import { describe, expect, it } from 'vitest'
import { ok, type Result } from '@shared/result'
import type { ParseRequest, ParseResult } from '@main/providers/types'
import type { ResolvedAccess } from '@main/ai/provider-resolver'
import { at, createHarness } from '../helpers/harness'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

function capturingAccess(capture: (request: ParseRequest) => void): ResolvedAccess {
  return {
    revision: 1,
    status: 'custom',
    text: {
      kind: 'ready',
      presetId: 'custom',
      actualPresetId: 'deepseek',
      presetName: 'DeepSeek',
      endpoint: 'https://example.invalid',
      model: 'deepseek-chat',
      provider: {
        parse: async (request: ParseRequest): Promise<Result<ParseResult>> => {
          capture(request)
          return ok({
            intentKind: 'chitchat',
            candidates: [],
            replyText: '收到。',
            confidence: 0.9
          })
        }
      }
    },
    vision: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' },
    asr: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' }
  }
}

describe('长上下文装配', () => {
  it('对话积累后生成滚动摘要', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    await harness.submit('你好')
    await harness.submit('今天有点忙')
    await harness.submit('晚点再安排')
    await tick()
    const summary = harness.summary.summary()
    expect(summary?.text).toBeTruthy()
    expect(summary?.messageCount).toBeGreaterThanOrEqual(6)
    expect(summary?.coversUntil).toBeTruthy()
  })

  it('装配摘要、相关记忆、目标与未来日程，并控制预算', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    await harness.submit('你好')
    await harness.submit('今天有点忙')
    await harness.submit('晚点再安排')
    await tick()
    harness.memories.add('我喜欢把会议安排在上午', 'preference', 'user')
    harness.goals.create({
      title: '论文初稿',
      instruction: '跟进写作进度',
      cadence: 'daily',
      hour: 21,
      minute: 0
    })
    harness.schedule.createEvent(
      {
        title: '项目评审',
        startAt: at(2026, 11, 10, 10, 0),
        endAt: at(2026, 11, 10, 11, 0),
        sourceModality: 'text'
      },
      { allowConflict: true }
    )
    const context = harness.context.build(undefined, '明天上午的会议')
    expect(context.summary).toBeTruthy()
    expect(context.memories.some((item) => item.content.includes('会议'))).toBe(true)
    expect(context.goals.some((goal) => goal.title === '论文初稿')).toBe(true)
    expect(context.schedule.some((item) => item.title === '项目评审')).toBe(true)
    expect(JSON.stringify(context).length).toBeLessThan(6_000)
  })

  it('对话请求会把装配后的上下文传给模型', async () => {
    let captured: ParseRequest | undefined
    const harness = createHarness(at(2026, 11, 9, 10, 0), {
      access: capturingAccess((request) => {
        captured = request
      })
    })
    harness.memories.add('我喜欢把会议安排在上午', 'preference', 'user')
    harness.goals.create({
      title: '论文进度',
      instruction: '检查写作',
      cadence: 'daily',
      hour: 21,
      minute: 0
    })
    await harness.submit('明天上午的会议怎么安排？')
    expect(captured?.conversationContext).toBeDefined()
    expect(
      captured?.conversationContext?.memories.some((item) => item.content.includes('会议'))
    ).toBe(true)
    expect(captured?.conversationContext?.goals.some((goal) => goal.title === '论文进度')).toBe(true)
  })

  it('从对话中自动学习记忆', async () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    await harness.submit('请记住：我喜欢把会议安排在上午')
    await tick()
    const list = harness.memories.list()
    expect(list.some((item) => item.content.includes('会议'))).toBe(true)
    expect(list.find((item) => item.content.includes('会议'))?.source).toBe('auto')
  })
})