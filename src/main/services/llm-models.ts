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
