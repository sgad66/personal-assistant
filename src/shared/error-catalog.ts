// 错误码与文案键严格分离（spec 4.4.2 / design 2.5.1）

export const ERROR_CODES = [
  'E_ENTRY_LOAD_FAIL',
  'E_INPUT_TOO_LARGE',
  'E_ASR_FAIL',
  'E_OCR_NO_TEXT',
  'E_MISSING_START_TIME',
  'E_TIME_IN_PAST',
  'E_AI_UNAVAILABLE',
  'E_TIME_INCONSISTENT',
  'E_CONFLICT_EXISTS',
  'E_DUPLICATE_EVENT',
  'E_STORE_WRITE_FAIL',
  'E_STORE_READ_FAIL',
  'E_EVENT_NOT_FOUND',
  'E_SESSION_STATE_MISMATCH',
  'E_PENDING_EXPIRED',
  'E_REMINDER_NOT_PENDING',
  'E_NOTIFICATION_DENIED',
  'E_VALIDATION_FAILED',
  'E_PRESET_CATALOG_UNAVAILABLE',
  'E_AI_ENDPOINT_INVALID',
  'E_CONFIG_WRITE_FAIL',
  'E_CONFIG_READ_FAIL',
  'E_ASR_UNSUPPORTED',
  'E_OCR_UNSUPPORTED',
  'E_AI_CHANNEL_DISABLED',
  'E_AI_PROVIDER_NOT_CONFIGURED',
  'E_AI_AUTH_FAILED',
  'E_AI_RATE_LIMITED',
  'E_AI_MODEL_UNSUPPORTED',
  'E_AI_NETWORK_FAILED',
  'E_AI_TIMEOUT'
] as const

export type AppErrorCode = (typeof ERROR_CODES)[number]

interface ErrorMeta {
  readonly messageKey: string
  readonly retryable: boolean
}

export const ERROR_META: Readonly<Record<AppErrorCode, ErrorMeta>> = {
  E_ENTRY_LOAD_FAIL: { messageKey: 'error.entryLoadFail', retryable: true },
  E_INPUT_TOO_LARGE: { messageKey: 'error.inputTooLarge', retryable: false },
  E_ASR_FAIL: { messageKey: 'error.asrFail', retryable: true },
  E_OCR_NO_TEXT: { messageKey: 'error.ocrNoText', retryable: true },
  E_MISSING_START_TIME: { messageKey: 'error.missingStartTime', retryable: false },
  E_TIME_IN_PAST: { messageKey: 'error.timeInPast', retryable: false },
  E_AI_UNAVAILABLE: { messageKey: 'error.aiUnavailable', retryable: true },
  E_TIME_INCONSISTENT: { messageKey: 'error.timeInconsistent', retryable: false },
  E_CONFLICT_EXISTS: { messageKey: 'error.conflictExists', retryable: false },
  E_DUPLICATE_EVENT: { messageKey: 'error.duplicateEvent', retryable: false },
  E_STORE_WRITE_FAIL: { messageKey: 'error.storeWriteFail', retryable: true },
  E_STORE_READ_FAIL: { messageKey: 'error.storeReadFail', retryable: true },
  E_EVENT_NOT_FOUND: { messageKey: 'error.eventNotFound', retryable: false },
  E_SESSION_STATE_MISMATCH: { messageKey: 'error.sessionStateMismatch', retryable: false },
  E_PENDING_EXPIRED: { messageKey: 'error.pendingExpired', retryable: false },
  E_REMINDER_NOT_PENDING: { messageKey: 'error.reminderNotPending', retryable: false },
  E_NOTIFICATION_DENIED: { messageKey: 'error.notificationDenied', retryable: false },
  E_VALIDATION_FAILED: { messageKey: 'error.validationFailed', retryable: false },
  E_PRESET_CATALOG_UNAVAILABLE: { messageKey: 'error.presetCatalogUnavailable', retryable: false },
  E_AI_ENDPOINT_INVALID: { messageKey: 'error.aiEndpointInvalid', retryable: false },
  E_CONFIG_WRITE_FAIL: { messageKey: 'error.configWriteFail', retryable: true },
  E_CONFIG_READ_FAIL: { messageKey: 'error.configReadFail', retryable: true },
  E_ASR_UNSUPPORTED: { messageKey: 'error.asrUnsupported', retryable: false },
  E_OCR_UNSUPPORTED: { messageKey: 'error.ocrUnsupported', retryable: false },
  E_AI_CHANNEL_DISABLED: { messageKey: 'error.aiChannelDisabled', retryable: false },
  E_AI_PROVIDER_NOT_CONFIGURED: { messageKey: 'error.aiProviderNotConfigured', retryable: false },
  E_AI_AUTH_FAILED: { messageKey: 'error.aiAuthFailed', retryable: false },
  E_AI_RATE_LIMITED: { messageKey: 'error.aiRateLimited', retryable: true },
  E_AI_MODEL_UNSUPPORTED: { messageKey: 'error.aiModelUnsupported', retryable: false },
  E_AI_NETWORK_FAILED: { messageKey: 'error.aiNetworkFailed', retryable: true },
  E_AI_TIMEOUT: { messageKey: 'error.aiTimeout', retryable: true }
}

export function messageKeyOf(code: AppErrorCode): string {
  return ERROR_META[code].messageKey
}

export function retryableOf(code: AppErrorCode): boolean {
  return ERROR_META[code].retryable
}