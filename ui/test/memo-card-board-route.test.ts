// 六角のボードの線の迂回（memo-card-board-route.ts）：ほかのカードの字の箱を避ける。今の曲線で横切らない線・短い帯・描かない線は今のまま
//   tab の配線（build と取り消したあとの描き直しは geo.route、つまんで運ぶ間は geo.edge、時間の上限）は memo-card-board-hex-wiring.test.ts。見た目は開発画面と Windows の確かめ
import { describe, expect, it } from 'vitest';
import type { Rect } from '../src/memo-card-board';
import { HEX_GEO, SQUARE_GEO } from '../src/memo-card-board-geo';
import { HEX, HEX_CENTER, hexBandBox, hexEdgeGeometry, hexLineEnds, hexReach, hexSlot, pointInHex } from '../src/memo-card-board-hex';
import {
  curveHits,
  cutPath,
  HEX_TEXT_BOX,
  hexRoute,
  hexRouteBox,
  hexRoutedEdge,
  type HexRouteResult,
  hexSpan,
  hexTextBox,
  offsetStraight,
  offsetWhole,
  piecesD,
  polylineLength,
  ROUTE,
  ROUTE_BUDGET_MS,
  routeLabel,
  routePieces,
  routeRegion,
  roundedRoute,
  segmentEntersBox,
  shiftLeft,
  shiftStraight,
  strictlyInside,
  visibilityRoute,
} from '../src/memo-card-board-route';
import type { Pt } from '../src/memo-card-board-select';
import { curveControls, curveGeometry, edgeGeometry } from '../src/memo-card-board-view';

const centerOf = (at: Pt): Pt => ({ x: at.x + HEX_CENTER.x, y: at.y + HEX_CENTER.y });
const distOf = (p: Pt, q: Pt) => Math.hypot(q.x - p.x, q.y - p.y);
// 仮の並びの n 枚（作った順に 5 枚と 4 枚の行）
const slots = (n: number) => Array.from({ length: n }, (_, i) => hexSlot(i));
const othersOf = (at: readonly Pt[], i: number, j: number) => at.filter((_, k) => k !== i && k !== j);
// 字の箱を k だけ広げた四角
const grow = (b: Rect, k: number): Rect => ({ x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k });
// 折れ線のどの区間も、どの箱の内側にも入らない
const polylineClear = (points: readonly Pt[], boxes: readonly Rect[]) => {
  for (let s = 1; s < points.length; s += 1) for (const b of boxes) if (segmentEntersBox(points[s - 1], points[s], b)) return false;
  return true;
};
// d の形：M のあと L と「Q 制御点 終わり」が並び、L で終わる
const ROUTE_D = /^M-?[\d.]+,-?[\d.]+(?: L-?[\d.]+,-?[\d.]+| Q-?[\d.]+,-?[\d.]+ -?[\d.]+,-?[\d.]+)* L-?[\d.]+,-?[\d.]+$/;
const onRim = (c: Pt, p: Pt) => Math.abs(hexReach(p.x - c.x, p.y - c.y) - HEX.w / 2) < 1e-6; // 六角（中心 c）の縁の上
const rng = (seed0: number) => {
  let seed = seed0;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
};

// d を読んで、描く形を細かい点に分ける（直線は両端、二次ベジェは 64 区間）。名札の確かめと、d が字の箱に入らないことの確かめに使う（実装の関数は使わない）
type Seg = { p: Pt; q: Pt; curve: boolean };
function drawnSegs(d: string): Seg[] {
  const tokens = d.split(' ');
  const xy = (s: string) => {
    const [x, y] = s.replace(/^[MLQ]/, '').split(',').map(Number);
    return { x, y };
  };
  let cur = xy(tokens[0]);
  const out: Seg[] = [];
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i].startsWith('L')) {
      const q = xy(tokens[i]);
      out.push({ p: cur, q, curve: false });
      cur = q;
      continue;
    }
    const c = xy(tokens[i]);
    const e = xy(tokens[i + 1]);
    i += 1;
    let prev = cur;
    for (let k = 1; k <= 64; k += 1) {
      const t = k / 64;
      const pt = { x: (1 - t) ** 2 * cur.x + 2 * (1 - t) * t * c.x + t * t * e.x, y: (1 - t) ** 2 * cur.y + 2 * (1 - t) * t * c.y + t * t * e.y };
      out.push({ p: prev, q: pt, curve: true });
      prev = pt;
    }
    cur = e;
  }
  return out;
}
// 描く形（d）が箱に入らない：直線は線分で、二次ベジェは細かい点で見る
const drawnClear = (d: string, boxes: readonly Rect[]) =>
  drawnSegs(d).every((s) => (s.curve ? !boxes.some((b) => strictlyInside(s.q, b)) : !boxes.some((b) => segmentEntersBox(s.p, s.q, b))));
// 描く形の長さの半分の点から、その所の進む向きの左（画面で見た左）へ off ずらした点
function drawnLabel(d: string, off: number): Pt {
  const segs = drawnSegs(d).filter((s) => distOf(s.p, s.q) > 0);
  let rest = segs.reduce((sum, s) => sum + distOf(s.p, s.q), 0) / 2;
  for (const s of segs) {
    const len = distOf(s.p, s.q);
    if (rest <= len) {
      const at = { x: s.p.x + ((s.q.x - s.p.x) * rest) / len, y: s.p.y + ((s.q.y - s.p.y) * rest) / len };
      return { x: at.x + ((s.q.y - s.p.y) / len) * off, y: at.y - ((s.q.x - s.p.x) / len) * off };
    }
    rest -= len;
  }
  throw new Error('長さが無い');
}

describe('数と字の箱', () => {
  it('ROUTE の値・時間の上限', () => {
    expect(ROUTE).toEqual({ curveSteps: 24, maxBoxes: 120, maxRatio: 2.2, corner: 14, cornerSteps: 8, minLeg: 1, arrow: 9, clear: 4, side: 3, label: 8, safe: 0.5, miter: 2 });
    expect(ROUTE.side).toBeLessThan(ROUTE.clear);
    expect(ROUTE_BUDGET_MS).toBe(150);
  });
  it('字の箱は、文の帯を横に 4 ずつ広げ、上下を上と下の三角の字の行まで広げた四角（箱の左上から x−4〜154、y＋27〜150）', () => {
    expect(HEX_TEXT_BOX).toEqual({ x: -4, y: 27, w: 158, h: 123 });
    expect(hexTextBox({ x: 10, y: 20 })).toEqual({ x: 6, y: 47, w: 158, h: 123 });
    const box = hexTextBox({ x: 0, y: 0 });
    const band = hexBandBox({ x: 0, y: 0 });
    expect(box.x).toBe(band.x - 4);
    expect(box.x + box.w).toBe(band.x + band.w + 4);
    expect(box.y).toBeLessThan(band.y);
    expect(box.y + box.h).toBeGreaterThan(band.y + band.h);
    // CSS の字の置き場（grok-cards.css）：真ん中の文 x＋8〜142・y＋44〜129、日時の行 x＋34〜116・y＋30〜42、タグの行 x＋34〜116・y＋131〜143、
    //   写真だけのカードの日時の行 x＋40〜110・y＋27〜39、題・タグの行 x＋44〜106・y＋137〜149
    const rows = [{ x: 8, y: 44, w: 134, h: 85 }, { x: 34, y: 30, w: 82, h: 12 }, { x: 34, y: 131, w: 82, h: 12 }, { x: 40, y: 27, w: 70, h: 12 }, { x: 44, y: 137, w: 62, h: 12 }];
    for (const r of rows) {
      expect(r.x).toBeGreaterThanOrEqual(box.x);
      expect(r.y).toBeGreaterThanOrEqual(box.y);
      expect(r.x + r.w).toBeLessThanOrEqual(box.x + box.w);
      expect(r.y + r.h).toBeLessThanOrEqual(box.y + box.h);
    }
  });
  it('道を探すときに避ける四角は、字の箱を上下左右に ROUTE.clear（4）広げた所（x−8〜158、y＋23〜154）', () => {
    expect(hexRouteBox({ x: 10, y: 20 })).toEqual({ x: 2, y: 43, w: 166, h: 131 });
    expect(hexRouteBox({ x: 0, y: 0 })).toEqual(grow(hexTextBox({ x: 0, y: 0 }), ROUTE.clear));
  });
});

