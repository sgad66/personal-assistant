import type {
  AiAccessConfigInput,
  AiAccessConfigView,
  CapabilityGapConfirmation,
  ChannelBindingInput,
  KeyOp,
  ValidationIssue
} from './access-config'
import { CONFIG_VERSION, validateChannels } from './access-config'
import type { SolutionId } from './solution'
import {
  DEFAULT_TIMEOUT_PREFERENCES,
  effectiveTimeoutPreferences,
  type TimeoutPreferences
} from './timeout-policy'
import {
  AI_CHANNELS,
  defaultModelFor,
  findPreset,
  supportsChannel,
  type AiChannelKind,
  type PresetCatalog,
  type PresetId
} from './preset-catalog'

export const MAX_CONFIRMATIONS = 20

export interface KeyDraft {
  readonly presetId: PresetId
  readonly storedMask: string
  readonly hasStoredKey: boolean
  readonly secret?: string
  readonly cleared: boolean
}

export interface AiDraft {
  readonly expectedVersion: number
  readonly bindings: Readonly<Record<AiChannelKind, ChannelBindingInput>>
  readonly keyDrafts: readonly KeyDraft[]
  readonly touchedChannels: readonly AiChannelKind[]
  readonly advancedChannels: readonly AiChannelKind[]
  readonly solution?: SolutionId
  readonly confirmations?: readonly CapabilityGapConfirmation[]
  readonly timeouts?: TimeoutPreferences
}

function cloneBinding(binding: ChannelBindingInput): ChannelBindingInput {
  return {
    enabled: binding.enabled,
    mode: binding.mode,
    presetId: binding.presetId,
    endpoint: binding.endpoint,
    model: binding.model,
    source: binding.source
  }
}

function uniquePresetIds(view: AiAccessConfigView): PresetId[] {
  const ids: PresetId[] = []
  for (const channel of AI_CHANNELS) {
    const binding = view.channels[channel]
    if (!ids.includes(binding.presetId)) ids.push(binding.presetId)
  }
  return ids
}

export function createDraft(view: AiAccessConfigView): AiDraft {
  const bindings: Record<AiChannelKind, ChannelBindingInput> = {
    text: cloneBinding(view.channels.text),
    vision: cloneBinding(view.channels.vision),
    asr: cloneBinding(view.channels.asr)
  }
  const keyDrafts: KeyDraft[] = uniquePresetIds(view).map((presetId) => {
    const channel = AI_CHANNELS.map((kind) => view.channels[kind]).find((item) => item.presetId === presetId)
    return {
      presetId,
      storedMask: channel?.keyMask ?? '',
      hasStoredKey: channel?.hasKey ?? false,
      cleared: false
    }
  })
  return {
    expectedVersion: view.version,
    bindings,
    keyDrafts,
    touchedChannels: [],
    advancedChannels: [],
    ...(view.solution ? { solution: view.solution } : {}),
    timeouts: effectiveTimeoutPreferences(view.timeouts)
  }
}

function ensureKeyDraft(keyDrafts: readonly KeyDraft[], presetId: PresetId): KeyDraft[] {
  if (keyDrafts.some((draft) => draft.presetId === presetId)) return keyDrafts.slice()
  return [
    ...keyDrafts,
    { presetId, storedMask: '', hasStoredKey: false, cleared: false }
  ]
}

function markTouched(touched: readonly AiChannelKind[], channel: AiChannelKind): AiChannelKind[] {
  return touched.includes(channel) ? touched.slice() : [...touched, channel]
}

export function selectPreset(
  draft: AiDraft,
  channel: AiChannelKind,
  presetId: PresetId,
  catalog: PresetCatalog
): AiDraft {
  const entry = findPreset(presetId, catalog)
  const current = draft.bindings[channel]
  let endpoint = current.endpoint
  let model = current.model
  let source = current.source
  if (entry && presetId !== 'custom' && supportsChannel(entry, channel)) {
    endpoint = entry.endpoint
    model = defaultModelFor(entry, channel) ?? current.model
    source = 'preset_default'
  } else if (presetId === 'custom') {
    source = 'custom_override'
  }
  const next: ChannelBindingInput = { ...current, presetId, endpoint, model, source }
  return {
    ...draft,
    bindings: { ...draft.bindings, [channel]: next },
    keyDrafts: ensureKeyDraft(draft.keyDrafts, presetId),
    touchedChannels: markTouched(draft.touchedChannels, channel)
  }
}

