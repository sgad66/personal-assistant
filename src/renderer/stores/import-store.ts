import { create } from 'zustand'
import type { ImportBatchPlan } from '@shared/import/plan'
import { detectFormat } from '@shared/import/detect'
import { sanitizeFileName } from '@shared/import/text'
import type { ImportFailureKind, ImportTextExtension } from '@shared/import/limits'
import {
  advanceAfterTurn,
  type ImportBatchState,
  type ImportDecisionFacts,
  type ImportFileResult
} from '@shared/import/runner'

interface ImportStoreState {
  batch?: ImportBatchState
  highlightedEventId?: string
  highlightedUntil?: number
  stageFiles: (files: readonly File[]) => void
  enqueue: (plan: ImportBatchPlan) => void
  start: () => void
  markReading: (index: number) => void
  markFileResult: (index: number, patch: Partial<ImportFileResult>) => void
  applyTurn: (turn: ImportDecisionFacts) => 'continue' | 'hold' | 'done'
  releaseAndContinue: () => void
  cancelBatch: () => void
  setHighlight: (eventId: string, until: number) => void
  fileAt: (index: number) => File | undefined
}

const stagedFiles = new Map<number, File>()

export const useImportStore = create<ImportStoreState>((set, get) => ({
  batch: undefined,
  highlightedEventId: undefined,
  highlightedUntil: undefined,

  stageFiles: (files) => {
    stagedFiles.clear()
    files.forEach((file, index) => stagedFiles.set(index, file))
  },

  enqueue: (plan) => {
    const accepted: ImportFileResult[] = plan.accepted.map((file) => ({
      fileName: sanitizeFileName(file.name),
      ext: detectFormat(file.name) as ImportTextExtension,
      bytes: file.size,
      phase: 'queued'
    }))
    const rejected: ImportFileResult[] = plan.rejected.map((file) => ({
      fileName: sanitizeFileName(file.name),
      phase: 'skipped',
      reasonKey: file.reasonKey,
      ...(file.ext ? { ext: file.ext as ImportTextExtension } : {})
    }))
    set({
      batch: { phase: 'idle', cursor: 0, files: [...accepted, ...rejected] }
    })
  },

  start: () => {
    const { batch } = get()
    if (!batch) return
    set({ batch: { ...batch, phase: 'running' } })
  },

  markReading: (index) => {
    const { batch } = get()
    if (!batch) return
    const files = batch.files.slice()
    const current = files[index]
    if (!current) return
    files[index] = { ...current, phase: 'reading' }
    set({ batch: { ...batch, files, cursor: index, phase: 'running' } })
  },

  markFileResult: (index, patch) => {
    const { batch } = get()
    if (!batch) return
    const files = batch.files.slice()
    const current = files[index]
    if (!current) return
    files[index] = {
      ...current,
      ...patch,
      ...(patch.reasonKey ? { reasonKey: escalateReason(patch.reasonKey) } : {})
    }
    set({ batch: { ...batch, files } })
  },

  applyTurn: (turn) => {
    const { batch } = get()
    if (!batch) return 'done'
    const result = advanceAfterTurn(batch, turn)
    set({ batch: result.state })
    return result.action
  },

  releaseAndContinue: () => {
    const { batch } = get()
    if (!batch || batch.phase !== 'awaiting_decision') return
    set({ batch: { ...batch, phase: 'running' } })
  },

  cancelBatch: () => {
    stagedFiles.clear()
    set({ batch: undefined })
  },

  setHighlight: (eventId, until) => {
    set({ highlightedEventId: eventId, highlightedUntil: until })
  },

  fileAt: (index) => stagedFiles.get(index)
}))
const REASON_BY_KIND: Record<ImportFailureKind, string> = {
  format: 'import.formatUnsupported',
  limit: 'import.fileTooLarge',
  decode: 'import.decodeFailed',
  no_text: 'import.noText',
  unreadable: 'import.readFailed',
  parse: 'error.aiUnavailable',
  video: 'import.videoUnsupported'
}

const reasonCounts = new Map<string, number>()

export function reasonKeyOf(kind: ImportFailureKind): string {
  return REASON_BY_KIND[kind]
}

export function escalateReason(reasonKey: string): string {
  const count = (reasonCounts.get(reasonKey) ?? 0) + 1
  reasonCounts.set(reasonKey, count)
  return count >= 3 ? 'import.askMore' : reasonKey
}
