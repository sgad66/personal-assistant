import React, { useEffect, useState } from 'react'
import type { AccessStatus } from '@shared/ipc-contracts'
import type { DayColumn, WeekView } from '@shared/domain/types'
import { DAY_MS, MINUTE_MS, formatDateLabel, formatLocalDate, formatRange, formatTime, startOfDay } from '@shared/time-kit'
import {
  busyMinutesOf,
  dayBlocksOf,
  formatDuration,
  freeBlocksOf,
  summarizeWeek
} from '../../schedule-insights'
import {
  FOCUS_DURATION_MS,
  HABITS,
  WIDGET_META,
  attentionOf,
  parseFocusState,
  parseHabitState,
  toggleHabitState,
  upcomingOf,
  workLifeStatsOf,
  type FocusState,
  type HabitId,
  type HabitState,
  type WidgetId
} from '../../home-layout'
import Icon, { type IconName } from '../Icon'
import { weekdayShort } from '../../ui-text'
import FreeTimeSuggestions from './FreeTimeSuggestions'

export interface WidgetContext {
  readonly days: readonly DayColumn[]
  readonly week?: WeekView
  readonly today?: DayColumn
  readonly now: number
  readonly aiStatus: AccessStatus
  readonly openDetail: (eventId: string) => void
  readonly prompt: (text: string) => void
  readonly openWeek: () => void
  readonly openSettings: () => void
}

const HABIT_ICONS: Readonly<Record<HabitId, IconName>> = {
  water: 'today',
  move: 'spark',
  read: 'note',
  early: 'moon'
}

export function renderHomeWidget(id: WidgetId, ctx: WidgetContext): React.ReactElement {
  switch (id) {
    case 'rhythm':
      return <RhythmWidget ctx={ctx} />
    case 'today':
      return <TodayWidget ctx={ctx} />
    case 'week':
      return <WeekWidget ctx={ctx} />
    case 'balance':
      return <BalanceWidget ctx={ctx} />
    case 'free':
      return <FreeTimeWidget ctx={ctx} />
    case 'templates':
      return <TemplatesWidget ctx={ctx} />
    case 'habits':
      return <HabitsWidget ctx={ctx} />
    case 'upcoming':
      return <UpcomingWidget ctx={ctx} />
    case 'conflicts':
      return <ConflictsWidget ctx={ctx} />
    case 'focus':
      return <FocusWidget />
    default:
      return (
        <div className="widget-empty is-compact">
          <h3>组件不可用</h3>
          <p>请重新选择这个组件。</p>
        </div>
      )
  }
}

function WidgetHead({ id, right }: { readonly id: WidgetId; readonly right?: React.ReactNode }): React.ReactElement {
  const meta = WIDGET_META[id]
  return (
    <header className="panel-head">
      <div>
        <span className="eyebrow">{meta.eyebrow}</span>
        <h2>{meta.title}</h2>
      </div>
      {right}
    </header>
  )
}

