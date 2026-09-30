/**
 * id 生成（CORE-API §5.1）。
 *
 * 用 crypto.randomUUID()：全局唯一、无需服务端、零依赖。
 * 不用 uuid 包（多一个依赖），不用 v7（排序不依赖 id，每条记录都有 createdAt）。
 *
 * `crypto` 通过参数注入，以满足 ADR-0006 铁律 2（core 不直接访问全局）。
 */

export interface RandomUuid {
  randomUUID(): string
}

/**
 * 生成一个记录 id。
 *
 * @param impl 注入的 crypto；默认取 globalThis.crypto（Node 19+ 与所有目标浏览器都有）
 * @throws 当环境不提供 randomUUID 时抛错——此时应降级到内存存储并警告用户（PRD E1）
 */
export function newId(impl?: RandomUuid): string {
  const c = impl ?? globalThis.crypto
  if (!c || typeof c.randomUUID !== 'function') {
    throw new Error('当前环境不支持 crypto.randomUUID()')
  }
  return c.randomUUID()
}

/**
 * 生成一组互不重复的 id。
 *
 * 批量导入/顺延时用，避免逐条调用带来的重复实现。
 */
export function newIds(count: number, impl?: RandomUuid): string[] {
  return Array.from({ length: count }, () => newId(impl))
}

/**
 * 可注入的 id 生成器，供 repo 层持有（CORE-API §5.5 的 Repo deps）。
 * 测试里传一个自增 fake，断言就能写出确定性的 id。
 */
export interface IdGen {
  next(): string
}

export function createIdGen(impl?: RandomUuid): IdGen {
  return { next: () => newId(impl) }
}

/** 测试专用：产生 id-1、id-2、… 的确定性生成器 */
export function createSeqIdGen(prefix = 'id'): IdGen {
  let n = 0
  return { next: () => `${prefix}-${++n}` }
}
