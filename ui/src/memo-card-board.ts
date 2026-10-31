// 自由配置ボード（Track B）の計算（計画書 docs/plan-card-board.md の B1-1）
//   ・ここは DOM も保存も使わない（node だけで試せる。ui/test/memo-card-board.test.ts）。保存の道は B1-2、画面は B1-3 以降
//   ・案 2：ボードは「台帳カードへの参照（ref＝Reply.id）と座標」だけを持つ。文・タグ・線の写しは持たない
//     → ファイルの形（toBoardFile）は項目を 1 つずつ選んで作るので、機械タグ（宛て:・送った:・貼った:）を含む
//       カードの中身がファイルに入りようがない（試験で確かめる）
//   ・対象は台帳の一番上のカードだけ（返信の返信は描かない。孤児と同じ扱い）。台帳 Reply の形は変えない
//   ・動かしていないカードは「仮の位置」（3 列の番地を升目に写す）。保存するのは動かしたカードだけ
import { CARD_COLUMNS, MAX_REPLIES, orderedTops, type Reply, topSlots } from './threads';
import { TEMPLATE_GRID } from './memo-card-templates';

export const BOARD_FORMAT = 'honeycomb-board';
export const BOARD_VERSION = 1;

// カードの大きさ・隙間（QB4＝固定。型の TEMPLATE_GRID と同じ値を共有する：型の dx,dy の目安と合わせるため）
export const BOARD_CARD = { w: TEMPLATE_GRID.cardW, h: TEMPLATE_GRID.cardH, gap: TEMPLATE_GRID.gap } as const;

export const BOARD_LIMITS = {
  nodes: MAX_REPLIES, // 座標の数（300。QB9＝グリッドと共有）
  coord: 10_000, // カードの x・y の範囲（±。型の dx,dy と同じ）
  viewCoord: 20_000, // 見ている位置 view.x・view.y の範囲（±）
  zoomMin: 0.25,
  zoomMax: 2,
  refLength: 64, // ref・memoId の字数
  fileBytes: 200 * 1024, // ファイルの大きさ（これを超えたら読めない）
} as const;

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/; // data.ts・C++（storage.cpp の UiDataFile）の名前の 1 段に使える文字

// ---------- 保存先の名前（B1-2 が使う。名前の規則は data.ts・storage.cpp と同じ） ----------

export const BOARDS_FOLDER = 'boards';

export function boardFileName(memoId: string): string | null {
  return NAME_RE.test(memoId) ? `${BOARDS_FOLDER}/${memoId}.json` : null;
}

// 最初の書き込みの前に 1 回だけ作る控え（すでにファイルがあるときだけ）
export function boardBackupName(memoId: string): string | null {
  return NAME_RE.test(memoId) ? `${BOARDS_FOLDER}/${memoId}-before-v1.json` : null;
}

// ---------- 形 ----------

export interface BoardNode {
  ref: string; // 台帳カードの Reply.id
  x: number;
  y: number;
}

export interface BoardView {
  x: number; // ボードの原点（0,0）が面のどこにあるか（画面の画素。パンの量）
  y: number;
  zoom: number;
}

export interface Board {
  memoId: string;
  updatedAt: number;
  view: BoardView;
  nodes: BoardNode[];
}

export const DEFAULT_VIEW: Readonly<BoardView> = { x: 0, y: 0, zoom: 1 };

