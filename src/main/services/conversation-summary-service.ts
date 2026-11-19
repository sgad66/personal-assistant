import type { ConversationMessage, ConversationSummary } from '@shared/domain/types'
import { fail, type Result } from '@shared/result'
import type { ConversationRepository } from '../storage/conversation-repository'
import type { DataStore } from '../storage/data-store'
import type { Logger } from '../observability/logger'
import type { ResolvedAccess } from '../ai/provider-resolver'
import type { ITextUnderstandingProvider } from '../providers/types'


const SUMMARY_MIN_NEW_MESSAGES = 6
const SUMMARY_MAX_CHARS = 1100

export interface SummaryServiceDeps {
  readonly store: DataStore
  readonly conversation: ConversationRepository
  readonly getAccess: () => ResolvedAccess
  readonly logger: Logger
  readonly clock: () => number
}

export class ConversationSummaryService {
  private running = false
  private queued = false

  constructor(private readonly deps: SummaryServiceDeps) {}

  summary(): ConversationSummary | undefined {
    return this.deps.store.snapshot().summary
  }

  async maybeUpdate(): Promise<void> {
    if (this.running) {
      this.queued = true
      return
    }
    this.running = true
    try {
      const messages = this.pendingMessages()
      if (messages.length < SUMMARY_MIN_NEW_MESSAGES) return
      const previous = this.summary()
      const now = this.deps.clock()
      const recent = messages.slice(-24)
      let text: string | undefined
      const access = this.deps.getAccess()
      const provider = access.text.kind === 'ready' ? (access.text.provider as ITextUnderstandingProvider) : undefined
      if (access.text.kind === 'ready' && access.text.actualPresetId !== 'local' && provider?.summarizeConversation) {
        const result = await provider
          .summarizeConversation({
            ...(previous?.text ? { previous: previous.text } : {}),
            messages: recent.map((message) => ({
              role: message.role,
              content: message.content.slice(0, 400)
            }))
          })
          .catch((): Result<string> => fail('E_AI_UNAVAILABLE', 'error.aiUnavailable', true))
        if (result.ok && result.data.trim().length > 0) {
          text = result.data.trim().slice(0, SUMMARY_MAX_CHARS)
        } else if (!result.ok) {
          this.deps.logger.failure('summary.failed', result.error.code, 0)
        }
      }
      if (!text) text = localSummary(previous?.text, messages)
      if (!text) return
      const last = messages[messages.length - 1]
      if (!last) return
      this.deps.store.write((draft) => {
        draft.summary = {
          text,
          coversUntil: last.messageId,
          messageCount: messages.length,
          updatedAt: now
        }
      })
      this.deps.logger.success('summary.updated', 0)
    } finally {
      this.running = false
      if (this.queued) {
        this.queued = false
        void this.maybeUpdate()
      }
    }
  }

  private pendingMessages(): ConversationMessage[] {
    const result = this.deps.conversation.listMessages(300)
    if (!result.ok) return []
    const messages = result.data
    const summary = this.summary()
    if (!summary) return messages
    const coveredIndex = messages.findIndex((message) => message.messageId === summary.coversUntil)
    if (coveredIndex < 0) return messages
    return messages.slice(coveredIndex + 1)
  }
}

function localSummary(previous: string | undefined, messages: readonly ConversationMessage[]): string {
  const lines: string[] = []
  if (previous) {
    lines.push(previous.slice(0, 360))
  }
  const recent = messages.slice(-10)
  for (const message of recent) {
    const who = message.role === 'user' ? '用户' : '助手'
    const sentence = message.content
      .split(/[。！？!?\n]/u)
      .map((item) => item.trim())
      .find((item) => item.length > 0)
    if (!sentence) continue
    lines.push(`${who}：${sentence.slice(0, 80)}`)
  }
  const text = lines.join('\n').trim()
  return text.length > 0 ? text.slice(-SUMMARY_MAX_CHARS) : ''
}
