import type { Goal, GoalCadence, GoalStatus } from '@shared/domain/types'
import { MINUTE_MS, addDays, formatDateLabel, formatTime, isSameDay, truncateToMinute } from '@shared/time-kit'

export const GOAL_INTERVAL_MIN = 15
export const GOAL_INTERVAL_MAX = 1440

export const GOAL_CADENCES: readonly GoalCadence[] = ['once', 'daily', 'weekdays', 'weekly', 'interval']

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export interface GoalDraft {
  title: string
  instruction: string
  cadence: GoalCadence
  hour: number
  minute: number
  weekday: number
  intervalMinutes: number
  onceAt?: number
}

export interface GoalDraftInput {
  title?: string
  instruction?: string
  cadence?: string
  hour?: number
  minute?: number
  weekday?: number
  intervalMinutes?: number
  onceAt?: number
}

type GoalScheduleShape = Pick<
  Goal,
  'cadence' | 'hour' | 'minute' | 'weekday' | 'intervalMinutes'
> & { onceAt?: number }

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function cadenceOf(value: string | undefined): GoalCadence {
  return GOAL_CADENCES.includes(value as GoalCadence) ? (value as GoalCadence) : 'daily'
}

export function clampProgress(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function normalizeGoalDraft(
  input: GoalDraftInput,
  now: number,
  fallbackTitle?: string
): GoalDraft {
  const title = (input.title ?? fallbackTitle ?? '').trim().slice(0, 50) || '持续跟进'
  const instruction = (input.instruction ?? '').trim().slice(0, 300) || title
  const cadence = cadenceOf(input.cadence)
  const hour = clampInt(input.hour, 0, 23, 9)
  const minute = clampInt(input.minute, 0, 59, 0)
  const weekday = clampInt(input.weekday, 0, 6, 1)
  const intervalMinutes = clampInt(
    input.intervalMinutes,
    GOAL_INTERVAL_MIN,
    GOAL_INTERVAL_MAX,
    60
  )
  const onceAt =
    cadence === 'once'
      ? truncateToMinute(
          input.onceAt !== undefined && input.onceAt > now ? input.onceAt : nextDailyAt(hour, minute, now)
        )
      : undefined
  return {
    title,
    instruction,
    cadence,
    hour,
    minute,
    weekday,
    intervalMinutes,
    ...(onceAt !== undefined ? { onceAt } : {})
  }
}

export function nextDailyAt(hour: number, minute: number, from: number): number {
  const date = new Date(from)
  date.setHours(hour, minute, 0, 0)
  if (date.getTime() <= from) date.setDate(date.getDate() + 1)
  return date.getTime()
}

function nextWeeklyAt(weekday: number, hour: number, minute: number, from: number): number {
  const date = new Date(from)
  date.setHours(hour, minute, 0, 0)
  let delta = (weekday - date.getDay() + 7) % 7
  if (delta === 0 && date.getTime() <= from) delta = 7
  date.setDate(date.getDate() + delta)
  return date.getTime()
}

function nextWeekdayAt(hour: number, minute: number, from: number): number {
  let candidate = nextDailyAt(hour, minute, from)
  for (let index = 0; index < 8; index += 1) {
    const day = new Date(candidate).getDay()
    if (day !== 0 && day !== 6) return candidate
    candidate = nextDailyAt(hour, minute, candidate + MINUTE_MS)
  }
  return candidate
}

export function computeGoalNextRun(goal: GoalScheduleShape, from: number): number | undefined {
  if (goal.cadence === 'once') {
    return goal.onceAt !== undefined && goal.onceAt > from ? goal.onceAt : undefined
  }
  if (goal.cadence === 'interval') {
    return from + goal.intervalMinutes * MINUTE_MS
  }
  if (goal.cadence === 'weekly') {
    return nextWeeklyAt(goal.weekday, goal.hour, goal.minute, from)
  }
  if (goal.cadence === 'weekdays') {
    return nextWeekdayAt(goal.hour, goal.minute, from)
  }
  return nextDailyAt(goal.hour, goal.minute, from)
}

export function initialGoalNextRun(draft: GoalDraft, now: number): number {
  if (draft.cadence === 'interval') return now + draft.intervalMinutes * MINUTE_MS
  return computeGoalNextRun(draft, now) ?? now + MINUTE_MS
}

export function isGoalDue(goal: Pick<Goal, 'status' | 'nextRunAt'>, now: number): boolean {
  return goal.status === 'active' && goal.nextRunAt <= now
}

function intervalLabel(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `每 ${minutes / 60} 小时`
  return `每 ${minutes} 分钟`
}

export function goalCadenceLabel(goal: GoalScheduleShape): string {
  if (goal.cadence === 'daily') return `每天 ${two(goal.hour)}:${two(goal.minute)}`
  if (goal.cadence === 'weekdays') return `工作日 ${two(goal.hour)}:${two(goal.minute)}`
  if (goal.cadence === 'weekly') {
    return `每${WEEKDAY_CN[goal.weekday] ?? '周一'} ${two(goal.hour)}:${two(goal.minute)}`
  }
  if (goal.cadence === 'interval') return intervalLabel(goal.intervalMinutes)
  return goal.onceAt !== undefined
    ? `仅一次 · ${formatDateLabel(goal.onceAt)} ${formatTime(goal.onceAt)}`
    : '仅一次'
}

export function goalNextRunLabel(nextRunAt: number | undefined, now: number): string {
  if (nextRunAt === undefined) return '没有后续安排'
  if (isSameDay(nextRunAt, now)) return `今天 ${formatTime(nextRunAt)}`
  if (isSameDay(nextRunAt, addDays(now, 1))) return `明天 ${formatTime(nextRunAt)}`
  return `${formatDateLabel(nextRunAt)} ${formatTime(nextRunAt)}`
}

export function goalStatusLabel(status: GoalStatus): string {
  if (status === 'active') return '跟进中'
  if (status === 'paused') return '已暂停'
  return '已完成'
}

export function goalProgressTone(status: GoalStatus, progress: number): 'active' | 'paused' | 'done' {
  if (status === 'completed' || progress >= 100) return 'done'
  if (status === 'paused') return 'paused'
  return 'active'
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}