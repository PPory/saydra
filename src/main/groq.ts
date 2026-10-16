// Groq: Whisper transcription plus the default refine models. No Electron imports.
import { keepSpokenText, type Segment } from './hallucination'
import { apiRequest, chat, type Endpoint } from './llm'

export const GROQ_BASE = 'https://api.groq.com/openai/v1'
// Full v3: noticeably fewer Mandarin homophone errors than turbo for ~0.3s more.
export const TRANSCRIBE_MODEL = 'whisper-large-v3'
export const DEFAULT_REFINE_MODEL = 'qwen/qwen3.8-27b'
export const LONG_REFINE_MODEL = 'openai/gpt-oss-120b'
export const REFINE_MODELS = [DEFAULT_REFINE_MODEL, LONG_REFINE_MODEL]

// Free tier caps Qwen at 1000 output tokens/min (~1500 Chinese chars, ~5 min of
// speech). gpt-oss-120b only has the 8000 tokens/min total cap, enough for
// ~15 min of speech in one call.
export const LONG_TEXT_CHARS = 900

export function refineModelFor(preferred: string, chars: number): string {
  return preferred.startsWith('qwen/') && chars > LONG_TEXT_CHARS ? LONG_REFINE_MODEL : preferred
}

export const groqEndpoint = (apiKey: string): Endpoint => ({ name: 'Groq', baseUrl: GROQ_BASE, apiKey })

export async function transcribe(
  apiKey: string,
  audio: ArrayBuffer,
  opts: { mimeType: string; prompt: string }
): Promise<{ text: string; rawText: string; segments: Segment[] }> {
  const ext = opts.mimeType.includes('wav') ? 'wav' : 'webm'
  const form = new FormData()
  form.append('file', new Blob([audio], { type: opts.mimeType }), `audio.${ext}`)
  form.append('model', TRANSCRIBE_MODEL)
  form.append('language', 'zh')
  form.append('prompt', opts.prompt)
  form.append('response_format', 'verbose_json') // per-segment confidence
  form.append('temperature', '0')
  // Serialize multipart up front: net.fetch does not accept FormData bodies.
  const encoded = new Response(form)
  const body = await encoded.arrayBuffer()
  const headers = { 'Content-Type': encoded.headers.get('content-type')! }
  // ~4 KB per second of 32 kbps Opus; allow more time for long recordings.
  const data = await apiRequest(
    groqEndpoint(apiKey),
    '/audio/transcriptions',
    { method: 'POST', headers, body },
    { timeoutMs: 30_000 + audio.byteLength / 8 }
  )
  const segments: Segment[] = data.segments ?? []
  const rawText = String(data.text ?? '').trim()
  return { text: keepSpokenText(segments), rawText, segments }
}

// Groq-only refine, kept for the eval and bench scripts.
export function refine(apiKey: string, model: string, systemPrompt: string, text: string): Promise<string> {
  return chat(groqEndpoint(apiKey), model, systemPrompt, text, {
    maxRateLimitWaitS: text.length > LONG_TEXT_CHARS ? 20 : 3
  })
}

export async function checkKey(apiKey: string): Promise<void> {
  await apiRequest(groqEndpoint(apiKey), '/models', { method: 'GET' }, { timeoutMs: 10_000 })
}
