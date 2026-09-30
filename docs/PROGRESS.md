# DayCell 实施进度快照

> **这份文件的用途**：让会话上下文可以安全丢弃。接手时先读这份，再按需读 PRD / CORE-API。
> 最后更新：2026-09-29 · **v6 需求已落到文档，代码尚未跟进**
> 代码当前状态 **全绿**：`tsc -b` 0 错 / `eslint .` 0 错 / **295 测试通过**（~0.4 s）

---

## 0. ★ v6 新需求（用户 2026-09-29 提出，**文档已改完，代码未动**）

**需求原话**：「打开之后默认是今日的页面，然后可以切换为周和月，先周后月。」

**已确认的三个细节**（用 ask_user_question 问过）：
1. 日视图**能前后翻日**（左右滑 / 「前一天·后一天」），不只显示今天
2. 日视图是**全屏页面**，沿用原 sheet 里的内容结构（待办/花费/想法三区块）
3. **确认取舍**：写入优先。代价是回看从"开屏即见本月密度"变成多一次视图切换

**连带决定**（我提的，已写进文档，用户未逐条否决）：
- 切换器顺序固定 **日 → 周 → 月**，常驻不折叠；快捷键 `d`/`w`/`m`
- **手机端取消底部 sheet**，改为三视图切换；点周/月的格子跳进日视图
- 桌面端：分栏不变（左周/月 + 右日详情）；切到「日」时左栏收起
- 切视图不丢选中日期；翻日不丢当前视图
- **从周/月进日视图必须记住来源**（视图 + 日期 + 滚动位置），返回时精确还原

**文档改动落点**：
| 文件 | 改了什么 |
|---|---|
| `docs/PRD.md` | §1.1 定位、§1.4 **新增红线取舍说明**、§2 场景 A/C/D、§3 M1–M3 重排为日/周/月 + **新增 M18 视图切换器** + M17 改写、§4 **US-09 整条重写**、§5.1 **新增日视图性能预算**、§5 a11y 焦点规则、§8 **新增「今天全空」空状态**、§9 **新增 D16/D17**、§10 验收清单 |
| `SPEC.md` | 头部版本行、§2 决策表加"默认视图"、**§3.1 改为三视图对照表**、**§3.2 整节重写** |
| `docs/adr/0005-*.md` | **整篇修订**：标题改「移动三视图」、新增 v6 起因、移动端决策改写、**专门解释为何推翻原版否决的"整页跳转"**、保留 bug 根因并说明失败模式如何变形、替代方案表重排 |
| `docs/adr/0007-*.md` | sheet 论据换成 v6 的同类场景（转场/键盘避让）、`layout.css` 描述、原型现状加注 |
| `docs/adr/README.md` | 0005 行标题与状态 |
| `docs/CORE-API.md` | 见下节 |

**代码侧待办（v6 引起的）**：
- `core/aggregate` 必须提供 **`aggregateDayDetail`**（日视图是首屏，要全文不只要计数）——契约已写进 CORE-API §5.6
- `src/app` 需要一个**一层来源栈** `{view, date, scrollTop}` + `popstate` 处理
- 翻日**不得 push history**（否则按一次返回只退一天，退不出日视图）
- `src/ui` 三视图组件；手机不再有 sheet 组件
- 原型 `prototype/index.html` **仍是 v5.2**，没跟进 v6（用户说先改文档）

---

## 1. 已完成

### 文档 `docs/`
| 文件 | 内容 |
|---|---|
| `PRD.md` | v0 需求定稿：§3 MoSCoW（**M1–M18**）/ §4 **US-01~US-12** / §7 **E1–E25** / §8 空状态 / §9 **D1–D17** / §11 Q1–Q5 未决 |
| `CORE-API.md` | core 层 TS 契约，11 个模块，3 条铁律 |
| `adr/0001~0008` | 存储选型 / SW 策略 / 金额整数分 / lunar 懒加载 / **响应式三视图** / core 无 React / CSS Modules / 自写 date |
| `README.md` | 索引；冲突优先级 **PRD > CORE-API > adr > SPEC** |

`SPEC.md`（仓库根）= 决策日志；其 §5 数据模型已被 PRD §6 取代。

### 原型 `prototype/index.html`
**v5.2**（⚠️ 早于 v6，仍是 sheet 方案），59,966 bytes，零依赖。服务在 http://127.0.0.1:5199/index.html
（nohup `python3 -m http.server 5199 --bind 127.0.0.1`，日志 `/tmp/daycell-proto.log`；**不是** DSH 托管 job，重启需手动）
`smoke.cjs`（jsdom）**114 项全通过**。

