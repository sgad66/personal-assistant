import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fail, ok, type Result } from '@shared/result'
import { messageKeyOf } from '@shared/error-catalog'
import type { ResolvedAccess } from '@main/ai/provider-resolver'
import type {
  ITextUnderstandingProvider,
  ParseRequest,
  ParseResult
} from '@main/providers/types'
import { localParse } from '@main/providers/local-parser'
import { at, createHarness } from '../helpers/harness'

const MEDIA_DIR = mkdtempSync(join(tmpdir(), 'pa-timeout-media-'))
let mediaSeq = 0

function imagePart() {
  mediaSeq += 1
  const tempFilePath = join(MEDIA_DIR, `shot-${mediaSeq}.png`)
  writeFileSync(tempFilePath, Buffer.from('fake-image'))
  return {
    kind: 'image' as const,
    tempFilePath,
    byteSize: 1024,
    mimeType: 'image/png' as const
  }
}

function textProvider(): ITextUnderstandingProvider {
  return {
    parse: async (request: ParseRequest): Promise<Result<ParseResult>> =>
      ok(localParse(request.description, request.referenceTime))
  }
}

function timeoutFailure(stage: 'connect_first_byte' | 'body_transfer' = 'connect_first_byte') {
  return fail('E_AI_TIMEOUT', messageKeyOf('E_AI_TIMEOUT'), true, {
    failureCategory: 'timeout',
    failureMeta: { stage, receivedFirstByte: stage === 'body_transfer', elapsedMs: 10 }
  })
}

function unauthorizedFailure() {
  return fail('E_AI_AUTH_FAILED', messageKeyOf('E_AI_AUTH_FAILED'), false, {
    failureCategory: 'unauthorized',
    failureMeta: { stage: 'result_parse', receivedFirstByte: true, elapsedMs: 10 }
  })
}

function accessWith(extract: () => Promise<Result<never>>): ResolvedAccess {
  return {
    revision: 1,
    status: 'deepseek_solution',
    timeouts: { relaxed: false },
    text: {
      kind: 'ready',
      presetId: 'deepseek',
      presetName: 'DeepSeek（官方 API）',
      endpoint: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      provider: textProvider()
    },
    vision: {
      kind: 'ready',
      presetId: 'groq',
      presetName: 'Groq（免费推荐）',
      endpoint: 'https://api.groq.com/openai/v1',
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      provider: { extract }
    },
    asr: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED', presetId: 'groq' }
  }
}

describe('会话超时、重试与来源（D3.4~D3.6）', () => {
  it('图片首包超时自动重试一次后失败，来源不误归因 DeepSeek', async () => {
    let calls = 0
    const access = accessWith(async () => {
      calls += 1
      return timeoutFailure()
    })
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submitParts([imagePart()], 'image')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toBe(2)
    expect(result.data.state).toBe('failed')
    expect(result.data.errorCode).toBe('E_AI_TIMEOUT')
    expect(result.data.retryState).toBe('auto_retry_failed')
    expect(result.data.failure?.sourceLabel).toBe('来源：图片识别 Groq')
    expect(result.data.failure?.text.includes('图片识别')).toBe(true)
    expect(result.data.failure?.text.includes('Groq')).toBe(true)
    expect(result.data.failure?.text.includes('DeepSeek')).toBe(false)
    expect(result.data.retry?.kind).toBe('media')
    expect(result.data.retry?.mediaKind).toBe('image')
    expect(result.data.retry?.available).toBe(true)
    expect(result.data.assistantMessage.sourceLabel).toBe('来源：图片识别 Groq')
    expect(result.data.assistantMessage.status).toBe('failed')
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('鉴权失败不自动重试', async () => {
    let calls = 0
    const access = accessWith(async () => {
      calls += 1
      return unauthorizedFailure()
    })
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submitParts([imagePart()], 'image')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toBe(1)
    expect(result.data.errorCode).toBe('E_AI_AUTH_FAILED')
    expect(result.data.retryState).toBe('idle')
  })

  it('整体超时（响应体阶段）不重试', async () => {
    let calls = 0
    const access = accessWith(async () => {
      calls += 1
      return timeoutFailure('body_transfer')
    })
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submitParts([imagePart()], 'image')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toBe(1)
    expect(result.data.failure?.messageKey).toBe('ai.fail.overallTimeout.vision')
  })

  it('请求期间配置 revision 变化时不重试', async () => {
    let calls = 0
    let revision = 1
    const access = accessWith(async () => {
      calls += 1
      revision = 2
      return timeoutFailure()
    })
    const harness = createHarness(at(2026, 11, 9, 10, 0), {
      accessProvider: () => ({ ...access, revision })
    })
    const result = await harness.submitParts([imagePart()], 'image')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toBe(1)
    expect(result.data.retryState).toBe('idle')
  })

  it('视觉绑定 DeepSeek 时零请求且不提供直接重试', async () => {
    let calls = 0
    const access: ResolvedAccess = {
      ...accessWith(async () => {
        calls += 1
        return timeoutFailure()
      }),
      vision: {
        kind: 'unsupported',
        code: 'E_OCR_UNSUPPORTED',
        presetId: 'deepseek',
        presetName: 'DeepSeek（官方 API）'
      }
    }
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submitParts([imagePart()], 'image')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toBe(0)
    expect(result.data.errorCode).toBe('E_OCR_UNSUPPORTED')
    expect(result.data.failure?.actions.includes('retry')).toBe(false)
    expect(result.data.failure?.actions.includes('switch_preset')).toBe(true)
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('组合输入媒体失败不创建日程并提示仅按文字继续', async () => {
    const access = accessWith(async () => timeoutFailure())
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submitParts(
      [{ kind: 'text', text: '明天下午三点开会' }, imagePart()],
      'composite'
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.failure?.text.includes('本次未创建日程')).toBe(true)
    expect(result.data.failure?.actions.includes('use_text')).toBe(true)
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('纯文字失败的重试类型为文字', async () => {
    const access: ResolvedAccess = {
      ...accessWith(async () => timeoutFailure()),
      text: {
        kind: 'ready',
        presetId: 'deepseek',
        presetName: 'DeepSeek（官方 API）',
        endpoint: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        provider: { parse: async () => timeoutFailure() }
      }
    }
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submit('明天下午三点开会')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.retry?.kind).toBe('text')
    expect(result.data.retry?.available).toBe(true)
    expect(result.data.failure?.sourceLabel).toBe('来源：文字理解 DeepSeek')
    expect(harness.store.snapshot().events).toHaveLength(0)
  })
})