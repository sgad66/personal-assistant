import type { CareSettings, CareState, Goal, ScheduleEvent } from '@shared/domain/types'
import type { CareNotice } from '@shared/ipc-contracts'
import { careKindLabel, careDueKind, dateKey, normalizeCareSettings } from '@shared/care/schedule'
import { fail, ok, type Result } from '@shared/result'
import { messageKeyOf } from '@shared/error-catalog'
import { addDays, formatTime, startOfDay, startOfWeek } from '@shared/time-kit'
import type { DataStore } from '../storage/data-store'
import type { ConversationRepository } from '../storage/conversation-repository'
import type { Logger } from '../observability/logger'
import type { ResolvedAccess } from '../ai/provider-resolver'
import type {
  CareRequest,
  CareResult,
  CareScheduleItem,
  CareWeekSummary,

  ITextUnderstandingProvider
} from '../providers/types'
import type { MemoryService } from './memory-service'
import type { ConversationSummaryService } from './conversation-summary-service'

const CARE_MAX_MESSAGE = 1000
const MINUTE_MS = 60_000
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export interface CareServiceDeps {
  readonly store: DataStore
  readonly conversation: ConversationRepository
  readonly memories: MemoryService
  readonly summary: ConversationSummaryService
  readonly getAccess: () => ResolvedAccess
  readonly logger: Logger
  readonly clock: () => number
  readonly timeZone: string
  readonly onRan?: (notice: CareNotice) => void
}

export class CareService {
  private running = false

  constructor(private readonly deps: CareServiceDeps) {}

  settings(): CareSettings {
    return this.deps.store.snapshot().careSettings
  }

  state(): CareState {
    return this.deps.store.snapshot().careState
  }

  updateSettings(patch: Partial<CareSettings>): Result<CareSettings> {
    const current = this.settings()
    const next = normalizeCareSettings({ ...current, ...patch })
    const written = this.deps.store.write((draft) => {
      draft.careSettings = next
      return next
    })
    return written.ok ? ok(next) : fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'))
  }

  async runDue(now: number): Promise<void> {
    if (this.running) return
    const kind = careDueKind(this.settings(), this.state(), now)
    if (!kind) return
    this.running = true
    try {
      await this.run(kind, now)
    } finally {
      this.running = false
    }
  }

  async run(kind: CareNotice['kind'], now: number): Promise<void> {
    const request = this.buildRequest(kind, now)
    const access = this.deps.getAccess()
    const provider = access.text.kind === 'ready' ? (access.text.provider as ITextUnderstandingProvider) : undefined
    let generated: CareResult | undefined
    if (access.text.kind === 'ready' && access.text.actualPresetId !== 'local' && provider?.generateCare) {
      const result = await provider.generateCare(request).catch(() => undefined)
      if (result?.ok) {
        generated = result.data
      } else if (result && !result.ok) {
        this.deps.logger.failure('care.failed', result.error.code, 0)
      }
    }
    const text = (generated?.message ?? localCareMessage(kind, request, now)).trim().slice(0, CARE_MAX_MESSAGE)
    if (text.length === 0) return
    if (generated?.memoryCandidates.length) {
      this.deps.memories.addMany(generated.memoryCandidates.slice(0, 2), 'ai')
    }

    const message = this.appendMessage(kind, text, now)
    const key = dateKey(now)
    const previous = this.state()
    const sentToday = previous.sentDate === key ? previous.sentToday : 0
    this.deps.store.write((draft) => {
      draft.careState = {
        sentDate: key,
        sentToday: sentToday + 1,
        ...(kind === 'morning' ? { lastMorningKey: key } : previous.lastMorningKey ? { lastMorningKey: previous.lastMorningKey } : {}),
        ...(kind === 'evening' ? { lastEveningKey: key } : previous.lastEveningKey ? { lastEveningKey: previous.lastEveningKey } : {}),
        ...(kind === 'weekly' ? { lastWeeklyKey: key } : previous.lastWeeklyKey ? { lastWeeklyKey: previous.lastWeeklyKey } : {}),
        updatedAt: now
      }
    })
    this.deps.logger.success('care.ran', 0)
    this.deps.onRan?.({ kind, at: now, message })
  }

