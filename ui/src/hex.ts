// 六角形の座標計算。「軸座標」(q, r) という2つの数でセルの位置を表す
// 参考: https://www.redblobgames.com/grids/hexagons/

export interface Hex {
  q: number;
  r: number;
}

export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const SQRT3 = Math.sqrt(3);

export const hexKey = (h: Hex) => `${h.q},${h.r}`;

// 頂点が上を向いた六角形（pointy-top）。size は中心から頂点までの距離
export function hexToPixel(h: Hex, size: number) {
  return { x: size * SQRT3 * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

export function pixelToHex(x: number, y: number, size: number): Hex {
  const q = ((SQRT3 / 3) * x - y / 3) / size;
  const r = ((2 / 3) * y) / size;
  return roundHex(q, r);
}

// 小数の座標を、いちばん近いセルに丸める
function roundHex(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

// 6つの頂点（頂点 0 が真上、時計回り）
export function hexCornerPoints(cx: number, cy: number, radius: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

// SVG の polygon 用の頂点リスト
export function hexCorners(cx: number, cy: number, radius: number): string {
  return hexCornerPoints(cx, cy, radius)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
}

// start から近い順に、空いているセルを探す（幅優先探索）
export function nearestFree(start: Hex, isTaken: (h: Hex) => boolean): Hex {
  if (!isTaken(start)) return start;
  const seen = new Set([hexKey(start)]);
  const queue: Hex[] = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const d of DIRECTIONS) {
      const next = { q: queue[i].q + d.q, r: queue[i].r + d.r };
      const key = hexKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isTaken(next)) return next;
      queue.push(next);
    }
  }
  return start;
}

export function hexDistance(a: Hex, b: Hex) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// ---------- セルの隙間（六角形の辺）をたどる線（六角メモの hex.js と同じ計算） ----------
//   頂点（3つのセルが接する角）を (i, j) で表す。j は行 r の上辺のジグザグ（= 行 r-1 の下辺）、
//   i は横の位置（半セル単位）。(i+j) が偶数の頂点はセルの上の角、奇数は下の角

interface Vertex {
  i: number;
  j: number;
}

export function vertexToPixel(v: Vertex, size: number) {
  return { x: (size * SQRT3 * v.i) / 2, y: size * (1.5 * v.j - 1) + ((v.i + v.j) & 1 ? size / 2 : 0) };
}

// セルの6つの角：上・右上・右下・下・左下・左上
function cornerVertices(h: Hex): Vertex[] {
  const c = 2 * h.q + h.r;
  return [
    { i: c, j: h.r },
    { i: c + 1, j: h.r },
    { i: c + 1, j: h.r + 1 },
    { i: c, j: h.r + 1 },
    { i: c - 1, j: h.r + 1 },
    { i: c - 1, j: h.r },
  ];
}

function vertexNeighbors(v: Vertex): Vertex[] {
  return [
    { i: v.i - 1, j: v.j },
    { i: v.i + 1, j: v.j },
    { i: v.i, j: (v.i + v.j) & 1 ? v.j + 1 : v.j - 1 },
  ];
}

// 辺をたどったときの最短の辺の数
function vertexDistance(a: Vertex, b: Vertex) {
  const di = Math.abs(b.i - a.i);
  const dj = b.j - a.j;
  if (dj === 0) return di;
  const up = dj < 0;
  const n = Math.abs(dj);
  const startOk = ((a.i + a.j) & 1) === (up ? 0 : 1);
  const endOk = ((b.i + b.j) & 1) === (up ? 1 : 0);
  const hMin = n - 1 + (startOk ? 0 : 1) + (endOk ? 0 : 1);
  return n + Math.max(di, hMin);
}

function distToLine(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
}

// セル a から b への、隙間だけを通る最短の道（頂点の列）。同じセルなら null。
//   最短の中では、なるべくまっすぐ（2つのセルを結ぶ直線の近く）を通る
export function gapRoute(a: Hex, b: Hex): Vertex[] | null {
  const d = hexDistance(a, b);
  if (d === 0) return null;
  const ca = cornerVertices(a);
  const cb = cornerVertices(b);
  if (d === 1) return ca.filter((v) => cb.some((w) => w.i === v.i && w.j === v.j));

  const pa = hexToPixel(a, 1);
  const pb = hexToPixel(b, 1);
  let best: { s: Vertex; t: Vertex; ps: { x: number; y: number }; pt: { x: number; y: number }; len: number; span: number; off: number } | null = null;
  for (const s of ca) {
    const ps = vertexToPixel(s, 1);
    for (const t of cb) {
      const pt = vertexToPixel(t, 1);
      const cand = { s, t, ps, pt, len: vertexDistance(s, t), span: Math.hypot(pt.x - ps.x, pt.y - ps.y), off: distToLine(ps, pa, pb) + distToLine(pt, pa, pb) };
      if (
        !best ||
        cand.len < best.len ||
        (cand.len === best.len && (cand.span < best.span - 1e-9 || (Math.abs(cand.span - best.span) <= 1e-9 && cand.off < best.off - 1e-9)))
      ) {
        best = cand;
      }
    }
  }
  if (!best) return null;
  const route = [best.s];
  let cur = best.s;
  for (let left = best.len; left > 0; left--) {
    let next: Vertex | null = null;
    let nextOff = Number.POSITIVE_INFINITY;
    for (const n of vertexNeighbors(cur)) {
      if (vertexDistance(n, best.t) !== left - 1) continue;
      const off = distToLine(vertexToPixel(n, 1), best.ps, best.pt);
      if (off < nextOff - 1e-9) {
        next = n;
        nextOff = off;
      }
    }
    if (!next) return null;
    route.push(next);
    cur = next;
  }
  return route;
}
