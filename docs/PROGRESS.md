# DayCell 实施进度快照

> **这份文件的用途**：让会话上下文可以安全丢弃。接手时先读这份，再按需读 PRD / CORE-API。
> 最后更新：2026-09-29 · **v6 与 v6.1 均已落到文档 + 原型**；core 代码未受 v6.1 影响（仅一处注释）
> 当前状态 **全绿**：`tsc -b` 0 错 / `eslint .` 0 错 / **336 测试通过**（~1.0 s）/ `node smoke.cjs` **218 项断言全通过**

---

## 0. ★ v6 / v6.1 需求（用户 2026-09-29 提出，**文档与原型均已跟进；core 代码基本未动**）

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
- ~~原型没跟进 v6~~ → ✅ 已升到 v6，见下

---

## 0b. ★ v6.1 新需求（用户 2026-09-29 提出，**已全部落地**）

**需求原话**：「由于目前引入了今日视图，所以不需要在顶部进行想法或者花费什么的添加了，把那一行都统一去掉吧。」

**我的判断：有必要，且理由比"省地方"更硬**（已写进 PRD **D18** / SPEC §3.3）：
1. v6 之后日视图就是落地页，顶部框与日详情各区块的内联表单**字段、交互、提交方式完全重复**
2. 顶部框写死今天：看着 9/25 却存进 9/29。原方案要靠「→ 今天」warn 徽标 + hover 长文案 + toast 带"今天"字样**三重补丁**缓解——**补丁需要三重，就是设计本身错了的证据**
3. 白占约 56 px 竖向空间，而全屏日视图最缺的就是竖向空间

**补速手段（关键，否则红线 1 会掉）**：完全空白的一天**自动展开待办区块的内联表单并聚焦**。
今天还空着时打开应用直接敲字回车，**比原来的顶部框还少一次点击**（原来要先点一下输入框）。
用户主动收起过的那一天按日期记在 `formDismissed`，不再自动弹。

**已明确接受的代价**：
- 今天已有内容时不自动展开（不能挡内容），要先点一次「+ 添加」→ **比 v6 多一次点击**
- 手机周/月视图下**没有录入入口**，必须先点格子进日视图（与 v6 导航一致）
- 「45 午饭」一句话记花费取消 → **PRD Q2 自动关闭**；`core/validate.ts parseQuickExpense` **失去调用方** → 转 **PRD Q7 待决**

**文档改动落点**：
| 文件 | 改了什么 |
|---|---|
| `docs/PRD.md` | §1.4 **新增 v6.1 取舍说明**、§2 **场景 A/B/C 全部重写**、§3 **M7 废除（编号保留不复用）+ M8 升为唯一入口**、§4 **US-01 整条重写 + US-03 补金额算法规则**、§8 **空状态表改写 + 新增第 4 条规矩**、§9 **新增 D18**、§10 验收清单、§11 **Q2 关闭 + 新增 Q6/Q7** |
| `SPEC.md` | §3.1 决策表（**顺带修掉两处 v6 就该改却漏掉的"默认视图 → 周"**）、**§3.3 整节重写为单一入口**、§3.3.1、§3.5 录入方式、§7 路线图 v0、§8 清单 |
| `docs/CORE-API.md` | **新增 §5.10 `core/validate`**（此前只有表格一行，从没给过接口章节）、**新增 §5.11 `core/clock`**（此前整个模块未登记）、§1.1 补 clock/errors/types 三行、附录目录结构补全 |
| `src/core/validate.ts` | 仅**注释**：给 `parseQuickExpense` 标注孤儿状态 + 指向 Q7（**无行为改动**） |
| `prototype/index.html` | v6 → **v6.1**，66,284 bytes（见下） |
| `smoke.cjs` | **整体重写**，114 → **218 项断言**（见下） |
| `src/prototype-parity.test.ts` | **新增**：原型 `toCents` ↔ core `parseAmount` 平价检验，40 组输入 |

**顺带修掉的三个既有 bug（都是 v6.1 改动直接暴露的）**：
1. `#ifAmt` 用 `Math.round(parseFloat(x)*100)` → `1.005` 会少记一分。删掉一句话解析后它成了**唯一**花费入口，必须修。现改为与 core `parseAmount` 逐位一致的字符串算法
2. 分区空文案写死「今天还没有待办/记账」→ 日视图能翻到任意一天，看着 9/21 却说"今天"。非今天一律省掉主语（**与顶部框同一类毛病**）
3. `syncHistory` 的 `pushed` 标记：用按钮/Esc 返回时没有真正弹掉自己压的 history 条目，`pushed` 会一直卡在 `true`，**第二次进日视图时系统手势返回就失效**（会直接退出应用）。已加 `requestBack()` 统一处理

