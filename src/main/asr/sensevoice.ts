// Local SenseVoice (sherpa-onnx, CPU). No Electron imports, so scripts can reuse it.
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

export const SENSEVOICE_DIR = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09'

export interface LocalRecognizer {
  transcribe(samples: Float32Array, sampleRate: number): Promise<string>
}

export async function loadSenseVoice(modelsRoot: string, numThreads = 4): Promise<LocalRecognizer> {
  const sherpa = require('sherpa-onnx-node')
  const dir = join(modelsRoot, SENSEVOICE_DIR)
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: join(dir, 'model.int8.onnx'), language: 'zh', useInverseTextNormalization: 1 },
      tokens: join(dir, 'tokens.txt'),
      numThreads,
      provider: 'cpu',
      debug: 0
    }
  })
  return {
    async transcribe(samples, sampleRate) {
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples, sampleRate })
      await recognizer.decodeAsync(stream)
      return String(recognizer.getResult(stream).text ?? '').trim()
    }
  }
}
