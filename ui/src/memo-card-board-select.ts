// ボードのカードの選択・範囲選択・まとめて動かす計算（B2-2。DOM も保存も使わない。ui/test/memo-card-board-select.test.ts）
//   選ぶ：クリック＝その 1 枚だけ／Shift クリック＝足す・外す／空きをクリック＝全部外す／Ctrl+A＝全部
//   範囲選択：Shift を押しながら空きをドラッグ（今の選択に、四角に掛かるカードを足す）
//   まとめて動かす：選んだカードのどれかをつまむと、選んだ全部が同じ量だけ動く（選んでいないカードをつまんだら、そのカードだけ選んで動かす）
//   描く・保存するのは app/memo-board-tab.ts（保存は 1 回にまとめる：memo-card-board-view.ts の planMoves）
import { t } from './i18n';
import { BOARD_CARD, BOARD_LIMITS, type BoardView, panBy, type Rect, screenDeltaToBoard, screenToBoard } from './memo-card-board';

export type Selection = ReadonlySet<string>;

export interface Pt {
  x: number;
  y: number;
}

export interface PressResult {
  selection: Set<string>; // 押した直後の選び方
  drag: string[]; // つまんで動かすカード（空＝動かさない）
  collapse: boolean; // 動かさずに離したら、押したカード 1 枚だけの選択にする（複数を選んでいるところの 1 枚を、ただクリックしたとき）
}

// カードを押した：Shift ならその 1 枚を足す・外す（動かさない）。選んでいるカードなら選びはそのまま（全部を動かす）。選んでいないカードならそれだけを選ぶ
export function pressSelect(sel: Selection, ref: string, shift: boolean): PressResult {
  if (shift) {
    const next = new Set(sel);
    if (!next.delete(ref)) next.add(ref);
    return { selection: next, drag: [], collapse: false };
  }
  if (sel.has(ref)) return { selection: new Set(sel), drag: [...sel], collapse: sel.size > 1 };
  return { selection: new Set([ref]), drag: [ref], collapse: false };
}

export const selectAll = (refs: Iterable<string>): Set<string> => new Set(refs);

export function sameSelection(a: Selection, b: Selection): boolean {
  if (a.size !== b.size) return false;
  for (const r of a) if (!b.has(r)) return false;
  return true;
}

// 描かれているカードだけ残す（消えたカードを選んだままにしない）。減らなければ同じ集まりを返す
export function pruneSelection(sel: Selection, live: ReadonlySet<string>): Selection {
  let all = true;
  for (const r of sel) if (!live.has(r)) all = false;
  return all ? sel : new Set([...sel].filter((r) => live.has(r)));
}

// ---------- 範囲選択（Shift＋空きのドラッグ） ----------

// 面の中の 2 点から、向きによらない四角
export function marqueeRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

// 四角（面の画素）に少しでも掛かるカード。cards は id → 左上のボード座標。a・b は面の左上からの画素
//   hit を渡すと、ボードの座標の四角とカードの左上で当たりを決める（六角は多角形で当てる。HX4）。無ければ箱（size）で当てる
export function marqueeHits(view: BoardView, a: Pt, b: Pt, cards: ReadonlyMap<string, Pt>, size: { w: number; h: number } = BOARD_CARD, hit?: (rect: Rect, at: Pt) => boolean): string[] {
  const r = marqueeRect(a, b);
  const p0 = screenToBoard(view, r.x, r.y);
  const p1 = screenToBoard(view, r.x + r.w, r.y + r.h);
  const board = { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y };
  const out: string[] = [];
  for (const [id, c] of cards) {
    if (hit ? hit(board, c) : c.x < p1.x && c.x + size.w > p0.x && c.y < p1.y && c.y + size.h > p0.y) out.push(id);
  }
  return out;
}

// 範囲選択の途中・結果：始めたときの選択に、四角のカードを足す
export const marqueeSelection = (base: Selection, hits: readonly string[]): Set<string> => new Set([...base, ...hits]);

// ---------- まとめて動かす ----------

const clampTo = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// つまんで動かしている最中の、全部のカードの位置。動かす量は 1 つ（画面の画素 → ボードの量 → 整数）。どれかが ±10,000 の端に着いたら、
// そこで全体が止まる（並びの形は崩れない）。1 枚だけのときは dragPosition（memo-card-board-view.ts）と同じ値
export function groupDragPositions(starts: ReadonlyMap<string, Pt>, delta: { dx: number; dy: number }, view: BoardView): Map<string, Pt> {
  return groupDragBy(starts, screenDeltaToBoard(view, delta.dx, delta.dy));
}

