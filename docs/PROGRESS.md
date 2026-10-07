# DayCell 实施进度快照

> **这份文件的用途**：让会话上下文可以安全丢弃。接手时先读这份，再按需读 PRD / CORE-API。
> 最后更新：2026-10-07 · **v7.9 阶段性目标模块**（见 §0m）；此前 v7.8 logo 高清化重制（§0l）、v7.7 logo 上架（§0k）、v7.6 支出改造（§0j）、v7.5 菜单/备份/纪念日/夜间（§0i）、v7.4 录入手动化 + 月汇总条 + 旧「小格」logo（§0h）、v7.3 应用名 + 底部切换器（§0g）、v7.2 手机端录入打磨（§0f）、PWA 已接线 + dist 重建（§0e）、v7.1 月格三行 + 启动页（§0d）
> 当前状态 **全绿**：`tsc -b` 0 错 / `eslint .` 0 错 / **562 测试通过**（17 文件）/ `node smoke.cjs` 218 项断言（只守原型，见 §0c）
> **已 git 化**（分支 `main`）。core 层 **13/13 模块全部完成**（含 `backup/*`，v7.5 补齐）。

---

## 0m. ★ v7.9 阶段性目标模块（2026-10-07，用户指令）

**需求原话（多轮对齐后锁定）**：阶段性目标（复习考公 / 每天多喝水 / 做教案）不适合放每日待办。用户拍板：**不要跟待办/支出联动、不要语义分层、不做每日打卡**；只有目标 + 当前所处阶段 + 阶段百分比 + 备注；**单独一个页面**（不放今天视图），上显示当前阶段、下面是该目标所有阶段，可管理、可回看历史；**去掉子阶段**；入口**放底部 tab 第 4 个「目标」**（不进右上角菜单）；详情页**顶部主展示目标阐述，下方才是阶段列表**。账单总结不单独建模块 = 目标的一种用法（建「账单管理」目标，每月一个阶段，备注放总结文字）。验收原型 `prototype/goals.html`（已交付 present_files，用户"非常好，直接开始写"）。

**实现落点**：
- **core**：`types.ts` 加 `GoalRecord`（type:'goal'，title + note 阐述）/ `StageRecord`（type:'stage'，goalId + title + pct? + note + done + isCurrent），`ALL_STORES`/`RecordTable` 八表；`validate.ts` 加 LIMITS 4 项 + parseGoalTitle/parseStageTitle/parseGoalNote/parseStageNote/parsePct；`repo` 加 `GoalRepo`（all/create/update/softDelete **级联软删阶段**，单事务）/ `StageRepo`（byGoal/create **第一个阶段自动 isCurrent** /update **pct:null 显式清空** /setCurrent **同目标互斥 + 目标阶段清 done** /setDone/softDelete）；`aggregate` 加 `goalSummaries`（一次取全表分组，createdAt 升序）/ `stagesOfGoal`（当前置顶，其余时间线）；`backup` serialize/parse/merge 三段含 goals/stages（**旧备份无这两段按空表处理**，v7.9 前备份仍可导入）；`idb.ts` 加 **`DB_VERSION = 2`** 与 SCHEMA_VERSION **刻意解耦**（库版本只管 object store 集合，已装用户 upgrade 补建 goals/stages；SCHEMA_VERSION 保持 1 → 旧备份兼容），upgrade `oldVersion < 2` 分支建两个新 store
- **UI**：`store.ts` `View` 扩为 `'day'|'week'|'month'|'goals'`（goals 视图 refresh 只刷 goalList，不加载日历聚合；shift 对 goals no-op）；`TabBar` 第 4 tab「目标」星形图标（与原型一致）；`App.tsx` goals 视图整屏替换 .cal/.detail（CSS data-view='goals' 单列）；`TopBar` goals 标题「目标」、翻页/今天按钮隐藏；新组件 `GoalsView.tsx` + `GoalsView.module.css`（列表卡片 / 阐述主展示 + 编辑 / 阶段行展开 ops：设为当前·标记完成·编辑·删除 / 新建目标、添加/编辑阶段底部弹层），视觉与原型一致、全部用现有 tokens 自动适配夜间
- **测试**：`src/core/repo/goals.test.ts` 19 项（CRUD、首阶段自动当前、互斥、pct 边界、级联删、墓碑回看、聚合排序、备份往返/旧备份兼容/合并统计）；`src/ui/GoalsView.test.tsx` 5 项（空状态、新建、详情主展示、互斥、删除回列表）→ 535 → **559**

**验证**：tsc / eslint 0 错；559 测试全绿（17 文件）；build 通过（PWA precache 15 entries）。已提交推送，GitHub Actions 部署后线上验证。

**文档落点**：PRD 修订行 v1.9；本节。

**§0m 补记（同日，用户指令「怎么点击完成让它到已完成列表里」）**：目标本身新增**整体完成**——`GoalRecord` 加 `done` 字段（读路径归一化：旧记录/旧备份无此字段一律按 false）；`GoalRepo.setDone`；`aggregate.goalSummaries` 进行中在前、**已完成沉底成组**（同组 createdAt 升序）；UI：列表页分「进行中的目标（n）/ 已完成的目标（n）」两组（已完成卡片淡出 + 绿「已完成」徽标），卡片与详情页顶栏都有「标记完成 / 恢复进行中」按钮；测试 559 → **562**。

**遗留**：真机过一遍目标 tab 全流程（滑杆、夜间模式下的徽标对比度）；旧备份导入在新版本上确认一次。

---

## 0l. ★ v7.8 logo 高清化重制（2026-10-03，用户指令）

**需求原话**：「这是该网页目前的 logo，但其实只是图片，清晰度很低。因为是裁剪下来的，四周四个角都没有被裁剪下来。能不能把它转换成完全一样的新格式，使它更清晰且符合 APP logo 的形状，做出一个一模一样的，换上去并推上去」

**原图分析（实测）**：486×483（非方形）。四周有白底残留：**仅左上角为纯白 (255,255,255)**，其余三角为浅蓝光晕（(223,242,254) 等）；渐变主体（b-r>60）几乎铺满全幅（bbox 4,0–485,478），左上角从白底斜向过渡到深蓝渐变；白卡片≈(91,136)-(305,360)、对勾≈(91,136)-(304,359)。原图**无任何纯黑像素**。

**落地方式**：新脚本 `scripts/gen-logo-hi.py`（Pillow，可复现）替换 `scripts/gen-logo-icons.py`：
1. **白底透明**（r,g,b 全 >248 → alpha 0）→ 得到内容 mask
2. **迭代 inpaint**：透明区 RGB 用邻域内容色填充（MaxFilter 5 核、迭代至填满）——消除"白底 255 vs 渐变 10"的插值硬跳变
3. **LANCZOS 放大 2048 母版**（保留渐变与光晕原样比例）
4. **标准圆角方形 mask**（半径 22.3%，iOS 风格）叠加，圆角边缘羽化 3px 自然淡出
5. **半透明像素 RGB 归一化**（straight alpha 反预乘，避免黑画布插值残留）
6. **UnsharpMask 轻锐化**（radius 1.8 / 50% / threshold 4）→ 更清晰
7. 从 2048 母版缩出全套：`logo.png`(512) / `pwa-192x192.png` / `pwa-512x512.png` / `apple-touch-icon-180x180.png` / `maskable-icon-512x512.png`(82% 居中)

