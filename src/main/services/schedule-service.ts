import type {
  ConflictItem,
  CreateOutcome,
  InputModality,
  ScheduleEvent,
  ScheduleEventDetail,
  UpdateOutcome,
  WeekView
} from '@shared/domain/types'
import { messageKeyOf } from '@shared/error-catalog'
import { clampText, LIMITS } from '@shared/schemas'
import { addDays, getWeekStart, overlapsWith, REMINDER_LEAD_MS, truncateToMinute } from '@shared/time-kit'
import { fail, ok, type Result } from '@shared/result'
import type { DataStore } from '../storage/data-store'
import { recalcConflictFlags } from '../storage/schedule-repository'
import { toEventDetail, toConflictItem, assembleWeekView } from './week-view-assembler'
import type { Logger } from '../observability/logger'

export interface ConfirmedIntent {
  readonly title: string
  readonly startAt?: number
  readonly endAt?: number
  readonly location?: string
  readonly note?: string
  readonly sourceModality: InputModality
}

export interface CreateOptions {
  readonly allowConflict?: boolean
  readonly allowPast?: boolean
  readonly now?: number
}

export interface UpdatePatch {
  readonly title?: string
  readonly startAt?: number
  readonly endAt?: number
  readonly location?: string
  readonly note?: string
}

interface ChangeListener {
  (notice: { revision: number; affectedWeekStarts: number[] }): void
}

export class ScheduleService {
  constructor(
    private readonly store: DataStore,
    private readonly logger: Logger,
    private readonly onChange?: ChangeListener
  ) {}

  detectConflict(interval: { startAt: number; endAt: number }, excludeEventId?: string): ConflictItem[] {
    const snapshot = this.store.snapshot()
    const weekStart = getWeekStart(interval.startAt)
    const weekEnd = addDays(weekStart, 7)
    const scoped = snapshot.events.filter(
      (event) =>
        event.status === 'active' &&
        event.eventId !== excludeEventId &&
        event.startAt < weekEnd &&
        event.endAt > weekStart
    )
    const conflicts = scoped
      .filter((event) => overlapsWith({ startAt: event.startAt, endAt: event.endAt }, interval))
      .map(toConflictItem)
      .sort((a, b) => a.startAt - b.startAt)
    if (conflicts.length > 0) {
      this.logger.log({ eventType: 'conflict.detected', resultStatus: 'success', durationMs: 0 })
    }
    return conflicts
  }

  findDuplicate(title: string, startAt: number, now: number): ScheduleEvent | undefined {
    const normalized = truncateToMinute(startAt)
    const duplicate = this.store
      .snapshot()
      .events.find(
        (event) =>
          event.status === 'active' &&
          event.title === title &&
          truncateToMinute(event.startAt) === normalized &&
          now - event.createdAt <= 24 * 60 * 60 * 1000
      )
    if (duplicate) {
      this.logger.log({ eventType: 'duplicate.rejected', resultStatus: 'failure', durationMs: 0 })
    }
    return duplicate
  }

