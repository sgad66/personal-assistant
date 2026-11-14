import React, { useEffect, useState } from 'react'
import HomePage from './pages/HomePage'
import BoardPage from './pages/BoardPage'
import AgentPage from './pages/AgentPage'
import WeekPage from './pages/WeekPage'
import Sidebar from './components/Sidebar'
import ReminderCenter from './components/ReminderCenter'
import AiSettings from './components/AiSettings'
import { useNavigationStore } from './stores/navigation-store'
import { useReminderStore } from './stores/reminder-store'
import { useScheduleStore } from './stores/schedule-store'
import { useAppStore } from './stores/app-store'

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

type Theme = 'light' | 'dark'

const THEME_KEY = 'pa-theme-v2'

function initialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  return saved === 'dark' ? 'dark' : 'light'
}

export default function App(): React.ReactElement {
  const page = useNavigationStore((state) => state.page)
  const navigate = useNavigationStore((state) => state.navigate)
  const aiStatus = useAppStore((state) => state.home?.aiStatus ?? 'local')
  const bootstrap = useAppStore((state) => state.bootstrap)
  const setAiStatus = useAppStore((state) => state.setAiStatus)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [summary, setSummary] = useState<number | null>(null)
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [closeToTray, setCloseToTray] = useState(
    () => localStorage.getItem('pa-close-to-tray') !== 'false'
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('pa-close-to-tray', String(closeToTray))
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
      setAiStatus(notice.status)
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
      if (!(event.ctrlKey || event.metaKey)) return
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
        setSettingsOpen(true)
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
        <div className="app-body">
          <Sidebar
            page={page}
            aiStatus={aiStatus}
            theme={theme}
            onNavigate={navigate}
            onOpenSettings={() => setSettingsOpen(true)}
            onToggleTheme={() => setTheme((value) => (value === 'light' ? 'dark' : 'light'))}

            onShowMini={() => void window.pa.desktop.showMini()}
          />
          <main className="app-main">
            {page === 'home' && <HomePage />}
            {page === 'board' && <BoardPage onOpenSettings={() => setSettingsOpen(true)} />}
            {page === 'agent' && <AgentPage onOpenSettings={() => setSettingsOpen(true)} />}
            {page === 'week' && <WeekPage />}
          </main>
        </div>

        <ReminderCenter />

        {settingsOpen && (
          <AiSettings
            onClose={() => setSettingsOpen(false)}
            closeToTray={closeToTray}
            onToggleCloseToTray={() => setCloseToTray((value) => !value)}
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