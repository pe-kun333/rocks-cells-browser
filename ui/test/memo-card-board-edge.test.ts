// 段 HX3：カードをつまんだまま面の端へ運ぶと、面が動いて先へ運べる（四角でも六角でも。形に頼らない）
//   純粋な関数（edgeBand・edgeSpeed・innerPoint・nextInner・edgePan・edgeFrameMove・edgePanStep・dragBoardDelta・groupDragBy・dragCancelPlan・viewToShowMoved）と、tab の配線（字面）を確かめる
//   DOM の動き（rAF で動き続ける・指から離れない・Esc で戻る）は開発画面と Windows の確かめ（計画書 §8.1 の確かめ A の (4)）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_LIMITS, boardToScreen, type BoardView } from '../src/memo-card-board';
import { dragBoardDelta, dragCancelPlan, EDGE_ARM_PX, EDGE_BAND_PX, EDGE_DT_MAX, EDGE_FRAME_MS, EDGE_SPEED_MAX, EDGE_SPEED_MIN, edgeBand, edgeFrameMove, edgePan, edgePanStep, edgeSpeed, groupDragBy, groupDragPositions, innerPoint, nextInner } from '../src/memo-card-board-select';
import { viewToShowMoved } from '../src/memo-card-board-view';

const vp = { w: 840, h: 217 };

describe('端の帯と速さ', () => {
  it('帯の幅：左右は 24px、上下は min(24, 面の高さ × 0.15)。どちらも面の大きさの半分まで', () => {
    expect([EDGE_BAND_PX, EDGE_ARM_PX]).toEqual([24, 24]);
    expect(edgeBand(vp)).toEqual({ x: 24, y: 24 }); // 217 × 0.15 ＝ 32.55
    expect(edgeBand({ w: 840, h: 100 })).toEqual({ x: 24, y: 15 });
    expect(edgeBand({ w: 840, h: 88 }).y).toBeCloseTo(13.2, 10); // 書く欄を開いた低い面
    expect(edgeBand({ w: 840, h: 51 }).y).toBeCloseTo(7.65, 10); // 道具の列と書く欄を両方開いた面（計画 §2）
    expect(edgeBand({ w: 30, h: 217 }).x).toBe(15); // 狭い面：左右の帯が重ならない
    expect(edgeBand({ w: 840, h: 0 })).toEqual({ x: 24, y: 0 });
    expect(edgeBand({ w: 0, h: 0 })).toEqual({ x: 0, y: 0 });
  });
  it('速さ：帯に入った深さに比べて 1 こま（16.7ms）に 2〜18px。帯の外は 0、縁と面の外は 18', () => {
    expect([EDGE_SPEED_MIN, EDGE_SPEED_MAX, EDGE_FRAME_MS, EDGE_DT_MAX]).toEqual([2, 18, 16.7, 50]);
    expect(edgeSpeed(0)).toBe(0);
    expect(edgeSpeed(-1)).toBe(0);
    expect(edgeSpeed(Number.NaN)).toBe(0);
    expect(edgeSpeed(0.01)).toBeCloseTo(2.16, 10);
    expect(edgeSpeed(0.5)).toBe(10);
    expect(edgeSpeed(1)).toBe(18);
    expect(edgeSpeed(3)).toBe(18);
  });
  it('面の中ほど（どの帯にも入っていない）か。境目（右 816・下 193）は中ほど。面に大きさが無ければ中ほどは無い', () => {
    expect(innerPoint({ x: 420, y: 108 }, vp)).toBe(true);
    expect(innerPoint({ x: 24, y: 24 }, vp)).toBe(true);
    expect(innerPoint({ x: 816, y: 193 }, vp)).toBe(true);
    expect(innerPoint({ x: 816.5, y: 108 }, vp)).toBe(false); // 右の帯
    expect(innerPoint({ x: 420, y: 193.5 }, vp)).toBe(false); // 下の帯
    expect(innerPoint({ x: -5, y: 108 }, vp)).toBe(false); // 面の外
    expect(innerPoint({ x: 0, y: 0 }, { w: 0, h: 0 })).toBe(false);
  });
  it('中ほどにいたかの印：一度立てば立ったまま', () => {
    expect(nextInner(false, { x: 420, y: 108 }, vp)).toBe(true);
    expect(nextInner(false, { x: 830, y: 108 }, vp)).toBe(false);
    expect(nextInner(true, { x: 830, y: 108 }, vp)).toBe(true);
  });
});

