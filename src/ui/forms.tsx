/**
 * 内联表单的共享底部动作条：取消 + 保存。
 * 三种表单（待办/花费/想法）共用，样式在 detail.module.css。
 * v7.2：不再展示「回车保存」等快捷键提示——手机端没有对应按键，属噪音。
 */
import type { JSX } from 'react'
import styles from './detail.module.css'

export function FormActs({
  onCancel,
  onSave,
}: {
  onCancel: () => void
  onSave: () => Promise<void> | void
}): JSX.Element {
  return (
    <div className={styles.acts}>
      <button className={styles.cancel} onClick={onCancel}>取消</button>
      <button className={styles.save} onClick={() => void onSave()}>保存</button>
    </div>
  )
}
