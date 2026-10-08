# DayCell core 层接口契约（CORE-API）v1.0

| 项 | 内容 |
|---|---|
| 文档状态 | 待评审 |
| 约束对象 | `src/core/**` |
| 上游 | `docs/PRD.md`（数据类型见 §6，边界异常见 §7） |
| 相关 ADR | 0001 存储 · 0003 金额 · 0004 农历 · 0006 core 隔离 · 0008 日期 |

**这份文档是什么**：core 层暴露给 UI 层的**唯一**契约。UI 只能通过这里的签名访问数据，不得绕过。

**为什么先写它**：这条边界同时是两个未来能力的接缝——
- 换云存储时，只换 `RecordStore` 的实现，repo 以上全部不动（PRD Q5）
- 出微信小程序时，只重写 UI，core 整体复用（SPEC §2 小程序可能性）

**边界写错了，这两条路都要重写存储层。**

---

## 1. 范围与铁律

### 1.1 core 里有什么

| 模块 | 职责 |
|---|---|
| `core/id` | 生成全局唯一 id |
| `core/date` | 纯日期运算（无 Date 时区陷阱） |
| `core/lunar` | 农历 / 节气 / 节日 / 农历纪念日换算（异步加载） |
| `core/label` | 格子单行标签的优先级规则 |
| `core/store` | 存储抽象接口 + 两个实现（IndexedDB / 内存） |
| `core/repo` | 领域操作（todos / notes / expenses / anniversaries / categories / settings） |
| `core/aggregate` | 日 / 周 / 月三级汇总，供视图直接消费 |
| `core/migrate` | 版本迁移（纯函数） |
| `core/backup` | 导出 Markdown / CSV / JSON，导入与校验 |
| `core/sync` | 云同步：WebDAV 客户端 / id 级 LWW 合并 / 同步引擎（v8.1，ADR-0009） |
| `core/validate` | 纯校验函数（金额、文本长度、日期）。**38 个测试** |
| `core/clock` | **唯一**允许调用 `Date.now()` 的地方（铁律 3 的落地手段） |
| `core/errors` | `DayCellError` 及其子类（见 §2.2） |
| `core/types` | 记录类型与 `DateKey`（见 §3） |
| `core/diagnose` | 环境探测（IndexedDB 可用性、配额、是否已安装） |

### 1.2 三条铁律（必须用 ESLint 强制，不能靠自觉）

1. **禁止 `import` React、任何 UI 库、任何 CSS**
2. **禁止访问 `window` / `document` / `localStorage` / `navigator`**
   —— 唯一例外：`core/store/idb.ts` 需要 `indexedDB`，`core/diagnose.ts` 需要探测能力。这两个文件必须通过**注入**拿到全局对象，不得直接引用（见 §5.1）
3. **禁止 `Date.now()` 之外的隐式当前时间**
   —— 需要"今天"的函数一律显式接收 `today: DateKey` 参数，便于测试与复现

**验证手段**（两道，缺一不可）：
- ESLint `no-restricted-imports` + `no-restricted-globals` 规则，CI 阻断
- 一个单元测试在**纯 Node 环境**（无 jsdom）里 `import` 全部 core 模块，能加载成功即通过

### 1.3 依赖白名单

core 只允许依赖：`idb`、`lunar-typescript`（动态 import）。
**不允许**：`dayjs`、`lodash`、`uuid`、任何 UI 库。见 ADR-0007 / ADR-0008。

---

## 2. 错误约定

**两套约定，按函数是否有副作用划分**——这条规则本身是契约的一部分，不得随意混用：

| 函数类型 | 约定 | 理由 |
|---|---|---|
| **纯校验函数**（`core/validate`） | 返回 `ParseResult<T>` | 每次按键都会调用，失败是**预期路径**，不该用异常 |
| **有副作用的异步操作**（repo / store / backup） | **throw** `DayCellError` 子类 | 失败是**异常路径**，UI 需要统一兜底 |

### 2.1 ParseResult

```ts
type ParseResult<T> =
  | { ok: true;  value: T }
  | { ok: false; code: ValidateCode; message: string };

type ValidateCode =
  | 'EMPTY'            // 空或纯空白
  | 'TOO_LONG'         // 超出长度上限
  | 'NOT_A_NUMBER'     // 金额非数字
  | 'NOT_POSITIVE'     // 金额 ≤ 0
  | 'TOO_LARGE'        // 金额超出安全整数（PRD E7）
  | 'BAD_DATE'         // 日期格式非法
  | 'BAD_BACKUP'       // 备份文件结构非法
  | 'VERSION_TOO_NEW'; // 备份 schemaVersion 高于当前应用
```

`message` 是**可直接展示给用户的中文文案**。UI 不得自行拼接错误提示。

### 2.2 DayCellError

```ts
abstract class DayCellError extends Error {
  abstract readonly code: ErrorCode;
  readonly cause?: unknown;
}

type ErrorCode =
  | 'STORAGE_UNAVAILABLE'  // IndexedDB 不可用 → PRD E1，UI 显示红色横幅并降级到 memoryStore
  | 'QUOTA_EXCEEDED'       // PRD E2，写入失败但**必须保留用户输入**
  | 'MIGRATION_FAILED'     // PRD §6.4，事务已回滚，旧数据完好
  | 'LUNAR_UNAVAILABLE'    // PRD E4，重试 1 次后仍失败 → UI 只显示公历
  | 'BACKUP_CORRUPT'       // PRD E17，一条都没写入
  | 'NOT_FOUND'            // 记录不存在（可能已被其他标签页删除）
  | 'TX_ABORTED';          // 事务中止

class StorageUnavailableError extends DayCellError { readonly code = 'STORAGE_UNAVAILABLE' }
class QuotaExceededError      extends DayCellError { readonly code = 'QUOTA_EXCEEDED' }
class MigrationFailedError    extends DayCellError { readonly code = 'MIGRATION_FAILED' }
class LunarUnavailableError   extends DayCellError { readonly code = 'LUNAR_UNAVAILABLE' }
class BackupCorruptError      extends DayCellError { readonly code = 'BACKUP_CORRUPT' }
class NotFoundError           extends DayCellError { readonly code = 'NOT_FOUND' }
class TxAbortedError          extends DayCellError { readonly code = 'TX_ABORTED' }
```

