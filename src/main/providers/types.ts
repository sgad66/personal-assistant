import type { FailureCategory, Result } from '@shared/result'
import type { ParseRequest, ParseResult } from '@shared/parse/types'

export type { ParsedCandidate, ParseRequest, ParseResult } from '@shared/parse/types'

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
