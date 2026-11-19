import type { ParseResult, ParsedCandidate, ParsedGoal, ParseRequest } from './types'
import { normalizeExpression, formatTime, formatDateLabel, parseChineseNumber } from '@shared/time-kit'

const TIME_WORD_PATTERN =
  /(今天|今日|明天|明日|后天|大后天|昨天|昨日|(?:本|这|这个)(?:周|星期|礼拜)[一二三四五六日天]|下(?:个)?(?:周|星期|礼拜)[一二三四五六日天]|(?:周|星期|礼拜)[一二三四五六日天]|\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?|\d{1,2}月\d{1,2}[日号]?)/

const CLOCK_PATTERN =
  /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚间)?\s*(?:\d{1,2}\s*[:：]\s*\d{1,2}|[零一二两三四五六七八九十\d]{1,3}\s*[点時时]\s*(?:半|[零一二两三四五六七八九十\d]{1,2}\s*分?)?)/

const DURATION_PATTERN = /(?:(\d+(?:\.\d+)?|半)\s*(?:个)?\s*(?:小时|钟头)|\d+\s*分钟)/

const GREETING_PATTERN = /^(你好|您好|hi|hello|哈喽|嗨|在吗|谢谢|多谢|早上好|下午好|晚上好)[！!。.~～\s]*$/i
const CANCEL_PATTERN = /(取消|删掉|删除|不用了|不去了)/
const MODIFY_PATTERN = /(改到|改成|改一下|修改|调整|推迟|提前|换个时间|换到)/
const GOAL_HINT_PATTERN = /(跟踪|跟进|盯着|盯一下|检查|复盘|汇报|推进|坚持|打卡|别忘|提醒我)/
const GOAL_FREQUENCY_PATTERN = /(每天|每日|每周|每个工作日|工作日|每隔)/
const GOAL_INTERVAL_PATTERN = /每隔\s*([\d一二两三四五六七八九十]+)\s*(小时|钟头|分钟)/
const GOAL_WEEKDAY_PATTERN = /每?(?:周|星期|礼拜)([一二三四五六日天])/
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6
}

function localGoal(text: string, referenceTime: number): ParseResult | undefined {
  if (!GOAL_HINT_PATTERN.test(text)) return undefined
  const hasFrequency = GOAL_FREQUENCY_PATTERN.test(text)
  const hasScheduleTime = TIME_WORD_PATTERN.test(text) && CLOCK_PATTERN.test(text)
  if (!hasFrequency && hasScheduleTime) return undefined

  const intervalMatch = GOAL_INTERVAL_PATTERN.exec(text)
  const weekdayMatch = GOAL_WEEKDAY_PATTERN.exec(text)
  const timeExpression = extractTimeExpression(text)
  const normalized = timeExpression
    ? normalizeExpression(timeExpression, referenceTime)
    : normalizeExpression(text, referenceTime)
  const startAt = normalized.startAt
  const hour = startAt !== undefined ? new Date(startAt).getHours() : 9
  const minute = startAt !== undefined ? new Date(startAt).getMinutes() : 0

  let cadence: ParsedGoal['cadence'] = 'daily'
  let intervalMinutes: number | undefined
  let weekday: number | undefined
  if (intervalMatch) {
    cadence = 'interval'
    const amount = parseChineseNumber(intervalMatch[1] ?? '') ?? 1
    intervalMinutes = Math.min(1440, Math.max(15, amount * (intervalMatch[2] === '分钟' ? 1 : 60)))
  } else if (weekdayMatch) {
    cadence = 'weekly'
    weekday = WEEKDAY_INDEX[weekdayMatch[1] ?? ''] ?? 1
  } else if (/每个工作日|工作日/.test(text)) {
    cadence = 'weekdays'
  }

  const title = extractGoalTitle(text)
  const goal: ParsedGoal = {
    title,
    instruction: text.slice(0, 300),
    cadence,
    ...(cadence === 'interval' ? {} : { hour, minute }),
    ...(weekday !== undefined ? { weekday } : {}),
    ...(intervalMinutes !== undefined ? { intervalMinutes } : {})
  }
  return {
    intentKind: 'goal',
    candidates: [],
    goals: [goal],
    replyText: `好的，我会按计划跟进「${title}」，每次检查后在这里告诉你进度。`,
    confidence: 0.85
  }
}

