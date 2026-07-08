import type { CoachContext } from '../types'

interface ReportCardProps {
  context: CoachContext | null
  loading: boolean
  error: string | null
  onRefresh: () => Promise<void>
}

const STYLE_LABELS: Record<string, string> = {
  polarized: '极化',
  aerobic: '有氧',
  sweetspot: '甜区',
  intervals: '间歇'
}

const STATUS_CONFIG = {
  green: { label: '绿灯', color: 'bg-green-500', text: '恢复良好' },
  yellow: { label: '黄灯', color: 'bg-yellow-500', text: '注意恢复' },
  red: { label: '红灯', color: 'bg-red-500', text: '需要休息' }
}

export default function ReportCard({
  context,
  loading,
  error,
  onRefresh
}: ReportCardProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <p className="text-sm text-gray-500">正在生成教练分析...</p>
      </div>
    )
  }

  if (error || !context) {
    return (
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-amber-600">
            {error ?? '请先配置 intervals.icu 以获取教练分析'}
          </p>
          <button
            onClick={onRefresh}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            刷新
          </button>
        </div>
      </div>
    )
  }

  const r = context.recovery
  const l = context.recentLoad
  const rec = context.recommendation
  const cap = context.capacity
  const status = STATUS_CONFIG[r.status]

  return (
    <div className="border-b border-gray-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-gray-700">当前状态</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-xs">
              <span className={`h-2 w-2 rounded-full ${status.color}`} />
              {status.label} · {status.text}
            </span>
            <span className="text-xs text-gray-400">生成于 {context.generatedAt}</span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 sm:grid-cols-4">
            <div>
              CTL: <span className="font-medium text-gray-800">{r.ctl.toFixed(1)}</span>
            </div>
            <div>
              TSB: <span className="font-medium text-gray-800">{r.tsb.toFixed(1)}</span>
            </div>
            <div>
              HRV:{' '}
              <span className="font-medium text-gray-800">{r.hrvToday?.toFixed(0) ?? '-'}</span>
              {' / '}
              {r.hrvBaseline.toFixed(0)}
            </div>
            <div>
              睡眠:{' '}
              <span className="font-medium text-gray-800">{r.sleepHours?.toFixed(1) ?? '-'}</span>h
            </div>
          </div>

          <div className="mt-2 text-xs text-gray-600">
            推荐模式：
            <span className="font-medium text-gray-800">
              {STYLE_LABELS[rec.currentStyle] ?? rec.currentStyle}
            </span>
            <span className="mx-1 text-gray-300">|</span>周 TSS 目标：
            <span className="font-medium text-gray-800">{rec.weeklyTssTarget}</span>
            <span className="mx-1 text-gray-300">|</span>
            {rec.intensityCaps.z3z4 && <span className="mr-1 text-red-600">禁止 3区/4区</span>}
            单次上限：
            <span className="font-medium text-gray-800">{rec.intensityCaps.maxSessionTss}</span>
          </div>

          {cap.avg4WeeksTss > 0 && (
            <div className="mt-1 text-xs text-gray-500">
              负荷参考：上周 {cap.lastWeekTss} · 4 周均 {cap.avg4WeeksTss}
              {cap.avg12WeeksTss > 0 && ` · 12 周均 ${cap.avg12WeeksTss}`}
              {cap.avg26WeeksTss > 0 && ` · 26 周均 ${cap.avg26WeeksTss}`}
              {cap.avg52WeeksTss > 0 && ` · 52 周均 ${cap.avg52WeeksTss}`}
            </div>
          )}

          {r.restriction && <p className="mt-1 text-xs text-red-600">{r.restriction}</p>}

          {l.totalTSS > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-gray-500">近 30 天分布：</span>
              <span className="text-blue-600">低强度 {l.lowAerobicPercent}%</span>
              <span className="text-orange-600">高强度 {l.highAerobicPercent}%</span>
              <span className="text-red-600">无氧 {l.anaerobicPercent}%</span>
            </div>
          )}

          {context.powerProfile.gaps.length > 0 && (
            <div className="mt-1 text-xs text-gray-500">
              短板：{context.powerProfile.gaps.join('，')}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <button
            onClick={onRefresh}
            className="rounded-md border border-gray-300 p-1.5 text-gray-500 hover:bg-gray-50"
            title="刷新分析"
          >
            <RefreshIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

function RefreshIcon(): React.JSX.Element {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  )
}
