// Short start/stop cues, synthesised so no audio files are shipped.
let ctx: AudioContext | null = null

function blip(freqs: number[], gain = 0.06): void {
  ctx ??= new AudioContext()
  const t0 = ctx.currentTime + 0.01
  freqs.forEach((f, i) => {
    const osc = ctx!.createOscillator()
    const amp = ctx!.createGain()
    const start = t0 + i * 0.07
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f, start)
    amp.gain.setValueAtTime(0, start)
    amp.gain.linearRampToValueAtTime(gain, start + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.16)
    osc.connect(amp).connect(ctx!.destination)
    osc.start(start)
    osc.stop(start + 0.18)
  })
}

export const playStart = () => blip([740, 988]) // rising: listening
export const playStop = () => blip([988, 740]) // falling: done talking
