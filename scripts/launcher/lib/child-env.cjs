// @ts-check
'use strict'

/**
 * 派生启动子进程用的环境变量。
 *
 * 部分终端与 IDE 预设 ELECTRON_RUN_AS_NODE=1，继承后 Electron 会以纯 Node 模式
 * 运行并立即退出，主窗口永远不会出现。启动器拉起应用前必须剔除该变量。
 *
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {NodeJS.ProcessEnv}
 */
function electronEnv(base) {
  const env = { ...(base || process.env) }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

module.exports = { electronEnv }