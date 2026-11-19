import { describe, expect, it } from 'vitest'
import { layoutFocusCloud, type CloudWordBox } from '@renderer/components/home/focus-cloud-layout'

function makeWords(count: number): CloudWordBox[] {
  return Array.from({ length: count }, (_, index) => ({
    width: 52 + ((index * 23) % 104),
    height: 20 + (index % 3) * 4
  }))
}

function overlaps(
  a: { x: number; y: number; box: CloudWordBox },
  b: { x: number; y: number; box: CloudWordBox },
  gap: number
): boolean {
  const aLeft = a.x - a.box.width / 2
  const aRight = a.x + a.box.width / 2
  const aTop = a.y - a.box.height / 2
  const aBottom = a.y + a.box.height / 2
  const bLeft = b.x - b.box.width / 2
  const bRight = b.x + b.box.width / 2
  const bTop = b.y - b.box.height / 2
  const bBottom = b.y + b.box.height / 2
  return aLeft < bRight + gap && aRight + gap > bLeft && aTop < bBottom + gap && aBottom + gap > bTop
}

describe('云状词云布局', () => {
  it('没有词或宽度无效时返回空布局', () => {
    expect(layoutFocusCloud([], { width: 640 })).toEqual({ placements: [], height: 0 })
    expect(layoutFocusCloud(makeWords(4), { width: 0 })).toEqual({ placements: [], height: 0 })
  })

  it('宽容器下所有词都落在容器内且互不重叠', () => {
    const width = 676
    const words = makeWords(16)
    const layout = layoutFocusCloud(words, { width, gap: 12 })
    expect(layout.placements).toHaveLength(16)
    expect(layout.height).toBeGreaterThanOrEqual(200)
    expect(layout.height).toBeLessThanOrEqual(460)

    for (const [index, placement] of layout.placements.entries()) {
      const box = words[index]
      expect(placement.x - box.width / 2).toBeGreaterThanOrEqual(-width / 2)
      expect(placement.x + box.width / 2).toBeLessThanOrEqual(width / 2)
    }

    for (let i = 0; i < layout.placements.length; i += 1) {
      for (let j = i + 1; j < layout.placements.length; j += 1) {
        expect(
          overlaps(
            { x: layout.placements[i].x, y: layout.placements[i].y, box: words[i] },
            { x: layout.placements[j].x, y: layout.placements[j].y, box: words[j] },
            12
          )
        ).toBe(false)
      }
    }
  })

  it('窄容器与较少词也能保持不重叠', () => {
    const width = 374
    const words = makeWords(9)
    const layout = layoutFocusCloud(words, { width, gap: 10 })
    expect(layout.placements).toHaveLength(9)
    for (let i = 0; i < layout.placements.length; i += 1) {
      for (let j = i + 1; j < layout.placements.length; j += 1) {
        expect(
          overlaps(
            { x: layout.placements[i].x, y: layout.placements[i].y, box: words[i] },
            { x: layout.placements[j].x, y: layout.placements[j].y, box: words[j] },
            10
          )
        ).toBe(false)
      }
    }
  })

  it('相同输入布局完全一致，不依赖随机数', () => {
    const words = makeWords(14)
    const first = layoutFocusCloud(words, { width: 620 })
    const second = layoutFocusCloud(words, { width: 620 })
    expect(second).toEqual(first)
  })

  it('按 maxWords 限制参与布局的词数', () => {
    const layout = layoutFocusCloud(makeWords(20), { width: 640, maxWords: 8 })
    expect(layout.placements).toHaveLength(8)
  })

  it('短词使用固定微旋转，长词保持水平', () => {
    const words: CloudWordBox[] = [
      { width: 150, height: 34 },
      { width: 54, height: 18 },
      { width: 120, height: 26 }
    ]
    const layout = layoutFocusCloud(words, { width: 640 })
    expect(layout.placements[0].rotate).toBe(0)
    expect(Math.abs(layout.placements[1].rotate)).toBeGreaterThan(0)
    expect(layout.placements[2].rotate).toBe(0)
  })
})