**关键排障**（为什么一路踩坑）：
- 首版 LANCZOS 直放 + 硬边 alpha 后出现 **70847 个纯黑像素**（原图无黑）——根因是 **LANCZOS 负波瓣在"白底 255 ↔ 渐变 10"强边缘振铃**，且圆角 mask 黑色画布经羽化插值后残留暗色
- 逐个隔离验证：羽化 alpha（1.0~2.0）单独有效（0 黑），但叠加圆角 mask + 锐化后复现；BICUBIC/BILINEAR/HAMMING 均无效（振铃在内容边缘，非 alpha 边缘）；锐化前后顺序无关（39840 恒定）→ 确认振铃源是 **RGB 通道在 alpha 边缘的内容插值**，而非 alpha 本身
- 最终组合：**inpaint 填平透明区 → LANCZOS 放大（0 黑）→ 圆角羽化 mask → 半透明归一化 → 轻锐化 = 0 黑点**；四角 alpha 全 0

**验证**：tsc / eslint 0 错；535 测试全绿（15 文件，纯资源替换无逻辑改动）；build 通过（PWA precache **15 entries** ~1899 KiB，图标全部进 dist）。已提交推送，GitHub Actions 部署后线上验证。

**文档落点**：PRD（M19 修订行 v1.8）；本节。`scripts/gen-logo-icons.py` 作废（被 gen-logo-hi.py 取代）。

**遗留**：真机确认 512 版顶栏 20px / splash 64px 观感；已安装 PWA 需重新添加到主屏刷新图标。

---

## 0i. ★ v7.5 右上角菜单 + 备份导出/合并导入 + MD 导出 + 纪念日设置 + 夜间模式（2026-10-01，用户指令）

**需求原话（多次澄清后锁定）**：「①右上角菜单栏，点开显示很多功能 ②夜间模式（手动开关，不跟随系统）③备份的导出、导入 ④一键导出本周或本月的数据（点开弹本周/本月）⑤设置纪念日，每周/每月/每年 + 自定义名字 ⑥导入用**合并**（覆盖会丢数据）⑦关于暂时先不实现 ⑧菜单项顺序：导出备份 / 导入备份 / 一键导出 MD / 纪念日设置 / 夜间模式放最下面 / 再下面放关于 ⑨手机端菜单栏也在右上角 ⑩今天视图最上边不再显示日期和周几（中间已展示，重复）」

**落地方式**：
1. **右上角「⋯」菜单**（`TopBar.tsx` + `icons.tsx` Ellipsis + `TopBar.module.css`）：手机端同样右上角（浮层右对齐）。菜单项顺序按用户原话：导出备份 / 导入备份 / 一键导出 MD（二级弹本周/本月/返回）/ 纪念日设置 / 分隔线 / 夜间模式 switch（最下面）/ 分隔线 / 关于（占位 toast「关于页即将上线」）。点 mask 外部关闭。
2. **夜间模式**：`store.theme('light'|'dark')` + `setTheme`；`tokens.css` 新增 `[data-theme='dark']` 全变量集（对比度按 WCAG AA 重算：ink 16.3:1 / ink-2 9.3:1 / ink-3 6.0:1 / accent #7C9BFF 7:1 / accent-strong #4663D2 5.2:1）；`index.html` 内联脚本在 splash 渲染前同步 `data-theme` + `theme-color`（无闪烁）+ `color-scheme: light dark`；DayView/detail/MonthView/WeekView 白字背景改 `--accent-strong`。手动开关，不跟随系统。
3. **备份导出/合并导入**（新模块 `core/backup/index.ts`，已注册 `core/index.ts`）：
   - `serializeBackup`：全表含墓碑 + settings（Clock 注入）；`parseBackup`：app/version/schemaVersion/exportedAt/逐记录 type/字段/settings key 白名单全量校验，坏即抛 `BackupCorruptError`（「现有数据未改动」）；`mergeBackup`：**合并口径**——按 id 去重、本地优先、备份墓碑不导入、settings 本地 key 不覆盖只补新 key、`store.tx` 单事务、所有写入 `keepTimestamps:true` 防 LWW 反转，返回 MergeStats。
   - `store.exportBackup`（JSON 下载 `daycell-backup-YYYY-MM-DD.json`）/ `importBackup`（parse→merge→aggregates.invalidate→refresh→toast「已合并导入 N 条记录」；菜单隐藏 `<input type=file accept=application/json>`）/ `exportMd('week'|'month')`（`renderRangeMd`：标题→区间→每日「待办 checkbox / 想法引用块 / 花费-分类¥金额（备注）」→每日小计→区间合计，墓碑过滤）。
4. **纪念日设置**（新页 `AnnivSettings.tsx|module.css`）：全屏覆盖层；列表（标题 + 中文频率描述，点击编辑/删除 confirm）；表单——名称 ≤20、频率 seg 每周/每月/每年/仅一次，**每周选星期几**（date 存本周一起的基准日）、**每月选 1–31 日号**（date 存 `当年-01-DD`）、**每年选公历/农历 + 月日 + 闰月 checkbox**（date `2000-MM-DD` 闰年锚定）、**仅一次选公历/农历日期**；`dateExists` 校验。同日多纪念日显示「前 2 个 +N」（聚合 `anniversaryTitles`）。
5. **core 扩展**：`AnniversaryRecord.repeat` 加 `'weekly'|'monthly'`；`ValidateCode` 加 `'BAD_VALUE'`；repo 创建/更新加组合校验（weekly/monthly 拒绝农历，**update 按合并后最终值判断**——修 repo 测试时发现只改 isLunar 的路径会漏）；`aggregate.annivHitsOn(record, dateKey, lunar)` 纯函数（none 精确日 / weekly 比 dowOf / monthly 比日号 / yearly 比 MM-DD；农历只走 none/yearly），`anniversaryTitles`/`anniversaryRecordsOn` 复用（删除旧的 `yearsOf`+`resolveSolarAnniversary` 展开法）。
6. **今天视图顶栏**：`TopBar` day 分支 title=''（v7.4 的「1 日 周二」也去掉），只留品牌；内容区 dtitle 完整日期保留（不重复）。

**测试**：532 全绿（15 文件，较 v7.4 的 501 +31）：
- `backup.test.ts` 14（serialize 含墓碑 / parse 6 类非法 / merge 新增-保留-墓碑-设置 / 渲染含小计合计）
- `aggregate` 新增 3：weekly（9 月视图 42 格 8/31~10/11 内周三命中——**初版断言误用 10/14/21/28，实际不在网格里，已修**）、monthly（15 号命中；**2 月视图含 1/31，31 号用例的断言修正**）
- `repo` 新增 3：weekly/monthly 创建、农历组合拒绝、**update 改成农历也拒绝**（由此修了 repo 按最终值校验的实现 bug）
- `store` 新增 6：setTheme Node 安全、纪念日 CRUD 刷新列表、非法输入 toast、**合并导入**（同 id 本地优先 + 新记录补入 + 设置补新 key——测试里两次 makeApp 各建新内存库导致 existing 取空，已修）、坏文件、exportMd/exportBackup Node 安全
- `App.test.tsx` 新增 3：今天顶栏无日期周几、菜单顺序 + 夜间 switch（data-theme + localStorage）、纪念日设置每周流程；`renderApp` 加 `localStorage.clear()` 防 theme 串场

