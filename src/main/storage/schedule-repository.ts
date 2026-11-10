import type { ScheduleEvent } from '@shared/domain/types'
import { addDays, getWeekStart, overlapsWith, startOfDay, truncateToMinute } from '@shared/time-kit'
import { messageKeyOf } from '@shared/error-catalog'
import { fail, ok, type Result } from '@shared/result'
import type { DataStore, DbShape } from './data-store'

export class ScheduleRepository {
  constructor(private readonly store: DataStore) {}

  insert(event: ScheduleEvent): Result<ScheduleEvent> {
    return this.store.write((draft) => {
      draft.events.push(event)
      recalcConflictFlags(draft, event.startAt)
      return draft.events.find((item) => item.eventId === event.eventId) as ScheduleEvent
    })
  }

  update(eventId: string, patch: Partial<ScheduleEvent>): Result<ScheduleEvent> {
    return this.store.write((draft) => {
      const event = draft.events.find((item) => item.eventId === eventId)
      if (!event) throw new Error('event not found')
      Object.assign(event, patch)
      event.updatedAt = patch.updatedAt ?? Date.now()
      recalcConflictFlags(draft, event.startAt)
      return event
    })
  }

  cancel(eventId: string): Result<ScheduleEvent> {
    return this.store.write((draft) => {
      const event = draft.events.find((item) => item.eventId === eventId)
      if (!event) throw new Error('event not found')
      event.status = 'cancelled'
      event.updatedAt = Date.now()
      recalcConflictFlags(draft, event.startAt)
      return event
    })
  }

  findById(eventId: string): Result<ScheduleEvent | undefined> {
    return this.store.read((draft) => draft.events.find((item) => item.eventId === eventId))
  }

  all(): Result<ScheduleEvent[]> {
    return this.store.read((draft) => draft.events.slice())
  }

  activeEvents(): Result<ScheduleEvent[]> {
    return this.store.read((draft) => draft.events.filter((item) => item.status === 'active'))
  }

  findByWeek(weekStart: number): Result<ScheduleEvent[]> {
    return this.store.read((draft) => {
      const start = getWeekStart(weekStart)
      const end = addDays(start, 7)
      return draft.events.filter(
        (event) => event.status === 'active' && event.startAt < end && event.endAt > start
      )
    })
  }

  findByInterval(interval: { startAt: number; endAt: number }): Result<ScheduleEvent[]> {
    return this.store.read((draft) =>
      draft.events.filter(
        (event) =>
          event.status === 'active' &&
          overlapsWith({ startAt: event.startAt, endAt: event.endAt }, interval)
      )
    )
  }

  findDuplicate(title: string, startAt: number, now: number): Result<ScheduleEvent | undefined> {
    const normalized = truncateToMinute(startAt)
    return this.store.read((draft) =>
      draft.events.find(
        (event) =>
          event.status === 'active' &&
          event.title === title &&
          truncateToMinute(event.startAt) === normalized &&
          now - event.createdAt <= 24 * 60 * 60 * 1000
      )
    )
  }

  save(event: ScheduleEvent): Result<void> {
    return this.store.write((draft) => {
      const index = draft.events.findIndex((item) => item.eventId === event.eventId)
      if (index >= 0) draft.events[index] = event
      else draft.events.push(event)
    })
  }

  recalcConflicts(around: number): Result<number> {
    return this.store.write((draft) => {
      recalcConflictFlags(draft, around)
      return draft.events.filter((item) => item.hasConflict).length
    })
  }

  countActive(): Result<number> {
    return this.store.read((draft) => draft.events.filter((item) => item.status === 'active').length)
  }
}

/**
 * 冲突标记重算：仅在同一自然周内对有效事项做区间重叠判定，首尾相接视为不冲突。
 */
export function recalcConflictFlags(draft: DbShape, around: number): void {
  const weekStart = getWeekStart(around)
  const weekEnd = addDays(weekStart, 7)
  const scoped = draft.events.filter(
    (event) => event.status === 'active' && event.startAt < weekEnd && event.endAt > weekStart
  )
  const conflictIds = new Set<string>()
  for (let i = 0; i < scoped.length; i += 1) {
    for (let j = i + 1; j < scoped.length; j += 1) {
      const a = scoped[i]
      const b = scoped[j]
      if (!a || !b) continue
      if (overlapsWith({ startAt: a.startAt, endAt: a.endAt }, { startAt: b.startAt, endAt: b.endAt })) {
        conflictIds.add(a.eventId)
        conflictIds.add(b.eventId)
      }
    }
  }
  for (const event of draft.events) {
    if (scoped.some((item) => item.eventId === event.eventId)) {
      event.hasConflict = conflictIds.has(event.eventId)
    }
  }
}

export function weekDaysOf(weekStart: number): number[] {
  const start = getWeekStart(weekStart)
  return Array.from({ length: 7 }, (_unused, index) => addDays(start, index))
}

export function dayKey(ts: number): number {
  return startOfDay(ts)
}

export function ensureEventId(prefix = 'evt'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function notFound(): Result<never> {
  return fail('E_EVENT_NOT_FOUND', messageKeyOf('E_EVENT_NOT_FOUND'))
}

export { ok }