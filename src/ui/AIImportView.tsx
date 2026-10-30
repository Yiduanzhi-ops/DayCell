/**
 * v9.2 AI 智能导入全屏页（今日页待办区块 ✦ 入口）。
 *
 * 流程：输入一段话（支持语音，能力可用时显示麦克风按钮）→ 调 /ai/import
 *       → 预览（四组：待办/习惯/想法/目标，默认全勾，每条可编辑文字/日期/频率）
 *       → 确认导入（store.aiImportItems 落库，支持任意日期）→ toast 返回。
 * 配额：由后端返回（非会员试用总额 / 会员每日），前端不写死数字；0 时整理按钮禁用。
 * 设计：语音引擎走 voiceInput.ts 抽象（MVP Web Speech，预留腾讯云 ASR）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import type { AiImportResult } from '@/app/store'
import { aiImport, aiQuota, getAccessToken } from './cloudbase'
import { speechSupported, startVoiceRecord, type VoiceRecordHandle } from './voiceInput'
import styles from './AIImportView.module.css'

/** 示例 chips（点击即填入，降低空输入门槛） */
const EXAMPLES = [
  '今天买牛奶和洗衣液，晚上7点健身房跑步',
  '明天上午交周报，后天体检',
  '每周三五晚上学英语，想养成每天喝水的习惯',
  '想做个智能猫粮喂食器，今年目标是把体重降到140斤',
]

const DOW = ['日', '一', '二', '三', '四', '五', '六']

/** 'YYYY-MM-DD' → '今天/明天/后天/M月D日' */
function dateLabel(k: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return k
  const day = 24 * 3600 * 1000
  const a = new Date(today + 'T00:00:00').getTime()
  const b = new Date(k + 'T00:00:00').getTime()
  const diff = Math.round((b - a) / day)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  return `${Number(k.slice(5, 7))}月${Number(k.slice(8, 10))}日`
}

/** 频率标签 */
function freqLabel(freq: { kind: 'daily' } | { kind: 'weekly'; weekdays: number[] }): string {
  if (freq.kind === 'daily') return '每天'
  const ds = [...(freq.weekdays || [])].sort((a, b) => a - b)
  return `每周${ds.map((d) => DOW[d]).join('')}`
}

