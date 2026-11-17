import { existsSync } from 'node:fs'
import type { InputModality, PendingIntent } from '@shared/domain/types'
import type { ChannelSourceTrace, SubmitEnvelope } from '@shared/ipc-contracts'
import { messageKeyOf } from '@shared/error-catalog'
import {
  fail,
  ok,
  type FailureCategory,
  type FailureMeta,
  type FailureStage,
  type Result
} from '@shared/result'
import { MEDIA_RETENTION_MS, budgetFor } from '@shared/ai/timeout-policy'
import { failureClassOfCategory } from '@shared/ai/failure'
import { sourceDisplayNameOf } from '@shared/ai/failure-text'
import type { AiFailureClass } from '@shared/ai/access-config'
import type { AiChannelKind, PresetId } from '@shared/ai/preset-catalog'
import { normalizeExpression, truncateToMinute } from '@shared/time-kit'
import { CLOCK_ONLY_SOURCE, EXTRACT_TIME_SOURCE } from '@shared/import/time-clues'
import { stripImportHeader, type ImportHeaderMeta } from '@shared/import/header'
import type { ImportFailureKind } from '@shared/import/limits'
import { translate } from '@shared/message-catalog'
import type {
  IImageToTextProvider,
  ISpeechToTextProvider,
  ITextUnderstandingProvider,
  OcrResult,
  ParseResult,
  Transcript
} from '../providers/types'
import type { ResolvedAccess, ResolvedChannel } from '../ai/provider-resolver'
import { withAutoRetry } from '../providers/request-runner'
import type { TempFileManager, TempKind } from '../temp-file-manager'
import type { Logger } from '../observability/logger'
import type { AiFailureDiagnosticsSink } from '../observability/ai-diagnostics'
import type { FailureTracker } from '../ai/failure-tracker'

export interface ParsedCandidateResolved {
  readonly intent: PendingIntent
}

export interface ParseOutcome {
  readonly description: string
  readonly intentKind: 'schedule' | 'modify' | 'cancel' | 'chitchat' | 'unknown'
  readonly replyText: string
  readonly confidence: number
  readonly candidates: readonly PendingIntent[]
  readonly sourceTrace?: readonly ChannelSourceTrace[]
  readonly importSource?: {
    readonly label: string
    readonly ext: string
    readonly bytes: number
    readonly chars: number
    readonly clipped: boolean
  }
}

export interface ParseContext {
  readonly referenceTime: number
  readonly timeZone: string
  readonly contextHints?: readonly string[]
}

export interface ParseOrchestratorOptions {
  readonly diagnostics?: AiFailureDiagnosticsSink
  readonly failureTracker?: FailureTracker
  readonly monotonic?: () => number
}

export interface ParseLastFailure {
  readonly channel: AiChannelKind
  readonly boundPresetId: PresetId
  readonly boundPresetName: string
  readonly sourcePresetId: PresetId
  readonly sourceName: string
  readonly failureClass: AiFailureClass
  readonly stage: FailureStage
  readonly durationMs: number
  readonly autoRetried: boolean
  readonly retryCount: number
  readonly consecutiveFailures: number
  readonly compositeMediaFailed: boolean
  readonly totalWaitMs: number
  readonly mediaRetentionMs: number
}

interface FailureNote {
  readonly channel: AiChannelKind
  readonly presetId: PresetId
  readonly presetName?: string
  readonly category: FailureCategory
  readonly stage: FailureStage
  readonly autoRetried: boolean
  readonly retryCount: number
  readonly compositeMediaFailed: boolean
  readonly durationMs: number
  readonly totalWaitMs: number
}

export class ParseOrchestrator {
  private lastTrace: readonly ChannelSourceTrace[] = []
  private lastFailureInfo: ParseLastFailure | undefined = undefined
  private lastImportMeta: ImportHeaderMeta | undefined = undefined

  private readonly monotonic: () => number

  constructor(
    private readonly accessProvider: () => ResolvedAccess,
    private readonly tempFiles: TempFileManager,
    private readonly logger: Logger,
    private readonly options: ParseOrchestratorOptions = {}
  ) {
    this.monotonic = options.monotonic ?? (() => performance.now())
  }

  lastSourceTrace(): readonly ChannelSourceTrace[] {
    return this.lastTrace
  }

