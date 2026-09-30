/**
 * 金额格式化（CORE-API §5.6 末尾）。
 *
 * **为什么规则属于 core 而不是 UI**：日详情、周行、月格、CSV 导出四处都要显示金额，
 * 放在 UI 里就会长出四份实现然后各自漂移——这和 ADR-0003「金额只存整数分」是同一条理由。
 *
 * ⚠️ 一律**整数分进、字符串出**。`formatMoney` / `formatMoneyCsv` 全程只用整数除法与取模，
 *    不出现 `cents / 100` 的小数结果；`formatMoneyShort` 的「万」档需要一位小数，
 *    那里用的是对整数分做 `Math.round(a / 100_000)`，**不是**先化成元再舍入。
 *    （对比：`1.005 * 100 === 100.49999999999999`，先化元再乘回去一定会错档。）
 */

/** 拆成 符号 / 整数元 / 分余数，全部整数运算 */
function split(cents: number): { sign: string; abs: number } {
  const n = Number.isFinite(cents) ? Math.trunc(cents) : 0
  return { sign: n < 0 ? '-' : '', abs: Math.abs(n) }
}

/** 两位小数，元为单位。2850 → '28.50'，5 → '0.05'，-1 → '-0.01' */
export function formatMoney(cents: number): string {
  const { sign, abs } = split(cents)
  const yuan = Math.floor(abs / 100)
  const frac = abs % 100
  return `${sign}${yuan}.${String(frac).padStart(2, '0')}`
}

/**
 * CSV 导出用：元为单位、两位小数、**不带货币符号也不带千分位**。
 *
 * 当前与 `formatMoney` 同值，但**故意不合并**：CSV 是要被 Excel 读回去的长期格式，
 * 一旦哪天给 `formatMoney` 加上 '¥' 或千分位（UI 很可能会想加），导出文件就静默坏掉。
 * 分开两个函数 = 把这个耦合显式化。
 */
export function formatMoneyCsv(cents: number): string {
  return formatMoney(cents)
}

/** 一位小数，末尾的 '.0' 去掉（纯整数运算，不经过元） */
function oneDecimalTenthOfYuan(abs: number): string {
  let yuan = Math.floor(abs / 100)
  let tenth = Math.round((abs % 100) / 10)
  if (tenth === 10) {
    tenth = 0
    yuan += 1
  }
  return tenth === 0 ? String(yuan) : `${yuan}.${tenth}`
}

/**
 * 紧凑格式，给**月格**用（PRD §3.4）：
 *  - `< 100 元`  → 一位小数并去掉尾零：2850 → '28.5'，2800 → '28'
 *  - `≥ 100 元`  → 取整元：50000 → '500'
 *  - `≥ 1 万元`  → x.x万：12_345_678 → '12.3万'
 *  - `≥ 100 万元` → 整万（否则 '1234.5万' 在格子里放不下）：1_234_567_890 → '1235万'
 *
 * **不带货币符号**——符号由视图加（原型月格是 '¥500'）。这样 core 不需要知道
 * 展示层要不要符号，也避免 CSV 与 UI 共用一个函数时被迫都带上 '¥'。
 *
 * `0` 返回 `'0'` 而不是 `''`：**要不要显示**是视图的决定（月格花费为 0 时整个不渲染），
 * 格式化函数不该替视图做这个判断。
 */
export function formatMoneyShort(cents: number): string {
  const { sign, abs } = split(cents)

  const WAN = 1_000_000 // 1 万元 = 100 万分
  if (abs >= WAN) {
    // 以「0.1 万」为单位（= 10 万分）做整数舍入，避免先化成万元浮点数
    const tenthWan = Math.round(abs / 100_000)
    if (tenthWan >= 1000) return `${sign}${Math.round(abs / WAN)}万`
    const wYuan = Math.floor(tenthWan / 10)
    const wFrac = tenthWan % 10
    return `${sign}${wFrac === 0 ? wYuan : `${wYuan}.${wFrac}`}万`
  }

  if (abs >= 10_000) return `${sign}${Math.round(abs / 100)}`
  return `${sign}${oneDecimalTenthOfYuan(abs)}`
}
