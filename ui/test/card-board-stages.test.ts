import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_PLACE_KEY,
  BOARD_UPPER_RATIO_KEY,
  CARD_BOARD_EVENT,
  boardUpperEnabled,
  onBoardPlace,
  placeGates,
  readBoardPlace,
  readBoardUpperRatio,
  readPlaces,
  requestPlace,
  settleBoardPlace,
  writeBoardPlace,
  writeBoardUpperRatio,
} from '../src/card-board-stages';
import { CARDS_PLACE_KEY, CARDS_STAGES_KEY, CARDS_UPPER_RATIO_KEY, cardsStageOn, cardsStagesFromStorage, readCardsOpen, readCardsPlace, readUpperRatio } from '../src/cards-stages';
import { PLACE_BUMP_NOTE } from '../src/memo-card-board-place';

// ---------- 旗の廃止（2026-10-25・利用者の指示「旗を本体に反映」）：ボード・上に出す・段 "3" は常にオン ----------
describe('旗の廃止：ボード（段 "1"）・上に出す（段 "2"）・Grok Cards の段 "3" は常にオン', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const OLD_BOARD_KEY = 'honeycomb.cardBoardStages'; // 廃止した鍵（もう読まない）
  const OLD_PICKER_KEY = 'honeycomb.boardMemoPicker'; // 廃止した鍵（もう読まない）

  it('何も書かないで読むと：上に出す（ボードの旗だった段 "1"・"2"）・段 "3" がオン', () => {
    expect(boardUpperEnabled()).toBe(true);
    expect(cardsStageOn('3')).toBe(true);
  });

  it('Grok Cards の段のうち "3" 以外（1・2・4〜9）は、鍵が無ければオンにならない（段 "3" が常にオンでも波及しない）', () => {
    for (const stage of ['1', '2', '4', '5', '6', '7', '8', '9']) expect(cardsStageOn(stage)).toBe(false);
    expect(readCardsPlace()).toBe('bottom'); // 段 9 が無いので下
    expect(readUpperRatio()).toBe(0.5);
    expect(readBoardPlace()).toBe('bottom'); // 置き場の鍵が無いので下（初期位置は下のまま）
    expect(readBoardUpperRatio()).toBe(0.5);
    expect(readPlaces()).toEqual({ places: { cards: 'bottom', board: 'bottom' }, bumped: null });
  });

  it('読むだけでは鍵を書かない（localStorage は空のまま）', () => {
    cardsStageOn('3');
    readCardsOpen();
    boardUpperEnabled();
    readBoardPlace();
    readBoardUpperRatio();
    readPlaces();
    settleBoardPlace();
    expect(store.size).toBe(0);
  });

  it('旧いボードの旗・選び口の旗が残っていても読まない：[]・["1"]・["2"]・壊れた値・"off" でも、ボードと上に出すはオンのまま', () => {
    for (const raw of ['[]', '["1"]', '["2"]', '["3"]', '[', '', '{}', '"1"', 'null', '1', 'off', 'on']) {
      store.set(OLD_BOARD_KEY, raw);
      store.set(OLD_PICKER_KEY, raw);
      expect(boardUpperEnabled(), `raw=${raw}`).toBe(true);
      expect(readPlaces(), `raw=${raw}`).toEqual({ places: { cards: 'bottom', board: 'bottom' }, bumped: null });
    }
    // 旧い鍵があっても、［上に出す］は効く。書くのは boardPlace だけ（旧い鍵は触らない・消さない）
    store.clear();
    store.set(OLD_BOARD_KEY, '["1"]');
    store.set(OLD_PICKER_KEY, 'off');
    expect(requestPlace({ who: 'board', to: 'upper' }).changed).toBe(true);
    expect(readBoardPlace()).toBe('upper');
    expect(store.get(OLD_BOARD_KEY)).toBe('["1"]');
    expect(store.get(OLD_PICKER_KEY)).toBe('off');
  });

  it('旧い cardsStages が [] や "3" の無い配列でも、段 "3" はオン。ほかの段はその鍵に入っているものだけ', () => {
    for (const raw of ['[]', '["1","2"]', '["9"]', '[', '', '{}', '"3"', 'null', '3']) {
      store.set(CARDS_STAGES_KEY, raw);
      expect(cardsStageOn('3'), `raw=${raw}`).toBe(true);
    }
    store.set(CARDS_STAGES_KEY, '[]');
    for (const stage of ['1', '2', '4', '5', '6', '7', '8', '9']) expect(cardsStageOn(stage), `[] stage=${stage}`).toBe(false);
    store.set(CARDS_STAGES_KEY, '["3"]');
    for (const stage of ['1', '2', '4', '5', '6', '7', '8', '9']) expect(cardsStageOn(stage), `["3"] stage=${stage}`).toBe(false);
    store.set(CARDS_STAGES_KEY, '["1","2","4"]');
    expect(['1', '2', '3', '4', '5', '9'].map((s) => cardsStageOn(s))).toEqual([true, true, true, true, false, false]);
    store.set(CARDS_STAGES_KEY, '["1","2","3","4","5","6","7","8","9"]');
    for (const stage of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) expect(cardsStageOn(stage)).toBe(true);
  });

  it('今までの利用者の保存値（["1","2","3"]・["1"]・段 9 入りなど）も、段 "3" 以外は今までと同じに読める', () => {
    store.set(OLD_BOARD_KEY, '["1"]');
    store.set(CARDS_STAGES_KEY, '["1","2","3"]');
    expect(boardUpperEnabled()).toBe(true);
    expect(cardsStageOn('3')).toBe(true);
    expect(cardsStageOn('9')).toBe(false);
  });

  it('鍵を消しても・戻しても同じ（旗が無いので、鍵の有無でボードは変わらない）', () => {
    store.set(CARDS_STAGES_KEY, '[]');
    store.set(OLD_BOARD_KEY, '[]');
    expect(cardsStageOn('3')).toBe(true);
    expect(boardUpperEnabled()).toBe(true);
    store.delete(CARDS_STAGES_KEY);
    store.delete(OLD_BOARD_KEY);
    expect(cardsStageOn('3')).toBe(true);
    expect(boardUpperEnabled()).toBe(true);
  });

  it('鍵が無いまま（ふだん）：［上に出す］を押すと上へ、下に戻すと下へ。書くのは boardPlace だけで、旗の鍵は書かない', () => {
    expect(requestPlace({ who: 'board', to: 'upper' }).changed).toBe(true);
    expect(readBoardPlace()).toBe('upper');
    expect(store.get(BOARD_PLACE_KEY)).toBe('"upper"');
    expect([...store.keys()]).toEqual([BOARD_PLACE_KEY]);
    expect(requestPlace({ who: 'board', to: 'bottom' }).changed).toBe(true);
    expect(readBoardPlace()).toBe('bottom');
    expect(store.get(OLD_BOARD_KEY)).toBeUndefined();
    expect(store.get(CARDS_STAGES_KEY)).toBeUndefined();
    expect(store.has(CARDS_PLACE_KEY)).toBe(false);
  });

  it('段 9 は既定にならない：ふだんは Grok Cards を上に出せない（取り合いも起きない）', () => {
    expect(placeGates()).toEqual({ stage9: false, stage2: true });
    expect(requestPlace({ who: 'cards', to: 'upper' }).changed).toBe(false);
    expect(store.has(CARDS_PLACE_KEY)).toBe(false);
  });

  it('localStorage が使えなくても例外を出さない（段 "3" と上に出すはオン。ほかの段はオフ）', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect(boardUpperEnabled()).toBe(true);
    expect(cardsStageOn('3')).toBe(true);
    expect(cardsStageOn('9')).toBe(false);
  });

  it('純関数：cardsStagesFromStorage は入っている段を読むだけ（鍵が無い・壊れた値は空。段 "3" は cardsStageOn が常にオンにする）', () => {
    expect([...cardsStagesFromStorage(null)]).toEqual([]);
    expect([...cardsStagesFromStorage('[]')]).toEqual([]);
    expect([...cardsStagesFromStorage('x')]).toEqual([]);
    expect([...cardsStagesFromStorage('["3",4]')]).toEqual(['3', 4]);
  });
});
// ---------- 案 C「上に出す」の置き場と割合（C2） ----------
describe('置き場・割合の保存（C2）', () => {
  const store = new Map<string, string>();
  const events: string[] = [];
  let win: EventTarget;
  const set = (k: string, v: unknown) => void store.set(k, JSON.stringify(v));
  const flags = (cards: string[] = ['3', '9']) => void set(CARDS_STAGES_KEY, cards);
  const storageEvent = (key: string | null) => Object.assign(new Event('storage'), { key });
  beforeEach(() => {
    store.clear();
    events.length = 0;
    win = new EventTarget();
    for (const name of [CARD_BOARD_EVENT, 'honeycomb-cards']) win.addEventListener(name, () => events.push(name));
    vi.stubGlobal('window', win);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('上に出す（旗の段 "2" は廃止＝常にオン）', () => {
    it('いつでも「上に出せる」（Grok Cards の旗が何でも変わらない）', () => {
      expect(boardUpperEnabled()).toBe(true);
      flags([]);
      expect(boardUpperEnabled()).toBe(true);
    });
  });

  describe('ボードの置き場', () => {
    it('鍵が無いときは下。upper だけを上と読む', () => {
      flags();
      expect(readBoardPlace()).toBe('bottom');
      set(BOARD_PLACE_KEY, 'upper');
      expect(readBoardPlace()).toBe('upper');
      for (const v of ['bottom', 'Upper', '', 1, null, {}]) {
        set(BOARD_PLACE_KEY, v);
        expect(readBoardPlace()).toBe('bottom');
      }
      store.set(BOARD_PLACE_KEY, '{');
      expect(readBoardPlace()).toBe('bottom');
    });
    it('書く：段があれば書き、同じ面へ知らせる。同じ値は書かず、知らせない', () => {
      flags();
      expect(writeBoardPlace('upper')).toBe(true);
      expect(store.get(BOARD_PLACE_KEY)).toBe('"upper"');
      expect(events).toEqual([CARD_BOARD_EVENT]);
      expect(writeBoardPlace('upper')).toBe(false);
      expect(events).toEqual([CARD_BOARD_EVENT]);
      expect(writeBoardPlace('bottom')).toBe(true);
      expect(readBoardPlace()).toBe('bottom');
    });
    it('localStorage が使えなくても例外を出さない', () => {
      flags();
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      });
      expect(readBoardPlace()).toBe('bottom');
      expect(readBoardUpperRatio()).toBe(0.5);
      expect(writeBoardPlace('upper')).toBe(false);
      expect(writeBoardUpperRatio(0.4)).toBe(false);
    });
  });

  describe('境目の割合', () => {
    it('既定は半分。範囲外・数でない値も半分として読み、保存はしない', () => {
      flags();
      expect(readBoardUpperRatio()).toBe(0.5);
      for (const v of [0, 1, -0.2, 1.5, '0.3', null, {}]) {
        set(BOARD_UPPER_RATIO_KEY, v);
        expect(readBoardUpperRatio()).toBe(0.5);
        expect(store.get(BOARD_UPPER_RATIO_KEY)).toBe(JSON.stringify(v)); // 読んだだけでは書き換えない
      }
      set(BOARD_UPPER_RATIO_KEY, 0.3);
      expect(readBoardUpperRatio()).toBe(0.3);
    });
    it('書く：範囲内だけ。範囲外・NaN は書かない。同じ面へは知らせない（ドラッグの途中で作り直さない）', () => {
      flags();
      expect(writeBoardUpperRatio(0.4)).toBe(true);
      expect(store.get(BOARD_UPPER_RATIO_KEY)).toBe('0.4');
      expect(writeBoardUpperRatio(0.4)).toBe(false);
      for (const v of [0, 1, -1, 2, Number.NaN, Number.POSITIVE_INFINITY]) expect(writeBoardUpperRatio(v)).toBe(false);
      expect(store.get(BOARD_UPPER_RATIO_KEY)).toBe('0.4');
      expect(events).toEqual([]);
    });
    it('Grok Cards の割合の鍵とは別（片方を書いても他方は変わらない）', () => {
      flags();
      set(CARDS_UPPER_RATIO_KEY, 0.7);
      writeBoardUpperRatio(0.25);
      expect(store.get(CARDS_UPPER_RATIO_KEY)).toBe('0.7');
      expect(readUpperRatio()).toBe(0.7);
      expect(readBoardUpperRatio()).toBe(0.25);
    });
  });

  describe('取り合い（あとから出したほうが上）', () => {
    it('Grok Cards が上のとき、ボードを上に出す：Grok Cards の鍵を bottom に書き戻し、一言を返す', () => {
      flags();
      set(CARDS_PLACE_KEY, 'upper');
      const r = requestPlace({ who: 'board', to: 'upper' });
      expect(r.changed).toBe(true);
      expect(r.bumped).toBe('cards');
      expect(r.note).toBe(PLACE_BUMP_NOTE.cards);
      expect(store.get(CARDS_PLACE_KEY)).toBe('"bottom"');
      expect(store.get(BOARD_PLACE_KEY)).toBe('"upper"');
      expect(readCardsPlace()).toBe('bottom');
      expect(readPlaces()).toEqual({ places: { cards: 'bottom', board: 'upper' }, bumped: null });
    });
    it('ボードが上のとき、Grok Cards を上に出す：ボードの鍵を bottom に書き戻す', () => {
      flags();
      set(BOARD_PLACE_KEY, 'upper');
      const r = requestPlace({ who: 'cards', to: 'upper' });
      expect(r.bumped).toBe('board');
      expect(r.note).toBe(PLACE_BUMP_NOTE.board);
      expect(store.get(BOARD_PLACE_KEY)).toBe('"bottom"');
      expect(store.get(CARDS_PLACE_KEY)).toBe('"upper"');
      expect(readPlaces().places).toEqual({ cards: 'upper', board: 'bottom' });
    });
    it('書く順：下へ戻すほうを先に（別の面が「両方上」を見ない）', () => {
      flags();
      set(CARDS_PLACE_KEY, 'upper');
      const order: string[] = [];
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          order.push(`${k}=${v}`);
          store.set(k, v);
        },
      });
      requestPlace({ who: 'board', to: 'upper' });
      expect(order).toEqual([`${CARDS_PLACE_KEY}="bottom"`, `${BOARD_PLACE_KEY}="upper"`]);
      order.length = 0;
      requestPlace({ who: 'cards', to: 'upper' });
      expect(order).toEqual([`${BOARD_PLACE_KEY}="bottom"`, `${CARDS_PLACE_KEY}="upper"`]);
    });
    it('関係のない鍵は新しく作らない（ボードだけを上に出しても、Grok Cards の鍵は書かない）', () => {
      flags();
      requestPlace({ who: 'board', to: 'upper' });
      expect(store.has(CARDS_PLACE_KEY)).toBe(false);
      expect(store.get(BOARD_PLACE_KEY)).toBe('"upper"');
      store.delete(BOARD_PLACE_KEY);
      requestPlace({ who: 'cards', to: 'upper' });
      expect(store.has(BOARD_PLACE_KEY)).toBe(false);
      expect(store.get(CARDS_PLACE_KEY)).toBe('"upper"');
    });
    it('下に戻す：相手は動かさない。何もしない要求は書かない', () => {
      flags();
      set(BOARD_PLACE_KEY, 'upper');
      set(CARDS_PLACE_KEY, 'bottom');
      expect(requestPlace({ who: 'board', to: 'bottom' }).note).toBe('');
      expect(store.get(BOARD_PLACE_KEY)).toBe('"bottom"');
      expect(store.get(CARDS_PLACE_KEY)).toBe('"bottom"');
      const before = [...store.entries()];
      expect(requestPlace({ who: 'board', to: 'bottom' }).changed).toBe(false);
      expect([...store.entries()]).toEqual(before);
    });
    it('段 9 が無いと Grok Cards は上に出せず、鍵も書かない（ボードの取り合いにもならない）', () => {
      flags(['3']);
      set(CARDS_PLACE_KEY, 'upper'); // 段 9 が無いので無効
      expect(readPlaces().places).toEqual({ cards: 'bottom', board: 'bottom' });
      const r = requestPlace({ who: 'board', to: 'upper' });
      expect(r.bumped).toBeNull();
      expect(store.get(CARDS_PLACE_KEY)).toBe('"upper"'); // 触らない
      expect(requestPlace({ who: 'cards', to: 'upper' }).changed).toBe(false);
    });
    it('どの順に押しても、保存された鍵が「両方上」になることはない', () => {
      flags();
      const reqs = [
        { who: 'cards', to: 'upper' },
        { who: 'cards', to: 'bottom' },
        { who: 'board', to: 'upper' },
        { who: 'board', to: 'bottom' },
      ] as const;
      const walk = (depth: number) => {
        const both = store.get(CARDS_PLACE_KEY) === '"upper"' && store.get(BOARD_PLACE_KEY) === '"upper"';
        expect(both).toBe(false);
        if (depth === 0) return;
        const snap = new Map(store);
        for (const req of reqs) {
          requestPlace(req);
          walk(depth - 1);
          store.clear();
          for (const [k, v] of snap) store.set(k, v);
        }
      };
      walk(4);
    });
  });

  describe('起動時の整理（settleBoardPlace）', () => {
    it('両方が上と残っていたら、ボードの鍵を bottom に書き戻し、一言を返す', () => {
      flags();
      set(CARDS_PLACE_KEY, 'upper');
      set(BOARD_PLACE_KEY, 'upper');
      expect(readPlaces()).toEqual({ places: { cards: 'upper', board: 'bottom' }, bumped: 'board' });
      expect(store.get(BOARD_PLACE_KEY)).toBe('"upper"'); // 読んだだけでは書き換えない
      expect(settleBoardPlace()).toBe(PLACE_BUMP_NOTE.board);
      expect(store.get(BOARD_PLACE_KEY)).toBe('"bottom"');
      expect(store.get(CARDS_PLACE_KEY)).toBe('"upper"');
      expect(settleBoardPlace()).toBe(''); // 2 回目は何も起きない
    });
    it('取り合いが無ければ何も書かない', () => {
      flags();
      set(BOARD_PLACE_KEY, 'upper');
      const before = [...store.entries()];
      expect(settleBoardPlace()).toBe('');
      expect([...store.entries()]).toEqual(before);
      expect(events).toEqual([]);
    });
  });

  describe('通知（onBoardPlace）', () => {
    it('別の面からは storage（関係する鍵と、全消し）、同じ面からは honeycomb-cardboard で届く。関係ない鍵では届かない', () => {
      let n = 0;
      const off = onBoardPlace(() => void n++);
      for (const key of [BOARD_PLACE_KEY, BOARD_UPPER_RATIO_KEY, CARDS_PLACE_KEY, CARDS_STAGES_KEY, null]) win.dispatchEvent(storageEvent(key));
      expect(n).toBe(5);
      win.dispatchEvent(storageEvent('honeycomb.memoPane'));
      win.dispatchEvent(storageEvent('other'));
      win.dispatchEvent(storageEvent('honeycomb.cardBoardStages')); // 廃止した旗の鍵：もう気にしない
      win.dispatchEvent(storageEvent('honeycomb.boardMemoPicker'));
      expect(n).toBe(5);
      win.dispatchEvent(new Event(CARD_BOARD_EVENT));
      expect(n).toBe(6);
      off();
      win.dispatchEvent(new Event(CARD_BOARD_EVENT));
      win.dispatchEvent(storageEvent(BOARD_PLACE_KEY));
      expect(n).toBe(6);
    });
  });
});