import { describe, expect, it } from 'vitest'
import { MESSAGES, translate } from '@shared/message-catalog'

const REQUIRED_KEYS = [
  'import.menuManual',
  'import.menuFile',
  'import.menuVideo',
  'import.menuFileHint',
  'import.menuVideoHint',
  'import.fileTooLarge',
  'import.tooManyFiles',
  'import.batchTooLarge',
  'import.formatUnsupported',
  'import.imageUseAgent',
  'import.noText',
  'import.decodeFailed',
  'import.readFailed',
  'import.pickerFailed',
  'import.dragHint',
  'import.videoUnsupported',
  'import.videoAltAudio',
  'import.videoAltShot',
  'import.noScheduleFound',
  'import.truncated',
  'import.askMore',
  'import.sourceLabel',
  'import.titlePending',
  'import.remainder',
  'import.queueProgress',
  'import.batchSummary',
  'import.batchResult',
  'import.batchToast',
  'import.writtenElsewhere',
  'import.cancelled'
]

describe('导入文案矩阵', () => {
  it('失败矩阵引用的键全部存在且非空', () => {
    for (const key of REQUIRED_KEYS) {
      expect(typeof MESSAGES[key]).toBe('string')
      expect((MESSAGES[key] as string).length > 0).toBe(true)
    }
  })

  it('占位符被替换且无残留花括号', () => {
    const text = translate('import.fileTooLarge', { limit: '2 MB' })
    expect(text.includes('{')).toBe(false)
    expect(text.includes('2 MB')).toBe(true)
    const source = translate('import.sourceLabel', { name: '排班表.txt' })
    expect(source.includes('排班表.txt')).toBe(true)
    expect(source.includes('来源：导入文件')).toBe(true)
    const remainder = translate('import.remainder', { ok: 1, missed: 2 })
    expect(remainder.includes('1')).toBe(true)
    expect(remainder.includes('2')).toBe(true)
  })

  it('视频文案不出现空头承诺', () => {
    const text = [
      translate('import.videoUnsupported'),
      translate('import.videoAltAudio'),
      translate('import.videoAltShot')
    ].join('|')
    expect(text.includes('敬请期待')).toBe(false)
    expect(text.includes('即将上线')).toBe(false)
  })

  it('图片提示与格式不支持可区分、拖放提示独立', () => {
    expect(translate('import.imageUseAgent').includes('图片')).toBe(true)
    expect(translate('import.imageUseAgent').includes('不支持')).toBe(false)
    expect(translate('import.dragHint').includes('拖放')).toBe(true)
    expect(translate('import.dragHint').includes('不支持该格式')).toBe(false)
  })
})