import { describe, expect, it } from 'vitest';
import { BOARD_CARD, BOARD_LIMITS } from '../src/memo-card-board';
import {
  cardNear,
  EMPTY_TAP_PX,
  emptyTap,
  groupDragPositions,
  marqueeHits,
  marqueeRect,
  marqueeSelection,
  pressSelect,
  pruneSelection,
  sameSelection,
  selectAll,
  selectionCountText,
} from '../src/memo-card-board-select';
import { HEX_NEAR, hexOutside } from '../src/memo-card-board-hex';
import { dragPosition } from '../src/memo-card-board-view';

const view = (zoom: number, x = 0, y = 0) => ({ x, y, zoom });
const set = (...r: string[]) => new Set(r);

describe('カードを押したときの選び方（pressSelect）', () => {
  it('ふつうに押す：選んでいなければ、そのカードだけを選んで動かす', () => {
    expect(pressSelect(set(), 'a', false)).toEqual({ selection: set('a'), drag: ['a'], collapse: false });
    expect(pressSelect(set('b', 'c'), 'a', false)).toEqual({ selection: set('a'), drag: ['a'], collapse: false });
  });
  it('選んでいるカードを押す：選びはそのまま、選んだ全部を動かす。複数選びの中の 1 枚なら、動かさず離したとき 1 枚だけにする印（collapse）', () => {
    expect(pressSelect(set('a', 'b'), 'a', false)).toEqual({ selection: set('a', 'b'), drag: ['a', 'b'], collapse: true });
    expect(pressSelect(set('a'), 'a', false)).toEqual({ selection: set('a'), drag: ['a'], collapse: false });
  });
  it('Shift で押す：足す・外す（動かさない）', () => {
    expect(pressSelect(set('a'), 'b', true)).toEqual({ selection: set('a', 'b'), drag: [], collapse: false });
    expect(pressSelect(set('a', 'b'), 'a', true)).toEqual({ selection: set('b'), drag: [], collapse: false });
    expect(pressSelect(set(), 'a', true).selection).toEqual(set('a'));
  });
  it('元の選びは書き換えない', () => {
    const s = set('a');
    pressSelect(s, 'b', true);
    pressSelect(s, 'b', false);
    expect([...s]).toEqual(['a']);
  });
});

describe('選びの手入れ', () => {
  it('全部選ぶ・同じかどうか', () => {
    expect(selectAll(['a', 'b', 'a'])).toEqual(set('a', 'b'));
    expect(sameSelection(set('a', 'b'), set('b', 'a'))).toBe(true);
    expect(sameSelection(set('a'), set('a', 'b'))).toBe(false);
    expect(sameSelection(set('a'), set('b'))).toBe(false);
  });
  it('描かれていないカードを外す。減らなければ同じ集まり', () => {
    const s = set('a', 'b', 'x');
    expect(pruneSelection(s, set('a', 'b', 'c'))).toEqual(set('a', 'b'));
    const t = set('a');
    expect(pruneSelection(t, set('a', 'b'))).toBe(t);
    expect(pruneSelection(set('a'), set()).size).toBe(0);
  });
  it('件数の文：選んでいなければ「n枚」、選んでいれば選んだ数も。カードが無ければ空', () => {
    expect(selectionCountText(0, 0)).toBe('');
    expect(selectionCountText(7, 0)).toBe('7枚');
    expect(selectionCountText(7, 3)).toBe('7枚（3枚を選択中）');
  });
});

