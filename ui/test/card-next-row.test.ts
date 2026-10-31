import { describe, expect, it } from 'vitest';

import {
  addedCardPlaceText,
  CARD_COLUMNS,
  lastPlaceableSlot,
  MAX_RANK,
  MAX_REPLIES,
  nextRowAddPlan,
  nextRowSlot,
  type Reply,
  topSlots,
  withReplyOnNextRow,
} from '../src/threads';

const card = (id: string, rank?: number, at = 0): Reply => ({ id, parent: null, text: id, createdAt: at, ...(rank !== undefined ? { rank } : {}) });
const slotsOf = (replies: readonly Reply[]) => Object.fromEntries(topSlots(replies));

describe('nextRowSlot（次の行の 1 列目）', () => {
  it('カードが 0 枚なら番地 0', () => {
    expect(nextRowSlot([])).toBe(0);
  });
  it('一番下のカードがある行の次の行の 1 列目（番地 = (最後の行 + 1) × 3）', () => {
    expect(nextRowSlot([card('a', 0)])).toBe(3); // 1 行目の 1 列目の次は 2 行目の 1 列目
    expect(nextRowSlot([card('a', 0), card('b', 1)])).toBe(3);
    expect(nextRowSlot([card('a', 0), card('b', 1), card('c', 2)])).toBe(3); // 行の最後の次も、同じ行の次の 1 列目
    expect(nextRowSlot([card('a', 0), card('b', 1), card('c', 2), card('d', 3)])).toBe(6);
    expect(nextRowSlot([card('a', 0), card('b', 4)])).toBe(6); // 空きがあっても、いちばん下の行の次
  });
  it('rank の無いカードも、今見えている番地のいちばん下から数える', () => {
    expect(nextRowSlot([card('a', undefined, 1), card('b', undefined, 2)])).toBe(3);
  });
  it('返信は番地に入らない（一番上のカードだけ）', () => {
    const reply = { id: 'r', parent: 'a', text: 'r', createdAt: 9 } as Reply;
    expect(nextRowSlot([card('a', 1), reply])).toBe(3);
  });
  it('置ける範囲（lastPlaceableSlot・MAX_RANK）の中', () => {
    const replies = [card('a', 0), card('b', 1), card('c', 2), card('d', 4)];
    const slot = nextRowSlot(replies);
    expect(slot).toBe(6);
    expect(slot).toBeLessThanOrEqual(lastPlaceableSlot(topSlots(replies)));
    expect(slot).toBeLessThanOrEqual(MAX_RANK);
  });
  it('MAX_RANK を越える次の行は null（ふつうの次の番地に足す）', () => {
    expect(nextRowSlot([card('a', MAX_RANK)])).toBeNull();
    // 次の行の 1 列目が MAX_RANK ぴったりなら置ける
    const onCap = (Math.floor(MAX_RANK / CARD_COLUMNS) - 1) * CARD_COLUMNS + (CARD_COLUMNS - 1); // その行の最後の列が、次の行の頭を MAX_RANK 以下にする
    expect(onCap % CARD_COLUMNS).toBe(CARD_COLUMNS - 1);
    const head = (Math.floor(onCap / CARD_COLUMNS) + 1) * CARD_COLUMNS;
    expect(head).toBeLessThanOrEqual(MAX_RANK);
    expect(nextRowSlot([card('a', onCap)])).toBe(head);
  });
});

