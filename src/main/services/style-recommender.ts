export type TrainingStyle = 'polarized' | 'aerobic' | 'sweetspot' | 'intervals'

interface RecoveryState {
  ctl: number
  tsb: number
  status: 'green' | 'yellow' | 'red'
}

interface LoadDistribution {
  lowAerobicPercent: number
  highAerobicPercent: number
  anaerobicPercent: number
}

interface PowerGap {
  duration: string
  declinePercent: number
}

interface Recommendation {
  currentStyle: TrainingStyle
  reason: string
  intensityCaps: {
    z3z4: boolean
    maxSessionTss: number
  }
}

const STYLE_LABELS: Record<TrainingStyle, string> = {
  polarized: '极化训练',
  aerobic: '有氧基础',
  sweetspot: '甜区训练',
  intervals: '间歇训练'
}

export function recommendStyle(
  recovery: RecoveryState,
  load: LoadDistribution,
  gaps: PowerGap[],
  userOverride: TrainingStyle | null
): Recommendation {
  // 1. 用户覆盖
  if (userOverride) {
    return {
      currentStyle: userOverride,
      reason: `用户选择本周采用${STYLE_LABELS[userOverride]}`,
      intensityCaps: buildIntensityCaps(recovery)
    }
  }

  // 2. 安全红灯：强制恢复
  if (recovery.status === 'red') {
    return {
      currentStyle: 'aerobic',
      reason: '恢复指标红灯，本周以低强度恢复骑为主',
      intensityCaps: { z3z4: true, maxSessionTss: 50 }
    }
  }

  // 3. 数据驱动推荐
  if (load.lowAerobicPercent < 65) {
    return {
      currentStyle: 'aerobic',
      reason: `最近低强度有氧占比仅 ${load.lowAerobicPercent.toFixed(0)}%，建议补强有氧基础`,
      intensityCaps: buildIntensityCaps(recovery)
    }
  }

  const significantGap = gaps.find((g) => g.declinePercent >= 8)
  if (significantGap) {
    const duration = significantGap.duration
    if (['5min', '10min', '20min'].includes(duration)) {
      return {
        currentStyle: 'sweetspot',
        reason: `${duration} 功率相对上赛季下降 ${significantGap.declinePercent.toFixed(0)}%，建议通过甜区训练提升阈值功率`,
        intensityCaps: buildIntensityCaps(recovery)
      }
    }
    return {
      currentStyle: 'intervals',
      reason: `${duration} 功率相对上赛季下降 ${significantGap.declinePercent.toFixed(0)}%，建议通过间歇训练提升无氧能力`,
      intensityCaps: buildIntensityCaps(recovery)
    }
  }

  if (recovery.tsb > 10 && load.lowAerobicPercent >= 75) {
    return {
      currentStyle: 'polarized',
      reason: '有氧基础扎实且疲劳低，适合极化训练加入高质量间歇',
      intensityCaps: buildIntensityCaps(recovery)
    }
  }

  // 4. 默认回退
  return {
    currentStyle: 'polarized',
    reason: '默认采用极化训练：80% 低强度 + 20% 高强度',
    intensityCaps: buildIntensityCaps(recovery)
  }
}

function buildIntensityCaps(recovery: RecoveryState): { z3z4: boolean; maxSessionTss: number } {
  if (recovery.status === 'red') {
    return { z3z4: true, maxSessionTss: 50 }
  }
  if (recovery.status === 'yellow' || recovery.tsb < -5) {
    return { z3z4: true, maxSessionTss: 90 }
  }
  return { z3z4: false, maxSessionTss: 150 }
}

export function parseStyleIntent(text: string): TrainingStyle | null {
  const lower = text.toLowerCase()
  if (lower.includes('有氧') || lower.includes('基础')) return 'aerobic'
  if (lower.includes('甜区') || lower.includes('阈值') || lower.includes('sweet'))
    return 'sweetspot'
  if (lower.includes('间歇') || lower.includes('interval')) return 'intervals'
  if (lower.includes('极化') || lower.includes('默认')) return 'polarized'
  return null
}
