import { describe, expect, it } from 'vitest'
import { coerceParseResult, interpretModelContent } from '@main/providers/llm-provider'

describe('模型回复解析', () => {
  it('接受带代码块、字符串置信度和别名意图的 JSON', () => {
    const parsed = interpretModelContent(
      '```json\n{"intentKind":"chat","candidates":[],"replyText":"你好，想安排什么？","confidence":"80"}\n```'
    )
    expect(parsed?.intentKind).toBe('chitchat')
    expect(parsed?.replyText).toBe('你好，想安排什么？')
    expect(parsed?.confidence).toBe(0.8)
  })

  it('缺少 replyText 时仍返回可展示的结构', () => {
    const parsed = coerceParseResult({
      intentKind: 'schedule',
      candidates: [{ title: '周会', startExpression: '明天下午三点' }],
      confidence: 0.9
    })
    expect(parsed?.intentKind).toBe('schedule')
    expect(parsed?.replyText).toBe('')
    expect(parsed?.candidates[0]?.title).toBe('周会')
  })

  it('没有 JSON 时不把原文当成日程', () => {
    expect(interpretModelContent('我帮你记在明天下午。')).toBeUndefined()
  })
})