describe('withReplyOnNextRow（withReply のあとに次の行へ）', () => {
  it('0 枚なら番地 0 に足す', () => {
    const placed = withReplyOnNextRow([], null, 'はじめ');
    expect(placed).not.toBeNull();
    expect(placed?.nextRow).toBe(true);
    expect(placed?.slot).toBe(0);
    expect(slotsOf(placed?.replies ?? [])).toEqual({ [placed?.reply.id ?? '']: 0 });
  });
  it('いちばん下の次の行の 1 列目に置き、ほかのカードは動かさない', () => {
    const replies = [card('a', undefined, 1), card('b', undefined, 2)];
    const placed = withReplyOnNextRow(replies, null, '新しい');
    expect(placed?.nextRow).toBe(true);
    expect(placed?.slot).toBe(3);
    expect(slotsOf(placed?.replies ?? [])).toEqual({ a: 0, b: 1, [placed?.reply.id ?? '']: 3 });
    // rank の無かったカードは、見えていた番地のまま固定する（withPlacedTop）
    expect(placed?.replies.find((r) => r.id === 'a')?.rank).toBe(0);
    expect(placed?.replies.find((r) => r.id === 'b')?.rank).toBe(1);
    expect(placed?.reply.rank).toBe(3);
  });
  it('空きの向こうのカードも、今の番地のまま', () => {
    // b は 2 行目の 1 列目（番地 3）。rank の無い c はその次（4）。次の行の 1 列目は 6 で、ふつうの次（5）とは違う
    const replies = [card('a', 0), card('b', 3), card('c', undefined, 5)];
    const placed = withReplyOnNextRow(replies, null, '新しい');
    expect(placed?.slot).toBe(6);
    expect(slotsOf(placed?.replies ?? [])).toEqual({ a: 0, b: 3, c: 4, [placed?.reply.id ?? '']: 6 });
    expect(placed?.replies.find((r) => r.id === 'b')?.rank).toBe(3);
    expect(placed?.replies.find((r) => r.id === 'c')?.rank).toBe(4);
  });
  it('行が埋まっていて、ふつうの次の番地がすでに次の行の 1 列目なら、rank は足さない', () => {
    const replies = [card('a', 0), card('b', 1), card('c', 2)];
    const placed = withReplyOnNextRow(replies, null, '新しい');
    expect(placed?.nextRow).toBe(true);
    expect(placed?.slot).toBe(3);
    expect(placed?.reply.rank).toBeUndefined();
    expect(placed?.replies.find((r) => r.id === 'a')?.rank).toBe(0);
    expect(placed?.replies.find((r) => r.id === 'c')?.rank).toBe(2);
  });
  it('返信（parent がある）は今までどおり。一番上の番地は動かさない', () => {
    const replies = [card('a', 0), card('b', 1)];
    const placed = withReplyOnNextRow(replies, 'a', '返信');
    expect(placed?.nextRow).toBe(false);
    expect(placed?.slot).toBeNull();
    expect(placed?.reply.parent).toBe('a');
    expect(placed?.reply.rank).toBeUndefined();
    expect(slotsOf(placed?.replies ?? [])).toEqual({ a: 0, b: 1 });
    expect(placed?.replies.find((r) => r.id === 'a')?.rank).toBe(0);
  });
  it('上限を越える次の行は、ふつうの次の番地に足す（ほかの rank は動かさない）', () => {
    const placed = withReplyOnNextRow([card('a', MAX_RANK)], null, '新しい');
    expect(placed?.nextRow).toBe(false);
    expect(placed?.slot).toBe(MAX_RANK + 1);
    expect(placed?.reply.rank).toBeUndefined();
    expect(placed?.replies.find((r) => r.id === 'a')?.rank).toBe(MAX_RANK);
  });
  it('件数の上限では足さない', () => {
    const replies = Array.from({ length: MAX_REPLIES }, (_, i) => card(`r${i}`, i, i));
    expect(withReplyOnNextRow(replies, null, '新しい')).toBeNull();
  });
  it('空の文は足さない', () => {
    expect(withReplyOnNextRow([card('a', 0)], null, '   ')).toBeNull();
  });
});

describe('nextRowAddPlan（足す前に、置く番地と落ちたかどうかを決める）', () => {
  it('次の行に置けるときはその番地', () => {
    expect(nextRowAddPlan([card('a', 0), card('b', 1)])).toEqual({ slot: 3, nextRow: true });
    expect(nextRowAddPlan([])).toEqual({ slot: 0, nextRow: true });
  });
  it('次の行が上限を越えるときは、ふつうの次の番地', () => {
    expect(nextRowAddPlan([card('a', MAX_RANK)])).toEqual({ slot: MAX_RANK + 1, nextRow: false });
  });
  it('件数の上限では足せない', () => {
    const replies = Array.from({ length: MAX_REPLIES }, (_, i) => card(`r${i}`, i, i));
    expect(nextRowAddPlan(replies)).toBeNull();
  });
});

describe('addedCardPlaceText（足したあとの行と列）', () => {
  it('次の行に置いたときと、ふつうの次の番地に落ちたとき', () => {
    expect(addedCardPlaceText(0, true)).toBe('コメントを 1 行目の 1 列目に足しました');
    expect(addedCardPlaceText(3, true)).toBe('コメントを 2 行目の 1 列目に足しました');
    expect(addedCardPlaceText(5, true)).toBe('コメントを 2 行目の 3 列目に足しました');
    expect(addedCardPlaceText(1, false)).toBe('次の行には置けないので、1 行目の 2 列目に足しました');
  });
});
