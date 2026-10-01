# 架构决策记录（ADR）

采用 [Michael Nygard 格式](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)：背景 → 决策 → 理由 → 替代方案 → 后果 → 实施要点。

**为什么用 ADR 而不是一份完整的技术文档**：一个纯前端、约 5k 行的应用写大而全的架构设计是过度工程，而且产品形态还在变（v0 阶段已经推翻过三次决策：当日总结、心情评分、统一输入框），大文档写完就过期。ADR 只记**错了代价很大**的决策，每条独立、可单独推翻。

| # | 标题 | 状态 | 错了会怎样 |
|---|---|---|---|
| [0001](0001-local-storage-indexeddb.md) | 本地存储：IndexedDB + 记录级 + 软删除 | 已接受 | **丢数据**，且将来加同步要重写存储层 |
| [0002](0002-service-worker-strategy.md) | Service Worker 缓存与更新策略 | 已接受 | 装不上主屏 / 离线不可用，产品定位崩塌 |
| [0003](0003-money-as-integer-cents.md) | 金额以整数「分」存储 | 已接受 | 长期累加出现分币误差，账目对不上 |
| [0004](0004-lunar-lib-lazy-load.md) | 农历库懒加载与降级 | 已接受 | 首屏多 80 KB；发版后旧页签白屏 |
| [0005](0005-responsive-sheet-layout.md) | 响应式布局：桌面分栏 / 移动三视图 | 已接受（**v6 修订**：移动 sheet → 全屏日视图；**v7 修订**：日视图并入「今天」，删除翻日） | **手机点开后无法返回**（已实际踩过；v6 后同一失败模式变为"进了某天出不来"） |
| [0006](0006-core-no-react-no-dom.md) | core 层禁止依赖 React 与 DOM | 已接受 | 出小程序时无法复用，重写 100% 而非 30% |
| [0007](0007-css-modules-not-tailwind.md) | 样式方案：CSS Modules 而非 Tailwind | 已接受 | 影响可控，属口味权衡 |
| [0008](0008-date-module-not-dayjs.md) | 日期处理：自写 core/date 而非 dayjs | 已接受 | 时区陷阱导致"今天"算错一天 |

## 约定

- 编号只增不改。推翻一条决策时**新建一条**并在旧条目标记「已被 ADR-XXXX 取代」，保留历史。
- 每条 ADR 必须能被 PRD 或 CORE-API 引用；引用不到的说明它不是架构决策，不该写成 ADR。
- 状态只有三种：`提议中` / `已接受` / `已废弃`。
