import { create } from 'zustand'

export type Page = 'home' | 'agent' | 'week'

interface NavigationState {
  page: Page
  history: Page[]
  lastNavigationAt: number
  navigate: (page: Page) => boolean
  back: () => Page
}

const NAV_LOCK_MS = 1_000

export const useNavigationStore = create<NavigationState>((set, get) => ({
  page: 'home',
  history: [],
  lastNavigationAt: 0,
  navigate: (page) => {
    const state = get()
    const now = Date.now()
    if (state.page === page && now - state.lastNavigationAt < NAV_LOCK_MS) {
      return false
    }
    if (now - state.lastNavigationAt < NAV_LOCK_MS && state.page !== page) {
      return false
    }
    set({
      page,
      history: [...state.history, state.page],
      lastNavigationAt: now
    })
    return true
  },
  back: () => {
    const state = get()
    const previous = state.history.at(-1) ?? 'home'
    set({
      page: previous,
      history: state.history.slice(0, -1),
      lastNavigationAt: Date.now()
    })
    return previous
  }
}))