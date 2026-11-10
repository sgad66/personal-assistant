import React, { useEffect, useState } from 'react'
import type { AiChannelKind, PresetId } from '@shared/ipc-contracts'
import { UI_TEXT } from '@shared/message-catalog'
import { toPresetSummary } from '@shared/ai/preset-catalog'
import { useAiSettingsStore } from '../../stores/ai-settings-store'
import PresetCatalogList from './PresetCatalogList'
import ChannelBindingCard from './ChannelBindingCard'
import FreeTierPanel from './FreeTierPanel'
import AiSettingsActions from './AiSettingsActions'

interface AiSettingsDialogProps {
  readonly onClose: () => void
}

const CHANNEL_TITLES: Record<AiChannelKind, string> = {
  text: UI_TEXT.aiTextChannel,
  vision: UI_TEXT.aiVisionChannel,
  asr: UI_TEXT.aiAsrChannel
}

export default function AiSettingsDialog({ onClose }: AiSettingsDialogProps): React.ReactElement {
  const view = useAiSettingsStore((state) => state.view)
  const draft = useAiSettingsStore((state) => state.draft)
  const catalog = useAiSettingsStore((state) => state.catalog)
  const loading = useAiSettingsStore((state) => state.loading)
  const saving = useAiSettingsStore((state) => state.saving)
  const dirty = useAiSettingsStore((state) => state.dirty)
  const issues = useAiSettingsStore((state) => state.issues)
  const testResults = useAiSettingsStore((state) => state.testResults)
  const loadError = useAiSettingsStore((state) => state.loadError)
  const hydrate = useAiSettingsStore((state) => state.hydrate)
  const pickPreset = useAiSettingsStore((state) => state.pickPreset)
  const toggleChannel = useAiSettingsStore((state) => state.toggleChannel)
  const changeMode = useAiSettingsStore((state) => state.changeMode)
  const overrideBinding = useAiSettingsStore((state) => state.overrideBinding)
  const setKey = useAiSettingsStore((state) => state.setKey)
  const removeKey = useAiSettingsStore((state) => state.removeKey)
  const restoreRecommended = useAiSettingsStore((state) => state.restoreRecommended)
  const clearAll = useAiSettingsStore((state) => state.clearAll)
  const save = useAiSettingsStore((state) => state.save)
  const test = useAiSettingsStore((state) => state.test)

  const [selectedPreset, setSelectedPreset] = useState<PresetId>('groq')
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (draft) setSelectedPreset(draft.bindings.text.presetId)
  }, [draft?.bindings.text.presetId])

  const presets = view?.presets ?? catalog.entries.map(toPresetSummary)
  const selectedSummary = presets.find((preset) => preset.presetId === selectedPreset)

  const requestClose = (): void => {
    if (saving) return
    if (dirty) {
      setConfirmClose(true)
      return
    }
    onClose()
  }

  const doSave = async (): Promise<void> => {
    const success = await save()
    if (success) onClose()
  }

  const doClear = (): void => {
    clearAll()
  }

  return (
    <div className="overlay ai-overlay" role="dialog" aria-modal="true" onClick={requestClose}>
      <div className="ai-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="detail-header">
          <div>
            <h2>{UI_TEXT.aiSettingsTitle}</h2>
            <p className="ai-hint">
              文本理解、视觉识别、语音转写可分别绑定不同服务商；修改只在保存后生效。
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={requestClose} disabled={saving}>
            {UI_TEXT.aiClose}
          </button>
        </header>

        {loading && <div className="ai-loading">正在读取配置…</div>}
        {loadError && <div className="ai-warning">{loadError}</div>}

        {draft && (
          <div className="ai-dialog-body">
            <PresetCatalogList
              presets={presets}
              selected={selectedPreset}
              catalogState={view?.catalogState ?? 'ok'}
              onSelect={setSelectedPreset}
            />

            <FreeTierPanel preset={selectedSummary} />

            <div className="ai-channel-grid">
              {(['text', 'vision', 'asr'] as const).map((channel) => {
                const binding = draft.bindings[channel]
                const keyDraft = draft.keyDrafts.find((item) => item.presetId === binding.presetId)
                return (
                  <ChannelBindingCard
                    key={channel}
                    channel={channel}
                    title={CHANNEL_TITLES[channel]}
                    binding={binding}
                    bindingView={view?.channels[channel]}
                    keyDraft={keyDraft}
                    catalog={catalog}
                    issues={issues}
                    testResult={testResults[channel]}
                    disabled={saving}
                    onPickPreset={(presetId) => pickPreset(channel, presetId)}
                    onToggle={(enabled) => toggleChannel(channel, enabled)}
                    onMode={(mode) => changeMode(channel, mode)}
                    onOverride={(patch) => overrideBinding(channel, patch)}
                    onTest={() => void test(channel)}
                    onKeyChange={(secret) => setKey(binding.presetId, secret)}
                    onKeyClear={() => removeKey(binding.presetId)}
                  />
                )
              })}
            </div>

            <AiSettingsActions
              saving={saving}
              dirty={dirty}
              onSave={() => void doSave()}
              onRestore={restoreRecommended}
              onClear={doClear}
              onClose={requestClose}
            />
          </div>
        )}

        {confirmClose && (
          <div className="ai-confirm" role="alertdialog">
            <p>{UI_TEXT.aiDirtyConfirm}</p>
            <div className="panel-actions">
              <button type="button" className="ghost-button" onClick={() => setConfirmClose(false)}>
                继续编辑
              </button>
              <button type="button" className="danger-button" onClick={onClose}>
                放弃更改
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}