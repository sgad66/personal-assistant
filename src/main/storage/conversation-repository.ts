import type {
  ConversationMessage,
  ConversationSession,
  PendingIntent
} from '@shared/domain/types'
import type { Result } from '@shared/result'
import type { DataStore } from './data-store'

export class ConversationRepository {
  constructor(private readonly store: DataStore) {}

  appendMessage(message: ConversationMessage): Result<ConversationMessage> {
    return this.store.write((draft) => {
      draft.messages.push(message)
      if (draft.messages.length > 500) {
        draft.messages = draft.messages.slice(-500)
      }
      return message
    })
  }

  listMessages(limit = 200): Result<ConversationMessage[]> {
    return this.store.read((draft) => draft.messages.slice(-limit))
  }

  getSession(): ConversationSession {
    return this.store.snapshot().session
  }

  saveSession(patch: Partial<ConversationSession>, now: number): Result<ConversationSession> {
    return this.store.write((draft) => {
      draft.session = { ...draft.session, ...patch, updatedAt: now }
      return draft.session
    })
  }

  setPendingIntent(intent: PendingIntent | undefined, now: number): Result<ConversationSession> {
    return this.saveSession({ pendingIntent: intent }, now)
  }

  lastClientMessageId(): string | undefined {
    return this.store.session.lastClientMessageId
  }

  markClientMessageId(clientMessageId: string, now: number): Result<ConversationSession> {
    return this.saveSession({ lastClientMessageId: clientMessageId }, now)
  }
}