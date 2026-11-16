import type {
  ConversationMessage,
  ConversationState,
  InputModality,
  PendingIntent
} from '@shared/domain/types'
import type {
  ConversationTurn,
  ResolutionCommand,
  SubmitEnvelope
} from '@shared/ipc-contracts'
import type { ConversationMessageDto } from '@shared/ipc-contracts'
import { describeResolution } from '@shared/conversation-thread'
import { messageKeyOf } from '@shared/error-catalog'
import { errorText } from '@shared/message-catalog'
import { fail, ok, type Result } from '@shared/result'
import { formatDateLabel, formatRange, truncateToMinute } from '@shared/time-kit'
import type { ConversationRepository } from '../storage/conversation-repository'
import type { DataStore } from '../storage/data-store'
import type { ParseOrchestrator, ParseOutcome } from './parse-orchestrator'
import type { ScheduleService } from './schedule-service'
import type { Logger } from '../observability/logger'
import type { ConflictItem } from '@shared/domain/types'

export interface ConversationDeps {
  readonly store: DataStore
  readonly conversation: ConversationRepository
  readonly schedule: ScheduleService
  readonly parser: ParseOrchestrator
  readonly logger: Logger
  readonly timeZone: string
  readonly clock: () => number
}

const CONFIRM_THRESHOLD = 0.6

export class ConversationOrchestrator {
  constructor(private readonly deps: ConversationDeps) {}

  async submit(envelope: SubmitEnvelope): Promise<Result<ConversationTurn>> {
    const now = this.deps.clock()
    if (envelope.parts.length === 0) {
      return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    }

    if (this.deps.conversation.lastClientMessageId() === envelope.clientMessageId) {
      const cached = this.lastTurnOf()
      if (cached) return ok(cached)
    }

    const modality: InputModality = envelope.modality
    const placeholder = buildPlaceholder(envelope)
    const userMessage = this.appendUserMessage(placeholder, modality, now)
    this.setSession({ state: 'parsing', lastClientMessageId: envelope.clientMessageId }, now)
    this.deps.logger.log({ eventType: 'input.submitted', resultStatus: 'success', durationMs: 0 })
    return this.composeReply(envelope, userMessage, now, true)
  }

  private async composeReply(
    envelope: SubmitEnvelope,
    userMessage: ConversationMessage,
    now: number,
    rewriteUser: boolean
  ): Promise<Result<ConversationTurn>> {
    const parsed = await this.deps.parser.parse(envelope, {
      referenceTime: now,
      timeZone: this.deps.timeZone,
      contextHints: this.contextHints(userMessage.messageId)
    })

    if (!parsed.ok) {
      this.updateMessage(userMessage.messageId, userMessage.content, 'failed', now)
      const assistant = this.appendAssistant(errorText(parsed.error.code), 'failed', now)
      this.setSession({ state: 'failed' }, now)
      return ok(this.turn('failed', { ...userMessage, status: 'failed' }, assistant, { errorCode: parsed.error.code }))
    }

    const outcome = parsed.data
    let visible = userMessage
    if (rewriteUser && outcome.description.length > 0 && outcome.description !== userMessage.content) {
      this.updateMessage(userMessage.messageId, outcome.description, 'parsed', now)
      visible = { ...userMessage, content: outcome.description.slice(0, 1000), status: 'parsed' }
    }
    return this.handleOutcome(outcome, visible, envelope.modality, now)
  }

  private contextHints(exceptMessageId: string): string[] {
    const listed = this.deps.conversation.listMessages(8)
    const hints = listed.ok
      ? listed.data
          .filter((message) => message.messageId !== exceptMessageId)
          .slice(-6)
          .map((message) => {
            const speaker = message.role === 'user' ? '用户' : '助手'
            return `${speaker}：${message.content.replace(/\s+/g, ' ').slice(0, 120)}`
          })
      : []
    const session = this.deps.store.session
    if (session.state !== 'idle' && session.state !== 'parsing') {
      hints.push(`会话状态：${session.state}`)
    }
    if (session.pendingIntent) {
      hints.push(`待补全事项：${session.pendingIntent.title}`)
    }
    return hints
  }

