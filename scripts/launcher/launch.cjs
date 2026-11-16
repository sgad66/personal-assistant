// @ts-check
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { CONTRACT_VERSION, LAUNCHER_VERSION, LOG_DIR, describe } = require('./lib/messages.cjs')
const { load } = require('./lib/config.cjs')
const { probeAll, deriveMode } = require('./lib/env-probe.cjs')
const { findFreePort, parsePort } = require('./lib/port-probe.cjs')
const { repairDeps, repairBinary, buildArtifacts } = require('./lib/repair.cjs')
const { read, writeAtomic, clear, evaluate, describeSuppression, idleMark } = require('./lib/state-mark.cjs')
const { isPidAlive, snapshotElectronPids, findNewMainPid, hasWindowTitle, waitForWindow } = require('./lib/process-observe.cjs')
const { log, logPath, rotate } = require('./lib/logger.cjs')
const { section, item, line, waitAnyKey, sleep } = require('./lib/ui.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const WINDOW_TITLE = 'AI 日程助手'

/**
 * @typedef {object} LaunchArgs
 * @property {'auto' | 'dev' | 'prod'} mode
 * @property {boolean} debugWindow
 * @property {boolean} noPause
 * @property {boolean} contractVersion
 */

/**
 * @param {string[]} argv
 * @returns {LaunchArgs}
 */
function parseArgs(argv) {
  /** @type {LaunchArgs} */
  const args = { mode: 'auto', debugWindow: false, noPause: false, contractVersion: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--mode') {
      const next = argv[index + 1]
      if (next === 'dev' || next === 'prod' || next === 'auto') {
        args.mode = next
        index += 1
      }
    } else if (value === '--debug-window') {
      args.debugWindow = true
    } else if (value === '--no-pause') {
      args.noPause = true
    } else if (value === '--contract-version') {
      args.contractVersion = true
    }
  }
  return args
}

/**
 * @param {string} result
 * @returns {string}
 */
function resultText(result) {
  const names = { pass: '通过', missing: '缺失', incomplete: '不完整', blocked: '阻断', unknown: '未知', skip: '跳过' }
  return names[result] || '未知'
}

/**
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
function httpReady(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (response) => {
      response.resume()
      const status = response.statusCode || 0
      resolve(status >= 200 && status < 300)
    })
    request.on('error', () => resolve(false))
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
  })
}

/**
 * @param {string} root
 * @param {string} kind
 * @returns {string}
 */
function openDevLog(root, kind) {
  const now = new Date()
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0')
  const name = `${kind}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.log`
  const dir = path.join(root, LOG_DIR)
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, name)
}

/**
 * @param {string} file
 * @returns {number | null}
 */
function readPortFromLog(file) {
  try {
    const text = fs.readFileSync(file, 'utf-8')
    return parsePort(text).port
  } catch {
    return null
  }
}

/**
 * @param {string} code
 * @param {string} root
 * @param {boolean} noPause
 */
