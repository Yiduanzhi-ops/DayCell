/**
 * core/migrate —— 版本迁移（PRD §6.4 / CORE-API §5.7）。
 *
 * ## 三条硬约束
 *
 * 1. **迁移必须是纯函数**：输入一套记录表、输出一套新的，**不碰 store、不改入参**。
 *    理由不是洁癖——PRD §6.4 要求同一套迁移既能用于 `onupgradeneeded`，
 *    也能用于 US-10 的**导入旧备份**流程。一旦迁移函数里出现 store 调用，
 *    导入路径就没法复用它，就会长出第二份迁移逻辑然后各自漂移。
 * 2. **禁止"删库重建"**。每一步都是显式的记录变换。
 * 3. **失败即整体失败**：抛 `MigrationFailedError`，调用方负责回滚。
 *    本模块只保证"不改坏入参"，让调用方手里始终握着一份完好的原数据。
 *
 * ## 为什么每一步都深拷贝
 *
 * `applyMigrations` 在入口拷一次、每步 `up()` 之后再拷一次。看起来浪费，
 * 但迁移是**极低频、极高代价**的操作（跑一次几十毫秒，出错就是用户全部数据），
 * 而"某个迁移函数就地改了自己的入参"是这类代码最典型的 bug——
 * 它会让导入流程第 4 步的"当前库快照"失去意义（快照和正在改的数据是同一个对象）。
 * 用拷贝把这个可能性直接消掉，比写文档警告下一个人可靠。
 */

import { MigrationFailedError } from '../errors'
import { ALL_STORES, SCHEMA_VERSION, type RecordTable } from '../types'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface Migration {
  from: number
  to: number
  /**
   * 纯函数变换。
   *
   * ⚠️ 必须返回**完整的六个表**，缺一个就视为失败（`applyMigrations` 会检查）。
   * 不打算改动的表原样返回即可——但请返回新数组，不要返回入参里的那个引用。
   */
  up(records: RecordTable): RecordTable
}

// ---------------------------------------------------------------------------
// 迁移表
// ---------------------------------------------------------------------------

/**
 * 当前**没有**任何迁移：v1 是基线版本，全新安装直接建 v1 的库。
 *
 * 加新迁移时在这里追加 `{ from: 1, to: 2, up }`，并把 `types.ts` 的
 * `SCHEMA_VERSION` 改成 2。`assertChainComplete()` 会检查链条是否连通
 * （测试里跑，漏写一步就直接红）。
 *
 * CORE-API 目录结构里画的 `migrate/v1.ts` 因此**没有创建**——
 * 空文件比没有文件更容易让人误以为里面有东西。
 */
export const MIGRATIONS: readonly Migration[] = []

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const cloneRecord = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T)

/** `undefined` / 非数组都当空表：一份只含部分表的旧备份不该让迁移崩掉 */
const cloneArr = <T>(rows: T[] | undefined): T[] =>
  Array.isArray(rows) ? rows.map(cloneRecord) : []

/** 空的八表。导入 replace 模式与测试夹具都从这里起步 */
export function emptyTables(): RecordTable {
  return {
    todos: [],
    notes: [],
    expenses: [],
    anniversaries: [],
    categories: [],
    goals: [],
    stages: [],
    settings: [],
  }
}

/**
 * 深拷贝一整套表。
 *
 * 逐字段写而不是遍历 `ALL_STORES` + 索引赋值：后者要么用 `any`（等于关掉类型系统），
 * 要么用一堆断言。**备份/迁移恰恰是最需要类型系统兜底的地方**——
 * 写错一次就是用户的全部数据。多写四行换编译器盯着，值。
 */
function cloneTables(t: RecordTable | undefined): RecordTable {
  if (!t) return emptyTables()
  return {
    todos: cloneArr(t.todos),
    notes: cloneArr(t.notes),
    expenses: cloneArr(t.expenses),
    anniversaries: cloneArr(t.anniversaries),
    categories: cloneArr(t.categories),
    goals: cloneArr(t.goals),
    stages: cloneArr(t.stages),
    settings: cloneArr(t.settings),
  }
}

/**
 * 校验某个 `up()` 的返回值形状。
 *
 * 迁移函数几年才写一次、写完就没人再看，**缺一个表**这种错误不会当场炸，
 * 而是在很久之后表现为"某类数据莫名其妙没了"。这里花几行把它变成即时失败。
 */
