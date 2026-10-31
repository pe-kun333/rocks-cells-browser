// 下の区画の切り替えの決まり（メモ⇄Grok Cards⇄上に出す）。B1-3 で「ボード」タブを足す前の動きを固める回帰試験
import { describe, expect, it } from 'vitest';

import { boardTabClick, boardTabShown, cardsTabClick, chromeFor as chromeForAll, escAction, titleClick } from '../src/grok-cards-tabs';

// ボードを見ていないとき、ボードの面は隠れていて、タブも選ばれていない。残りの値は、ボードを足す前の golden のまま（下の toEqual は足す前と同じ中身）
const chromeFor = (i: Parameters<typeof chromeForAll>[0]) => {
  const { boardRootHidden, boardSelected, ...old } = chromeForAll(i);
  expect(boardRootHidden).toBe(true);
  expect(boardSelected).toBe(false);
  return old;
};

const input = (over: Partial<Parameters<typeof chromeFor>[0]> = {}) => ({ tab: 'memo' as const, upper: false, memoOpen: true, sheetEmpty: false, ...over });

describe('メモを見ているとき', () => {
  it('メモを開いている：メモの部品を出し、空の案内は隠す。札の根は隠す', () => {
    expect(chromeFor(input())).toEqual({
      cardsRootHidden: true,
      cardsSelected: false,
      memoSelected: true,
      band: false,
      main: false,
      scroll: false,
      tools: false,
      countline: false,
      status: false,
      empty: true,
      sheet: false,
      page: false,
    });
  });
  it('シート名が空ならシートの欄は隠す', () => {
    expect(chromeFor(input({ sheetEmpty: true })).sheet).toBe(true);
  });
  it('メモを開いていない：帯だけ出す（Grok Cards はここから開ける）。空の案内を出し、メモの部品・シート・ページ欄は隠す', () => {
    const c = chromeFor(input({ memoOpen: false }));
    expect(c).toEqual({
      cardsRootHidden: true,
      cardsSelected: false,
      memoSelected: true,
      band: false,
      main: true,
      scroll: true,
      tools: true,
      countline: true,
      status: true,
      empty: false,
      sheet: true,
      page: true,
    });
  });
});

describe('Grok Cards を下の面に出しているとき', () => {
  it('札の根と主の枠だけ出し、メモの部品はみな隠す（メモを開いていてもいなくても同じ）', () => {
    const expected = {
      cardsRootHidden: false,
      cardsSelected: true,
      memoSelected: false,
      band: false,
      main: false,
      scroll: true,
      tools: true,
      countline: true,
      status: true,
      empty: true,
      sheet: true,
      page: true,
    };
    expect(chromeFor(input({ tab: 'cards' }))).toEqual(expected);
    expect(chromeFor(input({ tab: 'cards', memoOpen: false }))).toEqual(expected);
    expect(chromeFor(input({ tab: 'cards', sheetEmpty: true }))).toEqual(expected);
  });
});

describe('Grok Cards を上の半分に出しているとき（段 9）', () => {
  it('下の面はメモの見え方のまま。札の根は上の枠にあるので隠さない。「メモ」タブが選ばれ、「Grok Cards」タブは選ばれない', () => {
    for (const tab of ['memo', 'cards'] as const) {
      const open = chromeFor(input({ tab, upper: true }));
      expect(open.cardsRootHidden).toBe(false);
      expect(open.cardsSelected).toBe(false);
      expect(open.memoSelected).toBe(true);
      expect(open.main).toBe(false);
      expect(open.scroll).toBe(false);
      expect(open.empty).toBe(true);
      const shut = chromeFor(input({ tab, upper: true, memoOpen: false }));
      expect(shut.cardsRootHidden).toBe(false);
      expect(shut.main).toBe(true);
      expect(shut.empty).toBe(false);
    }
  });
  it('上に出していて tab が cards でも、下の面の部品は memo のときと同じ', () => {
    expect(chromeFor(input({ tab: 'cards', upper: true }))).toEqual(chromeFor(input({ tab: 'memo', upper: true })));
  });
});

describe('ボードを見ているとき（B1-3）',() => {
  const board = (over: Partial<Parameters<typeof chromeForAll>[0]> = {}) => chromeForAll({ tab: 'board', upper: false, memoOpen: true, sheetEmpty: false, ...over });
  it('ボードの面と主の枠だけ出し、メモの部品はみな隠す（Grok Cards を下に出しているときと同じ並び）。札の根は隠す', () => {
    const c = board();
    expect(c.boardRootHidden).toBe(false);
    expect(c.boardSelected).toBe(true);
    expect(c.cardsRootHidden).toBe(true);
    expect(c.cardsSelected).toBe(false);
    expect(c.memoSelected).toBe(false);
    const { boardRootHidden, boardSelected, cardsRootHidden, cardsSelected, memoSelected, ...parts } = c;
    void [boardRootHidden, boardSelected, cardsRootHidden, cardsSelected, memoSelected];
    expect(parts).toEqual({ band: false, main: false, scroll: true, tools: true, countline: true, status: true, empty: true, sheet: true, page: true });
  });
  it('メモを開いていなくても、シート名が空でも同じ', () => {
    expect(board({ memoOpen: false })).toEqual(board());
    expect(board({ sheetEmpty: true })).toEqual(board());
  });
  it('Grok Cards を上に出していても、ボードを見ていればボードを出す。札の根は上の枠にあるので隠さない', () => {
    const c = board({ upper: true });
    expect(c.boardRootHidden).toBe(false);
    expect(c.cardsRootHidden).toBe(false);
    expect(c.main).toBe(false);
    expect(c.empty).toBe(true);
  });
});

