// Dictionary auto-learn, the pure part: find what the user changed in the text
// we pasted, and check the model's suggested words against it. No Electron
// imports, so scripts/test-learn.ts can run it.

export interface Edit {
  removed: string // text we pasted that the user replaced
  added: string // what they replaced it with
  contextBefore: string // the surrounding pasted sentence, as pasted
  contextAfter: string // the same stretch as it reads now
}

interface Hunk {
  aStart: number // character offsets in the old text
  aEnd: number
  bStart: number // and in the new one
  bEnd: number
}

// Latin words and numbers stay whole; every CJK character, space run and
// punctuation mark is its own token.
const TOKEN = /[\p{L}\p{N}]+(?:['’.\-_][\p{L}\p{N}]+)*|\s+|./gsu
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

function tokenize(s: string): string[] {
  const out: string[] = []
  for (const m of s.matchAll(TOKEN)) {
    const t = m[0]
    // Split runs of CJK letters into characters: there are no spaces between words.
    if (CJK.test(t)) for (const ch of t) out.push(ch)
    else out.push(t)
  }
  return out
}

const MAX_LCS_CELLS = 250_000

// Token-level diff as character-offset hunks. Common prefix and suffix are
// trimmed first; the middle is aligned with an LCS when it is small enough.
function diff(a: string, b: string): Hunk[] {
  const ta = tokenize(a)
  const tb = tokenize(b)
  let pre = 0
  while (pre < ta.length && pre < tb.length && ta[pre] === tb[pre]) pre++
  let suf = 0
  while (suf < ta.length - pre && suf < tb.length - pre && ta[ta.length - 1 - suf] === tb[tb.length - 1 - suf]) suf++
  const ma = ta.slice(pre, ta.length - suf)
  const mb = tb.slice(pre, tb.length - suf)
  const offA = ta.slice(0, pre).join('').length
  const offB = tb.slice(0, pre).join('').length
  if (!ma.length && !mb.length) return []
  const whole: Hunk = { aStart: offA, aEnd: offA + ma.join('').length, bStart: offB, bEnd: offB + mb.join('').length }
  if (!ma.length || !mb.length || ma.length * mb.length > MAX_LCS_CELLS) return [whole]

  // LCS table, then walk it to collect the unmatched stretches.
  const n = ma.length
  const m = mb.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = ma[i] === mb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let ca = offA
  let cb = offB
  let open: Hunk | null = null
  const close = () => {
    if (open) hunks.push(open)
    open = null
  }
  while (i < n || j < m) {
    if (i < n && j < m && ma[i] === mb[j]) {
      close()
      ca += ma[i++].length
      cb += mb[j++].length
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      open ??= { aStart: ca, aEnd: ca, bStart: cb, bEnd: cb }
      cb += mb[j++].length
      open.bEnd = cb
    } else {
      open ??= { aStart: ca, aEnd: ca, bStart: cb, bEnd: cb }
      ca += ma[i++].length
      open.aEnd = ca
    }
  }
  close()
  // 「cloud code」→「Claude Code」 is one edit, not two split by the space.
  const merged: Hunk[] = []
  for (const h of hunks) {
    const last = merged.at(-1)
    if (last && /^\s*$/.test(a.slice(last.aEnd, h.aStart)) && /^\s*$/.test(b.slice(last.bEnd, h.bStart))) {
      last.aEnd = h.aEnd
      last.bEnd = h.bEnd
    } else merged.push({ ...h })
  }
  return merged
}

// Where an offset of the old text lands in the new one.
function mapOffset(hunks: Hunk[], at: number): number {
  let shift = 0
  for (const h of hunks) {
    if (h.aEnd <= at) shift += h.bEnd - h.bStart - (h.aEnd - h.aStart)
    else if (h.aStart < at) return h.bEnd // inside a change: snap to its end
  }
  return at + shift
}

const MAX_EDIT_CHARS = 30
const CONTEXT_CHARS = 30
const onlyPunctuation = (s: string) => !/[\p{L}\p{N}]/u.test(s)
const normalize = (s: string) => s.replace(/\r\n?/g, '\n')

// What the user corrected inside the pasted text: `baseline` is the input box
// right after pasting, `current` the same box later. Only word-sized
// replacements count; added sentences, deletions and rewrites are not about
// how a word is spelled.
export function findEdits(pasted: string, baselineRaw: string, currentRaw: string): Edit[] {
  const baseline = normalize(baselineRaw)
  const current = normalize(currentRaw)
  const p = normalize(pasted).trim()
  if (!p || baseline === current) return []
  const pos = baseline.lastIndexOf(p)
  if (pos < 0) return []
  const end = pos + p.length

  const hunks = diff(baseline, current)
  const inside = hunks.filter((h) => h.aEnd > pos && h.aStart < end) // what we pasted, not the rest of the box
  // Nearly all of the dictation changed: the user rewrote it rather than fixed words.
  const changed = inside.reduce((n, h) => n + Math.min(h.aEnd, end) - Math.max(h.aStart, pos), 0)
  if (changed > p.length * 0.8) return []

  const edits: Edit[] = []
  for (const h of inside) {
    const removed = baseline.slice(h.aStart, h.aEnd).trim()
    const added = current.slice(h.bStart, h.bEnd).trim()
    if (!removed || !added || removed === added) continue
    // A respelling keeps roughly its length. A long or much longer/shorter
    // phrase means the user was rewording here, so nothing nearby is a spelling fix.
    if (removed.length > MAX_EDIT_CHARS || added.length > MAX_EDIT_CHARS) return []
    if (added.length > removed.length * 2 + 2 || removed.length > added.length * 2 + 2) return []
    if (onlyPunctuation(added) || /\n/.test(added)) continue
    const ctxStart = Math.max(pos, h.aStart - CONTEXT_CHARS)
    const ctxEnd = Math.min(end, h.aEnd + CONTEXT_CHARS)
    edits.push({
      removed,
      added,
      contextBefore: baseline.slice(ctxStart, ctxEnd),
      contextAfter: current.slice(mapOffset(hunks, ctxStart), mapOffset(hunks, ctxEnd))
    })
  }
  return edits
}

const MAX_TERM_CHARS = 30
const MIN_FORM_CHARS = 2 // a one-character form (「的」→「地」) would rewrite everything

// What recognition wrote where the user typed a dictionary word, as 常被识别成.
// CJK edits are per character (「开花」→「开发」 diffs as 「花」→「发」), so the
// word is widened back out: the term with the edit undone, found in the pasted text.
export function heardForms(edits: Edit[], terms: string[]): Array<{ term: string; form: string }> {
  const out: Array<{ term: string; form: string }> = []
  for (const e of edits) {
    for (const term of terms) {
      if (!e.contextAfter.includes(term) || e.contextBefore.includes(term)) continue
      for (let k = term.indexOf(e.added); k >= 0; k = term.indexOf(e.added, k + 1)) {
        const form = term.slice(0, k) + e.removed + term.slice(k + e.added.length)
        if (form.length < MIN_FORM_CHARS || onlyPunctuation(form) || form.toLowerCase() === term.toLowerCase()) continue
        if (!e.contextBefore.includes(form)) continue
        if (!out.some((o) => o.term === term && o.form === form)) out.push({ term, form })
        break
      }
    }
  }
  return out
}

// Keep only words the user really typed in: present now, absent from what we
// pasted, term-shaped, and not already in the dictionary.
export function groundTerms(terms: unknown[], edits: Edit[], existing: string[]): string[] {
  const known = new Set(existing.map((t) => t.toLowerCase()))
  const out: string[] = []
  for (const raw of terms) {
    if (typeof raw !== 'string') continue
    const term = raw.trim()
    if (!term || term.length > MAX_TERM_CHARS || /[\n，。！？；：,.!?;:]$/.test(term) || onlyPunctuation(term)) continue
    if (term.split(/\s+/).length > 4) continue
    if (known.has(term.toLowerCase())) continue
    const typed = edits.some((e) => e.contextAfter.includes(term) && !e.contextBefore.includes(term))
    if (!typed) continue
    known.add(term.toLowerCase())
    out.push(term)
  }
  return out
}
