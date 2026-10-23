// テーマの決め方（theme.ts）と、最初の一瞬の写し（public/theme-boot.js）が同じ答えを出すか
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_PREF, parseThemePref, resolveTheme, type ThemeRef } from '../src/theme';

const BOOT = readFileSync(new URL('../public/theme-boot.js', import.meta.url), 'utf8');

// theme-boot.js を、保存した文字と Windows の明暗だけを渡して動かし、<html> に付いた値を返す
function boot(stored: string | null, osDark: boolean, opts: { storageThrows?: boolean } = {}): ThemeRef {
  const attrs: Record<string, string> = {};
  const document = { documentElement: { setAttribute: (k: string, v: string) => void (attrs[k] = v) } };
  const localStorage = {
    getItem: () => {
      if (opts.storageThrows) throw new Error('blocked');
      return stored;
    },
  };
  const matchMedia = () => ({ matches: osDark });
  new Function('document', 'localStorage', 'matchMedia', BOOT)(document, localStorage, matchMedia);
  return { id: attrs['data-theme'], kind: attrs['data-kind'] as ThemeRef['kind'] };
}

const SUMI: ThemeRef = { id: 'sumi', kind: 'dark' };
const MITSUROU: ThemeRef = { id: 'mitsurou', kind: 'light' };

// 一覧にある id だけを使った保存の形（知らない id の読み替えは theme.ts だけがする）
const CASES: [string, string | null][] = [
  ['保存なし', null],
  ['壊れた文字', '{oops'],
  ['空の形', '{}'],
  ['数', '42'],
  ['自動・既定', JSON.stringify(DEFAULT_THEME_PREF)],
  ['自動・明るいときも炭', JSON.stringify({ ...DEFAULT_THEME_PREF, light: SUMI })],
  ['自動・暗いときも蜜蝋', JSON.stringify({ ...DEFAULT_THEME_PREF, dark: MITSUROU })],
  ['いつも炭', JSON.stringify({ ...DEFAULT_THEME_PREF, mode: 'fixed', fixed: SUMI })],
  ['いつも同じで、欄が無い', JSON.stringify({ mode: 'fixed' })],
  ['知らない mode', JSON.stringify({ ...DEFAULT_THEME_PREF, mode: 'night', light: SUMI })],
  ['欄の形が違う', JSON.stringify({ mode: 'auto', light: 'sumi', dark: { id: 3 } })],
];

describe('テーマの決め方', () => {
  it('既定は自動：Windows が明るければ蜜蝋、暗ければ炭', () => {
    expect(resolveTheme(DEFAULT_THEME_PREF, false)).toEqual(MITSUROU);
    expect(resolveTheme(DEFAULT_THEME_PREF, true)).toEqual(SUMI);
  });

  it('いつも同じテーマなら、Windows の明暗によらない', () => {
    const pref = parseThemePref({ mode: 'fixed', fixed: SUMI });
    expect(resolveTheme(pref, false)).toEqual(SUMI);
    expect(resolveTheme(pref, true)).toEqual(SUMI);
  });

  it('知らない id はその欄の既定に、明暗は一覧のものにする', () => {
    const pref = parseThemePref({ mode: 'auto', light: { id: 'nope', kind: 'dark' }, dark: { id: 'mitsurou', kind: 'dark' }, pages: 'x' });
    expect(pref.light).toEqual(MITSUROU);
    expect(pref.dark).toEqual(MITSUROU);
    expect(pref.pages).toBe('theme');
    expect(parseThemePref(null)).toEqual(DEFAULT_THEME_PREF);
  });

  it.each(CASES)('theme-boot.js も同じ答え：%s', (_, stored) => {
    for (const osDark of [false, true]) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(stored ?? 'null');
      } catch {
        parsed = null;
      }
      expect(boot(stored, osDark)).toEqual(resolveTheme(parseThemePref(parsed), osDark));
    }
  });

  it('theme-boot.js は localStorage が読めなくても、Windows の明暗で付ける', () => {
    expect(boot(null, true, { storageThrows: true })).toEqual(SUMI);
    expect(boot(null, false, { storageThrows: true })).toEqual(MITSUROU);
  });
});
