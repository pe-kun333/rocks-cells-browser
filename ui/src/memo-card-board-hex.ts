// 正六角のカードの計算（HX4。DOM も保存も使わない。ui/test/memo-card-board-hex.test.ts）
//   正六角は頂点が上。幅 W＝150（縦の辺どうしの間）、高さ 2W/√3（173.2）。位置は箱（150×174）の左上の画素で持つ（四角と同じ形の位置）
//   ここで決めること：仮の並び（作った順に 5 枚と 4 枚の行を交互に）、重なり、線の端（縁で切る・短い線の帯）、範囲選択の当たり、点が中か、
//   開いたときの最後に書いた辺り（決まり 3・4）、顔の三角に出す字（印・タグ。日時は 2026-11-09 の利用者の依頼で出さない）、Shift＋矢印の選び方、メニューの出し口
//   描くのは app/memo-board-hex.ts（SVG の多角形と HTML の字）と app/memo-board-tab.ts。形ごとの口は memo-card-board-geo.ts
//   HX5：六角の位置は ui-data/boards-hex/<メモ id>.json（中身は四角と同じ形）。置いたカードはその位置、ファイルに無いカードは仮の並び。
//   六角で初めて位置を書くときに、描いているカード全部の仮の位置を一度だけ書く（固める。計画 §6.2 の 2）。動かしたカードは nodes の最後へ（上に描く）
import { BOARD_LIMITS, type Board, type BoardNode, type BoardPlacement, type BoardView, clampView, cleanCoord, type GridStep, liveRefs, moveNodes, type NodeMove, type Rect, trimNodes } from './memo-card-board';
import type { NearestOpts, Pt } from './memo-card-board-select';
import type { LoadBoardResult } from './memo-card-board-store';
import { boxReadable, curveGeometry, type EdgeGeometry, lastWritten, type MovePlan, OPEN_ZOOMS, type Placed, placeBox, READ_PAD, type ReadBox, type RecentOpts, type RecentView, replyCount, replyCounts, type Viewport } from './memo-card-board-view';
import { visibleTags } from './grok-cards-tags';
import type { DrawLink } from './memo-card-links';
import { createdTops, type Reply } from './threads';

const SQRT3 = Math.sqrt(3);

// 寸法（計画 §6.3。幅は位置を保存し始めたら変えない）
export const HEX = {
  w: 150, // 幅（縦の辺どうしの間）
  h: (2 * 150) / SQRT3, // 高さ（上の頂点から下の頂点。173.2）
  boxH: 174, // 箱の高さ（位置の左上からの大きさは 150×174）
  tri: 150 / (2 * SQRT3), // 上と下の三角の高さ（43.3）。真ん中の文の帯は y＋43.3〜y＋129.9
  gap: 16, // 仮の並びの隣どうしの縁から縁（線の矢じり 9 と線 7 が見える）
  stepX: 166, // 横の歩み（W＋隙間）
  stepY: 144, // 行の歩み（166×√3/2 を丸めた値）
  shift: 83, // 奇数の行のずらし（横の歩みの半分）
  rowLong: 5, // 偶数の行の枚数
  rowShort: 4, // 奇数の行の枚数
} as const;

export const HEX_BOX = { w: HEX.w, h: HEX.boxH } as const; // 箱（見えている割合・面の外の札・［全体］）
export const HEX_CENTER: Readonly<Pt> = { x: HEX.w / 2, y: HEX.h / 2 }; // 箱の左上から多角形の中心まで（75, 86.6）
export const HEX_STEP: Readonly<GridStep> = { x: HEX.stepX, y: HEX.stepY, shift: HEX.shift }; // 足す所・型の並びの升目（奇数の行は 83 右。HX5）
export const HEX_BAND_UNDER = 14; // 縁から縁がこれより短い線は、曲線と矢じりをやめて、隙間に短い色の帯で描く
const BAND_HALF = (HEX.h / 2) * 0.35; // 短い線の帯の長さの半分の上限（辺の長さ 86.6 の 7 割を帯にする）
const BAND_MIN = 6; // 向き合う二つの辺の重なる区間が無い・ごく短いときの帯の長さ
const SIDE_HALF = HEX.w / (2 * SQRT3); // 辺の長さ（W/√3）の半分（43.3）

