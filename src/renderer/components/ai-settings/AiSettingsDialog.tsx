import React, { useEffect, useState } from 'react'
import { translate } from '@shared/message-catalog'
import { useAiSettingsStore } from '../../stores/ai-settings-store'
import Icon from '../Icon'

interface AiSettingsDialogProps {
  readonly onClose: () => void
  readonly closeToTray: boolean
  readonly onToggleCloseToTray: () => void
}

export default function AiSettingsDialog({
  onClose,
  closeToTray,
  onToggleCloseToTray
}: AiSettingsDialogProps): React.ReactElement {
  const { draft, loading, saving, dirty, issues, saveError, loadError, hydrate,
    pickPreset, changeMode, setKey, save } = useAiSettingsStore()
  const online = draft?.bindings.text.mode === 'ai'
  const key = draft?.keyDrafts.find(item => item.presetId === 'deepseek')
  function selectMode(mode: 'local' | 'ai') {
    pickPreset('text', 'deepseek')
    changeMode('text', mode)
  }
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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

  return (
    <div className="modal-layer" onClick={requestClose}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="设置" onClick={(event) => event.stopPropagation()}>
        <header className="settings-head">
          <h2>设置</h2>
          <button type="button" className="icon-button" onClick={requestClose} aria-label="关闭设置" disabled={saving}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="settings-body">
          {loading && !draft && (
            <div className="settings-loading" aria-label="正在读取设置"><span /></div>
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
            <fieldset className="settings-modes" disabled={saving}>
              <legend>对话解析模式</legend>
              <div className="settings-options">
                <label className="settings-option">
                  <input type="radio" name="mode" checked={!online} onChange={() => selectMode('local')} />
                  <span><strong>本地解析</strong><small>离线提取日程，无需密钥</small></span>
                </label>
                <label className="settings-option">
                  <input type="radio" name="mode" checked={online} onChange={() => selectMode('ai')} />
                  <span><strong>DeepSeek API</strong><small>使用自己的密钥联网回答</small></span>
                </label>
              </div>
              {online && (
                <div className="settings-connection">
                  <label className="field">
                    <span>DeepSeek API Key</span>
                    <input type="password" autoComplete="off" value={key?.secret ?? ''}
                      placeholder={key?.hasStoredKey ? '已保存密钥，输入可替换' : '输入 DeepSeek API Key'}
                      onChange={event => setKey('deepseek', event.target.value)} />
                  </label>
                  <p>文字和识别结果会发送至 DeepSeek，费用按你的 API 账户计费。</p>
                </div>
              )}
              <p className="settings-media-note">图片文字由 PP-OCRv4 识别，录音由 SenseVoiceSmall 转写，两者均在本机免费运行。</p>
              {(issues.length > 0 || saveError) && (
                <p className="banner banner-danger" role="alert">{translate(issues[0]?.messageKey ?? 'error.configWriteFail')}</p>
              )}
            </fieldset>
          )}

          <section className="settings-behavior">
            <div>
              <strong>关闭窗口时最小化到托盘</strong>
              <p>开启后应用会在后台运行。此设置立即生效。</p>
            </div>
            <label className="switch">
              <input type="checkbox" checked={closeToTray} onChange={onToggleCloseToTray} />
              <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
              <span className="sr-only">关闭窗口时最小化到托盘</span>
            </label>
          </section>
        </div>

        <footer className="settings-footer">
          <button type="button" className="btn btn-quiet" onClick={requestClose} disabled={saving}>关闭</button>
          <button type="button" className="btn btn-primary" disabled={!draft || !dirty || saving} onClick={() => void doSave()}>保存</button>
        </footer>

        {confirmClose && (
          <div className="confirm-layer" role="alertdialog">
            <div className="confirm-card">
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