import type { Goal } from '@shared/domain/types'
import type { Result } from '@shared/result'
import type { DataStore } from './data-store'

export class GoalRepository {
  constructor(private readonly store: DataStore) {}

  list(): Result<Goal[]> {
    return this.store.read((draft) =>
      draft.goals.slice().sort((a, b) => {
        const weight = (goal: Goal): number => (goal.status === 'active' ? 0 : goal.status === 'paused' ? 1 : 2)
        const byStatus = weight(a) - weight(b)
        if (byStatus !== 0) return byStatus
        return a.nextRunAt - b.nextRunAt
      })
    )
  }

  find(goalId: string): Goal | undefined {
    return this.store.snapshot().goals.find((goal) => goal.goalId === goalId)
  }

  findDuplicate(title: string): Goal | undefined {
    const normalized = title.trim().toLowerCase()
    return this.store
      .snapshot()
      .goals.find((goal) => goal.status !== 'completed' && goal.title.trim().toLowerCase() === normalized)
  }

  insert(goal: Goal): Result<Goal> {
    return this.store.write((draft) => {
      draft.goals.push(goal)
      return goal
    })
  }

  update(goalId: string, patch: Partial<Goal>): Result<Goal | undefined> {
    return this.store.write((draft) => {
      const goal = draft.goals.find((item) => item.goalId === goalId)
      if (!goal) return undefined
      Object.assign(goal, patch)
      return goal
    })
  }

  remove(goalId: string): Result<boolean> {
    return this.store.write((draft) => {
      const index = draft.goals.findIndex((goal) => goal.goalId === goalId)
      if (index < 0) return false
      draft.goals.splice(index, 1)
      return true
    })
  }

  findDue(now: number): Result<Goal[]> {
    return this.store.read((draft) =>
      draft.goals
        .filter((goal) => goal.status === 'active' && goal.nextRunAt <= now)
        .sort((a, b) => a.nextRunAt - b.nextRunAt)
    )
  }
}