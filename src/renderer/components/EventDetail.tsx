import React, { useEffect, useRef, useState } from 'react'
import { formatDateLabel, formatRange } from '@shared/time-kit'
import { useScheduleStore } from '../stores/schedule-store'
import { useNavigationStore } from '../stores/navigation-store'
import { useAgentStore } from '../stores/agent-store'
import { formatDuration } from '../schedule-insights'
import Icon from './Icon'

interface EventDetailProps {
  readonly onClose: () => void
}

export default function EventDetail({ onClose }: EventDetailProps): React.ReactElement | null {
  const detail = useScheduleStore((state) => state.detail)
  const navigate = useNavigationStore((state) => state.navigate)
  const setSeedPrompt = useAgentStore((state) => state.setSeedPrompt)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [onClose])

  useEffect(() => {
    if (copied === 'idle') return
    const timer = window.setTimeout(() => setCopied('idle'), 2_000)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!detail) return null

  const adjust = (): void => {
    setSeedPrompt(`把《${detail.title}》调整为 `)
    navigate('agent')
    onClose()
  }

  const copy = async (): Promise<void> => {
    const lines = [
      detail.title,
      `${formatDateLabel(detail.startAt)} ${formatRange(detail.startAt, detail.endAt)}`,
      detail.location ? `地点：${detail.location}` : '',
      detail.note ? `备注：${detail.note}` : ''
    ].filter((line) => line.length > 0)
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
  }

  return (
    <div className="drawer-layer" onClick={onClose}>
      <aside
        className="event-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="事项详情"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <span className="eyebrow">EVENT</span>
          <button type="button" className="icon-button" ref={closeButtonRef} onClick={onClose} aria-label="关闭详情">
            <Icon name="close" size={18} />
          </button>
        </header>

        <h2 className="drawer-title">{detail.title}</h2>

        <div className="drawer-time">
          <span className="drawer-date">{formatDateLabel(detail.startAt)}</span>
          <span className="drawer-range">{formatRange(detail.startAt, detail.endAt)}</span>
          <span className="drawer-duration">{formatDuration(detail.endAt - detail.startAt)}</span>
        </div>

        <div className="drawer-chips">
          <span className={`chip ${detail.hasConflict ? 'is-warn' : 'is-ok'}`}>
            {detail.hasConflict ? '时间重叠' : '无冲突'}
          </span>
          <span className="chip">{reminderText(detail.reminderStatus)}</span>
          <span className="chip">{modalityText(detail.sourceModality)}</span>
          {detail.importSourceLabel && (
            <span className="chip" title={detail.importSourceLabel}>
              {detail.importSourceLabel}
            </span>
          )}
        </div>

        <dl className="drawer-fields">
          <div>
            <dt>
              <Icon name="pin" size={15} />
              地点
            </dt>
            <dd>{detail.location ?? '未填写'}</dd>
          </div>
          <div>
            <dt>
              <Icon name="note" size={15} />
              备注
            </dt>
            <dd>{detail.note ?? '未填写'}</dd>
          </div>
          <div>
            <dt>
              <Icon name="clock" size={15} />
              记录时间
            </dt>
            <dd>{formatDateLabel(detail.createdAt)} 创建</dd>
          </div>
          <div>
            <dt>
              <Icon name="refresh" size={15} />
              最近更新
            </dt>
            <dd>{formatDateLabel(detail.updatedAt)}</dd>
          </div>
        </dl>

        <footer className="drawer-actions">
          <button type="button" className={`btn btn-ghost ${copied === 'fail' ? 'is-danger-text' : ''}`} onClick={() => void copy()}>
            <Icon name={copied === 'ok' ? 'check' : 'note'} size={15} />
            {copied === 'ok' ? '已复制' : copied === 'fail' ? '复制失败' : '复制日程文本'}
          </button>
          <button type="button" className="btn btn-primary" onClick={adjust}>
            <Icon name="spark" size={16} />
            让智能体调整
          </button>
        </footer>
      </aside>
    </div>
  )
}

function modalityText(modality: string): string {
  if (modality === 'voice') return '语音录入'
  if (modality === 'image') return '图片识别'
  if (modality === 'composite') return '组合输入'
  return '文字录入'
}

function reminderText(status: string): string {
  if (status === 'reminded') return '已提醒'
  if (status === 'ignored') return '已忽略提醒'
  return '等待提醒'
}