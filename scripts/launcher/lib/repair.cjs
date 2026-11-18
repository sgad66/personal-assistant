// @ts-check
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { describe } = require('./messages.cjs')
const { probeDeps, probeBinary, probeArtifacts } = require('./env-probe.cjs')
const { countdown } = require('./ui.cjs')
const { log } = require('./logger.cjs')

const INSTALL_TIMEOUT_MS = 30 * 60 * 1000
const BINARY_TIMEOUT_MS = 10 * 60 * 1000
const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const FALLBACK_MIRROR = 'https://npmmirror.com/mirrors/electron/'

// 硬约束自检锚点：修复模块只允许官方安装与既有构建入口
const FORBIDDEN_PATTERNS = ['ci', 'audit fix', 'update -g', 'registry=']

/**
 * @typedef {object} RepairResult
 * @property {boolean} ok
 * @property {string} [code]
 * @property {string} detail
 * @property {boolean} [cancelled]
 */

/**
 * @param {string} root
 * @param {string} key
 * @returns {string | undefined}
 */
function readNpmrcValue(root, key) {
  try {
    const text = fs.readFileSync(path.join(root, '.npmrc'), 'utf-8')
    for (const line of text.split(/\r?\n/)) {
      const index = line.indexOf('=')
      if (index > 0 && line.slice(0, index).trim() === key) {
        return line.slice(index + 1).trim()
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv }} options
 * @returns {{ ok: boolean, timedOut: boolean, output: string }}
 */
function runCommand(command, args, options) {
  try {
    const output = execFileSync(command, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      encoding: 'utf-8',
      windowsHide: true,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { ok: true, timedOut: false, output: String(output).slice(-2000) }
  } catch (error) {
    const timedOut = Boolean(error && typeof error === 'object' && error.killed)
    return {
      ok: false,
      timedOut,
      output: error instanceof Error ? error.message : '命令执行失败'
    }
  }
}

/**
 * @param {string} root
 * @param {{ autoInstall?: boolean, onHeartbeat?: (text: string) => void }} [options]
 * @returns {Promise<RepairResult>}
 */
async function repairDeps(root, options) {
  const started = Date.now()
  if (options && options.autoInstall === false) {
    return { ok: false, code: 'E_LAUNCH_DEPS_MISSING', detail: '已关闭自动安装，请手动执行依赖安装' }
  }
  console.log('首次运行需要安装依赖，预计 3-10 分钟，请勿关闭窗口')
  const proceed = await countdown(10, true)
  if (!proceed) {
    return { ok: false, cancelled: true, detail: '已取消依赖安装' }
  }
  console.log('正在安装依赖，请稍候…')
  const result = runCommand('cmd.exe', ['/d', '/c', 'npm.cmd install --no-audit --no-fund'], {
    cwd: root,
    timeoutMs: INSTALL_TIMEOUT_MS
  })
  const durationMs = Date.now() - started
  log(root, { phase: '修复', item: '依赖安装', result: result.ok ? '已修复' : '失败', durationMs, detail: result.timedOut ? '安装超时' : '' })
  if (result.timedOut) {
    return { ok: false, code: 'E_LAUNCH_INSTALL_TIMEOUT', detail: '依赖安装超时' }
  }
  if (!result.ok) {
    return { ok: false, code: 'E_LAUNCH_DEPS_MISSING', detail: '依赖安装失败' }
  }
  const check = probeDeps(root)
  if (check.result !== 'pass') {
    return { ok: false, code: 'E_LAUNCH_DEPS_MISSING', detail: check.detail || '依赖仍不完整' }
  }
  return { ok: true, detail: '依赖安装完成' }
}

/**
 * @param {string} root
 * @param {{ autoRepairBinary?: boolean }} [options]
 * @returns {Promise<RepairResult>}
 */
async function repairBinary(root, options) {
  const started = Date.now()
  if (options && options.autoRepairBinary === false) {
    return {
      ok: false,
      code: 'E_LAUNCH_ELECTRON_BINARY_MISSING',
      detail: '已关闭自动修复，请手动补齐 Electron 运行文件'
    }
  }
  const installer = path.join(root, 'node_modules', 'electron', 'install.js')
  if (!fs.existsSync(installer)) {
    return { ok: false, code: 'E_LAUNCH_ELECTRON_BINARY_MISSING', detail: '未找到依赖自带安装脚本' }
  }
  console.log('正在修复 Electron 运行文件，约 1-5 分钟…')
  const projectMirror = readNpmrcValue(root, 'electron_mirror')
  const mirror = projectMirror || FALLBACK_MIRROR
  const source = projectMirror ? 'project' : 'convention'
  const env = { ...process.env, ELECTRON_MIRROR: mirror, npm_config_electron_mirror: mirror }
  const result = runCommand(process.execPath, [installer], { cwd: root, timeoutMs: BINARY_TIMEOUT_MS, env })
  const durationMs = Date.now() - started
  log(root, {
    phase: '修复',
    item: '运行文件修复',
    result: result.ok ? '已修复' : '失败',
    durationMs,
    detail: `mirror_source=${source}`
  })
  if (!result.ok) {
    return {
      ok: false,
      code: 'E_LAUNCH_ELECTRON_BINARY_MISSING',
      detail: result.timedOut ? '运行文件下载超时' : '运行文件修复失败'
    }
  }
  const check = probeBinary(root)
  if (check.result !== 'pass') {
    return { ok: false, code: 'E_LAUNCH_ELECTRON_BINARY_MISSING', detail: check.detail || '运行文件仍缺失' }
  }
  return { ok: true, detail: '运行文件修复完成' }
}

/**
 * @param {string} root
 * @returns {Promise<RepairResult>}
 */
async function buildArtifacts(root) {
  const started = Date.now()
  const entry = path.join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
  if (!fs.existsSync(entry)) {
    return { ok: false, code: 'E_LAUNCH_BUILD_INCOMPLETE', detail: '未找到构建入口' }
  }
  console.log('正在构建应用，预计 1-10 分钟…')
  const result = runCommand(process.execPath, [entry, 'build'], { cwd: root, timeoutMs: BUILD_TIMEOUT_MS })
  const durationMs = Date.now() - started
  log(root, {
    phase: '修复',
    item: '构建产物补齐',
    result: result.ok ? '已修复' : '失败',
    durationMs,
    detail: result.ok ? '' : '构建未完成'
  })
  if (!result.ok) {
    return { ok: false, code: 'E_LAUNCH_BUILD_INCOMPLETE', detail: '构建失败或超时' }
  }
  const check = probeArtifacts(root)
  if (check.result !== 'pass') {
    return { ok: false, code: 'E_LAUNCH_BUILD_INCOMPLETE', detail: check.detail || '构建产物仍不完整' }
  }
  return { ok: true, detail: '构建完成' }
}

module.exports = {
  repairDeps,
  repairBinary,
  buildArtifacts,
  FORBIDDEN_PATTERNS,
  readNpmrcValue,
  describe
}