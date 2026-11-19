import React, { useEffect, useMemo, useState } from 'react'
import type { GoalCadence } from '@shared/domain/types'
import type { GoalCreateInput, GoalView } from '@shared/ipc-contracts'
import {
  DAY_MS,
  formatDateLabel,
  formatLocalDate,
  formatTime
} from '@shared/time-kit'
import {
  goalCadenceLabel,
  goalNextRunLabel,
  goalProgressTone,
  goalStatusLabel
} from '@shared/goals/schedule'
import { useNavigationStore } from '../stores/navigation-store'
import { useGoalStore } from '../stores/goal-store'
import Icon from '../components/Icon'

const WEEKDAYS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' }
] as const

const CADENCES: readonly { value: GoalCadence; label: string; hint: string }[] = [
  { value: 'daily', label: '每天', hint: '每天固定时间回来看一次' },
  { value: 'weekdays', label: '工作日', hint: '周一到周五，跳过周末' },
  { value: 'weekly', label: '每周', hint: '每周固定一天检查' },
  { value: 'interval', label: '间隔', hint: '每隔一段时间检查一次' },
  { value: 'once', label: '一次', hint: '只在指定时间跟进一次' }
]

export default function GoalsPage(): React.ReactElement {
  const goals = useGoalStore((state) => state.goals)
  const loading = useGoalStore((state) => state.loading)
  const error = useGoalStore((state) => state.error)
  const running = useGoalStore((state) => state.running)
  const init = useGoalStore((state) => state.init)
  const refresh = useGoalStore((state) => state.refresh)
  const create = useGoalStore((state) => state.create)
  const setStatus = useGoalStore((state) => state.setStatus)
  const remove = useGoalStore((state) => state.remove)
  const runGoal = useGoalStore((state) => state.run)
  const clearError = useGoalStore((state) => state.clearError)
  const navigate = useNavigationStore((state) => state.navigate)

  const [now, setNow] = useState(() => Date.now())
  const [composerOpen, setComposerOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | undefined>(undefined)
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>(undefined)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  useEffect(() => {
    if (!confirmDelete) return undefined
    const timer = window.setTimeout(() => setConfirmDelete(undefined), 3_500)
    return () => window.clearTimeout(timer)
  }, [confirmDelete])

  const stats = useMemo(() => {
    const active = goals.filter((goal) => goal.status === 'active')
    const completed = goals.filter((goal) => goal.status === 'completed')
    const next = active.slice().sort((a, b) => a.nextRunAt - b.nextRunAt)[0]
    return { active: active.length, completed: completed.length, next }
  }, [goals])

  const handleRun = async (goal: GoalView): Promise<void> => {
    await runGoal(goal.goalId)
  }

  const handleDelete = async (goal: GoalView): Promise<void> => {
    if (confirmDelete !== goal.goalId) {
      setConfirmDelete(goal.goalId)
      return
    }
    setConfirmDelete(undefined)
    await remove(goal.goalId)
  }

  return (
    <main className="page goals-page">
      <header className="page-top">
        <div className="page-top-copy">
          <span className="eyebrow">GOALS</span>
          <h1>目标</h1>
          <p>助理会按节奏回来检查进度，并把每一次跟进写进对话。</p>
        </div>
        <div className="page-top-actions">
          <button type="button" className="btn btn-quiet" onClick={() => navigate('agent')}>
            <Icon name="spark" size={17} />
            在对话里建立
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setComposerOpen((open) => !open)}
          >
            <Icon name={composerOpen ? 'close' : 'plus'} size={17} />
            {composerOpen ? '收起' : '新建目标'}
          </button>
        </div>
      </header>

      <div className="goals-scroll">
        <section className="goals-summary" aria-label="目标概览">
          <div className="goals-summary-item">
            <span className="eyebrow">TRACKING</span>
            <strong>{stats.active}</strong>
            <p>个目标跟进中</p>
          </div>
          <div className="goals-summary-item">
            <span className="eyebrow">DONE</span>
            <strong>{stats.completed}</strong>
            <p>个已完成</p>
          </div>
          <div className="goals-summary-item is-wide">
            <span className="eyebrow">NEXT CHECK-IN</span>
            <strong className="goals-summary-next">
              {stats.next ? goalNextRunLabel(stats.next.nextRunAt, now) : '暂无计划'}
            </strong>
            <p>{stats.next ? `「${stats.next.title}」` : '建立目标后会自动安排第一次跟进'}</p>
          </div>
        </section>

        {error && (
          <div className="banner banner-danger" role="alert">
            <Icon name="alert" size={18} />
            <span>{error}</span>
            <button type="button" className="btn btn-quiet btn-sm" onClick={clearError}>
              关闭
            </button>
          </div>
        )}

        {composerOpen && (
          <GoalComposer
            onCreate={async (input) => {
              const ok = await create(input)
              if (ok) setComposerOpen(false)
              return ok
            }}
            onCancel={() => setComposerOpen(false)}
          />
        )}

        {goals.length === 0 && !loading ? (
          <EmptyGoals
            onCreateExample={async (input) => {
              const ok = await create(input)
              if (!ok) setComposerOpen(true)
            }}
          />
        ) : (
          <section className="goal-list" aria-label="目标列表">
            {goals.map((goal) => {
              const isRunning = running[goal.goalId] === true || goal.running
              const tone = goalProgressTone(goal.status, goal.progress)
              const expandedHere = expanded === goal.goalId
              return (
                <article key={goal.goalId} className={`goal-card tone-${tone}`}>
                  <header className="goal-card-head">
                    <div className="goal-title-row">
                      <span className={`goal-status tone-${tone}`}>
                        <span aria-hidden="true" />
                        {goalStatusLabel(goal.status)}
                      </span>
                      <h2>{goal.title}</h2>
                    </div>
                    <span className="goal-cadence">{goalCadenceLabel(goal)}</span>
                  </header>

                  <p className="goal-instruction">{goal.instruction}</p>

                  <div className="goal-progress-row">
                    <div className="goal-progress" aria-hidden="true">
                      <span style={{ width: `${goal.progress}%` }} />
                    </div>
                    <strong>{goal.progress}%</strong>
                  </div>

                  <div className="goal-meta">
                    {goal.status === 'active' ? (
                      <span>下次跟进 {goalNextRunLabel(goal.nextRunAt, now)}</span>
                    ) : (
                      <span>{goalStatusLabel(goal.status)}</span>
                    )}
                    {goal.runCount > 0 && <span>已跟进 {goal.runCount} 次</span>}
                    {goal.lastRunAt !== undefined && (
                      <span>
                        上次 {formatDateLabel(goal.lastRunAt)} {formatTime(goal.lastRunAt)}
                      </span>
                    )}
                    {goal.createdBy === 'ai' && <span className="goal-origin">助理建立</span>}
                  </div>

                  {goal.nextStep && <p className="goal-next-step">下一步：{goal.nextStep}</p>}

                  <div className="goal-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={isRunning || goal.status !== 'active'}
                      onClick={() => void handleRun(goal)}
                    >
                      <Icon name="play" size={13} />
                      {isRunning ? '跟进中…' : '立即跟进'}
                    </button>
                    {goal.status === 'active' && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => void setStatus(goal.goalId, 'pause')}
                      >
                        <Icon name="pause" size={13} />
                        暂停
                      </button>
                    )}
                    {goal.status === 'paused' && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => void setStatus(goal.goalId, 'resume')}
                      >
                        <Icon name="play" size={13} />
                        继续
                      </button>
                    )}
                    {goal.status !== 'completed' && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => void setStatus(goal.goalId, 'complete')}
                      >
                        <Icon name="check" size={13} />
                        标记完成
                      </button>
                    )}
                    {goal.checkpoints.length > 0 && (
                      <button
                        type="button"
                        className={`btn btn-quiet btn-sm ${expandedHere ? 'is-open' : ''}`}
                        onClick={() => setExpanded(expandedHere ? undefined : goal.goalId)}
                      >
                        <Icon name="note" size={13} />
                        {expandedHere ? '收起记录' : `查看记录 ${goal.checkpoints.length}`}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm is-danger-text"
                      onClick={() => void handleDelete(goal)}
                    >
                      <Icon name="trash" size={13} />
                      {confirmDelete === goal.goalId ? '确认删除' : '删除'}
                    </button>
                  </div>

                  {expandedHere && (
                    <ul className="goal-history">
                      {goal.checkpoints
                        .slice()
                        .reverse()
                        .map((checkpoint) => (
                          <li key={checkpoint.at} className={checkpoint.status === 'failed' ? 'is-failed' : ''}>
                            <div className="goal-history-head">
                              <span>
                                {formatDateLabel(checkpoint.at)} {formatTime(checkpoint.at)}
                              </span>
                              <strong>{checkpoint.progress}%</strong>
                            </div>
                            <p>{checkpoint.summary}</p>
                            {checkpoint.nextStep && <em>下一步：{checkpoint.nextStep}</em>}
                          </li>
                        ))}
                    </ul>
                  )}
                </article>
              )
            })}
          </section>
        )}
      </div>
    </main>
  )
}

