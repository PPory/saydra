// 关于 → 诊断信息: what a user copies when Saydra feels slow. Built from perf.log
// (one line per dictation, timings and counts only), the machine and the chosen
// services; never the user's words or keys. No Electron imports, so test:diag runs it.

export type PerfValue = string | number | null | undefined

// One perf.log line (after appendLog's timestamp): the mode, then key=value pairs.
// Missing values become 「-」 and spaces are squeezed out, so the line parses back.
export function perfLine(mode: string, fields: Record<string, PerfValue>): string {
  const show = (v: PerfValue) =>
    v === null || v === undefined || v === '' ? '-' : String(typeof v === 'number' ? Math.round(v) : v).replace(/\s+/g, '_')
  return [mode, ...Object.entries(fields).map(([k, v]) => `${k}=${show(v)}`)].join(' ')
}

export interface PerfEntry {
  at: string
  mode: string
  fields: Record<string, string>
}

export function parsePerfLine(line: string): PerfEntry | null {
  const [at, mode, ...pairs] = line.trim().split(/\s+/)
  if (!/^\d{4}-\d\d-\d\dT/.test(at ?? '') || !mode || mode.includes('=')) return null
  const fields: Record<string, string> = {}
  for (const p of pairs) {
    const i = p.indexOf('=')
    if (i > 0) fields[p.slice(0, i)] = p.slice(i + 1)
  }
  return { at, mode, fields }
}

// Milliseconds of one stage; 「asr=local:640」 carries the engine in front.
export function stageMs(e: PerfEntry, key: string): number | null {
  const raw = e.fields[key]
  if (!raw) return null
  const n = Number(raw.slice(raw.lastIndexOf(':') + 1) || NaN)
  return Number.isFinite(n) ? n : null
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// What the user waits through, in order. 粘贴 is up to the keystroke only.
export const STAGES: Array<[key: string, label: string]> = [
  ['mic', '打开麦克风'],
  ['stop', '结束录音后的收尾'],
  ['asr', '语音识别'],
  ['whisper', '等 Whisper 校对英文'],
  ['refine', '润色 / 翻译 / 回答'],
  ['paste', '粘贴']
]

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`

// The verdict lines on top, so nobody has to read the raw log to see what is slow.
export function summarize(entries: PerfEntry[]): string[] {
  if (!entries.length) return ['还没有口述记录：更新到这个版本后正常用几次，再来复制。']
  const ok = entries.filter((e) => e.fields.result === 'ok')
  const lines: string[] = []
  const waits = ok.map((e) => stageMs(e, 'wait')).filter((n): n is number => n !== null)
  const waitMid = median(waits)
  lines.push(
    `最近 ${entries.length} 次（成功 ${ok.length} 次）` +
      (waitMid === null ? '' : `：松开后等待中位 ${sec(waitMid)}，最慢 ${sec(Math.max(...waits))}`)
  )
  let slowest: [label: string, ms: number] | null = null
  for (const [key, label] of STAGES) {
    const mid = median(ok.map((e) => stageMs(e, key)).filter((n): n is number => n !== null))
    if (mid !== null && (!slowest || mid > slowest[1])) slowest = [label, mid]
  }
  if (slowest) lines.push(`最慢的环节：${slowest[0]}（中位 ${sec(slowest[1])}）`)
  const lags = entries.map((e) => stageMs(e, 'lag')).filter((n): n is number => n !== null)
  const stalls = lags.filter((n) => n >= 500).length
  if (stalls) lines.push(`程序卡顿：${stalls} 次超过 0.5 秒，最长 ${sec(Math.max(...lags))}`)
  const failed = entries.filter((e) => e.fields.result?.startsWith('error')).length
  const fellBack = entries.filter((e) => e.fields.fallback && e.fields.fallback !== '-').length
  if (failed || fellBack) lines.push(`出错 ${failed} 次，首选服务失败、换用备用 ${fellBack} 次`)
  return lines
}

export interface DiagnosticsInput {
  about: string[] // version, machine, network, services
  perfLog: string // perf.log as read
  barLog: string // bar.log as read, '' when missing
}

export const RECENT_DICTATIONS = 20
const RECENT_BAR_LINES = 5

const lastLines = (text: string, n: number) => text.split(/\r?\n/).filter((l) => l.trim()).slice(-n)

export function formatDiagnostics({ about, perfLog, barLog }: DiagnosticsInput): string {
  const recent = lastLines(perfLog, RECENT_DICTATIONS)
  const entries = recent.map(parsePerfLine).filter((e): e is PerfEntry => e !== null)
  const out = ['Saydra 诊断信息', ...about, '', ...summarize(entries)]
  if (recent.length) out.push('', '每次口述（毫秒）：', ...recent)
  const bar = lastLines(barLog, RECENT_BAR_LINES)
  if (bar.length) out.push('', '浮条记录：', ...bar)
  return out.join('\n')
}
