import React, { useEffect, useMemo, useState } from 'react'
import { MINUTE_MS, formatTime, getWeekStart, startOfDay } from '@shared/time-kit'
import { FOCUS_WINDOW_MS, buildFocusWords, type FocusSource } from '@shared/focus-words'
import { useAppStore } from '../stores/app-store'
import { useNavigationStore } from '../stores/navigation-store'
import { useScheduleStore } from '../stores/schedule-store'
import { useGoalStore } from '../stores/goal-store'
import { useMemoryStore } from '../stores/memory-store'
import { useAgentStore } from '../stores/agent-store'
import { busyMinutesOf, formatCountdown, formatDuration, focusOf, freeBlocksOf } from '../schedule-insights'
import QuickCapture from '../components/home/QuickCapture'
import FocusCloud from '../components/home/FocusCloud'
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
  const goals = useGoalStore((state) => state.goals)
  const memories = useMemoryStore((state) => state.items)
  const messages = useAgentStore((state) => state.messages)
  const setSeedPrompt = useAgentStore((state) => state.setSeedPrompt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    void useGoalStore.getState().init()
    void useAgentStore.getState().init()
  }, [])

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

  const focusSources = useMemo(() => {
    const sources: FocusSource[] = []
    for (const day of week?.days ?? []) {
      for (const item of day.items) {
        sources.push({
          text: item.title,
          weight: day.isToday ? 1.8 : 1.4,
          kind: 'schedule'
        })
      }
    }
    for (const goal of goals) {
      if (goal.status !== 'active') continue
      sources.push({ text: goal.title, weight: 2.4, kind: 'goal' })
      if (goal.nextStep) sources.push({ text: goal.nextStep, weight: 1.4, kind: 'goal' })
    }
    for (const memory of memories) {
      if (!memory.pinned && now - memory.updatedAt > FOCUS_WINDOW_MS) continue
      sources.push({ text: memory.content, weight: memory.pinned ? 1.9 : 1.2, kind: 'memory' })
    }
    for (const message of messages) {
      if (message.role !== 'user') continue
      if (now - message.createdAt > FOCUS_WINDOW_MS) continue
      sources.push({ text: message.content, weight: 1, kind: 'conversation' })
    }
    return sources
  }, [week, goals, memories, messages, now])

  const focusWords = useMemo(() => buildFocusWords(focusSources), [focusSources])

  const talkAbout = (word: string): void => {
    setSeedPrompt(`聊聊我最近关注的「${word}」`)
    navigate('agent')
  }

  return (
    <main className="page home-page">
      <div className="home-glow" aria-hidden="true" />
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
              <div className="hero-quiet">
                <span className="eyebrow">NEXT UP</span>
                <p>
                  {items.length > 0
                    ? '今天的安排已经结束，可以慢下来了。'
                    : '接下来是空白，可以休息，也可以记一件新的事。'}
                </p>
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

        <FocusCloud words={focusWords} recordCount={focusSources.length} onPick={talkAbout} />
      </div>
    </main>
  )
}