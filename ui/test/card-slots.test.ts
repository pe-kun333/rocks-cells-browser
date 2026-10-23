import { describe, expect, it } from 'vitest';

import { settledCount, withPending } from '../src/memo-card-order';
import { hasSlotGaps, lastPlaceableSlot, orderedTops, type Reply, topSlots, withMovedTop, withPackedTops, withPlacedTop } from '../src/threads';

const card = (id: string, rank?: number, at = 0): Reply => ({ id, parent: null, text: id, createdAt: at, ...(rank !== undefined ? { rank } : {}) }) as Reply;
const slotsOf = (replies: readonly Reply[] | null) => (replies ? Object.fromEntries(topSlots(replies)) : null);
// 4 枚（作った順 a b c d）：1 行目に 3 枚、2 行目に 1 枚
const four = () => [card('a', undefined, 1), card('b', undefined, 2), card('c', undefined, 3), card('d', undefined, 4)];

describe('topSlots', () => {
  it('rank が無ければ作った順に 0,1,2…', () => {
    expect(slotsOf(four())).toEqual({ a: 0, b: 1, c: 2, d: 3 });
  });
  it('rank は番地（間を空けてよい）。rank の無いカードは最後のカードの次から', () => {
    const r = [card('a', 0), card('b', 4), card('c', undefined, 5), card('d', undefined, 6)];
    expect(slotsOf(r)).toEqual({ a: 0, b: 4, c: 5, d: 6 });
    expect(hasSlotGaps(r)).toBe(true);
  });
  it('重なる番地は前のカードの次へずらす', () => {
    expect(slotsOf([card('a', 2, 1), card('b', 2, 2)])).toEqual({ a: 2, b: 3 });
  });
  it('置ける番地は、使っている行の次の 1 行まで', () => {
    expect(lastPlaceableSlot(topSlots(four()))).toBe(8); // 2 行使用 → 3 行目の最後
    expect(lastPlaceableSlot(new Map())).toBe(2);
  });
});

describe('withPlacedTop（利用者の例：3＋1 枚）', () => {
  it('d を 2 行目の 2 列目・3 列目へ', () => {
    expect(slotsOf(withPlacedTop(four(), 'd', 4))).toEqual({ a: 0, b: 1, c: 2, d: 4 });
    expect(slotsOf(withPlacedTop(four(), 'd', 5))).toEqual({ a: 0, b: 1, c: 2, d: 5 });
  });
  it('3 行目の 1〜3 列目へ', () => {
    for (const slot of [6, 7, 8]) expect(slotsOf(withPlacedTop(four(), 'd', slot))?.d).toBe(slot);
  });
  it('a を 3 行目へ動かすと 1 行目の 1 列目は空く（ほかは動かない）', () => {
    expect(slotsOf(withPlacedTop(four(), 'a', 7))).toEqual({ a: 7, b: 1, c: 2, d: 3 });
  });
  it('埋まっている・同じ所・次の行より後ろ・負は置けない', () => {
    expect(withPlacedTop(four(), 'd', 1)).toBeNull();
    expect(withPlacedTop(four(), 'd', 3)).toBeNull();
    expect(withPlacedTop(four(), 'd', 9)).toBeNull();
    expect(withPlacedTop(four(), 'd', -1)).toBeNull();
    expect(withPlacedTop(four(), 'x', 5)).toBeNull();
  });
  it('置くと一番上のカード全部に rank（返信は触らない）', () => {
    const reply = { id: 'r', parent: 'a', text: 'r', createdAt: 9 } as Reply;
    const next = withPlacedTop([...four(), reply], 'd', 5) as Reply[];
    expect(next.filter((r) => r.parent === null).map((r) => r.rank)).toEqual([0, 1, 2, 5]);
    expect(next.find((r) => r.id === 'r')?.rank).toBeUndefined();
  });
});

describe('withMovedTop（差し込み：次の空きまで押す）', () => {
  it('空きの無い並びは今までと同じ（前へ・後ろへ・最後へ）', () => {
    expect(slotsOf(withMovedTop(four(), 'd', 'a'))).toEqual({ d: 0, a: 1, b: 2, c: 3 });
    expect(slotsOf(withMovedTop(four(), 'a', 'c'))).toEqual({ b: 0, a: 1, c: 2, d: 3 });
    expect(slotsOf(withMovedTop(four(), 'a', null))).toEqual({ b: 0, c: 1, d: 2, a: 3 });
    expect(withMovedTop(four(), 'a', 'b')).toBeNull();
    expect(withMovedTop(four(), 'd', null)).toBeNull();
  });
  it('空きがあれば、前のカードから次の空きまでを押す（ほかの空きは残る）', () => {
    // a b c / _ d _ / _ _ e
    const r = [card('a', 0), card('b', 1), card('c', 2), card('d', 4), card('e', 8)];
    // e を b の前へ：b c は 3 の空きまで押される。d と 2 行目の空きは残る。e の元の 8 は空く
    expect(slotsOf(withMovedTop(r, 'e', 'b'))).toEqual({ a: 0, e: 1, b: 2, c: 3, d: 4 });
    // a を d の前へ（間に空き）：d だけ 5 へ押す。a の元の 0 は空く
    expect(slotsOf(withMovedTop(r, 'a', 'd'))).toEqual({ b: 1, c: 2, a: 4, d: 5, e: 8 });
  });
  it('間がすき間なく続いていれば、穴を作らない（後ろへ）', () => {
    const r = [card('a', 0), card('b', 1), card('c', 2), card('d', 6)];
    expect(slotsOf(withMovedTop(r, 'a', 'c'))).toEqual({ b: 0, a: 1, c: 2, d: 6 });
  });
});

describe('withPackedTops（詰める）', () => {
  it('並べた順のまま 0,1,2…', () => {
    const r = [card('a', 1), card('b', 4), card('c', 8)];
    expect(slotsOf(withPackedTops(r))).toEqual({ a: 0, b: 1, c: 2 });
    expect(withPackedTops(four())).toBeNull();
  });
});

describe('待ちの並び（区画の先に見せる並び）', () => {
  it('place・pack を当てる', () => {
    const shown = withPending(four(), [{ kind: 'place', id: 'd', slot: 5, at: 0 }]);
    expect(slotsOf(shown)).toEqual({ a: 0, b: 1, c: 2, d: 5 });
    const packed = withPending(shown, [{ kind: 'pack', at: 0 }]);
    expect(slotsOf(packed)).toEqual({ a: 0, b: 1, c: 2, d: 3 });
  });
  it('当てられない place（埋まっている）は飛ばす', () => {
    expect(slotsOf(withPending(four(), [{ kind: 'place', id: 'd', slot: 0, at: 0 }]))).toEqual({ a: 0, b: 1, c: 2, d: 3 });
  });
  it('写しが追いついたら捨てる', () => {
    const placed = withPlacedTop(four(), 'd', 5) as Reply[];
    expect(settledCount(four(), [{ kind: 'place', id: 'd', slot: 5, at: 0 }])).toBe(0);
    expect(settledCount(placed, [{ kind: 'place', id: 'd', slot: 5, at: 0 }])).toBe(1);
    expect(settledCount(placed, [{ kind: 'pack', at: 0 }])).toBe(0);
    expect(settledCount(withPackedTops(placed) as Reply[], [{ kind: 'pack', at: 0 }])).toBe(1);
  });
  it('読み順（前の版・書き出し）は番地の順', () => {
    const r = withPlacedTop(four(), 'a', 7) as Reply[];
    expect(orderedTops(r).map((x) => x.id)).toEqual(['b', 'c', 'd', 'a']);
  });
});
