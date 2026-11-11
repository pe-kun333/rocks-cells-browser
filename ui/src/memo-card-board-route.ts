// 六角のボードの線の迂回（ほかのカードの字を避ける。DOM も保存も使わない。ui/test/memo-card-board-route.test.ts）
//   今の曲線（hexEdgeGeometry）が、両端のほかのカードの字の箱の内側に入らなければ、今の形のまま返す（見た目を変えない）。短い帯・描かない（null）も今のまま
//   入るときは、字の箱を ROUTE.clear（4）広げた四角の角を点にした見通しのグラフで、両端の中心どうしの最短の道を探す（A*。探す範囲は 2.2 倍の楕円を囲む四角）。
//   道を、六角 a から最後に出る点と六角 b に最初に入る点で切り、曲がる点を進む向きの左へ ROUTE.side（3）ずらし（曲がる点の無い直線は線分ごと）、
//   端の隣の点をずらせず、どの曲がる点もずらせないときは折れ線全体を左へずらし（offsetWhole）、角を丸めて描く（丸めた曲線が字の箱に入るなら半径を半分に。
//   最初と最後の角は矢じりの手前にまっすぐな所を 9 残す）。名札は描く線の長さの半分の点から左へ ROUTE.label（8）、寄せ（anchor）は線から離れる向き。行きと帰りの線と名札を分ける
//   道が無い・長すぎる（中心どうしの距離の 2.2 倍を超える）・箱が多すぎる・端の形が壊れるときは、今の曲線に戻す
//   使うのは、全部の線を作り直すとき（tab の build）と、取り消し・同じ所で離したあとに動かしたカードの線を描き直すとき（geo.route）。
//   つまんで運ぶ間は今の曲線（geo.edge）。四角の線は使わない。tab は迂回の計算の時間を ROUTE_BUDGET_MS で切る
import type { Rect } from './memo-card-board';
import { HEX, HEX_CENTER, hexEdgeGeometry, hexLineEnds, pointInHex } from './memo-card-board-hex';
import type { Pt } from './memo-card-board-select';
import { curveControls, type EdgeGeometry } from './memo-card-board-view';

// 字の箱（箱の左上からの四角）：真ん中の文の帯（y＋43.3〜129.9）を横に 4 ずつ広げ、上下を上の三角・下の三角の字の行まで広げた所（x−4〜154、y＋27〜150）
//   CSS（grok-cards.css）の字の置き場：真ん中の文 x＋8〜142・y＋44〜129、日時の行 x＋34〜116・y＋30〜42、タグの行 y＋131〜143、
//   写真だけのカードの日時の行 x＋40〜110・y＋27〜39、題・タグの行 x＋44〜106・y＋137〜149
export const HEX_TEXT_BOX: Readonly<Rect> = { x: -4, y: 27, w: 158, h: 123 };

// カード（箱の左上 at）の字の箱（ボードの座標）。今の曲線が字に掛かるかを見る（curveHits）・描く線が入らないことを守る
export const hexTextBox = (at: Pt): Rect => ({ x: at.x + HEX_TEXT_BOX.x, y: at.y + HEX_TEXT_BOX.y, w: HEX_TEXT_BOX.w, h: HEX_TEXT_BOX.h });

export const ROUTE = {
  curveSteps: 24, // 今の曲線を折れ線にして調べる区間の数
  maxBoxes: 120, // 探す範囲に掛かる箱の数の上限（超えたら道を探さず、今の曲線）
  maxRatio: 2.2, // 道（中心から中心の折れ線）の長さの上限：中心どうしの距離のこの倍。探す範囲もこの楕円を囲む四角
  corner: 14, // 角を丸める大きさの上限（前後の区間の半分と、これの小さい方）
  cornerSteps: 8, // 丸めた角の曲線を折れ線にして、字の箱に入らないかを見る区間の数
  minLeg: 1, // 縁で切ったあとの最初・最後の区間が、これより短ければ形が壊れたとして今の曲線
  arrow: 9, // 矢じりの長さ：最初・最後の区間がこれより短くなるなら、端の隣の曲がる点はずらさない
  clear: 4, // 道を探すときは、字の箱をさらに上下左右にこれだけ広げた四角を避ける（線が字の箱の縁に沿わない）
  side: 3, // 曲がる点（直線の道は線分ごと）を進む向きの左へずらす長さ（clear より小さくして、ずらしても字の箱に入らない）
  label: 8, // 名札を、描く線の長さの半分の点から、その所の進む向きの左へずらす長さ（行きと帰りの名札が 16 ほど離れる）
  safe: 0.5, // 丸めた角・ずらした直線が字の箱に入らないかを見るときに足す余り（d の座標を 0.1 に丸めても入らない）
  miter: 2, // 折れ線全体をずらすとき（offsetWhole）、曲がる点を隣の区間の交わりに置く上限（side の倍）。超える鋭い角は二等分の向きに side
} as const;

