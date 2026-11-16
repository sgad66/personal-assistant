import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHANNEL_STATES,
  capabilityGapOf,
  describeChannelSource,
  inputHintOf,
  preflightInput
} from '@shared/ai/capability-gate'
import { getPresetCatalog, findPreset, type PresetCatalog } from '@shared/ai/preset-catalog'

const catalog = getPresetCatalog()

describe('能力缺口判定', () => {
  it('DeepSeek 图片与语音均为缺口，并建议 Groq', () => {
    const vision = capabilityGapOf({ presetId: 'deepseek' }, 'vision', catalog)
    expect(vision?.suggestedPresetId).toBe('groq')
    expect(vision?.reasonKey).toBe('ai.gap.deepseekVision')
    expect(vision?.presetName).toBe(findPreset('deepseek')?.displayName)
    const asr = capabilityGapOf({ presetId: 'deepseek' }, 'asr', catalog)
    expect(asr?.reasonKey).toBe('ai.gap.deepseekAsr')
  })

  it('Groq、自定义与缺失目录都不产生缺口', () => {
    expect(capabilityGapOf({ presetId: 'groq' }, 'vision', catalog)).toBeUndefined()
    expect(capabilityGapOf({ presetId: 'custom' }, 'vision', catalog)).toBeUndefined()
    const emptyCatalog: PresetCatalog = { catalogVersion: 2, entries: [], recommendedPresetId: 'custom' }
    expect(capabilityGapOf({ presetId: 'deepseek' }, 'vision', emptyCatalog)).toBeUndefined()
    expect(capabilityGapOf({ presetId: 'deepseek' }, 'text', catalog)).toBeUndefined()
  })
})

describe('发送前组合输入预检', () => {
  it('仅图片且视觉不可用被拒绝，不降级为文字', () => {
    const decision = preflightInput([{ kind: 'image' }], DEFAULT_CHANNEL_STATES)
    expect(decision.kind).toBe('reject')
    if (decision.kind !== 'reject') return
    expect(decision.code).toBe('E_OCR_UNSUPPORTED')
  })

  it('文字加图片时要求确认仅按文字继续', () => {
    const decision = preflightInput([{ kind: 'text' }, { kind: 'image' }], DEFAULT_CHANNEL_STATES)
    expect(decision.kind).toBe('confirm_drop_image')
    if (decision.kind !== 'confirm_drop_image') return
    expect(decision.messageKey).toBe('ai.gap.confirmDropImage')
  })

  it('语音不可用时即使带文字也拒绝', () => {
    const decision = preflightInput([{ kind: 'text' }, { kind: 'voice' }], DEFAULT_CHANNEL_STATES)
    expect(decision.kind).toBe('reject')
    if (decision.kind !== 'reject') return
    expect(decision.code).toBe('E_ASR_UNSUPPORTED')
  })

  it('文字始终放行，视觉 missing_key 仍按不可用处理', () => {
    expect(preflightInput([{ kind: 'text' }], DEFAULT_CHANNEL_STATES).kind).toBe('allow')
    const missing = { text: 'available' as const, vision: 'missing_key' as const, asr: 'disabled' as const }
    expect(preflightInput([{ kind: 'text' }, { kind: 'image' }], missing).kind).toBe('confirm_drop_image')
    expect(preflightInput([{ kind: 'voice' }], missing).kind).toBe('reject')
    const allReady = { text: 'available' as const, vision: 'available' as const, asr: 'available' as const }
    expect(preflightInput([{ kind: 'text' }, { kind: 'voice' }, { kind: 'image' }], allReady).kind).toBe('allow')
  })

  it('预检不修改入参通道状态', () => {
    const states = { text: 'available' as const, vision: 'disabled' as const, asr: 'disabled' as const }
    const before = JSON.stringify(states)
    preflightInput([{ kind: 'text' }, { kind: 'image' }], states)
    expect(JSON.stringify(states)).toBe(before)
  })
})

