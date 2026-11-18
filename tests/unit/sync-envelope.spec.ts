import { describe, expect, it } from 'vitest'
import { aadOf, deriveChannelKeys, makeIv, open, seal } from '../../src/main/sync/envelope'
import { checkAndAdvance } from '../../src/main/sync/replay-guard'

const SECRET = 'device-secret-for-test'

describe('同步信封加解密', () => {
  it('往返加解密成功且解密后字段一致', () => {
    const { c2mKey } = deriveChannelKeys(SECRET)
    const aad = aadOf({ protocol: 1, deviceId: 'dev-a', seq: 3, op: 'push', contractVersion: 2 })
    const envelope = seal({ batchId: 'b1', cursor: 0, changes: [] }, c2mKey, aad, 3)
    const opened = open<{ batchId: string }>(envelope, c2mKey, aad)
    expect(opened.ok).toBe(true)
    if (opened.ok) expect(opened.data.batchId).toBe('b1')
  })

  it('密文不含明文正文', () => {
    const { c2mKey } = deriveChannelKeys(SECRET)
    const aad = aadOf({ protocol: 1, deviceId: 'dev-a', seq: 1, op: 'push', contractVersion: 2 })
    const envelope = seal({ title: '会议室' }, c2mKey, aad, 1)
    expect(JSON.stringify(envelope).includes('会议室')).toBe(false)
  })

  it('篡改密文或 AAD 均解密失败', () => {
    const { c2mKey } = deriveChannelKeys(SECRET)
    const aad = aadOf({ protocol: 1, deviceId: 'dev-a', seq: 3, op: 'push', contractVersion: 2 })
    const envelope = seal({ value: 1 }, c2mKey, aad, 3)
    const flipped = Buffer.from(envelope.data, 'base64')
    flipped[0] = (flipped[0] ?? 0) ^ 0xff
    const tampered = open({ ...envelope, data: flipped.toString('base64') }, c2mKey, aad)
    expect(tampered.ok).toBe(false)
    if (!tampered.ok) expect(tampered.error.code).toBe('E_M_AUTH_EXPIRED')

    const otherAad = aadOf({ protocol: 1, deviceId: 'dev-a', seq: 4, op: 'push', contractVersion: 2 })
    expect(open(envelope, c2mKey, otherAad).ok).toBe(false)
  })

  it('双向通道密钥互不相同', () => {
    const keys = deriveChannelKeys(SECRET)
    expect(keys.c2mKey.equals(keys.m2cKey)).toBe(false)
    expect(keys.c2mKey.length).toBe(32)
    expect(keys.c2mKey.equals(deriveChannelKeys(SECRET).c2mKey)).toBe(true)
  })

  it('同序号 IV 前缀随机但序号部分稳定', () => {
    const first = makeIv(9)
    const second = makeIv(9)
    expect(first.length).toBe(12)
    expect(first.equals(second)).toBe(false)
    expect(first.subarray(4).equals(second.subarray(4))).toBe(true)
  })
})

describe('重放防护', () => {
  it('允许跳号、拒绝重复与倒退', () => {
    let state: { lastClientSeq: number } = { lastClientSeq: 0 }
    const first = checkAndAdvance(state, 1)
    expect(first.ok).toBe(true)
    if (first.ok) state = first.data
    const second = checkAndAdvance(state, 2)
    expect(second.ok).toBe(true)
    if (second.ok) state = second.data
    const jump = checkAndAdvance(state, 5)
    expect(jump.ok).toBe(true)
    if (jump.ok) state = jump.data
    expect(state.lastClientSeq).toBe(5)
    expect(checkAndAdvance(state, 2).ok).toBe(false)
    expect(checkAndAdvance(state, 0).ok).toBe(false)
    expect(state.lastClientSeq).toBe(5)
  })

  it('拒绝时状态不变', () => {
    const state = { lastClientSeq: 7 }
    const result = checkAndAdvance(state, 7)
    expect(result.ok).toBe(false)
    expect(state.lastClientSeq).toBe(7)
  })
})