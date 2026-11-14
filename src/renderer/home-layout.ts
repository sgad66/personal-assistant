import type { DayColumn, WeekItem } from '@shared/domain/types'
import { HOUR_MS, MINUTE_MS, startOfDay } from '@shared/time-kit'

export const ALL_WIDGET_IDS = [
  'rhythm',
  'today',
  'week',
  'balance',
  'free',
  'templates',
  'habits',
  'upcoming',
  'conflicts',
  'focus'
] as const

export type WidgetId = (typeof ALL_WIDGET_IDS)[number]

export interface WidgetMeta {
  readonly id: WidgetId
  readonly title: string
  readonly eyebrow: string
  readonly description: string
  readonly wide?: boolean
  readonly group: '工作' | '生活' | '通用'
}

export type WidgetRows = 1 | 2

export const WIDGET_ROWS: Readonly<Record<WidgetId, WidgetRows>> = {
  rhythm: 1,
  today: 1,
  week: 2,
  balance: 1,
  free: 1,
  templates: 1,
  habits: 1,
  upcoming: 1,
  conflicts: 1,
  focus: 1
}

export const WIDGET_META: Readonly<Record<WidgetId, WidgetMeta>> = {
  rhythm: {
    id: 'rhythm',
    title: '今日节奏',
    eyebrow: 'RHYTHM',
    description: '用 24 小时时间带看今天的忙闲分布',
    wide: true,
    group: '通用'
  },
  today: {
    id: 'today',
    title: '今天的安排',
    eyebrow: 'TODAY',
    description: '按时间列出今天的事项与状态',
    group: '通用'
  },
  week: {
    id: 'week',
    title: '这一周',
    eyebrow: 'WEEK',
    description: '七天概览与本周统计',
    group: '通用'
  },
  balance: {
    id: 'balance',
    title: '时间分布',
    eyebrow: 'BALANCE',
    description: '工作时段、晚间与周末的安排占比',
    group: '工作'
  },
  free: {
    id: 'free',
    title: '空档与建议',
    eyebrow: 'FREE TIME',
    description: '今天和明天的可用空档，可直接安排',
    group: '工作'
  },
  templates: {
    id: 'templates',
    title: '常用模板',
    eyebrow: 'TEMPLATES',
    description: '工作与生活的常用事项，一点即填',
    wide: true,
    group: '通用'
  },
  habits: {
    id: 'habits',
    title: '日常打卡',
    eyebrow: 'HABITS',
    description: '喝水、活动、阅读与早睡，只记录在本机',
    group: '生活'
  },
  upcoming: {
    id: 'upcoming',
    title: '接下来',
    eyebrow: 'UPCOMING',
    description: '本周接下来最重要的几项安排',
    group: '通用'
  },
  conflicts: {
    id: 'conflicts',
    title: '需要留意',
    eyebrow: 'ATTENTION',
    description: '时间重叠与时间待定的事项',
    group: '工作'
  },
  focus: {
    id: 'focus',
    title: '专注计时',
    eyebrow: 'FOCUS',
    description: '25 分钟专注，期间不打扰',
    group: '工作'
  }
}

export interface WidgetLayoutItem {
  readonly id: WidgetId
  readonly span: 1 | 2
  readonly rows: WidgetRows
}

export const DEFAULT_WIDGET_LAYOUT: readonly WidgetLayoutItem[] = [
  { id: 'rhythm', span: 2, rows: 1 },
  { id: 'today', span: 2, rows: 1 },
  { id: 'week', span: 1, rows: 1 },
  { id: 'free', span: 1, rows: 1 },
  { id: 'templates', span: 2, rows: 1 }
]

export const DEFAULT_WIDGET_IDS: readonly WidgetId[] = DEFAULT_WIDGET_LAYOUT.map((item) => item.id)

export interface LayoutPreset {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly items: readonly WidgetLayoutItem[]
}

export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  {
    id: 'daily',
    name: '日常',
    description: '今天、本周与空档，适合每天打开',
    items: DEFAULT_WIDGET_LAYOUT
  },
  {
    id: 'work',
    name: '工作',
    description: '聚焦待办、冲突与专注',
    items: [
      { id: 'rhythm', span: 2, rows: 1 },
      { id: 'today', span: 2, rows: 1 },
      { id: 'upcoming', span: 1, rows: 1 },
      { id: 'conflicts', span: 1, rows: 1 },
      { id: 'focus', span: 1, rows: 1 },
      { id: 'templates', span: 1, rows: 1 }
    ]
  },
  {
    id: 'life',
    name: '生活',
    description: '习惯、时间分布与生活模板',
    items: [
      { id: 'rhythm', span: 2, rows: 1 },
      { id: 'today', span: 2, rows: 1 },
      { id: 'habits', span: 1, rows: 1 },
      { id: 'balance', span: 1, rows: 1 },
      { id: 'free', span: 1, rows: 1 },
      { id: 'templates', span: 1, rows: 1 }
    ]
  },
  {
    id: 'minimal',
    name: '极简',
    description: '只看今天，减少干扰',
    items: [
      { id: 'rhythm', span: 2, rows: 1 },
      { id: 'today', span: 2, rows: 1 },
      { id: 'week', span: 2, rows: 1 }
    ]
  }
]

