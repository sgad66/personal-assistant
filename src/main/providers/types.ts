import type { FailureCategory, Result } from '@shared/result'
import type { CareKind, MemoryCandidate } from '@shared/domain/types'
import type { ParseRequest, ParseResult } from '@shared/parse/types'

export type {
  ConversationContext,
  ParsedCandidate,
  ParseRequest,
  ParseResult
} from '@shared/parse/types'

export type IntentKind = 'schedule' | 'modify' | 'cancel' | 'chitchat' | 'unknown'

export interface Transcript {
  readonly text: string
}

export interface OcrResult {
  readonly text: string
  readonly layoutHints?: readonly string[]
}

export interface ITextUnderstandingProvider {
  parse(request: ParseRequest): Promise<Result<ParseResult>>
  recommend?(request: RecommendationRequest): Promise<Result<readonly RecommendationIdea[]>>
  checkGoal?(request: GoalCheckRequest): Promise<Result<GoalCheckResult>>
  summarizeConversation?(request: SummaryRequest): Promise<Result<string>>
  extractMemories?(request: MemoryExtractionRequest): Promise<Result<readonly MemoryCandidate[]>>
  generateCare?(request: CareRequest): Promise<Result<CareResult>>
}

export interface SummaryRequest {
  readonly previous?: string
  readonly messages: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]
}

export interface MemoryExtractionRequest {
  readonly recent: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]
  readonly existing: readonly string[]
}

export interface CareScheduleItem {
  readonly title: string
  readonly startAt: number
  readonly endAt: number
  readonly location?: string
}

export interface CareGoal {
  readonly title: string
  readonly progress: number
  readonly instruction: string
  readonly nextStep?: string
  readonly lastRunAt?: number
  readonly stalled?: boolean
}

export interface CareWeekSummary {
  readonly count: number
  readonly busyMinutes: number
  readonly busiestDay?: string
}

export interface CareRequest {
  readonly kind: CareKind
  readonly referenceTime: number
  readonly timeZone: string
  readonly today: readonly CareScheduleItem[]
  readonly tomorrow: readonly CareScheduleItem[]
  readonly week: CareWeekSummary
  readonly goals: readonly CareGoal[]
  readonly memories: readonly string[]
  readonly summary?: string
  readonly recent: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]
}

export interface CareResult {
  readonly message: string
  readonly memoryCandidates: readonly MemoryCandidate[]
}

export interface GoalCheckRequest {
  readonly goal: {
    readonly title: string
    readonly instruction: string
    readonly cadence: string
    readonly progress: number
    readonly progressNote?: string
    readonly nextStep?: string
    readonly checkpoints: readonly {
      readonly at: number
      readonly progress: number
      readonly status: string
      readonly summary: string
    }[]
  }
  readonly referenceTime: number
  readonly timeZone: string
}

export interface GoalCheckResult {
  readonly summary: string
  readonly progress: number
  readonly nextStep?: string
}

export interface RecommendationRequest {
  readonly recentActivities: readonly { title: string; date: string }[]
  readonly alreadyScheduled: readonly string[]
  readonly availableSlots: readonly { index: number; date: string; time: string; minutes: number }[]
}

export interface RecommendationIdea {
  readonly slot: number
  readonly title: string
  readonly reason: string
  readonly minutes: number
}

export interface ISpeechToTextProvider {
  transcribe(tempFilePath: string, durationMs: number): Promise<Result<Transcript>>
}

export interface IImageToTextProvider {
  extract(tempFilePath: string, mimeType: string): Promise<Result<OcrResult>>
}

export interface ProviderConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly visionModel: string
  readonly asrModel: string
}

/** 仅兼容旧引用；新代码只用 `ChannelBudget`（shared/ai/timeout-policy）。 */
export interface TimeoutBudget {
  readonly textMs: number
  readonly voiceMs: number
  readonly imageMs: number
}

/** 仅兼容旧引用；新代码只用 `ChannelBudget`（shared/ai/timeout-policy）。 */
export const DEFAULT_TIMEOUT_BUDGET: TimeoutBudget = {
  textMs: 5_000,
  voiceMs: 8_000,
  imageMs: 10_000
}

export interface ProviderErrorDetail {
  readonly failureCategory: FailureCategory
  readonly status?: number
}