**UI 层的统一处理**：只 `catch (e instanceof DayCellError)`，按 `code` 分支；未知错误一律记日志并显示通用兜底文案，不得白屏。

---

## 3. 数据类型

**完整定义见 `docs/PRD.md` §6.2，此处不重复。** core 只补充两个派生类型：

```ts
/** 所有内容记录的联合类型 */
type DatedRecord = TodoRecord | NoteRecord | ExpenseRecord;

/** 六个 store 的名字；settings 的主键是 key 而非 id */
type StoreName = 'todos' | 'notes' | 'expenses' | 'anniversaries' | 'categories' | 'settings';

interface CoreRecord { id: string; createdAt: number; updatedAt: number; deleted: boolean }
```

**日期键类型**（贯穿全库，见 ADR-0008）：

```ts
/** 'YYYY-MM-DD'，浏览器本地时区。用 branded type 防止误传任意字符串 */
type DateKey = string & { readonly __brand: 'DateKey' };
```

---

## 4. 存储抽象：`RecordStore`

```ts
interface RecordStore {
  /** 打开或升级数据库。失败抛 StorageUnavailableError / MigrationFailedError */
  init(): Promise<void>;

  /** 写入或更新。必须自动刷新 updatedAt；这是唯一的写入口 */
  put<T extends CoreRecord>(store: StoreName, rec: T): Promise<T>;

  /** 批量写入，单事务。用于顺延、导入 */
  putMany<T extends CoreRecord>(store: StoreName, recs: T[]): Promise<T[]>;

  get<T extends CoreRecord>(store: StoreName, id: string): Promise<T | undefined>;

  /** 按日期范围（含端点）查询，结果按 date 升序、同日按 createdAt 升序。
   *  ⚠️ 必须走 byDate 索引；实现里出现全表扫描即视为 bug */
  byDate<T extends DatedRecord>(store: StoreName, from: DateKey, to: DateKey): Promise<T[]>;

  /** 一次拿三个内容 store 的日期范围数据，供月视图使用。
   *  实现应在**同一个只读事务**里发三个请求 */
  byDateAll(from: DateKey, to: DateKey): Promise<{
    todos: TodoRecord[]; notes: NoteRecord[]; expenses: ExpenseRecord[];
  }>;

  /** 为云同步预留：按 updatedAt 增量拉取（PRD §6.3 的 byUpdated 索引） */
  byUpdatedSince<T extends CoreRecord>(store: StoreName, since: number): Promise<T[]>;

  all<T extends CoreRecord>(store: StoreName): Promise<T[]>;   // 仅 anniversaries / categories / settings 可用

  /**
   * 事务包装。fn 内抛错则整体回滚。
   *
   * ⚠️ **fn 必须使用回调传入的 `scope`，不能用外层的 store 对象。**
   * IndexedDB 的原子性来自"所有请求挂在同一个 IDBTransaction 上"；若 fn 里用外层 store，
   * 每个操作会各自开新事务，回滚形同虚设。
   *
   * 原签名是 `fn: () => Promise<R>`，**实现时发现无法保证原子性，故改为传入 scope**。
   * 内存实现把 store 自身作为 scope 传入（它靠快照回滚，等价）。
   */
  tx<R>(fn: (scope: RecordStore) => Promise<R>): Promise<R>;

  estimateUsage(): Promise<{ usage: number; quota: number }>;

  /** 仅供测试与设置里的"清空全部数据"。生产代码路径不得调用 */
  clearAll(): Promise<void>;
}
```

### 4.1 接口里**故意没有** `remove`

删除只能通过 `put({...rec, deleted: true})` 完成。这是 PRD §6.1 规则 2（软删除/墓碑）的**结构性强制**——不是靠约定，而是接口里根本没有物理删除的入口。

### 4.2 两个实现

```ts
/** 生产实现。globals 注入而非直接引用 window，以满足 §1.2 铁律 2 */
function createIdbStore(deps: {
  indexedDB: IDBFactory;
  dbName?: string;        // 默认 'daycell'
  version?: number;       // 默认 1
  migrations?: Migration[];
}): RecordStore;

/** 测试实现 + PRD E1 降级实现（IndexedDB 不可用时） */
function createMemoryStore(): RecordStore;
```

`createMemoryStore` 必须**逐条通过同一套 store 契约测试**（同一份测试用例跑两个实现），否则降级路径不可信。

### 4.3 读取一律排除墓碑

所有 `byDate` / `byDateAll` / `byUpdatedSince` 的返回值**已过滤 `deleted === true`**。
需要墓碑的场景（导出整库、同步）走 `all()` 或 `byUpdatedSince(store, 0, { includeDeleted: true })`。

```ts
byUpdatedSince<T extends CoreRecord>(
  store: StoreName, since: number, opts?: { includeDeleted?: boolean }
): Promise<T[]>;
```

---

## 5. 各模块接口

### 5.1 `core/id`

```ts
/** crypto.randomUUID()。crypto 通过参数注入以满足铁律 2 */
function newId(crypto?: { randomUUID(): string }): string;
```

不用 `uuid` 包（多一个依赖），不用 v7（排序不依赖 id，每条记录都有 `createdAt`）。

### 5.2 `core/date`

