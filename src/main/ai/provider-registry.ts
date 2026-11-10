import type { ResolvedAccess } from './provider-resolver'
import { ok } from '@shared/result'
import type { Result } from '@shared/result'

export interface IProviderRegistry {
  current(): ResolvedAccess
  publish(next: ResolvedAccess): void
}

export class ProviderRegistry implements IProviderRegistry {
  private access: ResolvedAccess
  private revision: number

  constructor(initial: ResolvedAccess) {
    this.access = Object.freeze(initial)
    this.revision = initial.revision
  }

  current(): ResolvedAccess {
    return this.access
  }

  publish(next: ResolvedAccess): void {
    this.revision = Math.max(this.revision + 1, next.revision)
    this.access = Object.freeze({ ...next, revision: this.revision })
  }

  noop(): Result<void> {
    return ok(undefined)
  }
}