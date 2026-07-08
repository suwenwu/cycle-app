export interface LLMPreset {
  name: string
  baseUrl: string
  type: 'openai' | 'claude'
}

export const LLM_PRESETS: LLMPreset[] = [
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', type: 'openai' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', type: 'openai' },
  {
    name: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    type: 'openai'
  },
  { name: '火山引擎', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', type: 'openai' },
  { name: '月之暗面 Kimi', baseUrl: 'https://api.moonshot.cn/v1', type: 'openai' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', type: 'openai' }
]
