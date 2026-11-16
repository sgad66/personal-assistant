import { describe, expect, it } from 'vitest'
import type { ChannelBindingInput } from '@shared/ai/access-config'
import {
  SOLUTION_CATALOG,
  RECOMMENDED_SOLUTION,
  deepseekSolutionDraft,
  groqFreeDraft,
  resolveSolution,
  strictDeepSeekDraft
} from '@shared/ai/solution'
import { createBlankDraft, recommendedDraft, toConfigInput } from '@shared/ai/draft'
import { getPresetCatalog, findPreset } from '@shared/ai/preset-catalog'

const catalog = getPresetCatalog()

function previousDraft() {
  const blank = createBlankDraft(catalog)
  return {
    ...blank,
    keyDrafts: [
      ...blank.keyDrafts,
      { presetId: 'gemini' as const, storedMask: '••••5678', hasStoredKey: true, cleared: false }
    ]
  }
}

function binding(overrides: Partial<ChannelBindingInput> = {}): ChannelBindingInput {
  return {
    enabled: true,
    mode: 'ai',
    presetId: 'groq',
    endpoint: findPreset('groq')?.endpoint ?? '',
    model: 'llama-3.3-70b-versatile',
    source: 'preset_default',
    ...overrides
  }
}

describe('接入方案构造器', () => {
  it('DeepSeek 默认方案：文本 DeepSeek、图片与语音 Groq', () => {
    const previous = previousDraft()
    const draft = deepseekSolutionDraft(catalog, previous)
    expect(draft.bindings.text.enabled).toBe(true)
    expect(draft.bindings.text.presetId).toBe('deepseek')
    expect(draft.bindings.text.model).toBe('deepseek-chat')
    expect(draft.bindings.vision.presetId).toBe('groq')
    expect(draft.bindings.vision.model).toBe(findPreset('groq')?.models.vision)
    expect(draft.bindings.asr.presetId).toBe('groq')
    expect(draft.bindings.asr.model).toBe(findPreset('groq')?.models.asr)
    expect(draft.solution).toBe('deepseek_default')
    const deepseekKey = draft.keyDrafts.find((item) => item.presetId === 'deepseek')
    const groqKey = draft.keyDrafts.find((item) => item.presetId === 'groq')
    expect(deepseekKey?.cleared).toBe(false)
    expect(deepseekKey?.secret).toBeUndefined()
    expect(groqKey?.cleared).toBe(false)
    expect(groqKey?.secret).toBeUndefined()
    const geminiKey = draft.keyDrafts.find((item) => item.presetId === 'gemini')
    expect(geminiKey).toEqual(previous.keyDrafts.find((item) => item.presetId === 'gemini'))
    expect(JSON.stringify(toConfigInput(draft)).includes('gsk-')).toBe(false)
  })

  it('严格模式：视觉与语音指向 DeepSeek 且停用，保留原端点模型', () => {
    const previous = previousDraft()
    const draft = strictDeepSeekDraft(catalog, previous)
    expect(draft.bindings.vision.presetId).toBe('deepseek')
    expect(draft.bindings.vision.enabled).toBe(false)
    expect(draft.bindings.vision.endpoint).toBe(previous.bindings.vision.endpoint)
    expect(draft.bindings.vision.model).toBe(previous.bindings.vision.model)
    expect(draft.bindings.asr.presetId).toBe('deepseek')
    expect(draft.bindings.asr.enabled).toBe(false)
    expect(draft.bindings.asr.endpoint).toBe(previous.bindings.asr.endpoint)
    expect(draft.bindings.asr.model).toBe(previous.bindings.asr.model)
    expect(draft.touchedChannels.includes('text')).toBe(true)
    expect(draft.touchedChannels.includes('vision')).toBe(true)
    expect(draft.touchedChannels.includes('asr')).toBe(true)
    expect(draft.solution).toBe('deepseek_strict')
  })

  it('Groq 免费方案与既有推荐草稿一致', () => {
    const previous = previousDraft()
    const draft = groqFreeDraft(catalog, previous)
    expect(draft).toEqual(recommendedDraft(catalog, previous))
    expect(draft.solution).toBe('groq_free')
    expect(draft.bindings.text.presetId).toBe('groq')
    expect(draft.bindings.vision.presetId).toBe('groq')
    expect(draft.bindings.asr.presetId).toBe('groq')
  })

  it('构造器不修改入参草稿', () => {
    const previous = previousDraft()
    const before = JSON.stringify(previous)
    deepseekSolutionDraft(catalog, previous)
    strictDeepSeekDraft(catalog, previous)
    groqFreeDraft(catalog, previous)
    expect(JSON.stringify(previous)).toBe(before)
  })

  it('方案目录只有一个默认方案', () => {
    expect(RECOMMENDED_SOLUTION).toBe('deepseek_default')
    const defaults = SOLUTION_CATALOG.filter((solution) => solution.isDefault)
    expect(defaults).toHaveLength(1)
    expect(defaults[0]?.id).toBe('deepseek_default')
  })
})

describe('方案判定 resolveSolution', () => {
  it('声明优先：显式 user_custom 不被快照覆盖', () => {
    const channels = {
      text: binding({ presetId: 'deepseek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
      vision: binding(),
      asr: binding()
    }
    expect(resolveSolution(channels, catalog, () => true, 'user_custom')).toBe('user_custom')
  })

  it('严格模式：视觉与语音为 DeepSeek 且停用', () => {
    const channels = {
      text: binding({ presetId: 'deepseek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
      vision: binding({ presetId: 'deepseek', enabled: false }),
      asr: binding({ presetId: 'deepseek', enabled: false })
    }
    expect(resolveSolution(channels, catalog, (id) => id === 'deepseek')).toBe('deepseek_strict')
  })

  it('DeepSeek 默认方案与 Groq 免费方案均可识别', () => {
    const channels = {
      text: binding({ presetId: 'deepseek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
      vision: binding(),
      asr: binding()
    }
    expect(resolveSolution(channels, catalog, () => true)).toBe('deepseek_default')
    const groq = {
      text: binding(),
      vision: binding(),
      asr: binding()
    }
    expect(resolveSolution(groq, catalog, (id) => id === 'groq')).toBe('groq_free')
  })

  it('其余组合回落自定义', () => {
    const channels = {
      text: binding({ presetId: 'custom', endpoint: 'https://x.example.com', model: 'm' }),
      vision: binding({ enabled: false }),
      asr: binding({ enabled: false })
    }
    expect(resolveSolution(channels, catalog, () => true)).toBe('user_custom')
    const deepseekText = {
      text: binding({ presetId: 'deepseek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
      vision: binding({ enabled: false }),
      asr: binding({ enabled: false })
    }
    expect(resolveSolution(deepseekText, catalog, () => false)).toBe('user_custom')
  })
})