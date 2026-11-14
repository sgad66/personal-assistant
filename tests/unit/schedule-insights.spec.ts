import { describe, expect, it } from 'vitest'
import type { DayColumn, WeekItem } from '@shared/domain/types'
import {
  buildWeekTimeline,
  busyMinutesOf,
  dayBlocksOf,
  focusOf,
  formatCountdown,
  formatDuration,
  freeBlocksOf,
  summarizeWeek
} from '@renderer/schedule-insights'

function at(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function makeItem(startAt: number, endAt: number, patch: Partial<WeekItem> = {}): WeekItem {
  return {
    eventId: `${startAt}-${endAt}`,
    title: '测试事项',
    startAt,
    endAt,
    timeLabel: 'timed',
    hasConflict: false,
    continuation: 'none',
    ...patch
  }
}

function makeDay(date: number, items: WeekItem[], isToday = false): DayColumn {
  return { date, isToday, items }
}

describe('focusOf', () => {
  it('优先返回正在进行的事项', () => {
    const now = at(2026, 11, 14, 10, 30)
    const ongoing = makeItem(at(2026, 11, 14, 10, 0), at(2026, 11, 14, 11, 0), { title: '进行中' })
    const next = makeItem(at(2026, 11, 14, 13, 0), at(2026, 11, 14, 14, 0), { title: '稍后' })
    const focus = focusOf([next, ongoing], now)
    expect(focus?.kind).toBe('ongoing')
    expect(focus?.item.title).toBe('进行中')
    expect(focus?.minutes).toBe(30)
  })

  it('没有进行中的事项时返回最近的下一项', () => {
    const now = at(2026, 11, 14, 9, 0)
    const later = makeItem(at(2026, 11, 14, 16, 0), at(2026, 11, 14, 17, 0), { title: '下午' })
    const sooner = makeItem(at(2026, 11, 14, 11, 0), at(2026, 11, 14, 12, 0), { title: '上午' })
    const focus = focusOf([later, sooner], now)
    expect(focus?.kind).toBe('next')
    expect(focus?.item.title).toBe('上午')
    expect(focus?.minutes).toBe(120)
  })

  it('没有安排时返回 undefined', () => {
    expect(focusOf([], Date.now())).toBeUndefined()
  })
})

describe('busyMinutesOf', () => {
  it('重叠时间只统计一次', () => {
    const dayStart = at(2026, 11, 14, 0, 0)
    const items = [
      makeItem(at(2026, 11, 14, 9, 0), at(2026, 11, 14, 11, 0)),
      makeItem(at(2026, 11, 14, 10, 0), at(2026, 11, 14, 12, 0))
    ]
    expect(busyMinutesOf(items, dayStart)).toBe(180)
  })
})

describe('freeBlocksOf', () => {
  it('找出工作时段内的可用空档', () => {
    const now = at(2026, 11, 14, 9, 0)
    const items = [makeItem(at(2026, 11, 14, 10, 0), at(2026, 11, 14, 12, 0))]
    const blocks = freeBlocksOf(items, now)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].startAt).toBe(at(2026, 11, 14, 9, 0))
    expect(blocks[0].endAt).toBe(at(2026, 11, 14, 10, 0))
    expect(blocks[1].startAt).toBe(at(2026, 11, 14, 12, 0))
    expect(blocks[1].endAt).toBe(at(2026, 11, 14, 21, 0))
  })

  it('当前时间晚于工作结束时不返回空档', () => {
    expect(freeBlocksOf([], at(2026, 11, 14, 22, 0))).toEqual([])
  })
})

describe('buildWeekTimeline', () => {
  it('按时间生成区间，并为重叠事件分配并列车道', () => {
    const day = makeDay(
      at(2026, 11, 14, 0, 0),
      [
        makeItem(at(2026, 11, 14, 9, 0), at(2026, 11, 14, 10, 0)),
        makeItem(at(2026, 11, 14, 9, 30), at(2026, 11, 14, 11, 0)),
        makeItem(at(2026, 11, 14, 0, 0), at(2026, 11, 14, 0, 0), { timeLabel: 'all_day_pending' })
      ],
      true
    )
    const layout = buildWeekTimeline([day])
    const segments = layout.days[0].segments
    expect(layout.rangeStartHour).toBe(8)
    expect(layout.rangeEndHour).toBe(22)
    expect(layout.days[0].pending).toHaveLength(1)
    expect(segments).toHaveLength(2)
    expect(segments.every((segment) => segment.laneCount === 2)).toBe(true)
    expect(new Set(segments.map((segment) => segment.lane)).size).toBe(2)
    expect(segments[0].top).toBe(56)
    expect(segments[0].height).toBeGreaterThan(50)
  })

  it('把清晨事件纳入可视范围', () => {
    const day = makeDay(at(2026, 11, 14, 0, 0), [
      makeItem(at(2026, 11, 14, 6, 0), at(2026, 11, 14, 7, 0))
    ])
    const layout = buildWeekTimeline([day])
    expect(layout.rangeStartHour).toBe(6)
    expect(layout.rangeEndHour).toBe(22)
  })
})

describe('dayBlocksOf', () => {
  it('把事件映射为 24 小时带上的百分比区间', () => {
    const dayStart = at(2026, 11, 14, 0, 0)
    const blocks = dayBlocksOf([makeItem(at(2026, 11, 14, 9, 0), at(2026, 11, 14, 12, 0))], dayStart)
    expect(blocks[0].left).toBeCloseTo(37.5)
    expect(blocks[0].width).toBeCloseTo(12.5)
  })
})

describe('summarizeWeek', () => {
  it('统计总数、时长、最忙日与冲突', () => {
    const summary = summarizeWeek([
      makeDay(at(2026, 11, 14, 0, 0), [
        makeItem(at(2026, 11, 14, 9, 0), at(2026, 11, 14, 11, 0), { hasConflict: true }),
        makeItem(at(2026, 11, 14, 14, 0), at(2026, 11, 14, 15, 0))
      ]),
      makeDay(at(2026, 11, 15, 0, 0), [makeItem(at(2026, 11, 15, 9, 0), at(2026, 11, 15, 10, 0))])
    ])
    expect(summary.total).toBe(3)
    expect(summary.timedHours).toBe(4)
    expect(summary.busiestCount).toBe(2)
    expect(summary.conflicts).toBe(1)
  })
})

describe('格式化辅助函数', () => {
  it('格式化时长与倒计时', () => {
    expect(formatDuration(90 * 60_000)).toBe('1 小时 30 分')
    expect(formatDuration(45 * 60_000)).toBe('45 分钟')
    expect(formatCountdown(30)).toBe('30 分钟后')
    expect(formatCountdown(90)).toBe('1 小时 30 分后')
    expect(formatCountdown(0)).toBe('正在进行')
  })
})