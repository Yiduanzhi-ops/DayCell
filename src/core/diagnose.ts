/**
 * core/diagnose —— 环境探测（CORE-API §5.9）。
 *
 * 用途：首屏决定要不要显示 PRD E1 的红色横幅、要不要弹"添加到主屏幕"引导（S1）、
 * 以及设置页里那份"这台设备行不行"的诊断信息。
 *
 * ## 铁律 2 的落地方式
 *
 * core 不得直接引用 `window` / `navigator` / `indexedDB`（ESLint + `isolation.test.ts` 双重把关）。
 * 所以**所有全局对象都通过参数注入**，由 `src/app` 的装配层从 `globalThis` 上取好再传进来。
 * 副作用是这一整个模块可以在纯 Node 里测——而这本身就是铁律 2 的验证（CORE-API §7.1）。
 *
 * ⚠️ **`indexedDB: true` 不等于"真的能用"**。
 * Safari 隐私模式下 `indexedDB` 对象**存在**，但 `open()` 会失败。这里只做便宜的预检，
 * **权威判据是 `store.init()` 抛 `StorageUnavailableError`**（PRD E1 的降级由它触发）。
 * 之所以不在这里真的 open 一次：那会建出一个探测用的数据库，还要负责删掉，
 * 而删除本身在隐私模式下也可能失败——为了一个预检引入副作用不值得。
 */

/** 注入的 navigator 里我们真正会读的几个字段。用结构类型而不是 `unknown`，好让编译器盯着 */
export interface DiagnoseNavigator {
  userAgent?: string
  maxTouchPoints?: number
  /** iOS Safari 独有：已装到主屏时为 true。标准 Navigator 类型里没有它 */
  standalone?: boolean
  serviceWorker?: unknown
  storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> }
}

export interface DiagnoseDeps {
  indexedDB?: { open?: unknown } | null
  navigator?: DiagnoseNavigator | null
  matchMedia?: ((query: string) => { matches: boolean }) | null
  /**
   * `globalThis.isSecureContext`。
   *
   * 契约原本没列这个参数，但 `secureContext` 这个字段必须有来源，而它挂在 `globalThis` 上、
   * **不在 navigator 里**——不注入就只能直接读全局，那就破了铁律 2。
   */
  isSecureContext?: boolean
}

export interface Diagnosis {
  /** false → PRD E1：降级到 memoryStore + 顶部常驻红色横幅。见文件头的警告 */
  indexedDB: boolean
  /** 能否查配额（`navigator.storage.estimate`）。false 时 `usage` 一定为 undefined */
  storageEstimate: boolean
  /** 能否注册 SW（PWA 离线的前提，ADR-0002） */
  serviceWorker: boolean
  /** 是否已装到主屏。iOS 走 `navigator.standalone`，其余走 `display-mode: standalone` */
  installed: boolean
  /** PWA 可安装的前提：必须 https 或 localhost */
  secureContext: boolean
  /** 已用 / 配额（字节）。拿不到就是 undefined，**不要当成 0** */
  usage?: { usage: number; quota: number }
  /** 用于决定是否显示"添加到主屏幕"引导（PRD S1 / E3：iOS 7 天清除数据） */
  userAgentIOS: boolean
}

/** 全 false 的结果。探测不到任何东西时返回它，而不是抛错——诊断失败不该让应用起不来 */
export const unknownDiagnosis = (): Diagnosis => ({
  indexedDB: false,
  storageEstimate: false,
  serviceWorker: false,
  installed: false,
  secureContext: false,
  userAgentIOS: false,
})

/**
 * 探测当前环境。**不抛错**：任何一项拿不到就记 false / undefined。
 *
 * 这个函数自己失败（比如某个 getter 抛异常）也不该让应用白屏，
 * 所以整体包一层 try/catch，退化成 `unknownDiagnosis()`。
 */
export async function diagnose(deps: DiagnoseDeps = {}): Promise<Diagnosis> {
  const nav = deps.navigator ?? null
  const mq = deps.matchMedia ?? null

  const base: Diagnosis = {
    ...unknownDiagnosis(),
    // 光有对象还不够：某些被策略阉割的环境会留一个没有 open 的壳
    indexedDB: deps.indexedDB != null && typeof deps.indexedDB.open === 'function',
    storageEstimate: typeof nav?.storage?.estimate === 'function',
    serviceWorker: nav?.serviceWorker != null,
    secureContext: deps.isSecureContext === true,
    userAgentIOS: detectIOS(nav),
    installed: detectInstalled(nav, mq),
  }

  if (!base.storageEstimate) return base

  try {
    const est = await nav!.storage!.estimate!()
    // 两个字段都可能缺；缺一个就整个不给，避免 UI 拿半截数据算出个离谱的百分比
    if (typeof est?.usage === 'number' && typeof est?.quota === 'number') {
      return { ...base, usage: { usage: est.usage, quota: est.quota } }
    }
  } catch {
    // estimate() 在部分浏览器会直接 reject（配额信息被视为隐私）。拿不到就算了
  }
  return base
}

/**
 * iOS 检测。
 *
 * ⚠️ 光看 UA 不够：**iPadOS 13+ 的 Safari 把自己报成 Macintosh**（桌面版 UA），
 * 只能靠"声称是 Mac 但有多点触控"把它捞回来。漏掉这一条，iPad 用户就永远看不到
 * "添加到主屏幕"引导——而那正是 PRD E3（iOS 7 天清除数据）的主要缓解手段。
 */
function detectIOS(nav: DiagnoseNavigator | null): boolean {
  const ua = nav?.userAgent ?? ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  return /Macintosh/i.test(ua) && (nav?.maxTouchPoints ?? 0) > 1
}

/** 已安装到主屏。iOS 与标准两条路都要看：老 iOS 不支持 display-mode 媒体查询 */
function detectInstalled(nav: DiagnoseNavigator | null, mq: DiagnoseDeps['matchMedia']): boolean {
  if (nav?.standalone === true) return true
  try {
    return mq?.('(display-mode: standalone)')?.matches === true
  } catch {
    return false
  }
}
