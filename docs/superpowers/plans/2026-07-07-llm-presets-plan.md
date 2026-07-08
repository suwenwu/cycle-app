# LLM 国产模型预设与自动获取模型列表 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置页提供国产大模型预设模板，用户只需填 API Key 即可自动拉取可用模型列表并选择默认模型。

**架构：** 新增纯数据 preset 文件与 `/models` 拉取服务；主进程通过 IPC 暴露能力；渲染进程 SettingsView 增加 preset 选择、获取模型按钮与模型选择；失败时回退到手动输入。

**Tech Stack:** Electron + TypeScript + React + Tailwind CSS

## Global Constraints

- 所有预设均为 `type: 'openai'`（OpenAI-compatible）
- `/models` 请求超时 30 秒
- 失败时必须保留手动输入模型名的入口
- 自定义供应商功能保持原样
- 所有新增代码需通过 `npm run typecheck` 和 `npm run lint`

---

### Task 1: 创建国产大模型预设数据文件

**Files:**
- Create: `src/main/data/llm-presets.ts`

**Interfaces:**
- Produces: `LLM_PRESETS: LLMPreset[]` where `LLMPreset = { name: string; baseUrl: string; type: 'openai' | 'claude' }`

- [ ] **Step 1: 定义 preset 类型并导出数组**

```typescript
export interface LLMPreset {
  name: string
  baseUrl: string
  type: 'openai' | 'claude'
}

export const LLM_PRESETS: LLMPreset[] = [
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', type: 'openai' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', type: 'openai' },
  { name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', type: 'openai' },
  { name: '火山引擎', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', type: 'openai' },
  { name: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', type: 'openai' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', type: 'openai' }
]
```

- [ ] **Step 2: 验证文件无类型错误**

Run: `npx tsc --noEmit src/main/data/llm-presets.ts`
Expected: no errors

---

### Task 2: 创建模型列表拉取服务

**Files:**
- Create: `src/main/services/llm-models.ts`

**Interfaces:**
- Consumes: none
- Produces: `fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<string[]>`

- [ ] **Step 1: 实现 fetchOpenAIModels 函数**

```typescript
export async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`获取模型列表失败 (${res.status}): ${text || res.statusText}`)
    }

    const data = (await res.json()) as unknown
    if (!data || typeof data !== 'object' || !('data' in data)) {
      throw new Error('返回格式不支持自动获取模型，请手动填写')
    }

    const models = (data as { data?: unknown[] }).data
    if (!Array.isArray(models)) {
      throw new Error('返回格式不支持自动获取模型，请手动填写')
    }

    const ids = models
      .map((m) => (m && typeof m === 'object' ? (m as { id?: string }).id : undefined))
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    if (ids.length === 0) {
      throw new Error('未找到可用模型')
    }

    return ids
  } catch (err) {
    clearTimeout(timeout)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('获取模型列表超时，请检查网络或手动填写模型')
    }
    throw err
  }
}
```

- [ ] **Step 2: 运行类型检查**

Run: `npm run typecheck:node`
Expected: pass

---

### Task 3: 添加 IPC handler

**Files:**
- Modify: `src/main/ipc.ts`

**Interfaces:**
- Consumes: `fetchOpenAIModels` from `src/main/services/llm-models.ts`
- Produces: `llm:fetchModels` IPC handler returning `string[]`

- [ ] **Step 1: 导入依赖**

在 `src/main/ipc.ts` 顶部新增：

```typescript
import { fetchOpenAIModels } from './services/llm-models'
import { LLM_PRESETS } from './data/llm-presets'
```

- [ ] **Step 2: 注册 llm:fetchModels handler**

在 `registerIpcHandlers` 内 `llm:test` handler 之前或之后添加：

```typescript
  ipcMain.handle(
    'llm:fetchModels',
    async (_event, baseUrl: string, apiKey: string): Promise<string[]> => {
      if (!baseUrl) throw new Error('请先填写 Base URL')
      if (!apiKey) throw new Error('请先填写 API Key')
      return fetchOpenAIModels(baseUrl, apiKey)
    }
  )
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck:node`
Expected: pass

---

### Task 4: 更新 preload 暴露 fetchModels

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Interfaces:**
- Produces: `window.electron.llm.fetchModels(baseUrl, apiKey) => Promise<string[]>`

- [ ] **Step 1: 修改 src/preload/index.ts**

在 `llm` 对象内新增：

```typescript
  llm: {
    test: (provider: Record<string, unknown>, model: string) =>
      ipcRenderer.invoke('llm:test', provider, model),
    fetchModels: (baseUrl: string, apiKey: string) =>
      ipcRenderer.invoke('llm:fetchModels', baseUrl, apiKey)
  }
```

- [ ] **Step 2: 修改 src/preload/index.d.ts**

在 `LLMAPI` 接口内新增：

