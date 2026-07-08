import { chatStream as openaiStream, chat as openaiChat, type LLMMessage } from './llm-openai'
import { chatStream as claudeStream, chat as claudeChat } from './llm-claude'

export type { LLMMessage }

export interface ProviderConfig {
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  type: 'openai' | 'claude'
}

export interface RouterOptions {
  provider: ProviderConfig
  model: string
  messages: LLMMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

export async function* chatStream(options: RouterOptions): AsyncGenerator<string, void, unknown> {
  const { provider, model, messages, temperature, maxTokens, timeoutMs } = options

  if (provider.type === 'claude') {
    yield* claudeStream({
      apiKey: provider.apiKey,
      model,
      messages,
      temperature,
      maxTokens,
      timeoutMs
    })
  } else {
    yield* openaiStream({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model,
      messages,
      temperature,
      maxTokens,
      timeoutMs
    })
  }
}

export async function chat(options: RouterOptions): Promise<string> {
  const { provider, model, messages, temperature, maxTokens, timeoutMs } = options

  if (provider.type === 'claude') {
    return claudeChat({
      apiKey: provider.apiKey,
      model,
      messages,
      temperature,
      maxTokens,
      timeoutMs
    })
  }
  return openaiChat({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model,
    messages,
    temperature,
    maxTokens,
    timeoutMs
  })
}
