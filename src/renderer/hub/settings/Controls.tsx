// Settings building blocks: section header, row, shortcut recorder, microphone picker.
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ShortcutTarget } from '../../../shared/hub'
import { LANGUAGES, languageName, MAX_TRANSLATE_LANGUAGES } from '../../../shared/languages'
import { DEFAULT_BINDINGS, type Shortcut } from '../../../shared/keys'
import { Button, Icon, IconButton, KeyCaps, Modal, type IconName } from '../ui'

export function Section({ icon, title, children }: { icon: IconName; title: string; children: ComponentChildren }) {
  return (
    <section class="set-section">
      <header class="set-section-head">
        <Icon name={icon} />
        {title}
      </header>
      <div>{children}</div>
    </section>
  )
}

export function Row({
  title,
  description,
  children,
  top,
  stacked
}: {
  title: string
  description?: ComponentChildren
  children?: ComponentChildren
  top?: boolean
  stacked?: boolean // control below the text, full width
}) {
  return (
    <div class={`set-row${top ? ' top' : ''}${stacked ? ' stacked' : ''}`}>
      <div class="set-row-text">
        <span class="set-row-title">{title}</span>
        {description && <span class="set-row-desc">{description}</span>}
      </div>
      {children && <div class="set-row-control">{children}</div>}
    </div>
  )
}

// Click, then press the keys: main records them from the key hook (the page
// itself never sees Right Alt). Esc cancels.
export function ShortcutInput({
  target,
  value,
  canDisable,
  onChange
}: {
  target: ShortcutTarget
  value: Shortcut
  canDisable: boolean
  onChange: (keys: Shortcut) => void
}) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => void window.rea.cancelCapture(), [])

  const record = async () => {
    if (recording) {
      setRecording(false)
      return void window.rea.cancelCapture()
    }
    setError('')
    setRecording(true)
    const res = await window.rea.captureShortcut(target)
    setRecording(false)
    if (!res) return
    if (!res.ok) return setError(res.error)
    onChange(res.keys)
  }
  const isDefault = value.join() === DEFAULT_BINDINGS[target].join()

  return (
    <div class="shortcut-input">
      <div class="shortcut-input-row">
        <button type="button" class={`shortcut-box${recording ? ' recording' : ''}`} onClick={record}>
          {recording ? (
            <span class="shortcut-placeholder">按下键盘按键…（Esc 取消）</span>
          ) : (
            <>
              <KeyCaps keys={value} />
              <span class="shortcut-edit">{value.length ? '修改' : '设置'}</span>
            </>
          )}
        </button>
        <span class="slot">
          {!isDefault && <IconButton icon="retry" label="重置快捷键" onClick={() => onChange(DEFAULT_BINDINGS[target])} />}
        </span>
        <span class="slot">
          {canDisable && value.length > 0 && <IconButton icon="close" label="禁用快捷键" onClick={() => onChange([])} />}
        </span>
      </div>
      {error && <p class="field-error">{error}</p>}
    </div>
  )
}

