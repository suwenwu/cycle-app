export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  baseUrl: string
  apiKey: string
  model: string
  messages: LLMMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

async function requestChat(options: ChatOptions, stream: boolean): Promise<Response> {
  const { baseUrl, apiKey, model, messages, temperature, maxTokens, timeoutMs = 60_000 } = options

  const body: Record<string, unknown> = {
    model,
    messages,
    stream
  }
  if (temperature !== undefined) body.temperature = temperature
  if (maxTokens !== undefined) body.max_tokens = maxTokens

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`LLM API error ${res.status}: ${text || res.statusText}`)
    }

    return res
  } finally {
    clearTimeout(timeout)
  }
}

export async function* chatStream(options: ChatOptions): AsyncGenerator<string, void, unknown> {
  const res = await requestChat(options, true)

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
        if (data === '[DONE]') return

        try {
          const json = JSON.parse(data)
          const content = json.choices?.[0]?.delta?.content
          if (content) yield content
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function chat(options: ChatOptions): Promise<string> {
  const res = await requestChat(options, false)
  const text = await res.text()
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`LLM 返回不是 JSON: ${text.slice(0, 500)}`)
  }

  const choices = json.choices as
    Array<{ message?: { content?: string }; delta?: { content?: string } }> | undefined
  const content = choices?.[0]?.message?.content ?? choices?.[0]?.delta?.content
  if (!content) {
    console.error(
      '[llm-openai] empty content, response:',
      JSON.stringify(json, null, 2).slice(0, 2000)
    )
    const errorMsg = json.error
      ? JSON.stringify(json.error)
      : choices?.length === 0
        ? '模型返回空 choices'
        : '模型返回空内容'
    throw new Error(`LLM 无内容: ${errorMsg}`)
  }
  return content
}
