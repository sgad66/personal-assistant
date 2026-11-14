import { create } from 'zustand'
import { CONTRACT_VERSION, type AccessStatus, type HomeState } from '@shared/ipc-contracts'

interface AppState {
  home?: HomeState
  loading: boolean
  error?: string
  bootstrap: () => Promise<void>
  setAiStatus: (status: AccessStatus) => void
}

let started = false

export const useAppStore = create<AppState>((set) => ({
  loading: false,

  bootstrap: async () => {
    if (started) return
    started = true
    set({ loading: true, error: undefined })
    try {
      const home = await window.pa.app.bootstrap({ contractVersion: CONTRACT_VERSION })
      set({ home, loading: false })
    } catch {
      started = false
      set({ loading: false, error: '页面加载异常，请重试' })
    }
  },

  setAiStatus: (status) =>
    set((state) => ({
      home: state.home
        ? { ...state.home, aiStatus: status, aiConfigured: status !== 'local' }
        : state.home
    }))
}))