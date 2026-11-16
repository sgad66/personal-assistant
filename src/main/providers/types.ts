import type { FailureCategory, Result } from '@shared/result'

export type IntentKind = 'schedule' | 'modify' | 'cancel' | 'chitchat' | 'unknown'

export interface ParseRequest {
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
  readonly confidence: number
}

export interface Transcript {
  readonly text: string
}

export interface OcrResult {
  readonly text: string
  readonly layoutHints?: readonly string[]
}

export interface ITextUnderstandingProvider {
  parse(request: ParseRequest): Promise<Result<ParseResult>>
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