```ts
function today(now?: Date): DateKey;                 // 默认 new Date()，测试可注入
function isValidKey(s: string): s is DateKey;
function toKey(y: number, m: number, d: number): DateKey;   // m 是 1–12，不是 0–11
function fromKey(k: DateKey): { y: number; m: number; d: number };

function addDays(k: DateKey, n: number): DateKey;
function addMonths(k: DateKey, n: number): DateKey;  // 1/31 + 1月 → 2/28，夹取不溢出
function daysBetween(a: DateKey, b: DateKey): number; // b - a，可为负
function compareKey(a: DateKey, b: DateKey): -1 | 0 | 1;

function dowOf(k: DateKey): 0 | 1 | 2 | 3 | 4 | 5 | 6;              // 0=周日
function startOfWeek(k: DateKey, weekStartsOn?: 1 | 0): DateKey;    // 默认 1（周一，PRD D1）
function weekKeys(k: DateKey, weekStartsOn?: 1 | 0): DateKey[];     // 恒 7 个
function monthGrid(k: DateKey, weekStartsOn?: 1 | 0): DateKey[];    // **恒 42 个**（PRD D2）
function monthKeys(k: DateKey): DateKey[];                          // 仅本月实际天数
function isSameMonth(a: DateKey, b: DateKey): boolean;
```

**实现陷阱（必须写进测试）**：
- ❌ `new Date('2026-09-29')` → 解析为 **UTC 零点**，在 UTC−5 时区会变成前一天
- ✅ `new Date(2026, 8, 29)` → 本地时区，正确
- 所有函数内部只允许用后者。`toKey` / `fromKey` 是唯一与 `Date` 打交道的地方

详见 ADR-0008。

### 5.3 `core/lunar`（异步）

```ts
interface LunarInfo {
  lunarDay: string;     // '十九'、'初一'、'廿九'
  /**
   * 农历月中文名，不含「月」字，**闰月自带「闰」前缀**：普通月 '八'，闰六月 '闰六'。
   * 这是库 `getMonthInChinese()` 的原样输出——展示层直接拼 `${lunarMonth}月`，
   * **不要再自己加「闰」**，否则会变成「闰闰六月」（实现时踩到过）。
   */
  lunarMonth: string;
  isLeapMonth: boolean; // 仅供逻辑判断（纪念日换算），展示用 lunarMonth
  festival?: string;    // '中秋节'（已过白名单，PRD D15）
  solarTerm?: string;   // '白露'；非节气日为 undefined 而非空串
}

/** 纪念日换算结果。三个字段分别对应 PRD E14 / E13 / E25 */
interface AnniversaryResolution {
  key: DateKey | null;        // null = 超出支持范围，标签位留空
  usedFallbackMonth: boolean; // 该年无此闰月，已按正月号计
  usedFallbackDay: boolean;   // 该月无三十日（或公历 2/29 → 2/28）
}

interface LunarApi {
  /** 超出支持范围或库内部抛错时返回 **null**（PRD E4/E14），不抛 */
  lunarOf(k: DateKey): LunarInfo | null;
  /** 农历纪念日 → 指定年份的公历日。闰月见 E13，三十见 E25 */
  lunarAnniversary(lunarDate: string, year: number, isLeapMonth?: boolean): AnniversaryResolution;
  supportedRange(): { from: DateKey; to: DateKey };   // 1900-01-01 ~ 2100-12-31
}

/** 动态 import lunar-typescript。失败自动重试 1 次，仍失败抛 LunarUnavailableError（PRD E4） */
function loadLunar(opts?: LoadLunarOptions): Promise<LunarApi>;

// ── 不依赖库的纯函数，农历加载失败时也能用 ──
function supportedRangeCheck(): { from: DateKey; to: DateKey };
const inLunarRange: (year: number) => boolean;
/** 公历纪念日 → 指定年份的公历日。2/29 在平年记 2/28 并置 usedFallbackDay */
function resolveSolarAnniversary(isoDate: string, year: number): AnniversaryResolution;
/** 节日白名单过滤（PRD D15）。用关键词 includes，因为库返回「国庆节」「元旦节」这类带后缀的名字 */
function pickFestival(names: readonly string[]): string | undefined;
```

**为什么整个模块是异步的**：`lunar-typescript` ≈ 80 KB，必须代码分割（ADR-0004）。UI 在启动时调一次 `loadLunar()`，拿到 api 后同步使用；抛错则只渲染公历，标签位留空，**不白屏、不报错弹窗**。

#### 实现时对本节的修订（均已实测验证）

| 原契约 | 改成 | 原因 |
|---|---|---|
| `lunarOf(): LunarInfo` | `LunarInfo \| null` | 库对 1899/2101 **不抛错**而是返回不可信结果，只能由我们判范围并返回 null（PRD E14） |
| `lunarAnniversaryDate(date, year)` | `lunarAnniversary(date, year, isLeapMonth?)` | 原签名无法表达闰月生日；且实测发现**三十日在 29 天的月份会抛错**，需要 `usedFallbackDay`（新增 PRD E25） |
| `solarAnniversaryDate` 挂在 `LunarApi` 上 | 独立纯函数 `resolveSolarAnniversary` | 公历纪念日是纯日期运算，**不该依赖 80 KB 的农历库**；挂上去会导致农历加载失败时公历纪念日也显示不出来（违背 PRD E4） |
| `lunarMonthText?`（仅初一给值） | `lunarMonth`（恒有值） | "初一才显示月份"是**展示规则**，属于 `core/label`，不该塞进数据类型 |
| `isFestival` / `rawLunarDay` | 删除 | `rawLunarDay` 与 `lunarDayText` 完全重复；`isFestival` 等价于 `festival !== undefined \|\| lunarDay === '初一'`，调用方自己判即可 |

### 5.4 `core/label`