  async resolve(command: ResolutionCommand): Promise<Result<ConversationTurn>> {
    const now = this.deps.clock()
    const session = this.deps.store.session
    const userMessage = this.appendUserMessage(describeResolution(command), 'text', now)

    if (command.kind === 'supplement') {
      if (session.state !== 'clarifying' && session.state !== 'failed') {
        return this.stateMismatch(userMessage, now)
      }
      const base = session.pendingIntent?.originalText ?? session.pendingInput ?? ''
      const merged = `${base}${base.length > 0 ? '，' : ''}${command.text}`.trim()
      return this.composeReply(
        {
          clientMessageId: crypto.randomUUID(),
          modality: 'text',
          parts: [{ kind: 'text', text: merged }]
        },
        userMessage,
        now,
        false
      )
    }

    if (command.kind === 'confirm_candidates') {
      if (session.state !== 'candidate_select') return this.stateMismatch(userMessage, now)
      const candidates = session.pendingCandidates ?? []
      const selected = command.selectedIndexes
        .filter((index) => index >= 0 && index < candidates.length)
        .map((index) => candidates[index])
        .filter((item): item is PendingIntent => item !== undefined)
      if (selected.length === 0) {
        this.setSession({ state: 'idle', pendingCandidates: undefined }, now)
        const assistant = this.appendAssistant('已取消本次识别，未写入任何安排。', 'parsed', now)
        return ok(this.turn('idle', userMessage, assistant))
      }
      const createdIds: string[] = []
      const conflicts: ConflictItem[] = []
      let lastError: string | undefined
      for (const candidate of selected) {
        const result = this.writeCandidate(candidate, false, now)
        if (result.ok) {
          createdIds.push(result.data.eventId)
        } else if (result.error.code === 'E_CONFLICT_EXISTS') {
          conflicts.push(...this.deps.schedule.detectConflict(intervalOf(candidate)))
        } else {
          lastError = result.error.code
        }
      }
      if (conflicts.length > 0) {
        this.setSession({ state: 'conflict', pendingIntent: selected[0] }, now)
        const assistant = this.appendAssistant(
          `有 ${selected.length - createdIds.length} 项与已有安排冲突，请选择处理方式。`,
          'parsed',
          now
        )
        return ok(this.turn('conflict', userMessage, assistant, { conflicts }))
      }
      const contents =
        createdIds.length > 0
          ? [`已安排 ${createdIds.length} 项：`, ...selected.map((item) => describeIntent(item))].join('\n')
          : '未写入任何安排。'
      this.setSession(
        {
          state: 'idle',
          pendingCandidates: undefined,
          lastEventId: createdIds.at(-1) ?? session.lastEventId
        },
        now
      )
      const assistant = this.appendAssistant(contents, lastError ? 'failed' : 'parsed', now)
      return ok(
        this.turn(lastError ? 'failed' : 'idle', userMessage, assistant, {
          ...(lastError ? { errorCode: lastError } : {})
        })
      )
    }

    if (command.kind === 'reject_candidates') {
      if (session.state !== 'candidate_select') return this.stateMismatch(userMessage, now)
      this.setSession({ state: 'idle', pendingCandidates: undefined }, now)
      const assistant = this.appendAssistant('好的，已取消本次识别，没有写入任何安排。', 'parsed', now)
      return ok(this.turn('idle', userMessage, assistant))
    }

    if (command.kind === 'confirm_understanding') {
      if (session.state !== 'confirming' || !session.pendingIntent) return this.stateMismatch(userMessage, now)
      return ok(this.writeCandidateTurn(session.pendingIntent, userMessage, false, now))
    }

    if (command.kind === 'reparse') {
      if (session.state !== 'confirming' && session.state !== 'failed') {
        return this.stateMismatch(userMessage, now)
      }
      const text = session.pendingIntent?.originalText ?? session.pendingInput ?? ''
      if (text.length === 0) {
        this.setSession({ state: 'idle' }, now)
        const assistant = this.appendAssistant('请重新描述要安排的事情。', 'parsed', now)
        return ok(this.turn('idle', userMessage, assistant))
      }
      return this.composeReply(
        {
          clientMessageId: crypto.randomUUID(),
          modality: 'text',
          parts: [{ kind: 'text', text }]
        },
        userMessage,
        now,
        false
      )
    }

    if (command.kind === 'conflict_decision') {
      if (session.state !== 'conflict' || !session.pendingIntent) return this.stateMismatch(userMessage, now)
      if (command.choice === 'abandon') {
        this.setSession({ state: 'idle', pendingIntent: undefined, pendingConflictIds: undefined }, now)
        const assistant = this.appendAssistant('好的，已放弃本次安排，没有写入任何数据。', 'parsed', now)
        return ok(this.turn('idle', userMessage, assistant))
      }
      if (command.choice === 'reschedule') {
        this.setSession({ state: 'clarifying' }, now)
        const assistant = this.appendAssistant('请告诉我新的时间，例如“改到明天下午四点”。', 'clarifying', now)
        return ok(this.turn('clarifying', userMessage, assistant))
      }
      return ok(this.writeCandidateTurn(session.pendingIntent, userMessage, true, now))
    }

    return this.stateMismatch(userMessage, now)
  }

