import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CARE_SETTINGS,
  careDueKind,
  createCareState,
  dateKey,
  isQuietAt,
  nextCareAt,
  normalizeCareSettings
} from '@shared/care/schedule'
import { at } from '../helpers/harness'

function state(now: number) {
  return createCareState(now)
}

describe('主动关怀调度', () => {
  it('晨间计划在设定时间到 11:30 之间触发', () => {
    const now = at(2026, 11, 9, 8, 30)
    expect(careDueKind(DEFAULT_CARE_SETTINGS, state(now), now)).toBe('morning')
    const late = at(2026, 11, 9, 11, 31)
    expect(careDueKind(DEFAULT_CARE_SETTINGS, state(late), late)).not.toBe('morning')
  })

  it('22:30 到次日 08:00 不打扰', () => {
    expect(isQuietAt(at(2026, 11, 9, 23, 0))).toBe(true)
    expect(isQuietAt(at(2026, 11, 9, 7, 59))).toBe(true)
    expect(isQuietAt(at(2026, 11, 9, 12, 0))).toBe(false)
    const late = at(2026, 11, 9, 22, 45)
    expect(careDueKind(DEFAULT_CARE_SETTINGS, state(late), late)).toBeUndefined()
  })

  it('晚间复盘到点触发，且当天只触发一次', () => {
    const now = at(2026, 11, 9, 21, 30)
    expect(careDueKind(DEFAULT_CARE_SETTINGS, state(now), now)).toBe('evening')
    const once = {
      ...state(now),
      sentDate: dateKey(now),
      sentToday: 1,
      lastEveningKey: dateKey(now)
    }
    expect(careDueKind(DEFAULT_CARE_SETTINGS, once, now)).toBeUndefined()
  })

  it('周日每周复盘优先于晚间复盘', () => {
    const sunday = at(2026, 11, 15, 21, 30)
    expect(new Date(sunday).getDay()).toBe(0)
    expect(careDueKind(DEFAULT_CARE_SETTINGS, state(sunday), sunday)).toBe('weekly')
    const weeklyDone = {
      ...state(sunday),
      sentDate: dateKey(sunday),
      sentToday: 1,
      lastWeeklyKey: dateKey(sunday)
    }
    expect(careDueKind(DEFAULT_CARE_SETTINGS, weeklyDone, sunday)).toBeUndefined()
  })

  it('每天最多三条', () => {
    const now = at(2026, 11, 9, 21, 30)
    const used = {
      ...state(now),
      sentDate: dateKey(now),
      sentToday: 3
    }
    expect(careDueKind(DEFAULT_CARE_SETTINGS, used, now)).toBeUndefined()
  })

  it('关闭总开关后不再触发', () => {
    const now = at(2026, 11, 9, 8, 30)
    expect(
      careDueKind({ ...DEFAULT_CARE_SETTINGS, enabled: false }, state(now), now)
    ).toBeUndefined()
  })

  it('给出最近一次关怀时间', () => {
    const now = at(2026, 11, 9, 21, 29)
    const next = nextCareAt(DEFAULT_CARE_SETTINGS, now)
    expect(next?.kind).toBe('evening')
    expect(next?.at).toBe(at(2026, 11, 9, 21, 30))
  })

  it('设置归一化会修正时间格式并保留关闭状态', () => {
    const normalized = normalizeCareSettings({
      enabled: false,
      morningTime: '7:05',
      eveningTime: '25:00',
      weeklyWeekday: 8
    })
    expect(normalized.enabled).toBe(false)
    expect(normalized.morningTime).toBe('07:05')
    expect(normalized.eveningTime).toBe('21:30')
    expect(normalized.weeklyWeekday).toBe(0)
  })
})