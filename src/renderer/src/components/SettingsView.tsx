import { useState, useEffect } from 'react'
import { LLM_PRESETS } from '../../../main/data/llm-presets'

interface TestStatus {
  provider: string
  message: string
  type: 'idle' | 'loading' | 'success' | 'error'
}

interface ProviderConfig {
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  type: 'openai' | 'claude'
}

interface AppConfig {
  providers: ProviderConfig[]
  defaultProvider: string
  defaultModel: string
  intervals: { athleteId: string; apiKey: string }
}

interface Props {
  onClose: () => void
}

type Tab = 'providers' | 'intervals'

export default function SettingsView({ onClose }: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('providers')
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({})
  const [showIntervalsKey, setShowIntervalsKey] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>({
    provider: '',
    message: '',
    type: 'idle'
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.electron.config.get().then((c) => {
      const cfg = c as unknown as AppConfig
      const providers = cfg.providers || []
      let defaultProvider = cfg.defaultProvider
      let defaultModel = cfg.defaultModel
      // 如果没有默认模型，自动选择第一个供应商的第一个模型
      if (providers.length > 0 && (!defaultProvider || !defaultModel)) {
        defaultProvider = providers[0].name
        defaultModel = providers[0].models[0] || ''
      }
      setConfig({
        ...cfg,
        providers,
        defaultProvider,
        defaultModel
      })
    })
  }, [])

  if (!config) return <div className="flex h-screen items-center justify-center">Loading...</div>

  const updateProvider = (idx: number, patch: Partial<ProviderConfig>): void => {
    const next = [...config.providers]
    next[idx] = { ...next[idx], ...patch }
    setConfig({ ...config, providers: next })
  }

  const removeProvider = (idx: number): void => {
    setConfig({ ...config, providers: config.providers.filter((_, i) => i !== idx) })
    if (editingIdx === idx) setEditingIdx(null)
  }

  const addProvider = (): void => {
    const newProvider: ProviderConfig = {
      name: '',
      baseUrl: '',
      apiKey: '',
      models: [],
      type: 'openai'
    }
    setConfig({
      ...config,
      providers: [newProvider, ...config.providers]
    })
    setEditingIdx(0)
  }

  const handleSave = async (): Promise<void> => {
    const cfg = { ...config }
    const hasDefaultProvider = cfg.providers.some((p) => p.name === cfg.defaultProvider)
    if (cfg.providers.length > 0 && (!hasDefaultProvider || !cfg.defaultModel)) {
      cfg.defaultProvider = cfg.providers[0].name
      cfg.defaultModel = cfg.providers[0].models[0] || ''
      setConfig(cfg)
    }
    await window.electron.config.set(cfg as unknown as Record<string, unknown>)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveAndClose = async (): Promise<void> => {
    await handleSave()
    onClose()
  }

  const testProvider = async (provider: ProviderConfig): Promise<void> => {
    if (!provider.models.length) {
      setTestStatus({ provider: provider.name, message: '请先添加模型', type: 'error' })
      return
    }
    setTestStatus({ provider: provider.name, message: '测试中...', type: 'loading' })
    try {
      const result = await window.electron.llm.test(
        provider as unknown as Record<string, unknown>,
        provider.models[0]
      )
      setTestStatus({
        provider: provider.name,
        message: `连接成功: ${result.response}`,
        type: 'success'
      })
    } catch (err) {
      setTestStatus({
        provider: provider.name,
        message: err instanceof Error ? err.message : '测试失败',
        type: 'error'
      })
    }
  }

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
      const nextProviders = [...config.providers]
      nextProviders[idx] = { ...nextProviders[idx], models }
      const updates: Partial<AppConfig> = { providers: nextProviders }
      if (config.defaultProvider === p.name && models.length > 0) {
        updates.defaultModel = models[0]
      }
      setConfig({ ...config, ...updates })
      setTestStatus({
        provider: p.name,
        message: `获取成功，共 ${models.length} 个模型`,
        type: 'success'
      })
    } catch (err) {
      setTestStatus({
        provider: p.name,
        message: err instanceof Error ? err.message : '获取模型列表失败',
        type: 'error'
      })
    }
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-lg font-semibold text-gray-800">设置</h1>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600">已保存</span>}
          <button
            onClick={handleSave}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            保存
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-48 border-r border-gray-200 bg-white p-4">
          {(
            [
              ['providers', 'LLM 供应商'],
              ['intervals', 'intervals.icu']
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`mb-2 block w-full rounded-lg px-3 py-2 text-left text-sm ${
                tab === key
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <main className="flex-1 overflow-y-auto p-6">
          {tab === 'providers' && (
            <div>
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

              {config.providers.length > 0 && (
                <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
                  <h2 className="mb-3 text-sm font-medium text-gray-800">默认模型</h2>
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={config.defaultProvider}
                      onChange={(e) => {
                        const name = e.target.value
                        const p = config.providers.find((x) => x.name === name)
                        setConfig({
                          ...config,
                          defaultProvider: name,
                          defaultModel: p?.models[0] || ''
                        })
                      }}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      {config.providers.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name || '(未命名)'}
                        </option>
                      ))}
                    </select>
                    <select
                      value={config.defaultModel}
                      onChange={(e) => setConfig({ ...config, defaultModel: e.target.value })}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      {config.providers
                        .find((p) => p.name === config.defaultProvider)
                        ?.models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                    </select>
                  </div>
                  {!config.defaultProvider && (
                    <p className="mt-2 text-xs text-amber-600">尚未选择默认模型</p>
                  )}
                </div>
              )}

              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-medium text-gray-800">供应商列表</h2>
                <button
                  onClick={addProvider}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >
                  + 添加
                </button>
              </div>

              {config.providers.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">
                  暂无供应商配置，点击右上角&quot;添加&quot;创建你的第一个模型
                </div>
              )}

              {config.providers.map((p, idx) => (
                <div key={idx} className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
                  {editingIdx === idx ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          value={p.name}
                          onChange={(e) => updateProvider(idx, { name: e.target.value })}
                          placeholder="名称"
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        />
                        <select
                          value={p.type}
                          onChange={(e) =>
                            updateProvider(idx, { type: e.target.value as 'openai' | 'claude' })
                          }
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="openai">OpenAI Compatible</option>
                          <option value="claude">Claude</option>
                        </select>
                      </div>
                      <input
                        value={p.baseUrl}
                        onChange={(e) => updateProvider(idx, { baseUrl: e.target.value })}
                        placeholder="Base URL"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                      />
                      <div className="relative">
                        <input
                          type={showKeys[idx] ? 'text' : 'password'}
                          value={p.apiKey}
                          onChange={(e) => updateProvider(idx, { apiKey: e.target.value })}
                          placeholder="API Key"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKeys({ ...showKeys, [idx]: !showKeys[idx] })}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            {showKeys[idx] ? (
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                              />
                            ) : (
                              <>
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                />
                              </>
                            )}
                          </svg>
                        </button>
                      </div>
                      {p.models.length > 0 ? (
                        <select
                          value={config.defaultProvider === p.name ? config.defaultModel : ''}
                          onChange={(e) => {
                            const model = e.target.value
                            if (!model) return
                            const nextProviders = [...config.providers]
                            nextProviders[idx] = { ...nextProviders[idx], models: [model] }
                            setConfig({
                              ...config,
                              providers: nextProviders,
                              defaultProvider: p.name,
                              defaultModel: model
                            })
                          }}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                        >
                          <option value="">选择该供应商的默认模型...</option>
                          {p.models.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-xs text-gray-500">点击「获取模型列表」后在此选择模型</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setEditingIdx(null)}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                        >
                          完成
                        </button>
                        <button
                          onClick={() => testProvider(p)}
                          disabled={testStatus.type === 'loading' && testStatus.provider === p.name}
                          className="rounded-lg bg-green-100 px-3 py-1.5 text-sm text-green-700 hover:bg-green-200 disabled:opacity-50"
                        >
                          测试连接
                        </button>
                        <button
                          onClick={() => fetchModelsForProvider(idx)}
                          disabled={testStatus.type === 'loading' && testStatus.provider === p.name}
                          className="rounded-lg bg-blue-100 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-200 disabled:opacity-50"
                        >
                          获取模型列表
                        </button>
                        <button
                          onClick={() => removeProvider(idx)}
                          className="rounded-lg bg-red-100 px-3 py-1.5 text-sm text-red-700 hover:bg-red-200"
                        >
                          删除
                        </button>
                      </div>
                      {testStatus.provider === p.name && testStatus.type !== 'idle' && (
                        <p
                          className={`text-xs ${
                            testStatus.type === 'success'
                              ? 'text-green-600'
                              : testStatus.type === 'error'
                                ? 'text-red-600'
                                : 'text-gray-500'
                          }`}
                        >
                          {testStatus.message}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-800">{p.name || '(未命名)'}</div>
                        <div className="text-xs text-gray-500">{p.baseUrl}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.models.map((m) => (
                            <span
                              key={m}
                              className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => setEditingIdx(idx)}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                      >
                        编辑
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'intervals' && (
            <div className="max-w-md space-y-4">
              <h2 className="text-base font-medium text-gray-800">intervals.icu 配置</h2>
              <div>
                <label className="mb-1 block text-sm text-gray-600">Athlete ID</label>
                <input
                  value={config.intervals.athleteId}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      intervals: { ...config.intervals, athleteId: e.target.value }
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">API Key</label>
                <div className="relative">
                  <input
                    type={showIntervalsKey ? 'text' : 'password'}
                    value={config.intervals.apiKey}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        intervals: { ...config.intervals, apiKey: e.target.value }
                      })
                    }
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowIntervalsKey(!showIntervalsKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {showIntervalsKey ? (
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                        />
                      ) : (
                        <>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="flex items-center justify-between border-t border-gray-200 bg-white px-6 py-3">
        <p className="text-xs text-gray-500">修改后记得点击保存</p>
        <button
          onClick={handleSaveAndClose}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          保存并关闭
        </button>
      </footer>
    </div>
  )
}
