// @ts-check
'use strict'

const LAUNCHER_VERSION = '1.0.0'
const CONTRACT_VERSION = 'launcher-1'

const LAUNCHER_DIR = '.launcher'
const STATE_DIR = `${LAUNCHER_DIR}/state`
const LOG_DIR = `${LAUNCHER_DIR}/logs`
const TMP_DIR = `${LAUNCHER_DIR}/tmp`
const STATE_FILE = `${STATE_DIR}/launch-state.json`
const CONFIG_FILE = 'launcher.config.json'

/**
 * @typedef {object} ErrorMeta
 * @property {string} message
 * @property {string} suggestion
 * @property {number} exitCode
 * @property {true | false | 'log_only'} blocking
 */

/** @type {Record<string, ErrorMeta>} */
const CATALOG = {
  E_LAUNCH_UNSUPPORTED_OS: {
    message: '当前系统不受支持，需要 Windows 10 及以上 64 位系统',
    suggestion: '请在 Windows 10 或 Windows 11 的 64 位系统上运行',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_NODE_MISSING: {
    message: '未找到 Node.js 运行环境',
    suggestion: '安装 Node.js 18 或更高版本后重新双击启动',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_NODE_VERSION_LOW: {
    message: 'Node.js 版本过低',
    suggestion: '升级到 Node.js 18 或更高版本后重试',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_NPM_MISSING: {
    message: '未找到可用的 npm',
    suggestion: '重新安装 Node.js（会一并安装 npm），完成后重试',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_NPM_VERSION_LOW: {
    message: 'npm 版本过低',
    suggestion: '升级 npm 到 9 或更高版本后重试',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_DEPS_MISSING: {
    message: '项目依赖不完整',
    suggestion: '在地球联网状态下重试，启动器会自动安装依赖',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_INSTALL_TIMEOUT: {
    message: '依赖安装超时',
    suggestion: '检查网络后重新双击启动，安装会从断点继续',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_ELECTRON_BINARY_MISSING: {
    message: 'Electron 运行文件缺失',
    suggestion: '联网后重试，启动器会自动修复运行文件',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_BUILD_INCOMPLETE: {
    message: '应用构建产物不完整',
    suggestion: '重试一次；若仍失败，改用开发模式入口',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_PORT_IN_USE: {
    message: '开发端口 5173-5177 已被占用',
    suggestion: '关闭占用端口的程序，或改用生产模式入口',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_START_FAILED: {
    message: '应用启动失败',
    suggestion: '查看日志了解详情，或改用另一模式入口重试',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_TIMEOUT: {
    message: '等待应用窗口超时',
    suggestion: '稍等片刻从任务栏查看；若仍未出现，查看日志后重试',
    exitCode: 2,
    blocking: true
  },
  E_LAUNCH_PERMISSION_DENIED: {
    message: '部分运行文件不可写，已降级继续',
    suggestion: '如需完整日志，检查项目目录的写入权限',
    exitCode: 2,
    blocking: 'log_only'
  },
  E_LAUNCH_ALREADY_RUNNING: {
    message: '应用已经在运行',
    suggestion: '请从任务栏打开已有窗口；若窗口无法唤起，关闭应用后重试',
    exitCode: 1,
    blocking: false
  },
  E_LAUNCH_SHORTCUT_CONFLICT: {
    message: '桌面已有同名快捷方式，但指向其他程序',
    suggestion: '先重命名或删除该快捷方式，再重新创建',
    exitCode: 1,
    blocking: false
  },
  E_LAUNCH_SHORTCUT_FAILED: {
    message: '创建桌面快捷方式失败',
    suggestion: '右键「启动个人助理.bat」→ 发送到 → 桌面快捷方式',
    exitCode: 2,
    blocking: false
  },
  E_LAUNCH_SELFCHECK_BLOCKED: {
    message: '环境自检发现阻断项，无法启动',
    suggestion: '按上方逐项提示处理后重新自检',
    exitCode: 2,
    blocking: true
  }
}

/**
 * @param {string} code
 * @returns {ErrorMeta}
 */
function describe(code) {
  return (
    CATALOG[code] || {
      message: '启动器遇到未识别的问题',
      suggestion: '查看日志后重试，或联系维护者',
      exitCode: 3,
      blocking: false
    }
  )
}

module.exports = {
  LAUNCHER_VERSION,
  CONTRACT_VERSION,
  LAUNCHER_DIR,
  STATE_DIR,
  LOG_DIR,
  TMP_DIR,
  STATE_FILE,
  CONFIG_FILE,
  CATALOG,
  describe
}