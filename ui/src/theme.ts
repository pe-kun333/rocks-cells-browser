// 見た目のテーマを決めて <html> に付ける（計画書 docs/plan-themes.md §2・§5 の小さい 1〜5・14）
// 最初の一瞬は public/theme-boot.js が同じ決め方で付けている。ここは読み込んだときに付け直し（知らない id を直す）、
// 開いている間は storage（ほかの面・ほかの窓）と Windows の明暗の変化を受けて付け直す。C++ の relay は使わない
import { findTheme, type ThemeKind } from './themes';

export interface ThemeRef {
  id: string;
  kind: ThemeKind;
}

export interface ThemePref {
  version: 1;
  mode: 'auto' | 'fixed'; // 自動（Windows の明暗に合わせる）・いつも同じテーマ
  light: ThemeRef; // 自動で明るいとき
  dark: ThemeRef; // 自動で暗いとき
  fixed: ThemeRef; // いつも同じテーマのとき
  pages: 'theme' | 'os'; // いつも同じテーマのとき、ページ（タブ）の明暗もテーマに合わせるか（T4）
}

export const THEME_KEY = 'honeycomb.theme';

const LIGHT: ThemeRef = { id: 'mitsurou', kind: 'light' };
const DARK: ThemeRef = { id: 'sumi', kind: 'dark' };

export const DEFAULT_THEME_PREF: ThemePref = { version: 1, mode: 'auto', light: LIGHT, dark: DARK, fixed: LIGHT, pages: 'theme' };

// 保存した形を読む。知らない id はその欄の既定に、明暗は一覧のものにする
export function parseThemePref(raw: unknown): ThemePref {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_THEME_PREF;
  const v = raw as Record<string, unknown>;
  return {
    version: 1,
    mode: v.mode === 'fixed' ? 'fixed' : 'auto',
    light: parseRef(v.light, LIGHT),
    dark: parseRef(v.dark, DARK),
    fixed: parseRef(v.fixed, LIGHT),
    pages: v.pages === 'os' ? 'os' : 'theme',
  };
}

function parseRef(raw: unknown, fallback: ThemeRef): ThemeRef {
  const info = typeof raw === 'object' && raw !== null ? findTheme((raw as Record<string, unknown>).id) : undefined;
  return info ? { id: info.id, kind: info.kind } : fallback;
}

// 付けるテーマ（theme-boot.js にも同じ決め方の写しがある）
export function resolveTheme(pref: ThemePref, osDark: boolean): ThemeRef {
  if (pref.mode === 'fixed') return pref.fixed;
  return osDark ? pref.dark : pref.light;
}

export function loadThemePref(): ThemePref {
  try {
    return parseThemePref(JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null'));
  } catch {
    return DEFAULT_THEME_PREF; // 読めなければ自動の既定
  }
}

const CHANGED = 'honeycomb-theme-pref';

// 保存して、この面にもすぐ付ける（ほかの面には storage で届く）
export function saveThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, JSON.stringify(pref));
  } catch {
    // 保存できない環境でも、この面には付ける
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function currentTheme(): ThemeRef {
  const root = document.documentElement;
  const kind = root.dataset.kind;
  return { id: root.dataset.theme ?? LIGHT.id, kind: kind === 'dark' || kind === 'hc' ? kind : 'light' };
}

// 付けたあと、毎回知らせる（左は窓の枠の色を C++ へ送る。同じなら送らない）
export const THEME_APPLIED = 'honeycomb-theme-applied';

function applyTheme(t: ThemeRef) {
  const root = document.documentElement;
  if (root.dataset.theme !== t.id) root.dataset.theme = t.id;
  if (root.dataset.kind !== t.kind) root.dataset.kind = t.kind;
  window.dispatchEvent(new Event(THEME_APPLIED));
}

// ---------- 窓の枠（C++ の setTheme。計画書 §5 の小さい 15〜21） ----------

export interface WindowThemeSlot {
  id: string;
  kind: ThemeKind;
  bg: string; // 窓の地と、面を作るときの地（#rrggbb）
  tbBg: string; // 題名バー
  tbText: string; // 題名の字
  border: string; // 窓の枠の線
}

// テーマの色を #rrggbb で読む。見本の印 [data-theme-swatch] を付けた見えない要素に語を当て、算出した色を読む
// （getPropertyValue('--bg') は書いた文字のまま返すので使わない）。CSS がまだ無いなどで読めなければ null
function slotColors(ref: ThemeRef): WindowThemeSlot | null {
  const probe = document.createElement('span');
  probe.dataset.themeSwatch = ref.id;
  probe.style.cssText =
    'position:fixed;left:-99px;top:0;width:0;height:0;border:0 solid;background-color:var(--bg);color:var(--tb-text);border-top-color:var(--tb-bg);border-bottom-color:var(--border)';
  document.body.append(probe);
  const cs = getComputedStyle(probe);
  const colors = [cs.backgroundColor, cs.borderTopColor, cs.color, cs.borderBottomColor].map(toHex);
  probe.remove();
  const [bg, tbBg, tbText, border] = colors;
  if (!bg || !tbBg || !tbText || !border) return null;
  return { id: ref.id, kind: ref.kind, bg, tbBg, tbText, border };
}

// 'rgb(r, g, b)' を '#rrggbb' に。透明（語が無い）なら null
function toHex(color: string): string | null {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(color);
  if (!m || (m[4] !== undefined && Number(m[4]) < 1)) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

// 今のテーマから、C++ へ送る setTheme の中身を作る。色が読めなければ null（あとで送り直す）
export function windowThemeMessage() {
  const pref = loadThemePref();
  const fixed = pref.mode === 'fixed';
  const light = slotColors(fixed ? pref.fixed : pref.light);
  const dark = slotColors(fixed ? pref.fixed : pref.dark);
  if (!light || !dark) return null;
  const current: 'light' | 'dark' = !fixed && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; // resolveTheme と同じ
  return { type: 'setTheme' as const, mode: pref.mode, pages: pref.pages, current, light, dark };
}

// dev だけ：URL の ?theme=<id> で上書きする。?theme=check は決め打ちの色の直し残しを浮かせる検査用テーマ（theme-check.css）
function devOverride(): ThemeRef | null {
  if (!import.meta.env.DEV) return null;
  const id = new URLSearchParams(location.search).get('theme');
  if (id === 'check') {
    void import('./theme-check.css');
    return { id, kind: 'dark' };
  }
  const info = findTheme(id);
  return info ? { id: info.id, kind: info.kind } : null;
}

export function startTheme() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const override = devOverride();
  const update = () => applyTheme(override ?? resolveTheme(loadThemePref(), media.matches));
  update();
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key === THEME_KEY) update();
  });
  window.addEventListener(CHANGED, update);
  media.addEventListener('change', update);
}
