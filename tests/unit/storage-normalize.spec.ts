import { describe, expect, it } from 'vitest'
import {
  MOBILE_SCHEMA_VERSION,
  SYNC_STATE_SCHEMA_VERSION,
  createEmptyMobileDb,
  createSyncState,
  normalizeMobileDb,
  normalizeMobileEvent,
  normalizeSyncState
} from '@shared/storage/normalize'
import type { TrustedDevice } from '@shared/sync/types'

const NOW = 1_700_000_000_000

function device(deviceId: string): TrustedDevice {
  return {
    deviceId,
    name: deviceId,
    platform: 'android',
    pairedAt: NOW,
    status: 'trusted',
    permission: 'read_write',
    credentialFingerprint: 'abcdef0123456789',
    credentialVault: 'plain',
    revocationEpoch: 0,
    lastClientSeq: 0,
    lastAckedCursor: 0,
    appVersionCode: 1
  }
}

describe('桌面同步状态归一化', () => {
  it('缺失时补齐默认结构且不写入 enabled', () => {
    const state = normalizeSyncState(undefined, 0)
    expect(state.schemaVersion).toBe(SYNC_STATE_SCHEMA_VERSION)
    expect(state.enabled).toBe(false)
    expect(state.changeSeq).toBe(0)
    expect(state.changeLog).toHaveLength(0)
    expect(state.devices).toHaveLength(0)
    expect(state.conflicts).toHaveLength(0)
    expect(state.processedOps).toHaveLength(0)
    expect(state.pairing).toBeUndefined()
  })

  it('保留 deviceId 并接受注入值', () => {
    expect(normalizeSyncState(undefined, 0, 'desk-1').deviceId).toBe('desk-1')
    expect(createSyncState(0, 'desk-2').deviceId).toBe('desk-2')
  })

  it('第四台可信设备标记为 expired 且不静默删除', () => {
    const state = normalizeSyncState(
      { devices: [device('a'), device('b'), device('c'), device('d')] },
      NOW
    )
    expect(state.devices).toHaveLength(4)
    expect(state.devices[3]?.status).toBe('expired')
    expect(state.devices[0]?.status).toBe('trusted')
  })

  it('未知枚举原样保留', () => {
    const state = normalizeSyncState({ changeSeq: 2, changeLog: [{ seq: 1, eventId: 'e', revision: 1, kind: 'weird', originDevice: 'x', at: NOW }] }, NOW)
    expect(state.changeSeq).toBe(2)
    expect(state.changeLog[0]?.kind).toBe('weird' as never)
  })
})

describe('手机端数据归一化', () => {
  it('空库结构完整', () => {
    const db = createEmptyMobileDb(NOW)
    expect(db.schemaVersion).toBe(MOBILE_SCHEMA_VERSION)
    expect(db.events).toHaveLength(0)
    expect(db.outbox).toHaveLength(0)
    expect(db.sync.cursor).toBe(0)
    expect(db.settings.reminderEnabled).toBe(true)
    expect(db.settings.syncEnabled).toBe(false)
  })

  it('事项补齐 8 个扩展字段默认值', () => {
    const event = normalizeMobileDb({ events: [{ eventId: 'e', title: '会议', startAt: 1, endAt: 2 }] }, NOW).events[0]
    expect(event?.contentRevision).toBe(0)
    expect(event?.originDevice).toBe('desktop')
    expect(event?.syncStatus).toBe('synced')
    expect(event?.baseRevision).toBe(0)
    expect(event?.variant).toBe('authoritative')
    expect(event?.variantOrigin).toBeUndefined()
    expect(event?.cancelledAt).toBeUndefined()
    expect(event?.conflictId).toBeUndefined()
  })

  it('未知变体不丢数据', () => {
    const event = normalizeMobileEvent({ eventId: 'e', variant: 'weird' })
    expect(event.variant).toBe('weird' as never)
  })

  it('损坏输入退化为空库而非抛错', () => {
    const db = normalizeMobileDb('not-an-object', NOW)
    expect(db.events).toHaveLength(0)
  })
})