  history(limit = 200): ConversationMessageDto[] {
    const result = this.deps.conversation.listMessages(limit)
    if (!result.ok) return []
    return result.data.map(toDto)
  }

  private handleOutcome(
    outcome: ParseOutcome,
    userMessage: ConversationMessage,
    declaredModality: InputModality,
    now: number
  ): Result<ConversationTurn> {
    if (outcome.intentKind === 'chitchat' || outcome.intentKind === 'unknown') {
      this.setSession({ state: 'idle', pendingIntent: undefined }, now)
      const assistant = this.appendAssistant(outcome.replyText, 'parsed', now)
      return ok(this.turn('idle', userMessage, assistant))
    }

    if (outcome.intentKind === 'cancel') {
      return this.handleCancel(userMessage, now)
    }

    if (outcome.intentKind === 'modify') {
      return this.handleModify(outcome, userMessage, now)
    }

    const candidates = outcome.candidates
    if (candidates.length === 0) {
      this.setSession({ state: 'idle', pendingIntent: undefined }, now)
      const assistant = this.appendAssistant(outcome.replyText, 'parsed', now)
      return ok(this.turn('idle', userMessage, assistant))
    }

    if (candidates.length > 1) {
      const resolved = candidates.map((candidate) => ({ ...candidate, sourceModality: declaredModality }))
      this.setSession({ state: 'candidate_select', pendingCandidates: resolved }, now)
      const assistant = this.appendAssistant(
        `图片中识别到 ${resolved.length} 项安排，请勾选需要写入的条目：\n${resolved
          .map((item, index) => `${index + 1}. ${describeIntent(item)}`)
          .join('\n')}`,
        'parsed',
        now
      )
      return ok(
        this.turn('candidate_select', userMessage, assistant, {
          candidates: resolved.map((item) => previewOf(item))
        })
      )
    }

    const candidate = candidates[0] as PendingIntent
    if (candidate.missingFields.includes('startAt') || candidate.startAt === undefined) {
      this.setSession({ state: 'clarifying', pendingIntent: candidate }, now)
      const assistant = this.appendAssistant(
        '还差一点信息，请补充：\n1. 具体几点开始？\n2. 大概多长时间？',
        'clarifying',
        now
      )
      return ok(
        this.turn('clarifying', userMessage, assistant, {
          parsePreview: previewOf(candidate),
          errorCode: 'E_MISSING_START_TIME'
        })
      )
    }

    if (candidate.endAt !== undefined && candidate.endAt <= candidate.startAt) {
      this.setSession({ state: 'clarifying', pendingIntent: candidate }, now)
      const assistant = this.appendAssistant(errorText('E_TIME_INCONSISTENT'), 'clarifying', now)
      return ok(
        this.turn('clarifying', userMessage, assistant, {
          parsePreview: previewOf(candidate),
          errorCode: 'E_TIME_INCONSISTENT'
        })
      )
    }

    if (candidate.startAt <= now) {
      this.setSession({ state: 'clarifying', pendingIntent: candidate }, now)
      const assistant = this.appendAssistant(errorText('E_TIME_IN_PAST'), 'clarifying', now)
      return ok(
        this.turn('clarifying', userMessage, assistant, {
          parsePreview: previewOf(candidate),
          errorCode: 'E_TIME_IN_PAST'
        })
      )
    }

    if (this.deps.schedule.findDuplicate(candidate.title, candidate.startAt, now)) {
      this.setSession({ state: 'duplicate', pendingIntent: undefined }, now)
      const assistant = this.appendAssistant(errorText('E_DUPLICATE_EVENT'), 'failed', now)
      return ok(
        this.turn('duplicate', userMessage, assistant, {
          parsePreview: previewOf(candidate),
          errorCode: 'E_DUPLICATE_EVENT'
        })
      )
    }

    const conflicts = this.deps.schedule.detectConflict(intervalOf(candidate))
    if (conflicts.length > 0) {
      this.setSession(
        { state: 'conflict', pendingIntent: candidate, pendingConflictIds: conflicts.map((item) => item.eventId) },
        now
      )
      const assistant = this.appendAssistant(
        `与已有事项《${conflicts[0]?.title ?? ''}》时间冲突。请选择：改时间 / 仍然创建 / 放弃。`,
        'parsed',
        now
      )
      return ok(
        this.turn('conflict', userMessage, assistant, {
          parsePreview: previewOf(candidate),
          conflicts,
          errorCode: 'E_CONFLICT_EXISTS'
        })
      )
    }

    if (outcome.confidence < CONFIRM_THRESHOLD) {
      this.setSession({ state: 'confirming', pendingIntent: candidate }, now)
      const assistant = this.appendAssistant(
        `我理解的是：${describeIntent(candidate)}，对吗？`,
        'clarifying',
        now
      )
      return ok(
        this.turn('confirming', userMessage, assistant, { parsePreview: previewOf(candidate) })
      )
    }

    return ok(this.writeCandidateTurn(candidate, userMessage, false, now))
  }

