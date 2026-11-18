import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { syncFail, syncOk, type SyncResult } from '@shared/sync/errors'
import { deviceLimitReached } from '@shared/sync/pairing-rules'
import type { SyncState, TrustedDevice } from '@shared/sync/types'

export function credentialFingerprintOf(secret: string): string {
  return createHash('sha256').update(secret, 'utf-8').digest('hex').slice(0, 16)
}

export interface DeviceSecretVault {
  readonly kind: 'safe_storage' | 'plain'
  put(deviceId: string, secret: string): void
  get(deviceId: string): string | undefined
  remove(deviceId: string): void
}

interface SecretsFile {
  schemaVersion: number
  secrets: Record<string, { sealed: string; vault: 'safe_storage' | 'plain'; updatedAt: number }>
}

/**
 * 设备凭证独立文件：不改 `data.json` 结构，避免凭证进入主数据。
 * 默认 base64 包装（与既有 PlainFileVault 策略一致，仅作混淆，不作为安全边界）。
 */
export class FileDeviceSecretVault implements DeviceSecretVault {
  readonly kind = 'plain' as const
  private cache: SecretsFile | undefined

  constructor(
    private readonly filePath: string,
    private readonly clock: () => number = () => Date.now()
  ) {}

  private load(): SecretsFile {
    if (this.cache) return this.cache
    if (!existsSync(this.filePath)) {
      this.cache = { schemaVersion: 1, secrets: {} }
      return this.cache
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<SecretsFile>
      this.cache = { schemaVersion: 1, secrets: raw.secrets ?? {} }
    } catch {
      this.cache = { schemaVersion: 1, secrets: {} }
    }
    return this.cache
  }

  private persist(): void {
    const data = this.load()
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(data), 'utf-8')
    renameSync(tmp, this.filePath)
  }

  put(deviceId: string, secret: string): void {
    const data = this.load()
    data.secrets[deviceId] = {
      sealed: Buffer.from(secret, 'utf-8').toString('base64'),
      vault: 'plain',
      updatedAt: this.clock()
    }
    this.persist()
  }

  get(deviceId: string): string | undefined {
    const record = this.load().secrets[deviceId]
    if (!record) return undefined
    try {
      return Buffer.from(record.sealed, 'base64').toString('utf-8')
    } catch {
      return undefined
    }
  }

  remove(deviceId: string): void {
    const data = this.load()
    if (data.secrets[deviceId] === undefined) return
    delete data.secrets[deviceId]
    this.persist()
  }
}

export interface RegisterDeviceInput {
  deviceId: string
  name: string
  appVersionCode: number
  deviceSecret: string
  now: number
}

export function registerDevice(
  state: SyncState,
  input: RegisterDeviceInput
): SyncResult<{ state: SyncState; device: TrustedDevice }> {
  if (deviceLimitReached(state.devices)) return syncFail('E_M_DEVICE_LIMIT')
  const existing = state.devices.find((device) => device.deviceId === input.deviceId)
  if (existing && existing.status === 'trusted') return syncFail('E_M_DEVICE_LIMIT')
  const device: TrustedDevice = {
    deviceId: input.deviceId,
    name: normalizeDeviceName(input.name, input.deviceId),
    platform: 'android',
    pairedAt: input.now,
    status: 'trusted',
    permission: 'read_write',
    credentialFingerprint: credentialFingerprintOf(input.deviceSecret),
    credentialVault: 'plain',
    revocationEpoch: existing?.revocationEpoch ?? 0,
    lastClientSeq: 0,
    lastAckedCursor: 0,
    appVersionCode: input.appVersionCode
  }
  return syncOk({
    state: { ...state, devices: [...state.devices.filter((item) => item.deviceId !== input.deviceId), device] },
    device
  })
}

export function revokeDevice(state: SyncState, deviceId: string): SyncResult<SyncState> {
  const target = state.devices.find((device) => device.deviceId === deviceId)
  if (!target) return syncFail('E_M_DEVICE_NOT_FOUND')
  return syncOk({
    ...state,
    devices: state.devices.map((device) =>
      device.deviceId === deviceId
        ? { ...device, status: 'revoked', revocationEpoch: device.revocationEpoch + 1 }
        : device
    )
  })
}

/** 名称长度按"截断到 30 字"实现（超长不报错），首尾空白去除，空名回退到设备标识。 */
export function renameDevice(state: SyncState, deviceId: string, name: string): SyncResult<SyncState> {
  const target = state.devices.find((device) => device.deviceId === deviceId)
  if (!target) return syncFail('E_M_DEVICE_NOT_FOUND')
  const normalized = normalizeDeviceName(name, target.name)
  return syncOk({
    ...state,
    devices: state.devices.map((device) =>
      device.deviceId === deviceId ? { ...device, name: normalized } : device
    )
  })
}

export function normalizeDeviceName(name: string, fallback: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return fallback.slice(0, 30)
  return trimmed.slice(0, 30)
}

export function listDevices(state: SyncState): readonly TrustedDevice[] {
  return state.devices
}

export function verifyDevice(state: SyncState, deviceId: string, deviceSecret?: string): SyncResult<TrustedDevice> {
  const target = state.devices.find((device) => device.deviceId === deviceId)
  if (!target) return syncFail('E_M_AUTH_EXPIRED')
  if (target.status === 'revoked') return syncFail('E_M_REVOKED')
  if (target.status !== 'trusted') return syncFail('E_M_AUTH_EXPIRED')
  if (deviceSecret !== undefined && credentialFingerprintOf(deviceSecret) !== target.credentialFingerprint) {
    return syncFail('E_M_AUTH_EXPIRED')
  }
  return syncOk(target)
}