describe('線分と箱', () => {
  const b: Rect = { x: 0, y: 0, w: 100, h: 50 };
  it('内側を通れば当たる。縁ちょうどを沿う・角に触れる・外は当たらない', () => {
    expect(segmentEntersBox({ x: -10, y: 25 }, { x: 110, y: 25 }, b)).toBe(true);
    expect(segmentEntersBox({ x: 10, y: 10 }, { x: 20, y: 20 }, b)).toBe(true); // 丸ごと内側
    expect(segmentEntersBox({ x: 0, y: 0 }, { x: 100, y: 50 }, b)).toBe(true); // 角から角へ対角線
    expect(segmentEntersBox({ x: -10, y: 0 }, { x: 110, y: 0 }, b)).toBe(false); // 上の縁を沿う
    expect(segmentEntersBox({ x: 100, y: -10 }, { x: 100, y: 60 }, b)).toBe(false); // 右の縁を沿う
    expect(segmentEntersBox({ x: -10, y: 10 }, { x: 10, y: -10 }, b)).toBe(false); // 角に触れるだけ
    expect(segmentEntersBox({ x: -50, y: -50 }, { x: 0, y: 0 }, b)).toBe(false); // 角で止まる
    expect(segmentEntersBox({ x: -10, y: -10 }, { x: 200, y: -1 }, b)).toBe(false);
  });
  it('点が内側か（縁の上は内側に数えない）', () => {
    expect(strictlyInside({ x: 50, y: 25 }, b)).toBe(true);
    expect(strictlyInside({ x: 0, y: 25 }, b)).toBe(false);
    expect(strictlyInside({ x: 100, y: 50 }, b)).toBe(false);
  });
});

describe('今の曲線を調べる', () => {
  it('制御点は curveGeometry の d と同じ（0.1 に丸めた値）', () => {
    for (const [p, q] of [[{ x: 150, y: 86.6 }, { x: 166, y: 86.6 }], [{ x: 0, y: 0 }, { x: 400, y: 130 }], [{ x: 10, y: 300 }, { x: -200, y: -40 }]]) {
      const { c1, c2 } = curveControls(p, q);
      const r = (v: number) => Math.round(v * 10) / 10;
      expect(curveGeometry(p, q).d).toBe(`M${r(p.x)},${r(p.y)} C${r(c1.x)},${r(c1.y)} ${r(c2.x)},${r(c2.y)} ${r(q.x)},${r(q.y)}`);
    }
  });
  it('横に 2 つ隣（0→2）の曲線は、あいだのカード 1 の字の箱に入る。箱が無い・遠いときは入らない', () => {
    const ends = hexLineEnds(hexSlot(0), hexSlot(2));
    expect(ends).not.toBeNull();
    expect(curveHits(ends!.p, ends!.q, [hexTextBox(hexSlot(1))])).toBe(true);
    expect(curveHits(ends!.p, ends!.q, [])).toBe(false);
    expect(curveHits(ends!.p, ends!.q, [hexTextBox({ x: 166, y: 600 })])).toBe(false);
  });
  it('分けた点と点のあいだだけを横切る細い箱でも、入ると見る（点のあいだも線分で見る）', () => {
    const p = { x: 0, y: 0 };
    const q = { x: 240, y: 0 };
    const { c1, c2 } = curveControls(p, q);
    const at = (t: number) => {
      const s = 1 - t;
      return { x: s ** 3 * p.x + 3 * s * s * t * c1.x + 3 * s * t * t * c2.x + t ** 3 * q.x, y: s ** 3 * p.y + 3 * s * s * t * c1.y + 3 * s * t * t * c2.y + t ** 3 * q.y };
    };
    const a = at(11 / ROUTE.curveSteps);
    const b = at(12 / ROUTE.curveSteps);
    const thin: Rect = { x: (a.x + b.x) / 2 - 0.1, y: -200, w: 0.2, h: 400 };
    for (let i = 0; i <= ROUTE.curveSteps; i += 1) expect(strictlyInside(at(i / ROUTE.curveSteps), thin)).toBe(false);
    expect(curveHits(p, q, [thin])).toBe(true);
  });
});

describe('今のままの線（見た目を変えない）', () => {
  it('ほかのカードが無い・道から遠いときは、今の hexEdgeGeometry と同じ答え', () => {
    const far = [{ x: 3000, y: 3000 }, { x: -2000, y: 500 }];
    for (const b of [{ x: 166, y: 0 }, { x: 83, y: 144 }, { x: 400, y: 300 }, { x: -500, y: -200 }, { x: 0, y: 600 }, { x: 163, y: 0 }]) {
      for (const others of [[], far]) {
        const r = hexRoute({ x: 0, y: 0 }, b, others);
        expect(r.kind, `${b.x},${b.y}`).toBe('curve');
        expect(r.geometry).toEqual(hexEdgeGeometry({ x: 0, y: 0 }, b));
        expect(hexRoutedEdge({ x: 0, y: 0 }, b, others)).toEqual(hexEdgeGeometry({ x: 0, y: 0 }, b));
      }
    }
  });
  it('短い帯（縁から縁 14 未満）は、ほかのカードの字の箱があっても今の帯のまま。重なって描かない線は null のまま', () => {
    const others = [{ x: 80, y: -60 }, { x: 80, y: 60 }, { x: 160, y: 10 }];
    const band = hexEdgeGeometry({ x: 0, y: 0 }, { x: 163, y: 0 });
    expect(band?.band).toBe(10);
    expect(hexRoute({ x: 0, y: 0 }, { x: 163, y: 0 }, others)).toEqual({ kind: 'curve', geometry: band });
    expect(hexRoutedEdge({ x: 0, y: 0 }, { x: 81, y: 140 }, others)).toEqual(hexEdgeGeometry({ x: 0, y: 0 }, { x: 81, y: 140 }));
    expect(hexRoutedEdge({ x: 0, y: 0 }, { x: 100, y: 30 }, others)).toBeNull();
    expect(hexRoutedEdge({ x: 0, y: 0 }, { x: 0, y: 0 }, others)).toBeNull();
  });
  it('仮の並びの隣どうし（横・斜め）は、今の曲線のまま', () => {
    const at = slots(14);
    for (const [i, j] of [[0, 1], [1, 0], [0, 5], [5, 0], [1, 5], [5, 10], [6, 11]]) {
      const r = hexRoute(at[i], at[j], othersOf(at, i, j));
      expect(r.kind, `${i}→${j}`).toBe('curve');
      expect(r.geometry).toEqual(hexEdgeGeometry(at[i], at[j]));
    }
  });
});

