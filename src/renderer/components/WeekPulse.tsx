import React from 'react'
import type { DayColumn } from '@shared/domain/types'
import { startOfDay } from '@shared/time-kit'
import { busyMinutesOf, type WeekSummary } from '../schedule-insights'
import { workLifeStatsOf } from '../home-layout'
import { weekdayShort } from '../ui-text'
import { translate } from '@shared/message-catalog'
import Icon from './Icon'

interface WeekPulseProps {
  readonly days: readonly DayColumn[]
  readonly summary: WeekSummary
  readonly isCurrentWeek: boolean
  readonly onCreate: (date: number) => void
}

export default function WeekPulse({ days, summary, isCurrentWeek, onCreate }: WeekPulseProps): React.ReactElement {
  const stats = workLifeStatsOf(days)
  const rows = days.map((day) => ({
    day,
    minutes: busyMinutesOf(day.items, startOfDay(day.date)),
    count: day.items.length
  }))
  const maxMinutes = Math.max(60, ...rows.map((row) => row.minutes))

  return (
    <section className="week-pulse panel">
      <div className="pulse-copy">
        <span className="eyebrow">WEEK PULSE</span>
        <h2>{translate(isCurrentWeek ? 'week.pulseTitleThisWeek' : 'week.pulseTitleOther')}</h2>
        <div className="pulse-stats">
          <span>
            <strong>{summary.total}</strong> 项安排
          </span>
          <span>
            <strong>{roundHour(summary.timedHours)}h</strong> 已排
          </span>
          <span>
            <strong>{roundHour(stats.workFreeMinutes / 60)}h</strong> 工作空档
          </span>
          <span className={summary.conflicts > 0 ? 'is-warn' : ''}>
            <strong>{summary.conflicts}</strong> 处重叠
          </span>
        </div>
      </div>

      <div className="pulse-chart" aria-label={translate(isCurrentWeek ? 'week.pulseTitleThisWeek' : 'week.pulseTitleOther')}>
        {rows.map((row) => {
          const height = row.minutes === 0 ? 6 : Math.max(14, (row.minutes / maxMinutes) * 100)
          return (
            <button
              key={row.day.date}
              type="button"
              className={`pulse-col ${row.day.isToday ? 'is-today' : ''} ${row.minutes === 0 ? 'is-free' : ''}`}
              title={`${weekdayShort(row.day.date)} ${row.count} 项 · ${roundHour(row.minutes / 60)} 小时，点击快速安排`}
              onClick={() => onCreate(row.day.date)}
            >
              <span className="pulse-track" aria-hidden="true">
                <span style={{ height: `${height}%` }} />
              </span>
              <span className="pulse-day">{weekdayShort(row.day.date)}</span>
              <span className="pulse-date">{new Date(row.day.date).getDate()}</span>
            </button>
          )
        })}
      </div>

      <p className="pulse-hint">
        <Icon name="plus" size={12} />
        点击某一天，直接让助理在那天安排事项
      </p>
    </section>
  )
}

function roundHour(hours: number): number {
  return Math.round(hours * 10) / 10
}