import { create } from 'zustand'
import type { ScheduleEventDetail, WeekView } from '@shared/domain/types'
import { getWeekStart } from '@shared/time-kit'

interface ScheduleState {
  week: WeekView | undefined
  weekAnchor: number
  loading: boolean
  error?: string
  detail: ScheduleEventDetail | undefined
  detailOpen: boolean
  revision: number
  load: (weekStart?: number) => Promise<void>
  invalidate: (revision: number) => void
  openDetail: (eventId: string) => Promise<void>
  closeDetail: () => void
}

let loadSeq = 0

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  week: undefined,
  weekAnchor: getWeekStart(Date.now()),
  loading: false,
  detail: undefined,
  detailOpen: false,
  revision: 0,

  load: async (weekStart) => {
    const anchor = getWeekStart(weekStart ?? get().weekAnchor)
    const seq = ++loadSeq
    set({ loading: true, error: undefined, weekAnchor: anchor })
    try {
      const week = await window.pa.schedule.week({ weekStart: anchor })
      if (seq !== loadSeq) return
      set({ week, loading: false, revision: week.revision })
    } catch (error) {
      if (seq !== loadSeq) return
      set({
        loading: false,
        error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '') : '日程读取异常，请稍后重试'
      })
    }
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
      set({
        error: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '') : '该事项已不存在'
      })
    }
  },

  closeDetail: () => set({ detailOpen: false, detail: undefined })
}))