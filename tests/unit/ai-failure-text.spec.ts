import { describe, expect, it } from 'vitest'
import { MESSAGES } from '@shared/message-catalog'
import {
  channelLabelOf,
  presentFailure,
  sourceDisplayNameOf,
  sourceLineOf
} from '@shared/ai/failure-text'

const CHANNEL_KEYS = [
  'ai.fail.network.text',
  'ai.fail.network.vision',
  'ai.fail.network.asr',
  'ai.fail.firstByteTimeout.text',
  'ai.fail.firstByteTimeout.vision',
  'ai.fail.firstByteTimeout.asr',
  'ai.fail.overallTimeout.text',
  'ai.fail.overallTimeout.vision',
  'ai.fail.overallTimeout.asr'
]

describe('失败文案装配', () => {
  it('九条通道文案键均存在且非空', () => {
    for (const key of CHANNEL_KEYS) {
      expect(typeof MESSAGES[key]).toBe('string')
      expect((MESSAGES[key] as string).length > 0).toBe(true)
    }
  })

  it('图片 + Groq + 网络失败不误归因 DeepSeek', () => {
    const presentation = presentFailure({
      channel: 'vision',
      boundPresetId: 'groq',
      boundPresetName: 'Groq（免费推荐）',
      failureClass: 'network',
      stage: 'connect_first_byte'
    })
    expect(presentation.text.includes('图片识别')).toBe(true)
    expect(presentation.text.includes('Groq')).toBe(true)
    expect(presentation.text.includes('DeepSeek')).toBe(false)
    expect(presentation.sourceLabel).toBe('来源：图片识别 Groq')
    expect(presentation.messageKey).toBe('ai.fail.network.vision')
  })

  it('首包超时与整体超时使用不同文案键', () => {
    const first = presentFailure({
      channel: 'text',
      boundPresetId: 'deepseek',
      failureClass: 'timeout',
      stage: 'connect_first_byte',
      durationMs: 8000
    })
    expect(first.messageKey).toBe('ai.fail.firstByteTimeout.text')
    expect(first.text.includes('8 秒')).toBe(true)
    const overall = presentFailure({
      channel: 'text',
      boundPresetId: 'deepseek',
      failureClass: 'timeout',
      stage: 'body_transfer',
      durationMs: 15000
    })
    expect(overall.messageKey).toBe('ai.fail.overallTimeout.text')
  })

  it('连续失败与组合输入追加提示', () => {
    const repeated = presentFailure({
      channel: 'vision',
      boundPresetId: 'groq',
      failureClass: 'timeout',
      stage: 'connect_first_byte',
      consecutiveFailures: 3
    })
    expect(repeated.text.includes('已连续失败 3 次')).toBe(true)
    const composite = presentFailure({
      channel: 'vision',
      boundPresetId: 'groq',
      failureClass: 'timeout',
      stage: 'connect_first_byte',
      compositeMedia: true
    })
    expect(composite.text.includes('本次未创建日程')).toBe(true)
    expect(composite.actions.includes('use_text')).toBe(true)
  })

  it('媒体过期后动作改为重新选择且不再重试', () => {
    const expired = presentFailure({
      channel: 'vision',
      boundPresetId: 'groq',
      failureClass: 'timeout',
      stage: 'connect_first_byte',
      mediaRetryable: false
    })
    expect(expired.actions.includes('reselect_media')).toBe(true)
    expect(expired.actions.includes('retry')).toBe(false)
    expect(expired.retryableByClick).toBe(false)
    const retryable = presentFailure({
      channel: 'vision',
      boundPresetId: 'groq',
      failureClass: 'timeout',
      stage: 'connect_first_byte',
      mediaRetryable: true
    })
    expect(retryable.actions.includes('retry')).toBe(true)
    expect(retryable.retryableByClick).toBe(true)
  })

  it('文案不含端点、Key 与状态码原文', () => {
    const presentation = presentFailure({
      channel: 'asr',
      boundPresetId: 'custom',
      boundPresetName: '我的端点 https://api.example.com',
      failureClass: 'service_error',
      stage: 'result_parse'
    })
    const serialized = `${presentation.text}${presentation.sourceLabel}`
    expect(serialized.includes('https://')).toBe(false)
    expect(serialized.includes('sk-')).toBe(false)
    expect(serialized.includes('401')).toBe(false)
  })

  it('通道中文名与来源展示名稳定', () => {
    expect(channelLabelOf('text')).toBe('文字理解')
    expect(channelLabelOf('vision')).toBe('图片识别')
    expect(channelLabelOf('asr')).toBe('语音转写')
    expect(sourceDisplayNameOf('deepseek', 'x')).toBe('DeepSeek')
    expect(sourceDisplayNameOf('groq', 'x')).toBe('Groq')
    expect(sourceDisplayNameOf('gemini', 'x')).toBe('Google Gemini')
    expect(sourceDisplayNameOf('glm', 'x')).toBe('智谱 GLM')
    expect(sourceDisplayNameOf('openrouter', 'x')).toBe('OpenRouter')
    expect(sourceDisplayNameOf('custom', '我的服务')).toBe('我的服务')
    expect(sourceDisplayNameOf('custom', undefined)).toBe('自定义服务')
    expect(sourceLineOf('vision', 'groq')).toBe('来源：图片识别 Groq')
  })
})