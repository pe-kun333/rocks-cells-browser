// 下の区画のカードの関連の「マップ」（M5）：関連でつながったカードを、力学（反発・ばね・中心への引き）で置く
//   ・ここは純粋な関数だけ（DOM を使わない。画面は memo-card-map-view.ts）。乱数は使わない（同じ入力なら、開き直しても同じ形）
//   ・節は関連を持つ一番上のカード（出る・来る、どちらでも）。関連の無いカードはマップに出さない（数だけ返す）
//   ・位置は id ごとに持ち、呼ぶ側が前の位置を渡す（節と辺の組が変わったときだけ計算し直す。写しが届くたびには揺らさない）
import type { DrawLink } from './memo-card-links';
import type { Reply } from './threads';

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapGraph {
  ids: string[]; // 節（つながりごとに、つながりの最初のカードの作った順。中も作った順）
  edges: DrawLink[]; // 辺（元 → 相手。種類つき）
  loose: number; // 関連の無い一番上のカードの数（マップに出さない）
}

export const MAP_NODE_W = 150; // 節の大きさ（角丸の札）
export const MAP_NODE_H = 34;
export const MAP_STEPS = 150; // 力学を回す回数（動きを見せるときは 1 コマに 1 回）
const REPULSE = 9000; // 反発（距離の二乗に反比例）
const SPRING = 0.03; // ばねの強さ
const SPRING_LENGTH = 170; // ばねの自然長
const CENTER = 0.001; // 中心（0, 0）への弱い引き（強いと別のつながりが寄りすぎる）
const DAMPING = 0.6; // 減衰（速さに掛ける）
const MAX_SPEED = 50; // 1 回に動く上限（はじけないように）
const MIN_DIST = 1;
const GAP = 16; // 札どうしの最小のすき間（重なりを押し離すとき）
const APART = 4; // 別のつながりの節どうしの反発の倍率（つながりの境目が見えるように離す）

// 一番上のカードから、マップの節と辺を作る（tops は一番上のカード。並びは問わない）
export function mapGraph(tops: readonly Reply[]): MapGraph {
  const byId = new Map(tops.map((r) => [r.id, r]));
  const sorted = [...tops].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const edges: DrawLink[] = [];
  const near = new Map<string, string[]>();
  for (const r of sorted) {
    for (const link of r.links ?? []) {
      if (!byId.has(link.to) || link.to === r.id) continue;
      edges.push({ from: r.id, to: link.to, kind: link.kind });
      near.set(r.id, [...(near.get(r.id) ?? []), link.to]);
      near.set(link.to, [...(near.get(link.to) ?? []), r.id]);
    }
  }
  // つながりごと（向きを無視）に、最初のカードの作った順。中は作った順
  const pos = new Map(sorted.map((r, i) => [r.id, i]));
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const start of sorted) {
    if (seen.has(start.id) || !near.has(start.id)) continue;
    seen.add(start.id);
    const part = [start.id];
    for (let i = 0; i < part.length; i++) {
      for (const next of near.get(part[i]) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        part.push(next);
      }
    }
    part.sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
    ids.push(...part);
  }
  return { ids, edges, loose: sorted.length - ids.length };
}

// 初めの位置：前の位置があればそのまま。無い節は、ひまわりの種の並び（i 番目を半径 90√(i+½)・角 i×黄金角）に置く（乱数を使わない）
export function initialPositions(ids: readonly string[], keep: ReadonlyMap<string, MapPoint>): Map<string, MapPoint> {
  const out = new Map<string, MapPoint>();
  ids.forEach((id, i) => {
    const old = keep.get(id);
    if (old) {
      out.set(id, { ...old });
      return;
    }
    const r = 90 * Math.sqrt(i + 0.5);
    const a = i * 2.399963229728653; // 黄金角（ラジアン）
    out.set(id, { x: r * Math.cos(a), y: r * Math.sin(a) });
  });
  return out;
}

