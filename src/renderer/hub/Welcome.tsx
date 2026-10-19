// First-run guide: pick a refine service, connect it, then dictate once for real.
// Recognition runs on this PC with no key, so the refine service is all that needs setting up.
// On macOS the permissions come first: without them no shortcut or paste works.
import { useState } from 'preact/hooks'
import { IS_MAC } from '../../shared/keys'
import type { RefineProvider } from '../../shared/types'
import { essentialsGranted, PermissionList, usePermissions } from './Permissions'
import { GROQ_KEYS_URL, KeyField, ModelPicker, TryRefine, useModelList, useSettingsState } from './settings/ModelService'
import { Button, KeyCaps, Modal } from './ui'

type Step = 'permissions' | 'choose' | 'connect' | 'try'
const STEPS: Step[] = IS_MAC ? ['permissions', 'choose', 'connect', 'try'] : ['choose', 'connect', 'try']

export function Welcome({ onClose }: { onClose: () => void }) {
  const [s, save] = useSettingsState()
  const [step, setStep] = useState<Step>(STEPS[0])
  const [choice, setChoice] = useState<RefineProvider>('groq')
  const [url, setUrl] = useState('')
  // Bumped after a key or model is saved, so 「试一下」 runs on its own.
  const [savedTick, setSavedTick] = useState(0)
  const [models, setModels] = useModelList(s?.customBaseUrl ?? '', Boolean(s?.hasCustomKey))
  const perms = usePermissions()
  if (!s) return null

  const ready = choice === 'groq' ? s.hasApiKey : Boolean(s.customBaseUrl && s.hasCustomKey && s.customModel)
  const pick = (p: RefineProvider) => {
    setChoice(p)
    setUrl(s.customBaseUrl)
    void save({ refineProvider: p })
    setStep('connect')
  }
  const saved = () => setSavedTick((t) => t + 1)

  const title = {
    permissions: '欢迎使用 Saydra',
    choose: IS_MAC ? '选一个 AI 服务' : '欢迎使用 Saydra',
    connect: choice === 'groq' ? '连接 Groq' : '连接你的 AI 服务',
    try: '试一试'
  }[step]
  const footer = (
    <div class="welcome-footer">
      <span class="welcome-dots" aria-hidden="true">
        {STEPS.map((k) => (
          <i class={k === step ? 'on' : ''} />
        ))}
      </span>
      {step === 'permissions' && (
        <>
          <Button onClick={onClose}>稍后设置</Button>
          <Button variant="primary" disabled={!essentialsGranted(perms)} onClick={() => setStep('choose')}>
            下一步
          </Button>
        </>
      )}
      {step === 'choose' &&
        (IS_MAC ? <Button onClick={() => setStep('permissions')}>上一步</Button> : <Button onClick={onClose}>稍后设置</Button>)}
      {step === 'connect' && (
        <>
          <Button onClick={() => setStep('choose')}>上一步</Button>
          <Button variant="primary" disabled={!ready} onClick={() => setStep('try')}>
            下一步
          </Button>
        </>
      )}
      {step === 'try' && (
        <>
          <Button onClick={() => setStep('connect')}>上一步</Button>
          <Button variant="primary" onClick={onClose}>
            开始使用
          </Button>
        </>
      )}
    </div>
  )

  return (
    <Modal open onClose={onClose} title={title} width={560} class="welcome" footer={footer}>
      {step === 'permissions' && (
        <>
          <p class="modal-desc">
            按住快捷键说话，松开后整理好的文字会自动出现在光标处。先在 macOS 里给 Saydra 开几项权限，开好的会自动打勾：
          </p>
          {perms && <PermissionList p={perms} />}
        </>
      )}

      {step === 'choose' && (
        <>
          <p class="modal-desc">
            在任何输入框里按住快捷键说话，松开后，整理好的文字会自动出现在光标处。识别在这台电脑上完成；把口语整理成文字需要一个 AI
            服务，选一个你方便用的：
          </p>
          <div class="welcome-choices">
            <button type="button" class="welcome-choice" onClick={() => pick('groq')}>
              <span class="wc-title">
                Groq <span class="wc-tag">免费</span>
              </span>
              <span class="wc-desc">速度最快，注册就有免费额度。国内需要开代理才能连上。</span>
            </button>
            <button type="button" class="welcome-choice" onClick={() => pick('custom')}>
              <span class="wc-title">其他 AI 服务</span>
              <span class="wc-desc">DeepSeek、通义千问、Kimi 等任何兼容 OpenAI 接口的服务，用你自己的 API key。</span>
            </button>
          </div>
        </>
      )}

      {step === 'connect' && choice === 'groq' && (
        <>
          <p class="modal-desc">在 Groq 官网用邮箱注册，创建一个 API key，复制后粘贴到下面。</p>
          <div>
            <Button variant="outline" onClick={() => void window.rea.openExternal(GROQ_KEYS_URL)}>
              去 Groq 免费申请 key
            </Button>
          </div>
          <label class="welcome-label">API key</label>
          <KeyField
            placeholder="gsk_…  粘贴你的 Groq key"
            source={s.apiKeySource}
            saved={s.hasApiKey}
            test={(k) => window.rea.testConnection(k)}
            onSaved={(k) => save({ apiKey: k, refineProvider: 'groq' }).then(saved)}
          />
          <TryRefine provider="groq" disabled={!s.hasApiKey} auto={savedTick} />
        </>
      )}

      {step === 'connect' && choice === 'custom' && (
        <>
          <p class="modal-desc">在服务商的文档里找到 OpenAI 兼容的接口地址（一般以 /v1 结尾），再创建一个 API key。</p>
          <label class="welcome-label">服务地址</label>
          <input
            class="field"
            type="url"
            spellcheck={false}
            value={url}
            placeholder="https://…/v1"
            onInput={(e) => setUrl(e.currentTarget.value)}
            onBlur={() => url !== s.customBaseUrl && save({ customBaseUrl: url })}
          />
          <label class="welcome-label">API key</label>
          <KeyField
            placeholder="粘贴你的 API key"
            source={s.customKeySource}
            saved={s.hasCustomKey}
            test={async (k) => {
              const res = await window.rea.testCustom(url, k)
              if (res.models) setModels(res.models)
              return res
            }}
            onSaved={(k) => save({ customApiKey: k, customBaseUrl: url, refineProvider: 'custom' })}
          />
          {s.hasCustomKey && (
            <>
              <label class="welcome-label">模型</label>
              <ModelPicker
                wide
                value={s.customModel}
                models={models}
                onChange={(m) => save({ customModel: m }).then(saved)}
              />
              <p class="welcome-hint">选一个对话模型即可。名字带 reasoner、thinking 的推理模型会明显变慢。</p>
            </>
          )}
          <TryRefine provider="custom" disabled={!ready} auto={savedTick} />
        </>
      )}

      {step === 'try' && (
        <>
          <p class="modal-desc welcome-keys">
            点一下下面的输入框，然后按住 <KeyCaps keys={s.shortcuts.dictate} /> 说一句话，松开后整理好的文字会出现在框里。
          </p>
          <textarea class="field welcome-try" placeholder="比如：嗯明天下午三点开会，记得带上周的数据" />
          <p class="welcome-hint">轻按一下进入免提，再按一下结束；Esc 取消。快捷键可以在设置里改。</p>
        </>
      )}
    </Modal>
  )
}
