import assert from 'node:assert'

// ===== 1. PlanView stale-check =====
function isPlanStale(plan, currentWeekStart) {
  return plan.startDate < currentWeekStart
}

assert.strictEqual(isPlanStale({ startDate: '2026-07-13' }, '2026-07-13'), false)
assert.strictEqual(isPlanStale({ startDate: '2026-07-06' }, '2026-07-13'), true)
console.log('✓ PlanView stale-check')

// ===== 2. Push payload format =====
function buildEventPayload(day) {
  return {
    start_date_local: `${day.date}T00:00:00`,
    category: 'WORKOUT',
    name: day.name,
    description: day.description,
    type: day.type === 'VirtualRide' ? 'VirtualRide' : 'Ride',
    moving_time: day.duration,
    distance: 0,
    icu_training_load: day.tss,
    workout_doc: day.workoutDoc
  }
}

const day = {
  date: '2026-07-13',
  type: 'Ride',
  name: 'Z2 有氧',
  description: '有氧恢复',
  duration: 3600,
  tss: 50,
  workoutDoc: { description: 'test', target: 'POWER', ftp: 280, steps: [] }
}
const payload = buildEventPayload(day)
assert.strictEqual(payload.start_date_local, '2026-07-13T00:00:00')
assert.strictEqual(payload.type, 'Ride')
assert.strictEqual(payload.category, 'WORKOUT')
assert.strictEqual(payload.icu_training_load, 50)
assert.ok(payload.workout_doc)
console.log('✓ Push payload format')

// ===== 3. parsePlanJson date override =====
function addDaysLocal(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .format(d)
    .replace(/\//g, '-')
}

function parsePlanJson(text, fallbackRange) {
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found')
  const raw = JSON.parse(match[0])
  if (!Array.isArray(raw.days)) throw new Error('Missing days array')
  const DAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  const days = raw.days.map((d, idx) => ({
    date: addDaysLocal(fallbackRange.start, idx),
    dayOfWeek: DAY_LABELS[idx],
    type: d.type ?? 'rest',
    name: d.name ?? ''
  }))
  return {
    style: raw.style ?? 'polarized',
    weekTss: Number(raw.weekTss) || 0,
    startDate: raw.startDate || fallbackRange.start,
    endDate: raw.endDate || fallbackRange.end,
    days
  }
}

const sampleResponse = `\`
\`\`\`json
{
  "style": "aerobic",
  "weekTss": 300,
  "startDate": "2026-07-12",
  "endDate": "2026-07-18",
  "days": [
    {"date":"2026-07-12","dayOfWeek":"周一","type":"Ride","name":"有氧","tss":50,"duration":3600},
    {"date":"2026-07-13","dayOfWeek":"周二","type":"Ride","name":"有氧","tss":50,"duration":3600}
  ]
}
\`\`\`
\``
const parsed = parsePlanJson(sampleResponse, { start: '2026-07-13', end: '2026-07-19' })
assert.strictEqual(parsed.days[0].date, '2026-07-13')
assert.strictEqual(parsed.days[0].dayOfWeek, '周一')
assert.strictEqual(parsed.days[1].date, '2026-07-14')
assert.strictEqual(parsed.days[1].dayOfWeek, '周二')
console.log('✓ parsePlanJson date override (LLM wrong dates corrected)')

console.log('\nAll verification checks passed')
