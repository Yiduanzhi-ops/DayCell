/**
 * core/sync/webdav —— 极简 WebDAV 客户端（v8.1 坚果云同步）。
 *
 * ⚠️ **2026-10-08 实测：坚果云 WebDAV 不返回 CORS 许可头，浏览器会拦截所有跨域请求，
 * 纯网页应用无法直连坚果云**（ADR-0009 已修订，现行通道是 gitee.ts）。
 * 本文件保留为传输层实现之一（对支持 CORS 的 WebDAV 服务仍可用），
 * 引擎通过 SyncTransport 接口接入，不感知具体实现。
 *
 * 只实现同步需要的两个动词：
 *  - `GET`：下载云端文件（404 = 文件还不存在 → 返回 null）
 *  - `PUT`：整体覆盖云端文件（WebDAV 语义，个人全量 JSON 足够）
 *
 * 设计约束：
 *  - **纯 core：禁 React/DOM**（isolation.test.ts 守护）；fetch 由调用方注入
 *    （浏览器给 globalThis.fetch，测试给 mock），顶层不碰全局
 *  - 鉴权用 Basic Auth（user:pass → base64），WebDAV"应用密码"正是为此设计
 *  - 任何非 2xx（除 GET 404）抛 WebDavError，携带状态码，UI 层转成中文提示
 */

import { WebDavError } from '../errors'
import type { SyncTransport } from './transport'

export interface WebDavConfig {
  /** 云端文件完整 URL，如 https://dav.jianguoyun.com/dav/daycell-sync.json */
  url: string
  /** 坚果云账号（注册邮箱） */
  user: string
  /** 坚果云"应用密码"（坚果云官网生成，非登录密码） */
  pass: string
}

export interface WebDavClient extends SyncTransport {
  /** GET。文件不存在（404）→ null；其余错误抛 WebDavError */
  fetchFile(): Promise<string | null>
  /** PUT 整体覆盖。非 2xx 抛 WebDavError */
  putFile(text: string): Promise<void>
}

export interface WebDavDeps {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}

const authHeader = (cfg: WebDavConfig): string =>
  `Basic ${btoa(`${cfg.user}:${cfg.pass}`)}`

/** 校验配置非空；非法直接抛 WebDavError（设置页保存前也做同一校验） */
export function assertWebDavConfig(cfg: WebDavConfig): void {
  if (!cfg.url.trim() || !cfg.user.trim() || !cfg.pass.trim()) {
    throw new WebDavError('请完整填写 WebDAV 地址、账号与应用密码')
  }
  try {
    new URL(cfg.url)
  } catch {
    throw new WebDavError('WebDAV 地址格式不正确，应以 https:// 开头')
  }
}

export function createWebDavClient(cfg: WebDavConfig, deps: WebDavDeps = {}): WebDavClient {
  assertWebDavConfig(cfg)
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new WebDavError('当前环境不支持网络请求')

  const auth = authHeader(cfg)

  const fetchFile = async (): Promise<string | null> => {
    let res: Response
    try {
      res = await fetchImpl(cfg.url, { method: 'GET', headers: { Authorization: auth } })
    } catch (e) {
      throw new WebDavError('无法连接同步服务器，请检查网络', e)
    }
    if (res.status === 404) return null
    if (!res.ok) throw new WebDavError(`同步失败（HTTP ${res.status}），请检查账号与应用密码`, undefined)
    return await res.text()
  }

  const putFile = async (text: string): Promise<void> => {
    let res: Response
    try {
      res = await fetchImpl(cfg.url, {
        method: 'PUT',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: text,
      })
    } catch (e) {
      throw new WebDavError('无法连接同步服务器，请检查网络', e)
    }
    if (!res.ok) throw new WebDavError(`同步失败（HTTP ${res.status}），请检查账号与应用密码`, undefined)
  }

  return { fetchFile, putFile }
}
