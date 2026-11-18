import type { FailureCategory, FailureStage } from '../result'
import { translate } from '../message-catalog'
import type { AiFailureClass } from './access-config'
import { failureActionsOf, type UiAction } from './failure'
import type { AiChannelKind, PresetId } from './preset-catalog'

export interface FailurePresentationInput {
  readonly channel: AiChannelKind
  readonly boundPresetId: PresetId
  readonly boundPresetName?: string
  readonly sourcePresetId?: PresetId
  readonly sourceName?: string
  readonly failureClass: AiFailureClass
  readonly stage: FailureStage
  readonly category?: FailureCategory
  readonly durationMs?: number
  readonly consecutiveFailures?: number
  readonly compositeMedia?: boolean
  readonly mediaRetryable?: boolean
  readonly unsupportedModality?: boolean
}

export interface FailurePresentation {
  readonly messageKey: string
  readonly params: Readonly<Record<string, string | number>>
  readonly text: string
  readonly sourceLabel: string
  readonly actions: readonly UiAction[]
  readonly retryableByClick: boolean
}

export function channelLabelOf(channel: AiChannelKind): string {
  if (channel === 'vision') return '图片识别'
  if (channel === 'asr') return '语音转写'
  return '文字理解'
}

export function sourceDisplayNameOf(presetId: PresetId, fallbackName?: string): string {
  switch (presetId) {
    case 'deepseek':
      return 'DeepSeek'
    case 'groq':
      return 'Groq'
    case 'gemini':
      return 'Google Gemini'
    case 'glm':
      return '智谱 GLM'
    case 'openrouter':
      return 'OpenRouter'
    default: {
      const trimmed = fallbackName?.trim() ?? ''
      if (trimmed.length === 0) return '自定义服务'
      if (/https?:\/\/|sk-|@|\//i.test(trimmed)) return '自定义服务'
      return trimmed
    }
  }
}

export function messageKeyForFailure(
  input: Pick<
    FailurePresentationInput,
    'channel' | 'failureClass' | 'stage' | 'unsupportedModality'
  >
): string {
  if (input.unsupportedModality) {
    return input.channel === 'asr' ? 'error.asrUnsupported' : 'error.ocrUnsupported'
  }
  switch (input.failureClass) {
    case 'network':
      return `ai.fail.network.${input.channel}`
    case 'timeout':
      return input.stage === 'connect_first_byte'
        ? `ai.fail.firstByteTimeout.${input.channel}`
        : `ai.fail.overallTimeout.${input.channel}`
    case 'unauthorized':
      return 'error.aiAuthFailed'
    case 'rate_limited':
      return 'error.aiRateLimited'
    case 'model_unavailable':
      return 'error.aiModelUnsupported'
    case 'not_configured':
      return 'error.aiProviderNotConfigured'
    case 'unparsable':
      if (input.channel === 'vision') return 'error.ocrNoText'
      if (input.channel === 'asr') return 'error.asrFail'
      return 'error.aiUnavailable'
    default:
      return 'ai.fail.serviceUnavailable'
  }
}

export function presentFailure(input: FailurePresentationInput): FailurePresentation {
  const channelLabel = channelLabelOf(input.channel)
  const source = sourceDisplayNameOf(
    input.sourcePresetId ?? input.boundPresetId,
    input.sourceName ?? input.boundPresetName
  )
  const seconds = Math.max(1, Math.round((input.durationMs ?? 0) / 1000))
  const messageKey = messageKeyForFailure(input)
  const params: Readonly<Record<string, string | number>> = { channel: channelLabel, source, seconds }
  let text = translate(messageKey, params)
  if (input.channel !== 'text' && input.compositeMedia) {
    text = `${text}\n${translate('ai.fail.compositeMediaFailed')}`
  }
  if ((input.consecutiveFailures ?? 0) >= 3) {
    text = `${text}\n${translate('ai.fail.repeated', { count: input.consecutiveFailures ?? 0 })}`
  }

  let actions: UiAction[] = [...failureActionsOf(input.failureClass)]
  if (input.channel !== 'text') {
    actions = uniqueActions([...actions, 'use_text'])
  }
  if (input.failureClass === 'service_error') {
    actions = uniqueActions([...actions, 'switch_preset'])
  }
  if (input.channel !== 'text' && input.mediaRetryable === false) {
    actions = uniqueActions(actions.filter((action) => action !== 'retry').concat('reselect_media'))
  }
  return {
    messageKey,
    params,
    text,
    sourceLabel: translate('ai.fail.sourceLine', { channel: channelLabel, source }),
    actions,
    retryableByClick: actions.includes('retry')
  }
}

export function sourceLineOf(
  channel: AiChannelKind,
  presetId: PresetId,
  fallbackName?: string
): string {
  return translate('ai.fail.sourceLine', {
    channel: channelLabelOf(channel),
    source: sourceDisplayNameOf(presetId, fallbackName)
  })
}

function uniqueActions(actions: readonly UiAction[]): UiAction[] {
  return Array.from(new Set(actions))
}