  private appendMessage(kind: CareNotice['kind'], text: string, now: number): CareNotice['message'] {
    const message = {
      messageId: `msg_care_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant' as const,
      content: text,
      modality: 'text' as const,
      createdAt: now,
      status: 'parsed' as const,
      sourceLabel: careKindLabel(kind)
    }
    this.deps.conversation.appendMessage(message)
    return message
  }

  private buildRequest(kind: CareNotice['kind'], now: number): CareRequest {
    const snapshot = this.deps.store.snapshot()
    const dayStart = startOfDay(now)
    const tomorrowStart = addDays(dayStart, 1)
    const today = eventsBetween(snapshot.events, dayStart, tomorrowStart)
    const tomorrow = eventsBetween(snapshot.events, tomorrowStart, addDays(tomorrowStart, 1))
    const recentResult = this.deps.conversation.listMessages(8)
    const recent = recentResult.ok
      ? recentResult.data.slice(-6).map((message) => ({
          role: message.role,
          content: message.content.slice(0, 300)
        }))
      : []
    const summary = this.deps.summary.summary()
    return {
      kind,
      referenceTime: now,
      timeZone: this.deps.timeZone,
      today,
      tomorrow,
      week: weekSummary(snapshot.events, now),
      goals: snapshot.goals
        .filter((goal) => goal.status === 'active')
        .slice(0, 6)
        .map((goal) => ({
          title: goal.title,
          progress: goal.progress,
          instruction: goal.instruction,
          ...(goal.nextStep ? { nextStep: goal.nextStep } : {}),
          ...(goal.lastRunAt !== undefined ? { lastRunAt: goal.lastRunAt } : {}),
          ...(goalIsStalled(goal) ? { stalled: true } : {})
        })),
      memories: this.deps.memories.retrieve('', 8).map((memory) => memory.content),
      ...(summary?.text ? { summary: summary.text.slice(0, 900) } : {}),
      recent
    }
  }
}

function eventsBetween(events: readonly ScheduleEvent[], from: number, to: number): CareScheduleItem[] {
  return events
    .filter((event) => event.status === 'active' && event.startAt < to && event.endAt > from)
    .sort((a, b) => a.startAt - b.startAt)
    .slice(0, 8)
    .map((event) => ({
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      ...(event.location ? { location: event.location } : {})
    }))
}

function localCareMessage(kind: CareNotice['kind'], request: CareRequest, now: number): string {
  if (kind === 'morning') return localMorning(request, now)
  if (kind === 'evening') return localEvening(request, now)
  return localWeekly(request)
}

function eventLine(item: CareScheduleItem): string {
  return `${formatTime(item.startAt)} ${item.title}${item.location ? `（${item.location}）` : ''}`
}

function localMorning(request: CareRequest, now: number): string {
  const parts: string[] = []
  if (request.today.length === 0) {
    parts.push('早上好。今天暂时没有安排。')
    if (request.goals[0]) {
      const goal = request.goals[0]
      parts.push(
        `可以从「${goal.title}」里挑一个 30 分钟的小步骤${goal.nextStep ? `：${goal.nextStep}` : '，把今天最想推进的部分做掉'}。`
      )
    } else {
      parts.push('可以把今天想推进的事告诉我，我帮你记下来并安排跟进。')
    }
  } else {
    const preview = request.today.slice(0, 3).map(eventLine).join('；')
    parts.push(`早上好。今天有 ${request.today.length} 项安排：${preview}${request.today.length > 3 ? ' 等' : ''}。`)
    const first = request.today[0]
    if (first) parts.push(`先从「${first.title}」开始，留出一点准备时间会更从容。`)
    if (request.goals[0]) {
      const goal = request.goals[0]
      parts.push(
        `目标「${goal.title}」当前 ${goal.progress}%${goal.nextStep ? `，下一步：${goal.nextStep}` : '，今天推进一小步就很好'}。`
      )
    }
  }
  const birthdays = birthdayMemories(request.memories, now)
  if (birthdays.length > 0) {
    parts.push(`另外，记忆里今天是「${birthdays[0]}」，别忘了。`)
  }
  return parts.join('\n')
}

function localEvening(request: CareRequest, now: number): string {
  const parts: string[] = ['今天到这里。']
  if (request.today.length > 0) {
    const past = request.today.filter((item) => item.endAt <= now)
    const upcoming = request.today.filter((item) => item.endAt > now)
    parts.push(
      past.length > 0
        ? `今天排了 ${request.today.length} 项，时间已经过去的有：${past.slice(0, 3).map(eventLine).join('；')}。`
        : `今天排了 ${request.today.length} 项：${request.today.slice(0, 3).map(eventLine).join('；')}。`
    )
    if (upcoming.length > 0) {
      parts.push(`还没结束的：${upcoming.slice(0, 2).map(eventLine).join('；')}。`)
    }
  } else {
    parts.push('今天没有排定的事项。')
  }
  parts.push('想请你复盘三件事：今天最有进展的一步是什么？哪件事卡住了？明天最重要的一件事是什么？')
  if (request.goals[0]) {
    const goal = request.goals[0]
    parts.push(
      `目标「${goal.title}」记录在 ${goal.progress}%。如果今天有推进，可以去目标页继续跟进，我会把这次检查记下来。`
    )
  }
  const stalled = request.goals.filter((goal) => goal.stalled === true)
  if (stalled.length > 0) {
    parts.push(
      `「${stalled[0]?.title}」最近几次跟进没有变化，要不要把节奏调慢一点，或者拆成更小的一步？`
    )
  }
  const prep = request.tomorrow.filter((item) => isPrepWorthy(item.title)).slice(0, 1)
  if (prep.length > 0) {
    const item = prep[0]
    if (item) parts.push(`明天 ${formatTime(item.startAt)} 有「${item.title}」，今晚可以先准备一下要点。`)
  }
  return parts.join('\n')
}

function localWeekly(request: CareRequest): string {
  const parts: string[] = []
  if (request.week.count > 0) {
    const busy =
      request.week.busyMinutes >= 60
        ? `${Math.round((request.week.busyMinutes / 60) * 10) / 10} 小时`
        : `${request.week.busyMinutes} 分钟`
    parts.push(
      `这周共安排 ${request.week.count} 项，已排约 ${busy}${request.week.busiestDay ? `，最忙的是${request.week.busiestDay}` : ''}。`
    )
  } else {
    parts.push('这周还没有排定的事项。')
  }
  if (request.goals.length > 0) {
    parts.push(
      `目标进展：${request.goals
        .slice(0, 3)
        .map((goal) => `「${goal.title}」${goal.progress}%`)
        .join('；')}。`
    )
  }
  parts.push('下周可以只挑一件最重要的事，给它留一个固定时段；其余安排尽量留出缓冲。')
  if (request.goals.some((goal) => goal.stalled === true)) {
    parts.push('如果某个目标连续几次没有变化，建议把它拆成一个 30 分钟内能完成的小步骤。')
  }
  return parts.join('\n')
}

function birthdayMemories(memories: readonly string[], now: number): string[] {
  const date = new Date(now)
  const month = date.getMonth() + 1
  const day = date.getDate()
  return memories.filter((memory) => {
    if (!/(生日|纪念日|纪念)/.test(memory)) return false
    const match = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(memory)
    if (!match) return false
    return Number.parseInt(match[1] ?? '0', 10) === month && Number.parseInt(match[2] ?? '0', 10) === day
  })
}

function isPrepWorthy(title: string): boolean {
  return /(面试|汇报|考试|评审|交付|发布|答辩|签约|演讲|路演|体检)/.test(title)
}

function goalIsStalled(goal: Goal): boolean {
  const recent = goal.checkpoints.slice(-2)
  if (recent.length < 2) return false
  const last = recent[recent.length - 1]
  return recent.every((item) => item.progress === last?.progress) && goal.runCount >= 2
}

function weekSummary(events: readonly ScheduleEvent[], now: number): CareWeekSummary {
  const weekStart = startOfWeek(now)
  const weekEnd = addDays(weekStart, 7)
  const relevant = events.filter(
    (event) => event.status === 'active' && event.startAt < weekEnd && event.endAt > weekStart
  )
  const busyMinutes = Math.round(
    relevant.reduce(
      (sum, event) =>
        sum + Math.max(0, Math.min(event.endAt, weekEnd) - Math.max(event.startAt, weekStart)),
      0
    ) / MINUTE_MS
  )
  const dayCounts = new Map<number, number>()
  for (const event of relevant) {
    const day = startOfDay(Math.max(event.startAt, weekStart))
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
  }
  const busiest = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  return {
    count: relevant.length,
    busyMinutes,
    ...(busiest ? { busiestDay: WEEKDAY_LABELS[new Date(busiest[0]).getDay()] } : {})
  }
}