import React from 'react'

export type IconName =
  | 'today'
  | 'spark'
  | 'week'
  | 'settings'
  | 'plus'
  | 'arrowRight'
  | 'arrowLeft'
  | 'chevronLeft'
  | 'chevronRight'
  | 'arrowUp'
  | 'arrowDown'
  | 'check'
  | 'close'
  | 'mic'
  | 'image'
  | 'send'
  | 'refresh'
  | 'clock'
  | 'pin'
  | 'note'
  | 'alert'
  | 'sun'
  | 'moon'
  | 'trash'
  | 'calendar'
  | 'repeat'
  | 'target'
  | 'play'
  | 'pause'

interface IconProps {
  readonly name: IconName
  readonly size?: number
  readonly strokeWidth?: number
  readonly className?: string
}

export default function Icon({ name, size = 20, strokeWidth = 1.7, className }: IconProps): React.ReactElement | null {
  const common = {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className
  }

  switch (name) {
    case 'today':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
        </svg>
      )
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9L12 3.5Z" />
          <path d="M19 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
        </svg>
      )
    case 'week':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="3" />
          <path d="M3.5 9.5h17M8 3v4M16 3v4" />
          <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <path d="M4 7h6M14 7h6M4 17h10M18 17h2" />
          <circle cx="12" cy="7" r="2.2" />
          <circle cx="16" cy="17" r="2.2" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'arrowRight':
      return (
        <svg {...common}>
          <path d="M4 12h15M13 6l6 6-6 6" />
        </svg>
      )
    case 'arrowLeft':
      return (
        <svg {...common}>
          <path d="M20 12H5M11 6l-6 6 6 6" />
        </svg>
      )
    case 'chevronLeft':
      return (
        <svg {...common}>
          <path d="M14.5 6l-6 6 6 6" />
        </svg>
      )
    case 'chevronRight':
      return (
        <svg {...common}>
          <path d="M9.5 6l6 6-6 6" />
        </svg>
      )
    case 'arrowUp':
      return (
        <svg {...common}>
          <path d="M12 19V5M6 11l6-6 6 6" />
        </svg>
      )
    case 'arrowDown':
      return (
        <svg {...common}>
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common}>
          <path d="M4.5 12.5l5 5 10-11" />
        </svg>
      )
    case 'close':
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      )
    case 'mic':
      return (
        <svg {...common}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" />
        </svg>
      )
    case 'image':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="3" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M5.5 17l4.5-4.5L13 16l2.5-2.5L19 17" />
        </svg>
      )
    case 'send':
      return (
        <svg {...common}>
          <path d="M4.5 11.5L20 4l-7.5 15.5-2.2-6.3-5.8-1.7Z" />
        </svg>
      )
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 1 0-2.3 6.2" />
          <path d="M20 4v7h-7" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      )
    case 'pin':
      return (
        <svg {...common}>
          <path d="M12 21s6.5-5.7 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.3 12 21 12 21Z" />
          <circle cx="12" cy="10.5" r="2.2" />
        </svg>
      )
    case 'note':
      return (
        <svg {...common}>
          <path d="M6 3.5h9l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
          <path d="M15 3.5V8h4M8.5 12.5h7M8.5 16h5" />
        </svg>
      )
    case 'alert':
      return (
        <svg {...common}>
          <path d="M12 4l8.5 15h-17L12 4Z" />
          <path d="M12 9.5v4.2M12 17h.01" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.4 5.4L6.8 6.8M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...common}>
          <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...common}>
          <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 13h9.4l.8-13" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      )
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="3" />
          <path d="M3.5 9.5h17M8 3v4M16 3v4" />
        </svg>
      )
    case 'repeat':
      return (
        <svg {...common}>
          <path d="M4 9a4.5 4.5 0 0 1 4.5-4.5H18M18 4.5V9h-4.5" />
          <path d="M20 15a4.5 4.5 0 0 1-4.5 4.5H6M6 19.5V15h4.5" />
        </svg>
      )
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4" />
          <path d="M12 12l6.5-6.5M18.5 5.5h-3.6M18.5 5.5v3.6" />
        </svg>
      )
    case 'play':
      return (
        <svg {...common}>
          <path d="M8 5.5l11 6.5-11 6.5v-13Z" />
        </svg>
      )
    case 'pause':
      return (
        <svg {...common}>
          <path d="M8.5 5.5v13M15.5 5.5v13" />
        </svg>
      )
    default:
      return null
  }
}