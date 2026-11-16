import type { AiChannelKind } from './preset-catalog'
import type { PresetId } from './preset-catalog'

export const DEEPSEEK_OFFICIAL_HOSTS: readonly string[] = ['api.deepseek.com']

export interface EndpointGuardInput {
  readonly channel: AiChannelKind
  readonly presetId: PresetId
  readonly endpoint: string
}

export interface EndpointRisk {
  readonly kind: 'custom_official_media'
  readonly channel: AiChannelKind
  readonly host: string
  readonly confirmKey: 'ai.fail.endpointConfirm'
}

export function detectEndpointRisk(input: EndpointGuardInput): EndpointRisk | undefined {
  if (input.presetId !== 'custom') return undefined
  if (input.channel === 'text') return undefined
  let host: string
  try {
    host = new URL(input.endpoint).hostname
  } catch {
    return undefined
  }
  if (!DEEPSEEK_OFFICIAL_HOSTS.includes(host)) return undefined
  return { kind: 'custom_official_media', channel: input.channel, host, confirmKey: 'ai.fail.endpointConfirm' }
}