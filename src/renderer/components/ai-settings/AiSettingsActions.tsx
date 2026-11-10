import React from 'react'
import { UI_TEXT } from '@shared/message-catalog'

interface AiSettingsActionsProps {
  readonly saving: boolean
  readonly dirty: boolean
  readonly onSave: () => void
  readonly onRestore: () => void
  readonly onClear: () => void
  readonly onClose: () => void
}

export default function AiSettingsActions({
  saving,
  dirty,
  onSave,
  onRestore,
  onClear,
  onClose
}: AiSettingsActionsProps): React.ReactElement {
  return (
    <footer className="ai-actions">
      <div className="ai-actions-left">
        <button type="button" className="ghost-button" onClick={onRestore} disabled={saving}>
          {UI_TEXT.aiRestoreRecommended}
        </button>
        <button type="button" className="danger-ghost" onClick={onClear} disabled={saving}>
          {UI_TEXT.aiClearConfig}
        </button>
      </div>
      <div className="ai-actions-right">
        <button type="button" className="ghost-button" onClick={onClose} disabled={saving}>
          {UI_TEXT.aiCancel}
        </button>
        <button type="button" className="primary-button" onClick={onSave} disabled={saving || !dirty}>
          {saving ? '保存中…' : UI_TEXT.aiSave}
        </button>
      </div>
    </footer>
  )
}