export function emptyBoard(memoId: string, now = 0): Board {
  return { memoId, updatedAt: now, view: { ...DEFAULT_VIEW }, nodes: [] };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const whole = (n: number) => Math.round(n) || 0; // -0 を 0 にする

export const cleanCoord = (n: number) => clamp(whole(n), -BOARD_LIMITS.coord, BOARD_LIMITS.coord);

export function clampView(view: BoardView): BoardView {
  const zoom = Number.isFinite(view.zoom) ? clamp(view.zoom, BOARD_LIMITS.zoomMin, BOARD_LIMITS.zoomMax) : 1;
  const pos = (n: number) => (Number.isFinite(n) ? clamp(whole(n), -BOARD_LIMITS.viewCoord, BOARD_LIMITS.viewCoord) : 0);
  return { x: pos(view.x), y: pos(view.y), zoom: Math.round(zoom * 1000) / 1000 };
}

// ---------- ファイルの検査と書き出し ----------

export type BoardRefusal = 'format' | 'version' | 'memo' | 'shape' | 'size';

export type ParseBoardResult =
  | { ok: true; board: Board; dropped: number } // dropped：捨てたノードの数（あれば、次の最初の書き込みの前に控えを作る）
  | { ok: false; why: BoardRefusal };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// 読んだ JSON を検査する。読めない（版が新しい・形が合わない・メモが違う・大きすぎる）ときは理由を返す
//   読める一部（悪いノードだけ）は捨てて ok にする。同じ ref は先のものを残す。x・y は整数に丸めて ±10,000 に収める
//   知らない項目は読み捨てる（同じ版の中では。足したいときは版を上げる）
export function parseBoard(raw: unknown, opts: { memoId: string }): ParseBoardResult {
  if (!isRecord(raw) || raw.format !== BOARD_FORMAT) return { ok: false, why: 'format' };
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > BOARD_VERSION) return { ok: false, why: 'version' };
  if (typeof raw.memoId !== 'string' || raw.memoId !== opts.memoId || !NAME_RE.test(raw.memoId)) return { ok: false, why: 'memo' };
  if (!Array.isArray(raw.nodes)) return { ok: false, why: 'shape' };
  try {
    if (byteLength(JSON.stringify(raw)) > BOARD_LIMITS.fileBytes) return { ok: false, why: 'size' };
  } catch {
    return { ok: false, why: 'shape' };
  }
  const seen = new Set<string>();
  const nodes: BoardNode[] = [];
  let dropped = 0;
  for (const item of raw.nodes) {
    const node = parseNode(item);
    if (!node || seen.has(node.ref) || nodes.length >= BOARD_LIMITS.nodes) {
      dropped += 1;
      continue;
    }
    seen.add(node.ref);
    nodes.push(node);
  }
  const view = isRecord(raw.view) ? clampView({ x: num(raw.view.x, 0), y: num(raw.view.y, 0), zoom: num(raw.view.zoom, 1) }) : { ...DEFAULT_VIEW };
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) && raw.updatedAt >= 0 ? Math.floor(raw.updatedAt) : 0;
  return { ok: true, board: { memoId: raw.memoId, updatedAt, view, nodes }, dropped };
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function parseNode(item: unknown): BoardNode | null {
  if (!isRecord(item)) return null;
  const { ref, x, y } = item;
  if (typeof ref !== 'string' || !NAME_RE.test(ref)) return null;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { ref, x: cleanCoord(x), y: cleanCoord(y) };
}

export interface BoardFile {
  format: typeof BOARD_FORMAT;
  version: typeof BOARD_VERSION;
  memoId: string;
  updatedAt: number;
  view: BoardView;
  nodes: BoardNode[];
}

// 保存する形。項目を 1 つずつ選んで作る（ボードの値にほかの項目〈文・タグなど〉が紛れ込んでも、ファイルには入らない）
export function toBoardFile(board: Board): BoardFile {
  return {
    format: BOARD_FORMAT,
    version: BOARD_VERSION,
    memoId: board.memoId,
    updatedAt: Math.max(0, Math.floor(board.updatedAt) || 0),
    view: clampView(board.view),
    nodes: board.nodes.filter((n) => NAME_RE.test(n.ref)).map((n) => ({ ref: n.ref, x: cleanCoord(n.x), y: cleanCoord(n.y) })),
  };
}

// 書く文字列。200 KB を超える・メモ id が名前に使えないときは null（書かない）
export function serializeBoard(board: Board): string | null {
  if (!NAME_RE.test(board.memoId)) return null;
  const text = JSON.stringify(toBoardFile(board), null, 1);
  return byteLength(text) > BOARD_LIMITS.fileBytes ? null : text;
}

// 300 件を超えるときの整理：台帳に無い ref（孤児）を古い順（先頭から）に捨て、それでも多ければ後ろから捨てる
//   live を渡さなければ、どれも生きているものとして後ろから捨てる
export function trimNodes(nodes: readonly BoardNode[], live?: ReadonlySet<string>, max: number = BOARD_LIMITS.nodes): BoardNode[] {
  if (nodes.length <= max) return nodes.slice();
  let excess = nodes.length - max;
  const drop = new Set<number>();
  if (live) {
    for (let i = 0; i < nodes.length && excess > 0; i++) {
      if (!live.has(nodes[i].ref)) {
        drop.add(i);
        excess -= 1;
      }
    }
  }
  for (let i = nodes.length - 1; i >= 0 && excess > 0; i--) {
    if (!drop.has(i)) {
      drop.add(i);
      excess -= 1;
    }
  }
  return nodes.filter((_, i) => !drop.has(i));
}

