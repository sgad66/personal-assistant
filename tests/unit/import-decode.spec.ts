import { describe, expect, it } from 'vitest'
import { decodeTextBytes } from '@shared/import/decode'

let gb18030Available = true
try {
  new TextDecoder('gb18030')
} catch {
  gb18030Available = false
}

describe('文件字节解码', () => {
  it('UTF-8 BOM 被剥离', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x62, 0x63])
    const result = decodeTextBytes(bytes)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toBe('abc')
    expect(result.encoding).toBe('utf-8')
  })

  it('合法 UTF-8 中文', () => {
    const bytes = new TextEncoder().encode('明天下午三点开会')
    const result = decodeTextBytes(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.text).toBe('明天下午三点开会')
  })

  it('GB18030 中文回退', () => {
    if (!gb18030Available) return
    const bytes = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    const result = decodeTextBytes(bytes)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.text).toBe('中文')
      expect(result.encoding).toBe('gb18030')
    }
  })

  it('含 NUL 判定为二进制', () => {
    const result = decodeTextBytes(new Uint8Array([0x61, 0x00, 0x62]))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('binary')
  })

  it('大量替换符判定为二进制', () => {
    const bytes = new Uint8Array(Array.from({ length: 100 }, () => 0xff))
    const result = decodeTextBytes(bytes)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('binary')
  })
})