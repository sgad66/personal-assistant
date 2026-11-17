import { describe, expect, it } from 'vitest'
import { hasTimeClue, selectTimeClueWindow } from '@shared/import/time-clues'

describe('时间线索与窗口', () => {
  it('命中与未命中', () => {
    expect(hasTimeClue('11月20日 9:00 开会')).toBe(true)
    expect(hasTimeClue('明天下午三点开会')).toBe(true)
    expect(hasTimeClue('甲,乙,丙\n1,2,3')).toBe(false)
  })

  it('1240 字文本裁剪到 500 内且保留命中', () => {
    const hit = '11月20日 9:00 项目周会'
    const filler = Array.from({ length: 60 }, (_unused, index) => `第${index}行：这是一段没有时间信息的说明文字。`).join('\n')
    const text = `${hit}\n${filler}`
    const window = selectTimeClueWindow(text, 500)
    expect(window.hasClue).toBe(true)
    expect(window.usedChars <= 500).toBe(true)
    expect(window.clipped).toBe(true)
    expect(window.text.includes('11月20日 9:00')).toBe(true)
  })

  it('小预算仍保留命中行', () => {
    const text = '11月20日 9:00 开会\n其他说明文字很长很长很长很长很长很长很长'
    const window = selectTimeClueWindow(text, 40)
    expect(window.usedChars <= 40).toBe(true)
    expect(window.text.includes('11月20日')).toBe(true)
  })

  it('CRLF 归一、原文按去空白计数、无命中标记', () => {
    const window = selectTimeClueWindow('a b\r\nc', 10)
    expect(window.originalChars).toBe(3)
    expect(window.hasClue).toBe(false)
    expect(window.clipped).toBe(false)
    const crlf = selectTimeClueWindow('明天下午三点开会\r\n第二行', 500)
    expect(crlf.text.includes('\r')).toBe(false)
  })
})