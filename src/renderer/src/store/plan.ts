import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { WeeklyPlan } from '../types'

interface PlanState {
  currentPlan: WeeklyPlan | null
  setPlan: (plan: WeeklyPlan | null) => void
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set) => ({
      currentPlan: null,
      setPlan: (plan) => set({ currentPlan: plan })
    }),
    { name: 'cycle-plan' }
  )
)
