export type DecodeResult =
  | { readonly ok: true; readonly text: string; readonly encoding: 'utf-8' | 'gb18030' }
  | { readonly ok: false; readonly reason: 'decode_failed' | 'binary' }

function looksBinary(text: string): boolean {
  if (text.includes('\u0000')) return true
  const replacement = (text.match(/\uFFFD/g) ?? []).length
  return replacement / Math.max(1, text.length) > 0.05
}

export function decodeTextBytes(bytes: Uint8Array): DecodeResult {
  let input = bytes
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    input = bytes.subarray(3)
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input)
    if (looksBinary(text)) return { ok: false, reason: 'binary' }
    return { ok: true, text, encoding: 'utf-8' }
  } catch {
    try {
      const text = new TextDecoder('gb18030', { fatal: false }).decode(input)
      if (looksBinary(text)) return { ok: false, reason: 'binary' }
      return { ok: true, text, encoding: 'gb18030' }
    } catch {
      return { ok: false, reason: 'decode_failed' }
    }
  }
}