import { describe, expect, it } from 'vitest'
import {
  addDays,
  formatTime,
  getWeekDays,
  getWeekStart,
  normalizeExpression,
  overlapsWith,
  spansMultipleDays,
  startOfDay,
  touchesOnly
} from '@shared/time-kit'

function at(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

describe('TimeKit 自然周', () => {
  it('任意日期返回周一 00:00', () => {
    expect(getWeekStart(at(2026, 11, 9, 13, 30))).toBe(at(2026, 11, 9, 0, 0))
    expect(getWeekStart(at(2026, 11, 15, 23, 59))).toBe(at(2026, 11, 9, 0, 0))
    expect(getWeekStart(at(2026, 11, 9, 0, 0))).toBe(at(2026, 11, 9, 0, 0))
  })

  it('跨月跨年仍以周一为首日', () => {
    const weekStart = getWeekStart(at(2027, 1, 1, 9, 0))
    expect(new Date(weekStart).getDay()).toBe(1)
    expect(getWeekStart(at(2026, 12, 31, 9, 0))).toBe(weekStart)
  })

  it('getWeekDays 恒为 7 项且连续', () => {
    const days = getWeekDays(at(2026, 11, 12, 10, 0))
    expect(days).toHaveLength(7)
    expect(days[0]).toBe(at(2026, 11, 9, 0, 0))
    expect(days[6]).toBe(at(2026, 11, 15, 0, 0))
    expect(addDays(days[0] as number, 1)).toBe(days[1])
  })
})

describe('TimeKit 相对时间归一化', () => {
  it('T1 周四 20:00 说“明天下午三点开会”得到周五 15:00-16:00', () => {
    const reference = at(2026, 11, 5, 20, 0)
    const result = normalizeExpression('明天下午三点开会', reference)
    expect(result.startAt).toBe(at(2026, 11, 6, 15, 0))
    expect(result.endAt).toBe(at(2026, 11, 6, 16, 0))
    expect(result.explicitEnd).toBe(false)
  })

  it('T2 “下周三上午碰一下方案”得到下一自然周周三 09:00', () => {
    const reference = at(2026, 11, 9, 10, 0)
    const result = normalizeExpression('下周三上午碰一下方案', reference)
    expect(result.startAt).toBe(at(2026, 11, 18, 9, 0))
    expect(result.endAt).toBe(at(2026, 11, 18, 10, 0))
  })

  it('上午默认 09:00，下午默认 15:00', () => {
    expect(normalizeExpression('明天上午讨论', at(2026, 11, 9, 10, 0)).startAt).toBe(
      at(2026, 11, 10, 9, 0)
    )
    expect(normalizeExpression('明天下午讨论', at(2026, 11, 9, 10, 0)).startAt).toBe(
      at(2026, 11, 10, 15, 0)
    )
  })

  it('未指明日期且时刻已过时顺延次日', () => {
    const reference = at(2026, 11, 9, 20, 0)
    const result = normalizeExpression('下午三点开会', reference)
    expect(result.startAt).toBe(at(2026, 11, 10, 15, 0))
  })

  it('未指明时长默认 1 小时', () => {
    const reference = at(2026, 11, 9, 10, 0)
    const result = normalizeExpression('明天上午9点晨会', reference)
    expect(result.startAt).toBe(at(2026, 11, 10, 9, 0))
    expect((result.endAt ?? 0) - (result.startAt ?? 0)).toBe(60 * 60 * 1000)
  })

  it('仅给出日期与时段时使用默认时刻', () => {
    const result = normalizeExpression('下周一上午', at(2026, 11, 9, 10, 0))
    expect(result.startAt).toBe(at(2026, 11, 16, 9, 0))
  })

  it('未给出时刻时 timeFound 为 false', () => {
    const result = normalizeExpression('下周一有个会', at(2026, 11, 9, 10, 0))
    expect(result.dateFound).toBe(true)
    expect(result.timeFound).toBe(false)
  })

  it('秒与毫秒被截断到分钟', () => {
    const reference = at(2026, 11, 9, 10, 0) + 45_000
    const result = normalizeExpression('明天上午9点', reference)
    expect((result.startAt ?? 0) % 60_000).toBe(0)
    expect(formatTime(result.startAt ?? 0)).toBe('09:00')
  })
})

describe('TimeKit 区间判定', () => {
  it('T7 首尾相接不算冲突', () => {
    const a = { startAt: at(2026, 11, 9, 15, 0), endAt: at(2026, 11, 9, 16, 0) }
    const b = { startAt: at(2026, 11, 9, 16, 0), endAt: at(2026, 11, 9, 17, 0) }
    expect(overlapsWith(a, b)).toBe(false)
    expect(touchesOnly(a, b)).toBe(true)
  })

  it('重叠区间判定为冲突', () => {
    const a = { startAt: at(2026, 11, 9, 15, 0), endAt: at(2026, 11, 9, 16, 0) }
    const b = { startAt: at(2026, 11, 9, 15, 30), endAt: at(2026, 11, 9, 16, 30) }
    expect(overlapsWith(a, b)).toBe(true)
  })

  it('T5 显式结束早于开始不静默修正', () => {
    const result = normalizeExpression('明天 15:00 到 14:00 开会', at(2026, 11, 9, 10, 0))
    expect(result.explicitEnd).toBe(true)
    expect(result.startAt).toBe(at(2026, 11, 10, 15, 0))
    expect(result.endAt).toBe(at(2026, 11, 10, 14, 0))
    expect((result.endAt ?? 0) <= (result.startAt ?? 0)).toBe(true)
  })

  it('T17 跨天区间正确换算到次日', () => {
    const result = normalizeExpression('周五 22:00 至周六 02:00 机房值班', at(2026, 11, 9, 10, 0))
    expect(result.startAt).toBe(at(2026, 11, 13, 22, 0))
    expect(result.endAt).toBe(at(2026, 11, 14, 2, 0))
    expect(spansMultipleDays({ startAt: result.startAt ?? 0, endAt: result.endAt ?? 0 })).toBe(true)
  })

  it('跨天判定与同日判定', () => {
    expect(
      spansMultipleDays({ startAt: at(2026, 11, 13, 22, 0), endAt: at(2026, 11, 14, 2, 0) })
    ).toBe(true)
    expect(
      spansMultipleDays({ startAt: at(2026, 11, 13, 22, 0), endAt: at(2026, 11, 13, 23, 0) })
    ).toBe(false)
  })

  it('startOfDay 归零本地时刻', () => {
    expect(startOfDay(at(2026, 11, 9, 18, 40))).toBe(at(2026, 11, 9, 0, 0))
  })
})