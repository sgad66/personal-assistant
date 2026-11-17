import { describe, expect, it } from 'vitest'
import { IMPORT_LIMITS } from '@shared/import/limits'
import { planImportBatch } from '@shared/import/plan'

const MB = 1024 * 1024

describe('导入批次计划', () => {
  it('第七个文件被数量上限拒绝', () => {
    const files = Array.from({ length: 7 }, (_unused, index) => ({
      name: `f${index}.txt`,
      size: 1024
    }))
    const plan = planImportBatch(files)
    expect(plan.accepted).toHaveLength(6)
    expect(plan.rejected).toHaveLength(1)
    expect(plan.rejected[0]?.reasonKey).toBe('import.tooManyFiles')
  })

  it('2MB 边界：等于通过、超出拒绝', () => {
    const exact = planImportBatch([{ name: 'a.txt', size: IMPORT_LIMITS.maxFileBytes }])
    expect(exact.accepted).toHaveLength(1)
    const over = planImportBatch([{ name: 'b.txt', size: IMPORT_LIMITS.maxFileBytes + 1 }])
    expect(over.accepted).toHaveLength(0)
    expect(over.rejected[0]?.reasonKey).toBe('import.fileTooLarge')
  })

  it('合计超过 6MB 整批拒绝但保留真实合计', () => {
    const files = Array.from({ length: 6 }, (_unused, index) => ({
      name: `f${index}.txt`,
      size: Math.round(1.9 * MB)
    }))
    const plan = planImportBatch(files)
    expect(plan.batchRejected).toBe('import.batchTooLarge')
    expect(plan.accepted).toHaveLength(0)
    expect(plan.totalBytes).toBe(files.reduce((sum, file) => sum + file.size, 0))
  })

  it('图片、视频、PDF 分别归类', () => {
    const plan = planImportBatch([
      { name: 'a.png', size: 100 },
      { name: 'b.mp4', size: 100 },
      { name: 'c.PDF', size: 100 }
    ])
    const reasons = plan.rejected.map((file) => file.reasonKey)
    expect(reasons.includes('import.imageUseAgent')).toBe(true)
    expect(reasons.includes('import.videoUnsupported')).toBe(true)
    expect(reasons.includes('import.formatUnsupported')).toBe(true)
    const pdf = plan.rejected.find((file) => file.name === 'c.PDF')
    expect(pdf?.ext).toBe('pdf')
  })

  it('通过项按原顺序保留', () => {
    const plan = planImportBatch([
      { name: 'a.txt', size: 10 },
      { name: 'b.md', size: 20 }
    ])
    expect(plan.accepted.map((file) => file.name)).toEqual(['a.txt', 'b.md'])
    expect(plan.totalBytes).toBe(30)
  })
})