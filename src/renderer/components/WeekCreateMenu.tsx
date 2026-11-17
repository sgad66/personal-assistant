import React, { useEffect, useRef, useState } from 'react'
import { nextMenuIndex, type MenuNavKey } from '@shared/menu-nav'
import { translate } from '@shared/message-catalog'

export interface WeekCreateMenuProps {
  readonly open: boolean
  readonly returnFocusRef: { current: HTMLElement | null }
  readonly onManualCreate: () => void
  readonly onImportFile: () => void
  readonly onImportVideo: () => void
  readonly onClose: () => void
  readonly fileHintKey: string
  readonly videoHintKey: string
}

export default function WeekCreateMenu({
  open,
  returnFocusRef,
  onManualCreate,
  onImportFile,
  onImportVideo,
  onClose,
  fileHintKey,
  videoHintKey
}: WeekCreateMenuProps): React.ReactElement | null {
  const [activeIndex, setActiveIndex] = useState(0)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const actions = [onManualCreate, onImportFile, onImportVideo]

  useEffect(() => {
    if (!open) return
    setActiveIndex(0)
    itemRefs.current[0]?.focus()
  }, [open])

  if (!open) return null

  const runAction = (index: number): void => {
    const action = actions[index]
    onClose()
    action?.()
  }

  const move = (key: MenuNavKey): void => {
    const next = nextMenuIndex(activeIndex, key, actions.length)
    if (next < 0) {
      onClose()
      returnFocusRef.current?.focus()
      return
    }
    setActiveIndex(next)
    itemRefs.current[next]?.focus()
  }

  return (
    <div
      id="week-create-menu"
      role="menu"
      aria-label={translate('import.menuManual')}
      className="week-create-menu panel"
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End' || event.key === 'Escape') {
          event.preventDefault()
          move(event.key as MenuNavKey)
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          runAction(activeIndex)
        }
      }}
    >
      {[
        { labelKey: 'import.menuManual', hintKey: undefined },
        { labelKey: 'import.menuFile', hintKey: fileHintKey },
        { labelKey: 'import.menuVideo', hintKey: videoHintKey }
      ].map((item, index) => (
        <button
          key={item.labelKey}
          ref={(node) => {
            itemRefs.current[index] = node
          }}
          type="button"
          role="menuitem"
          tabIndex={index === activeIndex ? 0 : -1}
          className="week-menu-item"
          onClick={() => runAction(index)}
          onMouseEnter={() => setActiveIndex(index)}
        >
          <span>{translate(item.labelKey)}</span>
          {item.hintKey && <span className="week-menu-hint">{translate(item.hintKey)}</span>}
        </button>
      ))}
    </div>
  )
}