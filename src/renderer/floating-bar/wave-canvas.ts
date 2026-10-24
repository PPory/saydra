// Draws the waveform on a canvas in device pixels. At display scales like 125% a
// 2px bar is 2.5 device pixels, so DOM bars came out 2 or 3 wide and their heights
// jumped in 1.25px steps. Here every bar has the same whole-pixel width and gap,
// heights ease towards their targets each frame, and silence is a row of dots.

const EASE_MS = 45 // displayed height follows the target with this time constant
const LIGHT_MS = 200 // dim → white per bar
const LIGHT_SPREAD_S = 0.5 // the last bar lights this long after the first, scaled by count
const FADE_MS = 150 // bars fold to dots and fade out when recording ends
const DIM = 0.5

export interface WavePainter {
  set(heights: number[]): void // CSS px, from createWaveform
  fade(): void
  dispose(): void
}

export function createWavePainter(canvas: HTMLCanvasElement, count: number, cssW: number, cssH: number, barCss: number): WavePainter {
  const ctx = canvas.getContext('2d')!
  let dpr = 0
  let bw = 0
  let gap = 0
  let left = 0
  let H = 0
  let target = Array<number>(count).fill(0)
  const shown = Array<number>(count).fill(0)
  const born = performance.now()
  let fadeAt = 0
  let last = born
  let raf = 0

  function layout(): void {
    dpr = window.devicePixelRatio || 1
    const W = Math.round(cssW * dpr)
    bw = Math.max(1, Math.round(barCss * dpr))
    gap = Math.floor((W - count * bw) / (count - 1))
    while (gap < 1 && bw > 1) gap = Math.floor((W - count * --bw) / (count - 1))
    left = Math.floor((W - (count * bw + (count - 1) * gap)) / 2)
    // Same parity as the bar width, so a dot and every bar sit exactly on the centre line.
    H = Math.round(cssH * dpr)
    if ((H - bw) % 2) H++
    canvas.width = W
    canvas.height = H
    canvas.style.width = `${W / dpr}px`
    canvas.style.height = `${H / dpr}px`
  }

  function draw(now: number): void {
    raf = requestAnimationFrame(draw)
    if (window.devicePixelRatio !== dpr) layout()
    const k = 1 - Math.exp(-(now - last) / EASE_MS)
    last = now
    const fading = fadeAt ? Math.min(1, (now - fadeAt) / FADE_MS) : 0
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const mid = (count - 1) / 2
    for (let i = 0; i < count; i++) {
      const goal = fadeAt ? 0 : target[i]
      shown[i] += (goal - shown[i]) * k
      // Even steps around the centre: a bar grows one device pixel at each end.
      let h = Math.max(bw, Math.round(shown[i] * dpr))
      if ((h - bw) % 2) h++
      h = Math.min(h, H)
      // Light up from the middle outwards.
      const delay = (Math.abs(i - mid) * LIGHT_SPREAD_S * 1000) / count
      const lit = Math.min(1, Math.max(0, (now - born - delay) / LIGHT_MS))
      const alpha = (DIM + (1 - DIM) * lit) * (1 - fading)
      if (alpha <= 0) continue
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      ctx.beginPath()
      ctx.roundRect(left + i * (bw + gap), (H - h) / 2, bw, h, bw / 2)
      ctx.fill()
    }
    if (fading >= 1) cancelAnimationFrame(raf)
  }

  layout()
  raf = requestAnimationFrame(draw)
  return {
    set(heights) {
      target = heights
    },
    fade() {
      fadeAt ||= performance.now()
    },
    dispose() {
      cancelAnimationFrame(raf)
    }
  }
}