describe('範囲選択（Shift＋空きのドラッグ）', () => {
  it('四角は 2 点の向きによらない', () => {
    expect(marqueeRect({ x: 50, y: 40 }, { x: 10, y: 90 })).toEqual({ x: 10, y: 40, w: 40, h: 50 });
    expect(marqueeRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, w: 0, h: 0 });
  });
  const cards = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 210, y: 0 }],
    ['c', { x: 0, y: 116 }],
  ]);
  it('四角に少しでも掛かるカードが入る（拡大率 1・パンなし）', () => {
    expect(marqueeHits(view(1), { x: 150, y: 10 }, { x: 230, y: 50 }, cards)).toEqual(['a', 'b']); // a の右はし（190）と b の左はし（210）の両方に掛かる
    expect(marqueeHits(view(1), { x: 195, y: 10 }, { x: 205, y: 50 }, cards)).toEqual([]); // 隙間だけ
    expect(marqueeHits(view(1), { x: 0, y: 0 }, { x: 400, y: 300 }, cards)).toEqual(['a', 'b', 'c']);
    expect(marqueeHits(view(1), { x: 230, y: 50 }, { x: 150, y: 10 }, cards)).toEqual(['a', 'b']); // 逆向きでも同じ
  });
  it('拡大率とパンを反映する（画面の画素 → ボード座標）', () => {
    // zoom 2・パン (100, 50)：a は画面の (100..480, 50..242)、b は (520..)
    expect(marqueeHits(view(2, 100, 50), { x: 90, y: 40 }, { x: 110, y: 60 }, cards)).toEqual(['a']);
    expect(marqueeHits(view(2, 100, 50), { x: 500, y: 40 }, { x: 530, y: 60 }, cards)).toEqual(['b']);
    expect(marqueeHits(view(2, 100, 50), { x: 0, y: 0 }, { x: 90, y: 40 }, cards)).toEqual([]);
    // 縮小（0.5）：b は画面の 105..200
    expect(marqueeHits(view(0.5), { x: 150, y: 10 }, { x: 160, y: 20 }, cards)).toEqual(['b']);
  });
  it('四角の大きさが 0 の点でも、そのカードの中なら入る', () => {
    expect(marqueeHits(view(1), { x: 20, y: 20 }, { x: 20, y: 20 }, cards)).toEqual(['a']);
    expect(BOARD_CARD.w).toBe(190);
  });
  it('結果は、始めたときの選びに足したもの', () => {
    expect(marqueeSelection(set('x'), ['a', 'b'])).toEqual(set('x', 'a', 'b'));
    expect(marqueeSelection(set('a'), ['a'])).toEqual(set('a'));
    expect(marqueeSelection(set(), [])).toEqual(set());
  });
});

describe('まとめて動かす（groupDragPositions）', () => {
  const starts = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 210, y: 116 }],
  ]);
  it('全部が同じ量だけ動く（拡大率で割る）。並びの形は変わらない', () => {
    const out = groupDragPositions(starts, { dx: 30, dy: -10 }, view(1));
    expect(out.get('a')).toEqual({ x: 30, y: -10 });
    expect(out.get('b')).toEqual({ x: 240, y: 106 });
    const z = groupDragPositions(starts, { dx: 30, dy: -10 }, view(2));
    expect(z.get('a')).toEqual({ x: 15, y: -5 });
    expect(z.get('b')).toEqual({ x: 225, y: 111 });
  });
  it('パンは動きの量に効かない。元の位置は書き換えない', () => {
    const out = groupDragPositions(starts, { dx: 10, dy: 10 }, view(1, 700, -300));
    expect(out.get('a')).toEqual({ x: 10, y: 10 });
    expect(starts.get('a')).toEqual({ x: 0, y: 0 });
  });
  it('1 枚だけのときは dragPosition と同じ値（B2-1 と食い違わない）', () => {
    for (const zoom of [0.25, 0.5, 0.9, 1, 1.37, 2]) {
      for (const [dx, dy] of [[0, 0], [3, -3], [7.5, 2.5], [-33, 41], [1234, -987]]) {
        for (const s of [{ x: 0, y: 0 }, { x: 10, y: -10 }, { x: 9990, y: -9990 }]) {
          expect(groupDragPositions(new Map([['a', s]]), { dx, dy }, view(zoom)).get('a')).toEqual(dragPosition(s, { dx, dy }, view(zoom)));
        }
      }
    }
  });
  it('端（±10,000）では、全体がそこで止まる（形が崩れない）', () => {
    const edge = new Map([
      ['a', { x: 9900, y: 0 }],
      ['b', { x: 9000, y: 50 }],
    ]);
    const out = groupDragPositions(edge, { dx: 5000, dy: 0 }, view(1));
    expect(out.get('a')).toEqual({ x: BOARD_LIMITS.coord, y: 0 });
    expect(out.get('b')).toEqual({ x: 9100, y: 50 }); // 差 900 のまま
    const left = groupDragPositions(edge, { dx: -50000, dy: -50000 }, view(1));
    expect(left.get('b')).toEqual({ x: -BOARD_LIMITS.coord, y: -BOARD_LIMITS.coord + 50 });
    expect(left.get('a')).toEqual({ x: -BOARD_LIMITS.coord + 900, y: -BOARD_LIMITS.coord });
  });
  it('0 枚なら空', () => {
    expect(groupDragPositions(new Map(), { dx: 10, dy: 10 }, view(1)).size).toBe(0);
  });
  it('動かす量は整数（保存する値と同じ丸め）', () => {
    const out = groupDragPositions(starts, { dx: 10.4, dy: 10.6 }, view(1));
    expect(out.get('a')).toEqual({ x: 10, y: 11 });
    for (const p of out.values()) expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
  });
});

