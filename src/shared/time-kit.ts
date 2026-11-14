// 时间与自然周工具（纯函数，可单测）
// 约定：所有入参/出参为 epoch 毫秒，按设备本地时区解释

export const MINUTE_MS = 60_000
export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000
export const REMINDER_LEAD_MS = 10 * MINUTE_MS
export const DEFAULT_DURATION_MS = HOUR_MS

export interface TimeInterval {
  startAt: number
  endAt: number
}

function toDate(ts: number): Date {
  return new Date(ts)
}

export function startOfDay(ts: number): number {
  const d = toDate(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function startOfWeek(ts: number): number {
  const d = toDate(startOfDay(ts))
  const day = d.getDay() // 0 周日
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function getWeekStart(ts: number): number {
  return startOfWeek(ts)
}

export function addDays(ts: number, days: number): number {
  const d = toDate(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

export function addWeeks(ts: number, weeks: number): number {
  return addDays(ts, weeks * 7)
}

export function getWeekDays(weekStart: number): number[] {
  const base = startOfWeek(weekStart)
  return Array.from({ length: 7 }, (_unused, index) => addDays(base, index))
}

export function weekEndExclusive(weekStart: number): number {
  return addDays(startOfWeek(weekStart), 7)
}

export function isToday(ts: number, now = Date.now()): boolean {
  return startOfDay(ts) === startOfDay(now)
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b)
}

export function truncateToMinute(ts: number): number {
  return Math.floor(ts / MINUTE_MS) * MINUTE_MS
}

export function formatTime(ts: number): string {
  const d = toDate(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function formatRange(startAt: number, endAt?: number): string {
  if (endAt === undefined) return formatTime(startAt)
  return `${formatTime(startAt)}-${formatTime(endAt)}`
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function formatDateLabel(ts: number): string {
  const d = toDate(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_CN[d.getDay()]}`
}

export function formatDateShort(ts: number): string {
  const d = toDate(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function formatLocalDate(ts: number): string {
  const d = toDate(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function ratioOfDay(ts: number): number {
  const dayStart = startOfDay(ts)
  return (ts - dayStart) / DAY_MS
}

export function overlapsWith(a: TimeInterval, b: TimeInterval): boolean {
  return a.startAt < b.endAt && b.startAt < a.endAt
}

export function touchesOnly(a: TimeInterval, b: TimeInterval): boolean {
  return a.endAt === b.startAt || b.endAt === a.startAt
}

export function spansMultipleDays(interval: TimeInterval): boolean {
  return startOfDay(interval.startAt) !== startOfDay(interval.endAt)
}

export function isExpired(startAt: number, now = Date.now()): boolean {
  return startAt <= now
}

export interface ParsedTimeExpression {
  readonly dateFound: boolean
  readonly timeFound: boolean
  readonly durationFound: boolean
  readonly startAt?: number
  readonly endAt?: number
  readonly explicitEnd: boolean
}

const CN_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

export function parseChineseNumber(raw: string): number | undefined {
  const text = raw.trim()
  if (text.length === 0) return undefined
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '十') return 10
  if (text === '半') return 0.5
  const tenIndex = text.indexOf('十')
  if (tenIndex >= 0) {
    const prefix = text.slice(0, tenIndex)
    const suffix = text.slice(tenIndex + 1)
    const tens = prefix.length === 0 ? 1 : CN_DIGITS[prefix]
    const ones = suffix.length === 0 ? 0 : CN_DIGITS[suffix]
    if (tens === undefined || ones === undefined) return undefined
    return tens * 10 + ones
  }
  const single = CN_DIGITS[text]
  return single
}

const WEEKDAY_MAP: Readonly<Record<string, number>> = {
  一: 0,
  二: 1,
  三: 2,
  四: 3,
  五: 4,
  六: 5,
  日: 6,
  天: 6
}

interface DateHint {
  dayStart: number
  found: boolean
}

function resolveDateHint(text: string, referenceTime: number): DateHint {
  const ref = toDate(referenceTime)
  const todayStart = startOfDay(referenceTime)

  const absolute = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})[日号]?/.exec(text)
  if (absolute) {
    const d = new Date(Number(absolute[1]), Number(absolute[2]) - 1, Number(absolute[3]))
    d.setHours(0, 0, 0, 0)
    return { dayStart: d.getTime(), found: true }
  }

  const monthDay = /(\d{1,2})月(\d{1,2})[日号]?/.exec(text)
  if (monthDay) {
    const d = new Date(ref.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]))
    d.setHours(0, 0, 0, 0)
    if (d.getTime() < todayStart) {
      d.setFullYear(d.getFullYear() + 1)
    }
    return { dayStart: d.getTime(), found: true }
  }

  if (/大后天/.test(text)) return { dayStart: addDays(todayStart, 3), found: true }
  if (/后天/.test(text)) return { dayStart: addDays(todayStart, 2), found: true }
  if (/明天|明日/.test(text)) return { dayStart: addDays(todayStart, 1), found: true }
  if (/今天|今日|今晚|今早/.test(text)) return { dayStart: todayStart, found: true }
  if (/昨天|昨日/.test(text)) return { dayStart: addDays(todayStart, -1), found: true }

  const nextWeek = /下(?:个)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(text)
  if (nextWeek) {
    const target = WEEKDAY_MAP[nextWeek[1]]
    if (target !== undefined) {
      return { dayStart: addDays(startOfWeek(referenceTime), 7 + target), found: true }
    }
  }

  const thisWeek = /(?:本|这|这个)(?:周|星期|礼拜)([一二三四五六日天])/.exec(text)
  if (thisWeek) {
    const target = WEEKDAY_MAP[thisWeek[1]]
    if (target !== undefined) {
      return { dayStart: addDays(startOfWeek(referenceTime), target), found: true }
    }
  }

  const bareWeek = /(?:周|星期|礼拜)([一二三四五六日天])/.exec(text)
  if (bareWeek) {
    const target = WEEKDAY_MAP[bareWeek[1]]
    if (target !== undefined) {
      let candidate = addDays(startOfWeek(referenceTime), target)
      if (candidate < todayStart) candidate = addDays(candidate, 7)
      return { dayStart: candidate, found: true }
    }
  }

  return { dayStart: todayStart, found: false }
}

interface TimeHint {
  hour: number
  minute: number
  found: boolean
  explicit: boolean
}

const PERIOD_DEFAULTS: Readonly<Record<string, number>> = {
  凌晨: 6,
  早上: 9,
  早晨: 9,
  上午: 9,
  中午: 12,
  下午: 15,
  傍晚: 18,
  晚上: 20,
  夜里: 21,
  晚间: 20
}

function applyPeriod(hour: number, period?: string): number {
  if (period === undefined) return hour
  if (period === '下午' || period === '傍晚' || period === '晚上' || period === '夜里' || period === '晚间') {
    return hour < 12 ? hour + 12 : hour
  }
  if (period === '中午') return hour < 12 ? hour + 12 : hour
  return hour
}

function resolveTimeHint(text: string): TimeHint {
  const colon = /(\d{1,2})\s*[:：]\s*(\d{1,2})/.exec(text)
  if (colon) {
    const period = /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚间)/.exec(text)?.[1]
    const hour = applyPeriod(Number(colon[1]), period)
    return { hour, minute: Number(colon[2]), found: true, explicit: true }
  }

  const cnTime =
    /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚间)?\s*([零一二两三四五六七八九十\d]{1,3})\s*[点時时]\s*(?:(半)|([零一二两三四五六七八九十\d]{1,2})\s*分?)?/.exec(
      text
    )
  if (cnTime) {
    const period = cnTime[1]
    const rawHour = parseChineseNumber(cnTime[2])
    if (rawHour !== undefined) {
      const half = cnTime[3] !== undefined
      const rawMinute = half ? 0 : parseChineseNumber(cnTime[4] ?? '0')
      let hour = applyPeriod(rawHour, period)
      if (period === undefined && rawHour >= 1 && rawHour <= 6) hour = rawHour + 12
      return {
        hour,
        minute: half ? 30 : (rawMinute ?? 0),
        found: true,
        explicit: true
      }
    }
  }

  const periodOnly = /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚间)/.exec(text)
  if (periodOnly) {
    const hour = PERIOD_DEFAULTS[periodOnly[1]]
    if (hour !== undefined) {
      return { hour, minute: 0, found: true, explicit: true }
    }
  }

  return { hour: 0, minute: 0, found: false, explicit: false }
}

function resolveDurationMs(text: string): number | undefined {
  const hourMatch = /(\d+(?:\.\d+)?|半)\s*(?:个)?\s*(?:小时|钟头)/.exec(text)
  if (hourMatch) {
    if (hourMatch[1] === '半') return 30 * MINUTE_MS
    return Math.round(Number(hourMatch[1]) * HOUR_MS)
  }
  const minuteMatch = /(\d+)\s*分钟/.exec(text)
  if (minuteMatch) {
    return Number(minuteMatch[1]) * MINUTE_MS
  }
  return undefined
}

function resolveExplicitEndTime(text: string): { hour: number; minute: number } | undefined {
  const range = /(\d{1,2})\s*[:：]\s*(\d{1,2})\s*(?:到|至|-|~|—)\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/.exec(text)
  if (range) {
    return { hour: Number(range[3]), minute: Number(range[4]) }
  }

  const cnRange =
    /([零一二两三四五六七八九十\d]{1,3})\s*[点時时]\s*(?:半|([零一二两三四五六七八九十\d]{1,2})\s*分?)?\s*(?:到|至|-|~|—)\s*([零一二两三四五六七八九十\d]{1,3})\s*[点時时]\s*(?:半|([零一二两三四五六七八九十\d]{1,2})\s*分?)?/.exec(
      text
    )
  if (cnRange) {
    const period = /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚间)/.exec(text)?.[1]
    const rawEnd = parseChineseNumber(cnRange[3])
    if (rawEnd !== undefined) {
      const isHalf = /[点時时]\s*半/.test(text.slice(text.indexOf(cnRange[3])))
      const rawMinute = parseChineseNumber(cnRange[4] ?? '0') ?? 0
      let hour = applyPeriod(rawEnd, period)
      if (period === undefined && rawEnd >= 1 && rawEnd <= 6) hour = rawEnd + 12
      return { hour, minute: isHalf ? 30 : rawMinute }
    }
  }

  return undefined
}

export function normalizeExpression(text: string, referenceTime: number): ParsedTimeExpression {
  const startFragment = extractStartFragment(text)
  const dateHint = resolveDateHint(startFragment, referenceTime)
  const timeHint = resolveTimeHint(startFragment)
  const duration = resolveDurationMs(text)

  if (!timeHint.found) {
    return {
      dateFound: dateHint.found,
      timeFound: false,
      durationFound: duration !== undefined,
      explicitEnd: false
    }
  }

  const startDate = new Date(dateHint.dayStart)
  startDate.setHours(timeHint.hour, timeHint.minute, 0, 0)
  let startAt = truncateToMinute(
    dateHint.found ? startDate.getTime() : combineTodayWithTime(referenceTime, timeHint.hour, timeHint.minute)
  )

  if (!dateHint.found) {
    const reference = truncateToMinute(referenceTime)
    if (startAt < reference) {
      startAt = truncateToMinute(addDays(startAt, 1))
    }
  }

  const endFragment = extractEndFragment(text)
  const endTimeHint = endFragment ? resolveTimeHint(endFragment) : undefined
  const explicitEndHint = endTimeHint?.found
    ? { hour: endTimeHint.hour, minute: endTimeHint.minute }
    : resolveExplicitEndTime(text)
  if (explicitEndHint) {
    const bareWeekdayEnd = endFragment !== undefined && hasBareWeekday(endFragment)
    const endDateHint = endFragment
      ? resolveDateHint(endFragment, bareWeekdayEnd ? startAt : referenceTime)
      : { dayStart: 0, found: false }
    const endHasExplicitDate =
      endFragment !== undefined &&
      endDateHint.found &&
      /(明天|明日|后天|大后天|今天|今日|昨天|周|星期|礼拜|月|日|号)/.test(endFragment)
    const baseDay = endHasExplicitDate ? endDateHint.dayStart : startOfDay(startAt)
    const endDate = new Date(baseDay)
    endDate.setHours(explicitEndHint.hour, explicitEndHint.minute, 0, 0)
    const endAt = truncateToMinute(endDate.getTime())
    return {
      dateFound: dateHint.found,
      timeFound: true,
      durationFound: duration !== undefined,
      startAt,
      endAt,
      explicitEnd: true
    }
  }

  const endAt = startAt + (duration ?? DEFAULT_DURATION_MS)
  return {
    dateFound: dateHint.found,
    timeFound: true,
    durationFound: duration !== undefined,
    startAt,
    endAt: truncateToMinute(endAt),
    explicitEnd: false
  }
}

function extractEndFragment(text: string): string | undefined {
  const match = /(?:到|至|~|—|-)/.exec(text)
  if (!match) return undefined
  const start = match.index + match[0].length
  const fragment = text.slice(start, start + 16).trim()
  return fragment.length > 0 ? fragment : undefined
}

function extractStartFragment(text: string): string {
  const range = /(?:到|至|~|—)/.exec(text)
  if (range && range.index > 0) return text.slice(0, range.index).trim()

  const dash = /(\d{1,2})\s*[:：]\s*(\d{1,2})\s*-\s*(\d{1,2})/.exec(text)
  if (dash && dash.index > 0) {
    const dashIndex = dash[0].indexOf('-')
    if (dashIndex > 0) return text.slice(0, dash.index + dashIndex).trim()
  }
  return text
}

function hasBareWeekday(text: string): boolean {
  if (/(?:本|这|下|上)(?:个)?(?:周|星期|礼拜)/.test(text)) return false
  return /(?:周|星期|礼拜)[一二三四五六日天]/.test(text)
}

function combineTodayWithTime(referenceTime: number, hour: number, minute: number): number {
  const d = new Date(startOfDay(referenceTime))
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

export function describeRemaining(startAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((startAt - now) / MINUTE_MS))
}