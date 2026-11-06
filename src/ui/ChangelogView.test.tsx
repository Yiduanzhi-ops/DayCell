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
    expect(screen.getByText('当前版本 v9.36')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '← 返回' }))
    expect(screen.queryByText('当前版本 v9.36')).not.toBeInTheDocument()
  })

  it('列表倒序：第一条是最新版本 v9.36，且最新版要点可见', async () => {
    await openChangelog()
    const vers = screen.getAllByText(/^v\d+(\.\d+)+$/)
    expect(vers[0].textContent).toBe('v9.36')
    // v9.36
    expect(screen.getByText(/电脑上用鼠标滚轮就能左右滑/)).toBeInTheDocument()
    // v9.35
    expect(screen.getByText(/目标详情顶部不再被默认说明撑高/)).toBeInTheDocument()
    // v9.34
    expect(screen.getByText(/导入备份能救回删掉的东西/)).toBeInTheDocument()
    expect(screen.getByText(/恢复 N 条已删除的记录/)).toBeInTheDocument()
    // v9.33
    expect(screen.getByText(/补回文件夹归属/)).toBeInTheDocument()
    expect(screen.getByText(/只补本地原本没有归属的目标/)).toBeInTheDocument()
    expect(screen.getByText(/日期默认就是「当天」/)).toBeInTheDocument()
    expect(screen.getByText(/只选提醒型、不填具体时刻时，类型也会正确记住/)).toBeInTheDocument()
    expect(screen.getByText(/点文件夹名本身就能折叠\/展开/)).toBeInTheDocument()
    expect(screen.getByText(/文件夹多了也不会被横向挤走/)).toBeInTheDocument()
    expect(screen.getByText(/不会再"建完就看不见"/)).toBeInTheDocument()
    expect(screen.getByText(/不用再借某个文件夹的入口绕一圈/)).toBeInTheDocument()
    // v9.32
    expect(screen.getByText(/导入备份不再因「settings 含未知项」整份被拒/)).toBeInTheDocument()
    expect(screen.getByText(/设置项只有结构坏了/)).toBeInTheDocument()
    // v9.31
    expect(screen.getByText(/只在完成那天显示/)).toBeInTheDocument()
    expect(screen.getByText(/历史日看到的就是干净的当天/)).toBeInTheDocument()
    expect(screen.getByText(/组头右侧的「新建目标」/)).toBeInTheDocument()
    // v9.30
    expect(screen.getByText(/目标、阶段、子任务、文件夹、习惯、打卡、复盘这七类以前不计入/)).toBeInTheDocument()
    expect(screen.getByText(/已合并导入：2 个目标、1 个文件夹、3 条待办/)).toBeInTheDocument()
    // v9.29
    expect(screen.getByText(/「未分类」组头那颗常驻按钮去掉/)).toBeInTheDocument()
    expect(screen.getByText(/单夹视图不再在组头和顶部各挂一个同效按钮/)).toBeInTheDocument()
    expect(screen.getByText(/按钮文案去掉/)).toBeInTheDocument()
    expect(screen.getByText(/拖拽柄/)).toBeInTheDocument()
    expect(screen.getByText(/iPhone 上拖动更跟手/)).toBeInTheDocument()
    expect(screen.getByText(/不再误选文字/)).toBeInTheDocument()
    expect(screen.getByText(/按住列表项拖动调整顺序/)).toBeInTheDocument()
    expect(screen.getByText(/不用再删除重建/)).toBeInTheDocument()
    expect(screen.getByText(/会员购买闭环上线/)).toBeInTheDocument()
    expect(screen.getByText(/我有兑换码，去激活/)).toBeInTheDocument()
    expect(screen.getByText(/批量生成兑换码接口/)).toBeInTheDocument()
    expect(screen.getByText(/点面板外空白才保存并关闭/)).toBeInTheDocument()
    expect(screen.getByText(/移动端点类型按钮不转移焦点/)).toBeInTheDocument()
    expect(screen.getByText(/「2 小时不打开就掉登录」/)).toBeInTheDocument()
    expect(screen.getByText(/每 20 分钟自动检查并续期/)).toBeInTheDocument()
    expect(screen.getByText(/提醒型待办「改日期后从提醒日消失」/)).toBeInTheDocument()
    expect(screen.getByText(/提醒型待办误显示「截止 M\/D」标签/)).toBeInTheDocument()
    expect(screen.getByText(/修复待办原地编辑「类型 \+ 日期」改不动/)).toBeInTheDocument()
    expect(screen.getByText(/修复切换「提醒型」后类型丢失/)).toBeInTheDocument()
    expect(screen.getByText(/自动归入该文件夹/)).toBeInTheDocument()
    expect(screen.getByText(/修复「文件夹查询失败 \/ 创建文件夹失败」/)).toBeInTheDocument()
    expect(screen.getByText(/设备列表（可解绑）/)).toBeInTheDocument()
    expect(screen.getByText(/子任务支持「＋ 加入今日待办」/)).toBeInTheDocument()
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
