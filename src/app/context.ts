/**
 * React 绑定：AppStoreContext + useApp 选择器钩子。
 *
 * 用 zustand 的 vanilla store + context 而不是全局 create()，
 * 是为了**测试可以为每个用例建独立 store**（注入 memory store 与固定 today），
 * 用例之间零共享状态。
 */
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand'
import type { AppState } from './store'

export const AppStoreContext = createContext<StoreApi<AppState> | null>(null)

export function useApp<T>(selector: (s: AppState) => T): T {
  const store = useContext(AppStoreContext)
  if (!store) throw new Error('useApp 必须在 <AppStoreContext.Provider> 之内使用')
  return useStore(store, selector)
}
