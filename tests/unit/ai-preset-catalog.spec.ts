import { describe, expect, it } from 'vitest'
import {
  capabilityTagsOf,
  getPresetCatalog,
  findPreset,
  orderedPresets,
  supportsChannel,
  defaultModelFor,
  toPresetSummary
} from '@shared/ai/preset-catalog'
import { validatePresetCatalog, safeCatalog } from '@shared/ai/preset-catalog-validator'

describe('预设服务商目录', () => {
  it('内置 6 条预设且端点均为 HTTPS', () => {
    const catalog = getPresetCatalog()
    expect(catalog.entries).toHaveLength(6)
    expect(catalog.catalogVersion).toBe(2)
    for (const entry of catalog.entries) {
      expect(entry.endpoint.startsWith('https://')).toBe(true)
    }
  })

  it('DeepSeek 仅声明文字能力且不设视觉与语音模型', () => {
    const deepseek = findPreset('deepseek')
    expect(deepseek !== undefined).toBe(true)
    if (!deepseek) return
    expect(deepseek.capabilities.text).toBe('supported')
    expect(deepseek.capabilities.vision).toBe('unsupported')
    expect(deepseek.capabilities.asr).toBe('unsupported')
    expect(deepseek.models.vision).toBeUndefined()
    expect(deepseek.models.asr).toBeUndefined()
    expect(deepseek.badge).toBe('official_api')
    expect(deepseek.badge === 'free_recommended').toBe(false)
    expect(deepseek.freeTier).toBeUndefined()
    expect(supportsChannel(deepseek, 'text')).toBe(true)
    expect(supportsChannel(deepseek, 'vision')).toBe(false)
    expect(supportsChannel(deepseek, 'asr')).toBe(false)
    expect(capabilityTagsOf(deepseek).includes('text_only')).toBe(true)
    expect(capabilityTagsOf(deepseek).includes('official_api')).toBe(true)
    expect(Object.isFrozen(deepseek.capabilityTags)).toBe(true)
    expect(toPresetSummary(deepseek).keyHelpKey).toBe('ai.keyHelp.deepseek')
    expect(orderedPresets()[1]?.presetId).toBe('deepseek')
  })

  it('同时支持文本与视觉的条目不少于 4 个', () => {
    const catalog = getPresetCatalog()
    const both = catalog.entries.filter(
      (entry) => entry.capabilities.text === 'supported' && entry.capabilities.vision === 'supported'
    )
    expect(both.length).toBeGreaterThanOrEqual(4)
  })

  it('免费推荐唯一且 Groq 置顶、自定义置底', () => {
    const catalog = getPresetCatalog()
    const recommended = catalog.entries.filter((entry) => entry.badge === 'free_recommended')
    expect(recommended.length).toBe(1)
    const ordered = orderedPresets(catalog)
    expect(ordered[0]?.presetId).toBe('groq')
    expect(ordered[ordered.length - 1]?.presetId).toBe('custom')
  })

  it('能力判定与默认模型一致', () => {
    const groq = findPreset('groq')
    const gemini = findPreset('gemini')
    const glm = findPreset('glm')
    expect(groq !== undefined).toBe(true)
    expect(gemini !== undefined).toBe(true)
    expect(glm !== undefined).toBe(true)
    if (!groq || !gemini || !glm) return
    expect(supportsChannel(groq, 'asr')).toBe(true)
    expect(supportsChannel(gemini, 'asr')).toBe(false)
    expect(defaultModelFor(glm, 'vision')).toBe('glm-4.6v-flash')
    expect(supportsChannel(groq, 'vision')).toBe(true)
  })

  it('每个免费预设都有免费说明与时效声明', () => {
    const catalog = getPresetCatalog()
    for (const entry of catalog.entries) {
      if (!entry.freeTier) continue
      expect(entry.freeTier.summaryKey.length > 0).toBe(true)
      expect(entry.freeTier.disclaimerKey).toBe('ai.disclaimer')
    }
  })

  it('内置目录通过结构校验且只读', () => {
    const validated = validatePresetCatalog(getPresetCatalog())
    expect(validated.ok).toBe(true)
    expect(Object.isFrozen(getPresetCatalog())).toBe(true)
    expect(Object.isFrozen(getPresetCatalog().entries[0])).toBe(true)
  })

  it('缺失视觉模型但标记为支持时校验失败并降级', () => {
    const broken = {
      catalogVersion: 1,
      recommendedPresetId: 'groq' as const,
      entries: [
        {
          ...(getPresetCatalog().entries[0] as NonNullable<ReturnType<typeof findPreset>>),
          models: { text: 'x' },
          capabilities: { text: 'supported' as const, vision: 'supported' as const, asr: 'unsupported' as const }
        }
      ]
    }
    const validated = validatePresetCatalog({
      ...broken,
      entries: [
        broken.entries[0],
        ...getPresetCatalog().entries.slice(1, 4),
        getPresetCatalog().entries[4]
      ]
    })
    expect(validated.ok).toBe(false)
    if (validated.ok) return
    expect(validated.error.code).toBe('E_PRESET_CATALOG_UNAVAILABLE')
    const degraded = safeCatalog({
      ...broken,
      entries: [
        broken.entries[0],
        ...getPresetCatalog().entries.slice(1, 4),
        getPresetCatalog().entries[4]
      ]
    })
    expect(degraded.state).toBe('degraded')
    expect(degraded.catalog.entries).toHaveLength(1)
    expect(degraded.catalog.entries[0]?.presetId).toBe('custom')
  })

  it('自定义条目摘要保留免费说明字段', () => {
    const custom = findPreset('custom')
    expect(custom !== undefined).toBe(true)
    if (!custom) return
    const summary = toPresetSummary(custom)
    expect(summary.keyRequirement).toBe('optional')
    expect(summary.capabilities.text).toBe('supported')
  })

  it('DeepSeek 填视觉模型时校验失败并降级为自定义', () => {
    const catalog = getPresetCatalog()
    const broken = {
      ...catalog,
      entries: catalog.entries.map((entry) =>
        entry.presetId === 'deepseek'
          ? { ...entry, models: { ...entry.models, vision: 'deepseek-vl' } }
          : entry
      )
    }
    const validated = validatePresetCatalog(broken)
    expect(validated.ok).toBe(false)
    if (!validated.ok) expect(validated.error.code).toBe('E_PRESET_CATALOG_UNAVAILABLE')
    const degraded = safeCatalog(broken)
    expect(degraded.state).toBe('degraded')
    expect(degraded.catalog.entries).toHaveLength(1)
    expect(degraded.catalog.entries[0]?.presetId).toBe('custom')
  })

  it('文本能力标签与能力声明矛盾时校验失败', () => {
    const catalog = getPresetCatalog()
    const broken = {
      ...catalog,
      entries: catalog.entries.map((entry) =>
        entry.presetId === 'deepseek'
          ? {
              ...entry,
              capabilities: { text: 'supported' as const, vision: 'supported' as const, asr: 'unsupported' as const }
            }
          : entry
      )
    }
    expect(validatePresetCatalog(broken).ok).toBe(false)
  })

  it('条目不足 6 条时校验失败，缺可选字段仍可通过', () => {
    const catalog = getPresetCatalog()
    expect(validatePresetCatalog({ ...catalog, entries: catalog.entries.slice(0, 5) }).ok).toBe(false)
    const legacyEntries = catalog.entries.map((entry) => {
      const copy: Record<string, unknown> = { ...entry }
      delete copy.capabilityTags
      delete copy.keyHelpKey
      return copy
    })
    const legacy = {
      ...catalog,
      entries: legacyEntries as unknown as typeof catalog.entries
    }
    expect(validatePresetCatalog(legacy).ok).toBe(true)
  })
})