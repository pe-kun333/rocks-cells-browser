import { describe, expect, it } from 'vitest';
import { EXPAND_FLOOR, EXPAND_SLACK, expandLabel, expandTarget, isExpanded, leaveExpand, restoreHeight, shrinkExpand, toggleExpand } from '../src/memo-pane-expand';
import { MEMO_PANE_DEFAULT, MEMO_PANE_MAX } from '../src/memo-pane-limits';

describe('expandTarget', () => {
  it('画面の高さの 7 割', () => {
    expect(expandTarget(1000)).toBe(700);
    expect(expandTarget(1040)).toBe(728);
  });
  it('小さい画面でも下限以上、大きい画面でも上限（1600）まで', () => {
    expect(expandTarget(400)).toBe(EXPAND_FLOOR);
    expect(expandTarget(100000)).toBe(MEMO_PANE_MAX);
  });
  it('高さが分からない・おかしいときは 700', () => {
    for (const v of [0, -5, NaN, Infinity, Number.NaN]) expect(expandTarget(v)).toBe(700);
  });
});

describe('isExpanded', () => {
  it('広げ先の少し手前から「広げてある」', () => {
    expect(isExpanded(700, 1000)).toBe(true);
    expect(isExpanded(700 - EXPAND_SLACK, 1000)).toBe(true);
    expect(isExpanded(700 - EXPAND_SLACK - 1, 1000)).toBe(false);
    expect(isExpanded(300, 1000)).toBe(false);
  });
  it('既定の高さは、どの画面でも「広げてある」にならない', () => {
    for (const a of [300, 400, 600, 1000, 2000]) expect(isExpanded(MEMO_PANE_DEFAULT, a)).toBe(false);
  });
});

describe('toggleExpand', () => {
  it('広げると、広げる前の高さを覚える', () => {
    expect(toggleExpand({ height: 340, before: null }, 1000)).toEqual({ height: 700, before: 340 });
  });
  it('もう一度で、覚えた高さへ戻る（往復で元どおり）', () => {
    const open = toggleExpand({ height: 340, before: null }, 1000);
    expect(toggleExpand(open, 1000)).toEqual({ height: 340, before: null });
  });
  it('覚えていない（前から高い・開き直したあと）ときは、既定の高さへ戻る', () => {
    expect(toggleExpand({ height: 800, before: null }, 1000)).toEqual({ height: MEMO_PANE_DEFAULT, before: null });
  });
  it('覚えた高さが今より高い（おかしい）ときも、既定の高さへ', () => {
    expect(toggleExpand({ height: 700, before: 900 }, 1000)).toEqual({ height: MEMO_PANE_DEFAULT, before: null });
  });
  it('広げたあとにつまみで動かして狭くしたら、ボタンはもう一度広げる（前の高さは新しく覚える）', () => {
    expect(toggleExpand({ height: 400, before: 340 }, 1000)).toEqual({ height: 700, before: 400 });
  });
  it('拡大前の高さは範囲内に丸める', () => {
    expect(toggleExpand({ height: 50, before: null }, 1000).before).toBe(120);
  });
});

describe('shrinkExpand / leaveExpand', () => {
  it('Esc：広げてあれば戻す、なければ何もしない', () => {
    expect(shrinkExpand({ height: 700, before: 340 }, 1000)).toEqual({ height: 340, before: null });
    expect(shrinkExpand({ height: 340, before: null }, 1000)).toBeNull();
  });
  it('タブを離れるとき：このタブで広げたときだけ戻す', () => {
    expect(leaveExpand({ height: 700, before: 340 }, 1000)).toEqual({ height: 340, before: null });
    expect(leaveExpand({ height: 700, before: null }, 1000)).toBeNull();
    expect(leaveExpand({ height: 340, before: 340 }, 1000)).toBeNull();
  });
});

describe('restoreHeight / expandLabel', () => {
  it('戻す高さ', () => {
    expect(restoreHeight({ height: 700, before: 340 })).toBe(340);
    expect(restoreHeight({ height: 700, before: null })).toBe(MEMO_PANE_DEFAULT);
    expect(restoreHeight({ height: 700, before: NaN })).toBe(MEMO_PANE_DEFAULT);
  });
  it('ボタンの文字', () => {
    expect(expandLabel(false)).toBe('拡大');
    expect(expandLabel(true)).toBe('縮小');
  });
});