// 全部のカードを、ボードの量 d だけ動かした位置（groupDragPositions と同じ丸めと止め方。端で見る位置が動くときは dragBoardDelta の値を渡す。HX3）
export function groupDragBy(starts: ReadonlyMap<string, Pt>, d: Pt): Map<string, Pt> {
  const lim = BOARD_LIMITS.coord;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of starts.values()) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const out = new Map<string, Pt>();
  if (starts.size === 0) return out;
  const dx = clampTo(Math.round(d.x) || 0, -lim - minX, lim - maxX);
  const dy = clampTo(Math.round(d.y) || 0, -lim - minY, lim - maxY);
  for (const [id, p] of starts) out.set(id, { x: p.x + dx, y: p.y + dy });
  return out;
}

// ---------- つまんだまま面の端へ（HX3。形に頼らない：点と面の大きさと見ている位置だけで決める） ----------
//   点は面の左上からの画素。見ている位置に足す量は panBy にそのまま渡す（正＝面が右・下へ動き、左・上の先が見える）

export const EDGE_BAND_PX = 24; // 端の帯の幅の上限（画面の画素）
export const EDGE_ARM_PX = 24; // 帯の中で押したとき、押した所から帯の向きへこれだけ動けば始める
export const EDGE_SPEED_MIN = 2; // 1 こま（EDGE_FRAME_MS）に動かす量（画面の画素）：帯に入ったばかり
export const EDGE_SPEED_MAX = 18; // 帯の奥（面の縁）と面の外
export const EDGE_FRAME_MS = 16.7; // 1 こまとみなす時間。速さは時刻で決める（画面のこま数で変わらない）
export const EDGE_DT_MAX = 50; // こまが落ちたとき、一度に進める時間の上限

// 端の帯の幅：左右は 24px、上下は min(24, 面の高さ × 0.15)（低い面で帯が面を埋めないように）。どちらも面の大きさの半分まで（左右・上下の帯が重ならない）
export function edgeBand(viewport: { w: number; h: number }): { x: number; y: number } {
  const w = Math.max(0, viewport.w);
  const h = Math.max(0, viewport.h);
  return { x: Math.min(EDGE_BAND_PX, w / 2), y: Math.min(EDGE_BAND_PX, h * 0.15, h / 2) };
}

// 帯に入った深さ（0〜1。1＝面の縁）から、1 こまに動かす量。帯の外は 0、縁と面の外は EDGE_SPEED_MAX
export function edgeSpeed(depth: number): number {
  if (!(depth > 0)) return 0;
  return EDGE_SPEED_MIN + (EDGE_SPEED_MAX - EDGE_SPEED_MIN) * Math.min(1, depth);
}

// 一つの向き（横か縦）で、点がどちらの帯にどれだけ入っているか（−1〜1。負＝左・上の帯、正＝右・下の帯、帯の外は 0。面の外は ±1）
function axisDepth(pos: number, size: number, band: number): number {
  if (pos < 0) return -1;
  if (pos > size) return 1;
  if (!(band > 0)) return 0;
  if (pos < band) return -(band - pos) / band;
  if (pos > size - band) return (pos - (size - band)) / band;
  return 0;
}

// 点が面の中ほど（どの帯にも入っていない）にあるか。押してから一度でもここにいたら、帯に入ったときに動き始めてよい。面に大きさが無ければ false
export function innerPoint(p: Pt, viewport: { w: number; h: number }): boolean {
  if (!(viewport.w > 0) || !(viewport.h > 0)) return false;
  const band = edgeBand(viewport);
  return axisDepth(p.x, viewport.w, band.x) === 0 && axisDepth(p.y, viewport.h, band.y) === 0;
}

// 押してから中ほどにいたかの印を、今の指の点で進める（一度立てば、つまみ終えるまで立ったまま）
export const nextInner = (inner: boolean, p: Pt, viewport: { w: number; h: number }): boolean => inner || innerPoint(p, viewport);

// つまんでいる指が端の帯にあるとき、1 こまに見ている位置へ足す量（倍率は変えない）。向きごとに、次のどれかのときだけ動かす
//   ・押してから一度でも面の中ほどにいた（inner）・押した所（start）から帯の向きへ EDGE_ARM_PX 以上動いた・面の外へ出た（出た向きへ）
//   帯の中で押して少し動かしただけでは動かさない。帯は 24px までなので、同じ向きの帯の中から 24px 動けば面の縁か外にいる（効くのは、ほかの向きの帯で押したとき）
//   面に大きさが無ければ動かさない
export function edgePan(p: Pt, start: Pt, inner: boolean, viewport: { w: number; h: number }): { dx: number; dy: number } {
  if (!(viewport.w > 0) || !(viewport.h > 0)) return { dx: 0, dy: 0 };
  const band = edgeBand(viewport);
  const axis = (pos: number, from: number, size: number, b: number) => {
    const depth = axisDepth(pos, size, b);
    if (depth === 0) return 0;
    const outside = pos < 0 || pos > size;
    const toward = Math.sign(pos - from) === Math.sign(depth) && Math.abs(pos - from) >= EDGE_ARM_PX;
    if (!inner && !outside && !toward) return 0;
    return -Math.sign(depth) * edgeSpeed(Math.abs(depth));
  };
  return { dx: axis(p.x, start.x, viewport.w, band.x) || 0, dy: axis(p.y, start.y, viewport.h, band.y) || 0 };
}

