// Dictionary auto-learn: after a paste, read the same input box again a little
// later; if the user corrected how a word is written, add it to the dictionary
// as 「自动添加」. Apps whose input boxes UI Automation cannot read (WeChat,
// for one) are skipped silently.
import { findEdits, groundTerms, heardForms } from './learn'
import { chatWithFallback } from './llm'
import { LEARN_PROMPT, learnUserMessage, parseLearnReply } from './prompts'
import { refineTargets } from './providers'
import { getDb } from './store'
import { watchedInfo, watchFocus } from './platform/helper'

const BASELINE_AFTER_MS = 150 // the box has taken the paste by now (pasteText already waited 300 ms)
const CHECK_AFTER_MS = [8_000, 30_000]

interface Session {
  pasted: string
  baseline: string | null
  timers: ReturnType<typeof setTimeout>[]
  seen: Set<string> // corrections already judged
  checking: boolean
}

let session: Session | null = null
type OnLearned = (words: string[]) => void

// Corrections between two readings of the box -> new dictionary words. What
// each fix replaced is kept as the word's 常被识别成, so it is right next time.
export async function learnFrom(pasted: string, baseline: string, current: string, seen = new Set<string>()): Promise<string[]> {
  const edits = findEdits(pasted, baseline, current).filter((e) => !seen.has(`${e.removed}→${e.added}`))
  if (!edits.length) return []
  for (const e of edits) seen.add(`${e.removed}→${e.added}`)
  const targets = refineTargets(200)
  if (!targets.length) return []
  const res = await chatWithFallback(targets, LEARN_PROMPT, learnUserMessage(edits), { wrapTag: '', maxTokens: 200, timeoutMs: 15_000 })
  const db = getDb()
  const named = parseLearnReply(res.text)
  const words = groundTerms(named, edits, db.terms()).filter((w) => db.addWord(w, 'auto') === 'added')
  // Only fixes the model judged to be spelling, new words or ones already in the
  // dictionary: 「GPT」 changed to 「Claude」 is rewording, not a mishearing.
  const isNamed = (t: string) => named.some((w) => typeof w === 'string' && w.trim().toLowerCase() === t.toLowerCase())
  for (const { term, form } of heardForms(edits, db.terms().filter(isNamed))) db.addHeardAs(term, form)
  return words
}

async function check(s: Session, onLearned: OnLearned): Promise<void> {
  if (s.checking || s.baseline === null) return
  s.checking = true
  try {
    const now = await watchedInfo()
    if (!now?.text) return
    const words = await learnFrom(s.pasted, s.baseline, now.text, s.seen)
    if (words.length) onLearned(words)
  } catch (err) {
    console.warn('auto-learn failed', err)
  } finally {
    s.checking = false
  }
}

// Start watching the box we just pasted into.
export function trackPaste(pasted: string, onLearned: OnLearned): void {
  stop()
  const s: Session = { pasted, baseline: null, timers: [], seen: new Set(), checking: false }
  session = s
  s.timers.push(
    setTimeout(async () => {
      const info = await watchFocus()
      if (session !== s || !info?.text?.includes(pasted.trim())) return void (session === s && stop())
      s.baseline = info.text
      for (const ms of CHECK_AFTER_MS) s.timers.push(setTimeout(() => void check(s, onLearned), ms))
    }, BASELINE_AFTER_MS)
  )
}

// A new dictation is starting: one last look at the previous box, then let it go.
export function finishTracking(onLearned: OnLearned): void {
  const s = session
  if (!s) return
  stop()
  void check(s, onLearned)
}

function stop(): void {
  session?.timers.forEach(clearTimeout)
  session = null
}
