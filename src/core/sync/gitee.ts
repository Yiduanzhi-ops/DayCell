/**
 * core/sync/gitee —— Gitee 仓库文件同步客户端（v8.2 现行同步通道）。
 *
 * 通道演化（ADR-0009 修订）：
 *  1. v8.1 坚果云 WebDAV —— 服务端不返回 CORS 许可头，浏览器拦截所有跨域请求，不可行
 *  2. v8.2 初 LeanCloud 数据存储 —— 官方支持 CORS，但 2026-01-12 起停止注册/建应用、进入停服善后期，不可用
 *  3. **Gitee 开放 API（现行）** —— 实测支持浏览器跨域（Access-Control-Allow-Origin: *，
 *     PUT/POST 预检放行），国内访问稳定，免费。数据存在用户自己的**私有仓库**里的一个 JSON 文件。
 *
 * 存储模型：私有仓库内固定路径文件 `daycell-sync.json`（master 分支）。
 *  - 读：GET /api/v5/repos/{owner}/{repo}/contents/{path}?ref=master
 *        → 200 { content: base64 }；404（文件不存在）→ null
 *  - 写：先 GET 取 sha → 有 sha 则 POST（带 sha 更新）→ 无则 POST（创建）
 *    Gitee 创建/更新统一 POST /contents/{path}（更新必须带原文件 sha，防覆盖丢失）
 *
 * 鉴权：`Authorization: token <私人令牌>`（Gitee 官方支持；实测预检放行 authorization 头）。
 * 令牌作用域建议只勾「projects」（读写仓库文件），泄露最坏情况=该私有仓库文件被读写。
 *
 * 设计约束（同 webdav.ts）：纯 core，禁 React/DOM；fetch 注入；顶层不碰全局。
 */

import { GiteeError } from '../errors'
import type { SyncTransport } from './transport'

export interface GiteeConfig {
  /** Gitee 用户名或组织名（仓库拥有者） */
  owner: string
  /** 仓库名（私有仓库，同步文件存在里面） */
  repo: string
  /** 私人令牌（Gitee 设置 → 私人令牌；作用域勾「projects」即可） */
  token: string
}

export interface GiteeDeps {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}

/** 同步文件路径与分支（固定；私有仓库 master 分支） */
export const SYNC_FILE_PATH = 'daycell-sync.json'
const SYNC_BRANCH = 'master'

/** 校验配置非空；非法直接抛 GiteeError（设置页保存前也做同一校验） */
export function assertGiteeConfig(cfg: GiteeConfig): void {
  if (!cfg.owner.trim() || !cfg.repo.trim() || !cfg.token.trim()) {
    throw new GiteeError('请完整填写 Gitee 用户名、仓库名与私人令牌')
  }
  if (/[/\\]/.test(cfg.owner.trim()) || /[/\\]/.test(cfg.repo.trim())) {
    throw new GiteeError('用户名/仓库名包含非法字符')
  }
}

/** UTF-8 安全的 base64 编解码（Gitee content 字段是 base64；JSON 含中文） */
const b64encode = (s: string): string => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
const b64decode = (b64: string): string => {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const toError = (e: unknown): GiteeError =>
  e instanceof GiteeError ? e : new GiteeError('无法连接同步服务器，请检查网络', e)

export function createGiteeClient(cfg: GiteeConfig, deps: GiteeDeps = {}): SyncTransport {
  assertGiteeConfig(cfg)
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new GiteeError('当前环境不支持网络请求')

  const owner = encodeURIComponent(cfg.owner.trim())
  const repo = encodeURIComponent(cfg.repo.trim())
  const fileUrl = `https://gitee.com/api/v5/repos/${owner}/${repo}/contents/${SYNC_FILE_PATH}`
  const headers = { Authorization: `token ${cfg.token.trim()}` }

  /** 读文件元信息 → { sha, content } | null（404 = 文件不存在） */
  const fetchMeta = async (): Promise<{ sha: string; content: string | null } | null> => {
    let res: Response
    try {
      res = await fetchImpl(`${fileUrl}?ref=${SYNC_BRANCH}`, { method: 'GET', headers })
    } catch (e) {
      throw toError(e)
    }
    if (res.status === 404) return null
    if (!res.ok) throw new GiteeError(`同步失败（HTTP ${res.status}），请检查令牌与仓库权限`, undefined)
    const json = (await res.json()) as { sha?: string; content?: string }
    if (typeof json.sha !== 'string') return null
    return { sha: json.sha, content: typeof json.content === 'string' ? b64decode(json.content) : null }
  }

  const fetchFile = async (): Promise<string | null> => {
    const meta = await fetchMeta()
    return meta?.content ?? null
  }

  const putFile = async (text: string): Promise<void> => {
    const meta = await fetchMeta()
    const body = JSON.stringify({
      access_token: cfg.token.trim(),
      content: b64encode(text),
      message: 'sync',
      branch: SYNC_BRANCH,
      ...(meta ? { sha: meta.sha } : {}),
    })
    let res: Response
    try {
      res = await fetchImpl(fileUrl, { method: 'POST', headers, body })
    } catch (e) {
      throw toError(e)
    }
    if (!res.ok) throw new GiteeError(`同步失败（HTTP ${res.status}），请检查令牌与仓库权限`, undefined)
  }

  return { fetchFile, putFile }
}
