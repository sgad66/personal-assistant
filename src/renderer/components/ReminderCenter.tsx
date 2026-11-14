import React from 'react'
import { translate } from '@shared/message-catalog'
import { formatDateLabel, formatTime } from '@shared/time-kit'
import { useReminderStore } from '../stores/reminder-store'
import Icon from './Icon'

export default function ReminderCenter(): React.ReactElement | null {
  const queue = useReminderStore((state) => state.queue)
  const error = useReminderStore((state) => state.error)
  const respond = useReminderStore((state) => state.respond)
  const clearError = useReminderStore((state) => state.clearError)
  const current = queue[0]

  if (!current) {
    return error ? (
      <div className="reminder-error" role="alert">
        <Icon name="alert" size={16} />
        <span>{error}</span>
        <button type="button" onClick={clearError} aria-label="关闭">
          <Icon name="close" size={14} />
        </button>
      </div>
    ) : null
  }

  return (
    <div className="reminder-dock" role="alertdialog" aria-live="assertive" aria-label="日程提醒">
      <div className="reminder-card">
        <div className="reminder-head">
          <span className="reminder-pulse" aria-hidden="true" />
          <span className="eyebrow">UP NEXT</span>
          {queue.length > 1 && <span className="reminder-queue">1 / {queue.length}</span>}
        </div>
        <h3>{current.title}</h3>
        <p className="reminder-time">
          <Icon name="clock" size={15} />
          {formatDateLabel(current.startAt)} {formatTime(current.startAt)}
          <span>·</span>
          {translate('reminder.remaining', { minutes: current.remainingMinutes })}
        </p>
        <div className="reminder-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void respond('acknowledge')}>
            知道了
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void respond('snooze')}>
            5 分钟后再提醒
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void respond('ignore')}>
            忽略
          </button>
        </div>
        {error && <p className="reminder-inline-error">{error}</p>}
      </div>
    </div>
  )
}