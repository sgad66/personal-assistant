import type { AppErrorCode } from './error-catalog'

export type FailureCategory =
  | 'timeout'
  | 'rateLimited'
  | 'unparsable'
  | 'serviceError'
  | 'network'
  | 'unauthorized'
  | 'modelUnavailable'

export interface AppError<C extends AppErrorCode = AppErrorCode> {
  readonly code: C
  readonly messageKey: string
  readonly retryable: boolean
  readonly failureCategory?: FailureCategory
  readonly details?: Readonly<Record<string, string | number>>
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
  }
): Result<never, C> {
  const error: AppError<C> = {
    code,
    messageKey,
    retryable,
    ...(extra?.failureCategory ? { failureCategory: extra.failureCategory } : {}),
    ...(extra?.details ? { details: extra.details } : {})
  }
  return { ok: false, error }
}

export function isOk<T>(result: Result<T>): result is { readonly ok: true; readonly data: T } {
  return result.ok
}