// 平らな辺の法線（頂点が上：縦の辺は横向き 0°、斜めの辺は 60°・120°。y は下向き。絶対値で使うので向きの正負は問わない）
const NORMALS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0.5, SQRT3 / 2],
  [-0.5, SQRT3 / 2],
];

const round1 = (v: number) => Math.round(v * 10) / 10;

// 差 (dx, dy) の、三つの法線への射影の絶対値の最大（六角の「距離」。中心の差がこれ < W なら二枚は重なる）
export function hexReach(dx: number, dy: number): number {
  let m = 0;
  for (const [nx, ny] of NORMALS) m = Math.max(m, Math.abs(dx * nx + dy * ny));
  return m;
}

// ---------- 仮の並び ----------

// 仮の並びの i 番目（0 始まり）の箱の左上：5 枚と 4 枚の行を交互に。行 ＝ 2×⌊i/9⌋＋(i mod 9 ≥ 5 ? 1 : 0)、列 ＝ i mod 9（5 枚の行）か i mod 9 − 5（4 枚の行）。
//   奇数の行は 83 右へずらして、5 枚の行の間に噛み合わせる。面の大きさ・倍率・見ている位置には左右されない
export function hexSlot(i: number): Pt {
  const k = Math.max(0, Math.floor(i) || 0);
  const per = HEX.rowLong + HEX.rowShort;
  const rem = k % per;
  const row = 2 * Math.floor(k / per) + (rem >= HEX.rowLong ? 1 : 0);
  const col = rem < HEX.rowLong ? rem : rem - HEX.rowLong;
  return { x: col * HEX.stepX + (row % 2 === 1 ? HEX.shift : 0), y: row * HEX.stepY };
}

const SLOT_SEARCH = 4000; // 置いたカードと重なった仮のカードを回す空きの番を探す数（layoutCards の SEARCH_LIMIT と同じ）
const inCoord = (p: Pt) => Math.abs(p.x) <= BOARD_LIMITS.coord && Math.abs(p.y) <= BOARD_LIMITS.coord;

// 一番上のカードの並び（HX5）。board は六角のファイルの中身（無ければ全部が仮の並び）
//   置いたカード（ファイルに位置のあるカード）：その位置（saved: true）。描く順は nodes の順（最後に動かしたカードが上）
//   仮のカード（ファイルに位置の無いカード。saved: false）：作った順（createdTops）の i 番目を hexSlot(i) に。置いたカードと重なる番のカードだけを、
//   並びの最後の後ろ（番 n＝カードの数 から先）の空いた番へ回す（ほかの仮のカードは動かさない。仮のカードどうしは番が違えば重ならない）。
//   ±10,000 の中に空いた番が無ければ、元の番のまま重ねて置く。描く順は、仮のカード（作った順）が先（下）、置いたカードがあと（上）
export function hexLayout(replies: readonly Reply[], board: Board | null = null): BoardPlacement[] {
  const tops = createdTops(replies);
  const live = new Set(tops.map((r) => r.id));
  const placed: BoardNode[] = [];
  const seen = new Set<string>();
  for (const n of board?.nodes ?? []) {
    if (!live.has(n.ref) || seen.has(n.ref)) continue; // 孤児は描かない。同じ ref は先のもの
    seen.add(n.ref);
    placed.push(n);
  }
  const hitsPlaced = (p: Pt) => placed.some((n) => hexesOverlap(p, n));
  const out: BoardPlacement[] = [];
  let next = tops.length;
  tops.forEach((r, i) => {
    if (seen.has(r.id)) return;
    let p = hexSlot(i);
    if (hitsPlaced(p)) {
      let k = next;
      while (k < next + SLOT_SEARCH && inCoord(hexSlot(k)) && hitsPlaced(hexSlot(k))) k += 1;
      if (k < next + SLOT_SEARCH && inCoord(hexSlot(k))) {
        p = hexSlot(k);
        next = k + 1;
      }
    }
    out.push({ id: r.id, x: p.x, y: p.y, saved: false });
  });
  for (const n of placed) out.push({ id: n.ref, x: n.x, y: n.y, saved: true });
  return out;
}

