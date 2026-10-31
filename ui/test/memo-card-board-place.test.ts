// 上の入れ物の持ち主（なし／Grok Cards／ボード）の決まり（案 C・C1。まだ画面からは呼ばれない）
import { describe, expect, it } from 'vitest';

import { hostPlaceCommand, normalizeCardsPlace, type CardsPlace } from '../src/grok-cards-place';
import { boardTabClick, boardTabShown, chromeFor, escAction, type PaneTab } from '../src/grok-cards-tabs';
import {
  type PlaceGates,
  type PlaceRequest,
  type Places,
  PLACE_BUMP_NOTE,
  boardExpandShown,
  boardTabClickFor,
  boardTabLabel,
  boardTabShownFor,
  bumpNote,
  changePlaces,
  chromeForPlaces,
  escActionFor,
  hostCommandFor,
  hostCommandForGates,
  normalizeBoardPlace,
  normalizePlaces,
  upperOwner,
} from '../src/memo-card-board-place';

const BOOLS = [false, true];
const TABS: PaneTab[] = ['memo', 'cards', 'board'];
const RAWS: unknown[] = ['bottom', 'upper', 'Upper', '', null, undefined, 1, {}];

describe('normalizeBoardPlace', () => {
  it('段 "2" が無ければ、残っていても下', () => {
    for (const raw of RAWS) expect(normalizeBoardPlace(false, raw)).toBe('bottom');
  });
  it('段 "2" があるときは upper だけを上と読む', () => {
    expect(normalizeBoardPlace(true, 'upper')).toBe('upper');
    for (const raw of RAWS.filter((r) => r !== 'upper')) expect(normalizeBoardPlace(true, raw)).toBe('bottom');
  });
});

describe('normalizePlaces（読み込み直し・別の面からの変更）', () => {
  it('どちらも旗が無ければ、どちらも下', () => {
    expect(normalizePlaces({ stage9: false, stage2: false }, 'upper', 'upper')).toEqual({ places: { cards: 'bottom', board: 'bottom' }, bumped: null });
  });
  it('片方だけ上なら、そのまま', () => {
    expect(normalizePlaces({ stage9: true, stage2: true }, 'upper', 'bottom')).toEqual({ places: { cards: 'upper', board: 'bottom' }, bumped: null });
    expect(normalizePlaces({ stage9: true, stage2: true }, 'bottom', 'upper')).toEqual({ places: { cards: 'bottom', board: 'upper' }, bumped: null });
  });
  it('両方が上と読めたら Grok Cards を残し、ボードを下へ戻す（知らせの対象はボード）', () => {
    expect(normalizePlaces({ stage9: true, stage2: true }, 'upper', 'upper')).toEqual({ places: { cards: 'upper', board: 'bottom' }, bumped: 'board' });
  });
  it('旗の片方が無ければ、その分は下として読むので取り合いにならない', () => {
    expect(normalizePlaces({ stage9: false, stage2: true }, 'upper', 'upper')).toEqual({ places: { cards: 'bottom', board: 'upper' }, bumped: null });
    expect(normalizePlaces({ stage9: true, stage2: false }, 'upper', 'upper')).toEqual({ places: { cards: 'upper', board: 'bottom' }, bumped: null });
  });
});

describe('upperOwner', () => {
  it('持ち主を 1 つに決める', () => {
    expect(upperOwner({ cards: 'bottom', board: 'bottom' })).toBe('none');
    expect(upperOwner({ cards: 'upper', board: 'bottom' })).toBe('cards');
    expect(upperOwner({ cards: 'bottom', board: 'upper' })).toBe('board');
  });
  it('両方が上なら Grok Cards（読み込み直しの決まりと同じ）', () => {
    expect(upperOwner({ cards: 'upper', board: 'upper' })).toBe('cards');
  });
});

