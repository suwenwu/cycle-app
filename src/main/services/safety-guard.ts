import type { WellnessData } from './intervals-api'

export interface SafetyState {
  status: 'green' | 'yellow' | 'red'
  restriction?: string
  weeklyTssCap: number
  maxSessionTss: number
}

function median(arr: number[]): number {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function calcHrvBaseline(wellness: WellnessData[]): number {
  const vals = wellness
    .slice(-14)
    .map((w) => w.hrv)
    .filter((v): v is number => v != null)
  if (vals.length < 3) return 0
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length)
  return median(vals.filter((v) => Math.abs(v - mean) <= 2 * sd))
}

export function evaluateSafety(wellness: WellnessData[]): SafetyState {
  const latest = wellness[wellness.length - 1]
  const tsb = latest?.tsb ?? 0
  const hrvBaseline = calcHrvBaseline(wellness)
  const hrvToday = latest?.hrv
  const rhrToday = latest?.rhr
  const sleepHours = latest?.sleep

  const restrictions: string[] = []
  let status: 'green' | 'yellow' | 'red' = 'green'

  // HRV 低于基线 85%
  if (hrvBaseline > 0 && hrvToday != null && hrvToday < hrvBaseline * 0.85) {
    status = 'yellow'
    restrictions.push('HRV 低于基线 85%，建议降低强度')
  }

  // 连续 2 天恢复指标异常
  const last2 = wellness.slice(-2)
  const abnormalStreak = last2.every((w) => {
    if (w.hrv == null || hrvBaseline <= 0) return false
    return w.hrv < hrvBaseline * 0.85 || (w.rhr != null && w.rhr >= (rhrToday ?? 0) + 5)
  })
  if (abnormalStreak && last2.length >= 2) {
    status = 'red'
    restrictions.push('连续 2 天恢复指标异常，强制休息 1 天')
  }

  // 睡眠 < 6h
  if (sleepHours != null && sleepHours < 6) {
    status = status === 'red' ? 'red' : 'yellow'
    restrictions.push('睡眠不足 6 小时，次日不做高强度训练')
  }

  // TSB < -10
  if (tsb < -10) {
    status = 'red'
    restrictions.push('TSB 过低，进入保护模式')
  } else if (tsb < -5) {
    status = status === 'red' ? 'red' : 'yellow'
    restrictions.push('TSB 偏低，控制负荷')
  }

  const base = computeWeeklyTssCap(wellness, tsb)
  const finalCap =
    status === 'red' ? Math.round(base * 0.7) : status === 'yellow' ? Math.round(base * 0.9) : base

  const maxSessionTss = status === 'red' ? 50 : status === 'yellow' || tsb < -5 ? 90 : 150

  return {
    status,
    restriction: restrictions.length ? restrictions.join('；') : undefined,
    weeklyTssCap: finalCap,
    maxSessionTss
  }
}

function computeWeeklyTssCap(wellness: WellnessData[], tsb: number): number {
  const ctl = wellness[wellness.length - 1]?.ctl ?? 0
  // CTL * 7 是维持当前体能的近似周负荷；以此为安全上限基准
  const baseline = Math.round(ctl * 7)
  if (!baseline) return 300

  if (tsb > 10) return Math.round(baseline * 1.1)
  if (tsb < -10) return Math.round(baseline * 0.8)
  return baseline
}
