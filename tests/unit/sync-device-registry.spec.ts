import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  credentialFingerprintOf,
  FileDeviceSecretVault,
  normalizeDeviceName,
  registerDevice,
  renameDevice,
  revokeDevice,
  verifyDevice
} from '../../src/main/sync/device-registry'
import { createSyncState } from '@shared/storage/normalize'
import type { SyncState } from '@shared/sync/types'

const NOW = 1_700_000_000_000
const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-sync-'))
  dirs.push(dir)
  return dir
}

function registerThree(): SyncState {
  let state = createSyncState(NOW, 'desk-1')
  for (const id of ['a', 'b', 'c']) {
    const result = registerDevice(state, {
      deviceId: id,
      name: `手机${id}`,
      appVersionCode: 1,
      deviceSecret: `secret-${id}`,
      now: NOW
    })
    if (!result.ok) throw new Error(result.error.code)
    state = result.data.state
  }
  return state
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('设备注册表', () => {
  it('第四台设备被拒绝且既有三台状态不变', () => {
    const state = registerThree()
    const result = registerDevice(state, {
      deviceId: 'd',
      name: '手机d',
      appVersionCode: 1,
      deviceSecret: 'secret-d',
      now: NOW
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('E_M_DEVICE_LIMIT')
    expect(state.devices).toHaveLength(3)
    expect(state.devices.every((device) => device.status === 'trusted')).toBe(true)
  })

  it('撤销后校验返回已撤销', () => {
    const state = registerThree()
    const revoked = revokeDevice(state, 'a')
    expect(revoked.ok).toBe(true)
    if (!revoked.ok) return
    expect(revoked.data.devices[0]?.status).toBe('revoked')
    const verify = verifyDevice(revoked.data, 'a', 'secret-a')
    expect(verify.ok).toBe(false)
    if (!verify.ok) expect(verify.error.code).toBe('E_M_REVOKED')
  })

  it('凭证错误返回授权失效', () => {
    const state = registerThree()
    const verify = verifyDevice(state, 'a', 'wrong-secret')
    expect(verify.ok).toBe(false)
    if (!verify.ok) expect(verify.error.code).toBe('E_M_AUTH_EXPIRED')
  })

  it('设备记录不含明文凭证且指纹固定 16 位', () => {
    const state = registerThree()
    const serialized = JSON.stringify(state)
    expect(serialized.includes('deviceSecret')).toBe(false)
    expect(serialized.includes('secret-a')).toBe(false)
    expect(credentialFingerprintOf('secret-a').length).toBe(16)
    expect(credentialFingerprintOf('secret-a')).toBe(credentialFingerprintOf('secret-a'))
  })

  it('重命名去除空白并截断到 30 字', () => {
    const state = registerThree()
    const renamed = renameDevice(state, 'a', '  客厅手机  ')
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.data.devices[0]?.name).toBe('客厅手机')
    expect(normalizeDeviceName('长'.repeat(40), 'x').length).toBe(30)
    expect(normalizeDeviceName('   ', 'fallback').length > 0).toBe(true)
  })

  it('凭证密文写在独立文件且可读回', () => {
    const dir = tempDir()
    const vault = new FileDeviceSecretVault(join(dir, 'sync', 'device-secrets.json'), () => NOW)
    vault.put('a', 'secret-a')
    expect(vault.get('a')).toBe('secret-a')
    const raw = readFileSync(join(dir, 'sync', 'device-secrets.json'), 'utf-8')
    expect(raw.includes('secret-a')).toBe(false)
    vault.remove('a')
    expect(vault.get('a')).toBeUndefined()
  })
})