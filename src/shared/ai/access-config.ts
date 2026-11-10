import { ok } from '../result'
import type { AppError, Result } from '../result'
import { messageKeyOf, type AppErrorCode } from '../error-catalog'
import type { PresetSummary } from './preset-catalog'
import {
  AI_CHANNELS,
  findPreset,
  supportsChannel,
  toPresetSummary,
  type AiChannelKind,
  type PresetCatalog,
  type PresetCatalogEntry,
  type PresetId
} from './preset-catalog'

export const CONFIG_VERSION = 2

export type BindingSource = 'preset_default' | 'custom_override'
export type ChannelMode = 'ai' | 'local'
export type ChannelAvailability = 'available' | 'unsupported' | 'missing_key' | 'disabled' | 'invalid_endpoint'
export type AccessStatus = 'local' | 'free_recommended' | 'custom'
export type AiFailureClass =
  | 'not_configured'
  | 'unauthorized'
  | 'rate_limited'
  | 'model_unavailable'
  | 'network'
  | 'timeout'
  | 'unparsable'
  | 'service_error'

export interface ChannelBindingInput {
  readonly enabled: boolean
  readonly mode: ChannelMode
  readonly presetId: PresetId
  readonly endpoint: string
  readonly model: string
  readonly source: BindingSource
}

export interface ChannelBinding extends ChannelBindingInput {
  readonly channel: AiChannelKind
  readonly availability: ChannelAvailability
  readonly lastFailure?: AiFailureClass
}

export interface PresetKeyRecord {
  readonly presetId: PresetId
  readonly keyMask: string
  readonly sealed: string
  readonly vault: 'safe_storage' | 'plain'
  readonly updatedAt: number
}

export interface AiAccessConfig {
  readonly version: number
  readonly channels: Readonly<Record<AiChannelKind, ChannelBinding>>
  readonly keys: readonly PresetKeyRecord[]
  readonly status: AccessStatus
  readonly lastSavedAt: number
  readonly legacy?: Readonly<Record<string, unknown>>
}

export interface ChannelBindingView {
  readonly channel: AiChannelKind
  readonly enabled: boolean
  readonly mode: ChannelMode
  readonly presetId: PresetId
  readonly presetName: string
  readonly endpoint: string
  readonly model: string
  readonly source: BindingSource
  readonly availability: ChannelAvailability
  readonly hasKey: boolean
  readonly keyMask: string
  readonly lastFailure?: AiFailureClass
}

export interface AiConfigWarning {
  readonly code: string
  readonly messageKey: string
  readonly channel?: AiChannelKind
}

export interface AiAccessConfigView {
  readonly contractVersion: number
  readonly version: number
  readonly status: AccessStatus
  readonly channels: Readonly<Record<AiChannelKind, ChannelBindingView>>
  readonly presets: readonly PresetSummary[]
  readonly catalogState: 'ok' | 'degraded'
  readonly warnings: readonly AiConfigWarning[]
  readonly lastSavedAt: number
  readonly baseUrl: string
  readonly apiKey: ''
  readonly model: string
  readonly visionModel: string
  readonly asrModel: string
}

export interface AiAccessConfigInput {
  readonly expectedVersion: number
  readonly channels: Readonly<Record<AiChannelKind, ChannelBindingInput>>
  readonly keyOps: readonly KeyOp[]
}

export type KeyOp =
  | { readonly op: 'set'; readonly presetId: PresetId; readonly secret: string }
  | { readonly op: 'clear'; readonly presetId: PresetId }
  | { readonly op: 'keep'; readonly presetId: PresetId }

export interface ValidationIssue {
  readonly channel?: AiChannelKind
  readonly field: 'preset' | 'endpoint' | 'model' | 'apiKey' | 'channels'
  readonly code: AppErrorCode
  readonly messageKey: string
}

export interface PendingSecret {
  readonly presetId: PresetId
  readonly secret: string
}

