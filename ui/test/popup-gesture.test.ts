import { describe, expect, it } from 'vitest';

import { activationMovesBoard, detailCardActionClosesPin, nextTabPress, popupsHiddenWhileDragging } from '../src/popup-gesture';

describe('nextTabPress', () => {
  it('1回目は詳しいカード。同じタブを 400ms 以内にもう一度で開く', () => {
    const first = nextTabPress(null, 5, 1000, 400);
    expect(first).toEqual({ open: false, last: { id: 5, at: 1000 } });
    expect(nextTabPress(first.last, 5, 1400, 400)).toEqual({ open: true, last: null });
  });
  it('間が長い・別のタブは、新しい1回目', () => {
    const first = nextTabPress(null, 5, 0, 400);
    expect(nextTabPress(first.last, 5, 401, 400)).toEqual({ open: false, last: { id: 5, at: 401 } });
    expect(nextTabPress(first.last, 6, 200, 400)).toEqual({ open: false, last: { id: 6, at: 200 } });
  });
  it('開いたあとの次は、また1回目', () => {
    const opened = nextTabPress({ id: 5, at: 0 }, 5, 100, 400);
    expect(opened.open).toBe(true);
    expect(nextTabPress(opened.last, 5, 150, 400).open).toBe(false);
  });
});

describe('popupsHiddenWhileDragging', () => {
  it('動かした盤面のものは、種類にかかわらず隠す', () => {
    expect(popupsHiddenWhileDragging(null)).toBe(false);
    expect(popupsHiddenWhileDragging({ moved: false })).toBe(false);
    for (const kind of ['cell', 'memo', 'row', 'portal', 'group']) {
      expect(popupsHiddenWhileDragging({ kind, moved: true })).toBe(true);
    }
  });
  it('盤面をずらすだけ（moved が無い）では隠さない', () => {
    expect(popupsHiddenWhileDragging({ kind: 'pan' })).toBe(false);
  });
});

describe('detailCardActionClosesPin', () => {
  it('サイトを開く・下で開くは固定を外す', () => {
    expect(detailCardActionClosesPin('open-site')).toBe(true);
    expect(detailCardActionClosesPin('open-below')).toBe(true);
    expect(detailCardActionClosesPin('other')).toBe(false);
  });
});

describe('activationMovesBoard', () => {
  it('今のシートと、小窓で見ているシートには移さない', () => {
    expect(activationMovesBoard('main', 'main', 'other')).toBe(false);
    expect(activationMovesBoard('other', 'main', 'other')).toBe(false);
    expect(activationMovesBoard('other', 'main', null)).toBe(true);
    expect(activationMovesBoard('third', 'main', 'other')).toBe(true);
  });
});
