import { readFile } from 'fs/promises'
import { join } from 'path'
import type {
  IntervalsAPI,
  Activity,
  ActivitySummary,
  PowerCurveData,
  WellnessData
} from './intervals-api'
import { evaluateSafety } from './safety-guard'
import { recommendStyle, type TrainingStyle } from './style-recommender'

export type { TrainingStyle }
import {
  nowInShanghai,
  formatShanghaiDateTime,
  formatShanghaiDate,
  getWeekRange,
  getWeekExpiry,
  daysAgo,
  addDaysLocal
} from './time-utils'

const DATA_DIR = '/Users/s/Documents/cycle-training'

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
    thisSeason: {
      label: string
      start: string
      end: string
      durations: number[]
      watts: number[]
      wattsPerKg?: number[]
    }
    lastSeason: {
      label: string
      start: string
      end: string
      durations: number[]
      watts: number[]
      wattsPerKg?: number[]
    }
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

interface ParsedProfile {
  ftp?: number
  weight?: number
  maxHr?: number
}

async function parseAthleteProfile(): Promise<ParsedProfile> {
  try {
    const text = await readFile(join(DATA_DIR, 'data/athlete_profile.md'), 'utf-8')
    const weightMatch = text.match(/\|\s*体重\s*\|\s*([\d.]+)\s*kg\s*\|/)
    const ftpMatch = text.match(/\|\s*FTP\s*\(训练用\)\s*\|\s*(\d+)\s*W\s*\|/)
    const lthrMatch = text.match(/\|\s*LTHR\s*\|\s*(\d+)\s*bpm\s*\|/)
    return {
      weight: weightMatch ? parseFloat(weightMatch[1]) : undefined,
      ftp: ftpMatch ? parseInt(ftpMatch[1], 10) : undefined,
      maxHr: lthrMatch ? parseInt(lthrMatch[1], 10) : undefined
    }
  } catch {
    return {}
  }
}

function calcHrvBaseline(wellness: WellnessData[]): number {
  const vals = wellness
    .slice(-14)
    .map((w) => w.hrv)
    .filter((v): v is number => v != null)
  if (vals.length < 3) return 0
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)
  const filtered = vals.filter((v) => Math.abs(v - mean) <= 2 * sd)
  const s = [...filtered].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function analyzeLoad(activities: Activity[], ftp: number): CoachContext['recentLoad'] {
  let low = 0
  let high = 0
  let ana = 0
  let totalSeconds = 0

  for (const a of activities) {
    const tss = a.tss ?? 0
    if (tss <= 0) continue
    const np = a.normalizedPower ?? a.averageWatts
    const ifactor = a.intensityFactor
    let ratio: number | null = null
    if (np && np > 0) ratio = np / ftp
    else if (ifactor && ifactor > 0) ratio = ifactor

    if (ratio == null || ratio < 0.75) low += tss
    else if (ratio <= 0.95) high += tss
    else ana += tss
    totalSeconds += a.duration
  }

  const total = low + high + ana
  if (!total) {
    return {
      totalTSS: 0,
      lowAerobicPercent: 0,
      highAerobicPercent: 0,
      anaerobicPercent: 0,
      weeklyHours: 0
    }
  }

  return {
    totalTSS: Math.round(total),
    lowAerobicPercent: Math.round((low / total) * 100),
    highAerobicPercent: Math.round((high / total) * 100),
    anaerobicPercent: Math.round((ana / total) * 100),
    weeklyHours: Math.round((totalSeconds / 3600) * 10) / 10
  }
}

const KEY_DURATIONS = [5, 60, 300, 600, 1200, 3600]

function findNearestPoint(
  curve: PowerCurveData,
  targetSecs: number
): { watts: number; wattsPerKg?: number } | null {
  const pt = curve.dataPoints.reduce(
    (best, p) => {
      if (!best) return p
      return Math.abs(p.secs - targetSecs) < Math.abs(best.secs - targetSecs) ? p : best
    },
    null as { secs: number; watts: number; wattsPerKg?: number } | null
  )
  return pt ? { watts: pt.watts, wattsPerKg: pt.wattsPerKg } : null
}