// 固める（HX5。計画 §6.2 の 2）：六角のファイルに今の台帳のカードの位置が一つも無ければ、そのとき描いているカード全部の仮の並びの位置を
//   nodes の後ろに足したボード（作った順。孤児の位置はそのまま残す）。一つでもあれば同じボード（固めたあとは、触っていないカードは動かない）
//   足して 300 件（BOARD_LIMITS.nodes）を超えるなら、trimNodes で孤児から（古い順に）捨てる。生きたカードの位置は全部残す（1 つのメモのカードは 300 件まで）。
//   保存は 300 件を超えるボードを書かないので、ここで整えないと、孤児の多いファイルでは初めて動かす・足すときに書けなくなる
export function freezeHexBoard(board: Board, replies: readonly Reply[], now: number): Board {
  const live = liveRefs(replies);
  if (board.nodes.some((n) => live.has(n.ref))) return board;
  const all = hexLayout(replies, board);
  if (all.length === 0) return board;
  return { ...board, updatedAt: now, nodes: trimNodes([...board.nodes, ...all.map((p) => ({ ref: p.id, x: p.x, y: p.y }))], live) };
}

// 六角のファイルに書く動き（動かす・足す・貼る・戻す・やり直す）の計画（HX5。四角の planMoves の代わり。保存は 1 回）
//   読めない・読み込み中は書かない。台帳の一番上にないカード・位置が有限でない動きは入れない（1 枚もなければ notCard）
//   元と同じ所なら書かない（changed=false。つまむ・位置を戻すとき）：どのカードも置いた位置のまま、または、まだ固めていない（置いたカードが無い）並びで、
//   どのカードも仮の位置のまま。固めたあとの仮のカード（ファイルに無いカード。左やほかの形で足した）は、同じ所でも位置を書く（あとで置いたカードに押されて動かないように）。
//   opts.writeSame（足す道：［決める］・Ctrl+Enter・Shift+Enter・足し直し）：足す位置が仮の番と同じでも書く（固めて、そのカードを nodes の最後へ。計画 §6.2 の 2「初めて動かす・足すとき」）
//   opts.view：六角のファイルを初めて作る（missing を固める）ときの見ている位置（呼ぶ側が、見る位置を触っていれば今の位置を渡す。触っていなければ渡さず、初期の位置のまま）
//   書くときは、まだ固めていなければ固め（同じ 1 回の書き込みで）、そのあとに動きを当てる。動かしたカードは nodes の最後へ（最後に動かしたカードが上）。ほかのカードの位置はそのまま
export function planHexMoves(load: LoadBoardResult | null, replies: readonly Reply[], moves: readonly NodeMove[], now: number, opts: { writeSame?: boolean; view?: BoardView } = {}): MovePlan {
  if (load === null || load.state === 'unreadable') return { ok: false, why: 'blocked' };
  const live = liveRefs(replies);
  const usable = moves.filter((m) => live.has(m.ref) && Number.isFinite(m.x) && Number.isFinite(m.y));
  if (usable.length === 0) return { ok: false, why: 'notCard' };
  const at = new Map(hexLayout(replies, load.board).map((p) => [p.id, p]));
  const frozen = load.board.nodes.some((n) => live.has(n.ref));
  const same =
    !opts.writeSame &&
    usable.every((m) => {
      const p = at.get(m.ref);
      return p !== undefined && (p.saved || !frozen) && p.x === cleanCoord(m.x) && p.y === cleanCoord(m.y);
    });
  if (same) return { ok: true, board: load.board, changed: false };
  const base = load.state === 'missing' && opts.view ? { ...load.board, view: clampView(opts.view) } : load.board;
  const board = moveNodes(freezeHexBoard(base, replies, now), usable, now, live, { raise: true });
  return { ok: true, board, changed: board !== load.board };
}

// ---------- 重なり・点・範囲選択 ----------

