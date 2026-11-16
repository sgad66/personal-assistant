// @ts-check
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { findFreePort } = require('./port-probe.cjs')

const REQUIRED_DEPS = ['electron', 'electron-vite', 'vite', 'react', 'react-dom']

/**
 * @typedef {'pass' | 'blocked' | 'missing' | 'incomplete' | 'unknown' | 'skip'} ProbeResult
 */

/**
 * @typedef {object} ProbeItem
 * @property {number} order
 * @property {string} name
 * @property {ProbeResult} result
 * @property {string} [code]
 * @property {string} [detail]
 * @property {number} [durationMs]
 */

/**
 * @typedef {object} ProbeReport
 * @property {string} detectedAt
 * @property {ProbeItem[]} items
 * @property {'ready' | 'repairable' | 'blocked'} summary
 * @property {'prod' | 'dev' | 'repair' | 'blocked'} selectedMode
 * @property {string} reason
 * @property {number | null} selectedPort
 * @property {number | null} actualPort
 */

/**
 * @typedef {object} OsInput
 * @property {string} [platform]
 * @property {string} [release]
 * @property {string} [arch]
 * @property {string} [osVar]
 * @property {string} [archW6432]
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {string}
 */
function runSafe(command, args, timeoutMs) {
  try {
    return execFileSync(command, args, { timeout: timeoutMs, encoding: 'utf-8', windowsHide: true }).trim()
  } catch {
    return ''
  }
}

/**
 * @param {number} major
 * @param {number} minor
 * @returns {boolean}
 */
function atLeastWindows10(major, minor) {
  return major > 10 || (major === 10 && minor >= 0)
}

/**
 * @param {OsInput} [input]
 * @returns {{ result: ProbeResult, code?: string, detail?: string }}
 */
function probeOs(input) {
  const platform = input && input.platform ? input.platform : process.platform
  const release = input && input.release ? input.release : os.release()
  const arch = input && input.arch ? input.arch : os.arch()
  const osVar = input && input.osVar !== undefined ? input.osVar : process.env.OS
  const archW6432 = input && input.archW6432 !== undefined ? input.archW6432 : process.env.PROCESSOR_ARCHITEW6432

  if (platform !== 'win32' || (osVar !== undefined && osVar !== 'Windows_NT')) {
    return { result: 'blocked', code: 'E_LAUNCH_UNSUPPORTED_OS', detail: `platform=${platform}` }
  }
  const x64 = arch === 'x64' || (arch === 'ia32' && archW6432 === 'AMD64')
  if (!x64) {
    return { result: 'blocked', code: 'E_LAUNCH_UNSUPPORTED_OS', detail: `arch=${arch}` }
  }
  if (!release) {
    return { result: 'unknown', detail: '无法判定系统版本' }
  }
  const parsed = /^(\d+)\.(\d+)/.exec(release)
  if (!parsed) {
    return { result: 'unknown', detail: `release=${release}` }
  }
  const major = Number(parsed[1])
  const minor = Number(parsed[2])
  if (!atLeastWindows10(major, minor)) {
    return { result: 'blocked', code: 'E_LAUNCH_UNSUPPORTED_OS', detail: `release=${release}` }
  }
  return { result: 'pass', detail: `Windows ${release} ${arch}` }
}

/**
 * @param {{ version?: string, found?: boolean }} [input]
 * @returns {{ result: ProbeResult, code?: string, detail?: string }}
 */
function probeNode(input) {
  const version = input && input.version ? input.version : process.version
  const found = input && input.found !== undefined ? input.found : fs.existsSync(process.execPath)
  if (!found) {
    return { result: 'blocked', code: 'E_LAUNCH_NODE_MISSING', detail: '未找到 node 可执行文件' }
  }
  const parsed = /^v?(\d+)\./.exec(version)
  if (!parsed) {
    return { result: 'unknown', detail: `version=${version}` }
  }
  const major = Number(parsed[1])
  if (major < 18) {
    return { result: 'blocked', code: 'E_LAUNCH_NODE_VERSION_LOW', detail: `Node ${version}` }
  }
  return { result: 'pass', detail: `Node ${version}` }
}

/**
 * @param {{ version?: string, found?: boolean }} [input]
 * @returns {{ result: ProbeResult, code?: string, detail?: string }}
 */
function probeNpm(input) {
  if (input && input.version !== undefined) {
    const parsed = /^(\d+)\./.exec(input.version)
    if (!parsed) return { result: 'unknown', detail: `npm ${input.version}` }
    return Number(parsed[1]) >= 9
      ? { result: 'pass', detail: `npm ${input.version}` }
      : { result: 'blocked', code: 'E_LAUNCH_NPM_VERSION_LOW', detail: `npm ${input.version}` }
  }
  const whereCmd = runSafe('where', ['npm.cmd'], 2000)
  const whereExe = whereCmd ? '' : runSafe('where', ['npm.exe'], 2000)
  if (!whereCmd && !whereExe) {
    return { result: 'blocked', code: 'E_LAUNCH_NPM_MISSING', detail: '未找到 npm.cmd' }
  }
  const version = runSafe('cmd.exe', ['/d', '/c', 'npm.cmd -v'], 4000)
  if (!version) {
    return { result: 'blocked', code: 'E_LAUNCH_NPM_MISSING', detail: 'npm 版本读取失败' }
  }
  return probeNpm({ version })
}

