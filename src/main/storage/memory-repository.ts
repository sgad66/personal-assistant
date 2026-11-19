import type { MemoryItem } from '@shared/domain/types'
import type { Result } from '@shared/result'
import type { DataStore } from './data-store'

export class MemoryRepository {
  constructor(private readonly store: DataStore) {}

  list(): Result<MemoryItem[]> {
    return this.store.read((draft) =>
      draft.memories.slice().sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.updatedAt - a.updatedAt
      })
    )
  }

  find(memoryId: string): MemoryItem | undefined {
    return this.store.snapshot().memories.find((item) => item.memoryId === memoryId)
  }

  insert(items: readonly MemoryItem[]): Result<MemoryItem[]> {
    return this.store.write((draft) => {
      draft.memories.push(...items)
      return items.slice()
    })
  }

  replaceAll(items: readonly MemoryItem[]): Result<void> {
    return this.store.write((draft) => {
      draft.memories = items.slice()
    })
  }

  update(memoryId: string, patch: Partial<MemoryItem>): Result<MemoryItem | undefined> {
    return this.store.write((draft) => {
      const memory = draft.memories.find((item) => item.memoryId === memoryId)
      if (!memory) return undefined
      Object.assign(memory, patch)
      return memory
    })
  }

  remove(memoryId: string): Result<boolean> {
    return this.store.write((draft) => {
      const index = draft.memories.findIndex((item) => item.memoryId === memoryId)
      if (index < 0) return false
      draft.memories.splice(index, 1)
      return true
    })
  }

  clear(): Result<number> {
    return this.store.write((draft) => {
      const count = draft.memories.length
      draft.memories = []
      return count
    })
  }
}