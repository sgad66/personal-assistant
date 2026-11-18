import React from 'react'
import type { DayColumn, WeekItem } from '@shared/domain/types'
import { formatRange, startOfDay } from '@shared/time-kit'
import { busyMinutesOf } from '../schedule-insights'
import { weekdayShort } from '../ui-text'
import Icon from './Icon'

interface WeekOverviewProps {
  readonly days: readonly DayColumn[]
  readonly onSelect: (eventId: string) => void
  readonly onCreate: (date: number) => void
  readonly highlightEventId?: string
}

export default function WeekOverview({ days, onSelect, onCreate, highlightEventId }: WeekOverviewProps): React.ReactElement {
  return (
    <div className="week-overview">
      {days.map((day) => {
        const minutes = busyMinutesOf(day.items, startOfDay(day.date))
        return (
          <article key={day.date} className={`overview-day panel ${day.isToday ? 'is-today' : ''}`}>
            <header className="overview-head">
              <div className="overview-date">
                <span className="day-name">{weekdayShort(day.date)}</span>
                <strong>{new Date(day.date).getDate()}</strong>
              </div>
              {day.isToday && <span className="today-pill">今天</span>}
              <span className="overview-load">
                {minutes > 0 ? `${roundHour(minutes / 60)}h 已排` : '空闲'}
              </span>
            </header>

            <div className="overview-events">
              {day.items.length === 0 ? (
                <button type="button" className="overview-empty" onClick={() => onCreate(day.date)}>
                  <Icon name="plus" size={14} />
                  空闲，安排一件事
                </button>
              ) : (
                day.items.slice(0, 3).map((item) => (
                  <button
                    key={`${item.eventId}-${item.continuation}`}
                    type="button"
                    className={`overview-event ${highlightEventId === item.eventId ? 'is-new' : ''} ${item.hasConflict ? 'has-conflict' : ''}`}
                    onClick={() => onSelect(item.eventId)}
                    title={`${item.title} ${formatRange(item.startAt, item.endAt)}`}
                  >
                    <span className="overview-time">{item.timeLabel === 'all_day_pending' ? '待定' : formatTimeLabel(item)}</span>
                    <span className="overview-title">{item.title}</span>
                    {item.hasConflict && <span className="overview-flag">重叠</span>}
                  </button>
                ))
              )}
              {day.items.length > 3 && (
                <button type="button" className="overview-more" onClick={() => onCreate(day.date)}>
                  还有 {day.items.length - 3} 项
                </button>
              )}
            </div>

            <button type="button" className="overview-add" onClick={() => onCreate(day.date)}>
              <Icon name="plus" size={13} />
              在那天安排
            </button>
          </article>
        )
      })}
    </div>
  )
}

function formatTimeLabel(item: WeekItem): string {
  const start = new Date(item.startAt)
  const end = new Date(item.endAt)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(start.getHours())}:${pad(start.getMinutes())}–${pad(end.getHours())}:${pad(end.getMinutes())}`
}

function roundHour(hours: number): number {
  return Math.round(hours * 10) / 10
}