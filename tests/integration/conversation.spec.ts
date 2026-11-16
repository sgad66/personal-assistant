import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ok, type Result } from '@shared/result'
import type { ParseRequest, ParseResult } from '@main/providers/types'
import type { ResolvedAccess, ResolvedChannel } from '@main/ai/provider-resolver'
import { localParse } from '@main/providers/local-parser'
import { at, createHarness } from '../helpers/harness'

const MEDIA_DIR = mkdtempSync(join(tmpdir(), 'pa-media-fixtures-'))
let mediaSeq = 0

function imagePart() {
  mediaSeq += 1
  const tempFilePath = join(MEDIA_DIR, `shot-${mediaSeq}.png`)
  writeFileSync(tempFilePath, Buffer.from('fake-image-bytes'))
  return {
    kind: 'image' as const,
    tempFilePath,
    byteSize: 1024,
    mimeType: 'image/png' as const
  }
}

function voicePart() {
  mediaSeq += 1
  const tempFilePath = join(MEDIA_DIR, `voice-${mediaSeq}.webm`)
  writeFileSync(tempFilePath, Buffer.from('fake-audio-bytes'))
  return {
    kind: 'voice' as const,
    tempFilePath,
    durationMs: 3000
  }
}

function textProvider() {
  return {
    parse: async (request: ParseRequest): Promise<Result<ParseResult>> =>
      ok(localParse(request.description, request.referenceTime))
  }
}

function baseAccess(overrides: Partial<ResolvedAccess> = {}): ResolvedAccess {
  return {
    revision: 1,
    status: 'custom',
    text: {
      kind: 'ready',
      presetId: 'custom',
      presetName: '自定义',
      endpoint: 'https://local.invalid',
      model: 'local',
      provider: textProvider()
    },
    vision: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED', presetId: 'groq' },
    asr: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED', presetId: 'groq' },
    ...overrides
  }
}


