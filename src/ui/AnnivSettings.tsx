/**
 * 纪念日设置页（v7.5，PRD M11 补全）——全屏覆盖层，手机/桌面同构。
 *
 * 支持四种频率（用户拍板：每周 / 每月 / 每年 + 兼容既有的一次性数据）：
 *  - 每周：选星期几（date 存一个参考日期，匹配只看 dow）
 *  - 每月：选日号 1-31（date 只取 DD；不存在的日期自动不命中）
 *  - 每年：公历月日 或 农历月日（可闰月，PRD E13）；date 年份固定 2000（闰年，2/29 合法）
 *  - 仅一次：完整日期（公历/农历）
 * 每周/每月仅公历（核心层防御：repo 也拒绝农历 weekly/monthly）。
 *
 * 展示规则：同日多纪念日时由 DayView 显示「前 2 个 +N」。
 */
import { useState } from 'react'
import type { JSX } from 'react'
import { addDays, dowOf, startOfWeek } from '@core'
import type { AnniversaryInput, AnniversaryRecord } from '@core'
import { useApp } from '@/app/context'
import styles from './AnnivSettings.module.css'

type Freq = 'none' | 'yearly' | 'monthly' | 'weekly'

const FREQ_OPTIONS: Array<{ value: Freq; label: string }> = [
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'yearly', label: '每年' },
  { value: 'none', label: '仅一次' },
]

const DOW_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

const LUNAR_MONTH = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'] as const
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const

/** 农历 MM-DD → 中文（如 '05-05' → '五月初五'） */
function lunarDateLabel(mmdd: string): string {
  const m = Number(mmdd.slice(0, 2))
  const d = Number(mmdd.slice(3, 5))
  let day: string
  if (d === 1) day = '初一'
  else if (d === 10) day = '初十'
  else if (d === 20) day = '二十'
  else if (d === 30) day = '三十'
  else if (d < 10) day = `初${CN_NUM[d - 1]}`
  else if (d < 20) day = `十${d % 10 === 0 ? '' : CN_NUM[(d % 10) - 1]}`
  else day = `廿${CN_NUM[(d % 10) - 1]}`
  return `${LUNAR_MONTH[m - 1]}月${day}`
}

