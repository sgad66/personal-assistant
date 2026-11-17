import { create } from 'zustand'
import type {
  AgentStreamEvent,
  ConversationMessageDto,
  ConversationTurn,
  FailurePresentationDto,
  InputPart,
  MessageQuote,
  ResolutionCommand,
  RetryAffordance,
  SubmitEnvelope
} from '@shared/ipc-contracts'
import type { ConflictItem, ConversationState, ParsePreview } from '@shared/domain/types'
import { translate } from '@shared/message-catalog'
import { buildEnvelope } from '../input-collector'
import { usePreferencesStore } from './preferences-store'

export type RetryState = 'idle' | 'auto_retrying' | 'auto_retry_failed' | 'manual_retrying'

export interface PendingAsk {
  readonly clientMessageId: string
  readonly localMessageId: string
  readonly stage: string
  readonly startedAt: number
}

interface SendOptions {
  readonly retryOf?: string
  readonly attachment?: SubmitEnvelope['attachment']
  readonly quotes?: readonly MessageQuote[]
  readonly awaitCompletion?: boolean
}

interface AgentState {
  messages: ConversationMessageDto[]
  conversationState: ConversationState
  parsePreview?: ParsePreview
  candidates?: readonly ParsePreview[]
  conflicts?: readonly ConflictItem[]
  busy: boolean
  pending: readonly PendingAsk[]
  quoted: readonly MessageQuote[]
  error?: string
  lastEnvelope?: SubmitEnvelope
  lastTurn?: ConversationTurn
  failure?: FailurePresentationDto
  retry?: RetryAffordance
  retryState?: RetryState
  retryStartedAt?: number
  lastFailedModality?: ConversationMessageDto['modality']
  mediaPickerRequest?: 'image' | 'voice'
  initialized: boolean
  seedPrompt?: string
  init: () => Promise<void>
  sendText: (text: string) => Promise<boolean>
  sendParts: (parts: readonly InputPart[], options?: SendOptions) => Promise<boolean>
  resolve: (command: ResolutionCommand) => Promise<boolean>
  retryLast: () => Promise<boolean>
  reselectMedia: (kind: 'image' | 'voice') => void
  consumeMediaPicker: () => void
  setSeedPrompt: (text: string) => void
  consumeSeedPrompt: () => void
  clearError: () => void
  quoteMessage: (message: ConversationMessageDto, excerpt?: string) => void
  removeQuote: (messageId: string) => void
  clearQuotes: () => void
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cleaned = error.message.replace(/^Error invoking remote method '[^']+':\s*Error:\s*/, '')
    return cleaned.length > 0 ? cleaned : '操作失败，请重试'
  }
  return '操作失败，请重试'
}

function optimisticContent(parts: readonly InputPart[], attachment?: SubmitEnvelope['attachment']): string {
  if (attachment) {
    return [`【附件】${attachment.name}`, attachment.question].filter(Boolean).join('\n').slice(0, 1000)
  }
  const pieces: string[] = []
  for (const part of parts) {
    if (part.kind === 'text') pieces.push(part.text)
    else if (part.kind === 'voice') pieces.push(`【语音 ${Math.round(part.durationMs / 1000)} 秒】`)
    else pieces.push('【图片】')
  }
  return pieces.join(' ').slice(0, 1000)
}

function replaceUserMessage(
  messages: readonly ConversationMessageDto[],
  clientMessageId: string,
  userMessage: ConversationMessageDto
): ConversationMessageDto[] {
  const localId = `local_${clientMessageId}`
  const index = messages.findIndex(
    (message) => message.messageId === localId || message.messageId === userMessage.messageId
  )
  const next = messages.slice()
  if (index >= 0) next[index] = userMessage
  else next.push(userMessage)
  return next
}

function applyTurn(
  set: (partial: Partial<AgentState> | ((state: AgentState) => Partial<AgentState>)) => void,
  turn: ConversationTurn,
  clientMessageId?: string
): void {
  set((state) => {
    let messages =
      clientMessageId !== undefined
        ? replaceUserMessage(state.messages, clientMessageId, turn.userMessage)
        : state.messages.some((message) => message.messageId === turn.userMessage.messageId)
          ? state.messages.slice()
          : [...state.messages, turn.userMessage]
    if (!messages.some((message) => message.messageId === turn.assistantMessage.messageId)) {
      messages = [...messages, turn.assistantMessage]
    }
    const pending =
      clientMessageId !== undefined
        ? state.pending.filter((item) => item.clientMessageId !== clientMessageId)
        : state.pending
    return {
      messages,
      pending,
      busy: pending.length > 0,
      conversationState: turn.state,
      parsePreview: turn.parsePreview,
      candidates: turn.candidates,
      conflicts: turn.conflicts,
      error: undefined,
      lastTurn: turn,
      failure: turn.failure,
      retry: turn.retry,
      retryState: turn.retryState ?? 'idle',
      retryStartedAt: undefined,
      lastFailedModality:
        turn.assistantMessage.status === 'failed' ? turn.assistantMessage.modality : undefined
    }
  })
}

let streamSubscribed = false