  lastFailure(): ParseLastFailure | undefined {
    return this.lastFailureInfo
  }

  lastImportSource(): { readonly label: string } | undefined {
    return this.lastImportMeta
      ? { label: translate('import.sourceLabel', { name: this.lastImportMeta.fileName }) }
      : undefined
  }

  async parse(envelope: SubmitEnvelope, context: ParseContext): Promise<Result<ParseOutcome>> {
    const access = this.accessProvider()
    const startedAt = this.monotonic()

    this.lastFailureInfo = undefined
    this.lastImportMeta = undefined
    this.lastTrace = []

    const mediaParts = envelope.parts.filter((part) => part.kind !== 'text')
    const mediaPaths = mediaParts.map((part) => part.tempFilePath)
    this.tempFiles.purgeRetainedExcept(mediaPaths)

    for (const part of mediaParts) {
      if (existsSync(part.tempFilePath)) continue
      const channel: AiChannelKind = part.kind === 'voice' ? 'asr' : 'vision'
      const resolved = access[channel]
      const failed = fail('E_PENDING_EXPIRED', 'ai.fail.mediaExpired', false, {
        failureCategory: 'serviceError',
        failureMeta: { stage: 'local_check', receivedFirstByte: false, elapsedMs: 0 }
      })
      this.noteFailure({
        channel,
        presetId: resolved.presetId ?? 'custom',
        ...(resolved.kind === 'unsupported' ? { presetName: resolved.presetName } : {}),
        category: 'serviceError',
        stage: 'local_check',
        autoRetried: false,
        retryCount: 0,
        compositeMediaFailed: hasTextPart(envelope),
        durationMs: 0,
        totalWaitMs: budgetFor(channel, access.timeouts).totalWaitMs
      })
      return failed
    }

    const outcome = await this.execute(envelope, context, access, startedAt)
    if (outcome.ok) {
      for (const path of mediaPaths) this.tempFiles.release(path)
    } else if (mediaPaths.length > 0) {
      const kind: TempKind = mediaParts[0]?.kind === 'voice' ? 'voice' : 'image'
      this.tempFiles.retain(mediaPaths, { ttlMs: MEDIA_RETENTION_MS, kind })
    }
    return outcome
  }

