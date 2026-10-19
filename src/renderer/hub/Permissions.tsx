// macOS permissions: one row each with its state and a button to the switch in
// System Settings. Polled every second, so a row ticks itself once it is turned on.
import { useEffect, useState } from 'preact/hooks'
import type { MacPermission, MacPermissions } from '../../shared/hub'
import { Button, Icon, Modal, type IconName } from './ui'

const POLL_MS = 1000
// The hook is installed within ~2 s of the permission; after this long it needs a restart.
const HOOK_GRACE_POLLS = 4

export function usePermissions(): MacPermissions | null {
  const [p, setP] = useState<MacPermissions | null>(null)
  useEffect(() => {
    let alive = true
    const read = () => void window.rea.permissions().then((v) => alive && setP(v))
    read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return p
}

// What dictation cannot work without. The 🌐 setting only stops the emoji picker popping up.
export const essentialsGranted = (p: MacPermissions | null): boolean => Boolean(p?.microphone && p.accessibility)

const ROWS: { kind: MacPermission; icon: IconName; title: string; desc: string; action: string }[] = [
  { kind: 'microphone', icon: 'mic', title: '麦克风', desc: '听你说话。', action: '允许' },
  {
    kind: 'accessibility',
    icon: 'keyboard',
    title: '辅助功能',
    desc: '响应快捷键，把文字粘贴到光标处。在列表里打开 Saydra 的开关。',
    action: '去开启'
  },
  {
    kind: 'fnKey',
    icon: 'system',
    title: '🌐 键',
    desc: '把「按下 🌐 键时」改为「不执行任何操作」，否则每次按 Fn 都会弹出表情面板。',
    action: '打开键盘设置'
  }
]

export function PermissionList({ p }: { p: MacPermissions }) {
  // Accessibility on but the hook still not running after a few seconds: macOS wants
  // Input Monitoring too, or a restart before the permission applies.
  const [waited, setWaited] = useState(0)
  useEffect(() => setWaited((n) => (p.accessibility && !p.hookActive ? n + 1 : 0)), [p])
  const stuck = waited >= HOOK_GRACE_POLLS

  return (
    <div class="perm-list">
      {ROWS.filter((r) => p[r.kind] !== null).map((r) => {
        const ok = p[r.kind] === true
        return (
          <div class={`perm-row${ok ? ' ok' : ''}`}>
            <Icon name={r.icon} size={20} class="perm-icon" />
            <div class="perm-text">
              <span class="perm-title">{r.title}</span>
              <span class="perm-desc">{r.desc}</span>
            </div>
            {ok ? (
              <span class="perm-done">
                <Icon name="check" /> 已开启
              </span>
            ) : (
              <Button size="sm" variant="primary" onClick={() => void window.rea.grantPermission(r.kind)}>
                {r.action}
              </Button>
            )}
          </div>
        )
      })}
      {stuck && (
        <div class="perm-stuck">
          <span>
            辅助功能已开启，但快捷键还没生效。
            {p.inputMonitoring ? '重新启动 Saydra 就好。' : '再开启「输入监控」里的 Saydra，然后重新启动。'}
          </span>
          <div class="perm-stuck-actions">
            {!p.inputMonitoring && (
              <Button size="sm" onClick={() => void window.rea.grantPermission('inputMonitoring')}>
                开启输入监控
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => void window.rea.relaunch()}>
              重新启动 Saydra
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// Opened when a permission went missing after setup (an update can reset them).
export function PermissionsModal({ onClose }: { onClose: () => void }) {
  const p = usePermissions()
  if (!p) return null
  return (
    <Modal
      open
      onClose={onClose}
      title="授权 Saydra"
      width={560}
      class="welcome"
      footer={
        <Button variant="primary" disabled={!essentialsGranted(p)} onClick={onClose}>
          完成
        </Button>
      }
    >
      <p class="modal-desc">macOS 需要你亲自打开这几项，Saydra 才能听到快捷键、把文字放进输入框。开好的会自动打勾。</p>
      <PermissionList p={p} />
    </Modal>
  )
}
