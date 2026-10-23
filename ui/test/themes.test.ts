// テーマの色の検査：要る語がそろっているか、文字と地の組の比、相棒 6 人の見分けやすさ（計画書 docs/plan-themes.md §4・§5 の小さい 13）
import { describe, expect, it } from 'vitest';
import { LINK_KINDS } from '../src/memo-card-links';
import { SHEET_PALETTE } from '../src/sheets';
import { TAG_PALETTE } from '../src/tags';
import { THEMES } from '../src/themes';
import { apca, bandColor, deltaE, flatten, type Vision, wcag } from './color';
import { type CssRule, parseCss, readSrc, resolveTokens, tokensOf } from './theme-css';

const SHEETS = ['style.css', 'themes.css'].map((f) => parseCss(readSrc(f)));
const PARTS = ['haiku.css', 'grok-cards.css', 'bot-panel.css'].map((f) => parseCss(readSrc(f)));

// 部品の明暗ごとの塊（ハイク組・Grok Cards の殻・依頼の一覧・回答カード）：明るい側に、暗いテーマなら :root[data-kind='dark'] の側を重ねる
// 星空の回答カード（.bot-card.cosmic）は固定の色なので入れない
const PART_SELECTORS = [':root', '.bot-reqs', '.inbox-after', '.bot-msg.bot-card', '.grok-cards'];
const DARK = ":root[data-kind='dark']";

function partTokens(kind: string): Record<string, string> {
  const out: Record<string, string> = {};
  const take = (rules: CssRule[], dark: boolean) => {
    for (const rule of rules) {
      const sel = dark ? (rule.selector.startsWith(DARK) ? rule.selector.slice(DARK.length).trim() || ':root' : '') : rule.selector;
      if (!PART_SELECTORS.includes(sel)) continue;
      for (const d of rule.decls) if (d.prop.startsWith('--')) out[d.prop.slice(2)] = d.value;
    }
  };
  for (const rules of PARTS) take(rules, false);
  if (kind === 'dark') for (const rules of PARTS) take(rules, true);
  return out;
}

// テーマの塊を読む（蜜蝋は style.css の :root と同じ塊、ほかは themes.css）。部品の塊と合わせて、var() を解く
const LOADED = THEMES.map((t) => {
  const own = Object.assign({}, ...SHEETS.map((rules) => tokensOf(rules, `:root[data-theme='${t.id}']`))) as Record<string, string>;
  return { id: t.id, kind: t.kind, own, tokens: resolveTokens({ ...partTokens(t.kind), ...own }) };
});

// どのテーマにもなければならない語
const REQUIRED = [
  'bg', 'surface', 'cell', 'text', 'muted', 'border', 'hover', 'grid', 'cell-border',
  'accent', 'accent-soft', 'accent-text', 'accent-ink', 'accent-line', 'memo', 'memo-border', 'bot', 'bot-soft', 'bot-ink', 'app', 'app-soft',
  'danger', 'on-danger', 'warn', 'ok', 'heart', 'shadow', 'shadow-pop', 'scrim', 'tb-bg', 'tb-text',
  'evo-gold', 'evo-robe-top', 'evo-robe-bottom', 'moon-lit', 'moon-dark',
  'data-lmin', 'data-lmax', 'data-ink-lmin', 'data-ink-lmax', 'on-data',
  ...['ai', 'ai2', 'ai3', 'ai4', 'ai5', 'ai6'].flatMap((a) => [a, `${a}-border`, `${a}-soft`, `on-${a}`]),
];

// 組の種類ごとの下限（WCAG 2 の比）。body・label は文字、ui は印・枠、edge はセルの縁、divider は飾りの区切り、grid は蜂の巣の線（上限もある）
const KINDS = {
  body: { min: 4.5 },
  label: { min: 4.5 },
  ui: { min: 3 },
  edge: { min: 1.6 },
  divider: { min: 1.12 },
  grid: { min: 1.08, max: 1.6 },
} as const;

