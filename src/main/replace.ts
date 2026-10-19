// 词典 「常被识别成」: fixed replacements of what recognition keeps getting wrong
// (「开花」→「开发」, 「get」→「git」). No Electron imports, so
// scripts/test-replace.ts can run it.

export interface Replacement {
  from: string // what recognition writes
  to: string // the dictionary word
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isLatin = (s: string) => /^[\x20-\x7e]+$/.test(s)
// Latin forms match whole words only, ignoring case: 「get」 is not touched in 「together」.
const pattern = (s: string) => (isLatin(s) ? `(?<![A-Za-z0-9])${escape(s)}(?![A-Za-z0-9])` : escape(s))

// One pass, longest form first, so a replacement is never replaced again.
// A form inside its own word already written right (「Code」 in 「Claude Code」) is left alone.
export function applyReplacements(text: string, rules: Replacement[]): string {
  const usable = rules.filter((r) => r.from.trim() && r.to.trim() && r.from.toLowerCase() !== r.to.toLowerCase())
  if (!text || !usable.length) return text
  const byForm = new Map<string, string>()
  for (const r of usable) if (!byForm.has(r.from.toLowerCase())) byForm.set(r.from.toLowerCase(), r.to)
  const forms = [...byForm.keys()].sort((a, b) => b.length - a.length)
  const re = new RegExp(forms.map(pattern).join('|'), 'giu')

  // Spans where a target word is already written out.
  const targets = [...new Set(byForm.values())]
  const done: Array<[number, number]> = []
  for (const m of text.matchAll(new RegExp(targets.map(pattern).join('|'), 'giu'))) done.push([m.index, m.index + m[0].length])

  return text.replace(re, (match, ...args) => {
    const at = args.at(-2) as number
    if (done.some(([s, e]) => s <= at && at + match.length <= e)) return match
    return byForm.get(match.toLowerCase()) ?? match
  })
}
