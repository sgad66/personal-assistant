import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray } from 'electron'
import { join } from 'node:path'
import { createAppContext } from './app-context'
import { registerIpcHandlers } from './ipc/handlers'
import { Notifier } from './reminder/notifier'
import { IPC_CHANNELS } from '@shared/ipc-contracts'
import { PlainFileVault, type ICredentialVault } from './ai/credential-vault'
import { SafeStorageVault } from './ai/safe-storage-vault'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let closeToTray = true
let splashStartedAt = 0

const TRAY_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABjSURBVFhH7c6xCQAhFINh57lR3MqJrnMBy9viFtFeQUIUbf4HaR4kfCHHp95M6B+nAwDAFFDevy7dl4bNPgB0gDDmdAAA0AHOAdgKEMacDgAAOsA5AFsBwpjTmQJOBACA64AGPZAyNWzs46oAAAAASUVORK5CYII='
let context: ReturnType<typeof createAppContext> | null = null

const SPLASH_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; overflow: hidden;
    background: #f3f0e8; color: #1b1915;
    font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
    -webkit-user-select: none;
  }
  .card { position: relative; height: 100%; padding: 36px 38px 28px; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; }
  .halo { position: absolute; right: -80px; top: -100px; width: 280px; height: 280px; border-radius: 50%; background: radial-gradient(circle, rgba(182, 74, 42, 0.18), transparent 68%); }
  .top { position: relative; display: flex; align-items: center; gap: 12px; }
  .mark { width: 44px; height: 44px; border-radius: 13px; background: #b64a2a; color: #fffaf3; display: grid; place-items: center; font-family: Georgia, "Songti SC", serif; font-size: 21px; font-weight: 600; box-shadow: 0 10px 24px rgba(182, 74, 42, 0.18); animation: pop 600ms cubic-bezier(0.22, 0.8, 0.3, 1) both; }
  .brand { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
  .sub { margin-top: 2px; font-size: 8.5px; letter-spacing: 0.2em; color: #7a7264; }
  .mid { position: relative; }
  .quote { margin-bottom: 18px; font-size: 19px; font-weight: 600; letter-spacing: -0.02em; color: #14120f; animation: fade 700ms 120ms ease both; }
  .line { height: 2px; width: 100%; border-radius: 999px; background: rgba(27, 25, 21, 0.09); overflow: hidden; }
  .line span { display: block; height: 100%; width: 0; border-radius: 999px; background: #b64a2a; animation: load 1150ms 100ms cubic-bezier(0.4, 0, 0.2, 1) forwards; }
  .foot { position: relative; display: flex; justify-content: space-between; font-size: 10px; color: #6b6355; letter-spacing: 0.02em; }
  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(0.92); } to { opacity: 1; transform: none; } }
  @keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes load { to { width: 100%; } }
</style>
</head>
<body>
  <div class="card">
    <div class="halo"></div>
    <div class="top">
      <div class="mark">日</div>
      <div>
        <div class="brand">AI 日程助手</div>
        <div class="sub">PERSONAL ASSISTANT</div>
      </div>
    </div>
    <div class="mid">
      <div class="quote">把要记住的事，交给今天。</div>
      <div class="line"><span></span></div>
    </div>
    <div class="foot"><span>本机存储 · 提前十分钟提醒</span><span>正在启动</span></div>
  </div>
</body>
</html>`

const MINI_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; background: transparent; overflow: hidden;
    font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
    color: #f4efe4; -webkit-user-select: none;
  }
  .card {
    position: relative; display: flex; flex-direction: column; gap: 7px;
    height: 100%; padding: 15px 17px 14px; border-radius: 18px;
    background: #1b1915; border: 1px solid rgba(244, 239, 228, 0.14);
    box-shadow: 0 22px 55px rgba(0, 0, 0, 0.32);
    -webkit-app-region: drag; overflow: hidden;
  }
  .halo { position: absolute; right: -40px; top: -60px; width: 160px; height: 160px; border-radius: 50%; background: radial-gradient(circle, rgba(182, 74, 42, 0.35), transparent 68%); }
  .top { position: relative; display: flex; align-items: center; gap: 8px; }
  .mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: #b64a2a; color: #fffaf3; font-family: Georgia, "Songti SC", serif; font-size: 15px; font-weight: 600; }
  .brand { font-size: 12px; font-weight: 600; letter-spacing: -0.01em; }
  .meta { font-size: 9px; color: #a89f8f; }
  .status { display: flex; align-items: center; gap: 5px; margin-left: auto; font-size: 9px; color: #c8bfae; }
  .dot { width: 5px; height: 5px; border-radius: 50%; background: #8fd3b4; box-shadow: 0 0 0 2px rgba(143, 211, 180, 0.2); }
  .clock { position: relative; margin-top: 3px; font-family: Georgia, "Times New Roman", serif; font-size: 31px; line-height: 1; letter-spacing: -0.04em; }
  .next { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10.5px; color: #d9d2c2; margin-top: auto; }
  .open {
    position: absolute; right: 14px; bottom: 13px;
    height: 26px; padding: 0 10px; border: 0; border-radius: 999px;
    background: #b64a2a; color: #fffaf3; font-size: 10px; font-weight: 600;
    cursor: pointer; -webkit-app-region: no-drag;
  }
  .open:hover { background: #d96a45; }
</style>
</head>
<body>
  <div class="card">
    <div class="halo"></div>
    <div class="top">
      <div class="mark">日</div>
      <div><div class="brand">AI 日程助手</div><div class="meta">常驻右下角</div></div>
      <div class="status"><span class="dot"></span><span id="count">今天</span></div>
    </div>
    <div class="clock" id="clock">--:--</div>
    <div class="meta" id="date"></div>
    <div class="next" id="next">正在读取日程…</div>
    <button class="open" id="open">打开主窗口</button>
  </div>
  <script>
    (function () {
      function two(value) { return String(value).padStart(2, '0'); }
      function tick() {
        var now = new Date();
        document.getElementById('clock').textContent = two(now.getHours()) + ':' + two(now.getMinutes());
        var weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
        document.getElementById('date').textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 · ' + weekday;
      }
      tick();
      setInterval(tick, 30000);

      document.getElementById('open').addEventListener('click', function () {
        window.pa.desktop.showMain();
      });

      async function load() {
        try {
          var home = await window.pa.app.bootstrap({ contractVersion: window.paContractVersion });
          var week = await window.pa.schedule.week({ weekStart: home.currentWeekStart });
          var today = week.days.filter(function (day) { return day.isToday; })[0];
          var items = today ? today.items : [];
          document.getElementById('count').textContent = '今天 ' + items.length + ' 项';
          var now = Date.now();
          var next = items.filter(function (item) { return item.timeLabel === 'timed' && item.startAt > now; }).sort(function (a, b) { return a.startAt - b.startAt; })[0];
          if (next) {
            var start = new Date(next.startAt);
            document.getElementById('next').textContent = two(start.getHours()) + ':' + two(start.getMinutes()) + ' ' + next.title;
          } else {
            document.getElementById('next').textContent = items.length > 0 ? '今天的安排已经结束' : '今天还没有安排';
          }
        } catch (error) {
          document.getElementById('next').textContent = '打开主窗口查看日程';
        }
      }
      load();
    })();
  </script>
</body>
</html>`

const customUserData = process.env.PA_USER_DATA?.trim()
if (customUserData) {
  app.setPath('userData', customUserData)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function createSplashWindow(): void {
  splashStartedAt = Date.now()
  const splash = new BrowserWindow({
    width: 440,
    height: 320,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#f3f0e8',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  splashWindow = splash
  splash.once('ready-to-show', () => {
    if (!splash.isDestroyed()) splash.show()
  })
  splash.on('closed', () => {
    if (splashWindow === splash) splashWindow = null
  })
  void splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML))
}

function revealWindow(window: BrowserWindow): void {
  const override = Number.parseInt(process.env.PA_SPLASH_MS ?? '', 10)
  const minimum = Number.isFinite(override) && override > 0 ? override : 900
  const wait = Math.max(0, minimum - (Date.now() - splashStartedAt))
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
      splashWindow = null
    }
    if (!window.isDestroyed()) {
      window.show()
      window.focus()
    }
  }, wait)
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: process.env.PA_WINDOW_TITLE?.trim() || 'AI 日程助手',
    backgroundColor: '#f3f0e8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  let revealed = false
  const reveal = (): void => {
    if (revealed) return
    revealed = true
    revealWindow(window)
  }
  window.once('ready-to-show', reveal)
  setTimeout(reveal, 8_000)

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

function createMiniWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 180,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const area = screen.getPrimaryDisplay().workArea
  win.setPosition(area.x + area.width - 336, area.y + area.height - 196)
  win.setAlwaysOnTop(true, 'floating')
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  win.on('closed', () => {
    if (miniWindow === win) miniWindow = null
  })
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(MINI_HTML))
  return win
}

function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromDataURL(TRAY_ICON)
  tray = new Tray(icon)
  tray.setToolTip('AI 日程助手')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开主窗口', click: () => showMainWindow() },
      { label: '小窗模式', click: () => showMiniWindow() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
  )
  tray.on('click', () => showMainWindow())
}