function analyzePowerProfile(curves: PowerCurveData[]): {
  thisSeason: CoachContext['powerProfile']['thisSeason']
  lastSeason: CoachContext['powerProfile']['lastSeason']
  gaps: string[]
} {
  const thisSeason = curves.find((c) => c.id === 's0') ?? curves[0]
  const lastSeason = curves.find((c) => c.id === 's1') ?? curves[1]

  const empty = {
    label: '无数据',
    start: '',
    end: '',
    durations: [],
    watts: [],
    wattsPerKg: []
  }

  if (!thisSeason) {
    return { thisSeason: empty, lastSeason: lastSeason ? toSummary(lastSeason) : empty, gaps: [] }
  }

  const gaps: string[] = []
  if (lastSeason) {
    for (const secs of KEY_DURATIONS) {
      const current = findNearestPoint(thisSeason, secs)
      const previous = findNearestPoint(lastSeason, secs)
      if (current && previous && previous.watts > 0) {
        const decline = ((previous.watts - current.watts) / previous.watts) * 100
        if (decline >= 5) {
          gaps.push(`${fmtDuration(secs)} 功率下降 ${decline.toFixed(0)}%`)
        }
      }
    }
  }

  return {
    thisSeason: toSummary(thisSeason),
    lastSeason: lastSeason ? toSummary(lastSeason) : empty,
    gaps
  }
}

