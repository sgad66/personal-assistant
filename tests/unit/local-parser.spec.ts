import { describe, expect, it } from 'vitest'
import { localParse } from '@main/providers/local-parser'

const REF = new Date(2026, 10, 9, 10, 0, 0, 0).getTime()

describe('本地规则解析器', () => {
  it('提取标题与时间表达', () => {
    const result = localParse('明天下午三点开项目周会', REF)
    expect(result.intentKind).toBe('schedule')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.title).toContain('开项目周会')
    expect(result.candidates[0]?.startExpression).toContain('下午三点')
    expect(result.confidence).toBeGreaterThan(0.6)
  })

  it('缺少时间时置信度下降且不给出开始时间', () => {
    const result = localParse('帮我记一下要买牛奶', REF)
    expect(result.intentKind).toBe('schedule')
    expect(result.candidates[0]?.startExpression).toBeUndefined()
    expect(result.confidence).toBeLessThan(0.6)
    expect(result.replyText).toContain('什么时间')
  })

  it('闲聊识别为 chitchat 且无候选', () => {
    const result = localParse('你好', REF)
    expect(result.intentKind).toBe('chitchat')
    expect(result.candidates).toHaveLength(0)
    expect(result.replyText.length).toBeGreaterThan(0)
  })

  it('口语问候和能力询问也会回复，而不是追问时间', () => {
    const hello = localParse('你好呀', REF)
    const help = localParse('你能做什么', REF)
    expect(hello.intentKind).toBe('chitchat')
    expect(hello.replyText.length).toBeGreaterThan(0)
    expect(help.intentKind).toBe('chitchat')
    expect(help.replyText).toContain('日程')
  })

  it('取消意图识别', () => {
    const result = localParse('取消明天的会议', REF)
    expect(result.intentKind).toBe('cancel')
  })

  it('修改意图保留时间表达', () => {
    const result = localParse('改到下午四点', REF)
    expect(result.intentKind).toBe('modify')
    expect(result.candidates[0]?.startExpression).toBeDefined()
  })

  it('多行输入产生多个候选', () => {
    const result = localParse('周一上午十点 项目评审\n周二下午两点 客户拜访', REF)
    expect(result.intentKind).toBe('schedule')
    expect(result.candidates.length).toBeGreaterThanOrEqual(2)
  })
})