function EmptyGoals({
  onCreateExample
}: {
  readonly onCreateExample: (input: GoalCreateInput) => Promise<void>
}): React.ReactElement {
  return (
    <section className="goals-empty">
      <span className="goals-orb" aria-hidden="true">
        <span />
      </span>
      <span className="eyebrow">START A GOAL</span>
      <h2>让助理记住你想推进的事</h2>
      <p>
        在对话里说“每天 21:00 提醒我复盘”，助理会自动建立目标；也可以直接选一个示例开始。
      </p>
      <div className="goals-examples">
        <button
          type="button"
          className="goal-example"
          onClick={() =>
            void onCreateExample({
              title: '每日回顾',
              instruction: '回顾今天完成的事，指出一件明天最该推进的事。',
              cadence: 'daily',
              hour: 21,
              minute: 0
            })
          }
        >
          <strong>每天 21:00 回顾</strong>
          <span>记录今天的进展，挑出明天最重要的一件事</span>
        </button>
        <button
          type="button"
          className="goal-example"
          onClick={() =>
            void onCreateExample({
              title: '论文进度',
              instruction: '检查论文写作进度，记录已经写完的部分，并给出下一步建议。',
              cadence: 'interval',
              intervalMinutes: 120
            })
          }
        >
          <strong>每 2 小时检查进度</strong>
          <span>适合需要连续推进的写作、开发或复习</span>
        </button>
      </div>
    </section>
  )
}

