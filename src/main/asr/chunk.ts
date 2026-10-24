// SenseVoice is non-streaming: a 15-minute clip in one pass would hold the whole
// feature matrix in memory. Cut long audio into short pieces at natural pauses.

const FRAME_SEC = 0.1

// The middle of the quietest 100 ms frame between `lo` and `hi` (sample indexes).
export function quietestCut(samples: Float32Array, lo: number, hi: number, sampleRate: number): number {
  const frame = Math.round(FRAME_SEC * sampleRate)
  const step = Math.round(frame / 2)
  let cut = hi
  let quietest = Infinity
  for (let s = Math.max(0, lo); s + frame <= hi; s += step) {
    let energy = 0
    for (let i = s; i < s + frame; i++) energy += samples[i] * samples[i]
    if (energy < quietest) {
      quietest = energy
      cut = s + step
    }
  }
  return cut
}

// Cut at most every `maxSec`, at the quietest 100 ms frame within the last
// `searchSec` before each limit, so words are not split in half.
export function splitAtPauses(samples: Float32Array, sampleRate: number, maxSec = 30, searchSec = 5): Float32Array[] {
  const max = Math.round(maxSec * sampleRate)
  if (samples.length <= max) return [samples]
  const pieces: Float32Array[] = []
  let start = 0
  while (samples.length - start > max) {
    const hi = start + max
    const cut = quietestCut(samples, hi - Math.round(searchSec * sampleRate), hi, sampleRate)
    pieces.push(samples.subarray(start, cut))
    start = cut
  }
  pieces.push(samples.subarray(start))
  return pieces
}

// SenseVoice text has no punctuation; Chinese pieces join directly, English
// words across a cut need a space.
export function joinPieces(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .reduce((acc, p) => (acc && /[A-Za-z0-9]$/.test(acc) && /^[A-Za-z0-9]/.test(p) ? `${acc} ${p}` : acc + p), '')
}
