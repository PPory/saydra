// Dictionary auto-learn: after a paste, keep reading the same input box while the
// user may be fixing it; when they pause, send the box off, or it goes away, judge
// what changed. A fix to how a word is written goes into the dictionary as
// 「自动添加」. Apps whose input boxes UI Automation cannot read (WeChat, for one)
// are skipped.
//
// Readings come once a second and right after each key press, so the last reading
// before the box is cleared (a chat message sent) still has the fix in it.
import { findEdits, groundTerms, heardForms, holdsPasted } from './learn'
import { chatWithFallback } from './llm'
import { LEARN_PROMPT, learnUserMessage, parseLearnReply } from './prompts'
import { refineTargets } from './providers'
import { getDb } from './store'
import { platform } from './platform'
import { watchedInfo, watchFocus, type FocusInfo } from './platform/helper'

const BASELINE_AFTER_MS = [150, 600, 1500] // some boxes show the paste a little late
const POLL_MS = 1000
const AFTER_KEY_MS = 150
const IDLE_MS = 5000 // no change for this long: judge what is there, keep watching
const FIRST_EDIT_WITHIN_MS = 60_000 // nothing touched by then: stop
const MAX_TRACK_MS = 3 * 60_000

export interface Learned {
  words: string[] // new dictionary words
  heard: Array<{ term: string; form: string }> // new 常被识别成 forms, for new or existing words
}

export interface LearnHooks {
  onLearned: (r: Learned) => void
  log: (line: string) => void // userData/learn.log, never the text itself
}

type EndReason = 'sent' | 'gone' | 'next-dictation' | 'no-edit' | 'timeout'

interface Session {
  pasted: string
  app: string
  baseline: string
  last: string // latest reading that still had text in it
  judged: string // `last` as of the latest judgement
  startedAt: number
  edited: boolean
  seen: Set<string> // corrections already judged
  busy: boolean
  again: boolean
  reading: boolean
  ended: boolean
  poll: ReturnType<typeof setInterval>
  limit: ReturnType<typeof setTimeout>
  idle?: ReturnType<typeof setTimeout>
  afterKey?: ReturnType<typeof setTimeout>
  stats: { edits: number; asked: number; noModel: number; words: number; heard: number }
}

let hooks: LearnHooks = { onLearned: () => {}, log: () => {} }
let session: Session | null = null
let starting: object | null = null // the paste whose box is being looked up

export function initAutoLearn(h: LearnHooks): void {
  hooks = h
}

// Corrections between two readings of the box -> new dictionary words. What
// each fix replaced is kept as the word's 常被识别成, so it is right next time.
export async function learnFrom(
  pasted: string,
  baseline: string,
  current: string,
  seen = new Set<string>()
): Promise<Learned & { edits: number; asked: boolean }> {
  const edits = findEdits(pasted, baseline, current).filter((e) => !seen.has(`${e.removed}→${e.added}`))
  const result = { words: [] as string[], heard: [] as Learned['heard'], edits: edits.length, asked: false }
  if (!edits.length) return result
  for (const e of edits) seen.add(`${e.removed}→${e.added}`)
  const targets = refineTargets(200)
  if (!targets.length) return result
  const res = await chatWithFallback(targets, LEARN_PROMPT, learnUserMessage(edits), { wrapTag: '', maxTokens: 200, timeoutMs: 15_000 })
  const db = getDb()
  const named = parseLearnReply(res.text)
  result.asked = true
  result.words = groundTerms(named, edits, db.terms()).filter((w) => db.addWord(w, 'auto') === 'added')
  // Only fixes the model judged to be spelling, new words or ones already in the
  // dictionary: 「GPT」 changed to 「Claude」 is rewording, not a mishearing.
  const isNamed = (t: string) => named.some((w) => typeof w === 'string' && w.trim().toLowerCase() === t.toLowerCase())
  result.heard = heardForms(edits, db.terms().filter(isNamed)).filter(({ term, form }) => db.addHeardAs(term, form))
  return result
}