**tsc / eslint 0 错；`npm run build` 通过**（PWA precache 13 entries ~634 KiB）。

**文档落点**：PRD（修订行 v1.4 / US-09 修订 / M19 修订?——夜间与菜单 / 新增备份与纪念日条目）；SPEC（版本行 / 决策表 / §3.x 新增菜单与主题）；CORE-API（§5.8 backup 补齐）；本节。

**遗留**：真机验收菜单浮层、夜间模式视觉、导入导出文件流；「关于」页占位；纪念日同日多条的「+N」折叠规则待真机确认。

## 0j. ★ v7.6 「花费」→「支出」+ 支出表单去分类 + 待办完成沉底 + 导出保存提示 + 应用名 DayCell（2026-10-01，用户指令）

**需求原话**：「①把花费改为支出 ②添加支出不需要指定分类，先指定做了什么，然后指定花了多少钱，金额前加 ¥ ③待办里已完成的自动挪到最下边 ④一键导出/备份打开后直接给了文本，没告诉保存 ⑤网页名字改为 DayCell」

**落地方式**：
1. **「花费」→「支出」**：用户可见文案全部改（区块标题「支出」、按钮「记一笔支出」、MD 导出 `### 支出`、删除按钮 aria-label 原已是「支出」）；内部英文标识（expense/costCents/categoryId）与 CSS 类名不动（core 契约与测试零破坏）。
2. **支出录入去分类**：`ExpenseSection` 表单删掉分类 select；顺序改为**先「做了什么」（备注）→ 金额（固定 ¥ 前缀，`.yenWrap` 包裹）**；未指定分类的支出统一归「其他」（DEFAULT_CATEGORIES 恒有，E21 归并照常）；列表不再显示分类小标签（全是「其他」无信息量），`byCat` 只剩一项时不显示汇总条（原有逻辑）。store `lastCatId`（S5 会话记忆）保留字段不再被 UI 使用。
3. **待办完成沉底**：`TodoSection` 渲染前 `[...todos].sort((a,b) => Number(a.done) - Number(b.done))`（稳定排序：已完成沉底，未完成保持原序）；进度 `done/total` 计数用排序后列表（结果不变）。
4. **导出保存提示**：`exportBackup` / `exportMd` 的 toast 改为明确文件名与去向——「已导出备份：daycell-backup-2026-10-01.json（文件在浏览器下载列表）」/「已导出：daycell-周记录-2026-09-28.md（文件在浏览器下载列表）」。
5. **应用名 DayCell**：`index.html` title / `apple-mobile-web-app-title` / `vite.config.ts` manifest `name`+`short_name` / 顶栏品牌全部改为「DayCell」（去掉「人生小格·」前缀）；splash（启动页）保留 DayCell 主视觉 + 「人生小格」中文副题（v7.1 用户拍板过的品牌视觉，未动）；MD 导出标题改「DayCell · 本周/本月记录」。

**测试**：532 → **534**（App.test.tsx 新增 2：支出表单无分类选择 + 做了什么/¥ 金额存在；待办完成沉底 DOM 顺序断言）。tsc / eslint 0 错；`npm run build` 通过（PWA precache 13 entries ~634 KiB）。

**文档落点**：PRD（修订行 v1.5 / US-03 录入修订 / M18 应用名修订）；SPEC（版本行 / 决策表）；本节。

**遗留**：~~支出/想法创建后自动弹出新条目~~ → ✅ **2026-10-01 追加：已改为创建完收起**（与待办一致，见 §0j 补记）；真机确认支出表单新布局（做了什么 + ¥ 金额）手感；应用名 DayCell 在已安装 PWA 主屏上需重新添加到主屏才生效（short_name 缓存）。

> **§0j 补记（同日追加）**：用户反馈「每日的支出和想法，创建成功之后也会自动弹出来让你创建新条目的东西，这个也得去掉」——`ExpenseSection` / `NoteSection` 的 submit 成功后由「清空+保留焦点连续录入」改为 `closeForm()`（与 v7.4 待办口径完全一致）；测试 534 → **535**（App.test.tsx 新增「支出/想法创建后面板收起」冒烟）。

---

## 0k. ★ v7.7 logo 更换为用户提供的图标（2026-10-01，用户指令）

**需求原话**：「把这个作为该网页的 logo」（用户上传 486x483 图片：浅蓝渐变圆角方形 + 白色圆角矩形 + 蓝色对勾）。

**落地方式**：
1. **原图入库**：`assets/logo-user.png`（WebP → 保留原文件）；新脚本 `scripts/gen-logo-icons.py`（Pillow，一次性可复现）生成 5 个 PNG 到 `public/`：
   - `logo.png`（512，顶栏 + splash 共用）、`pwa-192x192.png`、`pwa-512x512.png`、`apple-touch-icon-180x180.png`（iOS 系统自动圆角）、`maskable-icon-512x512.png`（512 画布 logo 缩至 82% 居中留安全区）
2. **顶栏**：`BrandMark.tsx` 由内联 SVG（旧「小格」）改为 `<img src={BASE_URL+'logo.png'}>`；`.brand img` 20px 圆角 5px。
3. **启动页 splash**：`index.html` `.sp-logo` 内联 SVG 改为 `<img src="/DayCell/logo.png" width=64>`；深色变体里针对旧 rect 的 CSS 删除（img 自带浅蓝背景，深浅色均正常）。
4. **PWA manifest** 图标路径不变（仍指向 public 同名文件，内容已换新）。

**验证**：tsc / eslint 0 错；534 测试全绿（纯渲染替换，无逻辑改动）；build 通过（PWA precache **14 entries** ~1041 KiB，图标全部进 dist）。已提交推送，GitHub Actions 部署后线上验证 title/图标。

**文档落点**：PRD（M19 修订）；本节。

**遗留**：真机确认顶栏 20px 与 splash 64px 的观感（可调尺寸）；已安装 PWA 需重新添加到主屏刷新图标（manifest 缓存）。

---

## 0h. ★ v7.4 录入手动化 + 今日顶栏去年月 + 月消费汇总条 + 新 logo（2026-10-01，用户指令）

**需求原话**：「①创建完待办会自动弹创建新待办的窗口，改成手动 ②今日视图上面的某年某月不显示 ③月视图加本月消费，位置与本周消费一致 ④logo 在哪里设定，换一个吧」