// 迂回した 1 本の確かめ：道が避ける四角に入らない・楕円の中・2.2 倍以下、切った折れ線は道の一部で両端が縁の上、ずらした描く折れ線と d が字の箱に入らない、
//   名札は描く形の長さの半分の点から左へ 8、hexRoutedEdge と同じ答え
function checkRouted(r: Extract<HexRouteResult, { kind: 'routed' }>, a: Pt, b: Pt, others: readonly Pt[], tag: string) {
  const ca = centerOf(a);
  const cb = centerOf(b);
  const texts = others.map(hexTextBox);
  const d0 = distOf(ca, cb);
  expect(r.path[0], tag).toEqual(ca);
  expect(r.path[r.path.length - 1], tag).toEqual(cb);
  expect(polylineClear(r.path, others.map(hexRouteBox)), tag).toBe(true); // 道は、字の箱を 4 広げた四角に入らない
  expect(polylineLength(r.path), tag).toBeLessThanOrEqual(ROUTE.maxRatio * d0 + 1e-6);
  for (const p of r.path) expect(distOf(p, ca) + distOf(p, cb), tag).toBeLessThanOrEqual(ROUTE.maxRatio * d0 + 1e-6); // 道は楕円の中
  // 切った折れ線：両端は縁の上、曲がる点は道の点で、両端の六角の外
  expect(onRim(ca, r.raw[0]), tag).toBe(true);
  expect(onRim(cb, r.raw[r.raw.length - 1]), tag).toBe(true);
  for (const p of r.raw.slice(1, -1)) {
    expect(r.path.some((q) => q.x === p.x && q.y === p.y), tag).toBe(true);
    expect(pointInHex(a, p) || pointInHex(b, p), tag).toBe(false);
  }
  // 描く折れ線：両端は縁の上。ずらし方（shift）ごとの決まり
  const n = r.points.length;
  expect(n, tag).toBe(r.raw.length);
  expect(onRim(ca, r.points[0]), tag).toBe(true);
  expect(onRim(cb, r.points[n - 1]), tag).toBe(true);
  expect(distOf(r.points[0], r.points[1]), tag).toBeGreaterThanOrEqual(ROUTE.minLeg);
  expect(distOf(r.points[n - 2], r.points[n - 1]), tag).toBeGreaterThanOrEqual(ROUTE.minLeg);
  const same = (p: Pt, q: Pt) => p.x === q.x && p.y === q.y;
  if (r.shift === 'straight') {
    // 直線：両端とも、元の直線から左へ side（縁の上に沿って動く）
    expect(n, tag).toBe(2);
    const u = { x: (r.raw[1].x - r.raw[0].x) / distOf(r.raw[0], r.raw[1]), y: (r.raw[1].y - r.raw[0].y) / distOf(r.raw[0], r.raw[1]) };
    for (const p of r.points) expect((p.x - r.raw[0].x) * u.y - (p.y - r.raw[0].y) * u.x, tag).toBeCloseTo(ROUTE.side, 6);
  } else if (r.shift === 'bends') {
    // 曲がる点ごと：3 ずれるか、ずらさない。ずらした点の端の区間は矢じり以上。端の隣の点をずらすと端の区間が矢じりより短くなるなら、ずらさない
    const s = shiftLeft(r.raw, ROUTE.side);
    expect(r.points.slice(1, -1).some((p, k) => !same(p, r.raw[k + 1])), tag).toBe(true);
    for (let k = 1; k < n - 1; k += 1) {
      const moved = distOf(r.raw[k], r.points[k]);
      expect(Math.abs(moved - ROUTE.side) < 1e-9 || moved === 0, tag).toBe(true);
    }
    if (distOf(r.points[0], s[1]) < ROUTE.arrow) expect(r.points[1], tag).toEqual(r.raw[1]);
    if (distOf(s[n - 2], r.points[n - 1]) < ROUTE.arrow) expect(r.points[n - 2], tag).toEqual(r.raw[n - 2]);
    if (!same(r.points[1], r.raw[1])) expect(distOf(r.points[0], r.points[1]), tag).toBeGreaterThanOrEqual(ROUTE.arrow);
    if (!same(r.points[n - 2], r.raw[n - 2])) expect(distOf(r.points[n - 2], r.points[n - 1]), tag).toBeGreaterThanOrEqual(ROUTE.arrow);
  } else if (r.shift === 'whole') {
    // 折れ線全体：曲がる点ごとにずらすと、どの点もずらせない形。曲がる点は side 以上、交わりの上限（miter）までずれる
    const s = shiftLeft(r.raw, ROUTE.side);
    expect(n, tag).toBeGreaterThan(2);
    expect(distOf(r.raw[0], s[1]) < ROUTE.arrow || distOf(s[n - 2], r.raw[n - 1]) < ROUTE.arrow || s.slice(1, -1).some((p) => pointInHex(a, p) || pointInHex(b, p)), tag).toBe(true);
    for (let k = 1; k < n - 1; k += 1) {
      expect(distOf(r.raw[k], r.points[k]), tag).toBeGreaterThanOrEqual(ROUTE.side - 1e-9);
      expect(distOf(r.raw[k], r.points[k]), tag).toBeLessThanOrEqual(ROUTE.miter * ROUTE.side + 1e-9);
    }
    expect(r.points, tag).toEqual(offsetWhole(r.raw, a, b, ca, cb, ROUTE.side, texts));
  } else {
    // ずらせなかった：元の折れ線のまま（直線はずらした線分が字の箱に入る・切れない、曲がる道は全体をずらす形も字の箱に入る・切れない）
    expect(r.points, tag).toEqual(r.raw);
    if (n === 2) expect(offsetStraight(r.raw[0], r.raw[1], ca, cb, ROUTE.side, texts), tag).toBeNull();
    else expect(offsetWhole(r.raw, a, b, ca, cb, ROUTE.side, texts), tag).toBeNull();
  }
  const margin = r.shift === 'bends' ? ROUTE.clear - ROUTE.side : r.shift === 'none' ? ROUTE.clear : ROUTE.safe; // 曲がる点ごとは 4 − 3 の余り、直線・全体は safe の余り
  expect(polylineClear(r.points, texts.map((t) => grow(t, margin - 1e-3))), tag).toBe(true);
  // d：形と、描く形（丸めた曲線も）が両端以外のカードの広げない字の箱に入らないこと
  expect(r.geometry.d, tag).toMatch(ROUTE_D);
  expect(r.geometry.band, tag).toBeUndefined();
  expect(drawnClear(r.geometry.d, texts), tag).toBe(true);
  // 矢じりの手前のまっすぐな所：描く最初と最後の L は min(9, 端の区間) 以上（d の 0.1 の丸めの分だけゆるく）
  const segs = drawnSegs(r.geometry.d);
  expect(distOf(segs[0].p, segs[0].q), tag).toBeGreaterThanOrEqual(Math.min(ROUTE.arrow, distOf(r.points[0], r.points[1])) - 0.15);
  const last = segs[segs.length - 1];
  expect(last.curve, tag).toBe(false);
  expect(distOf(last.p, last.q), tag).toBeGreaterThanOrEqual(Math.min(ROUTE.arrow, distOf(r.points[n - 2], r.points[n - 1])) - 0.15);
  // 名札：描く形の長さの半分の点から左へ 8（d の 0.1 の丸めと分け方の差の分だけゆるく）。寄せは左の法線の横の成分で
  const label = drawnLabel(r.geometry.d, ROUTE.label);
  expect(distOf(r.geometry.mid, label), tag).toBeLessThan(0.3);
  expect(r.geometry.anchor, tag).toMatch(/^(start|middle|end)$/);
  expect(hexRoutedEdge(a, b, others), tag).toEqual(r.geometry);
}

// 名札の場所（26×15 と見なす。寄せが start なら点から右へ、end なら左へ、middle なら真ん中。縦は点が真ん中）
const labelBox = (g: { mid: Pt; anchor?: string }): Rect => ({ x: g.anchor === 'start' ? g.mid.x : g.anchor === 'end' ? g.mid.x - 26 : g.mid.x - 13, y: g.mid.y - 7.5, w: 26, h: 15 });
const boxesMeet = (p: Rect, q: Rect) => p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y;

