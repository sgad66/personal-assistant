export type FocusSourceKind = 'schedule' | 'goal' | 'memory' | 'conversation'

export interface FocusSource {
  readonly text: string
  readonly weight?: number
  readonly kind?: FocusSourceKind
}

export interface FocusWord {
  readonly word: string
  readonly weight: number
  readonly count: number
  readonly kinds: readonly FocusSourceKind[]
}

export interface FocusWordOptions {
  readonly limit?: number
}

export const FOCUS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
export const FOCUS_WORD_LIMIT = 24

const KIND_ORDER: readonly FocusSourceKind[] = ['schedule', 'goal', 'memory', 'conversation']

const PHRASE_MAX = 12
const TITLE_PHRASE_MAX = 20

const STOP_PHRASES = new Set([
  '可以',
  '休息',
  '没有',
  '什么',
  '怎么',
  '怎样',
  '一下',
  '这个',
  '那个',
  '这些',
  '那些',
  '我们',
  '你们',
  '他们',
  '自己',
  '时候',
  '现在',
  '一些',
  '事情',
  '东西',
  '需要',
  '觉得',
  '知道',
  '看看',
  '试试',
  '谢谢',
  '你好',
  '是的',
  '对的',
  '好的',
  '就是',
  '然后',
  '另外',
  '还有',
  '关于',
  '大概',
  '可能',
  '如果',
  '但是',
  '不过',
  '所以',
  '因为',
  '安排',
  '之间',
  '以及',
  '进行',
  '一个',
  '两个',
  '有点',
  '比较',
  '非常',
  '真的',
  '已经',
  '还是',
  '或者',
  '而且',
  '同时',
  '而已',
  '一起',
  '感觉',
  '有点',
  '最后',
  '开始',
  '结束',
  '取消',
  '清空',
  '删除',
  '修改',
  '更新',
  '查询',
  '查找',
  '打开',
  '关闭',
  '设置',
  '切换',
  '提交',
  '保存',
  '引用',
  '输入',
  '之前',
  '上面',
  '下面',
  '这段话',
  '这句话',
  '回答',
  '消息',
  '内容'
])

const STOP_ENGLISH = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'for',
  'with',
  'to',
  'of',
  'in',
  'on',
  'at',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'i',
  'you',
  'he',
  'she',
  'we',
  'they',
  'my',
  'your',
  'our',
  'their',
  'me',
  'us',
  'them',
  'do',
  'does',
  'did',
  'will',
  'would',
  'can',
  'could',
  'should',
  'have',
  'has',
  'had',
  'not',
  'from',
  'by',
  'as',
  'so',
  'if',
  'then',
  'than',
  'too',
  'very',
  'just',
  'about',
  'into',
  'over',
  'after',
  'before',
  'up',
  'down',
  'out',
  'off',
  'again',
  'please',
  'help',
  'let',
  'lets',
  'get',
  'got',
  'make',
  'made',
  'ok',
  'okay'
])

const LEADING_WORDS = [
  '帮我',
  '麻烦',
  '请问',
  '告诉我',
  '提醒我',
  '记得',
  '你可以',
  '你能',
  '我们',
  '我想',
  '我要',
  '我的',
  '我',
  '然后',
  '另外',
  '还有',
  '关于',
  '大概',
  '可能',
  '如果',
  '但是',
  '不过',
  '所以',
  '因为',
  '就是',
  '一下',
  '之前',
  '安排',
  '确认',
  '讨论',
  '跟进',
  '处理',
  '准备',
  '参加',
  '完成',
  '检查',
  '整理',
  '清空',
  '删除',
  '取消',
  '添加',
  '修改',
  '更新',
  '查询',
  '查找',
  '打开',
  '关闭',
  '设置',
  '切换',
  '提交',
  '保存',
  '引用'
]

const LEADING_TIME =
  /^(?:(?:今天|明天|后天|昨天|前天|本周|这周|下周|周末|周[一二三四五六日天]|星期[一二三四五六日天]|最近|近期|今年|明年|去年)(?:[一二三四五六七八九十]{1,2})?(?:上午|下午|晚上|早上|中午|今晚)?的?)/u

const TRAILING_CHARS = new Set(Array.from('的了着过吗呢吧呀啊嘛哦呐哈'))

const TRAILING_PHRASES = ['是什么', '有什么', '有哪些', '怎么办', '怎么做', '怎么弄', '为什么', '怎么样', '啥意思']

const SOFT_BOUNDARY = /(?:为了|的|了|和|与|及|或|在|把|被|让|给|对|从|向|为)/u

const TIME_PHRASE =
  /^(?:(?:到|从|至|于|在)?(?:(?:今天|明天|后天|昨天|前天|本周|这周|下周|周末|周[一二三四五六日天]|星期[一二三四五六日天]|上午|下午|晚上|早上|中午|今晚|最近|近期|今年|明年|去年|\d{1,2}|[一二三四五六七八九十]{1,2}|[点时:：分秒号月日年半前后]+))\s*)+$/u

const FILE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'txt',
  'csv',
  'md',
  'mp3',
  'mp4',
  'wav',
  'zip',
  'rar',
  'html',
  'json',
  'ts',
  'tsx',
  'js',
  'css',
  'exe'
])

