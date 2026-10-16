// Target languages for translate mode: code, name shown in the UI, name given to the model.
export interface Language {
  code: string
  name: string
  english: string
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: '英语', english: 'English' },
  { code: 'en_us', name: '英语（美国）', english: 'American English' },
  { code: 'en_gb', name: '英语（英国）', english: 'British English' },
  { code: 'zh_cn', name: '简体中文（中国大陆）', english: 'Simplified Chinese (Mainland China)' },
  { code: 'zh_tw', name: '繁体中文（台湾）', english: 'Traditional Chinese (Taiwan)' },
  { code: 'zh_hk', name: '繁体中文（香港）', english: 'Traditional Chinese (Hong Kong)' },
  { code: 'ja', name: '日语', english: 'Japanese' },
  { code: 'ko', name: '韩语', english: 'Korean' },
  { code: 'fr', name: '法语', english: 'French' },
  { code: 'de', name: '德语', english: 'German' },
  { code: 'es', name: '西班牙语', english: 'Spanish' },
  { code: 'es_mx', name: '西班牙语（墨西哥）', english: 'Mexican Spanish' },
  { code: 'pt_br', name: '葡萄牙语（巴西）', english: 'Brazilian Portuguese' },
  { code: 'pt_pt', name: '葡萄牙语（葡萄牙）', english: 'European Portuguese' },
  { code: 'it', name: '意大利语', english: 'Italian' },
  { code: 'ru', name: '俄语', english: 'Russian' },
  { code: 'ar', name: '阿拉伯语', english: 'Arabic' },
  { code: 'hi', name: '印地语', english: 'Hindi' },
  { code: 'th', name: '泰语', english: 'Thai' },
  { code: 'vi', name: '越南语', english: 'Vietnamese' },
  { code: 'id', name: '印尼语', english: 'Indonesian' },
  { code: 'ms', name: '马来语', english: 'Malay' },
  { code: 'tl', name: '他加禄语', english: 'Tagalog' },
  { code: 'tr', name: '土耳其语', english: 'Turkish' },
  { code: 'pl', name: '波兰语', english: 'Polish' },
  { code: 'nl', name: '荷兰语', english: 'Dutch' },
  { code: 'sv', name: '瑞典语', english: 'Swedish' },
  { code: 'nb', name: '挪威语', english: 'Norwegian' },
  { code: 'da', name: '丹麦语', english: 'Danish' },
  { code: 'fi', name: '芬兰语', english: 'Finnish' },
  { code: 'uk', name: '乌克兰语', english: 'Ukrainian' },
  { code: 'cs', name: '捷克语', english: 'Czech' },
  { code: 'el', name: '希腊语', english: 'Greek' },
  { code: 'he', name: '希伯来语', english: 'Hebrew' },
  { code: 'hu', name: '匈牙利语', english: 'Hungarian' },
  { code: 'ro', name: '罗马尼亚语', english: 'Romanian' },
  { code: 'fa', name: '波斯语', english: 'Persian' },
  { code: 'ur', name: '乌尔都语', english: 'Urdu' },
  { code: 'bn', name: '孟加拉语', english: 'Bengali' },
  { code: 'ta', name: '泰米尔语', english: 'Tamil' },
  { code: 'sw', name: '斯瓦希里语', english: 'Swahili' }
]

export const MAX_TRANSLATE_LANGUAGES = 3

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]))
export const findLanguage = (code: string): Language | undefined => BY_CODE.get(code)
export const languageName = (code: string): string => BY_CODE.get(code)?.name ?? code
