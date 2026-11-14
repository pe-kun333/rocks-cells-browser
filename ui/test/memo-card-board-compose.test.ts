// 段 HX2：上の区画の細い書く欄・書く欄を開いたときの見ている位置・［決める］の置き場
//   純粋な関数（composeTextHeight・addSpot・spotNextToLast・boxVisibleRatio・viewToRead・composeView）と、tab・CSS の配線（字面）を確かめる
//   DOM の動き（打って伸びるときのちらつき・IME・面の高さ）は開発画面と Windows の確かめ（計画書 §8.1 の確かめ A の (3)）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_CARD, BOARD_LIMITS, type BoardView } from '../src/memo-card-board';
import { addSpot, COMPOSE_LINE_PX, COMPOSE_ROWS_MAX, composeTextHeight, spotNextToLast } from '../src/memo-card-board-edit';
import { boardFaces, boxReadable, boxVisibleRatio, cardVisibleRatio, COMPOSE_KEEP_RATIO, composeView, openingView, squareReadBox, viewToRead } from '../src/memo-card-board-view';
import type { Reply } from '../src/threads';
import { code } from './helpers';
import { unwrapT } from './source-text';
import { parseCss } from './theme-css';

let seq = 0;
const reply = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt: 1000 + seq++, ...over });
// 作った順に n 枚（c00 が最初）。仮の 3 列の並び：c<i> は (i % 3 × 210, ⌊i / 3⌋ × 116)
const cards = (n: number) => Array.from({ length: n }, (_, i) => reply(`c${String(i).padStart(2, '0')}`, { createdAt: 100 + i }));
const rs14 = cards(14);
const f14 = boardFaces(rs14, null);
const rs15 = cards(15);
const f15 = boardFaces(rs15, null);
const posOf = (faces: readonly { x: number; y: number }[]) => faces.map((f) => ({ x: f.x, y: f.y }));
const at = (faces: readonly { id: string; x: number; y: number }[], id: string) => {
  const f = faces.find((x) => x.id === id);
  if (!f) throw new Error(id);
  return f;
};
const vpOf = (h: number, w = 840) => ({ w, h });
const opened: BoardView = { x: 115, y: -345, zoom: 1 }; // 面 217 の上の区画で 14 枚を開いた位置（最後の 5 枚が読める。HX1 の openingView の値）

describe('前提（HX1 の開き方につなぐ）', () => {
  it('opened は、面 217 の上の区画で 14 枚を開いた位置（openingView）', () => {
    expect(openingView(null, rs14, f14, vpOf(217), { place: 'upper' }).view).toEqual(opened);
  });
});

describe('composeTextHeight（上の区画の書く欄の高さ）', () => {
  it('1 行（18px）から 3 行までの間で、字の高さに枠を足す', () => {
    expect([COMPOSE_LINE_PX, COMPOSE_ROWS_MAX]).toEqual([18, 3]);
    expect(composeTextHeight(26)).toBe(28); // 1 行：18 ＋ 余白 8 ＋ 枠 2
    expect(composeTextHeight(0)).toBe(28); // 空でも 1 行
    expect(composeTextHeight(44)).toBe(46); // 2 行
    expect(composeTextHeight(62)).toBe(64); // 3 行
    expect(composeTextHeight(98)).toBe(64); // 5 行でも 3 行まで（あとは欄の中で送る）
    expect(composeTextHeight(43.2)).toBe(46); // 端数は切り上げ
    expect(composeTextHeight(Number.NaN)).toBe(28);
  });
});

