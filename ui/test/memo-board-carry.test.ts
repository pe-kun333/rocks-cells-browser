import { describe, expect, it } from 'vitest';
import { boardCarryMemo, type BoardMemoInfo, carryLabel, sentFromLower } from '../src/memo-board-pick';

const info = (other: boolean): BoardMemoInfo => ({ shownId: 'B', shownTitle: 'メモB', lowerId: 'A', lowerTitle: 'メモA', chosen: other, other });

describe('下から上のボードへ運ぶ道（CB8）', () => {
  it('上に出していて別のメモを見ているときだけ、運ぶ先がある', () => {
    expect(boardCarryMemo(info(true), true)).toEqual({ id: 'B', title: 'メモB' });
    expect(boardCarryMemo(info(true), false)).toBeNull();
    expect(boardCarryMemo(info(false), true)).toBeNull();
    expect(boardCarryMemo(null, true)).toBeNull();
  });

  it('項目の文', () => {
    expect(carryLabel('メモB', 'copy')).toBe('↑ 上のボード「メモB」へ写す');
    expect(carryLabel('メモB', 'move')).toBe('↑ 上のボード「メモB」へ移す');
  });
});

describe('届いた印の送り手（CB8）', () => {
  it('下から送っていなければ下の分ではない', () => {
    expect(sentFromLower({ lowerSentAt: null, boardSentAt: 100, now: 200 })).toBe(false);
  });
  it('ボードが貼った直後に下から送ったら、下の分', () => {
    expect(sentFromLower({ lowerSentAt: 150, boardSentAt: 100, now: 200 })).toBe(true);
  });
  it('下から送った直後にボードが貼ったら、ボードの分', () => {
    expect(sentFromLower({ lowerSentAt: 100, boardSentAt: 150, now: 200 })).toBe(false);
  });
  it('ボードが送っていなければ、下の分', () => {
    expect(sentFromLower({ lowerSentAt: 100, boardSentAt: null, now: 200 })).toBe(true);
  });
  it('10 秒より前の送りは数えない', () => {
    expect(sentFromLower({ lowerSentAt: 100, boardSentAt: null, now: 10_101 })).toBe(false);
    expect(sentFromLower({ lowerSentAt: 100, boardSentAt: null, now: 10_100 })).toBe(true);
  });
});
