import { addWeeks, getWeekStart } from './time-kit'
import type { WeekView } from './domain/types'

export type WeekNavLabelKey = 'week.navThisWeek' | 'week.navBackToThisWeek'
export type WeekNavHintKey = 'week.navThisWeekHint' | 'week.navBackHint'

export interface WeekNavState {
  readonly currentWeekStart: number
  readonly isCurrentWeek: boolean
  readonly labelKey: WeekNavLabelKey
  readonly hintKey: WeekNavHintKey
  readonly ariaDisabled: boolean
}

export type WeekRequestKind = 'step' | 'refresh' | 'today'

export interface WeekRequest {
  readonly kind: WeekRequestKind
  readonly delta?: -1 | 1
}

export interface WeekLoadPrev {
  readonly anchor: number
  readonly week?: WeekView
}

export interface WeekLoadApplied {
  readonly anchor: number
  readonly week?: WeekView
}

export function isCurrentWeek(viewWeekStart: number, now: number): boolean {
  return getWeekStart(viewWeekStart) === getWeekStart(now)
}

export function weekNavOf(viewWeekStart: number, now: number): WeekNavState {
  const currentWeekStart = getWeekStart(now)
  const current = getWeekStart(viewWeekStart) === currentWeekStart
  return {
    currentWeekStart,
    isCurrentWeek: current,
    labelKey: current ? 'week.navThisWeek' : 'week.navBackToThisWeek',
    hintKey: current ? 'week.navThisWeekHint' : 'week.navBackHint',
    ariaDisabled: current
  }
}

export function planWeekRequest(anchor: number, request: WeekRequest, now: number): number {
  if (request.kind === 'refresh') return anchor
  if (request.kind === 'today') return getWeekStart(now)
  return addWeeks(anchor, request.delta ?? 0)
}

export function applyWeekOutcome(
  prev: WeekLoadPrev,
  target: number,
  outcome: 'success' | 'failure',
  week?: WeekView
): WeekLoadApplied {
  if (outcome === 'failure') {
    return {
      anchor: prev.anchor,
      ...(prev.week ? { week: prev.week } : {})
    }
  }
  return {
    anchor: target,
    ...(week ? { week } : {})
  }
}