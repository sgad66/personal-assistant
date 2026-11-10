import { describe, expect, it } from 'vitest'
import { buildEnvelope, resolveModality, validateImage, validateText, validateVoice } from '@renderer/input-collector'

describe('多模态输入边界（T19）', () => {
  it('500 字符可提交，501 字符被拦截', () => {
    expect(validateText('a'.repeat(500)).ok).toBe(true)
    const over = validateText('a'.repeat(501))
    expect(over.ok).toBe(false)
    expect(over.errorCode).toBe('E_INPUT_TOO_LARGE')
  })

  it('60 秒可提交，61 秒被拦截', () => {
    expect(validateVoice(60_000).ok).toBe(true)
    const over = validateVoice(61_000)
    expect(over.ok).toBe(false)
    expect(over.errorCode).toBe('E_INPUT_TOO_LARGE')
  })

  it('10 MB 可提交，10.1 MB 被拦截', () => {
    expect(validateImage(10 * 1024 * 1024, 'image/png').ok).toBe(true)
    const over = validateImage(Math.ceil(10.1 * 1024 * 1024), 'image/png')
    expect(over.ok).toBe(false)
    expect(over.errorCode).toBe('E_INPUT_TOO_LARGE')
  })

  it('不支持的图片格式被拦截', () => {
    const result = validateImage(1024, 'image/gif')
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('E_VALIDATION_FAILED')
  })
})

describe('模态判定', () => {
  it('单一模态取对应值', () => {
    expect(resolveModality([{ kind: 'text', text: 'hi' }])).toBe('text')
    expect(
      resolveModality([{ kind: 'voice', tempFilePath: '/tmp/a.webm', durationMs: 1000 }])
    ).toBe('voice')
    expect(
      resolveModality([
        { kind: 'image', tempFilePath: '/tmp/a.png', byteSize: 1000, mimeType: 'image/png' }
      ])
    ).toBe('image')
  })

  it('两种及以上取 composite', () => {
    const parts = [
      { kind: 'text' as const, text: '补充' },
      { kind: 'voice' as const, tempFilePath: '/tmp/a.webm', durationMs: 1000 }
    ]
    expect(resolveModality(parts)).toBe('composite')
    const envelope = buildEnvelope(parts, 'fixed-id-123')
    expect(envelope.modality).toBe('composite')
    expect(envelope.clientMessageId).toBe('fixed-id-123')
  })

  it('组合输入载荷至少包含两种 kind', () => {
    const envelope = buildEnvelope(
      [
        { kind: 'text', text: '明天下午三点开会' },
        { kind: 'image', tempFilePath: '/tmp/a.png', byteSize: 2048, mimeType: 'image/png' }
      ],
      'combo-1'
    )
    expect(new Set(envelope.parts.map((part) => part.kind)).size).toBeGreaterThanOrEqual(2)
    expect(envelope.modality).toBe('composite')
  })
})