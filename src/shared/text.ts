// Word counting for the stats: each CJK character is a word (shown as
// 「字」), each run of Latin letters/digits is one word.
const CJK = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g
const LATIN_WORD = /[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g

export function countWords(text: string): number {
  return (text.match(CJK)?.length ?? 0) + (text.replace(CJK, ' ').match(LATIN_WORD)?.length ?? 0)
}

// Local calendar day, e.g. 2026-10-14. Stats group by the user's own days.
export function dayKey(d: Date | number): string {
  const t = new Date(d)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