// 二枚の六角（箱の左上 a・b）が重なるか：同じ向きの正六角は、中心の差 d が「幅 2W の同じ向きの正六角」の内側（max|d·n| < W − 1e-6）にあるとき重なる。
//   隙間は足さない。辺が接するだけなら重ならない（仮の並びの隣どうしは重ならない）
export function hexesOverlap(a: Pt, b: Pt): boolean {
  return hexReach(b.x - a.x, b.y - a.y) < HEX.w - 1e-6;
}

// 二枚の六角（箱の左上 a・b）の重なりの深さ（W − 六角の距離）。重ならなければ 0 以下。型の中の重なりを見る（memo-card-board-spots.ts の offsetsOverlap。TA1）
export function hexDepth(a: Pt, b: Pt): number {
  return HEX.w - hexReach(b.x - a.x, b.y - a.y);
}

// 右クリックで、縁のすぐ外をそのカードの上と数える幅（ボードの座標。仮の並びのすき間 16 の半分＋1。TA4a。左クリックは今のまま多角形だけ）
export const HEX_NEAR = 9;

// 点 p（ボードの座標）の、六角（箱の左上 at）の縁から外への離れ（多角形の中心からの六角の距離 − 75）。中は 0 以下（中心は −75）
export function hexOutside(at: Pt, p: Pt): number {
  return hexReach(p.x - (at.x + HEX_CENTER.x), p.y - (at.y + HEX_CENTER.y)) - HEX.w / 2;
}

// 点 p（ボードの座標）が六角（箱の左上 at）の中か。縁の上も中に数える
export function pointInHex(at: Pt, p: Pt): boolean {
  return hexReach(p.x - (at.x + HEX_CENTER.x), p.y - (at.y + HEX_CENTER.y)) <= HEX.w / 2 + 1e-9;
}

// ボードの座標の四角 rect が、六角（箱の左上 at）に少しでも掛かるか（範囲選択）。辺が接するだけなら掛からない（四角のカードと同じ）
//   分ける軸で調べる：x（四角と六角の縦の辺の法線）・y（四角の横の辺）・六角の斜めの辺の二つの法線。どの軸でも射影が重なれば掛かる
export function hexHitsRect(rect: Rect, at: Pt): boolean {
  const cx = at.x + HEX_CENTER.x;
  const cy = at.y + HEX_CENTER.y;
  const x0 = rect.x;
  const x1 = rect.x + rect.w;
  const y0 = rect.y;
  const y1 = rect.y + rect.h;
  const half = HEX.w / 2;
  const tall = HEX.h / 2;
  if (!(cx - half < x1 && cx + half > x0)) return false;
  if (!(cy - tall < y1 && cy + tall > y0)) return false;
  for (const [nx, ny] of NORMALS.slice(1)) {
    const ends = [x0 * nx + y0 * ny, x1 * nx + y0 * ny, x0 * nx + y1 * ny, x1 * nx + y1 * ny];
    const lo = Math.min(...ends);
    const hi = Math.max(...ends);
    const c = cx * nx + cy * ny;
    if (!(c - half < hi && c + half > lo)) return false;
  }
  return true;
}

// ---------- 線 ----------

// 中心から向き (ux, uy)（長さ 1）に進んで、六角の縁に当たるまでの長さ：(W/2) ÷ max|u·n|
export function hexEdgeReach(ux: number, uy: number): number {
  return HEX.w / 2 / Math.max(1e-9, hexReach(ux, uy));
}

export interface HexLineEnds {
  p: Pt; // a の縁の上の点
  q: Pt; // b の縁の上の点
  length: number; // 縁から縁の長さ（中心どうしの線の上で）
  ux: number; // 中心 a から b への向き（長さ 1）
  uy: number;
}

// 六角 a から b（箱の左上）への線の端：中心どうしを結ぶ線を、それぞれの縁で切る。重なっている・接している（縁から縁の長さが無い）ときは null
export function hexLineEnds(a: Pt, b: Pt): HexLineEnds | null {
  const ca = { x: a.x + HEX_CENTER.x, y: a.y + HEX_CENTER.y };
  const cb = { x: b.x + HEX_CENTER.x, y: b.y + HEX_CENTER.y };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  const r = hexEdgeReach(ux, uy);
  const length = dist - 2 * r;
  if (!(length > 1e-9)) return null;
  return { p: { x: ca.x + ux * r, y: ca.y + uy * r }, q: { x: cb.x - ux * r, y: cb.y - uy * r }, length, ux, uy };
}

