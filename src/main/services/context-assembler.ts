import type { ConversationMessage } from '@shared/domain/types'
import type { ConversationContext } from '@shared/parse/types'
import { HOUR_MS } from '@shared/time-kit'
import type { ConversationRepository } from '../storage/conversation-repository'
import type { DataStore } from '../storage/data-store'
import type { MemoryService } from './memory-service'

const RECENT_LIMIT = 10
const MEMORY_LIMIT = 8
const GOAL_LIMIT = 5
const SCHEDULE_LIMIT = 8
const SUMMARY_CHARS = 900
const RECENT_CHARS = 240
const TOTAL_BUDGET = 5_200

export interface ContextAssemblerDeps {
  readonly store: DataStore
  readonly conversation: ConversationRepository
  readonly memories: MemoryService
  readonly clock: () => number
}

export class ContextAssembler {
  constructor(private readonly deps: ContextAssemblerDeps) {}

  build(excludeMessageId: string | undefined, query: string): ConversationContext {
    const now = this.deps.clock()
    const messagesResult = this.deps.conversation.listMessages(120)
    const messages = messagesResult.ok ? messagesResult.data : []
    const snapshot = this.deps.store.snapshot()
    const summary = snapshot.summary

    const filtered = messages.filter((message) => message.messageId !== excludeMessageId)
    const coveredIndex = summary
      ? filtered.findIndex((message) => message.messageId === summary.coversUntil)
      : -1
    const afterSummary = coveredIndex >= 0 ? filtered.slice(coveredIndex + 1) : filtered
    const tail = filtered.slice(-4)
    const recent = uniqueMessages([...afterSummary, ...tail]).slice(-RECENT_LIMIT)

    const memoryQuery =
      query.trim().length > 0
        ? query
        : filtered
            .filter((message) => message.role === 'user')
            .slice(-3)
            .map((message) => message.content)
            .join(' ')
    const memories = this.deps.memories.retrieve(memoryQuery, MEMORY_LIMIT)
    const goals = snapshot.goals
      .filter((goal) => goal.status === 'active')
      .sort((a, b) => a.nextRunAt - b.nextRunAt)
      .slice(0, GOAL_LIMIT)
      .map((goal) => ({
        title: goal.title,
        progress: goal.progress,
        ...(goal.nextStep ? { nextStep: goal.nextStep } : {})
      }))
    const horizon = now + 36 * HOUR_MS
    const schedule = snapshot.events
      .filter((event) => event.status === 'active' && event.endAt > now && event.startAt < horizon)
      .sort((a, b) => a.startAt - b.startAt)
      .slice(0, SCHEDULE_LIMIT)
      .map((event) => ({
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt,
        ...(event.location ? { location: event.location } : {})
      }))

    const context: ConversationContext = {
      ...(summary?.text ? { summary: summary.text.slice(0, SUMMARY_CHARS) } : {}),
      recent: recent.map((message) => ({
        role: message.role,
        content: message.content.slice(0, RECENT_CHARS)
      })),
      memories: memories.map((memory) => ({ content: memory.content, kind: memory.kind })),
      goals,
      schedule
    }
    return trimBudget(context)
  }
}

function uniqueMessages(messages: readonly ConversationMessage[]): ConversationMessage[] {
  const seen = new Set<string>()
  const result: ConversationMessage[] = []
  for (const message of messages) {
    if (seen.has(message.messageId)) continue
    seen.add(message.messageId)
    result.push(message)
  }
  return result
}

function contextSize(context: ConversationContext): number {
  return JSON.stringify(context).length
}

function trimBudget(context: ConversationContext): ConversationContext {
  let recent = context.recent.slice()
  let next: ConversationContext = { ...context, recent }
  while (contextSize(next) > TOTAL_BUDGET && recent.length > 2) {
    recent = recent.slice(1)
    next = { ...context, recent }
  }
  return next
}