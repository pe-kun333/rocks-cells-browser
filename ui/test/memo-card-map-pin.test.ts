import { describe, expect, it } from 'vitest';

import { avoidPlacement, boxesOverlap, clampInto, edgeLabelPoint, MAP_EDGE_LABEL_OFFSET, MAP_SIDES, nearestSide, pinPlacement, sidePlacement } from '../src/memo-card-map';

describe('edgeLabelPoint', () => {
  it('右向きの線：真ん中の上（向きの左）へずらす', () => {
    expect(edgeLabelPoint({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ x: 50, y: -MAP_EDGE_LABEL_OFFSET });
  });

  it('A→B と B→A は反対側に出る（重ならない）', () => {
    const a = { x: 10, y: 20 };
    const b = { x: 110, y: 80 };
    const ab = edgeLabelPoint(a, b);
    const ba = edgeLabelPoint(b, a);
    expect(Math.hypot(ab.x - ba.x, ab.y - ba.y)).toBeCloseTo(MAP_EDGE_LABEL_OFFSET * 2);
    expect((ab.x + ba.x) / 2).toBeCloseTo(60);
    expect((ab.y + ba.y) / 2).toBeCloseTo(50);
  });

  it('下向きの線は右へずれる（画面の y は下向き）', () => {
    const p = edgeLabelPoint({ x: 0, y: 0 }, { x: 0, y: 40 }, 6);
    expect(p.x).toBeCloseTo(6);
    expect(p.y).toBeCloseTo(20);
  });

  it('長さ 0 の線は真ん中のまま', () => {
    expect(edgeLabelPoint({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});

describe('pinPlacement', () => {
  const area = { left: 0, top: 30, right: 800, bottom: 500 };
  const size = { w: 300, h: 200 };

  it('入るときは札の右、上の縁にそろえる', () => {
    expect(pinPlacement({ left: 100, top: 100, right: 260, bottom: 132 }, size, area)).toEqual({ x: 268, y: 100, side: 'right' });
  });

  it('右に入らなければ左', () => {
    expect(pinPlacement({ left: 600, top: 100, right: 760, bottom: 132 }, size, area)).toEqual({ x: 292, y: 100, side: 'left' });
  });

  it('どちらにも入らなければ広い方に置き、窓の中に収める', () => {
    const narrow = { left: 0, top: 0, right: 400, bottom: 500 };
    const p = pinPlacement({ left: 50, top: 10, right: 210, bottom: 42 }, size, narrow);
    expect(p.side).toBe('right');
    expect(p.x).toBe(96); // 400 - 4 - 300
    expect(p.y).toBe(10);
  });

  it('下にはみ出すときは上へ寄せる。上の帯（area.top）より上には出さない', () => {
    expect(pinPlacement({ left: 100, top: 450, right: 260, bottom: 482 }, size, area).y).toBe(296); // 500 - 4 - 200
    expect(pinPlacement({ left: 100, top: 0, right: 260, bottom: 32 }, size, area).y).toBe(34);
  });

  it('カードが窓より大きいときは左上の縁にそろえる', () => {
    const p = pinPlacement({ left: 10, top: 40, right: 170, bottom: 72 }, { w: 900, h: 900 }, area);
    expect(p).toEqual({ x: 4, y: 34, side: 'right' });
  });
});

describe('sidePlacement', () => {
  const area = { left: 0, top: 30, right: 800, bottom: 600 };
  const size = { w: 200, h: 100 };
  const node = { left: 300, top: 250, right: 460, bottom: 282 };

  it('4 つの側に置ける（左右は上の縁、上下は左の縁にそろえる）', () => {
    expect(sidePlacement(node, size, area, 'right')).toEqual({ x: 468, y: 250, side: 'right' });
    expect(sidePlacement(node, size, area, 'left')).toEqual({ x: 92, y: 250, side: 'left' });
    expect(sidePlacement(node, size, area, 'top')).toEqual({ x: 300, y: 142, side: 'top' });
    expect(sidePlacement(node, size, area, 'bottom')).toEqual({ x: 300, y: 290, side: 'bottom' });
  });

  it('入らない側は、その時だけ反対の側', () => {
    const nearTop = { left: 300, top: 60, right: 460, bottom: 92 };
    expect(sidePlacement(nearTop, size, area, 'top')).toEqual({ x: 300, y: 100, side: 'bottom' });
    const nearRight = { left: 640, top: 250, right: 800 - 10, bottom: 282 };
    expect(sidePlacement(nearRight, size, area, 'right').side).toBe('left');
  });

  it('入る側は、縁に沿ってずらして窓に収める（側は変えない）', () => {
    const nearRightEdge = { left: 700, top: 500, right: 790, bottom: 532 };
    const p = sidePlacement(nearRightEdge, size, area, 'top');
    expect(p.side).toBe('top');
    expect(p.x).toBe(596); // 800 - 4 - 200
    expect(p.y).toBe(392);
  });

  it('どちらにも入らなければ空きの広い方', () => {
    const small = { left: 0, top: 0, right: 300, bottom: 200 };
    const n = { left: 100, top: 40, right: 200, bottom: 60 };
    expect(sidePlacement(n, size, small, 'top').side).toBe('bottom');
    expect(sidePlacement(n, size, small, 'bottom').side).toBe('bottom');
  });

  it('pinPlacement は右（入らなければ左）のまま', () => {
    for (const side of MAP_SIDES) expect(sidePlacement(node, size, area, side).side).toBe(side);
    expect(pinPlacement(node, size, area)).toEqual(sidePlacement(node, size, area, 'right'));
  });
});

describe('nearestSide', () => {
  const c = { x: 100, y: 100 };
  it('角度で 4 つに分ける', () => {
    expect(nearestSide(c, { x: 200, y: 120 })).toBe('right');
    expect(nearestSide(c, { x: 0, y: 60 })).toBe('left');
    expect(nearestSide(c, { x: 130, y: 0 })).toBe('top');
    expect(nearestSide(c, { x: 80, y: 300 })).toBe('bottom');
  });
  it('斜め 45° ちょうどは左右、重なっていれば右', () => {
    expect(nearestSide(c, { x: 150, y: 150 })).toBe('right');
    expect(nearestSide(c, { x: 50, y: 50 })).toBe('left');
    expect(nearestSide(c, c)).toBe('right');
  });
});

describe('boxesOverlap と clampInto', () => {
  const area = { left: 0, top: 100, right: 600, bottom: 400 };
  it('見えている・見えていない', () => {
    expect(boxesOverlap({ left: 10, top: 120, right: 50, bottom: 150 }, area)).toBe(true);
    expect(boxesOverlap({ left: 10, top: 20, right: 50, bottom: 100 }, area)).toBe(false); // 上の縁にちょうど接する：見えていない
    expect(boxesOverlap({ left: 10, top: 390, right: 50, bottom: 450 }, area)).toBe(true);
    expect(boxesOverlap({ left: 610, top: 120, right: 650, bottom: 150 }, area)).toBe(false);
  });
  it('最後の位置を、置ける所に収める', () => {
    const size = { w: 200, h: 100 };
    expect(clampInto({ x: 50, y: 150 }, size, area)).toEqual({ x: 50, y: 150 });
    expect(clampInto({ x: 50, y: -40 }, size, area)).toEqual({ x: 50, y: 104 });
    expect(clampInto({ x: 500, y: 380 }, size, area)).toEqual({ x: 396, y: 296 });
    expect(clampInto({ x: 500, y: 380 }, { w: 900, h: 900 }, area)).toEqual({ x: 4, y: 104 });
  });
});

describe('avoidPlacement', () => {
  const area = { left: 0, top: 0, right: 1000, bottom: 600 };
  const size = { w: 300, h: 150 };
  const node = { left: 20, top: 100, right: 320, bottom: 500 }; // 背の高い並びのカード

  it('障りものが無ければ、ふつうの置き所', () => {
    expect(avoidPlacement(node, size, area, 'right', [])).toEqual({ x: 328, y: 100, side: 'right', avoided: false });
  });

  it('右に出すと関連の欄に重なる：同じ右で、欄の下へずらす', () => {
    const popover = { left: 220, top: 120, right: 610, bottom: 260 };
    const p = avoidPlacement(node, size, area, 'right', [popover, node]);
    expect(p).toEqual({ x: 328, y: 268, side: 'right', avoided: true });
  });

  it('ずらしても並ばないときは、次の側（下・左・上）', () => {
    const shortNode = { left: 300, top: 100, right: 600, bottom: 140 };
    const popover = { left: 500, top: 60, right: 1000, bottom: 400 }; // 右は全部ふさぐ
    const p = avoidPlacement(shortNode, size, area, 'right', [popover, shortNode]);
    expect(p).toEqual({ x: 192, y: 148, side: 'bottom', avoided: true });
    expect(boxesOverlap({ left: p.x, top: p.y, right: p.x + size.w, bottom: p.y + size.h }, popover)).toBe(false);
  });

  it('どこも重なるときは、選んだ側のまま（avoided は false）', () => {
    const everywhere = { left: 0, top: 0, right: 1000, bottom: 600 };
    const p = avoidPlacement(node, size, area, 'left', [everywhere]);
    expect(p.avoided).toBe(false);
    expect(p).toEqual({ ...sidePlacement(node, size, area, 'left'), avoided: false });
  });

  it('選んだ側が空いていれば、選んだ側を先に使う', () => {
    const popover = { left: 330, top: 100, right: 700, bottom: 300 };
    const p = avoidPlacement({ left: 400, top: 320, right: 560, bottom: 352 }, size, area, 'bottom', [popover]);
    expect(p).toEqual({ x: 400, y: 360, side: 'bottom', avoided: false });
  });
});
