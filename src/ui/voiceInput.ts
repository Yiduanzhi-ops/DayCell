/**
 * v9.7 语音输入：腾讯云 ASR（云端转文本）。
 *
 * 前端职责：录音 → 16kHz 单声道 16bit PCM WAV → base64 → 交给云端
 * （/ai/import audio 分支，云端 ASR + AI 分类一次完成）。
 * 不再依赖浏览器内置 SpeechRecognition（准确率低、各端不一致）。
 */
export function speechSupported(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as { mediaDevices?: { getUserMedia?: unknown } }
  return Boolean(nav.mediaDevices && nav.mediaDevices.getUserMedia)
}

export interface VoiceAudio {
  /** WAV base64（16kHz 单声道 16bit） */
  data: string
  format: 'wav'
}

/** 语音 base64 上限：约 2.5MB（30s ≈ 1.3MB；6MB 网关通道下兜底保护） */
export const AUDIO_B64_MAX = 2_500_000

export interface VoiceRecordHandle {
  /** 停止录音并返回 WAV base64 */
  stop(): Promise<VoiceAudio>
  /** 取消（释放麦克风，stop 的 Promise 会 reject） */
  cancel(): void
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: Error) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolveFn!: (v: T) => void
  let rejectFn!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res
    rejectFn = rej
  })
  return { promise, resolve: resolveFn, reject: rejectFn }
}

/** 开始录音。maxSec 到点自动停止并 resolve。 */
export function startVoiceRecord(maxSec = 30): VoiceRecordHandle {
  const deferred = createDeferred<VoiceAudio>()
  let stream: MediaStream | null = null
  let ctx: AudioContext | null = null
  let proc: ScriptProcessorNode | null = null
  let chunks: Float32Array[] = []
  let stopped = false
  let settled = false
  let autoTimer: number | undefined

  const cleanup = (): void => {
    if (autoTimer !== undefined) window.clearTimeout(autoTimer)
    try {
      proc?.disconnect()
    } catch {
      /* noop */
    }
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => undefined)
    }
    stream?.getTracks().forEach((t) => t.stop())
  }

  const toBase64 = (buf: ArrayBuffer): Promise<string> =>
    new Promise((resolve, reject) => {
      const blob = new Blob([buf], { type: 'audio/wav' })
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : ''
        const idx = dataUrl.indexOf(',')
        resolve(idx >= 0 ? dataUrl.slice(idx + 1) : '')
      }
      reader.onerror = () => reject(new Error('encode-failed'))
      reader.readAsDataURL(blob)
    })

  const finish = (): void => {
    if (settled) return
    settled = true
    cleanup()
    try {
      let total = 0
      for (const c of chunks) total += c.length
      const merged = new Float32Array(total)
      let off = 0
      for (const c of chunks) {
        merged.set(c, off)
        off += c.length
      }
      chunks = []
      // 统一降到 16kHz（AudioContext 采样率可能不是 16k）
      const rate = ctx ? ctx.sampleRate : 16000
      const out = rate === 16000 ? merged : downsampleLinear(merged, rate, 16000)
      const wav = encodeWav16(out, 16000)
      void toBase64(wav).then(
        (data) => {
          // 413 防护：WAV base64 超过约 2.5MB（≈16kHz/16bit 58 秒）直接拒绝，
          // 双保险——正常 30 秒上限不会触发
          if (data.length > AUDIO_B64_MAX) {
            deferred.reject(new Error('audio-too-large'))
            return
          }
          if (data) deferred.resolve({ data, format: 'wav' })
          else deferred.reject(new Error('encode-failed'))
        },
        (e: Error) => deferred.reject(e),
      )
    } catch (e) {
      deferred.reject(e instanceof Error ? e : new Error('encode-failed'))
    }
  }

  const stop = (): Promise<VoiceAudio> => {
    if (stopped) {
      finish()
      return deferred.promise
    }
    stopped = true
    // 给 onaudioprocess 最后一个事件让出，再封包
    window.setTimeout(finish, 120)
    return deferred.promise
  }

  const cancel = (): void => {
    if (settled) return
    settled = true
    cleanup()
    deferred.reject(new Error('cancelled'))
  }

  void (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      type AudioCtor = new (opts?: AudioContextOptions) => AudioContext
      const Ctor: AudioCtor | undefined =
        (window as unknown as { AudioContext?: AudioCtor }).AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
      if (!Ctor) throw new Error('unsupported')
      ctx = new Ctor({ sampleRate: 16000 })
      const source = ctx.createMediaStreamSource(stream)
      proc = ctx.createScriptProcessor(4096, 1, 1)
      proc.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0)
        if (data.length > 0) chunks.push(new Float32Array(data))
      }
      source.connect(proc)
      proc.connect(ctx.destination)
      if (maxSec > 0) {
        autoTimer = window.setTimeout(() => {
          if (!stopped) void stop()
        }, maxSec * 1000)
      }
    } catch (e) {
      if (settled) return
      settled = true
      cleanup()
      deferred.reject(e instanceof Error ? e : new Error('mic-denied'))
    }
  })()

  return { stop, cancel }
}

/** 线性插值降采样 */
function downsampleLinear(buf: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate
  const outLen = Math.max(1, Math.round(buf.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, buf.length - 1)
    const frac = pos - i0
    out[i] = buf[i0] * (1 - frac) + buf[i1] * frac
  }
  return out
}

/** 编码 16bit PCM WAV */
function encodeWav16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const n = samples.length
  const dataSize = n * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const dv = new DataView(buf)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  dv.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true) // PCM
  dv.setUint16(22, 1, true) // mono
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  writeStr(36, 'data')
  dv.setUint32(40, dataSize, true)
  let off = 44
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  return buf
}