const CHUNK_SPLIT = /[\s,，。.!！?？;；:：、·|/\\()（）[\]【】{}《》"“”‘’…—_-]+/u

interface Accumulator {
  word: string
  key: string
  weight: number
  count: number
  firstIndex: number
  kinds: Set<FocusSourceKind>
}

function normalizeWidth(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

function stripNoise(text: string): string {
  return normalizeWidth(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*>\s?/gm, '')
}

function charLength(value: string): number {
  return Array.from(value).length
}

function trimPhrase(chunk: string): string {
  let phrase = chunk.trim()
  let changed = true
  while (changed && phrase.length > 0) {
    changed = false
    const withoutTime = phrase.replace(LEADING_TIME, '')
    if (withoutTime !== phrase) {
      phrase = withoutTime.trim()
      changed = true
      continue
    }
    for (const word of LEADING_WORDS) {
      if (phrase.startsWith(word) && charLength(phrase) > charLength(word)) {
        phrase = phrase.slice(word.length)
        changed = true
        break
      }
    }
  }
  while (phrase.length > 1 && (phrase.startsWith('的') || phrase.startsWith('地') || phrase.startsWith('得'))) {
    phrase = phrase.slice(1)
  }
  for (const suffix of TRAILING_PHRASES) {
    if (phrase.endsWith(suffix) && charLength(phrase) > charLength(suffix)) {
      phrase = phrase.slice(0, -suffix.length)
      break
    }
  }
  while (phrase.length > 0 && TRAILING_CHARS.has(phrase.slice(-1))) {
    phrase = phrase.slice(0, -1)
  }
  return phrase.trim()
}

function isStopPhrase(phrase: string): boolean {
  if (STOP_PHRASES.has(phrase)) return true
  const chars = Array.from(phrase)
  if (chars.length < 4 || chars.length > 8) return false
  const reachable = new Array<boolean>(chars.length + 1).fill(false)
  reachable[0] = true
  for (let end = 1; end <= chars.length; end += 1) {
    for (let start = 0; start < end; start += 1) {
      if (!reachable[start]) continue
      if (!STOP_PHRASES.has(chars.slice(start, end).join(''))) continue
      reachable[end] = true
      break
    }
  }
  return reachable[chars.length] === true
}

function isCandidate(phrase: string): boolean {
  if (phrase.length === 0) return false
  const chars = Array.from(phrase)
  if (chars.length < 2) return false
  if (!/[A-Za-z0-9\u4e00-\u9fff]/.test(phrase)) return false
  if (/^\d+$/.test(phrase)) return false
  if (/^[A-Za-z]$/.test(phrase)) return false
  if (isStopPhrase(phrase) || STOP_ENGLISH.has(phrase.toLowerCase())) return false
  if (FILE_EXTENSIONS.has(phrase.toLowerCase())) return false
  if (/^[\d.:%+-]+$/.test(phrase)) return false
  if (TIME_PHRASE.test(phrase)) return false
  return true
}

function expandChunk(chunk: string, maxChars: number): string[] {
  if (charLength(chunk) <= PHRASE_MAX) {
    const trimmed = trimPhrase(chunk)
    if (trimmed.length === 0 || charLength(trimmed) > maxChars) return []
    return [trimmed]
  }
  return chunk
    .split(SOFT_BOUNDARY)
    .map(trimPhrase)
    .filter((part) => part.length > 0 && charLength(part) <= maxChars)
}

function chunksOf(text: string, maxChars: number): string[] {
  const pieces: string[] = []
  for (const raw of stripNoise(text).split(CHUNK_SPLIT)) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    for (const part of expandChunk(trimmed, maxChars)) {
      if (!isCandidate(part)) continue
      pieces.push(part)
    }
  }
  return pieces
}

function accumulate(
  map: Map<string, Accumulator>,
  word: string,
  weight: number,
  kind: FocusSourceKind,
  index: number
): void {
  const key = word.toLowerCase()
  const existing = map.get(key)
  if (existing) {
    existing.weight += weight
    existing.count += 1
    existing.kinds.add(kind)
    if (/[A-Z]/.test(word) && !/[A-Z]/.test(existing.word)) existing.word = word
    return
  }
  map.set(key, {
    word,
    key,
    weight,
    count: 1,
    firstIndex: index,
    kinds: new Set([kind])
  })
}

function pickKind(kind: FocusSourceKind | undefined): FocusSourceKind {
  return kind ?? 'conversation'
}

function weightOf(source: FocusSource): number {
  const weight = source.weight
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) return 1
  return weight
}

export function buildFocusWords(
  sources: readonly FocusSource[],
  options: FocusWordOptions = {}
): FocusWord[] {
  const limit = options.limit ?? FOCUS_WORD_LIMIT
  const found = new Map<string, Accumulator>()

  sources.forEach((source, index) => {
    if (!source || typeof source.text !== 'string') return
    const text = source.text.trim()
    if (text.length === 0) return
    const kind = pickKind(source.kind)
    const weight = weightOf(source)
    const maxChars = kind === 'schedule' || kind === 'goal' ? TITLE_PHRASE_MAX : PHRASE_MAX

    for (const phrase of chunksOf(text, maxChars)) {
      accumulate(found, phrase, weight, kind, index)
    }
  })

  const byLength = [...found.values()].sort((a, b) => charLength(b.word) - charLength(a.word))
  const chosen: Accumulator[] = []
  for (const candidate of byLength) {
    const covered = chosen.find(
      (item) => item.key !== candidate.key && item.word.includes(candidate.word) && item.weight >= candidate.weight
    )
    if (covered) continue
    chosen.push(candidate)
  }

  chosen.sort((a, b) => {
    if (a.weight !== b.weight) return b.weight - a.weight
    if (a.count !== b.count) return b.count - a.count
    return a.firstIndex - b.firstIndex
  })

  const filtered = chosen.filter((item) => {
    const onlyConversation = item.kinds.size === 1 && item.kinds.has('conversation')
    if (onlyConversation && item.count === 1 && charLength(item.word) > 10) return false
    return true
  })

  return filtered.slice(0, limit).map((item) => ({
    word: item.word,
    weight: Math.round(item.weight * 100) / 100,
    count: item.count,
    kinds: KIND_ORDER.filter((kind) => item.kinds.has(kind))
  }))
}