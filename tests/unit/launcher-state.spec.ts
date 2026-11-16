import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const state = require(path.resolve(__dirname, '../../scripts/launcher/lib/state-mark.cjs'))

const NOW = 1_700_000_000_000

function mark(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    state: 'starting',
    pid: 0,
    devServerPid: 0,
    startedAt: NOW,
    mode: 'dev',
    port: 5173,
    fallbackUsed: false,
    launcherVersion: '1.0.0',
    ...overrides
  }
}

describe('启动状态与陈旧判定', () => {
  it('299 秒仍为启动中，301 秒判为陈旧', () => {
    const alive = () => true
    expect(state.evaluate(mark({ pid: 100 }), NOW + 299_000, alive)).toBe('starting')
    expect(state.evaluate(mark({ pid: 100 }), NOW + 301_000, alive)).toBe('stale')
  })

  it('运行中 PID 消失判为陈旧，存活维持运行中', () => {
    expect(state.evaluate(mark({ state: 'running', pid: 100 }), NOW + 1000, () => false)).toBe('stale')
    expect(state.evaluate(mark({ state: 'running', pid: 100 }), NOW + 1000, () => true)).toBe('running')
  })

  it('启动中 PID 已消失判为陈旧', () => {
    expect(state.evaluate(mark({ state: 'starting', pid: 200 }), NOW + 1000, () => false)).toBe('stale')
  })

  it('空闲标记直接返回 idle', () => {
    expect(state.evaluate(state.idleMark(NOW), NOW, () => true)).toBe('idle')
  })

  it('重复双击提示按下取整', () => {
    const info = state.describeSuppression(mark({ startedAt: NOW }), NOW + 301_400)
    expect(info.text).toContain('301')
    expect(info.shouldAct).toBe(false)
    expect(info.waitSeconds).toBe(3)
  })

  it('标记原子读写与清理', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'launcher-state-'))
    const written = state.writeAtomic(root, mark({ state: 'running', pid: 321 }))
    expect(written).toBe(true)
    const readBack = state.read(root)
    expect(readBack.state).toBe('running')
    expect(readBack.pid).toBe(321)
    expect(state.clear(root)).toBe(true)
    const file = path.join(root, '.launcher', 'state', 'launch-state.json')
    expect(existsSync(file)).toBe(false)
    expect(state.read(root).state).toBe('idle')
  })

  it('字段损坏时降级为空闲', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'launcher-state-bad-'))
    const idle = state.read(root)
    expect(idle.state).toBe('idle')
    expect(idle.port).toBe(0)
  })
})