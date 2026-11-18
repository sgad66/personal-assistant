import type { ImportFailureKind, ImportTextExtension } from './limits'

export type ImportFilePhase =
  | 'queued'
  | 'reading'
  | 'submitting'
  | 'awaiting_decision'
  | 'written'
  | 'no_schedule'
  | 'failed'
  | 'skipped'

export interface ImportFileResult {
  readonly fileName: string
  readonly ext?: ImportTextExtension
  readonly bytes?: number
  readonly phase: ImportFilePhase
  readonly reasonKey?: string
  readonly failureKind?: ImportFailureKind
  readonly readableChars?: number
  readonly originalChars?: number
  readonly clipped?: boolean
  readonly durationMs?: number
}

export interface ImportBatchState {
  readonly phase: 'idle' | 'running' | 'awaiting_decision' | 'done'
  readonly cursor: number
  readonly files: readonly ImportFileResult[]
}

export interface ImportDecisionFacts {
  readonly state: string
  readonly candidateCount: number
  readonly createdEventId?: string
  readonly errorCode?: string
}

export type NextImportAction =
  | { readonly kind: 'read'; readonly index: number }
  | { readonly kind: 'wait_decision' }
  | { readonly kind: 'done' }
  | { readonly kind: 'none' }

export interface AdvanceResult {
  readonly state: ImportBatchState
  readonly action: 'continue' | 'hold' | 'done'
}

const HOLD_STATES = new Set(['candidate_select', 'confirming', 'conflict', 'clarifying'])
const TERMINAL = new Set<ImportFilePhase>(['written', 'no_schedule', 'failed', 'skipped'])

export function nextImportAction(state: ImportBatchState): NextImportAction {
  if (state.files.length === 0) return { kind: 'none' }
  if (state.files.some((file) => file.phase === 'reading' || file.phase === 'submitting')) {
    return { kind: 'none' }
  }
  if (state.files.some((file) => file.phase === 'awaiting_decision')) {
    return { kind: 'wait_decision' }
  }
  const index = state.files.findIndex((file) => file.phase === 'queued')
  if (index >= 0) return { kind: 'read', index }
  return { kind: 'done' }
}

export function advanceAfterTurn(
  state: ImportBatchState,
  turn: ImportDecisionFacts,
  _now?: number
): AdvanceResult {
  const files = state.files.slice()
  const index = state.cursor
  const current = files[index]
  if (!current) {
    return { state: { ...state, files }, action: state.files.every((file) => TERMINAL.has(file.phase)) ? 'done' : 'continue' }
  }

  if (current.phase === 'awaiting_decision' && HOLD_STATES.has(turn.state)) {
    return { state: { ...state, files, phase: 'awaiting_decision' }, action: 'hold' }
  }
  if (HOLD_STATES.has(turn.state) && turn.candidateCount > 0) {
    files[index] = { ...current, phase: 'awaiting_decision' }
    return { state: { ...state, files, phase: 'awaiting_decision' }, action: 'hold' }
  }

  files[index] = settle(current, turn)
  const nextIndex = files.findIndex((file, position) => position > index && file.phase === 'queued')
  const cursor = nextIndex >= 0 ? nextIndex : files.length
  const phase = nextIndex >= 0 ? 'running' : 'done'
  return { state: { ...state, files, cursor, phase }, action: nextIndex >= 0 ? 'continue' : 'done' }
}

function settle(current: ImportFileResult, turn: ImportDecisionFacts): ImportFileResult {
  if (turn.state === 'duplicate') {
    return { ...current, phase: 'failed', reasonKey: 'error.duplicateEvent' }
  }
  if (turn.state === 'failed') {
    return { ...current, phase: 'failed' }
  }
  if (turn.createdEventId) {
    return { ...current, phase: 'written' }
  }
  if (turn.candidateCount === 0) {
    return { ...current, phase: 'no_schedule' }
  }
  return { ...current, phase: 'failed' }
}