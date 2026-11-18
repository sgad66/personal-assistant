import React, { useEffect, useRef, useState } from 'react'
import { formatDateLabel, getWeekStart } from '@shared/time-kit'
import type { WeekView } from '@shared/domain/types'
import { translate } from '@shared/message-catalog'
import { planWeekRequest, weekNavOf } from '@shared/week-nav'
import { useNavigationStore } from '../stores/navigation-store'
import { useScheduleStore } from '../stores/schedule-store'
import { useAgentStore } from '../stores/agent-store'
import { useImportStore } from '../stores/import-store'
import { useImportPicker } from '../import-picker'
import { planImportBatch } from '@shared/import/plan'
import { middleEllipsis } from '@shared/import/text'
import { summarizeWeek } from '../schedule-insights'
import WeekPulse from '../components/WeekPulse'
import WeekOverview from '../components/WeekOverview'
import WeekGrid from '../components/WeekGrid'
import WeekTimeline from '../components/WeekTimeline'
import WeekCreateMenu from '../components/WeekCreateMenu'
import WeekVideoNotice from '../components/WeekVideoNotice'
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
  const focusTodayToken = useScheduleStore((state) => state.focusTodayToken)
  const loading = useScheduleStore((state) => state.loading)
  const error = useScheduleStore((state) => state.error)
  const load = useScheduleStore((state) => state.load)
  const refresh = useScheduleStore((state) => state.refresh)
  const goToCurrentWeek = useScheduleStore((state) => state.goToCurrentWeek)
  const openDetail = useScheduleStore((state) => state.openDetail)
  const setSeedPrompt = useAgentStore((state) => state.setSeedPrompt)
  const batch = useImportStore((state) => state.batch)
  const stageFiles = useImportStore((state) => state.stageFiles)
  const enqueue = useImportStore((state) => state.enqueue)
  const startImport = useImportStore((state) => state.start)
  const setHighlight = useImportStore((state) => state.setHighlight)
  const highlightedEventId = useImportStore((state) => state.highlightedEventId)
  const highlightedUntil = useImportStore((state) => state.highlightedUntil)

  const [view, setView] = useState<WeekViewMode>(readStoredView)
  const [autoPicked, setAutoPicked] = useState(localStorage.getItem('pa-week-view') !== null)
  const [nowMinute, setNowMinute] = useState(() => Date.now())
  const [menuOpen, setMenuOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [banner, setBanner] = useState<string | undefined>(undefined)

  const navButtonRef = useRef<HTMLButtonElement | null>(null)
  const createButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const viewWeekStart = week?.weekStart ?? weekAnchor
  const nav = weekNavOf(viewWeekStart, nowMinute)
  const navRef = useRef(nav)
  navRef.current = nav

  useEffect(() => {
    localStorage.setItem('pa-week-view', view)
  }, [view])

  useEffect(() => {
    void load(getWeekStart(Date.now()))
  }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setNowMinute(Date.now())
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (autoPicked || !week) return
    setView(week.totalCount === 0 ? 'overview' : 'timeline')
    setAutoPicked(true)
  }, [autoPicked, week])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return
      if (document.querySelector('[aria-modal="true"]')) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const anchor = useScheduleStore.getState().weekAnchor
        const delta = event.key === 'ArrowLeft' ? -1 : 1
        setMenuOpen(false)
        void load(planWeekRequest(anchor, { kind: 'step', delta }, Date.now()))
      }
      if (event.key.toLowerCase() === 't') {
        if (navRef.current.isCurrentWeek) return
        void goToCurrentWeek()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [load, goToCurrentWeek])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      if (createButtonRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onBlur = (): void => setMenuOpen(false)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onBlur)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    setMenuOpen(false)
  }, [view])

  function go(delta: -1 | 1): void {
    setMenuOpen(false)
    void load(planWeekRequest(weekAnchor, { kind: 'step', delta }, Date.now()))
  }

  const handleBackToThisWeek = (): void => {
    if (nav.isCurrentWeek) return
    void goToCurrentWeek()
  }

  const createOn = (date: number): void => {
    setMenuOpen(false)
    setSeedPrompt(`在${formatDateLabel(date)}安排 `)
    navigate('agent')
  }

  const startPrompt = (text: string): void => {
    setSeedPrompt(text)
    navigate('agent')
  }

  const handlePick = (files: File[]): void => {
    const plan = planImportBatch(files.map((file) => ({ name: file.name, size: file.size })))
    if (plan.batchRejected) {
      setBanner(translate('import.batchTooLarge', { limit: '6 MB' }))
      return
    }
    if (plan.accepted.length === 0) {
      const first = plan.rejected[0]
      if (first) {
        setBanner(
          translate(first.reasonKey, {
            ...(first.ext ? { ext: first.ext } : {}),
            limit: '2 MB'
          })
        )
      }
      return
    }
    stageFiles(files)
    enqueue(plan)
    startImport()
    setBanner(undefined)
    navigate('agent')
  }

  const picker = useImportPicker({
    onPick: handlePick,
    onPickerFailed: () => setBanner(translate('import.pickerFailed'))
  })

  const onImportFile = (): void => {
    picker.open()
  }

  useEffect(() => {
    if (!highlightedUntil) return
    const remaining = Math.max(0, highlightedUntil - Date.now())
    const timer = window.setTimeout(() => setHighlight('', 0), remaining)
    return () => window.clearTimeout(timer)
  }, [highlightedUntil, setHighlight])

  const rangeLabel = week ? formatRangeLabel(week) : translate('week.loading')
  const title = nav.isCurrentWeek ? translate('week.currentTitle') : rangeLabel
  const summary = week ? summarizeWeek(week.days) : undefined

  return (
    <main
      className="page week-page"
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        setBanner(translate('import.dragHint'))
      }}
    >
      <header className="page-top week-top">
        <div className="page-top-copy">
          <span className="eyebrow">WEEKLY VIEW</span>
          <h1>{title}</h1>
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
            <button
              ref={navButtonRef}
              type="button"
              className={`btn btn-quiet btn-sm week-nav ${nav.isCurrentWeek ? 'is-current' : ''}`}
              aria-disabled={nav.ariaDisabled}
              aria-label={translate(nav.labelKey)}
              title={translate(nav.hintKey)}
              onClick={handleBackToThisWeek}
            >
              {translate(nav.labelKey)}
            </button>
            <button type="button" className="icon-button" onClick={() => go(1)} aria-label="下一周">
              <Icon name="chevronRight" size={18} />
            </button>
          </div>

          <button type="button" className="icon-button" onClick={() => void refresh()} aria-label="刷新" disabled={loading}>
            <Icon name="refresh" size={18} />
          </button>

          <div className="week-create-wrap" ref={menuRef}>
            <button
              ref={createButtonRef}
              type="button"
              className="btn btn-primary btn-sm"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls="week-create-menu"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <Icon name="plus" size={16} />
              新建
            </button>

            <WeekCreateMenu
              open={menuOpen}
              returnFocusRef={createButtonRef}
              onManualCreate={() => createOn(Date.now())}
              onImportFile={onImportFile}
              onImportVideo={() => setVideoOpen(true)}
              onClose={() => setMenuOpen(false)}
              fileHintKey="import.menuFileHint"
              videoHintKey="import.menuVideoHint"
            />
          </div>
        </div>
      </header>

      <WeekVideoNotice open={videoOpen} onClose={() => setVideoOpen(false)} returnFocusRef={createButtonRef} />

      {banner && (
        <div className="banner" role="alert">
          <Icon name="alert" size={18} />
          <span>{banner}</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setBanner(undefined)}>
            关闭
          </button>
        </div>
      )}

      {error && (
        <div className="banner banner-danger" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      )}

      {week && summary && (
        <WeekPulse days={week.days} summary={summary} isCurrentWeek={nav.isCurrentWeek} onCreate={createOn} />
      )}

      {week && week.totalCount === 0 && (
        <div className="empty-week-banner">
          <span className="empty-week-mark" aria-hidden="true">
            <Icon name="calendar" size={20} />
          </span>
          <div>
            <strong>这一周还没有安排</strong>
            <p>从一个小目标开始，或者直接说一句话交给助理。</p>
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
          focusTodaySignal={focusTodayToken}
          highlightEventId={highlightedEventId}
        />
      )}

      {week && view === 'list' && (
        <WeekGrid
          days={week.days}
          onSelect={(eventId) => void openDetail(eventId)}
          onCreate={createOn}
          focusTodaySignal={focusTodayToken}
          highlightEventId={highlightedEventId}
        />
      )}

      {week && view === 'overview' && (
        <WeekOverview
          days={week.days}
          onSelect={(eventId) => void openDetail(eventId)}
          onCreate={createOn}
          highlightEventId={highlightedEventId}
        />
      )}

      {batch?.phase === 'done' && (
        <section className="import-results panel">
          <header className="import-results-head">
            <strong>{translate('import.batchSummary', {
              ok: batch.files.filter((file) => file.phase === 'written').length,
              failed: batch.files.filter((file) => file.phase === 'failed').length
            })}</strong>
          </header>
          <ul>
            {batch.files.map((file, index) => (
              <li key={`${file.fileName}-${index}`} className={file.phase === 'failed' ? 'is-fail' : ''}>
                <span title={file.fileName}>{middleEllipsis(file.fileName, 32)}</span>
                <span>
                  {file.phase === 'written'
                    ? '已写入'
                    : file.phase === 'no_schedule'
                      ? translate('import.noScheduleFound', { name: file.fileName })
                      : file.reasonKey
                        ? translate(file.reasonKey, { name: file.fileName })
                        : translate(`import.failureKind.${file.failureKind ?? 'parse'}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {picker.input}

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