```ts
type LabelKind =
  | 'anniversary' | 'festival' | 'solarTerm'
  | 'lunarMonth'   // 初一：显示月份名（PRD D14）
  | 'lunarDay'     // 普通农历日
  | 'none';       // 农历不可用 → 标签位留空（PRD E4）

interface CellLabel {
  text: string;
  kind: LabelKind;
  emphasis: boolean;  // 是否用强调色。只有 lunarDay 为 false，其余为 true
  extra?: number;     // 同一天还有几个纪念日没显示（text 只放第一个）；仅 >1 时出现
}

/** 实现 PRD US-07 的优先级：纪念日 > 节日 > 节气 > 农历月初一 > 农历日
 *  纯函数，不查库、不查农历库——两个入参都由调用方给 */
function cellLabel(lunar: LunarInfo | null, anniversaries?: readonly string[]): CellLabel;

/** 日详情用：不做取舍，能拼的都拼上，如「中秋节 · 八月十五」。农历不可用返回空串 */
function lunarFullText(lunar: LunarInfo | null): string;
```

#### 实现时对本节的修订

| 原契约 | 改成 | 原因 |
|---|---|---|
| `kind: 'term' \| 'lunar'` | `'solarTerm' \| 'lunarMonth' \| 'lunarDay'` | 初一显示月份名、普通日显示日名，**两者的强调色不同**（D14），合成一个 `'lunar'` 会让 UI 再判一次 `lunarDay === '初一'`，把展示规则漏到 UI 层 |
| `lunarSuffix?: string` | 删除，改为 `emphasis: boolean` | 后缀是给 UI 拼字符串用的，等于让 UI 参与文案组装；`emphasis` 直接给出"要不要强调"这个唯一需要的结论 |
| — | 新增 `extra?: number` | 同一天可以有多个纪念日（生日 + 体检），原契约无法表达"还有 N 个" |
| `cellLabel(k, lunar, titles)` | `cellLabel(lunar, anniversaries?)` | 这个函数**用不到日期**（优先级判断只看 lunar 与纪念日标题）。留着 `k` 会让调用方误以为它会做日期运算 |
| `detailLabel(k, lunar, titles) → {primary, secondary}` | `lunarFullText(lunar) → string` | 详情页的「中秋节 · 八月十五」是**一行文本**，没有主次样式差异；返回结构体是让调用方再拼一次。纪念日标题在详情页有独立区块，不需要混进这行 |

**此模块不得出现任何倒数逻辑**（PRD US-07：任何日期都不得显示"X 天后"）。

### 5.5 `core/repo`

```ts
/* ---- 通用 ---- */
interface Repo<Deps> {
  /** deps 注入 store、id 生成器、时钟，全部可替换以便测试 */
  store: RecordStore;
  newId(): string;
  now(): number;
}

/* ---- 待办 ---- */
interface TodoRepo {
  byDate(date: DateKey): Promise<TodoRecord[]>;                    // 排除墓碑，按 createdAt 升序
  create(date: DateKey, text: string): Promise<TodoRecord>;        // 先 validate，失败返回 ParseResult 错误
  setText(id: string, text: string): Promise<TodoRecord>;          // 不存在抛 NotFoundError
  toggle(id: string): Promise<TodoRecord>;                         // 同时维护 doneAt
  softDelete(id: string): Promise<void>;

  /** 顺延（PRD US-04）。单事务。已 rolledTo 的跳过（PRD E11） */
  rollOver(from: DateKey, to: DateKey): Promise<{
    moved: TodoRecord[];        // 目标日新增的
    skipped: number;            // 已顺延过、跳过的条数
  }>;
  /** 是否有可顺延项，用于决定是否显示横幅（PRD E10：无则不显示） */
  rollableCount(date: DateKey): Promise<number>;
}

/** 纯函数：待办进度。**排除 rolledTo 的记录**（PRD US-04） */
function todoProgress(recs: TodoRecord[]): { done: number; total: number };

/* ---- 想法 ---- */
interface NoteRepo {
  byDate(date: DateKey): Promise<NoteRecord[]>;
  create(date: DateKey, text: string): Promise<NoteRecord>;
  setText(id: string, text: string): Promise<NoteRecord>;
  softDelete(id: string): Promise<void>;
}

/* ---- 花费 ---- */
interface ExpenseRepo {
  byDate(date: DateKey): Promise<ExpenseRecord[]>;
  create(date: DateKey, input: { amountCents: number; catId: string; note: string }): Promise<ExpenseRecord>;
  update(id: string, patch: Partial<Pick<ExpenseRecord, 'amountCents' | 'catId' | 'note'>>): Promise<ExpenseRecord>;
  softDelete(id: string): Promise<void>;
}

/* ---- 纪念日 ---- */
interface AnniversaryRepo {
  all(): Promise<AnniversaryRecord[]>;
  /** 指定月份内所有命中的纪念日 → { dateKey: [title, ...] }，供月/周视图一次取完 */
  byMonth(month: string): Promise<Map<DateKey, string[]>>;
  create(input: { title: string; date: string; isLunar: boolean; repeat: 'none' | 'yearly' }): Promise<AnniversaryRecord>;
  softDelete(id: string): Promise<void>;
}

/* ---- 分类 ---- */
interface CategoryRepo {
  all(): Promise<CategoryRecord[]>;          // 按 order 升序
  create(name: string): Promise<CategoryRecord>;
  rename(id: string, name: string): Promise<CategoryRecord>;
  reorder(ids: string[]): Promise<void>;
  softDelete(id: string): Promise<void>;     // 历史支出保留 catId，见 PRD E21
  /** 解析 catId → 显示名；已删除或不存在返回 '已删除分类' */
  resolveName(id: string): Promise<string>;
}

/* ---- 设置 ---- */
interface SettingRepo {
  get<T>(key: SettingKey, fallback: T): Promise<T>;
  set<T>(key: SettingKey, value: T): Promise<void>;
}
type SettingKey = 'accentColor' | 'lastBackupAt' | 'backupReminderOff' | 'onboarded' | 'weekStartsOn';
```

