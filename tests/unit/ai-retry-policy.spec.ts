import { describe, expect, it } from 'vitest'
import { decideAutoRetry, remainingBudgetMs, type RetryDecisionInput } from '@shared/ai/retry-policy'

function input(overrides: Partial<RetryDecisionInput> = {}): RetryDecisionInput {
  return {
    failureClass: 'timeout',
    stage: 'connect_first_byte',
    receivedFirstByte: false,
    attempt: 0,
    idempotent: true,
    remainingMs: 3000,
    snapshotRevision: 2,
    currentRevision: 2,
    ...overrides
  }
}

describe('自动重试白名单', () => {
  it('超时 + 首包 + 预算足够 + 配置未变时允许一次', () => {
    expect(decideAutoRetry(input())).toEqual({ retry: true })
    expect(decideAutoRetry(input({ failureClass: 'network' }))).toEqual({ retry: true })
  })

  it('非超时/网络类一律不重试', () => {
    const cases = [
      'unauthorized',
      'rateLimited',
      'modelUnavailable',
      'unparsable',
      'serviceError'
    ] as const
    for (const failureClass of cases) {
      const decision = decideAutoRetry(input({ failureClass }))
      expect(decision.retry).toBe(false)
      if (!decision.retry) expect(decision.reason).toBe('failure_class')
    }
    const missing = decideAutoRetry(input({ failureClass: undefined }))
    expect(missing.retry).toBe(false)
    if (!missing.retry) expect(missing.reason).toBe('failure_class')
  })

  it('整体超时或首包已达都不重试', () => {
    const bodyStage = decideAutoRetry(input({ stage: 'body_transfer' }))
    expect(bodyStage.retry).toBe(false)
    if (!bodyStage.retry) expect(bodyStage.reason).toBe('stage')
    const firstByteReceived = decideAutoRetry(input({ receivedFirstByte: true }))
    expect(firstByteReceived.retry).toBe(false)
    if (!firstByteReceived.retry) expect(firstByteReceived.reason).toBe('stage')
  })

  it('已重试、非幂等、预算不足、配置变更均阻断', () => {
    const retried = decideAutoRetry(input({ attempt: 1 }))
    expect(retried.retry).toBe(false)
    if (!retried.retry) expect(retried.reason).toBe('already_retried')

    const notIdempotent = decideAutoRetry(input({ idempotent: false }))
    expect(notIdempotent.retry).toBe(false)
    if (!notIdempotent.retry) expect(notIdempotent.reason).toBe('not_idempotent')

    const lowBudget = decideAutoRetry(input({ remainingMs: 2999 }))
    expect(lowBudget.retry).toBe(false)
    if (!lowBudget.retry) expect(lowBudget.reason).toBe('budget_exhausted')

    const changed = decideAutoRetry(input({ snapshotRevision: 2, currentRevision: 3 }))
    expect(changed.retry).toBe(false)
    if (!changed.retry) expect(changed.reason).toBe('source_changed')
  })

  it('剩余预算计算不为负', () => {
    expect(remainingBudgetMs(20000, 5000)).toBe(15000)
    expect(remainingBudgetMs(20000, 25000)).toBe(0)
    expect(remainingBudgetMs(20000, 20000)).toBe(0)
  })
})