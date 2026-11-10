import React, { useEffect, useState } from 'react'
import { CONTRACT_VERSION, type AccessStatus } from '@shared/ipc-contracts'
import { UI_TEXT } from '@shared/message-catalog'
import { formatDateLabel, getWeekStart } from '@shared/time-kit'
import { useNavigationStore } from '../stores/navigation-store'
import { useScheduleStore } from '../stores/schedule-store'

export default function HomePage(): React.ReactElement {
  const navigate = useNavigationStore((state) => state.navigate)
  const setAnchor = useScheduleStore((state) => state.load)
  const [error, setError] = useState<string | undefined>(undefined)
  const [aiStatus, setAiStatus] = useState<AccessStatus>('local')
  const [today, setToday] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    window.pa.app
      .bootstrap({ contractVersion: CONTRACT_VERSION })
      .then((state) => {
        if (cancelled) return
        setToday(Date.now())
        useScheduleStore.setState({ weekAnchor: getWeekStart(state.currentWeekStart) })
        setAiStatus(state.aiStatus ?? (state.aiConfigured ? 'custom' : 'local'))
      })
      .catch(() => {
        if (!cancelled) setError('页面加载异常，请重试')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const off = window.pa.app.onAiConfigChanged((notice) => setAiStatus(notice.status))
    return off
  }, [])

  const aiLabel =
    aiStatus === 'free_recommended'
      ? UI_TEXT.aiStatusFreeRecommended
      : aiStatus === 'custom'
        ? UI_TEXT.aiStatusCustom
        : UI_TEXT.aiStatusLocal

  return (
    <main className="home-page">
      <header className="home-header">
        <div>
          <p className="eyebrow">PERSONAL ASSISTANT</p>
          <h1>{UI_TEXT.appName}</h1>
          <p className="home-subtitle">
            今天 {formatDateLabel(today)} · 提前 10 分钟提醒，不会再错过安排
          </p>
        </div>
        <div className={`ai-status ${aiStatus !== 'local' ? 'is-online' : ''}`}>
          <span className="dot" />
          {aiLabel}
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => window.location.reload()}>
            重试
          </button>
        </div>
      )}

      <section className="entry-grid">
        <button type="button" className="entry-card entry-agent" onClick={() => navigate('agent')}>
          <span className="entry-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="44" height="44" fill="none">
              <rect x="8" y="12" width="32" height="26" rx="10" stroke="currentColor" strokeWidth="2.4" />
              <circle cx="18" cy="25" r="3" fill="currentColor" />
              <circle cx="30" cy="25" r="3" fill="currentColor" />
              <path d="M20 33c2.4 1.6 5.6 1.6 8 0" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M24 12V7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="24" cy="6" r="2" fill="currentColor" />
            </svg>
          </span>
          <span className="entry-body">
            <span className="entry-title">{UI_TEXT.homeAgent}</span>
            <span className="entry-desc">{UI_TEXT.homeAgentHint}</span>
            <span className="entry-tags">
              <em>文字</em>
              <em>语音</em>
              <em>图片</em>
            </span>
          </span>
          <span className="entry-arrow" aria-hidden="true">
            →
          </span>
        </button>

        <button type="button" className="entry-card entry-week" onClick={() => navigate('week')}>
          <span className="entry-icon" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="44" height="44" fill="none">
              <rect x="7" y="10" width="34" height="30" rx="6" stroke="currentColor" strokeWidth="2.4" />
              <path d="M7 19h34" stroke="currentColor" strokeWidth="2.4" />
              <path d="M16 7v6M32 7v6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              <path d="M14 26h5M22 26h5M30 26h5M14 32h5M22 32h5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </span>
          <span className="entry-body">
            <span className="entry-title">{UI_TEXT.homeWeek}</span>
            <span className="entry-desc">{UI_TEXT.homeWeekHint}</span>
            <span className="entry-tags">
              <em>周一至周日</em>
              <em>冲突可视</em>
            </span>
          </span>
          <span className="entry-arrow" aria-hidden="true">
            →
          </span>
        </button>
      </section>

      <footer className="home-footer">
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setAnchor(getWeekStart(Date.now()))
            navigate('week')
          }}
        >
          查看本周安排
        </button>
        <span className="hint">所有数据保存在本机，语音与图片在解析后立即清除</span>
      </footer>
    </main>
  )
}