#### 实现时对本节的修订

1. **`AnniversaryRepo.byMonth(month)` 没有实现**，改为在 `aggregate` 里做区间解析。
   理由：把纪念日解析成公历日期**需要农历 API**，而 repo 一直是"存储 + 校验"层、不依赖 lunar；
   aggregate 本来就依赖 lunar（`DayAggregate.label` 要 `cellLabel(lunar, …)`），放它那里依赖图更干净。
   另外 `byMonth` 只覆盖一个月，而月视图是 **42 格**（含邻月补齐日），按 month 开口反而不够用。
2. **新增 `CategoryRepo.nameMap(): Promise<Map<string,string>>` 与 `resolveName(id)`**。
   `nameMap` 一次取完整张分类表，供聚合层把 `catId` 换成中文名——否则每笔支出都要查一次分类。
   ⚠️ 它只含**活着的**分类（`store.all()` 默认排墓碑），所以"查不到"就等于该分类已删除，
   调用方按 PRD **E21** 处理（见 §5.6）。`resolveName` 则直接返回 `'已删除分类'`，供单条展示用。
3. **`rollOver` 必须让 `createdAt` 逐条递增**（`base + i`，并用 `keepTimestamps: true` 写入）。
   这是一次真实的 bug 修复：原实现在同步循环里对每条记录取同一个 `now()`，整批 `createdAt` 完全相同，
   排序于是退化成 `sortDated` 的 **id 字典序**兜底；生产环境 id 是 UUID，
   结果就是**顺延过来的待办顺序随机**，和昨天对不上——而 US-04 要的正是可追溯。
   用 `keepTimestamps` 是因为 `put` 默认会把 `updatedAt` 刷成 `now()`，
   那样会得到 `createdAt > updatedAt`（记录在被创建之前就被修改了）。
   回归测试注入了一个**字典序递减**的 idGen，确保不是"id 恰好也是递增的"在掩盖问题。

### 5.6 `core/aggregate`

**这是三视图的直接数据源，也是性能契约的落点（PRD §5.1）。**

> **v6 起 `aggregateDayDetail` 是首屏关键路径**：默认视图改成了日视图（今天），
> 应用启动后第一个数据请求就是它。它的预算（≤ 30 ms）比月视图更紧。

```ts
interface DayAggregate {
  date: DateKey;
  todoDone: number;
  todoTotal: number;          // 均已排除 rolledTo
  noteCount: number;
  costCents: number;
  byCat: Array<{ catId: string; name: string; cents: number }>;   // 金额降序
  anniversaries: string[];
  label: CellLabel;
  isEmpty: boolean;           // 三类皆空 → 视图渲染空状态
}

/** 月视图：42 格。**必须只发 3 次范围查询**（byDateAll + anniversaries + categories），
 *  禁止逐日查询（42 × 3 = 126 次），禁止全库载入内存 */
function aggregateMonth(cursor: DateKey, opts?: { weekStartsOn?: 1 | 0 }): Promise<DayAggregate[]>;

/** 周视图：7 行。同上一次 byDateAll */
function aggregateWeek(cursor: DateKey, opts?: { weekStartsOn?: 1 | 0 }): Promise<{
  days: DayAggregate[];
  total: WeekTotal;
}>;

interface WeekTotal {
  todoDone: number; todoTotal: number;
  daysWithNotes: number;
  costCents: number;
}

/** 月标题栏：N 天有记录 · ¥本月支出 */
function monthSummary(cursor: DateKey): Promise<{ daysWithRecords: number; costCents: number }>;

/** 单日的**指示器**（计数与汇总）。用于周行、月格；**不含正文** */
function aggregateDay(date: DateKey): Promise<DayAggregate>;

/**
 * 单日的**完整内容**——日视图（v6 的默认落地页）的唯一数据源。
 *
 * 为什么不能只用 `aggregateDay`：DayAggregate 只有计数（todoDone/noteCount/costCents），
 * 而日视图要显示待办与想法的**全文**、每笔花费的分类与备注。
 * 让 UI 自己再发三次 repo 查询会重复排序与过滤逻辑，也多一轮往返。
 */
interface DayDetail {
  date: DateKey;
  summary: DayAggregate;             // 含 label / byCat / isEmpty，标题栏与汇总直接用
  todos: TodoRecord[];               // 已排序、已排除墓碑；**含 rolledTo 项**（进度计算要排除它们）
  notes: NoteRecord[];
  expenses: ExpenseRecord[];
  anniversaries: AnniversaryRecord[];
  lunar: LunarInfo | null;           // 农历不可用为 null（PRD E4），UI 只渲染公历
  /** 前一天未完成待办数。>0 时显示顺延横幅（PRD D5 / E10）；顺带返回，省一次查询 */
  prevDayRollable: number;
}

function aggregateDayDetail(date: DateKey): Promise<DayDetail>;
```

**金额格式化**（UI 层用，但规则属于 core，避免两处实现不一致）：

```ts
/** 精确：日详情、周行。28.50 */
function formatMoney(cents: number): string;
/** 紧凑：月格。<100 保留一位小数，≥100 取整，≥1万 显示 x.x万（PRD §3.4） */
function formatMoneyShort(cents: number): string;
/** CSV 导出用：元为单位，两位小数，不带货币符号 */
function formatMoneyCsv(cents: number): string;
```

#### 实现时对本节的修订（`src/core/aggregate/`，已实测）