// 全部の線を作り直す 1 回（tab の build・取り消したあとの描き直し）で、迂回の道の計算に使ってよい時間（ms）。超えたら残りの線は今の曲線
export const ROUTE_BUDGET_MS = 150;

// カード（箱の左上 at）の、道を探すときに避ける四角：字の箱を ROUTE.clear 広げた所（x−8〜158、y＋23〜154）
export const hexRouteBox = (at: Pt): Rect => ({ x: at.x + HEX_TEXT_BOX.x - ROUTE.clear, y: at.y + HEX_TEXT_BOX.y - ROUTE.clear, w: HEX_TEXT_BOX.w + 2 * ROUTE.clear, h: HEX_TEXT_BOX.h + 2 * ROUTE.clear });

const EPS = 1e-6; // 縁ちょうど・角に触れるのは内側に数えない幅
const TANGENT_EPS = 1e-9;
const SQRT3 = Math.sqrt(3);
// 六角の三つの平らな辺の法線（memo-card-board-hex.ts の NORMALS と同じ。頂点が上・y は下向き）
const SLABS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.5, SQRT3 / 2],
  [-0.5, SQRT3 / 2],
];

const round1 = (v: number) => Math.round(v * 10) / 10;
const dist = (p: Pt, q: Pt) => Math.hypot(q.x - p.x, q.y - p.y);
const lerp = (p: Pt, q: Pt, t: number): Pt => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
const grow = (b: Rect, k: number): Rect => ({ x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k });

// 点 p が四角 b の内側か（縁の上は内側に数えない）
export function strictlyInside(p: Pt, b: Rect): boolean {
  return p.x > b.x + EPS && p.x < b.x + b.w - EPS && p.y > b.y + EPS && p.y < b.y + b.h - EPS;
}

