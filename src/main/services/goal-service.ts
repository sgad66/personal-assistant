import type { ConversationMessage, Goal, GoalCheckpoint } from '@shared/domain/types'
import type {
  ConversationMessageDto,
  GoalChangeNotice,
  GoalChangeReason,
  GoalCreateInput,
  GoalRunResult,
  GoalStatusRequest,
  GoalView
} from '@shared/ipc-contracts'
import { messageKeyOf } from '@shared/error-catalog'
import { errorText } from '@shared/message-catalog'
import { fail, ok, type Result } from '@shared/result'
import {
  clampProgress,
  computeGoalNextRun,
  goalNextRunLabel,
  initialGoalNextRun,
  normalizeGoalDraft,
  type GoalDraft
} from '@shared/goals/schedule'
import type { ConversationRepository } from '../storage/conversation-repository'
import type { DataStore } from '../storage/data-store'
import type { GoalRepository } from '../storage/goal-repository'
import type { Logger } from '../observability/logger'
import type { GoalRunner } from './goal-runner'

const CHECKPOINT_KEEP = 20

export interface GoalServiceDeps {
  readonly store: DataStore
  readonly goals: GoalRepository
  readonly runner: GoalRunner
  readonly conversation: ConversationRepository
  readonly logger: Logger
  readonly clock: () => number
  readonly onChanged?: (notice: GoalChangeNotice) => void
}

export interface GoalFromAiOutcome {
  readonly view?: GoalView
  readonly created: boolean
}

export class GoalService {
  private readonly inFlight = new Set<string>()

  constructor(private readonly deps: GoalServiceDeps) {}

  list(): GoalView[] {
    const result = this.deps.goals.list()
    if (!result.ok) return []
    return result.data.map((goal) => this.viewOf(goal))
  }

  isRunning(goalId: string): boolean {
    return this.inFlight.has(goalId)
  }

  find(goalId: string): Goal | undefined {
    return this.deps.goals.find(goalId)
  }

  dueGoals(now: number): Goal[] {
    const result = this.deps.goals.findDue(now)
    return result.ok ? result.data : []
  }

  create(input: GoalCreateInput): Result<GoalView> {
    const now = this.deps.clock()
    const draft = normalizeGoalDraft(input, now)
    return this.insertGoal(draft, now, 'user')
  }

  createFromAi(draft: GoalDraft, now: number): GoalFromAiOutcome {
    const existing = this.deps.goals.findDuplicate(draft.title)
    if (existing) {
      return { view: this.viewOf(existing), created: false }
    }
    const created = this.insertGoal(draft, now, 'ai')
    return created.ok ? { view: created.data, created: true } : { created: false }
  }

  setStatus(request: GoalStatusRequest): Result<GoalView> {
    const goal = this.deps.goals.find(request.goalId)
    if (!goal) return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    const now = this.deps.clock()

    if (request.action === 'pause') {
      const updated = this.deps.goals.update(goal.goalId, { status: 'paused', updatedAt: now })
      if (!updated.ok || !updated.data) return fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'))
      return ok(this.emit('updated', updated.data))
    }

    if (request.action === 'resume') {
      if (goal.status === 'completed') {
        return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
      }
      const nextRunAt = computeGoalNextRun(goal, now)
      if (nextRunAt === undefined) {
        return fail('E_TIME_IN_PAST', messageKeyOf('E_TIME_IN_PAST'))
      }
      const updated = this.deps.goals.update(goal.goalId, {
        status: 'active',
        nextRunAt,
        updatedAt: now
      })
      if (!updated.ok || !updated.data) return fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'))
      return ok(this.emit('updated', updated.data))
    }

    const checkpoint: GoalCheckpoint = {
      at: now,
      progress: 100,
      status: 'success',
      summary: '你手动标记了这个目标已完成。'
    }
    const updated = this.deps.goals.update(goal.goalId, {
      status: 'completed',
      progress: 100,
      progressNote: '你手动标记了这个目标已完成。',
      updatedAt: now,
      checkpoints: [...goal.checkpoints, checkpoint].slice(-CHECKPOINT_KEEP)
    })
    if (!updated.ok || !updated.data) return fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'))
    return ok(this.emit('updated', updated.data))
  }

  remove(goalId: string): Result<{ goalId: string }> {
    const goal = this.deps.goals.find(goalId)
    if (!goal) return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    const removed = this.deps.goals.remove(goalId)
    if (!removed.ok || !removed.data) return fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'))
    this.deps.onChanged?.({ revision: this.deps.store.revision, reason: 'updated' })
    return ok({ goalId })
  }

