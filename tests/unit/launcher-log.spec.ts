import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const logger = require(path.resolve(__dirname, '../../scripts/launcher/lib/logger.cjs'))

describe('结构化启动日志', () => {
  it('每行恒为 8 个 TAB 字段且含版本', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'launcher-log-'))
    const result = logger.log(root, {
      phase: '检测',
      item: 'Node.js',
      result: '通过',
      durationMs: 12,
      detail: 'Node v22'
    })
    expect(result.ok).toBe(true)
    const file = logger.logPath(root, 'launch')
    expect(existsSync(file)).toBe(true)
    const rows = readFileSync(file, 'utf-8').split('\n').filter((row: string) => row.length > 0)
    expect(rows.length).toBe(1)
    const fields = rows[0].split('\t')
    expect(fields.length).toBe(8)
    expect(fields[2]).toBe('检测')
    expect(fields[3]).toBe('Node.js')
    expect(fields[4]).toBe('通过')
    expect(fields[1].length).toBeGreaterThan(0)
    expect(fields[7]).toBe('Node v22')
  })

  it('自检日志写入独立文件', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'launcher-log-self-'))
    const result = logger.log(root, {
      phase: '自检',
      item: '环境自检',
      result: '通过',
      detail: '就绪'
    })
    expect(result.ok).toBe(true)
    const file = logger.logPath(root, 'selfcheck')
    expect(existsSync(file)).toBe(true)
  })

  it('超长说明被截断而不抛错', () => {
    const text = 'A'.repeat(400)
    const cleaned = logger.sanitizeDetail(text)
    expect(cleaned.length).toBe(300)
    const withBreaks = logger.sanitizeDetail('第一行\n第二行\t第三行')
    expect(withBreaks.includes('\n')).toBe(false)
    expect(withBreaks.includes('\t')).toBe(false)
  })

  it('目录不可写时返回告警而不抛异常', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'launcher-log-bad-'))
    mkdirSync(path.join(root, '.launcher'), { recursive: true })
    writeFileSync(path.join(root, '.launcher', 'logs'), 'occupied', 'utf-8')
    const result = logger.log(root, { phase: '检测', item: '日志', result: '通过' })
    expect(result.ok).toBe(false)
    expect(result.warning).toBeDefined()
  })

  it('轮转删除超出数量的旧日志', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'launcher-log-rotate-'))
    const dir = path.join(root, '.launcher', 'logs')
    mkdirSync(dir, { recursive: true })
    for (const name of ['launch-20200101.log', 'launch-20200102.log', 'launch-20200103.log']) {
      writeFileSync(path.join(dir, name), 'x', 'utf-8')
    }
    const removed = logger.rotate(root, { retentionDays: 30, maxFiles: 1 })
    expect(removed).toBeGreaterThanOrEqual(2)
  })
})