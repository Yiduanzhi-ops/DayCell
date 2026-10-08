/**
 * core/sync/transport —— 同步传输接口（v8.2）。
 *
 * 引擎只依赖这一个形状，不关心底层是 WebDAV 还是 Gitee：
 *  - fetchFile：下载云端同步内容；云端还没有 → null
 *  - putFile：整体覆盖云端同步内容
 *
 * 实现（同目录）：
 *  - webdav.ts（v8.1 坚果云，因 CORS 浏览器不可用，保留实现与测试）
 *  - gitee.ts（v8.2 现行通道，Gitee 开放 API 支持浏览器跨域）
 */

export interface SyncTransport {
  /** 下载。云端尚无内容 → null；失败抛 DayCellError 子类 */
  fetchFile(): Promise<string | null>
  /** 整体覆盖。失败抛 DayCellError 子类 */
  putFile(text: string): Promise<void>
}
