// 画面の言葉を切り替える（英語版 E0。計画書 docs/plan-i18n-en.md）
//   ・鍵は日本語の文そのもの（t('見た目')）。英語の辞書（locales/en.json）に無い文は、日本語のまま出す（壊れない）
//   ・言語の決め方：⚙（見た目の小窓）で選んだもの ＞ Windows の言語（navigator.languages の先頭が ja なら日本語、ほかは英語）
//   ・選んだ言語は localStorage honeycomb.lang に 'auto' | 'ja' | 'en'。切り替えは次に起動したときから（画面を作り直さない）
//   ・差し込み：t('今：{name}', { name }) の {name} を置き換える。テンプレート文字列を包んだものは {0}・{1}…
//   ・同じ名前の t がファイルの中にあるときは、import { t as tr } として tr('…') で使う（i18n-scan はどちらも数える）
import en from './locales/en.json';

export type Lang = 'ja' | 'en';
export type LangPref = 'auto' | Lang;

export const LANG_KEY = 'honeycomb.lang';
export const LANGS: readonly Lang[] = ['ja', 'en'];

const DICTS: Record<Lang, Readonly<Record<string, string>>> = { ja: {}, en };

export function isLangPref(v: unknown): v is LangPref {
  return v === 'auto' || v === 'ja' || v === 'en';
}

// Windows の言語（WebView2 は OS の表示言語を navigator.languages に渡す）。分からなければ日本語
export function detectLang(langs: readonly string[] | undefined): Lang {
  const first = (langs?.[0] ?? '').toLowerCase();
  if (first === '' || first === 'ja' || first.startsWith('ja-')) return 'ja';
  return 'en';
}

export function resolveLang(pref: LangPref, langs: readonly string[] | undefined): Lang {
  return pref === 'auto' ? detectLang(langs) : pref;
}

export function loadLangPref(): LangPref {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return isLangPref(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveLangPref(pref: LangPref) {
  try {
    if (pref === 'auto') localStorage.removeItem(LANG_KEY);
    else localStorage.setItem(LANG_KEY, pref);
  } catch {
    // 保存できなくても、今の画面はそのまま
  }
}

function osLangs(): readonly string[] | undefined {
  try {
    if (typeof navigator === 'undefined' || typeof document === 'undefined') return undefined; // 画面の外（試験など）は日本語
    return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : undefined;
  } catch {
    return undefined;
  }
}

// 起動したときに一度だけ決める（途中で変えると、もう作った画面と食い違うため）
let current: Lang = resolveLang(loadLangPref(), osLangs());

export function lang(): Lang {
  return current;
}

// 試験用：言語を決め直す
export function setLangForTest(l: Lang) {
  current = l;
}

export function fill(text: string, vars?: Readonly<Record<string, unknown>>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

export function translate(ja: string, l: Lang, vars?: Readonly<Record<string, unknown>>): string {
  const dict = DICTS[l];
  const s = Object.prototype.hasOwnProperty.call(dict, ja) ? dict[ja] : ja;
  return fill(s, vars);
}

// 画面の文字。鍵は日本語の文
export function t(ja: string, vars?: Readonly<Record<string, unknown>>): string {
  return translate(ja, current, vars);
}

// 前後の空白は残して、中身だけを訳す（HTML の文字の並びを崩さない）。辞書に無ければ null
export function translateText(text: string, l: Lang): string | null {
  const core = text.trim();
  if (!core) return null;
  const dict = DICTS[l];
  if (!Object.prototype.hasOwnProperty.call(dict, core)) return null;
  return text.replace(core, dict[core]);
}

const ATTRS = ['title', 'aria-label', 'placeholder'] as const;

// index.html のように最初からある文字（文字の節と title・aria-label・placeholder）を、辞書にあるものだけ訳す
export function translateDom(root: Element, l: Lang = current) {
  if (l === 'ja') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const next = translateText(n.nodeValue ?? '', l);
    if (next !== null) n.nodeValue = next;
  }
  for (const e of [root, ...root.querySelectorAll('*')]) {
    for (const a of ATTRS) {
      const v = e.getAttribute(a);
      if (v === null) continue;
      const next = translateText(v, l);
      if (next !== null) e.setAttribute(a, next);
    }
  }
}

// UI の入口で一度だけ呼ぶ：<html lang> を付け、最初からある文字を訳す
export function startI18n() {
  document.documentElement.lang = current;
  translateDom(document.body);
}