// 線分 pq が四角 b の内側を通るか（縁ちょうどを沿う・角に触れるだけなら通らない）。四角を EPS だけ縮めて、Liang–Barsky で切る
export function segmentEntersBox(p: Pt, q: Pt, b: Rect): boolean {
  const x0 = b.x + EPS;
  const x1 = b.x + b.w - EPS;
  const y0 = b.y + EPS;
  const y1 = b.y + b.h - EPS;
  if (!(x0 < x1 && y0 < y1)) return false;
  if (Math.max(p.x, q.x) <= x0 || Math.min(p.x, q.x) >= x1 || Math.max(p.y, q.y) <= y0 || Math.min(p.y, q.y) >= y1) return false;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const sides: readonly (readonly [number, number])[] = [
    [-dx, p.x - x0],
    [dx, x1 - p.x],
    [-dy, p.y - y0],
    [dy, y1 - p.y],
  ];
  for (const [den, num] of sides) {
    if (den === 0) {
      if (num < 0) return false;
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return t0 < t1;
}

const boxesCross = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// 今の曲線（縁の点 p から q。曲げ方は curveGeometry と同じ三次ベジェ）を curveSteps 区間の折れ線にして、どれかの箱の内側に入るか（点のあいだの区間も線分で見る）
export function curveHits(p: Pt, q: Pt, boxes: readonly Rect[]): boolean {
  if (boxes.length === 0) return false;
  const { c1, c2 } = curveControls(p, q);
  const x0 = Math.min(p.x, q.x, c1.x, c2.x);
  const y0 = Math.min(p.y, q.y, c1.y, c2.y);
  const hull: Rect = { x: x0 - 1, y: y0 - 1, w: Math.max(p.x, q.x, c1.x, c2.x) - x0 + 2, h: Math.max(p.y, q.y, c1.y, c2.y) - y0 + 2 }; // 曲線は制御点を囲む四角の中
  const near = boxes.filter((b) => boxesCross(b, hull));
  if (near.length === 0) return false;
  let prev: Pt = p;
  for (let i = 1; i <= ROUTE.curveSteps; i += 1) {
    const t = i / ROUTE.curveSteps;
    const s = 1 - t;
    const k0 = s * s * s;
    const k1 = 3 * s * s * t;
    const k2 = 3 * s * t * t;
    const k3 = t * t * t;
    const pt = { x: k0 * p.x + k1 * c1.x + k2 * c2.x + k3 * q.x, y: k0 * p.y + k1 * c1.y + k2 * c2.y + k3 * q.y };
    for (const b of near) if (segmentEntersBox(prev, pt, b)) return true;
    prev = pt;
  }
  return false;
}

export interface RouteOpts {
  region?: Rect; // 点（箱の角）をこの中だけに取る（線分もこの中に収まるので、この中に掛かる箱だけを渡せばよい）
}

// from から to への、どの箱の内側も通らない最短の折れ線（両端を含む）。無ければ null
//   点は箱の角（ほかの箱の内側にある角は使わない）。辺は、線分がどの箱の内側にも入らないときだけ（縁ちょうどを沿う・角に触れるのは可。
//   縁がちょうど接する二つの箱のあいだも通れる）。A*（直線の距離を目安に）で探し、辺は調べるときに確かめる
//   曲がる角は、その箱に沿う向き（箱が線の片側に収まる）の辺だけをたどる（最短の道が曲がるのは、箱に沿って回る角だけなので、答えは変わらない）
export function visibilityRoute(from: Pt, to: Pt, boxes: readonly Rect[], opts: RouteOpts = {}): Pt[] | null {
  if (boxes.some((b) => strictlyInside(from, b) || strictlyInside(to, b))) return null;
  const clear = (p: Pt, q: Pt) => !boxes.some((b) => segmentEntersBox(p, q, b));
  if (clear(from, to)) return [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];
  const region = opts.region;
  const pts: Pt[] = [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];
  const turn: number[] = [0, 0]; // 角が向く向きの符号の積（箱が角から広がる向き ex·ey）。両端は 0（どの向きにも出られる）
  for (const b of boxes) {
    const corners: readonly (readonly [number, number, number])[] = [
      [b.x, b.y, 1],
      [b.x + b.w, b.y, -1],
      [b.x, b.y + b.h, -1],
      [b.x + b.w, b.y + b.h, 1],
    ];
    for (const [x, y, s] of corners) {
      if (region && (x < region.x - EPS || x > region.x + region.w + EPS || y < region.y - EPS || y > region.y + region.h + EPS)) continue;
      const pt = { x, y };
      if (boxes.some((o) => strictlyInside(pt, o))) continue;
      pts.push(pt);
      turn.push(s);
    }
  }
  const n = pts.length;
  const g = new Float64Array(n).fill(Infinity);
  const h = new Float64Array(n);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) h[i] = dist(pts[i], to);
  g[0] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i += 1) {
      if (closed[i] || g[i] === Infinity) continue;
      const f = g[i] + h[i];
      if (f < best) {
        best = f;
        u = i;
      }
    }
    if (u < 0) return null;
    if (u === 1) break;
    closed[u] = 1;
    const pu = pts[u];
    for (let v = 1; v < n; v += 1) {
      if (closed[v] || v === u) continue;
      const pv = pts[v];
      const dx = pv.x - pu.x;
      const dy = pv.y - pu.y;
      const xy = dx * dy;
      if (xy * turn[u] > TANGENT_EPS || xy * turn[v] > TANGENT_EPS) continue; // 箱に沿わない向き（その角で曲がっても近道にならない）
      const ng = g[u] + Math.hypot(dx, dy);
      if (ng >= g[v]) continue;
      if (!clear(pu, pv)) continue;
      g[v] = ng;
      prev[v] = u;
    }
  }
  const out: Pt[] = [];
  for (let i = 1; i >= 0; i = prev[i]) {
    const p = pts[i];
    const last = out[out.length - 1];
    if (!last || dist(last, p) > EPS) out.push({ x: p.x, y: p.y }); // 重なった角（二つの箱の角が同じ所）は 1 つに
  }
  return out.reverse();
}