export function isWidgetId(value: unknown): value is WidgetId {
  return typeof value === 'string' && (ALL_WIDGET_IDS as readonly string[]).includes(value)
}

export function isWidgetSpan(value: unknown): value is 1 | 2 {
  return value === 1 || value === 2
}

export function isWidgetRows(value: unknown): value is WidgetRows {
  return value === 1 || value === 2
}

export function parseWidgetLayout(raw: string | null): WidgetLayoutItem[] {
  const fallback = (): WidgetLayoutItem[] => DEFAULT_WIDGET_LAYOUT.map((item) => ({ ...item }))
  if (raw === null) return fallback()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return fallback()
    const items: WidgetLayoutItem[] = []
    for (const value of parsed) {
      if (typeof value === 'string') {
        if (isWidgetId(value) && !items.some((item) => item.id === value)) {
          items.push({
            id: value,
            span: WIDGET_META[value].wide ? 2 : 1,
            rows: WIDGET_ROWS[value]
          })
        }
        continue
      }
      if (typeof value !== 'object' || value === null) continue
      const candidate = value as { id?: unknown; span?: unknown; rows?: unknown }
      if (!isWidgetId(candidate.id) || items.some((item) => item.id === candidate.id)) continue
      items.push({
        id: candidate.id,
        span: isWidgetSpan(candidate.span) ? candidate.span : WIDGET_META[candidate.id].wide ? 2 : 1,
        rows: isWidgetRows(candidate.rows) ? candidate.rows : WIDGET_ROWS[candidate.id]
      })
    }
    return items
  } catch {
    return fallback()
  }
}

export function serializeWidgetLayout(items: readonly WidgetLayoutItem[]): string {
  return JSON.stringify(items)
}

export function layoutIds(items: readonly WidgetLayoutItem[]): WidgetId[] {
  return items.map((item) => item.id)
}

export function addWidget(
  items: readonly WidgetLayoutItem[],
  id: WidgetId,
  span?: 1 | 2,
  rows?: WidgetRows
): WidgetLayoutItem[] {
  if (items.some((item) => item.id === id)) return items.map((item) => ({ ...item }))
  return [
    ...items.map((item) => ({ ...item })),
    {
      id,
      span: span ?? (WIDGET_META[id].wide ? 2 : 1),
      rows: rows ?? WIDGET_ROWS[id]
    }
  ]
}

export function removeWidget(items: readonly WidgetLayoutItem[], id: WidgetId): WidgetLayoutItem[] {
  return items.filter((item) => item.id !== id).map((item) => ({ ...item }))
}

export function moveWidget(
  items: readonly WidgetLayoutItem[],
  id: WidgetId,
  delta: number
): WidgetLayoutItem[] {
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) return items.map((item) => ({ ...item }))
  const target = Math.max(0, Math.min(items.length - 1, index + delta))
  if (target === index) return items.map((item) => ({ ...item }))
  const next = items.map((item) => ({ ...item }))
  const [item] = next.splice(index, 1)
  if (item === undefined) return items.map((entry) => ({ ...entry }))
  next.splice(target, 0, item)
  return next
}

export function setWidgetSpan(
  items: readonly WidgetLayoutItem[],
  id: WidgetId,
  span: 1 | 2
): WidgetLayoutItem[] {
  return items.map((item) => (item.id === id ? { ...item, span } : { ...item }))
}

export function setWidgetRows(
  items: readonly WidgetLayoutItem[],
  id: WidgetId,
  rows: WidgetRows
): WidgetLayoutItem[] {
  return items.map((item) => (item.id === id ? { ...item, rows } : { ...item }))
}

export interface WorkLifeStats {
  readonly scheduledMinutes: number
  readonly workMinutes: number
  readonly eveningMinutes: number
  readonly weekendMinutes: number
  readonly workFreeMinutes: number
  readonly workWindowMinutes: number
}

export function workLifeStatsOf(days: readonly DayColumn[]): WorkLifeStats {
  let scheduledMinutes = 0
  let workMinutes = 0
  let eveningMinutes = 0
  let weekendMinutes = 0
  let workWindowMinutes = 0

  for (const day of days) {
    const dayStart = startOfDay(day.date)
    const weekday = new Date(day.date).getDay()
    scheduledMinutes += busyMinutesInWindow(day.items, dayStart, 0, 24)
    if (weekday >= 1 && weekday <= 5) {
      workMinutes += busyMinutesInWindow(day.items, dayStart, 9, 18)
      workWindowMinutes += 9 * 60
    }
    eveningMinutes += busyMinutesInWindow(day.items, dayStart, 18, 22)
    if (weekday === 0 || weekday === 6) {
      weekendMinutes += busyMinutesInWindow(day.items, dayStart, 0, 24)
    }
  }

  return {
    scheduledMinutes,
    workMinutes,
    eveningMinutes,
    weekendMinutes,
    workFreeMinutes: Math.max(0, workWindowMinutes - workMinutes),
    workWindowMinutes
  }
}

