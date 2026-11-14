import React from 'react'
import type { AccessStatus } from '@shared/ipc-contracts'
import { UI_TEXT } from '@shared/message-catalog'
import type { Page } from '../stores/navigation-store'
import { aiStatusLabel } from '../ui-text'
import Icon, { type IconName } from './Icon'

interface SidebarProps {
  readonly page: Page
  readonly aiStatus: AccessStatus
  readonly theme: 'light' | 'dark'
  readonly onNavigate: (page: Page) => void
  readonly onOpenSettings: () => void
  readonly onToggleTheme: () => void

  readonly onShowMini: () => void
}

const NAV_ITEMS: readonly { page: Page; label: string; icon: IconName }[] = [
  { page: 'home', label: '今日', icon: 'today' },
  { page: 'agent', label: '智能体', icon: 'spark' },
  { page: 'board', label: '看板', icon: 'calendar' },
  { page: 'week', label: '本周', icon: 'week' }
]

export default function Sidebar({
  page,
  aiStatus,
  theme,
  onNavigate,
  onOpenSettings,
  onToggleTheme,

  onShowMini
}: SidebarProps): React.ReactElement {
  return (
    <aside className="sidebar">
      <button type="button" className="brand" onClick={() => onNavigate('home')} aria-label="回到今日">
        <span className="brand-mark" aria-hidden="true">
          日
        </span>
        <span className="brand-copy">
          <strong>{UI_TEXT.appName}</strong>
          <em>PERSONAL ASSISTANT</em>
        </span>
      </button>

      <nav className="sidebar-nav" aria-label="主导航">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.page}
            type="button"
            className={`nav-item ${page === item.page ? 'is-active' : ''}`}
            aria-current={page === item.page ? 'page' : undefined}
            onClick={() => onNavigate(item.page)}
          >
            <span className="nav-icon" aria-hidden="true">
              <Icon name={item.icon} size={19} />
            </span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <button type="button" className="ai-pod" onClick={onOpenSettings}>
          <span className={`status-dot ${aiStatus === 'local' ? 'is-local' : 'is-online'}`} aria-hidden="true" />
          <span className="ai-pod-copy">
            <strong>{aiStatusLabel(aiStatus)}</strong>
            <em>连接与密钥</em>
          </span>
          <Icon name="settings" size={17} className="ai-pod-icon" />
        </button>


        <button type="button" className="theme-toggle" onClick={onShowMini} title="打开右下角小窗">
          <Icon name="calendar" size={17} />
          <span>小窗模式</span>
        </button>

        <button type="button" className="theme-toggle" onClick={onToggleTheme} aria-label="切换主题">
          <Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} />
          <span>{theme === 'light' ? '深色模式' : '浅色模式'}</span>
        </button>
        <p className="sidebar-note">数据仅保存在本机</p>
      </div>
    </aside>
  )
}