// 道を探す範囲：両端の中心を焦点とし、焦点までの距離の和が中心どうしの距離 D の maxRatio（2.2）倍の楕円を囲む四角
//   （長半径 1.1·D、短半径 √(1.21 − 0.25)·D を道の向きに回して囲む）。長さが 2.2 倍以内の道は、どの点も焦点までの距離の和が道の長さ以下なので、この楕円の中を通る
export function routeRegion(ca: Pt, cb: Pt): Rect {
  const d = dist(ca, cb);
  const major = (ROUTE.maxRatio / 2) * d;
  const minor = Math.sqrt(Math.max(0, major * major - (d / 2) * (d / 2)));
  const ux = d > 0 ? (cb.x - ca.x) / d : 1;
  const uy = d > 0 ? (cb.y - ca.y) / d : 0;
  const hw = Math.sqrt(major * major * ux * ux + minor * minor * uy * uy);
  const hh = Math.sqrt(major * major * uy * uy + minor * minor * ux * ux);
  return { x: (ca.x + cb.x) / 2 - hw, y: (ca.y + cb.y) / 2 - hh, w: 2 * hw, h: 2 * hh };
}

// 線分 p→q（p＋t(q−p)、0≤t≤1）のうち、六角（中心 c）の中（縁を含む）にある t の区間。無ければ null（三つの平らな辺の帯で切る）
export function hexSpan(c: Pt, p: Pt, q: Pt): [number, number] | null {
  const half = HEX.w / 2;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  for (const [nx, ny] of SLABS) {
    const s = (p.x - c.x) * nx + (p.y - c.y) * ny;
    const ds = dx * nx + dy * ny;
    if (Math.abs(ds) < 1e-12) {
      if (Math.abs(s) > half + EPS) return null;
      continue;
    }
    const a = (-half - s) / ds;
    const b = (half - s) / ds;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

// 中心から中心の折れ線 path を、六角 a（中心 ca）から最後に出る点と、六角 b（中心 cb）に最初に入る点で切り、そのあいだの点だけを残す
//   （a・b の中にある曲がる点は捨てる。残る区間はもとの道の一部）。出る点が入る点より後になる（切れない）ときは null
export function cutPath(path: readonly Pt[], ca: Pt, cb: Pt): Pt[] | null {
  let k = -1;
  let tk = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const s = hexSpan(ca, path[i], path[i + 1]);
    if (s) {
      k = i;
      tk = s[1];
    }
  }
  let m = -1;
  let tm = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const s = hexSpan(cb, path[i], path[i + 1]);
    if (s) {
      m = i;
      tm = s[0];
      break;
    }
  }
  if (k < 0 || m < 0 || k > m || (k === m && tk >= tm)) return null;
  const raw = [lerp(path[k], path[k + 1], tk), ...path.slice(k + 1, m + 1), lerp(path[m], path[m + 1], tm)];
  const out: Pt[] = [];
  for (const p of raw) if (out.length === 0 || dist(out[out.length - 1], p) > EPS) out.push({ x: p.x, y: p.y });
  return out.length >= 2 ? out : null;
}

// 折れ線の両端を除く点を、進む向きの左へ d だけずらす（両端は動かさない）。向きは、前後の区間の左の法線を足した向き（角の二等分）、ずらす長さは d。
//   左は画面で見た左（y は下向きなので、向き (dx, dy) の左の法線は (dy, −dx)）。逆向きにたどる線は逆側へずれる（a→b と b→a が重ならない）
export function shiftLeft(points: readonly Pt[], d: number): Pt[] {
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return { x: p.x, y: p.y };
    const a = points[i - 1];
    const b = points[i + 1];
    const la = dist(a, p);
    const lb = dist(p, b);
    if (la < EPS || lb < EPS) return { x: p.x, y: p.y };
    const nx = (p.y - a.y) / la + (b.y - p.y) / lb;
    const ny = -(p.x - a.x) / la - (b.x - p.x) / lb;
    const len = Math.hypot(nx, ny);
    if (len < EPS) return { x: p.x, y: p.y }; // 折り返す点（最短の道には出ない）
    return { x: p.x + (nx / len) * d, y: p.y + (ny / len) * d };
  });
}