1. **不是自由函数，而是工厂方法**：
   ```ts
   function createAggregates(deps: {
     store: RecordStore          // 范围查询只有 store 开口（byDateAll），repo 没有对应方法
     repos: Repos                // anniversaries.all() / categories.nameMap()
     lunar?: LunarApi | null     // null = 农历加载失败（PRD E4）
   }): Aggregates
   ```
   返回 `{ aggregateDay, aggregateWeek, aggregateMonth, monthSummary, aggregateDayDetail, invalidate }`，
   方法名与原契约一致。改成工厂是为了注入依赖——自由函数需要模块级单例，既不可测也违反铁律 2。
2. **`aggregateDayDetail` 只发 1 次 `byDateAll`**：区间开成 `[date-1, date]`，
   一次拿到"今天的内容"和"昨天有几条可顺延"，然后按 date 劈开。
   **不要**为 `prevDayRollable` 再查一次（有测试用间谍断言 `toHaveBeenCalledTimes(1)`）。
3. **`aggregateMonth` 全程 3 次查询，与天数无关**：`byDateAll` + `anniversaries.all` + `categories.nameMap`，
   三者 `Promise.all` 并发。有测试断言 `store.all` **从不**被用于 `todos/notes/expenses`
   （即"用 `all()` 拿内容记录再在内存过滤日期"这条禁令是被机器守着的）。
4. **目录是 `index.ts` + `money.ts`**，不是原计划的 `day.ts week.ts month.ts money.ts`。
   三个视图共用同一个 `buildRange(keys)`——正是它保证了"查询次数与天数无关"。
   拆开要么把 `buildRange` 复制三份，要么再多一个共享文件，都不如放一起。
5. **PRD E21 在这里落地**：分类被删 → 该笔支出**并入「其他」**的汇总行，不单独成行；
   若连「其他」也被删了，才用导出的 `DELETED_CAT_LABEL`（`'已删除分类'`）单独成行。
   当日总额 `costCents` **不受影响**——钱确实花掉了。
6. **`byCat` 的排序是 金额降序 → catId 升序**。第二段不是多余的：
   只有金额降序时，同额分类的相对顺序取决于 `Map` 的迭代序，输出不确定，React key 会抖。
7. **新增 `invalidate()`**：分类名做了缓存（CORE-API §6 要求"翻日时不得重查分类表"），
   代价是分类改名/增删后必须调一次。**UI 在 categories 任何写操作后调用。**
8. **`isEmpty` 含 rolledTo 的待办、不含纪念日**。那条待办仍属于这一天、仍会显示（划线态），
   所以不算空白；而纪念日不是用户写的东西——一天只有纪念日时按空状态处理。
   （v6.1 曾用此语义驱动"空白日自动展开待办表单"，**v7.2 已移除该机制**，isEmpty 只被 UI 空状态文案消费。）

### 5.7 `core/migrate`

```ts
interface Migration {
  from: number; to: number;
  /** 纯函数：不得访问 store。返回需要写入的记录 */
  up(records: Record<StoreName, CoreRecord[]>): Record<StoreName, CoreRecord[]>;
}
const MIGRATIONS: Migration[];
```

约束（PRD §6.4）：
- 迁移必须是**纯函数**，以便导入旧备份时复用（PRD E18）
- 禁止"删库重建"
- 失败 → 事务回滚，抛 `MigrationFailedError`，旧数据完好

#### 实现时对本节的修订（`src/core/migrate/index.ts`，24 条测试，100% 语句覆盖）

1. **`Record<StoreName, CoreRecord[]>` 换成了 `RecordTable`**（定义在 `types.ts`）。
   原写法有类型漏洞：`SettingRecord` 只有 `{key, value, updatedAt}`，**没有** id/createdAt/deleted，
   它不是 `CoreRecord`。硬套要么编译不过，要么被迫 `as unknown as` 把类型系统关掉——
   而备份/迁移恰恰是最需要类型兜底的地方（写错一次就是用户全部数据）。
   `RecordTable` 逐字段列出六个表，**新增 store 时这里会编译失败**，逼你同时更新迁移与备份。
2. **不是自由函数，而是工厂 `createMigrator(migrations): Migrator`**。
   真实 `MIGRATIONS` 现在是空的（v1 是基线），若链条逻辑只能跑真实那张表，
   "多步迁移/链条断裂/越过目标"这些分支就永远测不到。注入合成迁移 = 现在就把机器测透。
   模块同时导出绑定真实表的 `migrationPath` / `applyMigrations` / `assertChainComplete`。
3. **`apply` 在入口和每步之后都深拷贝**。迁移是极低频、极高代价的操作，
   而"某个 `up()` 就地改了入参"是这类代码最典型的 bug——它会让导入流程第 4 步的
   "当前库快照"失去意义（快照和正在改的数据是同一个对象）。已用变异检验确认测试抓得住。
4. **`up()` 的返回值会校验形状**：少一个表就抛 `MigrationFailedError` 并点名缺哪个。
   迁移几年才写一次，"缺表"不会当场炸，只会在很久之后表现为"某类数据莫名没了"。
5. **没有环保护**：构造时已强制 `to > from`，版本号严格递增，循环必然终止。
   一个永远走不到的 catch 分支既测不到，也会让读代码的人以为这里真有风险。
6. **`migrate/v1.ts` 没有创建**：v1 是基线，没有 v0→v1 这一步。空文件比没有文件更容易误导。

### 5.8 `core/backup`（v7.5 已实现；契约按实现回填）

> **v1.0 契约修订**（2026-10-01，v7.5）：①`BackupFile.records: Record<StoreName, CoreRecord[]>` 改为 **`data` 分表对象**（todos/notes/expenses/anniversaries/categories/settings，settings 是 `SettingRecord[]` 不是 CoreRecord）；②导入**只有合并**（用户拍板：覆盖会丢数据），`mode='replace'` 移除；③合并按 **id 去重、本地优先**（非"较新者胜"——本地数据总是赢），备份墓碑不导入，settings 本地 key 不覆盖、只补新 key；④CSV 导出未实现（无需求方），MD 导出为 `renderRangeMd`（周/月区间），由 store 层 `exportMd('week'|'month')` 调用。

