// ボード（Track B）の読むだけの描画の計算（DOM も localStorage も使わない。ui/test/memo-card-board-view.test.ts）
//   ここで決めること：カードの顔（題・本文の頭・印・タグ）、線（曲線）の形、絞り込みで薄くするカード、読み込み状態の文、初めの見ている位置、ホイールの拡大率
//   描くのは app/memo-board-tab.ts（カードは DOM、線は SVG）。位置の計算・座標の変換は memo-card-board.ts
//   機械タグ（宛て:・送った:・貼った:）はここで落とす（顔にも絞り込みの札・検索にも出さない）
import { BOARD_CARD, type Board, cleanCoord, DEFAULT_VIEW, fitView, layoutCards, liveRefs, moveNodes, type NodeMove, placementBounds, screenDeltaToBoard, setView, type BoardView } from './memo-card-board';
import { boardSaveMessage, boardUnreadableNote, type LoadBoardResult, type SaveBoardResult } from './memo-card-board-store';
import { BOARD_EMPTY_TEXT, BOARD_LOADING_NOTE, loadingNote, unreadableBlockNote } from './memo-card-board-texts';
import { visibleTags } from './grok-cards-tags';
import { cardLabel, type DrawLink } from './memo-card-links';
import type { Reply } from './threads';

export const BOARD_FACE = { titleMax: 36, bodyMax: 56, tagsMax: 3 } as const;

export interface CardFace {
  id: string;
  x: number;
  y: number;
  saved: boolean; // false＝仮の位置（保存されていない）
  title: string;
  body: string; // 画像・引用のカードでは空（題と印だけ）
  tags: string[]; // 機械タグを除いた先頭 tagsMax 個
  moreTags: number; // 入りきらなかったタグの数
  mark: string; // ❝（引用）📷（画像）💬n（返信の数）。無ければ空
}

const clip = (text: string, max: number) => {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
};

// 一番上のカードの下にぶら下がる返信の数（返信の返信も数える）
export function replyCount(replies: readonly Reply[], id: string): number {
  const seen = new Set<string>([id]);
  let count = 0;
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.pop() as string;
    for (const r of replies) {
      if (r.parent === cur && !seen.has(r.id)) {
        seen.add(r.id);
        count += 1;
        queue.push(r.id);
      }
    }
  }
  return count;
}

export function cardMark(replies: readonly Reply[], reply: Reply): string {
  const parts: string[] = [];
  if (reply.quote) parts.push('❝');
  if (reply.image) parts.push('📷');
  const n = replyCount(replies, reply.id);
  if (n > 0) parts.push(`💬${n}`);
  return parts.join(' ');
}

// 一枚の顔。画像・引用のカードは、題と印だけ（QB12）
export function cardFace(replies: readonly Reply[], reply: Reply, place: { x: number; y: number; saved: boolean }): CardFace {
  const lines = reply.text.split('\n').map((s) => s.trim()).filter((s) => s !== '');
  const flat = reply.quote || reply.image;
  const tags = visibleTags(reply.tags ?? []);
  return {
    id: reply.id,
    x: place.x,
    y: place.y,
    saved: place.saved,
    title: cardLabel(reply, BOARD_FACE.titleMax),
    body: flat ? '' : clip(lines.slice(1).join(' '), BOARD_FACE.bodyMax),
    tags: tags.slice(0, BOARD_FACE.tagsMax),
    moreTags: Math.max(0, tags.length - BOARD_FACE.tagsMax),
    mark: cardMark(replies, reply),
  };
}

// 一番上のカードの顔と位置。孤児（台帳に無い位置）は描かない（layoutCards は台帳のカードだけを返す）。読まない・書かない
export function boardFaces(replies: readonly Reply[], board: Board | null): CardFace[] {
  const byId = new Map(replies.map((r) => [r.id, r]));
  const out: CardFace[] = [];
  for (const p of layoutCards(replies, board)) {
    const reply = byId.get(p.id);
    if (reply) out.push(cardFace(replies, reply, p));
  }
  return out;
}

// 線：一番上のカードの関連のうち、両端が描かれているもの（作った順、同じ時刻なら id、同じ元なら付けた順）
export function boardLinks(replies: readonly Reply[], shown: ReadonlySet<string>): DrawLink[] {
  const tops = replies.filter((r) => r.parent === null && shown.has(r.id)).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: DrawLink[] = [];
  for (const r of tops) {
    for (const l of r.links ?? []) {
      if (l.to !== r.id && shown.has(l.to)) out.push({ from: r.id, to: l.to, kind: l.kind });
    }
  }
  return out;
}

// ---------- 絞り込み（合わないカードは薄くする） ----------

// 検索の語：空白（全角も）で区切り、小文字にそろえる。5 語まで
export function searchWords(input: string): string[] {
  return input.toLowerCase().split(/[\s\u3000]+/).filter((w) => w !== '').slice(0, 5);
}