// Judge the latest reading. One at a time; a call while busy runs again after.
async function judge(s: Session): Promise<void> {
  if (s.busy) return void (s.again = true)
  if (s.last === s.judged) return
  s.busy = true
  const text = s.last
  try {
    const r = await learnFrom(s.pasted, s.baseline, text, s.seen)
    s.judged = text
    s.stats.edits += r.edits
    if (r.asked) s.stats.asked++
    else if (r.edits) s.stats.noModel++
    s.stats.words += r.words.length
    s.stats.heard += r.heard.length
    if (r.words.length || r.heard.length) hooks.onLearned(r)
  } catch (err) {
    console.warn('auto-learn failed', err)
    hooks.log(`${s.app} error=${String((err as Error)?.message ?? err).slice(0, 120)}`)
  } finally {
    s.busy = false
  }
  if (s.again) {
    s.again = false
    await judge(s)
  }
}

async function read(s: Session): Promise<void> {
  if (s.ended || s.reading) return
  s.reading = true
  const now = await watchedInfo().finally(() => (s.reading = false))
  if (s.ended || !now) return // a failed read: the next one will do
  if (now.text === undefined) return end(s, 'gone')
  if (!now.text.trim()) return end(s, 'sent') // judged as it read just before
  if (now.text === s.last) return
  s.last = now.text
  s.edited = true
  clearTimeout(s.idle)
  s.idle = setTimeout(() => void judge(s), IDLE_MS)
}

function end(s: Session, reason: EndReason): void {
  if (s.ended) return
  s.ended = true
  if (session === s) session = null
  clearInterval(s.poll)
  clearTimeout(s.limit)
  clearTimeout(s.idle)
  clearTimeout(s.afterKey)
  void judge(s).finally(() => {
    const { edits, asked, noModel, words, heard } = s.stats
    const outcome =
      s.last === s.baseline ? 'unchanged'
      : words || heard ? 'learned'
      : asked ? 'not-a-word-fix' // the model saw the edits and named no word
      : noModel ? 'no-refine-service'
      : 'no-word-sized-edit' // a rewrite, added sentences, deletions only
    const secs = Math.round((Date.now() - s.startedAt) / 1000)
    hooks.log(`${s.app} end=${reason} ${outcome} edits=${edits} words=${words} heard=${heard} secs=${secs}`)
  })
}

// Start watching the box we just pasted into.
export async function trackPaste(pasted: string): Promise<void> {
  if (session) end(session, 'next-dictation')
  const token = {}
  starting = token
  const app = platform
    .frontApp()
    .then((a) => a?.appName ?? '?')
    .catch(() => '?')
  let info: FocusInfo | null = null
  for (const ms of BASELINE_AFTER_MS) {
    await new Promise((r) => setTimeout(r, ms))
    if (starting !== token) return // a newer dictation took over
    info = await watchFocus()
    if (info?.text !== undefined && holdsPasted(info.text, pasted)) break
  }
  if (starting !== token) return
  starting = null
  if (info?.text === undefined) return hooks.log(`${await app} skip=unreadable type=${info?.type ?? 'none'}`)
  if (!holdsPasted(info.text, pasted)) return hooks.log(`${await app} skip=paste-not-found type=${info.type ?? '?'} len=${info.text.length}`)

  const startedAt = Date.now()
  const s: Session = {
    pasted,
    app: await app,
    baseline: info.text,
    last: info.text,
    judged: info.text,
    startedAt,
    edited: false,
    seen: new Set(),
    busy: false,
    again: false,
    reading: false,
    ended: false,
    poll: setInterval(() => {
      void read(s)
      if (!s.edited && Date.now() - startedAt > FIRST_EDIT_WITHIN_MS) end(s, 'no-edit')
    }, POLL_MS),
    limit: setTimeout(() => end(s, 'timeout'), MAX_TRACK_MS),
    stats: { edits: 0, asked: 0, noModel: 0, words: 0, heard: 0 }
  }
  session = s
}

// A key went down: if a box is watched, read it again shortly, so the reading just
// before Enter clears a chat box is already in hand.
export function noteKey(): void {
  const s = session
  if (!s) return
  clearTimeout(s.afterKey)
  s.afterKey = setTimeout(() => void read(s), AFTER_KEY_MS)
}

// A new dictation is starting: one last look at the previous box, then let it go.
export async function finishTracking(): Promise<void> {
  starting = null
  const s = session
  if (!s) return
  await read(s)
  end(s, 'next-dictation')
}
