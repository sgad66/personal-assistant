import { describe, expect, it } from 'vitest'
import {
  classifyHttpStatus,
  failureActionsOf,
  mapFailure,
  suggestionOf,
  type AiErrorDto
} from '@shared/ai/failure'
import { aiConfigChangedMessage } from '../helpers/ai-fixtures'

describe('AI 失败分类映射', () => {
  it('五类失败得到五个互不相同的错误码', () => {
    const codes = [
      mapFailure({ failureClass: 'not_configured' }, 'text').code,
      mapFailure({ failureClass: 'unauthorized' }, 'text').code,
      mapFailure({ failureClass: 'rate_limited' }, 'text').code,
      mapFailure({ failureClass: 'model_unavailable' }, 'text').code,
      mapFailure({ failureClass: 'network' }, 'text').code
    ]
    expect(new Set(codes).size).toBe(5)
    expect(codes).toContain('E_AI_PROVIDER_NOT_CONFIGURED')
    expect(codes).toContain('E_AI_AUTH_FAILED')
    expect(codes).toContain('E_AI_RATE_LIMITED')
    expect(codes).toContain('E_AI_MODEL_UNSUPPORTED')
    expect(codes).toContain('E_AI_NETWORK_FAILED')
  })

  it('五类失败文案键两两不同且鉴权指向设置', () => {
    const keys: string[] = [
      mapFailure({ failureClass: 'not_configured' }, 'text').messageKey,
      mapFailure({ failureClass: 'unauthorized' }, 'text').messageKey,
      mapFailure({ failureClass: 'rate_limited' }, 'text').messageKey,
      mapFailure({ failureClass: 'model_unavailable' }, 'text').messageKey,
      mapFailure({ failureClass: 'network' }, 'text').messageKey
    ]
    expect(new Set(keys).size).toBe(5)
    expect(failureActionsOf('unauthorized')).toContain('open_settings')
    expect(failureActionsOf('unauthorized')).toContain('update_key')
  })

  it('限流操作集包含重试与切换预设', () => {
    const actions = failureActionsOf('rate_limited')
    expect(actions).toContain('retry')
    expect(actions).toContain('switch_preset')
  })

  it('连续限流第 3 次才建议切换预设', () => {
    expect(suggestionOf(1)).toEqual([])
    expect(suggestionOf(2)).toEqual([])
    expect(suggestionOf(3)).toContain('switch_preset')
  })

  it('HTTP 状态归一化顺序正确', () => {
    expect(classifyHttpStatus(401)).toBe('unauthorized')
    expect(classifyHttpStatus(403)).toBe('unauthorized')
    expect(classifyHttpStatus(402)).toBe('rate_limited')
    expect(classifyHttpStatus(429)).toBe('rate_limited')
    expect(classifyHttpStatus(400, 'invalid model: foo')).toBe('model_unavailable')
    expect(classifyHttpStatus(400, 'bad request')).toBe('service_error')
    expect(classifyHttpStatus(503)).toBe('service_error')
  })

  it('输出不泄露密钥与堆栈原文', () => {
    const dto: AiErrorDto = mapFailure({ failureClass: 'unauthorized', message: 'sk-secret-key abc' }, 'text')
    const serialized = JSON.stringify(dto)
    expect(serialized.includes('sk-secret-key')).toBe(false)
    expect(serialized.includes('Error:')).toBe(false)
  })

  it('分类映射不修改入参', () => {
    const input = { failureClass: 'rate_limited' as const }
    const before = JSON.stringify(input)
    mapFailure(input, 'text')
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('辅助夹具可用', () => {
  it('配置变更通知夹具仅含修订号与状态', () => {
    const notice = aiConfigChangedMessage(3, 'free_recommended')
    expect(notice.revision).toBe(3)
    expect(notice.status).toBe('free_recommended')
    expect(JSON.stringify(notice).includes('secret')).toBe(false)
  })
})