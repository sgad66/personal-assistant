import { create } from 'zustand'
import type {
  AiAccessConfigView,
  AiChannelKind,
  AiConnectionTestResult,
  ChannelAvailability,
  ChannelBindingInput,
  ChannelCapabilityGap,
  PresetId,
  ValidationIssue
} from '@shared/ipc-contracts'
import type { AiDraft } from '@shared/ai/draft'
import {
  appendConfirmation,
  clearKey,
  createBlankDraft,
  createDraft,
  hasDraftKey,
  isDirty,

  resetToCustom,
  selectPreset,
  setAdvancedOverride,
  setChannelEnabledWithCatalog,
  setChannelMode,
  setRelaxedTimeout,
  stageKey,
  toConfigInput,
  validateDraft
} from '@shared/ai/draft'
import { deriveAvailability } from '@shared/ai/access-config'
import { capabilityGapOf } from '@shared/ai/capability-gate'
import { deepseekSolutionDraft, groqFreeDraft, strictDeepSeekDraft } from '@shared/ai/solution'
import { CUSTOM_FALLBACK_CATALOG, getPresetCatalog, type PresetCatalog } from '@shared/ai/preset-catalog'
import { useAppStore } from './app-store'

export type GapStage = 'switch' | 'strict'

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
  pendingGap?: { channel: AiChannelKind; gap: ChannelCapabilityGap; stage: GapStage }
  hydrate: () => Promise<void>
  pickPreset: (channel: AiChannelKind, presetId: PresetId) => void
  toggleChannel: (channel: AiChannelKind, enabled: boolean) => void
  toggleRelaxed: () => void
  changeMode: (channel: AiChannelKind, mode: 'ai' | 'local') => void
  overrideBinding: (channel: AiChannelKind, patch: Partial<Pick<ChannelBindingInput, 'endpoint' | 'model'>>) => void
  setKey: (presetId: PresetId, secret: string) => void
  removeKey: (presetId: PresetId) => void
  restoreRecommended: () => void
  applyDeepSeekSolution: () => void
  applyGroqFree: () => void
  applyStrict: () => void
  requestStrict: () => void
  confirmGap: (action: 'strict' | 'keep_fallback' | 'cancel') => void
  cancelGap: () => void
  restoreDefault: () => void
  clearAll: () => void
  save: () => Promise<boolean>
  test: (channel: AiChannelKind) => Promise<void>
}

export function channelStatesOf(
  draft: AiDraft,
  catalog: PresetCatalog
): Readonly<Record<AiChannelKind, ChannelAvailability>> {
  const entries = new Map(catalog.entries.map((entry) => [entry.presetId, entry]))
  const build = (channel: AiChannelKind): ChannelAvailability => {
    const binding = draft.bindings[channel]
    return deriveAvailability(
      { ...binding, channel },
      entries.get(binding.presetId),
      hasDraftKey(draft, binding.presetId),
      entries
    )
  }
  return { text: build('text'), vision: build('vision'), asr: build('asr') }
}

let hydratePromise: Promise<void> | null = null

function confirmationStatesOf(
  draft: AiDraft
): Readonly<Record<AiChannelKind, { readonly presetId: PresetId; readonly enabled: boolean }>> {
  return {
    text: { presetId: draft.bindings.text.presetId, enabled: draft.bindings.text.enabled },
    vision: { presetId: draft.bindings.vision.presetId, enabled: draft.bindings.vision.enabled },
    asr: { presetId: draft.bindings.asr.presetId, enabled: draft.bindings.asr.enabled }
  }
}

function gapKindOf(channel: AiChannelKind): 'drop_image' | 'strict_mode' | 'keep_fallback' {
  return channel === 'vision' ? 'drop_image' : 'keep_fallback'
}

