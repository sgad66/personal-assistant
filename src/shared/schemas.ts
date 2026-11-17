import { z } from 'zod'

export const LIMITS = {
  textChars: 500,
  attachmentChars: 32_000,
  voiceMs: 60_000,
  imageBytes: 10 * 1024 * 1024,
  titleChars: 50,
  locationChars: 100,
  noteChars: 500,
  contentChars: 1000
} as const

export const textPartSchema = z.object({
  kind: z.literal('text'),
  text: z.string().min(1).max(LIMITS.attachmentChars)
})

export const voicePartSchema = z.object({
  kind: z.literal('voice'),
  tempFilePath: z.string().min(1),
  durationMs: z.number().int().positive().max(LIMITS.voiceMs)
})

export const imagePartSchema = z.object({
  kind: z.literal('image'),
  tempFilePath: z.string().min(1),
  byteSize: z.number().int().positive().max(LIMITS.imageBytes),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp'])
})

export const partSchema = z.discriminatedUnion('kind', [textPartSchema, voicePartSchema, imagePartSchema])

export const submitEnvelopeSchema = z
  .object({
    attachment: z.object({ name: z.string().min(1).max(255), question: z.string().max(LIMITS.textChars).optional() }).optional(),
    clientMessageId: z.string().min(8).max(128),
    modality: z.enum(['text', 'voice', 'image', 'composite']),
    parts: z.array(partSchema).min(1).max(6),
    retryOf: z.string().min(8).max(128).optional()
  })
  .superRefine((value, ctx) => {
    const kinds = new Set(value.parts.map((part) => part.kind))
    if (value.modality === 'composite' && kinds.size < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'composite 输入至少包含两种模态' })
    }
    const textTotal = value.parts
      .filter((part): part is z.infer<typeof textPartSchema> => part.kind === 'text')
      .reduce((sum, part) => sum + part.text.length, 0)
    if (textTotal > (value.attachment ? LIMITS.attachmentChars : LIMITS.textChars)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '文字总长度超出限制' })
    }
    const voiceTotal = value.parts
      .filter((part): part is z.infer<typeof voicePartSchema> => part.kind === 'voice')
      .reduce((sum, part) => sum + part.durationMs, 0)
    if (voiceTotal > LIMITS.voiceMs) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '语音总时长超出限制' })
    }
  })

export type SubmitEnvelopeInput = z.infer<typeof submitEnvelopeSchema>

export const resolutionCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('supplement'), text: z.string().min(1).max(LIMITS.textChars) }),
  z.object({ kind: z.literal('confirm_candidates'), selectedIndexes: z.array(z.number().int().min(0)).min(1) }),
  z.object({ kind: z.literal('reject_candidates') }),
  z.object({ kind: z.literal('confirm_understanding') }),
  z.object({ kind: z.literal('reparse') }),
  z.object({
    kind: z.literal('conflict_decision'),
    choice: z.enum(['reschedule', 'create_anyway', 'abandon'])
  })
])

export const weekQuerySchema = z.object({
  weekStart: z.number().int()
})

export const eventDetailQuerySchema = z.object({
  eventId: z.string().min(1)
})

export const reminderResponseSchema = z.object({
  eventId: z.string().min(1),
  plannedAt: z.number().int(),
  action: z.enum(['acknowledge', 'snooze', 'ignore'])
})

export const stageTempFileSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  bytes: z.instanceof(ArrayBuffer)
})

export const aiConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().max(400),
  model: z.string().min(1).max(100),
  visionModel: z.string().min(1).max(100),
  asrModel: z.string().min(1).max(100)
})

export const parsedCandidateSchema = z.object({
  title: z.string().optional(),
  startExpression: z.string().optional(),
  endExpression: z.string().optional(),
  location: z.string().optional(),
  note: z.string().optional()
})

export const parseResultSchema = z.object({
  intentKind: z.enum(['schedule', 'modify', 'cancel', 'chitchat', 'unknown']),
  candidates: z.array(parsedCandidateSchema).max(10),
  replyText: z.string().max(2000),
  confidence: z.number().min(0).max(1)
})

export const channelBindingInputSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['ai', 'local']),
  presetId: z.enum(['groq', 'deepseek', 'gemini', 'glm', 'openrouter', 'custom']),
  endpoint: z.string().min(1).max(300),
  model: z.string().min(1).max(150),
  source: z.enum(['preset_default', 'custom_override'])
})

export const keyOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('set'),
    presetId: z.enum(['groq', 'deepseek', 'gemini', 'glm', 'openrouter', 'custom']),
    secret: z.string().min(1).max(400)
  }),
  z.object({
    op: z.literal('clear'),
    presetId: z.enum(['groq', 'deepseek', 'gemini', 'glm', 'openrouter', 'custom'])
  }),
  z.object({
    op: z.literal('keep'),
    presetId: z.enum(['groq', 'deepseek', 'gemini', 'glm', 'openrouter', 'custom'])
  })
])

export const aiAccessConfigInputSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    channels: z.object({
      text: channelBindingInputSchema,
      vision: channelBindingInputSchema,
      asr: channelBindingInputSchema
    }),
    keyOps: z.array(keyOpSchema).max(10),
    timeouts: z.object({ relaxed: z.boolean() }).optional()
  })
  .superRefine((value, ctx) => {
    const ops = new Map<string, number>()
    for (const op of value.keyOps) {
      if (op.op === 'keep') continue
      const count = (ops.get(op.presetId) ?? 0) + 1
      ops.set(op.presetId, count)
      if (count > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '同一预设最多一条 set 或 clear 操作' })
      }
    }
  })

export const aiConnectionTestRequestSchema = z.object({
  channel: z.enum(['text', 'vision', 'asr']),
  binding: channelBindingInputSchema,
  secret: z.string().max(400).optional()
})

export function clampText(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}