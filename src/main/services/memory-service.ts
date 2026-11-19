import type {
  MemoryCandidate,
  MemoryItem,
  MemoryKind,
  MemorySource
} from '@shared/domain/types'
import { normalizeMemoryContent } from '@shared/memory/extract'
import { messageKeyOf } from '@shared/error-catalog'
import { fail, ok, type Result } from '@shared/result'
import type { Logger } from '../observability/logger'
import type { MemoryRepository } from '../storage/memory-repository'

export const MAX_MEMORIES = 200
const MAX_CONTENT = 200

export interface MemoryServiceDeps {
  readonly repository: MemoryRepository
  readonly logger: Logger
  readonly clock: () => number
  readonly onChanged?: (revision: number) => void
}

export interface MemoryAddResult {
  readonly added: number
  readonly merged: number
}

export class MemoryService {
  constructor(private readonly deps: MemoryServiceDeps) {}

  list(): MemoryItem[] {
    const result = this.deps.repository.list()
    return result.ok ? result.data : []
  }

  add(content: string, kind: MemoryKind = 'fact', source: MemorySource = 'user'): Result<MemoryItem> {
    const now = this.deps.clock()
    const item: MemoryItem = {
      memoryId: makeId(now),
      content: content.trim().slice(0, MAX_CONTENT),
      kind,
      source,
      confidence: source === 'user' ? 1 : 0.75,
      pinned: false,
      createdAt: now,
      updatedAt: now
    }
    if (item.content.length === 0) {
      return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    }
    const existing = this.findSimilar(item.content)
    if (existing) {
      const merged = this.merge(existing, item)
      const saved = this.deps.repository.update(existing.memoryId, merged)
      if (!saved.ok || !saved.data) return fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'))
      this.notify()
      return ok(saved.data)
    }
    const inserted = this.deps.repository.insert([item])
    if (!inserted.ok) return fail(inserted.error.code, inserted.error.messageKey, inserted.error.retryable)
    this.prune()
    this.notify()
    return ok(item)
  }

  addMany(candidates: readonly MemoryCandidate[], source: MemorySource): MemoryAddResult {
    let added = 0
    let merged = 0
    for (const candidate of candidates.slice(0, 5)) {
      const content = candidate.content.trim().slice(0, MAX_CONTENT)
      if (content.length < 4) continue
      const existing = this.findSimilar(content)
      if (existing) {
        const next = this.merge(existing, {
          memoryId: existing.memoryId,
          content,
          kind: candidate.kind,
          source,
          confidence: candidate.confidence,
          pinned: existing.pinned,
          createdAt: existing.createdAt,
          updatedAt: this.deps.clock()
        })
        this.deps.repository.update(existing.memoryId, next)
        merged += 1
        continue
      }
      const now = this.deps.clock()
      const item: MemoryItem = {
        memoryId: makeId(now),
        content,
        kind: candidate.kind,
        source,
        confidence: Math.min(1, Math.max(0.3, candidate.confidence)),
        pinned: false,
        createdAt: now,
        updatedAt: now
      }
      if (this.deps.repository.insert([item]).ok) added += 1
    }
    if (added > 0) this.prune()
    if (added > 0 || merged > 0) this.notify()
    return { added, merged }
  }

  importLegacy(texts: readonly string[]): number {
    const candidates = texts
      .map((text) => text.trim().slice(0, MAX_CONTENT))
      .filter((text) => text.length > 0)
      .map<MemoryCandidate>((content) => ({ content, kind: 'fact', confidence: 0.6 }))
    const result = this.addMany(candidates, 'legacy')
    return result.added + result.merged
  }

