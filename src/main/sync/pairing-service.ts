import { createHash, generateKeyPairSync, randomBytes, randomInt, type KeyObject } from 'node:crypto'
import { syncFail, syncOk, type SyncResult } from '@shared/sync/errors'
import {
  SYNC_LIMITS,
  SYNC_PROTOCOL_MAX,
  SYNC_PROTOCOL_MIN,
  SYNC_PROTOCOL_VERSION,
  type PairBeginRequest,
  type PairBeginResponse,
  type PairCompleteRequest,
  type PairCompleteResponse
} from '@shared/sync/protocol'
import {
  createPairingState,
  deviceLimitReached,
  fingerprintShortOf,
  markUsed,
  pairingValidityOf,
  registerFailure,
  type PairingAttemptState
} from '@shared/sync/pairing-rules'
import { registerDevice, credentialFingerprintOf, type DeviceSecretVault } from './device-registry'
import type { SyncRepository } from './sync-repository'

export interface PairingChallenge {
  code: string
  expiresAt: number
  fingerprintShort: string
  addresses: readonly string[]
}

interface HandshakeState {
  nonce: string
  privateKey: KeyObject
  publicKeyBase64: string
  expiresAt: number
  appVersionCode: number
}

export interface PairingServiceOptions {
  repo: SyncRepository
  vault: DeviceSecretVault
  clock: () => number
  addresses?: () => readonly string[]
  serverFingerprintShort?: string
}

function digestOf(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex')
}

function publicKeyBase64Of(publicKey: KeyObject): string {
  const raw = publicKey.export({ format: 'der', type: 'spki' })
  return Buffer.from(raw).subarray(-32).toString('base64')
}

/**
 * 配对服务：配对码与失败计数只存内存（进程退出即失效），设备与凭证落 `sync` 子结构与独立凭证文件。
 * 已知偏差：配对通道的应用层加密由 S7 客户端统一补齐，本服务在 HTTP 明文层完成码校验与设备登记。
 */
export class PairingService {
  private pairing: PairingAttemptState | undefined
  private handshake: HandshakeState | undefined
  private currentCode: string | undefined

  constructor(private readonly options: PairingServiceOptions) {}

  private now(): number {
    return this.options.clock()
  }

  beginPairing(): SyncResult<PairingChallenge> {
    const state = this.options.repo.stateOf()
    if (deviceLimitReached(state.devices)) return syncFail('E_M_DEVICE_LIMIT')
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.currentCode = code
    this.pairing = createPairingState(digestOf(code), this.now(), SYNC_LIMITS.pairingCodeTtlMs)
    this.handshake = undefined
    return syncOk({
      code,
      expiresAt: this.pairing.expiresAt,
      fingerprintShort: this.options.serverFingerprintShort ?? fingerprintShortOf(digestOf(code)),
      addresses: this.options.addresses?.() ?? []
    })
  }

  cancelPairing(): void {
    this.pairing = undefined
    this.handshake = undefined
    this.currentCode = undefined
  }

  beginHandshake(request: PairBeginRequest): SyncResult<PairBeginResponse> {
    const now = this.now()
    const validity = pairingValidityOf(
      this.pairing,
      now,
      SYNC_LIMITS.pairingMaxAttempts,
      SYNC_LIMITS.pairingLockMs
    )
    if (!validity.ok) {
      return syncFail(validity.code)
    }
    if (request.protocolVersion < SYNC_PROTOCOL_MIN || request.protocolVersion > SYNC_PROTOCOL_MAX) {
      return syncFail('E_M_VERSION_MISMATCH')
    }
    const state = this.options.repo.stateOf()
    if (deviceLimitReached(state.devices)) return syncFail('E_M_DEVICE_LIMIT')

    const { publicKey, privateKey } = generateKeyPairSync('x25519')
    const nonce = randomBytes(16).toString('base64')
    const publicKeyBase64 = publicKeyBase64Of(publicKey)
    const expiresAt = this.pairing?.expiresAt ?? now
    this.handshake = { nonce, privateKey, publicKeyBase64, expiresAt, appVersionCode: request.appVersionCode }

    return syncOk({
      serverEphemeralPub: publicKeyBase64,
      serverNonce: nonce,
      serverFingerprintShort: this.options.serverFingerprintShort ?? fingerprintShortOf(digestOf(this.currentCode ?? '')),
      expiresAt,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      minProtocol: SYNC_PROTOCOL_MIN,
      maxProtocol: SYNC_PROTOCOL_MAX
    })
  }

  completeHandshake(request: PairCompleteRequest): SyncResult<PairCompleteResponse> {
    const now = this.now()
    const validity = pairingValidityOf(
      this.pairing,
      now,
      SYNC_LIMITS.pairingMaxAttempts,
      SYNC_LIMITS.pairingLockMs
    )
    if (!validity.ok) return syncFail(validity.code)
    const pairing = this.pairing
    if (!pairing) return syncFail('E_M_PAIR_CODE_EXPIRED')

    if (digestOf(request.pairingCode) !== pairing.codeDigest) {
      this.pairing = registerFailure(
        pairing,
        now,
        SYNC_LIMITS.pairingMaxAttempts,
        SYNC_LIMITS.pairingLockMs
      )
      if (this.pairing.lockedUntil !== undefined && this.pairing.lockedUntil > now) {
        return syncFail('E_M_PAIR_LOCKED')
      }
      return syncFail('E_M_PAIR_CODE_INVALID')
    }

    const state = this.options.repo.stateOf()
    if (deviceLimitReached(state.devices)) return syncFail('E_M_DEVICE_LIMIT')

    const deviceSecret = randomBytes(32).toString('base64url')
    const registered = registerDevice(state, {
      deviceId: request.deviceId,
      name: request.deviceName,
      appVersionCode: this.handshake?.appVersionCode ?? 1,
      deviceSecret,
      now
    })
    if (!registered.ok) return syncFail(registered.error.code)

    const written = this.options.repo.updateSync((draft) => {
      draft.devices = registered.data.state.devices
    })
    if (!written.ok) return syncFail('E_M_STORE_WRITE_FAIL')

    try {
      this.options.vault.put(request.deviceId, deviceSecret)
    } catch {
      return syncFail('E_M_STORE_WRITE_FAIL')
    }

    this.pairing = markUsed(pairing, now)
    this.handshake = undefined
    this.currentCode = undefined

    return syncOk({
      deviceSecret,
      deviceId: request.deviceId,
      serverTime: now,
      credentialFingerprint: credentialFingerprintOf(deviceSecret),
      syncCursor: 0
    })
  }

  /** 供路由层判定"当前是否有可配对会话"。 */
  get pairingActive(): boolean {
    return this.pairing !== undefined && this.pairing.usedAt === undefined && this.pairing.expiresAt > this.now()
  }
}