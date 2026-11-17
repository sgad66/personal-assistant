import { describe, expect, it } from 'vitest'
import { at, createHarness } from '../helpers/harness'
import { assembleWeekView } from '@main/services/week-view-assembler'
import { applyWeekOutcome, planWeekRequest } from '@shared/week-nav'
import type { ScheduleEvent } from '@shared/domain/types'

function event(overrides: Partial<ScheduleEvent>): ScheduleEvent {
  return {
    eventId: 'evt_default',
    title: '默认事项',
    startAt: at(2026, 11, 9, 9, 0),
    endAt: at(2026, 11, 9, 10, 0),
    sourceModality: 'text',
    hasConflict: false,
    status: 'active',
    reminderStatus: 'not_reminded',
    snoozeCount: 0,
    createdAt: at(2026, 11, 8, 9, 0),
    updatedAt: at(2026, 11, 8, 9, 0),
    ...overrides
  }
}

describe('周日程表装配', () => {
  it('恒为周一到周日七列', () => {
    const view = assembleWeekView({
      events: [],
      weekStart: at(2026, 11, 11, 10, 0),
      now: at(2026, 11, 9, 10, 0),
      revision: 1
    })
    expect(view.days).toHaveLength(7)
    expect(view.days[0]?.date).toBe(at(2026, 11, 9, 0, 0))
    expect(view.days[6]?.date).toBe(at(2026, 11, 15, 0, 0))
    expect(view.days[0]?.isToday).toBe(true)
    expect(view.days[1]?.isToday).toBe(false)
  })

  it('同日按开始时间升序', () => {
    const view = assembleWeekView({
      events: [
        event({ eventId: 'late', startAt: at(2026, 11, 9, 14, 0), endAt: at(2026, 11, 9, 15, 0) }),
        event({ eventId: 'early', startAt: at(2026, 11, 9, 9, 0), endAt: at(2026, 11, 9, 10, 0) })
      ],
      weekStart: at(2026, 11, 9, 0, 0),
      now: at(2026, 11, 9, 10, 0),
      revision: 1
    })
    expect(view.days[0]?.items.map((item) => item.eventId)).toEqual(['early', 'late'])
  })

  it('已取消事项不出现在周视图', () => {
    const view = assembleWeekView({
      events: [event({ eventId: 'cancelled', status: 'cancelled' })],
      weekStart: at(2026, 11, 9, 0, 0),
      now: at(2026, 11, 9, 10, 0),
      revision: 1
    })
    expect(view.totalCount).toBe(0)
  })

  it('T17 跨天事项在起止两日双列可见', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    harness.schedule.createEvent({
      title: '机房值班',
      startAt: at(2026, 11, 13, 22, 0),
      endAt: at(2026, 11, 14, 2, 0),
      sourceModality: 'text'
    })
    const week = harness.schedule.getWeek(at(2026, 11, 9, 0, 0))
    expect(week.ok).toBe(true)
    if (!week.ok) return
    const friday = week.data.days[4]
    const saturday = week.data.days[5]
    expect(friday?.items).toHaveLength(1)
    expect(friday?.items[0]?.continuation).toBe('starts_here')
    expect(saturday?.items).toHaveLength(1)
    expect(saturday?.items[0]?.continuation).toBe('continues_from_prev')
    expect(week.data.days.flatMap((day) => day.items)).toHaveLength(2)
    expect(harness.store.snapshot().reminders).toHaveLength(1)
  })

  it('冲突标记在周视图中可见', () => {
    const harness = createHarness(at(2026, 11, 9, 10, 0))
    const first = harness.schedule.createEvent({
      title: 'A',
      startAt: at(2026, 11, 9, 15, 0),
      endAt: at(2026, 11, 9, 16, 0),
      sourceModality: 'text'
    })
    expect(first.ok).toBe(true)
    harness.schedule.createEvent(
      {
        title: 'B',
        startAt: at(2026, 11, 9, 15, 30),
        endAt: at(2026, 11, 9, 16, 30),
        sourceModality: 'text'
      },
      { allowConflict: true }
    )
    const week = harness.schedule.getWeek(at(2026, 11, 9, 0, 0))
    if (!week.ok) return
    const items = week.data.days[0]?.items ?? []
    expect(items).toHaveLength(2)
    expect(items.every((item) => item.hasConflict)).toBe(true)
  })

  it('连续装配五个周只读不写盘', () => {
    const events = [event({})]
    const before = JSON.stringify(events)
    for (let index = 0; index < 5; index += 1) {
      assembleWeekView({
        events,
        weekStart: at(2026, 11, 9 + index * 7, 0, 0),
        now: at(2026, 11, 9, 10, 0),
        revision: 1
      })
    }
    expect(JSON.stringify(events)).toBe(before)
  })

  it('加载失败不推进锚点并保留旧周', () => {
    const view = assembleWeekView({
      events: [event({})],
      weekStart: at(2026, 11, 9, 0, 0),
      now: at(2026, 11, 9, 10, 0),
      revision: 1
    })
    const prev = { anchor: at(2026, 11, 9, 0, 0), week: view }
    const next = applyWeekOutcome(prev, at(2026, 11, 16, 0, 0), 'failure')
    expect(next.anchor).toBe(prev.anchor)
    expect(next.week).toEqual(view)
  })

  it('刷新计划保持所看周锚点', () => {
    const anchor = at(2026, 11, 16, 0, 0)
    expect(planWeekRequest(anchor, { kind: 'refresh' }, at(2026, 11, 9, 10, 0))).toBe(anchor)
  })
})