```typescript
interface LLMAPI {
  test: (
    provider: Record<string, unknown>,
    model: string
  ) => Promise<{ success: boolean; response: string }>
  fetchModels: (baseUrl: string, apiKey: string) => Promise<string[]>
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: pass

---

### Task 5: 更新 SettingsView 增加 preset 与获取模型 UI

**Files:**
- Modify: `src/renderer/src/components/SettingsView.tsx`

**Interfaces:**
- Consumes: `LLM_PRESETS` data (via static import or IPC), `window.electron.llm.fetchModels`
- Produces: updated provider list with auto-filled models and default model selection

- [ ] **Step 1: 导入 preset 数据**

在 SettingsView 顶部新增：

```typescript
import { LLM_PRESETS } from '../../../main/data/llm-presets'
```

注意：electron-vite 允许 renderer 引用 main 目录下的纯数据/类型文件，只要没有 Node-only 依赖。`llm-presets.ts` 是纯数据，可以安全导入。

- [ ] **Step 2: 添加 preset 选择控件**

在 providers tab 顶部、默认模型选择区上方或内部添加：

```tsx
<div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
  <h2 className="mb-3 text-sm font-medium text-gray-800">快速添加国产模型</h2>
  <select
    value=""
    onChange={(e) => {
      const name = e.target.value
      if (!name) return
      const preset = LLM_PRESETS.find((p) => p.name === name)
      if (!preset) return
      const newProvider: ProviderConfig = {
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKey: '',
        models: [],
        type: preset.type
      }
      setConfig({
        ...config,
        providers: [newProvider, ...config.providers]
      })
      setEditingIdx(0)
      e.target.value = ''
    }}
    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
  >
    <option value="">选择厂商...</option>
    {LLM_PRESETS.map((p) => (
      <option key={p.name} value={p.name}>
        {p.name}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 3: 在每个 provider 编辑卡片添加「获取模型列表」按钮**

在 provider 编辑卡片按钮组（完成 / 测试连接 / 删除）中新增按钮：

```tsx
<button
  onClick={() => fetchModelsForProvider(idx)}
  disabled={testStatus.type === 'loading' && testStatus.provider === p.name}
  className="rounded-lg bg-blue-100 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-200 disabled:opacity-50"
>
  获取模型列表
</button>
```

- [ ] **Step 4: 实现 fetchModelsForProvider 函数**

在组件内新增：

```typescript
  const fetchModelsForProvider = async (idx: number): Promise<void> => {
    const p = config.providers[idx]
    if (!p.baseUrl || !p.apiKey) {
      setTestStatus({
        provider: p.name,
        message: '请先填写 Base URL 和 API Key',
        type: 'error'
      })
      return
    }
    setTestStatus({ provider: p.name, message: '获取模型列表中...', type: 'loading' })
    try {
      const models = await window.electron.llm.fetchModels(p.baseUrl, p.apiKey)
      updateProvider(idx, { models })
      setTestStatus({
        provider: p.name,
        message: `获取成功，共 ${models.length} 个模型`,
        type: 'success'
      })
      // 如果当前默认供应商就是这个，同步更新默认模型
      if (config.defaultProvider === p.name) {
        setConfig((prev) => ({
          ...prev,
          defaultModel: models[0] || prev.defaultModel
        }))
      }
    } catch (err) {
      setTestStatus({
        provider: p.name,
        message: err instanceof Error ? err.message : '获取模型列表失败',
        type: 'error'
      })
    }
  }
```

注意：`setConfig((prev) => ...)` 需要确保 `config` 状态正确更新；如果当前环境不允许函数式更新，请使用 `setConfig({ ...config, defaultModel: models[0] || config.defaultModel })`。

- [ ] **Step 5: 确保模型输入框仍可作为 fallback**

保留现有 models 输入框，不要删除。用户可以在获取失败时手动填写。

- [ ] **Step 6: 类型检查与 lint**

Run: `npm run typecheck && npm run lint`
Expected: pass

---

### Task 6: 集成验证

**Files:**
- None (manual verification)

- [ ] **Step 1: 运行开发模式**

Run: `npm run dev`

- [ ] **Step 2: 手动测试 happy path**

1. 打开设置 → LLM 供应商
2. 从「快速添加国产模型」选择 DeepSeek
3. 填入有效 API Key
4. 点击「获取模型列表」
5. 确认模型列表填充到 models 输入框/默认模型下拉框
6. 选择默认模型，保存
7. 回到训练计划页点击生成，确认能正常调用 LLM

- [ ] **Step 3: 手动测试失败路径**

1. 选择任意 preset
2. 填错误 API Key
3. 点击「获取模型列表」
4. 确认显示错误信息且仍可手动输入模型名

- [ ] **Step 4: 打包验证**

Run: `npm run build:unpack`
Expected: 构建成功

- [ ] **Step 5: 运行 lint 和 typecheck**

Run: `npm run typecheck && npm run lint`
Expected: pass

---

## Self-Review Checklist

1. **Spec coverage:**
   - 提供国产大模型预设 → Task 1 + Task 5 Step 2
   - 自动拉取模型列表 → Task 2 + Task 3 + Task 5 Step 4
   - 失败时保留手动输入 → Task 5 Step 5
   - 保留自定义供应商 → Task 5 不改变原有 addProvider 逻辑
   - 预设只带 URL，用户填 API Key → Task 1 数据设计 + Task 5 Step 2

2. **Placeholder scan:** 无 TBD/TODO/"适当处理"等模糊描述。

3. **Type consistency:**
   - `fetchOpenAIModels` 签名一致
   - IPC handler 与 preload 声明一致
   - `LLMPreset` 在 data 文件和 SettingsView 中一致
