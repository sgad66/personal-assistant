import { ok, type Result } from '@shared/result'
import { httpsJson, joinUrl } from './http-client'
import type { IntentKind, ITextUnderstandingProvider, ParseRequest, ParseResult, ProviderConfig } from './types'
import { failFromCategory, notConfiguredFailure } from './error-mapping'
import type { Logger } from '../observability/logger'

const SYSTEM_PROMPT = [
  '你是中文日程解析助手。请从用户输入中抽取需要安排的日程，只输出 JSON，不要输出任何解释。',
  '返回结构：{"intentKind":"schedule|modify|cancel|chitchat|unknown","candidates":[{"title":"事项标题","startExpression":"原文时间表达","endExpression":"原文结束时间表达(可选)","location":"地点(可选)","note":"备注(可选)"}],"replyText":"面向用户的一句话回复","confidence":0到1的数字}',
  '规则：startExpression 必须保留原文的相对时间表达（例如“明天下午三点”“下周三上午”），不要自行换算成绝对时间；',
  '未提到结束时间就省略 endExpression；闲聊或问候返回 chitchat 且 candidates 为空；',
  '改了最近一条安排返回 modify；取消最近一条返回 cancel；图片识别出多个事项时返回多个 candidates。'
].join('\n')

interface ChatChoice {
  message?: { content?: string }
}

interface ChatResponse {
  choices?: ChatChoice[]
}

export class LlmProvider implements ITextUnderstandingProvider {
  constructor(
    private readonly config: ProviderConfig,
    private readonly logger: Logger,
    private readonly timeoutMs = 20_000
  ) {}

  async parse(request: ParseRequest): Promise<Result<ParseResult>> {
    if (!this.config.apiKey) {
      return notConfiguredFailure()
    }
    const started = Date.now()
    const response = await httpsJson(
      joinUrl(this.config.baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                `当前时间：${new Date(request.referenceTime).toLocaleString('zh-CN', { hour12: false })}`,
                `时区：${request.timeZone}`,
                request.contextHints && request.contextHints.length > 0
                  ? `上下文：${request.contextHints.join('；')}`
                  : '',
                `用户输入：${request.description}`
              ]
                .filter((line) => line.length > 0)
                .join('\n')
            }
          ]
        })
      },
      this.timeoutMs
    )

    if (!response.ok) {
      const category = response.failureCategory ?? 'serviceError'
      this.logger.failure('parse.failed', 'E_AI_UNAVAILABLE', Date.now() - started, category)
      return failFromCategory(category)
    }

    const body = response.body as ChatResponse
    const content = body.choices?.[0]?.message?.content ?? ''
    const interpreted = interpretModelContent(content)
    if (!interpreted) {
      this.logger.failure('parse.failed', 'E_AI_UNAVAILABLE', Date.now() - started, 'unparsable')
      return failFromCategory('unparsable')
    }

    this.logger.success('parse.completed', Date.now() - started)
    return ok(interpreted)
  }
}

const INTENT_ALIASES: Readonly<Record<string, IntentKind>> = {
  schedule: 'schedule',
  modify: 'modify',
  cancel: 'cancel',
  chitchat: 'chitchat',
  unknown: 'unknown',
  chat: 'chitchat',
  greeting: 'chitchat',
  create: 'schedule',
  add: 'schedule',
  update: 'modify',
  change: 'modify',
  delete: 'cancel',
  remove: 'cancel'
}

export function interpretModelContent(content: string): ParseResult | undefined {
  const trimmed = content.trim()
  if (trimmed.length === 0) return undefined
  const jsonText = extractJson(trimmed)
  if (!jsonText) return undefined
  try {
    return coerceParseResult(JSON.parse(jsonText) as unknown)
  } catch {
    return undefined
  }
}

export function coerceParseResult(raw: unknown): ParseResult | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const value = raw as Record<string, unknown>
  const kindRaw = typeof value.intentKind === 'string' ? value.intentKind.trim().toLowerCase() : 'unknown'
  const intentKind = INTENT_ALIASES[kindRaw]
  if (!intentKind) return undefined

  const candidatesRaw = Array.isArray(value.candidates) ? value.candidates : []
  const candidates = candidatesRaw.slice(0, 10).flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const candidate = item as Record<string, unknown>
    const text = (key: string, max: number): string | undefined =>
      typeof candidate[key] === 'string' && (candidate[key] as string).trim().length > 0
        ? (candidate[key] as string).trim().slice(0, max)
        : undefined
    return [
      {
        ...(text('title', 80) ? { title: text('title', 80) } : {}),
        ...(text('startExpression', 80) ? { startExpression: text('startExpression', 80) } : {}),
        ...(text('endExpression', 80) ? { endExpression: text('endExpression', 80) } : {}),
        ...(text('location', 100) ? { location: text('location', 100) } : {}),
        ...(text('note', 200) ? { note: text('note', 200) } : {})
      }
    ]
  })

  let confidence = 0.6
  if (typeof value.confidence === 'number' && Number.isFinite(value.confidence)) {
    confidence = value.confidence
  } else if (typeof value.confidence === 'string') {
    const numeric = Number(value.confidence)
    if (Number.isFinite(numeric)) confidence = numeric
  }
  if (confidence > 1 && confidence <= 100) confidence = confidence / 100
  confidence = Math.min(1, Math.max(0, confidence))

  const replyText = typeof value.replyText === 'string' ? value.replyText.trim().slice(0, 1000) : ''
  return { intentKind, candidates, replyText, confidence }
}

function extractJson(content: string): string | undefined {
  const trimmed = content.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  if (fenced?.[1]) return fenced[1].trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return undefined
}