// 置き方 at の全部の組（i＜j）を両向きで調べる。数を返す。minGap：両向きとも迂回する組で、逆向きの描く折れ線（逆順）と点ごとに比べたときの、いちばん離れた所の下限
function checkPairs(at: readonly Pt[], minGap: number = 2 * ROUTE.side - 1e-6) {
  const out = { pairs: 0, curve: 0, routed: 0, straight: 0, fallback: {} as Record<string, number>, shift: {} as Record<string, number>, maxRatio: 0, both: 0, minLabelGap: Infinity, labelsMeet: 0, smallGap: 0, hits: 0, bandHits: 0, bandHitsRouted: 0 };
  for (let i = 0; i < at.length; i += 1) {
    for (let j = i + 1; j < at.length; j += 1) {
      out.pairs += 1;
      const others = othersOf(at, i, j);
      const base = hexEdgeGeometry(at[i], at[j]);
      const ends = hexLineEnds(at[i], at[j]);
      const curve = base !== null && base.band === undefined && ends !== null;
      const hit = curve && curveHits(ends.p, ends.q, others.map(hexTextBox));
      const bandHit = curve && curveHits(ends.p, ends.q, others.map(hexBandBox)); // 下調べの数え方（文の帯だけ）
      if (hit) out.hits += 1;
      if (bandHit) out.bandHits += 1;
      const r = hexRoute(at[i], at[j], others);
      const tag = `${i}→${j}`;
      if (!hit) {
        expect(r, tag).toEqual({ kind: 'curve', geometry: base });
        out.curve += 1;
        continue;
      }
      if (r.kind === 'fallback') {
        out.fallback[r.why] = (out.fallback[r.why] ?? 0) + 1;
        expect(r.geometry, tag).toEqual(base);
        continue;
      }
      expect(r.kind, tag).toBe('routed');
      if (r.kind !== 'routed') continue;
      out.routed += 1;
      if (bandHit) out.bandHitsRouted += 1;
      if (r.raw.length === 2) out.straight += 1;
      out.shift[r.shift] = (out.shift[r.shift] ?? 0) + 1;
      out.maxRatio = Math.max(out.maxRatio, polylineLength(r.path) / distOf(centerOf(at[i]), centerOf(at[j])));
      checkRouted(r, at[i], at[j], others, tag);
      const back = hexRoute(at[j], at[i], others);
      if (back.kind !== 'routed') continue;
      checkRouted(back, at[j], at[i], others, `${j}→${i}`);
      out.both += 1;
      expect(back.geometry.d, tag).not.toBe(r.geometry.d); // 行きと帰りの線は同じにならない（直線も）
      // 形で比べる：逆向きの描く折れ線を逆順にして、点ごとに比べたときのいちばん離れた所（点の数が違えば別の形）
      const rev = [...back.points].reverse();
      const shapeGap = rev.length === r.points.length ? Math.max(...rev.map((p, k) => distOf(p, r.points[k]))) : Infinity;
      expect(shapeGap, tag).toBeGreaterThanOrEqual(minGap);
      if (shapeGap < 2 * ROUTE.side - 1e-6) out.smallGap += 1;
      const gap = distOf(back.geometry.mid, r.geometry.mid);
      expect(gap, tag).toBeGreaterThanOrEqual(12); // 名札は 12 以上離れる
      out.minLabelGap = Math.min(out.minLabelGap, gap);
      if (boxesMeet(labelBox(r.geometry), labelBox(back.geometry))) out.labelsMeet += 1;
    }
  }
  return out;
}

const SLOW = 30000; // 全部の試験と一緒に流すと秒の単位になる試験の上限（ms）

describe('仮の並び（hexSlot）の全部の組', () => {
  it('14 枚（91 組）：今の曲線が字の箱に入る 63 組（文の帯に入る 51 組を含む）は全部が迂回する（直線 4 組。戻す組は 0。長さは中心どうしの 1.2 倍まで。両向きとも迂回する 62 組は、形が 6 以上違い、名札が 12 以上離れて重ならない）', () => {
    const s = checkPairs(slots(14));
    expect(s.pairs).toBe(91);
    expect(s.hits).toBe(63);
    expect(s.bandHits).toBe(51);
    expect(s.bandHitsRouted).toBe(51);
    expect(s.routed).toBe(63);
    expect(s.straight).toBe(4);
    expect(s.shift).toEqual({ bends: 59, straight: 4 });
    expect(s.fallback).toEqual({});
    expect(s.maxRatio).toBeLessThan(1.2);
    expect(s.both).toBe(62);
    expect(s.labelsMeet).toBe(0);
  }, SLOW);
  it('35 枚（595 組）：入る 511 組（文の帯に入る 470 組を含む）は全部が迂回する（直線 23 組。戻す組は 0。長さは 1.35 倍まで。両向きとも迂回する 508 組は、形が 6 以上違い、名札が重ならない）', () => {
    const s = checkPairs(slots(35));
    expect(s.pairs).toBe(595);
    expect(s.hits).toBe(511);
    expect(s.bandHits).toBe(470);
    expect(s.bandHitsRouted).toBe(470);
    expect(s.routed).toBe(511);
    expect(s.straight).toBe(23);
    expect(s.shift).toEqual({ bends: 488, straight: 23 });
    expect(s.fallback).toEqual({});
    expect(s.maxRatio).toBeLessThan(1.35);
    expect(s.both).toBe(508);
    expect(s.labelsMeet).toBe(0);
  }, SLOW);
  it('重さ：35 枚の全部の組を両向き（1190 本）で計算して 15 秒の内（2026-11-08 の手元の計測で 0.3 秒ほど。片向き 595 組は 0.15 秒ほど）', () => {
    const at = slots(35);
    const t0 = performance.now();
    for (let i = 0; i < 35; i += 1) for (let j = 0; j < 35; j += 1) if (i !== j) hexRoutedEdge(at[i], at[j], othersOf(at, i, j));
    expect(performance.now() - t0).toBeLessThan(15000);
  }, SLOW);
});

describe('決まった種のでたらめな置き方（全部の組を両向きで）', () => {
  it('ずらした並び（仮の並び 20 枚を ±20 ずらす。種 101）：190 組のうち迂回 144（直線 1。折れ線全体をずらす 3）・今の曲線のまま 43・戻す 3（長すぎる 1・端 2）。両向きとも迂回する 142 組は、形が 6 以上違い、名札が重ならない', () => {
    const r = rng(101);
    const at = slots(20).map((p) => ({ x: p.x + Math.round((r() - 0.5) * 40), y: p.y + Math.round((r() - 0.5) * 40) }));
    const s = checkPairs(at);
    expect([s.pairs, s.routed, s.straight, s.curve]).toEqual([190, 144, 1, 43]);
    expect(s.shift).toEqual({ bends: 140, whole: 3, straight: 1 });
    expect(s.fallback).toEqual({ tooLong: 1, ends: 2 });
    expect([s.both, s.smallGap, s.labelsMeet]).toEqual([142, 0, 0]);
  }, SLOW);
  it('ずらした並び（35 枚を ±20 ずらす。種 222）：両向きとも迂回する 476 組に同じ形は無い（3 組は片方しかずらせず、違いが 3）。名札が重なる組は 2', () => {
    const r = rng(222);
    const at = slots(35).map((p) => ({ x: p.x + Math.round((r() - 0.5) * 40), y: p.y + Math.round((r() - 0.5) * 40) }));
    const s = checkPairs(at, ROUTE.side - 1e-6);
    expect([s.pairs, s.routed, s.straight, s.curve]).toEqual([595, 479, 8, 86]);
    expect(s.shift).toEqual({ bends: 466, straight: 8, whole: 4, none: 1 });
    expect(s.fallback).toEqual({ ends: 16, tooLong: 12, noPath: 2 });
    expect([s.both, s.smallGap, s.labelsMeet]).toEqual([476, 3, 2]);
  }, SLOW);
  it('密集（15 枚を 700×500 にばらまく。重なりあり）：105 組のうち迂回 4・今の曲線のまま 30・道が無い 71', () => {
    const r = rng(202);
    const at = Array.from({ length: 15 }, () => ({ x: Math.round(r() * 700), y: Math.round(r() * 500) }));
    const s = checkPairs(at);
    expect([s.pairs, s.routed, s.curve]).toEqual([105, 4, 30]);
    expect(s.fallback).toEqual({ noPath: 71 });
  });
  it('斜め（12 枚を右下へ並べて ±30 ずらす）：66 組のうち迂回 55・今の曲線のまま 11', () => {
    const r = rng(303);
    const at = Array.from({ length: 12 }, (_, i) => ({ x: i * 120 + Math.round((r() - 0.5) * 60), y: i * 90 + Math.round((r() - 0.5) * 60) }));
    const s = checkPairs(at);
    expect([s.pairs, s.routed, s.curve]).toEqual([66, 55, 11]);
    expect(s.fallback).toEqual({});
    expect(s.labelsMeet).toBe(0);
  }, SLOW);
});

