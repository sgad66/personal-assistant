import type { FailureCategory, FailureMeta } from '@shared/result'
import { fail, type Result } from '@shared/result'
import { ERROR_META } from '@shared/error-catalog'

const CATEGORY_CODE = {
  timeout: 'E_AI_TIMEOUT',
  rateLimited: 'E_AI_RATE_LIMITED',
  unparsable: 'E_AI_UNAVAILABLE',
  serviceError: 'E_AI_UNAVAILABLE',
  network: 'E_AI_NETWORK_FAILED',
  unauthorized: 'E_AI_AUTH_FAILED',
  modelUnavailable: 'E_AI_MODEL_UNSUPPORTED'
} as const

export function failFromCategory(category: FailureCategory, meta?: FailureMeta): Result<never> {
  const code = CATEGORY_CODE[category]
  const errorMeta = ERROR_META[code]
  return fail(code, errorMeta.messageKey, errorMeta.retryable, {
    failureCategory: category,
    ...(meta ? { failureMeta: meta } : {})
  })
}

export function notConfiguredFailure(): Result<never> {
  const meta = ERROR_META.E_AI_PROVIDER_NOT_CONFIGURED
  return fail('E_AI_PROVIDER_NOT_CONFIGURED', meta.messageKey, meta.retryable)
}