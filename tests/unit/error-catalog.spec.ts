import { describe, expect, it } from 'vitest'
import { ERROR_CODES, ERROR_META, messageKeyOf, retryableOf } from '@shared/error-catalog'
import { MESSAGES } from '@shared/message-catalog'

describe('错误码与文案', () => {
  it('错误码集合无重复且数量随扩展变化', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
    expect(ERROR_CODES.length).toBeGreaterThanOrEqual(18)
    expect(ERROR_CODES).toContain('E_AI_PROVIDER_NOT_CONFIGURED')
    expect(ERROR_CODES).toContain('E_AI_RATE_LIMITED')
    expect(ERROR_CODES).toContain('E_CONFIG_READ_FAIL')
  })

  it('每个错误码都有唯一 messageKey', () => {
    const keys = ERROR_CODES.map((code) => ERROR_META[code].messageKey)
    expect(new Set(keys).size).toBe(ERROR_CODES.length)
  })

  it('错误文案键集合与错误码集合完全对等', () => {
    const keys = ERROR_CODES.map((code) => messageKeyOf(code)).sort()
    const messageKeys = Object.keys(MESSAGES)
      .filter((key) => key.startsWith('error.'))
      .sort()
    expect(messageKeys).toEqual(keys)
    for (const key of keys) {
      expect((MESSAGES[key] ?? '').length).toBeGreaterThan(0)
    }
  })

  it('新增错误码可重试标记正确', () => {
    expect(retryableOf('E_AI_RATE_LIMITED')).toBe(true)
    expect(retryableOf('E_AI_NETWORK_FAILED')).toBe(true)
    expect(retryableOf('E_AI_TIMEOUT')).toBe(true)
    expect(retryableOf('E_CONFIG_WRITE_FAIL')).toBe(true)
    expect(retryableOf('E_AI_AUTH_FAILED')).toBe(false)
    expect(retryableOf('E_ASR_UNSUPPORTED')).toBe(false)
  })

  it('可重试标记与设计一致', () => {
    expect(retryableOf('E_INPUT_TOO_LARGE')).toBe(false)
    expect(retryableOf('E_STORE_READ_FAIL')).toBe(true)
    expect(retryableOf('E_AI_UNAVAILABLE')).toBe(true)
    expect(retryableOf('E_EVENT_NOT_FOUND')).toBe(false)
  })
})
const BASELINE_ERROR_CODES = [
  'E_ENTRY_LOAD_FAIL',
  'E_INPUT_TOO_LARGE',
  'E_ASR_FAIL',
  'E_OCR_NO_TEXT',
  'E_MISSING_START_TIME',
  'E_TIME_IN_PAST',
  'E_AI_UNAVAILABLE',
  'E_TIME_INCONSISTENT',
  'E_CONFLICT_EXISTS',
  'E_DUPLICATE_EVENT',
  'E_STORE_WRITE_FAIL',
  'E_STORE_READ_FAIL',
  'E_EVENT_NOT_FOUND',
  'E_SESSION_STATE_MISMATCH',
  'E_PENDING_EXPIRED',
  'E_REMINDER_NOT_PENDING',
  'E_NOTIFICATION_DENIED',
  'E_VALIDATION_FAILED',
  'E_PRESET_CATALOG_UNAVAILABLE',
  'E_AI_ENDPOINT_INVALID',
  'E_CONFIG_WRITE_FAIL',
  'E_CONFIG_READ_FAIL',
  'E_ASR_UNSUPPORTED',
  'E_OCR_UNSUPPORTED',
  'E_AI_CHANNEL_DISABLED',
  'E_AI_PROVIDER_NOT_CONFIGURED',
  'E_AI_AUTH_FAILED',
  'E_AI_RATE_LIMITED',
  'E_AI_MODEL_UNSUPPORTED',
  'E_AI_NETWORK_FAILED',
  'E_AI_TIMEOUT'
]

describe('错误码集合冻结', () => {
  it('与基线逐一一致，超时增量未新增错误码', () => {
    expect([...ERROR_CODES].sort()).toEqual([...BASELINE_ERROR_CODES].sort())
    expect(ERROR_CODES).toHaveLength(BASELINE_ERROR_CODES.length)
  })

  it('新增失败文案不属于错误码', () => {
    expect(ERROR_CODES.includes('ai.fail.network.vision' as never)).toBe(false)
    expect(MESSAGES['ai.fail.network.vision'].length > 0).toBe(true)
    expect(MESSAGES['ai.fail.firstByteTimeout.text'].length > 0).toBe(true)
    expect(MESSAGES['error.aiTimeout'].length > 0).toBe(true)
    expect(MESSAGES['error.aiNetworkFailed'].length > 0).toBe(true)
  })
})
