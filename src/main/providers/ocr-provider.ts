import { readFileSync } from 'node:fs'
import { fail, ok, type Result } from '@shared/result'
import { messageKeyOf } from '@shared/error-catalog'
import { httpsJson, joinUrl } from './http-client'
import type { IImageToTextProvider, OcrResult, ProviderConfig } from './types'
import { failFromCategory, notConfiguredFailure } from './error-mapping'
import type { Logger } from '../observability/logger'

const OCR_PROMPT =
  '请提取这张图片中的全部文字，保持原有分行结构，只输出提取到的文字，不要添加解释。若图片中没有任何文字，输出空字符串。'

interface ChatChoice {
  message?: { content?: string }
}
interface ChatResponse {
  choices?: ChatChoice[]
}

export class OcrProvider implements IImageToTextProvider {
  constructor(
    private readonly config: ProviderConfig,
    private readonly logger: Logger,
    private readonly timeoutMs = 10_000
  ) {}

  async extract(tempFilePath: string, mimeType: string): Promise<Result<OcrResult>> {
    if (!this.config.apiKey) {
      return notConfiguredFailure()
    }
    const started = Date.now()
    let base64: string
    try {
      base64 = readFileSync(tempFilePath).toString('base64')
    } catch {
      return failFromCategory('serviceError')
    }

    const response = await httpsJson(
      joinUrl(this.config.baseUrl, '/chat/completions'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.visionModel,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: OCR_PROMPT },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
              ]
            }
          ]
        })
      },
      this.timeoutMs
    )

    if (!response.ok) {
      const category = response.failureCategory ?? 'serviceError'
      this.logger.failure('ocr.failed', 'E_OCR_NO_TEXT', Date.now() - started, category)
      return failFromCategory(category)
    }

    const body = response.body as ChatResponse
    const text = (body.choices?.[0]?.message?.content ?? '').trim()
    if (text.length === 0) {
      this.logger.failure('ocr.failed', 'E_OCR_NO_TEXT', Date.now() - started, 'unparsable')
      return fail('E_OCR_NO_TEXT', messageKeyOf('E_OCR_NO_TEXT'), true, { failureCategory: 'unparsable' })
    }
    this.logger.success('ocr.completed', Date.now() - started)
    return ok({
      text,
      layoutHints: text.split(/\n+/).map((line) => line.trim()).filter((line) => line.length > 0)
    })
  }
}