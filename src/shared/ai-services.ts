// Well-known OpenAI-compatible services, so setting one up is: pick it, paste a key.
// Nothing is stored about the choice: the saved address says which one it is.

export interface AiService {
  id: string
  name: string // short, in messages and logs
  label: string // in the picker
  baseUrl: string
  keysUrl: string
  // Chat models to pick by themselves once the service lists its models, best first.
  // Model names change often, so these are matched against the live list; `fallback`
  // is used only when the service has no list to offer.
  prefer: (string | RegExp)[]
  fallback: string
}

export const AI_SERVICES: AiService[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    prefer: ['deepseek-flash', 'deepseek-chat'],
    fallback: 'deepseek-chat'
  },
  {
    id: 'qwen',
    name: '通义千问',
    label: '通义千问（阿里云百炼）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keysUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    prefer: ['qwen-flash', 'qwen-plus', 'qwen-turbo'],
    fallback: 'qwen-plus'
  },
  {
    id: 'kimi',
    name: 'Kimi',
    label: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    keysUrl: 'https://platform.moonshot.cn/console/api-keys',
    prefer: [/^kimi-k2\.\d+$/, 'moonshot-v1-8k'],
    fallback: 'moonshot-v1-8k'
  },
  {
    id: 'glm',
    name: '智谱',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keysUrl: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys',
    prefer: [/^glm-[\d.]+-flash$/, /^glm-[\d.]+-air$/],
    fallback: 'glm-4.7-flash'
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    keysUrl: 'https://cloud.siliconflow.cn/account/ak',
    prefer: [/^deepseek-ai\/DeepSeek-V[\d.]+-Flash$/, /^deepseek-ai\/DeepSeek-V[\d.]+$/],
    fallback: 'deepseek-ai/DeepSeek-V3'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keysUrl: 'https://platform.openai.com/api-keys',
    prefer: ['gpt-4.1-mini', 'gpt-4o-mini'],
    fallback: 'gpt-4.1-mini'
  }
]

export const OTHER_SERVICE = 'other'

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

// Which service an address belongs to; null for any other address (or none).
export function serviceOf(baseUrl: string): AiService | null {
  const host = hostOf(baseUrl)
  return (host && AI_SERVICES.find((s) => hostOf(s.baseUrl) === host)) || null
}

// The model to choose by itself: the best preferred one the service offers, the only
// one on offer, or the fallback when the service gives no list. '' when unsure.
export function pickModel(service: AiService | null, models: string[] | null): string {
  if (models?.length === 1) return models[0]
  if (!service) return ''
  if (!models?.length) return models ? service.fallback : ''
  for (const p of service.prefer) {
    if (typeof p === 'string') {
      if (models.includes(p)) return p
      continue
    }
    // The newest version: kimi-k2.10 over kimi-k2.6.
    const hit = models.filter((m) => p.test(m)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0]
    if (hit) return hit
  }
  return ''
}
