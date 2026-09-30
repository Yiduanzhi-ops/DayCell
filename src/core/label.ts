/**
 * 格子标签（CORE-API §5.7）。
 *
 * **纯函数**：不查库、不碰农历库，输入是已经解析好的 `LunarInfo | null` 与纪念日标题数组。
 * 这样农历加载失败时（PRD E4）这条链路照常工作，只是标签降级。
 *
 * 优先级（PRD D14）：纪念日 > 节日 > 节气 > 农历月初一 > 农历日。
 * 一个格子只放一行标签，所以必须有个确定的取舍顺序，否则同一天会闪。
 */

import type { LunarInfo } from './lunar'

export type LabelKind =
  | 'anniversary'
  | 'festival'
  | 'solarTerm'
  | 'lunarMonth'
  | 'lunarDay'
  | 'none'

export interface CellLabel {
  /** 显示的文本；kind='none' 时为空串，UI 应留白而不是显示占位符 */
  text: string
  kind: LabelKind
  /** 是否用强调色。农历日常规显示，其余四类强调 */
  emphasis: boolean
  /** 同一天还有几个纪念日没显示出来（text 只放第一个） */
  extra?: number
}

const NONE: CellLabel = { text: '', kind: 'none', emphasis: false }

/**
 * 算出一格的标签。
 *
 * @param lunar        `lunarOf()` 的结果；null 表示农历不可用或超出范围
 * @param anniversaries 落在这一天的纪念日标题，**已按用户顺序排好**
 */
export function cellLabel(lunar: LunarInfo | null, anniversaries: readonly string[] = []): CellLabel {
  if (anniversaries.length > 0) {
    return {
      text: anniversaries[0]!,
      kind: 'anniversary',
      emphasis: true,
      // 只有真的多出来才带 extra，避免 UI 渲染一个 "+0"
      ...(anniversaries.length > 1 ? { extra: anniversaries.length - 1 } : {}),
    }
  }

  // 农历不可用 → 标签位留空，公历日期照常显示（PRD E4：不白屏、不显示错误）
  if (!lunar) return NONE

  if (lunar.festival) return { text: lunar.festival, kind: 'festival', emphasis: true }
  if (lunar.solarTerm) return { text: lunar.solarTerm, kind: 'solarTerm', emphasis: true }

  // 初一显示月份名而不是"初一"（PRD D14）——这是月视图上唯一有用的农历锚点。
  // lunarMonth 已经自带「闰」前缀（见 LunarInfo 的注释），这里直接拼「月」。
  if (lunar.lunarDay === '初一') {
    return { text: `${lunar.lunarMonth}月`, kind: 'lunarMonth', emphasis: true }
  }

  return { text: lunar.lunarDay, kind: 'lunarDay', emphasis: false }
}

/**
 * 日详情页的农历完整表述，如「中秋节 · 八月十五」。
 *
 * 与格子标签不同：这里不做取舍，能拼的都拼上。
 * 农历不可用时返回空串，调用方据此整行不渲染。
 */
export function lunarFullText(lunar: LunarInfo | null): string {
  if (!lunar) return ''
  const parts: string[] = []
  if (lunar.festival) parts.push(lunar.festival)
  if (lunar.solarTerm) parts.push(lunar.solarTerm)
  parts.push(`${lunar.lunarMonth}月${lunar.lunarDay}`)
  return parts.join(' · ')
}
