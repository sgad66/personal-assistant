import { describe, expect, it } from 'vitest'
import { submitEnvelopeSchema } from '@shared/schemas'

function validEnvelope(quotes?: unknown) {
  return {
    clientMessageId: 'client_message_1',
    modality: 'text',
    parts: [{ kind: 'text', text: '明天下午三点开会' }],
    ...(quotes === undefined ? {} : { quotes })
  }
}

describe('提交信封的引用校验', () => {
  it('接受合法的引用列表', () => {
    const parsed = submitEnvelopeSchema.safeParse(
      validEnvelope([{ messageId: 'msg_1', role: 'assistant', excerpt: '已安排：项目周会' }])
    )
    expect(parsed.success).toBe(true)
  })

  it('不带引用时保持兼容', () => {
    expect(submitEnvelopeSchema.safeParse(validEnvelope()).success).toBe(true)
  })

  it('拒绝超过 5 条引用', () => {
    const quotes = Array.from({ length: 6 }, (_item, index) => ({
      messageId: `msg_${index}`,
      role: 'user',
      excerpt: '内容'
    }))
    expect(submitEnvelopeSchema.safeParse(validEnvelope(quotes)).success).toBe(false)
  })

  it('拒绝超长的引用片段与非法角色', () => {
    expect(
      submitEnvelopeSchema.safeParse(
        validEnvelope([{ messageId: 'msg_1', role: 'user', excerpt: '示'.repeat(501) }])
      ).success
    ).toBe(false)
    expect(
      submitEnvelopeSchema.safeParse(validEnvelope([{ messageId: 'msg_1', role: 'system', excerpt: '内容' }]))
        .success
    ).toBe(false)
  })
})