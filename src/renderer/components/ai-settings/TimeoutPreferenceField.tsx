import React from 'react'
import type { AiChannelKind } from '@shared/ipc-contracts'
import { budgetFor } from '@shared/ai/timeout-policy'
import { channelLabelOf } from '@shared/ai/failure-text'
import { translate } from '@shared/message-catalog'
import { useAiSettingsStore } from '../../stores/ai-settings-store'

const CHANNELS: readonly AiChannelKind[] = ['text', 'vision', 'asr']

export default function TimeoutPreferenceField(): React.ReactElement {
  const draft = useAiSettingsStore((state) => state.draft)
  const saving = useAiSettingsStore((state) => state.saving)
  const toggleRelaxed = useAiSettingsStore((state) => state.toggleRelaxed)
  const relaxed = draft?.timeouts?.relaxed ?? false
  const reasoner =
    draft?.bindings.text.presetId === 'deepseek' && draft.bindings.text.model.includes('reasoner')

  return (
    <section className="timeout-field" aria-label="网络等待设置">
      <header className="timeout-field-head">
        <div>
          <strong>{translate('ai.timeout.relaxed')}</strong>
          <p>{translate('ai.timeout.relaxedHint')}</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={relaxed}
            disabled={saving || !draft}
            onChange={toggleRelaxed}
          />
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
          <span className="sr-only">{translate('ai.timeout.relaxed')}</span>
        </label>
      </header>

      <ul className="timeout-budget-list">
        {CHANNELS.map((channel) => {
          const budget = budgetFor(channel, { relaxed })
          return (
            <li key={channel}>
              <span>{channelLabelOf(channel)}</span>
              <span>
                首包 {Math.round(budget.firstByteMs / 1000)} 秒 / 整体 {Math.round(budget.overallMs / 1000)} 秒
              </span>
              <span className="muted">上限 {Math.round(budget.totalWaitMs / 1000)} 秒</span>
            </li>
          )
        })}
      </ul>

      {reasoner && <p className="channel-warning">{translate('ai.timeout.reasonerHint')}</p>}
    </section>
  )
}