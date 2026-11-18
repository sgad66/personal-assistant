import path from 'node:path'
import { describe, expect, it } from 'vitest'

const { electronEnv } = require(path.resolve(__dirname, '../../scripts/launcher/lib/child-env.cjs'))

describe('启动器子进程环境', () => {
  it('剔除 ELECTRON_RUN_AS_NODE，避免 Electron 退化为纯 Node 模式', () => {
    const env = electronEnv({ ELECTRON_RUN_AS_NODE: '1', PATH: 'C:\\Windows' })
    expect('ELECTRON_RUN_AS_NODE' in env).toBe(false)
    expect(env.PATH).toBe('C:\\Windows')
  })

  it('不修改传入的环境对象', () => {
    const base = { ELECTRON_RUN_AS_NODE: '1', FOO: 'bar' }
    const env = electronEnv(base)
    expect(base.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env.FOO).toBe('bar')
    expect(env).not.toBe(base)
  })

  it('未传入时基于 process.env 派生', () => {
    const env = electronEnv()
    expect('ELECTRON_RUN_AS_NODE' in env).toBe(false)
  })
})