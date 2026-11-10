import type {
  ConflictItem,
  DayColumn,
  ScheduleEvent,
  ScheduleEventDetail,
  WeekItem,
  WeekView
} from '@shared/domain/types'
import { addDays, getWeekStart, startOfDay, isToday, weekEndExclusive } from '@shared/time-kit'

export interface WeekAssembleInput {
  readonly events: readonly ScheduleEvent[]
  readonly weekStart: number
  readonly now: number
  readonly revision: number
}

export function assembleWeekView(input: WeekAssembleInput): WeekView {
  const weekStart = getWeekStart(input.weekStart)
  const weekEnd = weekEndExclusive(weekStart)
  const active = input.events.filter((event) => event.status === 'active')

  const days: DayColumn[] = []
  for (let index = 0; index < 7; index += 1) {
    const dayStart = addDays(weekStart, index)
    const dayEnd = addDays(dayStart, 1)
    const items: WeekItem[] = active
      .filter((event) => event.startAt < dayEnd && event.endAt > dayStart)
      .sort((a, b) => a.startAt - b.startAt || a.eventId.localeCompare(b.eventId))
      .map((event) => toWeekItem(event, dayStart, dayEnd))
    days.push({ date: dayStart, isToday: isToday(dayStart, input.now), items })
  }

  return {
    weekStart,
    weekEndExclusive: weekEnd,
    days,
    totalCount: days.reduce((sum, day) => sum + day.items.length, 0),
    revision: input.revision
  }
}

function toWeekItem(event: ScheduleEvent, dayStart: number, dayEnd: number): WeekItem {
  const startsToday = startOfDay(event.startAt) === dayStart
  const continuesBeyondDay = event.endAt > dayEnd
  const continuation: WeekItem['continuation'] = startsToday
    ? continuesBeyondDay
      ? 'starts_here'
      : 'none'
    : 'continues_from_prev'
  return {
    eventId: event.eventId,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    ...(event.location ? { location: event.location } : {}),
    timeLabel: 'timed',
    hasConflict: event.hasConflict,
    continuation
  }
}

export function toEventDetail(event: ScheduleEvent): ScheduleEventDetail {
  const dayStart = startOfDay(event.startAt)
  const item = toWeekItem(event, dayStart, addDays(dayStart, 1))
  return {
    ...item,
    ...(event.note ? { note: event.note } : {}),
    sourceModality: event.sourceModality,
    reminderStatus: event.reminderStatus,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt
  }
}

export function toConflictItem(event: ScheduleEvent): ConflictItem {
  return {
    eventId: event.eventId,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt
  }
}