import type { SyncErrorCode } from './errors'
import type { TrustedDevice } from './types'

export interface PairingAttemptState {
  codeDigest: string
  expiresAt: number
  attempts: number
  lockedUntil?: number
  usedAt?: number
}

export type PairingValidity =
  | { ok: true }
  | { ok: false; code: SyncErrorCode; remainingMs?: number }

export function createPairingState(codeDigest: string, now: number, ttlMs: number): PairingAttemptState {
  return { codeDigest, expiresAt: now + ttlMs, attempts: 0 }
}

export function pairingValidityOf(
  state: PairingAttemptState | undefined,
  now: number,
  maxAttempts: number,
  lockMs: number
): PairingValidity {
  if (!state) return { ok: false, code: 'E_M_PAIR_CODE_EXPIRED' }
  if (state.lockedUntil !== undefined && state.lockedUntil > now) {
    return { ok: false, code: 'E_M_PAIR_LOCKED', remainingMs: state.lockedUntil - now }
  }
  if (state.usedAt !== undefined || now >= state.expiresAt) {
    return { ok: false, code: 'E_M_PAIR_CODE_EXPIRED' }
  }
  void maxAttempts
  void lockMs
  return { ok: true }
}

export function registerFailure(
  state: PairingAttemptState,
  now: number,
  maxAttempts: number,
  lockMs: number
): PairingAttemptState {
  const attempts = state.attempts + 1
  const base: PairingAttemptState = { ...state, attempts }
  if (attempts >= maxAttempts) {
    return { ...base, lockedUntil: now + lockMs }
  }
  return base
}

export function markUsed(state: PairingAttemptState, now: number): PairingAttemptState {
  return { ...state, usedAt: now }
}

export function deviceLimitReached(devices: readonly TrustedDevice[], maxDevices = 3): boolean {
  return devices.filter((device) => device.status === 'trusted').length >= maxDevices
}

export function fingerprintShortOf(digest: string): string {
  const normalized = digest.replace(/[^0-9a-f]/gi, '').toLowerCase()
  return normalized.slice(0, 4).padEnd(4, '0')
}

export function shortCode(digest: string): string {
  const normalized = digest.replace(/[^0-9a-f]/gi, '').toLowerCase()
  if (normalized.length === 0) return '000000'
  const value = parseInt(normalized.slice(0, 8), 16)
  return String(value % 1_000_000).padStart(6, '0')
}