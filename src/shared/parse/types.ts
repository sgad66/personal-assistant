import type { IntentKind } from '@shared/domain/types'
import type { ChatAttachment } from '@shared/ipc-contracts'

export interface ParseRequest {
  readonly attachment?: ChatAttachment
  readonly description: string
  readonly referenceTime: number
  readonly timeZone: string
  readonly contextHints?: readonly string[]
}

export interface ParsedCandidate {
  readonly title?: string
  readonly startExpression?: string
  readonly endExpression?: string
  readonly location?: string
  readonly note?: string
}

export interface ParseResult {
  readonly intentKind: IntentKind
  readonly candidates: readonly ParsedCandidate[]
  readonly replyText: string
  readonly quoteText?: string
  readonly confidence: number
}