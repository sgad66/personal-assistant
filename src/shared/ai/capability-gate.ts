import type { AccessStatus, ChannelAvailability } from './access-config'
import {
  findPreset,
  supportsChannel,
  type AiChannelKind,
  type PresetCatalog,
  type PresetId
} from './preset-catalog'

export type InputPartKind = 'text' | 'voice' | 'image'
export type PreflightDecision =
  | { readonly kind: 'allow' }
  | {
      readonly kind: 'reject'
      readonly code: 'E_ASR_UNSUPPORTED' | 'E_OCR_UNSUPPORTED'
      readonly messageKey: string
    }
  | { readonly kind: 'confirm_drop_image'; readonly messageKey: string }

export interface ChannelCapabilityGap {
  readonly channel: AiChannelKind
  readonly presetId: PresetId
  readonly presetName: string
  readonly suggestedPresetId: PresetId
  readonly reasonKey: string
}

export interface ChannelSourceDescription {
  readonly sourceNoteKey?: string
  readonly sourceMatchesBinding: boolean
  readonly servingLabel?: string
}

export const DEFAULT_CHANNEL_STATES: Readonly<Record<AiChannelKind, ChannelAvailability>> = Object.freeze({
  text: 'available',
  vision: 'disabled',
  asr: 'disabled'
})

export const GROQ_FALLBACK_LABEL = 'Groq'
export const DEEPSEEK_LABEL = 'DeepSeek'

export function capabilityGapOf(
  binding: { readonly presetId: PresetId },
  channel: AiChannelKind,
  catalog: PresetCatalog
): ChannelCapabilityGap | undefined {
  if (channel === 'text') return undefined
  if (binding.presetId === 'custom') return undefined
  const entry = findPreset(binding.presetId, catalog)
  if (!entry) return undefined
  if (supportsChannel(entry, channel)) return undefined
  return {
    channel,
    presetId: entry.presetId,
    presetName: entry.displayName,
    suggestedPresetId: 'groq',
    reasonKey: channel === 'asr' ? 'ai.gap.deepseekAsr' : 'ai.gap.deepseekVision'
  }
}

export function preflightInput(
  parts: readonly { readonly kind: InputPartKind }[],
  channelStates: Readonly<Record<AiChannelKind, ChannelAvailability>>
): PreflightDecision {
  const hasVoice = parts.some((part) => part.kind === 'voice')
  if (hasVoice && channelStates.asr !== 'available') {
    return { kind: 'reject', code: 'E_ASR_UNSUPPORTED', messageKey: 'error.asrUnsupported' }
  }
  const hasImage = parts.some((part) => part.kind === 'image')
  if (hasImage && channelStates.vision !== 'available') {
    const hasText = parts.some((part) => part.kind === 'text')
    if (hasText) return { kind: 'confirm_drop_image', messageKey: 'ai.gap.confirmDropImage' }
    return { kind: 'reject', code: 'E_OCR_UNSUPPORTED', messageKey: 'error.ocrUnsupported' }
  }
  return { kind: 'allow' }
}

export function describeChannelSource(
  binding: { readonly channel: AiChannelKind; readonly presetId: PresetId },
  channels: Readonly<Record<AiChannelKind, { readonly presetId: PresetId }>>,
  catalog: PresetCatalog
): ChannelSourceDescription {
  if (binding.presetId === 'custom') return { sourceMatchesBinding: true }
  const entry = findPreset(binding.presetId, catalog)
  if (!entry) return { sourceMatchesBinding: true }
  if (supportsChannel(entry, binding.channel)) {
    if (
      binding.channel !== 'text' &&
      binding.presetId === 'groq' &&
      channels.text.presetId === 'deepseek'
    ) {
      return {
        sourceNoteKey: binding.channel === 'asr' ? 'ai.source.groqAsr' : 'ai.source.groqVision',
        sourceMatchesBinding: true,
        servingLabel: GROQ_FALLBACK_LABEL
      }
    }
    return { sourceMatchesBinding: true }
  }
  if (binding.channel === 'text') return { sourceMatchesBinding: true }

  const groq = findPreset('groq', catalog)
  const actual = channels[binding.channel]
  const servedByGroq = groq !== undefined && actual.presetId === 'groq'
  if (servedByGroq) {
    return {
      sourceNoteKey: binding.channel === 'asr' ? 'ai.source.groqAsr' : 'ai.source.groqVision',
      sourceMatchesBinding: false,
      servingLabel: GROQ_FALLBACK_LABEL
    }
  }
  if (binding.channel === 'asr') {
    return {
      sourceNoteKey: 'ai.gap.deepseekAsr',
      sourceMatchesBinding: false,
      servingLabel: entry.displayName
    }
  }
  return {
    sourceNoteKey: 'ai.gap.deepseekVision',
    sourceMatchesBinding: false,
    servingLabel: entry.displayName
  }
}

export function inputHintOf(
  status: AccessStatus,
  channelStates: Readonly<Record<AiChannelKind, ChannelAvailability>>,
  bindings?: Readonly<Record<AiChannelKind, { readonly endpoint: string }>>
): string {
  const visionReady = channelStates.vision === 'available'
  const asrReady = channelStates.asr === 'available'
  let text = '文字可用'
  if (channelStates.text !== 'available') text = '文字服务当前不可用'
  else if (status === 'local') text = '文字由本地规则解析'
  else if (status === 'deepseek_solution' || status === 'deepseek_text_only') text = '文字由 DeepSeek 回答'

  if (visionReady && asrReady) {
    const localMedia = bindings?.vision.endpoint === 'local' && bindings.asr.endpoint === 'local'
    return text + (localMedia ? '，图片和录音在本机识别' : '，支持图片识别和语音转写')
  }
  if (visionReady) return text + '，语音转写当前不可用'
  if (asrReady) return text + '，图片识别当前不可用'
  return text + '，图片识别和语音转写当前不可用'
}
