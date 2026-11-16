import type { InputModality, PendingIntent } from '@shared/domain/types'
import type { SubmitEnvelope } from '@shared/ipc-contracts'
import { messageKeyOf } from '@shared/error-catalog'
import { fail, ok, type FailureCategory, type Result } from '@shared/result'
import type { AppErrorCode } from '@shared/error-catalog'
import { normalizeExpression, truncateToMinute } from '@shared/time-kit'
import { localParse } from '../providers/local-parser'
import type { IImageToTextProvider, ISpeechToTextProvider, ITextUnderstandingProvider } from '../providers/types'
import type { ResolvedAccess, ResolvedChannel } from '../ai/provider-resolver'
import type { TempFileManager } from '../temp-file-manager'
import type { Logger } from '../observability/logger'

export interface ParsedCandidateResolved {
  readonly intent: PendingIntent
}

export interface ParseOutcome {
  readonly description: string
  readonly intentKind: 'schedule' | 'modify' | 'cancel' | 'chitchat' | 'unknown'
  readonly replyText: string
  readonly confidence: number
  readonly candidates: readonly PendingIntent[]
}

export interface ParseContext {
  readonly referenceTime: number
  readonly timeZone: string
  readonly contextHints?: readonly string[]
}

export class ParseOrchestrator {
  constructor(
    private readonly accessProvider: () => ResolvedAccess,
    private readonly tempFiles: TempFileManager,
    private readonly logger: Logger
  ) {}

  async parse(envelope: SubmitEnvelope, context: ParseContext): Promise<Result<ParseOutcome>> {
    const started = Date.now()
    const access = this.accessProvider()
    const stagedPaths: string[] = []
    const modalities: InputModality[] = []
    const descriptionParts: string[] = []
    let ocrText: string | undefined

    try {
      for (const part of envelope.parts) {
        if (part.kind === 'text') {
          modalities.push('text')
          descriptionParts.push(part.text.trim())
        } else if (part.kind === 'voice') {
          modalities.push('voice')
          stagedPaths.push(part.tempFilePath)
          if (part.durationMs > 60_000) {
            return fail('E_INPUT_TOO_LARGE', messageKeyOf('E_INPUT_TOO_LARGE'))
          }
          if (access.asr.kind !== 'ready') {
            return unresolvedFailure(access.asr)
          }
          const transcript = await (access.asr.provider as ISpeechToTextProvider).transcribe(
            part.tempFilePath,
            part.durationMs
          )
          if (!transcript.ok) {
            this.logger.failure('asr.failed', transcript.error.code, Date.now() - started, transcript.error.failureCategory)
            return fail(transcript.error.code, transcript.error.messageKey, transcript.error.retryable, {
              failureCategory: transcript.error.failureCategory ?? 'serviceError'
            })
          }
          descriptionParts.push(transcript.data.text.trim())
        } else {
          modalities.push('image')
          stagedPaths.push(part.tempFilePath)
          if (part.byteSize > 10 * 1024 * 1024) {
            return fail('E_INPUT_TOO_LARGE', messageKeyOf('E_INPUT_TOO_LARGE'))
          }
          if (access.vision.kind !== 'ready') {
            return unresolvedFailure(access.vision)
          }
          const ocr = await (access.vision.provider as IImageToTextProvider).extract(
            part.tempFilePath,
            part.mimeType
          )
          if (!ocr.ok) {
            this.logger.failure('ocr.failed', ocr.error.code, Date.now() - started, ocr.error.failureCategory)
            return fail(ocr.error.code, ocr.error.messageKey, ocr.error.retryable, {
              failureCategory: ocr.error.failureCategory ?? 'serviceError'
            })
          }
          ocrText = ocr.data.text
          descriptionParts.push(ocr.data.text)
        }
      }

      const description = descriptionParts.filter((part) => part.length > 0).join('\n').trim()
      if (description.length === 0) {
        return ok({
          description,
          intentKind: 'unknown',
          replyText: '没有识别到内容，请换一种方式再试一次。',
          confidence: 0.1,
          candidates: []
        })
      }

      const modality = resolveModality(modalities, envelope.modality)
      if (access.text.kind !== 'ready') {
        return unresolvedFailure(access.text)
      }
      const parsed = await (access.text.provider as ITextUnderstandingProvider).parse({
        description,
        referenceTime: context.referenceTime,
        timeZone: context.timeZone,
        ...(context.contextHints ? { contextHints: context.contextHints } : {})
      })

      const result = parsed.ok ? parsed.data : recoverableLocal(parsed.error.code, description, context.referenceTime)
      if (!result) {
        this.logger.failure('parse.failed', parsed.ok ? 'E_AI_UNAVAILABLE' : parsed.error.code, Date.now() - started, parsed.ok ? undefined : parsed.error.failureCategory)
        if (parsed.ok) {
          return fail('E_AI_UNAVAILABLE', messageKeyOf('E_AI_UNAVAILABLE'), true)
        }
        return fail(parsed.error.code, parsed.error.messageKey, parsed.error.retryable, {
          failureCategory: parsed.error.failureCategory ?? 'serviceError'
        })
      }
      if (!parsed.ok) {
        this.logger.failure('parse.failed', parsed.error.code, Date.now() - started, parsed.error.failureCategory)
      }
      if (result.intentKind === 'chitchat' || result.intentKind === 'unknown') {
        this.logger.success('parse.completed', Date.now() - started)
        return ok({
          description,
          intentKind: result.intentKind,
          replyText: result.replyText,
          confidence: result.confidence,
          candidates: []
        })
      }

      const candidates = buildCandidates(result.candidates, description, modality, ocrText, context)
      this.logger.success('parse.completed', Date.now() - started)
      return ok({
        description,
        intentKind: result.intentKind,
        replyText: result.replyText,
        confidence: result.confidence,
        candidates
      })
    } catch (error) {
      this.logger.failure('parse.failed', 'E_AI_UNAVAILABLE', Date.now() - started, 'serviceError')
      return fail('E_AI_UNAVAILABLE', messageKeyOf('E_AI_UNAVAILABLE'), true, {
        failureCategory: 'serviceError' as FailureCategory,
        details: { reason: error instanceof Error ? error.message : 'unknown' }
      })
    } finally {
      for (const path of stagedPaths) {
        this.tempFiles.release(path)
      }
    }
  }
}

