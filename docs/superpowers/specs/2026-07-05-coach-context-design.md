# 教练上下文重构设计文档

## 背景

当前 `cycle-app` 的聊天教练功能把 `.opencode/AGENTS.md`、`docs/training_philosophy.md`、`data/athlete_profile.md` 等静态文档直接拼进系统提示，固定走极化训练路线。存在以下问题：

1. **模板太死**：无论用户状态如何，都按极化训练给建议，无法根据有氧不足、甜区短板等动态调整。
2. **没有实时数据**：聊天前不拉取 intervals.icu 的最新 wellness/activities/power-curves，建议脱离当前疲劳状态。
3. **时间不一致**：系统用 UTC 计算日期，与运动员时区 Asia/Shanghai 不一致。
4. **缺少用户覆盖机制**：用户想临时换一种训练风格时，没有简单入口。

## 目标

- 打开聊天窗口时自动基于上海时间拉取最近 30 天数据，生成结构化分析报告。
- 在聊天界面上方展示报告卡，同时把分析结果注入系统提示。
- 默认按极化训练推荐，但允许数据驱动微调（有氧不足→有氧，5min 下降→间歇/甜区等）。
- 用户可一句话或点击按钮切换本周训练风格，覆盖持续到本周日。
- 下周一自动提示用户重新选择本周模式。
- 所有建议必须遵守安全红线，不超过用户当前恢复能力。

## 架构

```
用户打开 ChatView
    │
    ▼
[renderer] ChatView 调用 window.electron.coach.getContext()
    │
    ▼
[main] coach-context.ts
    ├── 获取上海当前日期/时间
    ├── 从 store 读取本周风格覆盖
    ├── 检查覆盖是否过期（是否过了本周日）
    ├── 拉取 intervals.icu 最近 30 天数据
    │     ├── wellness
    │     ├── activities
    │     └── power-curves
    │
    ├── style-recommender.ts：基于数据算推荐风格
    ├── safety-guard.ts：基于 HRV/RHR/TSB/睡眠算安全负荷上限
    │
    └── 返回 CoachContext（结构化 JSON）
              │
              ├──────► [renderer] ReportCard 组件渲染报告卡
              │
              └──────► [main] buildSystemPrompt()
                              把 CoachContext 拼进系统提示
                              发送给 LLM
```

所有时间计算统一在 main 进程用 `Asia/Shanghai`；原始数据→结构化分析→系统提示，分层明确；ReportCard 和 LLM 看到的是同一份分析结果。

## CoachContext 数据结构

```typescript
interface CoachContext {
  generatedAt: string       // 2026-07-05 09:30 (Asia/Shanghai)
  weekRange: {
    start: string           // 本周一
    end: string             // 本周日
  }
  athlete: {
    name?: string
    ftp?: number
    weight?: number
    maxHr?: number
  }
  recovery: {
    ctl: number
    atl: number
    tsb: number
    hrvBaseline: number
    hrvToday?: number
    rhrToday?: number
    sleepHours?: number
    status: 'green' | 'yellow' | 'red'
    restriction?: string    // 例如：HRV 偏低，今日不做高强度
  }
  recentLoad: {
    totalTSS: number
    lowAerobicPercent: number      // <0.75 FTP
    highAerobicPercent: number     // 0.75–0.95 FTP
    anaerobicPercent: number       // >0.95 FTP
    weeklyHours: number
  }
  powerProfile: {
    thisSeason: PowerCurveSummary
    lastSeason: PowerCurveSummary
    gaps: string[]                 // 例如：5min 功率相对下降 8%
  }
  recommendation: {
    defaultStyle: 'polarized'
    currentStyle: 'polarized' | 'aerobic' | 'sweetspot' | 'intervals'
    styleReason: string            // 为什么选这个风格
    weeklyTssTarget: number        // 安全负荷上限
    intensityCaps: {
      z3z4: boolean               // 是否禁止灰色区域
      maxSessionTss: number
    }
  }
  userOverride?: {
    style: string
    expiresAt: string
    reason?: string
  }
}
```

所有数字都已经过计算和格式化，LLM 不需要自己算。`recommendation.currentStyle` 是最终生效风格：先看用户本周覆盖，没覆盖再看数据推荐，都没就默认极化。

## 风格推荐逻辑

推荐优先级（从高到低）：

1. **用户本周覆盖**（存在且未过期）→ 直接用。
2. **安全红线**（TSB<-10 / HRV<基线85% / 连续恢复异常）→ 强制恢复骑/休息，风格=恢复。
3. **数据驱动推荐**（无用户覆盖时）：
   - 最近 30 天低强度有氧 < 70% → 推荐有氧基础。
   - 5min/20min 功率相对上赛季明显下降 → 推荐甜区或间歇。
   - CTL 连续下降且 TSB 高 → 维持极化。
   - 否则 → 默认极化。
4. **默认回退** → 极化。

**用户覆盖规则：**
- 用户在聊天里说“这周练甜区”或点击 ReportCard 按钮 → 存 `userOverride.style='sweetspot'`，`expiresAt=本周日 23:59`。
- 用户说“恢复默认” → 删除覆盖。
- 下周一打开聊天时，如果覆盖过期，ReportCard 顶部提示选择本周模式。

