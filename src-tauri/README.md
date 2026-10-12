# DayCell 桌面壳（Tauri）

把 DayCell 变成 Mac 上**常驻桌面**的轻量小应用：一个 logo 悬浮球贴在屏幕右缘，点击弹出手机同尺寸的面板，随时记录待办/想法/习惯/目标，不占任务栏、不挡视野。

## 交互（v1.1）

| 操作 | 效果 |
|---|---|
| **点击右缘 logo 悬浮球**（64pt，按下即展开） | 弹出 **414×896pt 面板**（与 iPhone Pro Max 同尺寸），贴右缘垂直居中 |
| 全屏应用（浏览器/视频/PPT）中 | 球**跨 Space 置顶**（`CanJoinAllSpaces + FullScreenAuxiliary`），全屏下仍可见可点 |
| 鼠标移出面板 | **不自动收回**，面板保持（收起走热键 / 托盘） |
| 快捷键 `Cmd+Shift+D` | 展开 / 收起面板 |
| 点击菜单栏（托盘）图标 | 展开 / 收起 |
| 托盘菜单「切换宽窗模式」 | 820×900pt 宽窗，用于月视图等密集页面 |
| 托盘菜单「开机自启」 | 登录时自动待命（悬浮球） |

> 尺寸均为逻辑 pt：与手机/网页 CSS 一致，Retina 屏下视觉尺寸等于手机屏幕，不因像素密度缩放变小。

## 数据与同步

- 桌面壳加载的是**同一份前端代码**，功能与网页版完全一致（夜间模式、目标、习惯、想法、纪念日、备份等）。
- 桌面端数据存在本机 WebView 存储（与浏览器隔离），多端同步照旧走应用内「同步设置」（Gitee 通道）。
- 手机端 / GitHub Pages 网页版**零改动、零影响**。

## 本机构建

前置（一次性）：

```bash
# Rust 工具链（若已装过可跳过）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# 项目依赖
npm install
```

构建安装包（产出 `src-tauri/target/release/bundle/` 下的 .app / .dmg）：

```bash
npm run tauri:build
```

开发调试（改前端代码热更新 + 壳实时预览）：

```bash
npm run tauri:dev
```

## 打包产物

- `src-tauri/target/release/bundle/macos/DayCell.app` —— 拖入「应用程序」即用
- `src-tauri/target/release/bundle/dmg/DayCell_1.1.0_<arch>.dmg` —— 可分发的安装镜像

## 发版注意

- 前端改动照旧走 GitHub 推送 → Pages 自动部署（手机端/网页版）。
- 桌面壳版本号在 `src-tauri/tauri.conf.json` 的 `version`，功能更新时与前端版本同步 bump。
- 图标源：`public/logo-hi.png`，重新生成 icns：`iconutil -c icns <iconset> -o src-tauri/icons/icon.icns`。
- 悬浮球组件：`src/ui/BallView.tsx`（收起态整窗渲染 logo，`pointerdown` 首击即展开，避免未激活窗口首击只 focus）；`BallGate.tsx` 仅 Tauri 且窗口 <90px 时渲染球，网页端永不出现。