function busyMinutesInWindow(
  items: readonly WeekItem[],
  dayStart: number,
  startHour: number,
  endHour: number
): number {
  const windowStart = dayStart + startHour * HOUR_MS
  const windowEnd = dayStart + endHour * HOUR_MS
  const intervals = items
    .map((item) => ({
      startAt: Math.max(item.startAt, windowStart),
      endAt: Math.min(item.endAt, windowEnd)
    }))
    .filter((interval) => interval.endAt > interval.startAt)
    .sort((a, b) => a.startAt - b.startAt)

  let total = 0
  let currentStart: number | undefined
  let currentEnd = 0
  for (const interval of intervals) {
    if (currentStart === undefined) {
      currentStart = interval.startAt
      currentEnd = interval.endAt
      continue
    }
    if (interval.startAt <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endAt)
    } else {
      total += currentEnd - currentStart
      currentStart = interval.startAt
      currentEnd = interval.endAt
    }
  }
  if (currentStart !== undefined) total += currentEnd - currentStart
  return Math.round(total / MINUTE_MS)
}

export interface UpcomingEntry {
  readonly item: WeekItem
  readonly date: number
}

export function upcomingOf(days: readonly DayColumn[], now: number, limit = 3): UpcomingEntry[] {
  const entries: UpcomingEntry[] = []
  for (const day of days) {
    for (const item of day.items) {
      if (item.timeLabel !== 'timed') continue
      if (item.startAt <= now) continue
      entries.push({ item, date: day.date })
    }
  }
  entries.sort((a, b) => a.item.startAt - b.item.startAt)
  return entries.slice(0, limit)
}

export interface AttentionItem {
  readonly item: WeekItem
  readonly date: number
  readonly kind: 'conflict' | 'pending'
}

export function attentionOf(days: readonly DayColumn[]): AttentionItem[] {
  const entries: AttentionItem[] = []
  for (const day of days) {
    for (const item of day.items) {
      if (item.hasConflict) {
        entries.push({ item, date: day.date, kind: 'conflict' })
      } else if (item.timeLabel === 'all_day_pending') {
        entries.push({ item, date: day.date, kind: 'pending' })
      }
    }
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'conflict' ? -1 : 1
    return a.item.startAt - b.item.startAt
  })
  return entries
}

export const HABITS = [
  { id: 'water', label: '喝水', hint: '保持水分' },
  { id: 'move', label: '活动', hint: '起身走动' },
  { id: 'read', label: '阅读', hint: '读几页书' },
  { id: 'early', label: '早睡', hint: '按时休息' }
] as const

export type HabitId = (typeof HABITS)[number]['id']

export interface HabitState {
  readonly date: string
  readonly done: readonly HabitId[]
}

export function isHabitId(value: unknown): value is HabitId {
  return typeof value === 'string' && HABITS.some((habit) => habit.id === value)
}

export function parseHabitState(raw: string | null, todayKey: string): HabitState {
  if (raw === null) return { date: todayKey, done: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { date: todayKey, done: [] }
    const value = parsed as { date?: unknown; done?: unknown }
    if (value.date !== todayKey || !Array.isArray(value.done)) {
      return { date: todayKey, done: [] }
    }
    return { date: todayKey, done: value.done.filter(isHabitId) }
  } catch {
    return { date: todayKey, done: [] }
  }
}

export function toggleHabitState(raw: string | null, id: HabitId, todayKey: string): string {
  const state = parseHabitState(raw, todayKey)
  const done = state.done.includes(id)
    ? state.done.filter((habit) => habit !== id)
    : [...state.done, id]
  return JSON.stringify({ date: todayKey, done })
}

export const FOCUS_DURATION_MS = 25 * MINUTE_MS

export interface FocusState {
  readonly endsAt?: number
  readonly remainingMs: number
  readonly running: boolean
  readonly completed: boolean
}

export function parseFocusState(raw: string | null, now: number, duration = FOCUS_DURATION_MS): FocusState {
  if (raw === null) return { remainingMs: duration, running: false, completed: false }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return { remainingMs: duration, running: false, completed: false }
    }
    const value = parsed as { endsAt?: unknown; remainingMs?: unknown; running?: unknown }
    if (value.running === true && typeof value.endsAt === 'number') {
      const remaining = value.endsAt - now
      if (remaining > 0) {
        return { endsAt: value.endsAt, remainingMs: remaining, running: true, completed: false }
      }
      return { remainingMs: 0, running: false, completed: true }
    }
    const remaining = typeof value.remainingMs === 'number' ? Math.max(0, value.remainingMs) : duration
    return { remainingMs: remaining, running: false, completed: remaining === 0 }
  } catch {
    return { remainingMs: duration, running: false, completed: false }
  }
}