export interface MigrationOutcome {
  readonly config: AiAccessConfig
  readonly migrated: boolean
  readonly warnings: readonly AiConfigWarning[]
  readonly pendingSecrets: readonly PendingSecret[]
  readonly error?: AppError
}

export const DEFAULT_ENDPOINT = 'https://api.openai.com/v1'
export const DEFAULT_MODELS = {
  text: 'gpt-4o-mini',
  vision: 'gpt-4o-mini',
  asr: 'whisper-1'
} as const

export function maskSecret(secret: string): string {
  const trimmed = secret.trim()
  if (trimmed.length === 0) return ''
  const tail = Array.from(trimmed).slice(-4).join('')
  return `••••${tail}`
}

function customBinding(_channel: AiChannelKind, endpoint: string, model: string): ChannelBindingInput {
  return {
    enabled: false,
    mode: 'ai',
    presetId: 'custom',
    endpoint,
    model,
    source: 'custom_override'
  }
}

export function emptyShellConfig(now: number): AiAccessConfig {
  return {
    version: CONFIG_VERSION,
    channels: {
      text: {
        ...customBinding('text', DEFAULT_ENDPOINT, DEFAULT_MODELS.text),
        enabled: true,
        mode: 'local',
        channel: 'text',
        availability: 'available'
      },
      vision: { ...customBinding('vision', DEFAULT_ENDPOINT, DEFAULT_MODELS.vision), channel: 'vision', availability: 'disabled' },
      asr: { ...customBinding('asr', DEFAULT_ENDPOINT, DEFAULT_MODELS.asr), channel: 'asr', availability: 'disabled' }
    },
    keys: [],
    status: 'local',
    lastSavedAt: now
  }
}

function normalizeBinding(
  channel: AiChannelKind,
  raw: Partial<ChannelBindingInput> | undefined,
  fallback: ChannelBindingInput,
  hasKey: boolean,
  entries: ReadonlyMap<PresetId, PresetCatalogEntry>
): ChannelBinding {
  const presetId = raw?.presetId ?? fallback.presetId
  const entry = entries.get(presetId)
  const binding: ChannelBindingInput = {
    enabled: raw?.enabled ?? fallback.enabled,
    mode: channel === 'text' ? (raw?.mode ?? fallback.mode) : 'ai',
    presetId,
    endpoint: (raw?.endpoint ?? fallback.endpoint).trim(),
    model: (raw?.model ?? fallback.model).trim(),
    source: raw?.source ?? fallback.source
  }
  const availability = deriveAvailability({ ...binding, channel, availability: 'available' }, entry, hasKey, entries)
  return { ...binding, channel, availability }
}

export function deriveAvailability(
  binding: ChannelBindingInput & { channel: AiChannelKind; availability?: ChannelAvailability },
  entry: PresetCatalogEntry | undefined,
  hasKey: boolean,
  entries?: ReadonlyMap<PresetId, PresetCatalogEntry>
): ChannelAvailability {
  if (!binding.enabled) return 'disabled'
  if (binding.channel === 'text' && binding.mode === 'local') return 'available'
  const resolvedEntry = entry ?? entries?.get(binding.presetId)
  if (!resolvedEntry) return 'unsupported'
  if (!supportsChannel(resolvedEntry, binding.channel)) return 'unsupported'
  if (!binding.endpoint.startsWith('https://')) return 'invalid_endpoint'
  if (!binding.model.trim()) return 'missing_key'
  if (!hasKey) return 'missing_key'
  return 'available'
}

export function deriveStatus(
  channels: Readonly<Record<AiChannelKind, ChannelBindingInput>>,
  entries: ReadonlyMap<PresetId, PresetCatalogEntry>,
  hasKey: (presetId: PresetId) => boolean
): AccessStatus {
  const list = AI_CHANNELS.map((channel) => channels[channel])
  if (list.every((binding) => !binding.enabled)) return 'local'
  if (
    channels.text.mode === 'local' &&
    !channels.vision.enabled &&
    !channels.asr.enabled
  ) {
    return 'local'
  }
  const allGroq = list.every((binding) => binding.presetId === 'groq' && binding.source === 'preset_default')
  if (allGroq && entries.has('groq') && hasKey('groq')) return 'free_recommended'
  return 'custom'
}

