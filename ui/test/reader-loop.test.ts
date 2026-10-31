// 六角で見る（動画の区間セル）の区間を繰り返す段取り（plan-reader-video の V3a）：回し方の整え・まぜる順・段取り・名前つきの組の読み方
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOOP,
  LOOP_LIMITS,
  cleanLoopOptions,
  parseLoopSets,
  planLoop,
  shuffleOrder,
  type LoopSpan,
} from '../src/reader-loop';

// 上の例で使う区間（0 は 10〜15 秒、1 は 30〜35 秒）
const spans: LoopSpan[] = [
  { start: 10, end: 15 },
  { start: 30, end: 35 },
];

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('cleanLoopOptions（回し方の形を整える）', () => {
  it('例：形の合わないものは既定で埋め、範囲に収めて 0.5 秒きざみに丸める', () => {
    expect(cleanLoopOptions({ mode: 'each', times: 4.6, gap: 1.3, pad: 9, steps: 'yes' })).toEqual({
      mode: 'each',
      times: 5,
      gap: 1.5,
      steps: false,
      pad: 3,
    });
  });

  it('オブジェクトでなければ既定の写し（同じオブジェクトではない）', () => {
    const r = cleanLoopOptions(null);
    expect(r).toEqual(DEFAULT_LOOP);
    expect(r).not.toBe(DEFAULT_LOOP);
    expect(cleanLoopOptions('x')).toEqual(DEFAULT_LOOP);
  });

  it('mode は三つのどれでもなければ seq', () => {
    expect(cleanLoopOptions({ mode: 'bogus' }).mode).toBe('seq');
    expect(cleanLoopOptions({ mode: 'shuffle' }).mode).toBe('shuffle');
  });

  it('times は数でなければ 3。有限の数なら四捨五入して 1〜10 に収める', () => {
    expect(cleanLoopOptions({ times: '4' }).times).toBe(3);
    expect(cleanLoopOptions({ times: NaN }).times).toBe(3);
    expect(cleanLoopOptions({ times: Infinity }).times).toBe(3);
    expect(cleanLoopOptions({ times: 0 }).times).toBe(1);
    expect(cleanLoopOptions({ times: 99 }).times).toBe(10);
    expect(cleanLoopOptions({ times: 2.5 }).times).toBe(3);
  });

  it('gap は数でなければ 0。0〜10 に収めて 0.5 きざみ', () => {
    expect(cleanLoopOptions({ gap: '2' }).gap).toBe(0);
    expect(cleanLoopOptions({ gap: -2 }).gap).toBe(0);
    expect(cleanLoopOptions({ gap: 11 }).gap).toBe(10);
    expect(cleanLoopOptions({ gap: 0.3 }).gap).toBe(0.5);
  });

  it('pad は数でなければ 0。0〜3 に収めて 0.5 きざみ', () => {
    expect(cleanLoopOptions({ pad: NaN }).pad).toBe(0);
    expect(cleanLoopOptions({ pad: -1 }).pad).toBe(0);
    expect(cleanLoopOptions({ pad: 2.7 }).pad).toBe(2.5);
  });

  it('steps は true のときだけ true', () => {
    expect(cleanLoopOptions({ steps: true }).steps).toBe(true);
    expect(cleanLoopOptions({ steps: 1 }).steps).toBe(false);
  });
});

describe('shuffleOrder（seed から決まる並べ替え）', () => {
  it('0〜n-1 の並べ替えになっている', () => {
    expect([...shuffleOrder(10, 1)].sort((a, b) => a - b)).toEqual(range(10));
  });

  it('同じ seed なら同じ順', () => {
    expect(shuffleOrder(10, 5)).toEqual(shuffleOrder(10, 5));
  });

  it('seed が違えば違う順（1 と 2 で n = 10）', () => {
    expect(shuffleOrder(10, 1)).not.toEqual(shuffleOrder(10, 2));
  });

  it('n が 0 以下・有限でなければ []。整数でない正の数は切り捨て', () => {
    expect(shuffleOrder(0, 1)).toEqual([]);
    expect(shuffleOrder(-3, 1)).toEqual([]);
    expect(shuffleOrder(NaN, 1)).toEqual([]);
    expect(shuffleOrder(Infinity, 1)).toEqual([]);
    expect([...shuffleOrder(2.9, 1)].sort((a, b) => a - b)).toEqual([0, 1]);
  });
});

