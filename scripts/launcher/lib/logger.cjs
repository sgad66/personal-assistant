// @ts-check
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { LAUNCHER_VERSION, LOG_DIR } = require('./messages.cjs')

const PHASES = ['检测', '修复', '模式选择', '启动', '等待', '成功', '失败', '自检']
const RESULTS = ['通过', '缺失', '已修复', '失败', '超时', '跳过', '未知']
const DETAIL_MAX = 300

/**
 * @typedef {object} LogRecord
 * @property {string} phase
 * @property {string} item
 * @property {string} result
 * @property {string} [code]
 * @property {number} [durationMs]
 * @property {string} [detail]
 * @property {'launch' | 'selfcheck'} [kind]
 */

/**
 * @param {Date} date
 * @returns {string}
 */
function formatTimestamp(date) {
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/**
 * @param {Date} date
 * @returns {string}
 */
function dateStamp(date) {
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

/**
 * @param {string | undefined} detail
 * @returns {string}
 */
function sanitizeDetail(detail) {
  if (!detail) return ''
  const flat = detail.replace(/[\t\r\n]+/g, ' ').trim()
  return flat.length > DETAIL_MAX ? flat.slice(0, DETAIL_MAX) : flat
}

/**
 * @param {string} root
 * @param {'launch' | 'selfcheck'} kind
 * @param {Date} [now]
 * @returns {string}
 */
function logPath(root, kind, now = new Date()) {
  return path.join(root, LOG_DIR, `${kind}-${dateStamp(now)}.log`)
}

/**
 * @param {string} root
 * @param {LogRecord} record
 * @returns {{ ok: boolean, path?: string, warning?: string }}
 */
function log(root, record) {
  const kind = record.kind === 'selfcheck' || record.phase === '自检' ? 'selfcheck' : 'launch'
  const now = new Date()
  const target = logPath(root, kind, now)
  const detail = sanitizeDetail(record.detail)
  const fields = [
    formatTimestamp(now),
    LAUNCHER_VERSION,
    record.phase,
    record.item,
    record.result,
    record.code || '',
    String(record.durationMs === undefined ? 0 : Math.round(record.durationMs)),
    detail
  ]
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.appendFileSync(target, `${fields.join('\t')}\n`, 'utf-8')
    return { ok: true, path: target }
  } catch {
    return { ok: false, warning: '日志无法写入，问题排查能力受限' }
  }
}

/**
 * @param {string} root
 * @param {number} [count]
 * @returns {string[]}
 */
function tail(root, count = 20) {
  try {
    const file = logPath(root, 'launch')
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter((line) => line.length > 0)
    return lines.slice(-count)
  } catch {
    return []
  }
}

/**
 * @param {string} root
 * @param {{ retentionDays: number, maxFiles: number }} policy
 * @returns {number}
 */
function rotate(root, policy) {
  const dir = path.join(root, LOG_DIR)
  let removed = 0
  try {
    const names = fs.readdirSync(dir).filter((name) => /^(launch|selfcheck)-\d{8}\.log$/.test(name) || /^dev-\d{8}-\d{6}\.log$/.test(name))
    const entries = names
      .map((name) => {
        const full = path.join(dir, name)
        try {
          return { full, mtime: fs.statSync(full).mtimeMs }
        } catch {
          return { full, mtime: 0 }
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
    const cutoff = Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000
    entries.forEach((entry, index) => {
      const tooOld = entry.mtime > 0 && entry.mtime < cutoff
      const tooMany = index >= policy.maxFiles
      if (tooOld || tooMany) {
        try {
          fs.unlinkSync(entry.full)
          removed += 1
        } catch {
          // 删除失败不阻断
        }
      }
    })
  } catch {
    return 0
  }
  return removed
}

module.exports = { log, rotate, logPath, tail, formatTimestamp, sanitizeDetail, PHASES, RESULTS }