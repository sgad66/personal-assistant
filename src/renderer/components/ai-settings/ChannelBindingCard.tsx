import React, { useState } from 'react'
import type {
  AiChannelKind,
  AiConnectionTestResult,
  ChannelBindingView,
  PresetId,
  ValidationIssue
} from '@shared/ipc-contracts'
import type { KeyDraft } from '@shared/ai/draft'
import type { ChannelBindingInput } from '@shared/ipc-contracts'
import {
  deriveAvailability,
  type ChannelAvailability
} from '@shared/ai/access-config'
import { findPreset, toPresetSummary, type PresetCatalog } from '@shared/ai/preset-catalog'
import { UI_TEXT } from '@shared/message-catalog'
import ApiKeyField from './ApiKeyField'

interface ChannelBindingCardProps {
  readonly channel: AiChannelKind
  readonly title: string
  readonly binding: ChannelBindingInput
  readonly bindingView: ChannelBindingView | undefined
  readonly keyDraft: KeyDraft | undefined
  readonly catalog: PresetCatalog
  readonly issues: readonly ValidationIssue[]
  readonly testResult: AiConnectionTestResult | undefined
  readonly disabled?: boolean
  readonly onPickPreset: (presetId: PresetId) => void
  readonly onToggle: (enabled: boolean) => void
  readonly onMode: (mode: 'ai' | 'local') => void
  readonly onOverride: (patch: Partial<Pick<ChannelBindingInput, 'endpoint' | 'model'>>) => void
  readonly onTest: () => void
  readonly onKeyChange: (secret: string) => void
  readonly onKeyClear: () => void
}

export default function ChannelBindingCard(props: ChannelBindingCardProps): React.ReactElement {
  const {
    channel,
    title,
    binding,
    bindingView,
    keyDraft,
    catalog,
    issues,
    testResult,
    disabled,
    onPickPreset,
    onToggle,
    onMode,
    onOverride,
    onTest,
    onKeyChange,
    onKeyClear
  } = props
  const [advanced, setAdvanced] = useState(false)
  const entry = findPreset(binding.presetId, catalog)
  const hasKey =
    keyDraft !== undefined &&
    !keyDraft.cleared &&
    ((keyDraft.secret !== undefined && keyDraft.secret.length > 0) || keyDraft.hasStoredKey)
  const availability = deriveAvailability(
    { ...binding, channel },
    entry,
    hasKey,
    new Map(catalog.entries.map((item) => [item.presetId, item]))
  )
  const issue = issues.find((item) => item.channel === channel)
  const isLocalText = channel === 'text' && binding.mode === 'local'
  const presetSupports = entry !== undefined && (binding.presetId === 'custom' || entry.capabilities[channel] === 'supported')

  return (
    <section className={`ai-channel-card ${availability === 'available' ? 'is-available' : ''}`}>
      <header className="ai-channel-head">
        <div>
          <h3>{title}</h3>
          <span className={`ai-status-badge ${badgeTone(availability)}`}>{availabilityText(availability)}</span>
        </div>
        <label className="ai-switch">
          <input
            type="checkbox"
            checked={binding.enabled}
            disabled={disabled}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span>启用</span>
        </label>
      </header>

      {issue && (
        <div className="ai-field-error" role="alert">
          {issue.messageKey}
        </div>
      )}

      <div className="ai-channel-row">
        <label className="field">
          <span>服务商</span>
          <select
            value={binding.presetId}
            disabled={disabled}
            onChange={(event) => onPickPreset(event.target.value as PresetId)}
          >
            {catalog.entries.map((item) => (
              <option key={item.presetId} value={item.presetId}>
                {item.displayName}
                {item.capabilities[channel] === 'supported' ? '' : '（不支持该能力）'}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>端点</span>
          <input
            value={binding.endpoint}
            readOnly={!advanced}
            disabled={disabled}
            onChange={(event) => onOverride({ endpoint: event.target.value })}
          />
        </label>

        <label className="field">
          <span>模型</span>
          <input
            value={binding.model}
            readOnly={!advanced}
            disabled={disabled}
            onChange={(event) => onOverride({ model: event.target.value })}
          />
        </label>
      </div>

      <div className="ai-channel-actions">
        <button
          type="button"
          className="ghost-button"
          disabled={disabled}
          onClick={() => setAdvanced((value) => !value)}
        >
          {advanced ? '收起高级编辑' : UI_TEXT.aiAdvancedEdit}
        </button>
        <button type="button" className="ghost-button" disabled={disabled || isLocalText} onClick={onTest}>
          {UI_TEXT.aiTestConnection}
        </button>
        {channel === 'text' && (
          <label className="ai-mode">
            <input
              type="checkbox"
              checked={binding.mode === 'local'}
              disabled={disabled}
              onChange={(event) => onMode(event.target.checked ? 'local' : 'ai')}
            />
            <span>{UI_TEXT.aiLocalParsing}</span>
          </label>
        )}
      </div>

      {advanced && binding.source === 'custom_override' && !isLocalText && (
        <p className="ai-warning-inline">{UI_TEXT.aiAdvancedHint}</p>
      )}
      {!presetSupports && binding.presetId !== 'custom' && (
        <p className="ai-warning-inline">{UI_TEXT.aiUnsupported}</p>
      )}
      {isLocalText && <p className="ai-hint">{UI_TEXT.aiLocalHint}</p>}

      {!isLocalText && binding.enabled && (
        <ApiKeyField
          preset={entry ? toPresetSummary(entry) : undefined}
          keyDraft={keyDraft}
          disabled={disabled}
          onChange={onKeyChange}
          onClear={onKeyClear}
        />
      )}

      {testResult && (
        <div className={`ai-test-result ${testResult.resultStatus === 'success' ? 'is-ok' : 'is-fail'}`}>
          {testResult.resultStatus === 'success'
            ? '配置检查通过'
            : `配置检查失败：${testResult.error?.code ?? ''}`}
        </div>
      )}

      {bindingView && (
        <p className="ai-hint">
          已保存状态：{availabilityText(bindingView.availability)}
          {bindingView.keyMask ? ` · Key ${bindingView.keyMask}` : ''}
        </p>
      )}
    </section>
  )
}

function availabilityText(availability: ChannelAvailability): string {
  switch (availability) {
    case 'available':
      return UI_TEXT.aiAvailable
    case 'unsupported':
      return UI_TEXT.aiUnsupported
    case 'missing_key':
      return UI_TEXT.aiNotConfigured
    case 'invalid_endpoint':
      return '端点无效'
    default:
      return UI_TEXT.aiDisabled
  }
}

function badgeTone(availability: ChannelAvailability): string {
  if (availability === 'available') return 'is-ok'
  if (availability === 'disabled') return 'is-muted'
  return 'is-warn'
}