describe('boxVisibleRatio・viewToRead（読む箱を少しだけ寄せる）', () => {
  const box = (id: string, faces = f14) => squareReadBox(at(faces, id));
  it('箱の何割が見えているか（面積の割合）。cardVisibleRatio は四角の箱で同じ計算', () => {
    expect(boxVisibleRatio(opened, box('c13'), vpOf(217))).toBe(1);
    expect(boxVisibleRatio(opened, box('c13'), vpOf(167))).toBe(0.5);
    expect(boxVisibleRatio(opened, box('c05'), vpOf(217))).toBe(0);
    expect(boxVisibleRatio(opened, box('c13'), { w: 0, h: 0 })).toBe(0);
    for (const h of [217, 167, 140]) expect(cardVisibleRatio(opened, at(f14, 'c13'), vpOf(h))).toBe(boxVisibleRatio(opened, box('c13'), vpOf(h)));
  });
  it('読めていれば動かさない。面に大きさが無ければ動かさない', () => {
    expect(viewToRead(opened, box('c13'), vpOf(217))).toBeNull();
    expect(viewToRead(opened, box('c05'), { w: 0, h: 0 })).toBeNull();
  });
  it('下へはみ出していれば、下の辺を面の縁（2px）に合わせる。上へはみ出していれば、上の辺を合わせる', () => {
    const down = viewToRead(opened, box('c13'), vpOf(160));
    expect(down).toEqual({ x: 115, y: -402, zoom: 1 });
    expect(boxReadable(down!, box('c13'), vpOf(160))).toBe(true);
    const up = viewToRead(opened, box('c05'), vpOf(176));
    expect(up).toEqual({ x: 115, y: -114, zoom: 1 });
    expect(boxReadable(up!, box('c05'), vpOf(176))).toBe(true);
  });
  it('右・左へはみ出していれば、その側の辺を合わせる。面より広い箱は左の辺を合わせる', () => {
    const r = { x: 700, y: 10, w: BOARD_CARD.w, h: BOARD_CARD.h };
    expect(viewToRead({ x: 0, y: 0, zoom: 1 }, r, vpOf(217))).toEqual({ x: -52, y: 0, zoom: 1 });
    const l = { x: -50, y: 10, w: BOARD_CARD.w, h: BOARD_CARD.h };
    expect(viewToRead({ x: 0, y: 0, zoom: 1 }, l, vpOf(217))).toEqual({ x: 52, y: 0, zoom: 1 });
    const wide = { x: 100, y: 10, w: BOARD_CARD.w, h: BOARD_CARD.h };
    expect(viewToRead({ x: 0, y: 0, zoom: 1 }, wide, { w: 150, h: 217 })).toEqual({ x: -98, y: 0, zoom: 1 });
  });
  it('面より高い箱は、上の辺（文の始め）を縁に合わせる。倍率に端数があっても縁を割らない', () => {
    expect(viewToRead(opened, box('c13'), vpOf(88))).toEqual({ x: 115, y: -462, zoom: 1 });
    const small = { x: 250, y: -391, zoom: 0.85 };
    const v = viewToRead(small, box('c13'), vpOf(80));
    expect(v).toEqual({ x: 250, y: -392, zoom: 0.85 });
    const top = at(f14, 'c13').y * 0.85 + v!.y;
    expect(top).toBeGreaterThanOrEqual(2);
    expect(top).toBeLessThan(3);
  });
  it('動かす量が 0（面 80 で上の辺がもう縁にある）・範囲で止まって今と同じ位置なら null（要らない滑りと保存を走らせない）', () => {
    expect(viewToRead({ x: 0, y: 0, zoom: 1 }, { x: 10, y: 2, w: BOARD_CARD.w, h: BOARD_CARD.h }, vpOf(80))).toBeNull();
    expect(viewToRead({ x: 250, y: -392, zoom: 0.85 }, box('c13'), vpOf(80))).toBeNull(); // 一度寄せた位置でもう一度
    const lim = BOARD_LIMITS.viewCoord;
    expect(viewToRead({ x: lim, y: 0, zoom: 1 }, { x: -lim - 200, y: 10, w: BOARD_CARD.w, h: BOARD_CARD.h }, vpOf(217))).toBeNull();
  });
  it('［決める］で面の下に出たカード（15 枚・最後のカードの下）は、下の辺を縁に合わせて滑らせる（116 動く）', () => {
    const spot = addSpot({ last: at(f15, 'c14'), view: opened, viewport: vpOf(217), taken: posOf(f15) });
    expect(spot).toEqual({ x: 420, y: 580 });
    expect(viewToRead(opened, squareReadBox(spot!), vpOf(217))).toEqual({ x: 115, y: -461, zoom: 1 });
  });
});