interface GoalComposerProps {
  readonly onCreate: (input: GoalCreateInput) => Promise<boolean>
  readonly onCancel: () => void
}

function GoalComposer({ onCreate, onCancel }: GoalComposerProps): React.ReactElement {
  const [title, setTitle] = useState('')
  const [instruction, setInstruction] = useState('')
  const [cadence, setCadence] = useState<GoalCadence>('daily')
  const [clock, setClock] = useState('09:00')
  const [weekday, setWeekday] = useState(1)
  const [intervalValue, setIntervalValue] = useState('60')
  const [intervalUnit, setIntervalUnit] = useState<'分钟' | '小时'>('分钟')
  const [onceDate, setOnceDate] = useState(() => formatLocalDate(Date.now() + DAY_MS))
  const [onceClock, setOnceClock] = useState('09:00')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | undefined>(undefined)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) {
      setFormError('给目标起一个名字。')
      return
    }
    const [hour, minute] = parseClock(cadence === 'once' ? onceClock : clock)
    const input: GoalCreateInput = {
      title: trimmedTitle,
      instruction: instruction.trim().length > 0 ? instruction.trim() : trimmedTitle,
      cadence,
      ...(cadence === 'interval'
        ? {
            intervalMinutes: Math.min(
              1440,
              Math.max(15, Math.round((Number(intervalValue) || 60) * (intervalUnit === '小时' ? 60 : 1)))
            )
          }
        : { hour, minute }),
      ...(cadence === 'weekly' ? { weekday } : {}),
      ...(cadence === 'once' ? { onceAt: clockOfDate(onceDate, onceClock) } : {})
    }
    setSubmitting(true)
    setFormError(undefined)
    const ok = await onCreate(input)
    setSubmitting(false)
    if (!ok) setFormError('没有保存成功，请再试一次。')
  }

  return (
    <form className="goal-composer" onSubmit={(event) => void submit(event)}>
      <header className="goal-composer-head">
        <div>
          <h2>新建目标</h2>
          <p>描述你想推进的事，助理会在你设定的节奏里主动回来检查。</p>
        </div>
        <button type="button" className="icon-button" aria-label="关闭新建目标" onClick={onCancel}>
          <Icon name="close" size={16} />
        </button>
      </header>

      <label className="goal-field">
        <span>目标名称</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={50}
          placeholder="例如：论文初稿"
          autoFocus
        />
      </label>

      <label className="goal-field">
        <span>每次跟进要关注什么</span>
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          maxLength={300}
          rows={3}
          placeholder="例如：回顾今天写完的部分，指出下一步最该做什么。"
        />
      </label>

      <fieldset className="goal-field goal-cadence-field">
        <legend>跟进节奏</legend>
        <div className="goal-cadence-options">
          {CADENCES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`goal-cadence-option ${cadence === option.value ? 'is-active' : ''}`}
              title={option.hint}
              onClick={() => setCadence(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="goal-cadence-hint">
          {CADENCES.find((option) => option.value === cadence)?.hint}
        </p>
      </fieldset>

      <div className="goal-time-row">
        {cadence !== 'interval' && cadence !== 'once' && (
          <label className="goal-field goal-field-inline">
            <span>时间</span>
            <input type="time" value={clock} onChange={(event) => setClock(event.target.value)} />
          </label>
        )}
        {cadence === 'weekly' && (
          <label className="goal-field goal-field-inline">
            <span>星期</span>
            <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
              {WEEKDAYS.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {cadence === 'interval' && (
          <>
            <label className="goal-field goal-field-inline">
              <span>每隔</span>
              <input
                type="number"
                min={15}
                max={1440}
                value={intervalValue}
                onChange={(event) => setIntervalValue(event.target.value)}
              />
            </label>
            <label className="goal-field goal-field-inline">
              <span>单位</span>
              <select
                value={intervalUnit}
                onChange={(event) => setIntervalUnit(event.target.value as '分钟' | '小时')}
              >
                <option value="分钟">分钟</option>
                <option value="小时">小时</option>
              </select>
            </label>
          </>
        )}
        {cadence === 'once' && (
          <>
            <label className="goal-field goal-field-inline">
              <span>日期</span>
              <input
                type="date"
                value={onceDate}
                onChange={(event) => setOnceDate(event.target.value)}
              />
            </label>
            <label className="goal-field goal-field-inline">
              <span>时间</span>
              <input
                type="time"
                value={onceClock}
                onChange={(event) => setOnceClock(event.target.value)}
              />
            </label>
          </>
        )}
      </div>

      {formError && <p className="goal-form-error">{formError}</p>}

      <div className="goal-composer-actions">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="btn btn-primary" disabled={submitting || title.trim().length === 0}>
          {submitting ? '正在建立…' : '开始跟进'}
        </button>
      </div>
    </form>
  )
}

function parseClock(value: string): [number, number] {
  const [hour, minute] = value.split(':').map((part) => Number.parseInt(part, 10))
  return [Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 9, Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0]
}

function clockOfDate(date: string, time: string): number {
  const parsed = new Date(`${date}T${time}:00`)
  return Number.isNaN(parsed.getTime()) ? Date.now() + DAY_MS : parsed.getTime()
}
