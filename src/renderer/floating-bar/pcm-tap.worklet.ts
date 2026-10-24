// Audio thread: the microphone at 16 kHz for the live preview, in 200 ms blocks.
// Averaging the input samples behind each output sample is crude filtering, but
// good enough for a preview; the pasted text is recognised from the recording.
declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

const OUT_RATE = 16_000
const BLOCK = OUT_RATE / 5

class PcmTap extends AudioWorkletProcessor {
  private step = sampleRate / OUT_RATE
  private pos = 0
  private sum = 0
  private n = 0
  private out = new Float32Array(BLOCK)
  private len = 0

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]
      this.n++
      if (++this.pos < this.step) continue
      this.pos -= this.step
      this.out[this.len++] = this.sum / this.n
      this.sum = this.n = 0
      if (this.len === BLOCK) {
        this.port.postMessage(this.out, [this.out.buffer])
        this.out = new Float32Array(BLOCK)
        this.len = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-tap', PcmTap)
