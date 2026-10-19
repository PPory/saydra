// Dictionary auto-learn: finding the user's corrections in pasted text, and
// accepting only grounded words from the model.
// Usage: npm run test:learn
import { findEdits, groundTerms, heardForms, holdsPasted } from '../src/main/learn'

const cases: [string, boolean, unknown?][] = []
const check = (name: string, ok: boolean, detail?: unknown) => cases.push([name, ok, detail])

const pasted = '我叫新和，这周四和 cloud code 团队开会。'
const before = `前面已有的内容。${pasted}`

let e = findEdits(pasted, before, before.replace('新和', '辛禾'))
check('CJK name fix', e.length === 1 && e[0].removed === '新和' && e[0].added === '辛禾', e)
check('context shows both versions', e[0]?.contextBefore.includes('新和') && e[0]?.contextAfter.includes('辛禾'), e[0])

e = findEdits(pasted, before, before.replace('cloud code', 'Claude Code'))
check('Latin words fix', e.length === 1 && e[0].removed === 'cloud code' && e[0].added === 'Claude Code', e)

e = findEdits(pasted, before, before.replace('新和', '辛禾').replace('cloud code', 'Claude Code'))
check('two fixes, two edits', e.length === 2, e)

e = findEdits(pasted, before, before.replace('新和', '辛禾').replace('cloud code', 'Claude Code').replace('开会', '碰个头'))
check('three small edits in a short sentence all count', e.length === 3, e)

e = findEdits(pasted, before, before.replace('新', '辛'))
check('single character fix', e.length === 1 && e[0].added === '辛', e)

e = findEdits(pasted, before, `${before}另外补一句很长的话，跟拼写没有关系。`)
check('appended text is not an edit', e.length === 0, e)

// Editors read paragraphs back with their own line breaks.
const paras = '第一段讲新和的安排。\n\n第二段说 cloud code。'
const box = '第一段讲新和的安排。\r\n第二段说 cloud code。\u200B'
check('box with other line breaks holds the paste', holdsPasted(box, paras))
check('box without the paste', !holdsPasted('别的内容', paras) && !holdsPasted(box, '  '))
e = findEdits(paras, box, box.replace('新和', '辛禾'))
check('fix found across changed line breaks', e.length === 1 && e[0].added === '辛禾', e)

e = findEdits(pasted, before, before.replace('这周四和 cloud code 团队开会。', ''))
check('deletion is not an edit', e.length === 0, e)

e = findEdits(pasted, before, before.replace('，', '；'))
check('punctuation change is not an edit', e.length === 0, e)

e = findEdits(pasted, before, before.replace('前面已有的', '之前写好的'))
check('edits outside the pasted text are ignored', e.length === 0, e)

e = findEdits(pasted, before, before.replace('这周四和 cloud code 团队开会', '下个月我们再找时间和对方的产品团队一起认真地讨论这个问题吧'))
check('long rewrite is not a spelling fix', e.length === 0, e)

check('pasted text not found', findEdits('完全不同', before, before.replace('新和', '辛禾')).length === 0)
check('CRLF boxes still match', findEdits('第一行\n新和', 'x第一行\r\n新和', 'x第一行\r\n辛禾').length === 1)

const edits = findEdits(pasted, before, before.replace('新和', '辛禾').replace('cloud code', 'Claude Code'))
check('grounded words kept', groundTerms(['辛禾', 'Claude Code'], edits, []).join() === '辛禾,Claude Code', groundTerms(['辛禾', 'Claude Code'], edits, []))
check('invented word dropped', groundTerms(['辛禾Xenho'], edits, []).length === 0)
check('word that was already pasted dropped', groundTerms(['团队'], edits, []).length === 0)
check('known word dropped (any case)', groundTerms(['claude code'], edits, ['Claude Code']).length === 0)
check('sentence-like answer dropped', groundTerms(['辛禾，'], edits, []).length === 0)
check('non-strings ignored', groundTerms([42, null, '辛禾'], edits, []).join() === '辛禾')

// 常被识别成 from the fixes
const forms = heardForms(edits, ['辛禾', 'Claude Code'])
check('wrong forms of fixed words', JSON.stringify(forms) === JSON.stringify([{ term: '辛禾', form: '新和' }, { term: 'Claude Code', form: 'cloud code' }]), forms)
const one = findEdits('我们在开花新功能', 'x我们在开花新功能', 'x我们在开发新功能')
check('one-character CJK fix widened to the word', JSON.stringify(heardForms(one, ['开发'])) === JSON.stringify([{ term: '开发', form: '开花' }]), [one, heardForms(one, ['开发'])])
const de = findEdits('慢慢的走', 'x慢慢的走', 'x慢慢地走')
check('one-character form ignored', heardForms(de, ['地']).length === 0, heardForms(de, ['地']))
const caseOnly = findEdits('用 claude code 写', 'x用 claude code 写', 'x用 Claude Code 写')
check('case-only fix is not a form', heardForms(caseOnly, ['Claude Code']).length === 0, heardForms(caseOnly, ['Claude Code']))
check('term not in the fix', heardForms(edits, ['团队']).length === 0)

let failed = 0
for (const [name, ok, detail] of cases) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  -> ${JSON.stringify(detail)}`}`)
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed ? 1 : 0)
