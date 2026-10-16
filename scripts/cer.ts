// Character error rate for comparing speech recognisers.

// Engines differ in number style (「8点半」 vs 「八点半」, 「15%」 vs 「百分之十五」);
// spell digits out so only real recognition errors count.
const DIGITS = '零一二三四五六七八九'
function zhNumber(n: number): string {
  if (n < 10) return DIGITS[n]
  if (n < 20) return '十' + (n % 10 ? DIGITS[n % 10] : '')
  if (n < 100) return DIGITS[Math.floor(n / 10)] + '十' + (n % 10 ? DIGITS[n % 10] : '')
  return [...String(n)].map((d) => DIGITS[Number(d)]).join('')
}
const spellNumbers = (s: string) =>
  s.replace(/(\d+)\s*%/g, (_, d) => '百分之' + zhNumber(Number(d))).replace(/\d+/g, (d) => zhNumber(Number(d)))

// Character error rate on content only: punctuation, spaces, case and number style ignored.
export const norm = (s: string) => spellNumbers(s.toLowerCase()).replace(/[\s\p{P}\p{S}]/gu, '')
export function cer(ref: string, hyp: string): number {
  const a = [...norm(ref)]
  const b = [...norm(hyp)]
  if (!a.length) return b.length ? 1 : 0
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length] / a.length
}
