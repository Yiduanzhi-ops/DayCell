#!/usr/bin/env python3
"""用用户提供的 logo（v7.6 用户拍板更换）生成 PWA / 顶栏 / 启动页图标。

输入：assets/logo-user.png（用户上传，WebP 486x483，浅蓝渐变圆角方形 + 白色矩形对勾）
输出（public/，构建直接引用，已提交）：
  logo.png                    512 全幅（顶栏 BrandMark / splash 共用）
  pwa-192x192.png             PWA 192
  pwa-512x512.png             PWA 512
  maskable-icon-512x512.png   maskable：512 画布上 logo 缩至 82% 居中，留安全区
  apple-touch-icon-180x180.png iOS 主屏图标（系统自带圆角）

用法：python3 scripts/gen-logo-icons.py
依赖：Pillow（可读 WebP）
"""
from PIL import Image

SRC = 'assets/logo-user.png'
OUT = 'public'

def main() -> None:
    im = Image.open(SRC).convert('RGBA')

    # 全幅图标
    for name, size in [('logo.png', 512), ('pwa-192x192.png', 192), ('pwa-512x512.png', 512), ('apple-touch-icon-180x180.png', 180)]:
        im.resize((size, size), Image.LANCZOS).save(f'{OUT}/{name}', 'PNG')
        print(f'  {name} {size}x{size}')

    # maskable：512 透明画布，logo 缩至 82% 居中（内容安全区）
    size = 512
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    fit = int(size * 0.82)
    logo = im.resize((fit, fit), Image.LANCZOS)
    canvas.paste(logo, ((size - fit) // 2, (size - fit) // 2), logo)
    canvas.save(f'{OUT}/maskable-icon-512x512.png', 'PNG')
    print('  maskable-icon-512x512.png 512x512 (82% centered)')

if __name__ == '__main__':
    main()