  private handleCancel(userMessage: ConversationMessage, now: number): Result<ConversationTurn> {
    const lastEventId = this.deps.store.session.lastEventId
    if (!lastEventId) {
      this.setSession({ state: 'idle' }, now)
      const assistant = this.appendAssistant('当前没有可以取消的安排。', 'parsed', now)
      return ok(this.turn('idle', userMessage, assistant))
    }
    const cancelled = this.deps.schedule.cancelEvent(lastEventId, now)
    if (!cancelled.ok) {
      this.setSession({ state: 'idle' }, now)
      const assistant = this.appendAssistant(errorText(cancelled.error.code), 'failed', now)
      return ok(this.turn('failed', userMessage, assistant, { errorCode: cancelled.error.code }))
    }
    this.setSession({ state: 'idle', lastEventId: undefined }, now)
    const assistant = this.appendAssistant('已取消最近一条安排，对应提醒也已作废。', 'parsed', now)
    return ok(this.turn('idle', userMessage, assistant))
  }

  private handleModify(
    outcome: ParseOutcome,
    userMessage: ConversationMessage,
    now: number
  ): Result<ConversationTurn> {
    const lastEventId = this.deps.store.session.lastEventId
    const candidate = outcome.candidates[0]
    if (!lastEventId) {
      this.setSession({ state: 'idle' }, now)
      const assistant = this.appendAssistant('还没有可以修改的安排，请先创建一条。', 'parsed', now)
      return ok(this.turn('idle', userMessage, assistant))
    }
    if (!candidate || candidate.startAt === undefined) {
      this.setSession({ state: 'clarifying' }, now)
      const assistant = this.appendAssistant('请告诉我改成什么时间，例如“改到明天下午四点”。', 'clarifying', now)
      return ok(this.turn('clarifying', userMessage, assistant))
    }
    const updated = this.deps.schedule.updateEvent(lastEventId, {
      startAt: candidate.startAt,
      ...(candidate.endAt !== undefined ? { endAt: candidate.endAt } : {})
    })
    if (!updated.ok) {
      if (updated.error.code === 'E_CONFLICT_EXISTS') {
        const conflicts = this.deps.schedule.detectConflict(intervalOf(candidate), lastEventId)
        this.setSession({ state: 'conflict', pendingIntent: candidate }, now)
        const assistant = this.appendAssistant(
          `与已有事项《${conflicts[0]?.title ?? ''}》时间冲突。请选择：改时间 / 仍然创建 / 放弃。`,
          'parsed',
          now
        )
        return ok(this.turn('conflict', userMessage, assistant, { conflicts }))
      }
      this.setSession({ state: 'failed' }, now)
      const assistant = this.appendAssistant(errorText(updated.error.code), 'failed', now)
      return ok(this.turn('failed', userMessage, assistant, { errorCode: updated.error.code }))
    }
    this.setSession({ state: 'idle', lastEventId }, now)
    const assistant = this.appendAssistant(
      `已修改：${updated.data.event.title}，${formatDateLabel(updated.data.event.startAt)} ${formatRange(
        updated.data.event.startAt,
        updated.data.event.endAt
      )}`,
      'parsed',
      now
    )
    return ok(this.turn('idle', userMessage, assistant, { createdEventId: lastEventId }))
  }