**落地方式**：
1. **待办创建后收起表单**：`TodoSection.tsx` 的 `submit` 成功后直接 `closeForm()`（删除"保留并清空 + 重新聚焦"的连续录入；`ref` 同步移除）。花费/想法表单的连续录入**保持不变**（用户只点名待办）。PRD US-01 修订。
2. **今日视图顶栏不显示年月**：`TopBar.tsx` day 分支 `title = "1 日 周二"`（原 `2026 年 9 月` + small 日期），年月整体去掉；周/月视图标题不变。内容区 dtitle 的完整日期保留（语义不同）。
3. **月视图「本月消费」汇总条**：`MonthView.tsx` 星期头上方新增 `.mbar`——左 `N 天有记录`、右对齐 `本月消费 ¥xxx.xx`，样式/位置对齐周视图 `.weekbar`（bg-subtle + border-bottom）。数据用 `month.summary.daysWithRecords / costCents`（core 已有）。
4. **新 logo「小格」**：accent（#2E4BA6）圆角方块 + 白色田字格线 + 右上实心格（人生小格 = 被标记出的那一格）。三处同源：`BrandMark.tsx`（顶栏内联 SVG，fill var(--accent)）、`index.html` splash（sp-brand 上方加 34px 内联 SVG）、PWA 图标（`assets/logo.svg` + `assets/logo-maskable.svg` → sharp 转 4 个 PNG 覆盖 `public/*.png`）。原 CSS 两横线 `.mark` 删除。

**测试**：501 全绿（App.test.tsx 用例 2 断言改为"保存后表单收起"）。tsc / eslint 0 错，`npm run build` 通过（PWA precache 13 entries）。

**文档落点**：PRD（修订行 v1.3 / **US-01 修订** / **US-06 修订** / **M19 修订** / US-09 顶栏年月）；SPEC（版本行 / §3.2 汇总表 / §3.3 连续录入 / §3.7 启动页与 logo / 功能清单）；本节。

**遗留**：新 logo 与月汇总条的真机视觉需用户确认；花费/想法表单若也要"创建完收起"需用户明确（当前保持连续录入）。

---

## 0g. ★ v7.3 应用名 + 底部视图切换器（2026-10-01，用户指令）

**需求原话**：「①网站默认名字叫『人生小格·DayCell』②今天/周/月切换器固定在页面下方，稍微明显一点，适配手机端交互风格 ③每个页面上方体现网站名字和 logo」

**落地方式**：
1. **应用名定稿「人生小格·DayCell」**：`index.html` `<title>`、`vite.config.ts` PWA manifest `name`、顶栏品牌文字三处统一（原「人生小格 DayCell」/ 顶栏只显「DayCell」）；`short_name「人生小格」`、splash 视觉（DayCell + 人生小格）不动。
2. **底部固定切换器**：新建 `src/ui/TabBar.tsx` + `TabBar.module.css`——fixed bottom + `env(safe-area-inset-bottom)`，三 tab（今天=时钟图标 / 周=四横线 / 月=网格，20px 内联 SVG + 文字竖排），active 高亮 accent 色 + 顶部 3px 指示条（"明显一点"的落点）；桌面端共用同一组件。`App.tsx` 接入 TabBar，`.app` 加 `padding-bottom: calc(58px + safe-area)`，toast 上移避开。TopBar 移除 `.seg` 切换器与 `setView`，品牌名手机端也常显（原 `.brand span{display:none}` 删除，字号 13.5px 防挤占）。快捷键 d/t/w/m 不变（App.tsx 全局）。
3. **页顶品牌**：TopBar 左端 logo（`.mark`）+「人生小格·DayCell」文字，三视图共用顶栏 → 每个页面上方均可见。

**测试**：501 全绿（App.test.tsx 用例 1 的日头「今天」徽标断言改按类定位——TabBar 的「今天」文字与其同名）。tsc / eslint 0 错，`npm run build` 通过（PWA precache 13 entries）。

**文档落点**：PRD（修订行 v1.2 / **M18 修订** / **D17 修订** / §10 验收清单）；SPEC（版本行 / §3.2 底部切换器 / §3.7 应用名记录 / 功能清单）；本节。

**遗留**：底部 tab bar 与品牌名的真机视觉需真机确认；iOS 底部安全区（`env(safe-area-inset-bottom)`）在真机 PWA 全屏下的表现需真机验收。

---

## 0f. ★ v7.2 手机端录入打磨（2026-10-01，用户指令）

**需求原话**：「①去掉『回车保存』的字样（手机端没有对应按键）②页面自动打开时默认弹出的『添加待办』去掉，手动添加时再弹出来 ③添加待办/想法时页面不允许放大，保持原来的尺寸」

**落地方式**：
1. **移除快捷键提示文案**：`FormActs` 的 `tip` prop 与渲染整体删除（待办/花费「回车保存」、想法「⌘/Ctrl+回车保存」、想法编辑态「回车换行 · ⌘/Ctrl+回车保存」）；`.tip` 样式类删除、`.acts` 改右对齐。**快捷键行为保留**（桌面端回车 / ⌘+回车仍有效，见 US-02/US-13），只是不再展示提示。
2. **移除空白日自动展开**：`store.refresh()` 不再对空白日自动展开待办表单并聚焦；`formDismissed` 状态（类型定义 / 初值 / openForm / closeForm 写入）整体删除；openForm 保留「再点同一个 + 添加 = 收起」。录入改为**手动点「+ 添加」**才展开并聚焦。
3. **输入时页面不缩放**：`index.html` viewport 加 `maximum-scale=1,user-scalable=no`（PRD **D20**）。表单字号 13–13.5px < 16px，不锁的话 iOS Safari / Android Chrome 聚焦输入框会自动放大页面、视觉跳动。**代价**：用户无法手动双指缩放页面（个人工具应用，已接受）。

**测试**：503 → **501**（`store.test.ts` 删 3 个自动展开专属用例、新增 1 个「换日不自动展开」，其余改写为手动语义；`App.test.tsx` 5 个冒烟改写「先点 + 添加再录入」）。`tsc -b` / `eslint .` 0 错。

**文档落点**：PRD（v6.1 决定段追加修订 / 场景 A / M8 / **US-01 重写** / §8 空状态表与表单展开说明 / **D18 修订 + D20 新增** / §10 验收清单）；SPEC（版本行 / 决策表两行 / §3.2 viewport 锁定 / §3.3 手动展开 / 功能清单 / 决策记录）；本节。

**遗留**：viewport 禁缩放的真机手感需真机确认；`prototype/index.html` 仍停在 v6.1（含自动展开与顶部框），`smoke.cjs` 只守原型自身回归、不受影响；删原型时连 `src/prototype-parity.test.ts` 一起删（既有记录）。

---

## 0e. ★ PWA 接线 + dist 重建（2026-10-01，用户指令「做成 PWA 然后构建 dist」）

**按 ADR-0002 落地，零新依赖**（`vite-plugin-pwa` 1.3.0 本来就在 devDeps）：

- `vite.config.ts`：`VitePWA({ registerType: 'prompt', injectRegister: null, ... })`
  - **precache 全部构建产物**（含懒加载 lunar chunk）→ 首访后完整离线（US-11）；16 条清单里 4 条 URL 重复（插件把 manifest 引用的图标追加了一遍），workbox 按 cache key 幂等，实测无害
  - `registerType:'prompt'` = 不自动 skipWaiting/clientsClaim（E20：不在运行中偷换资源）。⚠️ generateSW 产物里**总有一段** `message: SKIP_WAITING → self.skipWaiting()` 监听——v0 没有发送方，它是为将来「有新版本点击刷新」提示预留的，不违背 E20（已核对产物确认）
  - `injectRegister:null`：注册收敛到 `src/main.tsx` 一处（挂载后 window.load 时，不占首屏关键路径；失败静默——离线是增强不是前提）。第一版忘了关，dist 里长出没人引用的 `registerSW.js` 且与手动注册构成双重路径，已修
  - 图标不写 `includeAssets`（globPatterns 的 `*.png` 已捕获，两处写会重复）
  - 无任何 runtime caching（§5.4 运行时零网络请求）；`navigateFallback:'/index.html'`
