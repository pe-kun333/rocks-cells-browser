import { describe, expect, it } from 'vitest';
import { BOARD_CARD, BOARD_LIMITS } from '../src/memo-card-board';
import { SPOT_RINGS, spotBeside } from '../src/memo-card-board-edit';

const px = BOARD_CARD.w + BOARD_CARD.gap;
const py = BOARD_CARD.h + BOARD_CARD.gap;

describe('spotBeside（選んだカードの右・下に足す場所）', () => {
  it('右：空いていれば升目 1 つ右', () => {
    expect(spotBeside({ x: 0, y: 0 }, 'right', [{ x: 0, y: 0 }])).toEqual({ x: px, y: 0 });
  });
  it('下：空いていれば升目 1 つ下', () => {
    expect(spotBeside({ x: 10, y: 20 }, 'down', [{ x: 10, y: 20 }])).toEqual({ x: 10, y: 20 + py });
  });
  it('埋まっていれば、その向きに進んで最初の空き', () => {
    const taken = [{ x: 0, y: 0 }, { x: px, y: 0 }, { x: px * 2 + 5, y: 3 }];
    expect(spotBeside({ x: 0, y: 0 }, 'right', taken)).toEqual({ x: px * 3, y: 0 });
    const down = [{ x: 0, y: 0 }, { x: 0, y: py }];
    expect(spotBeside({ x: 0, y: 0 }, 'down', down)).toEqual({ x: 0, y: py * 2 });
  });
  it('少しだけ重なるカードも避ける', () => {
    expect(spotBeside({ x: 0, y: 0 }, 'down', [{ x: 0, y: 0 }, { x: BOARD_CARD.w - 1, y: py + 1 }])).toEqual({ x: 0, y: py * 2 });
  });
  it('範囲の外に出るなら null', () => {
    const lim = BOARD_LIMITS.coord;
    expect(spotBeside({ x: lim - 10, y: 0 }, 'right', [])).toBeNull();
    expect(spotBeside({ x: 0, y: lim - 10 }, 'down', [])).toBeNull();
  });
  it('SPOT_RINGS 歩先まで埋まっていれば null', () => {
    const taken = Array.from({ length: SPOT_RINGS + 1 }, (_, k) => ({ x: px * k, y: 0 }));
    expect(spotBeside({ x: 0, y: 0 }, 'right', taken)).toBeNull();
  });
  it('右に足すとき、上下にずれたカードは邪魔にならない', () => {
    expect(spotBeside({ x: 0, y: 0 }, 'right', [{ x: 0, y: 0 }, { x: px, y: py }])).toEqual({ x: px, y: 0 });
  });
});
