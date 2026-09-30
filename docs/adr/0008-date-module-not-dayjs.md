# ADR-0008 日期处理：自写 core/date，不用 dayjs

- **状态**：已接受
- **日期**：2026-09-29
- **相关**：SPEC §6 技术栈、PRD §7 E12/E15/E16、CORE-API §5.2、ADR-0006

> 本条推翻了 SPEC §6 原定的「dayjs」。

## 背景

DayCell 的一切都以"日期"为轴：记录归属哪天、月格 42 个格子、周视图 7 行、待办跨天顺延、农历纪念日换算。**日期算错一天，数据就落错格子**，而且用户立刻能发现（"我明明记的是昨天"）。

SPEC 原定用 `dayjs`（约 7 KB gzip）。但需求澄清阶段已经确定了两条关键约束：

- **只用"日期"，不用"时刻"**——产品刻意不碰时间点（SPEC §1 产品定位）
- **只用浏览器本地时区**，不做时区转换、不做多时区（PRD D11）

也就是说，dayjs 最擅长的那些事（时区、相对时间、duration、格式化本地化）我们**一件都不需要**。

## 决策

**自写 `core/date.ts`，约 60 行，零依赖。**

### 核心类型：branded `DateKey`

```ts
/** 'YYYY-MM-DD'，浏览器本地时区 */
type DateKey = string & { readonly __brand: 'DateKey' };
```

全库、全接口一律用 `DateKey`，**不用 `Date` 对象跨模块传递**。`Date` 只在 `toKey` / `fromKey` 两个函数内部出现。

### 接口（CORE-API §5.2）

```ts
today(now?: Date): DateKey
isValidKey(s: string): s is DateKey
toKey(y, m, d): DateKey          // m 是 1–12，不是 0–11
fromKey(k): { y, m, d }

addDays(k, n): DateKey
addMonths(k, n): DateKey         // 夹取：1/31 + 1月 → 2/28
daysBetween(a, b): number
compareKey(a, b): -1 | 0 | 1

dowOf(k): 0..6
startOfWeek(k, weekStartsOn = 1): DateKey
weekKeys(k): DateKey[]           // 恒 7 个
monthGrid(k): DateKey[]          // 恒 42 个
monthKeys(k): DateKey[]
isSameMonth(a, b): boolean
```

### 唯一允许接触 `Date` 的两个函数

```ts
export function toKey(y: number, m: number, d: number): DateKey {
  const dt = new Date(y, m - 1, d);        // ✅ 本地时区构造
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` as DateKey;
}
export function fromKey(k: DateKey) {
  const [y, m, d] = k.split('-').map(Number);
  return { y, m, d };                       // 返回数字，不返回 Date
}
```

`addDays` 的实现基于 `Date` 的本地时区算术：

```ts
export function addDays(k: DateKey, n: number): DateKey {
  const { y, m, d } = fromKey(k);
  const dt = new Date(y, m - 1, d + n);     // 溢出自动进位，本地时区
  return toKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}
