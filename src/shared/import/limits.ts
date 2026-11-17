export const IMPORT_EXTENSIONS = Object.freeze(['txt', 'md', 'csv', 'ics', 'json'] as const)
export type ImportTextExtension = (typeof IMPORT_EXTENSIONS)[number]

export const IMAGE_EXTENSIONS = Object.freeze(['png', 'jpg', 'jpeg', 'webp'] as const)
export const VIDEO_EXTENSIONS = Object.freeze([
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'm4v',
  'wmv',
  'flv'
] as const)

export const KNOWN_UNSUPPORTED = Object.freeze([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'exe',
  'bmp',
  'gif',
  'svg',
  'tiff',
  'heic'
] as const)

export const IMPORT_LIMITS = Object.freeze({
  maxFiles: 6,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 6 * 1024 * 1024,
  minChars: 1,
  textBudget: 500,
  headerMaxChars: 140,
  fileNameMaxChars: 60
})

export type ImportFailureKind =
  | 'format'
  | 'limit'
  | 'decode'
  | 'no_text'
  | 'unreadable'
  | 'parse'
  | 'video'

export type ImportTextFormat = ImportTextExtension