  private async execute(
    envelope: SubmitEnvelope,
    context: ParseContext,
    access: ResolvedAccess,
    parseStartedAt: number
  ): Promise<Result<ParseOutcome>> {
    const started = Date.now()
    const modalities: InputModality[] = []
    const descriptionParts: string[] = []
    const trace: ChannelSourceTrace[] = []
    let ocrText: string | undefined
    let importMeta: ImportHeaderMeta | undefined

    const importSource = (): ParseOutcome['importSource'] | undefined =>
      importMeta
        ? {
            label: translate('import.sourceLabel', { name: importMeta.fileName }),
            ext: importMeta.ext,
            bytes: importMeta.bytes,
            chars: importMeta.chars,
            clipped: importMeta.clipped
          }
        : undefined

    try {
      for (const part of envelope.parts) {
        if (part.kind === 'text') {
          modalities.push('text')
          const stripped = envelope.attachment ? { body: part.text, header: undefined } : stripImportHeader(part.text)
          if (stripped.header) {
            importMeta = stripped.header
            this.lastImportMeta = stripped.header
          }
          descriptionParts.push(stripped.body.trim())
          continue
        }

        if (part.kind === 'voice') {
          modalities.push('voice')
          if (part.durationMs > 60_000) {
            return fail('E_INPUT_TOO_LARGE', messageKeyOf('E_INPUT_TOO_LARGE'))
          }
          if (access.asr.kind !== 'ready') {
            trace.push(traceOf('asr', access.asr, gapResultOf(access.asr)))
            this.lastTrace = trace
            this.noteFailure({
              channel: 'asr',
              presetId: access.asr.presetId ?? 'custom',
              ...(access.asr.kind === 'unsupported' ? { presetName: access.asr.presetName } : {}),
              category: access.asr.kind === 'unsupported' ? 'modelUnavailable' : 'serviceError',
              stage: 'local_check',
              autoRetried: false,
              retryCount: 0,
              compositeMediaFailed: hasTextPart(envelope),
              durationMs: 0,
              totalWaitMs: budgetFor('asr', access.timeouts).totalWaitMs
            })
            this.logFailure('asr', access.asr, 0, 'local_check', false, 0)
            return unresolvedFailure(access.asr)
          }
          const budget = budgetFor('asr', access.timeouts)
          const asrProvider = (access.asr as Extract<ResolvedChannel, { kind: 'ready' }>)
            .provider as ISpeechToTextProvider
          const run = await withAutoRetry<Transcript>(
            () => asrProvider.transcribe(part.tempFilePath, part.durationMs),
            {
              channel: 'asr',
              budget,
              snapshotRevision: access.revision,
              currentRevision: () => this.accessProvider().revision,
              idempotent: true,
              startedAt: parseStartedAt,
              onBeforeRetry: (attempt) => this.logRetried('asr', access.asr, attempt, budget.tier)
            }
          )
          const transcript = run.result
          const elapsed = Math.max(0, this.monotonic() - parseStartedAt)
          if (!transcript.ok) {
            trace.push(traceOf('asr', access.asr, 'failed'))
            this.lastTrace = trace
            this.noteFailure({
              channel: 'asr',
              presetId: access.asr.presetId ?? 'custom',
              category: transcript.error.failureCategory ?? 'serviceError',
              stage: transcript.error.failureMeta?.stage ?? 'connect_first_byte',
              autoRetried: run.autoRetried,
              retryCount: run.retryCount,
              compositeMediaFailed: hasTextPart(envelope),
              durationMs: elapsed,
              totalWaitMs: budget.totalWaitMs
            })
            this.logFailure(
              'asr',
              access.asr,
              elapsed,
              transcript.error.failureMeta?.stage ?? 'connect_first_byte',
              run.autoRetried,
              run.retryCount,
              transcript.error.failureCategory
            )
            return fail(transcript.error.code, transcript.error.messageKey, transcript.error.retryable, {
              failureCategory: transcript.error.failureCategory ?? 'serviceError',
              ...(transcript.error.failureMeta ? { failureMeta: transcript.error.failureMeta } : {})
            })
          }
          trace.push(traceOf('asr', access.asr, 'success'))
          this.logger.success('asr.completed', elapsed, {
            channel: 'asr',
            presetId: access.asr.presetId,
            sourcePresetId: actualPresetIdOf(access.asr),
            resolution: 'success'
          })
          descriptionParts.push(transcript.data.text.trim())
          continue
        }

        modalities.push('image')
        if (part.byteSize > 10 * 1024 * 1024) {
          return fail('E_INPUT_TOO_LARGE', messageKeyOf('E_INPUT_TOO_LARGE'))
        }
        if (access.vision.kind !== 'ready') {
          trace.push(traceOf('vision', access.vision, gapResultOf(access.vision)))
          this.lastTrace = trace
          this.noteFailure({
            channel: 'vision',
            presetId: access.vision.presetId ?? 'custom',
            ...(access.vision.kind === 'unsupported' ? { presetName: access.vision.presetName } : {}),
            category: access.vision.kind === 'unsupported' ? 'modelUnavailable' : 'serviceError',
            stage: 'local_check',
            autoRetried: false,
            retryCount: 0,
            compositeMediaFailed: hasTextPart(envelope),
            durationMs: 0,
            totalWaitMs: budgetFor('vision', access.timeouts).totalWaitMs
          })
          this.logFailure('vision', access.vision, 0, 'local_check', false, 0)
          return unresolvedFailure(access.vision)
        }
        const budget = budgetFor('vision', access.timeouts)
        const visionProvider = (access.vision as Extract<ResolvedChannel, { kind: 'ready' }>)
          .provider as IImageToTextProvider
        const run = await withAutoRetry<OcrResult>(
          () => visionProvider.extract(part.tempFilePath, part.mimeType),
          {
            channel: 'vision',
            budget,
            snapshotRevision: access.revision,
            currentRevision: () => this.accessProvider().revision,
            idempotent: true,
            startedAt: parseStartedAt,
            onBeforeRetry: (attempt) => this.logRetried('vision', access.vision, attempt, budget.tier)
          }
        )
        const ocr = run.result
        const elapsed = Math.max(0, this.monotonic() - parseStartedAt)
        if (!ocr.ok) {
          trace.push(traceOf('vision', access.vision, 'failed'))
          this.lastTrace = trace
          this.noteFailure({
            channel: 'vision',
            presetId: access.vision.presetId ?? 'custom',
            category: ocr.error.failureCategory ?? 'serviceError',
            stage: ocr.error.failureMeta?.stage ?? 'connect_first_byte',
            autoRetried: run.autoRetried,
            retryCount: run.retryCount,
            compositeMediaFailed: hasTextPart(envelope),
            durationMs: elapsed,
            totalWaitMs: budget.totalWaitMs
          })
          this.logFailure(
            'vision',
            access.vision,
            elapsed,
            ocr.error.failureMeta?.stage ?? 'connect_first_byte',
            run.autoRetried,
            run.retryCount,
            ocr.error.failureCategory
          )
          return fail(ocr.error.code, ocr.error.messageKey, ocr.error.retryable, {
            failureCategory: ocr.error.failureCategory ?? 'serviceError',
            ...(ocr.error.failureMeta ? { failureMeta: ocr.error.failureMeta } : {})
          })
        }
        trace.push(traceOf('vision', access.vision, 'success'))
        this.logger.success('ocr.completed', elapsed, {
          channel: 'vision',
          presetId: access.vision.presetId,
          sourcePresetId: actualPresetIdOf(access.vision),
          resolution: 'success'
        })
        ocrText = ocr.data.text
        descriptionParts.push(ocr.data.text)
      }

      const description = descriptionParts.filter((part) => part.length > 0).join('\n').trim()
      if (description.length === 0) {
        this.lastTrace = trace
        return ok({
          description,
          intentKind: 'unknown',
          replyText: envelope.parts.some(part => part.kind === 'image')
            ? '图片中没有识别到可读文字。可以上传更清晰的截图，或在对话里描述图片后提问。'
            : '没有识别到内容，请换一种方式再试一次。',
          confidence: 0.1,
          candidates: [],
          ...(importSource() ? { importSource: importSource() } : {}),
          ...(trace.length > 0 ? { sourceTrace: trace } : {})
        })
      }

      const modality = resolveModality(modalities, envelope.modality)
      if (access.text.kind !== 'ready') {
        trace.push(traceOf('text', access.text, gapResultOf(access.text)))
        this.lastTrace = trace
        this.logImportOutcome(importMeta, 0, 'failed', 0, access.text.code, 'parse')
        this.noteFailure({
          channel: 'text',
          presetId: access.text.presetId ?? 'custom',
          category: access.text.kind === 'unsupported' ? 'modelUnavailable' : 'serviceError',
          stage: 'local_check',
          autoRetried: false,
          retryCount: 0,
          compositeMediaFailed: false,
          durationMs: 0,
          totalWaitMs: budgetFor('text', access.timeouts).totalWaitMs
        })
        return unresolvedFailure(access.text)
      }
      const textBudget = budgetFor('text', access.timeouts)
      const textProvider = (access.text as Extract<ResolvedChannel, { kind: 'ready' }>)
        .provider as ITextUnderstandingProvider
      const run = await withAutoRetry<ParseResult>(
        () =>
          textProvider.parse({
            description,
            attachment: envelope.attachment,
            referenceTime: context.referenceTime,
            timeZone: context.timeZone,
            ...(context.contextHints ? { contextHints: context.contextHints } : {})
          }),
        {
          channel: 'text',
          budget: textBudget,
          snapshotRevision: access.revision,
          currentRevision: () => this.accessProvider().revision,
          idempotent: true,
          startedAt: parseStartedAt,
          onBeforeRetry: (attempt) => this.logRetried('text', access.text, attempt, textBudget.tier)
        }
      )
      const parsed = run.result
      const elapsed = Math.max(0, this.monotonic() - parseStartedAt)

      if (!parsed.ok) {
        trace.push(traceOf('text', access.text, 'failed'))
        this.lastTrace = trace
        this.logImportOutcome(importMeta, elapsed, 'failed', 0, parsed.error.code, 'parse')
        this.noteFailure({
          channel: 'text',
          presetId: access.text.presetId ?? 'custom',
          category: parsed.error.failureCategory ?? 'serviceError',
          stage: parsed.error.failureMeta?.stage ?? 'connect_first_byte',
          autoRetried: run.autoRetried,
          retryCount: run.retryCount,
          compositeMediaFailed: false,
          durationMs: elapsed,
          totalWaitMs: textBudget.totalWaitMs
        })
        this.logFailure(
          'text',
          access.text,
          elapsed,
          parsed.error.failureMeta?.stage ?? 'connect_first_byte',
          run.autoRetried,
          run.retryCount,
          parsed.error.failureCategory
        )
        return fail(parsed.error.code, parsed.error.messageKey, parsed.error.retryable, {
          failureCategory: parsed.error.failureCategory ?? 'serviceError',
          ...(parsed.error.failureMeta ? { failureMeta: parsed.error.failureMeta } : {})
        })
      }

      trace.push(traceOf('text', access.text, 'success'))
      this.lastTrace = trace
      const result = parsed.data
      if (result.intentKind === 'chitchat' || result.intentKind === 'unknown') {
        this.logger.success('parse.completed', elapsed, {
          channel: 'text',
          presetId: access.text.presetId,
          sourcePresetId: actualPresetIdOf(access.text),
          resolution: 'success'
        })
        this.logImportOutcome(importMeta, elapsed, 'success', 0)
        return ok({
          description,
          intentKind: result.intentKind,
          replyText: result.replyText,
          confidence: result.confidence,
          candidates: [],
          ...(importSource() ? { importSource: importSource() } : {}),
          ...(trace.length > 0 ? { sourceTrace: trace } : {})
        })
      }

      const candidates = buildCandidates(result.candidates, description, modality, envelope.attachment ? undefined : ocrText, context, !!envelope.attachment)
      this.logger.success('parse.completed', elapsed, {
        channel: 'text',
        presetId: access.text.presetId,
        sourcePresetId: actualPresetIdOf(access.text),
        resolution: 'success'
      })
      this.logImportOutcome(importMeta, elapsed, 'success', candidates.length)
      return ok({
        description,
        intentKind: result.intentKind,
        replyText: result.replyText,
        confidence: result.confidence,
        candidates,
        ...(importSource() ? { importSource: importSource() } : {}),
        ...(trace.length > 0 ? { sourceTrace: trace } : {})
      })
    } catch (error) {
      const elapsed = Math.max(0, this.monotonic() - parseStartedAt)
      this.logger.failure('parse.failed', 'E_AI_UNAVAILABLE', elapsed, 'serviceError')
      return fail('E_AI_UNAVAILABLE', messageKeyOf('E_AI_UNAVAILABLE'), true, {
        failureCategory: 'serviceError' as FailureCategory,
        failureMeta: { stage: 'result_parse', receivedFirstByte: false, elapsedMs: elapsed },
        details: { reason: error instanceof Error ? error.name : 'unknown' }
      })
    } finally {
      void started
    }
  }

