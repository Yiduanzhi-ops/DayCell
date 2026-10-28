/**
 * DayCell Service Worker（v9.3，injectManifest 自定义版）。
 *
 * 职责：
 *  1. 预缓存全部构建产物（与 v7.1 起的 generateSW 版一致，纯 precache 无 runtime caching）
 *  2. **Web Push 展示**（v9.3 新增）：收到 push 事件 → showNotification；
 *     点击通知 → 聚焦已开窗口，否则按 data.url 打开新窗口
 *  3. 导航回退到 index.html（相对路径，CloudBase 根路径 / GitHub Pages 子路径双兼容）
 *
 * 注意：所有路径都写相对路径（相对 SW 自身作用域解析），
 * 避免 CloudBase 预览站（根路径部署）拿到 /DayCell/ 前缀而 404。
 */
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope

// autoUpdate 语义（v8.19 起）：新 SW 安装即接管，下次导航/刷新即新版
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', () => {
  cleanupOutdatedCaches()
  self.clients.claim()
})

// 预缓存清单（vite-plugin-pwa 构建时注入 self.__WB_MANIFEST）
precacheAndRoute(self.__WB_MANIFEST)

// 导航回退：断网/离线刷新时打开 index.html（相对 SW scope 解析）
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// ---- v9.3 Web Push ----
interface PushPayload {
  title?: string
  body?: string
  data?: { url?: string }
}

self.addEventListener('push', (event) => {
  let payload: PushPayload | null = null
  try {
    payload = event.data ? (event.data.json() as PushPayload) : null
  } catch {
    payload = null // 坏负载（非 JSON）静默忽略
  }
  const p = payload ?? {}
  const options: NotificationOptions = {
    body: p.body ?? '',
    icon: 'pwa-192x192.png',
    badge: 'pwa-192x192.png',
    data: p.data ?? {},
    tag: 'daycell-daily',
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(p.title ?? 'DayCell', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? './'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        if ('focus' in client) {
          await client.focus()
          return
        }
      }
      await self.clients.openWindow(url)
    })(),
  )
})

export {}
