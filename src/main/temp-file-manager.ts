import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, basename } from 'node:path'

export type TempKind = 'voice' | 'image'

/**
 * 临时文件管理器：先登记，再由 finally 路径强制释放。
 */
export class TempFileManager {
  private readonly dir: string
  private readonly registered = new Set<string>()

  constructor(rootDir?: string) {
    this.dir = rootDir ?? mkdtempSync(join(tmpdir(), 'pa-temp-'))
    mkdirSync(this.dir, { recursive: true })
  }

  get directory(): string {
    return this.dir
  }

  stage(sourcePath: string, kind: TempKind): string {
    if (!existsSync(sourcePath)) {
      throw new Error(`source not found: ${sourcePath}`)
    }
    const target = join(this.dir, `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(sourcePath) || ''}`)
    copyFileSync(sourcePath, target)
    this.registered.add(target)
    return target
  }

  stageBytes(fileName: string, bytes: Uint8Array, kind: TempKind): string {
    const safeName = basename(fileName).replace(/[^\w.-]/g, '_')
    const target = join(this.dir, `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`)
    writeFileSync(target, bytes)
    this.registered.add(target)
    return target
  }

  release(path: string): void {
    this.registered.delete(path)
    try {
      if (existsSync(path)) rmSync(path, { force: true })
    } catch {
      // 清理失败不阻断业务
    }
  }

  releaseAll(): void {
    for (const path of Array.from(this.registered)) {
      this.release(path)
    }
  }

  isEmpty(): boolean {
    try {
      return readdirSync(this.dir).length === 0
    } catch {
      return true
    }
  }
}