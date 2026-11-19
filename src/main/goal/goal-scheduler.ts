import type { GoalRunResult } from '@shared/ipc-contracts'
import { messageKeyOf } from '@shared/error-catalog'
import type { Logger } from '../observability/logger'
import type { GoalService } from '../services/goal-service'

const POLL_INTERVAL_MS = 20_000

export interface GoalSchedulerDeps {
  readonly goals: GoalService
  readonly logger: Logger
  readonly clock: () => number
  readonly onRun?: (result: GoalRunResult) => void
}

export class GoalScheduler {
  private timer: NodeJS.Timeout | null = null
  private readonly queue: string[] = []
  private draining = false
  private polling = false

  constructor(private readonly deps: GoalSchedulerDeps) {}

  start(intervalMs = POLL_INTERVAL_MS): void {
    const safeInterval = Math.max(5_000, Math.min(intervalMs, 60_000))
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
    try {
      const now = this.deps.clock()
      for (const goal of this.deps.goals.dueGoals(now)) {
        if (this.deps.goals.isRunning(goal.goalId)) continue
        if (this.queue.includes(goal.goalId)) continue
        this.queue.push(goal.goalId)
      }
    } finally {
      this.polling = false
    }
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    const goalId = this.queue.shift()
    if (!goalId) return
    this.draining = true
    try {
      const result = await this.deps.goals.run(goalId)
      if (result.ok) {
        this.deps.onRun?.(result.data)
      } else {
        this.deps.logger.failure('goal.failed', result.error.code || messageKeyOf('E_AI_UNAVAILABLE'), 0)
      }
    } finally {
      this.draining = false
    }
    void this.drain()
  }
}