export function setChannelEnabledWithCatalog(
  draft: AiDraft,
  channel: AiChannelKind,
  enabled: boolean,
  catalog: PresetCatalog
): AiDraft {
  const current = draft.bindings[channel]
  let next: ChannelBindingInput = { ...current, enabled }
  if (enabled && (!current.endpoint.trim() || !current.model.trim())) {
    const entry = findPreset(current.presetId, catalog)
    if (entry && current.presetId !== 'custom') {
      next = {
        ...next,
        endpoint: current.endpoint.trim() || entry.endpoint,
        model: current.model.trim() || defaultModelFor(entry, channel) || ''
      }
    }
  }
  return {
    ...draft,
    bindings: { ...draft.bindings, [channel]: next },
    touchedChannels: markTouched(draft.touchedChannels, channel)
  }
}

export function setChannelEnabled(draft: AiDraft, channel: AiChannelKind, enabled: boolean): AiDraft {
  return setChannelEnabledWithCatalog(draft, channel, enabled, EMPTY_CATALOG)
}

const EMPTY_CATALOG: PresetCatalog = Object.freeze({
  catalogVersion: 1,
  entries: [],
  recommendedPresetId: 'custom' as PresetId
})

export function setChannelMode(draft: AiDraft, channel: AiChannelKind, mode: 'ai' | 'local'): AiDraft {
  if (channel !== 'text') return draft
  const current = draft.bindings[channel]
  return {
    ...draft,
    bindings: {
      ...draft.bindings,
      [channel]: { ...current, mode, enabled: mode === 'local' ? true : current.enabled }
    },
    touchedChannels: markTouched(draft.touchedChannels, channel)
  }
}

