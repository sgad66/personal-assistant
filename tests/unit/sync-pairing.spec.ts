import { describe, expect, it } from 'vitest'
import {
  createPairingState,
  deviceLimitReached,
  fingerprintShortOf,
  markUsed,
  pairingValidityOf,
  registerFailure,
  shortCode
} from '@shared/sync/pairing-rules'
import type { TrustedDevice } from '@shared/sync/types'

const TTL = 5 * 60 * 1000
const LOCK = 10 * 60 * 1000
const NOW = 1_700_000_000_000

function device(deviceId: string, status: TrustedDevice['status']): TrustedDevice {
  return {
    deviceId,
    name: deviceId,
    platform: 'android',
    pairedAt: NOW,
    status,
    permission: 'read_write',
    credentialFingerprint: 'abcdef0123456789',
    credentialVault: 'plain',
    revocationEpoch: 0,
    lastClientSeq: 0,
    lastAckedCursor: 0,
    appVersionCode: 1
  }
}

describe('配对准入规则', () => {
  it('5 分钟内有效、超时失效', () => {
    const state = createPairingState('digest', NOW, TTL)
    expect(pairingValidityOf(state, NOW + TTL - 1000, 5, LOCK).ok).toBe(true)
    const expired = pairingValidityOf(state, NOW + TTL + 1000, 5, LOCK)
    expect(expired.ok).toBe(false)
    if (!expired.ok) expect(expired.code).toBe('E_M_PAIR_CODE_EXPIRED')
  })

  it('第 5 次失败后锁定 10 分钟，锁定期间不校验码', () => {
    let state = createPairingState('digest', NOW, TTL)
    for (let index = 0; index < 5; index += 1) {
      state = registerFailure(state, NOW + index, 5, LOCK)
    }
    expect(state.lockedUntil).toBe(NOW + 4 + LOCK)
    const locked = pairingValidityOf(state, NOW + 10, 5, LOCK)
    expect(locked.ok).toBe(false)
    if (!locked.ok) {
      expect(locked.code).toBe('E_M_PAIR_LOCKED')
      expect(locked.remainingMs !== undefined).toBe(true)
    }
  })

  it('已使用视为失效且不可重复', () => {
    const used = markUsed(createPairingState('digest', NOW, TTL), NOW + 1000)
    const validity = pairingValidityOf(used, NOW + 2000, 5, LOCK)
    expect(validity.ok).toBe(false)
    if (!validity.ok) expect(validity.code).toBe('E_M_PAIR_CODE_EXPIRED')
  })

  it('设备上限只计可信设备', () => {
    expect(
      deviceLimitReached([device('a', 'trusted'), device('b', 'trusted'), device('c', 'trusted')])
    ).toBe(true)
    expect(deviceLimitReached([device('a', 'trusted'), device('b', 'trusted'), device('c', 'revoked')])).toBe(
      false
    )
    expect(deviceLimitReached([device('a', 'expired'), device('b', 'expired')])).toBe(false)
  })

  it('指纹短码恒为 4 位，六位码由摘要派生', () => {
    expect(fingerprintShortOf('0123456789abcdef').length).toBe(4)
    expect(fingerprintShortOf('0123456789abcdef')).toBe('0123')
    expect(fingerprintShortOf('zzz').length).toBe(4)
    expect(shortCode('ffffffff').length).toBe(6)
    expect(shortCode('ffffffff')).toBe(shortCode('ffffffff'))
    expect(shortCode('ffffffff') === '000000').toBe(false)
  })
})