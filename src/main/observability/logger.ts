import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FailureCategory } from '@shared/result'
import type { AiChannelKind } from '@shared/ai/preset-catalog'
import type { FailureStage } from '@shared/result'

export type ObservabilityEventType =
  | 'entry.opened'
  | 'input.submitted'
  | 'input.rejected'
  | 'asr.completed'
  | 'asr.failed'
  | 'ocr.completed'
  | 'ocr.failed'
  | 'parse.completed'
  | 'parse.failed'
  | 'schedule.written'
  | 'schedule.write_failed'
  | 'conflict.detected'
  | 'duplicate.rejected'
  | 'reminder.scheduled'
  | 'reminder.delivered'
  | 'reminder.responded'
  | 'reminder.voided'
  | 'reminder.summary_shown'
  | 'ai.request.retried'

export type ResolutionOutcome = 'success' | 'failed' | 'capability_gap' | 'not_configured'

export interface LogContext {
  readonly channel?: AiChannelKind
  readonly presetId?: string
  readonly sourcePresetId?: string
  readonly sourceName?: string
  readonly resolution?: ResolutionOutcome
  readonly failureStage?: FailureStage
  readonly receivedFirstByte?: boolean
  readonly autoRetried?: boolean
  readonly retryCount?: number
  readonly tier?: string
}

export interface LogRecord {
  readonly eventType: ObservabilityEventType
  readonly resultStatus: 'success' | 'failure'
  readonly durationMs: number
  readonly errorCode?: string
  readonly failureCategory?: FailureCategory
  readonly channel?: AiChannelKind
  readonly presetId?: string
  readonly sourcePresetId?: string
  readonly sourceName?: string
  readonly resolution?: ResolutionOutcome
  readonly failureStage?: FailureStage
  readonly receivedFirstByte?: boolean
  readonly autoRetried?: boolean
  readonly retryCount?: number
  readonly tier?: string
}

export interface LogEntry extends LogRecord {
  readonly timestamp: string
}

export class Logger {
  private readonly filePath: string | null

  constructor(filePath?: string | null) {
    this.filePath = filePath ?? null
    if (this.filePath) {
      mkdirSync(dirname(this.filePath), { recursive: true })
    }
  }

  log(record: LogRecord): void {
    const entry: LogEntry = { timestamp: new Date().toISOString(), ...record, durationMs: Math.round(record.durationMs) }
    if (!this.filePath) return
    try {
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf-8')
    } catch {
      // 日志失败不阻断业务
    }
  }

  success(eventType: ObservabilityEventType, durationMs = 0, context?: LogContext): void {
    this.log({
      eventType,
      resultStatus: 'success',
      durationMs,
      ...(context?.channel ? { channel: context.channel } : {}),
      ...(context?.presetId ? { presetId: context.presetId } : {}),
      ...(context?.sourcePresetId ? { sourcePresetId: context.sourcePresetId } : {}),
      ...(context?.sourceName ? { sourceName: context.sourceName } : {}),
      ...(context?.resolution ? { resolution: context.resolution } : {}),
      ...(context?.failureStage ? { failureStage: context.failureStage } : {}),
      ...(context?.receivedFirstByte !== undefined ? { receivedFirstByte: context.receivedFirstByte } : {}),
      ...(context?.autoRetried !== undefined ? { autoRetried: context.autoRetried } : {}),
      ...(context?.retryCount !== undefined ? { retryCount: context.retryCount } : {}),
      ...(context?.tier ? { tier: context.tier } : {})
    })
  }

  failure(
    eventType: ObservabilityEventType,
    errorCode: string,
    durationMs = 0,
    failureCategory?: FailureCategory,
    context?: LogContext
  ): void {
    this.log({
      eventType,
      resultStatus: 'failure',
      durationMs,
      errorCode,
      ...(failureCategory ? { failureCategory } : {}),
      ...(context?.channel ? { channel: context.channel } : {}),
      ...(context?.presetId ? { presetId: context.presetId } : {}),
      ...(context?.sourcePresetId ? { sourcePresetId: context.sourcePresetId } : {}),
      ...(context?.sourceName ? { sourceName: context.sourceName } : {}),
      ...(context?.resolution ? { resolution: context.resolution } : {}),
      ...(context?.failureStage ? { failureStage: context.failureStage } : {}),
      ...(context?.receivedFirstByte !== undefined ? { receivedFirstByte: context.receivedFirstByte } : {}),
      ...(context?.autoRetried !== undefined ? { autoRetried: context.autoRetried } : {}),
      ...(context?.retryCount !== undefined ? { retryCount: context.retryCount } : {}),
      ...(context?.tier ? { tier: context.tier } : {})
    })
  }
}

export const silentLogger = new Logger(null)