import type { AppErrorCode } from '../error-catalog'
import { ERROR_META } from '../error-catalog'
import type { FailureCategory } from '../result'
import type { AiChannelKind } from './preset-catalog'
import type { AiFailureClass } from './access-config'

export type UiAction =
  | 'retry'
  | 'open_settings'
  | 'switch_preset'
  | 'update_key'
  | 'change_model'
  | 'use_text'

export interface AiErrorDto {
  readonly code: AppErrorCode
  readonly messageKey: string
  readonly retryable: boolean
  readonly failureClass?: AiFailureClass
  readonly actions?: readonly UiAction[]
}

export interface FailureInput {
  readonly category?: FailureCategory
  readonly status?: number
  readonly message?: string
  readonly failureClass?: AiFailureClass
}

const CLASS_CODE: Readonly<Record<AiFailureClass, AppErrorCode>> = {
  not_configured: 'E_AI_PROVIDER_NOT_CONFIGURED',
  unauthorized: 'E_AI_AUTH_FAILED',
  rate_limited: 'E_AI_RATE_LIMITED',
  model_unavailable: 'E_AI_MODEL_UNSUPPORTED',
  network: 'E_AI_NETWORK_FAILED',
  timeout: 'E_AI_TIMEOUT',
  unparsable: 'E_AI_UNAVAILABLE',
  service_error: 'E_AI_UNAVAILABLE'
}

const CLASS_ACTIONS: Readonly<Record<AiFailureClass, readonly UiAction[]>> = {
  not_configured: ['open_settings'],
  unauthorized: ['open_settings', 'update_key'],
  rate_limited: ['retry', 'open_settings', 'switch_preset'],
  model_unavailable: ['change_model', 'switch_preset', 'open_settings'],
  network: ['retry'],
  timeout: ['retry'],
  unparsable: ['retry'],
  service_error: ['retry']
}

export function failureClassOfCategory(category?: FailureCategory): AiFailureClass {
  switch (category) {
    case 'timeout':
      return 'timeout'
    case 'rateLimited':
      return 'rate_limited'
    case 'unauthorized':
      return 'unauthorized'
    case 'network':
      return 'network'
    case 'modelUnavailable':
      return 'model_unavailable'
    case 'unparsable':
      return 'unparsable'
    default:
      return 'service_error'
  }
}

export function classifyHttpStatus(status: number, message = ''): AiFailureClass {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 402 || status === 429) return 'rate_limited'
  if (status === 400 || status === 404) {
    if (/(model|invalid_model|model_not_found|does not exist)/i.test(message)) return 'model_unavailable'
    return 'service_error'
  }
  if (status >= 500) return 'service_error'
  if (status >= 400) return 'service_error'
  return 'service_error'
}

export function mapFailure(input: FailureInput, _channel: AiChannelKind): AiErrorDto {
  let failureClass: AiFailureClass
  if (input.failureClass) {
    failureClass = input.failureClass
  } else if (input.category) {
    failureClass = failureClassOfCategory(input.category)
  } else if (typeof input.status === 'number') {
    failureClass = classifyHttpStatus(input.status, input.message ?? '')
  } else {
    failureClass = 'service_error'
  }
  const code = CLASS_CODE[failureClass]
  const meta = ERROR_META[code]
  return {
    code,
    messageKey: meta.messageKey,
    retryable: meta.retryable,
    failureClass,
    actions: CLASS_ACTIONS[failureClass]
  }
}

export function failureActionsOf(failureClass: AiFailureClass): readonly UiAction[] {
  return CLASS_ACTIONS[failureClass]
}

export function suggestionOf(count: number): readonly UiAction[] {
  if (count >= 3) return ['switch_preset']
  return []
}

export function notConfigured(_channel: AiChannelKind): AiErrorDto {
  return mapFailure({ failureClass: 'not_configured' }, _channel)
}

export function disabled(_channel: AiChannelKind): AiErrorDto {
  const meta = ERROR_META.E_AI_CHANNEL_DISABLED
  return {
    code: 'E_AI_CHANNEL_DISABLED',
    messageKey: meta.messageKey,
    retryable: false
  }
}

export function unsupported(channel: AiChannelKind): AiErrorDto {
  const code: AppErrorCode = channel === 'asr' ? 'E_ASR_UNSUPPORTED' : 'E_OCR_UNSUPPORTED'
  const meta = ERROR_META[code]
  return {
    code,
    messageKey: meta.messageKey,
    retryable: false
  }
}

export function invalidEndpoint(): AiErrorDto {
  const meta = ERROR_META.E_AI_ENDPOINT_INVALID
  return {
    code: 'E_AI_ENDPOINT_INVALID',
    messageKey: meta.messageKey,
    retryable: false
  }
}