// カードの検索の対象の文：本文・引用の題と文・見せるタグ・返信の文（機械タグは入れない）
export function searchText(replies: readonly Reply[], reply: Reply): string {
  const parts = [reply.text, reply.quote?.title ?? '', reply.quote?.text ?? '', ...visibleTags(reply.tags ?? [])];
  const seen = new Set<string>([reply.id]);
  const queue = [reply.id];
  while (queue.length > 0) {
    const cur = queue.pop() as string;
    for (const r of replies) {
      if (r.parent === cur && !seen.has(r.id)) {
        seen.add(r.id);
        parts.push(r.text);
        queue.push(r.id);
      }
    }
  }
  return parts.join('\n').toLowerCase();
}

// 絞り込みに合わない（薄くする）一番上のカードの id。tag・語のどちらも無ければ空
export function dimmedIds(replies: readonly Reply[], tag: string | null, words: readonly string[]): Set<string> {
  const out = new Set<string>();
  if (tag === null && words.length === 0) return out;
  for (const r of replies) {
    if (r.parent !== null) continue;
    const tagOk = tag === null || visibleTags(r.tags ?? []).includes(tag);
    const text = words.length > 0 ? searchText(replies, r) : '';
    const wordsOk = words.every((w) => text.includes(w));
    if (!tagOk || !wordsOk) out.add(r.id);
  }
  return out;
}

// 線が薄くなるのは、両端のカードがどちらも薄いとき
export const linkDimmed = (link: DrawLink, dim: ReadonlySet<string>) => dim.has(link.from) && dim.has(link.to);

// ---------- 線の形（曲線） ----------

export interface EdgeGeometry {
  d: string; // path の d（三次ベジェ）
  mid: { x: number; y: number }; // 曲線の真ん中（種類の名前を置く所）
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// カード a から b への曲線。端は四角の縁（中心どうしを結ぶ線が縁に当たる所）。向きの左右で逆側へ膨らむ（行きと帰りが重ならない）
//   中心が重なっている・縁どうしが交差している（カードが重なっている）ときは null（描かない）
export function edgeGeometry(a: { x: number; y: number }, b: { x: number; y: number }, size: { w: number; h: number } = BOARD_CARD): EdgeGeometry | null {
  const hw = size.w / 2;
  const hh = size.h / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1) return null;
  const cut = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  if (cut * 2 >= 1) return null;
  const p = { x: a.x + hw + dx * cut, y: a.y + hh + dy * cut };
  const q = { x: b.x + hw - dx * cut, y: b.y + hh - dy * cut };
  const sx = q.x - p.x;
  const sy = q.y - p.y;
  const len = Math.hypot(sx, sy) || 1;
  const off = Math.min(60, len * 0.18);
  const nx = (-sy / len) * off;
  const ny = (sx / len) * off;
  const c1 = { x: p.x + sx * 0.33 + nx, y: p.y + sy * 0.33 + ny };
  const c2 = { x: p.x + sx * 0.67 + nx, y: p.y + sy * 0.67 + ny };
  const mid = { x: 0.125 * p.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * q.x, y: 0.125 * p.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * q.y };
  const f = (pt: { x: number; y: number }) => `${round1(pt.x)},${round1(pt.y)}`;
  return { d: `M${f(p)} C${f(c1)} ${f(c2)} ${f(q)}`, mid: { x: round1(mid.x), y: round1(mid.y) } };
}

// ---------- 見ている位置・ホイール ----------

// ホイールの 1 目盛りの拡大率（ctrl＋ホイール＝ピンチも同じ）。1 回で 0.5〜2 倍まで。deltaMode は WheelEvent のもの（0 画素・1 行・2 ページ）
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 1;
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.min(2, Math.max(0.5, Math.exp(-px * 0.0015)));
}

// 開いたときの見ている位置：保存した位置があればそれ（読み込めた ok で、初期値のままでないときだけ）。なければ全体が収まる位置
//   初期値（0,0,100%）のままのファイルは「まだ見ている位置を保存していない」（カードの位置だけ保存したファイル）ので、全体表示にする（B2-2 で見ている位置を保存するようになっても、この扱いは残す）
export function initialView(load: LoadBoardResult | null, faces: readonly CardFace[], viewport: { w: number; h: number }): BoardView {
  if (load?.state === 'ok') {
    const v = load.board.view;
    if (v.x !== DEFAULT_VIEW.x || v.y !== DEFAULT_VIEW.y || v.zoom !== DEFAULT_VIEW.zoom) return { ...v };
  }
  return fitView(placementBounds(faces), viewport);
}

// ［全体］
export function fitAll(faces: readonly CardFace[], viewport: { w: number; h: number }): BoardView {
  return faces.length === 0 ? { ...DEFAULT_VIEW } : fitView(placementBounds(faces), viewport);
}

// ---------- カードを動かして保存（B2-1） ----------

export const DRAG_THRESHOLD = 4; // つまんだとみなす動き（画素。押しただけの click と見分ける）

// つまんで動かしている最中のカードの位置：押したときのボード座標に、画面での動き（画素）をボードの量にして足す。離したときに保存する値と同じ丸め（整数・±10,000）
export function dragPosition(start: { x: number; y: number }, delta: { dx: number; dy: number }, view: BoardView): { x: number; y: number } {
  const d = screenDeltaToBoard(view, delta.dx, delta.dy);
  return { x: cleanCoord(start.x + d.x), y: cleanCoord(start.y + d.y) };
}