### 代码 `src/core/`（全部有测试）
```
types.ts          记录级模型 + 墓碑 deleted + isLeapMonth + SCHEMA_VERSION=1
errors.ts         DayCellError 8 子类 + ValidationError(validateCode)
clock.ts          ★ 全项目唯一的 Date.now() 豁免点；createFakeClock
id.ts             newId / createIdGen / createSeqIdGen
date.ts           自写日期模块（ADR-0008），DateKey 恒 'YYYY-MM-DD'
validate.ts       ParseResult + parseAmount（字符串位运算，非 *100）
lunar.ts          ★ 懒加载 lunar-typescript + 白名单 + 三条回退（E13/E14/E25）
label.ts          ★ cellLabel 优先级 + lunarFullText，纯函数
store/types.ts    RecordStore 契约 + sortDated / sortCategories
store/memory.ts   内存实现（测试 + 降级）
store/idb.ts      IndexedDB 实现（idb v8）
store/contract.test.ts  ★ 同一套 67 用例跑两个实现
repo/index.ts     todos/notes/expenses/anniversaries/categories/settings
repo/repo.test.ts 60 用例，覆盖 US-04 顺延、E10/E11/E21/E24
isolation.test.ts import.meta.glob 静态扫源码，守 ADR-0006 边界
```

**尚未写**：`aggregate/*`（含 v6 新增的 `aggregateDayDetail`）、`migrate/*`、`backup/*`（json/csv/markdown/import）、`diagnose.ts`、`core/index.ts` 单一出口、`src/ui/*`、`src/app/*`、`index.html`、PWA 插件接线、`scripts/report-size.mjs`。

---

## 2. CORE-API 与实现的两处偏离（**文档已同步**，见 CORE-API 内的"实现时修订"表）

1. **`RecordStore.tx` 签名**：`fn: () => Promise<R>` → **`fn: (scope: RecordStore) => Promise<R>`**。
   原因：IndexedDB 的原子性来自"所有请求挂在同一个 IDBTransaction 上"，用外层 store 会各自开新事务，回滚形同虚设。
2. **`core/lunar` / `core/label` 的形状**：`lunarOf` 返回 `LunarInfo | null`（库对超范围年份不抛错）；
   `lunarAnniversary` 增加 `isLeapMonth` 参数与 `usedFallbackDay`；`resolveSolarAnniversary` 改为**不依赖库的纯函数**（否则农历加载失败时公历纪念日也没了，违背 E4）；
   `LunarInfo.lunarMonth` **自带「闰」前缀**，展示层不得再加（实测踩过「闰闰六月」）；
   `CellLabel` 用 `emphasis: boolean` + `extra?: number` 取代 `lunarSuffix`，`kind` 拆出 `lunarMonth`/`lunarDay`。

## 3. ★ lunar-typescript 实测行为（文档里没有，只有代码注释和这里）

1. **闰月用负数月份**：`Lunar.fromYmd(2025, -6, 1)` = 闰六月初一。该年无此闰月 → **抛错** `wrong lunar year 2026 month -6`（PRD E13 回退路径）
2. **超范围年份不抛错**：1899、2101 都照常返回不可信值 → 范围必须自己判（`inLunarRange`，PRD E14）
3. **三十日在 29 天的月份 → 抛错** `only 29 days in lunar year 2026 month 8`（**PRD 原先漏掉，已补为 E25**）
4. `getMonthInChinese()` 闰月返回 **'闰六'**（自带前缀）；`getJieQi()` 非节气日返回 **空串**
5. 节日分三处：`Solar.getFestivals()` 公历（**名字带「节」后缀**：国庆节/元旦节/教师节）、
   `lunar.getFestivals()` 农历（中秋节/春节）、`lunar.getOtherFestivals()` **噪音**（地藏节/天灸日/世界住房日）→ 我们不读第三个，且白名单用 `includes` 关键词匹配
6. **清明只以节气形式出现**，不在 festivals 里
7. 实测锚点：2026-09-29=八月十九 / 09-25=中秋节 / 09-07=白露(廿六) / 09-11=八月初一 / 09-10=教师节 / 2026-02-17=春节(正月初一) / 2025-07-25=闰六月初一 / **2026 年没有任何闰月**

## 4. 下一步（按序）

