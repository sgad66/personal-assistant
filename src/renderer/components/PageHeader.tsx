import React from 'react'
import { UI_TEXT } from '@shared/message-catalog'

interface PageHeaderProps {
  readonly title: string
  readonly subtitle?: string
  readonly onBack: () => void
  readonly actions?: React.ReactNode
}

export default function PageHeader({ title, subtitle, onBack, actions }: PageHeaderProps): React.ReactElement {
  return (
    <header className="page-header">
      <button type="button" className="back-button" onClick={onBack} aria-label={UI_TEXT.back}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {UI_TEXT.back}
      </button>
      <div className="page-title">
        <h1>{title}</h1>
        {subtitle && <span className="page-subtitle">{subtitle}</span>}
      </div>
      <div className="page-actions">{actions}</div>
    </header>
  )
}