// 六角 a から b への線の形。縁から縁が HEX_BAND_UNDER（14）以上なら、四角と同じ曲げ方の曲線（矢じりは呼ぶ側）。
//   短ければ、曲線と矢じりをやめて、向き合う二つの辺のあいだに短い色の帯（band＝太さ。縁から縁の長さより 2 細く、向き合う辺どうしの隙間 g＝max|d·n|−W を超えない。
//   ただし 1 より細くはしない〈g が 1 より狭いときは g を超える〉。上限 10）。描かないときは null
//   帯の向き：中心の差との内積の絶対値が最大の法線 n*（向き合う辺の法線）に直交させる（向き合う辺と平行。ずれた隣どうしでも顔に食い込まない）。
//   置く所：二つの辺のちょうど真ん中の線の上。長さは、二つの辺（長さ W/√3）の重なる区間と上限（辺の 7 割）の短い方で、重なる区間の真ん中に置く。
//   重なる区間が無い・BAND_MIN（6）より短いときは長さ 6 で、二つの辺の近い端どうしの真ん中に置く
export function hexEdgeGeometry(a: Pt, b: Pt): EdgeGeometry | null {
  const ends = hexLineEnds(a, b);
  if (!ends) return null;
  if (ends.length >= HEX_BAND_UNDER) return curveGeometry(ends.p, ends.q);
  const ca = { x: a.x + HEX_CENTER.x, y: a.y + HEX_CENTER.y };
  const cb = { x: b.x + HEX_CENTER.x, y: b.y + HEX_CENTER.y };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  let face = NORMALS[0];
  let reach = -Infinity;
  for (const n of NORMALS) {
    const v = Math.abs(dx * n[0] + dy * n[1]);
    if (v > reach) {
      reach = v;
      face = n;
    }
  }
  const sign = dx * face[0] + dy * face[1] >= 0 ? 1 : -1;
  const nx = face[0] * sign; // a から b へ向く、向き合う辺の法線
  const ny = face[1] * sign;
  const tx = -ny; // 辺の向き
  const ty = nx;
  const ta = ca.x * tx + ca.y * ty;
  const tb = cb.x * tx + cb.y * ty;
  const lo = Math.max(ta - SIDE_HALF, tb - SIDE_HALF);
  const hi = Math.min(ta + SIDE_HALF, tb + SIDE_HALF);
  const len = Math.max(BAND_MIN, Math.min(2 * BAND_HALF, hi - lo));
  const mt = (lo + hi) / 2; // 重なる区間の真ん中（重ならなければ、近い端どうしの真ん中）
  const mn = (ca.x * nx + ca.y * ny + cb.x * nx + cb.y * ny) / 2; // 二つの辺の真ん中
  const at = (t: number) => ({ x: mn * nx + t * tx, y: mn * ny + t * ty });
  const p1 = at(mt - len / 2);
  const p2 = at(mt + len / 2);
  const m = at(mt);
  const f = (p: Pt) => `${round1(p.x)},${round1(p.y)}`;
  const gap = reach - HEX.w; // 向き合う辺どうしの隙間（縁から縁の長さは、中心どうしの線の上で測るので、ずれた隣ではこれより長い）
  return { d: `M${f(p1)} L${f(p2)}`, mid: { x: round1(m.x), y: round1(m.y) }, band: round1(Math.min(10, Math.max(1, Math.min(ends.length - 2, gap)))) };
}

// ---------- 見ている位置（開いたとき・出したとき・「100%」。HX1 の決まりに六角の読む箱を渡す） ----------

// 読む箱：箱全体（150×174。三角まで丸ごと。答え 3）
export const hexReadBox: ReadBox = (at) => ({ x: at.x, y: at.y, w: HEX.w, h: HEX.boxH });

// 真ん中の文の帯（箱の y＋43.3〜y＋129.9）。どれも入らない面（146・88）で見せる所
export const hexBandBox = (at: Pt): Rect => ({ x: at.x, y: at.y + HEX.tri, w: HEX.w, h: HEX.h / 2 });

