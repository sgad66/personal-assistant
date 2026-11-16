import { describe, expect, it } from 'vitest'
import { detectEndpointRisk } from '@shared/ai/endpoint-guard'

describe('自定义端点同域守卫', () => {
  it('自定义视觉/语音端点指向 DeepSeek 官方域时命中', () => {
    const vision = detectEndpointRisk({
      channel: 'vision',
      presetId: 'custom',
      endpoint: 'https://api.deepseek.com/v1'
    })
    expect(vision?.kind).toBe('custom_official_media')
    expect(vision?.channel).toBe('vision')
    expect(vision?.host).toBe('api.deepseek.com')
    expect(vision?.confirmKey).toBe('ai.fail.endpointConfirm')
    const asr = detectEndpointRisk({
      channel: 'asr',
      presetId: 'custom',
      endpoint: 'https://api.deepseek.com/v1'
    })
    expect(asr?.channel).toBe('asr')
  })

  it('相似域名、其他预设与文本通道都不命中', () => {
    expect(
      detectEndpointRisk({
        channel: 'vision',
        presetId: 'custom',
        endpoint: 'https://api.deepseek.com.evil.tld/v1'
      })
    ).toBeUndefined()
    expect(
      detectEndpointRisk({
        channel: 'vision',
        presetId: 'custom',
        endpoint: 'https://api.groq.com/openai/v1'
      })
    ).toBeUndefined()
    expect(
      detectEndpointRisk({
        channel: 'vision',
        presetId: 'deepseek',
        endpoint: 'https://api.deepseek.com/v1'
      })
    ).toBeUndefined()
    expect(
      detectEndpointRisk({
        channel: 'vision',
        presetId: 'groq',
        endpoint: 'https://api.deepseek.com/v1'
      })
    ).toBeUndefined()
    expect(
      detectEndpointRisk({
        channel: 'text',
        presetId: 'custom',
        endpoint: 'https://api.deepseek.com/v1'
      })
    ).toBeUndefined()
  })

  it('非法端点不抛错且返回 undefined', () => {
    expect(
      detectEndpointRisk({ channel: 'vision', presetId: 'custom', endpoint: 'not a url' })
    ).toBeUndefined()
    expect(detectEndpointRisk({ channel: 'vision', presetId: 'custom', endpoint: '' })).toBeUndefined()
  })
})