function extractGoalTitle(text: string): string {
  const cleaned = stripSchedulePhrases(text)
    .replace(/每天|每日|每个工作日|工作日|每周[一二三四五六日天]?/g, ' ')
    .replace(/每隔\s*[\d一二两三四五六七八九十]+\s*(?:小时|钟头|分钟)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '')
    .trim()
  return (cleaned.length > 0 ? cleaned : text.trim()).slice(0, 50)
}

const ACTION_PATTERN =
  /(开|去|参加|见|到|做|交|送|吃|看|买|写|准备|安排|提醒|复习|考试|面试|会议|周会|评审|拜访|预约|打卡|练|跑步|健身|上课|上班|开会|有个会|碰|聊|讨论|沟通|汇报|对接)/

const MEMORY_STATEMENT_PATTERN =
  /(请记住|帮我记住|记住|我(?:更|最)?(?:喜欢|偏好|习惯|讨厌|不喜欢)|我住在|我的生日|我是.{0,10}(?:工程师|设计师|老师|学生|医生|产品经理|程序员))/

function isMemoryStatement(text: string): boolean {
  return MEMORY_STATEMENT_PATTERN.test(text) && !CLOCK_PATTERN.test(text)
}

function isSmallTalk(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2 || trimmed.length > 30) return false
  if (CLOCK_PATTERN.test(trimmed)) return false
  if (ACTION_PATTERN.test(trimmed)) return false
  return true
}

export function stripSchedulePhrases(input: string): string {
  let text = input
  text = text.replace(/帮我|帮忙|请|麻烦/g, ' ')
  text = text.replace(/记一下|记录一下|记个|安排一下|安排|提醒我|提醒|添加|新增|设置/g, ' ')
  text = text.replace(/^(?:我)?(?:要|想|需要)/, ' ')
  text = text.replace(/有个|有一场|有一项|一场|一项/g, ' ')
  text = text.replace(new RegExp(TIME_WORD_PATTERN.source, 'g'), ' ')
  text = text.replace(new RegExp(CLOCK_PATTERN.source, 'g'), ' ')
  text = text.replace(new RegExp(DURATION_PATTERN.source, 'g'), ' ')
  text = text.replace(/到|至|~|—|-/g, ' ')
  text = text.replace(/大概|大约|左右|前后/g, ' ')
  text = text.replace(/[，,。；;！!？?]/g, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

function extractTitle(text: string, description: string): string {
  const stripped = stripSchedulePhrases(text)
  const summary = stripped.length > 0 ? stripped : description.replace(/\s+/g, ' ').trim().slice(0, 20)
  return summary.slice(0, 50)
}

function extractLocation(text: string): string | undefined {
  const explicit = /(?:地点|在)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9]{1,15}(?:会议室|办公室|大厅|会议室|中心|医院|学校|公司|家|餐厅|咖啡厅))/.exec(
    text
  )
  return explicit?.[1]
}

function extractTimeExpression(text: string): string | undefined {
  const clockPattern = new RegExp(CLOCK_PATTERN.source, 'g')
  const clockMatches = Array.from(text.matchAll(clockPattern))
  const dateMatch = TIME_WORD_PATTERN.exec(text)
  if (clockMatches.length === 0) {
    if (!dateMatch) return undefined
    const after = text.slice(dateMatch.index + dateMatch[0].length)
    const period = /^(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚间)/.exec(after)?.[0]
    return `${dateMatch[0]}${period ?? ''}`
  }
  const firstClock = clockMatches[0]
  if (!firstClock || firstClock.index === undefined) return undefined
  const start = Math.min(dateMatch?.index ?? firstClock.index, firstClock.index)
  let end = firstClock.index + firstClock[0].length
  const second = clockMatches[1]
  if (second && second.index !== undefined) {
    const between = text.slice(firstClock.index + firstClock[0].length, second.index)
    if (/(?:到|至|~|—|-)/.test(between)) {
      end = second.index + second[0].length
    }
  }
  return text.slice(start, end).trim()
}

