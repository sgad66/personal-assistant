import React from 'react'
import { UI_TEXT, translate } from '@shared/message-catalog'
import { formatDateLabel, formatTime } from '@shared/time-kit'
import { useReminderStore } from '../stores/reminder-store'

export default function ReminderCenter(): React.ReactElement | null {
  const current = useReminderStore((state) => state.queue[0])
  const error = useReminderStore((state) => state.error)
  const respond = useReminderStore((state) => state.respond)
  const clearError = useReminderStore((state) => state.clearError)

  if (!current) {
    return error ? (
      <div className="reminder-error" role="alert">
        {error}
        <button type="button" onClick={clearError}>
          ×
        </button>
      </div>
    ) : null
  }

  return (
    <div className="reminder-dock" role="alertdialog" aria-live="assertive">
      <div className="reminder-card">
        <div className="reminder-head">
          <span className="reminder-pulse" />
          <span>{UI_TEXT.reminderTitle}</span>
          <span className="reminder-remaining">
            {translate('reminder.remaining', { minutes: current.remainingMinutes })}
          </span>
        </div>
        <h3>{current.title}</h3>
        <p className="reminder-time">
          {formatDateLabel(current.startAt)} {formatTime(current.startAt)}
        </p>
        <div className="reminder-actions">
          <button type="button" className="primary-button" onClick={() => void respond('acknowledge')}>
            {UI_TEXT.acknowledge}
          </button>
          <button type="button" className="ghost-button" onClick={() => void respond('snooze')}>
            {UI_TEXT.snooze}
          </button>
          <button type="button" className="danger-ghost" onClick={() => void respond('ignore')}>
            {UI_TEXT.ignore}
          </button>
        </div>
      </div>
      {error && <div className="reminder-inline-error">{error}</div>}
    </div>
  )
}