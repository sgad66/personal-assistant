import { describe, expect, it } from 'vitest'
import { nextMenuIndex } from '@shared/menu-nav'

describe('菜单键盘导航', () => {
  it('向下循环、向上回绕', () => {
    expect(nextMenuIndex(2, 'ArrowDown', 3)).toBe(0)
    expect(nextMenuIndex(0, 'ArrowUp', 3)).toBe(2)
  })

  it('Home/End 到首尾', () => {
    expect(nextMenuIndex(1, 'Home', 3)).toBe(0)
    expect(nextMenuIndex(1, 'End', 3)).toBe(2)
  })

  it('Escape 与空菜单返回 -1', () => {
    expect(nextMenuIndex(1, 'Escape', 3)).toBe(-1)
    expect(nextMenuIndex(0, 'ArrowDown', 0)).toBe(-1)
  })

  it('越界与负数归一', () => {
    expect(nextMenuIndex(5, 'ArrowDown', 3)).toBe(0)
    expect(nextMenuIndex(-2, 'ArrowDown', 3)).toBe(0)
    expect(nextMenuIndex(-1, 'ArrowUp', 3)).toBe(0)
  })
})