const LOCAL_FALLBACK_CODES = new Set<AppErrorCode>([
  'E_AI_TIMEOUT',
  'E_AI_UNAVAILABLE',
  'E_AI_NETWORK_FAILED',
  'E_AI_RATE_LIMITED',
  'E_AI_MODEL_UNSUPPORTED'
])

function recoverableLocal(
  code: AppErrorCode,
  description: string,
  referenceTime: number
): ReturnType<typeof localParse> | undefined {
  if (!LOCAL_FALLBACK_CODES.has(code)) return undefined
  return localParse(description, referenceTime)
}

function unresolvedFailure(resolved: ResolvedChannel): Result<never> {
  if (resolved.kind === 'ready') {
    return fail('E_AI_UNAVAILABLE', messageKeyOf('E_AI_UNAVAILABLE'), true)
  }
  return fail(resolved.code, messageKeyOf(resolved.code), false)
}

function resolveModality(modalities: InputModality[], declared: InputModality): InputModality {
  const unique = Array.from(new Set(modalities))
  if (unique.length >= 2) return 'composite'
  const single = unique[0]
  if (single === 'text' || single === 'voice' || single === 'image') return single
  return declared
}

function buildCandidates(
  rawCandidates: readonly {
    title?: string
    startExpression?: string
    endExpression?: string
    location?: string
    note?: string
  }[],
  description: string,
  modality: InputModality,
  ocrText: string | undefined,
  context: ParseContext
): PendingIntent[] {
  const source = rawCandidates.length > 0 ? rawCandidates : [{}]
  const items: PendingIntent[] = []

  for (const candidate of source) {
    const startExpression = candidate.startExpression ?? extractTimeFromDescription(description)
    const normalized = startExpression
      ? normalizeExpression(startExpression, context.referenceTime)
      : normalizeExpression(description, context.referenceTime)
    const missingFields: string[] = []
    if (normalized.startAt === undefined) {
      missingFields.push('startAt')
      missingFields.push('duration')
    }
    const title = (candidate.title ?? '').trim().length > 0
      ? (candidate.title as string).trim()
      : summarize(description)
    items.push({
      title: title.slice(0, 50),
      ...(normalized.startAt !== undefined ? { startAt: truncateToMinute(normalized.startAt) } : {}),
      ...(normalized.endAt !== undefined ? { endAt: truncateToMinute(normalized.endAt) } : {}),
      ...(candidate.location ? { location: candidate.location.slice(0, 100) } : {}),
      ...(candidate.note ? { note: candidate.note.slice(0, 500) } : {}),
      sourceModality: modality,
      originalText: description,
      missingFields,
      confidence: normalized.startAt !== undefined ? 0.9 : 0.5
    })
  }

  if (ocrText && items.length === 1) {
    const lines = ocrText
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && /(\d{1,2}[:：]\d{1,2}|[一二三四五六日天]|上午|下午|点)/.test(line))
    if (lines.length > 1) {
      return lines.map((line) => {
        const normalized = normalizeExpression(line, context.referenceTime)
        const missingFields: string[] = []
        if (normalized.startAt === undefined) {
          missingFields.push('startAt', 'duration')
        }
        return {
          title: summarize(line),
          ...(normalized.startAt !== undefined ? { startAt: truncateToMinute(normalized.startAt) } : {}),
          ...(normalized.endAt !== undefined ? { endAt: truncateToMinute(normalized.endAt) } : {}),
          sourceModality: modality,
          originalText: line,
          missingFields,
          confidence: 0.8
        }
      })
    }
  }

  return items
}

function extractTimeFromDescription(description: string): string | undefined {
  const match =
    /(今天|今日|明天|明日|后天|大后天|(?:本|这|这个)(?:周|星期|礼拜)[一二三四五六日天]|下(?:个)?(?:周|星期|礼拜)[一二三四五六日天]|(?:周|星期|礼拜)[一二三四五六日天]|\d{1,2}月\d{1,2}[日号]?)[^，,。；;]{0,12}?(?:\d{1,2}\s*[:：]\s*\d{1,2}|[零一二两三四五六七八九十\d]{1,3}\s*[点時时](?:半|[零一二两三四五六七八九十\d]{1,2}\s*分?)?)/.exec(
      description
    )
  if (match) return match[0]
  const clockOnly = /\d{1,2}\s*[:：]\s*\d{1,2}|(?:上午|下午|晚上|中午|早上|凌晨)?\s*[零一二两三四五六七八九十\d]{1,3}\s*[点時时](?:半)?/.exec(
    description
  )
  return clockOnly?.[0]
}

function summarize(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 20 ? compact.slice(0, 20) : compact
}