function assertTable(m: Migration, t: unknown): asserts t is RecordTable {
  if (t === null || typeof t !== 'object') {
    throw new MigrationFailedError(`v${m.from} → v${m.to} 的 up() 没有返回记录表`)
  }
  const missing = ALL_STORES.filter((s) => !Array.isArray((t as RecordTable)[s]))
  if (missing.length > 0) {
    throw new MigrationFailedError(
      `v${m.from} → v${m.to} 的 up() 返回值缺少这些表：${missing.join(', ')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// 迁移器
// ---------------------------------------------------------------------------

export interface Migrator {
  /** 算出 from → to 的迁移链。@throws MigrationFailedError */
  path(from: number, to: number): Migration[]
  /** 执行迁移。**纯函数**：入参不会被改动。@throws MigrationFailedError */
  apply(records: RecordTable, from: number, to: number): RecordTable
  /** 自检：能否从 v1 一路走到 targetVersion。@throws MigrationFailedError */
  assertChainComplete(targetVersion?: number): void
}

/**
 * 用一组迁移构造迁移器。
 *
 * 做成工厂而不是模块级单例，是为了**能测**：真实的 `MIGRATIONS` 现在是空的
 * （v1 是基线），如果链条逻辑只能跑真实那张表，"多步迁移""链条断裂""环"
 * 这些分支就永远测不到，只能等到真的加第二个版本时才发现写错了。
 * 注入合成迁移表 = 现在就能把机器本身测透。
 *
 * 构造时就做合法性检查，**炸在启动时而不是用户升级时**。
 */
export function createMigrator(migrations: readonly Migration[]): Migrator {
  const byFrom = new Map<number, Migration>()
  for (const m of migrations) {
    const dup = byFrom.get(m.from)
    if (dup) {
      throw new MigrationFailedError(
        `迁移表里 v${m.from} 有两条出路（→ v${dup.to} 和 → v${m.to}），链条不确定`,
      )
    }
    if (m.to <= m.from) {
      throw new MigrationFailedError(`迁移 v${m.from} → v${m.to} 不是升级（to 必须大于 from）`)
    }
    byFrom.set(m.from, m)
  }

  function path(from: number, to: number): Migration[] {
    if (!Number.isInteger(from) || from < 1) {
      throw new MigrationFailedError(`版本号非法（from=${String(from)}）`)
    }
    if (!Number.isInteger(to) || to < 1) {
      throw new MigrationFailedError(`版本号非法（to=${String(to)}）`)
    }
    if (from === to) return []
    if (from > to) {
      // 降级不支持：新版本写的数据可能含有旧代码读不懂的字段，
      // 静默"迁回去"等于丢数据。备份导入的 VERSION_TOO_NEW（PRD E18）在 backup 层先挡。
      throw new MigrationFailedError(`不支持降级：数据是 v${from}，当前应用只到 v${to}`)
    }

    const out: Migration[] = []
    let cur = from
    // 不需要环保护：构造时已强制 `to > from`，所以每一步 cur 严格递增，
    // 循环最多走 (to - from) 次就一定终止。**用不变量代替对不可能情况的防御**——
    // 一个永远走不到的 catch 分支既测不到，也会让读代码的人以为这里真有风险。
    while (cur < to) {
      const m = byFrom.get(cur)
      if (!m) {
        throw new MigrationFailedError(`缺少从 v${cur} 出发的迁移步骤，无法升到 v${to}`)
      }
      out.push(m)
      cur = m.to
    }
    if (cur !== to) {
      throw new MigrationFailedError(
        `迁移链越过了目标版本：从 v${from} 走到了 v${cur}，要的是 v${to}`,
      )
    }
    return out
  }

  return {
    path,

    apply(records, from, to) {
      let cur = cloneTables(records)
      for (const m of path(from, to)) {
        let next: unknown
        try {
          next = m.up(cur)
        } catch (e) {
          throw new MigrationFailedError(`v${m.from} → v${m.to} 迁移执行失败`, e)
        }
        // assertTable 抛的已经是 MigrationFailedError，不再包一层
        assertTable(m, next)
        // 每步之后再拷一次：即使 up() 就地改了它拿到的对象，下一步看到的也是干净副本
        cur = cloneTables(next)
      }
      return cur
    },

    assertChainComplete(targetVersion = SCHEMA_VERSION) {
      path(1, targetVersion)
    },
  }
}

// ---------------------------------------------------------------------------
// 默认实例：绑定真实的 MIGRATIONS
// ---------------------------------------------------------------------------

const defaultMigrator = createMigrator(MIGRATIONS)

/** 真实迁移表上的 `path`。签名与语义见 `Migrator.path` */
export const migrationPath: Migrator['path'] = (from, to) => defaultMigrator.path(from, to)

/** 真实迁移表上的 `apply`。**纯函数**，入参不会被改动 */
export const applyMigrations: Migrator['apply'] = (records, from, to) =>
  defaultMigrator.apply(records, from, to)

/**
 * 自检：真实迁移链能否从 v1 一路走到当前 `SCHEMA_VERSION`。
 *
 * 给测试与 CI 用。加了迁移却漏写中间某一步时，**开发机上不会炸**
 * （开发机的库已经是新版本了），只会在用户升级时炸——所以这条必须主动跑。
 */
export function assertChainComplete(): void {
  defaultMigrator.assertChainComplete()
}

