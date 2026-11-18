import type { SyncErrorCode } from '@shared/sync/errors'
import { syncFail, type SyncResult } from '@shared/sync/errors'
import { SYNC_LIMITS, SYNC_PATHS, SYNC_PROTOCOL_MAX, SYNC_PROTOCOL_MIN, SYNC_PROTOCOL_VERSION } from '@shared/sync/protocol'
import { verifyDevice, type DeviceSecretVault } from './device-registry'
import type { PairingService } from './pairing-service'
import type { SyncHttpRequest, SyncHttpResponse } from './server'
import type { SyncRepository } from './sync-repository'

export const HTTP_STATUS_OF_SYNC_ERROR: Readonly<Record<SyncErrorCode, number>> = {
  E_M_OS_TOO_LOW: 400,
  E_M_SIGN_CONFLICT: 400,
  E_M_STORAGE_FULL: 507,
  E_M_STORE_WRITE_FAIL: 500,
  E_M_STORE_FULL: 503,
  E_M_STORE_CORRUPT: 500,
  E_M_PARSE_UNCLEAR: 400,
  E_M_IMAGE_REJECTED: 415,
  E_M_PROXY_TIMEOUT: 504,
  E_M_UNREACHABLE: 503,
  E_M_BLOCKED: 503,
  E_M_OFFLINE: 503,
  E_M_NOT_ENABLED: 404,
  E_M_VERSION_MISMATCH: 426,
  E_M_AUTH_EXPIRED: 401,
  E_M_REVOKED: 401,
  E_M_PAIR_CODE_INVALID: 400,
  E_M_PAIR_CODE_EXPIRED: 400,
  E_M_PAIR_LOCKED: 423,
  E_M_DEVICE_LIMIT: 409,
  E_M_SYNC_BUSY: 409,
  E_M_REPLAY_REJECTED: 401,
  E_M_PAYLOAD_TOO_LARGE: 413,
  E_M_SYNC_LOG_EXPIRED: 409,
  E_M_ACK_INVALID: 400,
  E_M_CONFLICT_NOT_FOUND: 404,
  E_M_CONFLICT_CLOSED: 409,
  E_M_DEVICE_NOT_FOUND: 404,
  E_M_PERMISSION_DENIED: 403,
  E_M_WEB_AUTH_REQUIRED: 401
}

export interface SyncRouterDeps {
  enabled: () => boolean
  pairing: PairingService
  repo: SyncRepository
  vault: DeviceSecretVault
  clock: () => number
  addresses?: () => readonly string[]
  serverFingerprintShort?: string
}