/**
 * @param {string} root
 * @returns {{ result: ProbeResult, code?: string, detail?: string }}
 */
function probeDeps(root) {
  const missing = []
  for (const name of REQUIRED_DEPS) {
    const manifest = path.join(root, 'node_modules', name, 'package.json')
    if (!fs.existsSync(manifest)) {
      missing.push(name)
      continue
    }
    try {
      JSON.parse(fs.readFileSync(manifest, 'utf-8'))
    } catch {
      return { result: 'unknown', detail: `${name}/package.json 无法解析` }
    }
  }
  if (missing.length > 0) {
    return { result: 'missing', code: 'E_LAUNCH_DEPS_MISSING', detail: `缺少依赖：${missing.join('、')}` }
  }
  return { result: 'pass', detail: '5 个关键依赖齐全' }
}

/**
 * @param {string} root
 * @param {{ exists?: boolean, size?: number, pathTxt?: string }} [input]
 * @returns {{ result: ProbeResult, code?: string, detail?: string }}
 */
function probeBinary(root, input) {
  const binPath = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  const exists = input && input.exists !== undefined ? input.exists : fs.existsSync(binPath)
  let size = input && input.size !== undefined ? input.size : 0
  if (!input && exists) {
    try {
      size = fs.statSync(binPath).size
    } catch {
      size = 0
    }
  }
  if (!exists || size <= 1024 * 1024) {
    return {
      result: 'missing',
      code: 'E_LAUNCH_ELECTRON_BINARY_MISSING',
      detail: exists ? `文件过小（${size} 字节）` : '未找到 electron.exe'
    }
  }
  const pathTxt = path.join(root, 'node_modules', 'electron', 'path.txt')
  if (input && input.pathTxt !== undefined) {
    if (!input.pathTxt.includes('electron.exe')) {
      return { result: 'missing', code: 'E_LAUNCH_ELECTRON_BINARY_MISSING', detail: 'path.txt 指向异常' }
    }
  } else if (fs.existsSync(pathTxt)) {
    try {
      const content = fs.readFileSync(pathTxt, 'utf-8')
      if (content.trim().length > 0 && !content.includes('electron.exe')) {
        return { result: 'missing', code: 'E_LAUNCH_ELECTRON_BINARY_MISSING', detail: 'path.txt 指向异常' }
      }
    } catch {
      // 读取失败不作为缺失依据
    }
  }
  return { result: 'pass', detail: `electron.exe ${size} 字节` }
}

/**
 * @param {string} root
 * @param {{ missing?: string[] }} [input]
 * @returns {{ result: ProbeResult, code?: string, detail?: string }}
 */
function probeArtifacts(root, input) {
  if (input && input.missing) {
    if (input.missing.length === 0) return { result: 'pass', detail: '构建产物完整' }
    return {
      result: 'incomplete',
      code: 'E_LAUNCH_BUILD_INCOMPLETE',
      detail: `构建产物不完整（${describeMissing(input.missing)}）`
    }
  }
  const required = [
    { key: 'main', file: path.join(root, 'out', 'main', 'index.js') },
    { key: 'preload', file: path.join(root, 'out', 'preload', 'index.js') },
    { key: 'renderer', file: path.join(root, 'out', 'renderer', 'index.html') }
  ]
  const missing = []
  for (const entry of required) {
    try {
      const stat = fs.statSync(entry.file)
      if (!stat.isFile() || stat.size === 0) missing.push(entry.key)
    } catch {
      missing.push(entry.key)
    }
  }
  if (missing.length > 0) {
    return {
      result: 'incomplete',
      code: 'E_LAUNCH_BUILD_INCOMPLETE',
      detail: `构建产物不完整（${describeMissing(missing)}）`
    }
  }
  return { result: 'pass', detail: '构建产物完整' }
}

/**
 * @param {string[]} keys
 * @returns {string}
 */
function describeMissing(keys) {
  const names = { main: '主进程产物缺失', preload: '预加载产物缺失', renderer: '渲染产物缺失' }
  return keys.map((key) => names[key] || `${key} 缺失`).join('、')
}

/**
 * @param {ProbeReport} report
 * @returns {{ mode: 'prod' | 'dev' | 'repair' | 'blocked', reason: string }}
 */
