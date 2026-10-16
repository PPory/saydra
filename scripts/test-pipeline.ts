// Run transcribe -> refine on an audio file without the app or a microphone.
// Usage: GROQ_API_KEY=xxx npm run test:pipeline -- <file.wav|file.webm> [scene] [model]
import { readFile } from 'node:fs/promises'
import { DEFAULT_REFINE_MODEL, refine, transcribe } from '../src/main/groq'
import { buildRefineSystemPrompt, buildWhisperPrompt, needsRefine } from '../src/main/prompts'
import type { Scene } from '../src/shared/types'

const [file, scene = 'other', model = DEFAULT_REFINE_MODEL] = process.argv.slice(2)
const apiKey = process.env.GROQ_API_KEY
if (!file || !apiKey) {
  console.error('Usage: GROQ_API_KEY=xxx npm run test:pipeline -- <audio file> [scene] [model]')
  process.exit(1)
}

const buf = await readFile(file)
const audio = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const mimeType = file.endsWith('.wav') ? 'audio/wav' : 'audio/webm'

let t = performance.now()
const { text: raw, rawText, segments } = await transcribe(apiKey, audio, { mimeType, prompt: buildWhisperPrompt('') })
const tTranscribe = performance.now() - t
for (const s of segments)
  console.log(`  seg no_speech=${s.no_speech_prob.toFixed(2)} logprob=${s.avg_logprob.toFixed(2)}  ${s.text}`)
if (rawText !== raw) console.log(`[已过滤幻觉] ${rawText}`)
console.log(`[转写 ${tTranscribe.toFixed(0)}ms]\n${raw}\n`)

if (!raw) {
  console.log('(没有可用的语音内容，不会粘贴任何文字)')
  process.exit(0)
}
if (!needsRefine(raw, true)) {
  console.log('(内容太短，跳过润色)')
  process.exit(0)
}
const ctx = { appName: 'test.exe', title: 'pipeline test', scene: scene as Scene }
t = performance.now()
const refined = await refine(apiKey, model, buildRefineSystemPrompt(ctx, ''), raw)
console.log(`[润色 ${model} ${(performance.now() - t).toFixed(0)}ms]\n${refined}`)
