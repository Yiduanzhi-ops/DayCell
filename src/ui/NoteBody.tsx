/**
 * v8.92：想法 / 复盘正文的只读展示块。
 *
 * 背景：此前整段正文被包在 <button> 里（.ntxtBtn），点哪儿都直接进编辑态——
 *  - 长文一碰就跳成输入框，排版全变，读起来断裂；
 *  - button 里的文字在浏览器里基本选不中、复制不了。
 *
 * 现在正文是普通文本（可选中复制），编辑由独立的「编辑」按钮触发；
 * 需要控制列表密度的位置（回顾页长列表）传 clamp，真折断了才给「展开全文」——
 * 判断走实测溢出（scrollHeight > clientHeight），不用字数估算免得刚满三行也弹按钮。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import styles from './detail.module.css'

/** 无布局能力的环境（jsdom 测试）里 scrollHeight 恒为 0，退化成按字数估：393px 宽约 24 字/行 */
const estimateOverflow = (text: string, lines: number): boolean =>
  text.length > lines * 24 || text.split('\n').length > lines

export function NoteBody({ text, clamp }: { text: string; clamp?: number }): JSX.Element {
  const lines = clamp ?? 0
  const ref = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || lines <= 0) {
      setOverflow(false)
      return
    }
    const measured = el.scrollHeight > el.clientHeight + 1
    setOverflow(measured || (el.scrollHeight === 0 && estimateOverflow(text, lines)))
  }, [text, lines])

  // 折叠样式必须一直挂着：只有先限高，scrollHeight / clientHeight 才能测出「到底折没折断」。
  // 折没折断由 overflow 决定，未折断时这个限高只是不起作用（内容本来就在 3 行内）。
  const showClamp = lines > 0 && !expanded

  return (
    <>
      <div
        ref={ref}
        className={styles.ntxt}
        style={
          showClamp
            ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
            : undefined
        }
      >
        {text}
      </div>
      {lines > 0 && overflow && (
        <button
          type="button"
          className={styles.moreBtn}
          aria-expanded={expanded}
          aria-label={expanded ? '收起全文' : '展开全文'}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </>
  )
}