```

## 理由

### 1. 那个必须避开的陷阱

```js
new Date('2026-09-29')   // ❌ 按 ISO 8601 解析为 UTC 零点
new Date(2026, 8, 29)    // ✅ 本地时区零点
```

在 UTC+8（中国）下前者是 `2026-09-29 08:00` 本地时间，取 `getDate()` 得 29，**碰巧正确**。但在 UTC−5（美东）下前者是 `2026-09-28 19:00`，`getDate()` 得 **28**——差一天。

这就是为什么大量"日期差一天"的 bug 只在特定时区出现、开发者在自己机器上永远复现不了。

**dayjs 不能免疫这个问题**：`dayjs('2026-09-29')` 内部同样走 `new Date(string)`。它只是把陷阱包装得更好看。真正安全的做法是**永远不解析日期字符串，永远用数字构造**——这正是本模块把 `fromKey` 设计成返回 `{y,m,d}` 而非 `Date` 的原因。

### 2. 需求面小到不需要库

我们需要的运算只有：加减天数、加减月份（夹取）、星期几、周一起始、42 格网格、日期差、字符串比较。

其中**字符串比较就够了**：`'2026-09-29' < '2026-10-01'` 在字典序下天然成立，因为 `YYYY-MM-DD` 是定宽零填充的。这一条替代了 dayjs 的 `isBefore` / `isAfter` / `isSame`。

自己写这 60 行，比学 dayjs 的 API、配 plugin、盯 bundle 更省事。

### 3. core 的可移植性（ADR-0006）

`core/date.ts` 是要在纯 Node 环境里跑单元测试的。零依赖意味着：
- 不用 mock 任何库
- 不用担心库的内部实现访问 `window`
- 将来抽成 `packages/core` 给小程序用时，不用管 dayjs 在 Taro 里的兼容性

### 4. 顺带解决了"今天"的可测性

`today(now?: Date)` 接受注入。铁律 3（禁止隐式当前时间，ADR-0006）在这里落地：所有依赖"今天"的逻辑——顺延横幅、今天高亮、备份提醒——在测试里都能固定日期复现。

用 dayjs 也能做（`dayjs(mockDate)`），但需要处处记得传参；把它收敛到 `today()` 一个入口更难漏。

## 考虑过的替代方案

| 方案 | 为什么否掉 |
|---|---|
| **dayjs**（原方案） | 7 KB 换 60 行；不能免疫字符串解析陷阱；plugin 机制（`utc`、`timezone`、`isoWeek`）我们一个都不用。**注意 `isoWeek` 是需要 plugin 的**，而"周一起始"恰好是我们的核心需求（PRD D1） |
| date-fns | Tree-shaking 友好，但每个函数是独立模块，用 6 个函数就引入 6 个模块，且体积（约 15 KB）比 dayjs 还大 |
| Luxon | 功能最全、时区处理最严谨，但 70 KB+。我们不做时区转换，用它等于买卡车送一箱油 |
| Temporal（TC39 提案） | **正确方向**。`Temporal.PlainDate` 就是为"只有日期没有时刻"设计的，从类型上消灭了时区陷阱。但截至 2026-09 仍需 polyfill（约 60 KB），Safari 未 shipped。**v1 重新评估**——届时如果原生可用，`core/date.ts` 的接口可以原样保留、内部换成 Temporal |
| 直接用原生 `Date` | 就是陷阱本身。可变对象 + 0 起始月份 + 字符串解析歧义，是这个 bug 类别的来源 |
| 用 `Intl.DateTimeFormat` | 那是**格式化/本地化**工具，不做日期算术 |

## 后果

**正面**
- 零依赖，core 更轻、更可移植
- **从类型上杜绝了"传 `Date` 对象跨模块"**，时区陷阱被关在两个函数里
- `YYYY-MM-DD` 定宽格式让字典序比较直接可用，省掉一批比较函数
- 60 行代码，100% 测试覆盖是现实的（用 dayjs 时我们只会测自己的调用点）

**负面**
- **自己维护 = 自己负责 bug**。缓解：PRD §10 要求 core 覆盖率 ≥ 80%，且 CORE-API §7 列了必测清单（跨年、跨月、6 行月份、`addMonths` 夹取、周一起始、闰年 2/29）
- 将来若需要"3 天前"这类相对时间表达、或按用户 locale 格式化长日期，要么自己写，要么那时再引入 dayjs。**评估：v0 不需要**——界面上的日期都是 `2026 年 9 月 29 日` / `周二` 这种固定中文格式，手写模板即可
- 与 `lunar-typescript` 交互时需要转换：该库接受 `Date` 或 `ymd`。**约定：只传 `fromKey()` 得到的 `{y,m,d}` 数字**，不传 `Date`，避免陷阱从这条缝里钻回来

## 实施要点

- **`DateKey` 的 brand 必须真的起作用**：`const k: DateKey = '2026-9-29'` 应该编译失败。branded type 写法要保证 TS 不能隐式赋 `string`
- 所有函数必须是**纯函数**（`today` 除外，且它接受注入）
- `monthGrid` **恒返回 42 个**（PRD D2：6 行月份完整显示，不裁成 5 行）。不要"按需 5 或 6 行"——那会让网格高度跳动
- `addMonths` 的夹取行为要写进测试：`addMonths('2026-01-31', 1) === '2026-02-28'`、`addMonths('2028-01-31', 1) === '2028-02-29'`（闰年）
- `startOfWeek` 默认 `weekStartsOn = 1`（周一）。周日起始作为参数保留，但**不在设置里暴露**（PRD D1 已定周一，少一个选项）
- 必测的边界日期：`2026-12-31 → addDays(+1) → 2027-01-01`；`2028-02-29`；`2026-08-31` 所在月的 42 格网格（跨到 9 月和 10 月）
- **测试必须在 UTC、UTC+8、UTC−5 三个时区各跑一遍**（CI 里用 `TZ` 环境变量）。这是唯一能抓住时区陷阱的办法——只在一个时区跑，写错了也是绿的
