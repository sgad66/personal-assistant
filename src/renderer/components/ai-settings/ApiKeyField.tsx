import React, { useState } from 'react'
import type { KeyDraft } from '@shared/ai/draft'
import type { PresetSummary } from '@shared/ipc-contracts'
import { UI_TEXT } from '@shared/message-catalog'

interface ApiKeyFieldProps {
  readonly preset: PresetSummary | undefined
  readonly keyDraft: KeyDraft | undefined
  readonly disabled?: boolean
  readonly onChange: (secret: string) => void
  readonly onClear: () => void
}

export default function ApiKeyField({
  preset,
  keyDraft,
  disabled,
  onChange,
  onClear
}: ApiKeyFieldProps): React.ReactElement {
  const [value, setValue] = useState('')
  const hasStored = (keyDraft?.hasStoredKey ?? false) && !(keyDraft?.cleared ?? false)
  return (
    <div className="ai-key-field">
      <label>
        <span>API Key</span>
        <input
          type="password"
          value={value}
          placeholder={hasStored ? UI_TEXT.aiKeyPlaceholder : '粘贴服务商提供的 API Key'}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => {
            setValue(event.target.value)
            onChange(event.target.value)
          }}
        />
      </label>
      <div className="ai-key-meta">
        {hasStored ? (
          <>
            <span>
              {UI_TEXT.aiKeySavedPrefix}
              <code>{keyDraft?.storedMask}</code>
            </span>
            <button type="button" className="danger-ghost" onClick={onClear} disabled={disabled}>
              {UI_TEXT.aiKeyClear}
            </button>
          </>
        ) : (
          <span className="ai-hint">{preset ? `需要 ${preset.displayName} 的 API Key` : ''}</span>
        )}
        {keyDraft?.cleared && <span className="ai-warning-inline">保存后将清除该 Key</span>}
      </div>
    </div>
  )
}