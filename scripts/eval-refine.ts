// Regression cases for the refine prompt, taken from real dictation failures.
// Usage: npm run eval:refine -- [model]
import { DEFAULT_REFINE_MODEL, refine } from '../src/main/groq'
import { buildRefineSystemPrompt } from '../src/main/prompts'
import { CASES, checkCase } from './refine-cases'


const model = process.argv[2] ?? DEFAULT_REFINE_MODEL
const apiKey = process.env.GROQ_API_KEY
if (!apiKey) {
  console.error('Set GROQ_API_KEY first')
  process.exit(1)
}

// Free tier allows 8000 tokens/min per model and each call is ~700 tokens.
const PACE_MS = 6000
let passed = 0
for (const [i, c] of CASES.entries()) {
  if (i) await new Promise((r) => setTimeout(r, PACE_MS))
  const ctx = { appName: 'eval.exe', title: 'eval', scene: c.scene ?? 'other' }
  const out = await refine(apiKey, model, buildRefineSystemPrompt(ctx, ''), c.raw)
  const { ok, missing, forbidden } = checkCase(c, out)
  if (ok) passed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.raw}\n   → ${out.replace(/\n/g, ' ⏎ ')}`)
  if (!ok) console.log(`   missing: ${missing.join(', ') || '-'}  forbidden: ${forbidden.join(', ') || '-'}`)
}
console.log(`\n${model}: ${passed}/${CASES.length} passed`)
