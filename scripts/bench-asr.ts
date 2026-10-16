// Compare Groq Whisper and local SenseVoice on the same recordings.
// Usage: GROQ_API_KEY=xxx npm run bench:asr -- <recordings dir> [reference.txt]
// Reference file: one sentence per line; each recording is matched to its closest line.
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { DEFAULT_REFINE_MODEL, refine, transcribe } from '../src/main/groq'
import { buildRefineSystemPrompt, buildWhisperPrompt } from '../src/main/prompts'
import { loadSenseVoice } from '../src/main/asr/sensevoice'
import { cer } from './cer'

const require = createRequire(import.meta.url)
const ffmpeg: string = require('ffmpeg-static')

const [dir, refFile] = process.argv.slice(2)
const apiKey = process.env.GROQ_API_KEY
if (!dir || !apiKey) {
  console.error('Usage: GROQ_API_KEY=xxx npm run bench:asr -- <recordings dir> [reference.txt]')
  process.exit(1)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function decode16k(file: string): Float32Array {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30
  })
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${file}: ${r.stderr}`)
  const b = r.stdout as Buffer
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}

const refs = refFile
  ? (await readFile(refFile, 'utf8')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  : []
const files = (await readdir(dir)).filter((f) => /\.(webm|wav|ogg|mp3|m4a)$/i.test(f)).sort()
if (!files.length) throw new Error(`no audio files in ${dir}`)

let t = performance.now()
const sv = await loadSenseVoice(join(process.cwd(), 'data/models'))
const loadMs = performance.now() - t
console.log(`SenseVoice 模型加载 ${Math.round(loadMs)}ms，共 ${files.length} 段录音\n`)

interface Row {
  file: string
  seconds: number
  ref?: string
  whisper: string
  sense: string
  whisperMs: number
  senseMs: number
  whisperCer?: number
  senseCer?: number
  whisperRefined: string
  senseRefined: string
}
const rows: Row[] = []
const prompt = buildWhisperPrompt('')
const sysPrompt = buildRefineSystemPrompt(null, '')

for (const f of files) {
  const path = join(dir, f)
  const samples = decode16k(path)
  const seconds = samples.length / 16000

  t = performance.now()
  const sense = await sv.transcribe(samples, 16000)
  const senseMs = performance.now() - t

  const bytes = await readFile(path)
  const audio = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const mimeType = f.endsWith('.wav') ? 'audio/wav' : 'audio/webm'
  t = performance.now()
  const { text: whisper } = await transcribe(apiKey, audio, { mimeType, prompt })
  const whisperMs = performance.now() - t

  let ref: string | undefined
  if (refs.length) ref = refs.reduce((best, r) => (cer(r, whisper) + cer(r, sense) < cer(best, whisper) + cer(best, sense) ? r : best))

  // Same refine step for both, so the final pasted text can be compared too.
  const whisperRefined = whisper ? await refine(apiKey, DEFAULT_REFINE_MODEL, sysPrompt, whisper) : ''
  await sleep(4000)
  const senseRefined = sense ? await refine(apiKey, DEFAULT_REFINE_MODEL, sysPrompt, sense) : ''
  await sleep(4000)

  const row: Row = {
    file: f,
    seconds,
    ref,
    whisper,
    sense,
    whisperMs,
    senseMs,
    whisperCer: ref ? cer(ref, whisper) : undefined,
    senseCer: ref ? cer(ref, sense) : undefined,
    whisperRefined,
    senseRefined
  }
  rows.push(row)
  const pct = (x?: number) => (x === undefined ? '' : ` 错字率 ${(x * 100).toFixed(1)}%`)
  console.log(`■ ${f}（${seconds.toFixed(1)} 秒）${ref ? `\n  标准: ${ref}` : ''}`)
  console.log(`  Whisper   ${Math.round(whisperMs)}ms${pct(row.whisperCer)}\n    识别: ${whisper}\n    润色: ${whisperRefined}`)
  console.log(`  SenseVoice ${Math.round(senseMs)}ms${pct(row.senseCer)}\n    识别: ${sense}\n    润色: ${senseRefined}\n`)
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const totalSec = rows.reduce((a, r) => a + r.seconds, 0)
const summary = [
  `| | Whisper large-v3（Groq 云端） | SenseVoice（本地 CPU） |`,
  `|---|---|---|`,
  ...(refs.length
    ? [`| 平均错字率 | ${(avg(rows.map((r) => r.whisperCer!)) * 100).toFixed(1)}% | ${(avg(rows.map((r) => r.senseCer!)) * 100).toFixed(1)}% |`]
    : []),
  `| 平均识别耗时 | ${Math.round(avg(rows.map((r) => r.whisperMs)))}ms | ${Math.round(avg(rows.map((r) => r.senseMs)))}ms |`,
  `| 录音总长 | ${totalSec.toFixed(1)} 秒 | （模型加载 ${Math.round(loadMs)}ms，只在启动时一次） |`
].join('\n')
console.log(summary)

const md = [
  `# 语音识别对比：Whisper vs SenseVoice`,
  ``,
  summary,
  ``,
  ...rows.flatMap((r) => [
    `## ${r.file}（${r.seconds.toFixed(1)} 秒）`,
    r.ref ? `**标准答案**：${r.ref}` : '',
    ``,
    `| | Whisper | SenseVoice |`,
    `|---|---|---|`,
    `| 识别 | ${r.whisper} | ${r.sense} |`,
    `| 润色后 | ${r.whisperRefined.replace(/\n/g, '<br>')} | ${r.senseRefined.replace(/\n/g, '<br>')} |`,
    ...(r.ref ? [`| 错字率 | ${(r.whisperCer! * 100).toFixed(1)}% | ${(r.senseCer! * 100).toFixed(1)}% |`] : []),
    `| 耗时 | ${Math.round(r.whisperMs)}ms | ${Math.round(r.senseMs)}ms |`,
    ``
  ])
].join('\n')
await mkdir('output', { recursive: true })
const out = join('output', `asr-bench-${basename(dir)}.md`)
await writeFile(out, md, 'utf8')
console.log(`\n报告：${out}`)
