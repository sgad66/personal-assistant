import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '@shared/error-catalog'
import { MESSAGES } from '@shared/message-catalog'
import { SYNC_ERROR_CODES, SYNC_ERROR_META, isSyncErrorCode, syncMessageKeyOf } from '@shared/sync/errors'
import {
  SYNC_LIMITS,
  SYNC_PATHS,
  SYNC_PROTOCOL_MAX,
  SYNC_PROTOCOL_MIN,
  SYNC_PROTOCOL_VERSION,
  outboundChangeSchema,
  pushRequestSchema,
  syncPathList
} from '@shared/sync/protocol'

const RETRYABLE = [
  'E_M_PAIR_LOCKED',
  'E_M_PROXY_TIMEOUT',
  'E_M_UNREACHABLE',
  'E_M_BLOCKED',
  'E_M_OFFLINE',
  'E_M_SYNC_BUSY',
  'E_M_SYNC_LOG_EXPIRED',
  'E_M_ACK_INVALID',
  'E_M_PAYLOAD_TOO_LARGE',
  'E_M_STORE_WRITE_FAIL',
  'E_M_STORE_FULL',
  'E_M_STORAGE_FULL'
] as const

const EVENT = {
  title: '董事会',
  startAt: 1_700_000_000_000,
  endAt: 1_700_003_600_000,
  sourceModality: 'text',
  status: 'active',
  createdAt: 1_699_999_900_000,
  updatedAt: 1_699_999_950_000,
  contentRevision: 1,
  originDevice: 'mobile',
  variant: 'authoritative'
}

describe('同步协议常量', () => {
  it('协议版本与上限值', () => {
    expect(SYNC_PROTOCOL_VERSION).toBe(1)
    expect(SYNC_PROTOCOL_MIN).toBe(1)
    expect(SYNC_PROTOCOL_MAX).toBe(1)
    expect(SYNC_LIMITS.batchEvents).toBe(200)
    expect(SYNC_LIMITS.requestBytes).toBe(2_097_152)
    expect(SYNC_LIMITS.maxDevices).toBe(3)
    expect(SYNC_LIMITS.pairingCodeTtlMs).toBe(300_000)
  })

  it('路径清单共 13 条且含全部阶段', () => {
    expect(syncPathList()).toHaveLength(13)
    expect(syncPathList()).toContain(SYNC_PATHS.health)
    expect(syncPathList()).toContain(SYNC_PATHS.pairBegin)
    expect(syncPathList()).toContain(SYNC_PATHS.pairComplete)
    expect(syncPathList()).toContain(SYNC_PATHS.status)
    expect(syncPathList()).toContain(SYNC_PATHS.pull)
    expect(syncPathList()).toContain(SYNC_PATHS.push)
    expect(syncPathList()).toContain(SYNC_PATHS.ack)
    expect(syncPathList()).toContain(SYNC_PATHS.calibrate)
    expect(syncPathList()).toContain(SYNC_PATHS.conflictResolve)
    expect(syncPathList()).toContain(SYNC_PATHS.deviceProfile)
    expect(syncPathList()).toContain(SYNC_PATHS.aiParse)
    expect(syncPathList()).toContain(SYNC_PATHS.webAuth)
    expect(syncPathList()).toContain(SYNC_PATHS.webAssets)
  })
})

describe('同步请求校验', () => {
  it('严格拒绝未知字段', () => {
    expect(pushRequestSchema.safeParse({ batchId: 'b', cursor: 0, changes: [], extra: 1 }).success).toBe(false)
    expect(pushRequestSchema.safeParse({ batchId: 'b', cursor: 0, changes: [] }).success).toBe(true)
  })

  it('upsert 必须带 event，tombstone 可省略', () => {
    expect(outboundChangeSchema.safeParse({ opId: 'o', eventId: 'e', kind: 'upsert', baseRevision: 0, revision: 1 }).success).toBe(false)
    expect(
      outboundChangeSchema.safeParse({
        opId: 'o',
        eventId: 'e',
        kind: 'upsert',
        baseRevision: 0,
        revision: 1,
        event: EVENT
      }).success
    ).toBe(true)
    expect(
      outboundChangeSchema.safeParse({ opId: 'o', eventId: 'e', kind: 'tombstone', baseRevision: 1, revision: 2 }).success
    ).toBe(true)
  })

  it('单批不超过 200 条', () => {
    const changes = Array.from({ length: 201 }, (_value, index) => ({
      opId: `o-${index}`,
      eventId: `e-${index}`,
      kind: 'tombstone' as const,
      baseRevision: 0,
      revision: 1
    }))
    expect(pushRequestSchema.safeParse({ batchId: 'b', cursor: 0, changes }).success).toBe(false)
  })
})

describe('同步错误命名空间', () => {
  it('30 项且与既有错误码零交集', () => {
    expect(SYNC_ERROR_CODES).toHaveLength(30)
    expect(new Set(SYNC_ERROR_CODES).size).toBe(30)
    for (const code of ERROR_CODES) {
      expect(SYNC_ERROR_CODES.includes(code as never)).toBe(false)
    }
  })

  it('messageKey 唯一且统一前缀', () => {
    const keys = SYNC_ERROR_CODES.map((code) => syncMessageKeyOf(code))
    expect(new Set(keys).size).toBe(30)
    for (const key of keys) {
      expect(key.startsWith('sync.error.')).toBe(true)
    }
  })

  it('可重试标记与任务清单一致', () => {
    for (const code of RETRYABLE) {
      expect(SYNC_ERROR_META[code].retryable).toBe(true)
    }
    const others = SYNC_ERROR_CODES.filter((code) => !(RETRYABLE as readonly string[]).includes(code))
    for (const code of others) {
      expect(SYNC_ERROR_META[code].retryable).toBe(false)
    }
  })

  it('错误码识别与文案齐备', () => {
    expect(isSyncErrorCode('E_M_AUTH_EXPIRED')).toBe(true)
    expect(isSyncErrorCode('E_AI_TIMEOUT')).toBe(false)
    for (const code of SYNC_ERROR_CODES) {
      expect((MESSAGES[syncMessageKeyOf(code)] ?? '').length > 0).toBe(true)
    }
  })
})

describe('同步与移动端文案', () => {
  it('既有 error.* 前缀键集合不变', () => {
    const keys = ERROR_CODES.map((code) => code)
    const messageKeys = Object.keys(MESSAGES).filter((key) => key.startsWith('error.'))
    expect(messageKeys.length).toBe(keys.length)
  })

  it('关键文案存在且语义正确', () => {
    expect(MESSAGES['mobile.uninstall.notice'].includes('卸载')).toBe(true)
    expect(MESSAGES['mobile.uninstall.notice'].includes('电脑端')).toBe(true)
    expect(MESSAGES['sync.conflict.copyPrefix']).toBe('[副本]')
    expect(MESSAGES['sync.status.connected']).toBe('已连接')
    expect(MESSAGES['mobile.parse.local']).toBe('本机解析')
  })
})