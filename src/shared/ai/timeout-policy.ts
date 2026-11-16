import type { FailureStage } from '../result'
import type { AiChannelKind } from './preset-catalog'

export type TimeoutTier = 'standard' | 'relaxed'

export interface TimeoutPreferences {
  readonly relaxed: boolean
}

export interface ChannelBudget {
  readonly channel: AiChannelKind
  readonly tier: TimeoutTier
  readonly firstByteMs: number
  readonly overallMs: number
  readonly totalWaitMs: number
}

export const DEFAULT_TIMEOUT_PREFERENCES: TimeoutPreferences = Object.freeze({ relaxed: false })

export const AUTO_RETRY_MAX = 1
export const RETRY_MIN_REMAINING_MS = 3_000
export const MEDIA_RETENTION_MS = 120_000
export const RETENTION_SWEEP_INTERVAL_MS = 5_000

type BudgetTriple = readonly [number, number, number]

export const TIMEOUT_BUDGETS: Readonly<
  Record<TimeoutTier, Readonly<Record<AiChannelKind, BudgetTriple>>>
> = Object.freeze({
  standard: Object.freeze({
    text: Object.freeze([8_000, 15_000, 20_000] as const),
    vision: Object.freeze([15_000, 30_000, 35_000] as const),
    asr: Object.freeze([10_000, 20_000, 25_000] as const)
  }),
  relaxed: Object.freeze({
    text: Object.freeze([12_000, 25_000, 30_000] as const),
    vision: Object.freeze([20_000, 45_000, 50_000] as const),
    asr: Object.freeze([15_000, 35_000, 40_000] as const)
  })
})

export function tierOf(preferences?: TimeoutPreferences): TimeoutTier {
  return preferences?.relaxed === true ? 'relaxed' : 'standard'
}

export function effectiveTimeoutPreferences(preferences?: TimeoutPreferences): TimeoutPreferences {
  return preferences?.relaxed === true
    ? Object.freeze({ relaxed: true })
    : DEFAULT_TIMEOUT_PREFERENCES
}

export function budgetFor(channel: AiChannelKind, preferences?: TimeoutPreferences): ChannelBudget {
  const tier = tierOf(preferences)
  const triple = TIMEOUT_BUDGETS[tier][channel]
  return Object.freeze({
    channel,
    tier,
    firstByteMs: triple[0],
    overallMs: triple[1],
    totalWaitMs: triple[2]
  })
}

export function mediaRetentionMs(): number {
  return MEDIA_RETENTION_MS
}

export type { FailureStage }