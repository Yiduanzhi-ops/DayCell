/**
 * app/sync —— 云同步的"浏览器侧接线"（v8.1 坚果云同步）。
 *
 * 职责（**唯一允许碰 localStorage / 写后触发**的层）：
 *  - 同步配置（WebDAV 地址 / 账号 / 应用密码）读写 localStorage
 *    —— 刻意不进 IndexedDB、不进备份文件：密码不随备份到处走；
 *    丢失只影响"自动同步"，数据本体在本地库 + 云端，重填三个值即可恢复
 *  - wrapStoreForSync：包装 RecordStore 的三个写入口，写成功后触发
 *    engine.schedulePush()（core 的 repo 全部经此写库，一处包装全覆盖）
 *
 * core 隔离：本文件在 app 层，允许 DOM；core 层绝不 import 这里。
 */

import type { RecordStore } from '@core'
import type { SyncEngine, WebDavConfig } from '@core'

const SYNC_KEY = 'daycell-sync'

/** 读同步配置；未配置 / 损坏 → null（损坏时顺带清掉，避免反复报错） */
export function readSyncConfig(): WebDavConfig | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(SYNC_KEY)
  if (!raw) return null
  try {
    const cfg = JSON.parse(raw) as Partial<WebDavConfig>
    if (typeof cfg.url === 'string' && typeof cfg.user === 'string' && typeof cfg.pass === 'string') {
      return { url: cfg.url, user: cfg.user, pass: cfg.pass }
    }
  } catch {
    // fallthrough
  }
  try {
    localStorage.removeItem(SYNC_KEY)
  } catch {
    // 隐私模式等写入失败，忽略
  }
  return null
}

export function writeSyncConfig(cfg: WebDavConfig): void {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify(cfg))
  } catch {
    // 隐私模式等写入失败：本次会话仍生效，只是不持久
  }
}

/** 包装 store：put / putMany / putSetting 写成功后触发防抖推送。
 *  逐方法 bind 包装（不用 ...store 展开——memory/idb 的方法可能依赖闭包 this） */
export function wrapStoreForSync(
  store: RecordStore,
  getEngine: () => SyncEngine | null,
): RecordStore {
  const wrap = <A extends unknown[], R>(
    fn: (...args: A) => Promise<R>,
  ): ((...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const r = await fn(...args)
      getEngine()?.schedulePush()
      return r
    }

  const b = <F extends keyof RecordStore>(k: F): RecordStore[F] => store[k].bind(store) as RecordStore[F]

  return {
    init: b('init'),
    put: wrap(b('put')),
    putMany: wrap(b('putMany')),
    get: b('get'),
    byDate: b('byDate'),
    byDateAll: b('byDateAll'),
    byUpdatedSince: b('byUpdatedSince'),
    all: b('all'),
    tx: b('tx'),
    getSetting: b('getSetting'),
    putSetting: wrap(b('putSetting')),
    allSettings: b('allSettings'),
    estimateUsage: b('estimateUsage'),
    clearAll: b('clearAll'),
    close: b('close'),
  }
}
