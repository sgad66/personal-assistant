import { IMPORT_LIMITS } from './limits'

export function middleEllipsis(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const ext = /\.[a-z0-9]{1,8}$/i.exec(value)?.[0] ?? ''
  const suffix = ext.length > 0 && ext.length <= maxChars - 8 ? ext : ''
  const room = maxChars - 1 - suffix.length
  if (room <= 1) return value.slice(0, maxChars)
  const headLen = Math.ceil(room / 2)
  const tailLen = room - headLen
  const head = value.slice(0, headLen)
  if (tailLen <= 0) return `${head}…${suffix}`.slice(0, maxChars)
  const tailStart = value.length - suffix.length - tailLen
  const tail = value.slice(Math.max(headLen, tailStart), value.length - suffix.length)
  return `${head}…${tail}${suffix}`
}

export function sanitizeFileName(value: string): string {
  const base = String(value).split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|⟦⟧]/g, '')
  const trimmed = cleaned.trim()
  if (trimmed.length === 0) return '未命名文件'
  return trimmed.length <= IMPORT_LIMITS.fileNameMaxChars
    ? trimmed
    : middleEllipsis(trimmed, IMPORT_LIMITS.fileNameMaxChars)
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}