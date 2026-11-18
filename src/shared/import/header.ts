import { IMPORT_LIMITS, type ImportTextFormat } from './limits'
import { middleEllipsis, sanitizeFileName } from './text'

export interface ImportHeaderMeta {
  readonly ext: ImportTextFormat
  readonly bytes: number
  readonly chars: number
  readonly clipped: boolean
  readonly fileName: string
}

export interface StrippedText {
  readonly header?: ImportHeaderMeta
  readonly body: string
}

const HEADER_PATTERN =
  /^⟦pa-import:1\|ext=(txt|md|csv|ics|json)\|bytes=(\d+)\|chars=(\d+)\|clip=([01])\|name=([^⟧]*)⟧(?:\r?\n)?/

function buildHeader(meta: ImportHeaderMeta, name: string): string {
  return `⟦pa-import:1|ext=${meta.ext}|bytes=${Math.max(0, Math.trunc(meta.bytes))}|chars=${Math.max(
    0,
    Math.trunc(meta.chars)
  )}|clip=${meta.clipped ? 1 : 0}|name=${name}⟧`
}

export function encodeImportHeader(meta: ImportHeaderMeta): string {
  let name = sanitizeFileName(meta.fileName)
  let header = buildHeader(meta, name)
  while (header.length > IMPORT_LIMITS.headerMaxChars && name.length > 1) {
    name = middleEllipsis(name, Math.max(1, name.length - 2))
    header = buildHeader(meta, name)
  }
  return header
}

export function stripImportHeader(text: string): StrippedText {
  const match = HEADER_PATTERN.exec(text)
  if (!match) return { body: text }
  const header: ImportHeaderMeta = {
    ext: (match[1] ?? 'txt') as ImportTextFormat,
    bytes: Number(match[2] ?? 0),
    chars: Number(match[3] ?? 0),
    clipped: match[4] === '1',
    fileName: match[5] ?? ''
  }
  return { header, body: text.slice(match[0].length) }
}

export function importTextBudget(headerLength: number): number {
  return Math.max(120, IMPORT_LIMITS.textBudget - headerLength - 1)
}