- manifest：`name「人生小格 DayCell」/ short_name「人生小格」（主屏名）/ start_url '/?source=pwa' / display standalone / lang zh-CN / 192+512+maskable`
- `index.html`：iOS meta 四件套（`apple-mobile-web-app-capable` 等）+ `apple-touch-icon`（E3：装主屏才豁免 ITP 7 天清数据）
- **图标是 `scripts/gen-icons.mjs` 生成的**（新增，已提交）：手写 PNG 编码器（zlib deflate + CRC32，~60 行），accent 圆角方 + 白色两横（与 TopBar `.mark` logo 同源），maskable 版内容缩进 20% 安全区。**不装 sharp/jimp**——一次性脚本不值得引入原生二进制依赖。改图标 = 改脚本重跑，产物直接提交

**dist 交付**（2026-10-01 重建，含 v7 + v7.1 + PWA）：
- `dist/` 15 文件 644 KB；`daycell-dist.zip` **201 KB**（内容在 zip 根，拖拽部署口径与上次一致）
- `vite preview` + curl 验证：`/`、`/sw.js`、`/manifest.webmanifest`、图标、主 JS 全 200 且 content-type 正确
- 首屏 gzip ≈ **91 KB**（react-dom 独占 65 KB）——仍超 PRD §5.1 的 80 KB 预算，**预算口径（vendor 算不算）仍未拍**（§4 第 4 条）；lunar 102 KB 懒加载不计入
- ⚠️ **验收还差真机一步**（PRD §10）：iOS Safari 部署到 HTTPS → 添加到主屏幕 → 飞行模式 → 从主屏启动能读能写。沙箱无浏览器 provider，SW 实际注册行为只能真机确认

---

## 0d. ★ v7.1 需求（用户 2026-09-30 提出，**代码与文档均已落地**）

**需求原话**：「①月视图每天的信息太紧凑、不够明显，要清晰看到每天的花费/待办数量/是否有想法 ②打开网站加初始动画：DayCell + 中文名『人生小格』+ 作者『以端枳』，要美观简洁。」

**先讨论后动手**（用户明确要求）：给了月格三方案与 splash 两种实现层，用户拍板 4 项：进度用 `✓2/5` / 想法点保持 ink-3 灰（不加强调色）/ **splash 每次固定 1.5s**（放弃"就绪即走"）/ `<title>` 改「人生小格 DayCell」。第二轮用户追加：**行2 必须是花费、想法点放第三行右下角**（推翻了我"想法点挪到行1"的草案）。

**顺手修掉的真 bug**：旧 MonthView 把整个底部指标行包在 `todoTotal > 0` 里——**只记花费或只记想法（无待办）的日子，花费和想法点根本不渲染**。用户"看不到花费"的主诉主要是它。变异检验：把 gate 塞回去 → 新测试 1 败。

**落地形状**：
- 月格固定三行：行1 日期+标签 / **行2 花费**（ink-2 + 600 字重 + tabular-nums，只要有就显示；纪念日徽章优先占此行）/ 行3 `✓done/total` 进度（左，全完成强调色 chip）+ **想法点右下角**（>1 条带数字）。邻月格只留行1
- 格子长高：桌面 76→88px、手机 68→76px（"紧凑"的解法是给空间，不是缩字）；E22（<320px 隐藏花费）指向新类 `.costRow`
- ✓ 用内联 SVG（`CheckMark`，stroke 与周行 Check 同源）——'✓' 字符在 9px 下会 fallback 到 emoji 体，不可控
- splash：内联 `index.html`（HTML+CSS+3 行兜底脚本），**固定 1.5s 后淡出 300ms**；四元素错峰上浮（0/0.12/0.24/0.36s）+ 强调色细线 scaleX 展开；`prefers-reduced-motion` 只留淡入淡出；启动抛错也按时退场（定时器不依赖 React）；meta author/description 同步「以端枳」
- **顺手修的 a11y 缺陷**：三个区块的「+ 添加」按钮可访问名完全相同（h3 不参与名字计算），屏幕阅读器分不清——已加区分性 aria-label（添加待办/记一笔花费/添加想法 + 收起态）。这是写新测试时暴露的

**改动文件**：`src/ui/MonthView.tsx`（重写格子 JSX + CheckMark）、`src/ui/MonthView.module.css`（三行结构/行高/E22）、`index.html`（splash + title + meta）、`src/main.tsx`（头注释：splash 自管生命周期）、`src/ui/{Todo,Expense,Note}Section.tsx`（aria-label）、`src/ui/App.test.tsx`（新增月格三行冒烟，502→503）。

**文档落点**：PRD（US-06 重写 / **M19 新增** / 修订行）、SPEC（§3.4 重写 + **§3.7 启动页新增** + 头部 v7.1）、本节。

**遗留**：splash 的视觉最终效果**只能用户真机确认**（沙箱无浏览器 provider；jsdom 测不了 CSS 动画）。dist 未重建（见 §4 第 0 条）。

---

## 0c. ★ v7 需求（用户 2026-09-30 提出，**代码与文档均已落地**）

**需求原话**：「①日视图左右切换非常不丝滑 ②无法修改已保存的想法和待办 ③日视图其实只代表今天，把今天和日合并；想看其他日子，在周/月视图点对应格子即可。」

**落地方式**：
1. **不丝滑 → 结构性解决**：不是调手势阈值，而是**删掉翻日**（与 ③ 合并处理）。横滑手势、日视图下的前后箭头、`shift(±1)` 全部移除；日详情换日只剩"周/月点格子"一条路，换日时旧内容保持可见（refresh 不清 detail）+ Web Animations 入场过渡（窄屏整屏滑入 220ms / 宽屏淡入 160ms，`prefers-reduced-motion` 尊重，jsdom 无 `el.animate` 静默跳过）
2. **就地编辑**：待办/想法点文字原位变输入框（US-13，原 Could-C3 提前实现）。回车保存（想法 ⌘/Ctrl+回车）、Esc 取消、**失焦有改动即保存**；校验复用 `repos.*.setText` → core `parseTodoText/parseNoteText`，无第二套规则；IME isComposing 守卫与新建表单一致
3. **今天/日合并**：切换器首标签「日」→「今天」；`setView('day')` 恒把 selected 复位为今天；快捷键 `d` 语义变为"回今天"（加 `t` 别名）；`j/k`/`←/→` 只在周/月生效。**内部 View 值仍是 `'day'`**（避免 CSS 属性选择器与测试大面积改名）

