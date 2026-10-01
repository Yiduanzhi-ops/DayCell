/**
 * 生产入口：装配 core → 建 app store → 首次数据加载 → 挂载 React。
 *
 * 启动顺序是刻意的（PRD §5.1 首屏关键路径）：
 *  1. initCore 里 IndexedDB 打开 + 分类播种是同步等待的（没数据没法渲染）
 *  2. 农历库经 loadLunar **动态 import**，失败按 E4 降级为 null，不阻塞也不炸
 *  3. 首帧渲染的是日视图（今天）——aggregateDayDetail 只查 [昨天, 今天] 两天
 *
 * 启动页（#splash，v7.1）在 index.html 里自管生命周期：**固定显示 1.5s** 后淡出，
 * 与本文件的挂载时机无关（用户拍板要完整展示 branding）。应用通常在 1.5s 内已就绪，
 * 在 splash 底下完成首帧；即使启动抛错，splash 也会按时退场，不会卡死白屏。
 */
import { createRoot } from 'react-dom/client'
import { today } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore } from '@/app/store'
import { App } from '@/ui/App'
import '@/ui/tokens.css'

async function main(): Promise<void> {
  const bundle = await initCore()
  const store = createAppStore(bundle, { today: today() })
  await store.getState().init()

  const el = document.getElementById('root')
  if (!el) throw new Error('#root 不存在')
  createRoot(el).render(<App store={store} />)
}

void main()
