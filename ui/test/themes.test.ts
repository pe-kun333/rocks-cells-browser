// テーマの色の検査：要る語がそろっているか、文字と地の組の比、相棒 6 人の見分けやすさ（計画書 docs/plan-themes.md §4・§5 の小さい 13）
import { describe, expect, it } from 'vitest';
import { MARK_COLOR_KEY, MARK_COLORS, type MarkColor } from '../src/likes';
import { LINK_KINDS } from '../src/memo-card-links';
import { SHEET_PALETTE } from '../src/sheets';
import { TAG_PALETTE } from '../src/tags';
import { THEMES } from '../src/themes';
import { apca, bandColor, deltaE, flatten, oklchHue, type Vision, wcag } from './color';
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

// テーマの塊を読む（蜜蝋は style.css の :root と同じ塊と、あとから足した語の themes.css の :root, :root[data-theme='mitsurou'] の塊〈MK7〉。ほかは themes.css）。
//   どちらのファイルも、選択子の並びに :root[data-theme='<id>'] がちょうど入っている塊を読む（後に書いたものが勝つ）。部品の塊と合わせて、var() を解く
const LOADED = THEMES.map((t) => {
  const own = Object.assign({}, ...SHEETS.map((rules) => tokensOf(rules, `:root[data-theme='${t.id}']`))) as Record<string, string>;
  return { id: t.id, kind: t.kind, own, tokens: resolveTokens({ ...partTokens(t.kind), ...own }) };
});

// 色の印の淡い地の語（MK7。likes.ts の MARK_COLOR_KEY から。grok-cards.css の data-mark-color の規則が --card-mark-fill に入れる）。
//   語が無いと地の変数が無効になり、黙って今の色（--surface）になるので、どのテーマにも要る語に入れる
const MARK_TOKENS = MARK_COLORS.map((c) => `mark-${MARK_COLOR_KEY[c]}-soft`);

