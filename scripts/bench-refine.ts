// Compare refine models on any OpenAI-compatible endpoint: pass rate on the
// regression cases plus latency over the same network path the app uses.
// Usage: REFINE_BASE_URL=https://x/v1 REFINE_API_KEY=xxx npm run bench:refine -- <model> [model...]
// Second test: real raw transcripts from an ASR bench report (output/asr-bench-*.md),
// scored by character error rate of the refined text against the reference.
import { existsSync, readFileSync } from 'node:fs'
import { buildRefineSystemPrompt } from '../src/main/prompts'
import { cer } from './cer'
import { CASES, checkCase } from './refine-cases'

const base = process.env.REFINE_BASE_URL?.replace(/\/$/, '')
const apiKey = process.env.REFINE_API_KEY
const models = process.argv.slice(2)
if (!base || !apiKey || !models.length) {
  console.error('Usage: REFINE_BASE_URL=... REFINE_API_KEY=... npm run bench:refine -- <model> [model...]')
  process.exit(1)
}
const ASR_REPORT = process.env.REFINE_ASR_REPORT ?? 'output/asr-bench-bench.md'

// Pairs of [reference, raw transcript] for both engines in the report.
function asrPairs(): [string, string][] {
  if (!existsSync(ASR_REPORT)) return []
  const pairs: [string, string][] = []
  let ref = ''
  for (const line of readFileSync(ASR_REPORT, 'utf8').split(/\r?\n/)) {
    const r = line.match(/^\*\*标准答案\*\*：(.+)$/)
    if (r) ref = r[1].trim()
    const t = line.match(/^\| 识别 \| (.*) \| (.*) \|$/)
    if (t && ref) for (const raw of [t[1], t[2]]) if (raw.trim()) pairs.push([ref, raw.trim()])
  }
  return pairs
}
const ASR = asrPairs()
const PACE_MS = Number(process.env.REFINE_PACE_MS ?? 0)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call(model: string, system: string, text: string): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: Math.ceil(text.length * 1.5) + 600,
      // Groq reasoning models: same settings as src/main/groq.ts
      ...(model.startsWith('qwen/') && { reasoning_effort: 'none' }),
      ...(model.startsWith('openai/gpt-oss') && { reasoning_effort: 'low' }),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `<转写>\n${text}\n</转写>` }
      ]
    }),
    signal: AbortSignal.timeout(60_000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const out = String(data.choices?.[0]?.message?.content ?? '')
  return out.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?转写>/g, '').trim()
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const summary: string[] = []
for (const model of models) {
  let passed = 0
  let errors = 0
  const ms: number[] = []
  const fails: string[] = []
  for (const [i, c] of CASES.entries()) {
    if (i && PACE_MS) await sleep(PACE_MS)
    const ctx = { appName: 'eval.exe', title: 'eval', scene: c.scene ?? 'other' }
    const t = performance.now()
    try {
      const out = await call(model, buildRefineSystemPrompt(ctx, ''), c.raw)
      ms.push(performance.now() - t)
      const r = checkCase(c, out)
      if (r.ok) passed++
      else fails.push(`  ✗ ${c.raw}\n    → ${out.replace(/\n/g, ' ⏎ ')}\n    缺: ${r.missing.join(', ') || '-'}  多: ${r.forbidden.join(', ') || '-'}`)
    } catch (e) {
      errors++
      fails.push(`  ! ${c.raw}\n    ${(e as Error).message}`)
      if (errors >= 3 && !ms.length) break // model unusable, skip the rest
    }
  }
  const rawCer: number[] = []
  const outCer: number[] = []
  for (const [ref, raw] of ASR) {
    if (PACE_MS) await sleep(PACE_MS)
    const t = performance.now()
    try {
      const out = await call(model, buildRefineSystemPrompt(null, ''), raw)
      ms.push(performance.now() - t)
      rawCer.push(cer(ref, raw))
      outCer.push(cer(ref, out))
      if (cer(ref, out) < cer(ref, raw)) fails.push(`  ↑ ${raw}\n    → ${out.replace(/\n/g, ' ⏎ ')}`)
      if (cer(ref, out) > cer(ref, raw)) fails.push(`  ↓ ${raw}\n    → ${out.replace(/\n/g, ' ⏎ ')}`)
    } catch (e) {
      errors++
      fails.push(`  ! ${raw}
    ${(e as Error).message}`)
    }
  }
  const pct = (xs: number[]) => (xs.length ? `${((xs.reduce((a, b) => a + b, 0) / xs.length) * 100).toFixed(1)}%` : '-')
  const line = `${model.padEnd(34)} 用例 ${passed}/${CASES.length}  实录错字率 ${pct(rawCer)}→${pct(outCer)}  中位 ${ms.length ? Math.round(median(ms)) : '-'}ms  最慢 ${ms.length ? Math.round(Math.max(...ms)) : '-'}ms${errors ? `  错误 ${errors}` : ''}`
  console.log(line)
  if (fails.length) console.log(fails.join('\n'))
  summary.push(line)
}
console.log(`\n${summary.join('\n')}`)