  createEvent(intent: ConfirmedIntent, options: CreateOptions = {}): Result<CreateOutcome> {
    const now = options.now ?? this.store.now()
    const started = Date.now()
    const title = clampText(intent.title.trim(), LIMITS.titleChars)
    if (title.length === 0) {
      return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    }
    if (intent.startAt === undefined) {
      return fail('E_MISSING_START_TIME', messageKeyOf('E_MISSING_START_TIME'))
    }
    const startAt = truncateToMinute(intent.startAt)
    const endAt = truncateToMinute(intent.endAt ?? startAt + 60 * 60 * 1000)
    if (endAt <= startAt) {
      return fail('E_TIME_INCONSISTENT', messageKeyOf('E_TIME_INCONSISTENT'))
    }
    if (startAt <= now && options.allowPast !== true) {
      return fail('E_TIME_IN_PAST', messageKeyOf('E_TIME_IN_PAST'))
    }
    if (this.findDuplicate(title, startAt, now)) {
      return fail('E_DUPLICATE_EVENT', messageKeyOf('E_DUPLICATE_EVENT'))
    }

    const conflicts = this.detectConflict({ startAt, endAt })
    if (conflicts.length > 0 && options.allowConflict !== true) {
      return fail('E_CONFLICT_EXISTS', messageKeyOf('E_CONFLICT_EXISTS'), false, {
        details: { title: conflicts[0]?.title ?? '' }
      })
    }

    const eventId = `evt_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const event: ScheduleEvent = {
      eventId,
      title,
      startAt,
      endAt,
      ...(intent.location ? { location: clampText(intent.location, LIMITS.locationChars) } : {}),
      ...(intent.note ? { note: clampText(intent.note, LIMITS.noteChars) } : {}),
      sourceModality: intent.sourceModality,
      hasConflict: conflicts.length > 0,
      status: 'active',
      reminderStatus: 'not_reminded',
      snoozeCount: 0,
      createdAt: now,
      updatedAt: now
    }

    const written = this.store.write((draft) => {
      draft.events.push(event)
      recalcConflictFlags(draft, startAt)
      for (const reminder of draft.reminders) {
        if (reminder.eventId === eventId && !reminder.handled) {
          reminder.handled = true
          reminder.response = 'none'
        }
      }
      draft.reminders.push({
        reminderId: `rem_${eventId}_${startAt}`,
        eventId,
        plannedAt: startAt - REMINDER_LEAD_MS,
        channel: 'in_app',
        handled: false
      })
      const stored = draft.events.find((item) => item.eventId === eventId) as ScheduleEvent
      return { event: stored }
    })

    if (!written.ok) {
      this.logger.failure('schedule.write_failed', written.error.code, Date.now() - started)
      return written
    }

    this.logger.success('schedule.written', Date.now() - started)
    this.logger.success('reminder.scheduled', 0)
    this.emitChange(startAt, endAt)
    return ok({ eventId, event: written.data.event, conflicts })
  }

  updateEvent(eventId: string, patch: UpdatePatch, options: CreateOptions = {}): Result<UpdateOutcome> {
    const now = options.now ?? this.store.now()
    const current = this.store.snapshot().events.find((event) => event.eventId === eventId)
    if (!current || current.status !== 'active') {
      return fail('E_EVENT_NOT_FOUND', messageKeyOf('E_EVENT_NOT_FOUND'))
    }
    const startAt = truncateToMinute(patch.startAt ?? current.startAt)
    const endAt = truncateToMinute(patch.endAt ?? startAt + (current.endAt - current.startAt))
    if (endAt <= startAt) {
      return fail('E_TIME_INCONSISTENT', messageKeyOf('E_TIME_INCONSISTENT'))
    }
    const title = clampText((patch.title ?? current.title).trim(), LIMITS.titleChars)
    if (title.length === 0) {
      return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    }

    const conflicts = this.detectConflict({ startAt, endAt }, eventId)
    if (conflicts.length > 0 && options.allowConflict !== true) {
      return fail('E_CONFLICT_EXISTS', messageKeyOf('E_CONFLICT_EXISTS'), false, {
        details: { title: conflicts[0]?.title ?? '' }
      })
    }

    const written = this.store.write((draft) => {
      const event = draft.events.find((item) => item.eventId === eventId)
      if (!event) throw new Error('event not found')
      event.title = title
      event.startAt = startAt
      event.endAt = endAt
      if (patch.location !== undefined) event.location = clampText(patch.location, LIMITS.locationChars)
      if (patch.note !== undefined) event.note = clampText(patch.note, LIMITS.noteChars)
      event.updatedAt = now
      event.snoozeCount = 0
      event.reminderStatus = 'not_reminded'
      recalcConflictFlags(draft, startAt)
      for (const reminder of draft.reminders) {
        if (reminder.eventId === eventId && !reminder.handled) {
          reminder.handled = true
          reminder.response = 'none'
        }
      }
      draft.reminders.push({
        reminderId: `rem_${eventId}_${startAt}`,
        eventId,
        plannedAt: startAt - REMINDER_LEAD_MS,
        channel: 'in_app',
        handled: false
      })
      const stored = draft.events.find((item) => item.eventId === eventId) as ScheduleEvent
      return { event: stored }
    })

    if (!written.ok) {
      this.logger.failure('schedule.write_failed', written.error.code, 0)
      return written
    }
    this.logger.success('schedule.written', 0)
    this.logger.log({ eventType: 'reminder.voided', resultStatus: 'success', durationMs: 0 })
    this.logger.success('reminder.scheduled', 0)
    this.emitChange(current.startAt, startAt)
    return ok({ eventId, event: written.data.event, conflicts })
  }

  cancelEvent(eventId: string, now = this.store.now()): Result<void> {
    const written = this.store.write((draft) => {
      const event = draft.events.find((item) => item.eventId === eventId && item.status === 'active')
      if (!event) throw new Error('event not found')
      event.status = 'cancelled'
      event.updatedAt = now
      for (const reminder of draft.reminders) {
        if (reminder.eventId === eventId && !reminder.handled) {
          reminder.handled = true
          reminder.response = 'none'
        }
      }
      recalcConflictFlags(draft, event.startAt)
      return event.startAt
    })
    if (!written.ok) {
      return fail('E_EVENT_NOT_FOUND', messageKeyOf('E_EVENT_NOT_FOUND'))
    }
    this.logger.log({ eventType: 'reminder.voided', resultStatus: 'success', durationMs: 0 })
    this.emitChange(written.data, written.data)
    return ok(undefined)
  }

  getWeek(weekStart: number): Result<WeekView> {
    const snapshot = this.store.snapshot()
    return ok(
      assembleWeekView({
        events: snapshot.events,
        weekStart,
        now: this.store.now(),
        revision: snapshot.revision
      })
    )
  }

  getDetail(eventId: string): Result<ScheduleEventDetail> {
    const event = this.store.snapshot().events.find((item) => item.eventId === eventId && item.status === 'active')
    if (!event) {
      return fail('E_EVENT_NOT_FOUND', messageKeyOf('E_EVENT_NOT_FOUND'))
    }
    return ok(toEventDetail(event))
  }

  findEvent(eventId: string): ScheduleEvent | undefined {
    return this.store.snapshot().events.find((item) => item.eventId === eventId)
  }

  resetReminderForEvent(eventId: string, plannedAt: number, snoozeCount: number): Result<void> {
    return this.store.write((draft) => {
      const event = draft.events.find((item) => item.eventId === eventId)
      if (!event) throw new Error('event not found')
      event.snoozeCount = snoozeCount
      event.reminderStatus = 'not_reminded'
      event.updatedAt = this.store.now()
      draft.reminders.push({
        reminderId: `rem_${eventId}_${plannedAt}`,
        eventId,
        plannedAt,
        channel: 'in_app',
        handled: false
      })
    })
  }

  private emitChange(fromTs: number, toTs: number): void {
    if (!this.onChange) return
    const weeks = new Set<number>([getWeekStart(fromTs), getWeekStart(toTs)])
    this.onChange({ revision: this.store.revision, affectedWeekStarts: Array.from(weeks) })
  }
}