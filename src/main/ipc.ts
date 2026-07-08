import { ipcMain } from 'electron'
import { IntervalsAPI } from './services/intervals-api'
import { chat, type LLMMessage, type ProviderConfig } from './services/llm-router'
import {
  getCachedCoachContext,
  invalidateCoachCache,
  getWeekExpiry,
  type TrainingStyle,
  type CoachContext,
  type WeeklyPlan
} from './services/coach-context'
import { generateWeeklyPlan } from './services/plan-generator'
import { fetchOpenAIModels } from './services/llm-models'
import Store from 'electron-store'

interface WeeklyStyle {
  style: TrainingStyle
  expiresAt: string
  reason?: string
}

const store = new Store<{
  providers: ProviderConfig[]
  defaultProvider: string
  defaultModel: string
  intervals: { athleteId: string; apiKey: string }
  coach: { weeklyStyle: WeeklyStyle | null }
}>({
  defaults: {
    providers: [] as ProviderConfig[],
    defaultProvider: '',
    defaultModel: '',
    intervals: { athleteId: '', apiKey: '' },
    coach: { weeklyStyle: null }
  }
})

let intervalsApi: IntervalsAPI | null = null

function getIntervalsApi(): IntervalsAPI {
  if (!intervalsApi) {
    const config = store.get('intervals') as { athleteId: string; apiKey: string }
    intervalsApi = new IntervalsAPI(config.athleteId, config.apiKey)
  }
  return intervalsApi
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export function registerIpcHandlers(): void {
  ipcMain.handle('intervals:fetchWellness', async (_event, days: number) => {
    return getIntervalsApi().fetchWellness(daysAgo(days), daysAgo(0))
  })

  ipcMain.handle(
    'intervals:fetchActivities',
    async (_event, startDate: string, endDate: string) => {
      return getIntervalsApi().fetchActivities(startDate, endDate)
    }
  )

  ipcMain.handle('intervals:fetchPowerCurves', async () => {
    return getIntervalsApi().fetchPowerCurves()
  })

  ipcMain.handle('intervals:fetchGear', async () => {
    return getIntervalsApi().fetchGear()
  })

  ipcMain.handle(
    'coach:getContext',
    async (_event, forceRefresh = false): Promise<CoachContext | null> => {
      const cfg = store.get('intervals')
      if (!cfg.athleteId || !cfg.apiKey) return null
      if (forceRefresh) invalidateCoachCache()
      const weeklyStyle = store.get('coach').weeklyStyle
      try {
        return await getCachedCoachContext(getIntervalsApi(), {
          userOverride: weeklyStyle ?? undefined
        })
      } catch (err) {
        console.error('[coach:getContext] failed:', err instanceof Error ? err.message : err)
        throw err
      }
    }
  )

  ipcMain.handle('coach:setWeeklyStyle', async (_event, style: TrainingStyle | null) => {
    if (style) {
      store.set('coach.weeklyStyle', {
        style,
        expiresAt: getWeekExpiry(),
        reason: '用户手动切换本周训练风格'
      })
    } else {
      store.set('coach.weeklyStyle', null)
    }
    invalidateCoachCache()
  })

  ipcMain.handle(
    'plan:generate',
    async (
      _event,
      style?: TrainingStyle,
      startDate?: string,
      endDate?: string
    ): Promise<WeeklyPlan> => {
      const cfg = store.get('intervals')
      if (!cfg.athleteId || !cfg.apiKey) throw new Error('请先配置 intervals.icu')

      const ctx = await getCachedCoachContext(getIntervalsApi(), {
        userOverride: store.get('coach').weeklyStyle ?? undefined
      })
      if (!ctx) throw new Error('无法获取教练上下文')

      const providers = store.get('providers')
      const providerName = store.get('defaultProvider')
      const model = store.get('defaultModel')
      if (!providerName || !model) {
        throw new Error('未设置默认模型，请在设置中选择默认供应商和模型')
      }
      const provider = providers.find((p) => p.name === providerName)
      if (!provider) throw new Error(`未找到模型配置: ${providerName}`)

      console.log(
        '[plan:generate] requested style:',
        style ?? 'default',
        'target:',
        startDate ?? 'default',
        endDate ?? 'default'
      )
      try {
        const plan = await generateWeeklyPlan(ctx, { provider, model }, style, startDate, endDate)
        console.log('[plan:generate] generated style:', plan.style)
        return plan
      } catch (err) {
        const message = err instanceof Error ? err.message : '未知错误'
        console.error('[plan:generate] failed:', message)
        if (message.includes('aborted') || message.includes('AbortError')) {
          throw new Error('生成计划超时（5分钟）。建议：缩短日期范围、换更快的模型、或检查网络。')
        }
        throw err
      }
    }
  )

  ipcMain.handle('plan:push', async (_event, plan: WeeklyPlan) => {
    console.log('[plan:push] start:', plan.startDate, plan.days.length, 'days')
    const api = getIntervalsApi()
    let created = 0
    let failed = 0
    let skipped = 0
    let deleted = 0
    const errors: string[] = []
    const eventIds: string[] = []

    const eventsByDate = new Map<string, string[]>()
    try {
      const existingEvents = await api.fetchEvents(plan.startDate, plan.endDate)
      console.log('[plan:push] fetched existing events:', existingEvents.length)
      for (const evt of existingEvents) {
        if (evt.category !== 'WORKOUT' || !evt.id) continue
        const date = evt.start_date_local?.slice(0, 10)
        if (!date) continue
        const list = eventsByDate.get(date) ?? []
        list.push(evt.id)
        eventsByDate.set(date, list)
      }
    } catch (err) {
      console.error('[plan:push] failed to fetch existing events:', err)
    }

    for (const day of plan.days) {
      try {
        const existingIds = eventsByDate.get(day.date) ?? []
        for (const id of existingIds) {
          try {
            console.log('[plan:push] deleting existing event:', id)
            await api.deleteEvent(id)
            deleted++
          } catch (err) {
            console.error(`[plan:push] failed to delete event ${id}:`, err)
          }
        }

        if (day.type === 'rest' || day.tss === 0) {
          skipped++
          continue
        }
        console.log('[plan:push] creating event:', day.date, day.name)
        const event = await api.createEvent({
          start_date_local: `${day.date}T00:00:00`,
          category: 'WORKOUT',
          name: day.name,
          description: day.description,
          type: day.type === 'VirtualRide' ? 'VirtualRide' : 'Ride',
          moving_time: day.duration,
          distance: 0,
          icu_training_load: day.tss,
          workout_doc: day.workoutDoc
            ? (day.workoutDoc as unknown as Record<string, unknown>)
            : undefined
        })
        console.log('[plan:push] created event:', event.id)
        if (event.id) eventIds.push(event.id)
        created++
      } catch (err) {
        failed++
        errors.push(`${day.date}: ${err instanceof Error ? err.message : '未知错误'}`)
      }
    }

    console.log('[plan:push] done:', { created, failed, skipped, deleted, errors: errors.length })
    return { created, failed, skipped, deleted, errors, eventIds }
  })

  ipcMain.handle('plan:delete', async (_event, eventIds: string[]) => {
    console.log('[plan:delete] start:', eventIds.length, 'events')
    const api = getIntervalsApi()
    let deleted = 0
    let failed = 0
    const errors: string[] = []

    for (const id of eventIds) {
      try {
        console.log('[plan:delete] deleting event:', id)
        await api.deleteEvent(id)
        deleted++
      } catch (err) {
        failed++
        errors.push(`${id}: ${err instanceof Error ? err.message : '未知错误'}`)
      }
    }

    console.log('[plan:delete] done:', { deleted, failed, errors: errors.length })
    return { deleted, failed, errors }
  })

  ipcMain.handle('config:get', () => store.store)
  ipcMain.handle('config:set', (_event, config: Record<string, unknown>) => {
    const prevIntervals = store.get('intervals') as { athleteId: string; apiKey: string }
    store.set(config)
    const nextIntervals = store.get('intervals') as { athleteId: string; apiKey: string }
    if (
      nextIntervals.athleteId !== prevIntervals.athleteId ||
      nextIntervals.apiKey !== prevIntervals.apiKey
    ) {
      intervalsApi = null
    }
  })
  ipcMain.handle('config:getCurrentModel', () => ({
    provider: store.get('defaultProvider'),
    model: store.get('defaultModel')
  }))
  ipcMain.handle('config:setCurrentModel', (_event, provider: string, model: string) => {
    store.set('defaultProvider', provider)
    store.set('defaultModel', model)
  })

  ipcMain.handle(
    'llm:fetchModels',
    async (_event, baseUrl: string, apiKey: string): Promise<string[]> => {
      if (!baseUrl) throw new Error('请先填写 Base URL')
      if (!apiKey) throw new Error('请先填写 API Key')
      return fetchOpenAIModels(baseUrl, apiKey)
    }
  )

  ipcMain.handle('llm:test', async (_event, providerData: ProviderConfig, model: string) => {
    const testMessages: LLMMessage[] = [{ role: 'user', content: 'Hi' }]
    const response = await chat({
      provider: providerData,
      model,
      messages: testMessages,
      maxTokens: 10
    })
    return { success: true, response: response.slice(0, 100) }
  })
}
