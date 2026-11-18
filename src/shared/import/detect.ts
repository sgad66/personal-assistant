import { IMAGE_EXTENSIONS, IMPORT_EXTENSIONS, VIDEO_EXTENSIONS } from './limits'
import { extensionOf } from './text'

export type ImportFormat = 'txt' | 'md' | 'csv' | 'ics' | 'json' | 'image' | 'video' | 'unsupported'

export function detectFormat(fileName: string): ImportFormat {
  const ext = extensionOf(fileName)
  if (ext.length === 0) return 'unsupported'
  if ((IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
    return ext as 'txt' | 'md' | 'csv' | 'ics' | 'json'
  }
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image'
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video'
  return 'unsupported'
}