// SiliconFlow (硅基流动): the same SenseVoice model as the local engine, run in their
// cloud for free, so low-memory machines need not load it. No Electron imports.
import { apiRequest, type Endpoint } from './llm'

export const SILICONFLOW_BASE = 'https://api.siliconflow.cn/v1'
export const SILICONFLOW_ASR_MODEL = 'FunAudioLLM/SenseVoiceSmall'

export const siliconflowEndpoint = (apiKey: string): Endpoint => ({ name: '硅基流动', baseUrl: SILICONFLOW_BASE, apiKey })

// Comes back punctuated, English in lower case. The service ignores `prompt`,
// so the dictionary only helps later, in refine.
export async function transcribeSiliconFlow(apiKey: string, audio: ArrayBuffer, mimeType: string): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([audio], { type: mimeType }), mimeType.includes('wav') ? 'audio.wav' : 'audio.webm')
  form.append('model', SILICONFLOW_ASR_MODEL)
  // Serialize multipart up front: net.fetch does not accept FormData bodies.
  const encoded = new Response(form)
  const body = await encoded.arrayBuffer()
  const data = await apiRequest(
    siliconflowEndpoint(apiKey),
    '/audio/transcriptions',
    { method: 'POST', headers: { 'Content-Type': encoded.headers.get('content-type')! }, body },
    { timeoutMs: 20_000 + audio.byteLength / 8 }
  )
  return String(data.text ?? '').trim()
}

export async function checkSiliconflowKey(apiKey: string): Promise<void> {
  await apiRequest(siliconflowEndpoint(apiKey), '/models?sub_type=speech-to-text', { method: 'GET' }, { timeoutMs: 10_000 })
}
