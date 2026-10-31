// 英語の辞書に無い文を数える道具の中身（node の道具 scripts/i18n-check.ts と試験から使う。node の API は使わない）
//   ・t('…') の鍵：ソースの中の t('…') / t("…") / t(`…`)（${} の無いもの）を集める
//   ・包んでいない日本語：コメントでない行の、日本語を含む文字列（t( の中のものは除く）。進み具合の目安
const JP = /[\u3040-\u30ff\u4e00-\u9fff]/;
const T_CALL = /\b(?:t|tr)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const LITERAL = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

export interface ScanResult {
  keys: string[]; // t() の鍵（重ならない）
  unwrapped: number; // 包んでいない日本語の文字列の数
}

function unescapeJs(s: string): string {
  return s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
}

export function scanSource(src: string): ScanResult {
  const keys = new Set<string>();
  let unwrapped = 0;
  let inBlock = false;
  for (const line of src.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
      inBlock = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    const code = line.replace(/\s\/\/.*$/, '');
    const wrapped = new Set<number>();
    for (const m of code.matchAll(T_CALL)) {
      if (m[1] === '`' && m[2].includes('${')) continue;
      keys.add(unescapeJs(m[2]));
      wrapped.add((m.index ?? 0) + m[0].indexOf(m[1]));
    }
    for (const m of code.matchAll(LITERAL)) {
      if (!JP.test(m[2])) continue;
      if (wrapped.has(m.index ?? -1)) continue;
      unwrapped++;
    }
  }
  return { keys: [...keys], unwrapped };
}

export interface CheckResult {
  keys: number;
  translated: number;
  missing: string[];
  unwrapped: number;
  unused: string[]; // 辞書にあるが、t() でも index.html でも使っていない
}

// sources：ソース（パスと中身）。extraKeys：index.html など t() 以外で訳す文。dict：英語の辞書
export function checkDictionary(sources: readonly { path: string; text: string }[], extraKeys: readonly string[], dict: Readonly<Record<string, string>>): CheckResult {
  const keys = new Set<string>();
  let unwrapped = 0;
  for (const s of sources) {
    const r = scanSource(s.text);
    for (const k of r.keys) keys.add(k);
    unwrapped += r.unwrapped;
  }
  const missing = [...keys].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k)).sort();
  const used = new Set([...keys, ...extraKeys]);
  const unused = Object.keys(dict).filter((k) => !used.has(k)).sort();
  return { keys: keys.size, translated: keys.size - missing.length, missing, unwrapped, unused };
}

// index.html の文字（文字の節と title・aria-label・placeholder）のうち日本語のもの
export function htmlTexts(html: string): string[] {
  const out = new Set<string>();
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of body.matchAll(/>([^<>]+)</g)) {
    const s = m[1].trim();
    if (s && JP.test(s)) out.add(s);
  }
  for (const m of body.matchAll(/\b(?:title|aria-label|placeholder)="([^"]*)"/g)) {
    const s = m[1].trim();
    if (s && JP.test(s)) out.add(s);
  }
  return [...out];
}

// 訳文の決まり：空でない・日本語の字が残っていない（固有の名前は「日本語」の 1 語だけ許す）
export function badTranslations(dict: Readonly<Record<string, string>>): string[] {
  return Object.entries(dict)
    .filter(([, v]) => !v.trim() || JP.test(v.replace('日本語', '')))
    .map(([k]) => k);
}