// 直線の道（縁の点 p から q）を、線分ごと進む向きの左へ d ずらした形。ずらした線を、六角 a（中心 ca）から出る点と六角 b（中心 cb）に入る点で切る（両端は縁の上に沿って動く）。
//   ずらした線分がどれかの箱（ROUTE.safe 広げた）に入る・切れない・短すぎるときは null
export function offsetStraight(p: Pt, q: Pt, ca: Pt, cb: Pt, d: number, boxes: readonly Rect[]): Pt[] | null {
  const len = dist(p, q);
  if (len < EPS) return null;
  const ux = (q.x - p.x) / len;
  const uy = (q.y - p.y) / len;
  const ox = uy * d;
  const oy = -ux * d;
  const far = HEX.h; // 縁の点から六角の幅より遠くまで伸ばした線で切る
  const s = { x: p.x + ox - ux * far, y: p.y + oy - uy * far };
  const e = { x: q.x + ox + ux * far, y: q.y + oy + uy * far };
  const sa = hexSpan(ca, s, e);
  const sb = hexSpan(cb, s, e);
  if (!sa || !sb || sa[1] >= sb[0]) return null;
  const p2 = lerp(s, e, sa[1]);
  const q2 = lerp(s, e, sb[0]);
  if (dist(p2, q2) < ROUTE.minLeg || boxes.some((b) => segmentEntersBox(p2, q2, grow(b, ROUTE.safe)))) return null;
  return [p2, q2];
}

// 直線の道を左へ d ずらす（offsetStraight）。ずらせないときは、ずらさない（p・q のまま）
export function shiftStraight(p: Pt, q: Pt, ca: Pt, cb: Pt, d: number, boxes: readonly Rect[]): Pt[] {
  return offsetStraight(p, q, ca, cb, d, boxes) ?? [p, q];
}

// 曲がる点のある道（raw）の折れ線全体を、進む向きの左へ d ずらした形（端の隣の点をずらせず、どの曲がる点もずらさなかったとき。行きと帰りを分ける）。
//   各区間を左へ d 平行に動かし、曲がる点は隣の区間の交わり（交わりが d の ROUTE.miter 倍より遠い鋭い角は、二等分の向きに d）。
//   両端は、最初の区間を六角 a（中心 ca・箱の左上 a）から出る所、最後の区間を六角 b に入る所で切り直す（offsetStraight と同じ）。
//   どれかの箱（ROUTE.safe 広げた）に入る・切れない・曲がる点が端の六角に入る・端の区間が ROUTE.minLeg より短いときは null
export function offsetWhole(raw: readonly Pt[], a: Pt, b: Pt, ca: Pt, cb: Pt, d: number, boxes: readonly Rect[]): Pt[] | null {
  const n = raw.length;
  if (n < 3) return null;
  const dirs: Pt[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const len = dist(raw[i], raw[i + 1]);
    if (len < EPS) return null;
    dirs.push({ x: (raw[i + 1].x - raw[i].x) / len, y: (raw[i + 1].y - raw[i].y) / len });
  }
  const left = dirs.map((u) => ({ x: u.y, y: -u.x }));
  const inner: Pt[] = [];
  for (let i = 1; i < n - 1; i += 1) {
    const n1 = left[i - 1];
    const n2 = left[i];
    const sx = n1.x + n2.x;
    const sy = n1.y + n2.y;
    const sl = Math.hypot(sx, sy);
    if (sl < EPS) return null; // 折り返す点
    const denom = 1 + n1.x * n2.x + n1.y * n2.y; // 交わりまでの長さは d·√(2 ÷ denom)
    const k = Math.sqrt(2 / denom) <= ROUTE.miter ? d / denom : d / sl;
    inner.push({ x: raw[i].x + sx * k, y: raw[i].y + sy * k });
  }
  const far = HEX.h;
  const u0 = dirs[0];
  const s = { x: raw[0].x + left[0].x * d - u0.x * far, y: raw[0].y + left[0].y * d - u0.y * far };
  const sa = hexSpan(ca, s, inner[0]);
  if (!sa || sa[1] >= 1 - EPS) return null;
  const uz = dirs[n - 2];
  const e = { x: raw[n - 1].x + left[n - 2].x * d + uz.x * far, y: raw[n - 1].y + left[n - 2].y * d + uz.y * far };
  const sb = hexSpan(cb, inner[inner.length - 1], e);
  if (!sb || sb[0] <= EPS) return null;
  const pts = [lerp(s, inner[0], sa[1]), ...inner, lerp(inner[inner.length - 1], e, sb[0])];
  if (dist(pts[0], pts[1]) < ROUTE.minLeg || dist(pts[n - 2], pts[n - 1]) < ROUTE.minLeg) return null;
  if (inner.some((p) => pointInHex(a, p) || pointInHex(b, p))) return null;
  const grown = boxes.map((r) => grow(r, ROUTE.safe));
  for (let i = 1; i < n; i += 1) if (grown.some((r) => segmentEntersBox(pts[i - 1], pts[i], r))) return null;
  return pts;
}

