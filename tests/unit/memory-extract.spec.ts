import { describe, expect, it } from 'vitest'
import { extractLocalMemories } from '@shared/memory/extract'

describe('本地记忆提取', () => {
  const now = 1_760_000_000_000

  it('识别明确偏好', () => {
    const result = extractLocalMemories('我更喜欢把会议安排在上午。', now)
    expect(result).toHaveLength(1)
    expect(result[0]?.kind).toBe('preference')
    expect(result[0]?.content).toContain('喜欢')
  })

  it('识别个人信息', () => {
    const result = extractLocalMemories('我的生日是5月20日，记得提醒我。', now)
    expect(result[0]?.kind).toBe('profile')
    expect(result[0]?.content).toContain('5月20日')
  })

  it('识别习惯与长期承诺', () => {
    const habit = extractLocalMemories('我每周五晚上都会复盘这周的工作。', now)
    expect(habit[0]?.kind).toBe('habit')
    const commitment = extractLocalMemories('我计划这个月完成论文初稿。', now)
    expect(commitment[0]?.kind).toBe('commitment')
  })

  it('普通一次性日程不写入记忆', () => {
    expect(extractLocalMemories('明天下午三点开项目周会。', now)).toHaveLength(0)
  })

  it('清理“请记住”前缀并去重', () => {
    const result = extractLocalMemories('请记住：我喜欢早上开会。我喜欢早上开会。', now)
    expect(result).toHaveLength(1)
    expect(result[0]?.content).toBe('我喜欢早上开会')
  })

  it('最多返回三条', () => {
    const result = extractLocalMemories(
      '我喜欢上午开会。我住在杭州。我每天都会读半小时书。我计划今年完成一个 side project。',
      now
    )
    expect(result.length).toBeLessThanOrEqual(3)
  })
})