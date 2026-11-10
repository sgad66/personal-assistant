import React from 'react'
import type { DayColumn } from '@shared/domain/types'
import { formatDateShort, formatRange } from '@shared/time-kit'
import { UI_TEXT } from '@shared/message-catalog'

interface WeekGridProps {
  readonly days: readonly DayColumn[]
  readonly onSelect: (eventId: string) => void
}

export default function WeekGrid({ days, onSelect }: WeekGridProps): React.ReactElement {
  return (
    <div className="week-grid" role="grid" aria-label="周日程表">
      {days.map((day, index) => (
        <section key={day.date} className={`day-column ${day.isToday ? 'is-today' : ''}`} role="gridcell">
          <header className="day-header">
            <span className="day-name">{UI_TEXT.weekdays[index]}</span>
            <span className="day-date">{formatDateShort(day.date)}</span>
            {day.isToday && <span className="today-badge">今天</span>}
          </header>
          <div className="day-items">
            {day.items.length === 0 && <div className="day-empty">—</div>}
            {day.items.map((item) => (
              <button
                key={`${item.eventId}-${item.continuation}`}
                type="button"
                className={`event-card ${item.hasConflict ? 'has-conflict' : ''} ${
                  item.continuation === 'continues_from_prev' ? 'is-continuation' : ''
                }`}
                onClick={() => onSelect(item.eventId)}
                title={`${item.title} ${formatRange(item.startAt, item.endAt)}`}
              >
                <span className="event-time">
                  {item.continuation === 'continues_from_prev' ? '延续' : formatRange(item.startAt, item.endAt)}
                  {item.continuation === 'starts_here' ? ' →' : ''}
                </span>
                <span className="event-title">{item.title}</span>
                {item.location && <span className="event-location">{item.location}</span>}
                {item.hasConflict && <span className="conflict-badge">冲突</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}