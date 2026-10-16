// Live waveform for the pill: loudness pulses appear near the centre and ripple
// outwards, then decay.

const UPDATE_MS = 50
const DIFFUSION_MS = 80
const VOCAL_BINS = [14, 140] // ~330 Hz – 3.3 kHz at 48 kHz / FFT 2048
const AVG_FRAMES = 3
export const MIN_H = 2
export const MAX_H = 24 // Windows
const NOISE_T = 0.03
const VOICE_T = 0.1
const SMOOTHING = 0.85
const FLOOR = { follow: 0.01, fast: 0.06, slow: 0.002, margin: 0.006, max: 0.35 }

const rand = (min: number, max: number) => min + Math.random() * (max - min)

interface Bar {
  h: number
  age: number
  live: boolean // set by a pulse, decaying back to the idle dot
}

export function createWaveform(count: number, onChange: (heights: number[]) => void) {
  let bars: Bar[] = Array.from({ length: count }, () => ({ h: MIN_H, age: 0, live: false }))
  let analyser: AnalyserNode | null = null
  let bins = new Uint8Array(0)
  const recent: number[] = []
  let floor = 0
  let smoothed = 3
  let lastUpdate = 0
  let raf = 0
  const pulses: Array<{ h: number; at: number }> = []
  const timers = new Set<number>()

  const emit = () => onChange(bars.map((b) => b.h))

  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }

  // Loudness of the voice band -> target bar height, with an adaptive noise floor.
  function measure(): number {
    analyser!.getByteFrequencyData(bins)
    const [lo, hi] = [VOCAL_BINS[0], Math.min(VOCAL_BINS[1], bins.length - 1)]
    let sum = 0
    for (let i = lo; i <= hi; i++) sum += bins[i]
    recent.push(sum / (hi - lo + 1))
    if (recent.length > AVG_FRAMES) recent.shift()
    const level = recent.reduce((a, b) => a + b, 0) / recent.length / 255
    const k = level <= floor + FLOOR.follow ? FLOOR.fast : FLOOR.slow
    floor = Math.min(FLOOR.max, Math.max(0, floor * (1 - k) + level * k))
    const signal = Math.max(0, level - floor - FLOOR.margin)

    let v: number
    if (signal < NOISE_T) v = 0.15 + (signal / NOISE_T) * 0.22 + Math.random() * 0.04
    else if (signal < VOICE_T) {
      const p = (signal - NOISE_T) / (VOICE_T - NOISE_T)
      v = Math.min(0.86, Math.max(0.36, 0.42 + p * 0.46 + rand(-0.12, 0.12)))
    } else {
      const x = (signal - VOICE_T) / (1 - VOICE_T)
      const jitter = Math.max(0.18, 0.3 * x)
      let shaped = Math.min(1, Math.max(0, x ** 0.25 + rand(-jitter, jitter)))
      if (x > 0.4) shaped = Math.min(1, shaped * rand(1.4, 1.8))
      v = Math.min(1, Math.max(0.52, 0.62 + 0.35 * shaped + rand(-0.12, 0.12)))
    }
    v = Math.max(0.15, v)
    const target = Math.max(MIN_H, Math.min(MAX_H, MIN_H + Math.round((MAX_H - MIN_H) * v)))
    smoothed = smoothed * (1 - SMOOTHING) + target * SMOOTHING

    // Louder sound = more likely to start a new ripple.
    if (signal > Math.max(NOISE_T * 0.5, VOICE_T * 0.7) && Math.random() < Math.min(0.8, signal * 2))
      pulses.push({ h: Math.round(smoothed * rand(0.9, 1.1)), at: performance.now() })
    return signal
  }

  function spread(): void {
    const now = performance.now()
    while (pulses.length && now - pulses[0].at >= DIFFUSION_MS) {
      const p = pulses.shift()!
      const n = bars.length
      const centre = Math.max(0, Math.min(n - 1, Math.floor(n / 2) + Math.floor((Math.random() - 0.5) * Math.min(n * 0.15, 3))))
      bars[centre] = { h: Math.round(p.h * rand(0.95, 1.05)), age: 0, live: true }
      const left = centre
      const right = n - 1 - centre
      for (let d = 1; d <= Math.max(left, right); d++) {
        for (const [i, side] of [
          [centre - d, left],
          [centre + d, right]
        ] as const) {
          if (i < 0 || i >= n) continue
          const decay = Math.max(0.12, 1 - (d / Math.max(side, 1)) * (0.65 + Math.random() * 0.08))
          const h = Math.max(MIN_H, Math.round(p.h * decay * rand(0.9, 1.1)))
          later(d * DIFFUSION_MS * (0.15 + Math.random() * 0.05) + Math.random() * 15, () => {
            const blend = rand(0.65, 0.75)
            const cur = bars[i]?.h ?? MIN_H
            if (bars[i]) bars[i] = { h: Math.max(h, Math.round(cur * (1 - blend) + h * blend)), age: Math.floor(Math.random() * 2), live: true }
            emit()
          })
        }
      }
    }
    // Age every live bar back down to an idle dot; outer bars fade a little faster.
    const mid = Math.floor(bars.length / 2)
    bars = bars.map((b, i) => {
      if (!b.live) return b
      const age = b.age + (Math.random() > 0.7 ? 1 : Math.random() > 0.95 ? 2 : 0)
      const rate = Math.max(0.95, rand(0.98, 0.995) / (1 + (Math.abs(i - mid) / bars.length) * 0.3))
      const h = Math.max(MIN_H, Math.round(b.h * rate ** (age / 12) * rand(0.95, 1.05)))
      return age > 50 + Math.random() * 15 || h <= MIN_H ? { h: MIN_H, age: 0, live: false } : { ...b, h, age }
    })
  }

  function frame(): void {
    raf = requestAnimationFrame(frame)
    const now = performance.now()
    if (analyser && now - lastUpdate >= UPDATE_MS) {
      lastUpdate = now
      measure()
    }
    spread()
    emit()
  }

  return {
    attach(node: AnalyserNode | null) {
      analyser = node
      bins = new Uint8Array(node?.frequencyBinCount ?? 0)
      floor = 0
      recent.length = 0
      if (node && !raf) frame()
      if (!node) this.reset()
    },
    reset() {
      cancelAnimationFrame(raf)
      raf = 0
      timers.forEach(clearTimeout)
      timers.clear()
      pulses.length = 0
      bars = bars.map(() => ({ h: MIN_H, age: 0, live: false }))
      emit()
    }
  }
}
