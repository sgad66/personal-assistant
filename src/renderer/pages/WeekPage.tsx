import React, { useEffect, useState } from 'react'
import { addWeeks, formatDateLabel, getWeekStart } from '@shared/time-kit'
import type { WeekView } from '@shared/domain/types'
import { useNavigationStore } from '../stores/navigation-store'
import { useScheduleStore } from '../stores/schedule-store'
import { useAgentStore } from '../stores/agent-store'
import { summarizeWeek } from '../schedule-insights'
import WeekPulse from '../components/WeekPulse'
import WeekOverview from '../components/WeekOverview'
import WeekGrid from '../components/WeekGrid'
import WeekTimeline from '../components/WeekTimeline'
import EventDetail from '../components/EventDetail'
import Icon from '../components/Icon'

type WeekViewMode = 'timeline' | 'list' | 'overview'

function readStoredView(): WeekViewMode {
  const stored = localStorage.getItem('pa-week-view')
  if (stored === 'list' || stored === 'overview') return stored
  return 'timeline'
}

export default function WeekPage(): React.ReactElement {
  const navigate = useNavigationStore((state) => state.navigate)
  const week = useScheduleStore((state) => state.week)
  const weekAnchor = useScheduleStore((state) => state.weekAnchor)
  const loading = useScheduleStore((state) => state.loading)
  const error = useScheduleStore((state) => state.error)
  const load = useScheduleStore((state) => state.load)
  const openDetail = useScheduleStore((state) => state.openDetail)
  const detailOpen = useScheduleStore((state) => state.detailOpen)
  const closeDetail = useScheduleStore((state) => state.closeDetail)
  const setSeedPrompt = useAgentStore((state) => state.setSeedPrompt)

  const [view, setView] = useState<WeekViewMode>(readStoredView)
  const [autoPicked, setAutoPicked] = useState(localStorage.getItem('pa-week-view') !== null)

  useEffect(() => {
    localStorage.setItem('pa-week-view', view)
  }, [view])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (autoPicked || !week) return
    setView(week.totalCount === 0 ? 'overview' : 'timeline')
    setAutoPicked(true)
  }, [autoPicked, week])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'ArrowLeft') void load(addWeeks(useScheduleStore.getState().weekAnchor, -1))
      if (event.key === 'ArrowRight') void load(addWeeks(useScheduleStore.getState().weekAnchor, 1))
      if (event.key.toLowerCase() === 't') void load(getWeekStart(Date.now()))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [load])

  const go = (delta: number): void => {
    void load(addWeeks(weekAnchor, delta))
  }

  const createOn = (date: number): void => {
    setSeedPrompt(`在${formatDateLabel(date)}安排 `)
    navigate('agent')
  }

  const startPrompt = (text: string): void => {
    setSeedPrompt(text)
    navigate('agent')
  }

  const rangeLabel = week ? formatRangeLabel(week) : '本周'
  const isCurrentWeek = week?.weekStart === getWeekStart(Date.now())
  const summary = week ? summarizeWeek(week.days) : undefined

  return (
    <main className="page week-page">
      <header className="page-top week-top">
        <div className="page-top-copy">
          <span className="eyebrow">WEEKLY VIEW</span>
          <h1>{isCurrentWeek ? '本周安排' : rangeLabel}</h1>
          <p>
            {rangeLabel}
            {summary ? ` · ${summary.total} 项 · ${roundHour(summary.timedHours)}h · ` : ''}
            {summary ? (summary.conflicts > 0 ? `${summary.conflicts} 处重叠` : '无冲突') : ''}
          </p>
        </div>

        <div className="week-controls">
          <div className="view-switch" role="group" aria-label="切换视图">
            <button
              type="button"
              className={view === 'timeline' ? 'is-active' : ''}
              onClick={() => setView('timeline')}
              title="时间轴视图"
            >
              <Icon name="clock" size={14} />
              时间轴
            </button>
            <button
              type="button"
              className={view === 'list' ? 'is-active' : ''}
              onClick={() => setView('list')}
              title="列表视图"
            >
              <Icon name="week" size={14} />
              列表
            </button>
            <button
              type="button"
              className={view === 'overview' ? 'is-active' : ''}
              onClick={() => setView('overview')}
              title="概览视图"
            >
              <Icon name="calendar" size={14} />
              概览
            </button>
          </div>

          <div className="week-pager" role="group" aria-label="切换周">
            <button type="button" className="icon-button" onClick={() => go(-1)} aria-label="上一周">
              <Icon name="chevronLeft" size={18} />
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load(getWeekStart(Date.now()))}>
              今天
            </button>
            <button type="button" className="icon-button" onClick={() => go(1)} aria-label="下一周">
              <Icon name="chevronRight" size={18} />
            </button>
          </div>

          <button type="button" className="icon-button" onClick={() => void load()} aria-label="刷新" disabled={loading}>
            <Icon name="refresh" size={18} />
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => createOn(Date.now())}>
            <Icon name="plus" size={16} />
            新建
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner-danger" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      {week && summary && <WeekPulse days={week.days} summary={summary} onCreate={createOn} />}

      {week && week.totalCount === 0 && (
        <div className="empty-week-banner">
          <span className="empty-week-mark" aria-hidden="true">
            <Icon name="calendar" size={20} />
          </span>
          <div>
            <strong>这一周还没有安排</strong>
            <p>从一个小目标开始，或者直接说一句话交给智能体。</p>
          </div>
          <div className="empty-week-actions">
            <button
              type="button"
              className="empty-suggestion"
              onClick={() => startPrompt('明天上午 10:00 开会 1 小时')}
            >
              安排会议
            </button>
            <button
              type="button"
              className="empty-suggestion"
              onClick={() => startPrompt('明天下午 2:00 专注 2 小时')}
            >
              专注时间
            </button>
            <button
              type="button"
              className="empty-suggestion"
              onClick={() => startPrompt('今天晚上 7:00 运动 1 小时')}
            >
              运动一下
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('agent')}>
              去安排
              <Icon name="arrowRight" size={15} />
            </button>
          </div>
        </div>
      )}

      {loading && !week && (
        <div className="week-skeleton" aria-hidden="true">
          {Array.from({ length: 7 }, (_unused, index) => (
            <span key={index} />
          ))}
        </div>
      )}

      {week && view === 'timeline' && (
        <WeekTimeline
          days={week.days}
          empty={week.totalCount === 0}
          onSelect={(eventId) => void openDetail(eventId)}
          onCreate={createOn}
        />
      )}

      {week && view === 'list' && (
        <WeekGrid days={week.days} onSelect={(eventId) => void openDetail(eventId)} onCreate={createOn} />
      )}

      {week && view === 'overview' && (
        <WeekOverview days={week.days} onSelect={(eventId) => void openDetail(eventId)} onCreate={createOn} />
      )}

      {detailOpen && <EventDetail onClose={closeDetail} />}
    </main>
  )
}

function formatRangeLabel(week: WeekView): string {
  const start = new Date(week.weekStart)
  const end = new Date(week.weekEndExclusive - 1)
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  if (sameMonth) {
    return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getDate()}日`
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`
}

function roundHour(hours: number): number {
  return Math.round(hours * 10) / 10
}