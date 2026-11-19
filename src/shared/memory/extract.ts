import type { MemoryCandidate, MemoryKind } from '@shared/domain/types'

interface MemoryRule {
  readonly kind: MemoryKind
  readonly pattern: RegExp
  readonly confidence: number
}

const RULES: readonly MemoryRule[] = [
  {
    kind: 'profile',
    pattern: /(我叫|我的生日|我住在|我在.{0,10}(?:工作|上班|上学)|我是.{0,12}(?:工程师|设计师|老师|学生|医生|产品经理|程序员))/,
    confidence: 0.82
  },
  {
    kind: 'preference',
    pattern: /(我(?:更|最)?(?:喜欢|偏好|习惯|通常|一般|讨厌|不喜欢)|对我来说|以后都|请记住|帮我记住|别再|不要再)/,
    confidence: 0.76
  },
  {
    kind: 'habit',
    pattern: /(我(?:每天|每周|工作日|早上|晚上|周末).{0,30}(?:习惯|都会|固定|通常|一般|坚持))/,
    confidence: 0.72
  },
  {
    kind: 'commitment',
    pattern: /(我(?:要|计划|准备|打算|希望).{0,36}(?:完成|做完|写完|学完|交付|坚持|养成|准备))/,
    confidence: 0.66
  },
  {
    kind: 'relation',
    pattern: /(我(?:老婆|老公|爱人|伴侣|儿子|女儿|妈妈|爸爸|同事|老板|朋友).{0,24})/,
    confidence: 0.72
  }
]

const MAX_CANDIDATES = 3
const MAX_CONTENT = 180

export function normalizeMemoryContent(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？、；：,.!?;:（）()【】[\]"]/g, '')
}

function cleanSentence(sentence: string): string {
  return sentence
    .trim()
    .replace(/^(?:请|麻烦|帮我|劳驾)?(?:记住|记一下|记得)[:：]?\s*/u, '')
    .replace(/^以后都\s*/u, '')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_CONTENT)
}

export function extractLocalMemories(text: string, now: number): MemoryCandidate[] {
  void now
  const sentences = text
    .split(/[。！？!?；;\n]/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
  const found: MemoryCandidate[] = []
  for (const sentence of sentences) {
    const rule = RULES.find((item) => item.pattern.test(sentence))
    if (!rule) continue
    const content = cleanSentence(sentence)
    if (content.length < 4) continue
    if (found.some((item) => normalizeMemoryContent(item.content) === normalizeMemoryContent(content))) {
      continue
    }
    found.push({ content, kind: rule.kind, confidence: rule.confidence })
    if (found.length >= MAX_CANDIDATES) break
  }
  return found
}