  private logImportOutcome(
    meta: ImportHeaderMeta | undefined,
    elapsedMs: number,
    outcome: 'success' | 'failed',
    candidateCount: number,
    errorCode?: string,
    failureKind?: ImportFailureKind
  ): void {
    if (!meta) return
    const importSummary = {
      ext: meta.ext,
      bytes: meta.bytes,
      readableChars: meta.chars,
      clipped: meta.clipped,
      candidateCount,
      parseDurationMs: elapsedMs,
      outcome,
      ...(failureKind ? { failureKind } : {})
    }
    if (outcome === 'success') {
      this.logger.success('import.completed', elapsedMs, { importSummary })
      return
    }
    this.logger.failure('import.failed', errorCode ?? 'E_AI_UNAVAILABLE', elapsedMs, undefined, {
      importSummary
    })
  }

  private noteFailure(note: FailureNote): void {
    const sourceName = sourceDisplayNameOf(note.presetId, note.presetName)
    const boundPresetName = note.presetName ?? sourceName
    const consecutiveFailures = this.options.failureTracker?.record(note.channel) ?? 0
    const failureClass = failureClassOfCategory(note.category)
    this.lastFailureInfo = {
      channel: note.channel,
      boundPresetId: note.presetId,
      boundPresetName,
      sourcePresetId: note.presetId,
      sourceName,
      failureClass,
      stage: note.stage,
      durationMs: note.durationMs,
      autoRetried: note.autoRetried,
      retryCount: note.retryCount,
      consecutiveFailures,
      compositeMediaFailed: note.compositeMediaFailed,
      totalWaitMs: note.totalWaitMs,
      mediaRetentionMs: MEDIA_RETENTION_MS
    }
    this.options.diagnostics?.record({
      at: Date.now(),
      channel: note.channel,
      boundPresetName,
      sourceName,
      stage: note.stage,
      failureClass,
      durationMs: note.durationMs,
      autoRetried: note.autoRetried,
      retryCount: note.retryCount
    })
  }

