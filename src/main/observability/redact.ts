// 日志脱敏：标题保留前 6 字符；地点/备注只保留长度；临时路径替换为 <temp>
export function redactTitle(title: string): string {
  const visible = Array.from(title).slice(0, 6).join('')
  return `${visible}***`
}

export function redactLocation(location: string | undefined): string {
  if (!location) return 'none'
  return `len:${location.length}`
}

export function redactNote(note: string | undefined): string {
  if (!note) return 'none'
  return `len:${note.length}`
}

export function redactPath(path: string | undefined): string {
  if (!path) return 'none'
  return '<temp>'
}

export function sanitizeLogPayload(
  payload: Readonly<Record<string, unknown>>
): Readonly<Record<string, string | number | boolean>> {
  const result: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'title' && typeof value === 'string') {
      result.title = redactTitle(value)
    } else if (key === 'location' && typeof value === 'string') {
      result.location = redactLocation(value)
    } else if (key === 'note' && typeof value === 'string') {
      result.note = redactNote(value)
    } else if (key === 'tempFilePath' && typeof value === 'string') {
      result.tempFilePath = redactPath(value)
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    }
  }
  return result
}