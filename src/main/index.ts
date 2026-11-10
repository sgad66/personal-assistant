import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createAppContext } from './app-context'
import { registerIpcHandlers } from './ipc/handlers'
import { Notifier } from './reminder/notifier'
import { IPC_CHANNELS } from '@shared/ipc-contracts'
import { PlainFileVault, type ICredentialVault } from './ai/credential-vault'
import { SafeStorageVault } from './ai/safe-storage-vault'

let mainWindow: BrowserWindow | null = null
let context: ReturnType<typeof createAppContext> | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'AI 日程助手',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('focus', () => {
    window.webContents.send(IPC_CHANNELS.desktopPresence, 'foreground')
  })
  window.on('blur', () => {
    window.webContents.send(IPC_CHANNELS.desktopPresence, 'background')
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

function bootstrapApp(): void {
  const userDataDir = app.getPath('userData')
  let vault: ICredentialVault = new PlainFileVault()
  try {
    const safeVault = new SafeStorageVault()
    if (safeVault.isUsable) vault = safeVault
  } catch {
    vault = new PlainFileVault()
  }
  context = createAppContext({ userDataDir, vault })
  const ctx = context
  const notifier = new Notifier(() => mainWindow, ctx.logger)

  registerIpcHandlers(ctx)

  ctx.events.on('ai-config-changed', (notice: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.aiConfigChanged, notice)
    }
  })

  ctx.events.on('schedule-changed', (notice: { revision: number; affectedWeekStarts: number[] }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.scheduleChanged, notice)
    }
  })

  ctx.events.on('reminder-poll', () => {
    ctx.scheduler.pollNow()
  })

  ctx.events.on('reminder-presented', (payload) => {
    notifier.present(payload)
  })

  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.on('did-finish-load', () => {
    const expired = ctx.scheduler.emitExpiredSummary()
    if (expired > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.expiredSummary, { startedEventCount: expired })
    }
    ctx.scheduler.start(15_000)
  })

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

app.whenReady().then(bootstrapApp).catch(() => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (context) {
    context.scheduler.stop()
    context.tempFiles.releaseAll()
    context.store.close()
  }
})