**风格定义：**
- 极化：80% Z1-Z2 + 20% Z5+
- 有氧：90%+ Z1-Z2
- 甜区：大量 88–94% FTP
- 间歇：短高功率 + 充分恢复

## 系统提示模板

```markdown
你是一名自行车教练。当前时间是 {generatedAt}，运动员时区 Asia/Shanghai。

## 运动员档案
{athleteProfile}

## 静态知识库
{staticDocs}

## 当前状态（{recovery.status}）
- CTL: {recovery.ctl}, ATL: {recovery.atl}, TSB: {recovery.tsb}
- HRV 基线: {recovery.hrvBaseline}, 今日: {recovery.hrvToday}
- 睡眠: {recovery.sleepHours}h
- 限制: {recovery.restriction}

## 最近 30 天训练分布
- 总 TSS: {recentLoad.totalTSS}
- 低强度有氧: {recentLoad.lowAerobicPercent}%
- 高强度有氧: {recentLoad.highAerobicPercent}%
- 无氧: {recentLoad.anaerobicPercent}%

## 能力短板
{powerProfile.gaps}

## 本周推荐
- 风格: {recommendation.currentStyle}
- 原因: {recommendation.styleReason}
- 周 TSS 目标上限: {recommendation.weeklyTssTarget}
- 强度限制: {recommendation.intensityCaps}

## 规则
1. 必须遵守 {recovery.status} 状态。红灯时只建议恢复骑或休息。
2. 不得推荐超过 {recommendation.weeklyTssTarget} 的周负荷。
3. 如果用户要求改变风格，按其要求；否则按本周推荐风格给计划。
4. 不主动提及功率曲线具体数值，只描述短板和训练方向。
```

静态知识库保留但位置靠后，实时数据放在前面，安全规则用具体数字写死。

## UI 报告卡 & 聊天流程

**ReportCard 组件：**

放在 `ChatView` 的消息列表上方，可折叠。显示：
- 当前时间（上海）
- 本周模式：极化 / 有氧 / 甜区 / 间歇
- 恢复状态灯（绿/黄/红）
- 本周 TSS 上限
- 关键短板（例如：低强度有氧不足 / 5min 功率下降）
- “刷新分析”按钮
- “切换本周模式”按钮（极化/有氧/甜区/间歇/恢复默认）

**聊天流程：**

1. 打开 ChatView → 自动调用 `coach.getContext()` → 显示 ReportCard。
2. 如果 `userOverride` 过期（新的一周）：ReportCard 顶部出现提示条选择模式。
3. 用户自由聊天，AI 基于系统提示里的 CoachContext 回答。
4. 用户说“这周练甜区”或点击按钮 → 更新 `userOverride` → 重新生成上下文。

**新增 IPC：**
- `coach:getContext()` → 返回 CoachContext
- `coach:setWeeklyStyle(style)` → 设置/清除本周风格
- `chat:send` 保持原样，main 进程构建提示时自动拼入 CoachContext

## 安全红线

安全规则写死在 `safety-guard.ts`，不交给 LLM 判断：

| 条件 | 动作 |
|------|------|
| HRV < 基线 85% 或 RHR 升高 ≥5 bpm | 推荐恢复骑，禁止高强度 |
| 连续 2 天恢复指标异常 | 强制休息 1 天 |
| 睡眠 < 6h | 次日不做高强度 |
| TSB < -10 | 进入保护模式，降负荷 1–2 天 |
| 用户选择风格但安全红灯 | 弹提示：当前状态不适合该风格，建议恢复 |

**周 TSS 上限计算：**
- 基线：最近 4 周平均周 TSS
- 根据 TSB 调整：TSB > 10 +10%；-5 ≤ TSB ≤ 10 维持；TSB < -10 -20%
- 红灯状态额外 -30%

## 错误处理

- **intervals.icu 拉取失败**：ReportCard 显示“数据更新失败，使用上次缓存”，系统提示里标注数据不是最新。
- **无 intervals 配置**：ReportCard 显示“请先配置 intervals.icu”，AI 仍可用静态知识回答。
- **LLM 调用失败**：保持现有错误提示。

## 文件变更计划

新增：
- `src/main/services/coach-context.ts`
- `src/main/services/style-recommender.ts`
- `src/main/services/safety-guard.ts`
- `src/main/services/time-utils.ts`（上海时间工具）
- `src/renderer/src/components/ReportCard.tsx`

修改：
- `src/main/services/system-prompt.ts`：接入 CoachContext
- `src/main/ipc.ts`：注册 `coach:getContext` / `coach:setWeeklyStyle`
- `src/preload/index.ts`：暴露 coach API
- `src/renderer/src/components/ChatView.tsx`：加载并显示 ReportCard
- `src/renderer/src/types/index.ts`：补充 CoachContext 类型

## 验收标准

- [ ] 打开聊天自动按上海时间拉取 30 天数据，不阻塞输入框。
- [ ] ReportCard 正确显示当前时间、恢复灯、本周模式、TSS 上限、短板。
- [ ] LLM 第一次回复能引用当前 CTL/TSB/HRV 等数据。
- [ ] 用户说“这周练甜区”后，本周推荐变为甜区，并持续到周日。
- [ ] 下周一打开时提示重新选择模式。
- [ ] TSB<-10 或 HRV 偏低时，AI 不推荐高强度训练。
- [ ] `npm run typecheck` 和 `npm run lint` 通过。
