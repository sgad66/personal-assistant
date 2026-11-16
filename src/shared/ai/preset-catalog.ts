// 预设服务商目录：编译期常量，零网络依赖，只提供建议值，永不反写用户配置

export type AiChannelKind = 'text' | 'vision' | 'asr'
export type PresetId = 'groq' | 'deepseek' | 'gemini' | 'glm' | 'openrouter' | 'custom'

export const AI_CHANNELS: readonly AiChannelKind[] = ['text', 'vision', 'asr']
export const PRESET_IDS: readonly PresetId[] = ['groq', 'deepseek', 'gemini', 'glm', 'openrouter', 'custom']

export type CapabilityLevel = 'supported' | 'unsupported'
export type PresetBadge = 'free_recommended' | 'domestic_direct' | 'official_api' | 'none'
export type PresetCapabilityTag = 'text_only' | 'official_api'
export type KeyRequirement = 'required' | 'optional' | 'none'
export type FreeTierLimitKind = 'rate' | 'quota' | 'both'

export interface PresetModels {
  readonly text?: string
  readonly vision?: string
  readonly asr?: string
}

export interface FreeTierInfo {
  readonly coveredChannels: readonly AiChannelKind[]
  readonly limitKind: FreeTierLimitKind
  readonly summaryKey: string
  readonly disclaimerKey: string
}

export interface PresetCatalogEntry {
  readonly presetId: PresetId
  readonly displayName: string
  readonly endpoint: string
  readonly models: PresetModels
  readonly capabilities: Readonly<Record<AiChannelKind, CapabilityLevel>>
  readonly keyRequirement: KeyRequirement
  readonly freeTier?: FreeTierInfo
  readonly badge: PresetBadge
  readonly sortWeight: number
  readonly capabilityTags?: readonly PresetCapabilityTag[]
  readonly keyHelpKey?: string
}

export interface PresetCatalog {
  readonly catalogVersion: number
  readonly entries: readonly PresetCatalogEntry[]
  readonly recommendedPresetId: PresetId
}

export interface PresetSummary {
  readonly presetId: PresetId
  readonly displayName: string
  readonly endpoint: string
  readonly models: PresetModels
  readonly capabilities: Readonly<Record<AiChannelKind, CapabilityLevel>>
  readonly keyRequirement: KeyRequirement
  readonly freeTier?: FreeTierInfo
  readonly badge: PresetBadge
  readonly capabilityTags?: readonly PresetCapabilityTag[]
  readonly keyHelpKey?: string
}

const SUPPORTED: CapabilityLevel = 'supported'
const UNSUPPORTED: CapabilityLevel = 'unsupported'

function caps(
  text: CapabilityLevel,
  vision: CapabilityLevel,
  asr: CapabilityLevel
): Readonly<Record<AiChannelKind, CapabilityLevel>> {
  return Object.freeze({ text, vision, asr })
}

const DISCLAIMER_KEY = 'ai.disclaimer'

const BUILTIN_ENTRIES: readonly PresetCatalogEntry[] = [
  {
    presetId: 'groq',
    displayName: 'Groq（免费推荐）',
    endpoint: 'https://api.groq.com/openai/v1',
    models: Object.freeze({
      text: 'openai/gpt-oss-120b',
      vision: 'qwen/qwen3.8-27b',
      asr: 'whisper-large-v3-turbo'
    }),
    capabilities: caps(SUPPORTED, SUPPORTED, SUPPORTED),
    keyRequirement: 'required',
    freeTier: Object.freeze({
      coveredChannels: Object.freeze(['text', 'vision', 'asr'] as AiChannelKind[]),
      limitKind: 'both',
      summaryKey: 'ai.freeTier.groq',
      disclaimerKey: DISCLAIMER_KEY
    }),
    badge: 'free_recommended',
    sortWeight: 0
  },
  {
    presetId: 'deepseek',
    displayName: 'DeepSeek（官方 API）',
    endpoint: 'https://api.deepseek.com/v1',
    models: Object.freeze({
      text: 'deepseek-chat'
    }),
    capabilities: caps(SUPPORTED, UNSUPPORTED, UNSUPPORTED),
    keyRequirement: 'required',
    badge: 'official_api',
    sortWeight: 5,
    capabilityTags: Object.freeze(['text_only', 'official_api'] as PresetCapabilityTag[]),
    keyHelpKey: 'ai.keyHelp.deepseek'
  },
  {
    presetId: 'gemini',
    displayName: 'Google Gemini（免费额度）',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: Object.freeze({
      text: 'gemini-2.0-flash',
      vision: 'gemini-2.0-flash'
    }),
    capabilities: caps(SUPPORTED, SUPPORTED, UNSUPPORTED),
    keyRequirement: 'required',
    freeTier: Object.freeze({
      coveredChannels: Object.freeze(['text', 'vision'] as AiChannelKind[]),
      limitKind: 'both',
      summaryKey: 'ai.freeTier.gemini',
      disclaimerKey: DISCLAIMER_KEY
    }),
    badge: 'none',
    sortWeight: 10
  },
  {
    presetId: 'glm',
    displayName: '智谱 GLM（国内直连）',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    models: Object.freeze({
      text: 'glm-4-flash',
      vision: 'glm-4.6v-flash'
    }),
    capabilities: caps(SUPPORTED, SUPPORTED, UNSUPPORTED),
    keyRequirement: 'required',
    freeTier: Object.freeze({
      coveredChannels: Object.freeze(['text', 'vision'] as AiChannelKind[]),
      limitKind: 'both',
      summaryKey: 'ai.freeTier.glm',
      disclaimerKey: DISCLAIMER_KEY
    }),
    badge: 'domestic_direct',
    sortWeight: 20
  },
  {
    presetId: 'openrouter',
    displayName: 'OpenRouter（:free 模型）',
    endpoint: 'https://openrouter.ai/api/v1',
    models: Object.freeze({
      text: 'meta-llama/llama-3.3-70b-instruct:free',
      vision: 'google/gemini-2.0-flash-exp:free'
    }),
    capabilities: caps(SUPPORTED, SUPPORTED, UNSUPPORTED),
    keyRequirement: 'required',
    freeTier: Object.freeze({
      coveredChannels: Object.freeze(['text', 'vision'] as AiChannelKind[]),
      limitKind: 'both',
      summaryKey: 'ai.freeTier.openrouter',
      disclaimerKey: DISCLAIMER_KEY
    }),
    badge: 'none',
    sortWeight: 30
  },
  {
    presetId: 'custom',
    displayName: '自定义（OpenAI 兼容）',
    endpoint: 'https://api.openai.com/v1',
    models: Object.freeze({
      text: 'gpt-4o-mini',
      vision: 'gpt-4o-mini',
      asr: 'whisper-1'
    }),
    capabilities: caps(SUPPORTED, SUPPORTED, SUPPORTED),
    keyRequirement: 'optional',
    freeTier: Object.freeze({
      coveredChannels: Object.freeze([] as AiChannelKind[]),
      limitKind: 'both',
      summaryKey: 'ai.freeTier.custom',
      disclaimerKey: DISCLAIMER_KEY
    }),
    badge: 'none',
    sortWeight: 100
  }
]