describe('具体の組（14 枚の仮の並び）', () => {
  const at = slots(14);
  const routed = (i: number, j: number) => {
    const r = hexRoute(at[i], at[j], othersOf(at, i, j));
    expect(r.kind, `${i}→${j}`).toBe('routed');
    if (r.kind !== 'routed') throw new Error('routed でない');
    return r;
  };
  it('0→2：今の曲線は 1 の字の箱に入る。迂回の道は 1 の字の箱を 4 広げた四角の上の縁（y 23）の角を通り、描く線は進む向き（右）の左＝上へ 3 ずれる', () => {
    const ends = hexLineEnds(at[0], at[2])!;
    expect(curveHits(ends.p, ends.q, [hexTextBox(at[1])])).toBe(true);
    const r = routed(0, 2);
    expect(r.path).toEqual([centerOf(at[0]), { x: 158, y: 23 }, { x: 324, y: 23 }, centerOf(at[2])]);
    expect(r.geometry.d).toBe('M139.5,37.2 L148.2,28.7 Q157,20.2 169.3,20.2 L312.7,20.2 Q325,20.2 333.8,28.7 L342.5,37.2');
    expect(r.geometry.mid).toEqual({ x: 241, y: 12.2 }); // 線（y 20.2）から上へ 8
    expect(r.geometry.anchor).toBe('middle'); // 横の区間：名札は真ん中寄せ
    expect(r.shift).toBe('bends');
    expect(hexTextBox(at[1]).y - r.points[1].y).toBeGreaterThan(ROUTE.clear + ROUTE.side - 1); // 字の箱の上の縁（27）から 6 より離れる
  });
  it('2→0（逆向き）：道は同じ道を逆にたどるが、描く線は下へずれ、名札も下へ。丸めた曲線が 1 の字の箱に入らないよう、角の丸めは小さい', () => {
    const r = routed(2, 0);
    const go = routed(0, 2);
    expect(r.path).toEqual([...go.path].reverse());
    expect(r.raw).toEqual([...go.raw].reverse());
    expect(r.geometry.d).toBe('M342.5,37.2 L327.9,28.7 Q323,25.8 317.4,25.8 L164.6,25.8 Q159,25.8 154.1,28.7 L139.5,37.2');
    expect(r.geometry.mid).toEqual({ x: 241, y: 33.8 });
    expect(r.geometry.anchor).toBe('middle');
    const back = [...r.points].reverse();
    for (const k of [1, 2]) expect(distOf(back[k], go.points[k])).toBeCloseTo(2 * ROUTE.side, 9); // 曲がる点は左右に 3 ずつ、合わせて 6 離れる
    expect(distOf(r.geometry.mid, go.geometry.mid)).toBeCloseTo(21.6, 6);
  });
  it('4→5（行の折り返し）・0→13（左上から右下の隅）：どの字の箱にも入らない', () => {
    const r45 = routed(4, 5);
    expect(drawnClear(r45.geometry.d, othersOf(at, 4, 5).map(hexTextBox))).toBe(true);
    expect(r45.path.length).toBe(4);
    const r013 = routed(0, 13);
    expect(drawnClear(r013.geometry.d, othersOf(at, 0, 13).map(hexTextBox))).toBe(true);
    expect(r013.path.length).toBe(6);
  });
  it('0→13 と 13→0：名札は縦の区間（カード 6 と 7 のあいだ）に乗る。下へ進む行きは右に start、上へ進む帰りは左に end で、字が線から離れる向きに伸びて重ならない', () => {
    const go = routed(0, 13);
    const back = routed(13, 0);
    expect(go.geometry.mid).toEqual({ x: 417.2, y: 230 });
    expect(go.geometry.anchor).toBe('start');
    expect(back.geometry.mid).toEqual({ x: 396.8, y: 231.9 });
    expect(back.geometry.anchor).toBe('end');
    expect(boxesMeet(labelBox(go.geometry), labelBox(back.geometry))).toBe(false);
  });
});

describe('今の曲線へ戻す道', () => {
  const a = { x: 0, y: 0 };
  it('重ねて囲む（a の字の箱のまわりを、重なり合う 8 枚の字の箱が囲む）：道が無い', () => {
    const ring: Pt[] = [];
    for (const dx of [-150, 0, 150]) for (const dy of [-100, 0, 100]) if (dx !== 0 || dy !== 0) ring.push({ x: dx, y: dy });
    const b = { x: 1000, y: 0 };
    expect(hexRoute(a, b, ring)).toEqual({ kind: 'fallback', geometry: hexEdgeGeometry(a, b), why: 'noPath' });
    expect(hexRoutedEdge(a, b, ring)).toEqual(hexEdgeGeometry(a, b));
  });
  it('長い壁（縦に重ねた 31 枚）：端を回る道は 2.2 倍の楕円の外なので、範囲の中に道が無い', () => {
    const wall = Array.from({ length: 31 }, (_, k) => ({ x: 250, y: (k - 15) * 100 }));
    const b = { x: 500, y: 0 };
    expect(hexRoute(a, b, wall)).toEqual({ kind: 'fallback', geometry: hexEdgeGeometry(a, b), why: 'noPath' });
  });
  it('2.2 倍の境：上の端の高さを変えた縦の壁（21 枚）。上の端 −471 は 2.1999 倍で迂回、−472 は超えて今の曲線（tooLong）', () => {
    const b = { x: 600, y: 0 };
    const wall = (top: number) => Array.from({ length: 21 }, (_, k) => ({ x: 300, y: top + k * 100 }));
    const fits = hexRoute(a, b, wall(-471));
    expect(fits.kind).toBe('routed');
    if (fits.kind === 'routed') {
      expect(polylineLength(fits.path) / distOf(centerOf(a), centerOf(b))).toBeCloseTo(2.1999, 4);
      expect(fits.path).toEqual([centerOf(a), { x: 292, y: -448 }, { x: 458, y: -448 }, centerOf(b)]);
    }
    expect(hexRoute(a, b, wall(-472))).toEqual({ kind: 'fallback', geometry: hexEdgeGeometry(a, b), why: 'tooLong' });
  });
  it('探す範囲に掛かる字の箱が 120 を超える：道を探さない（tooMany）', () => {
    const pile = Array.from({ length: ROUTE.maxBoxes + 1 }, () => ({ x: 250, y: 0 }));
    const b = { x: 500, y: 0 };
    expect(hexRoute(a, b, pile)).toEqual({ kind: 'fallback', geometry: hexEdgeGeometry(a, b), why: 'tooMany' });
    expect(hexRoute(a, b, pile.slice(1)).kind).toBe('routed'); // 120 なら探す（重ねた 120 枚の上を回る）
  });
  it('箱の数は探す範囲に掛かるものだけで数える：範囲の外に 200 枚、範囲の中に 1 枚なら迂回する', () => {
    const b = { x: 500, y: 0 };
    const region = routeRegion(centerOf(a), centerOf(b));
    const outside = Array.from({ length: 200 }, (_, k) => ({ x: 5000 + (k % 10) * 170, y: Math.floor(k / 10) * 150 }));
    for (const p of outside) expect(hexRouteBox(p).x).toBeGreaterThan(region.x + region.w);
    const r = hexRoute(a, b, [{ x: 250, y: 0 }, ...outside]);
    expect(r.kind).toBe('routed');
    expect(r.geometry).toEqual(hexRoute(a, b, [{ x: 250, y: 0 }]).geometry);
  });
  it('端の隣の曲がる点が六角 a の縁のすぐ外（0.34）：縁で切ったあとの最初の区間が 1 より短いので、今の曲線（ends）', () => {
    const ea = { x: 121, y: 12 };
    const eb = { x: 471, y: 429 };
    const others = [{ x: 322, y: 138 }, { x: 65, y: 147 }, { x: 295, y: 236 }];
    expect(hexRoute(ea, eb, others)).toEqual({ kind: 'fallback', geometry: hexEdgeGeometry(ea, eb), why: 'ends' });
    const path = visibilityRoute(centerOf(ea), centerOf(eb), others.map(hexRouteBox), { region: routeRegion(centerOf(ea), centerOf(eb)) })!;
    expect(path[1]).toEqual({ x: 223, y: 170 }); // カード (65,147) の避ける四角の右上の角
    const raw = cutPath(path, centerOf(ea), centerOf(eb))!;
    expect(distOf(raw[0], raw[1])).toBeLessThan(ROUTE.minLeg);
  });
  it('端のカードの中心が、ほかのカードの避ける四角の内側（重ねて置いた）：道が無い', () => {
    const b = { x: 500, y: 0 };
    const others = [{ x: 20, y: 10 }, { x: 250, y: 0 }];
    expect(hexRoute(a, b, others)).toEqual({ kind: 'fallback', geometry: hexEdgeGeometry(a, b), why: 'noPath' });
  });
});

