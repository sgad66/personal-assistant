import React, { useEffect, useMemo, useState } from 'react'
import { MINUTE_MS, formatTime, getWeekStart, startOfDay } from '@shared/time-kit'
import { useAppStore } from '../stores/app-store'
import { useNavigationStore } from '../stores/navigation-store'
import { useScheduleStore } from '../stores/schedule-store'
import { busyMinutesOf, formatCountdown, formatDuration, focusOf, freeBlocksOf } from '../schedule-insights'
import QuickCapture from '../components/home/QuickCapture'
import { greetingOf, monthLabel, weekdayLong, yearLabel } from '../ui-text'
import Icon from '../components/Icon'

export default function HomePage(): React.ReactElement {
  const navigate = useNavigationStore((state) => state.navigate)
  const home = useAppStore((state) => state.home)
  const bootError = useAppStore((state) => state.error)
  const bootstrap = useAppStore((state) => state.bootstrap)
  const week = useScheduleStore((state) => state.week)
  const scheduleError = useScheduleStore((state) => state.error)
  const load = useScheduleStore((state) => state.load)
  const openDetail = useScheduleStore((state) => state.openDetail)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  const currentWeekStart = home?.currentWeekStart ?? getWeekStart(now)
  useEffect(() => {
    if (!week || week.weekStart !== currentWeekStart) {
      void load(currentWeekStart)
    }
  }, [week, currentWeekStart, load])

  const today = useMemo(() => week?.days.find((day) => day.isToday), [week])
  const items = today?.items ?? []
  const error = bootError ?? scheduleError
  const dayStart = startOfDay(now)
  const busyMinutes = busyMinutesOf(items, dayStart)
  const freeBlocks = freeBlocksOf(items, now)
  const focus = focusOf(items, now)

  return (
    <main className="page home-page">
      <div className="home-stage">
      <header className="home-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            {yearLabel(now)} · {monthLabel(now)}
          </span>
          <h1>
            {greetingOf(now)}
            <span className="hero-stop">.</span>
          </h1>
          <p className="hero-sub">
            {weekdayLong(now)} · {items.length > 0 ? `今天有 ${items.length} 项安排` : '今天还没有安排'}
          </p>
          <div className="hero-stats">
            <span>
              <strong>{items.length}</strong> 项
            </span>
            <i aria-hidden="true" />
            <span>
              <strong>{busyMinutes > 0 ? formatDuration(busyMinutes * MINUTE_MS) : '0 分钟'}</strong> 已排
            </span>
            <i aria-hidden="true" />
            <span>
              <strong>{freeBlocks.length}</strong> 段空档
            </span>
          </div>
        </div>

        <div className="hero-side">

          {focus ? (
            <button
              type="button"
              className={`hero-focus ${focus.kind === 'ongoing' ? 'is-now' : ''}`}
              onClick={() => void openDetail(focus.item.eventId)}
            >
              <span className="eyebrow">{focus.kind === 'ongoing' ? 'NOW' : 'NEXT UP'}</span>
              <strong>{focus.item.title}</strong>
              <span className="hero-focus-meta">
                {focus.kind === 'ongoing'
                  ? `还剩 ${formatDuration(focus.minutes * MINUTE_MS)}`
                  : `${formatCountdown(focus.minutes)} · ${formatTime(focus.item.startAt)}`}
                {focus.item.location ? ` · ${focus.item.location}` : ''}
              </span>
            </button>
          ) : (
            <div className="hero-focus is-empty">
              <span className="eyebrow">NEXT UP</span>
              <strong>{items.length > 0 ? '今天的安排已经结束' : '接下来是空白'}</strong>
              <span className="hero-focus-meta">可以休息，也可以记一件新的事。</span>
            </div>
          )}
        </div>
      </header>

      {error && (
        <div className="banner banner-danger" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      )}

      <section className="capture-block">
        <QuickCapture onMore={() => navigate('agent')} />
      </section>
      </div>
    </main>
  )
}