export function parseLocalAttachment(request: ParseRequest): ParseResult {
  const question = request.attachment?.question?.trim() ?? ''
  const lines = request.description.split(/\n+/).filter(line =>
    CLOCK_PATTERN.test(line) && !/^(?:DTSTART|DTEND|RRULE|SUMMARY|DESCRIPTION|LOCATION)[;:]/i.test(line))
  const askingToSchedule = /(?:加入|添加|导入|记入|记录|创建|帮我安排|安排到).{0,12}(?:日程|行程|安排|会议|活动)?/.test(question)
  if (lines.length && (!question || askingToSchedule)) {
    const parsed = localParse(lines.join('\n'), request.referenceTime)
    if (parsed.intentKind === 'schedule') return parsed
  }
  const excerpt = request.description.slice(0, 800)
  const text = question
    ? '本地模式已提取附件文字。需要解读或回答问题时，可切换到 DeepSeek 模式。'
    : '已提取附件文字：'
  return { intentKind: 'chitchat', candidates: [], replyText: text + '\n' + excerpt, confidence: 1 }
}

export function localParse(description: string, referenceTime: number): ParseResult {
  const text = description.trim()
  if (text.length === 0) {
    return { intentKind: 'unknown', candidates: [], replyText: '想安排点什么？', confidence: 0.2 }
  }

  if (GREETING_PATTERN.test(text)) {
    return {
      intentKind: 'chitchat',
      candidates: [],
      replyText: '你好，我是你的日程助手。告诉我时间与事情，例如“明天下午三点开项目周会”，我会帮你安排。',
      confidence: 0.95
    }
  }

  if (CANCEL_PATTERN.test(text)) {
    return {
      intentKind: 'cancel',
      candidates: [],
      replyText: '好的，我帮你处理取消。',
      confidence: 0.8
    }
  }

  if (MODIFY_PATTERN.test(text)) {
    const startExpression = extractTimeExpression(text)
    return {
      intentKind: 'modify',
      candidates: [{ ...(startExpression ? { startExpression } : {}) }],
      replyText: '好的，我来调整最近一条安排。',
      confidence: 0.8
    }
  }

  const goal = localGoal(text, referenceTime)
  if (goal) return goal

  if (isMemoryStatement(text)) {
    return {
      intentKind: 'chitchat',
      candidates: [],
      replyText: '我记下了，以后会按这个偏好来考虑。',
      confidence: 0.72
    }
  }

  if (isSmallTalk(text)) {
    return {
      intentKind: 'chitchat',
      candidates: [],
      replyText: '嗯，我在。想聊聊今天，还是安排一件具体的事？',
      confidence: 0.55
    }
  }

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const candidateLines = lines.length > 1 ? lines : [text]
  const candidates: ParsedCandidate[] = candidateLines.map((line) => {
    const timeExpr = extractTimeExpression(line)
    const title = extractTitle(line, line)
    const location = extractLocation(line)
    const startExpression = timeExpr
    const normalized = timeExpr ? normalizeExpression(timeExpr, referenceTime) : undefined
    const candidate: ParsedCandidate = {
      title,
      ...(startExpression ? { startExpression } : {}),
      ...(location ? { location } : {}),
      ...(normalized?.explicitEnd
        ? { endExpression: line.slice(line.indexOf('到') + 1, line.indexOf('到') + 20) }
        : {})
    }
    return candidate
  })

  const first = candidates[0]
  const timeFound = first?.startExpression !== undefined
  const titleFound = (first?.title ?? '').length > 0
  const confidence = timeFound ? (titleFound ? 0.9 : 0.6) : 0.45

  let replyText = '我理解到了你的安排。'
  if (!timeFound) {
    replyText = '这件事安排在什么时间？顺便告诉我大概多长时间。'
  } else if (first?.startExpression) {
    const normalized = normalizeExpression(first.startExpression, referenceTime)
    if (normalized.startAt !== undefined && normalized.endAt !== undefined) {
      replyText = `我理解的是：${first.title ?? '这件事'}，${formatDateLabel(normalized.startAt)} ${formatTime(
        normalized.startAt
      )}-${formatTime(normalized.endAt)}`
    }
  }

  return {
    intentKind: 'schedule',
    candidates,
    replyText,
    confidence
  }
}