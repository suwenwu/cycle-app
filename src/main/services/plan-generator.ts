import type {
  CoachContext,
  TrainingStyle,
  WeeklyPlan,
  WorkoutDoc,
  WorkoutStep
} from './coach-context'
import { chat, type ProviderConfig } from './llm-router'
import { addDaysLocal, dayOfWeekLabel, daysBetween } from './time-utils'

export interface PlanGeneratorDeps {
  provider: ProviderConfig
  model: string
}

function buildPlanPrompt(
  ctx: CoachContext,
  range: { start: string; end: string },
  styleOverride?: TrainingStyle
): string {
  const style = styleOverride ?? ctx.recommendation.currentStyle
  const ftp = ctx.athlete.ftp ?? 280
  const dayCount = daysBetween(range.start, range.end) + 1
  const periodTssTarget = Math.round(ctx.recommendation.weeklyTssTarget * (dayCount / 7))
  const base = buildBasePrompt(ctx, range, periodTssTarget)
  const styleSection = buildStylePrompt(ctx, style)
  const outputFormat = buildOutputFormat(
    ftp,
    dayCount,
    periodTssTarget,
    ctx.recommendation.intensityCaps.maxSessionTss
  )
  return `${base}\n\n${styleSection}\n\n${outputFormat}`
}

function buildBasePrompt(
  ctx: CoachContext,
  range: { start: string; end: string },
  periodTssTarget: number
): string {
  const ftp = ctx.athlete.ftp ?? 280
  const weight = ctx.athlete.weight ?? 75
  const maxHr = ctx.athlete.maxHr ?? 180

  const thisWeekLines =
    ctx.thisWeek
      .map(
        (a) =>
          `- ${a.date} ${a.name} (${a.type}) ${formatDuration(a.duration)} TSS${a.tss ?? '-'} NP${a.normalizedPower ?? '-'}W`
      )
      .join('\n') || '无'

  const lastWeekLines =
    ctx.lastWeek
      .map(
        (a) =>
          `- ${a.date} ${a.name} (${a.type}) ${formatDuration(a.duration)} TSS${a.tss ?? '-'} NP${a.normalizedPower ?? '-'}W`
      )
      .join('\n') || '无'

  const gaps = ctx.powerProfile.gaps.length ? ctx.powerProfile.gaps.join('，') : '无明显短板'
  const cap = ctx.capacity
  const highIntensityDone = ctx.thisWeek.filter(
    (a) => a.normalizedPower && ftp > 0 && a.normalizedPower / ftp >= 1.05
  ).length

  const dayCount = daysBetween(range.start, range.end) + 1
  return `你是一名资深自行车教练，专攻功率训练。请严格根据以下运动员数据制定目标周期（${range.start} 至 ${range.end}，共 ${dayCount} 天）训练计划。

## 运动员档案
- FTP: ${ftp}W
- 体重: ${weight}kg
- 最大心率: ${maxHr}bpm

## 当前状态（排课时必须参考）
- CTL: ${ctx.recovery.ctl.toFixed(1)}
- ATL: ${ctx.recovery.atl.toFixed(1)}
- TSB: ${ctx.recovery.tsb.toFixed(1)}
- HRV 今日/基线: ${ctx.recovery.hrvToday?.toFixed(0) ?? '-'}/${ctx.recovery.hrvBaseline.toFixed(0)}
- 睡眠: ${ctx.recovery.sleepHours?.toFixed(1) ?? '-'}h
- 恢复状态: ${ctx.recovery.status}${ctx.recovery.restriction ? `（限制：${ctx.recovery.restriction}）` : ''}

## 本周已完成的训练（直接影响剩余天数安排）
${thisWeekLines}
- 注：本周已完成 ≥105% FTP 的高强度训练 ${highIntensityDone} 次

## 上周训练
${lastWeekLines}

## 近 30 天负荷分布
- 总 TSS: ${ctx.recentLoad.totalTSS}
- 低强度: ${ctx.recentLoad.lowAerobicPercent}%
- 高强度: ${ctx.recentLoad.highAerobicPercent}%
- 无氧: ${ctx.recentLoad.anaerobicPercent}%
- 周均时长: ${ctx.recentLoad.weeklyHours}h

## 历史负荷参考（制定目标时优先参考 4/12 周均值）
- 上周 TSS: ${cap.lastWeekTss}
- 4 周平均周 TSS: ${cap.avg4WeeksTss}
- 12 周平均周 TSS: ${cap.avg12WeeksTss}
- 26 周平均周 TSS: ${cap.avg26WeeksTss}
- 52 周平均周 TSS: ${cap.avg52WeeksTss}

## 能力短板
${gaps}

## 全局约束（任何风格都必须遵守）
- 周期 TSS 目标上限: ${periodTssTarget}
- 单次 TSS 上限: ${ctx.recommendation.intensityCaps.maxSessionTss}
- ${ctx.recommendation.intensityCaps.z3z4 ? '本周禁止 3区/4区 灰色区域训练，只做 1区/2区 或 5区/6区' : '允许适量 3区/4区，但优先级低于 1区/2区 和 5区/6区'}
- 如果 recovery.status === 'red' 或 TSB < -10 或 HRV < 基线 85% 或睡眠 <6h：
  - 当天必须是 rest 或 ≤60 分钟 1区/2区恢复骑
  - 取消所有 3区及以上训练
  - 当周 note 中说明降级原因
- 如果运动员状态不足以支撑所选风格的高强度要求，自动降级为有氧基础，并在 note 中说明
- 本周已完成 ≥2 次 ≥105% FTP 高强度训练后，剩余天数不再安排高强度
- 两次高强度日之间至少隔 1 天低强度或休息
- 日期和周几由系统填充，你只需按顺序输出 7 天内容，date 填 "YYYY-MM-DD" 占位即可`
}

