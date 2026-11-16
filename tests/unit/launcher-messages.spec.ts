import path from 'node:path'
import { describe, expect, it } from 'vitest'

const messages = require(path.resolve(__dirname, '../../scripts/launcher/lib/messages.cjs'))

const CODES = [
  'E_LAUNCH_UNSUPPORTED_OS',
  'E_LAUNCH_NODE_MISSING',
  'E_LAUNCH_NODE_VERSION_LOW',
  'E_LAUNCH_NPM_MISSING',
  'E_LAUNCH_NPM_VERSION_LOW',
  'E_LAUNCH_DEPS_MISSING',
  'E_LAUNCH_INSTALL_TIMEOUT',
  'E_LAUNCH_ELECTRON_BINARY_MISSING',
  'E_LAUNCH_BUILD_INCOMPLETE',
  'E_LAUNCH_PORT_IN_USE',
  'E_LAUNCH_START_FAILED',
  'E_LAUNCH_TIMEOUT',
  'E_LAUNCH_PERMISSION_DENIED',
  'E_LAUNCH_ALREADY_RUNNING',
  'E_LAUNCH_SHORTCUT_CONFLICT',
  'E_LAUNCH_SHORTCUT_FAILED',
  'E_LAUNCH_SELFCHECK_BLOCKED'
]

describe('启动器错误码与文案', () => {
  it('码值集合与约定完全一致', () => {
    expect(Object.keys(messages.CATALOG).sort()).toEqual(CODES.slice().sort())
    expect(CODES).toHaveLength(17)
  })

  it('每条都具备原因、建议、退出码与阻断标记', () => {
    for (const code of CODES) {
      const meta = messages.describe(code)
      expect(meta.message.length).toBeGreaterThan(0)
      expect(meta.suggestion.length).toBeGreaterThan(0)
      expect(typeof meta.exitCode).toBe('number')
      expect([true, false, 'log_only']).toContain(meta.blocking)
    }
  })

  it('可运行状态返回退出码 1，阻断类返回 2', () => {
    expect(messages.describe('E_LAUNCH_ALREADY_RUNNING').exitCode).toBe(1)
    expect(messages.describe('E_LAUNCH_SHORTCUT_CONFLICT').exitCode).toBe(1)
    expect(messages.describe('E_LAUNCH_START_FAILED').exitCode).toBe(2)
    expect(messages.describe('E_LAUNCH_BUILD_INCOMPLETE').blocking).toBe(true)
    expect(messages.describe('E_LAUNCH_PERMISSION_DENIED').blocking).toBe('log_only')
  })

  it('未知码返回兜底且不抛异常', () => {
    const meta = messages.describe('E_NOT_EXIST')
    expect(meta.message.length).toBeGreaterThan(0)
    expect(meta.exitCode).toBe(3)
  })

  it('版本与契约号非空且相互独立', () => {
    expect(messages.LAUNCHER_VERSION.length).toBeGreaterThan(0)
    expect(messages.CONTRACT_VERSION.length).toBeGreaterThan(0)
    expect(messages.LAUNCHER_VERSION === messages.CONTRACT_VERSION).toBe(false)
  })
})