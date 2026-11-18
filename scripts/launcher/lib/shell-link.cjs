// @ts-check
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { TMP_DIR } = require('./messages.cjs')

const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-Command']

/**
 * @typedef {object} ShortcutSpec
 * @property {string} root
 * @property {string} name
 * @property {string} target
 * @property {string} [icon]
 * @property {string} [description]
 */

/**
 * @typedef {'absent' | 'pointsToProject' | 'pointsElsewhere' | 'unknown'} ShortcutStatus
 */

/**
 * @param {string} value
 * @returns {string}
 */
function normalizePath(value) {
  return path.resolve(value).replace(/\//g, '\\').toLowerCase()
}

/**
 * @param {string} value
 * @returns {string}
 */
function quoteForPowerShell(value) {
  return value.replace(/'/g, "''")
}

/**
 * @returns {string | null}
 */
function resolveDesktop() {
  try {
    const output = execFileSync('powershell.exe', [...POWERSHELL_ARGS, "[Environment]::GetFolderPath('Desktop')"], {
      timeout: 5000,
      encoding: 'utf-8',
      windowsHide: true
    }).trim()
    if (output.length > 0) return output
  } catch {
    // 走备路径
  }
  const profile = process.env.USERPROFILE
  if (profile) {
    const fallback = path.join(profile, 'Desktop')
    if (fs.existsSync(fallback)) return fallback
  }
  return null
}

/**
 * @param {string} lnkPath
 * @returns {string | undefined}
 */
function readTarget(lnkPath) {
  try {
    const script = `(New-Object -ComObject WScript.Shell).CreateShortcut('${quoteForPowerShell(lnkPath)}').TargetPath`
    const output = execFileSync('powershell.exe', [...POWERSHELL_ARGS, script], {
      timeout: 5000,
      encoding: 'utf-8',
      windowsHide: true
    }).trim()
    return output.length > 0 ? output : undefined
  } catch {
    return undefined
  }
}

/**
 * @param {ShortcutSpec} spec
 * @returns {string}
 */
function lnkPathOf(spec) {
  const desktop = resolveDesktop()
  if (!desktop) return ''
  return path.join(desktop, `${spec.name}.lnk`)
}

/**
 * @param {ShortcutSpec} spec
 * @returns {ShortcutStatus}
 */
function status(spec) {
  const lnk = lnkPathOf(spec)
  if (!lnk) return 'unknown'
  if (!fs.existsSync(lnk)) return 'absent'
  const target = readTarget(lnk)
  if (!target) return 'unknown'
  return normalizePath(target) === normalizePath(spec.target) ? 'pointsToProject' : 'pointsElsewhere'
}

/**
 * @param {ShortcutSpec} spec
 * @returns {{ ok: boolean, code?: string, lnkPath?: string, updated?: boolean, detail: string }}
 */
function create(spec) {
  if (!fs.existsSync(spec.target)) {
    return { ok: false, code: 'E_LAUNCH_SHORTCUT_FAILED', detail: '目标入口不存在，未创建快捷方式' }
  }
  const lnk = lnkPathOf(spec)
  if (!lnk) {
    return { ok: false, code: 'E_LAUNCH_PERMISSION_DENIED', detail: '无法解析桌面路径' }
  }
  let updated = false
  if (fs.existsSync(lnk)) {
    const target = readTarget(lnk)
    if (target && normalizePath(target) !== normalizePath(spec.target)) {
      return { ok: false, code: 'E_LAUNCH_SHORTCUT_CONFLICT', detail: '桌面已有同名快捷方式且指向其他程序' }
    }
    updated = true
  }
  const icon = spec.icon && fs.existsSync(spec.icon) ? `${spec.icon},0` : ''
  const description = spec.description || 'AI 日程助手'
  const script =
    `$shell = New-Object -ComObject WScript.Shell; ` +
    `$link = $shell.CreateShortcut('${quoteForPowerShell(lnk)}'); ` +
    `$link.TargetPath = '${quoteForPowerShell(spec.target)}'; ` +
    `$link.WorkingDirectory = '${quoteForPowerShell(spec.root)}'; ` +
    `$link.Description = '${quoteForPowerShell(description)}'; ` +
    (icon ? `$link.IconLocation = '${quoteForPowerShell(icon)}'; ` : '') +
    `$link.Save()`
  try {
    execFileSync('powershell.exe', [...POWERSHELL_ARGS, script], {
      timeout: 8000,
      encoding: 'utf-8',
      windowsHide: true
    })
    return { ok: true, lnkPath: lnk, updated, detail: updated ? '已更新桌面快捷方式' : '已创建桌面快捷方式' }
  } catch {
    const fallback = createWithVbs(spec, lnk, icon)
    if (fallback) {
      return { ok: true, lnkPath: lnk, updated, detail: updated ? '已更新桌面快捷方式' : '已创建桌面快捷方式' }
    }
    return {
      ok: false,
      code: 'E_LAUNCH_SHORTCUT_FAILED',
      detail: '创建失败，可右键「启动个人助理.bat」→ 发送到 → 桌面快捷方式'
    }
  }
}

/**
 * @param {ShortcutSpec} spec
 * @param {string} lnk
 * @param {string} icon
 * @returns {boolean}
 */
function createWithVbs(spec, lnk, icon) {
  const dir = path.join(spec.root, TMP_DIR)
  const vbs = path.join(dir, `make-link-${Date.now()}.vbs`)
  try {
    fs.mkdirSync(dir, { recursive: true })
    const iconLine = icon ? `link.IconLocation = "${icon}"\r\n` : ''
    const content =
      'Set shell = CreateObject("WScript.Shell")\r\n' +
      `Set link = shell.CreateShortcut("${lnk}")\r\n` +
      `link.TargetPath = "${spec.target}"\r\n` +
      `link.WorkingDirectory = "${spec.root}"\r\n` +
      `link.Description = "${spec.description || 'AI 日程助手'}"\r\n` +
      `${iconLine}` +
      'link.Save\r\n'
    fs.writeFileSync(vbs, content, 'utf-8')
    execFileSync('cscript.exe', ['//nologo', vbs], { timeout: 8000, windowsHide: true })
    return true
  } catch {
    return false
  } finally {
    try {
      if (fs.existsSync(vbs)) fs.unlinkSync(vbs)
    } catch {
      // 清理失败不阻断
    }
  }
}

/**
 * @param {ShortcutSpec} spec
 * @returns {{ ok: boolean, code?: string, detail: string }}
 */
function remove(spec) {
  const lnk = lnkPathOf(spec)
  if (!lnk || !fs.existsSync(lnk)) {
    return { ok: false, detail: '未找到本应用的快捷方式，未做删除' }
  }
  const base = path.basename(lnk, '.lnk')
  if (base !== spec.name) {
    return { ok: false, detail: '名称不匹配，未做删除' }
  }
  const target = readTarget(lnk)
  if (!target || normalizePath(target) !== normalizePath(spec.target)) {
    return { ok: false, detail: '快捷方式指向其他程序，未做删除' }
  }
  try {
    fs.unlinkSync(lnk)
    return { ok: true, detail: '已删除桌面快捷方式' }
  } catch {
    return { ok: false, code: 'E_LAUNCH_SHORTCUT_FAILED', detail: '删除失败' }
  }
}

/**
 * @param {string} root
 * @returns {void}
 */
function cleanupTemp(root) {
  const dir = path.join(root, TMP_DIR)
  try {
    const cutoff = Date.now() - 60 * 60 * 1000
    for (const name of fs.readdirSync(dir)) {
      if (!/^make-link-\d+\.vbs$/.test(name)) continue
      const full = path.join(dir, name)
      const stat = fs.statSync(full)
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full)
    }
  } catch {
    // 目录不存在或不可读时不处理
  }
}

module.exports = {
  resolveDesktop,
  lnkPathOf,
  status,
  create,
  remove,
  cleanupTemp,
  normalizePath,
  readTarget
}