// ボードのカードの選択・範囲選択・まとめて動かす計算（B2-2。DOM も保存も使わない。ui/test/memo-card-board-select.test.ts）
//   選ぶ：クリック＝その 1 枚だけ／Shift クリック＝足す・外す／空きをクリック＝全部外す／Ctrl+A＝全部
//   範囲選択：Shift を押しながら空きをドラッグ（今の選択に、四角に掛かるカードを足す）
//   まとめて動かす：選んだカードのどれかをつまむと、選んだ全部が同じ量だけ動く（選んでいないカードをつまんだら、そのカードだけ選んで動かす）
//   描く・保存するのは app/memo-board-tab.ts（保存は 1 回にまとめる：memo-card-board-view.ts の planMoves）
import { BOARD_CARD, BOARD_LIMITS, type BoardView, type Rect, screenDeltaToBoard, screenToBoard } from './memo-card-board';

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
export function marqueeHits(view: BoardView, a: Pt, b: Pt, cards: ReadonlyMap<string, Pt>, size: { w: number; h: number } = BOARD_CARD): string[] {
  const r = marqueeRect(a, b);
  const p0 = screenToBoard(view, r.x, r.y);
  const p1 = screenToBoard(view, r.x + r.w, r.y + r.h);
  const out: string[] = [];
  for (const [id, c] of cards) {
    if (c.x < p1.x && c.x + size.w > p0.x && c.y < p1.y && c.y + size.h > p0.y) out.push(id);
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
  const d = screenDeltaToBoard(view, delta.dx, delta.dy);
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

// ---------- 表示 ----------

// 「7枚」「7枚（3枚を選択中）」。カードが無ければ空
export function selectionCountText(total: number, selected: number): string {
  if (total <= 0) return '';
  return selected > 0 ? `${total}枚（${selected}枚を選択中）` : `${total}枚`;
}