import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fail, ok, type Result } from '@shared/result'
import { messageKeyOf } from '@shared/error-catalog'
import { budgetFor, type ChannelBudget } from '@shared/ai/timeout-policy'
import { classifyUnsupportedModality, httpsJson, joinUrl } from './http-client'
import type { ISpeechToTextProvider, ProviderConfig, Transcript } from './types'
import { failFromCategory, notConfiguredFailure } from './error-mapping'
import type { Logger } from '../observability/logger'

interface TranscriptionResponse {
  text?: string
}

export class AsrProvider implements ISpeechToTextProvider {
  constructor(
    private readonly config: ProviderConfig,
    private readonly logger: Logger,
    private readonly budget: ChannelBudget = budgetFor('asr'),
    private readonly clock: () => number = () => Date.now()
  ) {}

  async transcribe(tempFilePath: string, _durationMs: number): Promise<Result<Transcript>> {
    if (!this.config.apiKey) {
      return notConfiguredFailure()
    }
    const started = this.clock()
    let bytes: Uint8Array
    try {
      bytes = readFileSync(tempFilePath)
    } catch {
      return failFromCategory('serviceError', {
        stage: 'local_check',
        receivedFirstByte: false,
        elapsedMs: this.clock() - started
      })
    }

    const form = new FormData()
    form.append('model', this.config.asrModel)
    form.append('file', new Blob([bytes], { type: 'audio/webm' }), basename(tempFilePath) || 'audio.webm')

    const response = await httpsJson(
      joinUrl(this.config.baseUrl, '/audio/transcriptions'),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form
      },
      { firstByteMs: this.budget.firstByteMs, overallMs: this.budget.overallMs }
    )

    if (!response.ok) {
      const category = response.failureCategory ?? 'serviceError'
      const elapsed = response.failureMeta?.elapsedMs ?? this.clock() - started
      if (classifyUnsupportedModality(response.status, response.text ?? '', 'asr')) {
        this.logger.failure('asr.failed', 'E_ASR_UNSUPPORTED', elapsed, 'modelUnavailable', {
          channel: 'asr',
          resolution: 'capability_gap'
        })
        return fail('E_ASR_UNSUPPORTED', messageKeyOf('E_ASR_UNSUPPORTED'), false, {
          failureCategory: 'modelUnavailable',
          failureMeta: {
            stage: 'result_parse',
            receivedFirstByte: response.failureMeta?.receivedFirstByte ?? true,
            elapsedMs: elapsed,
            status: response.status
          }
        })
      }
      this.logger.failure('asr.failed', 'E_ASR_FAIL', elapsed, category, {
        channel: 'asr',
        resolution: 'failed'
      })
      return failFromCategory(category, response.failureMeta)
    }

    const body = response.body as TranscriptionResponse
    const text = (body.text ?? '').trim()
    if (text.length === 0) {
      const elapsed = response.failureMeta?.elapsedMs ?? this.clock() - started
      this.logger.failure('asr.failed', 'E_ASR_FAIL', elapsed, 'unparsable', {
        channel: 'asr',
        resolution: 'failed'
      })
      return fail('E_ASR_FAIL', messageKeyOf('E_ASR_FAIL'), true, { failureCategory: 'unparsable' })
    }
    this.logger.success('asr.completed', response.failureMeta?.elapsedMs ?? this.clock() - started, {
      channel: 'asr',
      resolution: 'success'
    })
    return ok({ text })
  }
}