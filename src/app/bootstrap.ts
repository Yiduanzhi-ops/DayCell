/**
 * 装配层：把 core 的存储 / 领域 / 聚合接成一个 UI 可直接使用的 bundle。
 *
 * 这里是**全应用唯一**触碰浏览器全局（indexedDB / navigator / matchMedia）的入口——
 * core 铁律 2 要求这些全部注入，注入点就在这（ADR-0006）。
 *
 * 降级链（PRD E1/E4）：
 *  - IndexedDB 打开失败 → memory store + `degraded: true`（UI 显示红色横幅）
 *  - 农历库加载失败    → `lunar: null`（UI 只显示公历，绝不白屏、不抛错）
 */
import {
  createAggregates,
  createIdbStore,
  createMemoryStore,
  createRepos,
  diagnose,
  loadLunar,
  type Aggregates,
  type Diagnosis,
  type LunarApi,
  type RecordStore,
  type Repos,
} from '@core'

export interface CoreBundle {
  store: RecordStore
  repos: Repos
  aggregates: Aggregates
  /** IndexedDB 不可用 → 已降级到内存存储（数据刷新即丢），UI 必须显示红色横幅 */
  degraded: boolean
  /** 农历库重试后仍加载失败：公历照常，农历/节气/节日标签留空（PRD E4） */
  lunarFailed: boolean
  diag: Diagnosis
}

export interface InitCoreOptions {
  /** 测试用：直接注入 store（如 createMemoryStore()），跳过环境探测与 IndexedDB */
  store?: RecordStore
  /** 测试用：跳过农历库动态加载（按失败处理，走公历降级路径） */
  skipLunar?: boolean
  /**
   * v8.1：在 store.init() 之后、createRepos/createAggregates **之前**包装 store，
   * 让 repo 全部写操作都经过包装层（云同步的"写后触发推送"挂在这里）。
   * 包装后的 store 成为 bundle.store / repos / aggregates 共同使用的实例。
   */
  wrapStore?: (s: RecordStore) => RecordStore
}

export async function initCore(opts: InitCoreOptions = {}): Promise<CoreBundle> {
  const mq =
    typeof globalThis.matchMedia === 'function'
      ? (q: string) => globalThis.matchMedia(q)
      : null

  const diag = await diagnose({
    indexedDB: globalThis.indexedDB ?? null,
    navigator: globalThis.navigator ?? null,
    matchMedia: mq,
    isSecureContext: globalThis.isSecureContext === true,
  })

  let store = opts.store
  let degraded = false
  if (!store) {
    if (diag.indexedDB) {
      try {
        // createIdbStore 打开失败会抛 StorageUnavailableError（Safari 隐私模式等）
        store = await createIdbStore({ indexedDB: globalThis.indexedDB })
      } catch {
        degraded = true
      }
    } else {
      degraded = true
    }
    store ??= createMemoryStore()
  }
  await store.init()
  if (opts.wrapStore) store = opts.wrapStore(store)

  const repos = createRepos({ store })
  // 幂等：已有分类时不动。首次启动播种 8 个默认分类（PRD D12）
  await repos.categories.seedDefaults()

  let lunar: LunarApi | null = null
  if (!opts.skipLunar) {
    // loadLunar 内部已重试 1 次；再失败就按 E4 降级，**不抛**
    lunar = await loadLunar().catch(() => null)
  }

  return {
    store,
    repos,
    aggregates: createAggregates({ store, repos, lunar }),
    degraded,
    lunarFailed: lunar === null,
    diag,
  }
}
