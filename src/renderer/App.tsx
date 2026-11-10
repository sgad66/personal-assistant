import React, { useEffect, useState } from 'react'
import HomePage from './pages/HomePage'
import AgentPage from './pages/AgentPage'
import WeekPage from './pages/WeekPage'
import ReminderCenter from './components/ReminderCenter'
import { useNavigationStore } from './stores/navigation-store'
import { useReminderStore } from './stores/reminder-store'
import { useScheduleStore } from './stores/schedule-store'

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
        <div className="entry-error">
          <div className="entry-error-card">
            <h2>页面加载异常，请重试</h2>
            <p>错误码：E_ENTRY_LOAD_FAIL</p>
            <button type="button" onClick={() => window.location.reload()}>
              重试
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
  const [summary, setSummary] = useState<number | null>(null)

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
    const onVisibility = (): void => {
      void window.pa.desktop.setPresence(document.visibilityState === 'visible' ? 'foreground' : 'background')
    }
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    return () => {
      offChanged()
      offReminder()
      offSummary()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <ErrorBoundary>
      <div className="app-shell">
        <div className="app-backdrop" aria-hidden="true" />
        {page === 'home' && <HomePage />}
        {page === 'agent' && <AgentPage />}
        {page === 'week' && <WeekPage />}
        <ReminderCenter />
        {summary !== null && (
          <div className="summary-toast" role="status">
            <span>你有 {summary} 条已开始的安排</span>
            <button type="button" onClick={() => setSummary(null)}>
              知道了
            </button>
          </div>
        )}
      </div>
    </ErrorBoundary>
  )
}