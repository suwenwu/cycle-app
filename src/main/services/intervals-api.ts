const BASE_URL = 'https://intervals.icu/api/v1'

export interface WellnessData {
  date: string
  ctl?: number
  atl?: number
  tsb?: number
  hrv?: number
  rhr?: number
  sleep?: number
  sleepQuality?: number
  weight?: number
  load?: number
  rampRate?: number
}

export interface Activity {
  id: string
  name: string
  type: string
  startTime: string
  duration: number
  distance?: number
  averageWatts?: number
  normalizedPower?: number
  averageHr?: number
  maxHr?: number
  tss?: number
  intensityFactor?: number
}

export interface PowerCurvePoint {
  secs: number
  watts: number
  wattsPerKg?: number
}

export interface PowerCurveData {
  id: string
  label: string
  start: string
  end: string
  dataPoints: PowerCurvePoint[]
}

export interface Gear {
  id: string
  name: string
  type: string
  distance: number
}

export interface ActivitySummary {
  id: string
  name: string
  type: string
  date: string
  duration: number
  distance?: number
  tss?: number
  averageWatts?: number
  normalizedPower?: number
  averageHr?: number
  maxHr?: number
}

export interface CalendarEvent {
  id?: string
  start_date_local?: string
  category: 'WORKOUT' | 'NOTE' | 'EVENT'
  name: string
  description?: string
  type?: string
  moving_time?: number
  distance?: number
  icu_training_load?: number
  workout_doc?: Record<string, unknown>
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

function parseLocalDate(date: string): string {
  // intervals.icu returns YYYY-MM-DD; keep it as-is to avoid timezone drift
  return date
}

function sleepHours(d: Record<string, unknown>): number | undefined {
  if (typeof d.sleepSecs === 'number') return d.sleepSecs / 3600
  if (typeof d.sleepHours === 'number') return d.sleepHours
  return undefined
}

export class IntervalsAPI {
  private athleteId: string
  private authHeader: string

  constructor(athleteId: string, apiKey: string) {
    this.athleteId = athleteId
    this.authHeader = 'Basic ' + Buffer.from('API_KEY:' + apiKey).toString('base64')
  }

