import path from 'node:path'
import { describe, expect, it } from 'vitest'

const probe = require(path.resolve(__dirname, '../../scripts/launcher/lib/env-probe.cjs'))

interface ProbeItemLike {
  order: number
  name: string
  result: string
  code?: string
  detail?: string
}

function reportOf(items: ProbeItemLike[]): Record<string, unknown> {
  return {
    detectedAt: new Date().toISOString(),
    items,
    summary: 'ready',
    selectedMode: 'dev',
    reason: '',
    selectedPort: 5173,
    actualPort: null
  }
}

function item(order: number, result: string, detail?: string): ProbeItemLike {
  return { order, name: `第${order}项`, result, ...(detail ? { detail } : {}) }
}

describe('启动模式判定', () => {
  it('产物完整 → 生产模式', () => {
    const items = [item(1, 'pass'), item(2, 'pass'), item(3, 'pass'), item(4, 'pass'), item(5, 'pass'), item(6, 'pass'), item(7, 'pass')]
    const derived = probe.deriveMode(reportOf(items))
    expect(derived.mode).toBe('prod')
    expect(derived.reason).toContain('构建产物完整')
  })

  it('产物不完整 → 开发模式并带具体缺失', () => {
    const items = [item(1, 'pass'), item(2, 'pass'), item(3, 'pass'), item(4, 'pass'), item(5, 'pass'), item(6, 'incomplete', '构建产物不完整（渲染产物缺失）'), item(7, 'pass')]
    const derived = probe.deriveMode(reportOf(items))
    expect(derived.mode).toBe('dev')
    expect(derived.reason).toContain('渲染产物缺失')
  })

  it('依赖缺失 → 需要修复', () => {
    const items = [item(1, 'pass'), item(2, 'pass'), item(3, 'pass'), item(4, 'missing'), item(5, 'pass'), item(6, 'pass'), item(7, 'pass')]
    expect(probe.deriveMode(reportOf(items)).mode).toBe('repair')
  })

  it('系统或 Node 阻断 → 不启动', () => {
    const osBlocked = [item(1, 'blocked'), item(2, 'pass')]
    const nodeBlocked = [item(1, 'pass'), item(2, 'blocked')]
    expect(probe.deriveMode(reportOf(osBlocked)).mode).toBe('blocked')
    expect(probe.deriveMode(reportOf(nodeBlocked)).mode).toBe('blocked')
  })
})

describe('自检三级结论', () => {
  it('全部通过 → 就绪', () => {
    expect(probe.summarize([item(1, 'pass'), item(2, 'pass')])).toBe('ready')
  })

  it('存在可修复项 → 可修复', () => {
    expect(probe.summarize([item(1, 'pass'), item(6, 'incomplete')])).toBe('repairable')
  })

  it('存在阻断或未知 → 阻断', () => {
    expect(probe.summarize([item(1, 'blocked')])).toBe('blocked')
    expect(probe.summarize([item(1, 'unknown')])).toBe('blocked')
  })
})

describe('检测器行为', () => {
  it('渲染产物缺失被准确定位', () => {
    const result = probe.probeArtifacts('C:/not-exist-root', { missing: ['renderer'] })
    expect(result.result).toBe('incomplete')
    expect(result.detail).toContain('渲染产物缺失')
  })

  it('不支持的系统被阻断', () => {
    expect(probe.probeOs({ platform: 'linux', release: '10.0', arch: 'x64' }).code).toBe('E_LAUNCH_UNSUPPORTED_OS')
    expect(probe.probeOs({ platform: 'win32', release: '6.1.7601', arch: 'x64', osVar: 'Windows_NT' }).code).toBe('E_LAUNCH_UNSUPPORTED_OS')
    expect(probe.probeOs({ platform: 'win32', release: '10.0.19045', arch: 'ia32', osVar: 'Windows_NT' }).code).toBe('E_LAUNCH_UNSUPPORTED_OS')
  })

  it('Windows 10 x64 通过', () => {
    const result = probe.probeOs({ platform: 'win32', release: '10.0.19045', arch: 'x64', osVar: 'Windows_NT' })
    expect(result.result).toBe('pass')
  })

  it('Node 版本边界 18 通过、16 阻断', () => {
    expect(probe.probeNode({ version: 'v18.0.0', found: true }).result).toBe('pass')
    expect(probe.probeNode({ version: 'v16.20.0', found: true }).code).toBe('E_LAUNCH_NODE_VERSION_LOW')
    expect(probe.probeNode({ found: false }).code).toBe('E_LAUNCH_NODE_MISSING')
  })

  it('npm 主版本 8 判为过低', () => {
    expect(probe.probeNpm({ version: '8.19.4' }).code).toBe('E_LAUNCH_NPM_VERSION_LOW')
    expect(probe.probeNpm({ version: '10.9.8' }).result).toBe('pass')
  })
})