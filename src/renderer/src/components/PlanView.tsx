import { useCallback, useEffect, useState } from 'react'
import type { CoachContext, TrainingStyle, WeeklyPlan } from '../types'
import { usePlanStore } from '../store/plan'
import ReportCard from './ReportCard'

const STYLE_OPTIONS: { value: TrainingStyle; label: string }[] = [
  { value: 'polarized', label: '极化' },
  { value: 'aerobic', label: '有氧' },
  { value: 'sweetspot', label: '甜区' },
  { value: 'intervals', label: '间歇' }
]

export default function PlanView(): React.JSX.Element {
  const [coachContext, setCoachContext] = useState<CoachContext | null>(null)
  const [coachLoading, setCoachLoading] = useState(true)
  const [coachError, setCoachError] = useState<string | null>(null)

  const [selectedStyle, setSelectedStyle] = useState<TrainingStyle | null>(null)
  const [targetRange, setTargetRange] = useState<{ start: string; end: string }>(getNextWeekRange)
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [pushResult, setPushResult] = useState<{
    created: number
    failed: number
    skipped: number
    deleted: number
    errors: string[]
  } | null>(null)
  const [deleteResult, setDeleteResult] = useState<{
    deleted: number
    failed: number
    errors: string[]
  } | null>(null)
  const [pushing, setPushing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const { currentPlan: plan, setPlan } = usePlanStore()

  const fetchCoachContext = useCallback(async () => {
    setCoachLoading(true)
    setCoachError(null)
    try {
      const ctx = (await window.electron.coach.getContext(true)) as CoachContext | null
      setCoachContext((prev) => {
        // 只在首次加载时把推荐风格设为选中，避免生成计划后刷新覆盖用户选择
        if (!prev && ctx?.recommendation.currentStyle) {
          setSelectedStyle(ctx.recommendation.currentStyle)
        }
        return ctx
      })
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : '获取教练分析失败')
    } finally {
      setCoachLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCoachContext()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (plan && isPlanStale(plan)) {
      console.log(
        '[PlanView] clearing stale plan:',
        plan.startDate,
        '<',
        toShanghaiDateString(new Date())
      )
      setPlan(null)
    }
  }, [plan, setPlan])

  const handleGenerate = useCallback(async () => {
    setPlanLoading(true)
    setPlanError(null)
    setPushResult(null)
    try {
      const result = (await window.electron.plan.generate(
        selectedStyle ?? undefined,
        targetRange.start,
        targetRange.end
      )) as WeeklyPlan | null
      if (!result) throw new Error('生成计划失败')
      setPlan(result)
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : '生成计划失败')
    } finally {
      setPlanLoading(false)
    }
  }, [selectedStyle, targetRange, setPlan])

  const handleRegenerate = useCallback(async () => {
    setPlan(null)
    setPushResult(null)
    setDeleteResult(null)
    await handleGenerate()
  }, [handleGenerate, setPlan])

  const handlePush = useCallback(async () => {
    if (!plan) return
    setPushing(true)
    setPushResult(null)
    setDeleteResult(null)
    try {
      const result = await window.electron.plan.push(plan as unknown as Record<string, unknown>)
      setPushResult(result)
      if (result.eventIds.length > 0) {
        setPlan({ ...plan, eventIds: result.eventIds })
      }
    } catch (err) {
      setPushResult({
        created: 0,
        failed: plan.days.length,
        skipped: 0,
        deleted: 0,
        errors: [err instanceof Error ? err.message : '推送失败']
      })
    } finally {
      setPushing(false)
    }
  }, [plan, setPlan])

  const handleDelete = useCallback(async () => {
    if (!plan?.eventIds?.length) return
    setDeleting(true)
    setDeleteResult(null)
    try {
      const result = await window.electron.plan.delete(plan.eventIds)
      setDeleteResult(result)
      if (result.failed === 0) {
        setPlan({ ...plan, eventIds: undefined })
      }
    } catch (err) {
      setDeleteResult({
        deleted: 0,
        failed: plan.eventIds.length,
        errors: [err instanceof Error ? err.message : '删除失败']
      })
    } finally {
      setDeleting(false)
    }
  }, [plan, setPlan])

  const currentStyleLabel = STYLE_OPTIONS.find((s) => s.value === selectedStyle)?.label ?? '默认'

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2.5">
        <h1 className="text-sm font-semibold text-gray-800">训练计划</h1>
      </header>

      <ReportCard
        context={coachContext}
        loading={coachLoading}
        error={coachError}
        onRefresh={fetchCoachContext}
      />

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-4xl space-y-4">
          {!coachLoading && coachContext && coachContext.thisWeek.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-medium text-gray-700">
                本周已完成训练（{coachContext.weekRange.start} ~ {coachContext.weekRange.end}）
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {coachContext.thisWeek.map((a) => (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap px-2 py-1.5 text-gray-500">{a.date}</td>
                        <td className="px-2 py-1.5 font-medium text-gray-800">{a.name}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">{a.type}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">
                          {formatDuration(a.duration)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">
                          TSS {a.tss ?? '-'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">
                          NP {a.normalizedPower ?? '-'}W
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">
                          均心 {a.averageHr ?? '-'}bpm
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!coachLoading && coachContext && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-gray-700">选择下周训练风格：</span>
                <div className="flex flex-wrap gap-2">
                  {STYLE_OPTIONS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => {
                        setSelectedStyle(s.value)
                        setPlan(null)
                      }}
                      className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                        selectedStyle === s.value
                          ? 'bg-blue-600 text-white'
                          : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setSelectedStyle(coachContext.recommendation.currentStyle)
                      setPlan(null)
                    }}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    恢复默认
                  </button>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-3">
                <label className="text-sm text-gray-600">起止日期：</label>
                <input
                  type="date"
                  value={targetRange.start}
                  onChange={(e) => {
                    const start = e.target.value
                    const end = targetRange.end < start ? start : targetRange.end
                    setTargetRange({ start, end })
                    setPlan(null)
                  }}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                />
                <span className="text-sm text-gray-400">至</span>
                <input
                  type="date"
                  value={targetRange.end}
                  onChange={(e) => {
                    const end = e.target.value
                    const start = targetRange.start > end ? end : targetRange.start
                    setTargetRange({ start, end })
                    setPlan(null)
                  }}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={() => {
                    setTargetRange(getNextWeekRange())
                    setPlan(null)
                  }}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  重置为下周
                </button>
                {daysBetween(targetRange.start, targetRange.end) + 1 > 7 && (
                  <span className="text-xs text-amber-600">
                    共 {daysBetween(targetRange.start, targetRange.end) + 1} 天
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleGenerate}
                  disabled={planLoading}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {planLoading
                    ? '生成中...'
                    : `生成 ${targetRange.start} ~ ${targetRange.end} 计划（${currentStyleLabel}）`}
                </button>
                {plan && (
                  <>
                    <button
                      onClick={handleRegenerate}
                      disabled={planLoading}
                      className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      重新生成
                    </button>
                    <button
                      onClick={handlePush}
                      disabled={pushing}
                      className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {pushing ? '推送中...' : '确认并推送至日历'}
                    </button>
                    {plan.eventIds && plan.eventIds.length > 0 && (
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="rounded-md bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                      >
                        {deleting ? '删除中...' : '删除已推送计划'}
                      </button>
                    )}
                  </>
                )}
              </div>

              {planError && <p className="mt-2 text-sm text-red-600">{planError}</p>}
              {pushResult && (
                <div className="mt-2 text-sm">
                  {pushResult.failed === 0 ? (
                    <p className="text-green-600">
                      推送成功 {pushResult.created} 条
                      {pushResult.deleted > 0 && `，覆盖旧计划 ${pushResult.deleted} 条`}
                      {pushResult.skipped > 0 && `，跳过休息 ${pushResult.skipped} 条`}
                    </p>
                  ) : (
                    <div className="text-red-600">
                      <p>
                        成功 {pushResult.created} 条，失败 {pushResult.failed} 条
                        {pushResult.deleted > 0 && `，覆盖旧计划 ${pushResult.deleted} 条`}
                        {pushResult.skipped > 0 && `，跳过休息 ${pushResult.skipped} 条`}
                      </p>
                      {pushResult.errors.length > 0 && (
                        <ul className="mt-1 list-inside list-disc text-xs">
                          {pushResult.errors.slice(0, 3).map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
              {deleteResult && (
                <div className="mt-2 text-sm">
                  {deleteResult.failed === 0 ? (
                    <p className="text-green-600">删除成功 {deleteResult.deleted} 条</p>
                  ) : (
                    <div className="text-red-600">
                      <p>
                        成功 {deleteResult.deleted} 条，失败 {deleteResult.failed} 条
                      </p>
                      {deleteResult.errors.length > 0 && (
                        <ul className="mt-1 list-inside list-disc text-xs">
                          {deleteResult.errors.slice(0, 3).map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {plan && (
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-800">
                    {plan.startDate} ~ {plan.endDate} 训练计划
                  </h2>
                  <p className="text-sm text-gray-500">
                    风格：{STYLE_OPTIONS.find((s) => s.value === plan.style)?.label ?? plan.style}
                    {' · '}周 TSS：{plan.weekTss}
                    {plan.note ? ` · ${plan.note}` : ''}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">日期</th>
                      <th className="px-3 py-2 text-left font-medium">类型</th>
                      <th className="px-3 py-2 text-left font-medium">名称</th>
                      <th className="px-3 py-2 text-left font-medium">时长</th>
                      <th className="px-3 py-2 text-left font-medium">TSS</th>
                      <th className="px-3 py-2 text-left font-medium">目标</th>
                      <th className="px-3 py-2 text-left font-medium">内容</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {plan.days.map((day) => (
                      <tr key={day.date} className={day.type === 'rest' ? 'bg-gray-50' : ''}>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                          {day.dayOfWeek}
                          <div className="text-xs text-gray-400">{day.date}</div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {day.type === 'rest' ? '休息' : day.type}
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">{day.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                          {formatDuration(day.duration)}
                        </td>
                        <td className="px-3 py-2 text-gray-700">{day.tss}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {day.targetPower && <div>{day.targetPower}</div>}
                          {day.targetHr && (
                            <div className="text-xs text-gray-500">{day.targetHr}</div>
                          )}
                        </td>
                        <td className="max-w-xs px-3 py-2 text-gray-600">
                          <div className="line-clamp-3" title={day.description}>
                            {day.description}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function isPlanStale(plan: WeeklyPlan): boolean {
  return plan.endDate < toShanghaiDateString(new Date())
}

function toShanghaiDateString(d: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .format(d)
    .replace(/\//g, '-')
}

function getNextWeekRange(): { start: string; end: string } {
  const today = new Date()
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1) + 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { start: toShanghaiDateString(monday), end: toShanghaiDateString(sunday) }
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((end.getTime() - start.getTime()) / msPerDay)
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return '-'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h${m > 0 ? `${m}m` : ''}`
  return `${m}m`
}