// 節のつながりの番号（向きを無視して辺でたどれる節は同じ番号）。stepMap に渡す
export function mapGroups(ids: readonly string[], edges: readonly DrawLink[]): Map<string, number> {
  const near = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    near.get(e.from)?.push(e.to);
    near.get(e.to)?.push(e.from);
  }
  const group = new Map<string, number>();
  let n = 0;
  for (const start of ids) {
    if (group.has(start)) continue;
    const queue = [start];
    group.set(start, n);
    for (let i = 0; i < queue.length; i++) {
      for (const next of near.get(queue[i]) ?? []) {
        if (group.has(next)) continue;
        group.set(next, n);
        queue.push(next);
      }
    }
    n += 1;
  }
  return group;
}

// 力学を 1 回進める（pos と vel を書き換える）。pinned の節は動かさない。groups：つながりの番号（別のつながりどうしは強く反発）
//   返り値は、いちばん大きく動いた距離
export function stepMap(
  ids: readonly string[],
  pos: Map<string, MapPoint>,
  vel: Map<string, MapPoint>,
  edges: readonly DrawLink[],
  pinned: ReadonlySet<string>,
  groups: ReadonlyMap<string, number> = new Map(),
  aspect = 1,
): number {
  const force = new Map<string, MapPoint>(ids.map((id) => [id, { x: 0, y: 0 }]));
  // 反発（すべての組。並びの順に決まった順で足す）
  for (let i = 0; i < ids.length; i++) {
    const a = pos.get(ids[i]);
    const fa = force.get(ids[i]);
    if (!a || !fa) continue;
    for (let j = i + 1; j < ids.length; j++) {
      const b = pos.get(ids[j]);
      const fb = force.get(ids[j]);
      if (!b || !fb) continue;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d = Math.hypot(dx, dy);
      if (d < MIN_DIST) {
        // 重なったら、並びの順で決まった向きに離す（乱数を使わない）
        dx = 1;
        dy = (i % 2 === 0 ? 1 : -1) * 0.5;
        d = Math.hypot(dx, dy);
      }
      const apart = groups.get(ids[i]) !== groups.get(ids[j]) ? APART : 1;
      const f = (REPULSE * apart) / (d * d);
      fa.x += (dx / d) * f;
      fa.y += (dy / d) * f;
      fb.x -= (dx / d) * f;
      fb.y -= (dy / d) * f;
    }
  }
  // ばね（辺。同じ二枚のあいだに二本あっても、それぞれ引く）
  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    const fa = force.get(e.from);
    const fb = force.get(e.to);
    if (!a || !b || !fa || !fb) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(MIN_DIST, Math.hypot(dx, dy));
    const f = SPRING * (d - SPRING_LENGTH);
    fa.x += (dx / d) * f;
    fa.y += (dy / d) * f;
    fb.x -= (dx / d) * f;
    fb.y -= (dy / d) * f;
  }
  // 中心への弱い引き・減衰・速さの上限。つまんで止めた節は動かさない
  let most = 0;
  for (const id of ids) {
    const p = pos.get(id);
    const f = force.get(id);
    if (!p || !f) continue;
    if (pinned.has(id)) {
      vel.set(id, { x: 0, y: 0 });
      continue;
    }
    // 図の縦横の比（aspect ＝ 幅 ÷ 高さ）に合わせる：横長なら縦に強く引いて横に広げ、縦長なら横に強く引く（図に合わせて縮みすぎないように）
    f.x -= p.x * CENTER * (aspect < 1 ? 1 / (aspect * aspect) : 1);
    f.y -= p.y * CENTER * (aspect > 1 ? aspect * aspect : 1);
    const v = vel.get(id) ?? { x: 0, y: 0 };
    let vx = (v.x + f.x) * DAMPING;
    let vy = (v.y + f.y) * DAMPING;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SPEED) {
      vx = (vx / speed) * MAX_SPEED;
      vy = (vy / speed) * MAX_SPEED;
    }
    vel.set(id, { x: vx, y: vy });
    p.x += vx;
    p.y += vy;
    most = Math.max(most, Math.hypot(vx, vy));
  }
  // 札は横に長い（150×34）ので、距離だけの反発では横に重なることがある。重なった組を、重なりの浅い向きに押し離す
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < ids.length; i++) {
      const a = pos.get(ids[i]);
      if (!a) continue;
      for (let j = i + 1; j < ids.length; j++) {
        const b = pos.get(ids[j]);
        if (!b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = MAP_NODE_W + GAP - Math.abs(dx);
        const oy = MAP_NODE_H + GAP - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        const aFixed = pinned.has(ids[i]);
        const bFixed = pinned.has(ids[j]);
        if (aFixed && bFixed) continue;
        const shareA = aFixed ? 0 : bFixed ? 1 : 0.5;
        const shareB = 1 - shareA;
        if (ox < oy * (MAP_NODE_W / MAP_NODE_H)) {
          const s = dx >= 0 ? 1 : -1; // 同じ x なら、並びの順で b を右へ
          a.x -= s * ox * shareA;
          b.x += s * ox * shareB;
        } else {
          const s = dy >= 0 ? 1 : -1;
          a.y -= s * oy * shareA;
          b.y += s * oy * shareB;
        }
      }
    }
  }
  return most;
}

