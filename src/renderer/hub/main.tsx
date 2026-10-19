// Hub: the main window. Sidebar (首页 / 历史记录 / 词典, settings and help at
// the bottom), the page, and the settings dialog on top.
import '@fontsource/prompt/500.css'
import { render } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { HubChange, HubPage, HubRoute } from '../../shared/hub'
import { IS_MAC } from '../../shared/keys'
import { Dictionary } from './pages/Dictionary'
import { History } from './pages/History'
import { Home } from './pages/Home'
import { PermissionsModal } from './Permissions'
import { SettingsModal, type SettingsPage } from './settings/SettingsModal'
import { Welcome } from './Welcome'
import { Icon, Logo, ToastProvider, type IconName } from './ui'
import './tokens.css'
import './hub.css'

const NAV: { key: HubPage; label: string; icon: IconName }[] = [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'history', label: '历史记录', icon: 'history' },
  { key: 'dictionary', label: '词典', icon: 'book' }
]
const PAGE_KEY = 'hub.page'

// macOS keeps its traffic lights at the top of the sidebar (hub.css makes room).
if (IS_MAC) document.documentElement.classList.add('mac')

function readPage(): HubPage {
  try {
    const p = localStorage.getItem(PAGE_KEY) as HubPage | null
    return p && NAV.some((n) => n.key === p) ? p : 'home'
  } catch {
    return 'home'
  }
}

function App() {
  const [page, setPage] = useState<HubPage>(readPage)
  const [settings, setSettings] = useState<SettingsPage | null>(null)
  const [welcome, setWelcome] = useState(false)
  const [permissions, setPermissions] = useState(false)
  // Bumped when main reports a change, so pages refetch.
  const [versions, setVersions] = useState<Record<HubChange, number>>({ history: 0, dictionary: 0, settings: 0 })

  const go = useCallback((p: HubPage) => {
    setPage(p)
    try {
      localStorage.setItem(PAGE_KEY, p)
    } catch {
      /* per-viewer convenience only */
    }
  }, [])

  useEffect(() => {
    window.rea.onHubChanged((c) => setVersions((v) => ({ ...v, [c]: v[c] + 1 })))
    window.rea.onNavigate((route: HubRoute) => {
      if (route === 'welcome') {
        setSettings(null)
        setWelcome(true)
      } else if (route === 'permissions') {
        setPermissions(true)
      } else if (route === 'settings' || route === 'models' || route === 'about') {
        setWelcome(false)
        setSettings(route)
      } else {
        setWelcome(false)
        setSettings(null)
        go(route)
      }
    })
    // Stats and history also change while the window is hidden in the tray.
    const onFocus = () => setVersions((v) => ({ ...v, history: v.history + 1 }))
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [go])

  const closeSettings = useCallback(() => {
    setSettings(null)
    setVersions((v) => ({ ...v, settings: v.settings + 1 }))
  }, [])
  const closeWelcome = useCallback(() => {
    setWelcome(false)
    setVersions((v) => ({ ...v, settings: v.settings + 1 }))
  }, [])

  return (
    <div class="app">
      <div class="drag-strip" aria-hidden="true" />
      <aside class="sidebar">
        <div class="sidebar-panel">
          <Logo />
          <nav class="nav">
            {NAV.map((n) => (
              <button type="button" class={`nav-item${page === n.key ? ' on' : ''}`} onClick={() => go(n.key)}>
                <Icon name={n.icon} />
                <span>{n.label}</span>
              </button>
            ))}
          </nav>
          <div class="sidebar-bottom">
            <button type="button" class="nav-item" onClick={() => setSettings('settings')}>
              <Icon name="settings" />
              <span>设置</span>
            </button>
            <button type="button" class="nav-item" onClick={() => setSettings('about')}>
              <Icon name="help" />
              <span>关于</span>
            </button>
          </div>
        </div>
      </aside>
      <main class="content">
        {page === 'home' && <Home version={versions.history + versions.settings} />}
        {page === 'history' && <History version={versions.history + versions.settings} />}
        {page === 'dictionary' && <Dictionary version={versions.dictionary} />}
      </main>
      {settings && <SettingsModal page={settings} onPage={setSettings} onClose={closeSettings} />}
      {welcome && <Welcome onClose={closeWelcome} />}
      {permissions && !welcome && <PermissionsModal onClose={() => setPermissions(false)} />}
    </div>
  )
}

render(
  <ToastProvider>
    <App />
  </ToastProvider>,
  document.getElementById('root')!
)