describe('planLoop（区間と回し方から段取り）', () => {
  it('seq：回ごとに区間を元の順に', () => {
    const plan = planLoop(spans, { mode: 'seq', times: 2 });
    expect(plan.map((s) => s.span)).toEqual([0, 1, 0, 1]);
    expect(plan.map((s) => s.rep)).toEqual([0, 0, 1, 1]);
    expect(plan.every((s) => s.rate === null)).toBe(true);
    expect(plan.every((s) => s.gapAfter === 0)).toBe(true);
  });

  it('each：区間ごとに回数だけ。段上げのとき速さは 0.75 → 1 → …', () => {
    const plan = planLoop(spans, { mode: 'each', times: 2, steps: true });
    expect(plan.map((s) => s.span)).toEqual([0, 0, 1, 1]);
    expect(plan.map((s) => s.rep)).toEqual([0, 1, 0, 1]);
    expect(plan.map((s) => s.rate)).toEqual([0.75, 1, 0.75, 1]);
  });

  it('段上げは回の番号 2 以降も最後の値（1.25）で止まる', () => {
    const plan = planLoop([{ start: 10, end: 15 }], { mode: 'each', times: 4, steps: true });
    expect(plan.map((s) => s.rate)).toEqual([0.75, 1, 1.25, 1.25]);
  });

  it('のりしろと休みと終わりの切り方（duration で end を切る。最後の段の休みは 0）', () => {
    const plan = planLoop(spans, { mode: 'seq', times: 1, gap: 2, pad: 1 }, 1, 35.5);
    expect(plan).toEqual([
      { span: 0, start: 9, end: 16, rate: null, rep: 0, gapAfter: 2 },
      { span: 1, start: 29, end: 35.5, rate: null, rep: 0, gapAfter: 0 },
    ]);
  });

  it('のりしろで始まりは 0 より前に出ない', () => {
    const plan = planLoop([{ start: 1, end: 2 }], { times: 1, pad: 3 });
    expect(plan).toEqual([{ span: 0, start: 0, end: 5, rate: null, rep: 0, gapAfter: 0 }]);
  });

  it('使える区間が無ければ []（空・始まりが負・終わりが始まり以下・数でないもの）', () => {
    expect(planLoop([], {})).toEqual([]);
    expect(planLoop([{ start: -1, end: 2 }], {})).toEqual([]);
    expect(planLoop([{ start: 5, end: 5 }, { start: 3, end: 1 }], {})).toEqual([]);
    expect(planLoop([{ start: NaN, end: 3 }], {})).toEqual([]);
  });

  it('使えない区間は飛ばし、span には元の番号を入れる', () => {
    const mixed: LoopSpan[] = [
      { start: 5, end: 5 },
      { start: NaN, end: 3 },
      { start: 1, end: 2 },
    ];
    const plan = planLoop(mixed, { mode: 'seq', times: 1 });
    expect(plan.length).toBe(1);
    expect(plan[0].span).toBe(2);
  });

  it('shuffle：同じ seed なら同じ段取り。どの回の中にも全部の区間がちょうど一度ずつ。回ごとの順は shuffleOrder(区間の数, seed + 回) と同じ', () => {
    const five: LoopSpan[] = range(5).map((i) => ({ start: i * 10, end: i * 10 + 5 }));
    const plan = planLoop(five, { mode: 'shuffle', times: 3 }, 7);
    expect(planLoop(five, { mode: 'shuffle', times: 3 }, 7)).toEqual(plan);
    for (let rep = 0; rep < 3; rep++) {
      const ids = plan.filter((s) => s.rep === rep).map((s) => s.span);
      expect([...ids].sort((a, b) => a - b)).toEqual(range(5));
      expect(ids).toEqual(shuffleOrder(5, 7 + rep));
    }
  });

  it('400 段で切る（区間 50 個 × 10 回 = 500 段 → 400 段。最後の段の休みは 0）', () => {
    const many: LoopSpan[] = range(50).map((i) => ({ start: i * 10, end: i * 10 + 5 }));
    const plan = planLoop(many, { mode: 'seq', times: 10, gap: 1 });
    expect(plan.length).toBe(LOOP_LIMITS.steps);
    expect(plan[398].gapAfter).toBe(1);
    expect(plan[399].gapAfter).toBe(0);
    expect(plan[399]).toMatchObject({ span: 49, rep: 7 });
  });
});

describe('parseLoopSets（保存してある名前つきの組を読む）', () => {
  it('例：名前は空白をまとめて前後を取り、同じ名前は後のものを捨て、形の合わないものは捨てる', () => {
    expect(
      parseLoopSets([
        { name: ' ハガキ 1 ', keys: ['a', 'a', 'b', 3], mode: 'shuffle', times: 2 },
        { name: 'ハガキ 1', keys: ['c'] },
        { name: '', keys: ['d'] },
        { name: '空', keys: [] },
      ]),
    ).toEqual([{ name: 'ハガキ 1', keys: ['a', 'b'], mode: 'shuffle', times: 2, gap: 0, steps: false, pad: 0 }]);
  });

  it('名前の途中の空白は一つにまとめる', () => {
    expect(parseLoopSets([{ name: 'ハガキ  1', keys: ['a'] }])[0].name).toBe('ハガキ 1');
  });

  it('配列でなければ []', () => {
    expect(parseLoopSets(null)).toEqual([]);
    expect(parseLoopSets({ name: 'x', keys: ['a'] })).toEqual([]);
  });

  it('20 組で切る（先頭から）', () => {
    const many = range(25).map((i) => ({ name: 's' + i, keys: ['k'] }));
    const sets = parseLoopSets(many);
    expect(sets.length).toBe(20);
    expect(sets.map((s) => s.name)).toEqual(range(20).map((i) => 's' + i));
  });

  it('名前は 31 字目以降を切る（30 字まで）', () => {
    expect(parseLoopSets([{ name: 'a'.repeat(30) + 'b', keys: ['k'] }])[0].name).toBe('a'.repeat(30));
  });

  it('マスの指紋は 31 個目以降を切る（30 個まで）。空と 40 字を超えるものは捨てる', () => {
    const keys = range(31).map((i) => 'k' + i);
    const set = parseLoopSets([{ name: 'n', keys }])[0];
    expect(set.keys.length).toBe(30);
    expect(set.keys[29]).toBe('k29');
    expect(parseLoopSets([{ name: 'n', keys: ['', 'x'.repeat(41), 'y'.repeat(40)] }])[0].keys).toEqual(['y'.repeat(40)]);
  });
});
