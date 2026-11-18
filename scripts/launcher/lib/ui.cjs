// @ts-check
'use strict'

/**
 * @typedef {object} UiOptions
 * @property {boolean} [noPause]
 */

/**
 * @returns {boolean}
 */
function isTty() {
  return Boolean(process.stdout.isTTY)
}

/**
 * @param {string} title
 */
function section(title) {
  console.log('')
  console.log(`== ${title} ==`)
}

/**
 * @param {number} index
 * @param {string} name
 * @param {string} result
 */
function item(index, name, result) {
  console.log(`${index} ${name}：${result}`)
}

/**
 * @param {string} text
 */
function line(text) {
  console.log(text)
}

/**
 * @param {number} sec
 * @returns {Promise<void>}
 */
function sleep(sec) {
  return new Promise((resolve) => setTimeout(resolve, sec * 1000))
}

/**
 * @param {number} sec
 * @returns {Promise<boolean>}
 */
async function countdown(sec, allowEsc = true) {
  if (!isTty() || !allowEsc) {
    await sleep(sec)
    return true
  }
  const stdin = process.stdin
  let cancelled = false
  const onData = (/** @type {Buffer} */ data) => {
    if (data.length > 0 && data[0] === 27) cancelled = true
  }
  try {
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  } catch {
    await sleep(sec)
    return true
  }
  for (let remaining = sec; remaining > 0; remaining -= 1) {
    if (cancelled) break
    process.stdout.write(`\r将在 ${remaining} 秒后继续（按 Esc 取消）`)
    await sleep(1)
  }
  process.stdout.write('\r')
  try {
    stdin.removeListener('data', onData)
    stdin.setRawMode(false)
    stdin.pause()
  } catch {
    // 恢复失败不影响结论
  }
  return !cancelled
}

/**
 * @param {UiOptions} [options]
 */
async function waitAnyKey(options) {
  if (options && options.noPause) return
  if (!isTty()) return
  process.stdout.write('按任意键关闭窗口…')
  await new Promise((resolve) => {
    const stdin = process.stdin
    try {
      stdin.setRawMode(true)
      stdin.resume()
      stdin.once('data', () => {
        try {
          stdin.setRawMode(false)
          stdin.pause()
        } catch {
          // 忽略
        }
        resolve(undefined)
      })
    } catch {
      resolve(undefined)
    }
  })
}

module.exports = { section, item, line, countdown, waitAnyKey, isTty, sleep }