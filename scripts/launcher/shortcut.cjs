// @ts-check
'use strict'

const path = require('node:path')
const { load } = require('./lib/config.cjs')
const { create, remove, status, lnkPathOf, cleanupTemp } = require('./lib/shell-link.cjs')
const { log } = require('./lib/logger.cjs')
const { waitAnyKey } = require('./lib/ui.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const TARGET = path.join(ROOT, '启动个人助理.bat')
const ICON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

/**
 * @param {string[]} argv
 * @returns {{ subcommand: string, name?: string, waitIfTty: boolean }}
 */
function parseArgs(argv) {
  /** @type {{ subcommand: string, name?: string, waitIfTty: boolean }} */
  const args = { subcommand: 'status', waitIfTty: false }
  const positional = argv.filter((value) => !value.startsWith('--'))
  if (positional.length > 0) args.subcommand = positional[0]
  const nameIndex = argv.indexOf('--name')
  if (nameIndex >= 0 && argv[nameIndex + 1]) args.name = argv[nameIndex + 1]
  args.waitIfTty = argv.includes('--wait-if-tty')
  return args
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { config } = load(ROOT)
  const spec = {
    root: ROOT,
    name: args.name || config.shortcutName,
    target: TARGET,
    icon: ICON,
    description: 'AI 日程助手'
  }
  cleanupTemp(ROOT)

  if (args.subcommand === 'status') {
    const current = status(spec)
    const labels = {
      absent: '未创建',
      pointsToProject: '已创建，指向本项目',
      pointsElsewhere: '已存在同名快捷方式但指向其他程序',
      unknown: '无法确认'
    }
    console.log(`桌面快捷方式状态：${labels[current] || '无法确认'}`)
    log(ROOT, { phase: '自检', item: '快捷方式状态', result: '通过', detail: current })
    if (args.waitIfTty) await waitAnyKey({})
    return current === 'absent' ? 0 : current === 'pointsToProject' ? 0 : 1
  }

  if (args.subcommand === 'create') {
    const result = create(spec)
    if (result.ok) {
      console.log(`${result.detail}：${result.lnkPath || lnkPathOf(spec)}`)
      log(ROOT, { phase: '修复', item: '创建快捷方式', result: '已修复', detail: result.detail })
      if (args.waitIfTty) await waitAnyKey({})
      return 0
    }
    console.log(`创建失败：${result.detail}`)
    log(ROOT, { phase: '失败', item: '创建快捷方式', result: '失败', code: result.code || 'E_LAUNCH_SHORTCUT_FAILED', detail: result.detail })
    if (args.waitIfTty) await waitAnyKey({})
    return result.code === 'E_LAUNCH_SHORTCUT_CONFLICT' ? 1 : 2
  }

  if (args.subcommand === 'delete') {
    const result = remove(spec)
    if (result.ok) {
      console.log(result.detail)
      log(ROOT, { phase: '修复', item: '删除快捷方式', result: '已修复', detail: result.detail })
      if (args.waitIfTty) await waitAnyKey({})
      return 0
    }
    console.log(result.detail)
    log(ROOT, { phase: '失败', item: '删除快捷方式', result: '失败', code: result.code || '', detail: result.detail })
    if (args.waitIfTty) await waitAnyKey({})
    return result.code ? 2 : 1
  }

  console.log('用法：node scripts/launcher/shortcut.cjs create|delete|status [--name 名称]')
  if (args.waitIfTty) await waitAnyKey({})
  return 2
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(() => {
    console.log('快捷方式操作失败，可手动右键启动入口发送到桌面')
    process.exitCode = 2
  })