// つまんでいる指の下のボードの点が、押した時からどれだけ動いたか（ボードの量）。見ている位置が動いても、カードが指から離れない
//   押した点は押した時の見ている位置（view0）で、今の指の点は今の見ている位置（view）で、それぞれボードの座標に直して差を取る
export function dragBoardDelta(start: Pt, view0: BoardView, p: Pt, view: BoardView): Pt {
  const a = screenToBoard(view0, start.x, start.y);
  const b = screenToBoard(view, p.x, p.y);
  return { x: b.x - a.x, y: b.y - a.y };
}

// このこまに動かす量（画面の画素。整数）：edgePan の量（1 こまぶん）を、前のこまからの時間 dt に合わせて伸び縮みさせる（dt は EDGE_DT_MAX まで）
//   動く向きでは最低 1px（こまの多い画面で、端数に丸められて止まらないように）
export function edgeFrameMove(step: { dx: number; dy: number }, dt: number): Pt {
  const k = Math.min(Math.max(0, Number.isFinite(dt) ? dt : 0), EDGE_DT_MAX) / EDGE_FRAME_MS;
  const one = (v: number) => (v === 0 || k === 0 ? 0 : Math.sign(v) * Math.max(1, Math.round(Math.abs(v) * k)));
  return { x: one(step.dx), y: one(step.dy) };
}

// 1 こまで見ている位置を動かしたあとの位置。つまんだ全部の外枠が ±10,000（カードの範囲）を超える向きと、見ている位置が範囲の端で動けない向きは動かさない
//   （カードが範囲の端で止まっても面だけが動き続けて、指から離れないように）。どの向きも動かなければ null（次のこまを頼まない）
export function edgePanStep(view: BoardView, move: Pt, drag: { starts: ReadonlyMap<string, Pt>; start: Pt; view0: BoardView }, p: Pt): BoardView | null {
  const lim = BOARD_LIMITS.coord;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of drag.starts.values()) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x);
    minY = Math.min(minY, s.y);
    maxY = Math.max(maxY, s.y);
  }
  const within = (next: BoardView) => {
    const d = dragBoardDelta(drag.start, drag.view0, p, next);
    const sx = Math.round(d.x) || 0;
    const sy = Math.round(d.y) || 0;
    return { x: minX + sx >= -lim && maxX + sx <= lim, y: minY + sy >= -lim && maxY + sy <= lim };
  };
  const dx = move.x !== 0 && within(panBy(view, move.x, 0)).x ? move.x : 0;
  const dy = move.y !== 0 && within(panBy(view, 0, move.y)).y ? move.y : 0;
  if (dx === 0 && dy === 0) return null;
  const next = panBy(view, dx, dy);
  return next.x === view.x && next.y === view.y ? null : next;
}

// つまむのを取り消したときに戻すもの：動かしていればカードを押した時の位置へ、端で見ている位置が動いていれば押した時の見ている位置へ（見ている位置は保存しない）
export function dragCancelPlan(drag: { moved: boolean; panned: boolean; starts: ReadonlyMap<string, Pt>; view0: BoardView }): { positions: ReadonlyMap<string, Pt> | null; view: BoardView | null } {
  return { positions: drag.moved ? drag.starts : null, view: drag.panned ? { ...drag.view0 } : null };
}

// ---------- 表示 ----------

// 「7枚」「7枚（3枚を選択中）」。カードが無ければ空
export function selectionCountText(total: number, selected: number): string {
  if (total <= 0) return '';
  return selected > 0 ? t('{0}枚（{1}枚を選択中）', { 0: total, 1: selected }) : t('{0}枚', { 0: total });
}

// ---------- 隣のカード（Shift＋矢印で移る先・選びが無いときの起点） ----------

export type BoardDir = 'left' | 'right' | 'up' | 'down';

export const BOARD_ARROW_DIR: Readonly<Record<string, BoardDir>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

// 隣のカードの選び方の形ごとの違い（HX4）。verticalSide：↑↓ の横の差の重み（既定 2）。diagonalTie：点が同じなら ↓ は右下・↑ は左上を先にする（既定は pos の順）
export interface NearestOpts {
  verticalSide?: number;
  diagonalTie?: boolean;
}

