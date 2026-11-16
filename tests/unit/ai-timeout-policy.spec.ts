import { describe, expect, it } from 'vitest'
import {
  AUTO_RETRY_MAX,
  DEFAULT_TIMEOUT_PREFERENCES,
  MEDIA_RETENTION_MS,
  RETRY_MIN_REMAINING_MS,
  TIMEOUT_BUDGETS,
  budgetFor,
  effectiveTimeoutPreferences,
  mediaRetentionMs,
  tierOf
} from '@shared/ai/timeout-policy'

describe('超时预算表', () => {
  it('标准档与宽松档的三通道数值一致', () => {
    expect(budgetFor('text')).toEqual({
      channel: 'text',
      tier: 'standard',
      firstByteMs: 8000,
      overallMs: 15000,
      totalWaitMs: 20000
    })
    expect(budgetFor('vision', { relaxed: true }).totalWaitMs).toBe(50000)
    expect(TIMEOUT_BUDGETS.standard.vision).toEqual([15000, 30000, 35000])
    expect(TIMEOUT_BUDGETS.relaxed.asr).toEqual([15000, 35000, 40000])
    expect(TIMEOUT_BUDGETS.relaxed.text).toEqual([12000, 25000, 30000])
  })

  it('两档九个组合的总等待均不超过 60 秒', () => {
    const tiers = ['standard', 'relaxed'] as const
    const channels = ['text', 'vision', 'asr'] as const
    for (const tier of tiers) {
      for (const channel of channels) {
        const budget = budgetFor(channel, { relaxed: tier === 'relaxed' })
        expect(budget.totalWaitMs <= 60000).toBe(true)
        expect(budget.overallMs < budget.totalWaitMs).toBe(true)
        expect(budget.firstByteMs < budget.overallMs).toBe(true)
      }
    }
  })

  it('缺省偏好为标准档且返回值冻结', () => {
    expect(effectiveTimeoutPreferences(undefined)).toEqual({ relaxed: false })
    expect(DEFAULT_TIMEOUT_PREFERENCES.relaxed).toBe(false)
    expect(tierOf(undefined)).toBe('standard')
    expect(tierOf({ relaxed: true })).toBe('relaxed')
    const budget = budgetFor('text')
    expect(Object.isFrozen(budget)).toBe(true)
  })

  it('保留窗口、重试常量与默认档位固定', () => {
    expect(mediaRetentionMs()).toBe(120000)
    expect(MEDIA_RETENTION_MS).toBe(120000)
    expect(RETRY_MIN_REMAINING_MS).toBe(3000)
    expect(AUTO_RETRY_MAX).toBe(1)
    expect(effectiveTimeoutPreferences({ relaxed: true }).relaxed).toBe(true)
  })
})