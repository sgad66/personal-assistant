import { describe, expect, it } from 'vitest'
import {
  classifyError,
  classifyUnsupportedModality,
  runWithTwoPhaseBudget
} from '@main/providers/http-client'

function abortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function delayedAbort(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(abortError())
    })
  })
}

describe('两阶段计时', () => {
  it('立即返回按成功结论收敛', async () => {
    const outcome = await runWithTwoPhaseBudget(
      { firstByteMs: 20, overallMs: 60 },
      async (_signal, markFirstByte) => {
        markFirstByte()
        return 'ok'
      }
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.value).toBe('ok')
      expect(outcome.elapsedMs >= 0).toBe(true)
    }
  })

  it('永不返回时判定为首包超时', async () => {
    const outcome = await runWithTwoPhaseBudget(
      { firstByteMs: 20, overallMs: 60 },
      async (signal) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()))
        })
        return 'never'
      }
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.stage).toBe('connect_first_byte')
      expect(outcome.failureCategory).toBe('timeout')
      expect(outcome.receivedFirstByte).toBe(false)
      expect(outcome.elapsedMs >= 0).toBe(true)
    }
  })

  it('首包已达但响应体延迟时判定为整体超时', async () => {
    const outcome = await runWithTwoPhaseBudget(
      { firstByteMs: 20, overallMs: 60 },
      async (signal, markFirstByte) => {
        markFirstByte()
        await delayedAbort(signal, 200)
        return 'late'
      }
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.stage).toBe('body_transfer')
      expect(outcome.receivedFirstByte).toBe(true)
      expect(outcome.failureCategory).toBe('timeout')
    }
  })

  it('成功与中止竞争只产生一种结论且只执行业务一次', async () => {
    let calls = 0
    const outcome = await runWithTwoPhaseBudget(
      { firstByteMs: 30, overallMs: 60 },
      async (_signal, markFirstByte) => {
        calls += 1
        markFirstByte()
        return calls
      }
    )
    expect(outcome.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(calls).toBe(1)
  })

  it('错误分类阶段优先、错误名辅助', () => {
    expect(classifyError(abortError(), 'connect_first_byte', false)).toBe('timeout')
    expect(classifyError(new TypeError('fetch failed'), 'connect_first_byte', false)).toBe('network')
    expect(classifyError(new TypeError('terminated'), 'body_transfer', true)).toBe('timeout')
    expect(classifyError(new Error('boom'), 'result_parse', true)).toBe('serviceError')
  })

  it('不支持模态识别只对 400/415/422 生效', () => {
    expect(classifyUnsupportedModality(400, 'does not support image', 'vision')).toBe(true)
    expect(classifyUnsupportedModality(415, 'unsupported media type', 'vision')).toBe(true)
    expect(classifyUnsupportedModality(400, 'audio not supported', 'asr')).toBe(true)
    expect(classifyUnsupportedModality(422, 'modal error', 'vision')).toBe(true)
    expect(classifyUnsupportedModality(429, 'image unsupported', 'vision')).toBe(false)
    expect(classifyUnsupportedModality(200, 'ok', 'vision')).toBe(false)
  })
})