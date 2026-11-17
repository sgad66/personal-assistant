import type { ImagePart, InputPart } from '@shared/ipc-contracts'
import { LIMITS } from '@shared/schemas'
import { decodeTextBytes } from '@shared/import/decode'
import { extractText } from '@shared/import/extract'
import { IMPORT_EXTENSIONS } from '@shared/import/limits'
import { validateImage } from './input-collector'

export const DOCUMENT_ACCEPT = [...IMPORT_EXTENSIONS, 'pdf', 'docx'].map(ext => '.' + ext).join(',')
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'

export async function readChatAttachment(file: File, kind: 'file' | 'image'): Promise<InputPart> {
  if (!file.size) throw new Error('文件为空，请重新选择。')
  if (file.size > LIMITS.imageBytes) throw new Error('附件最大为 10 MB，请选用较小的文件。')
  if (kind === 'image') {
    const validation = validateImage(file.size, file.type)
    if (!validation.ok) throw new Error(validation.message)
    const staged = await window.pa.agent.stageTempFile({ fileName: file.name, mimeType: file.type, bytes: await file.arrayBuffer() })
    return { kind: 'image', ...staged, mimeType: file.type as ImagePart['mimeType'], byteSize: file.size }
  }

  const format = file.name.split('.').pop()?.toLowerCase()
  let text: string
  if (format === 'pdf' || format === 'docx') {
    text = await window.pa.agent.extractDocument(format, await file.arrayBuffer())
  } else {
    const supported = IMPORT_EXTENSIONS.find(ext => ext === format)
    if (!supported) throw new Error('支持 PDF、DOCX、TXT、Markdown、CSV、ICS 和 JSON 文件。')
    const decoded = decodeTextBytes(new Uint8Array(await file.arrayBuffer()))
    if (!decoded.ok) throw new Error('无法读取文字，请检查文件格式。')
    // 保留 JSON 数值、表头和 Markdown 链接，便于回答附件里的具体问题。
    text = supported === 'ics'
      ? [extractText('ics', decoded.text).text, decoded.text].join('\n')
      : decoded.text
  }
  if (!text.trim()) throw new Error('没有读到文字。扫描版 PDF 可将页面截图后作为图片上传。')
  if (text.length > LIMITS.attachmentChars) throw new Error('单次可读取 32,000 个字符，请按章节拆分后发送。')
  return { kind: 'text', text: text.trim() }
}
