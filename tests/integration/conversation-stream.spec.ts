import { describe, expect, it } from 'vitest'
import { ok, type Result } from '@shared/result'
import type { ParseRequest, ParseResult } from '@main/providers/types'
import type { ResolvedAccess } from '@main/ai/provider-resolver'
import { localParse } from '@main/providers/local-parser'
import { at, createHarness } from '../helpers/harness'

function accessWith(
  parse: (request: ParseRequest) => Promise<Result<ParseResult>>
): ResolvedAccess {
  return {
    revision: 1,
    status: 'custom',
    text: {
      kind: 'ready',
      presetId: 'custom',
      presetName: '自定义',
      endpoint: 'https://local.invalid',
      model: 'local',
      provider: { parse }
    },
    vision: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED', presetId: 'groq' },
    asr: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED', presetId: 'groq' }
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('对话流：即时上屏、串行解析与引用', () => {
  it('解析完成前就交付用户消息，并已写入历史', async () => {
    const gate = deferred()
    const access = accessWith(async (request) => {
      await gate.promise
      return ok(localParse(request.description, request.referenceTime))
    })
    const harness = createHarness(at(2026, 11, 17, 9, 0), { access })

    const accepted: string[] = []
    const running = harness.conversation.submit(harness.envelope('明天下午三点开项目周会'), {
      onAccepted: (message) => accepted.push(message.content)
    })

    expect(accepted).toEqual(['明天下午三点开项目周会'])
    expect(harness.store.snapshot().messages).toHaveLength(1)
    expect(harness.store.snapshot().messages[0]?.role).toBe('user')

    gate.resolve()
    const result = await running
    expect(result.ok).toBe(true)
    expect(harness.store.snapshot().messages).toHaveLength(2)
  })

  it('后一条提问能看到此前全部对话作为上下文', async () => {
    const hints: Array<readonly string[] | undefined> = []
    const access = accessWith(async (request) => {
      hints.push(request.contextHints)
      return ok(localParse(request.description, request.referenceTime))
    })
    const harness = createHarness(at(2026, 11, 17, 9, 0), { access })

    await harness.submit('明天下午三点开项目周会')
    await harness.submit('那后天下午四点评审呢')

    expect(hints[0]).toBeUndefined()
    expect(hints[1]?.some((line) => line.includes('明天下午三点开项目周会'))).toBe(true)
    expect(hints[1]?.some((line) => line.startsWith('助手：'))).toBe(true)
  })

  it('引用会随用户消息与助手回答一起保存', async () => {
    const harness = createHarness(at(2026, 11, 17, 9, 0))
    const quote = { messageId: 'msg_history_1', role: 'assistant' as const, excerpt: '已安排：项目周会，11月18日 15:00-16:00' }

    const result = await harness.conversation.submit({
      ...harness.envelope('这条安排能改到后天吗'),
      quotes: [quote]
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.userMessage.quotes?.[0]).toEqual(quote)
    expect(result.data.assistantMessage.quotes?.[0]).toEqual(quote)

    const stored = harness.store.snapshot().messages
    expect(stored[0]?.quotes?.[0]?.excerpt).toBe(quote.excerpt)
    expect(stored.at(-1)?.quotes?.[0]?.excerpt).toBe(quote.excerpt)
  })

  it('连续提交时解析严格串行，不会并发污染解析状态', async () => {
    let active = 0
    let maxActive = 0
    const access = accessWith(async (request) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 8))
      active -= 1
      return ok(localParse(request.description, request.referenceTime))
    })
    const harness = createHarness(at(2026, 11, 17, 9, 0), { access })

    const first = harness.submit('明天下午三点开项目周会')
    const second = harness.submit('后天上午十点方案评审')
    const [one, two] = await Promise.all([first, second])

    expect(one.ok).toBe(true)
    expect(two.ok).toBe(true)
    expect(maxActive).toBe(1)
    expect(harness.store.snapshot().messages.filter((message) => message.role === 'user')).toHaveLength(2)
  })

  it('模型返回的引用会出现在助手回答里', async () => {
    const access = accessWith(async () =>
      ok({
        intentKind: 'chitchat',
        candidates: [],
        replyText: '你之前说的是明天下午三点开会。',
        quoteText: '明天下午三点开会',
        confidence: 0.9
      })
    )
    const harness = createHarness(at(2026, 11, 17, 9, 0), { access })

    const result = await harness.submit('我什么时候开会')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.assistantMessage.quotes?.[0]?.excerpt).toBe('明天下午三点开会')
  })
})