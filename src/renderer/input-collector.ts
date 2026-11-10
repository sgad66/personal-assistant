import type { InputPart, SubmitEnvelope } from '@shared/ipc-contracts'
import type { InputModality } from '@shared/domain/types'
import { LIMITS } from '@shared/schemas'

export interface ValidateResult {
  readonly ok: boolean
  readonly errorCode?: 'E_INPUT_TOO_LARGE' | 'E_VALIDATION_FAILED'
  readonly message?: string
}

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export function validateText(text: string): ValidateResult {
  if (text.length > LIMITS.textChars) {
    return { ok: false, errorCode: 'E_INPUT_TOO_LARGE', message: '文字最多 500 个字符' }
  }
  return { ok: true }
}

export function validateVoice(durationMs: number): ValidateResult {
  if (durationMs > LIMITS.voiceMs) {
    return { ok: false, errorCode: 'E_INPUT_TOO_LARGE', message: '语音最长 60 秒' }
  }
  return { ok: true }
}

export function validateImage(byteSize: number, mimeType: string): ValidateResult {
  if (!IMAGE_MIME_TYPES.includes(mimeType as (typeof IMAGE_MIME_TYPES)[number])) {
    return { ok: false, errorCode: 'E_VALIDATION_FAILED', message: '仅支持 PNG / JPEG / WebP 图片' }
  }
  if (byteSize > LIMITS.imageBytes) {
    return { ok: false, errorCode: 'E_INPUT_TOO_LARGE', message: '图片最大 10 MB' }
  }
  return { ok: true }
}

export function resolveModality(parts: readonly InputPart[]): InputModality {
  const kinds = new Set(parts.map((part) => part.kind))
  if (kinds.size >= 2) return 'composite'
  const only = kinds.values().next().value
  if (only === 'text' || only === 'voice' || only === 'image') return only
  return 'text'
}

export function buildEnvelope(parts: readonly InputPart[], clientMessageId?: string): SubmitEnvelope {
  return {
    clientMessageId: clientMessageId ?? crypto.randomUUID(),
    modality: resolveModality(parts),
    parts
  }
}

export function composeDescription(parts: readonly InputPart[]): string {
  return parts
    .map((part) => (part.kind === 'text' ? part.text : part.kind === 'voice' ? '[语音]' : '[图片]'))
    .join(' ')
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}