```ts
interface BackupFile {
  app: 'daycell';
  version: 1;
  schemaVersion: 1;
  exportedAt: number;          // 毫秒时间戳
  data: {
    todos: TodoRecord[]; notes: NoteRecord[]; expenses: ExpenseRecord[];
    anniversaries: AnniversaryRecord[]; categories: CategoryRecord[];
    settings: SettingRecord[]; // 仅白名单 5 key（accentColor/lastBackupAt/backupReminderOff/onboarded/weekStartsOn）
  };
}

/** 全表导出，**含墓碑**（否则导入后已删记录会复活） */
function serializeBackup(deps: { store: RecordStore; clock: Clock }): Promise<BackupFile>;

/** 全量校验（app/version/schemaVersion/exportedAt/逐记录 type 与字段/settings key 白名单）。
 *  坏即抛 `BackupCorruptError`（消息承诺「现有数据未改动」），不返回部分结果 */
function parseBackup(raw: unknown): BackupFile;

interface MergeStats { inserted: number; retained: number; tombstoneSkipped: number; settingsAdded: number }

/** 合并：按 id 去重、本地优先、备份墓碑不导入、settings 本地 key 不覆盖只补新 key。
 *  单事务（store.tx）+ 全部写入 keepTimestamps:true（防 last-write-wins 把本地较新记录反转）。
 *  任何一步失败整体回滚（idb tx abort / memory tx snapshot-restore） */
function mergeBackup(file: BackupFile, deps: { store: RecordStore; clock: Clock }): Promise<MergeStats>;

/** 周/月区间 Markdown：标题→区间→每日「待办 checkbox / 想法引用块 / 花费-分类¥金额（备注）」
 *  →每日小计→区间合计。金额用 formatMoney（整数分），墓碑过滤 */
function renderRangeMd(range: { from: DateKey; to: DateKey }, deps: { store: RecordStore; nameMap: Record<string, string> }): Promise<string>;
```

**导入流程（store.importBackup，必须按此顺序）**：
1. `parseBackup` → 失败则**一条都不写**，抛 `BackupCorruptError`（toast「备份文件损坏…现有数据未改动」）
2. `schemaVersion` 高于当前 → `VERSION_TOO_NEW`，拒绝
3. `mergeBackup` 单事务写入 → `aggregates.invalidate()` → 刷新 → toast「已合并导入 N 条记录」
4. `schemaVersion` 低于当前：真实 MIGRATIONS 为空（v1 是基线），分支不可达（注入合成迁移可测，同 `createMigrator`）

### 5.9 `core/diagnose`

```ts
interface Diagnosis {
  indexedDB: boolean;        // false → PRD E1，UI 降级到 memoryStore + 红色横幅
  storageEstimate: boolean;
  serviceWorker: boolean;
  installed: boolean;        // 是否已装到主屏（display-mode: standalone）
  secureContext: boolean;    // PWA 安装的前提
  usage?: { usage: number; quota: number };
  userAgentIOS: boolean;     // 用于决定是否显示"添加到主屏幕"引导（PRD S1）
}
function diagnose(deps: {
  indexedDB?: unknown; navigator?: unknown; matchMedia?: unknown;
}): Promise<Diagnosis>;
```

全局对象**全部通过参数注入**，这是 §1.2 铁律 2 的落地方式。

---

### 5.10 `core/validate`

纯校验。**本节按已落地的实现回填**（`src/core/validate.ts`，38 个测试）。约定见 §2.1：一律返回 `ParseResult<T>`，不抛异常。

```ts
export type ValidateCode =
  | 'EMPTY' | 'TOO_LONG' | 'NOT_A_NUMBER' | 'NOT_POSITIVE' | 'TOO_LARGE' | 'INVALID_DATE'
export type ParseResult<T> = ParseOk<T> | ParseErr
export const ok:  <T>(value: T) => ParseOk<T>
export const err: (code: ValidateCode, message: string) => ParseErr

export const LIMITS: {
  readonly todoText: 500
  readonly noteText: 5000
  readonly expenseNote: 200
  readonly anniversaryTitle: 50
  readonly categoryName: 12
  readonly maxAmountCents: 9_999_999_900   // 99,999,999 元（PRD E7）
}

/** 全角数字 ０-９ / 全角句点 ．/ 句号 。→ 半角；千分位 , 与 ， 去掉。
 *  **只 trim 首尾空白**，不吃内部空格（'1 200' 应判为 NOT_A_NUMBER）；不接受 ¥ / ￥ 前缀（PRD Q6 待决） */
export function normalizeNumericInput(raw: string): string

/** 元 → **整数分**。标准十进制走字符串逐位运算，第三位小数 round half up。
 *  ⚠️ 绝不能用 Math.round(Number(s) * 100)：1.005 * 100 === 100.49999999999999，会少一分。
 *  非标准形态（'1e3'）兜底走 Number（PRD US-03 允许） */
export function parseAmount(raw: string): ParseResult<number>

export const parseTodoText:         (raw: string) => ParseResult<string>
export const parseNoteText:         (raw: string) => ParseResult<string>
export function parseExpenseNote(   raw: string): ParseResult<string>
export const parseAnniversaryTitle: (raw: string) => ParseResult<string>
export const parseCategoryName:     (raw: string) => ParseResult<string>
export function parseDateKey(       raw: string): ParseResult<DateKey>

/** 按 Unicode 码点计数，不是 .length（emoji / 生僻字占 2 个 UTF-16 单元） */
export function textLength(raw: string): number
```

