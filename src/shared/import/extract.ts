import type { ImportTextFormat } from './limits'

export interface ExtractResult {
  readonly text: string
  readonly notes: readonly string[]
}

const MAX_JSON_DEPTH = 6
const MAX_JSON_ITEMS = 300

export function extractText(format: ImportTextFormat, raw: string): ExtractResult {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '')
  if (format === 'md') {
    const text = normalized
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
    return { text, notes: [] }
  }
  if (format === 'csv') {
    return { text: normalized, notes: [] }
  }
  if (format === 'ics') {
    return extractIcs(normalized)
  }
  if (format === 'json') {
    return extractJson(normalized)
  }
  return { text: normalized, notes: [] }
}

function extractIcs(normalized: string): ExtractResult {
  const notes = new Set<string>()
  const events: string[] = []
  let current: { start?: string; end?: string; summary?: string; location?: string; description?: string } = {}
  let inEvent = false

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trim()
    if (/^BEGIN:VEVENT$/i.test(line)) {
      current = {}
      inEvent = true
      continue
    }
    if (/^END:VEVENT$/i.test(line)) {
      if (inEvent) events.push(formatIcsEvent(current))
      current = {}
      inEvent = false
      continue
    }
    if (/^RRULE/i.test(line)) {
      notes.add('ics_rrule_ignored')
      continue
    }
    if (!inEvent) continue
    const match = /^(SUMMARY|DTSTART|DTEND|LOCATION|DESCRIPTION)[^:]*:(.*)$/i.exec(line)
    if (!match) continue
    const key = (match[1] ?? '').toUpperCase()
    const value = (match[2] ?? '').trim()
    if (key === 'SUMMARY') current.summary = value
    else if (key === 'DTSTART') current.start = value
    else if (key === 'DTEND') current.end = value
    else if (key === 'LOCATION') current.location = value
    else if (key === 'DESCRIPTION') current.description = value
  }

  return { text: events.filter((line) => line.length > 0).join('\n'), notes: [...notes] }
}

function formatIcsEvent(event: {
  start?: string
  end?: string
  summary?: string
  location?: string
  description?: string
}): string {
  const start = parseIcsDate(event.start)
  const end = parseIcsDate(event.end)
  const parts = [
    start.dateText,
    start.timeText,
    end.timeText && end.dateText === start.dateText ? `– ${end.timeText}` : end.timeText,
    event.summary,
    event.location,
    event.description
  ].filter((part): part is string => typeof part === 'string' && part.length > 0)
  return parts.join(' ').trim()
}

function parseIcsDate(value: string | undefined): { dateText: string; timeText: string; utc: boolean } {
  if (!value) return { dateText: '', timeText: '', utc: false }
  const compact = value.replace(/[^0-9TZ]/gi, '').toUpperCase()
  const dateMatch = /^(\d{4})(\d{2})(\d{2})/.exec(compact)
  if (!dateMatch) return { dateText: '', timeText: '', utc: false }
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const timeMatch = /T(\d{2})(\d{2})/.exec(compact)
  const utc = compact.endsWith('Z')
  const dateText = `${month}月${day}日`
  const timeText = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}${utc ? ' (UTC)' : ''}` : utc ? '(UTC)' : ''
  return { dateText, timeText, utc }
}

function extractJson(normalized: string): ExtractResult {
  const notes = new Set<string>()
  const items: string[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    return { text: normalized, notes: ['json_parse_failed'] }
  }
  flattenJson(parsed, 0, '', items, notes)
  return { text: items.join('\n'), notes: [...notes] }
}

function flattenJson(
  value: unknown,
  depth: number,
  prefix: string,
  out: string[],
  notes: Set<string>
): void {
  if (out.length >= MAX_JSON_ITEMS) {
    notes.add('json_count_limited')
    return
  }
  if (depth > MAX_JSON_DEPTH) {
    notes.add('json_depth_limited')
    return
  }
  if (typeof value === 'string') {
    out.push(prefix.length > 0 ? `${prefix}: ${value}` : value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (out.length >= MAX_JSON_ITEMS) {
        notes.add('json_count_limited')
        return
      }
      flattenJson(item, depth + 1, prefix, out, notes)
    }
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (out.length >= MAX_JSON_ITEMS) {
        notes.add('json_count_limited')
        return
      }
      flattenJson(item, depth + 1, prefix.length > 0 ? `${prefix}.${key}` : key, out, notes)
    }
  }
}