/**
 * 内联表单的共享底部动作条：提示 + 取消 + 保存。
 * 三种表单（待办/花费/想法）共用，样式在 detail.module.css。
 */
import type { JSX } from 'react'
import styles from './detail.module.css'

export function FormActs({
  tip,
  onCancel,
  onSave,
}: {
  tip: string
  onCancel: () => void
  onSave: () => Promise<void> | void
}): JSX.Element {
  return (
    <div className={styles.acts}>
      <span className={styles.tip}>{tip}</span>
      <button className={styles.cancel} onClick={onCancel}>取消</button>
      <button className={styles.save} onClick={() => void onSave()}>保存</button>
    </div>
  )
}