function RhythmWidget({ ctx }: { readonly ctx: WidgetContext }): React.ReactElement {
  const items = ctx.today?.items ?? []
  const dayStart = startOfDay(ctx.now)
  const busyMinutes = busyMinutesOf(items, dayStart)
  const blocks = dayBlocksOf(items, dayStart)
  const freeBlocks = freeBlocksOf(items, ctx.now)
  const nextFree = freeBlocks[0]
  const startsNow = nextFree !== undefined && nextFree.startAt - ctx.now < 10 * MINUTE_MS
  const conflicts = items.filter((item) => item.hasConflict).length
  const nowPercent = Math.max(0, Math.min(100, ((ctx.now - dayStart) / DAY_MS) * 100))

  return (
    <>
      <WidgetHead id="rhythm" right={<span className={`panel-count ${conflicts > 0 ? 'is-warn' : ''}`}>{conflicts > 0 ? `${conflicts} 处重叠` : '无冲突'}</span>} />
      <div className="day-track">
        <div className="day-track-rail">
          {blocks.map((block, index) => (
            <button
              key={`${block.item.eventId}-${index}`}
              type="button"
              className={`day-block ${block.item.hasConflict ? 'is-conflict' : ''}`}
              style={{ left: `${block.left}%`, width: `${block.width}%` }}
              title={`${block.item.title} ${formatRange(block.item.startAt, block.item.endAt)}`}
              aria-label={`${block.item.title} ${formatRange(block.item.startAt, block.item.endAt)}`}
              onClick={() => ctx.openDetail(block.item.eventId)}
            >
              {block.width > 4 && <span className="day-block-label">{block.item.title}</span>}
            </button>
          ))}
          {blocks.length === 0 && <span className="day-track-empty">还没有安排</span>}
          <span className="day-now" style={{ left: `${nowPercent}%` }} aria-hidden="true">
            <i />
          </span>
        </div>
        <div className="day-ticks" aria-hidden="true">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>24:00</span>
        </div>
      </div>
      <div className="day-strip-foot">
        <span className="day-strip-busy">
          <Icon name="clock" size={13} />
          {busyMinutes > 0 ? `已排 ${formatDuration(busyMinutes * MINUTE_MS)}` : '全天空闲'}
        </span>
        {nextFree ? (
          <span className="free-hint">
            {startsNow ? `现在到 ${formatTime(nextFree.endAt)} 有空` : `下一段空档 ${formatTime(nextFree.startAt)}–${formatTime(nextFree.endAt)}`}
            <em>约 {formatDuration(nextFree.endAt - nextFree.startAt)}</em>
          </span>
        ) : (
          <span className="free-hint">
            {ctx.now >= dayStart + 21 * 3_600_000 ? '今天的空闲时段已经过去' : '今天没有 1 小时以上的空档'}
          </span>
        )}
      </div>
    </>
  )
}