function buildStylePrompt(ctx: CoachContext, style: TrainingStyle): string {
  const ftp = ctx.athlete.ftp ?? 280
  const baseLines = [
    `## 训练风格：${style}`,
    `### 排课时必须使用的数据`,
    `- CTL=${ctx.recovery.ctl.toFixed(1)} 决定可承受总负荷`,
    `- TSB=${ctx.recovery.tsb.toFixed(1)} 决定能否上高强度：TSB < -10 时取消高强度`,
    `- HRV=${ctx.recovery.hrvToday?.toFixed(0) ?? '-'} / 基线 ${ctx.recovery.hrvBaseline.toFixed(0)}：低于基线 85% 当天禁止高强度`,
    `- 睡眠=${ctx.recovery.sleepHours?.toFixed(1) ?? '-'}h：<6h 当天禁止高强度`,
    `- 本周已完成 ≥105% FTP 训练次数决定剩余高强度配额`,
    `- FTP=${ftp}W 用于计算绝对功率`
  ].join('\n')

  const styleContent = STYLE_PROMPTS[style] ?? STYLE_PROMPTS.polarized
  return `${baseLines}\n\n${styleContent}`
}

const STYLE_PROMPTS: Record<TrainingStyle, string> = {
  polarized: `### 核心原则
- 强度两极化：低强度有氧（1区/2区）占绝大多数，高强度（5区/6区）占少数，刻意压缩 3区/4区灰色区域
- 训练刺激来自"足够轻松 + 足够困难"，而不是中等强度磨时间
- 周结构根据恢复状态动态安排：状态好可放 2 次高强度，状态黄灯放 1 次，红灯只低强度恢复

### 强度分布目标
- 1区/2区：≥ 80% 训练量
- 5区/6区：≤ 20% 训练量
- 3区/4区：尽量 ≤ 5%

### 低强度课原则
- 功率 ≤ 75% FTP，心率 ≤ LTHR 以下
- 时长根据运动员可用时间和有氧基础安排：60-150 分钟
- 爬坡或顺风时不允许出现 > 80% FTP 的持续输出，必须控制强度

### 高强度课原则
- 单次主 set 总有效时间 12-30 分钟
- 可选形式：
  - VO2Max：3-6 组 x 3-5 分钟 @105-115% FTP
  - 厌氧能力：6-10 组 x 1-2 分钟 @115-130% FTP
  - 神经肌肉/冲刺：8-12 组 x 20-40 秒 @130-150% FTP
- 高强度步骤用单个确切功率值

### 恢复与安排约束
- 两次高强度日之间至少隔 1 天低强度或休息
- 红灯/睡眠 <6h/HRV 低时，取消高强度，改为低强度或休息
- 本周如果已做过 ≥2 次 5区/6区训练，降低后续高强度频率`,

  aerobic: `### 核心原则
- 几乎全部为低强度有氧，目标是提升脂肪氧化、毛细血管密度和有氧效率
- 宁可训练时间更长、强度更低，也不要加间歇
- 周结构以运动员恢复能力和可用时间灵活安排，不需要固定休息日

### 强度分布目标
- 1区/2区：≥ 90% 训练量
- 3区及以上：≤ 10%，且只出现在短加速或爬坡不可避免情况下

### 有氧课原则
- 功率 60-75% FTP，心率有氧区间
- 单次时长 60-180 分钟，根据运动员历史周均时长决定
- 长距离日优先安排在恢复良好的日子

### 可选变化（每周最多 1 次）
- 短加速开腿：4-6 组 x 10-15 秒 @110% FTP，充分恢复
- 稳态 tempo：单次不超过 20 分钟 @75-80% FTP
- 踏频练习：4 x 5 分钟 90-110 rpm @60% FTP

### 禁止项
- 任何 ≥ 90% FTP 持续 ≥ 1 分钟的训练
- 任何 VO2Max、阈值、甜区长块
- 任何形式的组间恢复不足以完成的重复训练

### 恢复规则
- 长距离日后第二天降低强度或休息
- 红灯/高 RHR/低 HRV 时缩短时长但不加强度`,

  sweetspot: `### 核心原则
- 主训练刺激集中在 88-94% FTP 的甜区
- 在神经疲劳可控的前提下获得接近阈值的适应
- 周结构根据 CTL、TSB 和本周已完训练动态调整甜区日数量

### 强度分布目标
- 甜区：占有效训练时间的 30-45%
- 2区有氧：40-55%
- 5区/6区：≤ 10%，仅作为少量开腿
- 3区/4区：≤ 10%

### 甜区课原则
- 单次总甜区时间 24-60 分钟
- 可选形式：
  - 持续块：2x20min、3x15min、1x40min @88-92% FTP
  - 间歇：4x8min、5x6min、3x12min @90-94% FTP
  - 渐进完成：2x12min @92-94% FTP，最后 30-60 秒 @105% FTP
- 组间休息 2-5 分钟

### 课表结构
- 热身 ramp 10-15 分钟 50%-75%
- 主 set 按上面形式
- 放松 ramp 8-10 分钟 75%-50%

### 安排约束
- TSB < -10 时减少甜区总量或改为有氧
- 睡眠 <6h 时甜区课改为低强度有氧
- 甜区日之间至少隔 1 天低强度
- 甜区课中功率不能掉到 <85% FTP 超过 20 秒

### 禁止项
- 甜区日与 VO2Max 日不能同周
- 3 分钟以上的 5区输出`,

  intervals: `### 核心原则
- 以 5区/6区高强度间歇为主要刺激
- 通过不同持续时间和恢复比例发展 VO2Max、无氧能力和恢复速度
- 周结构根据运动员恢复状态和高强度耐受度动态安排

### 强度分布目标
- 5区/6区：占有效训练时间的 20-35%
- 2区有氧：45-60%
- 3区/4区：≤ 5%

### 间歇课原则
- 单次高强度有效时间 15-35 分钟
- 可选形式（根据短板和状态选 1-2 种/周）：
  - VO2Max：4-6 组 x 3-5 分钟 @105-115% FTP，休息 ≥ 1:1
  - 阈值间歇：2-4 组 x 6-10 分钟 @100-105% FTP，休息 3-5 分钟
  - 厌氧能力：8-12 组 x 1-2 分钟 @120-130% FTP，完全恢复
  - 冲刺：10-15 组 x 20-40 秒 @130-150% FTP，完全恢复

### 课表结构
- 热身 ramp 10-12 分钟 50%-75%
- 主 set 1-2 个不同刺激（如 VO2Max + 冲刺），但同一天不超过两种
- 放松 ramp 8-10 分钟 75%-50%

### 安排约束
- 高强度日之间至少隔 1 天低强度或休息
- 每周最多 3 次高强度日
- TSB < -15 或 HRV 低/睡眠差时取消高强度
- 本周已完成 ≥2 次 ≥105% FTP 训练后降低频率

### 强度规则
- 高强度步骤必须给单个确切功率值
- 恢复比 ≥ 1:1
- 不允许同一天混合 VO2Max + 厌氧 + 阈值三种刺激
- 禁止甜区长块（> 5 分钟 @88-94% FTP）`
}