  private writeCandidateTurn(
    candidate: PendingIntent,
    userMessage: ConversationMessage,
    allowConflict: boolean,
    now: number
  ): ConversationTurn {
    this.setSession({ state: 'writing' }, now)
    const result = this.writeCandidate(candidate, allowConflict, now)
    if (!result.ok) {
      if (result.error.code === 'E_CONFLICT_EXISTS') {
        const conflicts = this.deps.schedule.detectConflict(intervalOf(candidate))
        this.setSession({ state: 'conflict', pendingIntent: candidate }, now)
        const assistant = this.appendAssistant(
          `与已有事项《${conflicts[0]?.title ?? ''}》时间冲突。请选择：改时间 / 仍然创建 / 放弃。`,
          'parsed',
          now
        )
        return this.turn('conflict', userMessage, assistant, { conflicts, errorCode: 'E_CONFLICT_EXISTS' })
      }
      this.setSession({ state: 'failed' }, now)
      const assistant = this.appendAssistant(errorText(result.error.code), 'failed', now)
      return this.turn('failed', userMessage, assistant, { errorCode: result.error.code })
    }
    const event = result.data.event
    this.setSession({ state: 'idle', lastEventId: event.eventId, pendingIntent: undefined, pendingCandidates: undefined }, now)
    const assistant = this.appendAssistant(
      `已安排：${event.title}，${formatDateLabel(event.startAt)} ${formatRange(event.startAt, event.endAt)}${
        event.location ? `，地点：${event.location}` : ''
      }`,
      'parsed',
      now,
      event.eventId
    )
    return this.turn('idle', userMessage, assistant, {
      createdEventId: event.eventId,
      parsePreview: previewOf(candidate)
    })
  }

  private writeCandidate(
    candidate: PendingIntent,
    allowConflict: boolean,
    now: number
  ): Result<{ eventId: string; event: import('@shared/domain/types').ScheduleEvent }> {
    return this.deps.schedule.createEvent(
      {
        title: candidate.title,
        ...(candidate.startAt !== undefined ? { startAt: candidate.startAt } : {}),
        ...(candidate.endAt !== undefined ? { endAt: candidate.endAt } : {}),
        ...(candidate.location ? { location: candidate.location } : {}),
        ...(candidate.note ? { note: candidate.note } : {}),
        sourceModality: candidate.sourceModality
      },
      { allowConflict, now }
    )
  }

  private stateMismatch(userMessage: ConversationMessage, now: number): Result<ConversationTurn> {
    this.setSession({ state: 'idle' }, now)
    const assistant = this.appendAssistant(errorText('E_SESSION_STATE_MISMATCH'), 'failed', now)
    return ok(
      this.turn('failed', userMessage, assistant, { errorCode: 'E_SESSION_STATE_MISMATCH' })
    )
  }

  private appendUserMessage(content: string, modality: InputModality, now: number): ConversationMessage {
    const message: ConversationMessage = {
      messageId: `msg_user_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: content.slice(0, 1000),
      modality,
      createdAt: now,
      status: 'parsed'
    }
    this.deps.conversation.appendMessage(message)
    return message
  }

  private appendAssistant(
    content: string,
    status: 'parsed' | 'clarifying' | 'failed',
    now: number,
    relatedEventId?: string
  ): ConversationMessage {
    const spoken = content.trim().length > 0 ? content.trim() : '我在，不过这次没组织好回复。请再说一次。'
    const message: ConversationMessage = {
      messageId: `msg_assistant_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: spoken.slice(0, 1000),
      modality: 'text',
      createdAt: now,
      status,
      ...(relatedEventId ? { relatedEventId } : {})
    }
    this.deps.conversation.appendMessage(message)
    return message
  }

