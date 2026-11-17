import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { memoryStore } from '../../src/main/storage/data-store'
import { SyncRepository } from '../../src/main/sync/sync-repository'
import { FileDeviceSecretVault } from '../../src/main/sync/device-registry'
import { PairingService } from '../../src/main/sync/pairing-service'
import { SyncRouter } from '../../src/main/sync/router'
import { SyncServer } from '../../src/main/sync/server'
import { revokeDevice } from '../../src/main/sync/device-registry'
import { SYNC_PATHS } from '@shared/sync/protocol'
import { TEST_NOW, makePairBegin } from '../helpers/sync-fixtures'

interface Harness {
  port: number
  pairing: PairingService
  repo: SyncRepository
  vault: FileDeviceSecretVault
  advance: (ms: number) => void
  setEnabled: (value: boolean) => void
  stop: () => Promise<void>
}

async function createHarness(): Promise<Harness> {
  let now = TEST_NOW
  const clock = (): number => now
  const store = memoryStore(clock)
  const repo = new SyncRepository(store, clock)
  const dir = mkdtempSync(join(tmpdir(), 'pa-pair-'))
  const vault = new FileDeviceSecretVault(join(dir, 'sync', 'device-secrets.json'), clock)
  const pairing = new PairingService({
    repo,
    vault,
    clock,
    serverFingerprintShort: 'abcd',
    addresses: () => ['127.0.0.1:47821']
  })
  let enabled = true
  const router = new SyncRouter({
    enabled: () => enabled,
    pairing,
    repo,
    vault,
    clock,
    serverFingerprintShort: 'abcd'
  })
  const server = new SyncServer({ dispatcher: (request) => router.dispatch(request), clock })
  const { port } = await server.start({ port: 0 })
  return {
    port,
    pairing,
    repo,
    vault,
    advance: (ms) => {
      now += ms
    },
    setEnabled: (value) => {
      enabled = value
    },
    stop: () => server.stop()
  }
}

async function call(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const init: RequestInit = { method, headers: { ...headers } }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['content-type'] = 'application/json'
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init)
  const json = (await response.json()) as Record<string, unknown>
  return { status: response.status, json }
}

async function pairDevice(harness: Harness, deviceId: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const challenge = harness.pairing.beginPairing()
  if (!challenge.ok) throw new Error(challenge.error.code)
  await call(harness.port, 'POST', SYNC_PATHS.pairBegin, makePairBegin(deviceId))
  return call(harness.port, 'POST', SYNC_PATHS.pairComplete, {
    pairingCode: challenge.data.code,
    deviceId,
    deviceName: `手机-${deviceId}`,
    fingerprintConfirm: challenge.data.fingerprintShort
  })
}