function buildOutputFormat(
  ftp: number,
  dayCount: number,
  periodTssTarget: number,
  maxSessionTss: number
): string {
  return `## 输出格式
重要：只输出 JSON，不要 markdown 代码块，不要解释。
{
  "style": "所选风格",
  "weekTss": 数字,
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "note": "简短说明（20字以内，包含降级原因如果发生）",
  "days": [
    {
      "date": "YYYY-MM-DD",
      "dayOfWeek": "周一",
      "type": "rest|Ride|VirtualRide",
      "name": "训练名称",
      "description": "Warmup\n- 10m ramp 50%-65%\n\nMain Set 6x\n- 5m 106%\n- 5m 50%\n\nCooldown\n- 8m ramp 60%-40%",
      "tss": 数字,
      "duration": 秒数,
      "targetPower": "例如 182W",
      "targetHr": "例如 140bpm",
      "workoutDoc": {
        "description": "训练简述",
        "target": "POWER",
        "ftp": ${ftp},
        "steps": [
          {"power": {"start": 126, "end": 196, "units": "w"}, "duration": 1200, "ramp": true, "warmup": true, "text": "热身 ramp 126-196W"},
          {"reps": 6, "text": "Main Set", "steps": [
            {"power": {"value": 297, "units": "w"}, "duration": 300, "text": "5区 297W"},
            {"power": {"value": 140, "units": "w"}, "duration": 300, "text": "恢复 140W"}
          ]},
          {"power": {"start": 182, "end": 126, "units": "w"}, "duration": 600, "ramp": true, "cooldown": true, "text": "放松 ramp 182-126W"}
        ]
      }
    }
  ]
}

description 规则（intervals.icu 纯文本训练格式）：
1. 用段落分隔 Warmup / Main Set / Cooldown
2. 每步以短横线开头
3. 格式：- [时长] [强度]，例如 - 10m 65%、- 5m 106% 90rpm
4. 渐进：- 10m ramp 50%-75%
5. 重复组：reps 步骤的 text 填 clean 标题如 "Main Set"，不要带次数和括号
6. 时长用 m/s/h，强度用 %FTP

workout_doc 规则（备用结构化数据）：
1. 每个训练日（除休息外）必须提供 workoutDoc
2. workoutDoc.target 固定为 "POWER"
3. workoutDoc.ftp 固定为 ${ftp}
4. 每步必须有 text 字段
5. 热身用 ramp + warmup: true，放松用 ramp + cooldown: true
6. 功率值：固定功率用 {"value": X, "units": "w"}，渐进用 {"start": X, "end": Y, "units": "w"}
7. 高强度步骤（5区/6区）必须用单个确切功率值，禁止用范围
8. 主训练组用 reps + 嵌套 steps 表示
9. 所有字符串中禁止使用 "Z1"-"Z7"，用 "1区"/"2区"/"5区"/"6区" 或纯功率值替代
10. 可加入 cadence: {"value": 85, "units": "cadence"}

输出约束：
1. 按顺序输出共 ${dayCount} 天，date 填 "YYYY-MM-DD" 占位即可
2. 休息日：type="rest"，tss=0，duration=0，不要 workoutDoc
3. 非休息日必须有 workoutDoc 和 description
4. 总 TSS 不要超过 ${periodTssTarget}
5. 单次 TSS 不要超过 ${maxSessionTss}
6. 高强度日之间至少隔 1 天低强度或休息`
}

