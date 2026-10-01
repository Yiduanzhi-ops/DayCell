/**
 * 生成 PWA 图标（public/pwa-*.png）。零依赖：手写 PNG 编码器（zlib + CRC32）。
 *
 * 为什么不装 sharp/jimp：图标是"accent 圆角方 + 白色两横"的极简设计（与 TopBar 的
 * .mark logo 同源），纯色扫描线用自写编码器 60 行就够；为一个一次性脚本引入
 * 带原生二进制的依赖不值（SPEC §6 的少依赖原则）。
 *
 * 设计规格（512 画布）：
 *  - 背景 #2E4BA6（--accent），圆角 22%（iOS 主屏会自动再切圆角，Android 用 maskable）
 *  - 两条白色横杠：x ∈ [30%, 70%]，y 中心 37% / 55%，高 7%，圆头
 *  - maskable 版：图形缩进安全区（40% 内容区），背景铺满出血
 *
 * 用法：node scripts/gen-icons.mjs   （已生成的文件直接提交，构建不需要重跑）
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ACCENT = [0x2e, 0x4b, 0xa6]

// ---- 极简 PNG 编码（8-bit RGBA，filter 0） ----

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y)
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- 图形 ----

const TRANSP = [0, 0, 0, 0]
const WHITE = [255, 255, 255, 255]
const SOLID = [...ACCENT, 255]

/** 圆角矩形 SDF 判定（超采样 2×2 抗锯齿） */
function makePixel(size, { maskable }) {
  // maskable：内容缩到中间 60%（安全区 80% 再留余量），背景铺满
  const inset = maskable ? size * 0.2 : 0
  const s = size - inset * 2 // 内容画布边长
  const radius = maskable ? 0 : s * 0.22 // 普通版圆角；maskable 背景已铺满，图形无圆角
  const barX0 = inset + s * 0.30
  const barX1 = inset + s * 0.70
  const barH = s * 0.07
  const bars = [inset + s * 0.37, inset + s * 0.55]
  const half = barH / 2

  const inRoundedBg = (x, y) => {
    if (maskable) return true
    const r = radius
    // 四角圆心
    const cx = x < r ? r : x > size - r ? size - r : x
    const cy = y < r ? r : y > size - r ? size - r : y
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  const inBar = (x, y) =>
    x >= barX0 + half && x <= barX1 - half
      ? bars.some((cy) => Math.abs(y - cy) <= half)
      : bars.some((cy) => (x - (x < barX0 + half ? barX0 + half : barX1 - half)) ** 2 + (y - cy) ** 2 <= half * half)

  return (px, py) => {
    // 2×2 超采样
    let bg = 0
    let fg = 0
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const x = px + (i + 0.5) / 2
        const y = py + (j + 0.5) / 2
        if (inRoundedBg(x, y)) bg++
        if (inBar(x, y)) fg++
      }
    }
    if (fg >= 2) return fg === 4 ? WHITE : [255, 255, 255, Math.round((fg / 4) * 255)]
    if (bg === 0) return TRANSP
    if (bg < 4) return [...ACCENT, Math.round((bg / 4) * 255)]
    return SOLID
  }
}

mkdirSync(join(ROOT, 'public'), { recursive: true })
const outputs = [
  ['pwa-192x192.png', 192, false],
  ['pwa-512x512.png', 512, false],
  ['maskable-icon-512x512.png', 512, true],
  ['apple-touch-icon-180x180.png', 180, false],
]
for (const [name, size, maskable] of outputs) {
  const png = encodePng(size, makePixel(size, { maskable }))
  writeFileSync(join(ROOT, 'public', name), png)
  console.log(`${name}  ${png.length} bytes`)
}