function toSummary(curve: PowerCurveData): CoachContext['powerProfile']['thisSeason'] {
  return {
    label: curve.label,
    start: curve.start,
    end: curve.end,
    durations: curve.dataPoints.map((p) => p.secs),
    watts: curve.dataPoints.map((p) => p.watts),
    wattsPerKg: curve.dataPoints.map((p) => p.wattsPerKg).filter((v): v is number => v != null)
  }
}

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.round(secs / 60)}min`
  return `${Math.round(secs / 3600)}h`
}

function getWeekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return formatShanghaiDate(d)
}

function computeWeeklyCapacity(
  activities: Activity[],
  currentWeekStart: string,
  safetyCap: number
): CoachContext['capacity'] {
  const weeklyTss = new Map<string, number>()
  for (const a of activities) {
    const date = a.startTime.slice(0, 10)
    if (!date || !a.tss) continue
    const weekStart = getWeekStart(date)
    weeklyTss.set(weekStart, (weeklyTss.get(weekStart) ?? 0) + a.tss)
  }

  // Exclude current week (may be incomplete)
  const completedWeeks = Array.from(weeklyTss.entries())
    .filter(([start]) => start < currentWeekStart)
    .sort((a, b) => (a[0] > b[0] ? -1 : 1))

  const lastWeekStart = addDaysLocal(currentWeekStart, -7)
  const lastWeekTss = weeklyTss.get(lastWeekStart) ?? 0

  const avg = (weeks: [string, number][]): number =>
    weeks.length ? Math.round(weeks.reduce((s, [, tss]) => s + tss, 0) / weeks.length) : 0

  const avg4WeeksTss = avg(completedWeeks.slice(0, 4))
  const avg12WeeksTss = avg(completedWeeks.slice(0, 12))
  const avg26WeeksTss = avg(completedWeeks.slice(0, 26))
  const avg52WeeksTss = avg(completedWeeks.slice(0, 52))

  // 用 CTL*7*0.8 作为维持体能的地板，避免无活动或活动稀疏时目标过低
  const ctlFloor = Math.round(safetyCap * 0.8)
  const baseline = Math.max(
    avg4WeeksTss,
    Math.round(avg12WeeksTss * 0.95),
    Math.round(avg26WeeksTss * 0.9),
    Math.round(avg52WeeksTss * 0.85),
    Math.round(lastWeekTss * 1.05),
    ctlFloor
  )

  const weeklyHistory = completedWeeks
    .slice(0, 52)
    .map(([weekStart, tss]) => ({ weekStart, tss }))
    .reverse()

  return {
    lastWeekTss,
    avg4WeeksTss,
    avg12WeeksTss,
    avg26WeeksTss,
    avg52WeeksTss,
    weeklyHistory,
    weeklyTssTarget: Math.min(baseline, safetyCap)
  }
}

function toActivitySummary(a: Activity): ActivitySummary {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    date: a.startTime.slice(0, 10),
    duration: a.duration,
    distance: a.distance,
    tss: a.tss,
    averageWatts: a.averageWatts,
    normalizedPower: a.normalizedPower,
    averageHr: a.averageHr,
    maxHr: a.maxHr
  }
}

function summarizeByWeek(
  activities: Activity[],
  weekStart: string,
  weekEnd: string
): { thisWeek: ActivitySummary[]; lastWeek: ActivitySummary[] } {
  const lastWeekStart = addDaysLocal(weekStart, -7)
  const lastWeekEnd = addDaysLocal(weekStart, -1)
  const thisWeek: ActivitySummary[] = []
  const lastWeek: ActivitySummary[] = []

  for (const a of activities) {
    const date = a.startTime.slice(0, 10)
    if (!date) continue
    if (date >= weekStart && date <= weekEnd) {
      thisWeek.push(toActivitySummary(a))
    } else if (date >= lastWeekStart && date <= lastWeekEnd) {
      lastWeek.push(toActivitySummary(a))
    }
  }

  return { thisWeek, lastWeek }
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
  type: string
  name: string
  description: string
  tss: number
  duration: number
  targetPower?: string
  targetHr?: string
  workoutDoc?: WorkoutDoc
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

export interface CoachOptions {
  userOverride?: { style: TrainingStyle; expiresAt: string; reason?: string }
}

let cachedContext: CoachContext | null = null
let cachedAt = 0
const CACHE_TTL_MS = 5 * 60 * 1000

export async function getCachedCoachContext(
  api: IntervalsAPI,
  options: CoachOptions = {}
): Promise<CoachContext | null> {
  if (cachedContext && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedContext
  }
  cachedContext = await buildCoachContext(api, options)
  cachedAt = Date.now()
  return cachedContext
}

export function invalidateCoachCache(): void {
  cachedContext = null
  cachedAt = 0
}

export async function buildCoachContext(
  api: IntervalsAPI,
  options: CoachOptions = {}
): Promise<CoachContext> {
  const now = nowInShanghai()
  const generatedAt = formatShanghaiDateTime(now)
  const weekRange = getWeekRange(now)

  // 检查覆盖是否过期（expiresAt 是本周日 23:59:59）
  let activeOverride = options.userOverride
  if (activeOverride && activeOverride.expiresAt.split('T')[0] < formatShanghaiDate(now)) {
    activeOverride = undefined
  }

  const [wellness, activities, powerCurves, athlete] = await Promise.all([
    api.fetchWellness(daysAgo(30, now), daysAgo(0, now)),
    api.fetchActivities(daysAgo(365, now), daysAgo(0, now), 1000),
    api.fetchPowerCurves(),
    parseAthleteProfile()
  ])

  const latest = wellness[wellness.length - 1]
  const hrvBaseline = calcHrvBaseline(wellness)
  const safety = evaluateSafety(wellness)
  const ftp = athlete.ftp ?? 280
  const load = analyzeLoad(
    activities.filter((a) => a.startTime.slice(0, 10) >= daysAgo(30, now)),
    ftp
  )
  const powerProfile = analyzePowerProfile(powerCurves)
  const { thisWeek, lastWeek } = summarizeByWeek(activities, weekRange.start, weekRange.end)
  const capacity = computeWeeklyCapacity(activities, weekRange.start, safety.weeklyTssCap)

  const styleResult = recommendStyle(
    { ctl: latest?.ctl ?? 0, tsb: latest?.tsb ?? 0, status: safety.status },
    load,
    powerProfile.gaps.map((g) => {
      const match = g.match(/^(\S+)/)
      return { duration: match ? match[1] : g, declinePercent: parseFloat(g) || 0 }
    }),
    activeOverride?.style ?? null
  )

  return {
    generatedAt,
    weekRange,
    athlete,
    recovery: {
      ctl: latest?.ctl ?? 0,
      atl: latest?.atl ?? 0,
      tsb: latest?.tsb ?? 0,
      hrvBaseline,
      hrvToday: latest?.hrv,
      rhrToday: latest?.rhr,
      sleepHours: latest?.sleep,
      status: safety.status,
      restriction: safety.restriction
    },
    recentLoad: load,
    powerProfile,
    thisWeek,
    lastWeek,
    capacity,
    recommendation: {
      defaultStyle: 'polarized',
      currentStyle: styleResult.currentStyle,
      styleReason: styleResult.reason,
      weeklyTssTarget: capacity.weeklyTssTarget,
      intensityCaps: {
        z3z4: styleResult.intensityCaps.z3z4,
        maxSessionTss: Math.min(styleResult.intensityCaps.maxSessionTss, safety.maxSessionTss)
      }
    },
    userOverride: activeOverride
  }
}

export { getWeekExpiry }
