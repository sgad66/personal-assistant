import { describe, expect, it } from 'vitest'
import { redactLocation, redactNote, redactPath, redactTitle, sanitizeLogPayload } from '@main/observability/redact'

describe('日志脱敏', () => {
  it('标题仅保留前 6 字符', () => {
    expect(redactTitle('明天下午三点开项目周会')).toBe('明天下午三点***')
  })

  it('地点与备注只记录长度', () => {
    expect(redactLocation('3 号会议室')).toBe('len:6')
    expect(redactNote(undefined)).toBe('none')
    expect(redactNote('请假条')).toBe('len:3')
  })

  it('临时路径替换为占位符', () => {
    expect(redactPath('C:/tmp/voice-123.webm')).toBe('<temp>')
  })

  it('批量脱敏不泄漏原文', () => {
    const result = sanitizeLogPayload({
      title: '产品评审会与季度规划讨论',
      location: '3 号会议室',
      note: '记得带材料',
      tempFilePath: 'C:/tmp/img-1.png',
      eventType: 'schedule.written'
    })
    expect(JSON.stringify(result)).not.toContain('季度规划讨论')
    expect(JSON.stringify(result)).not.toContain('3 号会议室')
    expect(JSON.stringify(result)).not.toContain('记得带材料')
    expect(JSON.stringify(result)).not.toContain('img-1.png')
    expect(result.eventType).toBe('schedule.written')
  })
})