describe('changePlaces（上に出す・下に戻す）', () => {
  const both: PlaceGates = { stage9: true, stage2: true };
  it('何も上に無いとき、ボードを上に出す：取り合いは無い', () => {
    expect(changePlaces(both, { cards: 'bottom', board: 'bottom' }, { who: 'board', to: 'upper' })).toEqual({ places: { cards: 'bottom', board: 'upper' }, changed: true, bumped: null });
  });
  it('Grok Cards が上にいるとき、ボードを上に出す：後から出したほうが上、先の Grok Cards は下へ戻す', () => {
    expect(changePlaces(both, { cards: 'upper', board: 'bottom' }, { who: 'board', to: 'upper' })).toEqual({ places: { cards: 'bottom', board: 'upper' }, changed: true, bumped: 'cards' });
  });
  it('ボードが上にいるとき、Grok Cards を上に出す：先のボードを下へ戻す', () => {
    expect(changePlaces(both, { cards: 'bottom', board: 'upper' }, { who: 'cards', to: 'upper' })).toEqual({ places: { cards: 'upper', board: 'bottom' }, changed: true, bumped: 'board' });
  });
  it('下に戻す：相手は動かさない・取り合いの知らせも無い', () => {
    expect(changePlaces(both, { cards: 'bottom', board: 'upper' }, { who: 'board', to: 'bottom' })).toEqual({ places: { cards: 'bottom', board: 'bottom' }, changed: true, bumped: null });
    expect(changePlaces(both, { cards: 'upper', board: 'bottom' }, { who: 'cards', to: 'bottom' })).toEqual({ places: { cards: 'bottom', board: 'bottom' }, changed: true, bumped: null });
  });
  it('もう上にいるものを上に出す・もう下にいるものを下に戻す：何も変わらない', () => {
    const c1 = changePlaces(both, { cards: 'bottom', board: 'upper' }, { who: 'board', to: 'upper' });
    expect(c1.changed).toBe(false);
    expect(c1.bumped).toBeNull();
    const c2 = changePlaces(both, { cards: 'bottom', board: 'bottom' }, { who: 'board', to: 'bottom' });
    expect(c2.changed).toBe(false);
  });
  it('旗が無いほうは動かさない（段 "2" が無ければ、ボードは上に出せない）', () => {
    const cur: Places = { cards: 'upper', board: 'bottom' };
    const r = changePlaces({ stage9: true, stage2: false }, cur, { who: 'board', to: 'upper' });
    expect(r).toEqual({ places: cur, changed: false, bumped: null });
    const cur2: Places = { cards: 'bottom', board: 'upper' };
    expect(changePlaces({ stage9: false, stage2: true }, cur2, { who: 'cards', to: 'upper' })).toEqual({ places: cur2, changed: false, bumped: null });
  });
  it('どんな順に押しても、上の持ち主は同時に 2 つにならない（旗 × 3 回までの全部の押し方）', () => {
    const reqs: PlaceRequest[] = [
      { who: 'cards', to: 'upper' },
      { who: 'cards', to: 'bottom' },
      { who: 'board', to: 'upper' },
      { who: 'board', to: 'bottom' },
    ];
    for (const stage9 of BOOLS) {
      for (const stage2 of BOOLS) {
        const gates = { stage9, stage2 };
        const walk = (cur: Places, depth: number) => {
          expect(cur.cards === 'upper' && cur.board === 'upper').toBe(false);
          if (!stage9) expect(cur.cards).toBe('bottom');
          if (!stage2) expect(cur.board).toBe('bottom');
          if (depth === 0) return;
          for (const req of reqs) {
            const r = changePlaces(gates, cur, req);
            if (r.bumped !== null) expect(r.changed).toBe(true);
            walk(r.places, depth - 1);
          }
        };
        walk({ cards: 'bottom', board: 'bottom' }, 3);
      }
    }
  });
});

describe('一言', () => {
  it('下へ戻した側の名前が入る。戻していなければ空', () => {
    expect(bumpNote(null)).toBe('');
    expect(bumpNote('cards')).toBe(PLACE_BUMP_NOTE.cards);
    expect(bumpNote('board')).toBe(PLACE_BUMP_NOTE.board);
    expect(PLACE_BUMP_NOTE.cards).toContain('Grok Cards を下に戻しました');
    expect(PLACE_BUMP_NOTE.board).toContain('ボードを下に戻しました');
  });
  it('ボードのタブの名前：上に出ているときは Grok Cards と同じ形', () => {
    expect(boardTabLabel('bottom')).toBe('ボード');
    expect(boardTabLabel('upper')).toBe('↑ 上に出ています');
  });
});

describe('ホストへの命令', () => {
  it('持ち主がいれば upper、いなくなったときだけ空、何も出したことが無ければ送らない', () => {
    expect(hostCommandFor('cards', false)).toBe('upper');
    expect(hostCommandFor('board', false)).toBe('upper');
    expect(hostCommandFor('board', true)).toBe('upper');
    expect(hostCommandFor('none', true)).toBe('');
    expect(hostCommandFor('none', false)).toBeNull();
  });
  it('持ち主が変わるだけのとき（Grok Cards → ボード）は、戻す空を挟まず upper のまま', () => {
    // sentUpper が true のまま持ち主だけが替わる。空を送ると面が下の帯へ戻ってしまう
    expect(hostCommandFor(upperOwner({ cards: 'bottom', board: 'upper' }), true)).toBe('upper');
  });
  it('段 "2" が無いときは、今までの Grok Cards の命令と全組み合わせで同じ（ボードの値が何でも）', () => {
    for (const stage9 of BOOLS) {
      for (const rawCards of RAWS) {
        for (const rawBoard of RAWS) {
          for (const sent of BOOLS) {
            const cards: CardsPlace = normalizeCardsPlace(stage9, rawCards);
            const want = hostPlaceCommand(stage9, cards, sent);
            const got = hostCommandForGates({ stage9, stage2: false }, { cards, board: normalizeBoardPlace(false, rawBoard) }, sent);
            expect(got).toBe(want);
            // 値が残っていても（旗が無いので）、ボードの値は命令に影響しない
            expect(hostCommandForGates({ stage9, stage2: false }, { cards, board: rawBoard === 'upper' ? 'upper' : 'bottom' }, sent)).toBe(want);
          }
        }
      }
    }
  });
});