  async run(goalId: string): Promise<Result<GoalRunResult>> {
    if (this.inFlight.has(goalId)) {
      return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    }
    const goal = this.deps.goals.find(goalId)
    if (!goal) return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    if (goal.status === 'completed') {
      return fail('E_VALIDATION_FAILED', messageKeyOf('E_VALIDATION_FAILED'))
    }

    const startedAt = this.deps.clock()
    this.inFlight.add(goalId)
    this.deps.onChanged?.({
      revision: this.deps.store.revision,
      reason: 'updated',
      goal: this.viewOf(goal)
    })

    let finalGoal: Goal | undefined
    let message: ConversationMessageDto | undefined
    let runResult: GoalRunResult | undefined
    try {
      const checked = await this.deps.runner
        .check(goal, startedAt)
        .catch(() => fail('E_AI_UNAVAILABLE', messageKeyOf('E_AI_UNAVAILABLE')))
      const finishedAt = this.deps.clock()
      const success = checked.ok
      const summary = success ? checked.data.summary : errorText(checked.error.code)
      const progress = success ? clampProgress(checked.data.progress) : goal.progress
      const nextStep = success ? checked.data.nextStep : undefined
      const completed = progress >= 100 || goal.cadence === 'once'
      const nextRunAt = completed ? goal.nextRunAt : computeGoalNextRun(goal, finishedAt) ?? goal.nextRunAt
      const checkpoint: GoalCheckpoint = {
        at: finishedAt,
        progress,
        status: success ? 'success' : 'failed',
        summary: summary.slice(0, 600),
        ...(nextStep ? { nextStep } : {})
      }
      const updated = this.deps.goals.update(goalId, {
        progress,
        progressNote: summary.slice(0, 300),
        ...(nextStep ? { nextStep } : {}),
        lastRunAt: finishedAt,
        lastSummary: summary.slice(0, 600),
        runCount: goal.runCount + 1,
        updatedAt: finishedAt,
        checkpoints: [...goal.checkpoints, checkpoint].slice(-CHECKPOINT_KEEP),
        ...(completed ? { status: 'completed' as const } : { nextRunAt })
      })
      if (!updated.ok || !updated.data) {
        return fail('E_STORE_WRITE_FAIL', messageKeyOf('E_STORE_WRITE_FAIL'))
      }
      finalGoal = updated.data
      const body = buildRunMessage(updated.data, summary, success, finishedAt)
      message = this.appendAssistantMessage(updated.data.goalId, body, finishedAt)
      runResult = {
        goal: { ...this.viewOf(updated.data), running: false },
        status: success ? 'success' : 'failed',
        source: success ? checked.data.source : 'failed',
        summary: body
      }

      return ok(runResult)
    } finally {
      this.inFlight.delete(goalId)
      if (finalGoal) {
        const view = this.viewOf(finalGoal)
        if (runResult) runResult = { ...runResult, goal: view }
        this.deps.onChanged?.({
          revision: this.deps.store.revision,
          reason: 'run',
          goal: view,
          ...(message ? { message } : {})
        })
      }
    }
  }

  private insertGoal(draft: GoalDraft, now: number, createdBy: 'user' | 'ai'): Result<GoalView> {
    const goal: Goal = {
      goalId: `goal_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ...draft,
      progress: 0,
      status: 'active',
      createdBy,
      createdAt: now,
      updatedAt: now,
      nextRunAt: initialGoalNextRun(draft, now),
      runCount: 0,
      checkpoints: []
    }
    const inserted = this.deps.goals.insert(goal)
    if (!inserted.ok) return inserted
    this.deps.logger.log({ eventType: 'goal.created', resultStatus: 'success', durationMs: 0 })
    return ok(this.emit('created', inserted.data))
  }

  private appendAssistantMessage(
    goalId: string,
    content: string,
    now: number
  ): ConversationMessageDto | undefined {
    const message: ConversationMessage = {
      messageId: `msg_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      content: content.slice(0, 1000),
      modality: 'text',
      createdAt: now,
      status: 'parsed',
      relatedGoalId: goalId
    }
    const appended = this.deps.conversation.appendMessage(message)
    return appended.ok ? toDto(appended.data) : undefined
  }

  private emit(reason: GoalChangeReason, goal: Goal, message?: ConversationMessageDto): GoalView {
    const view = this.viewOf(goal)
    this.deps.onChanged?.({
      revision: this.deps.store.revision,
      reason,
      goal: view,
      ...(message ? { message } : {})
    })
    return view
  }

  private viewOf(goal: Goal): GoalView {
    return {
      goalId: goal.goalId,
      title: goal.title,
      instruction: goal.instruction,
      cadence: goal.cadence,
      hour: goal.hour,
      minute: goal.minute,
      weekday: goal.weekday,
      intervalMinutes: goal.intervalMinutes,
      ...(goal.onceAt !== undefined ? { onceAt: goal.onceAt } : {}),
      progress: goal.progress,
      ...(goal.progressNote ? { progressNote: goal.progressNote } : {}),
      status: goal.status,
      createdBy: goal.createdBy,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      nextRunAt: goal.nextRunAt,
      ...(goal.lastRunAt !== undefined ? { lastRunAt: goal.lastRunAt } : {}),
      ...(goal.lastSummary ? { lastSummary: goal.lastSummary } : {}),
      ...(goal.nextStep ? { nextStep: goal.nextStep } : {}),
      runCount: goal.runCount,
      running: this.inFlight.has(goal.goalId),
      checkpoints: goal.checkpoints.map((item) => ({
        at: item.at,
        progress: item.progress,
        status: item.status,
        summary: item.summary,
        ...(item.nextStep ? { nextStep: item.nextStep } : {})
      }))
    }
  }
}

function buildRunMessage(goal: Goal, summary: string, success: boolean, now: number): string {
  const head = success
    ? `跟进「${goal.title}」：${summary}`
    : `跟进「${goal.title}」这次没有完成：${summary}`
  const tail =
    goal.status === 'completed'
      ? `进度 ${goal.progress}%，已标记完成。`
      : `进度 ${goal.progress}%，下次 ${goalNextRunLabel(goal.nextRunAt, now)}。`
  return `${head}\n${tail}`.slice(0, 1000)
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
    ...(message.relatedGoalId ? { relatedGoalId: message.relatedGoalId } : {}),
    ...(message.sourceLabel ? { sourceLabel: message.sourceLabel } : {}),
    ...(message.quotes && message.quotes.length > 0 ? { quotes: message.quotes } : {})
  }
}