function buildDescription(name: string, doc?: WorkoutDoc): string {
  if (!doc || !doc.steps.length) return name
  const lines: string[] = [name]
  const ftp = doc.ftp || 280

  function formatStep(step: WorkoutStep, depth = 0): string {
    const indent = '  '.repeat(depth)
    if (step.reps && step.steps && step.steps.length > 0) {
      const header = `${indent}${step.text || 'Main Set'} ${step.reps}x`
      const children = step.steps.map((s) => formatStep(s, depth + 1))
      return [header, ...children].join('\n')
    }

    const duration = step.duration ?? 0
    const durText = formatWorkoutDuration(duration)
    const target = formatPowerTarget(step.power, ftp)
    const cadence = step.cadence ? ` ${step.cadence.value}rpm` : ''
    const power = step.power
    const hasRamp = step.ramp && power?.start != null && power?.end != null
    const powerText =
      hasRamp && power?.start != null && power?.end != null
        ? `ramp ${pct(power.start, ftp)}-${pct(power.end, ftp)}`
        : target
    return `${indent}- ${durText} ${powerText}${cadence}${step.text ? ` ${step.text}` : ''}`.trim()
  }

  const sections = groupStepsIntoSections(doc.steps)
  for (const section of sections) {
    lines.push('')
    lines.push(section.name)
    for (const step of section.steps) {
      lines.push(formatStep(step))
    }
  }

  return lines.join('\n')
}