  private logFailure(
    channel: AiChannelKind,
    resolved: ResolvedChannel,
    elapsedMs: number,
    stage: FailureStage,
    autoRetried: boolean,
    retryCount: number,
    category?: FailureCategory
  ): void {
    const eventType = channel === 'vision' ? 'ocr.failed' : channel === 'asr' ? 'asr.failed' : 'parse.failed'
    this.logger.failure(eventType, resolved.kind === 'ready' ? 'E_AI_UNAVAILABLE' : resolved.code, elapsedMs, category, {
      channel,
      ...(resolved.presetId ? { presetId: resolved.presetId, sourcePresetId: actualPresetIdOf(resolved) } : {}),
      resolution: 'failed',
      failureStage: stage,
      autoRetried,
      retryCount
    })
  }

  private logRetried(
    channel: AiChannelKind,
    resolved: ResolvedChannel,
    attempt: number,
    tier: string
  ): void {
    this.logger.log({
      eventType: 'ai.request.retried',
      resultStatus: 'success',
      durationMs: 0,
      channel,
      retryCount: attempt,
      autoRetried: true,
      tier
    })
    void resolved
  }
}


function actualPresetIdOf(channel: ResolvedChannel): ChannelSourceTrace['actualPresetId'] {
  return channel.kind === 'ready' ? channel.actualPresetId ?? channel.presetId : channel.presetId ?? 'custom'
}

