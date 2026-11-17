import type { AiChannelKind, PresetCatalog, PresetId } from '@shared/ai/preset-catalog'
import { findPreset, supportsChannel } from '@shared/ai/preset-catalog'
import type { AiAccessConfig, AiFailureClass, ChannelBinding } from '@shared/ai/access-config'
import type { ChannelSourceTrace } from '@shared/ipc-contracts'
import {
  budgetFor,
  effectiveTimeoutPreferences,
  type ChannelBudget,
  type TimeoutPreferences
} from '@shared/ai/timeout-policy'
import type {
  IImageToTextProvider,
  ISpeechToTextProvider,
  ITextUnderstandingProvider,
  ProviderConfig
} from '../providers/types'
import { LlmProvider } from '../providers/llm-provider'
import { AsrProvider } from '../providers/asr-provider'
import { OcrProvider } from '../providers/ocr-provider'
import { localMedia } from '../providers/local-media'
import { localParse, parseLocalAttachment } from '../providers/local-parser'
import type { Logger } from '../observability/logger'
import type { ICredentialVault } from './credential-vault'

export type ProviderInstance =
  | ITextUnderstandingProvider
  | ISpeechToTextProvider
  | IImageToTextProvider

export type ResolvedChannel =
  | {
      readonly kind: 'ready'
      readonly presetId: PresetId
      readonly actualPresetId?: ChannelSourceTrace['actualPresetId']
      readonly presetName?: string
      readonly endpoint: string
      readonly model: string
      readonly provider: ProviderInstance
    }
  | { readonly kind: 'disabled'; readonly code: 'E_AI_CHANNEL_DISABLED'; readonly presetId?: PresetId }
  | {
      readonly kind: 'unsupported'
      readonly code: 'E_ASR_UNSUPPORTED' | 'E_OCR_UNSUPPORTED'
      readonly presetId?: PresetId
      readonly presetName?: string
    }
  | {
      readonly kind: 'not_configured'
      readonly code: 'E_AI_PROVIDER_NOT_CONFIGURED'
      readonly presetId?: PresetId
    }
  | {
      readonly kind: 'invalid_endpoint'
      readonly code: 'E_AI_ENDPOINT_INVALID'
      readonly presetId?: PresetId
    }

export interface ResolvedAccess {
  readonly revision: number
  readonly status: AiAccessConfig['status']
  readonly timeouts?: TimeoutPreferences
  readonly text: ResolvedChannel
  readonly vision: ResolvedChannel
  readonly asr: ResolvedChannel
}

class LocalTextProvider implements ITextUnderstandingProvider {
  async parse(request: Parameters<ITextUnderstandingProvider['parse']>[0]) {
    return { ok: true as const, data: request.attachment ? parseLocalAttachment(request) : localParse(request.description, request.referenceTime) }
  }
}

const localProvider = new LocalTextProvider()

export interface ResolverDeps {
  readonly catalog: PresetCatalog
  readonly vault: ICredentialVault
  readonly logger: Logger
  readonly providerFactory?: (channel: AiChannelKind, config: ProviderConfig) => ProviderInstance
}

export function resolveAccess(
  config: AiAccessConfig,
  revision: number,
  deps: ResolverDeps
): ResolvedAccess {
  return {
    revision,
    status: config.status,
    timeouts: effectiveTimeoutPreferences(config.timeouts),
    text: resolveChannel('text', config.channels.text, config, deps),
    vision: resolveChannel('vision', config.channels.vision, config, deps),
    asr: resolveChannel('asr', config.channels.asr, config, deps)
  }
}

function resolveChannel(
  channel: AiChannelKind,
  binding: ChannelBinding,
  config: AiAccessConfig,
  deps: ResolverDeps
): ResolvedChannel {
  if (binding.mode === 'local') {
    return {
      kind: 'ready',
      presetId: binding.presetId,
      actualPresetId: 'local',
      presetName: channel === 'text' ? '本地解析' : binding.model,
      endpoint: 'local',
      model: channel === 'text' ? 'local' : binding.model,
      provider: channel === 'text' ? localProvider : localMedia
    }
  }
  if (!binding.endpoint.startsWith('https://')) {
    return { kind: 'invalid_endpoint', code: 'E_AI_ENDPOINT_INVALID', presetId: binding.presetId }
  }
  const entry = findPreset(binding.presetId, deps.catalog)
  if (entry && binding.presetId !== 'custom' && !supportsChannel(entry, channel)) {
    return {
      kind: 'unsupported',
      code: channel === 'asr' ? 'E_ASR_UNSUPPORTED' : 'E_OCR_UNSUPPORTED',
      presetId: binding.presetId,
      presetName: entry.displayName
    }
  }
  if (!binding.enabled) {
    return { kind: 'disabled', code: 'E_AI_CHANNEL_DISABLED', presetId: binding.presetId }
  }
  const keyRecord = config.keys.find((key) => key.presetId === binding.presetId)
  const secret = keyRecord ? deps.vault.open(keyRecord) : undefined
  if (!secret) {
    return { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED', presetId: binding.presetId }
  }

  const providerConfig: ProviderConfig = {
    baseUrl: binding.endpoint,
    apiKey: secret,
    model: binding.model,
    visionModel: binding.model,
    asrModel: binding.model
  }
  return {
    kind: 'ready',
    presetId: binding.presetId,
    ...(entry ? { presetName: entry.displayName } : {}),
    endpoint: binding.endpoint,
    model: binding.model,
    provider: deps.providerFactory
      ? deps.providerFactory(channel, providerConfig)
      : buildDefaultProvider(channel, providerConfig, deps.logger, budgetFor(channel, config.timeouts))
  }
}

function buildDefaultProvider(
  channel: AiChannelKind,
  config: ProviderConfig,
  logger: Logger,
  budget: ChannelBudget
): ProviderInstance {
  if (channel === 'text') return new LlmProvider(config, logger, budget)
  if (channel === 'vision') return new OcrProvider(config, logger, budget)
  return new AsrProvider(config, logger, budget)
}

export function failureClassOfChannel(resolved: ResolvedChannel): AiFailureClass | undefined {
  if (resolved.kind === 'ready') return undefined
  if (resolved.kind === 'disabled') return 'not_configured'
  if (resolved.kind === 'not_configured') return 'not_configured'
  if (resolved.kind === 'unsupported') return 'model_unavailable'
  return 'service_error'
}
