import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AiFailureDiagnosticDto } from '@shared/ai/access-config'
import { atomicWrite } from '../temp-file-manager'

export type AiFailureDiagnostic = AiFailureDiagnosticDto

export interface AiFailureDiagnosticsSink {
  record(entry: AiFailureDiagnostic): void
  list(limit?: number): readonly AiFailureDiagnostic[]
  readFailed(): boolean
  clear(): void
}

interface DiagnosticsFile {
  readonly version: 1
  readonly records: readonly AiFailureDiagnostic[]
}

const FILE_VERSION = 1
const DEFAULT_LIMIT = 20

export class AiDiagnosticsStore implements AiFailureDiagnosticsSink {
  private records: AiFailureDiagnostic[] = []
  private failed = false

  constructor(
    private readonly filePath: string | null,
    private readonly clock: () => number = () => Date.now(),
    private readonly limit = DEFAULT_LIMIT
  ) {}

  load(): void {
    this.failed = false
    this.records = []
    if (!this.filePath) return
    try {
      if (!existsSync(this.filePath)) return
      const raw = readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<DiagnosticsFile>
      if (parsed.version !== FILE_VERSION || !Array.isArray(parsed.records)) {
        this.failed = true
        return
      }
      this.records = parsed.records.filter(isDiagnostic).slice(-this.limit)
    } catch {
      this.failed = true
      this.records = []
    }
  }

  record(entry: AiFailureDiagnostic): void {
    const at = Number.isFinite(entry.at) ? entry.at : this.clock()
    this.records = [...this.records, sanitize({ ...entry, at })].slice(-this.limit)
    this.flush()
  }

  list(limit = this.limit): readonly AiFailureDiagnostic[] {
    return this.records.slice(-Math.max(0, limit))
  }

  readFailed(): boolean {
    return this.failed
  }

  clear(): void {
    this.records = []
    this.failed = false
    this.flush()
  }

  private flush(): void {
    if (!this.filePath) return
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const payload: DiagnosticsFile = { version: FILE_VERSION, records: this.records }
      atomicWrite(this.filePath, JSON.stringify(payload))
    } catch {
      // 诊断写入失败不影响主流程
    }
  }
}

function isDiagnostic(value: unknown): value is AiFailureDiagnostic {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.at === 'number' &&
    typeof record.channel === 'string' &&
    typeof record.boundPresetName === 'string' &&
    typeof record.sourceName === 'string' &&
    typeof record.stage === 'string' &&
    typeof record.failureClass === 'string' &&
    typeof record.durationMs === 'number' &&
    typeof record.autoRetried === 'boolean' &&
    typeof record.retryCount === 'number'
  )
}

/**
 * 字段白名单：只保留九项诊断信息，任何额外字段（端点、Key、媒体）都被丢弃。
 */
function sanitize(entry: AiFailureDiagnostic): AiFailureDiagnostic {
  return {
    at: entry.at,
    channel: entry.channel,
    boundPresetName: entry.boundPresetName,
    sourceName: entry.sourceName,
    stage: entry.stage,
    failureClass: entry.failureClass,
    durationMs: entry.durationMs,
    autoRetried: entry.autoRetried,
    retryCount: entry.retryCount
  }
}