// [前景, 背景, 種類, 説明]（見本帳の組と同じ。どちらかの語が無いテーマでは飛ばす）
const PAIRS: [string, string, keyof typeof KINDS, string][] = [
  ['text', 'bg', 'body', '本文 / 地'],
  ['text', 'surface', 'body', '本文 / 面'],
  ['text', 'cell', 'body', 'セルの文字 / セル'],
  ['text', 'hover', 'body', '本文 / ホバー'],
  ['muted', 'bg', 'label', '補足 / 地'],
  ['muted', 'surface', 'label', '補足 / 面'],
  ['text', 'accent-soft', 'body', '本文 / 押したボタン'],
  ['accent-text', 'accent', 'label', 'ボタンの字 / 金'],
  ['text', 'memo', 'body', 'メモの字 / 紙'],
  ['danger', 'surface', 'label', '危険 / 面'],
  ['on-danger', 'danger', 'label', '赤い地の上の字'],
  ['warn', 'surface', 'label', '注意 / 面'],
  ['ok', 'surface', 'ui', '済み / 面'],
  ['heart', 'surface', 'ui', 'いいね / 面'],
  ['heart', 'bg', 'ui', 'いいね / 地'],
  ['tb-text', 'tb-bg', 'body', '題名バーの字'],
  ...['ai', 'ai2', 'ai3', 'ai4', 'ai5', 'ai6'].map(
    (a): [string, string, keyof typeof KINDS, string] => [`on-${a}`, a, 'label', `相棒の地の上の字 / --${a}`],
  ),
  ['app', 'app-soft', 'label', 'アプリ / アプリの地'],
  ['text', 'ai-soft', 'body', '本文 / Claude の吹き出し'],
  ['text', 'ai3-soft', 'body', '本文 / フェイブルの吹き出し'],
  ['accent-line', 'bg', 'ui', '金の枠 / 地'],
  ['accent-line', 'accent-soft', 'ui', '表示中のセルの枠 / 淡い金'],
  ['accent-ink', 'surface', 'label', '金の文字 / 面'],
  ['accent-ink', 'bg', 'label', '金の文字 / 地'],
  ['cell-border', 'bg', 'edge', 'セルの縁 / 地'],
  ['grid', 'bg', 'grid', '蜂の巣の線 / 地'],
  ['border', 'surface', 'divider', '区切り / 面'],
  ['island-ink', 'bg', 'label', '島の名前 / 地'],
  ['ai-border', 'bg', 'ui', 'Claude の縁 / 地'],
  ['ai2-border', 'bg', 'ui', 'ミツの縁 / 地'],
  ['ai3-border', 'bg', 'ui', 'フェイブルの縁 / 地'],
  ['bot', 'bg', 'ui', 'ボット / 地'],
  ['memo-border', 'bg', 'edge', 'メモの縁 / 地'],
  ['evo-gold', 'evo-robe-top', 'ui', '金 / 夜空'],
  // 部品の明暗ごとの塊（そのテーマの明暗の側）
  ...['tsukushi', 'hotaru', 'momiji', 'yuki', 'kaeru', 'tombo'].map(
    (h): [string, string, keyof typeof KINDS, string] => [`hk-${h}-ink`, `hk-${h}`, 'label', `ハイク組の字 / ${h}`],
  ),
  ['shell-badge-ink', 'shell-badge', 'label', '殻の札の字 / 札'],
  ['shell-focus', 'bg', 'ui', '殻のフォーカスの輪 / 地'],
  ['req-work', 'surface', 'label', '依頼の調査中 / 面'],
  ['req-work', 'req-work-soft', 'label', '依頼の調査中のチップ'],
  ['req-ok', 'surface', 'label', '依頼の回答あり / 面'],
  ['req-ok', 'req-ok-soft', 'label', '依頼の回答ありのチップ'],
  ['card-warn', 'surface', 'label', '回答カードの注意 / 面'],
];

// まだ無い語（T5 で足す）。この語の組は飛ばす
const LATER = new Set(['island-ink']);

const CHARACTERS = ['ai', 'ai2', 'ai3', 'ai4', 'ai5', 'ai6'];

// 保存するデータの色（タグ・島・順路の 12 色、シートの 12 色とメイン、関連の線の 6 色）
const DATA_COLORS = [...TAG_PALETTE, ...SHEET_PALETTE, '#d9891a', ...LINK_KINDS.map((k) => k.color)];
const VISIONS: Vision[] = ['normal', 'protan', 'deutan', 'tritan'];

describe.each(LOADED)('テーマ $id', ({ own, tokens }) => {
  it('テーマの塊に、要る語がそろっている', () => {
    expect(REQUIRED.filter((k) => !(k in own))).toEqual([]);
  });

  it('文字と地・印と地の組が、下限の比を下回らない', () => {
    const bad: string[] = [];
    for (const [fg, bg, kind, label] of PAIRS) {
      if (!(fg in tokens) || !(bg in tokens)) {
        if (!LATER.has(fg)) bad.push(`${label}：--${fg} か --${bg} が無い`);
        continue;
      }
      const ratio = wcag(tokens[fg], flatten(tokens[bg], tokens.surface)); // 半透明の地は面に重ねる
      const k: { min: number; max?: number } = KINDS[kind];
      if (ratio < k.min || (k.max !== undefined && ratio > k.max)) bad.push(`${label}（--${fg} / --${bg}）= ${ratio.toFixed(2)}`);
      apca(tokens[fg], tokens[bg]); // 目安。落とさない
    }
    expect(bad).toEqual([]);
  });

  it('相棒 6 人の色が、4 つの見え方のどれでも色差 5.5 以上', () => {
    const bad: string[] = [];
    for (const vision of VISIONS)
      for (let i = 0; i < CHARACTERS.length; i++)
        for (let j = i + 1; j < CHARACTERS.length; j++) {
          const d = deltaE(tokens[CHARACTERS[i]], tokens[CHARACTERS[j]], vision);
          if (d < 5.5) bad.push(`${vision} --${CHARACTERS[i]} と --${CHARACTERS[j]} = ${d.toFixed(1)}`);
        }
    expect(bad).toEqual([]);
  });

  // データの色（data-colors.css）：保存した色を帯に収めると、印は地・面・セルに 3:1、字と字を載せる塗りは 4.5:1、塗りの上の字は 4.5:1
  it('データの色を帯に収めると、印・字・塗りの上の字が読める', () => {
    const bad: string[] = [];
    const n = (k: string) => Number(tokens[k]);
    const grounds = ['bg', 'surface', 'cell'];
    for (const color of DATA_COLORS)
      for (const mode of ['clip', 'gamut'] as const) {
        const mark = bandColor(color, n('data-lmin'), n('data-lmax'), mode);
        const ink = bandColor(color, n('data-ink-lmin'), n('data-ink-lmax'), mode);
        for (const g of grounds) {
          if (wcag(mark, tokens[g]) < 3) bad.push(`印 ${color}→${mark} / --${g} = ${wcag(mark, tokens[g]).toFixed(2)}（${mode}）`);
          if (wcag(ink, tokens[g]) < 4.5) bad.push(`字 ${color}→${ink} / --${g} = ${wcag(ink, tokens[g]).toFixed(2)}（${mode}）`);
        }
        if (wcag(tokens['on-data'], ink) < 4.5) bad.push(`塗りの上の字 / ${color}→${ink} = ${wcag(tokens['on-data'], ink).toFixed(2)}（${mode}）`);
      }
    expect(bad).toEqual([]);
  });
});
