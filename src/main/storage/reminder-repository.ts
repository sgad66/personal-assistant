import type { ReminderRecord, ScheduleEvent } from '@shared/domain/types'
import { REMINDER_LEAD_MS } from '@shared/time-kit'
import { ok, type Result } from '@shared/result'
import type { DataStore } from './data-store'

export class ReminderRepository {
  constructor(private readonly store: DataStore) {}

  upsertForEvent(event: ScheduleEvent, now: number): Result<ReminderRecord[]> {
    return this.store.write((draft) => {
      this.voidDraft(draft, event.eventId, now)
      const record: ReminderRecord = {
        reminderId: `rem_${event.eventId}_${event.startAt}`,
        eventId: event.eventId,
        plannedAt: event.startAt - REMINDER_LEAD_MS,
        channel: 'in_app',
        handled: false
      }
      draft.reminders.push(record)
      return [record]
    })
  }

  voidByEvent(eventId: string, now: number): Result<void> {
    return this.store.write((draft) => {
      this.voidDraft(draft, eventId, now)
    })
  }

  private voidDraft(draft: ReturnType<DataStore['snapshot']>, eventId: string, _now: number): void {
    for (const reminder of draft.reminders) {
      if (reminder.eventId === eventId && !reminder.handled) {
        reminder.handled = true
        reminder.response = 'none'
      }
    }
  }

  findDue(now: number): Result<ReminderRecord[]> {
    return this.store.read((draft) => {
      const activeById = new Map(
        draft.events.filter((event) => event.status === 'active').map((event) => [event.eventId, event])
      )
      return draft.reminders
        .filter((reminder) => {
          if (reminder.handled) return false
          if (reminder.plannedAt > now) return false
          const event = activeById.get(reminder.eventId)
          if (!event) return false
          if (event.startAt <= now) {
            const leadAt = event.startAt - REMINDER_LEAD_MS
            return reminder.plannedAt > leadAt
          }
          return true
        })
        .sort((a, b) => a.plannedAt - b.plannedAt || a.eventId.localeCompare(b.eventId))
    })
  }

  findPending(eventId: string, plannedAt: number): Result<ReminderRecord | undefined> {
    return this.store.read((draft) =>
      draft.reminders.find(
        (reminder) =>
          reminder.eventId === eventId &&
          reminder.plannedAt === plannedAt &&
          reminder.firedAt !== undefined &&
          reminder.response === undefined
      )
    )
  }

  markDelivered(eventId: string, plannedAt: number, channel: ReminderRecord['channel'], now: number): Result<void> {
    return this.store.write((draft) => {
      const record = draft.reminders.find(
        (reminder) => reminder.eventId === eventId && reminder.plannedAt === plannedAt && !reminder.handled
      )
      if (!record) throw new Error('reminder not pending')
      record.handled = true
      record.firedAt = now
      record.channel = channel
      const event = draft.events.find((item) => item.eventId === eventId)
      if (event) event.updatedAt = now
    })
  }

  recordResponse(
    eventId: string,
    plannedAt: number,
    response: ReminderRecord['response'],
    now: number
  ): Result<ReminderRecord | undefined> {
    return this.store.write((draft) => {
      const record = draft.reminders.find((reminder) => reminder.eventId === eventId && reminder.plannedAt === plannedAt)
      if (!record) throw new Error('reminder not found')
      record.response = response
      record.respondedAt = now
      return record
    })
  }

  addSnoozeRecord(event: ScheduleEvent, plannedAt: number, _now: number): Result<ReminderRecord> {
    return this.store.write((draft) => {
      const record: ReminderRecord = {
        reminderId: `rem_${event.eventId}_${plannedAt}`,
        eventId: event.eventId,
        plannedAt,
        channel: 'in_app',
        handled: false
      }
      draft.reminders.push(record)
      return record
    })
  }

  countExpiredUnreminded(now: number): Result<number> {
    return this.store.read((draft) => {
      const unhandled = new Set(draft.reminders.filter((reminder) => !reminder.handled).map((reminder) => reminder.eventId))
      return draft.events.filter(
        (event) =>
          event.status === 'active' &&
          event.reminderStatus === 'not_reminded' &&
          event.startAt <= now &&
          unhandled.has(event.eventId)
      ).length
    })
  }

  consumeExpiredUnreminded(now: number): Result<number> {
    return this.store.write((draft) => {
      let count = 0
      for (const reminder of draft.reminders) {
        if (reminder.handled) continue
        const event = draft.events.find((item) => item.eventId === reminder.eventId)
        if (!event) continue
        if (event.status !== 'active') continue
        if (event.startAt > now) continue
        if (event.reminderStatus !== 'not_reminded') continue
        reminder.handled = true
        reminder.response = 'none'
        count += 1
      }
      return count
    })
  }

  allPending(): Result<ReminderRecord[]> {
    return this.store.read((draft) => draft.reminders.filter((reminder) => !reminder.handled))
  }

  existsPending(eventId: string): Result<boolean> {
    return this.store.read((draft) =>
      draft.reminders.some((reminder) => reminder.eventId === eventId && !reminder.handled)
    )
  }

  noop(): Result<void> {
    return ok(undefined)
  }
}