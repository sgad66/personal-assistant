import type { DayColumn, WeekItem } from '@shared/domain/types'
import { DAY_MS, HOUR_MS, MINUTE_MS, startOfDay } from '@shared/time-kit'

export { freeBlocksOf, type FreeBlock } from '@shared/free-blocks'

export const HOUR_HEIGHT = 56
export const MIN_SEGMENT_HEIGHT = 22

export interface DayFocus {
  readonly kind: 'ongoing' | 'next'
  readonly item: WeekItem
  readonly minutes: number
}

export interface DayBlock {
  readonly item: WeekItem
  readonly left: number
  readonly width: number
}

export interface TimelineSegment {
  readonly item: WeekItem
  readonly top: number
  readonly height: number
  lane: number
  laneCount: number
  readonly startAt: number
  readonly endAt: number
}

export interface DayTimeline {
  readonly day: DayColumn
  readonly segments: readonly TimelineSegment[]
  readonly pending: readonly WeekItem[]
}

export interface TimelineLayout {
  readonly minuteHeight: number
  readonly rangeStartHour: number
  readonly rangeEndHour: number
  readonly totalHeight: number
  readonly days: readonly DayTimeline[]
}

export interface WeekSummary {
  readonly total: number
  readonly timedHours: number
  readonly busiestDate?: number
  readonly busiestCount: number
  readonly conflicts: number
}

export function focusOf(items: readonly WeekItem[], now = Date.now()): DayFocus | undefined {
  const ongoing = items
    .filter((item) => item.startAt <= now && item.endAt > now)
    .sort((a, b) => a.endAt - b.endAt)[0]
  if (ongoing) {
    return { kind: 'ongoing', item: ongoing, minutes: Math.max(0, Math.ceil((ongoing.endAt - now) / MINUTE_MS)) }
  }
  const next = items
    .filter((item) => item.startAt > now)
    .sort((a, b) => a.startAt - b.startAt)[0]
  if (next) {
    return { kind: 'next', item: next, minutes: Math.max(0, Math.ceil((next.startAt - now) / MINUTE_MS)) }
  }
  return undefined
}

export function busyMinutesOf(items: readonly WeekItem[], dayStart: number): number {
  const intervals = items
    .map((item) => ({
      startAt: Math.max(item.startAt, dayStart),
      endAt: Math.min(item.endAt, dayStart + DAY_MS)
    }))
    .filter((interval) => interval.endAt > interval.startAt)
    .sort((a, b) => a.startAt - b.startAt)
  let total = 0
  let currentStart: number | undefined
  let currentEnd = 0
  for (const interval of intervals) {
    if (currentStart === undefined) {
      currentStart = interval.startAt
      currentEnd = interval.endAt
      continue
    }
    if (interval.startAt <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endAt)
    } else {
      total += currentEnd - currentStart
      currentStart = interval.startAt
      currentEnd = interval.endAt
    }
  }
  if (currentStart !== undefined) total += currentEnd - currentStart
  return Math.round(total / MINUTE_MS)
}

export function dayBlocksOf(items: readonly WeekItem[], dayStart: number): DayBlock[] {
  const dayEnd = dayStart + DAY_MS
  return items
    .map((item) => {
      const startAt = Math.max(item.startAt, dayStart)
      const endAt = Math.min(item.endAt, dayEnd)
      if (endAt <= startAt) return undefined
      const left = ((startAt - dayStart) / DAY_MS) * 100
      const width = Math.max(0.8, ((endAt - startAt) / DAY_MS) * 100)
      return { item, left, width: Math.min(100 - left, width) }
    })
    .filter((block): block is DayBlock => block !== undefined)
}

