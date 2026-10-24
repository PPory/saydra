// 流式输出: each sentence that settles while the user talks gets one light pass
// (punctuation, fillers out) from a small model on the user's own services, in
// order, one request at a time. The full refine still runs on the whole text at
// the end; this only makes the caption read like text.
import { acceptTidy } from '../shared/live-text'
import { groqEndpoint } from './groq'
import { ApiError, chatWithFallback, type ChatTarget } from './llm'
import { LIVE_TIDY_PROMPT } from './prompts'
import { customEndpoint } from './providers'
import { getApiKey, getCustomModel } from './settings'
import { isFillerOnly } from './text-tidy'

// Groq's free limits are per model: this one does not eat into the refine model's.
const GROQ_TIDY_MODEL = 'openai/gpt-oss-20b'
const TIMEOUT_MS = 6000

// Groq first (free), then the user's own service (may cost a little).
function targets(): ChatTarget[] {
  const out: ChatTarget[] = []
  const key = getApiKey()
  if (key) out.push({ endpoint: groqEndpoint(key), model: GROQ_TIDY_MODEL })
  const ep = customEndpoint()
  const model = getCustomModel()
  if (ep && model) out.push({ endpoint: ep, model })
  return out
}

export interface LiveTidy {
  // All sentences settled so far (oldest first, never changing once given).
  update(sentences: string[]): void
  readonly polished: Array<string | undefined> // by sentence; undefined until tidied or if rejected
  stop(): void // nothing new is sent; a request in flight still lands
  stats(): { ok: number; total: number }
}

export function createLiveTidy(onPolished: () => void): LiveTidy {
  const to = targets()
  const polished: Array<string | undefined> = []
  let queue: string[] = []
  let sent = 0
  let ok = 0
  let busy = false
  let stopped = false

  async function drain(): Promise<void> {
    if (busy) return
    busy = true
    while (!stopped && sent < queue.length) {
      const i = sent++
      // A sentence that is only 「嗯」: drop it here, no request.
      if (isFillerOnly(queue[i], 'other')) {
        polished[i] = ''
        ok++
        onPolished()
        continue
      }
      try {
        const { text } = await chatWithFallback(to, LIVE_TIDY_PROMPT, queue[i], {
          temperature: 0,
          maxTokens: 300,
          timeoutMs: TIMEOUT_MS
        })
        if (process.env.REA_SELFTEST_WAV) console.log(`  tidy #${i} ${acceptTidy(queue[i], text) ? 'ok' : 'rejected'}: ${queue[i]} → ${text}`)
        if (acceptTidy(queue[i], text)) {
          polished[i] = text
          ok++
          onPolished()
        }
      } catch (err) {
        // The caption keeps the sentence as heard; never the user's words in the log.
        console.warn('live tidy failed', err instanceof ApiError ? `${err.provider}:${err.kind}` : err)
      }
    }
    busy = false
  }

  return {
    update(sentences) {
      if (stopped || !to.length || sentences.length <= queue.length) return
      queue = sentences.slice() // the caller keeps appending to its own array
      void drain()
    },
    polished,
    stop() {
      stopped = true
    },
    stats: () => ({ ok, total: queue.length })
  }
}