describe('composeView（書く欄を開いたときの寄せ。「半分」は読む箱の面積の割合）', () => {
  const open = (vp: { w: number; h: number }, editing: string | null = null, selected: string | null = null, rs: readonly Reply[] = rs14, faces = f14) => composeView(opened, rs, faces, vp, { editing, selected });
  it('最後に書いたカードが面積で半分より多く見えていれば動かさない（細い書く欄を開いた面 176 では 6 割見える）', () => {
    expect(COMPOSE_KEEP_RATIO).toBe(0.5);
    expect(boxVisibleRatio(opened, squareReadBox(at(f14, 'c13')), vpOf(176))).toBeGreaterThan(0.5);
    expect(open(vpOf(176))).toBeNull();
  });
  it('面積で半分以下（ちょうど半分も）なら、開いたあとの面で読める所へ寄せる', () => {
    expect(open(vpOf(160))).toEqual({ x: 115, y: -402, zoom: 1 });
    expect(boxVisibleRatio(opened, squareReadBox(at(f14, 'c13')), vpOf(167))).toBe(0.5);
    expect(open(vpOf(167))).toEqual({ x: 115, y: -395, zoom: 1 });
  });
  it('縦と横の両方が切れたとき：7 割 × 7 割＝0.49 は面積で半分以下なので寄せる。7.1 割 × 7.1 割＝0.5041 は動かさない', () => {
    const one = [reply('a')];
    const faces = [{ id: 'a', x: 0, y: 0 }];
    const square100 = (p: { x: number; y: number }) => ({ x: p.x, y: p.y, w: 100, h: 100 });
    const vp = { w: 400, h: 100 };
    expect(boxVisibleRatio({ x: -30, y: 30, zoom: 1 }, square100(faces[0]), vp)).toBeCloseTo(0.49, 10);
    expect(composeView({ x: -30, y: 30, zoom: 1 }, one, faces, vp, { editing: null, selected: null, readBox: square100 })).toEqual({ x: 2, y: 2, zoom: 1 });
    expect(composeView({ x: -29, y: 29, zoom: 1 }, one, faces, vp, { editing: null, selected: null, readBox: square100 })).toBeNull();
  });
  it('書き直しているカードが先（選び・最後に書いたカードより）。それが半分より多く見えていれば、最後に書いたカードが隠れても動かさない', () => {
    expect(open(vpOf(176), 'c05', 'c10')).toEqual({ x: 115, y: -114, zoom: 1 });
    expect(boxVisibleRatio(opened, squareReadBox(at(f14, 'c13')), vpOf(160))).toBeLessThanOrEqual(0.5);
    expect(open(vpOf(160), 'c10', null)).toBeNull();
  });
  it('書き直していなければ、1 枚だけ選んでいるカード。それが見えていれば、最後に書いたカードが隠れても動かさない', () => {
    expect(open(vpOf(176), null, 'c05')).toEqual({ x: 115, y: -114, zoom: 1 });
    expect(open(vpOf(160), null, 'c10')).toBeNull();
  });
  it('目当てが描かれていなければ次へ（書き直しのカードが無い → 選び → 最後に書いたカード）', () => {
    expect(open(vpOf(160), 'gone', null)).toEqual({ x: 115, y: -402, zoom: 1 });
    expect(open(vpOf(160), 'gone', 'gone2')).toEqual({ x: 115, y: -402, zoom: 1 });
  });
  it('面より高いカード（下の置き場の書く欄で面 88）は、上の辺を縁に合わせる。カードが無い・面が無くなったときは動かさない', () => {
    expect(open(vpOf(88))).toEqual({ x: 115, y: -462, zoom: 1 });
    expect(open(vpOf(160), null, null, [], [])).toBeNull();
    expect(open(vpOf(0))).toBeNull();
  });
});

