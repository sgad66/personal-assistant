import React from 'react'
import type { PresetSummary } from '@shared/ipc-contracts'
import { translate } from '@shared/message-catalog'

interface FreeTierPanelProps {
  readonly preset: PresetSummary | undefined
}

export default function FreeTierPanel({ preset }: FreeTierPanelProps): React.ReactElement {
  const summaryKey = preset?.freeTier?.summaryKey
  const text = summaryKey ? translate(summaryKey) : '自定义服务是否免费取决于你使用的服务商。'
  return (
    <section className="ai-free-panel" aria-label="免费额度说明">
      <h4>免费额度说明</h4>
      <p>{text}</p>
      <p className="ai-hint">{translate('ai.disclaimer')}</p>
    </section>
  )
}