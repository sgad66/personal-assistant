import React from 'react'
import type { DayColumn } from '@shared/domain/types'
import { formatRange } from '@shared/time-kit'
import { weekdayShort } from '../ui-text'
import Icon from './Icon'

interface WeekGridProps {
  readonly days: readonly DayColumn[]
  readonly onSelect: (eventId: string) => void
  readonly onCreate: (date: number) => void
}

export default function WeekGrid({ days, onSelect, onCreate }: WeekGridProps): React.ReactElement {
  return (
    <div className="week-grid" aria-label="周日程表">
      {days.map((day) => (
        <section key={day.date} className={`day-column ${day.isToday ? 'is-today' : ''}`}>
          <header className="day-head">
            <div className="day-head-copy">
              <span className="day-name">{weekdayShort(day.date)}</span>
              <span className={`day-number ${day.isToday ? 'is-today' : ''}`}>{new Date(day.date).getDate()}</span>
            </div>
            <button
              type="button"
              className="day-add"
              onClick={() => onCreate(day.date)}
              aria-label={`在 ${day.date} 添加安排`}
              title="在这一天添加安排"
            >
              <Icon name="plus" size={14} />
            </button>
          </header>

          <div className="day-items">
            {day.items.length === 0 && (
              <button type="button" className="day-empty" onClick={() => onCreate(day.date)}>
                <span aria-hidden="true">
                  <Icon name="plus" size={14} />
                </span>
                空闲
              </button>
            )}
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
                {item.location && (
                  <span className="event-location">
                    <Icon name="pin" size={11} />
                    {item.location}
                  </span>
                )}
                {item.hasConflict && <span className="event-flag">时间重叠</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}