// 段 MK8a：吹き出しの計算（memo-card-board-callouts.ts。docs/plan-comment-board-marks.md §4.8・§9.1）
//   左右の空き・席の数と置き場・順（♥3 → ♥2 → 色 → ♥1・印が無ければ最後に書いた 2 枚を席の数まで・間の中で並べ替えない）・組と「＋n」・字・
//   MK3 との組み（借りる高さの上限。fitView の丸めの分を見込む。見直しの例と掃き出し）
//   面の大きさ 840×217・840×400・840×176 と六角の仮の並びは、下調べ research/05-callouts.md §3.3 と research/06-divider.md の見立て（アプリで測った値ではない）
import { describe, expect, it } from 'vitest';
import { borrowUpperRatio } from '../src/grok-cards-place';
import { BOARD_CARD, type BoardView, boardToScreen, type CardSize, fitView, placementBounds } from '../src/memo-card-board';
import { CALLOUT, CALLOUT_CAP_MARGIN, CALLOUT_WAIT_MS, calloutBadgeAt, type CalloutCard, type CalloutOrder, calloutBands, calloutFaceCap, calloutHead, calloutLayout, calloutMarksKey, calloutMoreText, calloutMoreTitle, calloutOrder, calloutPage, calloutPerSide, calloutSeats, calloutShot, calloutSlots, calloutTap, calloutText, hasCalloutMark, lastSeat } from '../src/memo-card-board-callouts';
import { HEX_GEO, SQUARE_GEO } from '../src/memo-card-board-geo';
import { HEX, HEX_BOX, hexSlot } from '../src/memo-card-board-hex';
import { PEEK_DOUBLE_MS } from '../src/sheet-peek-logic';
import { FIT_PAD, overviewNeedPx } from '../src/memo-card-board-overview';
import { cardLines, VIEW_SAVE_DELAY } from '../src/memo-card-board-view';
import type { Reply } from '../src/threads';

const hexes = (n: number) => Array.from({ length: n }, (_, i) => hexSlot(i)); // 六角の仮の並び（1 行 5 枚と 4 枚）
const fitOf = (n: number, vp: { w: number; h: number }): BoardView => fitView(placementBounds(hexes(n), HEX_BOX), vp); // ［全体］の位置
const bandsOf = (n: number, vp: { w: number; h: number }) => calloutBands(fitOf(n, vp), hexes(n), HEX_BOX, vp);
const seatsOf = (n: number, vp: { w: number; h: number }) => calloutSeats(bandsOf(n, vp), vp);
const card = (id: string, over: Partial<CalloutCard> = {}): CalloutCard => ({ id, x: 0, y: 0, like: 0, color: '', createdAt: 0, ...over });
const none = new Set<string>();
const reply = (text: string, over: Partial<Reply> = {}): Reply => ({ id: 'r', parent: null, text, createdAt: 0, ...over });

