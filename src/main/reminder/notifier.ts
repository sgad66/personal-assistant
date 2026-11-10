import type { BrowserWindow } from 'electron'
import { Notification } from 'electron'
import type { ReminderPayload } from '@shared/ipc-contracts'
import { IPC_CHANNELS } from '@shared/ipc-contracts'
import type { Logger } from '../observability/logger'

export class Notifier {
  private readonly notified = new Set<string>()

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly logger: Logger
  ) {}

  present(payload: ReminderPayload): void {
    const window = this.getWindow()
    if (window && !window.isDestroyed() && window.isVisible() && window.isFocused()) {
      window.webContents.send(IPC_CHANNELS.reminderPresented, payload)
      return
    }

    if (!Notification.isSupported()) {
      this.logger.failure('reminder.delivered', 'E_NOTIFICATION_DENIED', 0)
      return
    }

    const key = `${payload.eventId}_${payload.plannedAt}`
    if (this.notified.has(key)) return
    this.notified.add(key)

    try {
      const notification = new Notification({
        title: `日程提醒：还有 ${payload.remainingMinutes} 分钟`,
        body: payload.title,
        silent: false
      })
      notification.on('click', () => {
        const current = this.getWindow()
        if (!current || current.isDestroyed()) return
        if (current.isMinimized()) current.restore()
        current.show()
        current.focus()
        current.webContents.send(IPC_CHANNELS.reminderPresented, payload)
      })
      notification.show()
    } catch {
      this.logger.failure('reminder.delivered', 'E_NOTIFICATION_DENIED', 0)
    }
  }
}