export function pastThreshold(delta: { dx: number; dy: number }, threshold = DRAG_THRESHOLD): boolean {
  return Math.hypot(delta.dx, delta.dy) >= threshold;
}

// 動かせないとき（読み込み中・読めないボード）の文。動かせるなら null。動かせないときは書かない
export function moveBlockedNote(load: LoadBoardResult | null): string | null {
  if (load === null) return loadingNote('動かして');
  if (load.state === 'unreadable') return unreadableBlockNote('カードは動かせません', load.why);
  return null;
}

export type MovePlan = { ok: true; board: Board; changed: boolean } | { ok: false; why: 'blocked' | 'notCard' };

// 何枚かを動かした結果のボード（元は変えない。保存は 1 回）。読めないボードは動かさない。台帳の一番上にないカードは入れない（1 枚もなければ notCard）
//   動かしたカードだけが入る（ほかのカードの位置・孤児・見ている位置はそのまま）
export function planMoves(load: LoadBoardResult | null, replies: readonly Reply[], moves: readonly NodeMove[], now: number): MovePlan {
  if (load === null || load.state === 'unreadable') return { ok: false, why: 'blocked' };
  const live = liveRefs(replies);
  const usable = moves.filter((m) => live.has(m.ref));
  if (usable.length === 0) return { ok: false, why: 'notCard' };
  const board = moveNodes(load.board, usable, now, live);
  return { ok: true, board, changed: board !== load.board };
}

// 1 枚を動かした結果（B2-1）
export function planMove(load: LoadBoardResult | null, replies: readonly Reply[], ref: string, pos: { x: number; y: number }, now: number): MovePlan {
  return planMoves(load, replies, [{ ref, x: pos.x, y: pos.y }], now);
}

// 保存を待っている間の位置を、顔に当てる（動かした直後に元へ跳ばない。保存した扱い）
export function withPending(faces: readonly CardFace[], pending: ReadonlyMap<string, { x: number; y: number }>): CardFace[] {
  if (pending.size === 0) return [...faces];
  return faces.map((f) => {
    const p = pending.get(f.id);
    return p ? { ...f, x: p.x, y: p.y, saved: true } : f;
  });
}

// 保存の結果の文（成功は短く。初めての保存で控えを取ったときは、そのことも）
export function moveResultNote(result: SaveBoardResult): { text: string; tone: 'info' | 'warn' } {
  if (result.ok) return { text: result.backedUp ? '位置を保存しました（もとのボードの写しも取りました）' : '位置を保存しました', tone: 'info' };
  return { text: boardSaveMessage(result.why), tone: 'warn' };
}
// ---------- 見ている位置の保存（B2-2） ----------

export const VIEW_SAVE_DELAY = 400; // パン・ズームが止まってから保存するまで（ミリ秒）

// 最後に見ている位置を変えた時刻（touchedAt。変えていなければ null）から、保存するまであと何ミリ秒か。null＝保存するものがない。0＝いま保存する
export function viewSaveWait(touchedAt: number | null, now: number, delay: number = VIEW_SAVE_DELAY): number | null {
  if (touchedAt === null) return null;
  return Math.max(0, touchedAt + delay - now);
}

export type ViewPlan = { ok: true; board: Board; changed: boolean } | { ok: false; why: 'blocked' };

// 見ている位置だけを変えたボード（元は変えない。カード・孤児はそのまま）。読めない・読み込み中は書かない。同じなら changed=false
export function planView(load: LoadBoardResult | null, view: BoardView, now: number): ViewPlan {
  if (load === null || load.state === 'unreadable') return { ok: false, why: 'blocked' };
  const board = setView(load.board, view, now);
  return { ok: true, board, changed: board !== load.board };
}

// 見ている位置の保存の結果の文。うまくいったときは静か（パンのたびに出さない）。控えを取ったときと、できなかったときだけ出す
export function viewResultNote(result: SaveBoardResult): { text: string; tone: 'info' | 'warn' } | null {
  if (!result.ok) return { text: boardSaveMessage(result.why), tone: 'warn' };
  return result.backedUp ? { text: '見ている位置を保存しました（もとのボードの写しも取りました）', tone: 'info' } : null;
}

// ---------- 面の上に出す文 ----------

export interface BoardNote {
  text: string;
  tone: 'info' | 'warn' | '';
}

// 読み込み状態の文。null は読み込み中。読めない（unreadable）ときは理由つき（boardUnreadableNote）。仮の位置があるときは「保存されない」ことを一言
export function boardNote(load: LoadBoardResult | null, provisional: number): BoardNote {
  if (load === null) return { text: BOARD_LOADING_NOTE, tone: 'info' };
  if (load.state === 'unreadable') return { text: boardUnreadableNote(load.why), tone: 'warn' };
  if (provisional > 0) return { text: '仮の並びで見せています（位置はまだ保存されません）', tone: 'info' };
  return { text: '', tone: '' };
}

export const boardEmptyText = BOARD_EMPTY_TEXT;