import { describe, expect, it } from 'vitest'
import { middleEllipsis, sanitizeFileName, extensionOf } from '@shared/import/text'

describe('文件名清洗与省略', () => {
  it('取 basename 并去控制符/非法字符', () => {
    expect(sanitizeFileName('C:\\a\\排班表.txt')).toBe('排班表.txt')
    const cleaned = sanitizeFileName('a|b⟧c.txt')
    expect(cleaned.includes('|')).toBe(false)
    expect(cleaned.includes('⟧')).toBe(false)
    expect(sanitizeFileName('')).toBe('未命名文件')
  })

  it('超长文件名保留扩展名并限长 60', () => {
    const long = `${'a'.repeat(200)}.txt`
    const cleaned = sanitizeFileName(long)
    expect(cleaned.length <= 60).toBe(true)
    expect(cleaned.endsWith('.txt')).toBe(true)
  })

  it('中间省略保留扩展名', () => {
    const result = middleEllipsis('排班表-2026年度最终版本-第一版-修订.txt', 20)
    expect(result.length <= 20).toBe(true)
    expect(result.includes('…')).toBe(true)
    expect(result.endsWith('.txt')).toBe(true)
    expect(middleEllipsis('短.txt', 32)).toBe('短.txt')
  })

  it('中文、空格、括号往返稳定', () => {
    const name = '排班 表(终版).txt'
    expect(sanitizeFileName(name)).toBe(name)
    expect(extensionOf(name)).toBe('txt')
  })
})