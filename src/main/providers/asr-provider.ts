import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { fail, ok, type Result } from '@shared/result'
import { messageKeyOf } from '@shared/error-catalog'
import { httpsJson, joinUrl } from './http-client'
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
    private readonly timeoutMs = 8_000
  ) {}

  async transcribe(tempFilePath: string, _durationMs: number): Promise<Result<Transcript>> {
    if (!this.config.apiKey) {
      return notConfiguredFailure()
    }
    const started = Date.now()
    let bytes: Uint8Array
    try {
      bytes = readFileSync(tempFilePath)
    } catch {
      return failFromCategory('serviceError')
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
      this.timeoutMs
    )

    if (!response.ok) {
      const category = response.failureCategory ?? 'serviceError'
      this.logger.failure('asr.failed', 'E_ASR_FAIL', Date.now() - started, category)
      return failFromCategory(category)
    }

    const body = response.body as TranscriptionResponse
    const text = (body.text ?? '').trim()
    if (text.length === 0) {
      this.logger.failure('asr.failed', 'E_ASR_FAIL', Date.now() - started, 'unparsable')
      return fail('E_ASR_FAIL', messageKeyOf('E_ASR_FAIL'), true, { failureCategory: 'unparsable' })
    }
    this.logger.success('asr.completed', Date.now() - started)
    return ok({ text })
  }
}