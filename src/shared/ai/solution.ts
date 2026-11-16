import type { ChannelBindingInput } from './access-config'
import type { AiDraft, KeyDraft } from './draft'
import { recommendedDraft } from './draft'
import { effectiveTimeoutPreferences } from './timeout-policy'
import {
  AI_CHANNELS,
  defaultModelFor,
  findPreset,
  type AiChannelKind,
  type CapabilityLevel,
  type PresetCatalog,
  type PresetId
} from './preset-catalog'

export type SolutionId = 'deepseek_default' | 'deepseek_strict' | 'groq_free' | 'user_custom'

export const RECOMMENDED_SOLUTION: SolutionId = 'deepseek_default'
export const DEFAULT_SOLUTION: SolutionId = 'deepseek_default'

export interface SolutionDefinition {
  readonly id: SolutionId
  readonly labelKey: string
  readonly requiredKeys: readonly PresetId[]
  readonly capabilityCoverage: Readonly<Record<AiChannelKind, CapabilityLevel>>
  readonly noticeKey: string
  readonly isDefault: boolean
}

const COVERAGE_ALL: Readonly<Record<AiChannelKind, CapabilityLevel>> = Object.freeze({
  text: 'supported',
  vision: 'supported',
  asr: 'supported'
})

const COVERAGE_TEXT_ONLY: Readonly<Record<AiChannelKind, CapabilityLevel>> = Object.freeze({
  text: 'supported',
  vision: 'unsupported',
  asr: 'unsupported'
})

export const SOLUTION_CATALOG: readonly SolutionDefinition[] = Object.freeze([
  {
    id: 'deepseek_default',
    labelKey: 'ai.solution.deepseekDefault',
    requiredKeys: Object.freeze(['deepseek', 'groq'] as PresetId[]),
    capabilityCoverage: COVERAGE_ALL,
    noticeKey: 'ai.solution.notice',
    isDefault: true
  },
  {
    id: 'deepseek_strict',
    labelKey: 'ai.solution.strict',
    requiredKeys: Object.freeze(['deepseek'] as PresetId[]),
    capabilityCoverage: COVERAGE_TEXT_ONLY,
    noticeKey: 'ai.gap.deepseekVision',
    isDefault: false
  },
  {
    id: 'groq_free',
    labelKey: 'ai.solution.groqFree',
    requiredKeys: Object.freeze(['groq'] as PresetId[]),
    capabilityCoverage: COVERAGE_ALL,
    noticeKey: 'ai.freeTier.groq',
    isDefault: false
  },
  {
    id: 'user_custom',
    labelKey: 'ai.solution.restoreDefault',
    requiredKeys: Object.freeze([] as PresetId[]),
    capabilityCoverage: COVERAGE_ALL,
    noticeKey: 'ai.disclaimer',
    isDefault: false
  }
])

export function findSolution(id: SolutionId): SolutionDefinition | undefined {
  return SOLUTION_CATALOG.find((solution) => solution.id === id)
}

function ensureSolutionKeys(previous: AiDraft, ids: readonly PresetId[]): KeyDraft[] {
  let list = previous.keyDrafts.map((item) => ({ ...item }))
  for (const presetId of ids) {
    const index = list.findIndex((item) => item.presetId === presetId)
    if (index >= 0) {
      list[index] = { ...(list[index] as KeyDraft), cleared: false }
      continue
    }
    list = [...list, { presetId, storedMask: '', hasStoredKey: false, cleared: false }]
  }
  return list
}

function bindPreset(
  catalog: PresetCatalog,
  presetId: PresetId,
  channel: AiChannelKind,
  fallback: ChannelBindingInput
): ChannelBindingInput {
  const entry = findPreset(presetId, catalog)
  return {
    enabled: true,
    mode: 'ai',
    presetId,
    endpoint: entry?.endpoint ?? fallback.endpoint,
    model: entry ? (defaultModelFor(entry, channel) ?? fallback.model) : fallback.model,
    source: 'preset_default'
  }
}

export function deepseekSolutionDraft(catalog: PresetCatalog, previous: AiDraft): AiDraft {
  return {
    expectedVersion: previous.expectedVersion,
    bindings: {
      text: bindPreset(catalog, 'deepseek', 'text', previous.bindings.text),
      vision: bindPreset(catalog, 'groq', 'vision', previous.bindings.vision),
      asr: bindPreset(catalog, 'groq', 'asr', previous.bindings.asr)
    },
    keyDrafts: ensureSolutionKeys(previous, ['deepseek', 'groq']),
    touchedChannels: ['text', 'vision', 'asr'],
    advancedChannels: [],
    solution: 'deepseek_default',
    timeouts: effectiveTimeoutPreferences(previous.timeouts),
    ...(previous.confirmations ? { confirmations: previous.confirmations } : {})
  }
}

export function strictDeepSeekDraft(catalog: PresetCatalog, previous: AiDraft): AiDraft {
  const text = bindPreset(catalog, 'deepseek', 'text', previous.bindings.text)
  const pinned = (channel: AiChannelKind): ChannelBindingInput => ({
    ...previous.bindings[channel],
    presetId: 'deepseek',
    enabled: false
  })
  return {
    expectedVersion: previous.expectedVersion,
    bindings: {
      text,
      vision: pinned('vision'),
      asr: pinned('asr')
    },
    keyDrafts: ensureSolutionKeys(previous, ['deepseek']),
    touchedChannels: ['text', 'vision', 'asr'],
    advancedChannels: [],
    solution: 'deepseek_strict',
    timeouts: effectiveTimeoutPreferences(previous.timeouts),
    ...(previous.confirmations ? { confirmations: previous.confirmations } : {})
  }
}

export function groqFreeDraft(catalog: PresetCatalog, previous: AiDraft): AiDraft {
  return recommendedDraft(catalog, previous)
}

export function resolveSolution(
  channels: Readonly<Record<AiChannelKind, ChannelBindingInput>>,
  catalog: PresetCatalog,
  hasKey: (presetId: PresetId) => boolean,
  declared?: SolutionId
): SolutionId {
  if (declared !== undefined) return declared
  if (!findPreset('deepseek', catalog)) return 'user_custom'
  if (channels.vision.presetId === 'deepseek' && !channels.vision.enabled &&
    channels.asr.presetId === 'deepseek' && !channels.asr.enabled) {
    return 'deepseek_strict'
  }
  const textOnDeepSeek =
    channels.text.enabled && channels.text.presetId === 'deepseek' && hasKey('deepseek')
  const alternativeVision =
    channels.vision.enabled &&
    channels.vision.presetId !== 'deepseek' &&
    hasKey(channels.vision.presetId)
  const alternativeAsr =
    channels.asr.enabled && channels.asr.presetId !== 'deepseek' && hasKey(channels.asr.presetId)
  if (textOnDeepSeek && alternativeVision && alternativeAsr) return 'deepseek_default'
  const allGroq =
    findPreset('groq', catalog) !== undefined &&
    AI_CHANNELS.every(
      (channel) => channels[channel].presetId === 'groq' && channels[channel].source === 'preset_default'
    )
  if (allGroq && hasKey('groq')) return 'groq_free'
  return 'user_custom'
}