export function migrateLegacyConfig(raw: unknown, now = Date.now(), catalog?: PresetCatalog): MigrationOutcome {
  const entries: ReadonlyMap<PresetId, PresetCatalogEntry> = new Map(
    (catalog?.entries ?? []).map((entry) => [entry.presetId, entry])
  )
  if (typeof raw !== 'object' || raw === null) {
    return {
      config: emptyShellConfig(now),
      migrated: false,
      warnings: [],
      pendingSecrets: []
    }
  }

  const record = raw as Record<string, unknown>
  const version = typeof record.version === 'number' ? record.version : undefined

  if (version !== undefined && version > CONFIG_VERSION) {
    return {
      config: emptyShellConfig(now),
      migrated: false,
      warnings: [],
      pendingSecrets: [],
      error: {
        code: 'E_CONFIG_READ_FAIL',
        messageKey: messageKeyOf('E_CONFIG_READ_FAIL'),
        retryable: true
      }
    }
  }

  if (version === CONFIG_VERSION && typeof record.channels === 'object' && record.channels !== null) {
    const rawChannels = record.channels as Record<string, Partial<ChannelBindingInput>>
    const keys = Array.isArray(record.keys) ? (record.keys as PresetKeyRecord[]) : []
    const keySet = new Set(keys.map((key) => key.presetId))
    const channels: Record<AiChannelKind, ChannelBinding> = {
      text: normalizeBinding('text', rawChannels.text, customBinding('text', DEFAULT_ENDPOINT, DEFAULT_MODELS.text), keySet.has(rawChannels.text?.presetId ?? 'custom'), entries),
      vision: normalizeBinding('vision', rawChannels.vision, customBinding('vision', DEFAULT_ENDPOINT, DEFAULT_MODELS.vision), keySet.has(rawChannels.vision?.presetId ?? 'custom'), entries),
      asr: normalizeBinding('asr', rawChannels.asr, customBinding('asr', DEFAULT_ENDPOINT, DEFAULT_MODELS.asr), keySet.has(rawChannels.asr?.presetId ?? 'custom'), entries)
    }
    const status = deriveStatus(channels, entries, (presetId) => keySet.has(presetId))
    return {
      config: {
        version: CONFIG_VERSION,
        channels,
        keys,
        status,
        lastSavedAt: typeof record.lastSavedAt === 'number' ? record.lastSavedAt : now,
        ...(typeof record.legacy === 'object' && record.legacy !== null
          ? { legacy: record.legacy as Readonly<Record<string, unknown>> }
          : {})
      },
      migrated: false,
      warnings: [],
      pendingSecrets: []
    }
  }

  const baseUrl = typeof record.baseUrl === 'string' && record.baseUrl.trim().length > 0
    ? record.baseUrl.trim()
    : DEFAULT_ENDPOINT
  const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
  const model = typeof record.model === 'string' && record.model.trim().length > 0
    ? record.model.trim()
    : DEFAULT_MODELS.text
  const visionModel = typeof record.visionModel === 'string' && record.visionModel.trim().length > 0
    ? record.visionModel.trim()
    : DEFAULT_MODELS.vision
  const asrModel = typeof record.asrModel === 'string' && record.asrModel.trim().length > 0
    ? record.asrModel.trim()
    : DEFAULT_MODELS.asr

  const https = baseUrl.startsWith('https://')
  const enabled = apiKey.length > 0
  const availability: ChannelAvailability = !https
    ? 'invalid_endpoint'
    : enabled
      ? 'available'
      : 'missing_key'

  const build = (channel: AiChannelKind, modelName: string): ChannelBinding => ({
    channel,
    enabled,
    mode: 'ai',
    presetId: 'custom',
    endpoint: baseUrl,
    model: modelName,
    source: 'custom_override',
    availability
  })

  const channels: Record<AiChannelKind, ChannelBinding> = {
    text: build('text', model),
    vision: build('vision', visionModel),
    asr: build('asr', asrModel)
  }

  const warnings: AiConfigWarning[] = []
  if (!https) {
    warnings.push({ code: 'non_https_endpoint', messageKey: 'error.aiEndpointInvalid' })
  }
  if (apiKey.length > 0) {
    warnings.push({ code: 'legacy_plaintext_key', messageKey: 'ai.disclaimer' })
  }

  const keySet = apiKey.length > 0 ? new Set<PresetId>(['custom']) : new Set<PresetId>()
  return {
    config: {
      version: CONFIG_VERSION,
      channels,
      keys: [],
      status: deriveStatus(channels, entries, (presetId) => keySet.has(presetId)),
      lastSavedAt: now,
      legacy: { ...record, apiKey: '' }
    },
    migrated: true,
    warnings,
    pendingSecrets: apiKey.length > 0 ? [{ presetId: 'custom', secret: apiKey }] : []
  }
}

