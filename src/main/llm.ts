// OpenAI-compatible API client shared by Groq and any custom gateway (e.g. CPA).
// No Electron imports, so scripts can reuse it.

export interface Endpoint {
  name: string // shown in error messages, e.g. "Groq"
  baseUrl: string // ends with /v1
  apiKey: string
}

export type ApiErrorKind = 'auth' | 'network' | 'timeout' | 'rate_limit' | 'server'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly provider = '',
    readonly status = 0 // HTTP status, when the service answered
  ) {
    super(message)
  }
}

// Electron main swaps in net.fetch so requests follow the Windows system proxy.
let doFetch: typeof fetch = fetch
export function setFetch(impl: typeof fetch): void {
  doFetch = impl
}

export interface RequestOptions {
  timeoutMs: number
  attempts?: number // 1 when a fallback provider is waiting, so failures surface fast
  maxRateLimitWaitS?: number
}

export async function apiRequest(ep: Endpoint, path: string, init: RequestInit, opts: RequestOptions): Promise<any> {
  const attempts = opts.attempts ?? 2
  const fail = (message: string, kind: ApiErrorKind, status = 0) => new ApiError(message, kind, ep.name, status)
  let lastError: ApiError | undefined
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await doFetch(`${ep.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${ep.apiKey}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(Math.round(opts.timeoutMs)) // throws on fractional ms
      })
      if (res.ok) return await res.json()
      const body = await res.text()
      if (res.status === 401) throw fail(`${ep.name} 的 API key 无效或已失效，请在设置里重新填写`, 'auth')
      // Groq sits behind Cloudflare, which answers 403 when the request bypassed the proxy.
      if (res.status === 403) throw fail(`${ep.name} 拒绝访问，请确认代理已开启`, 'auth')
      if (res.status === 429) {
        lastError = fail(`${ep.name} 调用太频繁，请稍后再试`, 'rate_limit')
        // Honour retry-after (capped) so the retry does not hit the same limit.
        const wait = Math.min(Number(res.headers.get('retry-after')) || 1, opts.maxRateLimitWaitS ?? 3)
        if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, wait * 1000))
        continue
      }
      lastError = fail(`${ep.name} 返回错误 ${res.status}：${body.slice(0, 200)}`, 'server', res.status)
      if (res.status === 400 || res.status === 404) throw lastError
    } catch (err) {
      if (err instanceof ApiError && (err.kind === 'auth' || err.kind === 'server')) throw err
      if (err instanceof ApiError) lastError = err
      else if ((err as Error).name === 'TimeoutError') lastError = fail(`${ep.name} 响应超时`, 'timeout')
      // Connection problems: Node fetch rejects with TypeError('fetch failed'),
      // Electron net.fetch with 'net::ERR_*'. Anything else is a bug and must
      // surface as itself, not be disguised as a network error.
      else if ((err instanceof TypeError && err.message === 'fetch failed') || /^net::ERR_/.test((err as Error).message))
        lastError = fail('网络连接失败', 'network')
      else throw err
    }
  }
  throw lastError!
}

// Free-tier Groq caps Qwen at 1000 output tokens/min and rejects any request
// reserving more; measured ~0.6 output tokens per Chinese char for Qwen and
// ~1.25 for gpt-oss including its reasoning.
const QWEN_MAX_OUTPUT = 1000

// maxTokens: a fixed output budget (answers), instead of one sized to the input (cleanup).
function modelParams(model: string, chars: number, maxTokens?: number): Record<string, unknown> {
  if (model.startsWith('qwen/'))
    return { reasoning_effort: 'none', max_tokens: Math.min(QWEN_MAX_OUTPUT - 10, maxTokens ?? Math.ceil(chars * 0.8) + 200) }
  const max_tokens = maxTokens ?? Math.ceil(chars * 1.5) + 600
  if (model.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low', max_tokens }
  return { max_tokens }
}

export interface ChatOptions {
  timeoutMs?: number
  attempts?: number
  maxRateLimitWaitS?: number
  wrapTag?: string // user text goes inside <tag>…</tag> so the model never answers it; '' sends it as is
  maxTokens?: number
  temperature?: number
}

// One system + user turn, returning the cleaned text.
export async function chat(ep: Endpoint, model: string, system: string, text: string, opts: ChatOptions = {}): Promise<string> {
  const tag = opts.wrapTag ?? '转写'
  const body = {
    model,
    temperature: opts.temperature ?? 0.2,
    ...modelParams(model, text.length, opts.maxTokens),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: tag ? `<${tag}>\n${text}\n</${tag}>` : text }
    ]
  }
  const data = await apiRequest(
    ep,
    '/chat/completions',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    {
      timeoutMs: opts.timeoutMs ?? 20_000 + text.length * 10,
      attempts: opts.attempts,
      maxRateLimitWaitS: opts.maxRateLimitWaitS
    }
  )
  // Never paste half a dictation: a cut-off answer makes the caller fall back to the transcript.
  if (data.choices?.[0]?.finish_reason === 'length') throw new ApiError('输出被截断', 'server', ep.name)
  const out = String(data.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '')
  return (tag ? out.replace(new RegExp(`</?${tag}>`, 'g'), '') : out).trim()
}

export interface ChatTarget {
  endpoint: Endpoint
  model: string
}

// Try each target in order. With a fallback waiting, the first try gets a
// short budget and no retry: a fast second provider beats a slow first one.
export async function chatWithFallback(
  targets: ChatTarget[],
  system: string,
  text: string,
  opts: { longText?: boolean; wrapTag?: string; maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<{ text: string; target: ChatTarget; errors: ApiError[] }> {
  const errors: ApiError[] = []
  for (const [i, target] of targets.entries()) {
    const hasNext = i < targets.length - 1
    try {
      const out = await chat(target.endpoint, target.model, system, text, {
        wrapTag: opts.wrapTag,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        ...(hasNext && !opts.longText
          ? { timeoutMs: opts.timeoutMs ?? 4000 + text.length * 20, attempts: 1 }
          : { timeoutMs: opts.timeoutMs, maxRateLimitWaitS: opts.longText ? 20 : 3 }) // a long dictation is worth waiting for the token bucket
      })
      return { text: out, target, errors }
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      errors.push(err)
    }
  }
  throw errors.at(-1) ?? new ApiError('没有可用的模型服务', 'auth')
}

// null: the service has no model list (some gateways skip /models); the user types the name.
export async function listModels(ep: Endpoint): Promise<string[] | null> {
  try {
    const data = await apiRequest(ep, '/models', { method: 'GET' }, { timeoutMs: 10_000 })
    return (data.data ?? []).map((m: { id: string }) => m.id).sort()
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return null
    throw err
  }
}
