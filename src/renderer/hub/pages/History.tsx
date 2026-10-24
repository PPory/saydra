// 历史记录: dictations grouped by day, copy / retry / download audio / delete, retention.
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { HistoryItem, HistoryRetention, HistoryTab } from '../../../shared/hub'
import { Button, Confirm, Icon, IconButton, Menu, Tabs, useToast } from '../ui'

const PAGE = 50
const RETENTION: { value: HistoryRetention; label: string }[] = [
  { value: '24h', label: '24 小时' },
  { value: '1w', label: '1 周' },
  { value: '1m', label: '1 个月' },
  { value: '1y', label: '1 年' },
  { value: 'forever', label: '永远' },
  { value: 'never', label: '从不' }
]
const RANK: Record<HistoryRetention, number> = { never: 0, '24h': 1, '1w': 2, '1m': 3, '1y': 4, forever: 5 }

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return '今天'
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  return d.getFullYear() === today.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

function Row({ item, onChanged }: { item: HistoryItem; onChanged: () => void }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const failed = item.status === 'error'

  const copy = async () => {
    await navigator.clipboard.writeText(item.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const retry = async () => {
    setRetrying(true)
    const err = await window.rea.historyRetry(item.id)
    setRetrying(false)
    toast(err ?? '已重新转录', err ? 'err' : 'ok')
    onChanged()
  }
  const download = async () => {
    const res = await window.rea.historySaveAudio(item.id)
    if (res.message) toast(res.message, res.ok ? 'ok' : 'err')
  }
  const remove = async () => {
    await window.rea.historyDelete(item.id)
    setConfirmDelete(false)
    toast('转录已删除')
  }

  return (
    <div class={`history-row${failed ? ' failed' : ''}`}>
      <span class="history-time">{timeLabel(item.createdAt)}</span>
      <div class="history-text">
        {failed ? (
          <span class="history-error">
            <Icon name="error" />
            您的转录被中断。但 Saydra 仍然可以为您重试。
          </span>
        ) : (
          <p>{item.text}</p>
        )}
        {(item.mode !== 'dictate' || item.appName) && (
          <span class="history-meta">
            {item.mode === 'translate' && <em class="tag tag-translate">翻译</em>}
            {item.mode === 'ask' && <em class="tag tag-ask">改写选中文字</em>}
            {item.appName?.replace(/\.(exe|app)$/i, '')}
          </span>
        )}
      </div>
      <div class={`history-actions${retrying ? ' busy' : ''}`}>
        {!failed && item.askResult === 'answer' && (
          <Button size="sm" variant="outline" onClick={() => void window.rea.historyAnswer(item.id)}>
            查看答案
          </Button>
        )}
        {failed ? (
          <Button size="sm" variant="primary" loading={retrying} onClick={retry}>
            重试
          </Button>
        ) : (
          <IconButton icon={copied ? 'check' : 'copy'} label={copied ? '已复制' : '复制转录'} onClick={copy} />
        )}
        <Menu
          trigger={(toggle, open) => (
            <IconButton class={open ? 'active' : ''} icon="more" label="更多" onClick={toggle} />
          )}
          items={[
            { label: '重试', icon: 'retry', disabled: !item.hasAudio || retrying, onClick: retry },
            { label: '下载音频', icon: 'download', disabled: !item.hasAudio, onClick: download },
            { label: '删除转录', icon: 'delete', danger: true, onClick: () => setConfirmDelete(true) }
          ]}
        />
      </div>
      <Confirm
        open={confirmDelete}
        title="删除此转录？"
        description="此转录将被永久删除，无法恢复。"
        confirmText="删除"
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  )
}

export function History({ version }: { version: number }) {
  const toast = useToast()
  const [tab, setTab] = useState<HistoryTab>('all')
  const [items, setItems] = useState<HistoryItem[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [retention, setRetention] = useState<HistoryRetention>('forever')
  const [pendingRetention, setPendingRetention] = useState<HistoryRetention | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const loading = useRef(false)

  const load = useCallback(
    async (reset: boolean) => {
      if (loading.current) return
      loading.current = true
      const offset = reset ? 0 : items.length
      // On refresh keep what is already shown, so the list doesn't jump.
      const limit = reset ? Math.max(PAGE, items.length) : PAGE
      const page = await window.rea.historyList(tab, offset, limit)
      setItems((prev) => (reset ? page : [...prev, ...page]))
      setHasMore(page.length === limit)
      setLoaded(true)
      loading.current = false
    },
    [tab, items.length]
  )

  useEffect(() => {
    setItems([])
    setLoaded(false)
  }, [tab])
  useEffect(() => void load(true), [tab, version])
  useEffect(() => void window.rea.getSettings().then((s) => setRetention(s.historyRetention)), [version])

  const applyRetention = async (value: HistoryRetention) => {
    await window.rea.saveSettings({ historyRetention: value })
    setRetention(value)
    setPendingRetention(null)
  }
  const chooseRetention = (value: HistoryRetention) => {
    if (value === retention) return
    // Shortening deletes old records: ask first.
    if (RANK[value] < RANK[retention]) setPendingRetention(value)
    else void applyRetention(value)
  }
  const deleteAll = async () => {
    await window.rea.historyDeleteAll()
    setConfirmAll(false)
    toast('所有记录已删除')
  }

  const onScroll = (e: Event) => {
    const el = e.currentTarget as HTMLElement
    if (hasMore && el.scrollTop + el.clientHeight > el.scrollHeight - 200) void load(false)
  }

  // Group consecutive items by day.
  const groups: { label: string; items: HistoryItem[] }[] = []
  for (const it of items) {
    const label = dayLabel(it.createdAt)
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(it)
    else groups.push({ label, items: [it] })
  }
  const retentionLabel = RETENTION.find((r) => r.value === retention)?.label
  const pendingLabel = RETENTION.find((r) => r.value === pendingRetention)?.label

  return (
    <div class="page list-page">
      <div class="page-head">
        <h1 class="page-title">历史记录</h1>
        <div class="page-actions">
          <Menu
            trigger={(toggle) => (
              <Button variant="outline" onClick={toggle}>
                保存历史：{retentionLabel}
                <Icon name="dropdown" />
              </Button>
            )}
            items={RETENTION.map((r) => ({
              label: `${r.value === retention ? '✓ ' : '　 '}${r.label}`,
              onClick: () => chooseRetention(r.value)
            }))}
          />
          <Menu
            trigger={(toggle, open) => <IconButton class={open ? 'active' : ''} icon="more" label="更多" onClick={toggle} />}
            items={[{ label: '删除所有', icon: 'delete', danger: true, onClick: () => setConfirmAll(true) }]}
          />
        </div>
      </div>

      <div class="privacy-note">
        <Icon name="lock" />
        <div>
          <b>您的数据保持私密</b>
          <span>您的语音口述仅存储在您的设备上，无法从其他地方访问。音频保留 30 天，文字按「保存历史」的设置保留。</span>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: '全部' },
          { value: 'dictate', label: '听写' },
          { value: 'ask', label: '改写选中文字' }
        ]}
      />

      <div class="list-scroll" onScroll={onScroll}>
        {retention === 'never' ? (
          <div class="empty">
            <b>从不保存历史</b>
            <span>您可以在顶部更改持续时间以开始保存口述历史。</span>
          </div>
        ) : loaded && !items.length ? (
          <div class="empty">
            <b>尚无口述</b>
            <span>一旦您在不同应用中进行口述，您的所有口述历史将出现在这里。</span>
          </div>
        ) : (
          groups.map((g) => (
            <section class="history-group">
              <h3>{g.label}</h3>
              <div class="history-box">
                {g.items.map((it) => (
                  <Row key={it.id} item={it} onChanged={() => void load(true)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <Confirm
        open={confirmAll}
        title="删除所有历史记录？"
        description="您所有的本地历史记录将被永久删除，无法恢复。"
        confirmText="删除所有"
        onConfirm={deleteAll}
        onClose={() => setConfirmAll(false)}
      />
      <Confirm
        open={pendingRetention !== null}
        title={pendingRetention === 'never' ? '从不保存历史？' : '删除旧历史记录？'}
        description={
          pendingRetention === 'never' ? (
            '您所有的本地历史记录将被永久删除，无法恢复。'
          ) : (
            <>
              您所有的本地历史记录<b> 早于 {pendingLabel} </b>将被永久删除，无法恢复。
            </>
          )
        }
        confirmText={pendingRetention === 'never' ? '确认' : '删除'}
        onConfirm={() => pendingRetention && void applyRetention(pendingRetention)}
        onClose={() => setPendingRetention(null)}
      />
    </div>
  )
}