function hideToTray(): void {
  createTray()
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
}

function showMiniWindow(): void {
  createTray()
  if (!miniWindow || miniWindow.isDestroyed()) {
    miniWindow = createMiniWindow()
  } else {
    const area = screen.getPrimaryDisplay().workArea
    miniWindow.setPosition(area.x + area.width - 336, area.y + area.height - 196)
    miniWindow.show()
    miniWindow.focus()
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
}

function showMainWindow(): void {
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide()
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
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

  ipcMain.handle(IPC_CHANNELS.desktopHideToTray, () => {
    hideToTray()
    return undefined
  })

  ipcMain.handle(IPC_CHANNELS.desktopSetCloseToTray, (_event, enabled: unknown) => {
    closeToTray = enabled !== false
    return undefined
  })

  ipcMain.handle(IPC_CHANNELS.desktopShowMini, () => {
    showMiniWindow()
    return undefined
  })

  ipcMain.handle(IPC_CHANNELS.desktopShowMain, () => {
    showMainWindow()
    return undefined
  })

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

  createSplashWindow()
  mainWindow = createWindow()
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('close', (event) => {
    if (isQuitting || !closeToTray) return
    event.preventDefault()
    hideToTray()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    const expired = ctx.scheduler.emitExpiredSummary()
    if (expired > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.expiredSummary, { startedEventCount: expired })
    }
    ctx.scheduler.start(15_000)
  })

  app.on('second-instance', () => {
    showMainWindow()
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
  isQuitting = true
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close()
  if (tray && !tray.isDestroyed()) tray.destroy()
  if (context) {
    context.scheduler.stop()
    context.tempFiles.releaseAll()
    context.store.close()
  }
})