  private updateMessage(
    messageId: string,
    content: string,
    status: 'parsed' | 'clarifying' | 'failed',
    now: number
  ): void {
    this.deps.store.write((draft) => {
      const message = draft.messages.find((item) => item.messageId === messageId)
      if (message) {
        message.content = content.slice(0, 1000)
        message.status = status
        message.createdAt = message.createdAt
      }
    })
    this.deps.store.write((draft) => {
      draft.session.updatedAt = now
    })
  }

  private setSession(patch: Partial<import('@shared/domain/types').ConversationSession>, now: number): void {
    this.deps.conversation.saveSession(patch, now)
  }

  private turn(
    state: ConversationState,
    userMessage: ConversationMessage,
    assistantMessage: ConversationMessage,
    extras: {
      parsePreview?: import('@shared/domain/types').ParsePreview
      candidates?: import('@shared/domain/types').ParsePreview[]
      conflicts?: ConflictItem[]
      createdEventId?: string
      errorCode?: string
    } = {}
  ): ConversationTurn {
    return {
      userMessage: toDto(userMessage),
      assistantMessage: toDto(assistantMessage),
      state,
      ...(extras.parsePreview ? { parsePreview: extras.parsePreview } : {}),
      ...(extras.candidates ? { candidates: extras.candidates } : {}),
      ...(extras.conflicts ? { conflicts: extras.conflicts } : {}),
      ...(extras.createdEventId ? { createdEventId: extras.createdEventId } : {}),
      ...(extras.errorCode ? { errorCode: extras.errorCode } : {}),
      ...(extras.errorCode ? { errorText: errorText(extras.errorCode as never) } : {})
    }
  }

  private lastTurnOf(): ConversationTurn | undefined {
    const messages = this.deps.conversation.listMessages(4)
    if (!messages.ok || messages.data.length < 2) return undefined
    const reversed = messages.data.slice().reverse()
    const assistant = reversed.find((message) => message.role === 'assistant')
    const user = reversed.find((message) => message.role === 'user')
    if (!assistant || !user) return undefined
    return {
      userMessage: toDto(user),
      assistantMessage: toDto(assistant),
      state: this.deps.store.session.state,
      ...(assistant.relatedEventId ? { createdEventId: assistant.relatedEventId } : {})
    }
  }
}

function toDto(message: ConversationMessage): ConversationMessageDto {
  return {
    messageId: message.messageId,
    role: message.role,
    content: message.content,
    modality: message.modality,
    createdAt: message.createdAt,
    status: message.status,
    ...(message.relatedEventId ? { relatedEventId: message.relatedEventId } : {})
  }
}

function buildPlaceholder(envelope: SubmitEnvelope): string {
  const parts: string[] = []
  for (const part of envelope.parts) {
    if (part.kind === 'text') parts.push(part.text)
    else if (part.kind === 'voice') parts.push(`【语音 ${Math.round(part.durationMs / 1000)} 秒】`)
    else parts.push('【图片】')
  }
  return parts.join(' ').slice(0, 1000)
}

function describeIntent(intent: PendingIntent): string {
  const time =
    intent.startAt !== undefined
      ? `${formatDateLabel(intent.startAt)} ${formatRange(intent.startAt, intent.endAt)}`
      : '时间待定'
  return `${intent.title}，${time}${intent.location ? `，地点：${intent.location}` : ''}`
}

function previewOf(intent: PendingIntent): import('@shared/domain/types').ParsePreview {
  return {
    title: intent.title,
    ...(intent.startAt !== undefined ? { startAt: intent.startAt } : {}),
    ...(intent.endAt !== undefined ? { endAt: intent.endAt } : {}),
    ...(intent.location ? { location: intent.location } : {}),
    ...(intent.note ? { note: intent.note } : {}),
    missingFields: intent.missingFields
  }
}

function intervalOf(intent: PendingIntent): { startAt: number; endAt: number } {
  const startAt = intent.startAt ?? Date.now()
  const endAt = intent.endAt ?? startAt + 60 * 60 * 1000
  return { startAt: truncateToMinute(startAt), endAt: truncateToMinute(endAt) }
}