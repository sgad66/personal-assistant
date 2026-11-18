import { describe, expect, it } from 'vitest'
import type { WeekView } from '@shared/domain/types'
import { applyWeekOutcome, isCurrentWeek, planWeekRequest, weekNavOf } from '@shared/week-nav'
import { addWeeks, getWeekStart } from '@shared/time-kit'

function at(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

function weekOf(start: number): WeekView {
  return {
    weekStart: start,
    weekEndExclusive: start + 7 * 24 * 60 * 60 * 1000,
    days: [],
    totalCount: 0,
    revision: 1
  }
}

const MONDAY = at(2026, 11, 16, 0, 0)

describe('周导航两态', () => {
  it('本周内为「本周」且 aria-disabled', () => {
    const nav = weekNavOf(MONDAY, at(2026, 11, 16, 10, 0))
    expect(nav.isCurrentWeek).toBe(true)
    expect(nav.ariaDisabled).toBe(true)
    expect(nav.labelKey).toBe('week.navThisWeek')
    expect(nav.hintKey).toBe('week.navThisWeekHint')
    expect(nav.currentWeekStart).toBe(MONDAY)
  })

  it('非本周为「回到本周」且可点', () => {
    const nav = weekNavOf(MONDAY, at(2026, 11, 23, 10, 0))
    expect(nav.isCurrentWeek).toBe(false)
    expect(nav.ariaDisabled).toBe(false)
    expect(nav.labelKey).toBe('week.navBackToThisWeek')
    expect(nav.hintKey).toBe('week.navBackHint')
  })

  it('跨年同一周仍判本周', () => {
    const viewStart = at(2025, 12, 29, 0, 0)
    const now = at(2026, 1, 2, 10, 0)
    expect(getWeekStart(viewStart) === getWeekStart(now)).toBe(true)
    expect(isCurrentWeek(viewStart, now)).toBe(true)
    const nav = weekNavOf(viewStart, now)
    expect(nav.labelKey).toBe('week.navThisWeek')
  })

  it('决策函数幂等且不修改入参', () => {
    const first = weekNavOf(MONDAY, at(2026, 11, 16, 10, 0))
    const second = weekNavOf(MONDAY, at(2026, 11, 16, 10, 0))
    expect(second).toEqual(first)
  })
})

describe('周请求计划', () => {
  it('step/refresh/today 三种 kind', () => {
    expect(planWeekRequest(MONDAY, { kind: 'step', delta: -1 }, 0)).toBe(addWeeks(MONDAY, -1))
    expect(planWeekRequest(MONDAY, { kind: 'step', delta: 1 }, 0)).toBe(addWeeks(MONDAY, 1))
    expect(planWeekRequest(MONDAY, { kind: 'refresh' }, 0)).toBe(MONDAY)
    expect(planWeekRequest(MONDAY, { kind: 'today' }, at(2026, 11, 18, 9, 0))).toBe(
      getWeekStart(at(2026, 11, 18, 9, 0))
    )
  })
})

describe('加载结果提交', () => {
  it('失败不推进锚点并保留旧周', () => {
    const prev = { anchor: MONDAY, week: weekOf(MONDAY) }
    const next = applyWeekOutcome(prev, addWeeks(MONDAY, 1), 'failure')
    expect(next.anchor).toBe(MONDAY)
    expect(next.week).toEqual(prev.week)
  })

  it('成功推进锚点并写入新周', () => {
    const target = addWeeks(MONDAY, 1)
    const view = weekOf(target)
    const next = applyWeekOutcome({ anchor: MONDAY, week: weekOf(MONDAY) }, target, 'success', view)
    expect(next.anchor).toBe(target)
    expect(next.week).toBe(view)
  })
})