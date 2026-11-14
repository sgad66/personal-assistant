import { create } from 'zustand'

export type Page = 'home' | 'board' | 'agent' | 'week'

interface NavigationState {
  page: Page
  history: Page[]
  navigate: (page: Page) => boolean
  back: () => Page
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  page: 'home',
  history: [],

  navigate: (page) => {
    const state = get()
    if (state.page === page) return false
    set({
      page,
      history: [...state.history, state.page].slice(-10)
    })
    return true
  },

  back: () => {
    const state = get()
    const previous = state.history.at(-1) ?? 'home'
    set({
      page: previous,
      history: state.history.slice(0, -1)
    })
    return previous
  }
}))