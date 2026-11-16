// @ts-check
'use strict'

const net = require('node:net')

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function tryBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => {
      resolve(false)
    })
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true))
    })
  })
}

/**
 * @param {number} start
 * @param {number} count
 * @returns {Promise<{ port: number | null, triedPorts: number[] }>}
 */
async function findFreePort(start, count) {
  /** @type {number[]} */
  const triedPorts = []
  for (let offset = 0; offset < count; offset += 1) {
    const port = start + offset
    triedPorts.push(port)
    const free = await tryBind(port)
    if (free) return { port, triedPorts }
  }
  return { port: null, triedPorts }
}

/**
 * @param {string | undefined} text
 * @returns {{ port: number | null }}
 */
function parsePort(text) {
  if (!text) return { port: null }
  const match = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/.exec(text)
  return { port: match ? Number(match[1]) : null }
}

module.exports = { findFreePort, parsePort }