**smoke.cjs 重写时修掉的两个测试框架自身缺陷**：
1. **退出码只看对比度那一项**：`bad` 数组收集了却从不打印、从不影响 `process.exit`，所有功能断言失败被静默吞掉。已修
2. 一处在 `click(null)` 抛错就整体崩掉，后面所有断言跳过。已改为每节 `sec()` 独立 try/catch

> ✅ **变异检验已做**：故意把顶部框塞回去、删掉自动展开、金额退回浮点算法 → smoke 报 **22 项失败、退出码 1**；还原后 0。**一个永远不会失败的测试没有价值**，所以这一步不能省。

---

## 1. 已完成

### 文档 `docs/`
| 文件 | 内容 |
|---|---|
| `PRD.md` | v0 需求定稿：§3 MoSCoW（**M1–M18**，M7 已废除）/ §4 **US-01~US-12** / §7 **E1–E25** / §8 空状态（10 个）/ §9 **D1–D18** / §11 **Q1–Q7**（Q2 已关闭） |
| `CORE-API.md` | core 层 TS 契约，**13 个模块**（§5.1–§5.11），3 条铁律 |
| `adr/0001~0008` | 存储选型 / SW 策略 / 金额整数分 / lunar 懒加载 / **响应式三视图** / core 无 React / CSS Modules / 自写 date |
| `README.md` | 索引；冲突优先级 **PRD > CORE-API > adr > SPEC** |

`SPEC.md`（仓库根）= 决策日志；其 §5 数据模型已被 PRD §6 取代。

### 原型 `prototype/index.html`
**v6.1**（日/周/月三视图 + 默认日视图 + 单一录入入口），**66,284 bytes**、1053 行、手写 CSS 298 行 / 约 209 条规则，**零依赖**。

> ⚠️ **不需要服务器**。它是纯静态单文件：无 ES module、无 fetch、无 localStorage、无任何外部引用。
> 直接 `open prototype/index.html` 即可。（曾经挂过一个 nohup http.server，**已杀掉**——用户正确质疑了它的必要性。）

`smoke.cjs`（jsdom）**218 项断言全通过**，覆盖：默认落地 / 顶部框移除防回归 / 金额取整 / 心情移除 /
空白日自动展开 / 三类内联表单 / 月周回归 / 顺延 / 弹层 / 翻日与步进量 / **手机三条返回路径** / 对比度。

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
> ⚠️ `validate.ts` 里的 **`parseQuickExpense` 自 v6.1 起没有调用方**（唯一消费者是被移除的顶部框）。
> 函数与它的 15 个测试都还在，**未删**——删已测代码要用户点头。去留见 PRD §11 **Q7**。

另有 `src/prototype-parity.test.ts`（**不在 `src/core/` 下**，以躲开 `isolation.test.ts` 的 `./**/*.ts` 源码扫描）：
把原型的 `toCents()` 与 core 的 `parseAmount()` 用 40 组输入逐位比对。用 `import.meta.glob(..., ?raw)` 读原型
而不是 `node:fs`——因为 `src/` 归 `tsconfig.app.json` 管（`types: ["vite/client"]`），出现 node 内置模块编译不过。
jsdom 本身早已是 devDependency，本轮补装了缺失的 **`@types/jsdom`**。

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
7. ~~原型是否跟进 v6~~ → ✅ 已升到 **v6.1**（三视图 + 单一录入入口），smoke 218 项全绿
8. **等用户拍 PRD Q7**：`parseQuickExpense` 删还是留（建议删，约 30 行 + 15 个测试）
9. **等用户拍 PRD Q6**：金额输入要不要吃 `¥` / `￥` 前缀（建议吃，约 1 行 + 2 个测试；现在 core 拒绝，原型已与之对齐）

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
- **对比度**：`--ink-3 #767676` 是文字下限（4.54:1）；`--ink-4 #C4C4C4` **只能用于装饰**，v6.1 起白名单**仅 `.empty .big` 一处**（`.qadd:disabled` 随顶部框一起删了）。
- **录入入口只有一个**（v6.1 / PRD D18）：日详情各区块的内联表单，写入目标恒为当前选中日。**不要重新引入任何常驻快捷录入框**——它会带回"看着 A 天写进今天"这一整类错误。
- **UI 侧金额换算必须与 `core parseAmount` 逐位一致**（ADR-0003），由 `src/prototype-parity.test.ts` 强制。**禁止 `Math.round(parseFloat(x)*100)`**。

