import { describe, it, expect } from 'vitest'
import { newId, newIds, createIdGen, createSeqIdGen } from './id'

describe('newId', () => {
  it('用注入的 crypto（ADR-0006 铁律 2：不直接访问全局）', () => {
    expect(newId({ randomUUID: () => 'fake-uuid' })).toBe('fake-uuid')
  })

  it('默认取 globalThis.crypto，产出 UUID v4 形态', () => {
    const id = newId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('连续生成不重复（1000 个）', () => {
    const s = new Set(Array.from({ length: 1000 }, () => newId()))
    expect(s.size).toBe(1000)
  })

  it('环境不支持时抛错而不是静默返回坏 id', () => {
    expect(() => newId({} as { randomUUID(): string })).toThrow(/randomUUID/)
  })

  it('id 是字符串，可直接作 IndexedDB 主键', () => {
    expect(typeof newId()).toBe('string')
  })
})

describe('newIds', () => {
  it('批量生成互不重复', () => {
    const ids = newIds(50)
    expect(ids).toHaveLength(50)
    expect(new Set(ids).size).toBe(50)
  })

  it('0 个返回空数组', () => {
    expect(newIds(0)).toEqual([])
  })

  it('接受注入', () => {
    let n = 0
    expect(newIds(3, { randomUUID: () => `x${++n}` })).toEqual(['x1', 'x2', 'x3'])
  })
})

describe('createIdGen / createSeqIdGen', () => {
  it('createIdGen 每次产出新 id', () => {
    const g = createIdGen()
    expect(g.next()).not.toBe(g.next())
  })

  it('createSeqIdGen 是确定性的，供测试写出可断言的 id', () => {
    const g = createSeqIdGen()
    expect([g.next(), g.next(), g.next()]).toEqual(['id-1', 'id-2', 'id-3'])
  })

  it('createSeqIdGen 支持自定义前缀', () => {
    const g = createSeqIdGen('todo')
    expect(g.next()).toBe('todo-1')
  })
})
