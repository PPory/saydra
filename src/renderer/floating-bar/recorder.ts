// Microphone capture for one dictation: webm/opus for upload and retries,
// optional 16 kHz PCM for the local engine, and a simple voice detector.
import type { RecordingRequest, VoiceStats } from '../../shared/types'
import tapUrl from './pcm-tap.worklet?worker&url'

const MIME = 'audio/webm;codecs=opus'
const PCM_RATE = 16_000 // what the local SenseVoice model expects
// Frame RMS above this counts as voice. Silence with noise suppression sits
// well below 0.005; normal speech is 0.03+.
const VOICE_RMS = 0.012
const VAD_MS = 50

export type MicStatus = 'off' | 'opening' | 'live'

// Chromium decodes the Opus recording and resamples it to the context rate in one step.
export async function decodePcm(blob: Blob): Promise<Float32Array | null> {
  try {
    const decoded = await new OfflineAudioContext(1, 1, PCM_RATE).decodeAudioData(await blob.arrayBuffer())
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0)
    const mono = new Float32Array(decoded.length)
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const ch = decoded.getChannelData(c)
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / decoded.numberOfChannels
    }
    return mono
  } catch (err) {
    console.warn('pcm decode failed', err)
    return null // main falls back to the cloud engine
  }
}

interface Kept {
  blob: Blob
  voice: VoiceStats
  wantPcm: boolean
}

export function createRecorder(onStatus: (status: MicStatus, analyser: AnalyserNode | null) => void) {
  let recorder: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let audioCtx: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let vadTimer = 0
  let chunks: Blob[] = []
  let discard = false
  let stopRequested = false
  let opening = false
  let wantPcm = false
  let voicedMs = 0
  let peakRms = 0
  let micOpenMs = 0
  let lastCancelled: Kept | null = null // kept for 「撤销」 on the cancelled alert

  const voice = (): VoiceStats => ({
    voicedMs: Math.round(voicedMs),
    peakRms: Number(peakRms.toFixed(4)),
    micOpenMs: Math.round(micOpenMs)
  })

  async function send(k: Kept): Promise<void> {
    const pcm = k.wantPcm ? await decodePcm(k.blob) : null
    window.rea.sendRecording(await k.blob.arrayBuffer(), MIME, k.voice, pcm)
  }

  // Live preview: stream the mic to main as it is recorded (see pcm-tap.worklet.ts).
  async function attachTap(ctx: AudioContext, source: MediaStreamAudioSourceNode): Promise<void> {
    try {
      await ctx.audioWorklet.addModule(tapUrl)
      if (audioCtx !== ctx) return // already stopped
      const tap = new AudioWorkletNode(ctx, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 0 })
      tap.port.onmessage = (e: MessageEvent<Float32Array>) => window.rea.sendLivePcm(e.data)
      source.connect(tap)
    } catch (err) {
      console.warn('live preview unavailable', err)
    }
  }

  function release(): void {
    clearInterval(vadTimer)
    stream?.getTracks().forEach((t) => t.stop())
    void audioCtx?.close()
    stream = null
    audioCtx = null
    analyser = null
    recorder = null
    onStatus('off', null)
  }

  // The chosen microphone may have been unplugged: fall back to the system default.
  async function openMic(deviceId: string): Promise<MediaStream> {
    const base = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } } })
      } catch (err) {
        console.warn('chosen microphone unavailable, using default', err)
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: base })
  }

  async function start(req: RecordingRequest): Promise<void> {
    wantPcm = req.wantPcm
    chunks = []
    voicedMs = peakRms = 0
    discard = stopRequested = false
    opening = true
    const askedAt = performance.now()
    onStatus('opening', null)
    try {
      stream = await openMic(req.deviceId)
    } catch (err) {
      onStatus('off', null)
      window.rea.sendRecordingFailed((err as Error).message || '无法访问麦克风')
      return
    } finally {
      opening = false
    }
    if (stopRequested && discard) return release()
    audioCtx = new AudioContext()
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.7
    const source = audioCtx.createMediaStreamSource(stream)
    source.connect(analyser)
    if (req.livePreview) void attachTap(audioCtx, source)

    const frame = new Float32Array(analyser.fftSize)
    vadTimer = window.setInterval(() => {
      if (!analyser) return
      analyser.getFloatTimeDomainData(frame)
      let sum = 0
      for (const v of frame) sum += v * v
      const rms = Math.sqrt(sum / frame.length)
      if (rms > VOICE_RMS) voicedMs += VAD_MS
      peakRms = Math.max(peakRms, rms)
    }, VAD_MS)

    recorder = new MediaRecorder(stream, { mimeType: MIME, audioBitsPerSecond: 32_000 })
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    recorder.onstop = () => {
      const kept: Kept = { blob: new Blob(chunks, { type: MIME }), voice: voice(), wantPcm }
      const wasDiscarded = discard
      release()
      if (wasDiscarded) lastCancelled = kept
      else void send(kept)
    }
    recorder.start(250)
    micOpenMs = performance.now() - askedAt
    onStatus('live', analyser)
    // The key may have been released while the mic was still opening.
    if (stopRequested) recorder.stop()
  }

  return {
    start,
    stop() {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      else if (opening) stopRequested = true // start() stops right after the mic opens
      else window.rea.sendRecording(new ArrayBuffer(0), MIME, voice(), null) // mic failed; unblock main
    },
    cancel() {
      discard = true
      stopRequested = true
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      else if (!opening) release()
    },
    resendCancelled() {
      if (lastCancelled) void send(lastCancelled)
      lastCancelled = null
    }
  }
}
