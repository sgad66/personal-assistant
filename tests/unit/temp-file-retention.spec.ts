import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TempFileManager } from '@main/temp-file-manager'

function setup(clockValue?: { now: number }): TempFileManager {
  const dir = mkdtempSync(join(tmpdir(), 'pa-retain-'))
  return new TempFileManager(dir, () => clockValue?.now ?? 1000)
}

function staged(manager: TempFileManager, kind: 'image' | 'voice' = 'image'): string {
  return manager.stageBytes(`${kind}.png`, Buffer.from('bytes'), kind)
}

describe('临时文件保留窗口', () => {
  it('保留后记录过期时间，到期清理', () => {
    const manager = setup()
    const path = staged(manager)
    manager.retain([path], { ttlMs: 120000, now: 1000 })
    expect(manager.isRetained(path)).toBe(true)
    expect(manager.retainedUntil(path)).toBe(121000)
    expect(manager.retainedKind(path)).toBe('image')
    expect(manager.purgeExpired(120999)).toBe(0)
    expect(manager.purgeExpired(121000)).toBe(1)
    expect(manager.isRetained(path)).toBe(false)
    expect(existsSync(path)).toBe(false)
  })

  it('purgeRetainedExcept 只保留指定路径', () => {
    const manager = setup()
    const keep = staged(manager)
    const drop = staged(manager)
    manager.retain([keep, drop], { ttlMs: 120000, now: 1000 })
    expect(manager.purgeRetainedExcept([keep])).toBe(1)
    expect(manager.isRetained(keep)).toBe(true)
    expect(manager.isRetained(drop)).toBe(false)
  })

  it('release 清除保留项与定时器，releaseAll 清空目录', () => {
    const manager = setup()
    const path = staged(manager)
    manager.retain([path], { ttlMs: 1000, now: 1000 })
    manager.release(path)
    expect(manager.isRetained(path)).toBe(false)
    const a = staged(manager)
    const b = staged(manager, 'voice')
    manager.retain([a, b], { ttlMs: 120000, now: 1000 })
    manager.releaseAll()
    expect(manager.isEmpty()).toBe(true)
    expect(manager.retainedFiles()).toHaveLength(0)
  })

  it('ttlMs 为 0 时立即删除且不进入保留区', () => {
    const manager = setup()
    const path = staged(manager)
    manager.retain([path], { ttlMs: 0 })
    expect(manager.isRetained(path)).toBe(false)
    expect(existsSync(path)).toBe(false)
  })

  it('注入时钟推进后按当前时间清理', () => {
    const clock = { now: 1000 }
    const manager = setup(clock)
    const path = staged(manager)
    manager.retain([path], { ttlMs: 5000, kind: 'voice' })
    expect(manager.retainedUntil(path)).toBe(6000)
    clock.now = 6000
    expect(manager.purgeExpired()).toBe(1)
    expect(manager.isRetained(path)).toBe(false)
  })

  it('五条回收路径均可达成', () => {
    const manager = setup()
    const retryPath = staged(manager)
    manager.retain([retryPath], { ttlMs: 120000, now: 1000 })
    manager.release(retryPath)
    expect(manager.isRetained(retryPath)).toBe(false)

    const oldPath = staged(manager)
    manager.retain([oldPath], { ttlMs: 120000, now: 1000 })
    const newPath = staged(manager)
    manager.purgeRetainedExcept([newPath])
    expect(manager.isRetained(oldPath)).toBe(false)
    expect(manager.isRetained(newPath)).toBe(false)

    const expiredPath = staged(manager)
    manager.retain([expiredPath], { ttlMs: 1000, now: 1000 })
    manager.purgeExpired(2000)
    expect(manager.isRetained(expiredPath)).toBe(false)

    const backgroundPath = staged(manager)
    manager.retain([backgroundPath], { ttlMs: 120000, now: 1000 })
    manager.purgeRetainedExcept([])
    expect(manager.isRetained(backgroundPath)).toBe(false)

    const quitPath = staged(manager)
    manager.retain([quitPath], { ttlMs: 120000, now: 1000 })
    manager.releaseAll()
    expect(manager.retainedFiles()).toHaveLength(0)
  })
})