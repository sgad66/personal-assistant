import type { Logger } from '../observability/logger'
import type { CareService } from '../services/care-service'

const POLL_INTERVAL_MS = 30_000

export interface CareSchedulerDeps {
  readonly care: CareService
  readonly logger: Logger
  readonly clock: () => number
}

export class CareScheduler {
  private timer: NodeJS.Timeout | null = null
  private polling = false

  constructor(private readonly deps: CareSchedulerDeps) {}

  start(intervalMs = POLL_INTERVAL_MS): void {
    const safeInterval = Math.max(10_000, Math.min(intervalMs, 60_000))
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => this.pollNow(), safeInterval)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    this.pollNow()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  pollNow(): void {
    if (this.polling) return
    this.polling = true
    this.deps.care
      .runDue(this.deps.clock())
      .catch(() => {
        this.deps.logger.failure('care.failed', 'E_AI_UNAVAILABLE', 0, 'serviceError')
      })
      .finally(() => {
        this.polling = false
      })
  }
}