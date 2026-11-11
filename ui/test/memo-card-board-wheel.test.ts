import { describe, expect, it } from 'vitest';
import { pinchZoomFactor, wheelPlan } from '../src/memo-card-board-view';

const base = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false };

describe('pinchZoomFactor', () => {
  it('deltaY 0 は 1', () => {
    expect(pinchZoomFactor(0)).toBe(1);
  });

  it('大きく下へ動かすと 0.8 に収まる', () => {
    expect(pinchZoomFactor(1000)).toBe(0.8);
  });

  it('大きく上へ動かすと 1.25 に収まる', () => {
    expect(pinchZoomFactor(-1000)).toBe(1.25);
  });

  it('小さい動きは exp(-deltaY * unit * 0.01) のまま', () => {
    expect(pinchZoomFactor(10)).toBeCloseTo(Math.exp(-0.1), 10);
    expect(pinchZoomFactor(1, 16)).toBeCloseTo(Math.exp(-0.16), 10);
  });

  it('有限でない値は 1', () => {
    expect(pinchZoomFactor(NaN)).toBe(1);
  });
});

describe('wheelPlan', () => {
  it('通常の wheel は移動（deltaMode 0 は単位 1）', () => {
    const p = wheelPlan({ ...base, deltaX: 3, deltaY: 5 }, 800);
    expect(p).toEqual({ kind: 'pan', dx: 3, dy: 5 });
  });

  it('deltaMode 1（行）は単位 16', () => {
    const p = wheelPlan({ ...base, deltaY: 2, deltaMode: 1 }, 800);
    expect(p.kind).toBe('pan');
    if (p.kind !== 'pan') return;
    expect(p.dx + 0).toBeCloseTo(0, 10);
    expect(p.dy).toBeCloseTo(32, 10);
  });

  it('deltaMode 2（ページ）は単位 pageHeight', () => {
    const p = wheelPlan({ ...base, deltaY: 1, deltaMode: 2 }, 300);
    expect(p.kind).toBe('pan');
    if (p.kind !== 'pan') return;
    expect(p.dx + 0).toBeCloseTo(0, 10);
    expect(p.dy).toBeCloseTo(300, 10);
  });

  it('Ctrl 付きは拡大縮小（ピンチ）', () => {
    const p = wheelPlan({ ...base, deltaY: 1000, ctrlKey: true }, 800);
    expect(p).toEqual({ kind: 'zoom', factor: 0.8 });
  });

  it('Ctrl 付きは deltaMode の単位も使う', () => {
    const p = wheelPlan({ ...base, deltaY: 1, deltaMode: 1, ctrlKey: true }, 800);
    expect(p.kind).toBe('zoom');
    if (p.kind !== 'zoom') return;
    expect(p.factor).toBeCloseTo(Math.exp(-0.16), 10);
  });

  it('metaKey は見ない（型にも無い。Ctrl が無ければ移動）', () => {
    const e = { ...base, deltaY: 5, metaKey: true } as typeof base & { metaKey: boolean };
    expect(wheelPlan(e, 800)).toEqual({ kind: 'pan', dx: 0, dy: 5 });
  });

  it('Shift で dx が 0 なら dx と dy を入れ替える（dy は 0）', () => {
    const p = wheelPlan({ ...base, deltaY: 5, shiftKey: true }, 800);
    expect(p.kind).toBe('pan');
    if (p.kind !== 'pan') return;
    expect(p.dx).toBeCloseTo(5, 10);
    expect(p.dy + 0).toBeCloseTo(0, 10);
  });

  it('Shift でも dx があるときは入れ替えない', () => {
    const p = wheelPlan({ ...base, deltaX: 2, deltaY: 5, shiftKey: true }, 800);
    expect(p).toEqual({ kind: 'pan', dx: 2, dy: 5 });
  });
});
