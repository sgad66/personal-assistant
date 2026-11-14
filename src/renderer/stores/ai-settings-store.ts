import { create } from 'zustand'
import type {
  AiAccessConfigView,
  AiChannelKind,
  AiConnectionTestResult,
  ChannelBindingInput,
  PresetId,
  ValidationIssue
} from '@shared/ipc-contracts'
import type { AiDraft } from '@shared/ai/draft'
import {
  clearKey,
  createBlankDraft,
  createDraft,
  isDirty,
  recommendedDraft,
  resetToCustom,
  selectPreset,
  setAdvancedOverride,
  setChannelEnabled,
  setChannelMode,
  stageKey,
  toConfigInput,
  validateDraft
} from '@shared/ai/draft'
import { CUSTOM_FALLBACK_CATALOG, getPresetCatalog, type PresetCatalog } from '@shared/ai/preset-catalog'

interface AiSettingsState {
  view?: AiAccessConfigView
  draft?: AiDraft
  catalog: PresetCatalog
  loading: boolean
  saving: boolean
  loadError?: string
  saveError?: string
  issues: readonly ValidationIssue[]
  testResults: Partial<Record<AiChannelKind, AiConnectionTestResult>>
  testErrors: Partial<Record<AiChannelKind, string>>
  testing: Partial<Record<AiChannelKind, boolean>>
  dirty: boolean
  hydrate: () => Promise<void>
  pickPreset: (channel: AiChannelKind, presetId: PresetId) => void
  toggleChannel: (channel: AiChannelKind, enabled: boolean) => void
  changeMode: (channel: AiChannelKind, mode: 'ai' | 'local') => void
  overrideBinding: (channel: AiChannelKind, patch: Partial<Pick<ChannelBindingInput, 'endpoint' | 'model'>>) => void
  setKey: (presetId: PresetId, secret: string) => void
  removeKey: (presetId: PresetId) => void
  restoreRecommended: () => void
  clearAll: () => void
  save: () => Promise<boolean>
  test: (channel: AiChannelKind) => Promise<void>
}

let hydratePromise: Promise<void> | null = null