describe('探す範囲（2.2 倍の楕円を囲む四角）', () => {
  it('横の組：長半径 1.1·D、短半径 √0.96·D。縦の組は縦横が入れ替わる', () => {
    const r = routeRegion({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(r.x).toBeCloseTo(-60, 9);
    expect(r.w).toBeCloseTo(220, 9);
    expect(r.y).toBeCloseTo(-Math.sqrt(0.96) * 100, 9);
    expect(r.h).toBeCloseTo(2 * Math.sqrt(0.96) * 100, 9);
    const v = routeRegion({ x: 0, y: 0 }, { x: 0, y: 100 });
    expect(v.w).toBeCloseTo(2 * Math.sqrt(0.96) * 100, 9);
    expect(v.h).toBeCloseTo(220, 9);
  });
  it('斜めの組でも、焦点までの距離の和が 2.2·D の点（楕円の上）は、どれも四角の中', () => {
    const ca = { x: 10, y: 20 };
    const cb = { x: 310, y: 420 };
    const r = routeRegion(ca, cb);
    const d0 = distOf(ca, cb);
    const major = 1.1 * d0;
    const minor = Math.sqrt(major * major - (d0 / 2) ** 2);
    const u = { x: (cb.x - ca.x) / d0, y: (cb.y - ca.y) / d0 };
    let touched = 0;
    for (let k = 0; k < 360; k += 1) {
      const t = (k * Math.PI) / 180;
      const p = { x: (ca.x + cb.x) / 2 + major * Math.cos(t) * u.x - minor * Math.sin(t) * u.y, y: (ca.y + cb.y) / 2 + major * Math.cos(t) * u.y + minor * Math.sin(t) * u.x };
      expect(distOf(p, ca) + distOf(p, cb)).toBeCloseTo(2.2 * d0, 6);
      expect(p.x).toBeGreaterThanOrEqual(r.x - 1e-6);
      expect(p.x).toBeLessThanOrEqual(r.x + r.w + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(r.y - 1e-6);
      expect(p.y).toBeLessThanOrEqual(r.y + r.h + 1e-6);
      if (Math.abs(p.x - r.x) < 0.5 || Math.abs(p.y - r.y) < 0.5) touched += 1;
    }
    expect(touched).toBeGreaterThan(0); // 四角は楕円にちょうど接する（広すぎない）
  });
  it('短い壁（縦に重ねた 5 枚）は上の端を回る。描く線は字の箱に入らない', () => {
    const wall = Array.from({ length: 5 }, (_, k) => ({ x: 250, y: (k - 2) * 100 }));
    const r = hexRoute({ x: 0, y: 0 }, { x: 500, y: 0 }, wall);
    expect(r.kind).toBe('routed');
    if (r.kind === 'routed') {
      expect(r.path).toEqual([centerOf({ x: 0, y: 0 }), { x: 242, y: -177 }, { x: 408, y: -177 }, centerOf({ x: 500, y: 0 })]);
      checkRouted(r, { x: 0, y: 0 }, { x: 500, y: 0 }, wall, 'wall5');
    }
  });
  it('2.2 倍に収まる回り道は、前の「両端の箱を 200 広げた四角」の外でも、探し直さずに見つかる（7 枚の壁を上から回る）', () => {
    const wall = Array.from({ length: 7 }, (_, k) => ({ x: 600, y: (k - 3) * 100 }));
    const r = hexRoute({ x: 0, y: 0 }, { x: 1200, y: 0 }, wall);
    expect(r.kind).toBe('routed');
    if (r.kind === 'routed') expect(r.path).toEqual([centerOf({ x: 0, y: 0 }), { x: 592, y: -277 }, { x: 758, y: -277 }, centerOf({ x: 1200, y: 0 })]);
  });
});

describe('端の切り方（六角 a から最後に出る点と、六角 b に最初に入る点）', () => {
  const ca = centerOf({ x: 0, y: 0 });
  const cb = centerOf({ x: 400, y: 0 });
  it('線分のうち六角の中の区間（縁を含む）', () => {
    expect(hexSpan(ca, { x: 75, y: 100 }, { x: 375, y: 100 })).toEqual([0, 0.25]);
    expect(hexSpan(ca, { x: 300, y: 0 }, { x: 400, y: 0 })).toBeNull();
  });
  it('a の中の曲がる点は捨てる。切った点は縁の上', () => {
    const raw = cutPath([ca, { x: 100, y: 100 }, { x: 300, y: 100 }, cb], ca, cb)!;
    expect(raw.length).toBe(3);
    expect(raw[0]).toEqual({ x: 150, y: 100 });
    expect(raw[1]).toEqual({ x: 300, y: 100 });
    expect(raw[2].x).toBeCloseTo(400, 9);
    expect(raw[2].y).toBeCloseTo(100 - (13.397459621556 * 100) / 175, 6);
    expect(onRim(ca, raw[0]) && onRim(cb, raw[2])).toBe(true);
  });
  it('a から最後に出るのが b に入ったあと（切れない）なら null', () => {
    expect(cutPath([ca, cb, { x: ca.x, y: ca.y + 1 }, cb], ca, cb)).toBeNull();
  });
});

describe('道を探す（見通しのグラフ）', () => {
  it('箱が無い・まっすぐ通れるときは両端だけ', () => {
    expect(visibilityRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, [])).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(visibilityRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, [{ x: 0, y: 0, w: 100, h: 50 }])).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]); // 縁を沿う
  });
  it('あいだの箱を、近い側の角で回る', () => {
    const box = { x: 40, y: -10, w: 20, h: 30 };
    expect(visibilityRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, [box])).toEqual([{ x: 0, y: 0 }, { x: 40, y: -10 }, { x: 60, y: -10 }, { x: 100, y: 0 }]);
  });
  it('端が箱の内側・囲まれていれば null', () => {
    expect(visibilityRoute({ x: 50, y: 0 }, { x: 200, y: 0 }, [{ x: 40, y: -10, w: 20, h: 30 }])).toBeNull();
    const ring = [{ x: -30, y: -30, w: 60, h: 10 }, { x: -30, y: 20, w: 60, h: 10 }, { x: -30, y: -30, w: 10, h: 60 }, { x: 20, y: -30, w: 10, h: 60 }];
    expect(visibilityRoute({ x: 0, y: 0 }, { x: 200, y: 0 }, ring)).toBeNull();
  });
  it('角の向きで辺を減らしても、全部の辺のダイクストラと同じ長さ（でたらめな箱 300 通り）', () => {
    const rnd = rng(12345);
    let found = 0;
    for (let t = 0; t < 300; t += 1) {
      const boxes: Rect[] = Array.from({ length: 2 + Math.floor(rnd() * 9) }, () => ({ x: Math.round(rnd() * 400), y: Math.round(rnd() * 300), w: 10 + Math.round(rnd() * 120), h: 10 + Math.round(rnd() * 90) }));
      const from = { x: Math.round(rnd() * 500) - 50, y: Math.round(rnd() * 400) - 50 };
      const to = { x: Math.round(rnd() * 500) - 50, y: Math.round(rnd() * 400) - 50 };
      const got = visibilityRoute(from, to, boxes);
      const want = bruteShortest(from, to, boxes);
      expect(got === null, `${t}`).toBe(want === null);
      if (got && want !== null) {
        found += 1;
        expect(polylineLength(got), `${t}`).toBeCloseTo(want, 6);
        expect(polylineClear(got, boxes), `${t}`).toBe(true);
      }
    }
    expect(found).toBeGreaterThan(200);
  });
  it('範囲を渡すと、点はその中の角だけ', () => {
    const box = { x: 40, y: -10, w: 20, h: 30 };
    expect(visibilityRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, [box], { region: { x: -10, y: -5, w: 120, h: 40 } })).toEqual([{ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 60, y: 20 }, { x: 100, y: 0 }]);
    expect(visibilityRoute({ x: 0, y: 0 }, { x: 100, y: 0 }, [box], { region: { x: -10, y: -5, w: 120, h: 10 } })).toBeNull();
  });
});

