// Which services handle recognition and refine, built from the user's settings.
import { groqEndpoint, refineModelFor } from './groq'
import { apiRequest, type ChatTarget, type Endpoint } from './llm'
import { localAsrFailed } from './asr'
import { siliconflowEndpoint } from './siliconflow'
import {
  getApiKey,
  getAsrEngine,
  getCustomBaseUrl,
  getCustomKey,
  getCustomModel,
  getRefineModel,
  getRefineProvider,
  getSiliconflowKey
} from './settings'
import type { RefineProvider } from '../shared/types'

export function customEndpoint(baseUrl = getCustomBaseUrl(), apiKey = getCustomKey()): Endpoint | null {
  if (!baseUrl || !apiKey) return null
  let name = '自定义服务'
  try {
    name = new URL(baseUrl).hostname
  } catch {}
  return { name, baseUrl, apiKey }
}

// One configured service, or null while its key (or the custom model) is missing.
export function refineTarget(provider: RefineProvider, chars = 0): ChatTarget | null {
  if (provider === 'groq') {
    const key = getApiKey()
    return key ? { endpoint: groqEndpoint(key), model: refineModelFor(getRefineModel(), chars) } : null
  }
  const ep = customEndpoint()
  const model = getCustomModel()
  return ep && model ? { endpoint: ep, model } : null
}

// Preferred provider first, the other one as automatic fallback.
export function refineTargets(chars: number): ChatTarget[] {
  const ordered: RefineProvider[] = getRefineProvider() === 'custom' ? ['custom', 'groq'] : ['groq', 'custom']
  return ordered.map((p) => refineTarget(p, chars)).filter((t): t is ChatTarget => t !== null)
}

// Why dictation cannot start right now, phrased as the next step; null when ready.
export function setupProblem(): string | null {
  const engine = getAsrEngine()
  if (engine === 'groq' && !getApiKey()) return '还没填 Groq API key，已打开设置'
  if (engine === 'siliconflow' && !getSiliconflowKey()) return '还没填硅基流动 API key，已打开设置'
  if (engine === 'local' && localAsrFailed() && !getApiKey())
    return `本地识别模型加载失败（${localAsrFailed()!.message}），请在设置里改用 Groq`
  if (!refineTargets(0).length)
    return customEndpoint() && !getCustomModel()
      ? '自定义服务还没选模型，已打开设置'
      : '还没配置润色服务，先花一分钟设置一下'
  return null
}

// Open the TLS connection while the user is still talking: a cold first
// request to a gateway costs ~1 s that the dictation would otherwise wait for.
const warmedAt = new Map<string, number>()
export function warmUpConnections(): void {
  const endpoints = refineTargets(0).map((t) => t.endpoint)
  if (getAsrEngine() === 'groq' && getApiKey()) endpoints.push(groqEndpoint(getApiKey()))
  if (getAsrEngine() === 'siliconflow' && getSiliconflowKey()) endpoints.push(siliconflowEndpoint(getSiliconflowKey()))
  for (const ep of endpoints) {
    const last = warmedAt.get(ep.baseUrl) ?? 0
    if (Date.now() - last < 60_000) continue
    warmedAt.set(ep.baseUrl, Date.now())
    void apiRequest(ep, '/models', { method: 'GET' }, { timeoutMs: 5000, attempts: 1 }).catch(() => {})
  }
}
