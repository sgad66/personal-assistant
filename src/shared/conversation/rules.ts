import type { ConflictItem } from '@shared/domain/types'

export const JUDGE_ORDER = [
  'ask_missing',
  'ask_inconsistent',
  'ask_past',
  'ask_duplicate',
  'ask_conflict',
  'confirm_recap',
  'write'
] as const

export type JudgeStep = (typeof JUDGE_ORDER)[number]

export interface JudgeInput {
  missingFields: readonly string[]
  startAt?: number
  endAt?: number
  now: number
  duplicateEventId?: string
  conflicts: readonly Pick<ConflictItem, 'eventId'>[]
  confidence: number
  threshold: number
}

export function judgeNextStep(input: JudgeInput): JudgeStep {
  if (input.missingFields.includes('startAt') || input.startAt === undefined) return 'ask_missing'
  if (input.endAt !== undefined && input.endAt <= input.startAt) return 'ask_inconsistent'
  if (input.startAt <= input.now) return 'ask_past'
  if (input.duplicateEventId !== undefined) return 'ask_duplicate'
  if (input.conflicts.length > 0) return 'ask_conflict'
  if (input.confidence < input.threshold) return 'confirm_recap'
  return 'write'
}