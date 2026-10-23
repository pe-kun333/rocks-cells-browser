import { describe, expect, it } from 'vitest';

import { centerPan, clampBox, ClickCounter, peekBox } from '../src/sheet-peek-logic';

describe('ClickCounter', () => {
  it('同じものを 400ms 以内に2回 → 1回目の key', () => {
    const c = new ClickCounter();
    expect(c.press('p:a', 1000)).toBeNull();
    expect(c.press('p:a', 1300)).toBe('p:a');
  });
  it('間が長い・別のもの → ダブルクリックにならない', () => {
    const c = new ClickCounter();
    c.press('p:a', 0);
    expect(c.press('p:a', 401)).toBeNull();
    expect(c.press('p:b', 500)).toBeNull();
    expect(c.press('p:a', 600)).toBeNull();
  });
  it('3回目は新しい1回目', () => {
    const c = new ClickCounter();
    c.press('x', 0);
    expect(c.press('x', 100)).toBe('x');
    expect(c.press('x', 200)).toBeNull();
    expect(c.press('x', 300)).toBe('x');
  });
  it('空いた所（null）は数えを消す', () => {
    const c = new ClickCounter();
    c.press('x', 0);
    expect(c.press(null, 50)).toBeNull();
    expect(c.press('x', 100)).toBeNull();
  });
  it('sticky：2回目の的が違っても（空いた所でも）ダブルクリック', () => {
    const c = new ClickCounter();
    c.press('p:a', 0, true);
    expect(c.press('t:5', 200)).toBe('p:a');
    c.press('p:a', 1000, true);
    expect(c.press(null, 1200)).toBe('p:a');
    c.press('p:a', 2000, true);
    expect(c.press('t:5', 2500)).toBeNull();
  });
});

describe('centerPan', () => {
  it('セルが無ければ原点を窓のまん中に', () => {
    expect(centerPan([], { width: 200, height: 100 }, 0.75)).toEqual({ x: 100, y: 50 });
  });
  it('囲む四角のまん中を、拡大率をかけて窓のまん中に', () => {
    const pan = centerPan([{ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 20, y: -40 }], { width: 300, height: 200 }, 0.5);
    expect(pan).toEqual({ x: 150 - 50 * 0.5, y: 100 - 0 });
    // まん中の点が窓のまん中に写る
    expect(50 * 0.5 + pan.x).toBe(150);
  });
});

describe('peekBox', () => {
  const area = { left: 0, top: 0, width: 280, height: 600 };
  it('幅は盤面 − 16、高さは 45%、入口のすぐ下', () => {
    const b = peekBox({ left: 100, top: 100, width: 40, height: 40 }, area);
    expect(b).toEqual({ left: 8, top: 146, width: 264, height: 270 });
  });
  it('下に入らなければすぐ上', () => {
    const b = peekBox({ left: 100, top: 450, width: 40, height: 40 }, area);
    expect(b.top).toBe(450 - 6 - 270);
  });
  it('どちらにも入らなければ、広い方で入口に重ならない高さに低くする', () => {
    const small = { left: 0, top: 0, width: 280, height: 400 }; // 高さ 180 の窓
    const b = peekBox({ left: 100, top: 150, width: 40, height: 40 }, small);
    // 下の空き 400-8-196=196 ≥ 上の空き 150-6-8=136 → 下。高さは 180 のまま入る
    expect(b.top).toBe(196);
    expect(b.top + b.height).toBeLessThanOrEqual(392);
    const mid = peekBox({ left: 100, top: 170, width: 40, height: 40 }, { left: 0, top: 0, width: 280, height: 380 });
    // 高さ 171、下の空き 380-8-216=156、上の空き 170-14=156 → 下で 156 に
    expect(mid).toEqual({ left: 8, top: 216, width: 264, height: 156 });
  });
  it('入口に重ならずに 120px も取れなければ、120px で重なってもよい（盤面の中）', () => {
    const tiny = { left: 0, top: 0, width: 280, height: 260 };
    const b = peekBox({ left: 100, top: 110, width: 40, height: 40 }, tiny);
    expect(b.height).toBe(120);
    expect(b.top).toBeGreaterThanOrEqual(8);
    expect(b.top + b.height).toBeLessThanOrEqual(252);
  });
  it('clampBox：盤面の外へは出ない', () => {
    expect(clampBox({ left: -50, top: 900, width: 100, height: 100 }, area)).toEqual({ left: 0, top: 500, width: 100, height: 100 });
  });
});