// 折れ線の長さ
export function polylineLength(points: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += dist(points[i - 1], points[i]);
  return total;
}

// 描く形のかけら：直線（p→q）か、二次ベジェ（s→e、制御点 c）
export type RoutePiece = { kind: 'L'; p: Pt; q: Pt } | { kind: 'Q'; s: Pt; c: Pt; e: Pt };

const qAt = (s: Pt, c: Pt, e: Pt, t: number): Pt => ({
  x: (1 - t) * (1 - t) * s.x + 2 * (1 - t) * t * c.x + t * t * e.x,
  y: (1 - t) * (1 - t) * s.y + 2 * (1 - t) * t * c.y + t * t * e.y,
});
const qTangent = (s: Pt, c: Pt, e: Pt, t: number): Pt => ({ x: 2 * (1 - t) * (c.x - s.x) + 2 * t * (e.x - c.x), y: 2 * (1 - t) * (c.y - s.y) + 2 * t * (e.y - c.y) });

// 丸めた角の曲線（s→e、制御点 c）を cornerSteps 区間の折れ線にして、どれかの箱（ROUTE.safe 広げた）の内側に入るか
function cornerHits(s: Pt, c: Pt, e: Pt, boxes: readonly Rect[]): boolean {
  const x0 = Math.min(s.x, c.x, e.x) - 1;
  const y0 = Math.min(s.y, c.y, e.y) - 1;
  const hull: Rect = { x: x0, y: y0, w: Math.max(s.x, c.x, e.x) + 1 - x0, h: Math.max(s.y, c.y, e.y) + 1 - y0 };
  const near = boxes.map((b) => grow(b, ROUTE.safe)).filter((b) => boxesCross(b, hull));
  if (near.length === 0) return false;
  let prev = s;
  for (let i = 1; i <= ROUTE.cornerSteps; i += 1) {
    const pt = qAt(s, c, e, i / ROUTE.cornerSteps);
    if (near.some((b) => segmentEntersBox(prev, pt, b))) return true;
    prev = pt;
  }
  return false;
}

// 折れ線の角を丸めた形（かけらの並び）。丸める大きさは、前後の区間の半分と ROUTE.corner（14）の小さい方。
//   最初と最後の角は、さらに max(0, 端の区間 − ROUTE.arrow) まで（矢じりの手前に、まっすぐな所を 9 残す。端の区間が 9 より短ければ丸めない）。
//   丸めた曲線が boxes（両端のほかのカードの字の箱）に入るなら半分にしていき（14 → 7 → 3.5）、それでも入るなら丸めない角（直線のまま曲がる）
export function routePieces(points: readonly Pt[], boxes: readonly Rect[] = []): RoutePiece[] {
  const pts: Pt[] = [];
  for (const p of points) if (pts.length === 0 || dist(pts[pts.length - 1], p) > EPS) pts.push(p);
  const out: RoutePiece[] = [];
  let cur = pts[0];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = pts[i - 1];
    const c = pts[i];
    const b = pts[i + 1];
    const la = dist(a, c);
    const lb = dist(c, b);
    let r0 = Math.min(la / 2, lb / 2, ROUTE.corner);
    if (i === 1) r0 = Math.min(r0, Math.max(0, la - ROUTE.arrow));
    if (i === pts.length - 2) r0 = Math.min(r0, Math.max(0, lb - ROUTE.arrow));
    let done = false;
    for (const r of r0 > EPS ? [r0, r0 / 2, r0 / 4] : []) {
      const s = { x: c.x + ((a.x - c.x) / la) * r, y: c.y + ((a.y - c.y) / la) * r };
      const e = { x: c.x + ((b.x - c.x) / lb) * r, y: c.y + ((b.y - c.y) / lb) * r };
      if (cornerHits(s, c, e, boxes)) continue;
      out.push({ kind: 'L', p: cur, q: s }, { kind: 'Q', s, c, e });
      cur = e;
      done = true;
      break;
    }
    if (!done) {
      out.push({ kind: 'L', p: cur, q: c });
      cur = c;
    }
  }
  out.push({ kind: 'L', p: cur, q: pts[pts.length - 1] });
  return out;
}

