import React, { useEffect, useRef, useState } from 'react'
import type { DayColumn } from '@shared/domain/types'
import { formatRange, formatTime } from '@shared/time-kit'
import { HOUR_HEIGHT, buildWeekTimeline, nowLineTop, type TimelineSegment } from '../schedule-insights'
import { weekdayShort } from '../ui-text'
import Icon from './Icon'

interface WeekTimelineProps {
  readonly days: readonly DayColumn[]
  readonly empty?: boolean
  readonly onSelect: (eventId: string) => void
  readonly onCreate: (date: number) => void
}

export default function WeekTimeline({
  days,
  empty = false,
  onSelect,
  onCreate
}: WeekTimelineProps): React.ReactElement {
  const [now, setNow] = useState(() => Date.now())
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const layout = buildWeekTimeline(days)
  const hours = Array.from(
    { length: layout.rangeEndHour - layout.rangeStartHour + 1 },
    (_unused, index) => layout.rangeStartHour + index
  )

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    if (empty) {
      node.scrollTop = 0
      return
    }
    const today = days.find((day) => day.isToday)
    if (!today) return
    const currentLayout = buildWeekTimeline(days)
    const top = nowLineTop(today, Date.now(), currentLayout.rangeStartHour, currentLayout.totalHeight)
    if (top === undefined) return
    node.scrollTop = Math.max(0, top - 140)
  }, [days, empty])

  return (
    <div className="timeline-week">
      {!empty && (
        <div className="timeline-legend">
          <span>
            <i className="legend-dot is-busy" aria-hidden="true" />
            日程
          </span>
          <span>
            <i className="legend-dot is-conflict" aria-hidden="true" />
            时间重叠
          </span>
          <span className="legend-hint">滚轮浏览时间 · 点击空白日期的「+」快速安排</span>
        </div>
      )}

      <div className="timeline-scroll" ref={scrollRef}>
        <div className="timeline-canvas">
          <div className="timeline-gutter">
            <div className="timeline-gutter-head" />
            <div className="timeline-gutter-body" style={{ height: layout.totalHeight }}>
              {hours.map((hour) => (
                <span
                  key={hour}
                  className="timeline-hour-label"
                  style={{ top: (hour - layout.rangeStartHour) * HOUR_HEIGHT }}
                >
                  {String(hour).padStart(2, '0')}:00
                </span>
              ))}
            </div>
          </div>

          {layout.days.map(({ day, segments, pending }) => {
            const nowTop = nowLineTop(day, now, layout.rangeStartHour, layout.totalHeight)
            return (
              <section key={day.date} className={`timeline-col ${day.isToday ? 'is-today' : ''}`}>
                <header className="timeline-col-head">
                  <div className="timeline-col-date">
                    <span className="day-name">{weekdayShort(day.date)}</span>
                    <span className={`day-number ${day.isToday ? 'is-today' : ''}`}>
                      {new Date(day.date).getDate()}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="day-add"
                    onClick={() => onCreate(day.date)}
                    aria-label="在这一天添加安排"
                    title="添加安排"
                  >
                    <Icon name="plus" size={14} />
                  </button>
                  {pending.length > 0 && (
                    <button
                      type="button"
                      className="pending-chip"
                      onClick={() => onSelect(pending[0].eventId)}
                      title={`${pending.length} 项时间待定`}
                    >
                      待定 {pending.length}
                    </button>
                  )}
                </header>

                <div className="timeline-col-body" style={{ height: layout.totalHeight }}>
                  {groupSegments(segments).map((cluster) => {
                    const first = cluster[0]
                    if (!first) return null
                    if (cluster.length === 1) {
                      return (
                        <button
                          key={`${first.item.eventId}-${first.startAt}`}
                          type="button"
                          className={`timeline-event ${first.item.hasConflict ? 'has-conflict' : ''} ${
                            first.item.continuation === 'continues_from_prev' ? 'is-continued' : ''
                          } ${first.height < 38 ? 'is-tiny' : ''} ${first.height < 72 ? 'is-short' : ''}`}
                          style={{
                            top: first.top,
                            height: first.height,
                            left: '2px',
                            width: 'calc(100% - 4px)',
                            zIndex: 1
                          }}
                          title={`${first.item.title} ${formatRange(first.item.startAt, first.item.endAt)}`}
                          onClick={() => onSelect(first.item.eventId)}
                        >
                          <span className="timeline-event-time">
                            {first.item.continuation === 'continues_from_prev'
                              ? '延续'
                              : formatRange(first.item.startAt, first.item.endAt)}
                          </span>
                          <span className="timeline-event-title">{first.item.title}</span>
                          {first.height > 76 && first.item.location && (
                            <span className="timeline-event-location">{first.item.location}</span>
                          )}
                        </button>
                      )
                    }

                    const top = Math.min(...cluster.map((segment) => segment.top))
                    const bottom = Math.max(...cluster.map((segment) => segment.top + segment.height))
                    const height = Math.max(bottom - top, 26 + cluster.length * 22)
                    return (
                      <div
                        key={`cluster-${first.startAt}`}
                        className="timeline-cluster"
                        style={{ top, height }}
                      >
                        <div className="timeline-cluster-head">
                          <Icon name="alert" size={11} />
                          时间重叠 · {cluster.length} 项
                        </div>
                        {[...cluster].sort((a, b) => a.startAt - b.startAt).map((segment) => (
                          <button
                            key={`${segment.item.eventId}-${segment.startAt}`}
                            type="button"
                            className="timeline-cluster-event"
                            title={`${segment.item.title} ${formatRange(segment.item.startAt, segment.item.endAt)}`}
                            onClick={() => onSelect(segment.item.eventId)}
                          >
                            <span className="timeline-cluster-time">
                              {segment.item.continuation === 'continues_from_prev'
                                ? '延续'
                                : formatTime(segment.item.startAt)}
                            </span>
                            <span className="timeline-cluster-title">{segment.item.title}</span>
                          </button>
                        ))}
                      </div>
                    )
                  })}

                  {nowTop !== undefined && (
                    <span className="now-line" style={{ top: nowTop }} aria-label="当前时间">
                      <i />
                    </span>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
function groupSegments(segments: readonly TimelineSegment[]): TimelineSegment[][] {
  const sorted = [...segments].sort((a, b) => a.startAt - b.startAt)
  const groups: TimelineSegment[][] = []
  let current: TimelineSegment[] = []
  let end = 0

  for (const segment of sorted) {
    if (current.length > 0 && segment.startAt >= end) {
      groups.push(current)
      current = []
      end = 0
    }
    current.push(segment)
    end = Math.max(end, segment.endAt)
  }
  if (current.length > 0) groups.push(current)
  return groups
}