import { z } from 'zod'
import { fail, ok, type Result } from '../result'
import { messageKeyOf } from '../error-catalog'
import {
  AI_CHANNELS,
  CUSTOM_FALLBACK_CATALOG,
  type PresetCatalog,
  type PresetCatalogEntry
} from './preset-catalog'

const capabilityLevelSchema = z.enum(['supported', 'unsupported'])
const capabilityTagSchema = z.enum(['text_only', 'official_api'])

const entrySchema = z.object({
  presetId: z.enum(['groq', 'deepseek', 'gemini', 'glm', 'openrouter', 'custom']),
  displayName: z.string().min(1).max(30),
  endpoint: z.string().min(1),
  models: z.object({
    text: z.string().optional(),
    vision: z.string().optional(),
    asr: z.string().optional()
  }),
  capabilities: z.object({
    text: capabilityLevelSchema,
    vision: capabilityLevelSchema,
    asr: capabilityLevelSchema
  }),
  keyRequirement: z.enum(['required', 'optional', 'none']),
  freeTier: z
    .object({
      coveredChannels: z.array(z.enum(['text', 'vision', 'asr'])),
      limitKind: z.enum(['rate', 'quota', 'both']),
      summaryKey: z.string().min(1).max(200),
      disclaimerKey: z.string().min(1).max(200)
    })
    .optional(),
  badge: z.enum(['free_recommended', 'domestic_direct', 'official_api', 'none']),
  sortWeight: z.number().int(),
  capabilityTags: z
    .array(capabilityTagSchema)
    .refine((tags) => new Set(tags).size === tags.length, { message: 'duplicate' })
    .optional(),
  keyHelpKey: z.string().min(1).max(80).optional()
})

const catalogSchema = z.object({
  catalogVersion: z.number().int().positive(),
  entries: z.array(entrySchema).min(6),
  recommendedPresetId: z.enum(['groq', 'deepseek', 'gemini', 'glm', 'openrouter', 'custom'])
})

function semanticIssue(entry: PresetCatalogEntry): boolean {
  for (const channel of AI_CHANNELS) {
    const supported = entry.capabilities[channel] === 'supported'
    const hasModel = entry.models[channel] !== undefined
    if (entry.presetId !== 'custom' && supported !== hasModel) return true
  }
  if (!entry.endpoint.startsWith('https://')) return true
  if (entry.freeTier && entry.freeTier.summaryKey.length > 200) return true
  if (entry.presetId === 'deepseek') {
    if (entry.capabilities.text !== 'supported' || !entry.models.text) return true
    if (entry.capabilities.vision !== 'unsupported' || entry.models.vision !== undefined) return true
    if (entry.capabilities.asr !== 'unsupported' || entry.models.asr !== undefined) return true
    if (entry.badge === 'free_recommended') return true
    if (entry.freeTier !== undefined) return true
  }
  if (entry.capabilityTags !== undefined) {
    if (entry.capabilityTags.length === 0) return true
    if (
      entry.capabilityTags.includes('text_only') &&
      (entry.capabilities.vision === 'supported' || entry.capabilities.asr === 'supported')
    ) {
      return true
    }
    if (entry.capabilityTags.includes('official_api') && entry.badge !== 'official_api') return true
  }
  return false
}

export function validatePresetCatalog(catalog: PresetCatalog): Result<PresetCatalog> {
  const parsed = catalogSchema.safeParse(catalog)
  if (!parsed.success) {
    return fail('E_PRESET_CATALOG_UNAVAILABLE', messageKeyOf('E_PRESET_CATALOG_UNAVAILABLE'))
  }
  const ids = catalog.entries.map((entry) => entry.presetId)
  if (new Set(ids).size !== ids.length) {
    return fail('E_PRESET_CATALOG_UNAVAILABLE', messageKeyOf('E_PRESET_CATALOG_UNAVAILABLE'))
  }
  if (catalog.entries.some(semanticIssue)) {
    return fail('E_PRESET_CATALOG_UNAVAILABLE', messageKeyOf('E_PRESET_CATALOG_UNAVAILABLE'))
  }
  const recommended = catalog.entries.filter((entry) => entry.badge === 'free_recommended')
  if (recommended.length > 1) {
    return fail('E_PRESET_CATALOG_UNAVAILABLE', messageKeyOf('E_PRESET_CATALOG_UNAVAILABLE'))
  }
  if (!catalog.entries.some((entry) => entry.presetId === 'custom')) {
    return fail('E_PRESET_CATALOG_UNAVAILABLE', messageKeyOf('E_PRESET_CATALOG_UNAVAILABLE'))
  }
  const custom = catalog.entries.filter((entry) => entry.presetId === 'custom')
  if (custom.length !== 1) {
    return fail('E_PRESET_CATALOG_UNAVAILABLE', messageKeyOf('E_PRESET_CATALOG_UNAVAILABLE'))
  }
  return ok(catalog)
}

export function safeCatalog(catalog: PresetCatalog): {
  readonly catalog: PresetCatalog
  readonly state: 'ok' | 'degraded'
} {
  const validated = validatePresetCatalog(catalog)
  if (validated.ok) return { catalog: validated.data, state: 'ok' }
  return { catalog: CUSTOM_FALLBACK_CATALOG, state: 'degraded' }
}