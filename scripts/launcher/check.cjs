// @ts-check
'use strict'

const path = require('node:path')
const { LAUNCHER_VERSION, CONTRACT_VERSION } = require('./lib/messages.cjs')
const { load } = require('./lib/config.cjs')
const { probeAll, summarize, deriveMode } = require('./lib/env-probe.cjs')
const { status: shortcutStatus } = require('./lib/shell-link.cjs')
const { log, logPath } = require('./lib/logger.cjs')
const { section, item, line, waitAnyKey } = require('./lib/ui.cjs')

const ROOT = path.resolve(__dirname, '..', '..')

/**
 * @param {string} result
 * @returns {string}
 */
function resultText(result) {
  const names = { pass: '通过', missing: '缺失', incomplete: '不完整', blocked: '阻断', unknown: '未知', skip: '跳过' }
  return names[result] || '未知'
}

/**
 * @param {string} state
 * @returns {string}
 */
function shortcutText(state) {
  const names = {
    absent: '未创建',
    pointsToProject: '已指向本项目',
    pointsElsewhere: '已存在同名快捷方式但指向其他程序',
    unknown: '无法确认'
  }
  return names[state] || '无法确认'
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const waitIfTty = argv.includes('--wait-if-tty')
  const { config } = load(ROOT)
  const started = Date.now()

  const report = await probeAll({ root: ROOT, mode: 'selfcheck', startPort: config.portRange, portCount: 5 })
  const shortcut = shortcutStatus({
    root: ROOT,
    name: config.shortcutName,
    target: path.join(ROOT, '启动个人助理.bat')
  })
  const conclusion = summarize(report.items)
  const derived = deriveMode(report)
  const modeLabel = derived.mode === 'prod' ? '生产模式' : derived.mode === 'dev' ? '开发模式' : derived.mode === 'repair' ? '需要修复' : '不启动'
  const conclusionLabel = conclusion === 'ready' ? '就绪' : conclusion === 'repairable' ? '可修复' : '阻断'
  const jsonPayload = {
    version: LAUNCHER_VERSION,
    contractVersion: CONTRACT_VERSION,
    detectedAt: report.detectedAt,
    conclusion,
    mode: derived.mode,
    reason: derived.reason,
    selectedPort: report.selectedPort,
    items: report.items,
    shortcut
  }

  if (json) {
    console.log(JSON.stringify(jsonPayload))
  } else {
    section('AI 日程助手环境自检')
    line(`版本 ${LAUNCHER_VERSION} · 契约 ${CONTRACT_VERSION}`)
    for (const probe of report.items) {
      item(probe.order, probe.name, resultText(probe.result) + (probe.detail ? `（${probe.detail}）` : ''))
    }
    item(8, '桌面快捷方式', shortcutText(shortcut))
    section('自检结论')
    line(`结论：${conclusionLabel}`)
    line(`将采用的模式：${modeLabel}`)
    line(`原因：${derived.reason}`)
    line(`日志：${path.resolve(logPath(ROOT, 'selfcheck'))}`)
    line('LAUNCHER_UTF8_OK')
  }

  log(ROOT, {
    phase: '自检',
    item: '环境自检',
    result: conclusion === 'ready' ? '通过' : conclusion === 'repairable' ? '缺失' : '失败',
    durationMs: Date.now() - started,
    detail: `${conclusionLabel}；${modeLabel}；${derived.reason}`,
    kind: 'selfcheck'
  })

  if (waitIfTty && !json) await waitAnyKey({})
  if (conclusion === 'ready') return 0
  if (conclusion === 'repairable') return 1
  return 2
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(() => {
    console.log('错误码：E_LAUNCH_SELFCHECK_BLOCKED')
    console.log('原因：自检过程出现异常')
    console.log('建议：查看日志后重试')
    console.log(`日志：${path.resolve(logPath(ROOT, 'selfcheck'))}`)
    process.exitCode = 2
  })