  update(
    memoryId: string,
    patch: { content?: string; kind?: MemoryKind; pinned?: boolean }
  ): Result<MemoryItem> {
    const existing = this.deps.repository.find(memoryId)
    if (!existing) return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    const content = patch.content?.trim().slice(0, MAX_CONTENT)
    if (patch.content !== undefined && (content === undefined || content.length === 0)) {
      return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    }
    const updated = this.deps.repository.update(memoryId, {
      ...(content !== undefined ? { content } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      updatedAt: this.deps.clock()
    })
    if (!updated.ok || !updated.data) return fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'))
    this.notify()
    return ok(updated.data)
  }

  remove(memoryId: string): Result<{ memoryId: string }> {
    const removed = this.deps.repository.remove(memoryId)
    if (!removed.ok || !removed.data) {
      return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    }
    this.notify()
    return ok({ memoryId })
  }

  clear(): Result<{ cleared: number }> {
    const cleared = this.deps.repository.clear()
    if (!cleared.ok) return fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'))
    this.notify()
    return ok({ cleared: cleared.data })
  }

  retrieve(query: string, limit = 8): MemoryItem[] {
    const memories = this.list()
    if (memories.length === 0) return []
    const tokens = tokensOf(query)
    if (tokens.length === 0) {
      return memories
        .slice()
        .sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
          return b.updatedAt - a.updatedAt
        })
        .slice(0, limit)
    }
    const now = this.deps.clock()
    const scored = memories.map((memory) => {
      const normalized = normalizeMemoryContent(memory.content)
      let score = memory.pinned ? 40 : 0
      for (const token of tokens) {
        if (normalized.includes(token)) score += 10
      }
      score += memory.confidence * 12
      const ageDays = Math.max(0, (now - memory.updatedAt) / 86_400_000)
      score += Math.max(0, 10 - ageDays / 30)
      return { memory, score }
    })
    return scored
      .filter((item) => item.score > 12)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.memory)
  }

  private findSimilar(content: string): MemoryItem | undefined {
    const target = normalizeMemoryContent(content)
    if (target.length < 4) return undefined
    return this.list().find((memory) => {
      const existing = normalizeMemoryContent(memory.content)
      if (existing === target) return true
      if (target.length >= 8 && existing.includes(target)) return true
      if (existing.length >= 8 && target.includes(existing)) return true
      return false
    })
  }

  private merge(existing: MemoryItem, incoming: MemoryItem): Partial<MemoryItem> {
    const keepIncoming = incoming.content.length > existing.content.length
    return {
      content: keepIncoming ? incoming.content : existing.content,
      kind: existing.kind === 'fact' ? incoming.kind : existing.kind,
      source: incoming.source === 'user' ? 'user' : existing.source,
      confidence: Math.max(existing.confidence, incoming.confidence),
      pinned: existing.pinned,
      updatedAt: this.deps.clock()
    }
  }

  private prune(): void {
    const memories = this.list()
    if (memories.length <= MAX_MEMORIES) return
    const now = this.deps.clock()
    const ranked = memories.slice().sort((a, b) => {
      const scoreOf = (memory: MemoryItem): number => {
        if (memory.pinned) return Number.MAX_SAFE_INTEGER
        const ageDays = Math.max(0, (now - memory.updatedAt) / 86_400_000)
        return memory.confidence * 100 + Math.max(0, 30 - ageDays / 20) + memory.content.length / 20
      }
      return scoreOf(b) - scoreOf(a)
    })
    this.deps.repository.replaceAll(ranked.slice(0, MAX_MEMORIES))
  }

  private notify(): void {
    this.deps.onChanged?.(this.deps.repository.list().ok ? 1 : 0)
  }
}

function makeId(now: number): string {
  return `mem_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function tokensOf(query: string): string[] {
  const tokens = new Set<string>()
  const cjk = query.match(/[\u4e00-\u9fa5]{2,}/g) ?? []
  for (const sequence of cjk) {
    for (let index = 0; index < sequence.length - 1 && tokens.size < 30; index += 1) {
      tokens.add(sequence.slice(index, index + 2))
    }
  }
  const latin = query.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []
  for (const word of latin) {
    if (tokens.size >= 36) break
    tokens.add(word)
  }
  return [...tokens]
}