async function fail(code, root, noPause) {
  const meta = describe(code)
  console.log('')
  console.log(`错误码：${code}`)
  console.log(`原因：${meta.message}`)
  console.log(`建议：${meta.suggestion}`)
  console.log(`日志：${path.resolve(logPath(root, 'launch'))}`)
  log(root, { phase: '失败', item: '启动', result: '失败', code, detail: meta.message })
  await waitAnyKey({ noPause })
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.contractVersion) {
    console.log(`LAUNCHER_VERSION=${LAUNCHER_VERSION}`)
    console.log(`CONTRACT=${CONTRACT_VERSION}`)
    return 0
  }

  const root = ROOT
  const { config, warnings } = load(root, { defaultMode: args.mode, debugWindow: args.debugWindow })
  rotate(root, { retentionDays: config.logRetentionDays, maxFiles: config.logMaxFiles })
  section('AI 日程助手启动器')
  line(`版本 ${LAUNCHER_VERSION} · 契约 ${CONTRACT_VERSION}`)
  for (const warning of warnings) line(`提示：${warning}`)

  const now = Date.now()
  const mark = read(root)
  const status = evaluate(mark, now, isPidAlive)

  if (status === 'starting') {
    const suppression = describeSuppression(mark, now)
    line(suppression.text)
    await sleep(suppression.waitSeconds)
    return 1
  }
  if (status === 'running') {
    line('应用已经在运行，正在尝试唤起已有窗口…')
    const woken = await waitForWindow(root, WINDOW_TITLE, 8000)
    log(root, { phase: '启动', item: '重复双击', result: woken ? '通过' : '失败', code: woken ? '' : 'E_LAUNCH_ALREADY_RUNNING' })
    if (woken) {
      line('已唤起应用窗口')
      return 0
    }
    await fail('E_LAUNCH_ALREADY_RUNNING', root, args.noPause)
    return 1
  }
  if (status === 'stale') {
    clear(root)
  }

  writeAtomic(root, {
    ...idleMark(now),
    state: 'starting',
    pid: 0,
    devServerPid: 0,
    startedAt: now,
    mode: args.mode,
    launcherVersion: LAUNCHER_VERSION
  })

  section('环境检测')
  const report = await probeAll({ root, mode: 'launch', startPort: config.portRange, portCount: 5 })
  for (const probe of report.items) {
    item(probe.order, probe.name, resultText(probe.result))
    log(root, {
      phase: '检测',
      item: probe.name,
      result: probe.result === 'pass' ? '通过' : probe.result === 'missing' ? '缺失' : probe.result === 'unknown' ? '未知' : '失败',
      code: probe.code || '',
      durationMs: probe.durationMs || 0,
      detail: probe.detail || ''
    })
  }

  let repaired = false
  const depsItem = report.items.find((entry) => entry.order === 4)
  if (depsItem && depsItem.result === 'missing') {
    const result = await repairDeps(root, { autoInstall: config.autoInstall })
    if (result.cancelled) {
      clear(root)
      await fail('E_LAUNCH_DEPS_MISSING', root, args.noPause)
      return 2
    }
    if (!result.ok) {
      clear(root)
      await fail(result.code || 'E_LAUNCH_DEPS_MISSING', root, args.noPause)
      return 2
    }
    repaired = true
  }
  const binaryItem = report.items.find((entry) => entry.order === 5)
  if (binaryItem && binaryItem.result === 'missing') {
    const result = await repairBinary(root, { autoRepairBinary: config.autoRepairBinary })
    if (!result.ok) {
      clear(root)
      await fail(result.code || 'E_LAUNCH_ELECTRON_BINARY_MISSING', root, args.noPause)
      return 2
    }
    repaired = true
  }

  const finalReport = repaired ? await probeAll({ root, mode: 'launch', startPort: config.portRange, portCount: 5 }) : report
  const derived = deriveMode(finalReport)

  let mode = args.mode === 'auto' ? derived.mode : args.mode
  if (mode === 'blocked') {
    clear(root)
    const code = derived.reason.includes('端口') ? 'E_LAUNCH_PORT_IN_USE' : 'E_LAUNCH_SELFCHECK_BLOCKED'
    await fail(code, root, args.noPause)
    return 2
  }
  if (mode === 'repair') {
    clear(root)
    await fail('E_LAUNCH_DEPS_MISSING', root, args.noPause)
    return 2
  }

  const artifactsItem = finalReport.items.find((entry) => entry.order === 6)
  if (mode === 'prod' && artifactsItem && artifactsItem.result === 'incomplete') {
    const built = await buildArtifacts(root)
    if (!built.ok) {
      clear(root)
      await fail('E_LAUNCH_BUILD_INCOMPLETE', root, args.noPause)
      return 2
    }
  }

  const modeLabel = mode === 'prod' ? '生产模式' : '开发模式'
  const reason = mode === 'prod' ? '构建产物完整' : derived.reason
  section('启动模式')
  line(`启动模式：${modeLabel}（原因：${reason}）`)
  log(root, { phase: '模式选择', item: '启动模式', result: '通过', detail: `${modeLabel}：${reason}` })

  const portResult = await findFreePort(config.portRange, 5)
  if (mode === 'dev' && portResult.port === null) {
    clear(root)
    await fail('E_LAUNCH_PORT_IN_USE', root, args.noPause)
    return 2
  }
  const port = portResult.port || config.portRange

  const started = await startApplication(root, mode, port)
  const ready = await waitReady(root, mode, port, started, config.launchTimeoutSec * 1000)

  if (!ready.ok) {
    if (mode === 'prod') {
      line('生产模式启动失败，已自动改用开发模式')
      log(root, { phase: '启动', item: '模式回退', result: '失败', code: 'E_LAUNCH_START_FAILED', detail: '生产失败，回退开发模式一次' })
      const devPort = await findFreePort(config.portRange, 5)
      if (devPort.port === null) {
        clear(root)
        await fail('E_LAUNCH_PORT_IN_USE', root, args.noPause)
        return 2
      }
      const devStarted = await startApplication(root, 'dev', devPort.port)
      const devReady = await waitReady(root, 'dev', devPort.port, devStarted, 120000)
      if (!devReady.ok) {
        clear(root)
        await fail('E_LAUNCH_START_FAILED', root, args.noPause)
        return 2
      }
      writeRunning(root, devStarted.pid, devReady.mainPid, now, 'dev', devPort.port, true)
      section('启动成功')
      line('应用已启动')
      await finish(args.debugWindow)
      return 0
    }
    clear(root)
    await fail(ready.code || 'E_LAUNCH_START_FAILED', root, args.noPause)
    return 2
  }

  writeRunning(root, started.pid, ready.mainPid, now, mode, port, false)
  section('启动成功')
  line('应用已启动')
  log(root, { phase: '成功', item: '启动', result: '通过', detail: `${modeLabel}，端口 ${port}` })
  await finish(args.debugWindow)
  return 0
}

