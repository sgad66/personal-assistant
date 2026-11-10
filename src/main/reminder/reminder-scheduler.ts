import type { ReminderPayload, ReminderResponse, ReminderOutcome } from '@shared/ipc-contracts'
import type { ReminderRecord } from '@shared/domain/types'
import { messageKeyOf } from '@shared/error-catalog'
import { fail, ok, type Result } from '@shared/result'
import { describeRemaining, truncateToMinute } from '@shared/time-kit'
import type { DataStore } from '../storage/data-store'
import type { ReminderRepository } from '../storage/reminder-repository'
import type { ScheduleService } from '../services/schedule-service'
import type { Logger } from '../observability/logger'

const POLL_INTERVAL_MS = 15_000
const SNOOZE_DELAY_MS = 5 * 60_000

export interface ReminderSchedulerDeps {
  readonly store: DataStore
  readonly reminders: ReminderRepository
  readonly schedule: ScheduleService
  readonly logger: Logger
  readonly clock: () => number
  readonly present: (payload: ReminderPayload) => void
}

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null
  private readonly queue: ReminderPayload[] = []
  private presenting = false
  private polling = false

  constructor(private readonly deps: ReminderSchedulerDeps) {}

  start(intervalMs = POLL_INTERVAL_MS): void {
    const safeInterval = Math.min(intervalMs, 30_000)
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
      const due = this.deps.reminders.findDue(now)
      if (!due.ok) return
      for (const record of due.data) {
        const event = this.deps.schedule.findEvent(record.eventId)
        if (!event || event.status !== 'active') continue
        const delivered = this.deps.reminders.markDelivered(record.eventId, record.plannedAt, 'in_app', now)
        if (!delivered.ok) continue
        const payload: ReminderPayload = {
          eventId: event.eventId,
          plannedAt: record.plannedAt,
          title: event.title,
          startAt: event.startAt,
          remainingMinutes: describeRemaining(event.startAt, now)
        }
        this.queue.push(payload)
        this.deps.logger.log({ eventType: 'reminder.delivered', resultStatus: 'success', durationMs: 0 })
      }
    } finally {
      this.polling = false
    }
    this.drainQueue()
  }

  drainQueue(): void {
    if (this.presenting) return
    const next = this.queue.shift()
    if (!next) return
    this.presenting = true
    try {
      this.deps.present(next)
    } catch {
      this.queue.unshift(next)
    } finally {
      this.presenting = false
    }
    if (this.queue.length > 0) {
      this.drainQueue()
    }
  }

  handleResponse(response: ReminderResponse): Result<ReminderOutcome> {
    const now = this.deps.clock()
    const pending = this.deps.reminders.findPending(response.eventId, response.plannedAt)
    if (!pending.ok || !pending.data) {
      return fail('E_REMINDER_NOT_PENDING', messageKeyOf('E_REMINDER_NOT_PENDING'))
    }
    const event = this.deps.schedule.findEvent(response.eventId)
    if (!event || event.status !== 'active') {
      return fail('E_REMINDER_NOT_PENDING', messageKeyOf('E_REMINDER_NOT_PENDING'))
    }

    if (response.action === 'acknowledge') {
      this.deps.reminders.recordResponse(event.eventId, response.plannedAt, 'acknowledge', now)
      this.setEventReminderState(event.eventId, 'reminded', event.snoozeCount, now)
      this.deps.logger.log({ eventType: 'reminder.responded', resultStatus: 'success', durationMs: 0 })
      return ok({
        eventId: event.eventId,
        reminderStatus: 'reminded',
        snoozeCount: event.snoozeCount
      })
    }

    if (response.action === 'ignore') {
      this.deps.reminders.recordResponse(event.eventId, response.plannedAt, 'ignore', now)
      this.setEventReminderState(event.eventId, 'ignored', event.snoozeCount, now)
      this.deps.logger.log({ eventType: 'reminder.responded', resultStatus: 'success', durationMs: 0 })
      return ok({
        eventId: event.eventId,
        reminderStatus: 'ignored',
        snoozeCount: event.snoozeCount
      })
    }

    const nextCount = event.snoozeCount + 1
    this.deps.reminders.recordResponse(event.eventId, response.plannedAt, 'snooze', now)
    if (nextCount >= 3) {
      this.setEventReminderState(event.eventId, 'ignored', 3, now)
      this.deps.logger.log({ eventType: 'reminder.responded', resultStatus: 'success', durationMs: 0 })
      return ok({ eventId: event.eventId, reminderStatus: 'ignored', snoozeCount: 3 })
    }

    const nextPlannedAt = truncateToMinute(now + SNOOZE_DELAY_MS)
    const nextRecord: ReminderRecord = {
      reminderId: `rem_${event.eventId}_${nextPlannedAt}`,
      eventId: event.eventId,
      plannedAt: nextPlannedAt,
      channel: 'in_app',
      handled: false
    }
    this.setEventReminderState(event.eventId, 'not_reminded', nextCount, now)
    this.deps.reminders.addSnoozeRecord({ ...event, snoozeCount: nextCount }, nextRecord.plannedAt, now)
    this.deps.logger.log({ eventType: 'reminder.responded', resultStatus: 'success', durationMs: 0 })
    this.deps.logger.success('reminder.scheduled', 0)
    return ok({
      eventId: event.eventId,
      reminderStatus: 'not_reminded',
      snoozeCount: nextCount,
      nextPlannedAt
    })
  }

  emitExpiredSummary(): number {
    const now = this.deps.clock()
    const consumed = this.deps.reminders.consumeExpiredUnreminded(now)
    if (!consumed.ok || consumed.data === 0) return 0
    this.deps.logger.log({ eventType: 'reminder.summary_shown', resultStatus: 'success', durationMs: 0 })
    return consumed.data
  }

  pendingCount(): number {
    const pending = this.deps.reminders.allPending()
    return pending.ok ? pending.data.length : 0
  }

  private setEventReminderState(
    eventId: string,
    status: 'not_reminded' | 'reminded' | 'ignored',
    snoozeCount: number,
    now: number
  ): void {
    this.deps.store.write((draft) => {
      const event = draft.events.find((item) => item.eventId === eventId)
      if (!event) return
      event.reminderStatus = status
      event.snoozeCount = snoozeCount
      event.updatedAt = now
    })
  }
}