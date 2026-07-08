export interface LLMProvider {
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
  type: 'openai' | 'claude'
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMConfig {
  providers: LLMProvider[]
  defaultProvider: string
  defaultModel: string
}

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

export type TrainingStyle = 'polarized' | 'aerobic' | 'sweetspot' | 'intervals'

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

export interface WeeklyPlan {
  style: TrainingStyle
  weekTss: number
  startDate: string
  endDate: string
  days: PlanDay[]
  note?: string
  eventIds?: string[]
}

export interface WorkoutStep {
  duration?: number
  distance?: number
  power?: { value?: number; start?: number; end?: number; units: 'w' | '%ftp' }
  hr?: { value?: number; start?: number; end?: number; units: 'bpm' | '%hr' | '%lthr' }
  cadence?: { value: number; units: 'cadence' }
  warmup?: boolean
  cooldown?: boolean
  ramp?: boolean
  reps?: number
  steps?: WorkoutStep[]
  text: string
}

export interface WorkoutDoc {
  description: string
  target: 'POWER' | 'HR'
  ftp: number
  steps: WorkoutStep[]
}

export interface PlanDay {
  date: string
  dayOfWeek: string
  type: 'rest' | 'Ride' | 'Run' | 'WeightTraining' | string
  name: string
  description: string
  tss: number
  duration: number
  targetPower?: string
  targetHr?: string
  workoutDoc?: WorkoutDoc
}

export interface PowerCurveSummary {
  label: string
  start: string
  end: string
  durations: number[]
  watts: number[]
  wattsPerKg?: number[]
}

export interface CoachContext {
  generatedAt: string
  weekRange: { start: string; end: string }
  athlete: {
    name?: string
    ftp?: number
    weight?: number
    maxHr?: number
  }
  recovery: {
    ctl: number
    atl: number
    tsb: number
    hrvBaseline: number
    hrvToday?: number
    rhrToday?: number
    sleepHours?: number
    status: 'green' | 'yellow' | 'red'
    restriction?: string
  }
  recentLoad: {
    totalTSS: number
    lowAerobicPercent: number
    highAerobicPercent: number
    anaerobicPercent: number
    weeklyHours: number
  }
  powerProfile: {
    thisSeason: PowerCurveSummary
    lastSeason: PowerCurveSummary
    gaps: string[]
  }
  thisWeek: ActivitySummary[]
  lastWeek: ActivitySummary[]
  capacity: {
    lastWeekTss: number
    avg4WeeksTss: number
    avg12WeeksTss: number
    avg26WeeksTss: number
    avg52WeeksTss: number
    weeklyHistory: { weekStart: string; tss: number }[]
    weeklyTssTarget: number
  }
  recommendation: {
    defaultStyle: 'polarized'
    currentStyle: TrainingStyle
    styleReason: string
    weeklyTssTarget: number
    intensityCaps: {
      z3z4: boolean
      maxSessionTss: number
    }
  }
  userOverride?: {
    style: TrainingStyle
    expiresAt: string
    reason?: string
  }
}

export interface ElectronAPI {
  intervals: {
    fetchWellness: (days: number) => Promise<WellnessData[]>
    fetchActivities: (startDate: string, endDate: string) => Promise<Activity[]>
    fetchPowerCurves: () => Promise<PowerCurveData[]>
    fetchGear: () => Promise<Gear[]>
  }
  coach: {
    getContext: (forceRefresh?: boolean) => Promise<CoachContext | null>
    setWeeklyStyle: (style: TrainingStyle | null) => Promise<void>
  }
  plan: {
    generate: (style?: string) => Promise<unknown>
    push: (plan: Record<string, unknown>) => Promise<{
      created: number
      failed: number
      skipped: number
      errors: string[]
      eventIds: string[]
    }>
    delete: (eventIds: string[]) => Promise<{ deleted: number; failed: number; errors: string[] }>
  }
  config: {
    get: () => Promise<LLMConfig>
    set: (config: LLMConfig) => Promise<void>
    getCurrentModel: () => Promise<{ provider: string; model: string }>
    setCurrentModel: (provider: string, model: string) => Promise<void>
  }
}
