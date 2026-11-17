import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, join } from 'node:path'
import { ok, fail } from '@shared/result'
import { messageKeyOf } from '@shared/error-catalog'

const run = promisify(execFile)
const root = __dirname.includes('app.asar') ? process.resourcesPath : resolve(__dirname, '../..')
export function extractDocument(format: 'pdf' | 'docx', bytes: ArrayBuffer): Promise<string> {
  return new Promise((resolveText, reject) => {
    const child = execFile(join(root, '.media-env', 'python.exe'),
      ['-I', '-X', 'utf8', join(root, 'scripts', 'media.py'), format],
      { cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 256 * 1024 },
      (error, stdout) => {
        if (error) reject(new Error('文档读取失败，请检查文件是否损坏或已加密。'))
        else resolveText(stdout.trim())
      })
    child.stdin?.on('error', () => { /* 进程退出时由回调报告读取失败 */ })
    child.stdin?.end(Buffer.from(bytes))
  })
}

async function recognize(channel: 'vision' | 'asr', path: string) {
  try {
    const result = await run(join(root, '.media-env', 'python.exe'),
      ['-I', '-X', 'utf8', join(root, 'scripts', 'media.py'), channel, path],
      { cwd: root, windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 })
    return ok({ text: result.stdout.trim() })
  } catch {
    const code = channel === 'vision' ? 'E_OCR_NO_TEXT' : 'E_ASR_FAIL'
    return fail(code, messageKeyOf(code), false)
  }
}

export const localMedia = {
  extract: (path: string) => recognize('vision', path),
  transcribe: (path: string) => recognize('asr', path)
}
