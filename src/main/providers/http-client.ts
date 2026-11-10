import type { FailureCategory } from '@shared/result'

export interface HttpResult {
  readonly ok: boolean
  readonly status: number
  readonly body?: unknown
  readonly text?: string
  readonly failureCategory?: FailureCategory
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

export function classifyError(error: unknown): FailureCategory {
  if (error instanceof Error && error.name === 'AbortError') return 'timeout'
  if (error instanceof TypeError) return 'network'
  const message = error instanceof Error ? error.message : String(error)
  if (/(ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|network)/i.test(message)) return 'network'
  if (/(aborted|timeout|timed out)/i.test(message)) return 'timeout'
  return 'serviceError'
}

async function withTimeout<T>(
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; failureCategory: FailureCategory }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const value = await work(controller.signal)
    return { ok: true, value }
  } catch (error) {
    return { ok: false, failureCategory: classifyError(error) }
  } finally {
    clearTimeout(timer)
  }
}

export async function httpsJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<HttpResult> {
  if (!url.startsWith('https://')) {
    return { ok: false, status: 0, failureCategory: 'serviceError' }
  }
  const outcome = await withTimeout(timeoutMs, async (signal) => {
    const response = await fetch(url, { ...init, signal })
    const text = await response.text()
    return { response, text }
  })
  if (!outcome.ok) {
    return { ok: false, status: 0, failureCategory: outcome.failureCategory }
  }
  const { response, text } = outcome.value
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      failureCategory: classifyStatus(response.status, text),
      text
    }
  }
  try {
    return { ok: true, status: response.status, body: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, status: response.status, failureCategory: 'unparsable', text }
  }
}

export async function httpsMultipart(
  url: string,
  form: FormData,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<HttpResult> {
  return httpsJson(
    url,
    {
      method: 'POST',
      headers,
      body: form
    },
    timeoutMs
  )
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}