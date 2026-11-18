// @ts-check
'use strict'

const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

/**
 * @typedef {object} ProcessSnapshot
 * @property {number[]} pids
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {string}
 */
function runSafe(command, args, timeoutMs) {
  try {
    return execFileSync(command, args, { timeout: timeoutMs, encoding: 'utf-8', windowsHide: true })
  } catch {
    return ''
  }
}

/**
 * @param {string} csv
 * @param {string} imageName
 * @returns {number[]}
 */
function parseTasklistCsv(csv, imageName) {
  /** @type {number[]} */
  const pids = []
  for (const rawLine of csv.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('"')) continue
    const fields = line.split('","').map((field) => field.replace(/^"|"$/g, ''))
    if (fields.length < 2) continue
    if (fields[0].toLowerCase() !== imageName.toLowerCase()) continue
    const pid = Number(fields[1])
    if (Number.isFinite(pid)) pids.push(pid)
  }
  return pids
}

/**
 * @returns {ProcessSnapshot}
 */
function snapshotElectronPids() {
  const csv = runSafe('tasklist', ['/FI', 'IMAGENAME eq electron.exe', '/FO', 'CSV', '/NH'], 4000)
  return { pids: parseTasklistCsv(csv, 'electron.exe') }
}

/**
 * @param {ProcessSnapshot} before
 * @param {ProcessSnapshot} after
 * @returns {number | null}
 */
function findNewMainPid(before, after) {
  const previous = new Set(before.pids)
  const fresh = after.pids.filter((pid) => !previous.has(pid))
  return fresh.length > 0 ? fresh[0] || null : null
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false
  const csv = runSafe('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], 3000)
  return csv.includes(`"${pid}"`) || csv.includes(`,${pid},`)
}

/**
 * @param {string} title
 * @returns {'hit' | 'miss' | 'unavailable'}
 */
function hasWindowTitle(title) {
  const csv = runSafe('tasklist', ['/FI', `WINDOWTITLE eq ${title}`, '/FO', 'CSV', '/NH'], 4000)
  if (!csv.trim()) return 'unavailable'
  if (/INFO:/i.test(csv)) return 'unavailable'
  return csv.includes('electron.exe') ? 'hit' : 'miss'
}

/**
 * @param {string} root
 * @returns {boolean}
 */
function wakeExisting(root) {
  const exe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  try {
    const child = spawn(exe, [root], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} root
 * @param {string} title
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForWindow(root, title, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = hasWindowTitle(title)
    if (state === 'hit') return true
    if (state === 'unavailable') {
      await new Promise((resolve) => setTimeout(resolve, 500))
      continue
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

module.exports = {
  snapshotElectronPids,
  findNewMainPid,
  isPidAlive,
  hasWindowTitle,
  wakeExisting,
  waitForWindow,
  parseTasklistCsv
}