// どのテーマにもなければならない語
const REQUIRED = [
  'bg', 'surface', 'cell', 'text', 'muted', 'border', 'hover', 'grid', 'cell-border',
  'accent', 'accent-soft', 'accent-text', 'accent-ink', 'accent-line', 'memo', 'memo-border', 'bot', 'bot-soft', 'bot-ink', 'app', 'app-soft',
  'danger', 'on-danger', 'warn', 'ok', 'heart', 'shadow', 'shadow-pop', 'scrim', 'tb-bg', 'tb-text',
  'evo-gold', 'evo-robe-top', 'evo-robe-bottom', 'moon-lit', 'moon-dark',
  'data-lmin', 'data-lmax', 'data-ink-lmin', 'data-ink-lmax', 'on-data',
  ...['ai', 'ai2', 'ai3', 'ai4', 'ai5', 'ai6'].flatMap((a) => [a, `${a}-border`, `${a}-soft`, `on-${a}`]),
  ...MARK_TOKENS,
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

// 不透明でなければならない地（MK6。grok-cards.css）：--bg は選んだ ♥ の四角の、選びの輪の下の地の帯。--surface（六角の顔）と --accent-soft（足した光り）は、六角の ♥ の縁の内側の半分を隠す。
//   色の印の淡い地（MK7）も顔の地になるので同じ
const OPAQUE = ['bg', 'surface', 'accent-soft', ...MARK_TOKENS];
const isOpaqueHex = (v: string | undefined) => /^#[0-9a-f]{6}$/i.test(v ?? '');

// 色の印の淡い地の決まり（MK7。計画 docs/plan-comment-board-marks.md §4.7。値は台本で決めた）：
//   面（--surface）と淡い金（--accent-soft。足した光り・タグの札の地）から OKLab で 0.04（×100 で 4）以上、
//   本文・補足・金の文字（--text・--muted・--accent-ink）と 4.5:1 以上、3 色どうし 4 以上（ふつうの見え方）、
//   選びの輪（--accent-line。六角では顔の内側に描くので、色の地の上に乗る）と 3:1 以上（ui の下限。MK7 の見直し）、
//   色合いは ♥（--heart）と線の 5 色（同じ〈灰〉は除く）から 20° 以上離れた、13 のテーマに共通の空き（research/04 §3.2 の ±20° の空き）の中。
//   台本は docs/wip/2026-11-13/comment-board-marks-plan/mk7-colors/（選びの輪の比は台本では見ていない。この試験だけ）
const MARK_HUES: Record<MarkColor, [number, number]> = { 水: [196, 228], 若草: [127, 137], 赤紫: [321, 327] };
const MARK_HUE_GAP = 20;
const LINE_COLORS = LINK_KINDS.filter((k) => k.kind !== 'same').map((k) => ({ name: k.name, color: k.color }));
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

function markFillProblems(tokens: Record<string, string>): string[] {
  const bad: string[] = [];
  const fills = MARK_COLORS.map((c) => ({ name: c, token: `mark-${MARK_COLOR_KEY[c]}-soft` }));
  for (const { name, token } of fills) {
    const fill = tokens[token];
    if (!isOpaqueHex(fill)) {
      bad.push(`${name}：--${token} が #rrggbb でない（${fill}）`);
      continue;
    }
    for (const ground of ['surface', 'accent-soft']) {
      const d = deltaE(fill, tokens[ground]);
      if (d < 4) bad.push(`${name}：--${ground} との差 ${d.toFixed(1)}`);
    }
    for (const ink of ['text', 'muted', 'accent-ink']) {
      const r = wcag(tokens[ink], fill);
      if (r < 4.5) bad.push(`${name}：--${ink} との比 ${r.toFixed(2)}`);
    }
    const ring = wcag(tokens['accent-line'], fill);
    if (ring < 3) bad.push(`${name}：--accent-line（選びの輪）との比 ${ring.toFixed(2)}`);
    const h = oklchHue(fill);
    const [lo, hi] = MARK_HUES[name];
    if (h < lo || h > hi) bad.push(`${name}：色合い ${h.toFixed(1)}° が ${lo}〜${hi}° の外`);
    for (const { name: other, color } of [{ name: '♥', color: tokens.heart }, ...LINE_COLORS]) {
      const g = hueGap(h, oklchHue(color));
      if (g < MARK_HUE_GAP) bad.push(`${name}：${other} と色合いが ${g.toFixed(1)}° しか離れていない`);
    }
  }
  for (let i = 0; i < fills.length; i++)
    for (let j = i + 1; j < fills.length; j++) {
      const a = tokens[fills[i].token];
      const b = tokens[fills[j].token];
      if (!isOpaqueHex(a) || !isOpaqueHex(b)) continue;
      const d = deltaE(a, b);
      if (d < 4) bad.push(`${fills[i].name} と ${fills[j].name} の差 ${d.toFixed(1)}`);
    }
  return bad;
}

describe.each(LOADED)('テーマ $id', ({ own, tokens }) => {
  it('テーマの塊に、要る語がそろっている', () => {
    expect(REQUIRED.filter((k) => !(k in own))).toEqual([]);
  });

  it('面の地と顔の地は不透明（--bg・--surface・--accent-soft が #rrggbb。♥ の縁の地の帯と、縁の内側の半分を隠す顔。MK6）', () => {
    expect(OPAQUE.filter((k) => !isOpaqueHex(tokens[k]))).toEqual([]);
  });

  it('色の印の淡い地（MK7）：面・淡い金から 4 以上、本文・補足・金の文字と 4.5:1 以上、選びの輪と 3:1 以上、3 色どうし 4 以上、色合いは ♥ と線から離れた空きの中', () => {
    expect(markFillProblems(tokens)).toEqual([]);
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

// 検査のテーマ（dev だけ。THEMES に無いので別に読む）も、地は不透明（MK6）。色の印の淡い地も同じ決まり（MK7）
describe('検査のテーマ（theme-check.css）', () => {
  const check = tokensOf(parseCss(readSrc('theme-check.css')), ":root[data-theme='check']");
  it('面の地と顔の地は不透明（--bg・--surface・--accent-soft・色の印の地が #rrggbb）', () => {
    expect(OPAQUE.filter((k) => !isOpaqueHex(check[k]))).toEqual([]);
  });
  it('色の印の淡い地（MK7）：13 のテーマと同じ決まり', () => {
    expect(MARK_TOKENS.filter((k) => !(k in check))).toEqual([]);
    expect(markFillProblems(check)).toEqual([]);
  });
});

// 蜜蝋の、あとから足した語（MK7）：style.css は触らないので themes.css の :root, :root[data-theme='mitsurou'] の塊に置く
describe('蜜蝋の、あとから足した語（themes.css）', () => {
  const sheet = parseCss(readSrc('themes.css'));
  it('素の :root にもある（<html> に data-theme がまだ無い最初の描きでも効く）。蜜蝋と見本の印の塊と同じ値', () => {
    const bare = tokensOf(sheet, ':root');
    const mitsurou = tokensOf(sheet, ":root[data-theme='mitsurou']");
    const swatch = tokensOf(sheet, "[data-theme-swatch='mitsurou']");
    for (const k of MARK_TOKENS) {
      expect(isOpaqueHex(bare[k]), k).toBe(true);
      expect(mitsurou[k], k).toBe(bare[k]);
      expect(swatch[k], k).toBe(bare[k]);
    }
  });
  it('蜜蝋の読み（LOADED）は、この塊の語も読む', () => {
    const own = LOADED.find((t) => t.id === 'mitsurou')?.own ?? {};
    expect(MARK_TOKENS.filter((k) => !(k in own))).toEqual([]);
    expect(own.surface).toBeDefined(); // style.css の塊も読んでいる
  });
  it('ほかのテーマの塊（:root[data-theme=…]）は、詳しさで素の :root に勝つ（素の :root を含む塊は、この一つだけ）', () => {
    const bareRules = sheet.filter((r) => r.selector.split(',').some((s) => s.trim() === ':root'));
    expect(bareRules).toHaveLength(1);
    expect(bareRules[0].selector.split(',').map((s) => s.trim())).toEqual([':root', ":root[data-theme='mitsurou']", "[data-theme-swatch='mitsurou']"]);
  });
});
