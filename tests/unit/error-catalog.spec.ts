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