import type { Goal } from '@shared/domain/types'

import { fail, ok, type Result } from '@shared/result'
import type { Logger } from '../observability/logger'
import type { ResolvedAccess } from '../ai/provider-resolver'
import type { GoalCheckResult, ITextUnderstandingProvider } from '../providers/types'

export interface GoalRunnerDeps {
  readonly getAccess: () => ResolvedAccess
  readonly logger: Logger
  readonly clock: () => number
  readonly timeZone: string
}

export interface GoalCheckOutcome extends GoalCheckResult {
  readonly source: 'ai' | 'local'
}

export class GoalRunner {
  constructor(private readonly deps: GoalRunnerDeps) {}

  async check(goal: Goal, now: number): Promise<Result<GoalCheckOutcome>> {
    const access = this.deps.getAccess()
    const channel = access.text
    if (channel.kind !== 'ready' || channel.actualPresetId === 'local') {
      return ok({ ...localCheck(goal), source: 'local' })
    }
    const provider = channel.provider as ITextUnderstandingProvider
    if (!provider.checkGoal) {
      return ok({ ...localCheck(goal), source: 'local' })
    }

    const started = this.deps.clock()
    const result = await provider.checkGoal({
      goal: {
        title: goal.title,
        instruction: goal.instruction,
        cadence: goal.cadence,
        progress: goal.progress,
        ...(goal.progressNote ? { progressNote: goal.progressNote } : {}),
        ...(goal.nextStep ? { nextStep: goal.nextStep } : {}),
        checkpoints: goal.checkpoints.map((item) => ({
          at: item.at,
          progress: item.progress,
          status: item.status,
          summary: item.summary
        }))
      },
      referenceTime: now,
      timeZone: this.deps.timeZone
    })
    const elapsed = Math.max(0, this.deps.clock() - started)
    if (!result.ok) {
      this.deps.logger.failure('goal.failed', result.error.code, elapsed, result.error.failureCategory, {
        channel: 'text',
        resolution: 'failed'
      })
      return fail(result.error.code, result.error.messageKey, result.error.retryable)
    }
    this.deps.logger.success('goal.checked', elapsed, { channel: 'text', resolution: 'success' })
    return ok({
      summary: result.data.summary.trim().slice(0, 600),
      progress: Math.min(100, Math.max(goal.progress - 10, result.data.progress)),
      ...(result.data.nextStep ? { nextStep: result.data.nextStep.trim().slice(0, 200) } : {}),
      source: 'ai'
    })
  }
}

function localCheck(goal: Goal): GoalCheckResult {
  const progressNote = goal.progressNote ? `上次记录：${goal.progressNote}` : '还没有记录进展。'
  return {
    summary: [
      `按计划来跟进「${goal.title}」，目前记录进度 ${goal.progress}%。`,
      progressNote,
      goal.nextStep ? `上次建议的下一步：${goal.nextStep}` : '',
      '有新的推进就在对话里告诉我，我会把这次检查记下来。'
    ]
      .filter((line) => line.length > 0)
      .join(' ')
      .slice(0, 600),
    progress: goal.progress,
    ...(goal.nextStep ? { nextStep: goal.nextStep } : {})
  }
}
