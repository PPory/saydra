// Local speech recognition. Loads once in the background at startup (~1.8 s)
// so the first dictation does not wait for it. No Electron imports.
import { joinPieces, splitAtPauses } from './chunk'
import { loadSenseVoice, type LocalRecognizer } from './sensevoice'

export const PCM_RATE = 16_000

let loading: Promise<LocalRecognizer> | null = null
let loadError: Error | null = null

export function preloadLocalAsr(modelsRoot: string): Promise<LocalRecognizer> {
  loading ??= loadSenseVoice(modelsRoot).catch((err: Error) => {
    loadError = err
    throw err
  })
  return loading
}

export const localAsrFailed = (): Error | null => loadError

export async function transcribeLocal(samples: Float32Array): Promise<string> {
  if (!loading) throw new Error('本地识别模型未加载')
  const recognizer = await loading
  const parts: string[] = []
  for (const piece of splitAtPauses(samples, PCM_RATE)) parts.push(await recognizer.transcribe(piece, PCM_RATE))
  return joinPieces(parts)
}
