import { describe, expect, it } from 'vitest'
import {
  encodeImportHeader,
  importTextBudget,
  stripImportHeader,
  type ImportHeaderMeta
} from '@shared/import/header'

function meta(overrides: Partial<ImportHeaderMeta> = {}): ImportHeaderMeta {
  return {
    ext: 'txt',
    bytes: 1234,
    chars: 88,
    clipped: false,
    fileName: '排班表.txt',
    ...overrides
  }
}

describe('导入头编解码', () => {
  it('往返一致', () => {
    const source = meta({ clipped: true })
    const stripped = stripImportHeader(encodeImportHeader(source))
    expect(stripped.header).toEqual(source)
    expect(stripped.body).toBe('')
  })

  it('无头文本原样返回', () => {
    const stripped = stripImportHeader('普通文本')
    expect(stripped.header).toBeUndefined()
    expect(stripped.body).toBe('普通文本')
  })

  it('特殊字符文件名被清洗且可往返', () => {
    const header = encodeImportHeader(meta({ fileName: 'a|b⟧/c.txt' }))
    expect(header.includes('name=a|')).toBe(false)
    const stripped = stripImportHeader(`${header}\n正文`)
    expect(stripped.header?.fileName.includes('|')).toBe(false)
    expect(stripped.header?.fileName.includes('⟧')).toBe(false)
    expect(stripped.body).toBe('正文')
  })

  it('超长文件名时头部不超过 140 字符', () => {
    const header = encodeImportHeader(meta({ fileName: `${'x'.repeat(200)}.txt` }))
    expect(header.length <= 140).toBe(true)
    expect(header.includes('.txt⟧')).toBe(true)
  })

  it('预算计算与总长约束', () => {
    expect(importTextBudget(100)).toBe(399)
    expect(importTextBudget(500)).toBe(120)
    const header = encodeImportHeader(meta())
    const body = 'x'.repeat(importTextBudget(header.length))
    expect(header.length + 1 + body.length <= 500).toBe(true)
  })
})