// from のカードから向き dir の隣のカード。進む向きの差 main（0 より大きいこと）と横の差 side（side ≤ main × 2 の真横に近いこと）の中で、main + side × 2 が一番小さいもの。
// 同じなら pos の順で先のもの。候補が無ければ null（端では動かない。回り込まない）
//   opts で ↑↓ の横の重みと、同点の決め方を替えられる（六角は重み 0.5・↓ は右下・↑ は左上。HX4）。←→ はいつも重み 2
export function nearestInDirection(from: string, pos: ReadonlyMap<string, Pt>, dir: BoardDir, opts: NearestOpts = {}): string | null {
  const f = pos.get(from);
  if (!f) return null;
  const vertical = dir === 'up' || dir === 'down';
  const weight = vertical ? (opts.verticalSide ?? 2) : 2;
  let best: string | null = null;
  let bestScore = Infinity;
  let bestDx = 0;
  for (const [id, p] of pos) {
    if (id === from) continue;
    let main: number;
    let side: number;
    switch (dir) {
      case 'right':
        main = p.x - f.x;
        side = Math.abs(p.y - f.y);
        break;
      case 'left':
        main = f.x - p.x;
        side = Math.abs(p.y - f.y);
        break;
      case 'down':
        main = p.y - f.y;
        side = Math.abs(p.x - f.x);
        break;
      case 'up':
        main = f.y - p.y;
        side = Math.abs(p.x - f.x);
        break;
    }
    if (main <= 0) continue;
    if (side > main * 2) continue;
    const score = main + side * weight;
    const dx = p.x - f.x;
    // 同点：↓ は右（dx が大きい方）・↑ は左（dx が小さい方）を先に（diagonalTie のときだけ。点は整数の位置から作るので、同点は等しさで見てよい）
    const tieWins = opts.diagonalTie === true && vertical && score === bestScore && (dir === 'down' ? dx > bestDx : dx < bestDx);
    if (score < bestScore || tieWins) {
      bestScore = score;
      best = id;
      bestDx = dx;
    }
  }
  return best;
}

// 点 p（ボードの座標）のすぐ近くのカード（TA4a。空きの右クリックで、縁のすぐ外をそのカードに数える）：縁から外への離れ（outside。中は 0 以下）が
//   near 以下のカードのうち、離れがいちばん小さいもの。同じなら pos の順で先のもの。無ければ null。outside と near は形ごとの口（geo）
export function cardNear(pos: ReadonlyMap<string, Pt>, p: Pt, outside: (at: Pt, p: Pt) => number, near: number): string | null {
  let best: string | null = null;
  let bestOut = Infinity;
  for (const [id, at] of pos) {
    const d = outside(at, p);
    if (d <= near && d < bestOut) {
      bestOut = d;
      best = id;
    }
  }
  return best;
}

// ---------- 空きのダブルクリック（TA7。空きを押して動かさずに離した回を数える。dblclick は使わない） ----------

export const EMPTY_TAP_PX = 8; // 2 回の押しが、画面でこれより離れていたら、別の押し（ダブルクリックにしない）

export interface EmptyTap {
  x: number; // 画面の点（clientX・clientY）
  y: number;
  t: number; // 時刻（ミリ秒）
}

// prev：前の空きのクリック（無ければ null）。now：今のクリック。ms の内（同じ長さを含む。カードのダブルクリックと同じ数え方）・px の内なら、ダブルクリック（覚えは空にする：
//   3 回目を、次のダブルクリックの 2 回目にしない）。そうでなければ、今のクリックを 1 回目として覚える（離れた所・間の空いた 2 回目は、次の 1 回目になる）
export function emptyTap(prev: EmptyTap | null, now: EmptyTap, ms: number, px: number = EMPTY_TAP_PX): { double: boolean; next: EmptyTap | null } {
  const dt = prev === null ? Infinity : now.t - prev.t;
  const double = prev !== null && dt >= 0 && dt <= ms && Math.hypot(now.x - prev.x, now.y - prev.y) <= px;
  return double ? { double: true, next: null } : { double: false, next: now };
}

// 見えている面の真ん中に一番近いカード（中心どうしの距離）。同じなら pos の順で先のもの。カードが無ければ null
//   center はカードの左上から中心までの量（既定は四角の箱の真ん中。六角は多角形の中心。HX4）
export function centerMostCard(pos: ReadonlyMap<string, Pt>, view: BoardView, viewport: { w: number; h: number }, center: Pt = { x: BOARD_CARD.w / 2, y: BOARD_CARD.h / 2 }): string | null {
  if (pos.size === 0) return null;
  const c = screenToBoard(view, viewport.w / 2, viewport.h / 2);
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [id, p] of pos) {
    const d = Math.hypot(p.x + center.x - c.x, p.y + center.y - c.y);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}