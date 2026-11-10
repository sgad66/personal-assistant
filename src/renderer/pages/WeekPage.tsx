import React, { useEffect } from 'react'
import { UI_TEXT } from '@shared/message-catalog'
import { formatDateShort } from '@shared/time-kit'
import { useNavigationStore } from '../stores/navigation-store'
import { useScheduleStore } from '../stores/schedule-store'
import WeekGrid from '../components/WeekGrid'
import EventDetail from '../components/EventDetail'
import PageHeader from '../components/PageHeader'

export default function WeekPage(): React.ReactElement {
  const back = useNavigationStore((state) => state.back)
  const navigate = useNavigationStore((state) => state.navigate)
  const week = useScheduleStore((state) => state.week)
  const loading = useScheduleStore((state) => state.loading)
  const error = useScheduleStore((state) => state.error)
  const load = useScheduleStore((state) => state.load)
  const openDetail = useScheduleStore((state) => state.openDetail)
  const detailOpen = useScheduleStore((state) => state.detailOpen)
  const closeDetail = useScheduleStore((state) => state.closeDetail)

  useEffect(() => {
    void load()
  }, [load])

  const rangeLabel = week
    ? `${formatDateShort(week.weekStart)} - ${formatDateShort(week.weekEndExclusive - 1)}`
    : '本周'

  return (
    <main className="page week-page">
      <PageHeader
        title={UI_TEXT.weekTitle}
        subtitle={rangeLabel}
        onBack={back}
        actions={
          <button type="button" className="ghost-button" onClick={() => void load()}>
            刷新
          </button>
        }
      />

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      {loading && !week && <div className="week-skeleton">正在读取本周安排…</div>}

      {week && week.totalCount === 0 && (
        <div className="empty-week">
          <p>{UI_TEXT.weekEmpty}</p>
          <button type="button" className="primary-button" onClick={() => navigate('agent')}>
            去智能体安排
          </button>
        </div>
      )}

      {week && week.totalCount > 0 && (
        <WeekGrid days={week.days} onSelect={(eventId) => void openDetail(eventId)} />
      )}

      {week && week.totalCount === 0 && (
        <WeekGrid days={week.days} onSelect={(eventId) => void openDetail(eventId)} />
      )}

      {detailOpen && <EventDetail onClose={closeDetail} />}
    </main>
  )
}