function parseJson(body: Buffer): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(body.toString('utf-8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function failure(status: number, code: SyncErrorCode): SyncHttpResponse {
  return { status, body: { errorCode: code } }
}

function toResponse<T>(result: SyncResult<T>, successStatus = 200): SyncHttpResponse {
  if (!result.ok) return failure(HTTP_STATUS_OF_SYNC_ERROR[result.error.code], result.error.code)
  return { status: successStatus, body: result.data }
}

export class SyncRouter {
  constructor(private readonly deps: SyncRouterDeps) {}

  async dispatch(request: SyncHttpRequest): Promise<SyncHttpResponse> {
    const path = request.path

    if (path === SYNC_PATHS.health) {
      if (!this.deps.enabled()) return failure(404, 'E_M_NOT_ENABLED')
      const state = this.deps.repo.stateOf()
      return {
        status: 200,
        body: {
          service: 'pa-sync',
          protocolVersion: SYNC_PROTOCOL_VERSION,
          minProtocol: SYNC_PROTOCOL_MIN,
          maxProtocol: SYNC_PROTOCOL_MAX,
          serverFingerprintShort: this.deps.serverFingerprintShort ?? '0000',
          serverTime: this.deps.clock(),
          pairingAvailable: this.deps.pairing.pairingActive,
          deviceCount: state.devices.filter((device) => device.status === 'trusted').length,
          maxDevices: SYNC_LIMITS.maxDevices
        }
      }
    }

    if (!this.deps.enabled()) return failure(404, 'E_M_NOT_ENABLED')

    if (path === SYNC_PATHS.pairBegin) return this.pairBegin(request)
    if (path === SYNC_PATHS.pairComplete) return this.pairComplete(request)

    if (!Object.values(SYNC_PATHS).includes(path as never)) return failure(404, 'E_M_NOT_ENABLED')

    const deviceId = request.headers['x-pa-device']
    if (deviceId === undefined || deviceId.length === 0) return failure(401, 'E_M_AUTH_EXPIRED')

    const state = this.deps.repo.stateOf()
    const secret = this.deps.vault.get(deviceId)
    if (secret === undefined) return failure(401, 'E_M_AUTH_EXPIRED')
    const verified = verifyDevice(state, deviceId, secret)
    if (!verified.ok) return failure(HTTP_STATUS_OF_SYNC_ERROR[verified.error.code], verified.error.code)

    this.deps.repo.updateSync((draft) => {
      draft.devices = draft.devices.map((device) =>
        device.deviceId === deviceId ? { ...device, lastSeenAt: this.deps.clock() } : device
      )
    })

    if (path === SYNC_PATHS.deviceProfile) return this.deviceProfile(request, deviceId)

    // 协议业务接口在 S3 / S8 / S9 实现，此处返回占位状态。
    return failure(501, 'E_M_NOT_ENABLED')
  }

  private pairBegin(request: SyncHttpRequest): SyncHttpResponse {
    const json = parseJson(request.body)
    if (!json) return failure(400, 'E_M_PARSE_UNCLEAR')
    const deviceId = stringField(json, 'deviceId')
    const deviceName = stringField(json, 'deviceName')
    const ephemeralPub = stringField(json, 'ephemeralPub')
    const protocolVersion = numberField(json, 'protocolVersion')
    if (!deviceId || !deviceName || !ephemeralPub || protocolVersion === undefined) {
      return failure(400, 'E_M_PARSE_UNCLEAR')
    }
    return toResponse(
      this.deps.pairing.beginHandshake({
        deviceId,
        deviceName,
        ephemeralPub,
        appVersionName: stringField(json, 'appVersionName') ?? 'unknown',
        appVersionCode: numberField(json, 'appVersionCode') ?? 0,
        contractVersion: numberField(json, 'contractVersion') ?? 2,
        protocolVersion
      })
    )
  }

  private pairComplete(request: SyncHttpRequest): SyncHttpResponse {
    const json = parseJson(request.body)
    if (!json) return failure(400, 'E_M_PARSE_UNCLEAR')
    const pairingCode = stringField(json, 'pairingCode')
    const deviceId = stringField(json, 'deviceId')
    const deviceName = stringField(json, 'deviceName')
    if (!pairingCode || !deviceId || !deviceName) return failure(400, 'E_M_PARSE_UNCLEAR')
    return toResponse(
      this.deps.pairing.completeHandshake({
        pairingCode,
        deviceId,
        deviceName,
        fingerprintConfirm: stringField(json, 'fingerprintConfirm') ?? ''
      })
    )
  }

  private deviceProfile(request: SyncHttpRequest, deviceId: string): SyncHttpResponse {
    const json = parseJson(request.body)
    if (!json) return failure(400, 'E_M_PARSE_UNCLEAR')
    const name = stringField(json, 'name')
    if (!name) return failure(400, 'E_M_PARSE_UNCLEAR')
    const now = this.deps.clock()
    const written = this.deps.repo.updateSync((draft) => {
      draft.devices = draft.devices.map((device) =>
        device.deviceId === deviceId ? { ...device, name: name.trim().slice(0, 30) } : device
      )
    })
    if (!written.ok) return failure(500, 'E_M_STORE_WRITE_FAIL')
    return { status: 200, body: { deviceId, name: name.trim().slice(0, 30), updatedAt: now } }
  }
}

export function verifySecretOf(
  repo: SyncRepository,
  vault: DeviceSecretVault,
  deviceId: string
): SyncResult<void> {
  const secret = vault.get(deviceId)
  if (secret === undefined) return syncFail('E_M_AUTH_EXPIRED')
  const verified = verifyDevice(repo.stateOf(), deviceId, secret)
  return verified.ok ? { ok: true, data: undefined } : syncFail(verified.error.code)
}