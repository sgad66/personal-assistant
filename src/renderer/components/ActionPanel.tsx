import React, { useState } from 'react'
import type { ResolutionCommand } from '@shared/ipc-contracts'
import type { ConversationState, ParsePreview } from '@shared/domain/types'
import { formatDateLabel, formatRange } from '@shared/time-kit'
import { useAgentStore } from '../stores/agent-store'

interface ActionPanelProps {
  readonly conversationState: ConversationState
  readonly onResolve: (command: ResolutionCommand) => void
  readonly onReparse: () => void
}

export default function ActionPanel({ conversationState, onResolve, onReparse }: ActionPanelProps): React.ReactElement | null {
  const candidates = useAgentStore((state) => state.candidates)
  const conflicts = useAgentStore((state) => state.conflicts)
  const preview = useAgentStore((state) => state.parsePreview)
  const [selected, setSelected] = useState<number[]>([])

  if (conversationState === 'clarifying') {
    return (
      <div className="action-panel">
        <span className="panel-hint">请直接输入补充信息，我会合并到上一条安排里。</span>
      </div>
    )
  }

  if (conversationState === 'confirming' && preview) {
    return (
      <div className="action-panel">
        <div className="panel-title">我理解的是：{describe(preview)}</div>
        <div className="panel-actions">
          <button type="button" className="primary-button" onClick={() => onResolve({ kind: 'confirm_understanding' })}>
            确认
          </button>
          <button type="button" className="ghost-button" onClick={onReparse}>
            重新描述
          </button>
        </div>
      </div>
    )
  }

  if (conversationState === 'candidate_select' && candidates && candidates.length > 0) {
    return (
      <div className="action-panel">
        <div className="panel-title">请勾选要写入的安排</div>
        <ul className="candidate-list">
          {candidates.map((candidate, index) => (
            <li key={`${candidate.title ?? 'candidate'}-${index}`}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(index)}
                  onChange={(event) => {
                    setSelected((current) =>
                      event.target.checked ? [...current, index] : current.filter((item) => item !== index)
                    )
                  }}
                />
                <span>{describe(candidate)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="panel-actions">
          <button
            type="button"
            className="primary-button"
            disabled={selected.length === 0}
            onClick={() => {
              onResolve({ kind: 'confirm_candidates', selectedIndexes: selected })
              setSelected([])
            }}
          >
            写入选中项
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              onResolve({ kind: 'reject_candidates' })
              setSelected([])
            }}
          >
            全部放弃
          </button>
        </div>
      </div>
    )
  }

  if (conversationState === 'conflict' && conflicts) {
    return (
      <div className="action-panel conflict-panel">
        <div className="panel-title">
          ⚠ 与已有事项《{conflicts[0]?.title ?? '已有安排'}》时间冲突
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => onResolve({ kind: 'conflict_decision', choice: 'reschedule' })}
          >
            改时间
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onResolve({ kind: 'conflict_decision', choice: 'create_anyway' })}
          >
            仍然创建
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={() => onResolve({ kind: 'conflict_decision', choice: 'abandon' })}
          >
            放弃
          </button>
        </div>
      </div>
    )
  }

  if (conversationState === 'duplicate') {
    return (
      <div className="action-panel">
        <span className="panel-hint">该事项已存在，本次未重复写入。</span>
      </div>
    )
  }

  return null
}

function describe(preview: ParsePreview): string {
  const time =
    preview.startAt !== undefined
      ? `${formatDateLabel(preview.startAt)} ${formatRange(preview.startAt, preview.endAt)}`
      : '时间待定'
  return `${preview.title ?? '这件事'}，${time}${preview.location ? `，地点：${preview.location}` : ''}`
}