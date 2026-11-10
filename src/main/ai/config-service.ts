import type {
  AiConfigChangedNotice,
  AiConfigInput,
  AiConfigLoadOutcome,
  AiConfigSaveOutcome,
  AiConnectionTestRequest,
  AiConnectionTestResult
} from '@shared/ipc-contracts'
import { CONTRACT_VERSION } from '@shared/ipc-contracts'
import {
  CONFIG_VERSION,
  configFromV1Input,
  deriveAvailability,
  deriveStatus,
  isV1Input,
  projectView,
  validateChannels,
  type AccessStatus,
  type AiAccessConfig,
  type AiAccessConfigInput,
  type AiAccessConfigView,
  type AiConfigWarning,
  type AiFailureClass,
  type ChannelAvailability,
  type ChannelBinding,
  type PresetKeyRecord
} from '@shared/ai/access-config'
import { AI_CHANNELS, findPreset, supportsChannel, type AiChannelKind, type PresetId } from '@shared/ai/preset-catalog'
import type { PresetCatalog } from '@shared/ai/preset-catalog'
import { mapFailure } from '@shared/ai/failure'
import { messageKeyOf } from '@shared/error-catalog'
import type { Logger } from '../observability/logger'
import type { VersionedConfigStore } from './config-store'
import type { ICredentialVault } from './credential-vault'
import type { ProviderRegistry } from './provider-registry'
import { resolveAccess } from './provider-resolver'

export interface AiConfigServiceDeps {
  readonly store: VersionedConfigStore
  readonly vault: ICredentialVault
  readonly catalog: PresetCatalog
  readonly catalogState: 'ok' | 'degraded'
  readonly clock: () => number
  readonly logger: Logger
  readonly registry: ProviderRegistry
  readonly emit: (notice: AiConfigChangedNotice) => void
}

export class AiConfigService {
  private pending: Promise<AiConfigSaveOutcome> | null = null
  private warnings: readonly AiConfigWarning[] = []

  constructor(private readonly deps: AiConfigServiceDeps) {}

  initialize(): AiConfigLoadOutcome {
    const outcome = this.load()
    const access = resolveAccess(outcome.view ? this.deps.store.current() : this.deps.store.current(), 1, {
      catalog: this.deps.catalog,
      vault: this.deps.vault,
      logger: this.deps.logger
    })
    this.deps.registry.publish(access)
    return outcome
  }

  load(): AiConfigLoadOutcome {
    const loaded = this.deps.store.read()
    this.warnings = loaded.warnings
    const view = this.project(loaded.config)
    if (loaded.loadError) {
      return {
        ok: false,
        view,
        error: {
          code: 'E_CONFIG_READ_FAIL',
          messageKey: messageKeyOf('E_CONFIG_READ_FAIL'),
          retryable: true,
          failureClass: 'service_error' as AiFailureClass
        }
      }
    }
    return { ok: true, view }
  }

  async save(raw: unknown): Promise<AiConfigSaveOutcome> {
    if (this.pending) return this.pending
    this.pending = this.doSave(raw)
    try {
      return await this.pending
    } finally {
      this.pending = null
    }
  }