// 足したあと・面の外で離したあとに滑らせる目当て（tab の slideToRead。HX5）：箱（150×174）がその倍率で面に入れば箱。
//   入らなければ（箱の高さ×倍率 ＞ 面の高さ − 2×READ_PAD）真ん中の文の帯。箱の上の端に合わせると、低い面（132 より低い）では帯が半分しか見えず、
//   Ctrl+Enter で足すたびに見ている位置が縦に動くため。帯も入らない面では、帯の上の端を縁に合わせる（viewToRead）
export function hexSlideBox(at: Pt, zoom: number, viewport: Viewport): Rect {
  return HEX.boxH * zoom > viewport.h - 2 * READ_PAD + 1e-6 ? hexBandBox(at) : hexReadBox(at);
}

// 六角の最後に書いた辺り（決まり 3・4。四角の recentView の代わり）
//   3：最後に書いたカードの箱を縦の目当てにする。横に足すのは、同じ行（箱の上端の差の絶対値が HEX.tri〈43.3〉より小さい）のカードのうち、
//      その倍率と寄せ方で縦が丸ごと読める（箱が余白 2 で面に入る）ものだけ。横に近い順に、面の幅に入るだけ足す（倍率は zooms の順。既定 1.0→0.85）。
//      ほかの行のカードは数えない（読めれば見えるだけ）。仮の並びでは、すぐ前に書いたカードが同じ行の隣にある。隣の行のカードが横 83 の近さで先に幅を取ると、
//      すぐ前のカードが落ちるため。HX5 の自由な位置でも、同じ行は同じ決め方で見る。
//      上の区画では目当てを面の上の端に寄せ（入るなら余白 4、入らないなら 2）、下の置き場では真ん中に置く。横は足したカードの幅の真ん中
//   4：どれも入らないとき（面 146・88 など）、最後に書いたカードの真ん中の文の帯を倍率 1.0（fallbackZoom）で真ん中に置く
//   n は、その位置で丸ごと読めるカードの数（ほかの行のカードも数える。決まり 4 では 0）。描くカードが無ければ null
export function hexRecentView(replies: readonly Reply[], faces: readonly Placed[], viewport: Viewport, opts: RecentOpts): RecentView | null {
  const readBox = opts.readBox ?? hexReadBox;
  const last = lastWritten(replies, faces);
  if (!last) return null;
  const target = readBox(last);
  const align = opts.place === 'upper' ? 'top' : 'center';
  const mid = (r: Rect) => r.x + r.w / 2;
  const row = faces
    .filter((f) => f.id !== last.id)
    .map((f) => readBox(f))
    .filter((b) => Math.abs(b.y - target.y) < HEX.tri) // 同じ行だけ
    .sort((a, b) => Math.abs(mid(a) - mid(target)) - Math.abs(mid(b) - mid(target)));
  for (const zoom of opts.zooms ?? OPEN_ZOOMS) {
    // 縦の寄せ方は目当てだけで決まる（横に足しても変わらない）：その位置で、縦が丸ごと読める箱だけを足す
    const vy = placeBox(target, zoom, viewport, align).y;
    const near = row.filter((b) => b.y * zoom + vy >= READ_PAD - 1e-6 && (b.y + b.h) * zoom + vy <= viewport.h - READ_PAD + 1e-6);
    let x0 = target.x;
    let x1 = target.x + target.w;
    for (const b of near) {
      const nx0 = Math.min(x0, b.x);
      const nx1 = Math.max(x1, b.x + b.w);
      if ((nx1 - nx0) * zoom <= viewport.w - 2 * READ_PAD + 1e-6) {
        x0 = nx0;
        x1 = nx1;
      }
    }
    const view = placeBox({ x: x0, y: target.y, w: x1 - x0, h: target.h }, zoom, viewport, align);
    if (!boxReadable(view, target, viewport)) continue;
    return { view, rule: 3, n: faces.filter((f) => boxReadable(view, readBox(f), viewport)).length };
  }
  return { view: placeBox(hexBandBox(last), opts.fallbackZoom ?? 1, viewport, 'center'), rule: 4, n: 0 };
}

