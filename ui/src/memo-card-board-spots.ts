// ボードの置き場の計算（TA1。DOM も保存も使わない。ui/test/memo-card-board-spots.test.ts）
//   計画書 docs/plan-comment-board-templates.md の §4。ここに置くのは、足す置き場（memo-card-board-edit.ts）と貼る置き場（memo-card-board-paste.ts）の
//   両方が使う升目の計算。edit は paste を読み込むので、paste から edit を読むと読み込みが輪になる。だから別のファイルにした
//   ・升目の輪の順（右と下が先）：今の「足す」の置き場（spotForNewCard）と同じ順。ここへ出して、両方が使う（答えは変えない）
//   ・型を置く：押したカードを基準に、右と下の升へ型の順に 1 枚ずつ（spotsRightDown）。型の中に重なりが無ければ、型の形のまま（groupSpotFrom）
//   ・空きで押した点に 1 枚置く（TA4a）：点を真ん中にした左上（pointSpot）と、そこがふさがっているときの寄せ方（spotAt）
import { BOARD_CARD, BOARD_LIMITS, type BoardView, boxesOverlap, type CardSize, cleanCoord, type GridStep, type Overlaps, screenToBoard, SQUARE_STEP } from './memo-card-board';
import type { Pt } from './memo-card-board-select';

export const RING_MAX = 24; // 空きを探す輪の数（升目 1 つずつ外へ。memo-card-board-edit.ts の SPOT_RINGS と同じ数）
export const GROUP_RINGS = 2; // 形を保つ一団を、右と下へずらして探す輪の数（これより遠くへは出さず、順に升へ入れる置き方へ落とす）
export const SHAPE_SLACK = 6; // 型の中の浅い重なり（この深さまで）は、重なりに数えない（手で接して置いたカードの組を、形のまま出すため）

export interface Cell {
  dx: number;
  dy: number;
}

// 二枚（位置の左上）の重なりの深さ。重ならなければ 0 以下。型の中の重なりを見るのに使う（形ごとに渡す。四角はこれ、六角は hexDepth）
export type Depth = (a: Pt, b: Pt) => number;
export const boxDepth = (a: Pt, b: Pt, size: CardSize = BOARD_CARD): number => Math.min(size.w - Math.abs(b.x - a.x), size.h - Math.abs(b.y - a.y));

// 点 p の、箱（左上 at）の縁から外への離れ。箱の中は 0 以下（真ん中がいちばん小さい）。四角の geo の outside（TA4a）
export const boxOutside = (at: Pt, p: Pt, size: CardSize = BOARD_CARD): number => Math.max(Math.abs(p.x - (at.x + size.w / 2)) - size.w / 2, Math.abs(p.y - (at.y + size.h / 2)) - size.h / 2);

// 基準の位置から数えた升の位置。奇数の段（dy）は、ずらし（六角の 83）だけ右へ
export function cellAt(base: Pt, cell: Cell, step: GridStep): Pt {
  return { x: base.x + cell.dx * step.x + (cell.dy % 2 !== 0 ? (step.shift ?? 0) : 0), y: base.y + cell.dy * step.y };
}