**代码改动落点**：
| 文件 | 改了什么 |
|---|---|
| `src/app/store.ts` | `shift()` 日视图 no-op；`setView('day')` 复位 selected=today；新增 `updateTodoText` / `updateNoteText`（repo→refresh→toast，与 create 同构） |
| `src/ui/DayView.tsx` | 删 touch 滑动与 swipeHint；新增 selected 变化时的入场动画（useEffect + el.animate，首挂载不播） |
| `src/ui/TopBar.tsx` | 首标签「今天」；日视图下前后箭头加 `navDay` 类隐藏（CSS Modules 类名不跨文件，规则放 TopBar.module.css） |
| `src/ui/App.tsx` | 快捷键 `d`/`t` 回今天 |
| `src/ui/TodoSection.tsx` / `NoteSection.tsx` | 就地编辑（TodoEdit / NoteEdit 子组件；`done` ref 防 blur+click 双触发） |
| `src/ui/detail.module.css` | `.ttxtBtn/.tedit/.ntxtBtn/.nedit/.neditArea` |
| 测试 | store.test.ts 54 用例（改 8 个旧用例 + 新增 7 个：shift no-op / setView 复位 / 编辑成功与校验失败 / NotFound）；App.test.tsx 4 冒烟（新增就地编辑一条）。**变异检验 2/2 被抓**：恢复日视图翻日 → 1 败；setView('day') 不复位今天 → 2 败 |

**文档改动落点**：PRD **v1.0 → v1.1**（§1.4 新增 v7 取舍 / 场景 C 重写 / M1/M4/M5/M17/M18/S4 / C3 标记已实现 / **US-09 重写 + US-13 新增** / §5.1 翻日行改"换日" / §8 / **D16/D17 修订 + D19 新增** / §10 清单）；SPEC.md（头部 v7、§2 决策表加两行、§3.1 三视图表加"翻日"行、§3.2、§3.3 就地编辑约定、§7、§8）；ADR-0005（状态行、**新增"v7 修订的起因"**、硬性约束、后果、实施要点）；adr/README、docs/README（原型落后于真 UI 的债务）。

**⚠️ 原型从此不再代表真 UI**：`prototype/index.html` 停在 v6.1（仍有顶部框时代的翻日/滑动，无就地编辑）。`smoke.cjs` 的 218 项断言只守原型自身回归；真 UI 的行为由 vitest（502 用例）守。`src/prototype-parity.test.ts`（金额算法平价）仍有效——两边算法未动。

**已明确接受的代价（v7）**：连续补记相邻多天要"点格子 → 记 → 返回 → 点下一格"，比滑动翻日多两步（PRD 场景 C / D19）。

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

**代码侧待办（v6 引起的）**：✅ **2026-09-30 全部落地**（见 §1b）
- ~~`core/aggregate` 提供 `aggregateDayDetail`~~ ✅（还扩展了 `WeekDay` 周行预览，契约已回写 CORE-API）
- ~~`src/app` 一层来源栈 `{view, date, scrollTop}` + `popstate`~~ ✅（`app/store.ts`，48 用例守着）
- ~~翻日不得 push history~~ ✅（有专测 + 变异检验）
- ~~`src/ui` 三视图组件；手机不再有 sheet~~ ✅
- ~~原型没跟进 v6~~ → ✅ 已升到 v6.1

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
- 「45 午饭」一句话记花费取消 → **PRD Q2 自动关闭**；`core/validate.ts parseQuickExpense` 失去唯一调用方 → **已删除**（PRD Q7 已关闭）

**文档改动落点**：
| 文件 | 改了什么 |
|---|---|
| `docs/PRD.md` | §1.4 **新增 v6.1 取舍说明**、§2 **场景 A/B/C 全部重写**、§3 **M7 废除（编号保留不复用）+ M8 升为唯一入口**、§4 **US-01 整条重写 + US-03 补金额算法规则**、§8 **空状态表改写 + 新增第 4 条规矩**、§9 **新增 D18**、§10 验收清单、§11 **Q2 关闭 + 新增 Q6/Q7** |
| `SPEC.md` | §3.1 决策表（**顺带修掉两处 v6 就该改却漏掉的"默认视图 → 周"**）、**§3.3 整节重写为单一入口**、§3.3.1、§3.5 录入方式、§7 路线图 v0、§8 清单 |
| `docs/CORE-API.md` | **新增 §5.10 `core/validate`**（此前只有表格一行，从没给过接口章节）、**新增 §5.11 `core/clock`**（此前整个模块未登记）、§1.1 补 clock/errors/types 三行、附录目录结构补全 |
| `src/core/validate.ts` | **删除 `parseQuickExpense`**（−28 行，Q7 已关闭）；`validate.test.ts` −8 个 `it` |
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
| `PRD.md` | 需求定稿 v1.1（US-01~US-13，M1–M19） |
| `CORE-API.md` | core 层 TS 契约，13 个模块（§5.1–§5.11），3 条铁律。**backup（§5.8）v7.5 已实现**（serialize/parse/merge/renderRangeMd） |
| `adr/0001~0008` | 存储 / SW（**✅ 2026-10-01 已接线，见 PROGRESS §0e**）/ 金额 / lunar 懒加载 / 三视图 / core 隔离 / CSS Modules / 自写 date |
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
repo/repo.test.ts 62 用例，覆盖 US-04 顺延（含**保序**）、E10/E11/E21/E24
aggregate/        ★ 三视图唯一数据源（CORE-API §5.6）
  index.ts          createAggregates 工厂 + 5 个聚合方法 + E21 分类归并
  money.ts          formatMoney / formatMoneyShort / formatMoneyCsv，全程整数分
  *.test.ts         59 用例，**含查询次数间谍断言**（守 §6 性能契约）
migrate/          ★ 纯函数版本迁移（PRD §6.4）
  index.ts          createMigrator 工厂；真实 MIGRATIONS 目前为空（v1 是基线）
  migrate.test.ts   24 用例，100% 语句覆盖，注入合成迁移测链条逻辑
diagnose.ts       ★ 环境探测，全局对象**全部注入**（铁律 2 的落地）
diagnose.test.ts  23 用例，100% 语句覆盖
isolation.test.ts import.meta.glob 静态扫源码，守 ADR-0006 边界
```
> 🗑 `validate.ts` 里的 **`parseQuickExpense` 已删除**（2026-09-29 用户批准，PRD Q7 关闭）。
> 它唯一的消费者是被移除的顶部框。删除后 `validate.ts` 覆盖率从 97.26% **升到 98.38%**（分支 95.12% → 97.14%），
> 测试总数 336 → 328。找回实现：`git log -S parseQuickExpense`。**不要重新引入第二条花费录入路径。**

另有 `src/prototype-parity.test.ts`（**不在 `src/core/` 下**，以躲开 `isolation.test.ts` 的 `./**/*.ts` 源码扫描）：
把原型的 `toCents()` 与 core 的 `parseAmount()` 用 40 组输入逐位比对。用 `import.meta.glob(..., ?raw)` 读原型
而不是 `node:fs`——因为 `src/` 归 `tsconfig.app.json` 管（`types: ["vite/client"]`），出现 node 内置模块编译不过。
jsdom 本身早已是 devDependency，本轮补装了缺失的 **`@types/jsdom`**。

### 1b. 代码 `src/app/` + `src/ui/`（2026-09-30 落地，commits a285477 / 844ab48 / 93b6e75）
```
app/bootstrap.ts  全应用唯一触碰浏览器全局的入口（铁律 2 注入点）；
                  E1 降级 memory store + degraded 横幅 / E4 农历 null，不白屏