// ---------- 選ぶ・メニュー ----------

// Shift＋矢印：↑↓ の横の重みを 0.5 に（仮の並びで隣の行を飛ばさない）。同点なら ↓ は右下・↑ は左上を先に（↓↑ で元へ戻る）。←→ は今のまま
export const HEX_NEAREST: Readonly<NearestOpts> = { verticalSide: 0.5, diagonalTie: true };

// メニュー・📌・［移る］の出し口：右の縦の辺の上の端（箱の x＋150, y＋43.3）
export const hexMenuAnchor = (at: Pt): Pt => ({ x: at.x + HEX.w, y: at.y + HEX.tri });

// ---------- 顔の三角の字 ----------

export interface HexFaceInfo {
  marks: string[]; // 上の三角（日時は出さない。2026-11-09 の利用者の依頼）：❝（引用）・💬n（返信）・🔗n（つながる線）・✎（書き直した）の順。入らなければ後ろから落とす（描く側の CSS）
  tag: string; // 下の三角：タグを 1 つ（AI のカード・題のある写真のカードは空）
  more: number; // 下の三角：「+n」（残りのタグの数。AI のカード・題のある写真のカードはタグ全部を数える）
  who: string; // 下の三角：AI のカードの書き手の名前（人のカードは空）
  title: string; // 下の三角：写真だけのカード（引用の無い画像）の題（CB7 で付ける題。文の最初の行）。無ければ空
}

// 描いている線を、カードごとに数える（両端のカードにそれぞれ 1。上の三角の 🔗n）
export function linkCounts(links: readonly DrawLink[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of links) {
    out.set(l.from, (out.get(l.from) ?? 0) + 1);
    out.set(l.to, (out.get(l.to) ?? 0) + 1);
  }
  return out;
}

// 一枚の六角の、三角に出す字。links はそのカードにつながる描いている線の数。📷 は出さない（写真は真ん中の絵で分かる）
//   replied はそのカードの返信の数（何枚も作るときは replyCounts でまとめて数えて渡す。渡さなければ、ここで数える）
//   下の三角は、AI のカードなら書き手の名前、題のある写真だけのカードなら題、ほかはタグを 1 つ。名前・題を出すときは、タグを全部 +n に数える（機械タグは数えない）
export function hexFaceInfo(replies: readonly Reply[], reply: Reply, links: number, replied: number = replyCount(replies, reply.id)): HexFaceInfo {
  const marks: string[] = [];
  if (reply.quote) marks.push('❝');
  if (replied > 0) marks.push(`💬${replied}`);
  if (links > 0) marks.push(`🔗${links}`);
  if (reply.editedAt !== undefined) marks.push('✎');
  const tags = visibleTags(reply.tags ?? []);
  const who = reply.by ? reply.by.name.trim() || 'AI' : '';
  if (who) return { marks, tag: '', more: tags.length, who, title: '' };
  const photo = Boolean(reply.image) && !reply.quote;
  const title = photo ? (reply.text.split('\n').find((s) => s.trim() !== '')?.trim() ?? '') : '';
  if (title) return { marks, tag: '', more: tags.length, who: '', title };
  return { marks, tag: tags[0] ?? '', more: Math.max(0, tags.length - 1), who: '', title: '' };
}

// 描いているカードごとの三角の字（六角のときだけ作る。顔を描くのと、描き直しの鍵に使う：✎ などは顔の文だけでは替わらないため）
//   描き直すたびに作るので、返信の数は全部のカードについて一回でまとめて数える（カードごとに全部の返信をなめない）
export function hexFaceInfos(replies: readonly Reply[], faces: readonly { id: string }[], links: readonly DrawLink[]): Map<string, HexFaceInfo> {
  const byId = new Map(replies.map((r) => [r.id, r]));
  const counts = linkCounts(links);
  const replied = replyCounts(replies, faces.map((f) => f.id));
  const out = new Map<string, HexFaceInfo>();
  for (const f of faces) {
    const reply = byId.get(f.id);
    if (reply) out.set(f.id, hexFaceInfo(replies, reply, counts.get(f.id) ?? 0, replied.get(f.id) ?? 0));
  }
  return out;
}
