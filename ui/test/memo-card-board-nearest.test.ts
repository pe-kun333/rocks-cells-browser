import { describe, expect, it } from 'vitest';
import { BOARD_CARD } from '../src/memo-card-board';
import { BOARD_ARROW_DIR, centerMostCard, nearestInDirection } from '../src/memo-card-board-select';

const pos = (...rows: [string, number, number][]) => new Map(rows.map(([id, x, y]) => [id, { x, y }]));

describe('隣のカード（nearestInDirection）', () => {
  const abc = pos(['a', 0, 0], ['b', 200, 0], ['c', 100, 300]);

  it('仕様の例：a から右は b、下は c', () => {
    expect(nearestInDirection('a', abc, 'right')).toBe('b');
    expect(nearestInDirection('a', abc, 'down')).toBe('c');
  });
  it('仕様の例：b から左は a', () => {
    expect(nearestInDirection('b', abc, 'left')).toBe('a');
  });
  it('仕様の例：a から上と左は、候補が無いので null（端では動かない）', () => {
    expect(nearestInDirection('a', abc, 'up')).toBeNull();
    expect(nearestInDirection('a', abc, 'left')).toBeNull();
  });
  it('仕様の例：a(0,0) b(100,350)。a から右は横にずれすぎて null、下は b', () => {
    const ab = pos(['a', 0, 0], ['b', 100, 350]);
    expect(nearestInDirection('a', ab, 'right')).toBeNull();
    expect(nearestInDirection('a', ab, 'down')).toBe('b');
  });
  it('from の位置が無ければ null', () => {
    expect(nearestInDirection('x', abc, 'right')).toBeNull();
    expect(nearestInDirection('x', new Map(), 'down')).toBeNull();
  });
  it('同じ向き・同じ値なら pos の順で先のもの', () => {
    const first = pos(['a', 0, 0], ['b', 100, 50], ['c', 100, -50]);
    expect(nearestInDirection('a', first, 'right')).toBe('b');
    const second = pos(['a', 0, 0], ['c', 100, -50], ['b', 100, 50]);
    expect(nearestInDirection('a', second, 'right')).toBe('c');
  });
  it('main + side × 2 が一番小さいものを選ぶ（近くて真横のものが、遠くて真正面のものより勝つ）', () => {
    // 右へ：near は main 100・side 60（score 220）、far は main 150・side 0（score 150）。far が勝つ
    const p = pos(['a', 0, 0], ['near', 100, 60], ['far', 150, 0]);
    expect(nearestInDirection('a', p, 'right')).toBe('far');
    // near の side を 20 にすると score 140 で near が勝つ
    const q = pos(['a', 0, 0], ['near', 100, 20], ['far', 150, 0]);
    expect(nearestInDirection('a', q, 'right')).toBe('near');
  });
  it('side が main の 2 倍ちょうどは候補、それを超えると除外', () => {
    expect(nearestInDirection('a', pos(['a', 0, 0], ['b', 100, 200]), 'right')).toBe('b');
    expect(nearestInDirection('a', pos(['a', 0, 0], ['b', 100, 201]), 'right')).toBeNull();
  });
  it('同じ位置（main が 0）は候補にしない', () => {
    expect(nearestInDirection('a', pos(['a', 0, 0], ['b', 0, 0]), 'right')).toBeNull();
    expect(nearestInDirection('a', pos(['a', 0, 0], ['b', 0, 0]), 'down')).toBeNull();
  });
  it('上・左の向きも同じ決まりで選ぶ', () => {
    const p = pos(['a', 300, 300], ['u', 300, 100], ['l', 100, 300]);
    expect(nearestInDirection('a', p, 'up')).toBe('u');
    expect(nearestInDirection('a', p, 'left')).toBe('l');
  });
  it('回り込まない：書いた順の端から、反対側へは飛ばない', () => {
    // 右端の b から右へは何も無いので null（左端の a へ回らない）
    expect(nearestInDirection('b', abc, 'right')).toBeNull();
  });
  it('元の pos は書き換えない', () => {
    const p = pos(['a', 0, 0], ['b', 200, 0]);
    nearestInDirection('a', p, 'right');
    expect([...p.entries()]).toEqual([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 200, y: 0 }],
    ]);
  });
});

describe('矢印キーから向き（BOARD_ARROW_DIR）', () => {
  it('四つの矢印を向きに写す', () => {
    expect(BOARD_ARROW_DIR).toEqual({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' });
  });
});

describe('面の真ん中に近いカード（centerMostCard）', () => {
  it('カードが無ければ null', () => {
    expect(centerMostCard(new Map(), { x: 0, y: 0, zoom: 1 }, { w: 400, h: 300 })).toBeNull();
  });
  it('面の真ん中（画面の中心）に一番近いカードを選ぶ', () => {
    // 画面 400×300、原点は面の左上、拡大 1。真ん中は (200,150)
    const p = pos(['far', 1000, 1000], ['mid', 200 - BOARD_CARD.w / 2, 150 - BOARD_CARD.h / 2], ['near', 0, 0]);
    expect(centerMostCard(p, { x: 0, y: 0, zoom: 1 }, { w: 400, h: 300 })).toBe('mid');
  });
  it('見ている位置と拡大を使う（中心はボードの座標で決まる）', () => {
    // view.x=100、zoom=2 のとき、画面の (200,150) はボードの (50,75)
    const c = { x: 50, y: 75 };
    const p = pos(['a', c.x - BOARD_CARD.w / 2, c.y - BOARD_CARD.h / 2], ['b', 0, 0]);
    expect(centerMostCard(p, { x: 100, y: 0, zoom: 2 }, { w: 400, h: 300 })).toBe('a');
  });
  it('同じ距離なら pos の順で先のもの', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const vp = { w: 400, h: 300 };
    const left = 200 - BOARD_CARD.w / 2 - 50;
    const right = 200 - BOARD_CARD.w / 2 + 50;
    const y = 150 - BOARD_CARD.h / 2;
    expect(centerMostCard(pos(['l', left, y], ['r', right, y]), v, vp)).toBe('l');
    expect(centerMostCard(pos(['r', right, y], ['l', left, y]), v, vp)).toBe('r');
  });
  it('元の pos は書き換えない', () => {
    const p = pos(['a', 0, 0]);
    centerMostCard(p, { x: 0, y: 0, zoom: 1 }, { w: 400, h: 300 });
    expect([...p.entries()]).toEqual([['a', { x: 0, y: 0 }]]);
  });
});