// 比べる相手：箱の角（ほかの箱の内側の角を除く）と両端の全部の組を辺の候補にした、素朴なダイクストラの最短の長さ（無ければ null）
function bruteShortest(from: Pt, to: Pt, boxes: readonly Rect[]): number | null {
  if (boxes.some((b) => strictlyInside(from, b) || strictlyInside(to, b))) return null;
  const pts: Pt[] = [from, to];
  for (const b of boxes) {
    for (const p of [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h }]) if (!boxes.some((o) => strictlyInside(p, o))) pts.push(p);
  }
  const n = pts.length;
  const g = Array<number>(n).fill(Infinity);
  const done = Array<boolean>(n).fill(false);
  g[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i += 1) if (!done[i] && g[i] < Infinity && (u < 0 || g[i] < g[u])) u = i;
    if (u < 0) return null;
    if (u === 1) return g[1];
    done[u] = true;
    for (let v = 0; v < n; v += 1) {
      if (done[v]) continue;
      if (boxes.some((b) => segmentEntersBox(pts[u], pts[v], b))) continue;
      g[v] = Math.min(g[v], g[u] + distOf(pts[u], pts[v]));
    }
  }
}

describe('左へずらす', () => {
  it('両端は動かさない。曲がる点は、前後の区間の左の法線（画面で見て左。y は下向き）を足した向きへ、長さ d だけ', () => {
    const h = 3 / Math.SQRT2;
    const out = shiftLeft([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 3); // 右へ進んで下へ曲がる：左は上と右。二等分は右上
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[2]).toEqual({ x: 10, y: 10 });
    expect(out[1].x).toBeCloseTo(10 + h, 9);
    expect(out[1].y).toBeCloseTo(-h, 9);
    const flat = shiftLeft([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 3); // まっすぐ右：左は上
    expect(flat[1].x).toBeCloseTo(10, 9);
    expect(flat[1].y).toBeCloseTo(-3, 9);
  });
  it('逆向きにたどると逆側へずれる。shiftLeft は曲がる点の無い直線を動かさない', () => {
    const pts = [{ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 90, y: 20 }, { x: 120, y: 60 }];
    const go = shiftLeft(pts, 3);
    const back = shiftLeft([...pts].reverse(), 3).reverse();
    for (const k of [1, 2]) {
      expect(distOf(go[k], pts[k])).toBeCloseTo(3, 9);
      expect((go[k].x + back[k].x) / 2).toBeCloseTo(pts[k].x, 9);
      expect((go[k].y + back[k].y) / 2).toBeCloseTo(pts[k].y, 9);
    }
    expect(shiftLeft([{ x: 0, y: 0 }, { x: 30, y: 40 }], 3)).toEqual([{ x: 0, y: 0 }, { x: 30, y: 40 }]);
  });
  it('直線の道は線分ごと左へ 3 ずらし、両端を縁の上に置き直す。ずらした線分が字の箱に入るなら、ずらさない', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 0 };
    const ca = centerOf(a);
    const cb = centerOf(b);
    const p = { x: 150, y: ca.y };
    const q = { x: 400, y: cb.y };
    const go = shiftStraight(p, q, ca, cb, 3, []);
    expect(go[0].x).toBeCloseTo(150, 9);
    expect(go[0].y).toBeCloseTo(ca.y - 3, 9); // 右へ進む：左は上
    expect(go[1].x).toBeCloseTo(400, 9);
    expect(go[1].y).toBeCloseTo(cb.y - 3, 9);
    const back = shiftStraight(q, p, cb, ca, 3, []);
    expect(back[0].y).toBeCloseTo(cb.y + 3, 9); // 左へ進む：左は下
    expect(onRim(ca, go[0]) && onRim(cb, go[1]) && onRim(cb, back[0]) && onRim(ca, back[1])).toBe(true);
    const box: Rect = { x: 200, y: ca.y - 10, w: 50, h: 9 }; // ずらした線（y＝ca.y − 3）に掛かり、元の線（y＝ca.y）には掛からない
    expect(shiftStraight(p, q, ca, cb, 3, [box])).toEqual([p, q]);
    expect(offsetStraight(p, q, ca, cb, 3, [box])).toBeNull();
  });
  it('safe の確かめ：ずらした線から 0.3 だけ離れた縁を持つ箱ではずらさない。0.7 離れていればずらす', () => {
    const ca = centerOf({ x: 0, y: 0 });
    const cb = centerOf({ x: 400, y: 0 });
    const p = { x: 150, y: ca.y };
    const q = { x: 400, y: cb.y };
    const line = ca.y - 3; // ずらした線の y
    const near: Rect = { x: 200, y: line - 20.3, w: 50, h: 20 }; // 下の縁がずらした線の 0.3 上
    const far: Rect = { x: 200, y: line - 20.7, w: 50, h: 20 }; // 下の縁がずらした線の 0.7 上
    expect(shiftStraight(p, q, ca, cb, 3, [near])).toEqual([p, q]);
    expect(shiftStraight(p, q, ca, cb, 3, [far])[0].y).toBeCloseTo(line, 9);
  });
  it('折れ線全体をずらす形：各区間を左へ 3 平行に動かし、曲がる点は隣の区間の交わり。両端は六角の縁で切り直す', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 0 };
    const raw = [{ x: 150, y: 60 }, { x: 250, y: 60 }, { x: 250, y: 110 }, { x: 400, y: 110 }]; // 右・下・右
    const near = (got: readonly Pt[], want: readonly Pt[]) => {
      expect(got.length).toBe(want.length);
      got.forEach((p, k) => {
        expect(p.x).toBeCloseTo(want[k].x, 9);
        expect(p.y).toBeCloseTo(want[k].y, 9);
      });
    };
    near(offsetWhole(raw, a, b, centerOf(a), centerOf(b), 3, [])!, [{ x: 150, y: 57 }, { x: 253, y: 57 }, { x: 253, y: 107 }, { x: 400, y: 107 }]);
    const back = offsetWhole([...raw].reverse(), b, a, centerOf(b), centerOf(a), 3, [])!.reverse(); // 逆向きは逆側へ
    near(back, [{ x: 150, y: 63 }, { x: 247, y: 63 }, { x: 247, y: 113 }, { x: 400, y: 113 }]);
    expect(offsetWhole(raw, a, b, centerOf(a), centerOf(b), 3, [{ x: 251.5, y: 70, w: 10, h: 20 }])).toBeNull(); // ずらした縦の区間（x 253）が箱に入る
  });
  it('折れ線全体をずらす形：交わりが遠い鋭い角（152°）は、二等分の向きに 3', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 200 };
    const raw = [{ x: 150, y: 80 }, { x: 400, y: 80 }, { x: 120, y: 200 + 43.30127018922193 * 0.6 }];
    const out = offsetWhole(raw, a, b, centerOf(a), centerOf(b), 3, [])!;
    expect(distOf(out[1], raw[1])).toBeCloseTo(3, 9);
    expect(onRim(centerOf(a), out[0]) && onRim(centerOf(b), out[2])).toBe(true);
  });
});

