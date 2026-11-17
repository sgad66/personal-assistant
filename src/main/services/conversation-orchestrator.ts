import type {
  ConversationMessage,
  ConversationState,
  InputModality,
  MessageQuote,
  PendingIntent
} from '@shared/domain/types'
import type {
  ConversationTurn,
  ResolutionCommand,
  SubmitEnvelope
} from '@shared/ipc-contracts'
import type {
  ChannelSourceTrace,
  ConversationMessageDto,
  FailurePresentationDto,
  RetryAffordance
} from '@shared/ipc-contracts'
import { messageKeyOf } from '@shared/error-catalog'
import { errorText, translate } from '@shared/message-catalog'
import { fail, ok, type Result } from '@shared/result'
import { formatDateLabel, formatRange, truncateToMinute } from '@shared/time-kit'
import { presentFailure } from '@shared/ai/failure-text'
import { judgeNextStep } from '@shared/conversation/rules'
import { stripImportHeader } from '@shared/import/header'
import type { ConversationRepository } from '../storage/conversation-repository'
import type { DataStore } from '../storage/data-store'
import type { ParseOrchestrator, ParseLastFailure, ParseOutcome } from './parse-orchestrator'
import type { ScheduleService } from './schedule-service'
import type { Logger } from '../observability/logger'
import type { TempFileManager } from '../temp-file-manager'
import type { ConflictItem } from '@shared/domain/types'

export interface ConversationDeps {
  readonly store: DataStore
  readonly conversation: ConversationRepository
  readonly schedule: ScheduleService
  readonly parser: ParseOrchestrator
  readonly logger: Logger
  readonly timeZone: string
  readonly clock: () => number
  readonly tempFiles?: TempFileManager
}

const CONFIRM_THRESHOLD = 0.6

const CONTEXT_HINTS_MAX = 6
const CONTEXT_HINT_CHARS = 200

export interface SubmitHooks {
  readonly onAccepted?: (userMessage: ConversationMessageDto) => void
  readonly onProgress?: (stage: string) => void
}

