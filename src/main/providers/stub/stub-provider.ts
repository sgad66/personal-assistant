import { ok, type Result } from '@shared/result'
import type {
  IImageToTextProvider,
  ISpeechToTextProvider,
  ITextUnderstandingProvider,
  OcrResult,

  ParseResult,
  Transcript
} from '../types'

export interface StubOptions {
  readonly delayMs?: number
  readonly parseResult?: ParseResult
  readonly transcript?: string
  readonly ocrText?: string
}

/**
 * 可注入的桩实现：供集成测试与 E2E 注入可控延迟 / 可控返回。
 */
export class StubProviderSet
  implements ITextUnderstandingProvider, ISpeechToTextProvider, IImageToTextProvider
{
  constructor(private readonly options: StubOptions = {}) {}

  private async wait(): Promise<void> {
    const delay = this.options.delayMs ?? 0
    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay))
    }
  }

  async parse(): Promise<Result<ParseResult>> {
    await this.wait()
    const fallback: ParseResult = {
      intentKind: 'schedule',
      candidates: [{ title: '桩解析事项', startExpression: '明天上午九点' }],
      replyText: '已安排：桩解析事项',
      confidence: 0.9
    }
    return ok(this.options.parseResult ?? fallback)
  }

  async transcribe(_tempFilePath: string, _durationMs: number): Promise<Result<Transcript>> {
    await this.wait()
    return ok({ text: this.options.transcript ?? '明天上午九点开会' })
  }

  async extract(_tempFilePath: string, _mimeType: string): Promise<Result<OcrResult>> {
    await this.wait()
    return ok({ text: this.options.ocrText ?? '周五下午三点 产品评审会' })
  }
}