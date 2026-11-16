import net from 'node:net'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const portProbe = require(path.resolve(__dirname, '../../scripts/launcher/lib/port-probe.cjs'))

interface FoundPort {
  port: number | null
  triedPorts: number[]
}

function holdPort(port: number): Promise<{ close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      resolve({
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          })
      })
    })
  })
}

describe('开发端口预检', () => {
  it('空闲端口立即返回首个候选', async () => {
    const result: FoundPort = await portProbe.findFreePort(5600, 3)
    expect(result.triedPorts.length).toBe(1)
    expect(result.port === null).toBe(false)
    expect(result.triedPorts[0]).toBe(result.port)
  })

  it('被占用时顺延到下一个端口', async () => {
    const holder = await holdPort(5610)
    try {
      const result: FoundPort = await portProbe.findFreePort(5610, 3)
      expect(result.port).toBe(5611)
      expect(result.triedPorts).toEqual([5610, 5611])
    } finally {
      await holder.close()
    }
  })

  it('全部占用返回 null 且记录 5 个候选', async () => {
    const holders = []
    for (let port = 5620; port <= 5624; port += 1) {
      holders.push(await holdPort(port))
    }
    try {
      const result: FoundPort = await portProbe.findFreePort(5620, 5)
      expect(result.port).toBe(null)
      expect(result.triedPorts).toEqual([5620, 5621, 5622, 5623, 5624])
    } finally {
      for (const holder of holders) await holder.close()
    }
  })

  it('释放后端口可再次绑定', async () => {
    const first: FoundPort = await portProbe.findFreePort(5630, 1)
    const second: FoundPort = await portProbe.findFreePort(5630, 1)
    expect(first.port).toBe(5630)
    expect(second.port).toBe(5630)
  })
})

describe('开发端口解析', () => {
  it('从 dev 输出解析端口', () => {
    expect(portProbe.parsePort('  ➜  Local:   http://localhost:5174/').port).toBe(5174)
    expect(portProbe.parsePort('http://127.0.0.1:5175/').port).toBe(5175)
  })

  it('无地址文本返回 null', () => {
    expect(portProbe.parsePort('started without url').port).toBe(null)
    expect(portProbe.parsePort(undefined).port).toBe(null)
  })
})