// 力学を steps 回まとめて回す（動きを減らす設定のとき・確かめ）。前の位置 keep と、止めた節 pinned を渡す
export function simulateMap(graph: MapGraph, keep: ReadonlyMap<string, MapPoint>, pinned: ReadonlySet<string>, steps = MAP_STEPS, aspect = 1): Map<string, MapPoint> {
  const pos = initialPositions(graph.ids, keep);
  const vel = new Map<string, MapPoint>();
  const groups = mapGroups(graph.ids, graph.edges);
  for (let i = 0; i < steps; i++) stepMap(graph.ids, pos, vel, graph.edges, pinned, groups, aspect);
  return pos;
}

// 節の組と辺の組の印（同じなら計算し直さない）
export function mapGraphKey(graph: MapGraph): string {
  return `${graph.ids.join(',')}|${graph.edges.map((e) => `${e.from}>${e.to}:${e.kind}`).join(',')}`;
}

// 全部の節が入る枠（節の大きさと余白 margin を含む）。節が無ければ 0 の枠
export function mapBounds(pos: ReadonlyMap<string, MapPoint>, margin = 24): { x: number; y: number; w: number; h: number } {
  if (pos.size === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x - MAP_NODE_W / 2);
    maxX = Math.max(maxX, p.x + MAP_NODE_W / 2);
    minY = Math.min(minY, p.y - MAP_NODE_H / 2);
    maxY = Math.max(maxY, p.y + MAP_NODE_H / 2);
  }
  return { x: minX - margin, y: minY - margin, w: maxX - minX + margin * 2, h: maxY - minY + margin * 2 };
}

// 二つの節の中心を結ぶ線を、それぞれの札の縁で切る（矢じりが札に隠れないように）。札は MAP_NODE_W × MAP_NODE_H の四角
export function edgeEnds(a: MapPoint, b: MapPoint): { from: MapPoint; to: MapPoint } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1) return null;
  const cut = (dxs: number, dys: number) => {
    // 中心から (dxs, dys) の向きに進んで、四角の縁に当たるまでの割合
    const tx = dxs === 0 ? Infinity : MAP_NODE_W / 2 / Math.abs(dxs);
    const ty = dys === 0 ? Infinity : MAP_NODE_H / 2 / Math.abs(dys);
    return Math.min(tx, ty);
  };
  const ta = cut(dx, dy);
  const tb = cut(-dx, -dy);
  if (ta + tb >= 1) return null; // 札どうしが重なっている
  return { from: { x: a.x + dx * ta, y: a.y + dy * ta }, to: { x: b.x - dx * tb, y: b.y - dy * tb } };
}

