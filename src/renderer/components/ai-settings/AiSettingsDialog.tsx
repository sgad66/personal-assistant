import React, { useEffect, useState } from 'react'
import type { AiChannelKind } from '@shared/ipc-contracts'
import { translate } from '@shared/message-catalog'
import { useAiSettingsStore } from '../../stores/ai-settings-store'
import { aiStatusLabel } from '../../ui-text'
import Icon from '../Icon'
import ChannelBindingCard from './ChannelBindingCard'
import AiSettingsActions from './AiSettingsActions'

interface AiSettingsDialogProps {
  readonly onClose: () => void
  readonly closeToTray: boolean
  readonly onToggleCloseToTray: () => void
}

const CHANNELS: readonly {
  channel: AiChannelKind
  title: string
  description: string
}[] = [
  { channel: 'text', title: '文本理解', description: '把一句话解析成时间、标题与地点' },
  { channel: 'vision', title: '视觉识别', description: '从通知截图或照片中读出日程' },
  { channel: 'asr', title: '语音转写', description: '把一段录音转成文字再解析' }
]

export default function AiSettingsDialog({
  onClose,
  closeToTray,
  onToggleCloseToTray
}: AiSettingsDialogProps): React.ReactElement {
  const view = useAiSettingsStore((state) => state.view)
  const draft = useAiSettingsStore((state) => state.draft)
  const catalog = useAiSettingsStore((state) => state.catalog)
  const loading = useAiSettingsStore((state) => state.loading)
  const saving = useAiSettingsStore((state) => state.saving)
  const dirty = useAiSettingsStore((state) => state.dirty)
  const issues = useAiSettingsStore((state) => state.issues)
  const saveError = useAiSettingsStore((state) => state.saveError)
  const testResults = useAiSettingsStore((state) => state.testResults)
  const testErrors = useAiSettingsStore((state) => state.testErrors)
  const testing = useAiSettingsStore((state) => state.testing)
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

  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (saving) return
      if (dirty) {
        setConfirmClose(true)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, saving, onClose])

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

  const globalIssues = issues.filter((issue) => issue.channel === undefined)

  return (
    <div className="modal-layer" onClick={requestClose}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="设置" onClick={(event) => event.stopPropagation()}>
        <header className="settings-head">
          <div>
            <span className="eyebrow">PREFERENCES</span>
            <h2>设置</h2>
            <p>AI 连接与桌面行为。AI 修改在保存后生效，桌面行为即时生效。</p>
          </div>
          <button type="button" className="icon-button" onClick={requestClose} aria-label="关闭设置" disabled={saving}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <section className="settings-behavior">
          <div>
            <span className="eyebrow">DESKTOP</span>
            <strong>关闭窗口时最小化到托盘</strong>
            <p>开启后关闭窗口不会退出应用，图标会留在右下角托盘；关闭开关后，关闭窗口会直接退出。</p>
          </div>
          <label className="switch">
            <input type="checkbox" checked={closeToTray} onChange={onToggleCloseToTray} />
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
            <span className="sr-only">关闭窗口时最小化到托盘</span>
          </label>
        </section>

        {loading && (
          <div className="settings-loading" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}

        {loadError && (
          <div className="banner banner-warn">
            <Icon name="alert" size={18} />
            <span>{translate('error.configReadFail')}</span>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void hydrate()}>
              重新读取
            </button>
          </div>
        )}

        {draft && (
          <>
            <section className={`settings-status ${(view?.status ?? 'local') === 'local' ? 'is-local' : 'is-online'}`}>
              <span className={`status-dot ${(view?.status ?? 'local') === 'local' ? 'is-local' : 'is-online'}`} aria-hidden="true" />
              <div>
                <strong>{aiStatusLabel(view?.status ?? 'local')}</strong>
                <p>
                  {(view?.status ?? 'local') === 'local'
                    ? '目前只使用本地规则解析文字；语音与图片需要接入 AI 服务。'
                    : '已接入 AI 服务，文本、语音和图片会按通道配置处理。'}
                </p>
              </div>
              <span className="settings-status-tag">{view?.catalogState === 'degraded' ? '预设降级' : '配置已读取'}</span>
            </section>

            {saveError && (
              <div className="banner banner-danger" role="alert">
                <Icon name="alert" size={18} />
                <span>{translate('error.configWriteFail')}</span>
              </div>
            )}

            {globalIssues.length > 0 && (
              <div className="banner banner-danger" role="alert">
                <Icon name="alert" size={18} />
                <span>{translate(globalIssues[0]?.messageKey ?? 'error.validationFailed')}</span>
              </div>
            )}

            <div className="channel-list">
              {CHANNELS.map((item) => {
                const binding = draft.bindings[item.channel]
                const keyDraft = draft.keyDrafts.find((entry) => entry.presetId === binding.presetId)
                return (
                  <ChannelBindingCard
                    key={item.channel}
                    channel={item.channel}
                    title={item.title}
                    description={item.description}
                    binding={binding}
                    bindingView={view?.channels[item.channel]}
                    keyDraft={keyDraft}
                    catalog={catalog}
                    issues={issues}
                    testResult={testResults[item.channel]}
                    testError={testErrors[item.channel]}
                    testing={testing[item.channel] === true}
                    disabled={saving}
                    onPickPreset={(presetId) => pickPreset(item.channel, presetId)}
                    onToggle={(enabled) => toggleChannel(item.channel, enabled)}
                    onMode={(mode) => changeMode(item.channel, mode)}
                    onOverride={(patch) => overrideBinding(item.channel, patch)}
                    onTest={() => void test(item.channel)}
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
              onClear={clearAll}
              onClose={requestClose}
            />
          </>
        )}

        {confirmClose && (
          <div className="confirm-layer" role="alertdialog">
            <div className="confirm-card">
              <span className="eyebrow">UNSAVED CHANGES</span>
              <h3>有未保存的更改</h3>
              <p>放弃后本次修改不会生效，已保存的连接保持不变。</p>
              <div className="confirm-actions">
                <button type="button" className="btn btn-quiet" onClick={() => setConfirmClose(false)}>
                  继续编辑
                </button>
                <button type="button" className="btn btn-danger" onClick={onClose}>
                  放弃更改
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}