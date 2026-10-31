// 六角で見る（読む画面の下の区画）の時刻順の並び：動画の組・チャプターの区切り・結んでいないカード（plan-reader-video の V2b-a）
import { describe, expect, it } from 'vitest';
import { cardStart, timeOrder, type TimeChapter } from '../src/reader-time-order';

const ids = (cards: readonly { id: string }[]) => cards.map((card) => card.id);

// 上の例で使うカード（a と d は v1、c は v2、b は結んでいない）
const a = { id: 'a', at: { video: 'v1', title: 'ネタA', spans: [{ key: 'k1', start: 90, end: 95 }] } };
const b = { id: 'b' };
const c = { id: 'c', at: { video: 'v2', spans: [{ key: 'k2', start: 10, end: 12 }] } };
const d = { id: 'd', at: { video: 'v1', spans: [{ key: 'k3', start: 30, end: 33 }, { key: 'k4', start: 200, end: 201 }] } };

describe('timeOrder（時刻順の並びを組む）', () => {
  it('上の例の三つ（組・先に出す動画・チャプターの区切り）', () => {
    const out = timeOrder([a, b, c, d]);
    expect(out.groups).toEqual([
      { video: 'v1', title: 'ネタA', count: 2, sections: [{ title: null, start: null, cards: [d, a] }] },
      { video: 'v2', title: '動画', count: 1, sections: [{ title: null, start: null, cards: [c] }] },
    ]);
    expect(out.loose).toEqual([b]);

    expect(timeOrder([a, b, c, d], { first: 'v2' }).groups.map((g) => g.video)).toEqual(['v2', 'v1']);

    expect(
      timeOrder([a, b, c, d], { chapters: { video: 'v1', chapters: [{ start: 60, title: 'ハガキ1' }, { start: 0, title: 'オープニング' }] } }).groups[0].sections,
    ).toEqual([
      { title: 'オープニング', start: 0, cards: [d] },
      { title: 'ハガキ1', start: 60, cards: [a] },
    ]);
  });

  it('at の無いカードだけなら groups は空、loose は元の順', () => {
    const e = { id: 'e' };
    const out = timeOrder([b, e]);
    expect(out.groups).toEqual([]);
    expect(out.loose).toEqual([b, e]);
    expect(out.loose[0]).toBe(b);
  });

  it('空の配列は { groups: [], loose: [] }', () => {
    expect(timeOrder([])).toEqual({ groups: [], loose: [] });
  });

  it('同じ始まりの二枚は tops の順', () => {
    const p = { id: 'p', at: { video: 'v1', spans: [{ key: 'k5', start: 50, end: 55 }] } };
    const q = { id: 'q', at: { video: 'v1', spans: [{ key: 'k6', start: 50, end: 60 }] } };
    expect(ids(timeOrder([p, q]).groups[0].sections[0].cards)).toEqual(['p', 'q']);
    expect(ids(timeOrder([q, p]).groups[0].sections[0].cards)).toEqual(['q', 'p']);
  });

  it('first がカードの無い動画・null・省略なら、最初に出てきた順のままになる', () => {
    expect(timeOrder([a, b, c, d], { first: 'zz' }).groups.map((g) => g.video)).toEqual(['v1', 'v2']);
    expect(timeOrder([a, b, c, d], { first: null }).groups.map((g) => g.video)).toEqual(['v1', 'v2']);
    expect(timeOrder([a, b, c, d]).groups.map((g) => g.video)).toEqual(['v1', 'v2']);
  });

  it('組の題：最初のカードの題が空白だけなら次のカードの題。前後の空白は落とす。どれにも無ければ「動画」', () => {
    const t1 = { id: 't1', at: { video: 'v3', title: '   ', spans: [{ key: 'x1', start: 1, end: 2 }] } };
    const t2 = { id: 't2', at: { video: 'v3', title: ' 題B ', spans: [{ key: 'x2', start: 2, end: 3 }] } };
    expect(timeOrder([t1, t2]).groups[0].title).toBe('題B');

    const t3 = { id: 't3', at: { video: 'v4', title: '', spans: [{ key: 'x3', start: 1, end: 2 }] } };
    const t4 = { id: 't4', at: { video: 'v4', spans: [{ key: 'x4', start: 2, end: 3 }] } };
    expect(timeOrder([t3, t4]).groups[0].title).toBe('動画');
  });

  it('最初のチャプターより前のカードは title null の区切りに先に出る。カードの無いチャプターは出ない', () => {
    const x = { id: 'x', at: { video: 'v5', spans: [{ key: 'y1', start: 10, end: 11 }] } };
    const y = { id: 'y', at: { video: 'v5', spans: [{ key: 'y2', start: 70, end: 71 }] } };
    const out = timeOrder([y, x], {
      chapters: {
        video: 'v5',
        chapters: [
          { start: 60, title: 'ハガキ1' },
          { start: 120, title: 'ハガキ2' },
        ],
      },
    });
    expect(out.groups[0].sections).toEqual([
      { title: null, start: null, cards: [x] },
      { title: 'ハガキ1', start: 60, cards: [y] },
    ]);
  });

  it('使えないチャプター（始まりが負・NaN・Infinity・文字列、題が文字列でない）は無視する。全部使えなければ区切りは一つ', () => {
    const z = { id: 'z', at: { video: 'v6', spans: [{ key: 'z1', start: 30, end: 31 }] } };
    const bad: TimeChapter[] = [
      { start: -1, title: '負' },
      { start: NaN, title: 'NaN' },
      { start: Infinity, title: '無限' },
      { start: '5' as unknown as number, title: '文字列' },
      { start: 10, title: 5 as unknown as string },
    ];
    expect(timeOrder([z], { chapters: { video: 'v6', chapters: bad } }).groups[0].sections).toEqual([
      { title: null, start: null, cards: [z] },
    ]);

    // 使えるものが一つでもあれば、それだけを使う
    const mixed: TimeChapter[] = [...bad, { start: 0, title: '最初' }];
    expect(timeOrder([z], { chapters: { video: 'v6', chapters: mixed } }).groups[0].sections).toEqual([
      { title: '最初', start: 0, cards: [z] },
    ]);
  });

  it('chapters.video が別の動画なら、その組には区切りを入れない', () => {
    const out = timeOrder([a, c, d], { chapters: { video: 'v2', chapters: [{ start: 0, title: 'V2の最初' }] } });
    const [v1, v2] = out.groups;
    expect(v1.video).toBe('v1');
    expect(v1.sections).toEqual([{ title: null, start: null, cards: [d, a] }]);
    expect(v2.video).toBe('v2');
    expect(v2.sections).toEqual([{ title: 'V2の最初', start: 0, cards: [c] }]);
  });

  it('入力（tops・options）を変えず、返すカードは入力と同じもの', () => {
    const input = [a, b, c, d];
    const copy = structuredClone(input);
    const options = {
      first: 'v2',
      chapters: { video: 'v1', chapters: [{ start: 60, title: 'ハガキ1' }, { start: 0, title: 'オープニング' }] },
    };
    const optionsCopy = structuredClone(options);

    const out = timeOrder(input, options);

    expect(input).toEqual(copy);
    expect(options).toEqual(optionsCopy);
    const [g2, g1] = out.groups; // first が v2 なので v2 が先
    expect(g2.sections[0].cards[0]).toBe(c);
    expect(g1.sections[0].cards[0]).toBe(d);
    expect(g1.sections[1].cards[0]).toBe(a);
    expect(out.loose[0]).toBe(b);
  });
});

describe('cardStart（結んだ区間の一番早い始まり）', () => {
  it('区間が複数なら一番小さい start', () => {
    expect(
      cardStart({
        video: 'v',
        spans: [
          { key: 'p', start: 50, end: 60 },
          { key: 'q', start: 20, end: 25 },
        ],
      }),
    ).toBe(20);
  });

  it('区間が空なら Infinity', () => {
    expect(cardStart({ video: 'v', spans: [] })).toBe(Infinity);
  });
});