describe('edgePan（このこまの向きと量と、始める条件）', () => {
  const mid = { x: 420, y: 108 }; // 面の中ほどで押した
  it('押してから中ほどにいたなら、帯に入ると動く：右の帯は面を左へ（右の先を見せる）、上の帯は面を下へ。深さで速さが変わる', () => {
    expect(edgePan({ x: 828, y: 108 }, mid, true, vp)).toEqual({ dx: -10, dy: 0 }); // 深さ 0.5
    expect(edgePan({ x: 0, y: 108 }, mid, true, vp)).toEqual({ dx: 18, dy: 0 }); // 左の縁
    expect(edgePan({ x: 420, y: 211 }, mid, true, vp)).toEqual({ dx: 0, dy: -14 }); // 下の帯の深さ 0.75
    expect(edgePan({ x: 420, y: 6 }, mid, true, vp)).toEqual({ dx: 0, dy: 14 }); // 上の帯の深さ 0.75
    expect(edgePan({ x: 828, y: 211 }, mid, true, vp)).toEqual({ dx: -10, dy: -14 }); // 角は両方
    expect(edgePan(mid, mid, true, vp)).toEqual({ dx: 0, dy: 0 }); // 帯の外は動かない
    expect(edgePan({ x: 816, y: 193 }, mid, true, vp)).toEqual({ dx: 0, dy: 0 }); // 境目は動かない
  });
  it('帯の中で押して少し動かしただけでは始めない。面の縁ちょうど（x＝0）は面の中', () => {
    expect(edgePan({ x: 835, y: 100 }, { x: 830, y: 100 }, false, vp)).toEqual({ dx: 0, dy: 0 });
    expect(edgePan({ x: 420, y: 216 }, { x: 420, y: 200 }, false, vp)).toEqual({ dx: 0, dy: 0 }); // 下の帯の中で 16px
    expect(edgePan({ x: 0, y: 108 }, { x: 10, y: 108 }, false, vp)).toEqual({ dx: 0, dy: 0 });
    expect(edgePan({ x: 420, y: 3 }, { x: 420, y: 10 }, false, vp)).toEqual({ dx: 0, dy: 0 });
    expect(edgePan({ x: 838, y: 4 }, { x: 830, y: 10 }, false, vp)).toEqual({ dx: 0, dy: 0 }); // 角の中で少し
  });
  it('押した所から帯の向きへ 24px 動けば始める。同じ向きの帯の中からだと 24px で縁に着く（縁ちょうどの 840 は面の外ではない）', () => {
    expect(edgePan({ x: 840, y: 100 }, { x: 817, y: 100 }, false, vp)).toEqual({ dx: 0, dy: 0 }); // 23px
    expect(edgePan({ x: 840, y: 100 }, { x: 816, y: 100 }, false, vp)).toEqual({ dx: -18, dy: 0 }); // 24px（面の外ではないので、この条件だけで始まる）
    expect(edgePan({ x: 792, y: 100 }, { x: 816, y: 100 }, false, vp)).toEqual({ dx: 0, dy: 0 }); // 逆の向きへ 24px（帯の外）
  });
  it('ほかの向きの帯で押しても、こちらの向きへ 24px 動けば始める（横と縦は別々に見る）', () => {
    expect(edgePan({ x: 834, y: 10 }, { x: 810, y: 10 }, false, vp)).toEqual({ dx: -14, dy: 0 }); // 上の帯で押して右の帯へ 24px：横だけ動く
    expect(edgePan({ x: 833, y: 10 }, { x: 810, y: 10 }, false, vp)).toEqual({ dx: 0, dy: 0 }); // 23px
    const down = edgePan({ x: 5, y: 200 }, { x: 5, y: 100 }, false, vp); // 左の帯で押して下の帯へ
    expect(down.dx).toBe(0);
    expect(down.dy).toBeCloseTo(-6.6667, 3);
  });
  it('面の外へ出たら、押してから中ほどにいなくても、出た向きへ動かす（x＝−0.5 は面の外）', () => {
    expect(edgePan({ x: -0.5, y: 108 }, { x: 10, y: 108 }, false, vp)).toEqual({ dx: 18, dy: 0 });
    expect(edgePan({ x: 845, y: 100 }, { x: 830, y: 100 }, false, vp)).toEqual({ dx: -18, dy: 0 });
    expect(edgePan({ x: -30, y: 300 }, { x: 10, y: 200 }, false, vp)).toEqual({ dx: 18, dy: -18 });
    expect(edgePan({ x: 420, y: -40 }, { x: 420, y: 10 }, false, vp)).toEqual({ dx: 0, dy: 18 });
  });
  it('小さい面：高さ 0 なら動かない。高さ 51 なら帯 7.65 で中ほどが残る。幅 30 なら近い縁の側へ', () => {
    expect(edgePan({ x: 420, y: 10 }, { x: 420, y: 10 }, true, { w: 840, h: 0 })).toEqual({ dx: 0, dy: 0 });
    const low = { w: 840, h: 51 };
    expect(innerPoint({ x: 420, y: 25 }, low)).toBe(true);
    expect(edgePan({ x: 420, y: 25 }, { x: 420, y: 25 }, true, low)).toEqual({ dx: 0, dy: 0 });
    expect(edgePan({ x: 420, y: 51 }, { x: 420, y: 25 }, true, low).dy).toBeCloseTo(-18, 6);
    const narrow = { w: 30, h: 217 };
    expect(edgePan({ x: 20, y: 100 }, { x: 15, y: 100 }, true, narrow).dx).toBeCloseTo(-7.3333, 3); // 右の縁が近い：右の先を見せる
    expect(edgePan({ x: 10, y: 100 }, { x: 15, y: 100 }, true, narrow).dx).toBeCloseTo(7.3333, 3); // 左の縁が近い
    expect(edgePan({ x: 15, y: 100 }, { x: 15, y: 100 }, true, narrow)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('edgeFrameMove（速さはこま数でなく時刻で）', () => {
  const step = { dx: -10, dy: 14 };
  it('前のこまからの時間に比べて伸び縮み（16.7ms で 1 こまぶん）。50ms より長く空いても 50ms ぶんまで', () => {
    expect(edgeFrameMove(step, 16.7)).toEqual({ x: -10, y: 14 });
    expect(edgeFrameMove(step, 8.35)).toEqual({ x: -5, y: 7 }); // 120Hz
    expect(edgeFrameMove(step, 33.4)).toEqual({ x: -20, y: 28 }); // こまが一つ落ちた
    expect(edgeFrameMove(step, 1000)).toEqual({ x: -30, y: 42 }); // 50ms ぶん（×2.99）
  });
  it('動く向きでは最低 1px（こまの多い画面で止まらない）。時間が進んでいない・量が 0 なら 0', () => {
    expect(edgeFrameMove({ dx: 2, dy: 0 }, 4.17)).toEqual({ x: 1, y: 0 }); // 240Hz の 2px は 0.5 → 1
    expect(edgeFrameMove(step, 0)).toEqual({ x: 0, y: 0 });
    expect(edgeFrameMove(step, -5)).toEqual({ x: 0, y: 0 });
    expect(edgeFrameMove(step, Number.NaN)).toEqual({ x: 0, y: 0 });
    expect(edgeFrameMove({ dx: 0, dy: 0 }, 16.7)).toEqual({ x: 0, y: 0 });
  });
});

describe('edgePanStep（1 こまで動かすか、止めるか）', () => {
  const one = (x: number, y: number) => new Map([['a', { x, y }]]);
  const at = (p: { x: number; y: number }, view: BoardView, starts: Map<string, { x: number; y: number }>) => ({ starts, start: p, view0: view });
  it('動かす量が 0（帯の外）なら止める', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    expect(edgePanStep(v, { x: 0, y: 0 }, at({ x: 420, y: 108 }, v, one(0, 0)), { x: 420, y: 108 })).toBeNull();
  });
  it('見ている位置が範囲（±20,000）の端で動けなければ止める。角で片方だけ端なら、もう片方は動く', () => {
    const lim = BOARD_LIMITS.viewCoord;
    const edge = { x: -lim, y: 0, zoom: 1 };
    expect(edgePanStep(edge, { x: -18, y: 0 }, at({ x: 830, y: 100 }, edge, one(0, 0)), { x: 830, y: 100 })).toBeNull();
    const corner = { x: -lim, y: -100, zoom: 1 };
    expect(edgePanStep(corner, { x: -18, y: -14 }, at({ x: 830, y: 210 }, corner, one(0, 0)), { x: 830, y: 210 })).toEqual({ x: -lim, y: -114, zoom: 1 });
  });
  it('つまんだ全部の外枠がカードの範囲（±10,000）を超える向きは動かさない：9,990 のカードは右へは 0、左へは動く（倍率 0.25 でも同じ）', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const p = { x: 830, y: 100 };
    expect(edgePanStep(v, { x: -18, y: 0 }, at(p, v, one(9990, 0)), p)).toBeNull(); // 右の先を見せる：カードは 10,008 になる
    expect(edgePanStep(v, { x: 18, y: 0 }, at(p, v, one(9990, 0)), p)).toEqual({ x: 18, y: 0, zoom: 1 }); // 左：9,972
    const far = { x: 0, y: 0, zoom: 0.25 };
    expect(edgePanStep(far, { x: -18, y: 0 }, at(p, far, one(9990, 0)), p)).toBeNull(); // 1 こまで 72 進むので超える
    expect(edgePanStep(v, { x: 0, y: 14 }, at(p, v, one(0, -9995)), p)).toBeNull(); // 上の先を見せる：−10,009 になる
    const group = new Map([['a', { x: -9995, y: 0 }], ['b', { x: 5000, y: 0 }]]);
    expect(edgePanStep(v, { x: 18, y: 0 }, at(p, v, group), p)).toBeNull(); // まとまりの左の端が超える
    expect(edgePanStep(v, { x: -18, y: 0 }, at(p, v, group), p)).toEqual({ x: -18, y: 0, zoom: 1 });
  });
});

describe('dragBoardDelta・groupDragBy（見ている位置が動いても、カードが指から離れない）', () => {
  it('見ている位置が動かなければ、画面の差を倍率で割った量（今の groupDragPositions と同じ位置）', () => {
    const starts = new Map([['a', { x: 10, y: 20 }], ['b', { x: 300, y: -40 }]]);
    for (const zoom of [1, 2, 0.5]) {
      const v: BoardView = { x: 7, y: 9, zoom };
      const start = { x: 100, y: 50 };
      const delta = { dx: 30, dy: -10 };
      const d = dragBoardDelta(start, v, { x: start.x + delta.dx, y: start.y + delta.dy }, v);
      expect(d.x).toBeCloseTo(delta.dx / zoom, 10);
      expect(d.y).toBeCloseTo(delta.dy / zoom, 10);
      expect(groupDragBy(starts, d)).toEqual(groupDragPositions(starts, delta, v));
    }
  });
  it('指が止まったまま見ている位置が動くと、その分だけカードがボードの上を進む', () => {
    const p = { x: 100, y: 50 };
    expect(dragBoardDelta(p, { x: 0, y: 0, zoom: 1 }, p, { x: -30, y: 12, zoom: 1 })).toEqual({ x: 30, y: -12 });
    expect(dragBoardDelta(p, { x: 0, y: 0, zoom: 2 }, p, { x: -40, y: 0, zoom: 2 })).toEqual({ x: 20, y: 0 });
  });
  it('手で数えた値：view0 (−50,−250,1.5)・押した点 (260,230) から、view (−110,−250,1.5)・指 (270,230) で d ≈ (46.67, 0)', () => {
    const d = dragBoardDelta({ x: 260, y: 230 }, { x: -50, y: -250, zoom: 1.5 }, { x: 270, y: 230 }, { x: -110, y: -250, zoom: 1.5 });
    expect(d.x).toBeCloseTo(46.6667, 3);
    expect(d.y).toBeCloseTo(0, 10);
  });
  it('カードと指の間は、押した時のまま（丸めの半目盛り × 倍率まで）', () => {
    const card = { x: 200, y: 300 };
    const view0: BoardView = { x: -50, y: -250, zoom: 1.5 };
    const start = { x: 260, y: 230 };
    const offset0 = { x: start.x - boardToScreen(view0, card.x, card.y).x, y: start.y - boardToScreen(view0, card.x, card.y).y };
    expect(offset0).toEqual({ x: 10, y: 30 });
    for (const [view, p] of [
      [{ x: -110, y: -250, zoom: 1.5 }, { x: 270, y: 230 }],
      [{ x: -50, y: -320, zoom: 1.5 }, { x: 260, y: 205 }],
      [{ x: -400, y: -600, zoom: 1.5 }, { x: 830, y: 210 }],
    ] as [BoardView, { x: number; y: number }][]) {
      const moved = groupDragBy(new Map([['a', card]]), dragBoardDelta(start, view0, p, view)).get('a')!;
      const s = boardToScreen(view, moved.x, moved.y);
      expect(Math.abs(p.x - s.x - offset0.x)).toBeLessThanOrEqual(view.zoom / 2 + 1e-9);
      expect(Math.abs(p.y - s.y - offset0.y)).toBeLessThanOrEqual(view.zoom / 2 + 1e-9);
    }
  });
});

describe('dragCancelPlan・viewToShowMoved（取り消したとき・戻すとき）', () => {
  const starts = new Map([['a', { x: 10, y: 20 }]]);
  const view0: BoardView = { x: 5, y: -6, zoom: 0.85 };
  it('取り消し：動かして端で見ている位置も動いていたら、カードは押した時の位置、見ている位置は押した時の位置（保存はしない）', () => {
    const plan = dragCancelPlan({ moved: true, panned: true, starts, view0 });
    expect(plan.positions).toBe(starts);
    expect(plan.view).toEqual(view0);
    expect(plan.view).not.toBe(view0);
  });
  it('取り消し：見ている位置が動いていなければ、見ている位置には触らない。動かしていなければ何も戻さない', () => {
    expect(dragCancelPlan({ moved: true, panned: false, starts, view0 })).toEqual({ positions: starts, view: null });
    expect(dragCancelPlan({ moved: false, panned: false, starts, view0 })).toEqual({ positions: null, view: null });
  });
  it('戻す・やり直すで動いたカードがどれも読めなければ、1 枚目が読める所へ。どれか読めれば動かさない', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    expect(viewToShowMoved(v, [{ x: 2000, y: 50 }, { x: 2210, y: 50 }], vp)).toEqual({ x: -1352, y: 0, zoom: 1 });
    expect(viewToShowMoved(v, [{ x: 2000, y: 50 }, { x: 100, y: 50 }], vp)).toBeNull();
    expect(viewToShowMoved(v, [], vp)).toBeNull();
  });
});

// ---------- 配線（字面。行を丸写しせず、欄ごとに見る） ----------

const tab = readFile(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const select = readFile(new URL('../src/memo-card-board-select.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slice = (text: string, from: string, to: string) => {
  const a = text.indexOf(from);
  if (a < 0) throw new Error(`見つかりません：${from}`);
  const b = text.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`見つかりません：${to}`);
  return text.slice(a, b);
};
const body = (from: string, to: string) => slice(tab, from, to);
const count = (s: string) => tab.split(s).length - 1;
const members = [...tab.matchAll(/^ {2}(?:(?:private|readonly|get|async|static) )*(\w+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
const memberAt = (at: number) => {
  let name = '';
  for (const m of members) {
    if (m.at > at) break;
    name = m.name;
  }
  return name;
};
const sitesOf = (re: RegExp) => [...tab.matchAll(re)].map((m) => memberAt(m.index ?? 0));

describe('つまむのを終える道と、rAF を止める所', () => {
  it('rAF を止めるのは endDrag だけ（つまむのを終える＝this.drag を空にするのも endDrag だけ）。止めてから空にする', () => {
    expect(count('cancelAnimationFrame(')).toBe(1);
    expect(count('this.drag = null')).toBe(1);
    expect(body('private endDrag() {', 'private dropDrag(')).toMatch(/window\.cancelAnimationFrame\(this\.edgeRaf\);\s*this\.edgeRaf = 0;\s*const d = this\.drag;\s*this\.drag = null;/);
  });
  it('端で動かす rAF は armEdgePan と edgePanFrame だけで頼み、edgeRaf を書くのは armEdgePan・edgePanFrame・endDrag だけ。armEdgePan を呼ぶのは moveDrag だけ', () => {
    const raf = sitesOf(/requestAnimationFrame\(\((\w*)\) => this\.edgePanFrame\(\1\)\)/g);
    expect(raf.length).toBe(3);
    expect(new Set(raf)).toEqual(new Set(['armEdgePan', 'edgePanFrame']));
    expect(new Set(sitesOf(/this\.edgeRaf =/g))).toEqual(new Set(['armEdgePan', 'edgePanFrame', 'endDrag']));
    expect(sitesOf(/this\.armEdgePan\(/g)).toEqual(['moveDrag']);
  });
  it('離す・取り消す・動かせないの道は、どれも endDrag を通る。取り消しの入り口（Esc・pointercancel・lostpointercapture・blur・隠す・メモを替える・置き場の替え）は cancelDrag', () => {
    expect(body('private dropDrag(', '// やめる（Esc・pointercancel')).toMatch(/this\.endDrag\(\);/);
    expect(body('cancelDrag(): boolean {', '// after（B3-3b）')).toMatch(/this\.endDrag\(\);/);
    expect(body('private moveDrag(', 'private dragPoint(')).toMatch(/if \(blocked\) \{[\s\S]*?this\.endDrag\(\);\s*return;/);
    expect(tab).toMatch(/addEventListener\('pointercancel',\s*\(e\) => \{[\s\S]*?this\.drag && e\.pointerId === this\.drag\.pointerId\) this\.cancelDrag\(\);/);
    expect(tab).toMatch(/addEventListener\('lostpointercapture',\s*\(e\) => \{\s*if \(this\.drag && e\.pointerId === this\.drag\.pointerId\) this\.cancelDrag\(\);/);
    expect(tab).toMatch(/window\.addEventListener\('blur',\s*\(\) => \{[\s\S]*?this\.cancelDrag\(\);/);
    expect(body('setHidden(hidden: boolean) {', 'private noteHiddenLast(')).toMatch(/this\.cancelDrag\(\);/);
    expect(body('if (changed) {', 'this.memoId = snap.memoId;')).toMatch(/this\.cancelDrag\(\);/);
    const place = body('setPlace(available: boolean, upper: boolean) {', '// ---------- 見るメモの名札と選び口');
    expect(place.search(/if \(moved\) this\.cancelDrag\(\);/)).toBeGreaterThan(-1);
    expect(place.search(/if \(moved\) this\.cancelDrag\(\);/)).toBeLessThan(place.search(/if \(moved\) this\.settleFace\(0\);/));
    const cards = readFile(new URL('../src/app/grok-cards.ts', import.meta.url), 'utf8');
    expect(cards).toMatch(/this\.board\?\.cancelDrag\(\);/);
    expect(cards).toMatch(/board\.cancelDrag\(\);/);
  });
});

describe('形に頼らない（四角にも六角にも、上にも下にも）', () => {
  it('select.ts の端の節と、tab の dragPoint〜edgePanFrame に、四角の寸法・置き場・六角の印が無い', () => {
    const part = slice(select, '// ---------- つまんだまま面の端へ', '// ---------- 表示');
    expect(part.length).toBeGreaterThan(500);
    expect(part).not.toMatch(/BOARD_CARD/);
    const wiring = body('private dragPoint(', '// 描いている位置を変える');
    expect(wiring.length).toBeGreaterThan(500);
    expect(wiring).not.toMatch(/BOARD_CARD|this\.place\b|is-hex/);
  });
});

describe('押した時・指が動くたび・1 こま', () => {
  it('押した時の見ている位置・点・中ほどにいたか・触った印と書く欄の寄せの印の控えを覚える', () => {
    const press = body('private pressCard(', 'private moveDrag(');
    expect(press).toMatch(/const start = this\.stagePoint\(e\);/);
    for (const re of [/view0:\s*\{\s*\.\.\.this\.view\s*\}/, /inner:\s*innerPoint\(start,/, /panned:\s*false/, /edgeAt:\s*null/, /touched0:\s*this\.viewTouched/, /viewMoved0:\s*this\.viewMoved/, /shift0:\s*this\.composeShift/, /untouched0:\s*this\.composeUntouched/]) expect(press, String(re)).toMatch(re);
  });
  it('指が動くたびに、面を 1 回だけ測り、中ほどの印を進め、カードを指に付けてから、端なら動かし始める', () => {
    const move = body('private moveDrag(', 'private dragPoint(');
    expect(move).toMatch(/d\.px = e\.clientX;\s*d\.py = e\.clientY;/);
    expect(move.match(/this\.dragPoint\(/g)).toHaveLength(1);
    expect(move).toMatch(/d\.inner = nextInner\(d\.inner,\s*p,/);
    expect(move.search(/this\.followPointer\(d,\s*p\);/)).toBeLessThan(move.search(/this\.armEdgePan\(d,\s*p\);/));
    expect(body('private followPointer(', 'private armEdgePan(')).toMatch(/groupDragBy\(d\.starts,\s*dragBoardDelta\(d\.start,\s*d\.view0,\s*p,\s*this\.view\)\)/);
  });
  it('1 こま：頭で edgeRaf を下ろし、面を 1 回だけ測り、時刻で量を決め、止める判断は edgePanStep。止まるときは次を頼まない', () => {
    const frame = body('private edgePanFrame(', '// 描いている位置を変える');
    expect(frame).toMatch(/^private edgePanFrame\(time: number\) \{\s*this\.edgeRaf = 0;/);
    expect(frame.match(/this\.dragPoint\(/g)).toHaveLength(1);
    expect(frame).toMatch(/const dt = d\.edgeAt === null \? EDGE_FRAME_MS : time - d\.edgeAt;/);
    expect(frame).toMatch(/edgeFrameMove\(step,\s*dt\)/);
    expect(frame).toMatch(/const next = edgePanStep\(this\.view,\s*move,\s*d,\s*p\);\s*if \(!next\) return;/);
    expect(frame).toMatch(/if \(step\.dx === 0 && step\.dy === 0\) return;/);
    const last = frame.lastIndexOf('requestAnimationFrame(');
    expect(frame.search(/if \(!next\) return;/)).toBeLessThan(last);
    expect(frame).toMatch(/d\.panned = true;\s*this\.applyView\(\);\s*this\.followPointer\(d,\s*p\);/);
    expect(frame).not.toMatch(/this\.touchView\(|zoomAt\(/);
  });
  it('1 こまの重さ：線は 1 回に 1 本ずつだけ直す。倍率の字と読み上げの名前は値が変わったときだけ書く', () => {
    const place = body('private placeCards(', 'private endDrag(');
    expect(place.match(/for \(const line of this\.lineEls\)/g)).toHaveLength(1);
    expect(place).toMatch(/if \(!moves\.has\(line\.from\) && !moves\.has\(line\.to\)\) continue;/);
    expect(place.match(/this\.pins\.place\(\);/g)).toHaveLength(1);
    expect(tab).not.toMatch(/private placeCard\(/);
    expect(body('private applyView(', 'private loadFaces(')).toMatch(/if \(percent !== this\.zoomShown\) \{[\s\S]*?this\.zoomShown = percent;[\s\S]*?this\.zoomBtn\.textContent = `\$\{percent\}%`;[\s\S]*?this\.zoomBtn\.setAttribute\('aria-label',[\s\S]*?\}/);
  });
});

describe('離したとき・取り消したとき', () => {
  it('離したとき：見ている位置も動いていれば touchView で保存し、面の外で離していれば、つまんだカードが読める所へ滑らせる（保存する）', () => {
    const drop = body('private dropDrag(', '// やめる（Esc・pointercancel');
    expect(drop.search(/this\.endDrag\(\);/)).toBeLessThan(drop.search(/if \(d\.panned\) \{/));
    expect(drop).toMatch(/if \(d\.panned\) \{\s*this\.touchView\(\);[^\n]*\n\s*const at = d\.pos\.get\(d\.ref\);\s*if \(at\) this\.slideToRead\(at\);/);
    expect(drop).toMatch(/this\.commitMove\(moves,/);
  });
  it('取り消したとき：カードを戻し、rAF を止めてから見ている位置を戻して描き直す（保存しない）。押した時の印に戻す', () => {
    const cancel = body('cancelDrag(): boolean {', '// after（B3-3b）');
    expect(cancel).toMatch(/const back = dragCancelPlan\(d\);\s*if \(back\.positions\) this\.placeCards\(back\.positions\);/);
    expect(cancel).toMatch(/this\.endDrag\(\);[\s\S]*?if \(back\.view\) \{\s*this\.view = back\.view;[^\n]*\n\s*this\.applyView\(\);/);
    expect(cancel).toMatch(/if \(d\.moved\) \{[\s\S]*?this\.viewTouched = d\.touched0;\s*this\.viewMoved = d\.viewMoved0;\s*this\.composeShift = d\.shift0;\s*this\.composeUntouched = d\.untouched0;/);
    expect(cancel).not.toMatch(/this\.touchView\(/);
  });
  it('つまんでいる間に保存の待ちが切れても、端で動いた一時の位置ではなく押した時の位置を書く', () => {
    expect(body('flushView() {', '// ---------- 保存の列')).toMatch(/const view = \{ \.\.\.this\.viewToSave\(\) \};/);
    expect(body('private viewToSave(): BoardView {', 'private closedViewport()')).toMatch(/this\.drag\?\.panned \? this\.drag\.view0 : this\.viewAfterClose\(\)/);
  });
  it('戻す・やり直すでカードを動かしたあと、どれも読めなければ 1 枚目へ滑らせる（保存する）', () => {
    expect(body("case 'move': {", "case 'add': {")).toMatch(/this\.slideTo\(viewToShowMoved\(this\.view,\s*moves,\s*this\.viewport\(\),\s*this\.readBox\)\)/);
  });
});

describe('つまんで動かしている間は、ほかの道で見ている位置を変えない', () => {
  it('滑らせる（足したあと・戻すとき）と、書く欄の寄せは、つまんで動かしている間はしない。滑らせるのは範囲選択の途中もしない（HX5）', () => {
    expect(body('private slideToRead(', 'private returnDraft(')).toMatch(/private slideTo\(next: BoardView \| null\) \{\s*if \(!next \|\| this\.drag\?\.moved \|\| this\.marquee\) return;/);
    expect(body('private slideToRead(', 'private slideTo(')).toMatch(/this\.slideTo\(viewToRead\(/);
    expect(body('private shiftForCompose() {', 'private restoreAfterCompose() {')).toMatch(/if \(this\.hidden \|\| this\.needFit \|\| this\.drag\?\.moved\) return;/);
  });
  it('カードをつまんでいる間は、ほかの指で面を動かし始めない', () => {
    expect(tab).toMatch(/if \(!wants \|\| this\.pan \|\| this\.drag\) return;/);
  });
  it('ホイール・矢印・書く欄が空の矢印・［全体］・「100%」・キーのメニューは、つまむ（範囲選択）の間は何もしない', () => {
    expect(tab).toMatch(/'wheel',\s*\(e\) => \{\s*e\.preventDefault\(\);\s*if \(this\.drag \|\| this\.marquee\) return;/);
    expect(tab).toMatch(/BOARD_ARROW_PAN\[e\.key\] && [^\n]*!this\.drag && !this\.marquee\)/);
    expect(tab).toMatch(/inText &&\s*!this\.drag &&[^\n]*\n\s*emptyComposeArrowPan\(\{/);
    expect(body('private fit() {', 'private actualSize() {')).toMatch(/^private fit\(\) \{\s*if \(this\.drag \|\| this\.marquee\) return;/);
    expect(body('private actualSize() {', 'private faceTop()')).toMatch(/this\.drag \|\| this\.marquee\) return;/);
    expect(tab).toMatch(/if \(!isKeyboardMenu\(e\)[^\n]*this\.drag \|\| this\.marquee\) return;/);
  });
  it('📌 が開いているときの Esc：つまんで動かしている間・範囲選択の間は、📌 を閉じずに取り消しへ通す', () => {
    const at = tab.indexOf('this.pins.closeNewest(this.memoId);');
    const esc = tab.slice(tab.lastIndexOf('window.addEventListener(', at), at);
    expect(esc.search(/if \(this\.dragging\) return;/)).toBeGreaterThan(-1);
    expect(esc.search(/if \(this\.dragging\) return;/)).toBeLessThan(esc.search(/e\.stopImmediatePropagation\(\);/));
    expect(body('get dragging(): boolean {', 'private pressCard(')).toMatch(/this\.drag\?\.moved === true \|\| this\.marquee !== null/);
  });
});
