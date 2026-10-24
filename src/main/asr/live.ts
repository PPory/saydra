// Text on screen while the user is still talking. SenseVoice is not a streaming
// model but is fast (10 s of speech in ~0.25 s), so we re-read the sentence being
// spoken GAP_MS after each read finishes and settle it at the next pause; each read
// covers a few seconds at most, and a slow machine simply reads less often.
// Preview only: the pasted result still comes from one pass over the whole
// recording. No Electron imports.
import { quietestCut } from './chunk'

export const LIVE_RATE = 16_000

export const GAP_MS = 300
const MIN_NEW_MS = 250 // less new audio than this since the last read: wait
const PAUSE_MS = 400 // this much quiet at the end of a sentence settles it
const MIN_SENTENCE_MS = 3_000 // shorter ones keep growing, so a breath doesn't split a phrase
const MAX_SENTENCE_MS = 10_000 // no pause by then: cut at the quietest spot of the last few seconds
const SEARCH_MS = 4_000
const QUIET_RMS = 0.01 // the recorder counts frames above 0.012 as voice
const FRAME_MS = 100

const ms = (n: number): number => Math.round((n * LIVE_RATE) / 1000)

// The middle of the last pause of PAUSE_MS or more that begins after `from`.
// Reads are a few hundred ms apart, so a short pause is usually over by the time we look:
// search the whole stretch, not just its end.
function lastPause(samples: Float32Array, from: number, end: number): number | null {
  const frame = ms(FRAME_MS)
  const need = PAUSE_MS / FRAME_MS
  let found: number | null = null
  let runStart = -1
  for (let s = from; s + frame <= end; s += frame) {
    let energy = 0
    for (let i = s; i < s + frame; i++) energy += samples[i] * samples[i]
    const isQuiet = Math.sqrt(energy / frame) <= QUIET_RMS
    if (isQuiet && runStart < 0) runStart = s
    if (!isQuiet) runStart = -1
    else if ((s + frame - runStart) / frame >= need) found = runStart + ms(PAUSE_MS / 2)
  }
  return found
}

// Where the sentence that started at `start` ends, if it is done by `end`.
export function sentenceEnd(samples: Float32Array, start: number, end: number): number | null {
  if (end - start < ms(MIN_SENTENCE_MS)) return null
  const pause = lastPause(samples, start + ms(MIN_SENTENCE_MS) - ms(PAUSE_MS), end)
  if (pause !== null) return pause
  if (end - start >= ms(MAX_SENTENCE_MS)) return quietestCut(samples, end - ms(SEARCH_MS), end, LIVE_RATE)
  return null
}

export interface LivePreview {
  push(chunk: Float32Array): void
  // No more reads; resolves once the one in flight is done, so the final pass
  // has the model to itself.
  stop(): Promise<void>
  stats(): { runs: number; maxMs: number }
}

// `settled`: sentences that ended at a pause, oldest first (they never change once
// settled); `tail`: the one being spoken.
export function createLivePreview(
  transcribe: (samples: Float32Array) => Promise<string>,
  onText: (settled: string[], tail: string) => void
): LivePreview {
  let buf = new Float32Array(ms(30_000))
  let length = 0
  let start = 0 // where the sentence being spoken begins
  let readUpTo = 0
  const settled: string[] = []
  let current = ''
  let shown = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let inFlight: Promise<void> | null = null
  let runs = 0
  let maxMs = 0

  const show = () => {
    const key = settled.length + '\n' + current
    if (key === shown) return
    shown = key
    onText([...settled], current)
  }

  async function timed(from: number, to: number): Promise<string> {
    const t = performance.now()
    const text = await transcribe(buf.slice(from, to))
    runs++
    maxMs = Math.max(maxMs, performance.now() - t)
    return text
  }

  async function read(): Promise<void> {
    const end = length
    if (end - readUpTo < ms(MIN_NEW_MS)) return
    readUpTo = end
    const cut = sentenceEnd(buf, start, end)
    if (cut === null) current = await timed(start, end)
    else {
      settled.push(await timed(start, cut))
      start = cut
      // The words after the cut were on screen already: read them now, so they
      // don't vanish until the next read.
      current = end - cut >= ms(MIN_NEW_MS) ? await timed(cut, end) : ''
    }
    show()
  }

  const next = () => {
    timer = setTimeout(() => {
      inFlight = read()
        .catch((err) => console.warn('live preview failed', err))
        .finally(() => {
          inFlight = null
          if (!stopped) next()
        })
    }, GAP_MS)
  }
  next()

  return {
    push(chunk) {
      if (stopped) return
      // Settled sentences are not read again: drop them before growing. Not while a
      // read is in flight, it holds offsets into the buffer.
      if (length + chunk.length > buf.length && start > 0 && !inFlight) {
        buf.copyWithin(0, start, length)
        length -= start
        readUpTo -= start
        start = 0
      }
      if (length + chunk.length > buf.length) {
        const bigger = new Float32Array(Math.max(buf.length * 2, length + chunk.length))
        bigger.set(buf.subarray(0, length))
        buf = bigger
      }
      buf.set(chunk, length)
      length += chunk.length
    },
    async stop() {
      stopped = true
      clearTimeout(timer)
      await inFlight
    },
    stats: () => ({ runs, maxMs: Math.round(maxMs) })
  }
}
