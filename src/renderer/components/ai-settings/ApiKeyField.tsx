import React, { useState } from 'react'
import type { KeyDraft } from '@shared/ai/draft'
import type { PresetSummary } from '@shared/ipc-contracts'
import { UI_TEXT } from '@shared/message-catalog'
import Icon from '../Icon'

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
  const [visible, setVisible] = useState(false)
  const hasStored = (keyDraft?.hasStoredKey ?? false) && !(keyDraft?.cleared ?? false)
  const willOverwrite = hasStored && value.length > 0

  return (
    <div className="key-field">
      <label className="field">
        <span>API Key</span>
        <div className="key-input">
          <input
            type={visible ? 'text' : 'password'}
            value={value}
            placeholder={hasStored ? UI_TEXT.aiKeyPlaceholder : preset ? `粘贴 ${preset.displayName} 的 Key` : '粘贴 API Key'}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            onChange={(event) => {
              setValue(event.target.value)
              onChange(event.target.value)
            }}
          />
          <button
            type="button"
            className="key-visibility"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? '隐藏 Key' : '显示 Key'}
            tabIndex={-1}
          >
            {visible ? '隐藏' : '显示'}
          </button>
        </div>
      </label>
      <div className="key-meta">
        {hasStored ? (
          <>
            <span>
              已保存 <code>{keyDraft?.storedMask}</code>
            </span>
            <button
              type="button"
              className="key-clear"
              disabled={disabled}
              onClick={() => {
                setValue('')
                onClear()
              }}
            >
              <Icon name="trash" size={13} />
              清除
            </button>
          </>
        ) : (
          <span className="muted">{keyDraft?.cleared ? '保存后将清除该 Key' : '密钥会加密保存在本机'}</span>
        )}
        {willOverwrite && <span className="key-warn">保存后将覆盖原 Key</span>}
      </div>
    </div>
  )
}