import React, { useEffect, useState } from 'react'
import type { ResolutionCommand } from '@shared/ipc-contracts'
import type { ConversationState, ParsePreview } from '@shared/domain/types'
import { formatDateLabel, formatRange } from '@shared/time-kit'
import { useAgentStore } from '../stores/agent-store'
import ImportContextBlock, { type ImportPanelContext } from './ImportContextBlock'
import Icon from './Icon'

interface ActionPanelProps {
  readonly conversationState: ConversationState
  readonly onResolve: (command: ResolutionCommand) => void
  readonly onReparse: () => void
  readonly importContext?: ImportPanelContext
}

export default function ActionPanel({
  conversationState,
  onResolve,
  onReparse,
  importContext
}: ActionPanelProps): React.ReactElement | null {
  const candidates = useAgentStore((state) => state.candidates)
  const conflicts = useAgentStore((state) => state.conflicts)
  const preview = useAgentStore((state) => state.parsePreview)
  const [selected, setSelected] = useState<number[]>([])

  useEffect(() => {
    if (candidates && candidates.length > 0) {
      setSelected(candidates.map((_item, index) => index))
    } else {
      setSelected([])
    }
  }, [candidates])

  if (conversationState === 'clarifying') {
    return (
      <section className="decision-card is-clarify">
        <div className="decision-head">
          <span className="decision-icon">
            <Icon name="note" size={18} />
          </span>
          <div>
            <h3>还差一点信息</h3>
            <p>请直接输入补充内容，我会把它合并到刚才这件事里。</p>
          </div>
        </div>
      </section>
    )
  }

  if (conversationState === 'confirming' && preview) {
    return (
      <section className="decision-card">
        <div className="decision-head">
          <span className="decision-icon">
            <Icon name="check" size={18} />
          </span>
          <div>
            <h3>我理解的是这样</h3>
            <p>确认后就会写入日程。</p>
          </div>
        </div>
        {importContext && <ImportContextBlock {...importContext} />}
        <PreviewBlock preview={preview} />
        <div className="decision-actions">
          <button type="button" className="btn btn-primary" onClick={() => onResolve({ kind: 'confirm_understanding' })}>
            确认安排
          </button>
          <button type="button" className="btn btn-ghost" onClick={onReparse}>
            重新描述
          </button>
        </div>
      </section>
    )
  }

  if (conversationState === 'candidate_select' && candidates && candidates.length > 0) {
    const allSelected = selected.length === candidates.length
    return (
      <section className="decision-card">
        <div className="decision-head">
          <span className="decision-icon">
            <Icon name="calendar" size={18} />
          </span>
          <div>
            <h3>识别到 {candidates.length} 项安排</h3>
            <p>勾选需要写入的条目，未勾选的会忽略。</p>
          </div>
        </div>
        {importContext && <ImportContextBlock {...importContext} />}
        <ul className="candidate-list">
          {candidates.map((candidate, index) => {
            const checked = selected.includes(index)
            return (
              <li key={`${candidate.title ?? 'candidate'}-${index}`}>
                <label className={`candidate-item ${checked ? 'is-checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, index]
                          : current.filter((item) => item !== index)
                      )
                    }}
                  />
                  <span className="candidate-check" aria-hidden="true">
                    {checked && <Icon name="check" size={13} />}
                  </span>
                  <span className="candidate-body">
                    <strong>{candidate.title ?? '未命名事项'}</strong>
                    <em>{describe(candidate)}</em>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        <div className="decision-actions">
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => setSelected(allSelected ? [] : candidates.map((_item, index) => index))}
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
          <span className="decision-spacer" />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onResolve({ kind: 'reject_candidates' })}
          >
            全部放弃
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.length === 0}
            onClick={() => {
              onResolve({ kind: 'confirm_candidates', selectedIndexes: selected })
              setSelected([])
            }}
          >
            写入 {selected.length} 项
          </button>
        </div>
      </section>
    )
  }

  if (conversationState === 'conflict' && conflicts && conflicts.length > 0) {
    return (
      <section className="decision-card is-conflict">
        <div className="decision-head">
          <span className="decision-icon">
            <Icon name="alert" size={18} />
          </span>
          <div>
            <h3>这个时间和已有安排重叠</h3>
            <p>可以换个时间，也可以仍然创建。</p>
          </div>
        </div>
        <ul className="conflict-list">
          {conflicts.map((conflict) => (
            <li key={conflict.eventId}>
              <strong>{conflict.title}</strong>
              <span>
                {formatDateLabel(conflict.startAt)} {formatRange(conflict.startAt, conflict.endAt)}
              </span>
            </li>
          ))}
        </ul>
        <div className="decision-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onResolve({ kind: 'conflict_decision', choice: 'reschedule' })}
          >
            改时间
          </button>
          <span className="decision-spacer" />
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => onResolve({ kind: 'conflict_decision', choice: 'abandon' })}
          >
            放弃
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onResolve({ kind: 'conflict_decision', choice: 'create_anyway' })}
          >
            仍然创建
          </button>
        </div>
      </section>
    )
  }

  if (conversationState === 'duplicate') {
    return (
      <section className="decision-card is-clarify">
        <div className="decision-head">
          <span className="decision-icon">
            <Icon name="repeat" size={18} />
          </span>
          <div>
            <h3>这件事已经存在</h3>
            <p>没有重复写入。如果要调整，可以直接告诉我新的时间。</p>
          </div>
        </div>
      </section>
    )
  }

  return null
}

function PreviewBlock({ preview }: { readonly preview: ParsePreview }): React.ReactElement {
  const startAt = preview.startAt
  return (
    <dl className="preview-block">
      <div>
        <dt>事项</dt>
        <dd>{preview.title ?? '未命名事项'}</dd>
      </div>
      <div>
        <dt>时间</dt>
        <dd>
          {startAt !== undefined
            ? `${formatDateLabel(startAt)} ${formatRange(startAt, preview.endAt)}`
            : '时间待定'}
        </dd>
      </div>
      {preview.location && (
        <div>
          <dt>地点</dt>
          <dd>{preview.location}</dd>
        </div>
      )}
      {preview.note && (
        <div>
          <dt>备注</dt>
          <dd>{preview.note}</dd>
        </div>
      )}
    </dl>
  )
}

function describe(preview: ParsePreview): string {
  const time =
    preview.startAt !== undefined
      ? `${formatDateLabel(preview.startAt)} ${formatRange(preview.startAt, preview.endAt)}`
      : '时间待定'
  return `${time}${preview.location ? ` · ${preview.location}` : ''}`
}