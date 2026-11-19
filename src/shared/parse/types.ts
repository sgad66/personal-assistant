import type { IntentKind, MemoryKind } from '@shared/domain/types'
import type { ChatAttachment } from '@shared/ipc-contracts'

export interface ConversationContext {
  readonly summary?: string
  readonly recent: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]
  readonly memories: readonly { readonly content: string; readonly kind: MemoryKind }[]
  readonly goals: readonly {
    readonly title: string
    readonly progress: number
    readonly nextStep?: string
  }[]
  readonly schedule: readonly {
    readonly title: string
    readonly startAt: number
    readonly endAt: number
    readonly location?: string
  }[]
}

export interface ParseRequest {
  readonly attachment?: ChatAttachment
  readonly description: string
  readonly referenceTime: number
  readonly timeZone: string
  readonly contextHints?: readonly string[]
  readonly conversationContext?: ConversationContext
}

export interface ParsedCandidate {
  readonly title?: string
  readonly startExpression?: string
  readonly endExpression?: string
  readonly location?: string
  readonly note?: string
}

export interface ParsedGoal {
  readonly title?: string
  readonly instruction?: string
  readonly cadence?: 'once' | 'daily' | 'weekdays' | 'weekly' | 'interval'
  readonly hour?: number
  readonly minute?: number
  readonly weekday?: number
  readonly intervalMinutes?: number
  readonly atExpression?: string
}

export interface ParseResult {
  readonly intentKind: IntentKind
  readonly candidates: readonly ParsedCandidate[]
  readonly goals?: readonly ParsedGoal[]
  readonly replyText: string
  readonly quoteText?: string
  readonly confidence: number
}