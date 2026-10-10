/**
 * ui/ChangelogView 测试（v8.4 版本更新页）：
 *  - 从菜单进入、返回关闭
 *  - 页首显示当前版本号
 *  - 列表倒序（第一条是最新版本 v8.4）
 *  - 每版至少一条要点、不含空的过期占位
 */

// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createMemoryStore, type DateKey } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore } from '@/app/store'
import { App } from './App'

afterEach(cleanup)

const TODAY = '2026-10-08' as DateKey

async function renderApp() {
  localStorage.clear()
  const bundle = await initCore({ store: createMemoryStore(), skipLunar: true })
  const store = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
  await store.getState().init()
  render(<App store={store} />)
  return store
}

async function openChangelog() {
  await renderApp()
  fireEvent.click(screen.getByRole('button', { name: '菜单' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '版本更新' }))
}

describe('ChangelogView（版本更新）', () => {
  it('从菜单进入版本更新页，返回后关闭', async () => {
    await openChangelog()
    expect(screen.getByText('当前版本 v8.9')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '← 返回' }))
    expect(screen.queryByText('当前版本 v8.9')).not.toBeInTheDocument()
  })

  it('列表倒序：第一条是最新版本 v8.9，且最新版要点可见', async () => {
    await openChangelog()
    const vers = screen.getAllByText(/^v\d+\.\d+$/)
    expect(vers[0].textContent).toBe('v8.9')
    expect(screen.getByText('子任务支持「描述」：点描述区域（或「＋ 添加描述」）就地编辑，内容常驻显示在子任务标题下方（最多 500 字，多行），完成时随标题一起淡化')).toBeInTheDocument()
  })

  it('历史版本（v8.2 同步、v7.9 目标、v7.5 菜单）要点存在', async () => {
    await openChangelog()
    expect(screen.getByText('跨设备同步改走 Gitee 私有仓库：配置一次自动同步，同步即异地备份')).toBeInTheDocument()
    expect(screen.getByText('新增「目标」模块：阶段性目标 + 阶段列表 + 阐述总结，底部 tab 进入')).toBeInTheDocument()
    expect(screen.getByText('新增右上角菜单：备份导出 / 合并导入 / 一键导出 MD / 纪念日设置 / 夜间模式')).toBeInTheDocument()
  })

  it('早期版本（v6 三视图、v5 双视图、v0–v1 定位）要点存在', async () => {
    await openChangelog()
    expect(screen.getByText('三视图上线：默认「今天」落地页，可切换周 / 月')).toBeInTheDocument()
    expect(screen.getByText('月 / 周双视图定型：月看密度、周看内容')).toBeInTheDocument()
    expect(screen.getByText('定下核心定位：以「一天」为容器，记录待办 / 想法 / 花费')).toBeInTheDocument()
  })
})
