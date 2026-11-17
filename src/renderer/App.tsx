import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import HomePage from './pages/HomePage'
import BoardPage from './pages/BoardPage'
import AgentPage from './pages/AgentPage'
import WeekPage from './pages/WeekPage'
import SettingsPage from './pages/SettingsPage'
import Sidebar from './components/Sidebar'
import EventDetail from './components/EventDetail'
import ReminderCenter from './components/ReminderCenter'
import AiSettings from './components/AiSettings'
import { useNavigationStore } from './stores/navigation-store'
import { useReminderStore } from './stores/reminder-store'
import { useScheduleStore } from './stores/schedule-store'
import { useAppStore } from './stores/app-store'
import { usePreferencesStore } from './stores/preferences-store'

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="fatal-screen">
          <div className="fatal-card">
            <span className="eyebrow">SOMETHING WENT WRONG</span>
            <h1>页面加载异常</h1>
            <p>可以重新加载后再试一次，你的日程数据不会丢失。</p>
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App(): React.ReactElement {
  const page = useNavigationStore((state) => state.page)
  const navigate = useNavigationStore((state) => state.navigate)
  const aiStatus = useAppStore((state) => state.home?.aiStatus ?? 'local')
  const detailOpen = useScheduleStore((state) => state.detailOpen)
  const closeDetail = useScheduleStore((state) => state.closeDetail)
  const bootstrap = useAppStore((state) => state.bootstrap)
  const setAiStatus = useAppStore((state) => state.setAiStatus)
  const theme = usePreferencesStore((state) => state.theme)
  const toggleTheme = usePreferencesStore((state) => state.toggleTheme)
  const closeToTray = usePreferencesStore((state) => state.closeToTray)
  const setCloseToTray = usePreferencesStore((state) => state.setCloseToTray)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [summary, setSummary] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.inert = settingsOpen || detailOpen
  }, [settingsOpen, detailOpen])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    void window.pa.desktop.setCloseToTray(closeToTray)
  }, [closeToTray])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const offChanged = window.pa.schedule.onChanged((notice) => {
      useScheduleStore.getState().invalidate(notice.revision)
    })
    const offReminder = window.pa.reminder.onPresented((payload) => {
      useReminderStore.getState().enqueue(payload)
    })
    const offSummary = window.pa.app.onExpiredSummary((payload) => {
      setSummary(payload.startedEventCount)
    })
    const offAi = window.pa.app.onAiConfigChanged((notice) => {
      setAiStatus(notice.status, notice.channelStates)
    })
    const onVisibility = (): void => {
      void window.pa.desktop.setPresence(document.visibilityState === 'visible' ? 'foreground' : 'background')
    }
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    return () => {
      offChanged()
      offReminder()
      offSummary()
      offAi()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [setAiStatus])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || document.querySelector('[aria-modal="true"]')) return
      const key = event.key.toLowerCase()
      if (key === '1') {
        event.preventDefault()
        navigate('home')
      } else if (key === '2' || key === 'k') {
        event.preventDefault()
        navigate('agent')
      } else if (key === '3') {
        event.preventDefault()
        navigate('week')
      } else if (key === '4') {
        event.preventDefault()
        navigate('board')
      } else if (key === ',') {
        event.preventDefault()
        navigate('settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  useEffect(() => {
    if (summary === null) return
    const timer = window.setTimeout(() => setSummary(null), 8_000)
    return () => window.clearTimeout(timer)
  }, [summary])

  return (
    <ErrorBoundary>
      <div className="app-shell">
        <div className="app-body" ref={bodyRef}>
          <Sidebar
            page={page}
            aiStatus={aiStatus}
            theme={theme}
            onNavigate={navigate}
            onToggleTheme={toggleTheme}
            onShowMini={() => void window.pa.desktop.showMini()}
          />
          <div className="app-main">
            {page === 'home' && <HomePage />}
            {page === 'board' && <BoardPage onOpenSettings={() => setSettingsOpen(true)} />}
            {page === 'agent' && <AgentPage onOpenSettings={() => setSettingsOpen(true)} />}
            {page === 'week' && <WeekPage />}
            {page === 'settings' && <SettingsPage onOpenAiSettings={() => setSettingsOpen(true)} />}
          </div>
        </div>

        {detailOpen && <EventDetail onClose={closeDetail} />}

        <ReminderCenter />

        {settingsOpen && (
          <AiSettings
            onClose={() => setSettingsOpen(false)}
            closeToTray={closeToTray}
            onToggleCloseToTray={() => setCloseToTray(!closeToTray)}
          />
        )}

        {summary !== null && (
          <div className="summary-toast" role="status">
            <span className="toast-mark" aria-hidden="true" />
            <div>
              <strong>有 {summary} 条日程已经开始</strong>
              <p>提醒只在应用运行时触发，记得确认接下来的安排。</p>
            </div>
            <button type="button" className="toast-close" onClick={() => setSummary(null)} aria-label="关闭">
              ×
            </button>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}