describe('クリックと Esc の決まり', () => {
  it('「Grok Cards」タブ：上に出していれば下の面へ戻す。そうでなければ開く', () => {
    expect(cardsTabClick(true)).toBe('place-bottom');
    expect(cardsTabClick(false)).toBe('show-cards');
  });
  it('「メモ」タブ（タイトル）：Grok Cards を見ているときだけメモへ戻す。ふだんは今までのタイトルの働き', () => {
    expect(titleClick('cards')).toBe('show-memo');
    expect(titleClick('memo')).toBe('pass');
  });
  it('Esc：Grok Cards を見ていなければ何もしない。欄の中なら何もしない。選び窓があれば閉じる。そうでなければメモへ', () => {
    expect(escAction('memo', { inField: false, picker: false })).toBe('ignore');
    expect(escAction('memo', { inField: false, picker: true })).toBe('ignore');
    expect(escAction('cards', { inField: true, picker: true })).toBe('ignore');
    expect(escAction('cards', { inField: false, picker: true })).toBe('close-picker');
    expect(escAction('cards', { inField: false, picker: false })).toBe('show-memo');
  });

  it('ボード：タイトル（メモ）で戻る。ボードのタブは、見ていなければ開く', () => {
    expect(titleClick('board')).toBe('show-memo');
    expect(boardTabClick('memo')).toBe('show-board');
    expect(boardTabClick('cards')).toBe('show-board');
    expect(boardTabClick('board')).toBe('stay');
  });
  it('ボードの Esc：欄の中なら何もしない。広げてあれば縮める。そうでなければメモへ（選び窓は関係ない）', () => {
    expect(escAction('board', { inField: true, picker: false, boardExpanded: true })).toBe('ignore');
    expect(escAction('board', { inField: false, picker: false, boardExpanded: true })).toBe('shrink-board');
    expect(escAction('board', { inField: false, picker: false, boardExpanded: false })).toBe('show-memo');
    expect(escAction('board', { inField: false, picker: true })).toBe('show-memo');
  });
  it('boardExpanded を渡さなくても、メモ・Grok Cards の Esc は今までどおり', () => {
    expect(escAction('cards', { inField: false, picker: false, boardExpanded: true })).toBe('show-memo');
    expect(escAction('memo', { inField: false, picker: false, boardExpanded: true })).toBe('ignore');
  });
  it('ボードの Esc：カードをつまんでいる間は、つまむのの取り消しが先（欄の中でも広げていても）。つまんでいなければ今までどおり', () => {
    expect(escAction('board', { inField: false, picker: false, boardExpanded: true, boardDragging: true })).toBe('cancel-drag');
    expect(escAction('board', { inField: true, picker: false, boardDragging: true })).toBe('cancel-drag');
    expect(escAction('board', { inField: false, picker: false, boardExpanded: true, boardDragging: false })).toBe('shrink-board');
    expect(escAction('board', { inField: false, picker: false, boardDragging: false })).toBe('show-memo');
    // メモ・Grok Cards では、boardDragging が付いていても何も変わらない
    expect(escAction('memo', { inField: false, picker: false, boardDragging: true })).toBe('ignore');
    expect(escAction('cards', { inField: false, picker: false, boardDragging: true })).toBe('show-memo');
  });
  it('ボードの Esc：つまむのの取り消し → 選びを外す → 縮める → メモへ、の順（欄の中なら選びの解除も何もしない）', () => {
    const base = { picker: false };
    expect(escAction('board', { ...base, inField: false, boardExpanded: true, boardSelected: true, boardDragging: true })).toBe('cancel-drag');
    expect(escAction('board', { ...base, inField: false, boardExpanded: true, boardSelected: true })).toBe('clear-selection');
    expect(escAction('board', { ...base, inField: false, boardExpanded: true, boardSelected: false })).toBe('shrink-board');
    expect(escAction('board', { ...base, inField: false, boardSelected: false })).toBe('show-memo');
    expect(escAction('board', { ...base, inField: true, boardSelected: true })).toBe('ignore');
    // メモ・Grok Cards では、boardSelected が付いていても何も変わらない
    expect(escAction('memo', { ...base, inField: false, boardSelected: true })).toBe('ignore');
    expect(escAction('cards', { ...base, inField: false, boardSelected: true })).toBe('show-memo');
  });
  it('ボードのタブを出すか：旗がなければ出さない。上に出していれば出さない（ボードを見ている最中を除く）', () => {
    expect(boardTabShown(false, 'memo', false)).toBe(false);
    expect(boardTabShown(false, 'board', true)).toBe(false);
    expect(boardTabShown(true, 'memo', false)).toBe(true);
    expect(boardTabShown(true, 'cards', false)).toBe(true);
    expect(boardTabShown(true, 'memo', true)).toBe(false);
    expect(boardTabShown(true, 'board', true)).toBe(true);
  });
});