// 翻译目标: up to three target languages, added from a searchable list.
export function TranslationLanguages({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) {
  const [adding, setAdding] = useState(false)
  const full = value.length >= MAX_TRANSLATE_LANGUAGES
  return (
    <div class="lang-picker">
      {value.map((code) => (
        <span class="lang-chip" key={code}>
          {languageName(code)}
          <IconButton icon="close" label="移除" onClick={() => onChange(value.filter((c) => c !== code))} />
        </span>
      ))}
      <span data-tip={full ? '最多支持 3 种目标语言。删除一个以添加另一个。' : undefined}>
        <Button variant="outline" size="sm" disabled={full} onClick={() => setAdding(true)}>
          <Icon name="add" />
          {value.length ? '添加另一种语言' : '添加语言'}
        </Button>
      </span>
      <LanguageModal
        open={adding}
        exclude={value}
        onClose={() => setAdding(false)}
        onPick={(code) => {
          setAdding(false)
          onChange([...value, code])
        }}
      />
    </div>
  )
}

function LanguageModal({
  open,
  exclude,
  onClose,
  onPick
}: {
  open: boolean
  exclude: string[]
  onClose: () => void
  onPick: (code: string) => void
}) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setQuery('')
    setTimeout(() => input.current?.focus(), 0)
  }, [open])
  const q = query.trim().toLowerCase()
  const options = LANGUAGES.filter(
    (l) => !exclude.includes(l.code) && (!q || l.name.includes(q) || l.english.toLowerCase().includes(q))
  )
  return (
    <Modal open={open} onClose={onClose} title="添加语言" width={420}>
      <p class="modal-desc">在翻译模式中最多选择3种目标语言进行听写。</p>
      <label class="search lang-search">
        <Icon name="search" />
        <input ref={input} value={query} placeholder="搜索语言" onInput={(e) => setQuery(e.currentTarget.value)} />
      </label>
      <div class="lang-options">
        {options.length ? (
          options.map((l) => (
            <button type="button" class="lang-option" key={l.code} onClick={() => onPick(l.code)}>
              {l.name}
              <small>{l.english}</small>
            </button>
          ))
        ) : (
          <p class="lang-empty">没有选项</p>
        )}
      </div>
    </Modal>
  )
}

interface Mic {
  deviceId: string
  label: string
}

// 麦克风 modal: pick a device and watch its live level.
export function MicModal({ open, current, onClose, onSave }: { open: boolean; current: string; onClose: () => void; onSave: (id: string) => void }) {
  const [mics, setMics] = useState<Mic[] | null>(null)
  const [choice, setChoice] = useState(current)
  const [level, setLevel] = useState(0)
  const stream = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!open) return
    setChoice(current)
    void (async () => {
      // Labels are only filled in after microphone permission.
      const s = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null)
      s?.getTracks().forEach((t) => t.stop())
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'
      )
      setMics(list.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `麦克风 ${i + 1}` })))
    })()
  }, [open, current])

  // Live level of the highlighted microphone.
  useEffect(() => {
    if (!open) return
    let raf = 0
    let ctx: AudioContext | null = null
    let cancelled = false
    void (async () => {
      const s = await navigator.mediaDevices
        .getUserMedia({ audio: choice ? { deviceId: { exact: choice } } : true })
        .catch(() => null)
      if (!s || cancelled) return s?.getTracks().forEach((t) => t.stop())
      stream.current = s
      ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      ctx.createMediaStreamSource(s).connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      const tick = () => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        setLevel((l) => Math.max(Math.min(1, Math.sqrt(sum / buf.length) * 6), l * 0.85))
        raf = requestAnimationFrame(tick)
      }
      tick()
    })()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = null
      void ctx?.close()
      setLevel(0)
    }
  }, [open, choice])

  const options: Mic[] = [{ deviceId: '', label: '自动检测' }, ...(mics ?? [])]
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="麦克风"
      width={480}
      footer={
        <Button variant="primary" onClick={() => onSave(choice)}>
          保存
        </Button>
      }
    >
      <p class="modal-desc">选择能捕捉到您声音的麦克风。如果指示条没有移动，请尝试其他麦克风。</p>
      {mics && !mics.length ? (
        <div class="empty small">
          <b>未检测到麦克风</b>
          <span>检查您的设备设置或连接麦克风。</span>
        </div>
      ) : (
        <div class="mic-list" role="radiogroup">
          {options.map((m) => (
            <button
              type="button"
              role="radio"
              aria-checked={m.deviceId === choice}
              class={`mic-option${m.deviceId === choice ? ' on' : ''}`}
              onClick={() => setChoice(m.deviceId)}
            >
              <Icon name="mic" />
              <span class="mic-label">
                {m.label}
                {!m.deviceId && <small>使用系统默认麦克风</small>}
              </span>
              {m.deviceId === choice && (
                <span class="mic-level" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, i) => (
                    <i class={level * 8 > i ? 'lit' : ''} />
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
