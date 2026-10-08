/**
 * 同步设置页（v8.1，坚果云 WebDAV）——全屏覆盖层，手机/桌面同构。
 *
 * 表单：WebDAV 地址 / 账号（坚果云邮箱）/ 应用密码（坚果云官网生成，非登录密码）。
 * 配置只存**本机浏览器**（localStorage），不进 IndexedDB、不进备份文件；
 * 数据本体在本地库 + 坚果云云端，配置丢了重填即可。
 *
 * 交互：
 *  - 保存：写配置 → 重建引擎 → 立即同步一次（toast 结果）
 *  - 立即同步：pull + push（补自动同步的盲区，见 engine.ts 注释）
 *  - 状态区：上次同步时间 / 最近错误 / 进行中
 */
import { useState } from 'react'
import type { JSX } from 'react'
import type { WebDavConfig } from '@core'
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

  const [url, setUrl] = useState(syncConfig?.url ?? '')
  const [user, setUser] = useState(syncConfig?.user ?? '')
  const [pass, setPass] = useState(syncConfig?.pass ?? '')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const configured = syncConfig !== null
  const busy = saving || syncing
  const complete = url.trim() !== '' && user.trim() !== '' && pass.trim() !== ''

  const onSave = async (): Promise<void> => {
    if (!complete || busy) return
    setSaving(true)
    const cfg: WebDavConfig = { url: url.trim(), user: user.trim(), pass: pass.trim() }
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
            通过坚果云 WebDAV 让电脑端与手机端数据互通：打开网页自动拉取，改动后自动推送。
            配置只保存在本机浏览器，数据本体在本地与坚果云云端各有一份。
          </p>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>WebDAV 地址</span>
            <input
              className={styles.input}
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://dav.jianguoyun.com/dav/daycell.json"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>账号（坚果云邮箱）</span>
            <input
              className={styles.input}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@example.com"
              value={user}
              onChange={(e) => setUser(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>应用密码</span>
            <input
              className={styles.input}
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="坚果云官网生成的专用密码"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </label>

          <p className={styles.tip}>
            应用密码在坚果云官网「账户信息 → 安全选项」生成（不是登录密码）。
            手机与电脑填同一份配置即可互相同步。
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
