/**
 * v9.2 语音输入抽象层。
 *
 * 设计：UI 层只依赖 speechSupported() / transcribeSpeech()，不问语音来自哪个引擎。
 *   - MVP：浏览器原生 Web Speech API（免费，Chrome/Edge 桌面 + 部分安卓可用）
 *   - 将来：腾讯云 ASR（云函数加 /ai/asr 路由 + 前端录音上传）——届时只替换本文件
 *     的 transcribeSpeech 实现，导入页一行不用改。
 *
 * 能力检测：不支持的环境 speechSupported() 返回 false，UI 隐藏语音按钮。
 */
export function speechSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as {
    SpeechRecognition?: unknown
    webkitSpeechRecognition?: unknown
  }
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition)
}

export interface SpeechOptions {
  /** 识别语言，默认 zh-CN */
  lang?: string
  /** 中间结果回调（可做"正在听"提示） */
  onInterim?: (text: string) => void
}

/**
 * 说话 → 文本（浏览器原生实现）。
 * 返回最终识别文本；失败抛 Error（error/abort/no-speech 等）。
 */
export function transcribeSpeech(opts: SpeechOptions = {}): Promise<string> {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  if (!Ctor) {
    return Promise.reject(new Error('unsupported'))
  }
  const rec = new Ctor()
  rec.lang = opts.lang ?? 'zh-CN'
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1

  return new Promise<string>((resolve, reject) => {
    let finalText = ''
    const onResult = (e: SpeechRecognitionEventLike): void => {
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interim += r[0].transcript
      }
      opts.onInterim?.(interim)
    }
    const onEnd = (): void => {
      cleanup()
      const t = finalText.trim()
      if (t) resolve(t)
      else reject(new Error('no-speech'))
    }
    const onError = (e: { error?: string; message?: string }): void => {
      cleanup()
      reject(new Error(e?.error ?? 'speech-error'))
    }
    const cleanup = (): void => {
      rec.onresult = null
      rec.onend = null
      rec.onerror = null
    }
    rec.onresult = onResult
    rec.onend = onEnd
    rec.onerror = onError
    rec.start()
  })
}

/* eslint-disable @typescript-eslint/naming-convention */
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string; message?: string }) => void) | null
  start(): void
  stop(): void
}

interface SpeechRecognitionEventLike {
  results: Array<{
    isFinal: boolean
    [index: number]: { transcript: string }
  }>
}
/* eslint-enable @typescript-eslint/naming-convention */
