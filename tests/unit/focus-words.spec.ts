import { describe, expect, it } from 'vitest'
import { buildFocusWords } from '@shared/focus-words'

describe('近期焦点词', () => {
  it('没有文本时返回空数组', () => {
    expect(buildFocusWords([])).toEqual([])
    expect(buildFocusWords([{ text: '   ' }])).toEqual([])
  })

  it('剥离时间前缀、语气词并过滤停用短语', () => {
    const words = buildFocusWords([
      { text: '明天下午产品评审会了', kind: 'schedule', weight: 2 },
      { text: '可以休息', kind: 'conversation' },
      { text: '安排', kind: 'conversation' },
      { text: '明天上午', kind: 'conversation' }
    ])
    expect(words.map((item) => item.word)).toEqual(['产品评审会'])
  })

  it('相同焦点跨来源合并，展示首次出现的写法', () => {
    const words = buildFocusWords([
      { text: '产品评审会', kind: 'schedule', weight: 1.4 },
      { text: 'deepseek 调优', kind: 'conversation', weight: 1 },
      { text: 'DeepSeek', kind: 'memory', weight: 1.9 }
    ])
    expect(words[0].word).toBe('DeepSeek')
    expect(words[0].count).toBe(2)
    expect(words[0].kinds).toEqual(['memory', 'conversation'])
    expect(words[1].word).toBe('产品评审会')
    expect(words[2].word).toBe('调优')
  })

  it('长句按虚词拆成可读的焦点短语，纯时间片段被丢弃', () => {
    const words = buildFocusWords([
      { text: '帮我确认一下下周三下午的产品评审会流程', kind: 'conversation' }
    ])
    expect(words.map((item) => item.word)).toEqual(['产品评审会流程'])
  })

  it('过滤对话里的操作词、时间短语与一次性长句', () => {
    const words = buildFocusWords([
      { text: '清空明天的安排', kind: 'conversation' },
      { text: '取消', kind: 'conversation' },
      { text: '到周六', kind: 'conversation' },
      { text: '你可以引用我之前的输入', kind: 'conversation' },
      { text: '鸽巢原理是什么', kind: 'conversation' },
      { text: '鸽巢原理', kind: 'conversation' }
    ])
    expect(words.map((item) => item.word)).toEqual(['鸽巢原理'])
  })

  it('较长的短语优先于被它包含的短词', () => {
    const words = buildFocusWords([
      { text: '产品评审会流程', kind: 'schedule', weight: 1 },
      { text: '产品评审会', kind: 'schedule', weight: 1 }
    ])
    expect(words.map((item) => item.word)).toEqual(['产品评审会流程'])
  })

  it('过滤英文停用词并保留英文专有名词大小写', () => {
    const words = buildFocusWords([
      { text: 'the and for with', kind: 'conversation' },
      { text: 'DeepSeek 接口调优', kind: 'memory', weight: 2 }
    ])
    expect(words.map((item) => item.word)).toEqual(['DeepSeek', '接口调优'])
  })

  it('限制返回数量，顺序稳定可重复', () => {
    const sources = [
      { text: '产品评审会', kind: 'schedule' as const, weight: 3 },
      { text: '季度目标', kind: 'goal' as const, weight: 2 },
      { text: '周报', kind: 'schedule' as const },
      { text: '健身', kind: 'memory' as const }
    ]
    const first = buildFocusWords(sources, { limit: 2 })
    const second = buildFocusWords(sources, { limit: 2 })
    expect(first).toEqual(second)
    expect(first).toHaveLength(2)
    expect(first.map((item) => item.word)).toEqual(['产品评审会', '季度目标'])
  })

  it('忽略非法来源与空内容', () => {
    const words = buildFocusWords([
      { text: '' },
      { text: '   \n  ' },
      { text: '健身' }
    ])
    expect(words.map((item) => item.word)).toEqual(['健身'])
  })
})