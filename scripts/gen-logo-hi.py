#!/usr/bin/env python3
"""把用户提供的截图 logo（白底残留、486x483、四角未裁）转换为高清规范的 App 图标。

保证"完全一样"且更清晰、形状规范，具体流程：
1. 白底（r,g,b 全 > 248）→ 透明，得到内容 mask
2. 迭代 inpaint：把透明区 RGB 用邻域内容色填充 → 放大时 RGB 连续，无 LANCZOS 振铃黑边
3. 全幅 LANCZOS 放大到 2048 母版（保留渐变与光晕原样）
4. 叠加标准圆角方形 mask（半径 ≈ 22.3%，iOS 风格），圆角边缘羽化后自然淡出
5. 半透明像素 RGB 归一化（straight alpha），避免黑画布插值残留
6. UnsharpMask 轻度锐化 → 边缘更利、观感更清晰
7. 从 2048 母版缩放生成全套 PWA 图标

输出（public/）：
  logo-hi.png                2048 母版
  logo.png                   512（顶栏/splash 引用）
  pwa-192x192.png / pwa-512x512.png / apple-touch-icon-180x180.png
  maskable-icon-512x512.png  512 画布 logo 缩至 82% 居中

用法：python3 scripts/gen-logo-hi.py
依赖：Pillow
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

SRC = 'assets/logo-user.png'
OUT = 'public'
RADIUS_RATIO = 0.223  # iOS app icon 圆角比例
WHITE_TH = 248        # 白底判定阈值（r,g,b 全大于该值视为白底）
FEATHER = 1.5         # alpha 羽化半径（原图尺度，避免放大硬边）
ROUND_FEATHER = 3.0   # 圆角 mask 羽化（2048 尺度）
INPAINT_RADIUS = 5    # inpaint 最大滤波核


def prepare() -> tuple[np.ndarray, np.ndarray]:
    """原图 → (RGB int16, 内容 mask)。白底置透明，透明区 RGB 用邻域内容色填充。"""
    im = Image.open(SRC).convert('RGB')
    W, H = im.size
    px = im.load()
    a0 = np.zeros((H, W), dtype=np.uint8)
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            if not (r > WHITE_TH and g > WHITE_TH and b > WHITE_TH):
                a0[y, x] = 1
    rgb = np.array(im).astype(np.int16)
    mask_img = Image.fromarray((a0 * 255).astype(np.uint8))
    for _ in range(60):
        dil = np.array(mask_img.filter(ImageFilter.MaxFilter(INPAINT_RADIUS))) > 0
        todo = (a0 == 0) & dil
        if not todo.any():
            break
        mxa = np.array(
            Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(INPAINT_RADIUS))
        ).astype(np.int16)
        rgb[todo] = mxa[todo]
        a0[todo] = 1
        mask_img = Image.fromarray((a0 * 255).astype(np.uint8))
    return rgb, a0


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def main() -> None:
    rgb, a0 = prepare()

    S = 2048
    rgba = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    rgba.putalpha(Image.fromarray((a0 * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(FEATHER)))

    hi = rgba.resize((S, S), Image.LANCZOS)
    r = int(S * RADIUS_RATIO)
    rm = rounded_mask(S, r)
    hi.putalpha(Image.composite(rm, Image.new('L', (S, S), 0), rm.filter(ImageFilter.GaussianBlur(ROUND_FEATHER))))

    # 半透明像素 RGB 归一化（straight alpha 反预乘）
    arr = hi.load()
    for y in range(S):
        for x in range(S):
            pr, pg, pb, pa = arr[x, y]
            if 0 < pa < 255:
                arr[x, y] = (
                    min(255, int(pr * 255 / pa)),
                    min(255, int(pg * 255 / pa)),
                    min(255, int(pb * 255 / pa)),
                    pa,
                )

    hi = hi.filter(ImageFilter.UnsharpMask(radius=1.8, percent=50, threshold=4))
    hi.save(f'{OUT}/logo-hi.png', 'PNG')
    print(f'  logo-hi.png {S}x{S} (radius {r})')

    for name, size in [('logo.png', 512), ('pwa-192x192.png', 192), ('pwa-512x512.png', 512), ('apple-touch-icon-180x180.png', 180)]:
        hi.resize((size, size), Image.LANCZOS).save(f'{OUT}/{name}', 'PNG')
        print(f'  {name} {size}x{size}')

    size = 512
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    fit = int(size * 0.82)
    logo = hi.resize((fit, fit), Image.LANCZOS)
    canvas.paste(logo, ((size - fit) // 2, (size - fit) // 2), logo)
    canvas.save(f'{OUT}/maskable-icon-512x512.png', 'PNG')
    print('  maskable-icon-512x512.png 512x512 (82% centered)')


if __name__ == '__main__':
    main()
