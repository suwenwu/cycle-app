import { ElectronAPI } from '@electron-toolkit/preload'

interface IntervalsAPI {
  fetchWellness: (days: number) => Promise<unknown[]>
  fetchActivities: (startDate: string, endDate: string) => Promise<unknown[]>
  fetchPowerCurves: () => Promise<unknown[]>
  fetchGear: () => Promise<unknown[]>
}

interface CoachAPI {
  getContext: (forceRefresh?: boolean) => Promise<unknown>
  setWeeklyStyle: (style: string | null) => Promise<void>
}

interface PlanAPI {
  generate: (style?: string, startDate?: string, endDate?: string) => Promise<unknown>
  push: (plan: Record<string, unknown>) => Promise<{
    created: number
    failed: number
    skipped: number
    deleted: number
    errors: string[]
    eventIds: string[]
  }>
  delete: (eventIds: string[]) => Promise<{ deleted: number; failed: number; errors: string[] }>
}

interface ConfigAPI {
  get: () => Promise<Record<string, unknown>>
  set: (config: Record<string, unknown>) => Promise<void>
  getCurrentModel: () => Promise<{ provider: string; model: string }>
  setCurrentModel: (provider: string, model: string) => Promise<void>
}

interface LLMAPI {
  test: (
    provider: Record<string, unknown>,
    model: string
  ) => Promise<{ success: boolean; response: string }>
  fetchModels: (baseUrl: string, apiKey: string) => Promise<string[]>
}

declare global {
  interface Window {
    electron: ElectronAPI & {
      intervals: IntervalsAPI
      coach: CoachAPI
      plan: PlanAPI
      config: ConfigAPI
      llm: LLMAPI
    }
  }
}
