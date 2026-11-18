// @ts-check
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { LAUNCHER_VERSION, STATE_DIR, STATE_FILE } = require('./messages.cjs')

const SCHEMA_VERSION = 1
const STALE_MS = 300 * 1000

/**
 * @typedef {'idle' | 'starting' | 'running'} MarkState
 */

/**
 * @typedef {object} LaunchStateMark
 * @property {number} schemaVersion
 * @property {MarkState} state
 * @property {number} pid
 * @property {number} devServerPid
 * @property {number} startedAt
 * @property {'dev' | 'prod' | 'auto'} mode
 * @property {number} port
 * @property {boolean} fallbackUsed
 * @property {string} launcherVersion
 */

/**
 * @param {number} now
 * @returns {LaunchStateMark}
 */
function idleMark(now) {
  return {
    schemaVersion: SCHEMA_VERSION,
    state: 'idle',
    pid: 0,
    devServerPid: 0,
    startedAt: now,
    mode: 'auto',
    port: 0,
    fallbackUsed: false,
    launcherVersion: LAUNCHER_VERSION
  }
}

/**
 * @param {string} root
 * @returns {LaunchStateMark}
 */
function read(root) {
  const file = path.join(root, STATE_FILE)
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (!raw || raw.schemaVersion !== SCHEMA_VERSION) return idleMark(Date.now())
    const state = raw.state
    if (state !== 'starting' && state !== 'running') return idleMark(Date.now())
    return {
      schemaVersion: SCHEMA_VERSION,
      state,
      pid: Number(raw.pid) || 0,
      devServerPid: Number(raw.devServerPid) || 0,
      startedAt: Number(raw.startedAt) || Date.now(),
      mode: raw.mode === 'dev' || raw.mode === 'prod' ? raw.mode : 'auto',
      port: Number(raw.port) || 0,
      fallbackUsed: raw.fallbackUsed === true,
      launcherVersion: typeof raw.launcherVersion === 'string' ? raw.launcherVersion : LAUNCHER_VERSION
    }
  } catch {
    return idleMark(Date.now())
  }
}

/**
 * @param {string} root
 * @param {LaunchStateMark} mark
 * @returns {boolean}
 */
function writeAtomic(root, mark) {
  const dir = path.join(root, STATE_DIR)
  const file = path.join(root, STATE_FILE)
  const tmp = `${file}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(mark), 'utf-8')
    fs.renameSync(tmp, file)
    return true
  } catch {
    try {
      fs.unlinkSync(tmp)
    } catch {
      // 清理失败不阻断
    }
    return false
  }
}

/**
 * @param {string} root
 * @returns {boolean}
 */
function clear(root) {
  try {
    const file = path.join(root, STATE_FILE)
    if (fs.existsSync(file)) fs.unlinkSync(file)
    return true
  } catch {
    return false
  }
}

/**
 * @param {LaunchStateMark} mark
 * @param {number} now
 * @param {(pid: number) => boolean} isPidAlive
 * @returns {'idle' | 'starting' | 'running' | 'stale'}
 */
function evaluate(mark, now, isPidAlive) {
  if (mark.state === 'idle') return 'idle'
  if (mark.state === 'starting') {
    if (now - mark.startedAt > STALE_MS) return 'stale'
    if (mark.pid !== 0 && !isPidAlive(mark.pid)) return 'stale'
    return 'starting'
  }
  if (mark.state === 'running') {
    if (mark.pid === 0 || !isPidAlive(mark.pid)) return 'stale'
    return 'running'
  }
  return 'idle'
}

/**
 * @param {LaunchStateMark} mark
 * @param {number} now
 * @returns {{ text: string, waitSeconds: number, shouldAct: boolean }}
 */
function describeSuppression(mark, now) {
  const elapsed = Math.max(0, Math.floor((now - mark.startedAt) / 1000))
  return {
    text: `正在启动中，已等待 ${elapsed} 秒，请稍候`,
    waitSeconds: 3,
    shouldAct: false
  }
}

module.exports = {
  SCHEMA_VERSION,
  STALE_MS,
  read,
  writeAtomic,
  clear,
  evaluate,
  describeSuppression,
  idleMark
}