function deepFreezeCatalog(entries: readonly PresetCatalogEntry[]): PresetCatalog {
  for (const entry of entries) {
    Object.freeze(entry.models)
    Object.freeze(entry.capabilities)
    if (entry.capabilityTags) {
      Object.freeze(entry.capabilityTags)
    }
    if (entry.freeTier) {
      Object.freeze(entry.freeTier.coveredChannels)
      Object.freeze(entry.freeTier)
    }
    Object.freeze(entry)
  }
  Object.freeze(entries)
  const catalog: PresetCatalog = Object.freeze({
    catalogVersion: 2,
    entries,
    recommendedPresetId: 'groq' as PresetId
  })
  return Object.freeze(catalog)
}

const BUILTIN_CATALOG = deepFreezeCatalog(BUILTIN_ENTRIES)

export function getPresetCatalog(): PresetCatalog {
  return BUILTIN_CATALOG
}

export function findPreset(presetId: PresetId, catalog: PresetCatalog = BUILTIN_CATALOG): PresetCatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.presetId === presetId)
}

export function orderedPresets(catalog: PresetCatalog = BUILTIN_CATALOG): readonly PresetCatalogEntry[] {
  return catalog.entries
    .slice()
    .sort((a, b) => {
      if (a.presetId === 'custom') return 1
      if (b.presetId === 'custom') return -1
      if (a.badge === 'free_recommended' && b.badge !== 'free_recommended') return -1
      if (b.badge === 'free_recommended' && a.badge !== 'free_recommended') return 1
      return a.sortWeight - b.sortWeight
    })
}

export function supportsChannel(entry: PresetCatalogEntry, channel: AiChannelKind): boolean {
  if (entry.presetId === 'custom') return true
  return entry.capabilities[channel] === 'supported' && entry.models[channel] !== undefined
}

export function defaultModelFor(entry: PresetCatalogEntry, channel: AiChannelKind): string | undefined {
  return entry.models[channel]
}

export function capabilityTagsOf(entry: PresetCatalogEntry): readonly PresetCapabilityTag[] {
  return entry.capabilityTags ?? EMPTY_CAPABILITY_TAGS
}

const EMPTY_CAPABILITY_TAGS: readonly PresetCapabilityTag[] = Object.freeze([])

export function toPresetSummary(entry: PresetCatalogEntry): PresetSummary {
  return {
    presetId: entry.presetId,
    displayName: entry.displayName,
    endpoint: entry.endpoint,
    models: entry.models,
    capabilities: entry.capabilities,
    keyRequirement: entry.keyRequirement,
    ...(entry.freeTier ? { freeTier: entry.freeTier } : {}),
    badge: entry.badge,
    ...(entry.capabilityTags ? { capabilityTags: entry.capabilityTags } : {}),
    ...(entry.keyHelpKey ? { keyHelpKey: entry.keyHelpKey } : {})
  }
}

export const CUSTOM_FALLBACK_CATALOG: PresetCatalog = deepFreezeCatalog([
  BUILTIN_ENTRIES[BUILTIN_ENTRIES.length - 1] as PresetCatalogEntry
])