export const useAiSettingsStore = create<AiSettingsState>((set, get) => ({
  catalog: getPresetCatalog(),
  loading: false,
  saving: false,
  issues: [],
  testResults: {},
  testErrors: {},
  testing: {},
  dirty: false,
  pendingGap: undefined,

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
    const gap = capabilityGapOf({ presetId }, channel, catalog)
    if (gap) {
      set({ pendingGap: { channel, gap, stage: 'switch' } })
      return
    }
    const next = selectPreset(draft, channel, presetId, catalog)
    set((state) => ({
      draft: next,
      pendingGap: undefined,
      dirty: state.view ? isDirty(next, state.view) : true,
      testResults: { ...state.testResults, [channel]: undefined },
      testErrors: { ...state.testErrors, [channel]: undefined }
    }))
  },

  toggleChannel: (channel, enabled) => {
    const { draft, view, catalog } = get()
    if (!draft) return
    const next = setChannelEnabledWithCatalog(draft, channel, enabled, catalog)
    set({ draft: next, dirty: view ? isDirty(next, view) : true })
  },

  toggleRelaxed: () => {
    const { draft, view } = get()
    if (!draft) return
    const next = setRelaxedTimeout(draft, !(draft.timeouts?.relaxed ?? false))
    set({ draft: next, dirty: view ? isDirty(next, view) : true })
  },

  changeMode: (channel, mode) => {
    const { draft, view, catalog } = get()
    if (!draft) return
    let next = setChannelMode(draft, channel, mode)
    if (mode === 'ai' && !next.bindings[channel].enabled) {
      next = setChannelEnabledWithCatalog(next, channel, true, catalog)
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
    const next = groqFreeDraft(catalog, draft)
    set({
      draft: next,
      dirty: view ? isDirty(next, view) : true,
      testResults: {},
      testErrors: {},
      pendingGap: undefined
    })
  },

  applyDeepSeekSolution: () => {
    const { draft, catalog, view } = get()
    if (!draft) return
    const next = deepseekSolutionDraft(catalog, draft)
    set({
      draft: next,
      dirty: view ? isDirty(next, view) : true,
      testResults: {},
      testErrors: {},
      pendingGap: undefined
    })
  },

  applyGroqFree: () => {
    const { draft, catalog, view } = get()
    if (!draft) return
    const next = groqFreeDraft(catalog, draft)
    set({
      draft: next,
      dirty: view ? isDirty(next, view) : true,
      testResults: {},
      testErrors: {},
      pendingGap: undefined
    })
  },

  applyStrict: () => {
    const { draft, catalog, view } = get()
    if (!draft) return
    const strictDraft = strictDeepSeekDraft(catalog, draft)
    const next = appendConfirmation(strictDraft, {
      kind: 'strict_mode',
      at: Date.now(),
      result: 'confirmed',
      channelStates: confirmationStatesOf(strictDraft)
    })
    set({
      draft: next,
      dirty: view ? isDirty(next, view) : true,
      testResults: {},
      testErrors: {},
      pendingGap: undefined
    })
  },

  requestStrict: () => {
    const { draft, catalog } = get()
    if (!draft) return
    const gap = capabilityGapOf({ presetId: 'deepseek' }, 'vision', catalog)
    if (!gap) {
      get().applyStrict()
      return
    }
    set({ pendingGap: { channel: 'vision', gap, stage: 'strict' } })
  },

  confirmGap: (action) => {
    const { draft, view, pendingGap } = get()
    if (!draft || !pendingGap) return

    if (action === 'strict') {
      set({ pendingGap: { ...pendingGap, stage: 'strict' } })
      return
    }
    if (action === 'keep_fallback') {
      const next = appendConfirmation(draft, {
        kind: 'keep_fallback',
        at: Date.now(),
        result: 'confirmed',
        channelStates: confirmationStatesOf(draft)
      })
      set({ draft: next, dirty: view ? isDirty(next, view) : true, pendingGap: undefined })
      return
    }
    const next = appendConfirmation(draft, {
      kind: gapKindOf(pendingGap.channel),
      at: Date.now(),
      result: 'cancelled',
      channelStates: confirmationStatesOf(draft)
    })
    set({ draft: next, dirty: view ? isDirty(next, view) : true, pendingGap: undefined })
  },

  cancelGap: () => {
    get().confirmGap('cancel')
  },

  restoreDefault: () => {
    get().applyDeepSeekSolution()
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
        const nextDraft = createDraft(view)
        set({
          view,
          draft: nextDraft,
          catalog: nextCatalog,
          saving: false,
          dirty: false,
          issues: [],
          saveError: undefined,
          pendingGap: undefined
        })
        useAppStore.getState().setAiStatus(view.status, channelStatesOf(nextDraft, nextCatalog))
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