// ---------- ボードの更新（元は変えない） ----------

export interface NodeMove {
  ref: string;
  x: number;
  y: number;
}

// カードを動かした（離した）ときの座標を入れる。まだ無い ref は足す（仮の位置だったカードが保存される）。
//   形の悪い ref は無視する。x・y は整数・±10,000。300 件を超えるときは trimNodes（live があれば孤児から）
export function moveNodes(board: Board, moves: readonly NodeMove[], now: number, live?: ReadonlySet<string>): Board {
  const index = new Map(board.nodes.map((n, i) => [n.ref, i]));
  const nodes = board.nodes.map((n) => ({ ...n }));
  let changed = false;
  for (const m of moves) {
    if (!NAME_RE.test(m.ref) || !Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    const x = cleanCoord(m.x);
    const y = cleanCoord(m.y);
    const at = index.get(m.ref);
    if (at === undefined) {
      index.set(m.ref, nodes.length);
      nodes.push({ ref: m.ref, x, y });
      changed = true;
    } else if (nodes[at].x !== x || nodes[at].y !== y) {
      nodes[at] = { ref: m.ref, x, y };
      changed = true;
    }
  }
  if (!changed) return board;
  return { ...board, updatedAt: now, nodes: trimNodes(nodes, live) };
}

// 見ている位置を変える（clampView で収める）。変わらなければ同じ board を返す
export function setView(board: Board, view: BoardView, now: number): Board {
  const next = clampView(view);
  const cur = board.view;
  if (next.x === cur.x && next.y === cur.y && next.zoom === cur.zoom) return board;
  return { ...board, updatedAt: now, view: next };
}

// ---------- 孤児（台帳に無い・一番上でない ref） ----------

// 台帳の一番上のカードの id の集まり（ボードに描ける ref）
export function liveRefs(replies: readonly Reply[]): Set<string> {
  return new Set(replies.filter((r) => r.parent === null).map((r) => r.id));
}

export function splitNodes(board: Board, replies: readonly Reply[]): { live: BoardNode[]; orphans: BoardNode[] } {
  const ids = liveRefs(replies);
  const live: BoardNode[] = [];
  const orphans: BoardNode[] = [];
  for (const n of board.nodes) (ids.has(n.ref) ? live : orphans).push(n);
  return { live, orphans };
}

export const orphanCount = (board: Board, replies: readonly Reply[]) => splitNodes(board, replies).orphans.length;

// 孤児を消す（B4 の「整理」。利用者が押したときだけ）。孤児が無ければ同じ board を返す
export function pruneOrphans(board: Board, replies: readonly Reply[], now: number): Board {
  const { live, orphans } = splitNodes(board, replies);
  return orphans.length === 0 ? board : { ...board, updatedAt: now, nodes: live };
}

// ---------- 仮の並びと配置 ----------

// 番地（行 × 3 ＋ 列）を升目の左上へ（QB6：番地を 190×96＋隙間 20 の升目に写す）
export function slotPosition(slot: number): { x: number; y: number } {
  const s = Math.max(0, Math.floor(slot) || 0);
  return { x: (s % CARD_COLUMNS) * (BOARD_CARD.w + BOARD_CARD.gap), y: Math.floor(s / CARD_COLUMNS) * (BOARD_CARD.h + BOARD_CARD.gap) };
}

export interface BoardPlacement {
  id: string; // Reply.id
  x: number;
  y: number;
  saved: boolean; // true＝動かして保存した位置。false＝仮の位置（保存されていない）
}

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x < b.x + BOARD_CARD.w && b.x < a.x + BOARD_CARD.w && a.y < b.y + BOARD_CARD.h && b.y < a.y + BOARD_CARD.h;

const SEARCH_LIMIT = 4000; // 空きを探す番地の数（300 枚のカードがそれぞれ最大 4 升に掛かっても足りる）

// 一番上のカードの位置：保存したカードはその座標、そうでないカードは番地の升目（仮の位置）
//   仮の位置が、保存したカード（や先に決めた仮の位置）に重なるときは、重ならない最初の空きの升目へ仮にずらす
//   ずらした位置は保存しない（board は変えない）。順序は台帳の並び（orderedTops）
export function layoutCards(replies: readonly Reply[], board: Board | null): BoardPlacement[] {
  const saved = new Map<string, BoardNode>();
  for (const n of board?.nodes ?? []) if (!saved.has(n.ref)) saved.set(n.ref, n);
  const slots = topSlots(replies);
  const tops = orderedTops(replies);
  const taken: { x: number; y: number }[] = [];
  const out: BoardPlacement[] = [];
  for (const r of tops) {
    const node = saved.get(r.id);
    if (node) taken.push({ x: node.x, y: node.y });
  }
  for (const r of tops) {
    const node = saved.get(r.id);
    if (node) {
      out.push({ id: r.id, x: node.x, y: node.y, saved: true });
      continue;
    }
    const start = slots.get(r.id) ?? 0;
    let pos = slotPosition(start);
    for (let k = 1; k <= SEARCH_LIMIT && taken.some((t) => overlaps(pos, t)); k++) pos = slotPosition(start + k);
    taken.push(pos);
    out.push({ id: r.id, x: pos.x, y: pos.y, saved: false });
  }
  return out;
}

// ---------- 座標の変換・見ている位置 ----------
//   画面座標 = ボード座標 × zoom ＋ (view.x, view.y)

export function boardToScreen(view: BoardView, x: number, y: number): { x: number; y: number } {
  return { x: x * view.zoom + view.x, y: y * view.zoom + view.y };
}

export function screenToBoard(view: BoardView, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.x) / view.zoom, y: (sy - view.y) / view.zoom };
}

