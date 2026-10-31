// 全体の地図の純粋な関数（plan-reader-video の V6a）：地図を組む・帯の上の位置と秒・900 マスの外・知らせの文
import { describe, expect, it } from 'vitest';
import {
  capNotice,
  overviewInCut,
  overviewModel,
  overviewTime,
  type OverviewInput,
} from '../src/reader-overview';

// 上の例の入力（どの例でも同じものを使う）
const EXAMPLE: OverviewInput = {
  duration: 600,
  cells: [
    { head: true, start: 0, end: 0 },
    { start: 0, end: 10, liked: true },
    { start: 10, end: 20, note: true },
    { head: true, start: 300, end: 300 },
    { start: 300, end: 310, liked: true, note: true },
  ],
  cards: [
    { spans: [{ start: 10 }, { start: 300 }], ai: false },
    { spans: [{ start: 120 }, { start: 60 }], ai: true },
  ],
  cut: { from: 450, to: 590 },
};

describe('overviewModel（全体の地図を組む）', () => {
  it('例：長さ 600・点（♥・メモ・カード・AI）・区切り 2 つ・900 マスの外は 0.75〜590/600', () => {
    const m = overviewModel(EXAMPLE);
    expect(m.length).toBe(600);
    expect(m.points).toEqual([
      { kind: 'heart', at: 0, sec: 0, count: 1 },
      { kind: 'heart', at: 0.5, sec: 300, count: 1 },
      { kind: 'note', at: 10 / 600, sec: 10, count: 1 },
      { kind: 'note', at: 0.5, sec: 300, count: 1 },
      { kind: 'card', at: 10 / 600, sec: 10, count: 1 },
      { kind: 'card', at: 0.5, sec: 300, count: 1 },
      { kind: 'ai', at: 0.1, sec: 60, count: 1 },
    ]);
    expect(m.chapters).toEqual([
      { at: 0, sec: 0 },
      { at: 0.5, sec: 300 },
    ]);
    expect(m.cut).toEqual({ from: 0.75, to: 590 / 600 });
  });

  it('例：duration 0・マスの終わり 200・cut 210〜400 なら長さは 400', () => {
    const m = overviewModel({
      duration: 0,
      cells: [{ start: 0, end: 200, liked: true }],
      cards: [],
      cut: { from: 210, to: 400 },
    });
    expect(m.length).toBe(400);
    expect(m.cut).toEqual({ from: 210 / 400, to: 1 });
  });

  it('例：♥ が 100.0 秒と 100.5 秒（duration 1000。同じ枠 40）なら、♥ の点は 1 つで sec 100・count 2', () => {
    const m = overviewModel({
      duration: 1000,
      cells: [
        { start: 100, end: 101, liked: true },
        { start: 100.5, end: 101.5, liked: true },
      ],
      cards: [],
      cut: null,
    });
    expect(m.points).toEqual([{ kind: 'heart', at: 0.1, sec: 100, count: 2 }]);
  });

  it('同じ枠の AI のカードは一つにまとめる（sec は早い方、count は 2）。カードの区間も同じ枠なら一つ', () => {
    const m = overviewModel({
      duration: 1000,
      cells: [],
      cards: [
        { spans: [{ start: 302 }], ai: true },
        { spans: [{ start: 300 }], ai: true },
        { spans: [{ start: 300 }, { start: 301 }], ai: false },
      ],
      cut: null,
    });
    expect(m.points).toEqual([
      { kind: 'card', at: 0.3, sec: 300, count: 2 },
      { kind: 'ai', at: 0.3, sec: 300, count: 2 },
    ]);
  });

  it('長さが 0 になるとき（マスが無い・duration 0・cut 無し、区切りだけ・カードだけ）は空の地図', () => {
    expect(overviewModel({ duration: 0, cells: [], cards: [], cut: null })).toEqual({ length: 0, points: [], chapters: [], cut: null });
    expect(
      overviewModel({
        duration: 0,
        cells: [{ head: true, start: 0, end: 0, liked: true }],
        cards: [{ spans: [{ start: 0 }], ai: false }],
        cut: { from: 5, to: 5 },
      }),
    ).toEqual({ length: 0, points: [], chapters: [], cut: null });
  });

  it('時刻の無いマス（start が無い・NaN・負）は点にしない。その終わりも長さに入れない。区切りに ♥ があっても点にしない', () => {
    const m = overviewModel({
      duration: 0,
      cells: [
        { liked: true },
        { start: NaN, end: 500, liked: true },
        { start: -3, end: 50, note: true },
        { head: true, start: 5, end: 5, liked: true },
        { start: 10, end: 20, liked: true },
      ],
      cards: [],
      cut: null,
    });
    expect(m.length).toBe(20);
    expect(m.points).toEqual([{ kind: 'heart', at: 0.5, sec: 10, count: 1 }]);
    expect(m.chapters).toEqual([{ at: 0.25, sec: 5 }]);
  });

  it('cut の to <= from は null（長さは duration のまま）', () => {
    const same = overviewModel({ duration: 1000, cells: [], cards: [], cut: { from: 500, to: 500 } });
    expect(same.cut).toBeNull();
    expect(same.length).toBe(1000);
    const back = overviewModel({ duration: 1000, cells: [], cards: [], cut: { from: 500, to: 400 } });
    expect(back.cut).toBeNull();
    expect(back.length).toBe(1000);
  });

  it('AI のカードで使える start が一つも無いものは描かない（この動画のカードで使えない区間は飛ばす）', () => {
    const m = overviewModel({
      duration: 100,
      cells: [],
      cards: [
        { spans: [{ start: NaN }, { start: -1 }], ai: true },
        { spans: [], ai: true },
        { spans: [{ start: NaN }], ai: false },
      ],
      cut: null,
    });
    expect(m.points).toEqual([]);
  });

  it('duration が lastEnd より短いときは lastEnd が長さになる', () => {
    const m = overviewModel({
      duration: 100,
      cells: [{ start: 0, end: 200, liked: true }],
      cards: [],
      cut: null,
    });
    expect(m.length).toBe(200);
    expect(m.points).toEqual([{ kind: 'heart', at: 0, sec: 0, count: 1 }]);
  });

  it('チャプターは同じ枠なら早い方だけ残し、秒の早い順に並ぶ', () => {
    const m = overviewModel({
      duration: 1000,
      cells: [
        { head: true, start: 100.5, end: 100.5 },
        { head: true, start: 100, end: 100 },
        { head: true, start: 600, end: 600 },
      ],
      cards: [],
      cut: null,
    });
    expect(m.chapters).toEqual([
      { at: 0.1, sec: 100 },
      { at: 0.6, sec: 600 },
    ]);
  });

  it('入力の配列とオブジェクトは変えない', () => {
    const input = structuredClone(EXAMPLE);
    const before = structuredClone(input);
    overviewModel(input);
    expect(input).toEqual(before);
  });
});

