import { create } from 'zustand'
import type {
  MemoryChangeNotice,
  MemoryCreateInput,

  MemoryUpdateInput,
  MemoryView
} from '@shared/ipc-contracts'

const LEGACY_KEY = 'pa-memories-v1'
const MIGRATED_KEY = 'pa-memories-migrated-v1'

interface MemoryState {
  items: MemoryView[]
  loading: boolean
  initialized: boolean
  error?: string
  init: () => Promise<void>
  refresh: () => Promise<void>
  add: (input: MemoryCreateInput) => Promise<boolean>
  update: (input: MemoryUpdateInput) => Promise<boolean>
  remove: (memoryId: string) => Promise<boolean>
  clear: () => Promise<boolean>
  applyChanged: (notice: MemoryChangeNotice) => void
  clearError: () => void
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cleaned = error.message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
    return cleaned.length > 0 ? cleaned : '操作失败，请重试'
  }
  return '操作失败，请重试'
}

function sortItems(items: MemoryView[]): MemoryView[] {
  return items.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
}

function legacyTexts(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  } catch {
    return []
  }
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  items: [],
  loading: false,
  initialized: false,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    if (localStorage.getItem(MIGRATED_KEY) !== '1') {
      const legacy = legacyTexts()
      if (legacy.length > 0) {
        try {
          await window.pa.memory.importLegacy({ memories: legacy })
        } catch {
          // 迁移失败时保留旧数据，下次打开再试
        }
      }
      localStorage.setItem(MIGRATED_KEY, '1')
      localStorage.removeItem(LEGACY_KEY)
    }
    await get().refresh()
  },

  refresh: async () => {
    set({ loading: true, error: undefined })
    try {
      const items = await window.pa.memory.list()
      set({ items: sortItems(items), loading: false })
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },

  add: async (input) => {
    set({ error: undefined })
    try {
      const item = await window.pa.memory.create(input)
      set((state) => ({ items: sortItems([...state.items.filter((i) => i.memoryId !== item.memoryId), item]) }))
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    }
  },

  update: async (input) => {
    set({ error: undefined })
    try {
      const item = await window.pa.memory.update(input)
      set((state) => ({
        items: sortItems(state.items.map((existing) => (existing.memoryId === item.memoryId ? item : existing)))
      }))
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    }
  },

  remove: async (memoryId) => {
    set({ error: undefined })
    try {
      await window.pa.memory.remove({ memoryId })
      set((state) => ({ items: state.items.filter((item) => item.memoryId !== memoryId) }))
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    }
  },

  clear: async () => {
    set({ error: undefined })
    try {
      await window.pa.memory.clear()
      set({ items: [] })
      return true
    } catch (error) {
      set({ error: errorMessage(error) })
      return false
    }
  },

  applyChanged: (notice) => {
    if (notice.memories) {
      set({ items: sortItems([...notice.memories]) })
      return
    }
    void get().refresh()
  },

  clearError: () => set({ error: undefined })
}))
