import { HOUR_MS, MINUTE_MS, startOfDay } from './time-kit'

export interface FreeBlock {
  readonly startAt: number
  readonly endAt: number
}

export function freeBlocksOf(
  items: readonly FreeBlock[],
  now = Date.now(),
  workStartHour = 9,
  workEndHour = 21,
  minMinutes = 60
): FreeBlock[] {
  const dayStart = startOfDay(now)
  const windowStart = Math.max(dayStart + workStartHour * HOUR_MS, now)
  const windowEnd = dayStart + workEndHour * HOUR_MS
  if (windowStart >= windowEnd) return []

  const busy = items
    .map((item) => ({ startAt: item.startAt, endAt: item.endAt }))
    .filter((interval) => interval.endAt > windowStart && interval.startAt < windowEnd)
    .sort((a, b) => a.startAt - b.startAt)

  const merged: { startAt: number; endAt: number }[] = []
  for (const interval of busy) {
    const last = merged[merged.length - 1]
    if (last && interval.startAt <= last.endAt) {
      last.endAt = Math.max(last.endAt, interval.endAt)
    } else {
      merged.push({ startAt: interval.startAt, endAt: interval.endAt })
    }
  }

  const blocks: FreeBlock[] = []
  let cursor = windowStart
  for (const interval of merged) {
    if (interval.startAt - cursor >= minMinutes * MINUTE_MS) {
      blocks.push({ startAt: cursor, endAt: interval.startAt })
    }
    cursor = Math.max(cursor, interval.endAt)
  }
  if (windowEnd - cursor >= minMinutes * MINUTE_MS) {
    blocks.push({ startAt: cursor, endAt: windowEnd })
  }
  return blocks
}