describe('addSpot・spotNextToLast（書く欄で足すカードの置き場）', () => {
  const px = BOARD_CARD.w + BOARD_CARD.gap;
  const py = BOARD_CARD.h + BOARD_CARD.gap;
  const vp = vpOf(217);
  const taken14 = posOf(f14);
  it('［決める］（向き無し）：最後に書いたカードの右（x＋210、同じ y）が空いていて面の見えている幅に入れば、右', () => {
    expect(px).toBe(210);
    expect(addSpot({ last: at(f14, 'c13'), view: opened, viewport: vp, taken: taken14 })).toEqual({ x: 420, y: 464 });
  });
  it('右の幅の境目：右のカードの右の辺が面の縁（2px）に入る view.x 228 なら右、229 なら下（同じ x、y＋116）', () => {
    expect(py).toBe(116);
    expect(spotNextToLast({ x: 228, y: -345, zoom: 1 }, vp, at(f14, 'c13'), taken14)).toEqual({ x: 420, y: 464 });
    expect(spotNextToLast({ x: 229, y: -345, zoom: 1 }, vp, at(f14, 'c13'), taken14)).toEqual({ x: 210, y: 580 });
  });
  it('右がふさがっていれば下。右が面の外に出るなら下（15 枚：最後のカードは 3 列目）', () => {
    expect(addSpot({ last: at(f14, 'c13'), view: opened, viewport: vp, taken: [...taken14, { x: 420, y: 464 }] })).toEqual({ x: 210, y: 580 });
    expect(addSpot({ last: at(f15, 'c14'), view: opened, viewport: vp, taken: posOf(f15) })).toEqual({ x: 420, y: 580 });
  });
  it('右も下も無理なら、面の真ん中から右・下・右下（spotForNewCard）：15 枚で下もふさがると (630, 406)', () => {
    const taken = [...posOf(f15), { x: 420, y: 580 }];
    expect(spotNextToLast(opened, vp, at(f15, 'c14'), taken)).toBeNull();
    expect(addSpot({ last: at(f15, 'c14'), view: opened, viewport: vp, taken })).toEqual({ x: 630, y: 406 });
  });
  it('最後に書いたカードが面積で半分しか見えていなければ使わず、真ん中から（48/96 → (420, 472)。49/96 なら右）', () => {
    expect(spotNextToLast({ x: 115, y: -295, zoom: 1 }, vp, at(f14, 'c13'), taken14)).toBeNull();
    expect(addSpot({ last: at(f14, 'c13'), view: { x: 115, y: -295, zoom: 1 }, viewport: vp, taken: taken14 })).toEqual({ x: 420, y: 472 });
    expect(addSpot({ last: at(f14, 'c13'), view: { x: 115, y: -296, zoom: 1 }, viewport: vp, taken: taken14 })).toEqual({ x: 420, y: 464 });
    expect(spotNextToLast(opened, vp, null, taken14)).toBeNull();
  });
  it('Ctrl+Enter・Shift+Enter（向きあり）：選んだ 1 枚があればその横（spotBeside）。最後に書いたカードは使わない', () => {
    expect(addSpot({ dir: 'right', anchor: at(f14, 'c05'), last: at(f14, 'c13'), view: opened, viewport: vp, taken: taken14 })).toEqual({ x: 630, y: 116 });
    expect(addSpot({ dir: 'down', anchor: at(f14, 'c13'), last: at(f14, 'c13'), view: opened, viewport: vp, taken: taken14 })).toEqual({ x: 210, y: 580 });
  });
  it('向きがあって選んだカードが無いときは、真ん中から（spotForNewCard）で、最後に書いたカードの右には置かない', () => {
    expect(addSpot({ dir: 'down', last: at(f14, 'c13'), view: opened, viewport: vp, taken: taken14 })).toEqual({ x: 420, y: 522 });
    expect(addSpot({ last: at(f14, 'c13'), view: opened, viewport: vp, taken: taken14 })).toEqual({ x: 420, y: 464 });
  });
  it('倍率に合わせて幅を見る。±10,000 の外は使わない', () => {
    expect(spotNextToLast({ x: 0, y: 0, zoom: 2 }, vp, { x: 0, y: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: px, y: 0 });
    expect(spotNextToLast({ x: 100, y: 0, zoom: 2 }, vp, { x: 0, y: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: 0, y: py });
    const lim = BOARD_LIMITS.coord;
    const edge = { x: lim - 100, y: lim - 10 };
    expect(spotNextToLast({ x: -(lim - 200), y: -(lim - 60), zoom: 1 }, vp, edge, [edge])).toBeNull();
  });
});

// ---------- 配線（字面） ----------

const tab = unwrapT(readFile(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const css = readFile(new URL('../src/grok-cards.css', import.meta.url), 'utf8');
const body = (from: string, to: string) => {
  const a = tab.indexOf(from);
  if (a < 0) throw new Error(`見つかりません：${from}`);
  const b = tab.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`見つかりません：${to}`);
  return tab.slice(a, b);
};
// 否定・数える確かめは、行の注釈を除いた字（code。helpers.ts）で比べる
const rules = parseCss(css);
const decls = (selector: string) => {
  const rule = rules.find((r) => r.at.length === 0 && r.selector.split(',').map((s) => s.trim()).includes(selector));
  if (!rule) throw new Error(`見つかりません：${selector}`);
  return Object.fromEntries(rule.decls.map((d) => [d.prop, d.value]));
};
const px = (value: string, i = 0) => {
  const n = Number.parseFloat(value.trim().split(/\s+/)[i] ?? '');
  if (!Number.isFinite(n)) throw new Error(`数ではない：${value}`);
  return n;
};

describe('上の区画だけ書く欄を細くする', () => {
  it('CSS：上の区画では 1 行に並べ、見出し・案内の文・つなぐの括弧を隠す。狭いときはボタンを次の行へ回す。下の置き場の形（縦に並べる）は今のまま', () => {
    expect(decls('.memo-board-compose')['flex-direction']).toBe('column');
    expect(decls('.memo-board.is-upper .memo-board-compose')).toMatchObject({ 'flex-direction': 'row', 'flex-wrap': 'wrap', 'align-items': 'flex-end' });
    for (const s of ['.memo-board.is-upper .memo-board-compose-label', '.memo-board.is-upper .memo-board-compose-hint', '.memo-board.is-upper .memo-board-linkkind-note']) expect(decls(s).display, s).toBe('none');
    expect(decls('.memo-board.is-upper .memo-board-compose-actions')).not.toHaveProperty('flex-wrap'); // 下と同じく折り返せる
  });
  it('tab：隠す class の要素（見出し・つなぐの括弧・案内の文）を作っている', () => {
    expect(tab).toContain("private readonly composeLabel = el('label', 'memo-board-compose-label');");
    expect(tab).toContain("kindText.append(el('span', 'memo-board-linkkind-note', '（Ctrl+Enter・Shift+Enter で足すとき）'));");
    expect(tab).toContain("el('span', 'memo-board-compose-hint', COMPOSE_HINT)");
  });
  it('CSS：上の区画の欄の 1 行は COMPOSE_LINE_PX、余白と枠は composeTextHeight と同じ（4px・1px）。10em より細くしない。伸ばすのは JS なので手で引き伸ばさない', () => {
    expect(decls('.memo-board.is-upper .memo-board-compose-text')).toMatchObject({ 'line-height': `${COMPOSE_LINE_PX}px`, resize: 'none', 'overflow-y': 'auto', flex: '1 1 auto', 'min-width': '10em' });
    expect(decls('.memo-board-compose-text')).toMatchObject({ padding: '4px 6px', border: '1px solid var(--border)', 'box-sizing': 'border-box' });
    expect(decls('.memo-board.is-upper .memo-board-compose-text')).not.toHaveProperty('field-sizing'); // 変換の途中に高さが変わらないように、CSS では伸ばさない
  });
  it('CSS から見込む 1 行のときの欄全体の高さは 40〜46px（上の線 ＋ 上下の余白 ＋ max(欄, ボタン)）', () => {
    const compose = decls('.memo-board-compose');
    const tool = decls('.memo-board-tool');
    const button = px(tool.padding) * 2 + 2 + px(tool['font-size']) * 1.5; // 余白 ＋ 枠 ＋ 字（行の高さを多めに 1.5 倍で）
    const total = px(compose['border-top']) + px(compose.padding) * 2 + Math.max(composeTextHeight(26), button);
    expect(total).toBe(41);
    expect(total).toBeGreaterThanOrEqual(40);
    expect(total).toBeLessThanOrEqual(46);
  });
  it('tab：上の区画のときだけ 1 行・短いプレースホルダー・長い説明は title・［決める］の字を形に合わせる。下の置き場は 3 行・見出しが見える（title は置き場の決まりだけ）', () => {
    expect(tab).toContain("const COMPOSE_SHORT = { add: '新しいカードの文', edit: 'カードの文を書き直す', photo: 'この写真の題' } as const;");
    expect(tab).toContain("const COMPOSE_OK = { add: '決める', edit: '書き直す', photo: '題を付ける' } as const;");
    const shape = body('private paintComposeShape() {', 'private fitComposeText(): boolean {');
    expect(shape).toContain("const slim = this.place === 'upper';");
    expect(shape).toContain("const kind = this.photoTitleFor !== null ? 'photo' : this.composing?.kind === 'edit' ? 'edit' : 'add';");
    expect(shape).toContain('this.composeText.rows = slim ? 1 : 3;');
    expect(shape).toContain("this.composeText.placeholder = slim ? COMPOSE_SHORT[kind] : '';");
    expect(shape).toContain("this.composeText.title = slim ? [label, place, COMPOSE_HINT].filter((s) => s !== '').join('。') : place;");
    expect(shape).toContain('this.composeOk.textContent = slim ? COMPOSE_OK[kind] : COMPOSE_OK.add;');
    expect(tab).toContain('actions.append(this.composeOk, cancel, this.linkKindBox, this.composeLike, this.composeHint);'); // 書く欄の ♡ はつなぐの後ろ（MK6）
  });
  it('tab：足す欄の見出し・置き場の決まり・案内の文は、四角と六角で同じ字（HX5：六角も位置を決めて足す。HX4 の「並びの最後に出る」の字は無い）', () => {
    const shape = body('private paintComposeShape() {', 'private fitComposeText(): boolean {');
    expect(shape).toContain("const place = kind === 'add' ? COMPOSE_ADD_PLACE : '';");
    expect(code(shape)).not.toMatch(/\bhex\b|_HEX|coordsWritable|this\.shape/);
    expect(tab).toContain("private readonly composeHint = el('span', 'memo-board-compose-hint', COMPOSE_HINT);");
    expect(code(tab)).not.toMatch(/this\.composeHint\.textContent =/); // 字は作ったときのまま
  });
  it('tab：高さを決めるのは上の区画だけ。空なら測らずに 1 行。測る間はスクロールバーを出さない。下では自分で決めた高さ（composeFitted）だけを外す', () => {
    const fit = body('private fitComposeText(): boolean {', 'private growCompose() {');
    expect(fit.indexOf('if (this.imeComposing) return false;')).toBeGreaterThan(-1);
    expect(fit.indexOf('if (this.imeComposing) return false;')).toBeLessThan(fit.indexOf('const t = this.composeText;'));
    expect(fit).toMatch(/if \(this\.place !== 'upper' \|\| this\.compose\.hidden\) \{\s*if \(this\.composeFitted\) \{\s*t\.style\.height = '';\s*this\.composeFitted = false;\s*\}\s*return/);
    expect(fit).toContain('let height = composeTextHeight(0);');
    expect(fit).toContain("if (t.value !== '') {");
    expect(fit.indexOf("t.style.overflowY = 'hidden';")).toBeLessThan(fit.indexOf('composeTextHeight(t.scrollHeight)'));
    expect(fit.indexOf('composeTextHeight(t.scrollHeight)')).toBeLessThan(fit.indexOf('t.style.overflowY = overflow;'));
    expect(fit).toContain('this.composeFitted = true;');
    expect(code(fit).match(/t\.style\.height = ''/g)).toHaveLength(1); // 空に戻すのは、印があるときの一か所だけ
  });
  it('tab：置き場が替わったときだけ形を合わせる（面を合わせる前に）。書く欄を開くときは、欄を出す → タグの行 → 形 → 寄せる の順', () => {
    const place = body('setPlace(available: boolean, upper: boolean) {', '// ---------- 見るメモの名札と選び口');
    expect(place).toContain('if (moved) this.paintComposeShape();');
    expect(code(place).match(/this\.paintComposeShape\(\)/g)).toHaveLength(1);
    expect(place.indexOf('if (moved) this.paintComposeShape();')).toBeLessThan(place.indexOf('if (moved) this.settleFace(0);'));
    const show = body('private showCompose(', 'private paintComposeShape() {');
    const order = ['this.compose.hidden = false;', 'this.paintTools();', 'this.paintComposeShape();', 'this.shiftForCompose();'].map((s) => show.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('変換の途中（isComposing）は高さを変えず、変換が終わってから合わせる。下の置き場では打っても合わせない。開く・閉じるで変換の印を下ろす', () => {
    expect(tab).toMatch(/this\.composeText\.addEventListener\('input', \(e\) => \{\s*if \(this\.place !== 'upper' \|\| this\.imeComposing \|\| \(e instanceof InputEvent && e\.isComposing\)\) return;\s*this\.growCompose\(\);/);
    expect(tab).toMatch(/this\.composeText\.addEventListener\('compositionstart', \(\) => \{\s*this\.imeComposing = true;/);
    expect(tab).toMatch(/this\.composeText\.addEventListener\('compositionend', \(\) => \{\s*this\.imeComposing = false;\s*this\.growCompose\(\);/);
    expect(body('private showCompose(', 'private paintComposeShape() {')).toContain('this.imeComposing = false;');
    const close = body('private closeCompose() {', 'private submitCompose(');
    expect(close.indexOf('this.imeComposing = false;')).toBeGreaterThan(-1);
    expect(close.indexOf('this.imeComposing = false;')).toBeLessThan(close.indexOf('this.fitComposeText();'));
  });
  it('面の ResizeObserver：欄が開いていれば、高さを合わせ直す（幅が変わって折り返しが変わったとき）', () => {
    expect(body('new ResizeObserver(() => {', '}).observe(this.stage);')).toContain('if (!this.compose.hidden) this.growCompose();');
  });
});

describe('書く欄を開いたとき・伸びたとき・閉じたときの見ている位置', () => {
  it('開いたとき：目当て（書き直し → 1 枚の選び → 最後に書いた）を composeView で寄せる。保存しない。戻す先は初めの位置だけ', () => {
    const shift = body('private shiftForCompose() {', 'private restoreAfterCompose() {');
    expect(shift).toContain("const editing = this.composing?.kind === 'edit' ? this.composing.id : null;");
    expect(shift).toContain('const selected = this.selected.size === 1 ? [...this.selected][0] : null;');
    expect(shift).toContain('composeView(this.view, this.source?.get()?.replies ?? [], this.faces, this.viewport(), { editing, selected, readBox: this.readBox })');
    expect(shift).toContain('if (!this.composeShift) this.composeShift = { before: this.view };');
    expect(code(shift)).not.toContain('this.touchView(');
  });
  it('欄が伸びて高さが変わったとき：変換中でなく、開いてから触っていなければ、もう一度寄せる', () => {
    expect(body('private growCompose() {', 'private shiftForCompose() {')).toContain('if (this.fitComposeText() && this.composeUntouched && !this.compose.hidden) this.shiftForCompose();');
    expect(body('private showCompose(', 'private paintComposeShape() {')).toContain('this.composeUntouched = true;');
    expect(body('private closeCompose() {', 'private submitCompose(')).toContain('this.composeUntouched = false;');
  });
  it('閉じたとき：寄せてから触っていなければ、寄せる前の位置へ戻す（保存しない）。戻すのは断られた文を開き直す前', () => {
    const close = body('private closeCompose() {', 'private submitCompose(');
    expect(close.indexOf('this.compose.hidden = true;')).toBeLessThan(close.indexOf('this.restoreAfterCompose();'));
    expect(close.indexOf('this.restoreAfterCompose();')).toBeLessThan(close.indexOf('this.refusedDrafts.shift()'));
    const restore = body('private restoreAfterCompose() {', 'private dropComposeShift() {');
    expect(restore).toContain('this.view = shift.before;');
    expect(code(restore)).not.toContain('this.touchView(');
  });
  it('寄せた一時の位置は保存しない：見ている位置の保存（flushView）は、寄せていれば寄せる前の位置を書く（viewToSave → viewAfterClose）', () => {
    const flush = body('flushView() {', '// ---------- 保存の列');
    expect(flush).toContain('const view = { ...this.viewToSave() };');
    expect(code(flush)).not.toContain('{ ...this.view }');
    expect(body('private viewToSave(): BoardView {', 'private closedViewport()')).toContain(': this.viewAfterClose();');
    expect(body('private viewAfterClose(): BoardView {', 'private viewToSave()')).toContain('return this.composeShift?.before ?? this.view;');
  });
  it('触ったら（見ている位置を変えた・カードを動かした）・見ている位置が自分で替わったら・隠したら・メモを替えたら、戻さない（印は dropComposeShift で両方下ろす）', () => {
    expect(body('private dropComposeShift() {', 'private viewAfterClose()')).toMatch(/this\.composeShift = null;\s*this\.composeUntouched = false;/);
    expect(body('private touchView() {', 'private armViewTimer(')).toContain('this.dropComposeShift();');
    expect(body('private moveDrag(', 'private dragPoint(')).toMatch(/d\.moved = true;\s*this\.viewTouched = true;[^\n]*\n\s*this\.dropComposeShift\(\);/);
    expect(body('private settleFace(dy: number) {', '// 利用者が見ている位置を変えた')).toContain('this.dropComposeShift();');
    expect(body('private reopenAfterShow(', 'toggle() {')).toContain('this.dropComposeShift();');
    expect(body('private renderBoard(', 'private build(')).toContain('this.dropComposeShift();');
    const hide = body('setHidden(hidden: boolean) {', 'private noteHiddenLast(');
    expect(hide.indexOf('this.flushView();')).toBeLessThan(hide.indexOf('this.dropComposeShift();')); // 保存してから下ろす（保存は寄せる前の位置）
    const changed = body('if (changed) {', 'this.memoId = snap.memoId;');
    expect(changed.indexOf('this.flushView();')).toBeLessThan(changed.indexOf('this.dropComposeShift();'));
    expect(changed.indexOf('this.dropComposeShift();')).toBeLessThan(changed.indexOf('this.closeCompose()'));
  });
});

describe('［決める］の置き場と、足したあとの滑り・型を貼る場所', () => {
  const add = body('private submitAdd(', 'private drawAddedLink(');
  it('置き場は addSpot に任せ、書く欄を閉じたあとの面と見ている位置（寄せていれば戻したあと）で決める。形ごとの箱・歩み・重なり・横に置けないときの置き方は geo（HX5）', () => {
    // 最後に書いたカードはどの足し方にも渡す。向きのある足し方で使うのは、横に置けないときの六角だけ（四角の addSpot は besideFallback 'center' で使わない。純粋な関数の試験で固める）
    expect(add).toContain('const lastFace = lastWritten(snap.replies, this.faces);');
    expect(add).toContain('const spot = addSpot({ at: this.composeAt ?? undefined, dir, anchor, last, view: this.viewAfterClose(), viewport: this.closedViewport(), taken, size: geo.box, step: geo.step, overlaps: geo.overlaps, besideFallback: geo.besideFallback });');
    expect(add).toMatch(/if \(!spot\) \{\s*this\.flash\('置ける空きが見つかりませんでした/);
    expect(add).toContain('this.setPending(id, spot, token);');
    expect(body('private closedViewport()', 'private slideToRead(')).toContain('return { w: vp.w, h: vp.h + (this.compose.hidden ? 0 : this.compose.offsetHeight) };');
  });
  it('足せたあと、どの足し方のカードでも（［決める］・Ctrl+Enter・Shift+Enter）読めていなければ滑らせて保存する（viewToRead・touchView）。四角と六角の両方（HX2 は［決める］だけだった。上の区画の面 217 では、下に足したカードが見えないため。HX5 の見直し）', () => {
    const ok = add.slice(add.indexOf('this.setSelected(new Set([id]));'), add.indexOf('this.pushUndo('));
    expect(ok.length).toBeGreaterThan(30);
    expect(ok).toContain('if (this.memoId === memoId) this.slideToRead(this.pos.get(id) ?? spot);');
    expect(code(ok)).not.toContain('!dir');
    expect(code(ok)).not.toContain('this.geo.place(');
    const slide = body('private slideToRead(', 'private returnDraft(');
    expect(slide).toContain('viewToRead(this.view, this.geo.slideBox(at, this.view.zoom, vp), vp)'); // 目当ては形ごと（六角の低い面では文の帯。HX5）
    expect(slide.indexOf('this.slide();')).toBeLessThan(slide.indexOf('this.touchView();'));
  });
  it('型を貼る場所も、書く欄を閉じたあとの面と見ている位置で決める（貼ったあと closeCompose で戻るため）', () => {
    const paste = body('private pasteOnBoard(', 'this.closeCompose();');
    expect(paste).toContain('view: this.viewAfterClose(), viewport: this.closedViewport()');
  });
  it('下の置き場で見える見出しは前と同じく短く（1 行）、置き場の決まりの説明は title に', () => {
    expect(tab).toContain("const COMPOSE_ADD_LABEL = '新しいカードの文（最後に書いたカードの隣に足します。Ctrl+Enter で選んだカードの右・Shift+Enter で下に）';");
    expect(tab).toMatch(/const COMPOSE_ADD_PLACE = '［決める］で足すカードは、最後に書いたカードが半分より多く見えていればその右、右が面の外かふさがっていれば下、どちらも無理なら見ている場所の真ん中に置きます';/);
    expect([...'新しいカードの文（最後に書いたカードの隣に足します。Ctrl+Enter で選んだカードの右・Shift+Enter で下に）'].length).toBeLessThanOrEqual([...'新しいカードの文（見ている場所の真ん中に足します。Ctrl+Enter で選んだカードの右・Shift+Enter で下に）'].length + 1);
    expect(body('private showCompose(', 'private paintComposeShape() {')).toContain("mode.kind === 'add' ? COMPOSE_ADD_LABEL : 'カードの文を書き直す'");
  });
});