function pct(watts: number, ftp: number): string {
  return `${Math.round((watts / ftp) * 100)}%`
}

function formatWorkoutDuration(seconds: number): string {
  if (seconds <= 0) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0 && m > 0) return `${h}h${m}m`
  if (h > 0) return `${h}h`
  if (m > 0 && s > 0) return `${m}m${s}s`
  if (m > 0) return `${m}m`
  return `${s}s`
}

function formatPowerTarget(power: WorkoutStep['power'], ftp: number): string {
  if (!power) return 'Z2'
  if (power.units === '%ftp') {
    if (power.value != null) return `${power.value}%`
    if (power.start != null && power.end != null) return `${power.start}-${power.end}%`
  }
  if (power.value != null) return pct(power.value, ftp)
  if (power.start != null && power.end != null)
    return `${pct(power.start, ftp)}-${pct(power.end, ftp)}`
  return 'Z2'
}

function groupStepsIntoSections(steps: WorkoutStep[]): { name: string; steps: WorkoutStep[] }[] {
  const sections: { name: string; steps: WorkoutStep[] }[] = []
  let current: WorkoutStep[] = []
  for (const step of steps) {
    if (step.warmup) {
      if (current.length) {
        sections.push({ name: 'Main Set', steps: current })
        current = []
      }
      sections.push({ name: 'Warmup', steps: [step] })
    } else if (step.cooldown) {
      if (current.length) {
        sections.push({ name: 'Main Set', steps: current })
        current = []
      }
      sections.push({ name: 'Cooldown', steps: [step] })
    } else {
      current.push(step)
    }
  }
  if (current.length) {
    sections.push({ name: 'Main Set', steps: current })
  }
  return sections
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h${m}m`
  return `${m}m`
}

function nextWeekRange(thisWeekEnd: string): { start: string; end: string } {
  const start = addDaysLocal(thisWeekEnd, 1)
  const end = addDaysLocal(start, 6)
  return { start, end }
}

function parsePlanJson(text: string, fallbackRange: { start: string; end: string }): WeeklyPlan {
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('LLM 输出中未找到 JSON 对象')
  }

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>
  } catch (err) {
    throw new Error(`JSON 解析失败: ${err instanceof Error ? err.message : '未知错误'}`)
  }

  if (!Array.isArray(raw.days)) {
    throw new Error('LLM 输出缺少 days 数组')
  }

  const expectedCount = daysBetween(fallbackRange.start, fallbackRange.end) + 1
  if (raw.days.length !== expectedCount) {
    console.warn(
      `[plan-generator] day count mismatch: expected ${expectedCount}, got ${raw.days.length}`
    )
  }

  const days = raw.days.map((day: unknown, idx: number) => {
    if (!day || typeof day !== 'object') {
      throw new Error(`days[${idx}] 不是对象`)
    }
    const d = day as Record<string, unknown>
    const correctedDate = addDaysLocal(fallbackRange.start, idx)
    const correctedDayOfWeek = dayOfWeekLabel(correctedDate)
    return {
      date: correctedDate,
      dayOfWeek: correctedDayOfWeek,
      type: String(d.type ?? 'rest'),
      name: String(d.name ?? ''),
      description: buildDescription(
        String(d.name ?? ''),
        d.workoutDoc ? parseWorkoutDoc(d.workoutDoc as Record<string, unknown>) : undefined
      ),
      tss: Number(d.tss) || 0,
      duration: Number(d.duration) || 0,
      targetPower: d.targetPower ? String(d.targetPower) : undefined,
      targetHr: d.targetHr ? String(d.targetHr) : undefined,
      workoutDoc: d.workoutDoc
        ? parseWorkoutDoc(d.workoutDoc as Record<string, unknown>)
        : undefined
    }
  })

  return {
    style: (raw.style as TrainingStyle) ?? 'polarized',
    weekTss: Number(raw.weekTss) || 0,
    startDate: String(raw.startDate || fallbackRange.start),
    endDate: String(raw.endDate || fallbackRange.end),
    note: raw.note as string | undefined,
    days
  }
}

function parseWorkoutDoc(raw: Record<string, unknown>): WorkoutDoc {
  return {
    description: String(raw.description ?? ''),
    target: raw.target === 'HR' ? 'HR' : 'POWER',
    ftp: Number(raw.ftp) || 0,
    steps: Array.isArray(raw.steps) ? raw.steps.map(parseWorkoutStep) : []
  }
}

function parseWorkoutStep(raw: unknown): WorkoutStep {
  const s = (raw ?? {}) as Record<string, unknown>
  const step: WorkoutStep = {
    text: String(s.text ?? '')
  }
  if (typeof s.duration === 'number') step.duration = s.duration
  if (typeof s.distance === 'number') step.distance = s.distance
  if (typeof s.reps === 'number') step.reps = s.reps
  if (s.warmup === true) step.warmup = true
  if (s.cooldown === true) step.cooldown = true
  if (s.ramp === true) step.ramp = true
  if (s.power && typeof s.power === 'object') {
    const p = s.power as Record<string, unknown>
    step.power = {
      units: p.units === '%ftp' ? '%ftp' : 'w',
      value: typeof p.value === 'number' ? p.value : undefined,
      start: typeof p.start === 'number' ? p.start : undefined,
      end: typeof p.end === 'number' ? p.end : undefined
    }
  }
  if (s.hr && typeof s.hr === 'object') {
    const h = s.hr as Record<string, unknown>
    step.hr = {
      units: ['bpm', '%hr', '%lthr'].includes(String(h.units))
        ? (String(h.units) as 'bpm' | '%hr' | '%lthr')
        : 'bpm',
      value: typeof h.value === 'number' ? h.value : undefined,
      start: typeof h.start === 'number' ? h.start : undefined,
      end: typeof h.end === 'number' ? h.end : undefined
    }
  }
  if (s.cadence && typeof s.cadence === 'object') {
    const c = s.cadence as Record<string, unknown>
    step.cadence = {
      value: Number(c.value) || 0,
      units: 'cadence'
    }
  }
  if (Array.isArray(s.steps)) {
    step.steps = s.steps.map(parseWorkoutStep)
  }
  return step
}

export async function generateWeeklyPlan(
  ctx: CoachContext,
  deps: PlanGeneratorDeps,
  styleOverride?: TrainingStyle,
  startDate?: string,
  endDate?: string
): Promise<WeeklyPlan> {
  const range =
    startDate && endDate ? { start: startDate, end: endDate } : nextWeekRange(ctx.weekRange.end)
  const targetStyle = styleOverride ?? ctx.recommendation.currentStyle
  const prompt = buildPlanPrompt(ctx, range, styleOverride)

  console.log('[plan-generator] target range:', range.start, 'to', range.end, 'style:', targetStyle)
  const response = await chat({
    provider: deps.provider,
    model: deps.model,
    messages: [
      { role: 'system', content: '你是资深自行车教练，只输出合法 JSON。' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    maxTokens: 2000,
    timeoutMs: 300_000
  })

  try {
    const plan = parsePlanJson(response, range)
    if (plan.style !== targetStyle) {
      console.log('[plan-generator] overriding style:', plan.style, '->', targetStyle)
      plan.style = targetStyle
    }
    return plan
  } catch (err) {
    console.error('[plan-generator] parse failed:', err instanceof Error ? err.message : err)
    console.error('[plan-generator] raw response:', response.slice(0, 2000))
    throw err
  }
}

export { nextWeekRange }
