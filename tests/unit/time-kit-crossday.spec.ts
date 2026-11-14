import { describe, expect, it } from 'vitest'
import { normalizeExpression } from '@shared/time-kit'

function at(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

describe('跨天时间表达式', () => {
  it('周五晚到周六凌晨按下一个周六解析', () => {
    const reference = at(2026, 11, 14, 15, 59)
    const result = normalizeExpression('周五 22:00 到周六 02:00 机房值班', reference)
    expect(result.startAt).toBe(at(2026, 11, 20, 22, 0))
    expect(result.endAt).toBe(at(2026, 11, 21, 2, 0))
  })


  it('明确的明天到后天保持自然日语义', () => {
    const reference = at(2026, 11, 14, 15, 59)
    const result = normalizeExpression('明天 22:00 到后天 02:00 值班', reference)
    expect(result.startAt).toBe(at(2026, 11, 15, 22, 0))
    expect(result.endAt).toBe(at(2026, 11, 16, 2, 0))
  })

  it('本周内的周五到周六保持同周', () => {
    const reference = at(2026, 11, 10, 10, 0)
    const result = normalizeExpression('周五 22:00 到周六 02:00 值班', reference)
    expect(result.startAt).toBe(at(2026, 11, 13, 22, 0))
    expect(result.endAt).toBe(at(2026, 11, 14, 2, 0))
  })
})