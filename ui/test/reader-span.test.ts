// 六角で見る（動画の区間セル）の区間を、読む画面のマスへ当てる関数（plan-reader-video の V0b）：指紋・時刻の当て直し・マスごとの数
import { describe, expect, it } from 'vitest';
import { cellsOfSpan, countLinksByCell, itemsAtCell, locateSpan, type SpanCell } from '../src/reader-span';
import type { ReplySpan } from '../src/reader-links';

// 上の例で使うマスの並び（0 は 0〜5 秒、1 は 5〜10 秒、2 は 10〜15 秒）
const cells: SpanCell[] = [
  { key: 'a', start: 0, end: 5 },
  { key: 'b', start: 5, end: 10 },
  { key: 'c', start: 10, end: 15 },
];
const span = (key: string, start: number, end: number): ReplySpan => ({ key, start, end });

describe('locateSpan（区間のマスの番号。指紋を先に、だめなら時刻で当て直す）', () => {
  it('指紋が合えばその番号', () => {
    expect(locateSpan(cells, span('b', 5, 10))).toBe(1);
  });

  it('指紋が無ければ時刻で当て直す（始まりのずれが 2 秒以内で、区間と重なるマス）', () => {
    expect(locateSpan(cells, span('zz', 5.5, 9))).toBe(1);
    expect(locateSpan(cells, span('zz', 30, 35))).toBe(-1);
  });

  it('長さ 0 の区間：始まりを含むマスを重なりとみなし、始まりのずれが 2 秒以内のときだけ当てる', () => {
    expect(locateSpan(cells, span('zz', 4, 4))).toBe(-1); // マス 0 は始まりから 4 秒ずれている
    expect(locateSpan(cells, span('zz', 9.5, 9.5))).toBe(-1); // マス 1 は始まりから 4.5 秒ずれている
    expect(locateSpan(cells, span('zz', 10.5, 10.5))).toBe(2);
  });

  it('同じ指紋が二つあれば前のマス', () => {
    const dup: SpanCell[] = [
      { key: 'd', start: 0, end: 5 },
      { key: 'd', start: 5, end: 10 },
    ];
    expect(locateSpan(dup, span('d', 5, 10))).toBe(0);
  });

  it('時刻の候補が二つあるときは、始まりが近い方（同じなら番号の小さい方）', () => {
    const two: SpanCell[] = [
      { key: 'x', start: 0, end: 3 },
      { key: 'y', start: 3, end: 6 },
    ];
    expect(locateSpan(two, span('zz', 2.5, 5))).toBe(1); // 始まり 3 の方が 0.5 秒で近い
    const near: SpanCell[] = [
      { key: 'x', start: 0, end: 6 },
      { key: 'y', start: 1.5, end: 6 },
    ];
    expect(locateSpan(near, span('zz', 2, 4))).toBe(1); // x も許しの内（2 秒ずれ）だが、y（0.5 秒）の方が近い
    const tie: SpanCell[] = [
      { key: 'x', start: 0, end: 5 },
      { key: 'y', start: 2, end: 6 },
    ];
    expect(locateSpan(tie, span('zz', 1, 3))).toBe(0); // 始まりのずれは両方 1 秒。番号の小さい方
  });

  it('マスが空なら -1。時刻の無いマスは時刻の当て直しに入らない', () => {
    expect(locateSpan([], span('zz', 0, 1))).toBe(-1);
    expect(locateSpan([{ key: 'a' }], span('zz', 0, 1))).toBe(-1);
  });
});

describe('cellsOfSpan（区間にかかるマスの番号。小さい順・重なりなし）', () => {
  it('区間が二つのマスにまたがる', () => {
    expect(cellsOfSpan(cells, span('a', 0, 10))).toEqual([0, 1]);
  });

  it('端が触れるだけのマスは入らない', () => {
    expect(cellsOfSpan(cells, span('b', 5, 10))).toEqual([1]);
  });

  it('指紋が合わなくても、時刻で重なるマスと当て直したマスを入れる', () => {
    expect(cellsOfSpan(cells, span('zz', 3, 12))).toEqual([0, 1, 2]);
  });

  it('時刻の当て直しの許しは使わず、区間と重なるマスはすべて入る', () => {
    expect(cellsOfSpan(cells, span('zz', 0, 12))).toEqual([0, 1, 2]);
  });

  it('時刻の無いマスは、指紋が合えば入る', () => {
    expect(cellsOfSpan([{ key: 'a' }, { key: 'b' }], span('b', 0, 1))).toEqual([1]);
  });

  it('マスが空なら []', () => {
    expect(cellsOfSpan([], span('zz', 0, 1))).toEqual([]);
  });
});

describe('countLinksByCell（マスごとに結んだカードの数）', () => {
  it('同じマスに当たる区間は 1 つの項目で 1 だけ。AI の項目は範囲の始まりのマスにだけ数える', () => {
    const items = [
      { spans: [span('a', 0, 5), span('zz', 0.5, 4)] },
      { spans: [span('c', 10, 15)] },
      { ai: true, spans: [span('a', 0, 15)] },
    ];
    expect(countLinksByCell(cells, items)).toEqual([2, 0, 1]);
  });

  it('AI の項目が範囲の始まりのマスだけに数えるとき、ほかのマスには数えない', () => {
    expect(countLinksByCell(cells, [{ ai: true, spans: [span('a', 0, 15)] }])).toEqual([1, 0, 0]);
  });

  it('AI の項目で spans が空なら何もしない', () => {
    expect(countLinksByCell(cells, [{ ai: true, spans: [] }])).toEqual([0, 0, 0]);
  });

  it('見つからない区間は数えない', () => {
    expect(countLinksByCell(cells, [{ spans: [span('zz', 30, 35)] }])).toEqual([0, 0, 0]);
  });

  it('マスが空なら []', () => {
    expect(countLinksByCell([], [{ spans: [span('zz', 0, 1)] }])).toEqual([]);
  });
});

describe('itemsAtCell（そのマスに結んだ項目の番号。▤n と同じ数え方）', () => {
  const items = [
    { spans: [span('zz', 30, 35), span('b', 5, 10)] },
    { spans: [span('c', 10, 15)] },
    { ai: true, spans: [span('a', 0, 15)] },
    { ai: true, spans: [span('b', 5, 6)] },
  ];

  it('区間のどれかが当たる項目。AI の項目は範囲の始まりのマスだけ', () => {
    expect(itemsAtCell(cells, items, 0)).toEqual([2]);
    expect(itemsAtCell(cells, items, 1)).toEqual([0, 3]);
    expect(itemsAtCell(cells, items, 2)).toEqual([1]);
  });

  it('countLinksByCell の数と合う', () => {
    const counts = countLinksByCell(cells, items);
    expect(cells.map((_, i) => itemsAtCell(cells, items, i).length)).toEqual(counts);
  });

  it('番号がマスの外・マスが空なら []', () => {
    expect(itemsAtCell(cells, items, -1)).toEqual([]);
    expect(itemsAtCell(cells, items, 3)).toEqual([]);
    expect(itemsAtCell([], items, 0)).toEqual([]);
  });
});