function TodayWidget({ ctx }: { readonly ctx: WidgetContext }): React.ReactElement {
  const items = ctx.today?.items ?? []
  const dayStart = startOfDay(ctx.now)
  const busyMinutes = busyMinutesOf(items, dayStart)
  const freeBlocks = freeBlocksOf(items, ctx.now)
  const next = items
    .filter((item) => item.timeLabel === 'timed' && item.startAt > ctx.now)
    .sort((a, b) => a.startAt - b.startAt)[0]
  const spotlight =
    next !== undefined
      ? `${formatTime(next.startAt)} ${next.title}`
      : items.length > 0
        ? '今天的安排已经结束'
        : '今天还没有安排'

  return (
    <div className="today-widget-body">
      <WidgetHead id="today" right={<span className="panel-count">{items.length} 项</span>} />

      <div className="today-grid">
        <div className="today-main">
          {items.length === 0 ? (
            <div className="today-empty">
              <span className="empty-orbit" aria-hidden="true" />
              <h3>今天是一张白纸</h3>
              <p>从一个具体的小目标开始，剩下的交给助理安排。</p>
              <div className="today-chips">
                <button type="button" className="prompt-chip is-small" onClick={() => ctx.prompt('今天下午 2:00 专注 2 小时')}>
                  专注 2 小时
                </button>
                <button type="button" className="prompt-chip is-small" onClick={() => ctx.prompt('今天晚上 7:00 运动 1 小时')}>
                  运动 1 小时
                </button>
                <button type="button" className="prompt-chip is-small" onClick={() => ctx.prompt('明天上午 10:00 开会 1 小时')}>
                  安排会议
                </button>
              </div>
            </div>
          ) : (
            <div className="today-list">
              <ol className="timeline">
                {items.map((item) => {
                  const status = item.endAt <= ctx.now ? 'done' : item.startAt <= ctx.now ? 'ongoing' : 'upcoming'
                  return (
                    <li key={`${item.eventId}-${item.continuation}`} className={`is-${status}`}>
                      <button type="button" className="timeline-item" onClick={() => ctx.openDetail(item.eventId)}>
                        <span className="timeline-time">
                          {item.continuation === 'continues_from_prev' ? '延续' : formatTime(item.startAt)}
                        </span>
                        <span className="timeline-rail" aria-hidden="true">
                          <span className={`timeline-dot ${item.hasConflict ? 'is-conflict' : ''}`} />
                        </span>
                        <span className="timeline-body">
                          <strong>{item.title}</strong>
                          <span className="timeline-meta">
                            {formatRange(item.startAt, item.endAt)}
                            {item.location ? ` · ${item.location}` : ''}
                            {item.hasConflict ? ' · 时间重叠' : ''}
                          </span>
                        </span>
                        <span className="timeline-tail">
                          {status === 'ongoing' && <em className="state-tag is-live">进行中</em>}
                          {status === 'done' && <em className="state-tag">已结束</em>}
                          {status === 'upcoming' && <em className="duration">{formatDuration(item.endAt - item.startAt)}</em>}
                          <span className="timeline-arrow" aria-hidden="true">
                            <Icon name="chevronRight" size={16} />
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
        </div>

        <aside className="today-side">
          <div className="today-overview">
            <div>
              <span className="eyebrow">NEXT</span>
              <strong>{spotlight}</strong>
              <em>{next?.location ?? '留一点空白也很好'}</em>
            </div>
            <span className="today-stat">
              {busyMinutes > 0 ? `已排 ${formatDuration(busyMinutes * MINUTE_MS)}` : '全天空闲'}
            </span>
          </div>

          {freeBlocks.length > 0 && (
            <div className="today-slots">
              {freeBlocks.slice(0, 2).map((block) => (
                <div key={block.startAt} className="today-slot">
                  <span className="today-slot-time">
                    {formatTime(block.startAt)}–{formatTime(block.endAt)}
                  </span>
                  <span className="today-slot-length">{formatDuration(block.endAt - block.startAt)}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => ctx.prompt(`在${formatDateLabel(dayStart)} ${formatTime(block.startAt)} 安排 `)}
                  >
                    安排
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="today-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => ctx.prompt('')}>
              <Icon name="plus" size={14} />
              记一件事
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={ctx.openWeek}>
              查看本周
              <Icon name="arrowRight" size={14} />
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

function WeekWidget({ ctx }: { readonly ctx: WidgetContext }): React.ReactElement {
  const summary = ctx.week ? summarizeWeek(ctx.week.days) : undefined
  const maxCount = Math.max(1, ...(ctx.week?.days ?? []).map((day) => day.items.length))

  return (
    <>
      <WidgetHead
        id="week"
        right={
          <button type="button" className="btn btn-quiet btn-sm" onClick={ctx.openWeek}>
            展开
          </button>
        }
      />
      <div className="mini-week">
        {(ctx.week?.days ?? []).map((day) => (
          <button
            key={day.date}
            type="button"
            className={`mini-row ${day.isToday ? 'is-today' : ''}`}
            onClick={ctx.openWeek}
            title={day.items[0] ? `${day.items[0].title} · ${day.items.length} 项` : '这一天空闲'}
          >
            <span className="mini-day">{weekdayShort(day.date)}</span>
            <span className="mini-date">{new Date(day.date).getDate()}</span>
            <span className="mini-track" aria-hidden="true">
              <span style={{ width: `${(day.items.length / maxCount) * 100}%` }} />
            </span>
            <span className="mini-count">{day.items.length}</span>
            <span className="mini-top">{day.items[0]?.title ?? '空闲'}</span>
          </button>
        ))}
        {!ctx.week && <p className="mini-empty">正在读取本周安排…</p>}
      </div>
      {summary && (
        <p className="mini-summary">
          本周 {summary.total} 项 · 已排 {Math.round(summary.timedHours * 10) / 10} 小时
          {summary.busiestDate !== undefined ? ` · 最忙 ${weekdayShort(summary.busiestDate)}` : ''}
        </p>
      )}
    </>
  )
}

function BalanceWidget({ ctx }: { readonly ctx: WidgetContext }): React.ReactElement {
  const stats = workLifeStatsOf(ctx.days)
  const rows = [
    { label: '工作时段', value: stats.workMinutes, capacity: Math.max(1, stats.workWindowMinutes) },
    { label: '晚间', value: stats.eveningMinutes, capacity: 28 * 60 },
    { label: '周末', value: stats.weekendMinutes, capacity: 48 * 60 }
  ]
  const note =
    stats.scheduledMinutes === 0
      ? '本周还没有安排，先记一件事吧。'
      : stats.eveningMinutes > stats.workMinutes && stats.eveningMinutes > 0
        ? '晚间安排比工作时段还多，注意留出休息。'
        : stats.weekendMinutes > 0
          ? '周末也有安排，别忘了给自己留白。'
          : '安排主要在工作时段，节奏比较均衡。'

  return (
    <>
      <WidgetHead id="balance" right={<span className="panel-count">空档 {formatHours(stats.workFreeMinutes)}</span>} />
      <div className="balance-rows">
        {rows.map((row) => (
          <div key={row.label} className="balance-row">
            <span className="balance-label">{row.label}</span>
            <span className="balance-track" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (row.value / row.capacity) * 100)}%` }} />
            </span>
            <span className="balance-value">{formatHours(row.value)}</span>
          </div>
        ))}
      </div>
      <p className="balance-note">{note}</p>
    </>
  )
}

function FreeTimeWidget({ ctx }: { readonly ctx: WidgetContext }): React.ReactElement {
  const todayBlocks = freeBlocksOf(ctx.today?.items ?? [], ctx.now)
  const tomorrowDate = startOfDay(ctx.now) + DAY_MS
  const tomorrow = ctx.days.find((day) => day.date === tomorrowDate)
  const tomorrowBlocks = tomorrow
    ? freeBlocksOf(tomorrow.items, tomorrowDate + 9 * 3_600_000)
    : []
  const rows = [
    ...todayBlocks.slice(0, 2).map((block) => ({ label: '今天', date: startOfDay(ctx.now), block })),
    ...tomorrowBlocks.slice(0, 1).map((block) => ({ label: '明天', date: tomorrowDate, block }))
  ]

  return (
    <>
      <FreeTimeSuggestions key={`${ctx.aiStatus}-${startOfDay(ctx.now)}`} now={ctx.now} openDetail={ctx.openDetail} />
      {rows.length > 0 && (
        <details className="recommendation-free-times">
          <summary>可自行安排的空档 · {rows.length} 段</summary>
          <ul className="free-list">
            {rows.map((row) => (
              <li key={`${row.label}-${row.block.startAt}`} className="free-row">
                <span className="free-day">{row.label}</span>
                <span className="free-time">
                  {formatTime(row.block.startAt)}–{formatTime(row.block.endAt)}
                </span>
                <span className="free-length">{formatDuration(row.block.endAt - row.block.startAt)}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => ctx.prompt(`在${formatDateLabel(row.date)} ${formatTime(row.block.startAt)} 安排 `)}
                >
                  安排
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

const WORK_TEMPLATES: readonly { label: string; prompt: string; icon: IconName }[] = [
  { label: '会议', prompt: '明天上午 10:00 开会 1 小时', icon: 'note' },
  { label: '专注', prompt: '今天下午 2:00 专注 2 小时', icon: 'spark' },
  { label: '评审', prompt: '明天下午 3:00 设计评审 1 小时', icon: 'week' },
  { label: '复盘', prompt: '今天晚上 9:00 复盘 30 分钟', icon: 'refresh' }
]

const LIFE_TEMPLATES: readonly { label: string; prompt: string; icon: IconName }[] = [
  { label: '运动', prompt: '今天晚上 7:00 运动 1 小时', icon: 'today' },
  { label: '午餐', prompt: '明天中午 12:00 午餐 1 小时', icon: 'clock' },
  { label: '阅读', prompt: '今天晚上 9:30 阅读 30 分钟', icon: 'note' },
  { label: '家务', prompt: '明天上午 9:00 家务 1 小时', icon: 'calendar' },
  { label: '休息', prompt: '今天下午 4:00 休息 20 分钟', icon: 'moon' }
]

function TemplatesWidget({ ctx }: { readonly ctx: WidgetContext }): React.ReactElement {
  return (
    <>
      <WidgetHead id="templates" right={<span className="panel-count">一点即填</span>} />
      <div className="template-groups">
        <div className="template-group">
          <span className="template-group-label">工作</span>
          <div className="template-grid">
            {WORK_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                className="template-chip is-large"
                onClick={() => ctx.prompt(template.prompt)}
                title={template.prompt}
              >
                <Icon name={template.icon} size={13} />
                {template.label}
              </button>
            ))}
          </div>
        </div>
        <div className="template-group">
          <span className="template-group-label">生活</span>
          <div className="template-grid">
            {LIFE_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                className="template-chip is-large"
                onClick={() => ctx.prompt(template.prompt)}
                title={template.prompt}
              >
                <Icon name={template.icon} size={13} />
                {template.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

function HabitsWidget({ ctx }: { readonly ctx: WidgetContext }): React.ReactElement {
  const todayKey = formatLocalDate(ctx.now)
  const [state, setState] = useState<HabitState>(() => parseHabitState(localStorage.getItem('pa-habits'), todayKey))

  useEffect(() => {
    setState(parseHabitState(localStorage.getItem('pa-habits'), todayKey))
  }, [todayKey])

  const toggle = (id: HabitId): void => {
    const nextRaw = toggleHabitState(localStorage.getItem('pa-habits'), id, todayKey)
    localStorage.setItem('pa-habits', nextRaw)
    setState(parseHabitState(nextRaw, todayKey))
  }

  return (
    <>
      <WidgetHead id="habits" right={<span className="panel-count">{state.done.length}/{HABITS.length}</span>} />
      <div className="habit-progress" aria-hidden="true">
        <span style={{ width: `${(state.done.length / HABITS.length) * 100}%` }} />
      </div>
      <div className="habit-grid">
        {HABITS.map((habit) => {
          const done = state.done.includes(habit.id)
          return (
            <button
              key={habit.id}
              type="button"
              className={`habit-item ${done ? 'is-done' : ''}`}
              onClick={() => toggle(habit.id)}
            >
              <span className="habit-check" aria-hidden="true">
                {done ? <Icon name="check" size={13} /> : <Icon name={HABIT_ICONS[habit.id]} size={14} />}
              </span>
              <span className="habit-copy">
                <strong>{habit.label}</strong>
                <em>{habit.hint}</em>
              </span>
            </button>
          )
        })}
      </div>
      <p className="widget-footnote">只记录在本机，不影响日程数据。</p>
    </>
  )
}

function UpcomingWidget({ ctx }: { readonly ctx: WidgetContext }): React.ReactElement {
  const entries = upcomingOf(ctx.days, ctx.now, 3)

  return (
    <>
      <WidgetHead id="upcoming" right={<span className="panel-count">{entries.length} 项</span>} />
      {entries.length === 0 ? (
        <div className="widget-empty is-compact">
          <h3>接下来没有安排</h3>
          <p>可以休息，也可以让助理安排下一件事。</p>
        </div>
      ) : (
        <ul className="upcoming-list">
          {entries.map((entry) => (
            <li key={`${entry.item.eventId}-${entry.item.startAt}`}>
              <button type="button" className="upcoming-row" onClick={() => ctx.openDetail(entry.item.eventId)}>
                <span className="upcoming-date">
                  {relativeDate(entry.date, ctx.now)}
                  <em>{formatTime(entry.item.startAt)}</em>
                </span>
                <span className="upcoming-title">{entry.item.title}</span>
                <Icon name="chevronRight" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ConflictsWidget({ ctx }: { readonly ctx: WidgetContext }): React.ReactElement {
  const entries = attentionOf(ctx.days)

  return (
    <>
      <WidgetHead id="conflicts" right={<span className={`panel-count ${entries.length > 0 ? 'is-warn' : ''}`}>{entries.length} 项</span>} />
      {entries.length === 0 ? (
        <div className="widget-empty is-compact">
          <h3>本周没有冲突</h3>
          <p>时间重叠和待定事项会自动出现在这里。</p>
        </div>
      ) : (
        <ul className="attention-list">
          {entries.slice(0, 4).map((entry) => (
            <li key={`${entry.item.eventId}-${entry.kind}`}>
              <button type="button" className="attention-row" onClick={() => ctx.openDetail(entry.item.eventId)}>
                <span className={`attention-kind ${entry.kind === 'conflict' ? 'is-conflict' : ''}`}>
                  {entry.kind === 'conflict' ? '重叠' : '待定'}
                </span>
                <span className="attention-copy">
                  <strong>{entry.item.title}</strong>
                  <em>{formatDateLabel(entry.date)} · {formatRange(entry.item.startAt, entry.item.endAt)}</em>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function FocusWidget(): React.ReactElement {
  const [state, setState] = useState<FocusState>(() => parseFocusState(localStorage.getItem('pa-focus'), Date.now()))
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (!state.running) return
    const timer = window.setInterval(() => {
      const remaining = (state.endsAt ?? Date.now()) - Date.now()
      if (remaining <= 0) {
        const done: FocusState = { remainingMs: 0, running: false, completed: true }
        localStorage.setItem('pa-focus', JSON.stringify({ remainingMs: 0, running: false }))
        setState(done)
      } else {
        forceTick((value) => value + 1)
      }
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [state.running, state.endsAt])

  const remaining = state.running ? Math.max(0, (state.endsAt ?? 0) - Date.now()) : state.remainingMs
  const progress = 1 - Math.min(1, remaining / FOCUS_DURATION_MS)
  const tone = state.completed ? 'var(--sage)' : remaining < 5 * MINUTE_MS ? 'var(--danger)' : 'var(--accent)'

  const start = (): void => {
    const remaining = state.remainingMs > 0 && state.remainingMs < FOCUS_DURATION_MS ? state.remainingMs : FOCUS_DURATION_MS
    const endsAt = Date.now() + remaining
    localStorage.setItem('pa-focus', JSON.stringify({ endsAt, running: true }))
    setState({ endsAt, remainingMs: remaining, running: true, completed: false })
  }

  const pause = (): void => {
    const next = Math.max(0, (state.endsAt ?? Date.now()) - Date.now())
    localStorage.setItem('pa-focus', JSON.stringify({ remainingMs: next, running: false }))
    setState({ remainingMs: next, running: false, completed: next === 0 })
  }

  const reset = (): void => {
    localStorage.removeItem('pa-focus')
    setState({ remainingMs: FOCUS_DURATION_MS, running: false, completed: false })
  }

  return (
    <>
      <WidgetHead id="focus" right={<span className="panel-count">25 分钟</span>} />
      <div className="focus-body">
        <div
          className="focus-ring"
          style={{ background: `conic-gradient(${tone} ${progress * 360}deg, var(--line) 0deg)` }}
        >
          <span className="focus-time">{formatClock(remaining)}</span>
        </div>
        <p className="focus-note">
          {state.completed ? '这一轮完成了，起来活动一下。' : state.running ? '专注中，先不处理其他事。' : '准备好后开始一轮 25 分钟专注。'}
        </p>
        <div className="focus-actions">
          {state.running ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={pause}>
              暂停
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={start}>
              {state.remainingMs < FOCUS_DURATION_MS ? '继续' : '开始'}
            </button>
          )}
          <button type="button" className="btn btn-quiet btn-sm" onClick={reset}>
            重置
          </button>
        </div>
      </div>
    </>
  )
}

function formatHours(minutes: number): string {
  const hours = minutes / 60
  if (hours === 0) return '0h'
  return `${Math.round(hours * 10) / 10}h`
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function relativeDate(date: number, now: number): string {
  const diff = startOfDay(date) - startOfDay(now)
  if (diff === 0) return '今天'
  if (diff === DAY_MS) return '明天'
  return weekdayShort(date)
}
