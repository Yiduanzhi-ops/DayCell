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
- **v8.19 起：`registerType: 'autoUpdate'`（skipWaiting + clientsClaim）**——新 SW 安装即激活，下次导航/刷新即用新版
- **v7.1–v8.18 曾是 `prompt`（skipWaiting/clientsClaim 均 false，等所有页签关闭再激活）**，实测后果：PWA 常驻用户（主屏幕图标打开）的新 SW 永远处于 waiting，反复退出重进都拿不到新版，卡死在旧版本页。单人产品没有"提示用户刷新"的前端（v0 不做更新 UI），waiting 策略等于**发版无效**。故改为立即激活
- 旧 precache 条目被 Workbox 自动清理（`cleanupOutdatedCaches`）

### 3. 运行时请求：v0 一律不缓存网络资源

除了 precache 命中，**不注册任何 runtime caching 路由**。理由：v0 运行时零网络请求（PRD §5.4），没有可缓存的东西。加 runtime 路由只会引入隐私与一致性问题。

`navigateFallback` 指向 `index.html`，保证任意路径断网可打开。

## 理由

**为什么 v8.19 改为 `skipWaiting: true`（立即激活）**：原否决理由是白屏经典来源——旧页面已加载 `app.abc123.js`，新 SW 接管并清掉旧 precache 后，旧页面懒加载 `lunar.def456.js` 会 404。对 DayCell 此风险已降为 ≈0：唯一动态 chunk 是 lunar（ADR-0004），首屏日视图即显示农历、必然已加载，后续不再发起新的资源请求；且 DayCell 无 runtime caching，激活后旧页面不再请求任何 precache 资源。而"等页签关闭再激活"的代价被实测放大：PWA 常驻用户的 SW 永不退出 waiting → **新版永远到不了用户**，比极小概率的白屏窗口严重得多。故改立即激活（E20 豁免理由：激活不中断已加载页面，只影响后续导航）。

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
- **极窄窗口内旧页面懒加载可能 404**（见上，DayCell 实际 ≈0）。**缓解**：保持唯一动态 chunk lunar 首屏必加载；若将来新增懒加载 chunk，需重审此策略
- 预缓存增加约 60 KB 的首次下载（但换来后续零网络）
- SW 调试成本高。**缓解**：开发环境默认不注册 SW（`devOptions.enabled: false`），避免开发时缓存干扰

## 实施要点

- **必须 HTTPS**（localhost 豁免）。这是部署平台选型的硬约束之一（PRD Q4）
- `manifest.webmanifest` 必须包含：`name` / `short_name` / `start_url` / `display: standalone` / `theme_color` / `background_color` / 至少 192 与 512 两档图标 + `maskable`
- `start_url` 要带 `?source=pwa` 之类的标记，便于将来区分启动来源（但**不做埋点上报**，PRD §5.4）
- 声明 `color-scheme: light`，防止系统深色模式强制反色把界面搞坏（PRD E23）
- iOS 专属 meta：`apple-mobile-web-app-capable`、`apple-touch-icon`（180×180）
- **验收**：真机 iOS Safari 装到主屏 → 开飞行模式 → 从主屏启动 → 能读能写。这是 PRD §10 的必过项
