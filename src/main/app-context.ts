import { EventEmitter } from 'node:events'
import type {
  AiAccessConfigView,
  AiConfigChangedNotice,
  AiConfigLoadOutcome,
  AiConfigSaveOutcome,
  AiConnectionTestRequest,
  AiConnectionTestResult
} from '@shared/ipc-contracts'
import type { AccessStatus } from '@shared/ai/access-config'
import { getPresetCatalog, CUSTOM_FALLBACK_CATALOG, type PresetCatalog } from '@shared/ai/preset-catalog'
import { validatePresetCatalog } from '@shared/ai/preset-catalog-validator'
import { DataStore } from './storage/data-store'
import { ConversationRepository } from './storage/conversation-repository'
import { ReminderRepository } from './storage/reminder-repository'
import { ScheduleService } from './services/schedule-service'
import { ConversationOrchestrator } from './services/conversation-orchestrator'
import { ParseOrchestrator } from './services/parse-orchestrator'
import { ReminderScheduler } from './reminder/reminder-scheduler'
import { Logger } from './observability/logger'
import { AiDiagnosticsStore } from './observability/ai-diagnostics'
import { TempFileManager } from './temp-file-manager'
import { AiConfigService } from './ai/config-service'
import { VersionedConfigStore } from './ai/config-store'
import { PlainFileVault, type ICredentialVault } from './ai/credential-vault'
import { ProviderRegistry } from './ai/provider-registry'
import { FailureTracker } from './ai/failure-tracker'
import { resolveAccess, type ResolvedAccess } from './ai/provider-resolver'

export interface AppContext {
  readonly store: DataStore
  readonly conversationRepo: ConversationRepository
  readonly reminderRepo: ReminderRepository
  readonly scheduleService: ScheduleService
  readonly conversation: ConversationOrchestrator
  readonly parser: ParseOrchestrator
  readonly scheduler: ReminderScheduler
  readonly logger: Logger
  readonly tempFiles: TempFileManager
  readonly aiConfig: AiConfigService
  readonly aiRegistry: ProviderRegistry
  readonly aiFailureTracker: FailureTracker
  readonly aiCatalog: PresetCatalog
  readonly events: EventEmitter
  readonly timeZone: string
  readonly clock: () => number
  loadAiConfig(): AiConfigLoadOutcome
  saveAiConfig(input: unknown): Promise<AiConfigSaveOutcome>
  testAiConnection(request: AiConnectionTestRequest): Promise<AiConnectionTestResult>
  aiView(): AiAccessConfigView
  aiStatus(): AccessStatus
  aiAccess(): ResolvedAccess
}

export interface AppContextOptions {
  readonly userDataDir: string
  readonly clock?: () => number
  readonly timeZone?: string
  readonly vault?: ICredentialVault
}

export function createAppContext(options: AppContextOptions): AppContext {
  const clock = options.clock ?? (() => Date.now())
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Shanghai'
  const logger = new Logger(`${options.userDataDir}/logs/app.log`)
  const store = new DataStore({ filePath: `${options.userDataDir}/data.json`, clock })
  const conversationRepo = new ConversationRepository(store)
  const reminderRepo = new ReminderRepository(store)
  const tempFiles = new TempFileManager(undefined, clock)
  const diagnostics = new AiDiagnosticsStore(`${options.userDataDir}/ai-diagnostics.json`, clock)
  diagnostics.load()
  const events = new EventEmitter()
  const vault = options.vault ?? new PlainFileVault(clock)

  const validated = validatePresetCatalog(getPresetCatalog())
  const aiCatalog: PresetCatalog = validated.ok ? validated.data : CUSTOM_FALLBACK_CATALOG
  const catalogState: 'ok' | 'degraded' = validated.ok ? 'ok' : 'degraded'

  const scheduleService = new ScheduleService(store, logger, (notice) => {
    events.emit('schedule-changed', notice)
    events.emit('reminder-poll')
  })

  const configStore = new VersionedConfigStore({
    filePath: `${options.userDataDir}/ai-config.json`,
    vault,
    clock,
    catalog: aiCatalog
  })
  const registry = new ProviderRegistry(resolveAccess(configStore.read().config, 1, {
    catalog: aiCatalog,
    vault,
    logger
  }))
  const failureTracker = new FailureTracker(clock)
  const aiService = new AiConfigService({
    store: configStore,
    vault,
    catalog: aiCatalog,
    catalogState,
    clock,
    logger,
    registry,
    diagnostics,
    emit: (notice: AiConfigChangedNotice) => events.emit('ai-config-changed', notice)
  })
  aiService.initialize()

  const parser = new ParseOrchestrator(() => registry.current(), tempFiles, logger, {
    diagnostics,
    failureTracker
  })

  const conversation = new ConversationOrchestrator({
    store,
    conversation: conversationRepo,
    schedule: scheduleService,
    parser,
    logger,
    timeZone,
    clock,
    tempFiles
  })

  const scheduler = new ReminderScheduler({
    store,
    reminders: reminderRepo,
    schedule: scheduleService,
    logger,
    clock,
    present: (payload) => events.emit('reminder-presented', payload)
  })

  return {
    store,
    conversationRepo,
    reminderRepo,
    scheduleService,
    conversation,
    parser,
    scheduler,
    logger,
    tempFiles,
    aiConfig: aiService,
    aiRegistry: registry,
    aiFailureTracker: failureTracker,
    aiCatalog,
    events,
    timeZone,
    clock,
    loadAiConfig: () => aiService.load(),
    saveAiConfig: (input) => aiService.save(input),
    testAiConnection: (request) => aiService.testConnection(request),
    aiView: () => aiService.currentView(),
    aiStatus: () => aiService.currentStatus(),
    aiAccess: () => registry.current()
  }
}