describe('配对与传输（真实 HTTP）', () => {
  it('未开启互通时 health 返回 404 且不暴露版本', async () => {
    const harness = await createHarness()
    try {
      harness.setEnabled(false)
      const result = await call(harness.port, 'GET', SYNC_PATHS.health)
      expect(result.status).toBe(404)
      expect(result.json.errorCode).toBe('E_M_NOT_ENABLED')
      expect(result.json.protocolVersion).toBeUndefined()
    } finally {
      await harness.stop()
    }
  })

  it('开启后 health 返回协议区间且不含设备名', async () => {
    const harness = await createHarness()
    try {
      const result = await call(harness.port, 'GET', SYNC_PATHS.health)
      expect(result.status).toBe(200)
      expect(result.json.protocolVersion).toBe(1)
      expect(result.json.maxDevices).toBe(3)
      expect(result.json.deviceName).toBeUndefined()
    } finally {
      await harness.stop()
    }
  })

  it('配对成功后返回凭证且响应不含码摘要', async () => {
    const harness = await createHarness()
    try {
      const result = await pairDevice(harness, 'dev-a')
      expect(result.status).toBe(200)
      expect(typeof result.json.deviceSecret).toBe('string')
      expect(result.json.deviceId).toBe('dev-a')
      expect(JSON.stringify(result.json).includes('codeDigest')).toBe(false)
      expect(harness.repo.stateOf().devices).toHaveLength(1)
      expect(harness.vault.get('dev-a') !== undefined).toBe(true)
    } finally {
      await harness.stop()
    }
  })

  it('配对码过期与二次使用均被拒绝', async () => {
    const harness = await createHarness()
    try {
      const challenge = harness.pairing.beginPairing()
      if (!challenge.ok) throw new Error(challenge.error.code)
      await call(harness.port, 'POST', SYNC_PATHS.pairBegin, makePairBegin('dev-a'))
      await call(harness.port, 'POST', SYNC_PATHS.pairComplete, {
        pairingCode: challenge.data.code,
        deviceId: 'dev-a',
        deviceName: '手机-a',
        fingerprintConfirm: challenge.data.fingerprintShort
      })
      const reused = await call(harness.port, 'POST', SYNC_PATHS.pairComplete, {
        pairingCode: challenge.data.code,
        deviceId: 'dev-a',
        deviceName: '手机-a',
        fingerprintConfirm: challenge.data.fingerprintShort
      })
      expect(reused.status).toBe(400)
      expect(reused.json.errorCode).toBe('E_M_PAIR_CODE_EXPIRED')

      const second = harness.pairing.beginPairing()
      if (!second.ok) throw new Error(second.error.code)
      harness.advance(5 * 60 * 1000 + 1000)
      const expired = await call(harness.port, 'POST', SYNC_PATHS.pairComplete, {
        pairingCode: second.data.code,
        deviceId: 'dev-b',
        deviceName: '手机-b',
        fingerprintConfirm: 'abcd'
      })
      expect(expired.json.errorCode).toBe('E_M_PAIR_CODE_EXPIRED')
    } finally {
      await harness.stop()
    }
  })

  it('连续 5 次错误码后锁定', async () => {
    const harness = await createHarness()
    try {
      const challenge = harness.pairing.beginPairing()
      if (!challenge.ok) throw new Error(challenge.error.code)
      await call(harness.port, 'POST', SYNC_PATHS.pairBegin, makePairBegin('dev-a'))
      for (let index = 0; index < 5; index += 1) {
        await call(harness.port, 'POST', SYNC_PATHS.pairComplete, {
          pairingCode: '000000',
          deviceId: 'dev-a',
          deviceName: '手机-a',
          fingerprintConfirm: 'abcd'
        })
      }
      const locked = await call(harness.port, 'POST', SYNC_PATHS.pairComplete, {
        pairingCode: '000000',
        deviceId: 'dev-a',
        deviceName: '手机-a',
        fingerprintConfirm: 'abcd'
      })
      expect(locked.status).toBe(423)
      expect(locked.json.errorCode).toBe('E_M_PAIR_LOCKED')
    } finally {
      await harness.stop()
    }
  })

  it('第四台设备被拒绝', async () => {
    const harness = await createHarness()
    try {
      for (const id of ['a', 'b', 'c']) {
        const paired = await pairDevice(harness, id)
        expect(paired.status).toBe(200)
      }
      const fourth = harness.pairing.beginPairing()
      expect(fourth.ok).toBe(false)
      if (!fourth.ok) expect(fourth.error.code).toBe('E_M_DEVICE_LIMIT')
    } finally {
      await harness.stop()
    }
  })

  it('撤销后业务请求返回 401 已撤销', async () => {
    const harness = await createHarness()
    try {
      const paired = await pairDevice(harness, 'dev-a')
      expect(paired.status).toBe(200)
      const revoked = harness.repo.updateSync((draft) => {
        const result = revokeDevice(draft, 'dev-a')
        if (result.ok) draft.devices = result.data.devices
      })
      expect(revoked.ok).toBe(true)
      const status = await call(harness.port, 'POST', SYNC_PATHS.status, {}, { 'x-pa-device': 'dev-a' })
      expect(status.status).toBe(401)
      expect(status.json.errorCode).toBe('E_M_REVOKED')
    } finally {
      await harness.stop()
    }
  })

  it('缺少设备头或未知路径均不泄露数据', async () => {
    const harness = await createHarness()
    try {
      const missing = await call(harness.port, 'POST', SYNC_PATHS.status, {})
      expect(missing.status).toBe(401)
      expect(missing.json.errorCode).toBe('E_M_AUTH_EXPIRED')
      expect(Object.keys(missing.json)).toHaveLength(1)

      const unknown = await call(harness.port, 'GET', '/sync/v1/nope')
      expect(unknown.status).toBe(404)
      expect(unknown.json.protocolVersion).toBeUndefined()
    } finally {
      await harness.stop()
    }
  })

  it('请求体超过 2MB 返回 413', async () => {
    const harness = await createHarness()
    try {
      const oversized = await fetch(`http://127.0.0.1:${harness.port}${SYNC_PATHS.push}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(2 * 1024 * 1024 + 16)
      })
      expect(oversized.status).toBe(413)
      const body = (await oversized.json()) as Record<string, unknown>
      expect(body.errorCode).toBe('E_M_PAYLOAD_TOO_LARGE')
    } finally {
      await harness.stop()
    }
  })
})