describe('角を丸めた形と名札', () => {
  it('角ごとに、前後の区間の半分と 14 の小さい方で丸める（M・L・Q・L）。名札は描く形の長さの半分の点から、その所の進む向きの左へ 8', () => {
    const g = roundedRoute([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(g).toEqual({ d: 'M0,0 L86,0 Q100,0 100,14 L100,100', mid: { x: 102.2, y: -2.2 }, anchor: 'start' }); // 半分の点は角の曲線の真ん中 (96.5, 3.5)、向きは右下。左の法線は右上
    const two = roundedRoute([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 100, y: 30 }]);
    expect(two).toEqual({ d: 'M0,0 L26,0 Q40,0 40,14 L40,16 Q40,30 54,30 L100,30', mid: { x: 48.8, y: 20.4 }, anchor: 'start' });
    for (const r of [g, two]) expect(distOf(r.mid, drawnLabel(r.d, ROUTE.label))).toBeLessThan(0.15);
  });
  it('最初と最後の角は、端の区間 − 9 までしか丸めない（矢じりの手前にまっすぐな所を 9 残す。端の区間が 9 より短ければ丸めない）', () => {
    expect(roundedRoute([{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 100 }]).d).toBe('M0,0 L9,0 Q12,0 12,3 L12,100'); // 最初の区間 12：半径 3
    expect(roundedRoute([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }])).toEqual({ d: 'M0,0 L9,0 Q10,0 10,1 L10,100', mid: { x: 18, y: 45.2 }, anchor: 'start' });
    expect(roundedRoute([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 5 }]).d).toBe('M0,0 L100,0 L100,5'); // 最後の区間 5：丸めない
    expect(roundedRoute([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 }]).d).toBe('M0,0 L86,0 Q100,0 100,14 L100,30'); // 最後の区間 30：14 のまま（16 残る）
  });
  it('角の無い道は直線（M・L）。同じ点が続けば 1 つにする', () => {
    expect(roundedRoute([{ x: 0, y: 0 }, { x: 30, y: 40 }])).toEqual({ d: 'M0,0 L30,40', mid: { x: 21.4, y: 15.2 }, anchor: 'start' }); // 半分の点 (15, 20) から左へ 8
    expect(roundedRoute([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 40 }])).toEqual({ d: 'M0,0 L30,40', mid: { x: 21.4, y: 15.2 }, anchor: 'start' });
  });
  it('名札の寄せ：左の法線の横の成分が +0.5 より大きければ start、−0.5 より小さければ end、ほかは middle（下へ進めば右に start、上へ進めば左に end、横なら上下に middle）', () => {
    expect(roundedRoute([{ x: 0, y: 0 }, { x: 0, y: 100 }])).toEqual({ d: 'M0,0 L0,100', mid: { x: 8, y: 50 }, anchor: 'start' });
    expect(roundedRoute([{ x: 0, y: 100 }, { x: 0, y: 0 }])).toEqual({ d: 'M0,100 L0,0', mid: { x: -8, y: 50 }, anchor: 'end' });
    expect(roundedRoute([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toEqual({ d: 'M0,0 L100,0', mid: { x: 50, y: -8 }, anchor: 'middle' });
    expect(roundedRoute([{ x: 100, y: 0 }, { x: 0, y: 0 }])).toEqual({ d: 'M100,0 L0,0', mid: { x: 50, y: 8 }, anchor: 'middle' });
    // 斜め：左の法線の横の成分が 0.5 ちょうど（60°）は middle、少し超えれば start
    const at60 = (deg: number) => roundedRoute([{ x: 0, y: 0 }, { x: 100 * Math.cos((deg * Math.PI) / 180), y: 100 * Math.sin((deg * Math.PI) / 180) }]).anchor;
    expect(at60(30)).toBe('middle'); // 向き (0.87, 0.5)：左の法線 (0.5, −0.87)
    expect(at60(31)).toBe('start');
  });
  it('今の曲線・短い帯・四角の線は、名札の寄せを持たない（今のまま真ん中）', () => {
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 })).not.toHaveProperty('anchor');
    expect(hexEdgeGeometry({ x: 0, y: 0 }, { x: 163, y: 0 })).not.toHaveProperty('anchor');
    expect(edgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 })).not.toHaveProperty('anchor');
    expect(SQUARE_GEO.edge({ x: 0, y: 0 }, { x: 400, y: 300 })).not.toHaveProperty('anchor');
    const ring: Pt[] = [];
    for (const dx of [-150, 0, 150]) for (const dy of [-100, 0, 100]) if (dx !== 0 || dy !== 0) ring.push({ x: dx, y: dy });
    expect(hexRoutedEdge({ x: 0, y: 0 }, { x: 1000, y: 0 }, ring)).not.toHaveProperty('anchor'); // 今の曲線に戻した線
  });
  it('丸めた曲線が字の箱（safe 0.5 を足して）に入るなら、半径を半分にしていく（14 → 7）。それでも入るなら丸めない（3.5 でも入る → 0）', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const near: Rect = { x: 50, y: 2.5, w: 47.5, h: 47.5 }; // 角の内側。14 の曲線の真ん中 (96.5, 3.5) は入る、7 の曲線は入らない
    expect(roundedRoute(pts, [near]).d).toBe('M0,0 L93,0 Q100,0 100,7 L100,100');
    const tight: Rect = { x: 50, y: 0.6, w: 49.5, h: 49.4 }; // 3.5 の曲線の真ん中 (99.1, 0.9) も入る
    expect(roundedRoute(pts, [tight]).d).toBe('M0,0 L100,0 L100,100');
    expect(routePieces(pts, [tight]).map((p) => p.kind)).toEqual(['L', 'L']);
    expect(roundedRoute(pts, [tight]).mid).toEqual({ x: 100, y: -8 }); // 半分の点は角 (100, 0)。向きは最初の区間（右）なので上へ
    expect(roundedRoute(pts, [tight]).anchor).toBe('middle');
    for (const box of [near, tight]) expect(drawnClear(roundedRoute(pts, [box]).d, [box])).toBe(true);
  });
  it('かけらと d・名札の関数（roundedRoute はこの二つ）', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const pieces = routePieces(pts);
    expect(pieces.map((p) => p.kind)).toEqual(['L', 'Q', 'L']);
    const label = routeLabel(pieces, ROUTE.label);
    expect(roundedRoute(pts)).toEqual({ d: piecesD(pieces), mid: label.mid, anchor: label.anchor });
    expect(routeLabel(pieces, 0)).toEqual({ mid: { x: 96.5, y: 3.5 }, anchor: 'start' });
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11);
  });
});

describe('形ごとの口', () => {
  it('四角の口には route が無い（四角の線は今の edge のまま）', () => {
    expect(SQUARE_GEO.route).toBeUndefined();
    expect('route' in SQUARE_GEO).toBe(false);
  });
  it('六角の口の route は hexRoutedEdge と同じ答え。edge は今の hexEdgeGeometry のまま', () => {
    const at = slots(14);
    for (const [i, j] of [[0, 2], [4, 5], [0, 13], [0, 1], [3, 7]]) {
      const others = othersOf(at, i, j);
      expect(HEX_GEO.route?.(at[i], at[j], others)).toEqual(hexRoutedEdge(at[i], at[j], others));
      expect(HEX_GEO.edge(at[i], at[j])).toEqual(hexEdgeGeometry(at[i], at[j]));
    }
  });
  it('0→2：HEX_GEO.route は hexRoute の答えの形で、今の曲線の d と違う', () => {
    const at = slots(14);
    const others = othersOf(at, 0, 2);
    const routed = HEX_GEO.route?.(at[0], at[2], others);
    expect(routed).toEqual(hexRoute(at[0], at[2], others).geometry);
    expect(routed?.d).not.toBe(hexEdgeGeometry(at[0], at[2])?.d);
  });
});
