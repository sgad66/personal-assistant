import { create } from 'zustand'
import type { ReminderPayload, ReminderResponse } from '@shared/ipc-contracts'

interface ReminderState {
  queue: ReminderPayload[]
  error?: string
  enqueue: (payload: ReminderPayload) => void
  respond: (action: 'acknowledge' | 'snooze' | 'ignore') => Promise<void>
  dismiss: () => void
  clearError: () => void
}

export const useReminderStore = create<ReminderState>((set, get) => ({
  queue: [],
  enqueue: (payload) => {
    const exists = get().queue.some(
      (item) => item.eventId === payload.eventId && item.plannedAt === payload.plannedAt
    )
    if (exists) return
    set((state) => ({ queue: [...state.queue, payload] }))
  },
  respond: async (action) => {
    const current = get().queue[0]
    if (!current) return
    const response: ReminderResponse = {
      eventId: current.eventId,
      plannedAt: current.plannedAt,
      action
    }
    try {
      await window.pa.reminder.respond(response)
      set((state) => ({ queue: state.queue.slice(1), error: undefined }))
    } catch (error) {
      set({
        queue: get().queue.slice(1),
        error: error instanceof Error ? error.message : '该提醒已处理'
      })
    }
  },
  dismiss: () => set((state) => ({ queue: state.queue.slice(1) })),
  clearError: () => set({ error: undefined })
}))