# LLM 国产模型预设与自动获取模型列表

## 背景

当前设置页要求用户手动填写 LLM 供应商的 name、baseUrl、apiKey、models。国产大模型用户常不清楚该填什么 URL 和模型名，导致配置失败率高。

## 目标

1. 提供常用国产大模型预设，用户只需选择厂商并填写 API Key。
2. 通过 OpenAI-compatible `/models` 接口自动拉取该账号可用的模型列表。
3. 保留完全自定义供应商的入口。

## 方案

采用方案 A：模板化预设 + 实时拉取模型列表 + 失败时允许手动输入。

## 交互流程

1. 用户进入 **设置 → LLM 供应商**。
2. 点击顶部 **「快速添加国产模型」** 下拉框，选择厂商（如 DeepSeek）。
3. 系统自动填入 name、baseUrl、type，API Key 为空待填。
4. 用户填写 API Key 后，点击该供应商卡片上的 **「获取模型列表」**。
5. 主进程调用 `${baseUrl}/models`。
6. 成功后模型列表写入该供应商，并自动展开模型选择下拉框。
7. 用户选择默认模型，保存配置。

## 预设厂商

| 显示名称 | name | baseUrl | type |
|---|---|---|---|
| 硅基流动 | SiliconFlow | `https://api.siliconflow.cn/v1` | openai |
| DeepSeek | DeepSeek | `https://api.deepseek.com/v1` | openai |
| 阿里云百炼 | AliyunBailian | `https://dashscope.aliyuncs.com/compatible-mode/v1` | openai |
| 火山引擎 | VolcanoEngine | `https://ark.cn-beijing.volces.com/api/v3` | openai |
| 月之暗面 Kimi | Moonshot | `https://api.moonshot.cn/v1` | openai |
| 智谱 GLM | ZhipuGLM | `https://open.bigmodel.cn/api/paas/v4` | openai |

## 新增文件

### `src/main/data/llm-presets.ts`

导出 `LLM_PRESETS` 数组，元素包含 `name`、`baseUrl`、`type`。无 API Key 和模型信息。

### `src/main/services/llm-models.ts`

```ts
export async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<string[]>
```

- 请求 `GET ${baseUrl.replace(/\/+$/,'')}/models`
- Header: `Authorization: Bearer ${apiKey}`
- 解析响应 `data[].id`
- 超时 30 秒
- 失败抛出带状态码/文本的 Error

## 修改文件

### `src/main/ipc.ts`

新增 handler:

```ts
ipcMain.handle('llm:fetchModels', async (_event, baseUrl: string, apiKey: string) => {
  return fetchOpenAIModels(baseUrl, apiKey)
})
```

### `src/preload/index.ts` + `src/preload/index.d.ts`

在 `llm` 命名空间下新增:

```ts
fetchModels: (baseUrl: string, apiKey: string) => Promise<string[]>
```

### `src/renderer/src/components/SettingsView.tsx`

1. 在 suppliers tab 顶部添加 preset 下拉选择框。
2. 选择 preset 后调用 `addProvider` 逻辑，但用 preset 数据初始化。
3. 在每个编辑中的供应商卡片上增加 **「获取模型列表」** 按钮。
4. 点击后调用 `window.electron.llm.fetchModels(p.baseUrl, p.apiKey)`。
5. 成功后更新 `provider.models`，并自动将第一个模型设为该 provider 的候选默认。
6. 保留手动输入模型名的输入框作为 fallback。
7. 失败时在测试状态区显示错误信息。

## 错误处理

- 网络超时：30 秒后提示「获取模型列表超时，请检查网络或手动填写模型」。
- HTTP 错误：提示状态码和返回文本。
- 返回格式错误：提示「该平台暂不支持自动获取模型，请手动填写」。
- 用户仍可手动在 models 输入框填写模型名。

## 边界情况

- 如果用户先添加 preset，再修改 baseUrl，获取模型列表仍按当前 baseUrl 执行。
- 如果 provider.type 为 claude，不显示「获取模型列表」按钮（Claude 没有标准 /models 接口）。
- 如果 providers 为空，默认模型选择区为空。

## 验证标准

1. 选择 preset 后正确生成 provider 条目。
2. 填写有效 API Key 后能拉取模型列表。
3. 拉取失败时显示友好错误，且仍可手动输入。
4. 自定义供应商功能保持原样。
5. typecheck 和 lint 通过。
