import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InputPart, SubmitEnvelope } from '@shared/ipc-contracts'
import { ok, type Result } from '@shared/result'
import type { ParseRequest, ParseResult } from '@main/providers/types'
import type { ResolvedAccess } from '@main/ai/provider-resolver'
import type { AiFailureDiagnosticsSink } from '@main/observability/ai-diagnostics'
import type { FailureTracker } from '@main/ai/failure-tracker'
import { localParse } from '@main/providers/local-parser'
import { DataStore } from '@main/storage/data-store'
import { ConversationRepository } from '@main/storage/conversation-repository'
import { ReminderRepository } from '@main/storage/reminder-repository'
import { ScheduleService } from '@main/services/schedule-service'
import { ConversationOrchestrator } from '@main/services/conversation-orchestrator'
import { ParseOrchestrator } from '@main/services/parse-orchestrator'
import { ReminderScheduler } from '@main/reminder/reminder-scheduler'
import { TempFileManager } from '@main/temp-file-manager'
import { silentLogger } from '@main/observability/logger'
import type { ReminderPayload } from '@shared/ipc-contracts'

export interface Harness {
  readonly store: DataStore
  readonly schedule: ScheduleService
  readonly conversation: ConversationOrchestrator
  readonly scheduler: ReminderScheduler
  readonly reminders: ReminderRepository
  readonly parser: ParseOrchestrator
  readonly access: ResolvedAccess
  readonly presented: ReminderPayload[]
  now: () => number
  setNow: (value: number) => void
  advance: (ms: number) => void
  submit: (text: string) => Promise<Awaited<ReturnType<ConversationOrchestrator['submit']>>>
  submitParts: (parts: InputPart[], modality?: SubmitEnvelope['modality']) => Promise<Awaited<ReturnType<ConversationOrchestrator['submit']>>>
  envelope: (text: string) => SubmitEnvelope
}

export function at(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
}

export interface HarnessOptions {
  readonly access?: ResolvedAccess
  readonly accessProvider?: () => ResolvedAccess
  readonly diagnostics?: AiFailureDiagnosticsSink
  readonly failureTracker?: FailureTracker
}

export function createHarness(initialNow: number, options?: HarnessOptions): Harness {
  let now = initialNow
  const clock = (): number => now
  const store = new DataStore({ clock })
  const logger = silentLogger
  const tempFiles = new TempFileManager(mkdtempSync(join(tmpdir(), 'pa-test-temp-')))
  const conversationRepo = new ConversationRepository(store)
  const reminderRepo = new ReminderRepository(store)
  const schedule = new ScheduleService(store, logger)

  const localTextProvider = {
    parse: async (request: ParseRequest): Promise<Result<ParseResult>> =>
      ok(localParse(request.description, request.referenceTime))
  }
  const access: ResolvedAccess = options?.access ?? {
    revision: 1,
    status: 'custom',
    text: {
      kind: 'ready',
      presetId: 'custom',
      endpoint: 'https://local.invalid',
      model: 'local',
      provider: localTextProvider
    },
    vision: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' },
    asr: { kind: 'not_configured', code: 'E_AI_PROVIDER_NOT_CONFIGURED' }
  }

  const parser = new ParseOrchestrator(
    options?.accessProvider ?? (() => access),
    tempFiles,
    logger,
    {
      ...(options?.diagnostics ? { diagnostics: options.diagnostics } : {}),
      ...(options?.failureTracker ? { failureTracker: options.failureTracker } : {})
    }
  )

  const conversation = new ConversationOrchestrator({
    store,
    conversation: conversationRepo,
    schedule,
    parser,
    logger,
    timeZone: 'Asia/Shanghai',
    clock,
    tempFiles
  })

  const presented: ReminderPayload[] = []
  const scheduler = new ReminderScheduler({
    store,
    reminders: reminderRepo,
    schedule,
    logger,
    clock,
    present: (payload) => presented.push(payload)
  })

  const envelope = (text: string): SubmitEnvelope => ({
    clientMessageId: `test_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    modality: 'text',
    parts: [{ kind: 'text', text }] satisfies InputPart[]
  })

  return {
    store,
    schedule,
    conversation,
    scheduler,
    reminders: reminderRepo,
    parser,
    access,
    presented,
    now: () => now,
    setNow: (value) => {
      now = value
    },
    advance: (ms) => {
      now += ms
    },
    submit: (text) => conversation.submit(envelope(text)),
    submitParts: (parts, modality = 'text') =>
      conversation.submit({
        clientMessageId: `test_${Math.random().toString(36).slice(2)}_${Date.now()}`,
        modality,
        parts
      }),
    envelope
  }
}