export function validateChannels(
  input: AiAccessConfigInput,
  catalog: PresetCatalog,
  hasKey: (presetId: PresetId) => boolean
): readonly ValidationIssue[] {
  const entries: ReadonlyMap<PresetId, PresetCatalogEntry> = new Map(
    catalog.entries.map((entry) => [entry.presetId, entry])
  )
  const issues: ValidationIssue[] = []
  for (const channel of AI_CHANNELS) {
    const binding = input.channels[channel]
    if (!binding) {
      issues.push({
        channel,
        field: 'preset',
        code: 'E_VALIDATION_FAILED',
        messageKey: messageKeyOf('E_VALIDATION_FAILED')
      })
      continue
    }
    if (!binding.enabled) continue
    if (!binding.endpoint.startsWith('https://')) {
      issues.push({
        channel,
        field: 'endpoint',
        code: 'E_AI_ENDPOINT_INVALID',
        messageKey: messageKeyOf('E_AI_ENDPOINT_INVALID')
      })
      continue
    }
    if (!binding.model.trim()) {
      issues.push({
        channel,
        field: 'model',
        code: 'E_VALIDATION_FAILED',
        messageKey: messageKeyOf('E_VALIDATION_FAILED')
      })
      continue
    }
    const entry = entries.get(binding.presetId)
    if (entry && binding.presetId !== 'custom' && !supportsChannel(entry, channel)) {
      const code: AppErrorCode = channel === 'asr' ? 'E_ASR_UNSUPPORTED' : channel === 'vision' ? 'E_OCR_UNSUPPORTED' : 'E_AI_MODEL_UNSUPPORTED'
      issues.push({ channel, field: 'preset', code, messageKey: messageKeyOf(code) })
      continue
    }
    if (channel === 'text' && binding.mode === 'local') continue
    if (!hasKey(binding.presetId)) {
      issues.push({
        channel,
        field: 'apiKey',
        code: 'E_AI_PROVIDER_NOT_CONFIGURED',
        messageKey: messageKeyOf('E_AI_PROVIDER_NOT_CONFIGURED')
      })
    }
  }
  return issues
}

export interface ProjectViewOptions {
  readonly contractVersion: number
  readonly catalog: PresetCatalog
  readonly catalogState?: 'ok' | 'degraded'
  readonly warnings?: readonly AiConfigWarning[]
}