describe('点のすぐ近くのカード（cardNear。TA4a：空きの右クリックで、縁のすぐ外をそのカードに数える）', () => {
  // 仮の並びの 3 枚（すき間 16）：a (0,0)・b (166,0)・c (83,144)
  const pos = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 166, y: 0 }],
    ['c', { x: 83, y: 144 }],
  ]);
  const near = (p: { x: number; y: number }) => cardNear(pos, p, hexOutside, HEX_NEAR);
  it('縁から 9 までは、そのカード。それより外は null', () => {
    expect(near({ x: -8, y: 86.6 })).toBe('a'); // a の左の縁の外 8
    expect(near({ x: -10, y: 86.6 })).toBeNull(); // 外 10
    expect(near({ x: 2, y: 2 })).toBeNull(); // 箱の角（外 37.5）
    expect(near({ x: 75, y: 86.6 })).toBe('a'); // 中
  });
  it('すき間では、近い方のカード。同じ近さなら先のカード', () => {
    expect(near({ x: 155, y: 86.6 })).toBe('a'); // a の右の縁から 5、b の左の縁から 11
    expect(near({ x: 161, y: 86.6 })).toBe('b');
    expect(near({ x: 158, y: 86.6 })).toBe('a'); // すき間の真ん中（どちらからも 8）
  });
  it('3 枚の集まる所でも、どれかのカードになる（詰まった並びのすき間に、空きは無い）', () => {
    expect(near({ x: 158, y: 135 })).not.toBeNull();
  });
  it('幅が 0（四角）なら、中だけ。カードが無ければ null', () => {
    expect(cardNear(pos, { x: -1, y: 86.6 }, hexOutside, 0)).toBeNull();
    expect(cardNear(pos, { x: 0, y: 86.6 }, hexOutside, 0)).toBe('a');
    expect(cardNear(new Map(), { x: 0, y: 0 }, hexOutside, HEX_NEAR)).toBeNull();
  });
});

describe('空きのダブルクリックの数え方（emptyTap。TA7）', () => {
  const tap = (x: number, y: number, t: number) => ({ x, y, t });
  it('1 回目は覚えるだけ。同じ所を 400 ミリ秒の内に押した 2 回目がダブルクリック。そのあとは空', () => {
    const first = emptyTap(null, tap(100, 100, 1000), 400);
    expect(first).toEqual({ double: false, next: tap(100, 100, 1000) });
    const second = emptyTap(first.next, tap(102, 101, 1300), 400);
    expect(second).toEqual({ double: true, next: null });
    expect(emptyTap(second.next, tap(102, 101, 1400), 400).double).toBe(false); // 3 回目は、次の 1 回目
  });
  it('400 ミリ秒の内と外（ちょうどは内。カードのダブルクリックと同じ）', () => {
    const prev = tap(0, 0, 1000);
    expect(emptyTap(prev, tap(0, 0, 1400), 400).double).toBe(true);
    expect(emptyTap(prev, tap(0, 0, 1401), 400)).toEqual({ double: false, next: tap(0, 0, 1401) }); // 間の空いた 2 回目は、次の 1 回目になる
  });
  it('8 画素の内と外。離れた 2 回目は、次の 1 回目になる', () => {
    const prev = tap(100, 100, 1000);
    expect(EMPTY_TAP_PX).toBe(8);
    expect(emptyTap(prev, tap(108, 100, 1100), 400).double).toBe(true);
    expect(emptyTap(prev, tap(106, 106, 1100), 400).double).toBe(false); // 斜めに 8.5
    const far = emptyTap(prev, tap(300, 100, 1100), 400);
    expect(far).toEqual({ double: false, next: tap(300, 100, 1100) });
    expect(emptyTap(far.next, tap(301, 100, 1200), 400).double).toBe(true);
  });
  it('時刻が戻っていたら数えない。幅は渡せる', () => {
    expect(emptyTap(tap(0, 0, 2000), tap(0, 0, 1900), 400).double).toBe(false);
    expect(emptyTap(tap(0, 0, 1000), tap(20, 0, 1100), 400, 24).double).toBe(true);
  });
});
