# ADR-0002 Service Worker 缓存与更新策略

- **状态**：已接受
- **日期**：2026-09-29
- **相关**：PRD §5.1 / §5.4 / US-11 / E3 / E20、ADR-0004

## 背景

DayCell 是 PWA。两件事同时依赖 Service Worker：

1. **离线可用**：数据在本地 IndexedDB，但如果 HTML/JS 拿不到，断网就打不开——那"本地优先"就没意义
2. **装到主屏**：iOS 上只有安装成 PWA 才豁免 Safari 的 7 天数据清除（ITP）。**不装主屏 = 用户数据可能被系统清掉**（PRD E3）

同时，SW 是**最容易把应用搞坏的一层**：缓存策略错了会出现"发了新版但用户还在跑旧代码"、"chunk hash 对不上导致白屏"。ADR-0004 的农历库 404 就是这类问题的具体形态。

## 决策

用 `vite-plugin-pwa`（Workbox）生成，采取三条策略：

### 1. 静态资源：构建时预缓存（precache）

Vite 产出的带 hash 的 JS / CSS / HTML / 图标全部进 precache manifest。**首次加载后即完整离线可用**。

### 2. 更新策略：`autoUpdate` + 全量替换 precache

- 新版本 SW 安装时立刻预缓存新资源，**不阻塞当前页面**
- `skipWaiting: false`、`clientsClaim: false`——**不在运行中偷换资源**（PRD E20）
- 所有页签关闭后新 SW 自然激活；旧 precache 条目被 Workbox 自动清理
- 额外提供"有新版本，点击刷新"的可选提示（不强制）

### 3. 运行时请求：v0 一律不缓存网络资源

除了 precache 命中，**不注册任何 runtime caching 路由**。理由：v0 运行时零网络请求（PRD §5.4），没有可缓存的东西。加 runtime 路由只会引入隐私与一致性问题。

`navigateFallback` 指向 `index.html`，保证任意路径断网可打开。

## 理由

**为什么不用 `skipWaiting: true`（立即激活）**：这是白屏的经典来源。旧页面已经加载了 `app.abc123.js`，新 SW 立刻接管并清掉旧 precache，此时旧页面懒加载农历库（`lunar.def456.js`）就会 404。**"等所有页签关闭再激活"虽然让用户晚一点拿到新版，但绝不会把正在用的页面搞坏。**对一个记录类应用，晚一小时更新毫无损失。

**为什么 precache 而不是 runtime caching**： precache 在构建时就知道全部资源，命中率 100%，且 Workbox 自动管理生命周期。runtime caching 需要自己处理过期、版本、失败回退，对 v0 是纯负担。

**为什么必须装到主屏**：iOS Safari 的 ITP 规定——纯网页（未安装）7 天不访问就清除站点数据。已安装的 PWA 豁免。这不是优化，是**数据安全的前提**。所以 PRD S1 的"首启引导添加主屏"是 Should 里优先级最高的一条。

## 考虑过的替代方案

| 方案 | 为什么否掉 |
|---|---|
| 手写 manifest + 手写 SW | SPEC 原计划如此，**已推翻**。手写极易漏掉 chunk、漏掉 hash 更新、漏掉旧缓存清理。Workbox 是成熟方案，没有理由手写 |
| `skipWaiting: true` 立即更新 | 白屏风险，见上 |
| 不做 SW，只做 manifest | 无法离线、无法预缓存，且 Chrome 的安装提示要求 SW。等于放弃 PWA |
| 用 runtime caching 缓存农历库 |  lunar 是构建产物、有 hash，属于 precache 范畴。runtime caching 是给第三方 API 用的，v0 没有 |

## 后果

**正面**
- 二次打开 ≤ 500 ms（PRD §5.1），全部本地命中
- 飞行模式下功能完整
- 发版不会打断正在使用的用户

**负面**
- **用户可能长时间跑旧版本**（只要不关页签）。缓解：提供"有新版本"提示；对单人使用的产品影响很小
- 预缓存增加约 60 KB 的首次下载（但换来后续零网络）
- SW 调试成本高。**缓解**：开发环境默认不注册 SW（`devOptions.enabled: false`），避免开发时缓存干扰

## 实施要点

- **必须 HTTPS**（localhost 豁免）。这是部署平台选型的硬约束之一（PRD Q4）
- `manifest.webmanifest` 必须包含：`name` / `short_name` / `start_url` / `display: standalone` / `theme_color` / `background_color` / 至少 192 与 512 两档图标 + `maskable`
- `start_url` 要带 `?source=pwa` 之类的标记，便于将来区分启动来源（但**不做埋点上报**，PRD §5.4）
- 声明 `color-scheme: light`，防止系统深色模式强制反色把界面搞坏（PRD E23）
- iOS 专属 meta：`apple-mobile-web-app-capable`、`apple-touch-icon`（180×180）
- **验收**：真机 iOS Safari 装到主屏 → 开飞行模式 → 从主屏启动 → 能读能写。这是 PRD §10 的必过项
