# DayCell 文档索引

## 文档全景

| 文档 | 角色 | 状态 | 何时读 |
|---|---|---|---|
| [`../SPEC.md`](../SPEC.md) | **决策日志**——记录每次改了什么、为什么改，含完整变更轨迹 | 持续维护 | 想知道"当初为什么这么定" |
| [`PRD.md`](PRD.md) | **需求定稿**——v0 要做成什么样，含验收标准 | v1.0 待评审 | 开发前、验收时 |
| [`CORE-API.md`](CORE-API.md) | **接口契约**——core 层暴露给 UI 的唯一边界 | v1.0 待评审 | 写 core 或 UI 代码时 |
| [`adr/`](adr/README.md) | **架构决策记录**——8 条错了代价很大的决策 | 持续追加 | 想推翻某个技术选择时 |

## 三者的分工（重要）

```
SPEC.md      →  为什么改（历史，append-only，读起来像 changelog）
PRD.md       →  做什么（现在，v0 的唯一需求真相）
CORE-API.md  →  怎么接（边界，UI 与 core 的契约）
adr/         →  怎么做的关键选择（可单独推翻，不改 PRD）
```

**冲突时的优先级**：`PRD.md` > `CORE-API.md` > `adr/` > `SPEC.md`

发现不一致时的处理：改上游文档，并在 `SPEC.md` 追加一条变更记录。**不要只改代码不改文档。**

## 已知的文档债务

| 位置 | 问题 | 处理 |
|---|---|---|
| `SPEC.md` §5 | 数据模型是"一天一个 DayEntry blob"，**已废弃** | 已在该节顶部标注，正式模型见 PRD §6 |
| `SPEC.md` §6 | 技术栈曾写 Tailwind / dayjs / 手写 manifest | 已回写，理由见 ADR-0007 / 0008 / 0002 |
| `SPEC.md` 整体 | 读起来像 changelog，同一主题的新旧决策并存 | **有意保留**——它的价值就是变更轨迹。定稿信息一律查 PRD |
| `prototype/` + `smoke.cjs` | 都是**过渡产物**：真 UI 落地后应一并删除。⚠️ **真 UI 自 v7 起已领先原型**（原型停在 v6.1：仍有翻日/滑动，无就地编辑），smoke.cjs 只守原型、不再代表真 UI 行为 | ⚠️ 但 `src/prototype-parity.test.ts` **依赖 `prototype/index.html` 存在**（用 `import.meta.glob ?raw` 读它），删原型时必须连这个测试一起删 |
| `docs/PROGRESS.md` | 会话交接快照（     213 行），非需求文档 | 上下文被压缩后**先读这份**。它不进 PRD > CORE-API > adr > SPEC 的优先级链 |

## 尚未编写

| 文档 | 计划 |
|---|---|
| 云端 REST API 文档 | **v1 再做**。v0 无后端，没有 API 可写（见 PRD Q5） |
| 部署与运维手册 | 部署平台定了之后写（PRD Q4，6 条门槛待核对） |
| 测试计划 | 验收清单已在 PRD §10，详细用例随代码写 |
| 用户手册 | v0 面向自己与少量亲友，先用首启引导代替 |

## 目录结构

```
DayCell/
├── SPEC.md                    决策日志（     356 行）
├── docs/
│   ├── README.md              本文件
│   ├── PRD.md                 产品需求文档 v1.0（     564 行）
│   ├── CORE-API.md            core 层接口契约 v1.0（     723 行）
│   └── adr/
│       ├── README.md          ADR 索引与约定
│       ├── 0001-local-storage-indexeddb.md
│       ├── 0002-service-worker-strategy.md
│       ├── 0003-money-as-integer-cents.md
│       ├── 0004-lunar-lib-lazy-load.md
│       ├── 0005-responsive-sheet-layout.md
│       ├── 0006-core-no-react-no-dom.md
│       ├── 0007-css-modules-not-tailwind.md
│       └── 0008-date-module-not-dayjs.md
└── prototype/
    └── index.html             可点击原型 v6.1（`node smoke.cjs` 218 项断言通过）
                               ⚠️ 纯静态单文件，**不需要服务器**，直接 open 即可
```