export function projectView(config: AiAccessConfig, options: ProjectViewOptions): AiAccessConfigView {
  const entries: ReadonlyMap<PresetId, PresetCatalogEntry> = new Map(
    options.catalog.entries.map((entry) => [entry.presetId, entry])
  )
  const keyMap = new Map(config.keys.map((key) => [key.presetId, key]))
  const channels: Record<AiChannelKind, ChannelBindingView> = {
    text: viewOf('text', config.channels.text, entries, keyMap),
    vision: viewOf('vision', config.channels.vision, entries, keyMap),
    asr: viewOf('asr', config.channels.asr, entries, keyMap)
  }
  return {
    contractVersion: options.contractVersion,
    version: config.version,
    status: config.status,
    channels,
    presets: options.catalog.entries.map(toPresetSummary),
    catalogState: options.catalogState ?? 'ok',
    warnings: options.warnings ?? [],
    lastSavedAt: config.lastSavedAt,
    baseUrl: config.channels.text.endpoint,
    apiKey: '',
    model: config.channels.text.model,
    visionModel: config.channels.vision.model,
    asrModel: config.channels.asr.model
  }
}

function viewOf(
  channel: AiChannelKind,
  binding: ChannelBinding,
  entries: ReadonlyMap<PresetId, PresetCatalogEntry>,
  keys: ReadonlyMap<PresetId, PresetKeyRecord>
): ChannelBindingView {
  const entry = entries.get(binding.presetId)
  const key = keys.get(binding.presetId)
  return {
    channel,
    enabled: binding.enabled,
    mode: binding.mode,
    presetId: binding.presetId,
    presetName: entry?.displayName ?? '自定义（OpenAI 兼容）',
    endpoint: binding.endpoint,
    model: binding.model,
    source: binding.source,
    availability: binding.availability,
    hasKey: key !== undefined,
    keyMask: key?.keyMask ?? '',
    ...(binding.lastFailure ? { lastFailure: binding.lastFailure } : {})
  }
}

export function configFromV1Input(input: {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly visionModel: string
  readonly asrModel: string
}): AiAccessConfigInput {
  const count = input.apiKey.trim().length > 0
  const binding = (_channel: AiChannelKind, model: string): ChannelBindingInput => ({
    enabled: count && input.baseUrl.startsWith('https://'),
    mode: 'ai',
    presetId: 'custom',
    endpoint: input.baseUrl,
    model,
    source: 'custom_override'
  })
  return {
    expectedVersion: CONFIG_VERSION,
    channels: {
      text: binding('text', input.model),
      vision: binding('vision', input.visionModel),
      asr: binding('asr', input.asrModel)
    },
    keyOps: [
      input.apiKey.trim().length > 0
        ? { op: 'set', presetId: 'custom', secret: input.apiKey.trim() }
        : { op: 'keep', presetId: 'custom' }
    ]
  }
}

export function isV1Input(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false
  const record = raw as Record<string, unknown>
  return typeof record.baseUrl === 'string' && typeof record.channels !== 'object'
}

export function projectV1Config(config: AiAccessConfig): {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly visionModel: string
  readonly asrModel: string
} {
  return {
    baseUrl: config.channels.text.endpoint,
    apiKey: '',
    model: config.channels.text.model,
    visionModel: config.channels.vision.model,
    asrModel: config.channels.asr.model
  }
}

export function exportViewForLog(view: AiAccessConfigView): Readonly<Record<string, string | number>> {
  return {
    status: view.status,
    catalogState: view.catalogState,
    textPreset: view.channels.text.presetId,
    visionPreset: view.channels.vision.presetId,
    asrPreset: view.channels.asr.presetId
  }
}

export function requireCatalogEntries(catalog: PresetCatalog): ReadonlyMap<PresetId, PresetCatalogEntry> {
  return new Map(catalog.entries.map((entry) => [entry.presetId, entry]))
}

export function findEntry(catalog: PresetCatalog, presetId: PresetId): PresetCatalogEntry | undefined {
  return findPreset(presetId, catalog)
}

export function okConfig(config: AiAccessConfig): Result<AiAccessConfig> {
  return ok(config)
}