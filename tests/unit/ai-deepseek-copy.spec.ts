import { describe, expect, it } from 'vitest'
import { MESSAGES, UI_TEXT, translate } from '@shared/message-catalog'
import { ERROR_META } from '@shared/error-catalog'
import { AI_CHANNELS, PRESET_IDS, findPreset, supportsChannel } from '@shared/ai/preset-catalog'

const DEEPSEEK_KEYS = [
  'aiStatusDeepseekSolution',
  'aiStatusDeepseekTextOnly',
  'aiStatusOnlineUnknown',
  'ai.keyHelp.deepseek',
  'ai.gap.deepseekVision',
  'ai.gap.deepseekAsr',
  'ai.gap.keepFallback',
  'ai.gap.confirmDropImage',
  'ai.solution.deepseekDefault',
  'ai.solution.groqFree',
  'ai.solution.strict',
  'ai.solution.notice',
  'ai.solution.deepseekKeys',
  'ai.solution.groqKeys',
  'ai.solution.restoreDefault',
  'ai.source.deepseekText',
  'ai.source.groqVision',
  'ai.source.groqAsr',
  'ai.strict.exit',
  'aiAdvancedHint.deepseek'
]

describe('DeepSeek 文案护栏', () => {
  it('新增文案键均存在且非空', () => {
    for (const key of DEEPSEEK_KEYS) {
      expect(typeof MESSAGES[key]).toBe('string')
      expect((MESSAGES[key] as string).length > 0).toBe(true)
    }
  })

  it('能力缺口文案明确说明不支持', () => {
    expect(translate('ai.gap.deepseekVision').includes('不支持图片识别')).toBe(true)
    expect(translate('ai.gap.deepseekAsr').includes('不支持语音转写')).toBe(true)
  })

  it('Key 获取说明包含计费与官方政策', () => {
    const help = translate('ai.keyHelp.deepseek')
    expect(help.includes('按量计费')).toBe(true)
    expect(help.includes('官方政策')).toBe(true)
  })

  it('方案说明同时包含三层信息', () => {
    const notice = translate('ai.solution.notice')
    expect(notice.includes('不由 DeepSeek 提供')).toBe(true)
    expect(notice.includes('Groq 承接')).toBe(true)
    expect(notice.includes('严格模式')).toBe(true)
  })

  it('DeepSeek 文案不含夸大或免费承诺', () => {
    const related = Object.entries(MESSAGES).filter(
      ([key, value]) => key.toLowerCase().includes('deepseek') || value.includes('DeepSeek')
    )
    for (const [, value] of related) {
      expect(value.includes('永久免费')).toBe(false)
      expect(value.includes('无限额度')).toBe(false)
      expect(value.includes('全模态')).toBe(false)
    }
  })

  it('状态文案与短标签为五态且未知非本地兜底为已接入', () => {
    expect(UI_TEXT.aiStatusDeepseekSolution).toBe('AI 已接入（DeepSeek 方案）')
    expect(UI_TEXT.aiStatusDeepseekTextOnly).toBe('AI 已接入（DeepSeek 仅文字）')
    expect(UI_TEXT.aiStatusOnlineUnknown).toBe('AI 已接入')
  })

  it('错误码集合未新增且文案对等', () => {
    const errorKeys = Object.keys(MESSAGES)
      .filter((key) => key.startsWith('error.'))
      .sort()
    const metaKeys = Array.from(new Set(Object.values(ERROR_META).map((meta) => meta.messageKey))).sort()
    expect(errorKeys).toEqual(metaKeys)
  })

  it('通道与预设数量稳定，DeepSeek 不声明视觉与语音', () => {
    expect(AI_CHANNELS).toHaveLength(3)
    expect(PRESET_IDS).toHaveLength(6)
    const deepseek = findPreset('deepseek')
    expect(deepseek !== undefined).toBe(true)
    if (!deepseek) return
    expect(supportsChannel(deepseek, 'text')).toBe(true)
    expect(supportsChannel(deepseek, 'vision')).toBe(false)
    expect(supportsChannel(deepseek, 'asr')).toBe(false)
  })
})