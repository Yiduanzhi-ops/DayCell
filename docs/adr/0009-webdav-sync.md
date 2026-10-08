# ADR-0009：跨设备同步通道演进——Gitee 私有仓库（BYOB，不建账号体系）

- 状态：**已修订**（v8.2，2026-10-08；初版 v8.1 为坚果云 WebDAV，两次通道死亡后改为 Gitee）
- 关联：PRD Q5 / CORE-API §4（`byUpdatedSince` 预留）/ ADR-0001（软删除、updatedAt LWW）/ ADR-0006（core 隔离）

## 背景

DayCell 是纯前端 PWA，数据存每台设备浏览器本地（IndexedDB），电脑端与手机端互不相通。
用户希望跨设备同步，且数据不丢失（解决"单机单点"风险）。
核心约束：**部署仍是 GitHub Pages 纯静态**，无后端；同步通道必须能被浏览器直接跨域访问（CORS）。

## 通道演进（两次死亡，均实测确认，非猜测）

| 通道 | 结论 | 死亡原因（实测证据） |
|---|---|---|
| **坚果云 WebDAV**（v8.1 上线） | ❌ 不可行 | `dav.jianguoyun.com` 带 `Origin: https://yiduanzhi-ops.github.io` 请求，**响应无 `Access-Control-Allow-Origin`**——浏览器拦截所有跨域读写。Obsidian/Joplin 能用是桌面 App 不受 CORS 约束 |
| **LeanCloud 数据存储**（v8.2 初实现） | ❌ 不可用 | 官方公告（docs.leancloud.cn/sdk/announcements/sunset-announcement）：**2026-01-12 起停止新用户注册、停止创建新应用**，进入一年停服善后期。新用户无法注册 |
| **Gitee 开放 API**（v8.2 现行） | ✅ **采纳** | 实测 `gitee.com/api/v5` 国内可达（0.27s）、**`Access-Control-Allow-Origin: *`**、`Allow-Methods: GET/POST/PUT/DELETE...`、预检放行 `content-type, authorization`；免费、注册门槛低 |

（v8.1 曾否决过的 GitHub 私有仓库 + PAT——本地直连 GitHub 超时、手机网络更不可控——维持弃用；
用户本地与手机均在国内网络，Gitee 是可达性更优的同构替代。）

## 决策

1. **同步是"拉取"模型，不是"推送"**：自动同步 = 打开网页 pull 一次 + 本地变更防抖 push；
   保留手动「立即同步」补盲区（另一设备改过而本页一直开着时）。
2. **数据格式复用备份 JSON**（`BackupFile`），同步文件即云端最新备份——同步同时是异地备份。
   云端落点：用户自己的 Gitee **私有仓库**内固定文件 `daycell-sync.json`（master 分支）。
3. **通道抽象（v8.2 关键设计）**：`SyncTransport` 接口（`fetchFile`/`putFile`）是引擎唯一依赖；
   通道实现可替换（webdav.ts / gitee.ts），引擎、合并、UI 生命周期全部不动。
   本次两次换通道，engine 35 项测试仅换 mock，断言零改动 → 抽象有效。
4. **合并语义：id 级 last-write-wins**（≠ 备份导入的"本地优先"）。
   - 同 id 取 `updatedAt` 较新者（含墓碑 → 删除可同步）；远端独有墓碑跳过；本地独有保留
   - 不同 id 天然合并，两设备各自新增互不覆盖
   - 唯一数据丢失场景：两端**同时**改同一条（个人单用户概率≈0），按 LWW 覆盖
5. **写回必须 `keepTimestamps`**：否则合并写库的 updatedAt 全变"刚刚"，下次比较反向覆盖（ADR-0001 同款陷阱）。
6. **配置存 localStorage，不进 IndexedDB、不进备份文件**：
   - 令牌不随备份到处走；备份/导出不含同步凭据
   - 丢失只影响"自动同步"：重填三个值即可，数据本体在本地库 + 云端
7. **防循环**：pull 合并写库期间置 `merging` 标志，写库触发的 `schedulePush` 直接跳过，
   否则 拉取→写库→推送→另一端拉取 无限循环。
8. **触发点：包装 store 写入口**（`put`/`putMany`/`putSetting`），在 `initCore` 的
   `wrapStore` 注入点、`createRepos` 之前应用——repo 全部写操作一处包装全覆盖，
   不逐个改 repo/action。
9. **多用户隔离靠"一人一个 Gitee 账号/仓库"**：令牌绝不外传；网页本身公开但数据私有，
   发给别人用各填自己的仓库与令牌即互不干扰。

## 代价与边界（明示给用户）

- 分钟级模型，非实时（无服务器推送）；两设备同时开着时改动不会即时互见，点「立即同步」可马上拉
- 令牌存在浏览器本地，网页源码公开 → 被扒后最坏情况=该私有仓库文件被读写
  （建议令牌作用域只勾「projects」，把爆炸半径限制在同步文件本身）
- Gitee 偶尔维护/限流，个人使用可接受；Gitee 不可用时本地照常，只暂停同步
- 仓库默认分支需为 master（Gitee 新建私有仓库默认即 master；如用户仓库是其他分支需加 branch 配置）