export function setAdvancedOverride(
  draft: AiDraft,
  channel: AiChannelKind,
  patch: Partial<Pick<ChannelBindingInput, 'endpoint' | 'model'>>
): AiDraft {
  const current = draft.bindings[channel]
  return {
    ...draft,
    bindings: {
      ...draft.bindings,
      [channel]: {
        ...current,
        ...(patch.endpoint !== undefined ? { endpoint: patch.endpoint } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        source: 'custom_override'
      }
    },
    touchedChannels: markTouched(draft.touchedChannels, channel),
    advancedChannels: markTouched(draft.advancedChannels, channel)
  }
}

export function stageKey(draft: AiDraft, presetId: PresetId, secret: string): AiDraft {
  const keyDrafts = ensureKeyDraft(draft.keyDrafts, presetId).map((item) =>
    item.presetId === presetId
      ? { ...item, secret: secret.length > 0 ? secret : undefined, cleared: false }
      : item
  )
  return { ...draft, keyDrafts }
}

export function clearKey(draft: AiDraft, presetId: PresetId): AiDraft {
  const keyDrafts = ensureKeyDraft(draft.keyDrafts, presetId).map((item) =>
    item.presetId === presetId
      ? { ...item, secret: undefined, cleared: true }
      : item
  )
  return { ...draft, keyDrafts }
}

export function recommendedDraft(catalog: PresetCatalog, previous: AiDraft): AiDraft {
  const groq = findPreset('groq', catalog)
  const build = (channel: AiChannelKind): ChannelBindingInput => ({
    enabled: true,
    mode: 'ai',
    presetId: 'groq',
    endpoint: groq?.endpoint ?? '',
    model: groq ? (defaultModelFor(groq, channel) ?? '') : '',
    source: 'preset_default'
  })
  const keyDrafts = previous.keyDrafts.map((item) =>
    item.presetId === 'groq'
      ? { ...item, secret: undefined, cleared: false }
      : item
  )
  return {
    expectedVersion: previous.expectedVersion,
    bindings: {
      text: build('text'),
      vision: build('vision'),
      asr: build('asr')
    },
    keyDrafts: ensureKeyDraft(keyDrafts, 'groq'),
    touchedChannels: ['text', 'vision', 'asr'],
    advancedChannels: [],
    solution: 'groq_free',
    timeouts: effectiveTimeoutPreferences(previous.timeouts),
    ...(previous.confirmations ? { confirmations: previous.confirmations } : {})
  }
}

export function resetToCustom(draft: AiDraft): AiDraft {
  const empty = (channel: AiChannelKind): ChannelBindingInput => ({
    enabled: false,
    mode: channel === 'text' ? 'local' : 'ai',
    presetId: 'custom',
    endpoint: '',
    model: '',
    source: 'custom_override'
  })
  return {
    expectedVersion: draft.expectedVersion,
    bindings: { text: empty('text'), vision: empty('vision'), asr: empty('asr') },
    keyDrafts: draft.keyDrafts.map((item) => ({ ...item, secret: undefined, cleared: true })),
    touchedChannels: ['text', 'vision', 'asr'],
    advancedChannels: [],
    timeouts: effectiveTimeoutPreferences(draft.timeouts)
  }
}

export function hasDraftKey(draft: AiDraft, presetId: PresetId): boolean {
  const item = draft.keyDrafts.find((entry) => entry.presetId === presetId)
  if (!item) return false
  if (item.cleared) return false
  if (item.secret !== undefined && item.secret.length > 0) return true
  return item.hasStoredKey
}

export function validateDraft(draft: AiDraft, catalog: PresetCatalog): readonly ValidationIssue[] {
  return validateChannels(toConfigInput(draft), catalog, (presetId) => hasDraftKey(draft, presetId))
}

export function toConfigInput(draft: AiDraft): AiAccessConfigInput {
  const keyOps: KeyOp[] = draft.keyDrafts.map((item) => {
    if (item.cleared) return { op: 'clear', presetId: item.presetId }
    if (item.secret !== undefined && item.secret.length > 0) {
      return { op: 'set', presetId: item.presetId, secret: item.secret }
    }
    return { op: 'keep', presetId: item.presetId }
  })
  return {
    expectedVersion: draft.expectedVersion,
    channels: draft.bindings,
    keyOps,
    timeouts: effectiveTimeoutPreferences(draft.timeouts),
    ...(draft.solution ? { solution: draft.solution } : {}),
    ...(draft.confirmations ? { confirmations: draft.confirmations } : {})
  }
}

export function setRelaxedTimeout(draft: AiDraft, relaxed: boolean): AiDraft {
  return { ...draft, timeouts: { relaxed } }
}

export function appendConfirmation(draft: AiDraft, confirmation: CapabilityGapConfirmation): AiDraft {
  const list = [...(draft.confirmations ?? []), confirmation]
  return { ...draft, confirmations: list.slice(-MAX_CONFIRMATIONS) }
}

export function isDirty(draft: AiDraft, view: AiAccessConfigView): boolean {
  if (draft.solution !== view.solution) return true
  if ((draft.timeouts?.relaxed ?? false) !== view.timeouts.relaxed) return true
  for (const channel of AI_CHANNELS) {
    const a = draft.bindings[channel]
    const b = view.channels[channel]
    if (
      a.enabled !== b.enabled ||
      a.mode !== b.mode ||
      a.presetId !== b.presetId ||
      a.endpoint !== b.endpoint ||
      a.model !== b.model ||
      a.source !== b.source
    ) {
      return true
    }
  }
  for (const item of draft.keyDrafts) {
    if (item.secret !== undefined && item.secret.length > 0) return true
    if (item.cleared) return true
  }
  return false
}

export function createBlankDraft(catalog: PresetCatalog): AiDraft {
  const custom = findPreset('custom', catalog)
  const build = (channel: AiChannelKind): ChannelBindingInput => ({
    enabled: false,
    mode: 'ai',
    presetId: 'custom',
    endpoint: custom?.endpoint ?? '',
    model: custom ? (defaultModelFor(custom, channel) ?? '') : '',
    source: 'custom_override'
  })
  return {
    expectedVersion: CONFIG_VERSION,
    bindings: { text: build('text'), vision: build('vision'), asr: build('asr') },
    keyDrafts: [{ presetId: 'custom', storedMask: '', hasStoredKey: false, cleared: false }],
    touchedChannels: [],
    advancedChannels: [],
    timeouts: DEFAULT_TIMEOUT_PREFERENCES
  }
}