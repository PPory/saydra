// Small shared UI pieces for the hub: icons (Material, Apache 2.0), buttons,
// switch, segmented control, modal, menu, toast, key caps.
import type { ButtonHTMLAttributes, ComponentChildren } from 'preact'
import { createContext } from 'preact'
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks'
import { keyName, type Shortcut } from '../../shared/keys'

const PATHS = {
  home: 'M12 5.69l5 4.5V18h-2v-6H9v6H7v-7.81l5-4.5M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3z',
  history:
    'M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  book: 'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z',
  settings:
    'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  help: 'M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z',
  translate:
    'M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  more: 'M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  delete: 'M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z',
  retry:
    'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  search:
    'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  keyboard:
    'M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z',
  volume:
    'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  system:
    'M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z',
  sparkle:
    'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  folder: 'M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z',
  mic: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  error:
    'M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z',
  chevron: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  dropdown: 'M7 10l5 5 5-5z',
  lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z',
  model:
    'M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z'
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, class: cls }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg class={`icon ${cls ?? ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

export function Logo() {
  return (
    <div class="logo">
      <svg viewBox="0 0 26 26" width="22" height="22" aria-hidden="true">
        <rect x="5.2" y="10.1" width="2.4" height="5.8" rx="1.2" />
        <rect x="9" y="7.5" width="2.4" height="11" rx="1.2" />
        <rect x="12.8" y="4.9" width="2.4" height="16.2" rx="1.2" />
        <rect x="16.6" y="7.5" width="2.4" height="11" rx="1.2" />
        <rect x="20.4" y="10.1" width="2.4" height="5.8" rx="1.2" />
      </svg>
      <span>Saydra</span>
    </div>
  )
}

type BtnProps = Omit<ButtonHTMLAttributes, 'size' | 'type'> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'accent'
  size?: 'sm' | 'md'
  loading?: boolean
}

export function Button({ variant = 'secondary', size = 'md', loading, class: cls, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      class={`btn btn-${variant} btn-${size} ${cls ?? ''}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span class="spinner" />}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  label,
  size = 16,
  class: cls,
  ...rest
}: Omit<ButtonHTMLAttributes, 'size'> & { icon: IconName; label: string; size?: number }) {
  return (
    <button type="button" class={`icon-btn ${cls ?? ''}`} aria-label={label} data-tip={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      class={`switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div class="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          class={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange
}: {
  value: T
  tabs: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div class="tabs" role="tablist">
      {tabs.map((t) => (
        <button type="button" role="tab" aria-selected={t.value === value} class={t.value === value ? 'on' : ''} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// Key caps for a shortcut.
export function KeyCaps({ keys }: { keys: Shortcut }) {
  if (!keys.length) return <span class="keycap-none">未设置</span>
  return (
    <span class="keycaps">
      {keys.map((k) => (
        <kbd class="keycap">{keyName(k)}</kbd>
      ))}
    </span>
  )
}

export function Modal({
  open,
  onClose,
  title,
  width = 448,
  children,
  footer,
  class: cls
}: {
  open: boolean
  onClose: () => void
  title?: string
  width?: number
  children?: ComponentChildren
  footer?: ComponentChildren
  class?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`modal ${cls ?? ''}`} style={{ width: `${width}px` }} role="dialog" aria-modal="true" aria-label={title}>
        <IconButton class="modal-close" icon="close" label="关闭" onClick={onClose} />
        {title && <h2 class="modal-title">{title}</h2>}
        <div class="modal-body">{children}</div>
        {footer && <div class="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function Confirm({
  open,
  title,
  description,
  confirmText,
  danger = true,
  loading,
  onConfirm,
  onClose
}: {
  open: boolean
  title: string
  description: ComponentChildren
  confirmText: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmText}
          </Button>
        </>
      }
    >
      <p class="modal-desc">{description}</p>
    </Modal>
  )
}

// Dropdown menu anchored to its trigger.
export function Menu({
  trigger,
  items,
  align = 'right'
}: {
  trigger: (open: () => void, isOpen: boolean) => ComponentChildren
  items: { label: string; icon?: IconName; danger?: boolean; disabled?: boolean; onClick: () => void }[]
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div class="menu-anchor" ref={ref}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <div class={`menu menu-${align}`} role="menu">
          {items.map((it) => (
            <button
              type="button"
              role="menuitem"
              class={it.danger ? 'danger' : ''}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
            >
              {it.icon && <Icon name={it.icon} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Snackbar-style toasts at the bottom of the window.
type Toast = { id: number; text: string; tone: 'ok' | 'err' | 'info' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    if (!text) return
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div class="toasts" role="status">
        {toasts.map((t) => (
          <div class={`toast toast-${t.tone}`} key={t.id}>
            {t.tone !== 'info' && <Icon name={t.tone === 'ok' ? 'check' : 'error'} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// Numbers count up to their new value (250 ms ease-out).
export function useCountUp(target: number, duration = 250): number {
  const [value, setValue] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const start = performance.now()
    const begin = from.current
    let raf = 0
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / duration)
      const v = Math.round(begin + (target - begin) * (1 - Math.pow(1 - p, 3)))
      setValue(v)
      from.current = v
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

export const fmtNumber = (n: number) => n.toLocaleString('zh-CN')

// 3725 s -> [{1, 小时}, {2, 分钟}]
export function durationParts(seconds: number): { value: string; unit: string }[] {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return [{ value: fmtNumber(minutes), unit: '分钟' }]
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest && hours < 24
    ? [
        { value: fmtNumber(hours), unit: '小时' },
        { value: String(rest), unit: '分钟' }
      ]
    : [{ value: fmtNumber(hours), unit: '小时' }]
}
