import { create } from 'zustand'

export type Theme = 'light' | 'dark'

const THEME_KEY = 'pa-theme-v2'
const CLOSE_TO_TRAY_KEY = 'pa-close-to-tray'
const MEMORY_KEY = 'pa-memories-v1'

const MEMORY_LIMIT = 20
const MEMORY_CHARS = 200

interface PreferencesState {
  theme: Theme
  closeToTray: boolean
  memories: readonly string[]
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setCloseToTray: (enabled: boolean) => void
  addMemory: (text: string) => boolean
  removeMemory: (text: string) => void
  clearMemories: () => void
}

function readMemories(): string[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, MEMORY_LIMIT)
  } catch {
    return []
  }
}

function writeMemories(memories: readonly string[]): void {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memories))
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  theme: localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light',
  closeToTray: localStorage.getItem(CLOSE_TO_TRAY_KEY) !== 'false',
  memories: readMemories(),

  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    set({ theme })
  },

  toggleTheme: () => get().setTheme(get().theme === 'light' ? 'dark' : 'light'),

  setCloseToTray: (enabled) => {
    localStorage.setItem(CLOSE_TO_TRAY_KEY, String(enabled))
    set({ closeToTray: enabled })
  },

  addMemory: (text) => {
    const trimmed = text.trim().slice(0, MEMORY_CHARS)
    if (trimmed.length === 0) return false
    const current = get().memories
    if (current.includes(trimmed)) return false
    const next = [...current, trimmed].slice(-MEMORY_LIMIT)
    writeMemories(next)
    set({ memories: next })
    return true
  },

  removeMemory: (text) => {
    const next = get().memories.filter((item) => item !== text)
    writeMemories(next)
    set({ memories: next })
  },

  clearMemories: () => {
    writeMemories([])
    set({ memories: [] })
  }
}))