> 🗑 **`parseQuickExpense` 已删除**（v6.1，PRD **Q7** 已关闭）
> 它曾负责解析顶部快速框的一句话花费（`45 午饭` → `{cents:4500, note:'午饭'}`）。
> 该输入框在 v6.1 整行移除（PRD **D18** / SPEC §3.3），函数随之失去唯一调用方，
> 经产品负责人确认后删除：`validate.ts` −28 行、测试 −8 个 `it`。
> **不要重新引入**——第二条花费录入路径正是 PRD Q2 记的那个别扭点。
> 需要找回实现看 git 历史：`git log -S parseQuickExpense`。

> **UI 侧不得另写一份金额换算**（ADR-0003）。原型的 `toCents()` 是 `parseAmount` 的等价复刻，
> 由 `src/prototype-parity.test.ts` 用 40 组输入强制逐位一致（覆盖 round half up 边界、全角、千分位、
> `1e3`、上限、`¥` 前缀、内部空格、空串）。写这个测试的当天就抓到原型自作主张吃掉了 `¥` 和内部空格。

### 5.11 `core/clock`

铁律 3 的落地手段：**这是全项目唯一允许出现 `Date.now()` 的文件**。ESLint 只对 `core/clock.ts` 关闭 `no-restricted-syntax`；`core/store/**` 与 `core/migrate/**` 则完全禁用 `Date`。

```ts
export type Clock = () => number
export const systemClock: Clock

export interface FakeClock extends Clock {
  advance(ms: number): void
  set(ms: number): void
}
export function createFakeClock(start?: number): FakeClock   // 默认 1_700_000_000_000
```

> ⚠️ `createFakeClock()` 返回的是**可调用对象**（函数本身 + 挂两个方法），不是 `{ now }`。
> 注入时要写 `now: fakeClock`，**不能写 `now: fakeClock.now`**——后者是 `undefined`，
> 会静默退回 `systemClock`，测试变成"看起来在跑、其实在用真实时间"。
> 这个坑在 repo 测试里踩过一次，一次带走 10 个用例。

---

## 6. 性能契约

| 调用 | 上限 | 说明 |
|---|---|---|
| `aggregateMonth` | ≤ 100 ms @ 4 万条记录 | 3 次范围查询。**有基准测试守护，退化即 CI 失败** |
| `aggregateWeek` | ≤ 50 ms | 1 次 `byDateAll` |
| `aggregateDay` | ≤ 10 ms | 1 次 `byDateAll`（单日区间） |
| **`aggregateDayDetail`** | **≤ 20 ms** | v6 首屏关键路径。1 次 `byDateAll` + 纪念日/分类/农历；**翻日时不得重新初始化 store**，也不得重查分类表（可缓存） |
| 任意 `repo.create` | ≤ 100 ms | 含落盘（PRD §5.1） |
| `cellLabel` | ≤ 0.1 ms | 纯函数，42 次调用共 ≤ 5 ms |
| 首屏 core 代码 | ≤ 20 KB gzip | 农历库不计入（异步分包） |

**禁止出现的实现**（code review 检查项）：
- 在循环里开事务
- 用 `all()` 拿内容记录再在内存里过滤日期
- 逐日调用 `aggregateDay` 来拼月视图

---

## 7. 测试契约

core 的每个模块都必须有测试，且：

1. **在纯 Node 环境运行**（`environment: 'node'`，不是 jsdom）——这本身就是铁律 2 的验证
2. `RecordStore` 的契约测试**同一份用例跑两个实现**（idb 用 `fake-indexeddb`，memory 直接跑）
3. `core/date` 必须覆盖：跨年、跨月、6 行月份、`addMonths` 夹取（1/31 + 1 月）、周一起始、闰年 2/29
4. `core/validate` 必须覆盖 PRD US-03 的全部 6 种金额输入
5. `core/migrate` 必须能从 v1 的 fixture 一路迁移到当前版本
6. `core/backup` 测试：serialize 含墓碑 / parse 非法结构 / merge 合并语义（本地优先、新增补入、墓碑跳过、设置补新 key）/ renderRangeMd 小计合计（14 用例，`backup.test.ts`）
7. `aggregateMonth` 有 4 万条记录的基准测试

覆盖率要求：**core ≥ 80%**（PRD §10）。UI 层不设硬指标，但 US-01~US-12 必须有对应的组件测试。

---

## 8. 版本与兼容

- 本契约遵循**语义化版本**：新增可选参数/新模块 = minor；改签名/删模块 = major
- **major 变更必须同时更新本文档并写一条 ADR**
- `BackupFile.schemaVersion` 与本契约版本**独立演进**：schemaVersion 只跟数据结构走，不跟函数签名走
- UI 层不得依赖 core 的内部实现细节（未在此文档出现的导出一律视为私有）

---

## 附：目录结构

```
src/
  core/
    id.ts  date.ts  lunar.ts  label.ts  validate.ts  clock.ts  errors.ts  types.ts  diagnose.ts
    store/
      types.ts        ← RecordStore 接口
      idb.ts          ← 生产实现
      memory.ts       ← 测试 + E1 降级实现
      contract.test.ts← 同一份用例跑两个实现
    repo/
      todos.ts  notes.ts  expenses.ts  anniversaries.ts  categories.ts  settings.ts
    aggregate/
      index.ts        ← createAggregates 工厂 + 五个聚合方法（原计划 day/week/month 三文件，
      money.ts          因共用 buildRange 而合并，理由见 §5.6 修订 4）
    migrate/
      index.ts  v1.ts
    backup/
      json.ts  csv.ts  markdown.ts  import.ts
    index.ts          ← 唯一对外出口，UI 只从这里 import
  ui/                 ← React 组件 + CSS Modules
  app/                ← 装配、Zustand store、路由
```

`core/index.ts` 是**唯一出口**。UI 直接 import 子模块路径视为违规，用 ESLint `no-restricted-imports` 阻断。