// 線の呼称（種類の名前）を置く所：線の真ん中から、向きの左へ offset だけずらす（A→B と B→A の札が重ならないように）。
//   画面の座標（y は下向き）で、向き (dx, dy) の左は (dy, -dx)。線が短すぎるときは真ん中のまま
export const MAP_EDGE_LABEL_OFFSET = 10;
export function edgeLabelPoint(from: MapPoint, to: MapPoint, offset = MAP_EDGE_LABEL_OFFSET): MapPoint {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: mx, y: my };
  return { x: mx + (dy / len) * offset, y: my - (dx / len) * offset };
}

// 四角（窓の中の位置。left・top・right・bottom）
export interface MapBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// 右クリックで出したカードを、札のどちら側に出すか
export type MapSide = 'right' | 'left' | 'top' | 'bottom';
export const MAP_SIDES: readonly MapSide[] = ['right', 'left', 'top', 'bottom'];
const OPPOSITE: Readonly<Record<MapSide, MapSide>> = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };

// 札の side の側に置いたときの位置（窓に収めない、そのままの位置）。左右は札の上の縁、上下は札の左の縁にそろえる
function rawSide(node: MapBox, size: { w: number; h: number }, side: MapSide, gap: number): { x: number; y: number } {
  if (side === 'right') return { x: node.right + gap, y: node.top };
  if (side === 'left') return { x: node.left - gap - size.w, y: node.top };
  if (side === 'top') return { x: node.left, y: node.top - gap - size.h };
  return { x: node.left, y: node.bottom + gap };
}

// その側に、窓からはみ出さずに入るか（向きの軸だけを見る。もう一つの軸は縁に沿ってずらして収める）
function sideFits(node: MapBox, size: { w: number; h: number }, area: MapBox, side: MapSide, gap: number, pad: number): boolean {
  if (side === 'right') return node.right + gap + size.w <= area.right - pad;
  if (side === 'left') return node.left - gap - size.w >= area.left + pad;
  if (side === 'top') return node.top - gap - size.h >= area.top + pad;
  return node.bottom + gap + size.h <= area.bottom - pad;
}

// その側の空き（向きの軸の、札の縁から窓の縁まで）
function sideRoom(node: MapBox, area: MapBox, side: MapSide): number {
  if (side === 'right') return area.right - node.right;
  if (side === 'left') return node.left - area.left;
  if (side === 'top') return node.top - area.top;
  return area.bottom - node.bottom;
}

// 選んだ側（side）に置く。入らなければ、その時だけ反対の側。どちらも入らなければ空きの広い方。最後に窓の中へ収める
//   （返す side は実際に置いた側。選んだ側は呼ぶ側が覚えたまま）
export function sidePlacement(node: MapBox, size: { w: number; h: number }, area: MapBox, side: MapSide, gap = 8, pad = 4): { x: number; y: number; side: MapSide } {
  const other = OPPOSITE[side];
  let use: MapSide;
  if (sideFits(node, size, area, side, gap, pad)) use = side;
  else if (sideFits(node, size, area, other, gap, pad)) use = other;
  else use = sideRoom(node, area, side) >= sideRoom(node, area, other) ? side : other;
  const at = rawSide(node, size, use, gap);
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));
  return {
    x: clamp(at.x, area.left + pad, area.right - pad - size.w),
    y: clamp(at.y, area.top + pad, area.bottom - pad - size.h),
    side: use,
  };
}