export function AIImportView(): JSX.Element {
  const setAiOpen = useApp((s) => s.setAiOpen)
  const aiRemaining = useApp((s) => s.aiRemaining)
  const setAiRemaining = useApp((s) => s.setAiRemaining)
  const aiImportItems = useApp((s) => s.aiImportItems)
  const today = useApp((s) => s.today)

  const [phase, setPhase] = useState<'input' | 'analyzing' | 'preview'>('input')
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<AiImportResult | null>(null)
  /** 未勾选（取消导入）的条目 key：`${group}:${index}`；默认全勾 */
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  /** 正在就地编辑的条目：`${group}:${index}:${field}`，field ∈ text|date|freq */
  const [editing, setEditing] = useState<string | null>(null)
  const [editingVal, setEditingVal] = useState('')
  const [listening, setListening] = useState(false)
  /** 录音已进行秒数（实时反馈，用户边说边看） */
  const [recSec, setRecSec] = useState(0)
  /** 本次导入是否语音发起（loading 文案区分） */
  const [viaVoice, setViaVoice] = useState(false)
  const recordRef = useRef<VoiceRecordHandle | null>(null)
  const recTimer = useRef<number | null>(null)
  /** v9.8 实时听写定时器 */
  const listenTimer = useRef<number | null>(null)

  const canSpeech = speechSupported()

  // v9.7 配额显示：打开即拉取当前身份剩余次数（不消耗）；未登录/失败时静默，剩余保持未知
  const [quotaLine, setQuotaLine] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      const token = await getAccessToken()
      if (!token) return
      const q = await aiQuota(token)
      if (!alive || !q.ok || q.remaining == null) return
      if (q.remaining === 0) setAiRemaining(0)
      setQuotaLine(
        q.mode === 'trial_total'
          ? `AI 试用剩余 ${q.remaining} 次`
          : `今日 AI 剩余 ${q.remaining} 次`,
      )
    })()
    return () => {
      alive = false
    }
  }, [setAiRemaining])

  const checkedCount = useMemo(() => {
    if (!result) return 0
    let n = 0
    const groups: Array<[string, number]> = [
      ['todo', result.todos.length],
      ['habit', result.habits.length],
      ['note', result.notes.length],
      ['goal', result.goals.length],
    ]
    for (const [g, len] of groups) {
      for (let i = 0; i < len; i++) if (!unchecked.has(`${g}:${i}`)) n++
    }
    return n
  }, [result, unchecked])

  const keyOf = (g: string, i: number): string => `${g}:${i}`
  const toggle = (k: string): void => {
    const next = new Set(unchecked)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setUnchecked(next)
  }

  /** 开始就地编辑某条 */
  const startEdit = (k: string, field: 'text' | 'date' | 'time' | 'deadline' | 'freq', init: string): void => {
    setEditing(`${k}:${field}`)
    setEditingVal(init)
  }
  /** 提交就地编辑。v9.2.1：快捷按钮/日期选择路径存在 setState 异步时序（旧值覆盖新值），
   *  改为显式传入最新值（v ?? editingVal），杜绝「日期改不进去」。 */
  const commitEdit = (v?: string): void => {
    if (!result || !editing) return
    const [g, iStr, field] = editing.split(':')
    const i = Number(iStr)
    const val = v ?? editingVal
    if (field === 'text') {
      const t = val.trim()
      if (t) {
        const next = { ...result }
        if (g === 'todo' && next.todos[i]) next.todos[i] = { ...next.todos[i], text: t }
        if (g === 'habit' && next.habits[i]) next.habits[i] = { ...next.habits[i], name: t }
        if (g === 'note' && next.notes[i]) next.notes[i] = { ...next.notes[i], text: t }
        if (g === 'goal' && next.goals[i]) next.goals[i] = { ...next.goals[i], title: t }
        setResult(next)
      }
    } else if (field === 'date' && g === 'todo') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        const next = { ...result }
        if (next.todos[i]) next.todos[i] = { ...next.todos[i], date: val }
        setResult(next)
      }
    } else if (field === 'deadline' && g === 'todo') {
      // v9.8：截止日期可改/可清。空串 = 清除截止；否则必须是 YYYY-MM-DD
      const t = val.trim()
      const next = { ...result }
      if (next.todos[i]) {
        if (t === '') {
          const { deadline: _omit, ...rest } = next.todos[i] as {
            text: string
            date: string
            deadline?: string | null
            time?: string | null
            timeType?: 'due' | 'at' | null
          }
          next.todos[i] = rest
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
          next.todos[i] = { ...next.todos[i], deadline: t }
        }
      }
      setResult(next)
    } else if (field === 'time' && g === 'todo') {
      // v9.9：具体时间可改/可切类型（time:HH:MM 或 type:due|at）。函数式更新防连续提交互相覆盖
      const v = val.trim()
      setResult((prev) => {
        if (!prev) return prev
        const next = { ...prev }
        if (next.todos[i]) {
          if (v.startsWith('time:')) {
            const hm = v.slice(5)
            if (/^\d{2}:\d{2}$/.test(hm)) next.todos[i] = { ...next.todos[i], time: hm }
          } else if (v === 'type:due' || v === 'type:at') {
            const tt = v.slice(5) as 'due' | 'at'
            if (next.todos[i].time) next.todos[i] = { ...next.todos[i], timeType: tt }
          }
        }
        return next
      })
    } else if ((field === 'freq' || field === 'freqWk') && g === 'habit') {
      // val 形如 'daily' 或 'weekly:1,3,5'
      const t = val.trim()
      const next = { ...result }
      if (t.startsWith('daily') && next.habits[i]) {
        next.habits[i] = { ...next.habits[i], freq: { kind: 'daily' } }
        setResult(next)
      } else if (t.startsWith('weekly') && next.habits[i]) {
        const ds = t
          .split(':')[1]
          .split(',')
          .map(Number)
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        if (ds.length > 0) {
          next.habits[i] = { ...next.habits[i], freq: { kind: 'weekly', weekdays: ds } }
          setResult(next)
        }
      }
    }
    setEditing(null)
  }

  /** 统一处理整理结果（文本导入 / 语音导入共用）：配额、空结果、进预览 */
  const applyImportResult = (res: Awaited<ReturnType<typeof aiImport>>): void => {
    if (!res.ok) {
      if (res.error === 'ai_quota_exceeded') {
        setAiRemaining(0)
        // v9.7：配额文案由后端 mode 决定——非会员试用总额用完引导开通；会员每日用完明天再来
        setErr(
          res.mode === 'trial_total'
            ? 'AI 试用次数已用完，开通会员可继续使用'
            : '今日 AI 次数已用完，明天再来吧',
        )
      } else if (res.error === 'asr_not_configured') {
        setErr('语音识别暂未开通，先用文字输入吧')
      } else {
        setErr(`整理失败：${res.error === 'unauthorized' ? '登录已失效，请重新登录' : (res.error ?? '未知错误')}`)
      }
      setPhase('input')
      return
    }
    if (res.remaining != null) setAiRemaining(res.remaining)
    const s = res.structured
    if (!s || (!s.todos.length && !s.habits.length && !s.notes.length && !s.goals.length)) {
      setErr('没识别出可导入的内容，换个说法试试')
      setPhase('input')
      return
    }
    setResult(s)
    setUnchecked(new Set())
    setPhase('preview')
  }

  /** 整理（调后端） */
  const onAnalyze = async (): Promise<void> => {
    if (!text.trim() || phase === 'analyzing') return
    if (aiRemaining === 0) {
      setErr('AI 使用次数已用完')
      return
    }
    setErr(null)
    setPhase('analyzing')
    const token = await getAccessToken()
    if (!token) {
      setErr('需要先登录才能使用（主菜单 → 账号与同步）')
      setPhase('input')
      return
    }
    const res = await aiImport(token, text.trim(), today)
    applyImportResult(res)
  }

  /** 确认导入 */
  const onConfirm = async (): Promise<void> => {
    if (!result) return
    const filtered: AiImportResult = {
      todos: result.todos.filter((_, i) => !unchecked.has(`todo:${i}`)),
      habits: result.habits.filter((_, i) => !unchecked.has(`habit:${i}`)),
      notes: result.notes.filter((_, i) => !unchecked.has(`note:${i}`)),
      goals: result.goals.filter((_, i) => !unchecked.has(`goal:${i}`)),
    }
    setErr(null)
    const r = await aiImportItems(filtered)
    if (r.ok) {
      setAiOpen(false)
    } else if (r.error === 'empty') {
      setErr('请至少保留一条要导入的内容')
    } else {
      setErr(`导入失败：${r.error ?? '未知错误'}`)
    }
  }

  /** 语音输入 v9.8：边说边出字 —— 录音中每 3.5s 把新增音频转成文字实时追加进输入框；
   *  停止后文字留在框里、不自动整理，由用户检查修改后自己点「整理」。 */
  const onVoiceClick = async (): Promise<void> => {
    if (listening) {
      // 第二次点击：停止录音，最后一段增量转写补进框里（不自动整理）
      if (recTimer.current) window.clearInterval(recTimer.current)
      if (listenTimer.current) window.clearInterval(listenTimer.current)
      const rec = recordRef.current
      setListening(false)
      setViaVoice(false)
      if (!rec) return
      const token = await getAccessToken()
      if (!token) {
        setErr('需要先登录才能使用（主菜单 → 账号与同步）')
        rec.cancel()
        return
      }
      // 最后一段增量（若实时定时器还没取走）
      try {
        const tail = await rec.takeLatestAudio()
        if (tail) {
          const r = await aiImport(token, '', today, { data: tail, format: 'wav' }, { transcribeOnly: true })
          const rt = r.ok ? r.text?.trim() ?? '' : ''
          if (rt) {
            setText((prev) => {
              const p = prev.trim()
              return p ? `${p} ${rt}` : rt
            })
          }
        }
      } catch {
        /* 实时片段已尽力，最后一段失败不阻塞停止 */
      }
      // 释放麦克风（转写已完成，结果已入框，不再自动走分类）
      void rec.stop().catch(() => undefined)
      return
    }
    // 第一次点击：开始录音 + 实时听写
    setErr(null)
    try {
      const rec = startVoiceRecord(30)
      recordRef.current = rec
      setViaVoice(true)
      setRecSec(0)
      setListening(true)
      // 录音时长实时反馈
      const started = Date.now()
      recTimer.current = window.setInterval(() => {
        setRecSec(Math.min(30, Math.floor((Date.now() - started) / 1000)))
      }, 1000)
      // 实时听写：每 3.5s 取新增音频 → 仅转写 → 追加进输入框（边说边出字）
      let busy = false
      listenTimer.current = window.setInterval(() => {
        if (busy || !recordRef.current) return
        busy = true
        void (async () => {
          try {
            const token = await getAccessToken()
            if (!token) return
            const seg = await rec.takeLatestAudio()
            if (seg) {
              const r = await aiImport(token, '', today, { data: seg, format: 'wav' }, { transcribeOnly: true })
              const rt = r.ok ? r.text?.trim() ?? '' : ''
              if (rt) {
                setText((prev) => {
                  const p = prev.trim()
                  return p ? `${p} ${rt}` : rt
                })
              }
            }
          } catch {
            /* 单段失败静默，下个周期重试 */
          } finally {
            busy = false
          }
        })()
      }, 3500)
    } catch {
      setErr('无法访问麦克风，请检查浏览器权限')
    }
  }

  const close = (): void => {
    if (recTimer.current) window.clearInterval(recTimer.current)
    if (listenTimer.current) window.clearInterval(listenTimer.current)
    recordRef.current?.cancel()
    setAiOpen(false)
  }

  return (
    <div className={styles.overlay} data-testid="ai-import-view">
      <div className={styles.page}>
        {/* 顶栏 */}
        <div className={styles.top}>
          <h2 className={styles.title}>AI 智能导入</h2>
          <button className={styles.close} onClick={close} aria-label="关闭">
            ✕
          </button>
        </div>

        {phase === 'input' && (
          <div className={styles.inputWrap}>
            {quotaLine && <div className={styles.quotaLine} data-testid="ai-quota">{quotaLine}</div>}
            <textarea
              className={styles.area}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'把今天要做的、想记的、想养成的习惯都写下来…\n\n支持「明天」「下周一」「每周三」等说法'}
              rows={6}
              data-testid="ai-text"
            />
            <div className={styles.examples}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className={styles.chip}
                  onClick={() => setText(ex)}
                >
                  {ex.length > 18 ? `${ex.slice(0, 18)}…` : ex}
                </button>
              ))}
            </div>
            {err && <div className={styles.err}>{err}</div>}
            <div className={styles.acts}>
              {canSpeech && (
                <button
                  type="button"
                  className={`${styles.voice} ${listening ? styles.voiceOn : ''}`}
                  onClick={() => void onVoiceClick()}
                  aria-label={listening ? '正在录音，点击停止' : '语音输入'}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="2.5" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0" />
                    <path d="M12 18v3.5" />
                  </svg>
                  {listening ? `录音中 ${recSec}s · 边说边出字` : '语音'}
                </button>
              )}
              <button
                type="button"
                className={styles.go}
                disabled={!text.trim() || aiRemaining === 0}
                onClick={() => void onAnalyze()}
                data-testid="ai-analyze"
              >
                整理
              </button>
            </div>
            <div className={styles.hint}>AI 会把它整理成待办、习惯、想法和目标，确认后再写入</div>
          </div>
        )}

        {phase === 'analyzing' && (
          <div className={styles.loading} data-testid="ai-loading">
            <div className={styles.spinner} aria-hidden="true" />
            <p>{viaVoice ? '正在识别语音…' : 'AI 正在整理…'}</p>
            <p className={styles.loadingSub}>识别待办 / 习惯 / 想法 / 目标</p>
          </div>
        )}

        {phase === 'preview' && result && (
          <div className={styles.previewWrap}>
            <div className={styles.summary}>
              识别出 <b>{result.todos.length}</b> 待办 · <b>{result.habits.length}</b> 习惯 ·{' '}
              <b>{result.notes.length}</b> 想法 · <b>{result.goals.length}</b> 目标
              <span className={styles.summaryHint}>取消勾选的不导入 · 点文字可改</span>
            </div>
            {err && <div className={styles.err}>{err}</div>}
            <div className={styles.groups}>
              {result.todos.length > 0 && (
                <Group label="待办">
                  {result.todos.map((t, i) => {
                    const k = keyOf('todo', i)
                    const ed = editing === `${k}:text`
                    const edDate = editing === `${k}:date`
                    return (
                      <div key={k} className={styles.item}>
                        <button
                          type="button"
                          className={`${styles.chkbox} ${unchecked.has(k) ? styles.off : ''}`}
                          aria-pressed={!unchecked.has(k)}
                          aria-label={unchecked.has(k) ? '勾选导入' : '取消导入'}
                          onClick={() => toggle(k)}
                        />
                        {ed ? (
                          <input
                            className={styles.editInput}
                            value={editingVal}
                            autoFocus
                            onChange={(e) => setEditingVal(e.target.value)}
                            onBlur={() => commitEdit()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') setEditing(null)
                            }}
                          />
                        ) : (
                          <span
                            className={`${styles.itemText} ${unchecked.has(k) ? styles.dim : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => startEdit(k, 'text', t.text)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') startEdit(k, 'text', t.text)
                            }}
                          >
                            {t.text}
                          </span>
                        )}
                        <span
                          className={styles.tag}
                          role="button"
                          tabIndex={0}
                          onClick={() => startEdit(k, 'date', t.date)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') startEdit(k, 'date', t.date)
                          }}
                        >
                          {dateLabel(t.date, today)}
                        </span>
                        {t.deadline && (
                          <span
                            className={`${styles.tag} ${styles.tagDeadline}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => startEdit(k, 'deadline', t.deadline ?? '')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') startEdit(k, 'deadline', t.deadline ?? '')
                            }}
                          >
                            截止 {dateLabel(t.deadline, today)}
                          </span>
                        )}
                        {t.time && (
                          <span
                            className={`${styles.tag} ${styles.tagTime}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => startEdit(k, 'time', t.time as string)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') startEdit(k, 'time', t.time as string)
                            }}
                          >
                            {t.timeType === 'due' ? `截止 ${t.time}` : t.time}
                          </span>
                        )}                        {edDate && (
                          <div className={styles.datePick}>
                            {['今天', '明天', '后天'].map((w, di) => {
                              const d = new Date(today + 'T00:00:00')
                              d.setDate(d.getDate() + di)
                              const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                              return (
                                <button
                                  key={w}
                                  type="button"
                                  className={styles.dateOpt}
                                  onClick={() => commitEdit(val)}
                                >
                                  {w}
                                </button>
                              )
                            })}
                            <input
                              type="date"
                              className={styles.dateInput}
                              defaultValue={t.date}
                              onBlur={(e) => {
                                if (e.target.value) commitEdit(e.target.value)
                              }}
                            />
                          </div>
                        )}
                        {editing === `${k}:deadline` && (
                          <div className={styles.datePick}>
                            {['明天', '后天', '一周后'].map((w, di) => {
                              const d = new Date(today + 'T00:00:00')
                              d.setDate(d.getDate() + [1, 2, 7][di])
                              const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                              return (
                                <button
                                  key={w}
                                  type="button"
                                  className={styles.dateOpt}
                                  onClick={() => commitEdit(val)}
                                >
                                  {w}
                                </button>
                              )
                            })}
                            <input
                              type="date"
                              className={styles.dateInput}
                              defaultValue={t.deadline ?? undefined}
                              onBlur={(e) => {
                                if (e.target.value) commitEdit(e.target.value)
                              }}
                            />
                            <button
                              type="button"
                              className={styles.dateOpt}
                              onClick={() => commitEdit('')}
                            >
                              清除
                            </button>
                          </div>
                        )}
                        {editing === `${k}:time` && (
                          <div className={styles.datePick}>
                            <input
                              type="time"
                              className={styles.dateInput}
                              defaultValue={t.time ?? ''}
                              onBlur={(e) => {
                                if (e.target.value) commitEdit(`time:${e.target.value}`)
                              }}
                            />
                            <button
                              type="button"
                              className={`${styles.dateOpt} ${t.timeType === 'due' ? styles.on : ''}`}
                              onClick={() => commitEdit('type:due')}
                            >
                              截止时刻
                            </button>
                            <button
                              type="button"
                              className={`${styles.dateOpt} ${t.timeType === 'at' ? styles.on : ''}`}
                              onClick={() => commitEdit('type:at')}
                            >
                              提醒时刻
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </Group>
              )}
              {result.habits.length > 0 && (
                <Group label="习惯">
                  {result.habits.map((h, i) => {
                    const k = keyOf('habit', i)
                    const ed = editing === `${k}:text`
                    const edFreq = editing === `${k}:freq`
                    const freq = h.freq
                    return (
                      <div key={k} className={styles.item}>
                        <button
                          type="button"
                          className={`${styles.chkbox} ${unchecked.has(k) ? styles.off : ''}`}
                          aria-pressed={!unchecked.has(k)}
                          onClick={() => toggle(k)}
                        />
                        {ed ? (
                          <input
                            className={styles.editInput}
                            value={editingVal}
                            autoFocus
                            onChange={(e) => setEditingVal(e.target.value)}
                            onBlur={() => commitEdit()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') setEditing(null)
                            }}
                          />
                        ) : (
                          <span
                            className={`${styles.itemText} ${unchecked.has(k) ? styles.dim : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => startEdit(k, 'text', h.name)}
                          >
                            {h.name}
                          </span>
                        )}
                        <span
                          className={styles.tag}
                          role="button"
                          tabIndex={0}
                          onClick={() => startEdit(k, 'freq', freq.kind === 'daily' ? 'daily' : `weekly:${freq.weekdays.join(',')}`)}
                        >
                          {freqLabel(freq)}
                        </span>
                        {edFreq && (
                          <div className={styles.freqPick}>
                            <button
                              type="button"
                              className={`${styles.dateOpt} ${freq.kind === 'daily' ? styles.on : ''}`}
                              onClick={() => commitEdit('daily')}
                            >
                              每天
                            </button>
                            <button
                              type="button"
                              className={`${styles.dateOpt} ${freq.kind === 'weekly' ? styles.on : ''}`}
                              onClick={() => {
                                const cur =
                                  freq.kind === 'weekly' ? freq.weekdays : [1, 3, 5]
                                setEditingVal(`weekly:${cur.join(',')}`)
                                // 进入周几选择：先切到 weekly 编辑态
                                setEditing(`${k}:freqWk`)
                                setEditingVal(`weekly:${cur.join(',')}`)
                              }}
                            >
                              每周
                            </button>
                            {editing === `${k}:freqWk` && (
                              <div className={styles.weekPick}>
                                {DOW.map((d, di) => {
                                  const ds = editingVal
                                    .split(':')[1]
                                    .split(',')
                                    .map(Number)
                                  const on = ds.includes(di)
                                  return (
                                    <button
                                      key={d}
                                      type="button"
                                      className={`${styles.weekOpt} ${on ? styles.on : ''}`}
                                      onClick={() => {
                                        const on = ds.includes(di)
                                        const next = on
                                          ? ds.filter((x) => x !== di)
                                          : [...ds, di].sort((a, b) => a - b)
                                        // 全取消 → 回到每天；否则按周几保存
                                        commitEdit(next.length > 0 ? `weekly:${next.join(',')}` : 'daily')
                                      }}
                                    >
                                      {d}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </Group>
              )}
              {result.notes.length > 0 && (
                <Group label="想法">
                  {result.notes.map((n, i) => {
                    const k = keyOf('note', i)
                    const ed = editing === `${k}:text`
                    return (
                      <div key={k} className={styles.item}>
                        <button
                          type="button"
                          className={`${styles.chkbox} ${unchecked.has(k) ? styles.off : ''}`}
                          aria-pressed={!unchecked.has(k)}
                          onClick={() => toggle(k)}
                        />
                        {ed ? (
                          <input
                            className={styles.editInput}
                            value={editingVal}
                            autoFocus
                            onChange={(e) => setEditingVal(e.target.value)}
                            onBlur={() => commitEdit()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') setEditing(null)
                            }}
                          />
                        ) : (
                          <span
                            className={`${styles.itemText} ${unchecked.has(k) ? styles.dim : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => startEdit(k, 'text', n.text)}
                          >
                            {n.text}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </Group>
              )}
              {result.goals.length > 0 && (
                <Group label="目标">
                  {result.goals.map((g, i) => {
                    const k = keyOf('goal', i)
                    const ed = editing === `${k}:text`
                    return (
                      <div key={k} className={styles.item}>
                        <button
                          type="button"
                          className={`${styles.chkbox} ${unchecked.has(k) ? styles.off : ''}`}
                          aria-pressed={!unchecked.has(k)}
                          onClick={() => toggle(k)}
                        />
                        {ed ? (
                          <input
                            className={styles.editInput}
                            value={editingVal}
                            autoFocus
                            onChange={(e) => setEditingVal(e.target.value)}
                            onBlur={() => commitEdit()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') setEditing(null)
                            }}
                          />
                        ) : (
                          <span
                            className={`${styles.itemText} ${unchecked.has(k) ? styles.dim : ''}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => startEdit(k, 'text', g.title)}
                          >
                            {g.title}
                          </span>
                        )}
                        {g.note && (
                          <span className={styles.goalNote}>{g.note}</span>
                        )}
                      </div>
                    )
                  })}
                </Group>
              )}
            </div>
            <div className={styles.previewActs}>
              <button
                type="button"
                className={styles.redo}
                onClick={() => {
                  setPhase('input')
                  setResult(null)
                  setErr(null)
                }}
              >
                重新整理
              </button>
              <button
                type="button"
                className={styles.go}
                disabled={checkedCount === 0}
                onClick={() => void onConfirm()}
                data-testid="ai-confirm"
              >
                确认导入 {checkedCount} 条
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 预览分组标题 */
function Group({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className={styles.group}>
      <div className={styles.groupLabel}>{label}</div>
      {children}
    </div>
  )
}
