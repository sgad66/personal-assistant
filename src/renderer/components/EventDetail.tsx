import React from 'react'
import { UI_TEXT } from '@shared/message-catalog'
import { formatDateLabel, formatRange } from '@shared/time-kit'
import { useScheduleStore } from '../stores/schedule-store'

interface EventDetailProps {
  readonly onClose: () => void
}

export default function EventDetail({ onClose }: EventDetailProps): React.ReactElement | null {
  const detail = useScheduleStore((state) => state.detail)
  if (!detail) return null

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="detail-card" onClick={(event) => event.stopPropagation()}>
        <header className="detail-header">
          <h2>{UI_TEXT.detailTitle}</h2>
          <button type="button" className="ghost-button" onClick={onClose}>
            {UI_TEXT.close}
          </button>
        </header>
        <dl className="detail-list">
          <div>
            <dt>标题</dt>
            <dd>{detail.title}</dd>
          </div>
          <div>
            <dt>日期</dt>
            <dd>{formatDateLabel(detail.startAt)}</dd>
          </div>
          <div>
            <dt>时间</dt>
            <dd>{formatRange(detail.startAt, detail.endAt)}</dd>
          </div>
          <div>
            <dt>地点</dt>
            <dd>{detail.location ?? UI_TEXT.noData}</dd>
          </div>
          <div>
            <dt>备注</dt>
            <dd>{detail.note ?? UI_TEXT.noData}</dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>{modalityText(detail.sourceModality)}</dd>
          </div>
          <div>
            <dt>提醒状态</dt>
            <dd>{reminderText(detail.reminderStatus)}</dd>
          </div>
          <div>
            <dt>冲突</dt>
            <dd>{detail.hasConflict ? '与同时间段事项冲突' : '无冲突'}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

function modalityText(modality: string): string {
  if (modality === 'voice') return '语音'
  if (modality === 'image') return '图片'
  if (modality === 'composite') return '组合输入'
  return '文字'
}

function reminderText(status: string): string {
  if (status === 'reminded') return '已提醒'
  if (status === 'ignored') return '已忽略'
  return '未提醒'
}