  private async request<T>(
    path: string,
    params?: Record<string, string>,
    init?: RequestInit
  ): Promise<T> {
    const url = new URL(BASE_URL + path)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        ...(init?.headers ?? {})
      }
    })
    if (!res.ok) throw new Error(`intervals.icu ${res.status}: ${await res.text()}`)
    if (res.status === 204) return undefined as T
    const text = await res.text()
    return text ? (JSON.parse(text) as T) : (undefined as T)
  }

  async fetchWellness(startDate: string, endDate: string): Promise<WellnessData[]> {
    const raw = await this.request<
      Record<string, Record<string, unknown>> | Record<string, unknown>[]
    >(`/athlete/${this.athleteId}/wellness`, { oldest: startDate, newest: endDate })

    const entries: [string, Record<string, unknown>][] = Array.isArray(raw)
      ? raw.map((d) => [String(d.id ?? d.date ?? ''), d])
      : Object.entries(raw)

    return entries.map(([date, d]) => {
      const ctl = num(d.ctl)
      const atl = num(d.atl)
      return {
        date: parseLocalDate(date),
        ctl,
        atl,
        tsb: num(d.tsb) ?? (ctl != null && atl != null ? ctl - atl : undefined),
        hrv: num(d.hrv),
        rhr: num(d.restingHR),
        sleep: sleepHours(d),
        sleepQuality: num(d.sleepQuality),
        weight: num(d.weight),
        load: num(d.ctlLoad) ?? num(d.atlLoad) ?? num(d.load),
        rampRate: num(d.rampRate)
      }
    })
  }

  async fetchActivities(startDate: string, endDate: string, limit = 50): Promise<Activity[]> {
    const raw = await this.request<Record<string, unknown>[]>(
      `/athlete/${this.athleteId}/activities`,
      { oldest: startDate, newest: endDate, limit: String(limit) }
    )
    return raw.map((a) => ({
      id: String(a.id),
      name: String(a.name ?? ''),
      type: String(a.type ?? ''),
      startTime: String(a.start_date_local ?? a.startTime ?? a.start_date ?? ''),
      duration: num(a.moving_time) ?? num(a.duration) ?? 0,
      distance: num(a.distance),
      averageWatts: num(a.avgPower) ?? num(a.icu_average_watts) ?? num(a.average_watts),
      normalizedPower: num(a.icu_weighted_avg_watts) ?? num(a.weighted_average_watts),
      averageHr: num(a.avgHR) ?? num(a.averageHR) ?? num(a.average_heartrate) ?? num(a.icu_avg_hr),
      maxHr: num(a.maxHR) ?? num(a.max_heartrate) ?? num(a.icu_max_hr),
      tss: num(a.trainingLoad) ?? num(a.icu_training_load) ?? num(a.tss),
      intensityFactor: num(a.icu_intensity) ?? num(a.intensity_factor)
    }))
  }

  async fetchActivityDetails(activityId: string): Promise<Activity> {
    const a = await this.request<Record<string, unknown>>(`/activity/${activityId}`)
    return {
      id: String(a.id),
      name: String(a.name ?? ''),
      type: String(a.type ?? ''),
      startTime: String(a.start_date_local ?? a.startTime ?? a.start_date ?? ''),
      duration: num(a.moving_time) ?? num(a.duration) ?? 0,
      distance: num(a.distance),
      averageWatts: num(a.avgPower) ?? num(a.icu_average_watts) ?? num(a.average_watts),
      normalizedPower: num(a.icu_weighted_avg_watts) ?? num(a.weighted_average_watts),
      averageHr: num(a.avgHR) ?? num(a.averageHR) ?? num(a.average_heartrate) ?? num(a.icu_avg_hr),
      maxHr: num(a.maxHR) ?? num(a.max_heartrate) ?? num(a.icu_max_hr),
      tss: num(a.trainingLoad) ?? num(a.icu_training_load) ?? num(a.tss),
      intensityFactor: num(a.icu_intensity) ?? num(a.intensity_factor)
    }
  }

  async fetchPowerCurves(activityType = 'Ride'): Promise<PowerCurveData[]> {
    // intervals.icu power-curves: s0 = this season, s1 = last season
    const raw = await this.request<{
      list: {
        id: string
        label: string
        start_date_local?: string
        end_date_local?: string
        start?: string
        end?: string
        secs: number[]
        values: number[]
        watts_per_kg?: number[]
      }[]
    }>(`/athlete/${this.athleteId}/power-curves`, { curves: 's0,s1', type: activityType })

    return raw.list.map((curve) => ({
      id: curve.id,
      label: curve.label,
      start: curve.start_date_local ?? curve.start ?? '',
      end: curve.end_date_local ?? curve.end ?? '',
      dataPoints: curve.secs.map((secs, i) => ({
        secs,
        watts: curve.values[i],
        wattsPerKg: curve.watts_per_kg?.[i]
      }))
    }))
  }

  async fetchGear(): Promise<Gear[]> {
    const raw = await this.request<Record<string, unknown>[]>(`/athlete/${this.athleteId}/gear`)
    return raw.map((g) => ({
      id: g.id as string,
      name: g.name as string,
      type: g.type as string,
      distance: g.distance as number
    }))
  }

  async createEvent(event: CalendarEvent): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(`/athlete/${this.athleteId}/events`, undefined, {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { 'Content-Type': 'application/json' }
    })
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.request<void>(`/athlete/${this.athleteId}/events/${eventId}`, undefined, {
      method: 'DELETE'
    })
  }

  async fetchEvents(startDate: string, endDate: string): Promise<CalendarEvent[]> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const events = await this.request<CalendarEvent[]>(
        `/athlete/${this.athleteId}/events`,
        {
          oldest: startDate,
          newest: endDate,
          category: 'WORKOUT'
        },
        { signal: controller.signal }
      )
      clearTimeout(timeout)
      return events
    } catch (err) {
      clearTimeout(timeout)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('获取日历事件超时')
      }
      throw err
    }
  }
}