const ringOf = (r: number): Cell[] => {
  const ring: Cell[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push({ dx, dy });
  return ring;
};

// 輪 r のうち、右と下の升（dx≧0・dy≧0）。歩数（dx＋dy）の少ない順、同じなら右を先に
export function rightDownCells(r: number): Cell[] {
  const cells = ringOf(r).filter((c) => c.dx >= 0 && c.dy >= 0);
  cells.sort((a, b) => a.dx + a.dy - (b.dx + b.dy) || a.dy - b.dy);
  return cells;
}

// 輪 r のうち、上か左の升。基準に近い順
export function otherCells(r: number, step: GridStep): Cell[] {
  const cells = ringOf(r).filter((c) => c.dx < 0 || c.dy < 0);
  cells.sort((a, b) => Math.hypot(a.dx * step.x, a.dy * step.y) - Math.hypot(b.dx * step.x, b.dy * step.y) || b.dy - a.dy || b.dx - a.dx);
  return cells;
}

const inLimit = (p: Pt) => Math.abs(p.x) <= BOARD_LIMITS.coord && Math.abs(p.y) <= BOARD_LIMITS.coord;

// 見ている面の真ん中にカード 1 枚を置くときの左上（面に大きさが無ければ、原点にカード 1 枚）
export function centerSpot(view: BoardView, viewport: { w: number; h: number }, size: CardSize = BOARD_CARD): Pt {
  const c = viewport.w > 0 && viewport.h > 0 ? screenToBoard(view, viewport.w / 2, viewport.h / 2) : { x: size.w / 2, y: size.h / 2 };
  return { x: cleanCoord(c.x - size.w / 2), y: cleanCoord(c.y - size.h / 2) };
}

// base が空いていれば base。ふさがっていれば、升目の輪で右と下へ探す。右と下で見つからないときだけ、上と左も近い順に探す。無ければ null
export function ringSpot(base: Pt, taken: readonly Pt[], step: GridStep = SQUARE_STEP, overlaps: Overlaps = (a, b) => boxesOverlap(a, b), rings: number = RING_MAX): Pt | null {
  const free = (p: Pt) => inLimit(p) && !taken.some((t) => overlaps(p, t));
  if (free(base)) return base;
  for (let r = 1; r <= rings; r++) {
    for (const cell of rightDownCells(r)) {
      const p = cellAt(base, cell, step);
      if (free(p)) return p;
    }
  }
  for (let r = 1; r <= rings; r++) {
    for (const cell of otherCells(r, step)) {
      const p = cellAt(base, cell, step);
      if (free(p)) return p;
    }
  }
  return null;
}

// 点（ボードの座標）を真ん中にした箱の左上。空きで押した点から、置き場の左上を作る（TA4a）
export function pointSpot(p: Pt, size: CardSize = BOARD_CARD): Pt {
  return { x: cleanCoord(p.x - size.w / 2), y: cleanCoord(p.y - size.h / 2) };
}

// 相手（左上 t）の隣の升。相手の位置から数える。ずらしのある升目（六角）は 6 つ、無い升目（四角）は 8 つ
const neighbourSpots = (t: Pt, step: GridStep): Pt[] => {
  const shift = step.shift ?? 0;
  const d: readonly (readonly [number, number])[] =
    shift !== 0
      ? [[step.x, 0], [-step.x, 0], [shift, step.y], [-shift, step.y], [shift, -step.y], [-shift, -step.y]]
      : [[step.x, 0], [-step.x, 0], [0, step.y], [0, -step.y], [step.x, step.y], [-step.x, step.y], [step.x, -step.y], [-step.x, -step.y]];
  return d.map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy }));
};

// 押した所（左上 at）にカードを 1 枚置く場所（TA4a。計画書 §4.2）。置けなければ null
//   1. at（整数にして ±10,000 に収める）が空いていれば、そこ。升には寄せない。接していてもよい
//   2. ふさがっていれば、重なる相手それぞれの隣の升のうち、空いていて、at にいちばん近い所（左上どうしの距離）。同じ近さなら下、次に右
//   3. 無ければ、at から升目の輪で探す（ringSpot。右と下が先）
export function spotAt(at: Pt, taken: readonly Pt[], step: GridStep = SQUARE_STEP, overlaps: Overlaps = (a, b) => boxesOverlap(a, b), rings: number = RING_MAX): Pt | null {
  const base = { x: cleanCoord(at.x), y: cleanCoord(at.y) };
  const free = (p: Pt) => inLimit(p) && !taken.some((t) => overlaps(p, t));
  if (free(base)) return base;
  let best: Pt | null = null;
  let bestDist = Infinity;
  for (const t of taken) {
    if (!overlaps(base, t)) continue;
    for (const p of neighbourSpots(t, step)) {
      if (!free(p)) continue;
      const d = (p.x - base.x) ** 2 + (p.y - base.y) ** 2;
      if (d < bestDist || (d === bestDist && best !== null && (p.y > best.y || (p.y === best.y && p.x > best.x)))) {
        best = p;
        bestDist = d;
      }
    }
  }
  return best ?? ringSpot(base, taken, step, overlaps, rings);
}

// 基準の升（origin。その升そのものは使わない）から、右と下の升を n 個。型のカードを、型の順に 1 枚ずつ置く並び
//   升の順は ringSpot と同じ（輪 1 から。輪の中は歩数の少ない順、同じなら右）。taken と重なる升・±10,000 の外の升は飛ばす。
//   右と下で足りないときだけ、上と左の升も近い順に使う。足りなければ null
export function spotsRightDown(origin: Pt, n: number, taken: readonly Pt[], step: GridStep = SQUARE_STEP, overlaps: Overlaps = (a, b) => boxesOverlap(a, b), rings: number = RING_MAX): Pt[] | null {
  const out: Pt[] = [];
  if (n <= 0) return out;
  const free = (p: Pt) => inLimit(p) && !taken.some((t) => overlaps(p, t));
  const take = (cells: readonly Cell[]): boolean => {
    for (const cell of cells) {
      const p = cellAt(origin, cell, step);
      if (!free(p)) continue;
      out.push(p);
      if (out.length === n) return true;
    }
    return false;
  };
  for (let r = 1; r <= rings; r++) if (take(rightDownCells(r))) return out;
  for (let r = 1; r <= rings; r++) if (take(otherCells(r, step))) return out;
  return null;
}