describe('能力缺口与通道来源（D6.2/D6.3）', () => {
  it('图片绑定 DeepSeek 时直接拒绝，不调用识图、不写日程', async () => {
    let visionCalls = 0
    const visionProvider = {
      extract: async () => {
        visionCalls += 1
        return ok({ text: '明天下午三点开会' })
      }
    }
    const access = baseAccess({
      vision: {
        kind: 'unsupported',
        code: 'E_OCR_UNSUPPORTED',
        presetId: 'deepseek',
        presetName: 'DeepSeek（官方 API）',
        provider: visionProvider
      } as unknown as ResolvedChannel
    })
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submitParts([imagePart()], 'image')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.errorCode).toBe('E_OCR_UNSUPPORTED')
    expect(visionCalls).toBe(0)
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('文字加图片且视觉缺口时整体拒绝，不按纯文字创建', async () => {
    const access = baseAccess({
      vision: {
        kind: 'unsupported',
        code: 'E_OCR_UNSUPPORTED',
        presetId: 'deepseek',
        presetName: 'DeepSeek（官方 API）'
      }
    })
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submitParts(
      [{ kind: 'text', text: '明天下午三点开会' }, imagePart()],
      'composite'
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.errorCode).toBe('E_OCR_UNSUPPORTED')
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('语音绑定 DeepSeek 时拒绝转写且不写日程', async () => {
    let asrCalls = 0
    const asrProvider = {
      transcribe: async () => {
        asrCalls += 1
        return ok({ text: '明天下午三点开会' })
      }
    }
    const access = baseAccess({
      asr: {
        kind: 'unsupported',
        code: 'E_ASR_UNSUPPORTED',
        presetId: 'deepseek',
        presetName: 'DeepSeek（官方 API）',
        provider: asrProvider
      } as unknown as ResolvedChannel
    })
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submitParts([voicePart()], 'voice')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.errorCode).toBe('E_ASR_UNSUPPORTED')
    expect(asrCalls).toBe(0)
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('默认方案图片成功时来源标注为 DeepSeek 文字与 Groq 图片', async () => {
    const access = baseAccess({
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
        provider: { extract: async () => ok({ text: '' }) }
      }
    })
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submitParts(
      [{ kind: 'text', text: '明天下午三点开会' }, imagePart()],
      'composite'
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const trace = result.data.sourceTrace
    expect(trace).toHaveLength(2)
    const visionTrace = trace?.find((item) => item.channel === 'vision')
    const textTrace = trace?.find((item) => item.channel === 'text')
    expect(visionTrace?.actualPresetId).toBe('groq')
    expect(textTrace?.actualPresetId).toBe('deepseek')
    expect(result.data.assistantMessage.content.includes('图片识别：Groq')).toBe(false)
    expect(result.data.assistantMessage.content.includes('文字理解：DeepSeek')).toBe(false)
    expect(result.data.assistantMessage.sourceLabel).toBe('文字理解：DeepSeek；图片识别：Groq')
    expect(harness.store.snapshot().events).toHaveLength(1)
  })

  it('纯文字且来源等于绑定时不追加来源行', async () => {
    const access = baseAccess({
      text: {
        kind: 'ready',
        presetId: 'deepseek',
        presetName: 'DeepSeek（官方 API）',
        endpoint: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        provider: textProvider()
      }
    })
    const harness = createHarness(at(2026, 11, 9, 10, 0), { access })
    const result = await harness.submit('明天下午三点开会')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.sourceTrace).toHaveLength(1)
    expect(result.data.assistantMessage.content.includes('文字理解：')).toBe(false)
    expect(harness.store.snapshot().events).toHaveLength(1)
  })
})

describe('会话解析主链路（T1~T5、T22、T23）', () => {
  it('T1 文字录入后写入日程并回显', async () => {
    const harness = createHarness(at(2026, 11, 5, 20, 0))
    const result = await harness.submit('明天下午三点开会')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('idle')
    expect(result.data.createdEventId).toBeDefined()
    expect(result.data.assistantMessage.content).toContain('已安排：开会')
    expect(result.data.assistantMessage.content).toContain('15:00-16:00')

    const events = harness.store.snapshot().events
    expect(events).toHaveLength(1)
    expect(events[0]?.startAt).toBe(at(2026, 11, 6, 15, 0))
    expect(events[0]?.endAt).toBe(at(2026, 11, 6, 16, 0))
    expect(harness.store.snapshot().reminders).toHaveLength(1)
    expect(harness.store.snapshot().reminders[0]?.plannedAt).toBe(at(2026, 11, 6, 14, 50))
  })

  it('T2 下周三上午写入下一自然周周三 09:00', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('下周三上午碰一下方案')
    expect(result.ok).toBe(true)
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(1)
    expect(events[0]?.startAt).toBe(at(2026, 11, 18, 9, 0))
  })

  it('T3 缺少开始时间只追问、不写入', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('帮我记一下要买牛奶')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('clarifying')
    expect(result.data.errorCode).toBe('E_MISSING_START_TIME')
    expect(harness.store.snapshot().events).toHaveLength(0)
    expect(result.data.assistantMessage.content).toContain('几点')
  })

  it('T4 一次性追问全部缺失信息', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('下周一有个会')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('clarifying')
    expect(result.data.assistantMessage.content).toContain('几点开始')
    expect(result.data.assistantMessage.content).toContain('多长时间')
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('T5 结束早于开始返回不一致错误且不写入', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('明天 15:00 到 14:00 开会')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.errorCode).toBe('E_TIME_INCONSISTENT')
    expect(result.data.assistantMessage.content).toContain('结束时间需晚于开始时间')
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('T22 闲聊只回复、不创建日程', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const result = await harness.submit('你好')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('idle')
    expect(result.data.assistantMessage.content.length).toBeGreaterThan(0)
    expect(harness.store.snapshot().events).toHaveLength(0)
  })

  it('T23 会话内修正最近事项时间', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const created = await harness.submit('明天下午三点开会')
    expect(created.ok).toBe(true)
    const result = await harness.submit('改到下午四点')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.state).toBe('idle')
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(1)
    expect(events[0]?.startAt).toBe(at(2026, 11, 9, 16, 0))
    expect(result.data.assistantMessage.content).toContain('已修改')
  })

  it('追问后补充信息可继续完成写入', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const first = await harness.submit('下周一有个会')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.data.state).toBe('clarifying')

    const resolved = await harness.conversation.resolve({ kind: 'supplement', text: '下午三点，大概一小时' })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.data.state).toBe('idle')
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(1)
    expect(events[0]?.startAt).toBe(at(2026, 11, 16, 15, 0))
    expect(events[0]?.endAt).toBe(at(2026, 11, 16, 16, 0))
  })
})

describe('冲突与重复（T6、T8）', () => {
  it('T6 冲突后放弃不产生任何数据', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const first = await harness.submit('明天下午三点开会')
    expect(first.ok).toBe(true)

    const second = await harness.submit('明天下午三点半开会')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.state).toBe('conflict')
    expect(second.data.conflicts?.length).toBeGreaterThan(0)
    expect(harness.store.snapshot().events).toHaveLength(1)

    const abandoned = await harness.conversation.resolve({
      kind: 'conflict_decision',
      choice: 'abandon'
    })
    expect(abandoned.ok).toBe(true)
    if (!abandoned.ok) return
    expect(abandoned.data.state).toBe('idle')
    expect(harness.store.snapshot().events).toHaveLength(1)
    expect(harness.store.snapshot().reminders).toHaveLength(1)
  })

  it('冲突时仍然创建会写入并标记冲突', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    await harness.submit('明天下午三点开会')
    const second = await harness.submit('明天下午三点半开会')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const created = await harness.conversation.resolve({
      kind: 'conflict_decision',
      choice: 'create_anyway'
    })
    expect(created.ok).toBe(true)
    const events = harness.store.snapshot().events
    expect(events).toHaveLength(2)
    expect(events.every((event) => event.hasConflict)).toBe(true)
  })

  it('T8 24 小时内重复提交被抑制', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const first = await harness.submit('明天上午9点晨会')
    expect(first.ok).toBe(true)
    const second = await harness.submit('明天上午9点晨会')
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.data.state).toBe('duplicate')
    expect(second.data.errorCode).toBe('E_DUPLICATE_EVENT')
    expect(harness.store.snapshot().events).toHaveLength(1)
  })
})