  private async doSave(raw: unknown): Promise<AiConfigSaveOutcome> {
    const current = this.deps.store.current()
    const input: AiAccessConfigInput = isV1Input(raw)
      ? configFromV1Input(raw as AiConfigInput)
      : (raw as AiAccessConfigInput)
    const keyMap = new Map(current.keys.map((key) => [key.presetId, key]))
    const pendingSecrets = new Map<PresetId, string>()
    const cleared = new Set<PresetId>()
    for (const op of input.keyOps ?? []) {
      if (op.op === 'set' && op.secret.trim().length > 0) pendingSecrets.set(op.presetId, op.secret.trim())
      if (op.op === 'clear') cleared.add(op.presetId)
    }
    const hasKey = (presetId: PresetId): boolean => {
      if (cleared.has(presetId)) return false
      if (pendingSecrets.has(presetId)) return true
      const record = keyMap.get(presetId)
      if (!record) return false
      return this.deps.vault.open(record) !== undefined
    }

    const issues = validateChannels(input, this.deps.catalog, hasKey)
    if (issues.length > 0) {
      const first = issues[0]
      return {
        ok: false,
        issues,
        error: first
          ? {
              code: first.code,
              messageKey: first.messageKey,
              retryable: false,
              actions: ['open_settings']
            }
          : undefined
      }
    }

    const entries = new Map(this.deps.catalog.entries.map((entry) => [entry.presetId, entry]))
    const nextKeys: PresetKeyRecord[] = current.keys
      .filter((key) => !cleared.has(key.presetId))
      .map((key) => ({ ...key }))
    for (const [presetId, secret] of pendingSecrets) {
      const sealed = this.deps.vault.seal(presetId, secret)
      const record: PresetKeyRecord = {
        presetId,
        keyMask: sealed.masked,
        sealed: sealed.sealed,
        vault: sealed.vault,
        updatedAt: sealed.updatedAt
      }
      const index = nextKeys.findIndex((key) => key.presetId === presetId)
      if (index >= 0) nextKeys[index] = record
      else nextKeys.push(record)
    }

    const channels = {} as Record<AiChannelKind, ChannelBinding>
    for (const channel of AI_CHANNELS) {
      const binding = input.channels[channel]
      const availability: ChannelAvailability = deriveAvailability(
        { ...binding, channel },
        entries.get(binding.presetId),
        hasKey(binding.presetId),
        entries
      )
      channels[channel] = { ...binding, channel, availability }
    }
    const status: AccessStatus = deriveStatus(input.channels, entries, hasKey)
    const next: AiAccessConfig = {
      version: CONFIG_VERSION,
      channels,
      keys: nextKeys,
      status,
      lastSavedAt: this.deps.clock(),
      ...(current.legacy ? { legacy: current.legacy } : {})
    }

    const committed = this.deps.store.commit(next)
    if (!committed.ok) {
      return {
        ok: false,
        error: {
          code: 'E_CONFIG_WRITE_FAIL',
          messageKey: messageKeyOf('E_CONFIG_WRITE_FAIL'),
          retryable: true,
          failureClass: 'service_error' as AiFailureClass
        }
      }
    }

    const access = resolveAccess(next, this.deps.registry.current().revision + 1, {
      catalog: this.deps.catalog,
      vault: this.deps.vault,
      logger: this.deps.logger
    })
    this.deps.registry.publish(access)
    this.deps.emit({ revision: this.deps.registry.current().revision, status })
    this.warnings = []
    return { ok: true, view: this.project(next) }
  }

  async testConnection(request: AiConnectionTestRequest): Promise<AiConnectionTestResult> {
    const started = this.deps.clock()
    const channel = request.channel
    const binding = request.binding
    if (!binding.enabled) {
      return {
        channel,
        resultStatus: 'failure',
        error: { code: 'E_AI_CHANNEL_DISABLED', messageKey: messageKeyOf('E_AI_CHANNEL_DISABLED'), retryable: false },
        durationMs: 0
      }
    }
    if (channel === 'text' && binding.mode === 'local') {
      return { channel, resultStatus: 'success', durationMs: 0 }
    }
    if (!binding.endpoint.startsWith('https://')) {
      return {
        channel,
        resultStatus: 'failure',
        error: { code: 'E_AI_ENDPOINT_INVALID', messageKey: messageKeyOf('E_AI_ENDPOINT_INVALID'), retryable: false },
        durationMs: this.deps.clock() - started
      }
    }
    const entry = findPreset(binding.presetId, this.deps.catalog)
    if (entry && binding.presetId !== 'custom' && !supportsChannel(entry, channel)) {
      const code = channel === 'asr' ? 'E_ASR_UNSUPPORTED' : 'E_OCR_UNSUPPORTED'
      return {
        channel,
        resultStatus: 'failure',
        error: { code, messageKey: messageKeyOf(code), retryable: false },
        durationMs: this.deps.clock() - started
      }
    }
    const stored = this.deps.store.current().keys.find((key) => key.presetId === binding.presetId)
    const hasKey =
      (request.secret !== undefined && request.secret.trim().length > 0) ||
      (stored !== undefined && this.deps.vault.open(stored) !== undefined)
    if (!hasKey) {
      return {
        channel,
        resultStatus: 'failure',
        error: mapFailure({ failureClass: 'not_configured' }, channel),
        durationMs: this.deps.clock() - started
      }
    }
    return { channel, resultStatus: 'success', durationMs: this.deps.clock() - started }
  }

  current(): AiAccessConfig {
    return this.deps.store.current()
  }

  currentView(): AiAccessConfigView {
    return this.project(this.deps.store.current())
  }

  currentStatus(): AccessStatus {
    return this.deps.store.current().status
  }

  private project(config: AiAccessConfig): AiAccessConfigView {
    return projectView(config, {
      contractVersion: CONTRACT_VERSION,
      catalog: this.deps.catalog,
      catalogState: this.deps.catalogState,
      warnings: this.warnings
    })
  }
}