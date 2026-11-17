import { detectFormat } from './detect'
import { IMPORT_LIMITS } from './limits'
import { extensionOf } from './text'

export interface ImportCandidateFile {
  readonly name: string
  readonly size: number
}

export type ImportRejectReasonKey =
  | 'import.formatUnsupported'
  | 'import.videoUnsupported'
  | 'import.imageUseAgent'
  | 'import.fileTooLarge'
  | 'import.tooManyFiles'

export interface RejectedFile {
  readonly name: string
  readonly reasonKey: ImportRejectReasonKey
  readonly ext?: string
}

export interface ImportBatchPlan {
  readonly accepted: readonly ImportCandidateFile[]
  readonly rejected: readonly RejectedFile[]
  readonly batchRejected?: 'import.batchTooLarge'
  readonly totalBytes: number
}

export function planImportBatch(files: readonly ImportCandidateFile[]): ImportBatchPlan {
  const accepted: ImportCandidateFile[] = []
  const rejected: RejectedFile[] = []

  files.forEach((file, index) => {
    if (index >= IMPORT_LIMITS.maxFiles) {
      rejected.push({ name: file.name, reasonKey: 'import.tooManyFiles' })
      return
    }
    const format = detectFormat(file.name)
    if (format === 'image') {
      rejected.push({ name: file.name, reasonKey: 'import.imageUseAgent' })
      return
    }
    if (format === 'video') {
      rejected.push({ name: file.name, reasonKey: 'import.videoUnsupported' })
      return
    }
    if (format === 'unsupported') {
      rejected.push({
        name: file.name,
        reasonKey: 'import.formatUnsupported',
        ext: extensionOf(file.name)
      })
      return
    }
    if (file.size > IMPORT_LIMITS.maxFileBytes) {
      rejected.push({ name: file.name, reasonKey: 'import.fileTooLarge' })
      return
    }
    accepted.push(file)
  })

  const totalBytes = accepted.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > IMPORT_LIMITS.maxTotalBytes) {
    return { accepted: [], rejected, batchRejected: 'import.batchTooLarge', totalBytes }
  }
  return { accepted, rejected, totalBytes }
}