// かけらの並びの path の d：「M 始まり L … Q 制御点 終わり L …」。座標は 0.1 に丸める
export function piecesD(pieces: readonly RoutePiece[]): string {
  const f = (p: Pt) => `${round1(p.x)},${round1(p.y)}`;
  const first = pieces[0];
  let d = `M${f(first.kind === 'L' ? first.p : first.s)}`;
  for (const piece of pieces) d += piece.kind === 'L' ? ` L${f(piece.q)}` : ` Q${f(piece.c)} ${f(piece.e)}`;
  return d;
}

const LABEL_Q_STEPS = 32; // 名札の所を探すとき、二次ベジェの長さを測る区間の数

export type LabelAnchor = 'start' | 'middle' | 'end';

// 名札の点：描く形（丸めた曲線も含む）の長さのちょうど半分の点から、その所の進む向きの左（画面で見た左）へ off ずらした点（0.1 に丸める）。
//   名札の寄せ（text-anchor）は、ずらす向き（左の法線）の横の成分で決める：+0.5 より大きければ start、−0.5 より小さければ end、ほかは middle（字が線から離れる向きに伸びる）
export function routeLabel(pieces: readonly RoutePiece[], off: number): { mid: Pt; anchor: LabelAnchor } {
  const lens = pieces.map((piece) => {
    if (piece.kind === 'L') return [dist(piece.p, piece.q)];
    const parts: number[] = [];
    let prev = piece.s;
    for (let j = 1; j <= LABEL_Q_STEPS; j += 1) {
      const pt = qAt(piece.s, piece.c, piece.e, j / LABEL_Q_STEPS);
      parts.push(dist(prev, pt));
      prev = pt;
    }
    return parts;
  });
  let rest = lens.flat().reduce((a, b) => a + b, 0) / 2;
  let at: Pt = { x: 0, y: 0 };
  let dir: Pt = { x: 1, y: 0 };
  search: for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i];
    for (let j = 0; j < lens[i].length; j += 1) {
      const len = lens[i][j];
      const last = i === pieces.length - 1 && j === lens[i].length - 1;
      if (rest > len && !last) {
        rest -= len;
        continue;
      }
      const f = len > 0 ? Math.min(1, rest / len) : 0;
      if (piece.kind === 'L') {
        at = lerp(piece.p, piece.q, f);
        dir = { x: piece.q.x - piece.p.x, y: piece.q.y - piece.p.y };
      } else {
        const t = (j + f) / LABEL_Q_STEPS;
        at = qAt(piece.s, piece.c, piece.e, t);
        dir = qTangent(piece.s, piece.c, piece.e, t);
      }
      break search;
    }
  }
  const dl = Math.hypot(dir.x, dir.y) || 1;
  const nx = dir.y / dl;
  const ny = -dir.x / dl;
  const anchor: LabelAnchor = nx > 0.5 ? 'start' : nx < -0.5 ? 'end' : 'middle';
  return { mid: { x: round1(at.x + nx * off), y: round1(at.y + ny * off) }, anchor };
}

// 折れ線を、角を丸めた path にする（routePieces・piecesD）。名札（mid・anchor）は描く形の長さの半分の点から左へ ROUTE.label（routeLabel）。
//   矢じり（marker-end・orient auto）は最後の区間の向き
export function roundedRoute(points: readonly Pt[], boxes: readonly Rect[] = []): EdgeGeometry {
  const pieces = routePieces(points, boxes);
  const label = routeLabel(pieces, ROUTE.label);
  return { d: piecesD(pieces), mid: label.mid, anchor: label.anchor };
}

export type HexRouteWhy = 'tooMany' | 'noPath' | 'tooLong' | 'ends';
// 描く折れ線のずらし方：straight＝直線を線分ごと、bends＝曲がる点ごと（端の隣は矢じりの守りでずらさないことがある）、whole＝折れ線全体（F1）、none＝ずらせなかった
export type HexRouteShift = 'straight' | 'bends' | 'whole' | 'none';

export type HexRouteResult =
  | { kind: 'curve'; geometry: EdgeGeometry | null } // 今の形のまま（今の曲線がどの字の箱にも入らない・短い帯・描かない）
  | { kind: 'fallback'; geometry: EdgeGeometry; why: HexRouteWhy } // 今の曲線は字の箱に入るが、道を描けない：今の曲線
  | { kind: 'routed'; geometry: EdgeGeometry; path: Pt[]; raw: Pt[]; points: Pt[]; shift: HexRouteShift }; // 迂回の道。path は中心から中心の折れ線（広げた箱の角）、raw は a から最後に出る点と b に最初に入る点で切った折れ線、points は左へずらした描く折れ線（丸める前）

