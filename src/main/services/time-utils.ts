const TIME_ZONE = 'Asia/Shanghai'

export function nowInShanghai(): Date {
  const d = new Date()
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(d)

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0'
  return new Date(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
  )
}

export function formatShanghaiDateTime(d = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
    .format(d)
    .replace(/\//g, '-')
}

export function formatShanghaiDate(d = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .format(d)
    .replace(/\//g, '-')
}

export function getWeekRange(d = nowInShanghai()): { start: string; end: string } {
  const day = d.getDay() // 0 = Sunday
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  return { start: formatShanghaiDate(monday), end: formatShanghaiDate(sunday) }
}

export function getWeekExpiry(d = nowInShanghai()): string {
  const { end } = getWeekRange(d)
  return `${end}T23:59:59`
}

export function daysAgo(days: number, d = nowInShanghai()): string {
  const target = new Date(d)
  target.setDate(d.getDate() - days)
  return formatShanghaiDate(target)
}

export function addDaysLocal(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return formatShanghaiDate(d)
}

const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function dayOfWeekLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return DAY_LABELS[d.getDay()]
}

export function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((end.getTime() - start.getTime()) / msPerDay)
}

export function eachDay(startDate: string, endDate: string): string[] {
  const days = daysBetween(startDate, endDate)
  if (days < 0) return []
  const result: string[] = []
  for (let i = 0; i <= days; i++) {
    result.push(addDaysLocal(startDate, i))
  }
  return result
}
