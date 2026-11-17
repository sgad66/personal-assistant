import { create } from 'zustand'
import type { ScheduleEventDetail, WeekView } from '@shared/domain/types'
import { getWeekStart } from '@shared/time-kit'
import { applyWeekOutcome } from '@shared/week-nav'

export type GoToCurrentWeekResult = 'loaded' | 'already-current' | 'failed'

interface ScheduleState {
  week: WeekView | undefined
  weekAnchor: number
  requestedWeekStart?: number
  focusTodayToken: number
  loading: boolean
  error?: string
  detail: ScheduleEventDetail | undefined
  detailOpen: boolean
  revision: number
  load: (weekStart?: number) => Promise<void>
  refresh: () => Promise<void>
  goToCurrentWeek: (now?: number) => Promise<GoToCurrentWeekResult>
  invalidate: (revision: number) => void
  openDetail: (eventId: string) => Promise<void>
  closeDetail: () => void
}

let loadSeq = 0

function errorTextOf(error: unknown, fallback: string): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
    : fallback
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  week: undefined,
  weekAnchor: getWeekStart(Date.now()),
  focusTodayToken: 0,
  loading: false,
  detail: undefined,
  detailOpen: false,
  revision: 0,

  load: async (weekStart) => {
    const target = getWeekStart(weekStart ?? get().weekAnchor)
    const seq = ++loadSeq
    set({ loading: true, error: undefined, requestedWeekStart: target })
    try {
      const week = await window.pa.schedule.week({ weekStart: target })
      if (seq !== loadSeq) return
      const applied = applyWeekOutcome(
        { anchor: get().weekAnchor, ...(get().week ? { week: get().week as WeekView } : {}) },
        target,
        'success',
        week
      )
      set({
        weekAnchor: applied.anchor,
        ...(applied.week ? { week: applied.week } : {}),
        loading: false,
        revision: week.revision,
        requestedWeekStart: undefined
      })
    } catch (error) {
      if (seq !== loadSeq) return
      set({
        loading: false,
        error: errorTextOf(error, '日程读取异常，请稍后重试'),
        requestedWeekStart: undefined
      })
    }
  },

  refresh: async () => {
    await get().load(get().weekAnchor)
  },

  goToCurrentWeek: async (now) => {
    const current = getWeekStart(now ?? Date.now())
    const viewStart = get().week?.weekStart ?? get().weekAnchor
    if (get().loading) return 'already-current'
    if (viewStart === current) return 'already-current'
    await get().load(current)
    if (get().week?.weekStart === current) {
      set((state) => ({ focusTodayToken: state.focusTodayToken + 1 }))
      return 'loaded'
    }
    return 'failed'
  },

  invalidate: (revision) => {
    set({ revision })
    void get().load()
  },

  openDetail: async (eventId) => {
    try {
      const detail = await window.pa.schedule.detail({ eventId })
      set({ detail, detailOpen: true })
    } catch (error) {
      set({ error: errorTextOf(error, '该事项已不存在') })
    }
  },

  closeDetail: () => set({ detailOpen: false, detail: undefined })
}))