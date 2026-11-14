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
import { deriveAvailability, type ChannelAvailability } from '@shared/ai/access-config'
import { findPreset, toPresetSummary, type PresetCatalog } from '@shared/ai/preset-catalog'
import { translate, UI_TEXT } from '@shared/message-catalog'
import Icon from '../Icon'
import ApiKeyField from './ApiKeyField'

interface ChannelBindingCardProps {
  readonly channel: AiChannelKind
  readonly title: string
  readonly description: string
  readonly binding: ChannelBindingInput
  readonly bindingView: ChannelBindingView | undefined
  readonly keyDraft: KeyDraft | undefined
  readonly catalog: PresetCatalog
  readonly issues: readonly ValidationIssue[]
  readonly testResult: AiConnectionTestResult | undefined
  readonly testError?: string
  readonly testing: boolean
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
    description,
    binding,
    bindingView,
    keyDraft,
    catalog,
    issues,
    testResult,
    testError,
    testing,
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
  const locked = disabled || !binding.enabled
  const presetSupports = entry !== undefined && (binding.presetId === 'custom' || entry.capabilities[channel] === 'supported')

  return (
    <article className={`channel-card ${binding.enabled ? 'is-enabled' : 'is-disabled'} ${isLocalText ? 'is-local' : ''}`}>
      <header className="channel-head">
        <span className={`channel-mark is-${channel}`} aria-hidden="true">
          <Icon name={channel === 'text' ? 'note' : channel === 'vision' ? 'image' : 'mic'} size={19} />
        </span>
        <div className="channel-title">
          <div className="channel-title-line">
            <h3>{title}</h3>
            <span className={`status-pill ${availabilityTone(availability)}`}>{availabilityText(availability)}</span>
          </div>
          <p>{description}</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={binding.enabled}
            disabled={disabled}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
          <span className="sr-only">启用{title}</span>
        </label>
      </header>

      {issue && (
        <div className="channel-error" role="alert">
          <Icon name="alert" size={14} />
          <span>{translate(issue.messageKey)}</span>
        </div>
      )}

      <div className={`channel-body ${!binding.enabled && !isLocalText ? 'is-locked' : ''}`}>
        {!isLocalText ? (
          <>
            <div className="channel-main">
              <label className="field">
                <span>服务商</span>
                <select
                  value={binding.presetId}
                  disabled={locked}
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
              <ApiKeyField
                key={binding.presetId}
                preset={entry ? toPresetSummary(entry) : undefined}
                keyDraft={keyDraft}
                disabled={locked}
                onChange={onKeyChange}
                onClear={onKeyClear}
              />
            </div>

            {entry?.freeTier && (
              <p className="channel-hint">
                <Icon name="spark" size={13} />
                {translate(entry.freeTier.summaryKey)}
              </p>
            )}

            {!presetSupports && binding.presetId !== 'custom' && (
              <p className="channel-warning">{UI_TEXT.aiUnsupported}</p>
            )}

            <details className="channel-advanced" open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
              <summary>
                <Icon name="settings" size={14} />
                端点与模型
                <span className="advanced-note">仅高级用户需要修改</span>
              </summary>
              <div className="field-grid">
                <label className="field">
                  <span>Endpoint</span>
                  <input
                    value={binding.endpoint}
                    disabled={locked}
                    onChange={(event) => onOverride({ endpoint: event.target.value })}
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>Model</span>
                  <input
                    value={binding.model}
                    disabled={locked}
                    onChange={(event) => onOverride({ model: event.target.value })}
                    spellCheck={false}
                  />
                </label>
              </div>
              <p className="channel-hint muted">{UI_TEXT.aiAdvancedHint}</p>
            </details>
          </>
        ) : (
          <div className="local-panel">
            <span className="local-mark" aria-hidden="true">
              <Icon name="today" size={18} />
            </span>
            <div>
              <strong>不需要网络，也不需要 Key</strong>
              <p>{UI_TEXT.aiLocalHint}。适合常见的“明天下午三点开会”这类表达。</p>
            </div>
          </div>
        )}
      </div>

      <footer className="channel-foot">
        {channel === 'text' ? (
          <div className="segmented" role="group" aria-label="文本解析方式">
            <button
              type="button"
              className={isLocalText ? 'is-active' : ''}
              disabled={disabled}
              onClick={() => onMode('local')}
            >
              本地解析
            </button>
            <button
              type="button"
              className={!isLocalText ? 'is-active' : ''}
              disabled={disabled}
              onClick={() => onMode('ai')}
            >
              AI 服务
            </button>
          </div>
        ) : (
          <span className="channel-foot-note">
            {bindingView ? `已保存：${availabilityText(bindingView.availability)}` : '尚未保存'}
            {bindingView?.keyMask ? ` · ${bindingView.keyMask}` : ''}
          </span>
        )}

        <div className="channel-foot-actions">
          {testResult && !testing && (
            <span className={`test-result ${testResult.resultStatus === 'success' ? 'is-ok' : 'is-fail'}`}>
              {testResult.resultStatus === 'success'
                ? '本地校验通过'
                : translate(testResult.error?.messageKey ?? 'error.aiUnavailable')}
            </span>
          )}
          {testError && !testing && <span className="test-result is-fail">{testError}</span>}
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={disabled || testing || isLocalText || !binding.enabled}
            onClick={onTest}
          >
            {testing ? '检查中…' : '检查配置'}
          </button>
        </div>
      </footer>
    </article>
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

function availabilityTone(availability: ChannelAvailability): string {
  if (availability === 'available') return 'is-ok'
  if (availability === 'disabled') return 'is-muted'
  return 'is-warn'
}