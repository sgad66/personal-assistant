import type { AiChannelKind } from '@shared/ai/preset-catalog'

const WINDOW_MS = 5 * 60_000

export class FailureTracker {
  private readonly records = new Map<AiChannelKind, number[]>()

  constructor(private readonly clock: () => number = () => Date.now()) {}

  record(channel: AiChannelKind): number {
    const now = this.clock()
    const history = (this.records.get(channel) ?? []).filter((at) => now - at <= WINDOW_MS)
    history.push(now)
    this.records.set(channel, history)
    return history.length
  }

  count(channel: AiChannelKind): number {
    const now = this.clock()
    const history = (this.records.get(channel) ?? []).filter((at) => now - at <= WINDOW_MS)
    this.records.set(channel, history)
    return history.length
  }

  reset(channel?: AiChannelKind): void {
    if (channel) this.records.delete(channel)
    else this.records.clear()
  }
}