function traceOf(
  channel: AiChannelKind,
  resolved: ResolvedChannel,
  result: ChannelSourceTrace['result']
): ChannelSourceTrace {
  const presetId = resolved.presetId ?? 'custom'
  const presetName =
    resolved.kind === 'ready' || resolved.kind === 'unsupported' ? resolved.presetName : undefined
  return {
    channel,
    boundPresetId: presetId,
    actualPresetId: actualPresetIdOf(resolved),
    actualName: presetName ?? presetId,
    result
  }
}

function gapResultOf(resolved: ResolvedChannel): ChannelSourceTrace['result'] {
  if (resolved.kind === 'unsupported') return 'capability_gap'
  if (resolved.kind === 'not_configured') return 'not_configured'
  return 'failed'
}

function unresolvedFailure(resolved: ResolvedChannel): Result<never> {
  if (resolved.kind === 'ready') {
    return fail('E_AI_UNAVAILABLE', messageKeyOf('E_AI_UNAVAILABLE'), true)
  }
  const meta: FailureMeta = { stage: 'local_check', receivedFirstByte: false, elapsedMs: 0 }
  return fail(resolved.code, messageKeyOf(resolved.code), false, { failureMeta: meta })
}

function hasTextPart(envelope: SubmitEnvelope): boolean {
  return envelope.parts.some((part) => part.kind === 'text')
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
  context: ParseContext,
  attachment: boolean
): PendingIntent[] {
  const source = rawCandidates.length > 0 ? rawCandidates : [{}]
  const items: PendingIntent[] = []

  for (const candidate of source) {
    const startExpression = candidate.startExpression ?? (attachment ? undefined : extractTimeFromDescription(description))
    const normalized = startExpression
      ? normalizeExpression(candidate.endExpression && !startExpression.includes(candidate.endExpression)
        ? `${startExpression}到${candidate.endExpression}` : startExpression, context.referenceTime)
      : normalizeExpression(attachment ? '' : description, context.referenceTime)
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
      originalText: attachment ? [candidate.title, startExpression].filter(Boolean).join('，') : description,
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
  const match = new RegExp(EXTRACT_TIME_SOURCE).exec(description)
  if (match) return match[0]
  const clockOnly = new RegExp(CLOCK_ONLY_SOURCE).exec(description)
  return clockOnly?.[0]
}

function summarize(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 20 ? compact.slice(0, 20) : compact
}
