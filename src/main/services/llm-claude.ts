import type { LLMMessage } from './llm-openai'

export interface ClaudeOptions {
  apiKey: string
  model: string
  messages: LLMMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

function splitSystem(messages: LLMMessage[]): { system: string; rest: LLMMessage[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n')
  const rest = messages.filter((m) => m.role !== 'system')
  return { system, rest }
}

async function requestClaude(options: ClaudeOptions, stream: boolean): Promise<Response> {
  const { apiKey, model, messages, temperature, maxTokens, timeoutMs = 60_000 } = options
  const { system, rest } = splitSystem(messages)

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens ?? 4096,
    messages: rest,
    stream
  }
  if (system) body.system = system
  if (temperature !== undefined) body.temperature = temperature

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Claude API error ${res.status}: ${text || res.statusText}`)
    }

    return res
  } finally {
    clearTimeout(timeout)
  }
}

export async function* chatStream(options: ClaudeOptions): AsyncGenerator<string, void, unknown> {
  const res = await requestClaude(options, true)

  if (!res.body) throw new Error('No response body in stream')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue

        const data = trimmed.slice(6)
        try {
          const json = JSON.parse(data)
          if (json.type === 'content_block_delta') {
            const text = json.delta?.text
            if (text) yield text
          } else if (json.type === 'message_stop') {
            return
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function chat(options: ClaudeOptions): Promise<string> {
  const res = await requestClaude(options, false)
  const json = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = json.content?.find((b) => b.type === 'text')?.text
  if (!text) throw new Error('No content in Claude response')
  return text
}
