import React, { useEffect } from 'react'
import { translate, UI_TEXT } from '@shared/message-catalog'
import Icon from './Icon'

interface WeekVideoNoticeProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly returnFocusRef: { current: HTMLElement | null }
}

export default function WeekVideoNotice({
  open,
  onClose,
  returnFocusRef
}: WeekVideoNoticeProps): React.ReactElement | null {
  const closeRef = React.useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      onClose()
      returnFocusRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, returnFocusRef])

  if (!open) return null

  return (
    <div className="confirm-layer" role="presentation">
      <div
        className="confirm-card week-video-notice"
        role="dialog"
        aria-modal="true"
        aria-labelledby="week-video-title"
      >
        <span className="eyebrow">VIDEO</span>
        <h3 id="week-video-title">{translate('import.videoUnsupported')}</h3>
        <ul className="gap-consequences">
          <li>{translate('import.videoAltAudio')}</li>
          <li>{translate('import.videoAltShot')}</li>
        </ul>
        <div className="confirm-actions">
          <button
            ref={closeRef}
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              onClose()
              returnFocusRef.current?.focus()
            }}
          >
            <Icon name="close" size={14} />
            {UI_TEXT.close}
          </button>
        </div>
      </div>
    </div>
  )
}