describe('通道来源说明', () => {
  it('文本 DeepSeek + 视觉 Groq 显式标注来源不一致', () => {
    const source = describeChannelSource(
      { channel: 'vision', presetId: 'deepseek' },
      { text: { presetId: 'deepseek' }, vision: { presetId: 'groq' }, asr: { presetId: 'groq' } },
      catalog
    )
    expect(source.sourceNoteKey).toBe('ai.source.groqVision')
    expect(source.sourceMatchesBinding).toBe(false)
    expect(source.servingLabel).toBe('Groq')
    const textSource = describeChannelSource(
      { channel: 'text', presetId: 'deepseek' },
      { text: { presetId: 'deepseek' }, vision: { presetId: 'groq' }, asr: { presetId: 'groq' } },
      catalog
    )
    expect(textSource.sourceMatchesBinding).toBe(true)
    expect(textSource.sourceNoteKey).toBeUndefined()
  })

  it('DeepSeek 方案下 Groq 视觉通道仍标注来源但绑定一致', () => {
    const source = describeChannelSource(
      { channel: 'vision', presetId: 'groq' },
      { text: { presetId: 'deepseek' }, vision: { presetId: 'groq' }, asr: { presetId: 'groq' } },
      catalog
    )
    expect(source.sourceMatchesBinding).toBe(true)
    expect(source.sourceNoteKey).toBe('ai.source.groqVision')
    const plain = describeChannelSource(
      { channel: 'vision', presetId: 'groq' },
      { text: { presetId: 'custom' }, vision: { presetId: 'groq' }, asr: { presetId: 'groq' } },
      catalog
    )
    expect(plain.sourceMatchesBinding).toBe(true)
    expect(plain.sourceNoteKey).toBeUndefined()
  })

  it('严格模式给出能力缺口原因，不冒充有来源', () => {
    const channels = {
      text: { presetId: 'deepseek' as const },
      vision: { presetId: 'deepseek' as const },
      asr: { presetId: 'deepseek' as const }
    }
    expect(describeChannelSource({ channel: 'vision', presetId: 'deepseek' }, channels, catalog).sourceNoteKey).toBe(
      'ai.gap.deepseekVision'
    )
    expect(describeChannelSource({ channel: 'asr', presetId: 'deepseek' }, channels, catalog).sourceNoteKey).toBe(
      'ai.gap.deepseekAsr'
    )
  })

  it('来源说明不含端点与 Key', () => {
    const source = describeChannelSource(
      { channel: 'vision', presetId: 'deepseek' },
      { text: { presetId: 'deepseek' }, vision: { presetId: 'groq' }, asr: { presetId: 'groq' } },
      catalog
    )
    const serialized = JSON.stringify(source)
    expect(serialized.includes('https://')).toBe(false)
    expect(serialized.includes('sk-')).toBe(false)
  })
})

describe('默认状态与输入提示', () => {
  it('默认通道状态保守：图片与语音禁用', () => {
    expect(DEFAULT_CHANNEL_STATES.text).toBe('available')
    expect(DEFAULT_CHANNEL_STATES.vision).toBe('disabled')
    expect(DEFAULT_CHANNEL_STATES.asr).toBe('disabled')
  })

  it('严格模式不宣称三模态全支持', () => {
    const hint = inputHintOf('deepseek_text_only', {
      text: 'available',
      vision: 'unsupported',
      asr: 'unsupported'
    })
    expect(hint.includes('支持文字、语音与图片')).toBe(false)
    expect(hint.includes('文字可用')).toBe(true)
  })

  it('默认方案与本地模式的提示各不相同', () => {
    const solutionHint = inputHintOf('deepseek_solution', {
      text: 'available',
      vision: 'available',
      asr: 'available'
    })
    expect(solutionHint.includes('Groq')).toBe(true)
    expect(inputHintOf('local', DEFAULT_CHANNEL_STATES).includes('本地')).toBe(true)
  })
})