1. `core/aggregate/` — `money.ts` 格式化 + `aggregateDayDetail`（**v6 首屏关键路径，先做这个**）+ `aggregateDay` / `aggregateWeek` / `aggregateMonth`（**恒 42 格，只发 3 次区间查询，绝不全库扫**）
2. `core/migrate/`、`core/backup/`（json/csv/markdown/import）、`core/diagnose.ts`、`core/index.ts`
3. `src/app/*` — 视图状态机 + **一层来源栈** + `popstate`
4. `src/ui/*` — 日/周/月三视图（手机无 sheet）+ `index.html` + PWA 接线（ADR-0002）
5. `scripts/report-size.mjs` 守 **首屏 ≤ 80 KB gzip**（估算 ~62 KB；lunar 必须独立 chunk）
6. 修 `package.json` 的 `test:tz`：现在引用了**未安装**的 `cross-env-shell`，改成 `TZ=… npx vitest run` 链式（ADR-0008 要求三时区跑）
7. 原型是否跟进 v6（改成三视图）——**待用户决定**

---

## 5. 不可漂移的约束

- **产品**：日历为主，格子里放当天记录。**不碰时间点事件**（无日程、无提醒推送）。
- **两条红线**：单次写入 ≤ 5 s（v6 把它压到 0 次切换）；回看必须值得（v6 代价：多一次切换，见 PRD §1.4）。
- **v0 明确不做**（PRD §3 Won't）：当日总结、心情评分、照片、云同步、账号、预算、图表、提醒推送、带时间日程、习惯打卡、全文搜索、拖拽排序、优先级/标签、深色模式、多语言。
- **金额只存整数分**；UI 不得自行 `*100` / `/100`（用 repo 导出的 `toCents` / `toYuan`）。`1.005*100 === 100.49999999999999`，naive 换算是错的。
- **日期只用 `new Date(y, m-1, d)`**；`new Date('2026-09-29')` 按 UTC 午夜解析，在 UTC−x 会差一天。`daysBetween` 用 `Date.UTC` 避 DST。
- **core 不得 import React/DOM/zustand/CSS**（ESLint 强制 + `isolation.test.ts` 扫源码）。
- **墓碑永不物理删除**（`RecordStore` 故意没有 `remove`）；每次写都刷 `updatedAt`。
- **返回路径必须冗余**（ADR-0005 v6）：手机「← 返回」+ `popstate` + 桌面 `Esc`；**不能只依赖键盘**；进日视图必须记住来源。
- **对比度**：`--ink-3 #767676` 是文字下限（4.54:1）；`--ink-4 #C4C4C4` **只能用于装饰**，白名单仅 `.qadd:disabled` 与 `.empty .big`。

## 6. 环境事实

工作目录 `/Users/wangduanmao/DayCell`；sandbox `workspace-write`。
`~/.npm` 被沙箱挡 → 装包一律 `npm install --cache ./.npmcache --no-audit --no-fund`。
Node v24.18.1 / npm 10.9.8 / Python 3.9.6 / macOS（`cat -A` 不可用，用 python 看 repr）。
**无 Xcode**（排除原生 iOS）、**无浏览器 provider**（视觉只能用户自己看）、**`web_search` 不可用**（不要断言未验证的第三方平台事实）。
系统日期 **2026-09-29 周二**。
栈：Vite 8.3.1(Rolldown) / TS 5.9.3（**不能升 7**，typescript-eslint 8.71 peer `<6.1.0`）/ React 19.3 / Zustand 5 / idb 8.0.3 / lunar-typescript 1.8.6 / Vitest 5.0.2 / lightningcss / fake-indexeddb。
`vite.config.ts` 的 `manualChunks` **必须用函数形式**，Rolldown 不接受对象形式。
**idb v8 的坑**：`IDBPDatabase` 只有 1 个泛型参数；`getAllFromIndex` **只挂在 database 上**，事务内必须 `tx.objectStore(s).index(name).getAll(range)`；`IDBKeyRange.bound(lo,hi)` 在 `lo>hi` 时抛 `DataError`（空区间要先短路返回 `[]`）。

## 7. 未决（等用户拍）

- PRD §9 **D1–D17 默认值表从未被逐条确认过**（D16/D17 是 v6 新增，方向已口头确认）
- PRD §11 **Q1–Q5**：Q1 回看价值靠什么撑（我建议真实用两周后再议）/ Q2 双路径花费录入不一致 / Q3 调休数据源 / Q4 部署平台 / Q5 v1 同步存储
- 遗留物去留：`genlunar.cjs`、`smoke.cjs`、`prototype/`（v6 后原型已与文档不一致）

## 8. 用户沟通偏好

少给选项、不给矩阵；解释控制在两句内；**给带理由的推荐**而不是菜单；直说权衡与不确定性；**改动前先说清代价**。
用户会自己发现真问题并推翻自己之前的指令（v6 就是一例：他自己把默认视图从周改成了日）。
