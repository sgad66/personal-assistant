import { describe, expect, it } from 'vitest'
import {
  computeGoalNextRun,
  goalCadenceLabel,
  goalNextRunLabel,
  initialGoalNextRun,
  isGoalDue,
  normalizeGoalDraft
} from '@shared/goals/schedule'
import { at } from '../helpers/harness'

describe('目标调度纯函数', () => {
  const shape = {
    cadence: 'daily' as const,
    hour: 9,
    minute: 0,
    weekday: 1,
    intervalMinutes: 60
  }

  it('每天：当天时间未到从今天开始', () => {
    expect(computeGoalNextRun(shape, at(2026, 11, 9, 8, 30))).toBe(at(2026, 11, 9, 9, 0))
  })

  it('每天：当天时间已过则顺延到明天', () => {
    expect(computeGoalNextRun(shape, at(2026, 11, 9, 9, 0))).toBe(at(2026, 11, 10, 9, 0))
    expect(computeGoalNextRun(shape, at(2026, 11, 9, 22, 0))).toBe(at(2026, 11, 10, 9, 0))
  })

  it('工作日：周五晚上顺延到下周一', () => {
    expect(
      computeGoalNextRun({ ...shape, cadence: 'weekdays' }, at(2026, 11, 13, 18, 0))
    ).toBe(at(2026, 11, 16, 9, 0))
  })

  it('每周：按指定星期计算，跨周正确', () => {
    expect(
      computeGoalNextRun({ ...shape, cadence: 'weekly', weekday: 1 }, at(2026, 11, 9, 8, 0))
    ).toBe(at(2026, 11, 9, 9, 0))
    expect(
      computeGoalNextRun({ ...shape, cadence: 'weekly', weekday: 1 }, at(2026, 11, 9, 10, 0))
    ).toBe(at(2026, 11, 16, 9, 0))
  })

  it('间隔：从当前时刻往后推进', () => {
    expect(
      computeGoalNextRun({ ...shape, cadence: 'interval', intervalMinutes: 90 }, at(2026, 11, 9, 8, 0))
    ).toBe(at(2026, 11, 9, 9, 30))
  })

  it('一次性：过期后不再安排下一次', () => {
    expect(
      computeGoalNextRun(
        { ...shape, cadence: 'once', onceAt: at(2026, 11, 9, 21, 0) },
        at(2026, 11, 9, 21, 0)
      )
    ).toBeUndefined()
  })

  it('创建时首次跟进时间合理', () => {
    const now = at(2026, 11, 9, 10, 0)
    expect(initialGoalNextRun({ ...normalizeGoalDraft({ title: '复盘' }, now), cadence: 'interval', intervalMinutes: 60 }, now)).toBe(
      now + 60 * 60_000
    )
    expect(initialGoalNextRun(normalizeGoalDraft({ title: '复盘', cadence: 'daily', hour: 21 }, now), now)).toBe(
      at(2026, 11, 9, 21, 0)
    )
  })

  it('草稿归一化：默认每日 09:00，间隔限制在 15 分钟到 1 天', () => {
    const now = at(2026, 11, 9, 10, 0)
    const daily = normalizeGoalDraft({ title: '  论文  ', instruction: '' }, now)
    expect(daily.title).toBe('论文')
    expect(daily.instruction).toBe('论文')
    expect(daily.cadence).toBe('daily')
    expect(daily.hour).toBe(9)
    expect(daily.minute).toBe(0)

    const interval = normalizeGoalDraft({ title: '写作', cadence: 'interval', intervalMinutes: 1 }, now)
    expect(interval.intervalMinutes).toBe(15)
    const longInterval = normalizeGoalDraft({ title: '写作', cadence: 'interval', intervalMinutes: 5000 }, now)
    expect(longInterval.intervalMinutes).toBe(1440)
  })

  it('节奏与下一次时间文案稳定', () => {
    expect(goalCadenceLabel({ ...shape, cadence: 'daily' })).toBe('每天 09:00')
    expect(goalCadenceLabel({ ...shape, cadence: 'weekly', weekday: 3 })).toBe('每周三 09:00')
    expect(goalCadenceLabel({ ...shape, cadence: 'interval', intervalMinutes: 120 })).toBe('每 2 小时')
    expect(goalNextRunLabel(at(2026, 11, 9, 21, 0), at(2026, 11, 9, 10, 0))).toBe('今天 21:00')
    expect(goalNextRunLabel(at(2026, 11, 10, 9, 0), at(2026, 11, 9, 10, 0))).toBe('明天 09:00')
  })

  it('到点判定只对进行中的目标生效', () => {
    const now = at(2026, 11, 9, 21, 0)
    expect(isGoalDue({ status: 'active', nextRunAt: now }, now)).toBe(true)
    expect(isGoalDue({ status: 'paused', nextRunAt: now }, now)).toBe(false)
    expect(isGoalDue({ status: 'active', nextRunAt: now + 1 }, now)).toBe(false)
  })
})