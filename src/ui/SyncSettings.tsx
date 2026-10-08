/**
 * 同步设置页（v8.2，Gitee 仓库文件同步）——全屏覆盖层，手机/桌面同构。
 *
 * 通道为什么是 Gitee（ADR-0009 修订）：
 *  1. 坚果云 WebDAV —— 服务端不返回 CORS 许可头，浏览器会拦截网页里的所有跨域读写，不可行
 *  2. LeanCloud 数据存储 —— 官方支持 CORS，但 2026-01-12 起停止注册/建应用、进入停服善后期，不可用
 *  3. Gitee 开放 API（现行）—— 实测支持浏览器跨域，国内访问稳定，免费；数据存在你自己的私有仓库
 *
 * 表单三字段：Gitee 用户名 / 仓库名 / 私人令牌。
 * 配置只存**本机浏览器**（localStorage），不进 IndexedDB、不进备份文件；
 * 数据本体在本地库 + Gitee 私有仓库云端，配置丢了重填即可。
 *
 * 交互：
 *  - 保存：写配置 → 重建引擎 → 立即同步一次（toast 结果）
 *  - 立即同步：pull + push（补自动同步的盲区，见 engine.ts 注释）
 *  - 状态区：上次同步时间 / 最近错误 / 进行中
 */
import { useState } from 'react'
import type { JSX } from 'react'
import type { GiteeConfig } from '@core'
import { useApp } from '@/app/context'
import styles from './SyncSettings.module.css'

const fmtTime = (t: number | null): string =>
  t === null ? '从未' : new Date(t).toLocaleString()

export function SyncSettings(): JSX.Element {
  const syncConfig = useApp((s) => s.syncConfig)
  const syncStatus = useApp((s) => s.syncStatus)
  const closeSync = useApp((s) => s.closeSync)
  const saveSyncConfig = useApp((s) => s.saveSyncConfig)
  const syncNow = useApp((s) => s.syncNow)

  const [owner, setOwner] = useState(syncConfig?.owner ?? '')
  const [repo, setRepo] = useState(syncConfig?.repo ?? '')
  const [token, setToken] = useState(syncConfig?.token ?? '')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const configured = syncConfig !== null
  const busy = saving || syncing
  const complete = owner.trim() !== '' && repo.trim() !== '' && token.trim() !== ''

  const onSave = async (): Promise<void> => {
    if (!complete || busy) return
    setSaving(true)
    const cfg: GiteeConfig = { owner: owner.trim(), repo: repo.trim(), token: token.trim() }
    try {
      await saveSyncConfig(cfg)
    } finally {
      setSaving(false)
    }
  }

  const onSync = async (): Promise<void> => {
    if (busy) return
    setSyncing(true)
    try {
      await syncNow()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.page}>
        <div className={styles.head}>
          <button className={styles.back} onClick={closeSync}>
            ← 返回
          </button>
          <h1 className={styles.h1}>同步设置</h1>
          <span className={styles.headSpacer} />
        </div>

        <div className={styles.body}>
          <p className={styles.hint}>
            通过 Gitee 私有仓库让电脑端与手机端数据互通：打开网页自动拉取，改动后自动推送。
            配置只保存在本机浏览器，数据本体在本地与 Gitee 私有仓库各有一份。
          </p>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Gitee 用户名</span>
            <input
              className={styles.input}
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="如 yiduanzhi"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>仓库名</span>
            <input
              className={styles.input}
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="私有仓库名，如 daycell-sync"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>私人令牌</span>
            <input
              className={styles.input}
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Gitee → 设置 → 私人令牌"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>

          <p className={styles.tip}>
            注册 gitee.com（免费）→ 新建一个<strong>私有仓库</strong>（默认分支保持 master）→
            「设置 → 私人令牌」生成令牌，作用域勾「projects」即可。
            手机与电脑填同一份配置即可互相同步。同步文件固定为仓库内 daycell-sync.json。
          </p>

          <div className={styles.actions}>
            <button
              className={`${styles.btn} ${styles.primary}`}
              disabled={!complete || busy}
              onClick={() => void onSave()}
            >
              {saving ? '保存中…' : configured ? '保存并立即同步' : '保存'}
            </button>
            <button
              className={styles.btn}
              disabled={!configured || busy}
              onClick={() => void onSync()}
            >
              {syncing ? '同步中…' : '立即同步'}
            </button>
          </div>

          <div className={styles.status}>
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>同步状态</span>
              <span className={syncStatus?.state === 'error' ? styles.err : styles.ok}>
                {!configured
                  ? '未配置'
                  : syncStatus?.state === 'syncing'
                    ? '同步中…'
                    : syncStatus?.state === 'error'
                      ? '同步出错'
                      : '已开启'}
              </span>
            </div>
            {configured && (
              <>
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>上次同步</span>
                  <span>{fmtTime(syncStatus?.lastSyncAt ?? null)}</span>
                </div>
                {syncStatus?.state === 'error' && syncStatus.lastError && (
                  <div className={styles.errRow}>{syncStatus.lastError}</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
