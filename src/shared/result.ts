import type { AppErrorCode } from './error-catalog'

export type FailureCategory =
  | 'timeout'
  | 'rateLimited'
  | 'unparsable'
  | 'serviceError'
  | 'network'
  | 'unauthorized'
  | 'modelUnavailable'

export type FailureStage = 'connect_first_byte' | 'body_transfer' | 'result_parse' | 'local_check'

export interface FailureMeta {
  readonly stage: FailureStage
  readonly receivedFirstByte: boolean
  readonly elapsedMs: number
  readonly status?: number
}

export interface AppError<C extends AppErrorCode = AppErrorCode> {
  readonly code: C
  readonly messageKey: string
  readonly retryable: boolean
  readonly failureCategory?: FailureCategory
  readonly details?: Readonly<Record<string, string | number>>
  readonly failureMeta?: FailureMeta
}

export type Result<T, C extends AppErrorCode = AppErrorCode> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: AppError<C> }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail<C extends AppErrorCode>(
  code: C,
  messageKey: string,
  retryable = false,
  extra?: {
    failureCategory?: FailureCategory
    details?: Readonly<Record<string, string | number>>
    failureMeta?: FailureMeta
  }
): Result<never, C> {
  const error: AppError<C> = {
    code,
    messageKey,
    retryable,
    ...(extra?.failureCategory ? { failureCategory: extra.failureCategory } : {}),
    ...(extra?.details ? { details: extra.details } : {}),
    ...(extra?.failureMeta ? { failureMeta: extra.failureMeta } : {})
  }
  return { ok: false, error }
}

export function isOk<T>(result: Result<T>): result is { readonly ok: true; readonly data: T } {
  return result.ok
}