describe('左右の空き（calloutBands）', () => {
  it('描いているカードの外枠を画面へ移し、面の縁との差を取る（面 217・六角 20 枚は倍率 0.25 で左右に約 318、面 400 は 0.485 で約 222）', () => {
    const a = bandsOf(20, { w: 840, h: 217 });
    expect(fitOf(20, { w: 840, h: 217 }).zoom).toBe(0.25);
    expect(a!.left).toBe(318);
    expect(a!.right).toBeCloseTo(318.5, 5);
    const b = bandsOf(20, { w: 840, h: 400 });
    expect(fitOf(20, { w: 840, h: 400 }).zoom).toBe(0.485);
    expect(Math.abs(b!.left - 222.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(b!.right - 222.5)).toBeLessThanOrEqual(1);
  });
  it('外枠が面からはみ出す向きは 0、面の外にあれば面の幅まで（面の中だけ）', () => {
    const vp = { w: 840, h: 217 };
    expect(calloutBands({ x: -100, y: 0, zoom: 1 }, [{ x: 0, y: 0 }], HEX_BOX, vp)).toEqual({ left: 0, right: 840 - 50 });
    expect(calloutBands({ x: 900, y: 0, zoom: 1 }, [{ x: 0, y: 0 }], HEX_BOX, vp)).toEqual({ left: 840, right: 0 });
  });
  it('カードが無い・面に大きさが無ければ null', () => {
    expect(calloutBands({ x: 0, y: 0, zoom: 1 }, [], HEX_BOX, { w: 840, h: 217 })).toBeNull();
    expect(calloutBands({ x: 0, y: 0, zoom: 1 }, [{ x: 0, y: 0 }], HEX_BOX, { w: 0, h: 217 })).toBeNull();
    expect(calloutBands({ x: 0, y: 0, zoom: 1 }, [{ x: 0, y: 0 }], HEX_BOX, { w: 840, h: 0 })).toBeNull();
  });
});

describe('席（calloutSeats）', () => {
  it('寸法：高さ 44・間 4・上下の余白 6・内へ 8（幅は 空き − 16）・空き 200 以上・幅 260 まで。止まってから 400ms（保存の待ちと同じ長さ）', () => {
    expect(CALLOUT).toMatchObject({ h: 44, gap: 4, pad: 6, inset: 8, minBand: 200, maxW: 260, textMax: 40 });
    expect(CALLOUT_WAIT_MS).toBe(400);
    expect(CALLOUT_WAIT_MS).toBe(VIEW_SAVE_DELAY);
  });
  it('片側に積める数：面 217 で 4、400 で 8、176 で 3、140 で 2。56 未満は 0', () => {
    expect([217, 400, 176, 140, 56, 55].map(calloutPerSide)).toEqual([4, 8, 3, 2, 1, 0]);
    expect(calloutPerSide(Number.NaN)).toBe(0);
  });
  it('計画の目安：面 217 で 4+4、400 で 8+8、書く欄を開いた面 176 で 3+3（六角 20 枚・20 枚・10 枚の［全体］）', () => {
    const a = seatsOf(20, { w: 840, h: 217 });
    expect([a.left.n, a.right.n]).toEqual([4, 4]);
    const b = seatsOf(20, { w: 840, h: 400 });
    expect([b.left.n, b.right.n]).toEqual([8, 8]);
    const c = seatsOf(10, { w: 840, h: 176 });
    expect([c.left.n, c.right.n]).toEqual([3, 3]);
    expect(a.total).toBe(8);
  });
  it('空きが 200 に届かない側には出さない（面 400・六角 10 枚は倍率 0.788、空き約 100 で 0）', () => {
    expect(seatsOf(10, { w: 840, h: 400 }).total).toBe(0);
    const vp = { w: 840, h: 217 };
    expect(calloutSeats({ left: 199.9, right: 200 }, vp)).toMatchObject({ left: { n: 0 }, right: { n: 4, w: 184, x: 840 - 8 - 184 } });
    expect(calloutSeats(null, vp)).toMatchObject({ perSide: 0, total: 0 });
  });
  it('幅は 空き − 16 で 260 まで。左の列は面の左の端から 8、右の列は面の右の端から 8', () => {
    const s = calloutSeats({ left: 318, right: 250 }, { w: 840, h: 217 });
    expect(s.left).toEqual({ n: 4, x: 8, w: 260 });
    expect(s.right).toEqual({ n: 4, x: 840 - 8 - 234, w: 234 });
  });
});

describe('順（calloutOrder）', () => {
  const cards = [
    card('a1', { like: 1, createdAt: 10 }),
    card('c1', { color: '水', createdAt: 20 }),
    card('h3old', { like: 3, createdAt: 5 }),
    card('h2c', { like: 2, color: '若草', createdAt: 30 }),
    card('plain', { createdAt: 99 }),
    card('h3new', { like: 3, createdAt: 50 }),
    card('c1h1', { like: 1, color: '赤紫', createdAt: 15 }),
    card('a1new', { like: 1, createdAt: 40 }),
  ];
  it('♥3 → ♥2 → 色 → ♥1。同じ組の中は作った時刻の新しい順。♥2 と色のカードは ♥2、♥1 と色のカードは色の組（1 枚は 1 度だけ）。印の無いカードは入れない', () => {
    const o = calloutOrder(cards, [], none, null);
    expect(o.ids).toEqual(['h3new', 'h3old', 'h2c', 'c1', 'c1h1', 'a1new', 'a1']);
    expect(o.marked).toBe(true);
  });
  it('同じ時刻なら id の順', () => {
    expect(calloutOrder([card('b', { like: 2, createdAt: 1 }), card('a', { like: 2, createdAt: 1 })], [], none, null).ids).toEqual(['a', 'b']);
  });
  it('印が 1 枚も無いボードでは、最後に書いた順（recent）の頭から、描いていて薄くしていない 2 枚（marked は false）', () => {
    const plain = [card('x'), card('y'), card('z'), card('w')];
    expect(calloutOrder(plain, ['gone', 'y', 'w', 'x', 'z'], none, null)).toEqual({ key: 'r', ids: ['y', 'w'], marked: false });
    expect(calloutOrder(plain, ['y', 'w', 'x', 'z'], new Set(['y']), null).ids).toEqual(['w', 'x']);
  });
  it('印の鍵：描いているカードの印だけ（id の順。文・位置・作った時刻は入らない）。印が無ければ r', () => {
    expect(calloutMarksKey([card('x')])).toBe('r');
    const k = calloutMarksKey([card('b', { like: 2 }), card('a', { color: '水' }), card('n')]);
    expect(k).toBe(calloutMarksKey([card('a', { color: '水', createdAt: 9, x: 5 }), card('b', { like: 2, y: 7 })]));
    expect(k).not.toBe(calloutMarksKey([card('a', { color: '水' }), card('b', { like: 3 })]));
  });
  it('間の中では、印が替わったときのほか並べ替えない（前の順を受けて保つ。作った時刻・最後に書いた順・薄くしたカードが替わっても同じ並び）', () => {
    const first = calloutOrder(cards, [], none, null);
    const shuffled = cards.map((c) => ({ ...c, createdAt: 1000 - c.createdAt }));
    const kept = calloutOrder(shuffled, ['a1'], new Set(['h3new']), first);
    expect(kept).toBe(first);
    // 印が替わった（♥1 を ♥3 に）：並べ直す
    const changed = cards.map((c) => (c.id === 'a1' ? { ...c, like: 3 as const } : c));
    expect(calloutOrder(changed, [], none, first).ids).toEqual(['h3new', 'a1', 'h3old', 'h2c', 'c1', 'c1h1', 'a1new']);
  });
  it('印の無いボードの 2 枚も、間の中では保つ（新しく書いたカードが来ても替えない）。描かなくなったカードは抜き、足りない分を最後に書いた順から補う（MK8b。案 A）', () => {
    const plain = [card('x'), card('y'), card('z')];
    const first = calloutOrder(plain, ['y', 'x', 'z'], none, null);
    expect(calloutOrder([...plain, card('new')], ['new', 'y', 'x'], none, first)).toBe(first);
    // MK8a では ['x'] のままだった（MK8a の記録の (d)）。残った x の順は保ち、後ろに z を補う
    expect(calloutOrder([card('x'), card('z')], ['x', 'z'], none, first)).toEqual({ key: 'r', ids: ['x', 'z'], marked: false });
  });
  it('補うのは前の順が 2 枚に足りないときだけ（MK8b）：始めたときに全部薄かった（順が空）なら、検索を消したときに 2 枚を補う。2 枚あれば、薄くなっても補わない（出すときに抜く）', () => {
    const plain = [card('x'), card('y'), card('z'), card('w')];
    const recent = ['y', 'x', 'z', 'w'];
    const empty = calloutOrder(plain, recent, new Set(['y', 'x', 'z', 'w']), null);
    expect(empty.ids).toEqual([]);
    expect(calloutOrder(plain, recent, new Set(['y', 'x', 'z', 'w']), empty)).toBe(empty); // まだ全部薄い：補えるものが無い（同じものを返す）
    expect(calloutOrder(plain, recent, new Set(['y']), empty)).toEqual({ key: 'r', ids: ['x', 'z'], marked: false }); // 薄いもの・まだ順にあるものは飛ばす
    const two = calloutOrder(plain, recent, none, null);
    expect(two.ids).toEqual(['y', 'x']);
    expect(calloutOrder(plain, recent, new Set(['y', 'x']), two)).toBe(two); // 2 枚あるので補わない（並べ替えない）
    // 1 枚が描かれなくなり、もう 1 枚は薄い：残った 1 枚の順は保ち、薄くないカードを 1 枚だけ補う
    expect(calloutOrder([card('x'), card('z'), card('w')], ['z', 'x', 'w'], new Set(['x']), two)).toEqual({ key: 'r', ids: ['x', 'z'], marked: false });
  });
  it('補うのは印の無いボードだけ（印のボードは今までどおり、消えたカードを抜くだけ）。📌 で留めたカード（exclude）は補わない', () => {
    const marked = [card('a', { like: 1 }), card('b', { like: 2 }), card('c')];
    const first = calloutOrder(marked, ['c', 'a', 'b'], none, null);
    expect(first.ids).toEqual(['b', 'a']);
    expect(calloutOrder([card('a', { like: 1 }), card('c')], ['c'], none, { ...first, key: calloutMarksKey([card('a', { like: 1 }), card('c')]) }).ids).toEqual(['a']);
    const plain = [card('x'), card('y'), card('z')];
    const one = calloutOrder(plain, ['x'], none, null);
    expect(one.ids).toEqual(['x']);
    expect(calloutOrder(plain, ['y', 'z', 'x'], new Set(['y']), one).ids).toEqual(['x', 'z']); // y は 📌（出さない）
  });
});

describe('組と「＋n」（calloutPage・calloutSlots）', () => {
  it('出すカードが無ければ何も出さない。席に入れば 1 組（＋n なし）', () => {
    expect(calloutPage(0, 8, 0)).toEqual({ start: 0, count: 0, more: 0, corner: 0, page: 0, pages: 0 });
    expect(calloutPage(8, 8, 3)).toEqual({ start: 0, count: 8, more: 0, corner: 0, page: 0, pages: 1 });
  });
  it('入らない分は最後の席を「＋n」にする（n は次の組の枚数。最後の組のあとは頭の組へ）。組の番は回して収める', () => {
    expect(calloutPage(10, 8, 0)).toEqual({ start: 0, count: 7, more: 3, corner: 0, page: 0, pages: 2 });
    expect(calloutPage(10, 8, 1)).toEqual({ start: 7, count: 3, more: 7, corner: 0, page: 1, pages: 2 });
    expect(calloutPage(10, 8, 2)).toEqual(calloutPage(10, 8, 0));
    expect(calloutPage(10, 8, -1)).toEqual(calloutPage(10, 8, 1));
    expect(calloutPage(7, 3, 3)).toEqual({ start: 6, count: 1, more: 2, corner: 0, page: 3, pages: 4 });
    expect(calloutPage(10, 8, Number.NaN).page).toBe(0);
  });
  it('左右とも席が無い（席が 1 つ以下）なら、面の右上の札「＋n」だけ（n は出すカードの全部）', () => {
    expect(calloutPage(3, 0, 0)).toEqual({ start: 0, count: 0, more: 0, corner: 3, page: 0, pages: 1 });
    expect(calloutPage(3, 1, 0)).toMatchObject({ count: 0, corner: 3 });
    expect(calloutPage(1, 1, 0)).toMatchObject({ count: 1, corner: 0 });
  });
  it('左右の列へ：前半を左、後半を右（数をそろえる。片側が満ちたら、もう片側へ）。並びは左の上から、次に右の上から', () => {
    const both = calloutSeats({ left: 300, right: 300 }, { w: 840, h: 217 });
    expect(calloutSlots(5, both)).toEqual([{ side: 'left', k: 0 }, { side: 'left', k: 1 }, { side: 'left', k: 2 }, { side: 'right', k: 0 }, { side: 'right', k: 1 }]);
    expect(calloutSlots(8, both).filter((s) => s.side === 'right')).toHaveLength(4);
    expect(calloutSlots(9, both)).toHaveLength(8);
    const right = calloutSeats({ left: 100, right: 300 }, { w: 840, h: 217 });
    expect(calloutSlots(3, right)).toEqual([{ side: 'right', k: 0 }, { side: 'right', k: 1 }, { side: 'right', k: 2 }]);
  });
});

describe('置き場の全部（calloutLayout）', () => {
  const vp = { w: 840, h: 217 };
  const view = fitOf(20, vp);
  const pts = hexes(20);
  // 20 枚のうち 10 枚に印（♥3 が 2・♥2 が 2・色が 3・♥1 が 3）
  const marks: Partial<CalloutCard>[] = [{ like: 3 }, { like: 3 }, { like: 2 }, { like: 2, color: '水' }, { color: '若草' }, { color: '赤紫' }, { color: '水', like: 1 }, { like: 1 }, { like: 1 }, { like: 1 }];
  const cards = pts.map((p, i) => card(`c${i}`, { ...p, createdAt: i, ...(marks[i] ?? {}) }));
  const input = { view, viewport: vp, box: HEX_BOX, cards, recent: [], exclude: none, badge: HEX_GEO.badge };
  it('面 217・六角 20 枚・印 10 枚：席は 4+4。7 枚と、最後の席（右の 4 段目）に「＋3」。左の列は x 8、右の列は x 572（幅 260）。上から間 4', () => {
    const l = calloutLayout(input, null, 0);
    expect(l.items.map((i) => i.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(l.items.map((i) => i.id)).toEqual(['c1', 'c0', 'c3', 'c2', 'c6', 'c5', 'c4']);
    expect(l.items.slice(0, 4).map((i) => [i.x, i.y, i.w, i.h])).toEqual([
      [8, 6, 260, 44],
      [8, 54, 260, 44],
      [8, 102, 260, 44],
      [8, 150, 260, 44],
    ]);
    expect(l.items.slice(4).map((i) => [i.x, i.y])).toEqual([
      [572, 6],
      [572, 54],
      [572, 102],
    ]);
    expect(l.more).toEqual({ x: 572, y: 150, w: 260, h: 44, n: 3 });
    expect(l).toMatchObject({ corner: 0, page: 0, pages: 2 });
    expect(l.items[0]).toMatchObject({ like: 3, color: '' });
    expect(l.items[2]).toMatchObject({ like: 2, color: '水' });
  });
  it('次の組は番号を通しで続ける（8 番から）。最後の組の「＋n」は頭の組の枚数', () => {
    const first = calloutLayout(input, null, 0);
    const second = calloutLayout(input, first.order, 1);
    expect(second.items.map((i) => i.n)).toEqual([8, 9, 10]);
    expect(second.more?.n).toBe(7);
    expect(second.order).toBe(first.order);
  });
  it('MK8b：「＋n」は組によらず最後の席（右の 4 段目）。最後の組は枚数が少なくても動かない（続けて押しても同じ所に当たる）。吹き出しの並びは今までどおり', () => {
    const first = calloutLayout(input, null, 0);
    const second = calloutLayout(input, first.order, 1);
    expect(second.more).toEqual({ x: 572, y: 150, w: 260, h: 44, n: 7 });
    expect(second.more).toMatchObject({ x: first.more?.x, y: first.more?.y });
    expect(second.items.map((i) => [i.x, i.y])).toEqual([
      [8, 6],
      [8, 54],
      [572, 6],
    ]);
    const both = calloutSeats({ left: 300, right: 300 }, { w: 840, h: 217 });
    expect(lastSeat(both)).toEqual({ side: 'right', k: 3 });
    expect(lastSeat(calloutSeats({ left: 300, right: 100 }, { w: 840, h: 217 }))).toEqual({ side: 'left', k: 3 });
    expect(lastSeat(calloutSeats({ left: 100, right: 100 }, { w: 840, h: 217 }))).toBeUndefined();
    // 組の吹き出し（席 − 1 枚まで）は、最後の席に来ない
    for (let count = 0; count <= 7; count++) expect(calloutSlots(count, both)).not.toContainEqual({ side: 'right', k: 3 });
  });
  it('MK8b：選ぶとタグの行が出て面が低くなる（217 → 190 の見立て。位置は［全体］のまま）と、席は 4+4 から 3+3 に組み直る（層がダブルクリックの間は作り直さない理由）', () => {
    const before = calloutLayout(input, null, 0);
    const after = calloutLayout({ ...input, viewport: { w: 840, h: 190 } }, before.order, 0);
    expect(after.items.map((i) => i.id)).toEqual(['c1', 'c0', 'c3', 'c2', 'c6']);
    // 左の 4 段目（c2）は右の 1 段目へ、右の 3 段目（c4）の所は「＋5」になり、c5・c4 は頭の組から消える
    expect(before.items.find((i) => i.id === 'c2')).toMatchObject({ x: 8, y: 150 });
    expect(after.items.find((i) => i.id === 'c2')).toMatchObject({ x: 572, y: 6 });
    expect(before.items.find((i) => i.id === 'c4')).toMatchObject({ x: 572, y: 102 });
    expect(after.more).toEqual({ x: 572, y: 102, w: 260, h: 44, n: 5 });
  });
  it('MK8b：keep（出したい組のカード）が組の番の組に無ければ、keep の入る組を出す（番号は通しのまま）。keep が出ないカード・組が 1 つなら組の番のまま', () => {
    const order = calloutLayout(input, null, 0).order;
    const low = { ...input, viewport: { w: 840, h: 190 } }; // 1 組 5 枚
    expect(calloutLayout(low, order, 0, 'c4').items.map((i) => [i.id, i.n])).toEqual([
      ['c5', 6],
      ['c4', 7],
      ['c9', 8],
      ['c8', 9],
      ['c7', 10],
    ]);
    expect(calloutLayout(low, order, 0, 'c4').page).toBe(1);
    expect(calloutLayout(low, order, 1, 'c1').page).toBe(0);
    expect(calloutLayout(low, order, 1, 'c3').page).toBe(0);
    expect(calloutLayout(low, order, 0, 'c6').page).toBe(0); // 5 番は頭の組
    expect(calloutLayout(low, order, 1, 'c11').page).toBe(1); // 印の無いカード：組の番のまま
    expect(calloutLayout({ ...low, exclude: new Set(['c4']) }, order, 0, 'c4').page).toBe(0); // 出さないカード：組の番のまま
    expect(calloutLayout(input, order, 1, 'c1').page).toBe(0);
    expect(calloutLayout({ ...input, viewport: { w: 840, h: 400 }, view: fitOf(20, { w: 840, h: 400 }) }, order, 0, 'c7').page).toBe(0); // 1 組に入る
  });
  it('上下の帯には出さない：席は左右の列だけ。席の下の端は面の下の余白 6 の内', () => {
    const tall = calloutLayout({ ...input, viewport: { w: 840, h: 400 }, view: fitOf(20, { w: 840, h: 400 }) }, null, 0);
    for (const i of [...tall.items, ...(tall.more ? [tall.more] : [])]) {
      expect([8, 840 - 8 - i.w]).toContain(i.x);
      expect(i.y + i.h).toBeLessThanOrEqual(400 - 6);
    }
    expect(tall.items).toHaveLength(10); // 8+8 の席に入る
  });
  it('薄くしたカードは出さない（順は替えずに抜き、番号は出すカードで振る。8 枚になれば 8 席に入り「＋n」は無い）', () => {
    const l = calloutLayout({ ...input, exclude: new Set(['c1', 'c3']) }, null, 0);
    expect(l.items.map((i) => i.id)).toEqual(['c0', 'c2', 'c6', 'c5', 'c4', 'c9', 'c8', 'c7']);
    expect(l.items.map((i) => i.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(l.more).toBeNull();
    expect(l.order.ids).toContain('c1'); // 順には残す（絞りを外すと同じ席に戻る）
    const back = calloutLayout(input, l.order, 0);
    expect(back.items.map((i) => i.id)).toEqual(['c1', 'c0', 'c3', 'c2', 'c6', 'c5', 'c4']);
  });
  it('印の無いボードでは最後に書いた 2 枚。頭に印を付けない（印のタグがあっても、ここでは無いので like 0・color 空）', () => {
    const plain = pts.map((p, i) => card(`p${i}`, { ...p, createdAt: i }));
    const l = calloutLayout({ ...input, cards: plain, recent: ['p19', 'p4', 'p7'] }, null, 0);
    expect(l.items.map((i) => [i.id, i.n, i.like, i.color])).toEqual([
      ['p19', 1, 0, ''],
      ['p4', 2, 0, ''],
    ]);
    expect(l.order.marked).toBe(false);
  });
  it('左右とも席が無いとき（面 400・六角 10 枚）は、右上の札「＋n」だけ（吹き出しは無い）', () => {
    const vp400 = { w: 840, h: 400 };
    const ten = hexes(10).map((p, i) => card(`t${i}`, { ...p, like: 1 }));
    const l = calloutLayout({ view: fitOf(10, vp400), viewport: vp400, box: HEX_BOX, cards: ten, recent: [], exclude: none, badge: HEX_GEO.badge }, null, 0);
    expect(l.items).toEqual([]);
    expect(l.more).toBeNull();
    expect(l.corner).toBe(10);
  });
  it('カードが無ければ何も出さない', () => {
    const l = calloutLayout({ ...input, cards: [] }, null, 0);
    expect(l).toMatchObject({ items: [], more: null, corner: 0, pages: 0 });
  });
  it('印の無いボードの 2 枚は、席の数まで：左右とも席が無ければ何も出さない（右上の札も出さない。層は隠れる。面 400・六角 10 枚と、下を借りた面 321）', () => {
    for (const h of [400, 321]) {
      const vpH = { w: 840, h };
      const plain = hexes(10).map((p, i) => card(`p${i}`, { ...p, createdAt: i }));
      const l = calloutLayout({ view: fitOf(10, vpH), viewport: vpH, box: HEX_BOX, cards: plain, recent: ['p9', 'p3'], exclude: none, badge: HEX_GEO.badge }, null, 0);
      expect(seatsOf(10, vpH).total, `面 ${h}`).toBe(0);
      expect(l, `面 ${h}`).toMatchObject({ items: [], more: null, corner: 0 });
      expect(l.order.ids).toEqual(['p9', 'p3']); // 順は持つ（面が替わって席ができれば出す）
    }
  });
  it('席が 1 つのとき：印の無いボードは入る 1 枚だけ（＋n も右上の札も出さない）。印のあるボードは今までどおり右上の札だけ', () => {
    const vp1 = { w: 400, h: 60 }; // 右の空き 250・片側 1 段、左の空き 0
    const view = { x: 0, y: 0, zoom: 1 };
    const two = [card('a', { createdAt: 1 }), card('b', { y: 10, createdAt: 2 })];
    expect(calloutSeats(calloutBands(view, two, HEX_BOX, vp1), vp1)).toMatchObject({ left: { n: 0 }, right: { n: 1 }, total: 1 });
    const plain = calloutLayout({ view, viewport: vp1, box: HEX_BOX, cards: two, recent: ['b', 'a'], exclude: none, badge: HEX_GEO.badge }, null, 0);
    expect(plain.items.map((i) => [i.id, i.n, i.like])).toEqual([['b', 1, 0]]);
    expect(plain).toMatchObject({ more: null, corner: 0 });
    const marked = calloutLayout({ view, viewport: vp1, box: HEX_BOX, cards: two.map((c) => ({ ...c, like: 1 as const })), recent: [], exclude: none, badge: HEX_GEO.badge }, null, 0);
    expect(marked).toMatchObject({ items: [], more: null, corner: 2 });
  });
});

describe('MK8b：番号の小札（calloutBadgeAt・calloutLayout の badges・geo.badge）', () => {
  it('形ごとの点：四角は箱の左上の角、六角は上の頂点（箱の左上から (75, 0)。頂点が上の正六角で、中心 (75, 86.6) の真上）', () => {
    expect(SQUARE_GEO.badge).toEqual({ x: 0, y: 0 });
    expect(HEX_GEO.badge).toEqual({ x: HEX.w / 2, y: 0 });
    expect(HEX_GEO.badge.x).toBe(75);
  });
  it('小札の中心は、カードの描いている位置に点を足して画面へ移した所（面の左上からの画素。倍率 0.25 と 1）', () => {
    expect(calloutBadgeAt({ x: 318, y: 6, zoom: 0.25 }, { x: 166, y: 144 }, HEX_GEO.badge)).toEqual({ x: 318 + (166 + 75) * 0.25, y: 6 + 144 * 0.25 });
    expect(calloutBadgeAt({ x: -10, y: 20, zoom: 1 }, { x: 40, y: 50 }, SQUARE_GEO.badge)).toEqual({ x: 30, y: 70 });
    expect(calloutBadgeAt({ x: 5, y: 7, zoom: 0.5 }, { x: 100, y: 0 }, HEX_GEO.badge)).toEqual(boardToScreen({ x: 5, y: 7, zoom: 0.5 }, 175, 0));
  });
  const vp = { w: 840, h: 217 };
  const view = fitOf(20, vp);
  const marks: Partial<CalloutCard>[] = [{ like: 3 }, { like: 3 }, { like: 2 }, { like: 2, color: '水' }, { color: '若草' }, { color: '赤紫' }, { color: '水', like: 1 }, { like: 1 }, { like: 1 }, { like: 1 }];
  const cards = hexes(20).map((p, i) => card(`c${i}`, { ...p, createdAt: i, ...(marks[i] ?? {}) }));
  const input = { view, viewport: vp, box: HEX_BOX, cards, recent: [], exclude: none, badge: HEX_GEO.badge };
  it('小札は今の組で出す吹き出しのカードだけ、同じ番号で（＋n の先の組の分は出さない）。点はカードの上の頂点', () => {
    const l = calloutLayout(input, null, 0);
    expect(l.badges.map((b) => [b.id, b.n])).toEqual(l.items.map((i) => [i.id, i.n]));
    for (const b of l.badges) {
      const c = cards.find((x) => x.id === b.id)!;
      expect([b.x, b.y]).toEqual([(c.x + 75) * view.zoom + view.x, c.y * view.zoom + view.y]);
    }
    const second = calloutLayout(input, l.order, 1);
    expect(second.badges.map((b) => b.n)).toEqual([8, 9, 10]); // 次の組は通しの番号
  });
  it('左右に席が無い（右上の札だけ）・出すカードが無いときは、小札も出さない。四角のボードは左上の角', () => {
    const vp400 = { w: 840, h: 400 };
    const ten = hexes(10).map((p, i) => card(`t${i}`, { ...p, like: 1 }));
    expect(calloutLayout({ ...input, view: fitOf(10, vp400), viewport: vp400, cards: ten }, null, 0).badges).toEqual([]);
    expect(calloutLayout({ ...input, cards: [] }, null, 0).badges).toEqual([]);
    const sq = [card('s', { x: 400, y: 100, like: 2 })];
    const l = calloutLayout({ view: { x: 0, y: 0, zoom: 0.5 }, viewport: { w: 1200, h: 217 }, box: BOARD_CARD, cards: sq, recent: [], exclude: none, badge: SQUARE_GEO.badge }, null, 0);
    expect(l.badges).toEqual([{ id: 's', n: 1, x: 200, y: 50 }]);
  });
});

describe('MK8b：頭のダブルクリックの数え（calloutTap）・吹き出しの絵（calloutShot）', () => {
  const t = (id: string, at: number) => ({ id, at });
  it('同じカードの頭を 400ms 以内（カードのダブルクリックと同じ長さ）にもう一度押したら、そのカードへ跳ぶ。数え直す（3 回目は 1 回目）', () => {
    expect(PEEK_DOUBLE_MS).toBe(400);
    const first = calloutTap(null, t('a', 1000));
    expect(first).toEqual({ jump: null, next: t('a', 1000) });
    const second = calloutTap(first.next, t('a', 1400));
    expect(second).toEqual({ jump: 'a', next: null });
    expect(calloutTap(second.next, t('a', 1500))).toEqual({ jump: null, next: t('a', 1500) });
  });
  it('間が 400ms より長い・別のカードの頭なら、ダブルクリックにしない（押したカードを選ぶ 1 回目に数え直す。2 回目が同じ頭に当たるのは、層がその間作り直さないから：memo-board-callouts.test.ts）', () => {
    expect(calloutTap(t('a', 1000), t('a', 1401)).jump).toBeNull();
    expect(calloutTap(t('a', 1000), t('b', 1100))).toEqual({ jump: null, next: t('b', 1100) });
    expect(calloutTap(t('a', 1000), t('a', 900)).jump).toBeNull(); // 時刻が戻った
  });
  it('吹き出しの絵は、字の無いカード（文の頭が空）の顔の絵だけ。字があれば・顔の絵が無ければ空（頭だけ）', () => {
    expect(calloutShot('', 'shot1')).toBe('shot1');
    expect(calloutShot('写真の題', 'shot1')).toBe('');
    expect(calloutShot('', '')).toBe('');
    expect(calloutShot(calloutText(reply('', { image: 'shot1' })), 'shot1')).toBe('shot1');
  });
});

describe('字（頭・文の頭・＋n）', () => {
  it('頭は番号と印（♥2・色の記号）。印の無いときは番号だけ', () => {
    expect(calloutHead(3, 2, '水')).toBe('3 ♥2 ◎');
    expect(calloutHead(5, 0, '赤紫')).toBe('5 ☆');
    expect(calloutHead(12, 1, '若草')).toBe('12 ♥1 ▢');
    expect(calloutHead(1, 0, '')).toBe('1');
  });
  it('文の頭は cardLines の行を空白でつなぎ、40 字で切る（切ったら「…」）', () => {
    expect(calloutText(reply('  一行目  \n\n二行目'))).toBe('一行目 二行目');
    const long = 'あ'.repeat(30) + '\n' + 'い'.repeat(30);
    expect(calloutText(reply(long))).toBe(`${'あ'.repeat(30)} ${'い'.repeat(9)}…`);
    expect([...calloutText(reply('x'.repeat(40)))]).toHaveLength(40);
    const r = reply('見出し\n本文', { by: { who: 'main', name: 'AI' } });
    expect(calloutText(r)).toBe(cardLines(r).join(' '));
  });
  it('字の無いカード（写真だけ）は空（頭だけを出す。§9.2 に無い字は足さない）', () => {
    expect(calloutText(reply('', { image: 'shot1' }))).toBe('');
    expect(calloutText(reply(' \n ', { quote: { text: '引用', url: 'https://example.com/', title: '題' } }))).toBe('');
  });
  it('「＋n」の字と説明は §9.2 のとおり', () => {
    expect(calloutMoreText(3)).toBe('＋3');
    expect(calloutMoreTitle(3)).toBe('次の 3 枚');
  });
});

describe('MK3 との組み：印のカードがあるときの借りる高さの上限（calloutFaceCap・overviewNeedPx）', () => {
  // 下調べの例（research/06-divider.md §4.2・reviews/review.md）：境目を除いた高さ 508（割合 0.5 で上 254 ＝ 上の帯 37 ＋ 面 217）、六角 10 枚（外枠 814×462）
  const BAR = 37;
  const plain10 = hexes(10);
  const marked10 = plain10.map((p, i) => ({ ...p, like: i === 3 ? 2 : 0 }));
  const faceAfter = (needPx: number) => {
    const ratio = borrowUpperRatio(508, 0.5, needPx, 0);
    expect(ratio).not.toBeNull();
    return Math.round(ratio! * 508) - BAR; // 借りたあとの面の高さ
  };
  const seatsAt = (faceH: number) => seatsOf(10, { w: 840, h: faceH });
  it('印が無ければ今のまま（下 150 まで借りる）：面 321・倍率 0.617・空き約 169 で、席が無くなる', () => {
    const need = overviewNeedPx(plain10, { w: 840, h: 217 }, HEX_BOX);
    expect(need).toBe(276);
    const face = faceAfter(need);
    expect(face).toBe(321);
    expect(fitOf(10, { w: 840, h: face }).zoom).toBe(0.617);
    const bands = bandsOf(10, { w: 840, h: face })!;
    expect(Math.abs(bands.left - 169)).toBeLessThanOrEqual(1);
    expect(seatsAt(face).total).toBe(0);
    expect(seatsAt(217)).toMatchObject({ left: { n: 4 }, right: { n: 4 } }); // 借りなければ 4+4
  });
  it('印があれば、左右に空き 200 の席が残る高さまで（倍率の上限 (840 − 400 − 1 − 814 × 0.001) ÷ 814。切り捨てて 2 引く）：借りるのは 65、面 282 で 5+5', () => {
    const need = overviewNeedPx(marked10, { w: 840, h: 217 }, HEX_BOX);
    expect(need).toBe(Math.floor(462 * ((840 - 400 - 1 - 814 * 0.001) / 814) + FIT_PAD * 2) - CALLOUT_CAP_MARGIN - 217);
    expect(need).toBe(65);
    const face = faceAfter(need);
    expect(face).toBe(282);
    const bands = bandsOf(10, { w: 840, h: face })!;
    expect(bands.left).toBeGreaterThanOrEqual(200);
    expect(bands.right).toBeGreaterThanOrEqual(200);
    expect(seatsAt(face)).toMatchObject({ left: { n: 5 }, right: { n: 5 } });
    // 面が上限より 1〜2px 高くなっても、倍率は上限を超えないので席は残る（余り CALLOUT_CAP_MARGIN。アプリで面が何 px ずれるかは測っていない）
    for (const extra of [1, 2]) expect(seatsAt(face + extra).total, `+${extra}px`).toBe(10);
    // この例では 285 まで残る。286（倍率 0.541）だと、x の丸めで左は 200 ちょうどで残り、右は約 199.6 で消える
    expect(seatsAt(285).total).toBe(10);
    const ceil = bandsOf(10, { w: 840, h: 286 })!;
    expect(fitOf(10, { w: 840, h: 286 }).zoom).toBe(0.541);
    expect(ceil.left).toBe(200);
    expect(ceil.right).toBeCloseTo(199.626, 3);
    expect(seatsAt(286)).toMatchObject({ left: { n: 5 }, right: { n: 0 } });
  });
  it('今の面ですでに左右に席が無い（面 400・10 枚は倍率 0.788）なら上限をかけない（印が無いときと同じ）', () => {
    const vp = { w: 840, h: 400 };
    expect(seatsOf(10, vp).total).toBe(0);
    expect(overviewNeedPx(marked10, vp, HEX_BOX)).toBe(overviewNeedPx(plain10, vp, HEX_BOX));
  });
  it('借りても席が残る（上限が目当ての倍率に届く）ボードでは上限をかけない', () => {
    const two = hexes(2).map((p) => ({ ...p, color: '水' })); // 外枠 316×174：上限 440/316 は 1.2 より大きい
    const vp = { w: 840, h: 100 };
    expect(overviewNeedPx(two, vp, HEX_BOX)).toBe(overviewNeedPx(hexes(2), vp, HEX_BOX));
    expect(calloutFaceCap({ x: 0, w: 316, h: 174 }, 840, 0.37, 1.2, FIT_PAD)).toBeNull();
  });
  it('calloutFaceCap：外枠に大きさが無ければ null。外枠の端が原点から遠いほど少し低い（丸めのずれが大きい）。印の見方（like・color の無いものは印なし）', () => {
    expect(calloutFaceCap({ x: 0, w: 0, h: 462 }, 840, 0.3, 0.9, FIT_PAD)).toBeNull();
    expect(calloutFaceCap({ x: 0, w: 814, h: 462 }, 840, 0.392, 0.988, FIT_PAD)).toBe(282);
    expect(calloutFaceCap({ x: 0, w: 814, h: 462 }, 840, 0.6, 0.988, FIT_PAD)).toBeNull(); // 今の面ですでに席が無い（今の倍率が (840 − 400) ÷ 814 より大きい）
    expect(calloutFaceCap({ x: 0, w: 814, h: 1038 }, 840, 0.25, 0.988, FIT_PAD)).toBe(592);
    expect(calloutFaceCap({ x: 1001, w: 814, h: 1038 }, 840, 0.25, 0.988, FIT_PAD)).toBe(591);
    expect(calloutFaceCap({ x: -1815, w: 814, h: 1038 }, 840, 0.25, 0.988, FIT_PAD)).toBe(591); // 遠いほうの端（左の端 −1815）で見る
    expect([hasCalloutMark({}), hasCalloutMark({ like: 0, color: '' }), hasCalloutMark({ like: 1 }), hasCalloutMark({ color: '若草' })]).toEqual([false, false, true, true]);
  });
  // 見直しで見つかった例（直す前の上限 (面の幅 − 400) ÷ 外枠の幅 では、上限どおりの面か 1px 高い面で、片側の席が消えた）。印は 1 枚目だけ
  it('外枠が縦に長いボード・外枠の左端が 0 でないボードでも、上限どおりの面から 2px 高い面まで、左右に席が残る（直す前の高さでは片側が消える）', () => {
    const cases: [n: number, off: number, w: number, h: number, face: number, broken: number][] = [
      [42, 0, 698, 217, 568, 572], // 外枠 814×1470。直す前は上限の面 572 で右 199.89
      [16, 0, 983, 217, 466, 469], // 外枠 814×606。直す前は上限 468 の 1px 上で右 199.99
      [19, 0, 768, 217, 371, 374], // 外枠 814×750
      [30, 1001, 840, 217, 591, 595], // 外枠の左端 1001。直す前は上限の面 595 で右 199.71
      [40, 137, 700, 217, 519, 522], // 外枠の左端 137
      [37, 0, 707, 363, 531, 534], // 全体 800・割合 0.5 の面 363
      [20, 0, 843, 363, 440, 443], // 全体 800・割合 0.5 の面 363。直す前は 1px 上の 443 で右 199.998
    ];
    for (const [n, off, w, h, face, broken] of cases) {
      const pts = hexes(n).map((p, i) => ({ x: p.x + off, y: p.y, like: i === 0 ? 1 : 0 }));
      const seatsAtH = (fh: number) => calloutSeats(calloutBands(fitView(placementBounds(pts, HEX_BOX), { w, h: fh }), pts, HEX_BOX, { w, h: fh }), { w, h: fh });
      const label = `六角 ${n} 枚・左端 ${off}・幅 ${w}・面 ${h}`;
      expect(seatsAtH(h).left.n * seatsAtH(h).right.n, label).toBeGreaterThan(0); // 借りる前は左右に席がある
      expect(h + overviewNeedPx(pts, { w, h }, HEX_BOX), label).toBe(face);
      for (const k of [0, 1, 2]) {
        const s = seatsAtH(face + k);
        expect([s.left.n > 0, s.right.n > 0], `${label} +${k}px`).toEqual([true, true]);
      }
      const old = seatsAtH(broken);
      expect(old.left.n === 0 || old.right.n === 0, `${label} 直す前の ${broken}`).toBe(true);
    }
  });
  it('掃き出し：印があり、借りる前に左右とも席があれば、借りたあとの面（＋0〜2px）でも左右に席が残る（六角 2〜60 枚・四角 1〜6 列×1〜10 行・左端 4 通り・幅 700〜1300・面 176/217/260）', () => {
    const boards: { pts: { x: number; y: number }[]; box: CardSize }[] = [];
    for (let n = 2; n <= 60; n++) boards.push({ pts: hexes(n), box: HEX_BOX });
    for (let c = 1; c <= 6; c++)
      for (let r = 1; r <= 10; r++) {
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i < c; i++) for (let j = 0; j < r; j++) pts.push({ x: i * (BOARD_CARD.w + BOARD_CARD.gap), y: j * (BOARD_CARD.h + BOARD_CARD.gap) });
        boards.push({ pts, box: BOARD_CARD });
      }
    const both = (pts: readonly { x: number; y: number }[], box: CardSize, vp: { w: number; h: number }) => {
      const b = calloutBands(fitView(placementBounds(pts, box), vp), pts, box, vp)!;
      return b.left >= CALLOUT.minBand && b.right >= CALLOUT.minBand;
    };
    let capped = 0;
    const fails: string[] = [];
    for (const off of [0, 137, 1001, -2500]) {
      for (const b of boards) {
        const pts = b.pts.map((p, i) => ({ x: p.x + off, y: p.y, like: i === 0 ? 1 : 0 }));
        const plain = b.pts.map((p) => ({ x: p.x + off, y: p.y }));
        for (let w = 700; w <= 1300; w += 7) {
          for (const h of [176, 217, 260]) {
            if (!both(pts, b.box, { w, h })) continue;
            const need = overviewNeedPx(pts, { w, h }, b.box);
            if (need !== overviewNeedPx(plain, { w, h }, b.box)) capped++;
            for (const k of need > 0 ? [0, 1, 2] : [0]) if (!both(pts, b.box, { w, h: h + Math.max(0, need) + k })) fails.push(`${b.pts.length} 枚・左端 ${off}・幅 ${w}・面 ${h} +${k}`);
          }
        }
      }
    }
    expect(capped).toBeGreaterThan(10000); // 上限がかかる場合を十分に通っている
    expect(fails).toEqual([]);
  });
});

describe('型', () => {
  it('CalloutOrder の ids は読むだけ（前の順を書き換えない）', () => {
    const prev: CalloutOrder = { key: 'r', ids: ['a', 'b'], marked: false };
    const next = calloutOrder([card('a')], ['a'], none, prev);
    expect(prev.ids).toEqual(['a', 'b']);
    expect(next.ids).toEqual(['a']);
  });
});