const centerOf = (at: Pt): Pt => ({ x: at.x + HEX_CENTER.x, y: at.y + HEX_CENTER.y });

// 曲がる点のある道（raw）を左へずらす。端の隣の点は、最初・最後の区間が矢じり（ROUTE.arrow）より短くなる・両端の六角の中に入るなら、ずらさない。
//   ほかの点も、両端の六角の中に入るならずらさない。それでも最初・最後の区間が ROUTE.minLeg より短ければ null
function shiftBends(raw: readonly Pt[], a: Pt, b: Pt): Pt[] | null {
  const pts = shiftLeft(raw, ROUTE.side);
  const n = pts.length;
  const inEnds = (p: Pt) => pointInHex(a, p) || pointInHex(b, p);
  for (let i = 1; i < n - 1; i += 1) if (inEnds(pts[i])) pts[i] = { ...raw[i] };
  if (dist(pts[0], pts[1]) < ROUTE.arrow) pts[1] = { ...raw[1] };
  if (dist(pts[n - 2], pts[n - 1]) < ROUTE.arrow) pts[n - 2] = { ...raw[n - 2] };
  if (dist(pts[0], pts[1]) < ROUTE.minLeg || dist(pts[n - 2], pts[n - 1]) < ROUTE.minLeg) return null;
  return pts;
}

// 六角 a から b（箱の左上）への線を、others（両端のほかの、描いている六角のカードの箱の左上）の字の箱を避けて描く。答えの中身は HexRouteResult
//   今の曲線が字の箱（広げない）に入るときだけ道を探す。道を探すときに避けるのは、字の箱を ROUTE.clear 広げた四角（hexRouteBox）のうち、探す範囲（routeRegion）に掛かるもの。
//   掛かる箱が ROUTE.maxBoxes を超える・道が無い・道が 2.2 倍を超える・端で切れない・端の区間が短すぎるときは今の曲線
export function hexRoute(a: Pt, b: Pt, others: readonly Pt[]): HexRouteResult {
  const base = hexEdgeGeometry(a, b);
  const ends = base && base.band === undefined ? hexLineEnds(a, b) : null;
  if (!base || !ends) return { kind: 'curve', geometry: base };
  const texts = others.map(hexTextBox);
  if (!curveHits(ends.p, ends.q, texts)) return { kind: 'curve', geometry: base };
  const back = (why: HexRouteWhy): HexRouteResult => ({ kind: 'fallback', geometry: base, why });
  const ca = centerOf(a);
  const cb = centerOf(b);
  const region = routeRegion(ca, cb);
  const walls = others.map(hexRouteBox).filter((r) => boxesCross(r, region));
  if (walls.length > ROUTE.maxBoxes) return back('tooMany');
  const path = visibilityRoute(ca, cb, walls, { region });
  if (!path) return back('noPath');
  if (polylineLength(path) > ROUTE.maxRatio * dist(ca, cb) + EPS) return back('tooLong');
  const raw = cutPath(path, ca, cb);
  if (!raw) return back('ends');
  let points: Pt[];
  let shift: HexRouteShift;
  if (raw.length === 2) {
    const moved = offsetStraight(raw[0], raw[1], ca, cb, ROUTE.side, texts);
    points = moved ?? [{ ...raw[0] }, { ...raw[1] }];
    shift = moved ? 'straight' : 'none';
  } else {
    const bent = shiftBends(raw, a, b);
    if (!bent) return back('ends');
    const anyMoved = bent.some((p, i) => i > 0 && i < bent.length - 1 && (p.x !== raw[i].x || p.y !== raw[i].y));
    const whole = anyMoved ? null : offsetWhole(raw, a, b, ca, cb, ROUTE.side, texts); // どの曲がる点もずらせなかった：折れ線全体をずらしてみる（行きと帰りを分ける）
    points = whole ?? bent;
    shift = anyMoved ? 'bends' : whole ? 'whole' : 'none';
  }
  return { kind: 'routed', geometry: roundedRoute(points, texts), path, raw, points, shift };
}

// 六角の線の形（迂回あり）。BoardGeo の route（六角だけ）
export const hexRoutedEdge = (a: Pt, b: Pt, others: readonly Pt[]): EdgeGeometry | null => hexRoute(a, b, others).geometry;