/**
 * @param {boolean} debugWindow
 * @returns {Promise<void>}
 */
async function finish(debugWindow) {
  if (debugWindow) {
    await waitAnyKey({})
    return
  }
  await sleep(3)
}

/**
 * @param {string} root
 * @param {'dev' | 'prod'} mode
 * @param {number} port
 * @returns {Promise<{ pid: number, logFile?: string, beforePids: number[] }>}
 */
async function startApplication(root, mode, port) {
  const before = snapshotElectronPids()
  if (mode === 'dev') {
    const entry = path.join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
    const logFile = openDevLog(root, 'dev')
    const out = fs.openSync(logFile, 'a')
    const child = spawn(process.execPath, [entry, 'dev'], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', out, out]
    })
    child.unref()
    log(root, { phase: '启动', item: '开发服务', result: '通过', detail: `端口 ${port}` })
    return { pid: child.pid || 0, logFile, beforePids: before.pids }
  }
  const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  // windowsHide 必须为 false：带 CREATE_NO_WINDOW 拉起 Electron 时，主窗口会被创建但始终不显示
  const child = spawn(exe, [root], { cwd: root, detached: true, windowsHide: false, stdio: 'ignore' })
  child.unref()
  log(root, { phase: '启动', item: '生产进程', result: '通过', detail: `端口 ${port}` })
  return { pid: child.pid || 0, beforePids: before.pids }
}

/**
 * @param {string} root
 * @param {'dev' | 'prod'} mode
 * @param {number} port
 * @param {{ pid: number, logFile?: string, beforePids: number[] }} started
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, code?: string, mainPid?: number }>}
 */
async function waitReady(root, mode, port, started, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const actualPort = started.logFile ? readPortFromLog(started.logFile) : null
    const targetPort = actualPort || port
    const serviceReady = mode === 'prod' ? true : await httpReady(targetPort)
    if (serviceReady) {
      const after = snapshotElectronPids()
      const newPid = findNewMainPid({ pids: started.beforePids }, after)
      if (mode === 'dev' && newPid !== null && isPidAlive(newPid)) {
        const title = hasWindowTitle(WINDOW_TITLE)
        if (title === 'hit') {
          log(root, { phase: '等待', item: '就绪判据', result: '通过', detail: `L1+L2+L3 port=${targetPort}` })
          return { ok: true, mainPid: newPid }
        }
        if (title === 'unavailable') {
          await sleep(5)
          if (isPidAlive(newPid)) {
            log(root, { phase: '等待', item: '就绪判据', result: '通过', detail: `L1+L2 title_probe=unavailable port=${targetPort}` })
            return { ok: true, mainPid: newPid }
          }
        }
      }
      if (mode === 'prod') {
        const windowHit = await waitForWindow(root, WINDOW_TITLE, 15000)
        if (windowHit || (newPid !== null && isPidAlive(newPid))) {
          log(root, { phase: '等待', item: '就绪判据', result: '通过', detail: '生产窗口就绪' })
          return { ok: true, mainPid: newPid || 0 }
        }
      }
    }
    await sleep(2)
  }
  log(root, { phase: '等待', item: '就绪判据', result: '超时', code: 'E_LAUNCH_TIMEOUT' })
  return { ok: false, code: 'E_LAUNCH_TIMEOUT' }
}

/**
 * @param {string} root
 * @param {number} pid
 * @param {number} mainPid
 * @param {number} startedAt
 * @param {'dev' | 'prod'} mode
 * @param {number} port
 * @param {boolean} fallbackUsed
 */
function writeRunning(root, pid, mainPid, startedAt, mode, port, fallbackUsed) {
  writeAtomic(root, {
    ...idleMark(Date.now()),
    state: 'running',
    pid: mainPid || pid,
    devServerPid: mode === 'dev' ? pid : 0,
    startedAt,
    mode,
    port,
    fallbackUsed,
    launcherVersion: LAUNCHER_VERSION
  })
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(() => {
    clear(ROOT)
    console.log('错误码：E_LAUNCH_START_FAILED')
    console.log('原因：启动器内部异常')
    console.log('建议：查看日志后重试')
    console.log(`日志：${path.resolve(logPath(ROOT, 'launch'))}`)
    log(ROOT, { phase: '失败', item: '启动器', result: '失败', code: 'E_LAUNCH_START_FAILED', detail: '内部异常' })
    process.exitCode = 3
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 10)
  })