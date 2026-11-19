import type { CareKind, CareSettings, CareState } from '@shared/domain/types'
import { addDays, startOfDay } from '@shared/time-kit'

export const DEFAULT_CARE_SETTINGS: CareSettings = {
  enabled: true,
  morningEnabled: true,
  morningTime: '08:30',
  eveningEnabled: true,
  eveningTime: '21:30',
  weeklyEnabled: true,
  weeklyWeekday: 0,
  weeklyTime: '20:30',
  notify: true
}

export const CARE_QUIET_START = '22:30'
export const CARE_QUIET_END = '08:00'
export const CARE_MAX_PER_DAY = 3

const CARE_LABELS: Readonly<Record<CareKind, string>> = {
  morning: '今日计划',
  evening: '晚间回顾',
  weekly: '每周回顾'
}

export function careKindLabel(kind: CareKind): string {
  return CARE_LABELS[kind]
}

export function parseClock(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return { hour: 9, minute: 0 }
  const hour = Number.parseInt(match[1] ?? '9', 10)
  const minute = Number.parseInt(match[2] ?? '0', 10)
  return {
    hour: Math.min(23, Math.max(0, Number.isFinite(hour) ? hour : 9)),
    minute: Math.min(59, Math.max(0, Number.isFinite(minute) ? minute : 0))
  }
}

export function normalizeClock(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return fallback
  const hour = Number.parseInt(match[1] ?? '', 10)
  const minute = Number.parseInt(match[2] ?? '', 10)
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return fallback
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function atClock(now: number, value: string): number {
  const { hour, minute } = parseClock(value)
  const date = new Date(now)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

export function dateKey(now: number): string {
  const date = new Date(now)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function isQuietAt(now: number): boolean {
  const start = atClock(now, CARE_QUIET_START)
  const end = atClock(now, CARE_QUIET_END)
  return now >= start || now < end
}

export function normalizeCareSettings(raw: Partial<CareSettings> | undefined): CareSettings {
  const base = DEFAULT_CARE_SETTINGS
  return {
    enabled: raw?.enabled !== false,
    morningEnabled: raw?.morningEnabled !== false,
    morningTime: normalizeClock(raw?.morningTime, base.morningTime),
    eveningEnabled: raw?.eveningEnabled !== false,
    eveningTime: normalizeClock(raw?.eveningTime, base.eveningTime),
    weeklyEnabled: raw?.weeklyEnabled !== false,
    weeklyWeekday:
      typeof raw?.weeklyWeekday === 'number' && raw.weeklyWeekday >= 0 && raw.weeklyWeekday <= 6
        ? Math.round(raw.weeklyWeekday)
        : base.weeklyWeekday,
    weeklyTime: normalizeClock(raw?.weeklyTime, base.weeklyTime),
    notify: raw?.notify !== false
  }
}

export function createCareState(now: number): CareState {
  return { sentToday: 0, updatedAt: now }
}

function sentCountToday(state: CareState, key: string): number {
  return state.sentDate === key ? state.sentToday : 0
}

export function careDueKind(
  settings: CareSettings,
  state: CareState,
  now: number
): CareKind | undefined {
  if (!settings.enabled || isQuietAt(now)) return undefined
  const key = dateKey(now)
  if (sentCountToday(state, key) >= CARE_MAX_PER_DAY) return undefined
  const weekday = new Date(now).getDay()
  const eveningEnd = atClock(now, '23:30')

  if (
    settings.morningEnabled &&
    state.lastMorningKey !== key &&
    now >= atClock(now, settings.morningTime) &&
    now < atClock(now, '11:30')
  ) {
    return 'morning'
  }

  const weeklyToday =
    settings.weeklyEnabled && weekday === settings.weeklyWeekday && state.lastWeeklyKey !== key
  if (
    weeklyToday &&
    now >= atClock(now, settings.weeklyTime) &&
    now < eveningEnd
  ) {
    return 'weekly'
  }

  if (
    settings.eveningEnabled &&
    state.lastEveningKey !== key &&
    now >= Math.max(atClock(now, settings.eveningTime), atClock(now, '20:00')) &&
    now < eveningEnd
  ) {
    if (settings.weeklyEnabled && weekday === settings.weeklyWeekday && state.lastWeeklyKey === key) {
      return undefined
    }
    return 'evening'
  }

  return undefined
}

export function nextCareAt(
  settings: CareSettings,
  now: number
): { kind: CareKind; at: number } | undefined {
  if (!settings.enabled) return undefined
  const candidates: { kind: CareKind; at: number }[] = []
  for (let offset = 0; offset < 8; offset += 1) {
    const day = addDays(startOfDay(now), offset)
    const weekday = new Date(day).getDay()
    if (settings.morningEnabled) {
      const at = atClock(day, settings.morningTime)
      if (at > now && !isQuietAt(at)) candidates.push({ kind: 'morning', at })
    }
    if (settings.eveningEnabled) {
      const at = Math.max(atClock(day, settings.eveningTime), atClock(day, '20:00'))
      if (at > now && !isQuietAt(at)) candidates.push({ kind: 'evening', at })
    }
    if (settings.weeklyEnabled && weekday === settings.weeklyWeekday) {
      const at = atClock(day, settings.weeklyTime)
      if (at > now && !isQuietAt(at)) candidates.push({ kind: 'weekly', at })
    }
  }
  return candidates.sort((a, b) => a.at - b.at)[0]
}