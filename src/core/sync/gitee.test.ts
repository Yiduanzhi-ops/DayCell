/**
 * core/sync/gitee 单元测试（v8.2 现行同步通道）。
 *
 * 验证 REST 调用形状：URL / 鉴权头 / 404 处理 / 创建 vs 更新（sha）/ UTF-8 base64 往返 / 错误归一。
 * 全部走注入 mock fetch，不碰 DOM、不碰网络。
 */

import { describe, expect, it, vi } from 'vitest'
import { assertGiteeConfig, createGiteeClient, SYNC_FILE_PATH, type GiteeConfig } from './gitee'
import { GiteeError } from '../errors'

const CFG: GiteeConfig = { owner: 'me', repo: 'daycell-sync', token: 'tok_abc' }

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const asFetch = (f: ReturnType<typeof vi.fn>): FetchLike => f as unknown as FetchLike

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** UTF-8 安全的 base64（与 gitee.ts 同实现；验证中文内容往返） */
const b64 = (s: string): string => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

const FILE_URL = `https://gitee.com/api/v5/repos/me/daycell-sync/contents/${SYNC_FILE_PATH}`

describe('assertGiteeConfig', () => {
  it('合法配置通过', () => {
    expect(() => assertGiteeConfig(CFG)).not.toThrow()
  })
  it('缺字段抛 GiteeError', () => {
    expect(() => assertGiteeConfig({ ...CFG, token: '' })).toThrow(GiteeError)
  })
  it('仓库名含非法字符抛 GiteeError', () => {
    expect(() => assertGiteeConfig({ ...CFG, repo: 'a/b' })).toThrow(GiteeError)
  })
})

describe('createGiteeClient', () => {
  it('fetchFile：仓库无文件（404）→ null', async () => {
    const f = vi.fn(async () => json({ message: 'not found' }, 404))
    const c = createGiteeClient(CFG, { fetchImpl: asFetch(f) })
    await expect(c.fetchFile()).resolves.toBeNull()
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${FILE_URL}?ref=master`)
    expect((init.headers as Record<string, string>).Authorization).toBe('token tok_abc')
  })

  it('fetchFile：有文件 → UTF-8 解码返回正文（含中文）', async () => {
    const content = '{"hi":"你好"}'
    const c = createGiteeClient(CFG, {
      fetchImpl: asFetch(vi.fn(async () => json({ sha: 's1', content: b64(content) }))),
    })
    await expect(c.fetchFile()).resolves.toBe(content)
  })

  it('fetchFile：非 404 错误（401）抛 GiteeError（带状态码文案）', async () => {
    const c = createGiteeClient(CFG, { fetchImpl: asFetch(vi.fn(async () => json({ message: 'x' }, 401))) })
    await expect(c.fetchFile()).rejects.toThrow('HTTP 401')
  })

  it('fetchFile：fetch 抛 TypeError（网络/CORS 拦截）→ 归一为 GiteeError', async () => {
    const c = createGiteeClient(CFG, {
      fetchImpl: asFetch(vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })),
    })
    await expect(c.fetchFile()).rejects.toThrow(GiteeError)
    await expect(c.fetchFile()).rejects.toThrow('无法连接同步服务器')
  })

  it('putFile：已有文件 → POST 带 sha 更新（先查后写，共 2 次请求）', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ sha: 's1', content: b64('old') })) // 查询
      .mockResolvedValueOnce(json({ content: { sha: 's2' } })) // 更新
    const c = createGiteeClient(CFG, { fetchImpl: asFetch(f) })
    await c.putFile('{"v":2}')
    expect(f).toHaveBeenCalledTimes(2)
    const [postUrl, postInit] = f.mock.calls[1] as unknown as [string, RequestInit]
    expect(postUrl).toBe(FILE_URL)
    expect(postInit.method).toBe('POST')
    const body = JSON.parse(String(postInit.body)) as Record<string, string>
    expect(body.sha).toBe('s1') // 更新必须带原 sha
    expect(body.branch).toBe('master')
    expect(body.message).toBe('sync')
    expect(body.content).toBe(b64('{"v":2}'))
  })

  it('putFile：无文件（404）→ POST 创建（不带 sha）', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'not found' }, 404)) // 查询
      .mockResolvedValueOnce(json({ content: { sha: 's1' } }, 201)) // 创建
    const c = createGiteeClient(CFG, { fetchImpl: asFetch(f) })
    await c.putFile('{"v":1}')
    expect(f).toHaveBeenCalledTimes(2)
    const [, postInit] = f.mock.calls[1] as unknown as [string, RequestInit]
    const body = JSON.parse(String(postInit.body)) as Record<string, string>
    expect(body.sha).toBeUndefined()
    expect(body.content).toBe(b64('{"v":1}'))
  })

  it('putFile：写失败（500）抛 GiteeError', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ sha: 's1', content: b64('old') }))
      .mockResolvedValueOnce(json({ message: 'x' }, 500))
    const c = createGiteeClient(CFG, { fetchImpl: asFetch(f) })
    await expect(c.putFile('x')).rejects.toThrow('HTTP 500')
  })

  it('网络错误在写路径同样归一为 GiteeError', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({ sha: 's1', content: b64('old') }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const c = createGiteeClient(CFG, { fetchImpl: asFetch(f) })
    await expect(c.putFile('x')).rejects.toThrow(GiteeError)
  })
})
