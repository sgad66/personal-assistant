import React from 'react'
import type { AiAccessConfigView, PresetId, PresetSummary } from '@shared/ipc-contracts'
import { UI_TEXT } from '@shared/message-catalog'

interface PresetCatalogListProps {
  readonly presets: readonly PresetSummary[]
  readonly selected: PresetId
  readonly catalogState: 'ok' | 'degraded'
  readonly onSelect: (presetId: PresetId) => void
}

export default function PresetCatalogList({
  presets,
  selected,
  catalogState,
  onSelect
}: PresetCatalogListProps): React.ReactElement {
  return (
    <section className="ai-catalog" aria-label="可接入服务商">
      <div className="ai-section-head">
        <h3>可接入的服务商</h3>
        <span className="ai-hint">除自定义外均提供免费额度，额度以服务商政策为准</span>
      </div>

      {catalogState === 'degraded' && (
        <div className="ai-warning">预设列表加载异常，可继续使用自定义配置</div>
      )}

      <ul className="ai-preset-list">
        {presets.map((preset) => {
          const free = preset.badge === 'free_recommended' || preset.freeTier !== undefined
          return (
            <li key={preset.presetId}>
              <button
                type="button"
                className={`ai-preset-item ${selected === preset.presetId ? 'is-selected' : ''}`}
                onClick={() => onSelect(preset.presetId)}
              >
                <span className="ai-preset-name">
                  {preset.displayName}
                  {preset.badge === 'free_recommended' && <em className="ai-badge is-hot">免费推荐</em>}
                  {free && preset.badge !== 'free_recommended' && <em className="ai-badge">免费</em>}
                </span>
                <span className="ai-preset-caps">
                  <Capability active={preset.capabilities.text === 'supported'} label={UI_TEXT.aiTextChannel} />
                  <Capability active={preset.capabilities.vision === 'supported'} label={UI_TEXT.aiVisionChannel} />
                  <Capability active={preset.capabilities.asr === 'supported'} label={UI_TEXT.aiAsrChannel} />
                </span>
                <span className="ai-preset-endpoint">{preset.endpoint}</span>
                {preset.capabilities.asr !== 'supported' && (
                  <span className="ai-preset-note">不支持语音转写</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Capability({ active, label }: { readonly active: boolean; readonly label: string }): React.ReactElement {
  return (
    <span className={`ai-cap ${active ? 'is-on' : 'is-off'}`}>
      {active ? '●' : '○'} {label}
    </span>
  )
}

export function selectedPresetOf(
  presets: readonly PresetSummary[],
  presetId: PresetId
): PresetSummary | undefined {
  return presets.find((preset) => preset.presetId === presetId)
}

export function channelSummaryOf(view: AiAccessConfigView, channel: keyof AiAccessConfigView['channels']): string {
  return view.channels[channel].presetName
}