## 6. 环境事实

工作目录 `/Users/wangduanmao/DayCell`；sandbox `workspace-write`。
> ✅ **已 `git init`**（2026-09-29，用户批准）。分支 `main`，`.git` 约 740 KB。
> `.gitignore` 忽略 `node_modules/`(220M)、`.npmcache/`(447M)、`coverage/`、`*.tsbuildinfo`。
> **`.npmcache` 必须忽略**：沙箱下 `~/.npm` 不可写，装包一律 `--cache ./.npmcache`，
> 它会在项目目录里长出几百 MB 缓存。同样规则也写进了 `.git/info/exclude`（仓库级，
> 对 `--work-tree` 指向别处的提交也生效）。
>
> 前三个提交：① v6.1 改动前的追溯快照（取自 `/tmp/daycell-v6-snapshot`，**不是当时的真实提交**，
> 提交信息里已写明）② `git init + .gitignore` ③ v6.1 改动本身。
> 这样做的目的是让 v6.1 成为一个**可审阅的单一 diff**（`git show HEAD`）。
>
> 以后不需要再手动 tar 快照了；但**破坏性改动前先 `git status` 确认工作区干净**，
> 否则改动会和上一轮的未提交内容混在一个 diff 里。
`~/.npm` 被沙箱挡 → 装包一律 `npm install --cache ./.npmcache --no-audit --no-fund`。
Node v24.18.1 / npm 10.9.8 / Python 3.9.6 / macOS（`cat -A` 不可用，用 python 看 repr）。
**无 Xcode**（排除原生 iOS）、**无浏览器 provider**（视觉只能用户自己看）、**`web_search` 不可用**（不要断言未验证的第三方平台事实）。
系统日期 **2026-09-29 周二**。
栈：Vite 8.3.1(Rolldown) / TS 5.9.3（**不能升 7**，typescript-eslint 8.71 peer `<6.1.0`）/ React 19.3 / Zustand 5 / idb 8.0.3 / lunar-typescript 1.8.6 / Vitest 5.0.2 / lightningcss / fake-indexeddb。
`vite.config.ts` 的 `manualChunks` **必须用函数形式**，Rolldown 不接受对象形式。
**idb v8 的坑**：`IDBPDatabase` 只有 1 个泛型参数；`getAllFromIndex` **只挂在 database 上**，事务内必须 `tx.objectStore(s).index(name).getAll(range)`；`IDBKeyRange.bound(lo,hi)` 在 `lo>hi` 时抛 `DataError`（空区间要先短路返回 `[]`）。

## 7. 未决（等用户拍）

- PRD §9 **D1–D18 默认值表从未被逐条确认过**（D16/D17/D18 是 v6/v6.1 新增，方向已口头确认）
- PRD §11：Q1 回看价值靠什么撑（我建议真实用两周后再议）/ ~~Q2~~ **已关闭** / Q3 调休数据源 / Q4 部署平台 / Q5 v1 同步存储 / **Q6 金额吃不吃 `¥`** / **Q7 `parseQuickExpense` 删不删**
- 遗留物去留：`genlunar.cjs`、`smoke.cjs`、`prototype/`。
  ⚠️ 注意 `src/prototype-parity.test.ts` **依赖 `prototype/index.html` 存在**——删原型时必须连它一起删（文件头注释已写明）
- ~~是否 `git init`~~ → ✅ 已做（见 §6）。**遗留物去留那条现在可以真的执行了**：删 `prototype/` 时记得连 `src/prototype-parity.test.ts` 一起删

## 8. 用户沟通偏好

少给选项、不给矩阵；解释控制在两句内；**给带理由的推荐**而不是菜单；直说权衡与不确定性；**改动前先说清代价**。
用户会自己发现真问题并推翻自己之前的指令（v6 把默认视图从周改成日；v6.1 又砍掉了 v5 定稿的双路径录入）。
他会问"你觉得是不是有必要"——**这是真的要你的判断和理由，不是客套**；判断完要连带说清代价，再动手。
他也质疑过工具链的必要性（"原型图为什么需要连服务器？不是静态 html 么"）——**他是对的，不要为省事引入不必要的依赖**。
