// The live preview as shown above the pill: settled sentences in white, the one
// being spoken (it may still change) in grey. Pure, shared by main and the bar.

export interface LiveText {
  settled: string
  tail: string
}

// The card shows five lines (~120 characters).
const KEEP_CHARS = 200
const ENDING = /[。？！.?!]+$/ // the user is still talking: nothing has ended yet
const MARKS = /[\s，。、；：？！,.;:?!“”"'‘’（）()…—-]/g

// Settled sentences, each as the light tidy returned it (`polished[i]`) or as heard
// until then, joined by a comma where the speaker paused; then the tail as heard.
export function displayText(sentences: string[], polished: Array<string | undefined>, tail: string): LiveText {
  const parts: string[] = []
  let chars = 0
  for (let i = sentences.length - 1; i >= 0 && chars < KEEP_CHARS; i--) {
    // A pause is often mid-sentence: the tidy can't see what follows, so its full
    // stop becomes our comma. A question mark it can tell from the words alone.
    const part = (polished[i] ?? sentences[i]).trim().replace(/[。.]$/, '')
    if (!part) continue
    parts.unshift(part)
    chars += part.length
  }
  const settled = parts.reduce((acc, p) => (acc ? acc + separator(acc, p) + p : p), '')
  return finish(settled, tail.trim())
}

function separator(before: string, after: string): string {
  if (/[，。、；：？！,.;:?!]$/.test(before)) return /^[A-Za-z0-9]/.test(after) && /[,.;:?!]$/.test(before) ? ' ' : ''
  return /[A-Za-z0-9]$/.test(before) && /^[A-Za-z0-9]/.test(after) ? ', ' : '，'
}

function finish(settled: string, tail: string): LiveText {
  tail = tail.replace(/^[，。、；：？！,.;:?!\s]+/, '')
  if (tail) tail = tail.replace(ENDING, '')
  else settled = settled.replace(ENDING, '')
  return { settled, tail }
}

// The light tidy may only add punctuation and drop words (fillers, stutters): what
// it returns, marks aside, must be the sentence with some characters left out, and
// not too many. Anything else (a changed word, an answer) is thrown away.
export function acceptTidy(heard: string, tidied: string): boolean {
  const a = heard.replace(MARKS, '').toLowerCase()
  const b = tidied.replace(MARKS, '').toLowerCase()
  if (!b) return a.length <= 4 // only fillers
  if (b.length < a.length * 0.7) return false
  let i = 0
  for (const ch of b) {
    i = a.indexOf(ch, i)
    if (i < 0) return false
    i++
  }
  return true
}

// How the shown text moves to a new target: whatever changed within what is already
// on screen is replaced at once; only text beyond it is typed out (`pending`).
export function revealStep(shown: string, target: string): { now: string; pending: string } {
  let p = 0
  while (p < shown.length && p < target.length && shown[p] === target[p]) p++
  const keep = Math.min(target.length, Math.max(p, shown.length))
  return { now: target.slice(0, keep), pending: target.slice(keep) }
}

// One string for the card, and where its settled part ends.
// The tail starts after a pause too, so it gets the same comma.
export function joinLive(t: LiveText): { full: string; split: number } {
  const sep = t.settled && t.tail ? separator(t.settled, t.tail) : ''
  return { full: t.settled + sep + t.tail, split: t.settled.length + sep.length }
}