export function buildWeekTimeline(
  days: readonly DayColumn[],
  hourHeight = HOUR_HEIGHT
): TimelineLayout {
  let rangeStartHour = 8
  let rangeEndHour = 22

  for (const day of days) {
    const dayStart = startOfDay(day.date)
    for (const item of day.items) {
      if (item.timeLabel !== 'timed') continue
      const startHour = clampHour((item.startAt - dayStart) / HOUR_MS)
      const rawEndHour = clampHour((item.endAt - dayStart) / HOUR_MS)
      const endHour = rawEndHour === 0 ? 24 : rawEndHour
      rangeStartHour = Math.min(rangeStartHour, Math.floor(startHour))
      rangeEndHour = Math.max(rangeEndHour, Math.ceil(endHour))
    }
  }

  rangeStartHour = Math.max(0, Math.min(18, rangeStartHour))
  rangeEndHour = Math.max(rangeStartHour + 6, Math.min(24, rangeEndHour))

  const minuteHeight = hourHeight / 60
  const daysLayout: DayTimeline[] = days.map((day) => {
    const dayStart = startOfDay(day.date)
    const dayEnd = dayStart + DAY_MS
    const pending = day.items.filter((item) => item.timeLabel === 'all_day_pending')
    const segments = day.items
      .filter((item) => item.timeLabel === 'timed')
      .map((item) => {
        const startAt = Math.max(item.startAt, dayStart)
        const endAt = Math.min(item.endAt, dayEnd)
        if (endAt <= startAt) return undefined
        const top = ((startAt - dayStart) / HOUR_MS - rangeStartHour) * hourHeight
        const height = Math.max(
          MIN_SEGMENT_HEIGHT,
          ((endAt - startAt) / HOUR_MS) * hourHeight - 2
        )
        return {
          item,
          top,
          height,
          lane: 0,
          laneCount: 1,
          startAt,
          endAt
        }
      })
      .filter((segment): segment is TimelineSegment => segment !== undefined)
    assignLanes(segments)
    return { day, segments, pending }
  })

  return {
    minuteHeight,
    rangeStartHour,
    rangeEndHour,
    totalHeight: (rangeEndHour - rangeStartHour) * hourHeight,
    days: daysLayout
  }
}

export function nowLineTop(
  day: DayColumn,
  now: number,
  rangeStartHour: number,
  totalHeight: number,
  hourHeight = HOUR_HEIGHT
): number | undefined {
  if (!day.isToday) return undefined
  const dayStart = startOfDay(now)
  const top = ((now - dayStart) / HOUR_MS - rangeStartHour) * hourHeight
  if (top < 0 || top > totalHeight) return undefined
  return top
}

export function summarizeWeek(days: readonly DayColumn[]): WeekSummary {
  let total = 0
  let timedMinutes = 0
  let busiestDate: number | undefined
  let busiestCount = 0
  let conflicts = 0

  for (const day of days) {
    total += day.items.length
    if (day.items.length > busiestCount) {
      busiestCount = day.items.length
      busiestDate = day.date
    }
    for (const item of day.items) {
      if (item.timeLabel === 'timed') {
        const dayStart = startOfDay(day.date)
        const startAt = Math.max(item.startAt, dayStart)
        const endAt = Math.min(item.endAt, dayStart + DAY_MS)
        if (endAt > startAt) timedMinutes += (endAt - startAt) / MINUTE_MS
      }
      if (item.hasConflict) conflicts += 1
    }
  }

  return {
    total,
    timedHours: timedMinutes / 60,
    busiestDate,
    busiestCount,
    conflicts
  }
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / MINUTE_MS))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} 分钟`
  if (minutes === 0) return `${hours} 小时`
  return `${hours} 小时 ${minutes} 分`
}

export function formatCountdown(minutes: number): string {
  if (minutes <= 0) return '正在进行'
  if (minutes < 60) return `${minutes} 分钟后`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时后` : `${hours} 小时 ${rest} 分后`
}

function assignLanes(segments: TimelineSegment[]): void {
  const sorted = [...segments].sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt)
  let cluster: TimelineSegment[] = []
  let clusterEnd = 0

  const flush = (): void => {
    if (cluster.length === 0) return
    const lanes: TimelineSegment[][] = []
    for (const segment of cluster) {
      let laneIndex = lanes.findIndex(
        (lane) => (lane[lane.length - 1]?.endAt ?? 0) <= segment.startAt
      )
      if (laneIndex === -1) {
        lanes.push([segment])
        laneIndex = lanes.length - 1
      }
      lanes[laneIndex].push(segment)
      segment.lane = laneIndex
    }
    for (const segment of cluster) {
      segment.laneCount = lanes.length
    }
    cluster = []
    clusterEnd = 0
  }

  for (const segment of sorted) {
    if (cluster.length > 0 && segment.startAt >= clusterEnd) flush()
    cluster.push(segment)
    clusterEnd = Math.max(clusterEnd, segment.endAt)
  }
  flush()
}

function clampHour(value: number): number {
  return Math.max(0, Math.min(24, value))
}