// つまんで動かしているカードの真ん中が、札の真ん中から見てどちらの向きか（角度で 4 つに分ける。斜め 45° ちょうどは左右）
export function nearestSide(nodeCenter: MapPoint, cardCenter: MapPoint): MapSide {
  const dx = cardCenter.x - nodeCenter.x;
  const dy = cardCenter.y - nodeCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

// 右クリックで出したカードを置く所：札の右（入らなければ左。どちらも入らなければ広い方）に、札の上の縁にそろえて置き、
//   窓（area）の中に収める（pad は窓の縁との間）。カードが窓より大きいときは、左上の縁にそろえる（はみ出す分は呼ぶ側が高さを切る）
export function pinPlacement(node: MapBox, size: { w: number; h: number }, area: MapBox, gap = 8, pad = 4): { x: number; y: number; side: MapSide } {
  return sidePlacement(node, size, area, 'right', gap, pad); // 初めは右（入らなければ左）
}

// 二つの四角が少しでも重なるか（札・元のカードが、置ける所の中に見えているか）
export function boxesOverlap(a: MapBox, b: MapBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// 位置を、置ける所（area）の中に収める（元が見えないときに、最後の位置のまま残すため）。カードが大きすぎれば左上の縁
export function clampInto(at: MapPoint, size: { w: number; h: number }, area: MapBox, pad = 4): MapPoint {
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));
  return { x: clamp(at.x, area.left + pad, area.right - pad - size.w), y: clamp(at.y, area.top + pad, area.bottom - pad - size.h) };
}

// 避けるものがあるときの置き所：選んだ側（preferred）→ 右・下・左・上 の順に、窓に入って、どの障りもの（obstacles）とも重ならない側を探す。
//   その側では、まず縁に沿って収めた位置、次に障りものの先（左右に出すときは障りものの下・上、上下に出すときは右・左）へずらした位置を試す
//   （ずらしても、元の札と少し（ATTACH px）は並んでいること）。どれも重なるときは、ふつうの置き所（sidePlacement。重なりは前後の順に任せる）
//   avoided：選んだ側と違う側にしたか、ずらしたか（選んだ側は呼ぶ側が覚えたまま）
const ATTACH = 16;
const AVOID_ORDER: readonly MapSide[] = ['right', 'bottom', 'left', 'top'];
export function avoidPlacement(
  node: MapBox,
  size: { w: number; h: number },
  area: MapBox,
  preferred: MapSide,
  obstacles: readonly MapBox[],
  gap = 8,
  pad = 4,
): { x: number; y: number; side: MapSide; avoided: boolean } {
  const plain = sidePlacement(node, size, area, preferred, gap, pad);
  const boxOf = (x: number, y: number): MapBox => ({ left: x, top: y, right: x + size.w, bottom: y + size.h });
  const clear = (x: number, y: number) => obstacles.every((o) => !boxesOverlap(boxOf(x, y), o));
  if (obstacles.length === 0 || clear(plain.x, plain.y)) return { ...plain, avoided: false };
  const order = [preferred, ...AVOID_ORDER.filter((s) => s !== preferred)];
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));
  const minX = area.left + pad;
  const maxX = area.right - pad - size.w;
  const minY = area.top + pad;
  const maxY = area.bottom - pad - size.h;
  for (const side of order) {
    if (!sideFits(node, size, area, side, gap, pad)) continue;
    const base = rawSide(node, size, side, gap);
    const bx = clamp(base.x, minX, maxX);
    const by = clamp(base.y, minY, maxY);
    const tries: { x: number; y: number }[] = [{ x: bx, y: by }];
    if (side === 'right' || side === 'left') {
      for (const o of obstacles) tries.push({ x: bx, y: clamp(o.bottom + gap, minY, maxY) }, { x: bx, y: clamp(o.top - gap - size.h, minY, maxY) });
    } else {
      for (const o of obstacles) tries.push({ x: clamp(o.right + gap, minX, maxX), y: by }, { x: clamp(o.left - gap - size.w, minX, maxX), y: by });
    }
    for (const t of tries) {
      const attached = side === 'right' || side === 'left' ? t.y <= node.bottom - ATTACH && t.y + size.h >= node.top + ATTACH : t.x <= node.right - ATTACH && t.x + size.w >= node.left + ATTACH;
      if (attached && clear(t.x, t.y)) return { x: t.x, y: t.y, side, avoided: true };
    }
  }
  return { ...plain, avoided: false };
}
