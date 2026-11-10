import { describe, expect, it } from 'vitest'
import {
  clearKey,
  createDraft,
  isDirty,
  recommendedDraft,
  resetToCustom,
  selectPreset,
  setAdvancedOverride,
  setChannelEnabled,
  stageKey,
  toConfigInput
} from '@shared/ai/draft'
import { getPresetCatalog } from '@shared/ai/preset-catalog'
import { migrateLegacyConfig, projectView } from '@shared/ai/access-config'
import type { AiAccessConfigView } from '@shared/ai/access-config'

const catalog = getPresetCatalog()

function viewOf(basePreset: 'custom' | 'groq' = 'custom'): AiAccessConfigView {
  const config = migrateLegacyConfig(
    {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-abcdef1234',
      model: 'gpt-4o-mini',
      visionModel: 'gpt-4o-mini',
      asrModel: 'whisper-1'
    },
    1000,
    catalog
  ).config
  const withKey = {
    ...config,
    keys: [
      { presetId: 'custom' as const, keyMask: '••••1234', sealed: 'S', vault: 'plain' as const, updatedAt: 1000 },
      { presetId: 'groq' as const, keyMask: '••••7f3a', sealed: 'G', vault: 'plain' as const, updatedAt: 1000 }
    ],
    channels: {
      text: { ...config.channels.text, presetId: basePreset },
      vision: { ...config.channels.vision, presetId: basePreset },
      asr: { ...config.channels.asr, presetId: basePreset }
    }
  }
  return projectView(withKey, { contractVersion: 2, catalog })
}

function viewOfMixed(): AiAccessConfigView {
  const config = migrateLegacyConfig(
    {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-abcdef1234',
      model: 'gpt-4o-mini',
      visionModel: 'gpt-4o-mini',
      asrModel: 'whisper-1'
    },
    1000,
    catalog
  ).config
  const keys = [
    { presetId: 'custom' as const, keyMask: '••••1234', sealed: 'S', vault: 'plain' as const, updatedAt: 1000 },
    { presetId: 'groq' as const, keyMask: '••••7f3a', sealed: 'G', vault: 'plain' as const, updatedAt: 1000 },
    { presetId: 'gemini' as const, keyMask: '••••5678', sealed: 'M', vault: 'plain' as const, updatedAt: 1000 }
  ]
  const mixed = {
    ...config,
    keys,
    channels: {
      text: { ...config.channels.text, presetId: 'groq' as const },
      vision: { ...config.channels.vision, presetId: 'gemini' as const },
      asr: { ...config.channels.asr, presetId: 'groq' as const }
    }
  }
  return projectView(mixed, { contractVersion: 2, catalog })
}

describe('草稿引擎', () => {
  it('新建草稿未修改、不弄脏原视图', () => {
    const view = viewOf()
    const before = JSON.stringify(view)
    const draft = createDraft(view)
    expect(isDirty(draft, view)).toBe(false)
    expect(JSON.stringify(view)).toBe(before)
  })

  it('仅切换视觉预设，其他通道不变', () => {
    const view = viewOf()
    const draft = createDraft(view)
    const next = selectPreset(draft, 'vision', 'glm', catalog)
    expect(next.bindings.vision.presetId).toBe('glm')
    expect(next.bindings.vision.endpoint).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(next.bindings.vision.model).toBe('glm-4v-flash')
    expect(next.bindings.text.presetId).toBe(view.channels.text.presetId)
    expect(next.bindings.text.model).toBe(view.channels.text.model)
    expect(next.bindings.asr.presetId).toBe(view.channels.asr.presetId)
    expect(isDirty(next, view)).toBe(true)
  })

  it('切换到不支持语音的预设时保留原端点与模型', () => {
    const view = viewOf()
    const draft = createDraft(view)
    const before = draft.bindings.asr
    const next = selectPreset(draft, 'asr', 'gemini', catalog)
    expect(next.bindings.asr.endpoint).toBe(before.endpoint)
    expect(next.bindings.asr.model).toBe(before.model)
    expect(next.bindings.asr.presetId).toBe('gemini')
  })

  it('启用与停用只改启用态和端点模型保持', () => {
    const view = viewOf()
    const draft = createDraft(view)
    const disabled = setChannelEnabled(draft, 'vision', false)
    expect(disabled.bindings.vision.enabled).toBe(false)
    expect(disabled.bindings.vision.endpoint).toBe(draft.bindings.vision.endpoint)
  })

  it('Key 复用与隔离：不同预设互不可见', () => {
    const view = viewOfMixed()
    const draft = createDraft(view)
    const withGroqKey = stageKey(draft, 'groq', 'gsk-new-secret-0001')
    const groqDraft = withGroqKey.keyDrafts.find((item) => item.presetId === 'groq')
    const geminiDraft = withGroqKey.keyDrafts.find((item) => item.presetId === 'gemini')
    expect(groqDraft?.secret).toBe('gsk-new-secret-0001')
    expect(geminiDraft?.secret).toBeUndefined()
    expect(geminiDraft?.storedMask).toBe('••••5678')
    expect(groqDraft?.storedMask).toBe('••••7f3a')
  })

  it('清除 Key 生成 clear 操作', () => {
    const view = viewOf()
    const draft = clearKey(createDraft(view), 'custom')
    const input = toConfigInput(draft)
    expect(input.keyOps.some((op) => op.op === 'clear' && op.presetId === 'custom')).toBe(true)
  })

  it('恢复推荐组合保留已存 Groq Key 且不产生 clear', () => {
    const view = viewOf()
    const draft = createDraft(view)
    const recommended = recommendedDraft(catalog, draft)
    expect(recommended.bindings.text.presetId).toBe('groq')
    expect(recommended.bindings.vision.presetId).toBe('groq')
    expect(recommended.bindings.asr.presetId).toBe('groq')
    const input = toConfigInput(recommended)
    expect(input.keyOps.every((op) => op.op === 'keep')).toBe(true)
    expect(input.keyOps.some((op) => op.op === 'clear')).toBe(false)
  })

  it('清除配置回到本地解析', () => {
    const view = viewOf()
    const draft = resetToCustom(createDraft(view))
    expect(draft.bindings.text.mode).toBe('local')
    expect(draft.bindings.text.enabled).toBe(false)
    expect(draft.bindings.vision.enabled).toBe(false)
    expect(draft.bindings.asr.enabled).toBe(false)
    expect(draft.keyDrafts.every((item) => item.cleared)).toBe(true)
  })

  it('高级编辑标记为自定义覆盖', () => {
    const view = viewOf()
    const draft = createDraft(view)
    const next = setAdvancedOverride(draft, 'text', { model: 'custom-model' })
    expect(next.bindings.text.model).toBe('custom-model')
    expect(next.bindings.text.source).toBe('custom_override')
    expect(next.advancedChannels.includes('text')).toBe(true)
  })

  it('提交载荷覆盖三通道且同一预设无矛盾操作', () => {
    const view = viewOf()
    const draft = stageKey(createDraft(view), 'gemini', 'g-key-1234')
    const input = toConfigInput(draft)
    expect(input.channels.text !== undefined).toBe(true)
    expect(input.channels.vision !== undefined).toBe(true)
    expect(input.channels.asr !== undefined).toBe(true)
    const sets = input.keyOps.filter((op) => op.op === 'set').map((op) => (op.op === 'set' ? op.presetId : ''))
    expect(new Set(sets).size).toBe(sets.length)
  })
})