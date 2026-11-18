// 同步/移动端错误命名空间：独立于既有 ERROR_CODES（31 项冻结）
export const SYNC_ERROR_CODES = [
  'E_M_OS_TOO_LOW',
  'E_M_SIGN_CONFLICT',
  'E_M_STORAGE_FULL',
  'E_M_STORE_WRITE_FAIL',
  'E_M_STORE_FULL',
  'E_M_STORE_CORRUPT',
  'E_M_PARSE_UNCLEAR',
  'E_M_IMAGE_REJECTED',
  'E_M_PROXY_TIMEOUT',
  'E_M_UNREACHABLE',
  'E_M_BLOCKED',
  'E_M_OFFLINE',
  'E_M_NOT_ENABLED',
  'E_M_VERSION_MISMATCH',
  'E_M_AUTH_EXPIRED',
  'E_M_REVOKED',
  'E_M_PAIR_CODE_INVALID',
  'E_M_PAIR_CODE_EXPIRED',
  'E_M_PAIR_LOCKED',
  'E_M_DEVICE_LIMIT',
  'E_M_SYNC_BUSY',
  'E_M_REPLAY_REJECTED',
  'E_M_PAYLOAD_TOO_LARGE',
  'E_M_SYNC_LOG_EXPIRED',
  'E_M_ACK_INVALID',
  'E_M_CONFLICT_NOT_FOUND',
  'E_M_CONFLICT_CLOSED',
  'E_M_DEVICE_NOT_FOUND',
  'E_M_PERMISSION_DENIED',
  'E_M_WEB_AUTH_REQUIRED'
] as const

export type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number]

interface SyncErrorMeta {
  readonly messageKey: string
  readonly retryable: boolean
}

export const SYNC_ERROR_META: Readonly<Record<SyncErrorCode, SyncErrorMeta>> = {
  E_M_OS_TOO_LOW: { messageKey: 'sync.error.osTooLow', retryable: false },
  E_M_SIGN_CONFLICT: { messageKey: 'sync.error.signConflict', retryable: false },
  E_M_STORAGE_FULL: { messageKey: 'sync.error.storageFull', retryable: true },
  E_M_STORE_WRITE_FAIL: { messageKey: 'sync.error.storeWriteFail', retryable: true },
  E_M_STORE_FULL: { messageKey: 'sync.error.storeFull', retryable: true },
  E_M_STORE_CORRUPT: { messageKey: 'sync.error.storeCorrupt', retryable: false },
  E_M_PARSE_UNCLEAR: { messageKey: 'sync.error.parseUnclear', retryable: false },
  E_M_IMAGE_REJECTED: { messageKey: 'sync.error.imageRejected', retryable: false },
  E_M_PROXY_TIMEOUT: { messageKey: 'sync.error.proxyTimeout', retryable: true },
  E_M_UNREACHABLE: { messageKey: 'sync.error.unreachable', retryable: true },
  E_M_BLOCKED: { messageKey: 'sync.error.blocked', retryable: true },
  E_M_OFFLINE: { messageKey: 'sync.error.offline', retryable: true },
  E_M_NOT_ENABLED: { messageKey: 'sync.error.notEnabled', retryable: false },
  E_M_VERSION_MISMATCH: { messageKey: 'sync.error.versionMismatch', retryable: false },
  E_M_AUTH_EXPIRED: { messageKey: 'sync.error.authExpired', retryable: false },
  E_M_REVOKED: { messageKey: 'sync.error.revoked', retryable: false },
  E_M_PAIR_CODE_INVALID: { messageKey: 'sync.error.pairCodeInvalid', retryable: false },
  E_M_PAIR_CODE_EXPIRED: { messageKey: 'sync.error.pairCodeExpired', retryable: false },
  E_M_PAIR_LOCKED: { messageKey: 'sync.error.pairLocked', retryable: true },
  E_M_DEVICE_LIMIT: { messageKey: 'sync.error.deviceLimit', retryable: false },
  E_M_SYNC_BUSY: { messageKey: 'sync.error.syncBusy', retryable: true },
  E_M_REPLAY_REJECTED: { messageKey: 'sync.error.replayRejected', retryable: false },
  E_M_PAYLOAD_TOO_LARGE: { messageKey: 'sync.error.payloadTooLarge', retryable: true },
  E_M_SYNC_LOG_EXPIRED: { messageKey: 'sync.error.syncLogExpired', retryable: true },
  E_M_ACK_INVALID: { messageKey: 'sync.error.ackInvalid', retryable: true },
  E_M_CONFLICT_NOT_FOUND: { messageKey: 'sync.error.conflictNotFound', retryable: false },
  E_M_CONFLICT_CLOSED: { messageKey: 'sync.error.conflictClosed', retryable: false },
  E_M_DEVICE_NOT_FOUND: { messageKey: 'sync.error.deviceNotFound', retryable: false },
  E_M_PERMISSION_DENIED: { messageKey: 'sync.error.permissionDenied', retryable: false },
  E_M_WEB_AUTH_REQUIRED: { messageKey: 'sync.error.webAuthRequired', retryable: false }
}

export function syncMessageKeyOf(code: SyncErrorCode): string {
  return SYNC_ERROR_META[code].messageKey
}

export function syncRetryableOf(code: SyncErrorCode): boolean {
  return SYNC_ERROR_META[code].retryable
}

export function isSyncErrorCode(value: unknown): value is SyncErrorCode {
  return typeof value === 'string' && (SYNC_ERROR_CODES as readonly string[]).includes(value)
}
export interface SyncFailure {
  readonly code: SyncErrorCode
  readonly messageKey: string
  readonly retryable: boolean
}

export type SyncResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: SyncFailure }

export function syncFail<C extends SyncErrorCode>(code: C): SyncResult<never> {
  return {
    ok: false,
    error: { code, messageKey: SYNC_ERROR_META[code].messageKey, retryable: SYNC_ERROR_META[code].retryable }
  }
}

export function syncOk<T>(data: T): SyncResult<T> {
  return { ok: true, data }
}