import React, { useState } from 'react'
import { UI_TEXT } from '@shared/message-catalog'
import Icon from '../Icon'

interface AiSettingsActionsProps {
  readonly saving: boolean
  readonly dirty: boolean
  readonly onSave: () => void
  readonly onRestore: () => void
  readonly onRestoreDefault: () => void
  readonly onClear: () => void
  readonly onClose: () => void
}

export default function AiSettingsActions({
  saving,
  dirty,
  onSave,
  onRestore,
  onRestoreDefault,
  onClear,
  onClose
}: AiSettingsActionsProps): React.ReactElement {
  const [confirmClear, setConfirmClear] = useState(false)

  return (
    <footer className="settings-actions">
      <div className="settings-actions-left">
        <button type="button" className="btn btn-quiet btn-sm" onClick={onRestore} disabled={saving}>
          {UI_TEXT.aiUseGroqFree}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onRestoreDefault} disabled={saving}>
          {UI_TEXT.aiRestoreDefaultSolution}
        </button>
        <button type="button" className="btn btn-quiet btn-sm is-danger-text" onClick={() => setConfirmClear(true)} disabled={saving}>
          {UI_TEXT.aiClearConfig}
        </button>
      </div>
      <div className="settings-actions-right">
        <span className={`save-state ${dirty ? 'is-dirty' : ''}`}>{dirty ? '有未保存的更改' : '已同步'}</span>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
          {UI_TEXT.aiCancel}
        </button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving || !dirty}>
          {saving ? '保存中…' : UI_TEXT.aiSave}
        </button>
      </div>

      {confirmClear && (
        <div className="inline-confirm" role="alertdialog">
          <div>
            <strong>清除所有连接配置？</strong>
            <p>会恢复为本地解析，并清除已保存的 API Key。需要点击“保存”才会生效。</p>
          </div>
          <div className="inline-confirm-actions">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirmClear(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                onClear()
                setConfirmClear(false)
              }}
            >
              <Icon name="trash" size={14} />
              清除
            </button>
          </div>
        </div>
      )}
    </footer>
  )
}