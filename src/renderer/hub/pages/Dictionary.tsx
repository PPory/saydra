// 词典: words recognition and refining should spell your way.
import { useEffect, useRef, useState } from 'preact/hooks'
import type { DictSource, DictWord } from '../../../shared/hub'
import { Button, Confirm, Icon, IconButton, Modal, Tabs, useToast } from '../ui'

type Category = 'all' | DictSource
const SEARCH_DEBOUNCE_MS = 300

// 「广布、广部」 or one per line.
const splitForms = (text: string): string[] =>
  text
    .split(/[\n,，、;；]+/)
    .map((s) => s.trim())
    .filter(Boolean)

const EMPTY: Record<Category, string> = {
  all: 'Saydra 会记住您独特的名称和词汇，识别和润色时按词典里的写法输出。',
  auto: 'Saydra 会自动学习您改过的名称和词汇，并将其添加到您的个人词典中。',
  manual: '您可以手动将独特的名称和词汇添加到您的个人词典中。'
}

function WordModal({
  open,
  word,
  onClose
}: {
  open: boolean
  word: DictWord | null // null = add
  onClose: () => void
}) {
  const toast = useToast()
  const [value, setValue] = useState('')
  const [heard, setHeard] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    setValue(word?.term ?? '')
    setHeard(word?.heardAs.join('、') ?? '')
    setError('')
    setTimeout(() => input.current?.focus(), 0)
  }, [open, word])

  const submit = async (e?: Event) => {
    e?.preventDefault()
    if (!value.trim()) return setError('请输入一个词')
    setSaving(true)
    const forms = splitForms(heard)
    const res = word ? await window.rea.dictUpdate(word.id, value, forms) : await window.rea.dictAdd(value, forms)
    setSaving(false)
    if (!res.ok) return setError(res.message)
    toast(res.message)
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={word ? '编辑词汇' : '添加到词典'}
      footer={
        <>
          {word && <Button onClick={onClose}>取消</Button>}
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {word ? '保存' : '添加词汇'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <input
          ref={input}
          class={`field${error ? ' invalid' : ''}`}
          value={value}
          maxLength={60}
          placeholder={word ? '编辑词汇' : '添加新词'}
          onKeyDown={(e) => e.key === 'Enter' && !e.isComposing && void submit(e)}
          onInput={(e) => {
            setValue(e.currentTarget.value)
            setError('')
          }}
        />
        {error && <p class="field-error">{error}</p>}
        <label class="field-label" for="dict-heard">
          常被识别成（可选）
        </label>
        <input
          id="dict-heard"
          class="field"
          value={heard}
          placeholder="例如：开花、开化"
          onInput={(e) => setHeard(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.isComposing && void submit(e)}
        />
        <p class="field-hint">识别结果里出现这些写法时，直接换成上面的词。多个用「、」分隔。</p>
      </form>
    </Modal>
  )
}

export function Dictionary({ version }: { version: number }) {
  const toast = useToast()
  const [category, setCategory] = useState<Category>('all')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [words, setWords] = useState<DictWord[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<DictWord | null | undefined>(undefined) // undefined = closed
  const [deleting, setDeleting] = useState<DictWord[] | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])
  useEffect(() => {
    void window.rea.dictList(debounced, category === 'all' ? null : category).then((list) => {
      setWords(list)
      setSelected((s) => new Set([...s].filter((id) => list.some((w) => w.id === id))))
    })
  }, [debounced, category, version])

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const all = words ?? []
  const allSelected = all.length > 0 && selected.size === all.length

  const importCsv = async () => {
    const res = await window.rea.dictImport()
    if (res.message) toast(res.message, res.ok ? 'ok' : 'err')
  }
  const confirmDelete = async () => {
    if (!deleting) return
    const n = await window.rea.dictDelete(deleting.map((w) => w.id))
    toast(deleting.length === 1 ? `'${deleting[0].term}' 已删除` : `已删除 ${n} 个词`)
    setSelected(new Set())
    setDeleting(null)
  }

  return (
    <div class="page list-page">
      <div class="page-head">
        <h1 class="page-title">词典</h1>
        <div class="page-actions">
          <Button variant="outline" onClick={importCsv} data-tip="使用一列的 CSV 文件，每行一个词。">
            <Icon name="upload" />
            导入 CSV
          </Button>
          <Button variant="primary" onClick={() => setEditing(null)}>
            <Icon name="add" />
            新词
          </Button>
        </div>
      </div>

      {selected.size > 0 ? (
        <div class="selection-bar">
          <label class="checkbox">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(all.map((w) => w.id)))} />
            全选
          </label>
          <span>已选择 {selected.size} 个词</span>
          <span class="spacer" />
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            清除选择
          </Button>
          <Button variant="danger" onClick={() => setDeleting(all.filter((w) => selected.has(w.id)))}>
            <Icon name="delete" />
            删除
          </Button>
        </div>
      ) : (
        <div class="dict-toolbar">
          <Tabs
            value={category}
            onChange={setCategory}
            tabs={[
              { value: 'all', label: '所有' },
              { value: 'auto', label: '自动添加' },
              { value: 'manual', label: '手动添加' }
            ]}
          />
          <label class="search">
            <Icon name="search" />
            <input value={query} placeholder="搜索" onInput={(e) => setQuery(e.currentTarget.value)} />
            {query && <IconButton icon="close" label="清除" size={14} onClick={() => setQuery('')} />}
          </label>
        </div>
      )}

      <div class="list-scroll">
        {words && !words.length ? (
          <div class="empty">
            <b>{debounced ? '未找到与您的搜索匹配的词。' : '还没有词汇'}</b>
            {!debounced && <span>{EMPTY[category]}</span>}
          </div>
        ) : (
          <div class="word-grid">
            {all.map((w) => (
              <div class={`word${selected.has(w.id) ? ' selected' : ''}${selected.size ? ' selecting' : ''}`} key={w.id}>
                <label class="word-check" aria-label={`选择 ${w.term}`}>
                  <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggle(w.id)} />
                </label>
                <span class="word-main">
                  <span class="word-term" title={w.term}>
                    {w.term}
                  </span>
                  {w.heardAs.length > 0 && (
                    <span class="word-heard" title={`常被识别成：${w.heardAs.join('、')}`}>
                      替换 {w.heardAs.join('、')}
                    </span>
                  )}
                </span>
                {w.source === 'auto' && (
                  <span class="word-auto" data-tip="由 Saydra 自动添加">
                    <Icon name="sparkle" size={14} />
                  </span>
                )}
                <span class="word-actions">
                  <IconButton icon="edit" label="编辑" size={14} onClick={() => setEditing(w)} />
                  <IconButton icon="delete" label="删除" size={14} onClick={() => setDeleting([w])} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <WordModal open={editing !== undefined} word={editing ?? null} onClose={() => setEditing(undefined)} />
      <Confirm
        open={deleting !== null}
        title={deleting?.length === 1 ? '删除词汇？' : `删除 ${deleting?.length ?? 0} 个词？`}
        description={deleting?.length === 1 ? `'${deleting[0].term}' 将被永久删除，无法恢复。` : '所选的词将被永久删除，无法恢复。'}
        confirmText="删除"
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}
