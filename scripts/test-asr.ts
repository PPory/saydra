// Offline checks for long-audio chunking and the refine fallback chain.
// Usage: npm run test:asr
import { joinPieces, splitAtPauses } from '../src/main/asr/chunk'
import { ApiError, chatWithFallback, setFetch, type ChatTarget } from '../src/main/llm'

let failed = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${detail}`}`)
}

// --- chunking -------------------------------------------------------------
const RATE = 16_000
// 70 s of "speech" (noise) with a silent gap at 27–27.3 s and 55–55.3 s.
const audio = new Float32Array(70 * RATE).map(() => (Math.random() - 0.5) * 0.4)
for (const gap of [27, 55]) audio.fill(0, gap * RATE, (gap + 0.3) * RATE)
const pieces = splitAtPauses(audio, RATE)
const lengths = pieces.map((p) => p.length / RATE)
check('short audio stays whole', splitAtPauses(audio.subarray(0, 10 * RATE), RATE).length === 1)
check('long audio is split', pieces.length === 3, `got ${pieces.length}`)
check('no piece over 30 s', lengths.every((s) => s <= 30), lengths.join(', '))
check('nothing lost', pieces.reduce((a, p) => a + p.length, 0) === audio.length)
check(
  'cuts land in the silent gaps',
  Math.abs(lengths[0] - 27.15) < 0.2 && Math.abs(lengths[0] + lengths[1] - 55.15) < 0.2,
  lengths.join(', ')
)

check('chinese pieces join directly', joinPieces(['今天天气', '不错']) === '今天天气不错')
check('english words keep a space', joinPieces(['I use Claude', 'Code daily']) === 'I use Claude Code daily')
check('empty pieces skipped', joinPieces(['你好', '  ', '世界']) === '你好世界')

// --- refine fallback ------------------------------------------------------
const ep = (name: string) => ({ name, baseUrl: `https://${name}.test/v1`, apiKey: 'k' })
const targets: ChatTarget[] = [
  { endpoint: ep('primary'), model: 'm1' },
  { endpoint: ep('backup'), model: 'm2' }
]
const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 })

function fakeFetch(handler: (host: string) => Response | Promise<Response>): void {
  setFetch((async (url: string) => handler(new URL(url).hostname.split('.')[0])) as typeof fetch)
}

fakeFetch(() => reply('<转写>整理好的文字。</转写>'))
let res = await chatWithFallback(targets, 'sys', '原文')
check('primary answers', res.target.model === 'm1' && res.text === '整理好的文字。', JSON.stringify(res))

fakeFetch((host) => (host === 'primary' ? new Response('boom', { status: 502 }) : reply('备用结果')))
res = await chatWithFallback(targets, 'sys', '原文')
check('5xx falls back', res.target.model === 'm2' && res.errors.length === 1, JSON.stringify(res))

fakeFetch((host) => (host === 'primary' ? new Response('nope', { status: 401 }) : reply('备用结果')))
res = await chatWithFallback(targets, 'sys', '原文')
check('bad key falls back', res.target.model === 'm2' && res.errors[0].kind === 'auth')

let primaryCalls = 0
fakeFetch((host) => {
  if (host === 'primary') {
    primaryCalls++
    return new Response('slow down', { status: 429, headers: { 'retry-after': '5' } })
  }
  return reply('备用结果')
})
const t = performance.now()
res = await chatWithFallback(targets, 'sys', '原文')
check(
  'rate limit falls back without waiting',
  res.target.model === 'm2' && primaryCalls === 1 && performance.now() - t < 500,
  `calls ${primaryCalls}, ${Math.round(performance.now() - t)}ms`
)

fakeFetch(() => new Response('down', { status: 503 }))
try {
  await chatWithFallback(targets, 'sys', '原文')
  check('all down throws', false)
} catch (err) {
  check('all down throws', err instanceof ApiError && err.provider === 'backup')
}

fakeFetch(() => {
  throw new TypeError('fetch failed')
})
try {
  await chatWithFallback(targets.slice(0, 1), 'sys', '原文')
  check('network error classified', false)
} catch (err) {
  check('network error classified', err instanceof ApiError && err.kind === 'network')
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