export const useAgentStore = create<AgentState>((set, get) => {
  const handleStream = (event: AgentStreamEvent): void => {
    if (event.kind === 'accepted') {
      set((state) => ({
        messages: replaceUserMessage(state.messages, event.clientMessageId, event.userMessage),
        pending: state.pending.map((item) =>
          item.clientMessageId === event.clientMessageId ? { ...item, stage: '正在理解你的输入…' } : item
        )
      }))
      return
    }
    if (event.kind === 'progress') {
      set((state) => ({
        pending: state.pending.map((item) =>
          item.clientMessageId === event.clientMessageId ? { ...item, stage: event.stage } : item
        )
      }))
      return
    }
    if (event.kind === 'turn') {
      applyTurn(set, event.turn, event.clientMessageId)
      return
    }
    set((state) => {
      const pending = state.pending.filter((item) => item.clientMessageId !== event.clientMessageId)
      const localId = `local_${event.clientMessageId}`
      return {
        pending,
        busy: pending.length > 0,
        retryStartedAt: undefined,
        messages: state.messages.map((message) =>
          message.messageId === localId ? { ...message, status: 'failed' as const } : message
        ),
        error: event.errorText
      }
    })
  }

  return {
    messages: [],
    conversationState: 'idle',
    busy: false,
    pending: [],
    quoted: [],
    initialized: false,
    seedPrompt: undefined,
    retryState: 'idle',

    init: async () => {
      if (!streamSubscribed) {
        streamSubscribed = true
        window.pa.agent.onStream(handleStream)
      }
      if (get().initialized) return
      set({ initialized: true })
      try {
        const history = await window.pa.agent.history({ limit: 100 })
        set((state) => (state.messages.length === 0 ? { messages: history } : {}))
      } catch (error) {
        set({ error: errorMessage(error) })
      }
    },

    sendText: (text) => get().sendParts([{ kind: 'text', text }]),

    sendParts: async (parts, options) => {
      if (parts.length === 0) return false
      const quoted = options?.quotes && options.quotes.length > 0 ? options.quotes : get().quoted
      const memories = usePreferencesStore.getState().memories
      const envelope: SubmitEnvelope = {
        ...buildEnvelope(parts),
        ...(options?.attachment ? { attachment: options.attachment } : {}),
        ...(options?.retryOf ? { retryOf: options.retryOf } : {}),
        ...(quoted.length > 0 ? { quotes: quoted } : {}),
        ...(memories.length > 0 ? { memories } : {})
      }

      if (options?.awaitCompletion) {
        set({
          error: undefined,
          lastEnvelope: envelope,
          retryStartedAt: Date.now(),
          quoted: [],
          ...(options?.retryOf ? { retryState: 'manual_retrying' as const } : {})
        })
        try {
          const turn = await window.pa.agent.submit(envelope)
          applyTurn(set, turn)
          return true
        } catch (error) {
          set({ error: errorMessage(error), retryStartedAt: undefined, retryState: 'idle' })
          return false
        }
      }

      const localMessageId = `local_${envelope.clientMessageId}`
      const optimistic: ConversationMessageDto = {
        messageId: localMessageId,
        role: 'user',
        content: optimisticContent(parts, options?.attachment),
        modality: envelope.modality,
        createdAt: Date.now(),
        status: 'parsed',
        ...(quoted.length > 0 ? { quotes: quoted } : {})
      }
      set((state) => {
        const pending = [
          ...state.pending,
          {
            clientMessageId: envelope.clientMessageId,
            localMessageId,
            stage: '正在发送…',
            startedAt: Date.now()
          }
        ]
        return {
          messages: [...state.messages, optimistic],
          pending,
          busy: true,
          error: undefined,
          lastEnvelope: envelope,
          retryStartedAt: Date.now(),
          quoted: [],
          ...(options?.retryOf ? { retryState: 'manual_retrying' as const } : {})
        }
      })

      void window.pa.agent.submit(envelope).then(
        (turn) => applyTurn(set, turn, envelope.clientMessageId),
        (error) => handleStream({ kind: 'failed', clientMessageId: envelope.clientMessageId, errorText: errorMessage(error) })
      )
      return true
    },

    resolve: async (command) => {
      set({ error: undefined })
      try {
        const turn = await window.pa.agent.resolve(command)
        applyTurn(set, turn)
        return true
      } catch (error) {
        set({ error: errorMessage(error) })
        return false
      }
    },

    retryLast: async () => {
      const { lastEnvelope, retry, lastTurn, pending } = get()
      if (pending.length > 0) return false
      if (!lastEnvelope) {
        set({ error: '没有可重试的内容，请重新输入' })
        return false
      }
      const affordance: RetryAffordance =
        retry ?? { available: true, kind: lastEnvelope.parts.some((part) => part.kind !== 'text') ? 'media' : 'text' }
      if (affordance.kind === 'text') {
        return get().sendParts(lastEnvelope.parts, { attachment: lastEnvelope.attachment })
      }
      if (!affordance.available) {
        set({ error: translate('ai.fail.mediaExpired'), retryState: 'idle' })
        return false
      }
      const retryOf = lastTurn?.assistantMessage.messageId
      return get().sendParts(lastEnvelope.parts, { attachment: lastEnvelope.attachment, retryOf })
    },

    reselectMedia: (kind) => set({ mediaPickerRequest: kind, error: undefined }),
    consumeMediaPicker: () => set({ mediaPickerRequest: undefined }),

    setSeedPrompt: (text) => set({ seedPrompt: text }),
    consumeSeedPrompt: () => set({ seedPrompt: undefined }),
    clearError: () => set({ error: undefined }),

    quoteMessage: (message, excerpt) =>
      set((state) => {
        if (state.quoted.some((quote) => quote.messageId === message.messageId)) {
          return { quoted: state.quoted.filter((quote) => quote.messageId !== message.messageId) }
        }
        const text = (excerpt ?? message.content).trim().slice(0, 500)
        if (text.length === 0) return {}
        return {
          quoted: [...state.quoted, { messageId: message.messageId, role: message.role, excerpt: text }].slice(-5)
        }
      }),
    removeQuote: (messageId) =>
      set((state) => ({ quoted: state.quoted.filter((quote) => quote.messageId !== messageId) })),
    clearQuotes: () => set({ quoted: [] })
  }
})