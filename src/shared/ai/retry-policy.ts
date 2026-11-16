import type { FailureCategory, FailureStage } from '../result'
import { RETRY_MIN_REMAINING_MS } from './timeout-policy'

export type RetryBlockReason =
  | 'failure_class'
  | 'stage'
  | 'already_retried'
  | 'not_idempotent'
  | 'budget_exhausted'
  | 'source_changed'

export type RetryDecision =
  | { readonly retry: true }
  | { readonly retry: false; readonly reason: RetryBlockReason }

export interface RetryDecisionInput {
  readonly failureClass?: FailureCategory
  readonly stage: FailureStage
  readonly receivedFirstByte: boolean
  readonly attempt: number
  readonly idempotent: boolean
  readonly remainingMs: number
  readonly snapshotRevision: number
  readonly currentRevision: number
}

const RETRYABLE_CLASSES: readonly FailureCategory[] = ['timeout', 'network']

export function decideAutoRetry(input: RetryDecisionInput): RetryDecision {
  if (input.failureClass === undefined || !RETRYABLE_CLASSES.includes(input.failureClass)) {
    return { retry: false, reason: 'failure_class' }
  }
  if (input.stage !== 'connect_first_byte' || input.receivedFirstByte) {
    return { retry: false, reason: 'stage' }
  }
  if (input.attempt >= 1) {
    return { retry: false, reason: 'already_retried' }
  }
  if (!input.idempotent) {
    return { retry: false, reason: 'not_idempotent' }
  }
  if (input.remainingMs < RETRY_MIN_REMAINING_MS) {
    return { retry: false, reason: 'budget_exhausted' }
  }
  if (input.snapshotRevision !== input.currentRevision) {
    return { retry: false, reason: 'source_changed' }
  }
  return { retry: true }
}

export function remainingBudgetMs(totalWaitMs: number, elapsedMs: number): number {
  return Math.max(0, totalWaitMs - elapsedMs)
}