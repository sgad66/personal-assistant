export const EXTRACT_TIME_SOURCE =
  '(今天|今日|明天|明日|后天|大后天|(?:本|这|这个)(?:周|星期|礼拜)[一二三四五六日天]|下(?:个)?(?:周|星期|礼拜)[一二三四五六日天]|(?:周|星期|礼拜)[一二三四五六日天]|\\d{1,2}月\\d{1,2}[日号]?)[^，,。；;]{0,12}?(?:\\d{1,2}\\s*[:：]\\s*\\d{1,2}|[零一二两三四五六七八九十\\d]{1,3}\\s*[点時时](?:半|[零一二两三四五六七八九十\\d]{1,2}\\s*分?)?)'

export const CLOCK_ONLY_SOURCE =
  '\\d{1,2}\\s*[:：]\\s*\\d{1,2}|(?:上午|下午|晚上|中午|早上|凌晨)?\\s*[零一二两三四五六七八九十\\d]{1,3}\\s*[点時时](?:半)?'

export const TIME_CLUE_SOURCE = `${EXTRACT_TIME_SOURCE}|${CLOCK_ONLY_SOURCE}`

export function hasTimeClue(text: string): boolean {
  return new RegExp(TIME_CLUE_SOURCE).test(text)
}

export interface TextWindow {
  readonly text: string
  readonly clipped: boolean
  readonly originalChars: number
  readonly usedChars: number
  readonly hasClue: boolean
}

interface Span {
  readonly start: number
  readonly end: number
  readonly hits: number
}

export function selectTimeClueWindow(text: string, budget: number): TextWindow {
  const normalized = text.replace(/\r\n?/g, '\n')
  const originalChars = normalized.replace(/\s+/g, '').length
  const lines = normalized.split('\n')
  const hitIndexes = lines.map((line, index) => (hasTimeClue(line) ? index : -1)).filter((index) => index >= 0)

  if (hitIndexes.length === 0) {
    const clippedText = normalized.slice(0, budget)
    return {
      text: clippedText,
      clipped: clippedText.length < normalized.length,
      originalChars,
      usedChars: clippedText.length,
      hasClue: false
    }
  }

  const spans: Span[] = []
  for (const hit of hitIndexes) {
    const start = Math.max(0, hit - 1)
    const end = Math.min(lines.length - 1, hit + 1)
    const last = spans[spans.length - 1]
    if (last && start <= last.end + 1) {
      spans[spans.length - 1] = { start: last.start, end: Math.max(last.end, end), hits: last.hits + 1 }
    } else {
      spans.push({ start, end, hits: 1 })
    }
  }

  let selected = spans.slice()
  while (selected.length > 1) {
    const textLength = selected.reduce((sum, span) => sum + spanOf(lines, span).length + 1, -1)
    if (textLength <= budget) break
    selected = selected.slice(0, -1)
  }

  let output = selected.map((span) => spanOf(lines, span)).join('\n')
  if (output.length > budget) {
    output = output.slice(0, budget)
  }
  return {
    text: output,
    clipped: output.length < normalized.length,
    originalChars,
    usedChars: output.length,
    hasClue: true
  }
}

function spanOf(lines: readonly string[], span: Span): string {
  return lines.slice(span.start, span.end + 1).join('\n')
}