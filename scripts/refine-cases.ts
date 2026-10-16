// Refine regression cases, taken from real dictation failures. Shared by
// eval-refine (Groq) and bench-refine (any OpenAI-compatible provider).
import type { Scene } from '../src/shared/types'

export interface Case {
  raw: string
  scene?: Scene
  mustHave: string[] // substrings the output must keep
  mustNotHave?: string[]
}

export const CASES: Case[] = [
  { raw: '然后这是一个测试,看看做得怎么样。我也不知道说什么,随便说了。', mustHave: ['不知道说什么', '随便说'] },
  {
    raw: '这是一个测试。测试一下新做的这个语言输入法软件的效果。随便测试一下。',
    mustHave: ['语音输入法', '随便测试'],
    mustNotHave: ['语言输入法']
  },
  { raw: '我也不知道说什么,这是人随便说的。', mustHave: ['不知道说什么', '随便说'] },
  {
    raw: 'Hello,这是一个测试。看看这个新语言输入软件的效果怎么样。周四,周四晚上测试。',
    scene: 'chat',
    mustHave: ['Hello', '语音输入', '怎么样', '周四晚上'],
    mustNotHave: ['语言输入']
  },
  { raw: '嗯,那个,就是说我觉得这个方案啊还可以。', mustHave: ['我觉得这个方案', '还可以'], mustNotHave: ['嗯', '那个'] },
  { raw: '我们周三,不对,周四下午开会。', mustHave: ['周四下午开会'], mustNotHave: ['周三'] },
  { raw: '你能帮我查一下明天北京的天气吗?', scene: 'ai', mustHave: ['明天北京的天气'], mustNotHave: ['晴', '度'] },
  {
    raw: '需要准备三个东西,第一是季度报表,第二是预算方案,第三是新产品的演示。',
    scene: 'document',
    mustHave: ['1.', '季度报表', '预算方案', '新产品']
  },
  { raw: '这个功能我觉得还行吧,反正就是随便用用,不用太在意。', scene: 'chat', mustHave: ['还行', '随便用用', '不用太在意'] },
  // held out: not mirrored by the prompt's examples
  { raw: '我们下周去北京出差,顺便看一下客户,其实也没什么大事。', scene: 'chat', mustHave: ['顺便看一下客户', '没什么大事'] },
  { raw: '帮我把这个文档发给王总,嗯,他应该在等着呢。', mustHave: ['发给王总', '他应该在等着'], mustNotHave: ['嗯'] },
  { raw: '这个模型的推理速度很快,但是准确律不太高。', mustHave: ['准确率'], mustNotHave: ['准确律'] },
  { raw: '那个,我刚才说的不太对,应该是三个人,不是四个人。', mustHave: ['三个人'] }
]

export function checkCase(c: Case, out: string): { ok: boolean; missing: string[]; forbidden: string[] } {
  const missing = c.mustHave.filter((s) => !out.includes(s))
  const forbidden = (c.mustNotHave ?? []).filter((s) => out.includes(s))
  return { ok: !missing.length && !forbidden.length, missing, forbidden }
}
