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
import {
  capabilityTagsOf,
  defaultModelFor,
  findPreset,
  orderedPresets,
  toPresetSummary,
  type CapabilityLevel,
  type PresetCatalog,
  type PresetCatalogEntry
} from '@shared/ai/preset-catalog'
import { detectEndpointRisk } from '@shared/ai/endpoint-guard'
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
  const tags = entry ? capabilityTagsOf(entry) : []
  const notice = sourceNoticeOf(bindingView)
  const endpointRisk = detectEndpointRisk({
    channel,
    presetId: binding.presetId,
    endpoint: binding.endpoint
  })
  const reasonerModel = binding.presetId === 'deepseek' && binding.model.includes('reasoner')

  return (
    <article className={`channel-card ${binding.enabled ? 'is-enabled' : 'is-disabled'} ${isLocalText ? 'is-local' : ''}`}>
      <header className="channel-head">
        <span className={`channel-mark is-${channel}`} aria-hidden="true">
          <Icon name={channel === 'text' ? 'note' : channel === 'vision' ? 'image' : 'mic'} size={19} />
        </span>
        <div className="channel-title">
          <div className="channel-title-line">
            <h3>{title}</h3>
            {binding.source === 'custom_override' && binding.presetId !== 'custom' && (
              <span className="preset-tag is-neutral">{UI_TEXT.aiCustomOverrideBadge}</span>
            )}
            {tags.includes('official_api') && (
              <span className="preset-tag">{UI_TEXT.aiOfficialApiBadge}</span>
            )}
            {tags.includes('text_only') && (
              <span className="preset-tag is-neutral">{UI_TEXT.aiTextOnlyBadge}</span>
            )}
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

      {notice && (
        <div className="channel-source" role="note">
          <Icon name="alert" size={14} />
          <span>{translate(notice.noteKey)}</span>
          {notice.servingLabel && (
            <span className="source-detail">
              预设：{bindingView?.presetName ?? '—'} / 实际：{notice.servingLabel}
            </span>
          )}
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
                  {orderedPresets(catalog).map((item) => (
                    <option key={item.presetId} value={item.presetId}>
                      {presetOptionLabel(item, channel)}
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

            {entry && binding.presetId !== 'custom' && (
              <div className="capability-matrix" aria-label="能力对照">
                <CapabilityRow channel="text" level={entry.capabilities.text} />
                <CapabilityRow channel="vision" level={entry.capabilities.vision} reasonKey="ai.gap.deepseekVision" />
                <CapabilityRow channel="asr" level={entry.capabilities.asr} reasonKey="ai.gap.deepseekAsr" />
              </div>
            )}

            {entry?.freeTier && (
              <p className="channel-hint">
                <Icon name="spark" size={13} />
                {translate(entry.freeTier.summaryKey)}
              </p>
            )}

            {!presetSupports && binding.presetId !== 'custom' && (
              <p className="channel-warning">{translate(reasonForChannel(channel))}</p>
            )}

            {endpointRisk && (
              <p className="channel-warning">{translate('ai.fail.endpointConfirm')}（仅提示，不会自动修改）</p>
            )}

            {reasonerModel && <p className="channel-warning">{translate('ai.timeout.reasonerHint')}</p>}

            <p className="channel-hint muted">{translate('ai.disclaimer')}</p>

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
              <p className="channel-hint muted">
                {binding.presetId === 'deepseek'
                  ? translate('aiAdvancedHint.deepseek')
                  : UI_TEXT.aiAdvancedHint}
              </p>
              {binding.presetId === 'deepseek' && defaultModelFor(entry as PresetCatalogEntry, channel) && (
                <p className="channel-hint muted">默认模型：{defaultModelFor(entry as PresetCatalogEntry, channel)}</p>
              )}
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
                ? UI_TEXT.localOnlyVerified
                : translate(testResult.error?.messageKey ?? 'error.aiUnavailable')}
            </span>
          )}
          {!testing && <span className="test-local-hint">{translate('ai.test.localOnly')}</span>}
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

function CapabilityRow({
  channel,
  level,
  reasonKey
}: {
  readonly channel: AiChannelKind
  readonly level: CapabilityLevel
  readonly reasonKey?: string
}): React.ReactElement {
  const labels: Record<AiChannelKind, { ok: string; no: string }> = {
    text: { ok: UI_TEXT.aiCapabilityTextOk, no: UI_TEXT.aiCapabilityTextNo },
    vision: { ok: UI_TEXT.aiCapabilityVisionOk, no: UI_TEXT.aiCapabilityVisionNo },
    asr: { ok: UI_TEXT.aiCapabilityAsrOk, no: UI_TEXT.aiCapabilityAsrNo }
  }
  const supported = level === 'supported'
  return (
    <div className={`capability-row ${supported ? 'is-ok' : 'is-warn'}`}>
      <span className={`capability-dot ${supported ? 'is-ok' : 'is-warn'}`} aria-hidden="true" />
      <span>{supported ? labels[channel].ok : labels[channel].no}</span>
      {!supported && reasonKey && <span className="capability-reason">{translate(reasonKey)}</span>}
    </div>
  )
}

function presetOptionLabel(entry: PresetCatalogEntry, channel: AiChannelKind): string {
  const tags = capabilityTagsOf(entry)
  const suffix: string[] = []
  if (tags.includes('text_only')) suffix.push(UI_TEXT.aiTextOnlyBadge)
  if (tags.includes('official_api')) suffix.push(UI_TEXT.aiOfficialApiBadge)
  if (entry.capabilities[channel] !== 'supported') suffix.push('不支持该能力')
  return suffix.length > 0 ? `${entry.displayName}（${suffix.join(' · ')}）` : entry.displayName
}

function reasonForChannel(channel: AiChannelKind): string {
  if (channel === 'vision') return 'ai.gap.deepseekVision'
  if (channel === 'asr') return 'ai.gap.deepseekAsr'
  return 'error.aiModelUnsupported'
}

function sourceNoticeOf(
  bindingView: ChannelBindingView | undefined
): { noteKey: string; servingLabel?: string } | undefined {
  if (!bindingView?.sourceNoteKey) return undefined
  return {
    noteKey: bindingView.sourceNoteKey,
    ...(bindingView.servingLabel && bindingView.sourceMatchesBinding === false
      ? { servingLabel: bindingView.servingLabel }
      : {})
  }
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