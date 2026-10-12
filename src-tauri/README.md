# DayCell 桌面壳（Tauri）

把 DayCell 变成 Mac 上**侧边常驻**的桌面小应用：像微信/Dock 一样划过屏幕右缘即弹出，不占任务栏、不挡视野。

## 交互

| 操作 | 效果 |
|---|---|
| 鼠标划过屏幕**最右缘**（8px 触发区） | 细条滑开为 360px 面板 |
| 鼠标**移出面板** | 自动收回成细竖条（10px 宽，贴在右缘） |
| 快捷键 `Cmd+Shift+D` | 展开 / 收起 |
| 点击菜单栏（托盘）图标 | 展开 / 收起 |
| 托盘菜单「锁定面板」 | 勾选后划过不再自动收回 |
| 托盘菜单「切换宽窗模式」 | 820px 宽窗，用于月视图等密集页面 |
| 托盘菜单「开机自启」 | 登录时自动待命 |
| 顶栏空白处按住拖动 | 移动窗口位置 |

## 数据与同步

- 桌面壳加载的是**同一份前端代码**，功能与网页版完全一致（夜间模式、目标、习惯、想法、纪念日、备份等）。
- 桌面端数据存在本机 WebView 存储（与浏览器隔离），多端同步照旧走应用内「同步设置」（Gitee 通道）。
- 手机端 / GitHub Pages 网页版**零改动、零影响**。

## 为什么不需要辅助功能授权

划过展开用的是 **40ms 轮询读取鼠标坐标**（NSEvent/CGEvent），不是事件监听，所以**不需要**在「系统设置 → 隐私与安全性 → 辅助功能」里授权任何东西，安装即用。

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
- `src-tauri/target/release/bundle/dmg/DayCell_1.0.0_<arch>.dmg` —— 可分发的安装镜像

## 发版注意

- 前端改动照旧走 GitHub 推送 → Pages 自动部署（手机端/网页版）。
- 桌面壳版本号在 `src-tauri/tauri.conf.json` 的 `version`，功能更新时与前端版本同步 bump。
- 图标源：`public/logo-hi.png`，重新生成 icns：`iconutil -c icns <iconset> -o src-tauri/icons/icon.icns`。