/** 频率 + 日期的展示描述 */
export function anniversaryDesc(r: AnniversaryRecord): string {
  if (r.isLunar) {
    if (r.repeat === 'none') return `农历 ${r.date.slice(0, 4)} 年 ${lunarDateLabel(r.date)}`
    return `农历每年${lunarDateLabel(r.date)}${r.isLeapMonth ? '（闰月）' : ''}`
  }
  switch (r.repeat) {
    case 'weekly':
      return `每周${DOW_LABEL[dowOf(r.date as Parameters<typeof dowOf>[0])]}`
    case 'monthly':
      return `每月${Number(r.date.slice(8))}日`
    case 'yearly':
      return `每年${Number(r.date.slice(5, 7))}月${Number(r.date.slice(8))}日`
    default:
      return r.date
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** 日期存在性校验（2月30日等） */
function dateExists(y: number, m: number, d: number): boolean {
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

export function AnnivSettings(): JSX.Element {
  const annivList = useApp((s) => s.annivList)
  const closeAnniv = useApp((s) => s.closeAnniv)
  const deleteAnniversary = useApp((s) => s.deleteAnniversary)
  const [form, setForm] = useState<{ mode: 'add' } | { mode: 'edit'; rec: AnniversaryRecord } | null>(null)

  return (
    <div className={styles.overlay} role="dialog" aria-label="纪念日设置">
      <div className={styles.page}>
        <header className={styles.head}>
          <button className={styles.back} onClick={closeAnniv} aria-label="返回">
            ← 返回
          </button>
          <h1 className={styles.h1}>纪念日设置</h1>
          <button
            className={styles.addBtn}
            onClick={() => setForm({ mode: 'add' })}
            disabled={form !== null}
          >
            ＋ 新增
          </button>
        </header>

        {form === null ? (
          <ul className={styles.list}>
            {annivList.length === 0 && (
              <li className={styles.empty}>还没有纪念日，点右上角「＋ 新增」添加一个。</li>
            )}
            {annivList.map((r) => (
              <li key={r.id} className={styles.item}>
                <button
                  className={styles.itemMain}
                  onClick={() => setForm({ mode: 'edit', rec: r })}
                >
                  <span className={styles.itemTitle}>{r.title}</span>
                  <span className={styles.itemDesc}>{anniversaryDesc(r)}</span>
                </button>
                <button
                  className={styles.delBtn}
                  aria-label={`删除${r.title}`}
                  onClick={() => {
                    if (window.confirm(`删除纪念日「${r.title}」？`)) void deleteAnniversary(r.id)
                  }}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <AnnivForm
            key={form.mode === 'edit' ? form.rec.id : 'new'}
            initial={form.mode === 'edit' ? form.rec : null}
            onDone={() => setForm(null)}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 表单
// ---------------------------------------------------------------------------

function AnnivForm({ initial, onDone }: { initial: AnniversaryRecord | null; onDone: () => void }): JSX.Element {
  const today = useApp((s) => s.today)
  const createAnniversary = useApp((s) => s.createAnniversary)
  const updateAnniversary = useApp((s) => s.updateAnniversary)
  const showToast = useApp((s) => s.showToast)

  const [title, setTitle] = useState(initial?.title ?? '')
  const [freq, setFreq] = useState<Freq>(initial?.repeat ?? 'yearly')
  const [isLunar, setIsLunar] = useState(initial?.isLunar ?? false)
  const [isLeapMonth, setIsLeapMonth] = useState(initial?.isLeapMonth ?? false)

  const [dow, setDow] = useState<number>(
    initial && initial.repeat === 'weekly' ? dowOf(initial.date as Parameters<typeof dowOf>[0]) : 1,
  )
  const [mday, setMday] = useState(
    initial && initial.repeat === 'monthly' ? Number(initial.date.slice(8)) : 1,
  )

  // 年/月/日（yearly 用 2000 年锚定；none 用真实年份）
  const [solarYear, setSolarYear] = useState(
    initial && initial.repeat === 'none' && !initial.isLunar ? Number(initial.date.slice(0, 4)) : 2026,
  )
  const [lunarYear, setLunarYear] = useState(
    initial && initial.repeat === 'none' && initial.isLunar ? Number(initial.date.slice(0, 4)) : 2026,
  )
  const [month, setMonth] = useState(
    initial && initial.repeat !== 'weekly' && initial.repeat !== 'monthly'
      ? Number(initial.date.slice(5, 7))
      : 1,
  )
  const [day, setDay] = useState(
    initial && initial.repeat !== 'weekly' && initial.repeat !== 'monthly'
      ? Number(initial.date.slice(8))
      : 1,
  )

  const save = async (): Promise<void> => {
    const t = title.trim()
    if (!t) {
      showToast('请填写纪念日名称')
      return
    }
    let input: AnniversaryInput
    if (freq === 'weekly') {
      // date = 今天所在周（周一起）里选中的星期几，仅作参考日期
      const base = startOfWeek(today, 1)
      input = { title: t, date: addDays(base, (dow - 1 + 7) % 7), isLunar: false, repeat: 'weekly' }
    } else if (freq === 'monthly') {
      if (mday < 1 || mday > 31) {
        showToast('每月日期需在 1–31 之间')
        return
      }
      input = { title: t, date: `${today.slice(0, 4)}-01-${pad(mday)}`, isLunar: false, repeat: 'monthly' }
    } else if (freq === 'yearly') {
      const y = 2000 // 闰年，2/29 合法；date 只取 MM-DD
      if (!dateExists(y, month, day)) {
        showToast('日期不存在')
        return
      }
      input = {
        title: t,
        date: `${y}-${pad(month)}-${pad(day)}`,
        isLunar,
        repeat: 'yearly',
        isLeapMonth: isLunar ? isLeapMonth : undefined,
      }
    } else {
      const y = isLunar ? lunarYear : solarYear
      if (!dateExists(y, month, day)) {
        showToast('日期不存在')
        return
      }
      input = {
        title: t,
        date: `${y}-${pad(month)}-${pad(day)}`,
        isLunar,
        repeat: 'none',
        isLeapMonth: isLunar ? isLeapMonth : undefined,
      }
    }

    const ok = initial
      ? await updateAnniversary(initial.id, input)
      : await createAnniversary(input)
    if (ok) onDone()
  }

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>名称</span>
        <input
          className={styles.textInput}
          value={title}
          maxLength={20}
          placeholder="如：妈妈的生日、发工资"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>频率</span>
        <div className={styles.seg}>
          {FREQ_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={freq === o.value ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
              onClick={() => setFreq(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {freq === 'weekly' && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>星期</span>
          <div className={styles.dowRow}>
            {DOW_LABEL.map((name, i) => (
              <button
                key={name}
                className={dow === i ? `${styles.dowBtn} ${styles.dowOn}` : styles.dowBtn}
                onClick={() => setDow(i)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {freq === 'monthly' && (
        <div className={styles.field}>
          <span className={styles.fieldLabel}>每月</span>
          <div className={styles.row}>
            <input
              className={`${styles.textInput} ${styles.numInput}`}
              type="number"
              min={1}
              max={31}
              value={mday}
              onChange={(e) => setMday(Number(e.target.value))}
            />
            <span className={styles.hint}>日（不存在的日期自动跳过，如 2 月 31 日）</span>
          </div>
        </div>
      )}

      {(freq === 'yearly' || freq === 'none') && (
        <>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>历法</span>
            <div className={styles.seg}>
              <button
                className={!isLunar ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
                onClick={() => setIsLunar(false)}
              >
                公历
              </button>
              <button
                className={isLunar ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
                onClick={() => setIsLunar(true)}
              >
                农历
              </button>
            </div>
          </div>

          {freq === 'none' && (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>年份</span>
              <input
                className={`${styles.textInput} ${styles.numInput}`}
                type="number"
                min={1900}
                max={2100}
                value={isLunar ? lunarYear : solarYear}
                onChange={(e) => (isLunar ? setLunarYear : setSolarYear)(Number(e.target.value))}
              />
            </div>
          )}

          <div className={styles.field}>
            <span className={styles.fieldLabel}>{isLunar ? '农历' : '日期'}</span>
            <div className={styles.row}>
              <select
                className={styles.select}
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1} 月
                  </option>
                ))}
              </select>
              <select
                className={styles.select}
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
              >
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1} 日
                  </option>
                ))}
              </select>
              {isLunar && (
                <label className={styles.leap}>
                  <input
                    type="checkbox"
                    checked={isLeapMonth}
                    onChange={(e) => setIsLeapMonth(e.target.checked)}
                  />
                  闰月
                </label>
              )}
            </div>
          </div>
        </>
      )}

      <div className={styles.formActs}>
        <button className={styles.cancel} onClick={onDone}>
          取消
        </button>
        <button className={styles.save} onClick={() => void save()}>
          保存
        </button>
      </div>
    </div>
  )
}
