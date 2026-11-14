import { describe, expect, it } from 'vitest'
import type { DayColumn, WeekItem } from '@shared/domain/types'
import {
  ALL_WIDGET_IDS,
  DEFAULT_WIDGET_IDS,
  DEFAULT_WIDGET_LAYOUT,
  LAYOUT_PRESETS,
  WIDGET_ROWS,
  addWidget,
  attentionOf,
  moveWidget,
  parseFocusState,
  parseHabitState,
  parseWidgetLayout,
  removeWidget,
  serializeWidgetLayout,
  setWidgetRows,
  setWidgetSpan,
  toggleHabitState,
  upcomingOf,
  workLifeStatsOf
} from '@renderer/home-layout'

function at(year: number, month: number, day: number, hour = 0, minute = 0): number {
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

function makeDay(date: number, items: WeekItem[]): DayColumn {
  return { date, isToday: false, items }
}

describe('看板布局', () => {
  it('无存储或非法内容时使用默认布局', () => {
    const expected = DEFAULT_WIDGET_LAYOUT.map((item) => ({ ...item }))
    expect(parseWidgetLayout(null)).toEqual(expected)
    expect(parseWidgetLayout('not-json')).toEqual(expected)
    expect(parseWidgetLayout('{"version":1}')).toEqual(expected)
    expect(DEFAULT_WIDGET_IDS).toEqual(['rhythm', 'today', 'week', 'free', 'templates'])
  })

  it('兼容旧的字符串数组，并过滤未知组件与重复项', () => {
    expect(parseWidgetLayout('["today","unknown","today","week"]')).toEqual([
      { id: 'today', span: 1, rows: 1 },
      { id: 'week', span: 1, rows: 2 }
    ])
    expect(parseWidgetLayout('["rhythm"]')).toEqual([{ id: 'rhythm', span: 2, rows: 1 }])
    expect(parseWidgetLayout('[]')).toEqual([])
  })

  it('支持带宽高与行高的新布局格式', () => {
    expect(
      parseWidgetLayout(
        '[{"id":"rhythm","span":1,"rows":2},{"id":"today","span":2},{"id":"rhythm","span":2}]'
      )
    ).toEqual([
      { id: 'rhythm', span: 1, rows: 2 },
      { id: 'today', span: 2, rows: 1 }
    ])
  })

  it('支持添加、移除、上下移动和调整尺寸', () => {
    const base = [
      { id: 'rhythm' as const, span: 2 as const, rows: 1 as const },
      { id: 'today' as const, span: 1 as const, rows: 1 as const }
    ]
    expect(addWidget(base, 'week')).toEqual([
      { id: 'rhythm', span: 2, rows: 1 },
      { id: 'today', span: 1, rows: 1 },
      { id: 'week', span: 1, rows: 2 }
    ])
    expect(addWidget(base, 'today')).toEqual(base)
    expect(removeWidget(base, 'today')).toEqual([{ id: 'rhythm', span: 2, rows: 1 }])
    expect(
      moveWidget([...base, { id: 'week' as const, span: 1 as const, rows: 2 as const }], 'week', -1)
    ).toEqual([
      { id: 'rhythm', span: 2, rows: 1 },
      { id: 'week', span: 1, rows: 2 },
      { id: 'today', span: 1, rows: 1 }
    ])
    expect(setWidgetSpan(base, 'today', 2)).toEqual([
      { id: 'rhythm', span: 2, rows: 1 },
      { id: 'today', span: 2, rows: 1 }
    ])
    expect(setWidgetRows(base, 'today', 2)).toEqual([
      { id: 'rhythm', span: 2, rows: 1 },
      { id: 'today', span: 1, rows: 2 }
    ])
    expect(serializeWidgetLayout(base)).toBe(
      '[{"id":"rhythm","span":2,"rows":1},{"id":"today","span":1,"rows":1}]'
    )
  })
})

describe('工作生活时间分布', () => {
  it('分别统计工作时段、晚间、周末与工作空档', () => {
    const days = [
      makeDay(at(2026, 11, 9), [
        makeItem(at(2026, 11, 9, 10), at(2026, 11, 9, 11)),
        makeItem(at(2026, 11, 9, 19), at(2026, 11, 9, 20))
      ]),
      makeDay(at(2026, 11, 14), [makeItem(at(2026, 11, 14, 9), at(2026, 11, 14, 10))])
    ]
    const stats = workLifeStatsOf(days)

    expect(stats.workMinutes).toBe(60)
    expect(stats.eveningMinutes).toBe(60)
    expect(stats.weekendMinutes).toBe(60)
    expect(stats.scheduledMinutes).toBe(180)
    expect(stats.workWindowMinutes).toBe(540)
    expect(stats.workFreeMinutes).toBe(480)
  })

  it('重叠时间不重复统计', () => {
    const day = makeDay(at(2026, 11, 9), [
      makeItem(at(2026, 11, 9, 10), at(2026, 11, 9, 12)),
      makeItem(at(2026, 11, 9, 11), at(2026, 11, 9, 13))
    ])
    expect(workLifeStatsOf([day]).workMinutes).toBe(180)
  })
})

describe('接下来与需留意', () => {
  it('按开始时间返回未来的 timetable，限制数量并排除待定项', () => {
    const days = [
      makeDay(at(2026, 11, 9), [
        makeItem(at(2026, 11, 9, 8), at(2026, 11, 9, 9)),
        makeItem(at(2026, 11, 9, 10), at(2026, 11, 9, 11)),
        makeItem(at(2026, 11, 9, 0), at(2026, 11, 9, 0), { timeLabel: 'all_day_pending' })
      ]),
      makeDay(at(2026, 11, 10), [makeItem(at(2026, 11, 10, 9), at(2026, 11, 10, 10))])
    ]
    const upcoming = upcomingOf(days, at(2026, 11, 9, 9), 2)
    expect(upcoming).toHaveLength(2)
    expect(upcoming[0].item.startAt).toBe(at(2026, 11, 9, 10))
    expect(upcoming[1].item.startAt).toBe(at(2026, 11, 10, 9))
  })

  it('收集冲突与待定事项', () => {
    const days = [
      makeDay(at(2026, 11, 9), [
        makeItem(at(2026, 11, 9, 10), at(2026, 11, 9, 11), { hasConflict: true }),
        makeItem(at(2026, 11, 9, 0), at(2026, 11, 9, 0), { timeLabel: 'all_day_pending' })
      ])
    ]
    const entries = attentionOf(days)
    expect(entries).toHaveLength(2)
    expect(entries[0].kind).toBe('conflict')
    expect(entries[1].kind).toBe('pending')
  })
})

describe('习惯打卡', () => {
  it('按日期重置，并支持切换完成状态', () => {
    expect(parseHabitState(null, '2026-11-14')).toEqual({ date: '2026-11-14', done: [] })
    expect(parseHabitState('{"date":"2026-11-13","done":["water"]}', '2026-11-14')).toEqual({
      date: '2026-11-14',
      done: []
    })

    const once = toggleHabitState(null, 'water', '2026-11-14')
    expect(parseHabitState(once, '2026-11-14').done).toEqual(['water'])
    const twice = toggleHabitState(once, 'water', '2026-11-14')
    expect(parseHabitState(twice, '2026-11-14').done).toEqual([])
  })
})

describe('专注计时状态', () => {
  it('恢复运行中的剩余时间，并在过期后标记完成', () => {
    const now = at(2026, 11, 14, 10, 0)
    const running = parseFocusState(JSON.stringify({ endsAt: now + 60_000, running: true }), now)
    expect(running.running).toBe(true)
    expect(running.remainingMs).toBe(60_000)

    const finished = parseFocusState(JSON.stringify({ endsAt: now - 1_000, running: true }), now)
    expect(finished.completed).toBe(true)
    expect(finished.running).toBe(false)

    const paused = parseFocusState(JSON.stringify({ remainingMs: 90_000, running: false }), now)
    expect(paused.remainingMs).toBe(90_000)
    expect(paused.running).toBe(false)
  })
})
describe('尺寸规范与预设布局', () => {
  it('所有组件都有明确的行高规范', () => {
    expect([...ALL_WIDGET_IDS].sort()).toEqual(Object.keys(WIDGET_ROWS).sort())
    for (const id of ALL_WIDGET_IDS) {
      expect([1, 2]).toContain(WIDGET_ROWS[id])
    }
  })

  it('每个预设都包含合法、不重复的组件与行高', () => {
    expect(LAYOUT_PRESETS.length).toBeGreaterThanOrEqual(4)
    for (const preset of LAYOUT_PRESETS) {
      expect(preset.items.length).toBeGreaterThan(0)
      const ids = preset.items.map((item) => item.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const item of preset.items) {
        expect(ALL_WIDGET_IDS).toContain(item.id)
        expect([1, 2]).toContain(item.span)
        expect([1, 2]).toContain(item.rows)
      }
    }
  })
})