// 型の中のカードどうし（offsets＝型の中の位置）が、その形で 1 組でも重なるか。深さが slack までの浅い重なりは数えない
export function offsetsOverlap(offsets: readonly Pt[], depth: Depth = (a, b) => boxDepth(a, b), slack: number = SHAPE_SLACK): boolean {
  for (let i = 0; i < offsets.length; i++) for (let j = i + 1; j < offsets.length; j++) if (depth(offsets[i], offsets[j]) > slack) return true;
  return false;
}

// 形を保って置く一団の左上。start、次に右と下の輪 1〜rings の升へずらした位置を順に見て、全部のカードが空いていて ±10,000 の中にある最初の所。
//   上と左へは探さない。無ければ null（呼ぶ側は、順に升へ入れる置き方へ落とす）。引数の順は spotForGroup と同じ（避ける位置が先）
export function groupSpotFrom(start: Pt, taken: readonly Pt[], offsets: readonly Pt[], step: GridStep = SQUARE_STEP, overlaps: Overlaps = (a, b) => boxesOverlap(a, b), rings: number = GROUP_RINGS): Pt | null {
  const fits = (o: Pt) =>
    offsets.every((d) => {
      const p = { x: o.x + d.x, y: o.y + d.y };
      return inLimit(p) && !taken.some((t) => overlaps(p, t));
    });
  if (fits(start)) return start;
  for (let r = 1; r <= rings; r++) {
    for (const cell of rightDownCells(r)) {
      const o = cellAt(start, cell, step);
      if (fits(o)) return o;
    }
  }
  return null;
}

// 型を置く基準
//   card：押したカードの位置（左上）。型のカードは、その右と下に出る
//   point（TA5。空きで押した所）：at＝押した点を真ん中にした、カード 1 枚の左上。corner＝押した点そのもの（形を保つ一団の左上の角を合わせる。無ければ at）
//   center（TA5。題の帯から）：at＝見ている面の真ん中に置くカード 1 枚の左上（centerSpot）
export type SpotAnchor = { kind: 'card'; at: Pt } | { kind: 'point'; at: Pt; corner?: Pt } | { kind: 'center'; at: Pt };

export interface TemplateSpotsInput {
  raw: readonly Pt[]; // 型の中の位置（生の dx・dy。左上を 0 にしたもの。升目には広げない）
  anchor: SpotAnchor;
  taken: readonly Pt[]; // 避ける位置（描いているカードと、保存を待っているカード）
  step?: GridStep;
  overlaps?: Overlaps;
  depth?: Depth;
}

// 型のカードの位置（型の順）。置けなければ null
//   形を保つ：2 枚以上で、その形で型の中に重なりが無いとき。一団の左上を、押したカードの右の升に置く（ふさがっていれば、右と下へ 2 輪まで）
//   それ以外・形を保つ置き方で空きが無いとき：押したカードから、右と下の升へ、型の順に 1 枚ずつ
//   点・真ん中が基準（TA5）：形を保つなら、一団の左上を、押した点（真ん中は at）に置く（2 輪まで）。順に升へ入れるなら、1 枚目を押した所（spotAt）か
//   真ん中から（ringSpot。今の「足す」と同じ探し方）に置き、残りを、その 1 枚目の右と下の升へ
export function templateSpots(input: TemplateSpotsInput): Pt[] | null {
  const { raw, anchor, taken } = input;
  const step = input.step ?? SQUARE_STEP;
  const overlaps = input.overlaps ?? ((a: Pt, b: Pt) => boxesOverlap(a, b));
  const depth = input.depth ?? ((a: Pt, b: Pt) => boxDepth(a, b));
  if (raw.length === 0) return [];
  if (raw.length >= 2 && !offsetsOverlap(raw, depth)) {
    const corner = anchor.kind === 'point' ? (anchor.corner ?? anchor.at) : anchor.at;
    const start = anchor.kind === 'card' ? { x: anchor.at.x + step.x, y: anchor.at.y } : { x: cleanCoord(corner.x), y: cleanCoord(corner.y) };
    const origin = groupSpotFrom(start, taken, raw, step, overlaps);
    if (origin) return raw.map((d) => ({ x: origin.x + d.x, y: origin.y + d.y }));
  }
  if (anchor.kind === 'card') return spotsRightDown(anchor.at, raw.length, taken, step, overlaps);
  const first = anchor.kind === 'point' ? spotAt(anchor.at, taken, step, overlaps) : ringSpot(anchor.at, taken, step, overlaps);
  if (!first) return null;
  const rest = spotsRightDown(first, raw.length - 1, [...taken, first], step, overlaps);
  return rest ? [first, ...rest] : null;
}
