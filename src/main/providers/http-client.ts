import type { FailureCategory, FailureStage } from '@shared/result'
import type { AiChannelKind } from '@shared/ai/preset-catalog'

export interface HttpFailureMeta {
  readonly stage: FailureStage
  readonly receivedFirstByte: boolean
  readonly elapsedMs: number
  readonly status?: number
}

export interface HttpResult {
  readonly ok: boolean
  readonly status: number
  readonly body?: unknown
  readonly text?: string
  readonly failureCategory?: FailureCategory
  readonly failureMeta?: HttpFailureMeta
}

export interface RequestBudget {
  readonly firstByteMs: number
  readonly overallMs: number
}

export type BudgetOutcome<T> =
  | {
      readonly ok: true
      readonly stage: 'done'
      readonly receivedFirstByte: boolean
      readonly elapsedMs: number
      readonly value: T
    }
  | {
      readonly ok: false
      readonly stage: FailureStage
      readonly receivedFirstByte: boolean
      readonly elapsedMs: number
      readonly failureCategory: FailureCategory
    }

export function classifyStatus(status: number, bodyText = ''): FailureCategory {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 402 || status === 429) return 'rateLimited'
  if (
    (status === 400 || status === 404) &&
    /(model|invalid_model|model_not_found|does not exist)/i.test(bodyText)
  ) {
    return 'modelUnavailable'
  }
  return 'serviceError'
}

/**
 * 阶段优先、错误名辅助。
 * Node/undici 在响应体阶段可能抛 AbortError，也可能抛 `TypeError: terminated`，
 * 因此不能只凭 error.name 判阶段。
 */
export function classifyError(
  error: unknown,
  stage: FailureStage = 'connect_first_byte',
  receivedFirstByte = false
): FailureCategory {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (stage === 'body_transfer') {
    if (name === 'AbortError' || error instanceof TypeError) return 'timeout'
    if (/(aborted|timeout|timed out|terminated)/i.test(message)) return 'timeout'
    return 'serviceError'
  }
  if (name === 'AbortError') return 'timeout'
  if (error instanceof TypeError) return receivedFirstByte ? 'timeout' : 'network'
  if (/(ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|network)/i.test(message)) return 'network'
  if (/(aborted|timeout|timed out)/i.test(message)) return 'timeout'
  return 'serviceError'
}

export async function runWithTwoPhaseBudget<T>(
  budget: RequestBudget,
  work: (signal: AbortSignal, markFirstByte: () => void) => Promise<T>,
  clock: () => number = () => performance.now()
): Promise<BudgetOutcome<T>> {
  const started = clock()
  const controller = new AbortController()
  let stage: FailureStage = 'connect_first_byte'
  let receivedFirstByte = false
  let settled = false

  const firstByteTimer = setTimeout(() => {
    if (settled || receivedFirstByte) return
    stage = 'connect_first_byte'
    controller.abort()
  }, budget.firstByteMs)

  const overallTimer = setTimeout(() => {
    if (settled) return
    stage = receivedFirstByte ? 'body_transfer' : 'connect_first_byte'
    controller.abort()
  }, budget.overallMs)

  const markFirstByte = (): void => {
    if (receivedFirstByte) return
    receivedFirstByte = true
    clearTimeout(firstByteTimer)
  }

  try {
    const value = await work(controller.signal, markFirstByte)
    settled = true
    return {
      ok: true,
      stage: 'done',
      receivedFirstByte,
      elapsedMs: Math.max(0, clock() - started),
      value
    }
  } catch (error) {
    settled = true
    const resolvedStage = receivedFirstByte ? 'body_transfer' : stage
    return {
      ok: false,
      stage: resolvedStage,
      receivedFirstByte,
      elapsedMs: Math.max(0, clock() - started),
      failureCategory: classifyError(error, resolvedStage, receivedFirstByte)
    }
  } finally {
    clearTimeout(firstByteTimer)
    clearTimeout(overallTimer)
  }
}

export async function httpsJson(
  url: string,
  init: RequestInit,
  budget: RequestBudget
): Promise<HttpResult> {
  if (!url.startsWith('https://')) {
    return {
      ok: false,
      status: 0,
      failureCategory: 'serviceError',
      failureMeta: { stage: 'local_check', receivedFirstByte: false, elapsedMs: 0 }
    }
  }
  const outcome = await runWithTwoPhaseBudget(budget, async (signal, markFirstByte) => {
    const response = await fetch(url, { ...init, signal })
    markFirstByte()
    const text = await response.text()
    return { response, text }
  })
  if (!outcome.ok) {
    return {
      ok: false,
      status: 0,
      failureCategory: outcome.failureCategory,
      failureMeta: {
        stage: outcome.stage,
        receivedFirstByte: outcome.receivedFirstByte,
        elapsedMs: outcome.elapsedMs
      }
    }
  }
  const { response, text } = outcome.value
  const meta = {
    stage: 'result_parse' as const,
    receivedFirstByte: true,
    elapsedMs: outcome.elapsedMs,
    status: response.status
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      failureCategory: classifyStatus(response.status, text),
      text,
      failureMeta: meta
    }
  }
  try {
    return { ok: true, status: response.status, body: JSON.parse(text) as unknown, failureMeta: meta }
  } catch {
    return { ok: false, status: response.status, failureCategory: 'unparsable', text, failureMeta: meta }
  }
}

export async function httpsMultipart(
  url: string,
  form: FormData,
  headers: Record<string, string>,
  budget: RequestBudget
): Promise<HttpResult> {
  return httpsJson(
    url,
    {
      method: 'POST',
      headers,
      body: form
    },
    budget
  )
}

export function classifyUnsupportedModality(
  status: number,
  bodyText: string,
  _channel: AiChannelKind
): boolean {
  if (status !== 400 && status !== 415 && status !== 422) return false
  return /(image|vision|unsupported|not support|modal|audio|transcri)/i.test(bodyText)
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}