export const useAiSettingsStore = create<AiSettingsState>((set, get) => ({
  catalog: getPresetCatalog(),
  loading: false,
  saving: false,
  issues: [],
  testResults: {},
  testErrors: {},
  testing: {},
  dirty: false,

  hydrate: async () => {
    if (hydratePromise) return hydratePromise
    hydratePromise = (async () => {
      set({ loading: true, loadError: undefined })
      try {
        const outcome = await window.pa.app.getAiConfig()
        const view = outcome.view
        if (!view) {
          set({
            loading: false,
            loadError: '读取配置失败，可重新填写后保存',
            view: undefined,
            draft: createBlankDraft(getPresetCatalog()),
            testResults: {},
            testErrors: {},
            testing: {},
            issues: [],
            dirty: false
          })
          return
        }
        const catalog = view.catalogState === 'degraded' ? CUSTOM_FALLBACK_CATALOG : getPresetCatalog()
        set({
          view,
          draft: createDraft(view),
          catalog,
          loading: false,
          dirty: false,
          issues: [],
          testResults: {},
          testErrors: {},
          testing: {},
          loadError: outcome.ok ? undefined : '读取配置失败，可重新填写后保存'
        })
      } catch {
        const fallbackCatalog = getPresetCatalog()
        set({
          catalog: fallbackCatalog,
          draft: createBlankDraft(fallbackCatalog),
          loading: false,
          loadError: '读取配置失败，可重新填写后保存',
          dirty: false,
          testResults: {},
          testErrors: {},
          testing: {}
        })
      }
    })().finally(() => {
      hydratePromise = null
    })
    return hydratePromise
  },

  pickPreset: (channel, presetId) => {
    const { draft, catalog } = get()
    if (!draft) return
    const next = selectPreset(draft, channel, presetId, catalog)
    set((state) => ({
      draft: next,
      dirty: state.view ? isDirty(next, state.view) : true,
      testResults: { ...state.testResults, [channel]: undefined },
      testErrors: { ...state.testErrors, [channel]: undefined }
    }))
  },

  toggleChannel: (channel, enabled) => {
    const { draft, view } = get()
    if (!draft) return
    const next = setChannelEnabled(draft, channel, enabled)
    set({ draft: next, dirty: view ? isDirty(next, view) : true })
  },

  changeMode: (channel, mode) => {
    const { draft, view } = get()
    if (!draft) return
    let next = setChannelMode(draft, channel, mode)
    if (mode === 'ai' && !next.bindings[channel].enabled) {
      next = setChannelEnabled(next, channel, true)
    }
    const changed = next
    set({ draft: changed, dirty: view ? isDirty(changed, view) : true })
  },

  overrideBinding: (channel, patch) => {
    const { draft, view } = get()
    if (!draft) return
    const next = setAdvancedOverride(draft, channel, patch)
    set({ draft: next, dirty: view ? isDirty(next, view) : true })
  },

  setKey: (presetId, secret) => {
    const { draft, view } = get()
    if (!draft) return
    const next = stageKey(draft, presetId, secret)
    set({ draft: next, dirty: view ? isDirty(next, view) : true })
  },

  removeKey: (presetId) => {
    const { draft, view } = get()
    if (!draft) return
    const next = clearKey(draft, presetId)
    set({ draft: next, dirty: view ? isDirty(next, view) : true })
  },

  restoreRecommended: () => {
    const { draft, catalog, view } = get()
    if (!draft) return
    const next = recommendedDraft(catalog, draft)
    set({
      draft: next,
      dirty: view ? isDirty(next, view) : true,
      testResults: {},
      testErrors: {}
    })
  },

  clearAll: () => {
    const { draft, view } = get()
    if (!draft) return
    const next = resetToCustom(draft)
    set({
      draft: next,
      dirty: view ? isDirty(next, view) : true,
      testResults: {},
      testErrors: {}
    })
  },

  save: async () => {
    const { draft, saving, catalog } = get()
    if (!draft || saving) return false
    const localIssues = validateDraft(draft, catalog)
    if (localIssues.length > 0) {
      set({ issues: localIssues, saveError: undefined })
      return false
    }
    set({ saving: true, saveError: undefined, issues: [] })
    try {
      const outcome = await window.pa.app.setAiConfig(toConfigInput(draft))
      if (outcome.ok && outcome.view) {
        const view = outcome.view
        const nextCatalog = view.catalogState === 'degraded' ? CUSTOM_FALLBACK_CATALOG : getPresetCatalog()
        set({
          view,
          draft: createDraft(view),
          catalog: nextCatalog,
          saving: false,
          dirty: false,
          issues: [],
          saveError: undefined
        })
        return true
      }
      set({
        saving: false,
        issues: outcome.issues ?? [],
        saveError: outcome.error?.code ?? 'E_CONFIG_WRITE_FAIL'
      })
      return false
    } catch {
      set({ saving: false, saveError: 'E_CONFIG_WRITE_FAIL' })
      return false
    }
  },

  test: async (channel) => {
    const { draft } = get()
    if (!draft) return
    const presetId = draft.bindings[channel].presetId
    const keyDraft = draft.keyDrafts.find((item) => item.presetId === presetId)
    set((state) => ({
      testing: { ...state.testing, [channel]: true },
      testErrors: { ...state.testErrors, [channel]: undefined }
    }))
    try {
      const result = await window.pa.app.testConnection({
        channel,
        binding: draft.bindings[channel],
        ...(keyDraft?.secret ? { secret: keyDraft.secret } : {})
      })
      set((state) => ({ testResults: { ...state.testResults, [channel]: result } }))
    } catch {
      set((state) => ({
        testResults: { ...state.testResults, [channel]: undefined },
        testErrors: { ...state.testErrors, [channel]: '检查失败，请稍后重试' }
      }))
    } finally {
      set((state) => ({ testing: { ...state.testing, [channel]: false } }))
    }
  }
}))

export function issueFor(
  issues: readonly ValidationIssue[],
  channel: AiChannelKind,
  field?: ValidationIssue['field']
): ValidationIssue | undefined {
  return issues.find((issue) => issue.channel === channel && (field === undefined || issue.field === field))
}