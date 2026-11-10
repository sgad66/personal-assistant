import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { FailureCategory } from '@shared/result'

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

export interface LogRecord {
  readonly eventType: ObservabilityEventType
  readonly resultStatus: 'success' | 'failure'
  readonly durationMs: number
  readonly errorCode?: string
  readonly failureCategory?: FailureCategory
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

  success(eventType: ObservabilityEventType, durationMs = 0): void {
    this.log({ eventType, resultStatus: 'success', durationMs })
  }

  failure(eventType: ObservabilityEventType, errorCode: string, durationMs = 0, failureCategory?: FailureCategory): void {
    this.log({
      eventType,
      resultStatus: 'failure',
      durationMs,
      errorCode,
      ...(failureCategory ? { failureCategory } : {})
    })
  }
}

export const silentLogger = new Logger(null)