function deriveMode(report) {
  const byOrder = (/** @type {number} */ order) => report.items.find((item) => item.order === order)
  const osItem = byOrder(1)
  const nodeItem = byOrder(2)
  const npmItem = byOrder(3)
  if (osItem && osItem.result === 'blocked') return { mode: 'blocked', reason: '当前系统不受支持' }
  if (nodeItem && nodeItem.result === 'blocked') return { mode: 'blocked', reason: 'Node.js 不可用或版本过低' }
  if (npmItem && npmItem.result === 'blocked') return { mode: 'blocked', reason: 'npm 不可用或版本过低' }
  const deps = byOrder(4)
  const binary = byOrder(5)
  if (deps && deps.result === 'missing') return { mode: 'repair', reason: '依赖不完整，需要安装' }
  if (binary && binary.result === 'missing') return { mode: 'repair', reason: 'Electron 运行文件缺失，需要修复' }
  const artifacts = byOrder(6)
  if (artifacts && artifacts.result === 'incomplete') {
    return { mode: 'dev', reason: artifacts.detail || '构建产物不完整' }
  }
  const port = byOrder(7)
  if (port && port.result === 'blocked') return { mode: 'blocked', reason: '开发端口全部被占用' }
  if (artifacts && artifacts.result === 'pass') return { mode: 'prod', reason: '构建产物完整' }
  return { mode: 'dev', reason: '按开发模式启动' }
}

/**
 * @param {ProbeItem[]} items
 * @returns {'ready' | 'repairable' | 'blocked'}
 */
function summarize(items) {
  if (items.some((item) => item.result === 'blocked' || item.result === 'unknown')) return 'blocked'
  const repairable = items.some(
    (item) => item.result === 'missing' || item.result === 'incomplete'
  )
  if (repairable) return 'repairable'
  return 'ready'
}

/**
 * @param {object} options
 * @param {string} options.root
 * @param {'launch' | 'selfcheck'} options.mode
 * @param {number} [options.startPort]
 * @param {number} [options.portCount]
 * @param {Partial<Record<string, (input?: any) => any>>} [options.probes]
 * @returns {Promise<ProbeReport>}
 */
async function probeAll(options) {
  const root = options.root
  const mode = options.mode
  const startPort = options.startPort || 5173
  const portCount = options.portCount || 5
  const probes = options.probes || {}
  /** @type {ProbeItem[]} */
  const items = []

  const specs = [
    { order: 1, name: '操作系统', run: () => (probes.os ? probes.os() : probeOs()) },
    { order: 2, name: 'Node.js', run: () => (probes.node ? probes.node() : probeNode()) },
    { order: 3, name: 'npm', run: () => (probes.npm ? probes.npm() : probeNpm()) },
    { order: 4, name: '项目依赖', run: () => (probes.deps ? probes.deps() : probeDeps(root)) },
    { order: 5, name: 'Electron 运行文件', run: () => (probes.binary ? probes.binary() : probeBinary(root)) },
    { order: 6, name: '构建产物', run: () => (probes.artifacts ? probes.artifacts() : probeArtifacts(root)) },
    {
      order: 7,
      name: '开发端口',
      run: async () => {
        const found = probes.port ? await probes.port() : await findFreePort(startPort, portCount)
        if (found.port === null) {
          return { result: 'blocked', code: 'E_LAUNCH_PORT_IN_USE', detail: `已尝试 ${found.triedPorts.join('、')}` }
        }
        return { result: 'pass', detail: `端口 ${found.port} 可用`, port: found.port }
      }
    }
  ]

  for (const spec of specs) {
    const started = Date.now()
    let outcome
    try {
      outcome = await spec.run()
    } catch (error) {
      outcome = {
        result: 'unknown',
        detail: error instanceof Error ? error.message : '检测异常'
      }
    }
    const item = {
      order: spec.order,
      name: spec.name,
      result: outcome.result,
      ...(outcome.code ? { code: outcome.code } : {}),
      ...(outcome.detail ? { detail: outcome.detail } : {}),
      durationMs: Date.now() - started
    }
    items.push(item)
    if (mode === 'launch' && item.result === 'blocked') break
    if (mode === 'launch' && item.result === 'unknown') break
  }

  const portItem = items.find((item) => item.order === 7)
  const selectedPort = portItem && portItem.result === 'pass' ? extractPort(portItem.detail) : null
  /** @type {ProbeReport} */
  const report = {
    detectedAt: new Date().toISOString(),
    items,
    summary: summarize(items),
    selectedMode: 'dev',
    reason: '',
    selectedPort,
    actualPort: null
  }
  const derived = deriveMode(report)
  report.selectedMode = derived.mode
  report.reason = derived.reason
  return report
}

/**
 * @param {string | undefined} detail
 * @returns {number | null}
 */
function extractPort(detail) {
  if (!detail) return null
  const match = /端口\s*(\d+)/.exec(detail)
  return match ? Number(match[1]) : null
}

module.exports = {
  probeOs,
  probeNode,
  probeNpm,
  probeDeps,
  probeBinary,
  probeArtifacts,
  probeAll,
  deriveMode,
  summarize,
  REQUIRED_DEPS
}