describe('overviewTime（帯の上の位置を秒に当てる）', () => {
  it('長さ 600 の地図：0.25 は 150、1.5 は 600（0〜1 に収める）、NaN は 0、負は 0', () => {
    const m = overviewModel(EXAMPLE);
    expect(overviewTime(m, 0.25)).toBe(150);
    expect(overviewTime(m, 1.5)).toBe(600);
    expect(overviewTime(m, NaN)).toBe(0);
    expect(overviewTime(m, -1)).toBe(0);
  });

  it('長さ 0 の地図は 0', () => {
    const empty = overviewModel({ duration: 0, cells: [], cards: [], cut: null });
    expect(overviewTime(empty, 0.5)).toBe(0);
  });
});

describe('overviewInCut（900 マスの外かどうか）', () => {
  it('例：cut は 0.75〜590/600。0.8 は真、0.7 は偽、境目の 0.75 は真', () => {
    const m = overviewModel(EXAMPLE);
    expect(overviewInCut(m, 0.8)).toBe(true);
    expect(overviewInCut(m, 0.7)).toBe(false);
    expect(overviewInCut(m, 0.75)).toBe(true);
  });

  it('cut が無い地図は、どの位置も偽', () => {
    const m = overviewModel({ duration: 600, cells: [], cards: [], cut: null });
    expect(overviewInCut(m, 0.8)).toBe(false);
  });
});

describe('capNotice（900 マスの知らせの文）', () => {
  it('例：end で動画の長さが分かる → 「この動画は … ありますが…」', () => {
    expect(capNotice({ side: 'end', at: 8170, duration: 9052, total: 1240, kept: 900 })).toBe(
      'この動画は 2:30:52 ありますが、区間セルは 900 マスまでなので、2:16:10 から後ろは入っていません（字幕は全部で 1240 マス分。全体の地図の斜線の所）',
    );
  });

  it('end で動画の長さが分からない（0・NaN）→ 「区間セルは … から後ろは入っていません…」', () => {
    const want = '区間セルは 900 マスまでなので、2:16:10 から後ろは入っていません（字幕は全部で 1240 マス分。全体の地図の斜線の所）';
    expect(capNotice({ side: 'end', at: 8170, duration: 0, total: 1240, kept: 900 })).toBe(want);
    expect(capNotice({ side: 'end', at: 8170, duration: NaN, total: 1240, kept: 900 })).toBe(want);
  });

  it('例：start（聞き取りで古いマスを外した）→ 「聞き取りの区間セルは … より前の 12 マスを外しました…」', () => {
    expect(capNotice({ side: 'start', at: 95, duration: 0, total: 912, kept: 900 })).toBe(
      '聞き取りの区間セルは 900 マスまでなので、1:35 より前の 12 マスを外しました（外したマスは記録にも残りません。全体の地図の斜線の所）',
    );
  });
});
