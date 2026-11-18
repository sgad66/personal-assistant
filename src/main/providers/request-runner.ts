import { fail, type Result } from '@shared/result'
import { messageKeyOf } from '@shared/error-catalog'
import { decideAutoRetry, remainingBudgetMs, type RetryBlockReason } from '@shared/ai/retry-policy'
import type { ChannelBudget } from '@shared/ai/timeout-policy'
import type { AiChannelKind } from '@shared/ai/preset-catalog'

export interface RetryContext {
  readonly channel: AiChannelKind
  readonly budget: ChannelBudget
  readonly snapshotRevision: number
  readonly currentRevision: () => number
  readonly idempotent: boolean
  readonly clock?: () => number
  readonly startedAt?: number
  readonly onBeforeRetry?: (attempt: number) => void
}

export interface RetryOutcome<T> {
  readonly result: Result<T>
  readonly attempts: number
  readonly autoRetried: boolean
  readonly retryCount: number
  readonly elapsedMs: number
  readonly retryBlockReason?: RetryBlockReason
}

export async function withAutoRetry<T>(
  invoke: () => Promise<Result<T>>,
  context: RetryContext
): Promise<RetryOutcome<T>> {
  const clock = context.clock ?? (() => performance.now())
  const started = clock()
  const anchor = context.startedAt ?? started
  const first = await safeInvoke(invoke, clock, started)
  if (first.ok) {
    return {
      result: first,
      attempts: 1,
      autoRetried: false,
      retryCount: 0,
      elapsedMs: Math.max(0, clock() - started)
    }
  }

  const decision = decideAutoRetry({
    failureClass: first.error.failureCategory,
    stage: first.error.failureMeta?.stage ?? 'connect_first_byte',
    receivedFirstByte: first.error.failureMeta?.receivedFirstByte ?? false,
    attempt: 0,
    idempotent: context.idempotent,
    remainingMs: remainingBudgetMs(context.budget.totalWaitMs, clock() - anchor),
    snapshotRevision: context.snapshotRevision,
    currentRevision: context.currentRevision()
  })

  if (!decision.retry) {
    return {
      result: first,
      attempts: 1,
      autoRetried: false,
      retryCount: 0,
      elapsedMs: Math.max(0, clock() - started),
      retryBlockReason: decision.reason
    }
  }

  context.onBeforeRetry?.(1)
  const second = await safeInvoke(invoke, clock, started)
  return {
    result: second,
    attempts: 2,
    autoRetried: true,
    retryCount: 1,
    elapsedMs: Math.max(0, clock() - started)
  }
}

async function safeInvoke<T>(
  invoke: () => Promise<Result<T>>,
  clock: () => number,
  started: number
): Promise<Result<T>> {
  try {
    return await invoke()
  } catch {
    return fail('E_AI_UNAVAILABLE', messageKeyOf('E_AI_UNAVAILABLE'), true, {
      failureCategory: 'serviceError',
      failureMeta: {
        stage: 'result_parse',
        receivedFirstByte: false,
        elapsedMs: Math.max(0, clock() - started)
      }
    })
  }
}