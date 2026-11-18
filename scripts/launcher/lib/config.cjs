// @ts-check
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { CONFIG_FILE } = require('./messages.cjs')

/** @typedef {'auto' | 'dev' | 'prod'} LaunchMode */

/**
 * @typedef {object} LauncherConfig
 * @property {LaunchMode} defaultMode
 * @property {number} portRange
 * @property {boolean} autoInstall
 * @property {boolean} autoRepairBinary
 * @property {number} launchTimeoutSec
 * @property {number} selfCheckTimeoutSec
 * @property {number} logRetentionDays
 * @property {number} logMaxFiles
 * @property {string} shortcutName
 * @property {boolean} debugWindow
 */

/** @type {LauncherConfig} */
const DEFAULTS = {
  defaultMode: 'auto',
  portRange: 5173,
  autoInstall: true,
  autoRepairBinary: true,
  launchTimeoutSec: 180,
  selfCheckTimeoutSec: 10,
  logRetentionDays: 30,
  logMaxFiles: 20,
  shortcutName: 'AI 日程助手',
  debugWindow: false
}

const MODES = ['auto', 'dev', 'prod']

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {number | undefined}
 */
function toIntInRange(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  if (rounded < min || rounded > max) return undefined
  return rounded
}

/**
 * @param {number} basePort
 * @returns {number}
 */
function normalizePort(basePort) {
  if (basePort >= 1 && basePort <= 65000) return basePort
  return DEFAULTS.portRange
}

/**
 * @param {unknown} raw
 * @param {string[]} warnings
 * @returns {LauncherConfig}
 */
function normalize(raw, warnings) {
  /** @type {LauncherConfig} */
  const config = { ...DEFAULTS }
  if (typeof raw !== 'object' || raw === null) {
    warnings.push('配置读取失败，已使用默认配置')
    return config
  }
  const record = /** @type {Record<string, unknown>} */ (raw)

  if (record.defaultMode !== undefined) {
    if (typeof record.defaultMode === 'string' && MODES.includes(record.defaultMode)) {
      config.defaultMode = /** @type {LaunchMode} */ (record.defaultMode)
    } else {
      warnings.push('defaultMode 取值无效，已使用默认值 auto')
    }
  }
  if (record.portRange !== undefined) {
    const port = toIntInRange(record.portRange, 1024, 65000)
    if (port === undefined) warnings.push('portRange 取值无效，已使用默认值 5173')
    else config.portRange = normalizePort(port)
  }
  if (record.autoInstall !== undefined) {
    if (typeof record.autoInstall === 'boolean') config.autoInstall = record.autoInstall
    else warnings.push('autoInstall 取值无效，已使用默认值')
  }
  if (record.autoRepairBinary !== undefined) {
    if (typeof record.autoRepairBinary === 'boolean') config.autoRepairBinary = record.autoRepairBinary
    else warnings.push('autoRepairBinary 取值无效，已使用默认值')
  }
  if (record.launchTimeoutSec !== undefined) {
    const seconds = toIntInRange(record.launchTimeoutSec, 30, 600)
    if (seconds === undefined) warnings.push('launchTimeoutSec 超出 30~600，已使用默认值 180')
    else config.launchTimeoutSec = seconds
  }
  if (record.selfCheckTimeoutSec !== undefined) {
    const seconds = toIntInRange(record.selfCheckTimeoutSec, 5, 60)
    if (seconds === undefined) warnings.push('selfCheckTimeoutSec 超出 5~60，已使用默认值 10')
    else config.selfCheckTimeoutSec = seconds
  }
  if (record.logRetentionDays !== undefined) {
    const days = toIntInRange(record.logRetentionDays, 1, 365)
    if (days === undefined) warnings.push('logRetentionDays 超出 1~365，已使用默认值 30')
    else config.logRetentionDays = days
  }
  if (record.logMaxFiles !== undefined) {
    const files = toIntInRange(record.logMaxFiles, 1, 100)
    if (files === undefined) warnings.push('logMaxFiles 超出 1~100，已使用默认值 20')
    else config.logMaxFiles = files
  }
  if (record.shortcutName !== undefined) {
    if (
      typeof record.shortcutName === 'string' &&
      record.shortcutName.trim().length >= 1 &&
      record.shortcutName.trim().length <= 30
    ) {
      config.shortcutName = record.shortcutName.trim()
    } else {
      warnings.push('shortcutName 长度需为 1~30，已使用默认值')
    }
  }
  if (record.debugWindow !== undefined) {
    if (typeof record.debugWindow === 'boolean') config.debugWindow = record.debugWindow
    else warnings.push('debugWindow 取值无效，已使用默认值')
  }
  return config
}

/**
 * @param {string} root
 * @param {Partial<LauncherConfig>} [overrides]
 * @returns {{ config: LauncherConfig, warnings: string[] }}
 */
function load(root, overrides) {
  /** @type {string[]} */
  const warnings = []
  /** @type {LauncherConfig} */
  let config = { ...DEFAULTS }
  const filePath = path.join(root, CONFIG_FILE)
  try {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, 'utf-8')
      config = normalize(JSON.parse(text), warnings)
    }
  } catch {
    warnings.push('配置读取失败，已使用默认配置')
    config = { ...DEFAULTS }
  }

  if (overrides) {
    if (overrides.defaultMode && MODES.includes(overrides.defaultMode)) config.defaultMode = overrides.defaultMode
    if (typeof overrides.launchTimeoutSec === 'number') config.launchTimeoutSec = overrides.launchTimeoutSec
    if (typeof overrides.debugWindow === 'boolean') config.debugWindow = overrides.debugWindow
  }
  return { config, warnings }
}

module.exports = { load, DEFAULTS, normalize }