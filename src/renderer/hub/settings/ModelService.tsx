// Model service building blocks shared by 设置 → 模型服务 and the first-run guide:
// settings state, key field, model picker and the 「试一下」 check.
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  TRY_REFINE_SAMPLE,
  type KeySource,
  type PublicSettings,
  type RefineProvider,
  type SettingsInput,
  type TryRefineResult
} from '../../../shared/types'
import { Button, useToast } from '../ui'

export type Save = (input: SettingsInput, message?: string) => Promise<void>

export const GROQ_KEYS_URL = 'https://console.groq.com/keys'

// Settings as the page sees them, reloaded after every save.
export function useSettingsState(): [PublicSettings | null, Save] {
  const toast = useToast()
  const [s, setS] = useState<PublicSettings | null>(null)
  const reload = () => void window.rea.getSettings().then(setS)
  useEffect(reload, [])
  const save: Save = async (input, message) => {
    try {
      await window.rea.saveSettings(input)
      reload()
      if (message) toast(message)
    } catch (err) {
      toast(`保存失败：${(err as Error).message}`, 'err')
    }
  }
  return [s, save]
}

// The custom service's model names, fetched with the saved key whenever the
// address is known, so the picker is filled without pressing 「测试」 first.
export function useModelList(baseUrl: string, hasKey: boolean): [string[], (m: string[]) => void] {
  const [models, setModels] = useState<string[]>([])
  useEffect(() => {
    if (!baseUrl || !hasKey) return
    let live = true
    void window.rea.testCustom(baseUrl).then((r) => live && r.ok && r.models && setModels(r.models))
    return () => {
      live = false
    }
  }, [baseUrl, hasKey])
  return [models, setModels]
}

const sourceLabel = (src: KeySource) => (src === 'settings' ? '已保存' : src === 'env' ? '来自环境变量' : '未设置')

// Key field: verify with the service before saving, so a typo never breaks dictation.
export function KeyField({
  placeholder,
  source,
  saved,
  test,
  onSaved
}: {
  placeholder: string
  source: KeySource
  saved: boolean
  test: (key: string) => Promise<{ ok: boolean; message: string; models?: string[] }>
  onSaved: (key: string, models?: string[]) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    setStatus({ ok: true, message: '正在连接…' })
    const res = await test(value.trim())
    setStatus(res)
    if (res.ok && value.trim()) {
      await onSaved(value.trim(), res.models)
      setValue('')
      setStatus({ ok: true, message: `${res.message}，已保存` })
    }
    setBusy(false)
  }
  return (
    <div class="key-field">
      <div class="key-row">
        <input
          class="field"
          type="password"
          autocomplete="off"
          spellcheck={false}
          value={value}
          placeholder={saved ? '已保存，留空则保持不变' : placeholder}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && void run()}
        />
        <Button variant={value.trim() ? 'primary' : 'outline'} loading={busy} onClick={run}>
          {value.trim() ? '验证并保存' : '测试连接'}
        </Button>
      </div>
      <p class={`key-status ${status ? (status.ok ? 'ok' : 'err') : ''}`}>
        {status?.message ?? <span class={`badge${source !== 'none' ? ' on' : ''}`}>{sourceLabel(source)}</span>}
      </p>
    </div>
  )
}

// Type any model name, or pick one from the service's list (filtered as you type).
export function ModelPicker({
  value,
  models,
  onChange,
  wide
}: {
  value: string
  models: string[]
  onChange: (model: string) => void
  wide?: boolean
}) {
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  useEffect(() => setText(value), [value])

  const q = text.trim().toLowerCase()
  const list = q && q !== value.toLowerCase() ? models.filter((m) => m.toLowerCase().includes(q)) : models
  const commit = (raw: string) => {
    setOpen(false)
    const v = raw.trim()
    setText(v)
    if (v !== value) onChange(v)
  }

  return (
    <div class={`model-picker${wide ? ' wide' : ''}`}>
      <input
        class="field"
        spellcheck={false}
        value={text}
        placeholder={models.length ? '输入或选择模型' : '输入模型名，例如 deepseek-chat'}
        onFocus={() => setOpen(true)}
        onInput={(e) => {
          setText(e.currentTarget.value)
          setOpen(true)
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape' && open) {
            e.stopPropagation() // close the list, not the dialog
            setOpen(false)
          }
        }}
      />
      {open && list.length > 0 && (
        <div class="model-list" role="listbox">
          {list.slice(0, 300).map((m) => (
            <button
              type="button"
              role="option"
              aria-selected={m === value}
              class={m === value ? 'on' : ''}
              // mousedown, before the input's blur commits the typed text instead
              onMouseDown={(e) => {
                e.preventDefault()
                commit(m)
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 「试一下」: one real refine with this service, so the user sees it works and keeps their words.
export function TryRefine({ provider, disabled, auto }: { provider: RefineProvider; disabled?: boolean; auto?: unknown }) {
  const [res, setRes] = useState<TryRefineResult | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    setRes(null)
    try {
      setRes(await window.rea.tryRefine(provider))
    } finally {
      setBusy(false)
    }
  }
  // Run once per new truthy `auto` (e.g. right after a key or model is saved),
  // waiting until the reloaded settings enable the button.
  const lastAuto = useRef<unknown>(undefined)
  useEffect(() => {
    if (!auto || disabled || auto === lastAuto.current) return
    lastAuto.current = auto
    void run()
  }, [auto, disabled])

  return (
    <div class="try-refine">
      <Button variant="outline" loading={busy} disabled={disabled} onClick={run}>
        试一下
      </Button>
      {res && (
        <div class={`try-result ${res.ok ? 'ok' : 'err'}`}>
          {res.ok ? (
            <>
              <p class="try-line">
                <span>原话</span>
                {TRY_REFINE_SAMPLE}
              </p>
              <p class="try-line">
                <span>整理后</span>
                <b>{res.output}</b>
              </p>
              <p class="try-meta">{res.message}</p>
            </>
          ) : (
            <p>{res.message}</p>
          )}
        </div>
      )}
    </div>
  )
}