// 画面でつまんで動かした量（画面の画素）をボードの量へ（ドラッグでカードを動かすとき）
export function screenDeltaToBoard(view: BoardView, dx: number, dy: number): { x: number; y: number } {
  return { x: dx / view.zoom, y: dy / view.zoom };
}

export function panBy(view: BoardView, dx: number, dy: number): BoardView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy });
}

// 画面の点 (sx, sy)（ボードの面の左上からの画素）の下のボードの点を動かさずに、factor 倍にする
export function zoomAt(view: BoardView, factor: number, sx: number, sy: number): BoardView {
  if (!Number.isFinite(factor) || factor <= 0) return view;
  const zoom = clamp(view.zoom * factor, BOARD_LIMITS.zoomMin, BOARD_LIMITS.zoomMax);
  const f = zoom / view.zoom;
  return clampView({ x: sx - (sx - view.x) * f, y: sy - (sy - view.y) * f, zoom });
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// カードの置き場所（BoardPlacement）を囲む四角。1 枚も無ければ null
export function placementBounds(placements: readonly { x: number; y: number }[]): Rect | null {
  if (placements.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of placements) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + BOARD_CARD.w);
    y1 = Math.max(y1, p.y + BOARD_CARD.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// 全体表示（［全体］）：囲む四角が面（viewport。画素）の中央に収まる位置と拡大率。拡大は 1.2 倍までで、zoomMin〜zoomMax に収める
//   カードが無い・面が小さすぎる（余白を引くと 0 以下）ときは初期の位置を返す
export function fitView(bounds: Rect | null, viewport: { w: number; h: number }, opts: { pad?: number; maxZoom?: number } = {}): BoardView {
  const pad = opts.pad ?? 18;
  const maxZoom = opts.maxZoom ?? 1.2;
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return { ...DEFAULT_VIEW };
  const aw = viewport.w - pad * 2;
  const ah = viewport.h - pad * 2;
  if (!(aw > 0) || !(ah > 0)) return { ...DEFAULT_VIEW };
  const zoom = clamp(Math.min(aw / bounds.w, ah / bounds.h, maxZoom), BOARD_LIMITS.zoomMin, BOARD_LIMITS.zoomMax);
  return clampView({ x: (viewport.w - bounds.w * zoom) / 2 - bounds.x * zoom, y: (viewport.h - bounds.h * zoom) / 2 - bounds.y * zoom, zoom });
}