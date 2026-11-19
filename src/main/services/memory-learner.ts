import { extractLocalMemories } from '@shared/memory/extract'

import type { ConversationRepository } from '../storage/conversation-repository'
import type { Logger } from '../observability/logger'
import type { ResolvedAccess } from '../ai/provider-resolver'
import type { ITextUnderstandingProvider } from '../providers/types'
import type { MemoryService } from './memory-service'

const AI_LEARN_COOLDOWN_MS = 120_000

export interface MemoryLearnerDeps {
  readonly conversation: ConversationRepository
  readonly memories: MemoryService
  readonly getAccess: () => ResolvedAccess
  readonly logger: Logger
  readonly clock: () => number
}

export class MemoryLearner {
  private lastAiAt = 0
  private inFlight = false

  constructor(private readonly deps: MemoryLearnerDeps) {}

  async observe(text: string, now: number): Promise<void> {
    const local = extractLocalMemories(text, now)
    if (local.length > 0) this.deps.memories.addMany(local, 'auto')
    await this.learnWithAi(now)
  }

  private async learnWithAi(now: number): Promise<void> {
    if (this.inFlight || now - this.lastAiAt < AI_LEARN_COOLDOWN_MS) return
    const access = this.deps.getAccess()
    if (access.text.kind !== 'ready' || access.text.actualPresetId === 'local') return
    const provider = access.text.provider as ITextUnderstandingProvider
    if (!provider.extractMemories) return

    this.lastAiAt = now
    this.inFlight = true
    try {
      const messages = this.deps.conversation.listMessages(8)
      const result = await provider
        .extractMemories({
          recent: messages.ok
            ? messages.data.map((message) => ({
                role: message.role,
                content: message.content.slice(0, 400)
              }))
            : [],
          existing: this.deps.memories
            .list()
            .slice(0, 40)
            .map((memory) => memory.content)
        })
        .catch(() => undefined)
      if (result?.ok && result.data.length > 0) {
        this.deps.memories.addMany(result.data.slice(0, 3), 'ai')
      }
    } catch {
      // 后台学习失败不影响对话
    } finally {
      this.inFlight = false
    }
  }
}
