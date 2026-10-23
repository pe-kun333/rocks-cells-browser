// 歯止め：決め打ちの色を増やさない（計画書 docs/plan-themes.md §5 の小さい 12）
// 数えないもの：テーマの塊（選択子に :root）と、明暗ごとの部品の塊の語（--hk-* など）の定義、
// わざと固定の色の塊（/* theme: fixed begin */ 〜 /* theme: fixed end */。TS は // でもよい）。
// 色を直したら、そのファイルの上限を下げる（上限より少なくなったら落ちるので、下げ忘れない）
import { describe, expect, it } from 'vitest';
import { blankComments, parseCss, readSrc, srcFiles } from './theme-css';

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const CSS_LITERAL = new RegExp(`${HEX.source}|\\b(?:rgba?|hsla?)\\(|\\b(?:white|black)\\b`, 'g');
const TS_LITERAL = new RegExp(`${HEX.source}|\\b(?:rgba?|hsla?)\\(`, 'g');

// 明暗ごとの部品の塊の語（定義に色を書いてよい）
const COMPONENT_TOKENS = ['--hk-', '--shell-', '--card-', '--req-'];

// 数えない TS（偽物の C++ の描画・撮影の注釈と描画）
const TS_SKIP = new Set(['bridge.ts', 'captures.ts', 'capture-draw.ts']);

// ファイルごとの上限（T5 で 0 になった。データの色は保存する値として固定の塊に入れ、描くときは data-colors.css で帯へ）
const LIMITS: Record<string, number> = {};

// 金（--accent）を字と輪に使う所（T2 で 0 にした。字は --accent-ink、輪と枠は --accent-line）
const ACCENT_LIMITS: Record<string, number> = {};

function fixedRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /(?:\/\*|\/\/)\s*theme: fixed (begin|end)/g;
  let begin = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[1] === 'begin') begin = m.index;
    else if (begin >= 0) {
      out.push([begin, m.index]);
      begin = -1;
    }
  }
  return out;
}

const inside = (ranges: [number, number][], at: number) => ranges.some(([a, b]) => at >= a && at < b);

function countCss(name: string): { literals: number; accent: number } {
  const text = readSrc(name);
  const fixed = fixedRanges(text);
  let literals = 0;
  let accent = 0;
  for (const rule of parseCss(text)) {
    const tokenBlock = rule.selector.includes(':root');
    for (const d of rule.decls) {
      if (inside(fixed, d.offset)) continue;
      if (d.prop.startsWith('--') && (tokenBlock || COMPONENT_TOKENS.some((p) => d.prop.startsWith(p)))) continue;
      literals += d.value.match(CSS_LITERAL)?.length ?? 0;
      if ((d.prop === 'color' || d.prop.startsWith('outline')) && /var\(--accent\)/.test(d.value)) accent++;
    }
  }
  return { literals, accent };
}

function countTs(path: string): number {
  const text = readSrc(path);
  const fixed = fixedRanges(text);
  const code = blankComments(text).replace(/(^|\s)\/\/.*$/gm, (c) => c.replace(/[^\n]/g, ' '));
  let n = 0;
  for (const m of code.matchAll(TS_LITERAL)) if (!inside(fixed, m.index)) n++;
  return n;
}

const files = srcFiles;

describe('決め打ちの色の歯止め', () => {
  it('CSS と TS の決め打ちの色が、ファイルごとの上限と同じ', () => {
    const actual: Record<string, number> = {};
    for (const f of files('.css')) {
      const n = countCss(f).literals;
      if (n > 0 || f in LIMITS) actual[f] = n;
    }
    for (const f of files('.ts')) {
      if (TS_SKIP.has(f.split('/').pop() ?? '')) continue;
      const n = countTs(f);
      if (n > 0 || f in LIMITS) actual[f] = n;
    }
    expect(actual).toEqual(LIMITS);
  });

  it('金（--accent）を字と輪に使う所が、ファイルごとの上限と同じ', () => {
    const actual: Record<string, number> = {};
    for (const f of files('.css')) {
      const n = countCss(f).accent;
      if (n > 0 || f in ACCENT_LIMITS) actual[f] = n;
    }
    expect(actual).toEqual(ACCENT_LIMITS);
  });
});
