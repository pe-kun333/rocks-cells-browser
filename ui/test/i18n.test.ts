// 英語版 E0：言語の決め方・t()・辞書・未訳を数える道具
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { detectLang, fill, isLangPref, lang, resolveLang, setLangForTest, t, translate, translateText } from '../src/i18n';
import { badTranslations, checkDictionary, htmlTexts, scanSource } from '../src/i18n-scan';
import en from '../src/locales/en.json';

afterEach(() => setLangForTest('ja'));

describe('言語の決め方（設定 ＞ Windows の言語）', () => {
  it('Windows の言語：ja で始まれば日本語、ほかは英語、分からなければ日本語', () => {
    expect(detectLang(['ja-JP', 'en-US'])).toBe('ja');
    expect(detectLang(['ja'])).toBe('ja');
    expect(detectLang(['en-US', 'ja-JP'])).toBe('en');
    expect(detectLang(['fr-FR'])).toBe('en');
    expect(detectLang([])).toBe('ja');
    expect(detectLang(undefined)).toBe('ja');
    expect(detectLang(['jav'])).toBe('en');
  });
  it('設定が auto でなければ、設定が勝つ', () => {
    expect(resolveLang('auto', ['en-US'])).toBe('en');
    expect(resolveLang('ja', ['en-US'])).toBe('ja');
    expect(resolveLang('en', ['ja-JP'])).toBe('en');
  });
  it('保存の値は auto・ja・en だけ', () => {
    expect(isLangPref('en')).toBe(true);
    expect(isLangPref('fr')).toBe(false);
    expect(isLangPref(null)).toBe(false);
  });
  it('画面の外（試験）では日本語', () => {
    expect(lang()).toBe('ja');
  });
});

describe('t()：日本語の文が鍵', () => {
  it('日本語のときは、そのまま', () => {
    expect(t('見た目')).toBe('見た目');
  });
  it('英語のときは辞書の訳。辞書に無い文は日本語のまま（壊れない）', () => {
    setLangForTest('en');
    expect(t('見た目')).toBe('Appearance');
    expect(t('辞書に無い文')).toBe('辞書に無い文');
  });
  it('{name} を差し込む。無い名前はそのまま残す', () => {
    expect(translate('今：{name}', 'en', { name: 'Dawn' })).toBe('Now: Dawn');
    expect(translate('今：{name}', 'ja', { name: '暁' })).toBe('今：暁');
    expect(fill('{a} と {b}', { a: 1 })).toBe('1 と {b}');
  });
  it('HTML の文字は前後の空白を残して訳す。辞書に無ければ null', () => {
    expect(translateText('\n  見た目  ', 'en')).toBe('\n  Appearance  ');
    expect(translateText('見た目', 'ja')).toBeNull();
    expect(translateText('   ', 'en')).toBeNull();
    expect(translateText('日本語', 'en')).toBeNull();
  });
});

describe('英語の辞書', () => {
  it('訳文は空でなく、日本語の字が残っていない', () => {
    expect(badTranslations(en)).toEqual([]);
  });
  it('{name} などの差し込みの名前が、鍵と訳文でそろっている', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const [k, v] of Object.entries(en)) expect(names(v), k).toBe(names(k));
  });
  it('見た目の小窓（theme-menu.ts）と index.html の文は、全部訳がある', () => {
    const menu = readFileSync(new URL('../src/theme-menu.ts', import.meta.url), 'utf8');
    const html = htmlTexts(readFileSync(new URL('../index.html', import.meta.url), 'utf8')).filter((s) => s !== '日本語');
    const r = checkDictionary([{ path: 'theme-menu.ts', text: menu }], html, en);
    expect(r.missing).toEqual([]);
    expect(html.filter((s) => !(s in en))).toEqual([]);
    expect(r.keys).toBeGreaterThan(10);
  });
});

describe('未訳を数える道具', () => {
  it('t() の鍵を集め、包んでいない日本語を数える。コメントは数えない', () => {
    const src = [
      "// コメントの '日本語' は数えない",
      "const a = t('見た目');",
      'const b = t("今：{name}", { name });',
      "const c = '包んでいない';",
      'const d = `まだ ${n} 件`;',
      "const e = 'abc';",
      '/* 複数行の',
      "   'コメント' */",
      "el.title = t('ページの明暗もテーマに合わせる'); // 後ろの 'コメント'",
    ].join('\n');
    const r = scanSource(src);
    expect(r.keys.sort()).toEqual(['ページの明暗もテーマに合わせる', '今：{name}', '見た目'].sort());
    expect(r.unwrapped).toBe(2);
  });
  it('辞書と比べて、未訳・使っていない文を出す', () => {
    const r = checkDictionary([{ path: 'a.ts', text: "t('一'); t('二');" }], ['三'], { 一: 'one', 三: 'three', 四: 'four' });
    expect(r.keys).toBe(2);
    expect(r.translated).toBe(1);
    expect(r.missing).toEqual(['二']);
    expect(r.unused).toEqual(['四']);
  });
  it('index.html の日本語の文（文字・title・aria-label・placeholder）を集め、コメントは除く', () => {
    const html = '<!-- 説明 --><button title="戻る" aria-label="戻る">←</button><input placeholder="検索" /><b>見た目</b><i>abc</i>';
    expect(htmlTexts(html).sort()).toEqual(['戻る', '検索', '見た目'].sort());
  });
});
