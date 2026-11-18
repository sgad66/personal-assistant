import { randomUUID } from 'node:crypto'
import type { ScheduleRecommendation, ScheduleRecommendations } from '@shared/ipc-contracts'
import { freeBlocksOf } from '@shared/free-blocks'
import { addDays, formatLocalDate, formatRange, MINUTE_MS, startOfDay } from '@shared/time-kit'
import { errorText } from '@shared/message-catalog'
import type { ResolvedAccess } from '../ai/provider-resolver'
import type { RecommendationIdea, RecommendationRequest } from '../providers/types'
import type { DataStore } from '../storage/data-store'
import type { ScheduleService } from './schedule-service'
import type { ScheduleEvent } from '@shared/domain/types'

const GENERIC_IDEAS = [
  { title: '整理近期待办', reason: '留出一小段时间，把接下来要做的事情列成清单。' },
  { title: '散步放松', reason: '利用空档出门走走，给连续安排留一点休息时间。' },
  { title: '规划下一天', reason: '提前选出下一天最想完成的一件事。' }
]

function titleKey(title: string): string {
  return title.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

function scheduledTitles(events: readonly ScheduleEvent[], today: number): string[] {
  const end = addDays(today, 2)
  return [...new Set(events.filter(event => event.status === 'active' && event.endAt > today && event.startAt < end).map(event => event.title))]
}

function localIdeas(request: RecommendationRequest): RecommendationIdea[] {
  const activities = [...new Set(request.recentActivities.map(activity => activity.title))]
  const reserved = new Set(request.alreadyScheduled.map(titleKey))
  const followUps = activities.filter(activity => !activity.startsWith('整理「')).map(activity => ({
    title: `整理「${activity.slice(0, 40)}」的后续事项`, reason: `近期日程里有「${activity}」，可以用这段时间回顾并记下下一步。`
  }))
  const ideas = [...followUps, ...GENERIC_IDEAS].filter(idea => !reserved.has(titleKey(idea.title)))
  return ideas.slice(0, Math.min(3, request.availableSlots.length)).map((idea, index) => {
    const slot = request.availableSlots[index]!
    return { ...idea, slot: slot.index, minutes: Math.min(30, slot.minutes) }
  })
}

export class RecommendationService {
  private readonly offers = new Map<string, ScheduleRecommendation>()
  private pending?: { key: string; result: Promise<ScheduleRecommendations> }

  constructor(
    private readonly store: DataStore,
    private readonly schedule: ScheduleService,
    private readonly getAccess: () => ResolvedAccess
  ) {}

  async list(): Promise<ScheduleRecommendations> {
    if (this.store.loadFailed) throw new Error('日程读取失败，请重新打开应用后再试。')
    const access = this.getAccess()
    const now = this.store.now()
    const key = `${access.revision}/${this.store.revision}/${Math.floor(now / MINUTE_MS)}`
    if (this.pending?.key === key) return this.pending.result
    const result = this.generate(access, now)
    this.pending = { key, result }
    try {
      return await result
    } finally {
      if (this.pending?.result === result) this.pending = undefined
    }
  }

  private async generate(access: ResolvedAccess, now: number): Promise<ScheduleRecommendations> {
    const channel = access.text
    if (channel.kind !== 'ready') throw new Error(errorText(channel.code))
    const source = channel.actualPresetId === 'local' ? 'local' : 'deepseek'
    if (source === 'deepseek' && channel.presetId !== 'deepseek') {
      throw new Error('请先在设置中选择本地解析或 DeepSeek。')
    }
    const events = this.store.snapshot().events.filter(event => event.status === 'active')
    const today = startOfDay(now)
    const nextQuarter = (Math.floor(now / (15 * MINUTE_MS)) + 1) * 15 * MINUTE_MS
    const todaySlots = startOfDay(nextQuarter) === today ? freeBlocksOf(events, nextQuarter, 9, 21, 15) : []
    const tomorrowSlots = freeBlocksOf(events, addDays(today, 1), 9, 21, 15)
    // A long free day can host distinct morning, afternoon and evening choices.
    const slots = [...todaySlots, ...tomorrowSlots].flatMap(block => {
      const day = new Date(block.startAt)
      const boundaries = [13, 18].map(hour => day.setHours(hour, 0, 0, 0))
        .filter(time => time - block.startAt >= 15 * MINUTE_MS && block.endAt - time >= 15 * MINUTE_MS)
      const times = [block.startAt, ...boundaries, block.endAt]
      return times.slice(1).map((endAt, index) => ({ startAt: times[index]!, endAt }))
    })
    if (!slots.length) return { source, items: [] }
    const request: RecommendationRequest = {
      alreadyScheduled: scheduledTitles(events, today),
      recentActivities: events
        .filter(event => event.startAt <= now && event.endAt >= addDays(today, -14))
        .sort((a, b) => b.startAt - a.startAt)
        .slice(0, 16)
        .map(event => ({ title: event.title, date: formatLocalDate(event.startAt) })),
      availableSlots: slots.map((slot, index) => ({
        index, date: formatLocalDate(slot.startAt), time: formatRange(slot.startAt, slot.endAt),
        minutes: Math.floor((slot.endAt - slot.startAt) / MINUTE_MS)
      }))
    }
    let ideas: readonly RecommendationIdea[]
    if (source === 'local') {
      ideas = localIdeas(request)
    } else {
      if (!('recommend' in channel.provider) || !channel.provider.recommend) {
        throw new Error('DeepSeek 推荐服务当前不可用。')
      }
      const response = await channel.provider.recommend({ ...request, alreadyScheduled: request.alreadyScheduled.slice(0, 48) })
      if (!response.ok) throw new Error(`DeepSeek：${errorText(response.error.code)}`)
      if (this.getAccess().revision !== access.revision) throw new Error('解析模式已更改，请重新获取建议。')
      ideas = response.data
    }

    const items: ScheduleRecommendation[] = []
    const usedSlots = new Set<number>()
    const usedTitles = new Set(scheduledTitles(this.store.snapshot().events, today).map(titleKey))
    for (const idea of ideas) {
      const slot = slots[idea.slot]
      const key = titleKey(idea.title)
      if (!slot || usedSlots.has(idea.slot) || usedTitles.has(key)) continue
      const endAt = slot.startAt + idea.minutes * MINUTE_MS
      if (endAt > slot.endAt || slot.startAt <= this.store.now()) continue
      if (this.schedule.detectConflict({ startAt: slot.startAt, endAt }).length) continue
      const item = { id: randomUUID(), title: idea.title, reason: idea.reason, startAt: slot.startAt, endAt }
      usedSlots.add(idea.slot)
      usedTitles.add(key)
      items.push(item)
      this.offers.set(item.id, item)
    }
    for (const [id, item] of this.offers) {
      if (item.startAt <= now || this.offers.size > 64) this.offers.delete(id)
    }
    return { source, items: items.sort((a, b) => a.startAt - b.startAt) }
  }

  add(id: string): { eventId: string } {
    const item = this.offers.get(id)
    if (!item) throw new Error('该建议已失效或已添加，请刷新查看最新日程。')
    if (scheduledTitles(this.store.snapshot().events, startOfDay(this.store.now())).some(title => titleKey(title) === titleKey(item.title))) {
      throw new Error('今明两天已经安排了这个事项。')
    }
    const result = this.schedule.createEvent({
      title: item.title, startAt: item.startAt, endAt: item.endAt, sourceModality: 'text'
    })
    if (!result.ok) throw new Error(errorText(result.error.code))
    this.offers.delete(id)
    return { eventId: result.data.eventId }
  }
}
