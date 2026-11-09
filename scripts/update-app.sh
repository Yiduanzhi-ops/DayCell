#!/usr/bin/env bash
# 重建桌面壳并替换 /Applications/DayCell.app
# 用法：./scripts/update-app.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP="$ROOT/src-tauri/target/universal-apple-darwin/release/bundle/macos/DayCell.app"
TARGET="/Applications/DayCell.app"

echo "▸ 1/4 构建通用包（x86_64 + arm64，约 1.5 分钟）"
npm run tauri:build -- --target universal-apple-darwin

if [ ! -d "$APP" ]; then
  echo "✗ 构建产物缺失：$APP"
  exit 1
fi

echo "▸ 2/4 ad-hoc 签名"
codesign --force --deep --sign - "$APP"

echo "▸ 3/4 替换 $TARGET"
pkill -9 -f "MacOS/daycell" 2>/dev/null || true
sleep 1
# 先复制到临时目录再替换，避免直接写 /Applications 时中断留下半成品
TMP="$(mktemp -d)"
ditto "$APP" "$TMP/DayCell.app"
rm -rf "$TARGET"
ditto "$TMP/DayCell.app" "$TARGET"
rm -rf "$TMP"
touch "$TARGET"

echo "▸ 4/4 启动"
open "$TARGET"

echo "✓ 完成：DayCell $(defaults read "$TARGET/Contents/Info.plist" CFBundleShortVersionString) 已装到 /Applications 并启动"
