import { create } from 'zustand'
import type { GoalChangeNotice, GoalCreateInput, GoalView } from '@shared/ipc-contracts'

interface GoalState {
  goals: GoalView[]
  loading: boolean
  initialized: boolean
  error?: string
  running: Readonly<Record<string, boolean>>
  init: () => Promise<void>
  refresh: () => Promise<void>
  applyNotice: (notice: GoalChangeNotice) => void
  create: (input: GoalCreateInput) => Promise<boolean>
  setStatus: (goalId: string, action: 'pause' | 'resume' | 'complete') => Promise<boolean>
  remove: (goalId: string) => Promise<boolean>
  run: (goalId: string) => Promise<boolean>
  clearError: () => void
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cleaned = error.message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
    return cleaned.length > 0 ? cleaned : '操作失败，请重试'
  }
  return '操作失败，请重试'
}

function weight(goal: GoalView): number {
  return goal.status === 'active' ? 0 : goal.status === 'paused' ? 1 : 2
}

function sortGoals(goals: GoalView[]): GoalView[] {
  return goals.slice().sort((a, b) => {
    const byStatus = weight(a) - weight(b)
    if (byStatus !== 0) return byStatus
    return a.nextRunAt - b.nextRunAt
  })
}

export const useGoalStore = create<GoalState>((set, get) => ({
  goals: [],
  loading: false,
  initialized: false,
  running: {},

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    await get().refresh()
  },

  refresh: async () => {
    set({ loading: true, error: undefined })
    try {
      const goals = await window.pa.goal.list()
      set({ goals: sortGoals(goals), loading: false })
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  applyNotice: (notice) => {
    const incoming = notice.goal
    if (!incoming) {

      void get().refresh()
      return
    }
    set((state) => {
      const exists = state.goals.some((goal) => goal.goalId === incoming.goalId)
      const goals = exists
        ? state.goals.map((goal) => (goal.goalId === incoming.goalId ? incoming : goal))
        : [...state.goals, incoming]
      return { goals: sortGoals(goals) }
    })
  },

  create: async (input) => {
    set({ error: undefined })
    try {
      const view = await window.pa.goal.create(input)
      get().applyNotice({ revision: view.updatedAt, reason: 'created', goal: view })
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    }
  },

  setStatus: async (goalId, action) => {
    set({ error: undefined })
    try {
      const view = await window.pa.goal.setStatus({ goalId, action })
      get().applyNotice({ revision: view.updatedAt, reason: 'updated', goal: view })
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    }
  },

  remove: async (goalId) => {
    set({ error: undefined })
    try {
      await window.pa.goal.remove({ goalId })
      set((state) => ({ goals: state.goals.filter((goal) => goal.goalId !== goalId) }))
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    }
  },

  run: async (goalId) => {
    set((state) => ({ error: undefined, running: { ...state.running, [goalId]: true } }))
    try {
      const result = await window.pa.goal.run({ goalId })
      get().applyNotice({ revision: result.goal.updatedAt, reason: 'run', goal: result.goal })
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    } finally {
      set((state) => {
        const next = { ...state.running }
        delete next[goalId]
        return { running: next }
      })
    }
  },

  clearError: () => set({ error: undefined })
}))