app/store.ts      Zustand vanilla 状态机（419 行，v6 导航红线全在这）：
                  视图+日期单一真相 / 一层来源栈 {view,date,scrollTop} /
                  history 协作（进日视图 push 一条、翻日绝不 push、setView/back/popstate
                  三处弹幽灵条目）/ loadSeq 竞态守卫 / D18 空白日自动展开 /
                  写操作一律 repo→refresh→toast，校验失败走 core 中文文案
app/context.ts    React 绑定；测试可逐用例建独立 store
ui/               App 外壳（横幅/快捷键 j k ←→ d w m Esc/Toast 1.9s）
                  TopBar（日→周→月切换器 D17，「今天」按钮仅偏移时出现）
                  DayView（滑动翻日 ≥50px 且 ≥1.5×纵向 / 顺延横幅 / 来源返回条）
                  WeekView（7 行正文预览 + 滚动还原）/ MonthView（恒 6 行 42 格 D2）
                  Todo/Expense/NoteSection（v6.1 单一入口内联表单；金额走 core
                  parseAmount，UI 无 *100；IME isComposing 守卫；想法 ⌘+Enter 保存）
index.html + main.tsx  生产入口（启动顺序=首屏关键路径，见 main.tsx 头注释）
```
测试：`app/store.test.ts` **48 用例**（纯 Node 环境跑，兑现 store.ts 头注释的承诺；
history 用 stub 注入）。**变异检验 4/4 被抓**：删竞态守卫 1 败 / back 不还原日期 2 败 /
翻日 push history 1 败 / 删自动展开 5 败。`ui/App.test.tsx` **3 冒烟**（jsdom）。
⚠️ 两个测试环境坑：**vitest 未开 globals → RTL 自动 cleanup 不注册**，UI 测试必须手动
`afterEach(cleanup)`；Node 无 `history` 全局（canHistory 自然短路，需要时注入 stub）。

**本会话修的两个构建层问题**（都是上一会话遗留的破构建）：
1. `tsconfig.app.json` 只有 `'@core/*'` 没有 bare `'@core'` → tsc 20 个错（vite 的字符串
   alias 是前缀匹配所以 dev 能跑，tsc 的 paths 不是——**两边语义不同，改别名要两边都查**）
2. `eslint.config.js` 层级重排：ADR-0004 全局块曾 spread CORE_FORBIDDEN_IMPORTS，
   误伤 `src/main.tsx`（入口 import React/CSS 被当 core 违规）；且 flat config **同规则
   后者整体覆盖前者**，ui/app 块反而把 lunar 限制覆盖丢了。现每块自带完整规则
   （core 块与 ui/app 块各自并入 LUNAR_PATHS），ui/app 深导入 pattern 从 `@core/*/*`
   收紧为 `@core/*`（旧 pattern 挡不住 `@core/repo` 一层深导入）。6 组 stdin 变异验证生效。

**部署交付**（2026-09-30）：`dist/`（600 KB，8 文件）+ `daycell-dist.zip`（188 KB）。
用户自选**拖拽上传**（Netlify Drop / Vercel / CF Pages 均可，根路径静态托管，无需 base 配置）。
首屏实测 gzip ≈ **92 KB**（react-dom 独占 65 KB）——**超 PRD §5.1 的 80 KB 预算**，
lunar chunk（102 KB gzip）是懒加载不计入。预算口径要不要把 vendor 算进去，待用户拍。
沙箱网络到 github.com SSH/HTTPS 均超时（clash 未代理终端流量），CLI 部署路线走不通。

**尚未写**（2026-09-30 更新）：
- `backup/*`——**唯一剩下的 core 模块**。用户拍板延后（「导入导出备份都不要写，只完成记录」）。开工前的调研结论见 §4 第 3 条
- **PWA 插件接线**——⚠️ 上线后最大风险：iOS Safari 不装 PWA 时 ITP **7 天清除 IndexedDB**（E3），而导出功能又还没有 → 用户数据暂时无逃生通道。下一步的优先项
- **M11 纪念日创建入口**——core/repo/聚合/三视图徽章全就绪，只差 UI 表单（v0 Must 里唯一的缺口）；设置页同理未做
- `scripts/report-size.mjs`、4 万条基准测试（§6）
- ~~`core/index.ts`~~ ✅ ~~`src/ui/*`~~ ✅ ~~`src/app/*`~~ ✅ ~~`index.html`~~ ✅（见 §1b）

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

## 4. 下一步（按序，2026-10-01 重排）

0. ~~**⚠️ `dist/` 与 `daycell-dist.zip` 是 v7 之前的构建**~~ → ✅ **2026-10-01 已重建**（含 v7 + v7.1 + PWA，见 §0e）。用户拖拽 `daycell-dist.zip` 部署即可
1. ~~`core/aggregate`~~ ~~`core/migrate`~~ ~~`core/diagnose`~~ ~~`core/index.ts`~~ ~~`src/app`~~ ~~`src/ui`~~ → ✅ 全部完成（见 §1b；v7 修订见 §0c）
2. **~~PWA 接线~~ ✅（§0e）+ M11 纪念日创建入口**：
   - ~~PWA（ADR-0002）~~ ✅ 已接线并构建验证；**剩真机验收**（iOS 装主屏 + 飞行模式读写，PRD §10）与 S1 首启引导（`diag.installed/userAgentIOS` 已在 state 里，只差 UI）
   - 纪念日：底层全就绪（repo/聚合/三视图徽章/E13 闰月回退），只差 DayView 一个区块表单（公历/农历 + 每年重复）
3. ~~**`core/backup/*`**~~ → ✅ **v7.5 已实现**（2026-10-01，见 §0i）。实现与 2026-09-30 调研结论的差异：导入改为**合并**（用户拍板，防覆盖丢数据）而非"覆盖恢复"；备份格式 v1 `{app,version,exportedAt,schemaVersion,data:{todos,notes,expenses,anniversaries,categories,settings}}`；settings 白名单 5 key；墓碑不导入。旧调研结论存档：
   - 五步导入顺序照 CORE-API §5.8；`BackupFile.records` 用 `RecordTable`（契约原文 `Record<StoreName, CoreRecord[]>` 是错的，§2 已记）
   - `ValidateCode` **已含** `BAD_BACKUP` / `VERSION_TOO_NEW`（validate.ts 与 CORE-API §2.1 一致；§5.10 文档里写的 `INVALID_DATE` 是旧码，勿被误导）
   - `putSetting` 需加可选参 `{updatedAt?: number}` 保留导入时间戳（interface + 两实现各 2–3 行），否则恢复出的设置 updatedAt 全变"刚刚"，LWW 会拿旧备份覆盖较新的本地设置——与 `PutOptions.keepTimestamps` 同一理由
   - 契约第 4 步"快照当前库"可由 **tx 原子性等价提供**（idb tx = abort 回滚；memory tx 本身就是 snapshot+restore），不必再拷一份
   - `validateBackup` 只做**文件级**结构校验；记录级形状问题逐条跳过计入 `skippedInvalid`——一条脏数据不该绑架整个备份
   - 真实 MIGRATIONS 为空 → "低于当前版本走迁移"分支不可达，需仿照 createMigrator 的做法**注入合成版本号 + 迁移函数**才可测
   - Markdown 想法时间戳需要 `HH:mm` → date.ts 加 `timeHm(ts)` / `stampText(ts)`（Date 仍只关在 date.ts，ADR-0008）
   - 单文件 `backup/index.ts` 工厂起步（与 migrate 同构），CORE-API 附录画的四文件结构等长大再拆
   - §7.6 要求**往返测试**：导出 → 清空 → 导入 → 完全一致（含墓碑）
4. `scripts/report-size.mjs` 守首屏预算——**实测已 92 KB gzip（react-dom 独占 65 KB）**，先和用户对齐预算口径（vendor 算不算）再写阈值
5. 修 `package.json` 的 `test:tz`：仍引用**未安装**的 `cross-env-shell`，改成 `TZ=… npx vitest run` 链式（ADR-0008 要求三时区跑）
6. 4 万条记录基准测试（CORE-API §7.7 / §6 性能契约）
7. **等用户拍 PRD Q6**：金额吃不吃 `¥` / `￥` 前缀（建议吃，约 1 行 + 2 个测试；core 现拒绝，原型已对齐）

---

## 5. 不可漂移的约束

- **产品**：日历为主，格子里放当天记录。**不碰时间点事件**（无日程、无提醒推送）。
- **两条红线**：单次写入 ≤ 5 s（v6 把它压到 0 次切换）；回看必须值得（v6 代价：多一次切换，见 PRD §1.4）。
- **v0 明确不做**（PRD §3 Won't）：当日总结、心情评分、照片、云同步、账号、预算、图表、提醒推送、带时间日程、习惯打卡、全文搜索、拖拽排序、优先级/标签、深色模式、多语言。
- **金额只存整数分**；UI 不得自行 `*100` / `/100`（用 repo 导出的 `toCents` / `toYuan`）。`1.005*100 === 100.49999999999999`，naive 换算是错的。
- **日期只用 `new Date(y, m-1, d)`**；`new Date('2026-09-29')` 按 UTC 午夜解析，在 UTC−x 会差一天。`daysBetween` 用 `Date.UTC` 避 DST。
- **core 不得 import React/DOM/zustand/CSS**（ESLint 强制 + `isolation.test.ts` 扫源码）。
- **墓碑永不物理删除**（`RecordStore` 故意没有 `remove`）；每次写都刷 `updatedAt`。
- **日视图 = 今天（v7 / PRD D19）**：不得重新引入翻日（滑动、前后箭头、日视图下的 `shift`）。其他日子的日详情只从周/月点格子进入；`setView('day')` 恒复位 selected=today。
- **返回路径必须冗余**（ADR-0005 v6）：手机「← 返回」+ `popstate` + 桌面 `Esc`；**不能只依赖键盘**；进日详情必须记住来源。
- **对比度**：`--ink-3 #767676` 是文字下限（4.54:1）；`--ink-4 #C4C4C4` **只能用于装饰**，v6.1 起白名单**仅 `.empty .big` 一处**（`.qadd:disabled` 随顶部框一起删了）。
- **core 每个模块都必须有测试**（CORE-API §7），且在**纯 Node 环境**跑（`environment:'node'`）——这本身就是铁律 2 的验证。
- **迁移必须纯函数**：`applyMigrations` 入参不可被改动（导入流程靠它回滚）。已用变异检验确认测试抓得住。
- **`RecordTable`（`types.ts`）不要用 `Record<StoreName, CoreRecord[]>` 代替**：`SettingRecord` 没有 id/createdAt/deleted。
- **录入入口只有一个**（v6.1 / PRD D18）：日详情各区块的内联表单，写入目标恒为当前选中日。**不要重新引入任何常驻快捷录入框**——它会带回"看着 A 天写进今天"这一整类错误。
- **编辑不另起炉灶**（v7 / US-13）：就地编辑走 `repos.*.setText`，校验、文案、墓碑语义与新建完全同源；**不要**在 UI 层写第二套校验或"删了重建"。
- **UI 侧金额换算必须与 `core parseAmount` 逐位一致**（ADR-0003），由 `src/prototype-parity.test.ts` 强制。**禁止 `Math.round(parseFloat(x)*100)`**。

## 6. 环境事实

工作目录：Mac 侧 `/Users/wangduanmao/DayCell`；云电脑侧 `/home/user/Doubao/chats/38444556790203906/DayCell`（2026-10-01 起云电脑执行）。
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
**无 Xcode**（排除原生 iOS）、**无浏览器 provider**（视觉只能用户自己看；UI 验证靠 jsdom 冒烟测试 + curl 构建产物）、**`web_search` 不可用**（不要断言未验证的第三方平台事实）。
~~沙箱网络到 github.com 不通~~ → ✅ **2026-10-01 起云电脑可直推**：`git push https://x-access-token:<token>@github.com/Yiduanzhi-ops/DayCell.git main`（device flow 换的 token），GitHub Actions 自动部署到 Pages。v7.2(96e70a4)/v7.3(da8c484)/v7.4(3ff2db8)/v7.5 均已推送上线。
系统日期 **2026-09-30 周三**。
栈：Vite 8.3.1(Rolldown) / TS 5.9.3（**不能升 7**，typescript-eslint 8.71 peer `<6.1.0`）/ React 19.3 / Zustand 5 / idb 8.0.3 / lunar-typescript 1.8.6 / Vitest 5.0.2 / lightningcss / fake-indexeddb。
`vite.config.ts` 的 `manualChunks` **必须用函数形式**，Rolldown 不接受对象形式。
**idb v8 的坑**：`IDBPDatabase` 只有 1 个泛型参数；`getAllFromIndex` **只挂在 database 上**，事务内必须 `tx.objectStore(s).index(name).getAll(range)`；`IDBKeyRange.bound(lo,hi)` 在 `lo>hi` 时抛 `DataError`（空区间要先短路返回 `[]`）。

## 7. 未决（等用户拍）

- PRD §9 **D1–D18 默认值表从未被逐条确认过**（D16/D17/D18 是 v6/v6.1 新增，方向已口头确认）
- PRD §11：Q1 回看价值靠什么撑（我建议真实用两周后再议）/ ~~Q2~~ **已关闭** / Q3 调休数据源 / Q4 部署平台 / Q5 v1 同步存储 / **Q6 金额吃不吃 `¥`**（仍未决）/ ~~Q7~~ **已关闭：parseQuickExpense 已删**
- 遗留物去留：`genlunar.cjs`、`smoke.cjs`、`prototype/`。
  ⚠️ 注意 `src/prototype-parity.test.ts` **依赖 `prototype/index.html` 存在**——删原型时必须连它一起删（文件头注释已写明）
- ~~是否 `git init`~~ → ✅ 已做（见 §6）。**遗留物去留那条现在可以真的执行了**：删 `prototype/` 时记得连 `src/prototype-parity.test.ts` 一起删

## 8. 用户沟通偏好

少给选项、不给矩阵；解释控制在两句内；**给带理由的推荐**而不是菜单；直说权衡与不确定性；**改动前先说清代价**。
用户会自己发现真问题并推翻自己之前的指令（v6 把默认视图从周改成日；v6.1 又砍掉了 v5 定稿的双路径录入）。
他会问"你觉得是不是有必要"——**这是真的要你的判断和理由，不是客套**；判断完要连带说清代价，再动手。
他也质疑过工具链的必要性（"原型图为什么需要连服务器？不是静态 html 么"）——**他是对的，不要为省事引入不必要的依赖**。