describe('ボードを上に出していないとき、今までと同じ', () => {
  it('chromeForPlaces は chromeFor と全組み合わせで同じ（boardInUpper が false なだけ）', () => {
    for (const tab of TABS) {
      for (const upper of BOOLS) {
        for (const memoOpen of BOOLS) {
          for (const sheetEmpty of BOOLS) {
            const input = { tab, upper, memoOpen, sheetEmpty };
            expect(chromeForPlaces({ ...input, boardUpper: false })).toEqual({ ...chromeFor(input), boardInUpper: false });
          }
        }
      }
    }
  });
  it('boardTabClickFor・boardTabShownFor・escActionFor・boardExpandShown も今までと同じ', () => {
    for (const tab of TABS) {
      expect(boardTabClickFor(tab, false)).toBe(boardTabClick(tab));
      for (const flag of BOOLS) for (const cardsUpper of BOOLS) expect(boardTabShownFor(flag, tab, cardsUpper, false)).toBe(boardTabShown(flag, tab, cardsUpper));
      for (const inField of BOOLS) {
        for (const picker of BOOLS) {
          for (const boardExpanded of [undefined, ...BOOLS]) {
            for (const boardDragging of [undefined, ...BOOLS]) {
              for (const boardSelected of [undefined, ...BOOLS]) {
                const opts = { inField, picker, boardExpanded, boardDragging, boardSelected };
                expect(escActionFor(tab, opts, false)).toBe(escAction(tab, opts));
              }
            }
          }
        }
      }
    }
    expect(boardExpandShown(false)).toBe(true);
  });
});

describe('ボードを上に出しているとき', () => {
  const input = (over: Partial<Parameters<typeof chromeFor>[0]> = {}) => ({ tab: 'memo' as PaneTab, upper: false, memoOpen: true, sheetEmpty: false, ...over });

  it('下の帯はメモのまま、ボードの面だけが出ている（ボードのタブは「選んでいる」状態にならない）', () => {
    const c = chromeForPlaces({ ...input(), boardUpper: true });
    expect(c).toEqual({ ...chromeFor(input()), boardRootHidden: false, boardSelected: false, boardInUpper: true });
    expect(c.memoSelected).toBe(true);
    expect(c.cardsRootHidden).toBe(true);
  });
  it('tab が board のままでも（上にいるボードは下の帯のタブではないので）メモと同じ', () => {
    for (const memoOpen of BOOLS) {
      for (const sheetEmpty of BOOLS) {
        expect(chromeForPlaces({ ...input({ tab: 'board', memoOpen, sheetEmpty }), boardUpper: true })).toEqual(chromeForPlaces({ ...input({ tab: 'memo', memoOpen, sheetEmpty }), boardUpper: true }));
      }
    }
  });
  it('Grok Cards を下で見ていても、ボードは上に出ている', () => {
    const c = chromeForPlaces({ ...input({ tab: 'cards' }), boardUpper: true });
    expect(c).toEqual({ ...chromeFor(input({ tab: 'cards' })), boardRootHidden: false, boardSelected: false, boardInUpper: true });
    expect(c.cardsRootHidden).toBe(false);
    expect(c.cardsSelected).toBe(true);
    expect(c.memoSelected).toBe(false);
  });
  it('ボードのタブは旗がオンなら出ていて、押すと下へ戻す', () => {
    for (const tab of TABS) {
      expect(boardTabShownFor(true, tab, false, true)).toBe(true);
      expect(boardTabShownFor(false, tab, false, true)).toBe(false);
      expect(boardTabClickFor(tab, true)).toBe('place-bottom');
    }
  });
  it('［拡大］は出さない', () => {
    expect(boardExpandShown(true)).toBe(false);
  });
  it('Esc：つまむのを取り消す→選びを外す、まで。縮める・メモへ戻す・下へ戻すはしない', () => {
    const o = { inField: false, picker: false };
    expect(escActionFor('memo', { ...o, boardDragging: true }, true)).toBe('cancel-drag');
    expect(escActionFor('memo', { ...o, boardDragging: true, inField: true }, true)).toBe('cancel-drag');
    expect(escActionFor('memo', { ...o, boardSelected: true }, true)).toBe('clear-selection');
    expect(escActionFor('memo', { ...o, boardSelected: true, inField: true }, true)).toBe('ignore');
    expect(escActionFor('memo', { ...o, boardExpanded: true }, true)).toBe('ignore');
    expect(escActionFor('memo', o, true)).toBe('ignore');
    expect(escActionFor('board', o, true)).toBe('ignore');
  });
  it('Esc：Grok Cards を下で見ているときは Grok Cards の Esc（欄の中は何もしない・選び窓を閉じる・メモへ戻る）', () => {
    expect(escActionFor('cards', { inField: true, picker: false }, true)).toBe('ignore');
    expect(escActionFor('cards', { inField: false, picker: true }, true)).toBe('close-picker');
    expect(escActionFor('cards', { inField: false, picker: false }, true)).toBe('show-memo');
  });
});