export class ConversationOrchestrator {
  private activeTrace: readonly ChannelSourceTrace[] | undefined = undefined
  private activeImportLabel: string | undefined = undefined
  private activeQuotes: readonly MessageQuote[] | undefined = undefined
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly deps: ConversationDeps) {}

  async submit(envelope: SubmitEnvelope, hooks?: SubmitHooks): Promise<Result<ConversationTurn>> {
    const now = this.deps.clock()
    if (envelope.parts.length === 0) {
      return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    }

    if (this.deps.conversation.lastClientMessageId() === envelope.clientMessageId) {
      const cached = this.lastTurnOf()
      if (cached) return ok(cached)
    }

    const placeholder = buildPlaceholder(envelope)
    const userMessage = this.appendUserMessage(placeholder, envelope.modality, now, envelope.quotes)
    this.setSession({ state: 'parsing', lastClientMessageId: envelope.clientMessageId }, now)
    this.deps.logger.log({ eventType: 'input.submitted', resultStatus: 'success', durationMs: 0 })
    hooks?.onAccepted?.(toDto(userMessage))

    const run = this.chain.then(() => this.runSubmit(envelope, userMessage, now, hooks))
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async runSubmit(
    envelope: SubmitEnvelope,
    userMessage: ConversationMessage,
    now: number,
    hooks?: SubmitHooks
  ): Promise<Result<ConversationTurn>> {
    this.activeQuotes = envelope.quotes
    try {
      hooks?.onProgress?.('正在理解你的输入…')
      const quotedHints = (envelope.quotes ?? []).map((quote) => `引用原文：${quote.excerpt}`)
      const memoryHints = (envelope.memories ?? []).map((memory) => `用户记忆：${memory}`)
      const contextHints = [...memoryHints, ...quotedHints, ...this.contextHintsOf(userMessage.messageId)]
      const parsed = await this.deps.parser.parse(envelope, {
        referenceTime: now,
        timeZone: this.deps.timeZone,
        ...(contextHints.length > 0 ? { contextHints } : {})
      })

      const modality: InputModality = envelope.modality

      if (!parsed.ok) {
        this.updateMessage(userMessage.messageId, buildPlaceholder(envelope), 'failed', now)
        this.activeTrace = this.deps.parser.lastSourceTrace()
        this.activeImportLabel = this.deps.parser.lastImportSource()?.label
        const failureInfo = this.deps.parser.lastFailure()
        const retry = this.retryAffordanceOf(envelope)
        const failure = this.failurePresentationOf(failureInfo, parsed.error.code, retry)
        const assistant = this.appendAssistant(
          failure?.text ?? errorText(parsed.error.code),
          'failed',
          now,
          undefined,
          this.activeImportLabel ?? failure?.sourceLabel
        )
        this.setSession({ state: 'failed' }, now)
        return ok(
          this.turn('failed', userMessage, assistant, {
            errorCode: parsed.error.code,
            ...(failure ? { failure } : {}),
            retry,
            retryState: failureInfo?.autoRetried ? 'auto_retry_failed' : 'idle'
          })
        )
      }

      const outcome = parsed.data
      const outcomeQuotes: MessageQuote[] = [
        ...(envelope.quotes ?? []),
        ...(outcome.quoteText
          ? [{ messageId: 'msg_quote_context', role: 'user' as const, excerpt: outcome.quoteText }]
          : [])
      ]
      this.activeQuotes = outcomeQuotes.length > 0 ? outcomeQuotes : undefined
      this.activeTrace = outcome.sourceTrace
      this.activeImportLabel = outcome.importSource?.label
      this.setSession(
        {
          importContext: outcome.importSource
            ? { label: outcome.importSource.label, keepRemainder: true }
            : undefined
        },
        now
      )
      if (!envelope.attachment && outcome.description.length > 0) {
        this.updateMessage(userMessage.messageId, outcome.description, 'parsed', now)
      }
      if (envelope.attachment && (outcome.intentKind === 'modify' || outcome.intentKind === 'cancel')) {
        this.setSession({ state: 'idle' }, now)
        const assistant = this.appendAssistant('已读取附件。要修改或取消已有日程，请在对话中直接说明要调整的事项。', 'parsed', now)
        return ok(this.turn('idle', userMessage, assistant))
      }
      if (envelope.attachment && outcome.intentKind === 'schedule' && outcome.candidates.length > 1 &&
          outcome.confidence >= CONFIRM_THRESHOLD) {
        const remaining: PendingIntent[] = []
        const lines: string[] = []
        let lastEventId = this.deps.store.session.lastEventId
        for (const item of outcome.candidates) {
          if (item.startAt === undefined) {
            remaining.push(item)
            lines.push(`待补充时间：${item.title}`)
            continue
          }
          const result = this.writeCandidate(item, false, now)
          if (result.ok) {
            lines.push(`已安排：${describeIntent(item)}`)
            lastEventId = result.data.eventId
          } else if (result.error.code === 'E_DUPLICATE_EVENT') {
            lines.push(`已存在：${describeIntent(item)}`)
          } else {
            remaining.push(item)
            lines.push(`未写入：${describeIntent(item)}（${errorText(result.error.code)}）`)
          }
        }
        if (remaining.length === 1) {
          const item = remaining[0]!
          const conflicts = item.startAt === undefined ? [] : this.deps.schedule.detectConflict(intervalOf(item))
          if (item.startAt === undefined || conflicts.length) {
            const state = conflicts.length ? 'conflict' : 'clarifying'
            this.setSession({ state, lastEventId, pendingIntent: item, pendingCandidates: undefined }, now)
            const assistant = this.appendAssistant(lines.join('\n'), 'clarifying', now)
            return ok(this.turn(state, userMessage, assistant, { conflicts, parsePreview: previewOf(item) }))
          }
        }
        const state = remaining.length ? 'candidate_select' : 'idle'
        this.setSession({ state, lastEventId, pendingCandidates: remaining, pendingIntent: undefined }, now)
        const assistant = this.appendAssistant(lines.join('\n'), 'parsed', now)
        return ok(this.turn(state, userMessage, assistant, { candidates: remaining.map(previewOf) }))
      }
      hooks?.onProgress?.('正在整理结果…')
      return this.handleOutcome(outcome, userMessage, modality, now)
    } finally {
      this.activeQuotes = undefined
    }
  }

  async resolve(command: ResolutionCommand): Promise<Result<ConversationTurn>> {
    const run = this.chain.then(() => this.resolveNow(command))
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async resolveNow(command: ResolutionCommand): Promise<Result<ConversationTurn>> {
    const now = this.deps.clock()
    this.activeTrace = undefined
    this.activeImportLabel = undefined
    this.activeQuotes = undefined
    const session = this.deps.store.session
    const userMessage = this.appendUserMessage(describeCommand(command), 'text', now)

    if (command.kind === 'supplement') {
      if (session.state !== 'clarifying' && session.state !== 'failed') {
        return this.stateMismatch(userMessage, now)
      }
      const base = session.pendingIntent?.originalText ?? session.pendingInput ?? ''
      const merged = `${base}${base.length > 0 ? '，' : ''}${command.text}`.trim()
      const resumed = await this.resumeText(merged, now)
      if (!resumed.ok) {
        this.activeTrace = this.deps.parser.lastSourceTrace()
        const failureInfo = this.deps.parser.lastFailure()
        const retry = this.retryAffordanceOf({
          clientMessageId: 'resolve_supplement',
          modality: 'text',
          parts: [{ kind: 'text', text: command.text }]
        })
        const failure = this.failurePresentationOf(failureInfo, resumed.error.code, retry)
        const assistant = this.appendAssistant(
          failure?.text ?? errorText(resumed.error.code),
          'failed',
          now,
          undefined,
          failure?.sourceLabel
        )
        this.setSession({ state: 'failed' }, now)
        return ok(
          this.turn('failed', userMessage, assistant, {
            errorCode: resumed.error.code,
            ...(failure ? { failure } : {}),
            retry,
            retryState: failureInfo?.autoRetried ? 'auto_retry_failed' : 'idle'
          })
        )
      }
      return ok({ ...resumed.data, userMessage: toDto(userMessage) })
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
      const conflictingCandidates: PendingIntent[] = []
      let lastError: string | undefined
      const lines: string[] = []
      const importContext = session.importContext

      for (const candidate of selected) {
        const result = this.writeCandidate(candidate, false, now)
        if (result.ok) {
          createdIds.push(result.data.eventId)
          if (importContext) lines.push(`已安排：${describeIntent(candidate)}`)
        } else if (result.error.code === 'E_CONFLICT_EXISTS') {
          conflictingCandidates.push(candidate)
          conflicts.push(...this.deps.schedule.detectConflict(intervalOf(candidate)))
          if (importContext) lines.push(`时间冲突未决：${describeIntent(candidate)}`)
        } else if (result.error.code === 'E_DUPLICATE_EVENT') {
          if (importContext) lines.push(`已存在：${describeIntent(candidate)}`)
        } else {
          lastError = result.error.code
          if (importContext) lines.push(`保存失败：${describeIntent(candidate)}`)
        }
      }
      if (conflicts.length > 0) {
        this.setSession({ state: 'conflict', pendingIntent: conflictingCandidates[0], lastEventId: createdIds.at(-1) ?? session.lastEventId }, now)
        const assistant = this.appendAssistant(
          `有 ${conflictingCandidates.length} 项与已有安排冲突。请处理《${conflictingCandidates[0]?.title}》。`,
          'parsed',
          now
        )
        return ok(this.turn('conflict', userMessage, assistant, { conflicts }))
      }

      if (importContext?.keepRemainder) {
        const remaining = candidates.filter((_candidate, index) => !command.selectedIndexes.includes(index))
        if (remaining.length > 0) {
          this.setSession(
            {
              state: 'candidate_select',
              pendingCandidates: remaining,
              pendingIntent: undefined,
              lastEventId: createdIds.at(-1) ?? session.lastEventId
            },
            now
          )
          const assistant = this.appendAssistant(
            `${lines.join('\n')}\n${translate('import.remainder', {
              ok: createdIds.length,
              missed: remaining.length
            })}`.trim(),
            lastError ? 'failed' : 'parsed',
            now
          )
          return ok(
            this.turn(lastError ? 'failed' : 'candidate_select', userMessage, assistant, {
              candidates: remaining.map(previewOf),
              ...(lastError ? { errorCode: lastError } : {})
            })
          )
        }
      }

      const contents = importContext
        ? [
            ...lines,
            translate('import.batchResult', {
              ok: createdIds.length,
              missed: selected.length - createdIds.length
            })
          ].join('\n')
        : createdIds.length > 0
          ? [`已安排 ${createdIds.length} 项：`, ...selected.map((item) => describeIntent(item))].join('\n')
          : '未写入任何安排。'
      this.setSession(
        {
          state: 'idle',
          pendingCandidates: undefined,
          importContext: undefined,
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
      this.setSession({ state: 'idle', pendingCandidates: undefined, importContext: undefined }, now)
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
      const resumed = await this.resumeText(text, now)
      if (!resumed.ok) {
        const assistant = this.appendAssistant(errorText(resumed.error.code), 'failed', now)
        return ok(this.turn('failed', userMessage, assistant, { errorCode: resumed.error.code }))
      }
      return ok({ ...resumed.data, userMessage: toDto(userMessage) })
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

  private async resumeText(text: string, now: number): Promise<Result<ConversationTurn>> {
    const envelope: SubmitEnvelope = {
      clientMessageId: crypto.randomUUID(),
      modality: 'text',
      parts: [{ kind: 'text', text }]
    }
    const userMessage = this.appendUserMessage(text, 'text', now)
    return this.runSubmit(envelope, userMessage, now)
  }

  private contextHintsOf(excludeMessageId: string): string[] {
    const result = this.deps.conversation.listMessages(CONTEXT_HINTS_MAX + 4)
    if (!result.ok) return []
    return result.data
      .filter((message) => message.messageId !== excludeMessageId && message.content.trim().length > 0)
      .slice(-CONTEXT_HINTS_MAX)
      .map((message) => {
        const who = message.role === 'user' ? '用户' : '助手'
        return `${who}：${message.content.slice(0, CONTEXT_HINT_CHARS)}`
      })
      .filter((line) => line.length > 3)
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
        `识别到 ${resolved.length} 项安排，请勾选需要写入的条目：\n${resolved
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
    const leadingStep = judgeNextStep({
      missingFields: candidate.missingFields,
      ...(candidate.startAt !== undefined ? { startAt: candidate.startAt } : {}),
      ...(candidate.endAt !== undefined ? { endAt: candidate.endAt } : {}),
      now,
      conflicts: [],
      confidence: outcome.confidence,
      threshold: CONFIRM_THRESHOLD
    })

    if (leadingStep === 'ask_missing') {
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

    if (leadingStep === 'ask_inconsistent') {
      this.setSession({ state: 'clarifying', pendingIntent: candidate }, now)
      const assistant = this.appendAssistant(errorText('E_TIME_INCONSISTENT'), 'clarifying', now)
      return ok(
        this.turn('clarifying', userMessage, assistant, {
          parsePreview: previewOf(candidate),
          errorCode: 'E_TIME_INCONSISTENT'
        })
      )
    }

    if (leadingStep === 'ask_past') {
      this.setSession({ state: 'clarifying', pendingIntent: candidate }, now)
      const assistant = this.appendAssistant(errorText('E_TIME_IN_PAST'), 'clarifying', now)
      return ok(
        this.turn('clarifying', userMessage, assistant, {
          parsePreview: previewOf(candidate),
          errorCode: 'E_TIME_IN_PAST'
        })
      )
    }

    const startAt = candidate.startAt
    const duplicateHit =
      startAt === undefined ? undefined : this.deps.schedule.findDuplicate(candidate.title, startAt, now)
    const conflicts: ConflictItem[] =
      startAt === undefined || candidate.endAt === undefined
        ? []
        : this.deps.schedule.detectConflict({ startAt, endAt: candidate.endAt })
    const step = judgeNextStep({
      missingFields: candidate.missingFields,
      ...(startAt !== undefined ? { startAt } : {}),
      ...(candidate.endAt !== undefined ? { endAt: candidate.endAt } : {}),
      now,
      ...(duplicateHit ? { duplicateEventId: duplicateHit.eventId } : {}),
      conflicts,
      confidence: outcome.confidence,
      threshold: CONFIRM_THRESHOLD
    })

    if (step === 'ask_duplicate') {
      this.setSession({ state: 'duplicate', pendingIntent: undefined }, now)
      const assistant = this.appendAssistant(errorText('E_DUPLICATE_EVENT'), 'failed', now)
      return ok(
        this.turn('duplicate', userMessage, assistant, {
          parsePreview: previewOf(candidate),
          errorCode: 'E_DUPLICATE_EVENT'
        })
      )
    }

    if (step === 'ask_conflict') {
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

    if (step === 'confirm_recap') {
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
        sourceModality: candidate.sourceModality,
        ...(this.deps.store.session.importContext?.label
          ? { importSourceLabel: this.deps.store.session.importContext.label }
          : {})
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

  private appendUserMessage(
    content: string,
    modality: InputModality,
    now: number,
    quotes?: readonly MessageQuote[]
  ): ConversationMessage {
    const message: ConversationMessage = {
      messageId: `msg_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: content.slice(0, 1000),
      modality,
      createdAt: now,
      status: 'parsed',
      ...(quotes && quotes.length > 0 ? { quotes: quotes.map((quote) => ({ ...quote })) } : {})
    }
    this.deps.conversation.appendMessage(message)
    return message
  }

  private appendAssistant(
    content: string,
    status: 'parsed' | 'clarifying' | 'failed',
    now: number,
    relatedEventId?: string,
    sourceLabel?: string
  ): ConversationMessage {
    const message: ConversationMessage = {
      messageId: `msg_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: content.slice(0, 1000),
      modality: 'text',
      createdAt: now,
      status,
      ...(relatedEventId ? { relatedEventId } : {}),
      ...(sourceLabel ? { sourceLabel } : {}),
      ...(this.activeQuotes && this.activeQuotes.length > 0
        ? { quotes: this.activeQuotes.map((quote) => ({ ...quote })) }
        : {})
    }
    this.deps.conversation.appendMessage(message)
    return message
  }

  private updateMessage(
    messageId: string,
    content: string,
    status: 'parsed' | 'clarifying' | 'failed',
    now: number,
    sourceLabel?: string
  ): void {
    this.deps.store.write((draft) => {
      const message = draft.messages.find((item) => item.messageId === messageId)
      if (message) {
        message.content = content.slice(0, 1000)
        message.status = status
        message.createdAt = message.createdAt
        if (sourceLabel !== undefined) message.sourceLabel = sourceLabel
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
      failure?: FailurePresentationDto
      retry?: RetryAffordance
      retryState?: 'idle' | 'auto_retrying' | 'auto_retry_failed' | 'manual_retrying'
    } = {}
  ): ConversationTurn {
    const trace = this.activeTrace
    this.activeTrace = undefined
    const finalLabel = assistantMessage.sourceLabel ?? this.activeImportLabel ?? sourceLineOfTrace(trace ?? [])
    let assistant = assistantMessage
    if (finalLabel !== undefined && assistantMessage.sourceLabel !== finalLabel) {
      assistant = { ...assistantMessage, sourceLabel: finalLabel }
      this.updateMessage(assistant.messageId, assistant.content, assistant.status, assistant.createdAt, finalLabel)
    }
    return {
      userMessage: toDto(userMessage),
      assistantMessage: toDto(assistant),
      state,
      ...(extras.parsePreview ? { parsePreview: extras.parsePreview } : {}),
      ...(extras.candidates ? { candidates: extras.candidates } : {}),
      ...(extras.conflicts ? { conflicts: extras.conflicts } : {}),
      ...(extras.createdEventId ? { createdEventId: extras.createdEventId } : {}),
      ...(extras.errorCode ? { errorCode: extras.errorCode } : {}),
      ...(extras.errorCode ? { errorText: extras.failure?.text ?? errorText(extras.errorCode as never) } : {}),
      ...(extras.failure ? { failure: extras.failure } : {}),
      ...(extras.retry ? { retry: extras.retry } : {}),
      ...(extras.retryState ? { retryState: extras.retryState } : {}),
      ...(trace !== undefined && trace.length > 0 ? { sourceTrace: trace } : {})
    }
  }

  private retryAffordanceOf(envelope: SubmitEnvelope): RetryAffordance {
    if (envelope.parts.length === 0) return { available: false, kind: 'text', reason: 'no_input' }
    const media = envelope.parts.filter((part) => part.kind !== 'text')
    if (media.length === 0) return { available: true, kind: 'text' }
    const first = media[0]
    if (!first) return { available: false, kind: 'text', reason: 'no_input' }
    const mediaKind: 'image' | 'voice' = first.kind === 'voice' ? 'voice' : 'image'
    const expiresAt = this.deps.tempFiles?.retainedUntil(first.tempFilePath)
    if (expiresAt === undefined) {
      return { available: false, kind: 'media', mediaKind, reason: 'media_expired' }
    }
    return { available: true, kind: 'media', mediaKind, expiresAt }
  }

  private failurePresentationOf(
    info: ParseLastFailure | undefined,
    code: string,
    retry: RetryAffordance
  ): FailurePresentationDto | undefined {
    if (!info) return undefined
    const presentation = presentFailure({
      channel: info.channel,
      boundPresetId: info.boundPresetId,
      boundPresetName: info.boundPresetName,
      sourcePresetId: info.sourcePresetId,
      sourceName: info.sourceName,
      failureClass: info.failureClass,
      stage: info.stage,
      durationMs: info.durationMs,
      consecutiveFailures: info.consecutiveFailures,
      compositeMedia: info.compositeMediaFailed,
      mediaRetryable: info.channel === 'text' ? undefined : retry.available,
      unsupportedModality: code === 'E_OCR_UNSUPPORTED' || code === 'E_ASR_UNSUPPORTED'
    })
    return {
      messageKey: presentation.messageKey,
      text: presentation.text,
      sourceLabel: presentation.sourceLabel,
      actions: presentation.actions,
      retryableByClick: presentation.retryableByClick
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
    ...(message.relatedEventId ? { relatedEventId: message.relatedEventId } : {}),
    ...(message.sourceLabel ? { sourceLabel: message.sourceLabel } : {}),
    ...(message.quotes && message.quotes.length > 0 ? { quotes: message.quotes } : {})
  }
}

function sourceLabelOf(trace: ChannelSourceTrace): string {
  if (trace.channel === 'text') {
    return trace.actualPresetId === 'deepseek'
      ? translate('ai.source.deepseekText')
      : `文字理解：${trace.actualName}`
  }
  if (trace.channel === 'vision') {
    return trace.actualPresetId === 'groq'
      ? translate('ai.source.groqVision')
      : `图片识别：${trace.actualName}`
  }
  return trace.actualPresetId === 'groq'
    ? translate('ai.source.groqAsr')
    : `语音转写：${trace.actualName}`
}

function sourceLineOfTrace(trace: readonly ChannelSourceTrace[]): string | undefined {
  const ordered = (['text', 'vision', 'asr'] as const)
    .map((channel) => trace.find((item) => item.channel === channel))
    .filter((item): item is ChannelSourceTrace => item !== undefined)
  const line = ordered.map(sourceLabelOf).join('；')
  return line.length > 0 ? line : undefined
}

function buildPlaceholder(envelope: SubmitEnvelope): string {
  if (envelope.attachment) {
    return [`【附件】${envelope.attachment.name}`, envelope.attachment.question].filter(Boolean).join('\n')
  }
  const parts: string[] = []
  for (const part of envelope.parts) {
    if (part.kind === 'text') parts.push(stripImportHeader(part.text).body)
    else if (part.kind === 'voice') parts.push(`【语音 ${Math.round(part.durationMs / 1000)} 秒】`)
    else parts.push('【图片】')
  }
  return parts.join(' ').slice(0, 1000)
}

function describeCommand(command: ResolutionCommand): string {
  switch (command.kind) {
    case 'supplement':
      return command.text
    case 'confirm_candidates':
      return `确认写入第 ${command.selectedIndexes.map((index) => index + 1).join('、')} 项`
    case 'reject_candidates':
      return '放弃本次识别的全部候选'
    case 'confirm_understanding':
      return '确认理解正确'
    case 'reparse':
      return '重新描述'
    case 'conflict_decision':
      return command.choice === 'create_anyway'
        ? '仍然创建'
        : command.choice === 'abandon'
          ? '放弃'
          : '改时间'
    default:
      return '继续'
  }
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
