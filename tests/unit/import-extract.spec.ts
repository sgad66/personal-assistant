import { describe, expect, it } from 'vitest'
import { extractText } from '@shared/import/extract'

describe('有限文本化', () => {
  it('ICS 提取时间、标题与地点且标注 UTC', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:周会',
      'DTSTART:20261120T090000Z',
      'DTEND:20261120T100000Z',
      'LOCATION:3F',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    const result = extractText('ics', raw)
    expect(result.text.includes('11月20日')).toBe(true)
    expect(result.text.includes('09:00')).toBe(true)
    expect(result.text.includes('(UTC)')).toBe(true)
    expect(result.text.includes('周会')).toBe(true)
    expect(result.text.includes('3F')).toBe(true)
  })

  it('ICS 的 RRULE 不展开并记 notes', () => {
    const raw = [
      'BEGIN:VEVENT',
      'SUMMARY:例会',
      'DTSTART:20261120T090000',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT'
    ].join('\n')
    const result = extractText('ics', raw)
    expect(result.text.includes('RRULE')).toBe(false)
    expect(result.notes.includes('ics_rrule_ignored')).toBe(true)
  })

  it('JSON 深度与条数受限', () => {
    let deep: Record<string, unknown> = { value: '第七层' }
    for (let index = 0; index < 7; index += 1) {
      deep = { nested: deep }
    }
    const depth = extractText('json', JSON.stringify(deep))
    expect(depth.text.includes('第七层')).toBe(false)
    expect(depth.notes.includes('json_depth_limited')).toBe(true)

    const many = extractText(
      'json',
      JSON.stringify(Array.from({ length: 301 }, (_unused, index) => `v${index}`))
    )
    expect(many.text.split('\n')).toHaveLength(300)
    expect(many.notes.includes('json_count_limited')).toBe(true)
  })

  it('Markdown 去标记、CSV 保行、非法 JSON 不抛错', () => {
    const md = extractText('md', '# 标题\n> 引用\n**粗** 与 `代码` 与 [链接](https://x)')
    expect(md.text.includes('#')).toBe(false)
    expect(md.text.includes('**')).toBe(false)
    expect(md.text.includes('标题')).toBe(true)
    expect(md.text.includes('链接')).toBe(true)
    expect(md.text.includes('https://x')).toBe(false)

    const csv = extractText('csv', 'a,b\n1,2\n3,4')
    expect(csv.text.split('\n')).toHaveLength(3)

    const broken = extractText('json', '{not json')
    expect(broken.text).toBe('{not json')
    expect(broken.notes.includes('json_parse_failed')).toBe(true)
  })
})