// ボード（Track B）の読むだけの描画の計算（DOM も localStorage も使わない。ui/test/memo-card-board-view.test.ts）
//   ここで決めること：カードの顔（題・本文の頭・印・タグ）、線（曲線）の形、絞り込みで薄くするカード、読み込み状態の文、開いたときの見ている位置（最後に書いた辺り）、ホイールの拡大率
//   描くのは app/memo-board-tab.ts（カードは DOM、線は SVG）。位置の計算・座標の変換は memo-card-board.ts
//   機械タグ（宛て:・送った:・貼った:）はここで落とす（顔にも絞り込みの札・検索にも出さない）
import { t } from './i18n';
import { BOARD_CARD, type Board, type BoardLayout, type BoardPlacement, type CardSize, clampView, cleanCoord, DEFAULT_VIEW, fitView, layoutCards, liveRefs, moveNodes, type NodeMove, panBy, placementBounds, type Rect, rectBounds, screenDeltaToBoard, setView, type BoardView, zoomAt } from './memo-card-board';
import type { BoardPlace } from './memo-card-board-place';
import { boardSaveMessage, boardUnreadableNote, type LoadBoardResult, type SaveBoardResult } from './memo-card-board-store';
import { BOARD_EMPTY_TEXT, BOARD_LOADING_NOTE, layoutHead, loadingNote, unreadableBlockNote } from './memo-card-board-texts';
import { visibleTags } from './grok-cards-tags';
import { cardColor, cardLike, type LikeLevel, type MarkColor, withColorSymbol } from './likes';
import { cardLabel, type DrawLink } from './memo-card-links';
import { parseAiCardText } from './reader-ai-card';
import type { Reply } from './threads';

export const BOARD_FACE = { titleMax: 36, bodyMax: 56, tagsMax: 3, flowMax: 240 } as const;

export interface CardFace {
  id: string;
  x: number;
  y: number;
  saved: boolean; // false＝仮の位置（保存されていない）
  title: string;
  body: string; // 画像・引用のカードでは空（題と印だけ）
  tags: string[]; // 機械タグを除いた先頭 tagsMax 個
  moreTags: number; // 入りきらなかったタグの数
  mark: string; // 色の記号（◎▢☆。MK7。先頭）・❝（引用）📷（画像）💬n（返信の数）。無ければ空
  first: string; // 流し込む文の 1 行目（画像・引用のカードは題）
  rest: string; // 流し込む文の 2 行目から（改行でつなぐ）。1 行だけのカード・画像・引用のカードは空
  bold: boolean; // 1 行目を太字にする（2 行以上のカード、画像・引用のカード）
  who: string; // AI のカードの書き手の名前（人のカードは空）
  thumb: string; // 顔の左に絵を出す写真の shots の id（画像だけのカード。引用つきの画像・ほかのカードは空。決定 1）
  like: 0 | LikeLevel; // カードの ♥ の段（MK5。印のタグ。無ければ 0）。顔に入るので、替わると描き直しの鍵も替わる
  color: MarkColor | ''; // カードの色の印の名前（MK5。無ければ空）
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

// 何枚ものカードの返信の数を、一回でまとめて数える（replyCount と同じ答え。親から子の表を一度だけ作り、カードごとにその下だけをたどる）
//   描き直すたびに全部のカードで数える所（六角の三角の字。HX4）で使う：カードごとに全部の返信をなめない
export function replyCounts(replies: readonly Reply[], ids: Iterable<string>): Map<string, number> {
  const children = new Map<string, Reply[]>();
  for (const r of replies) {
    if (r.parent === null) continue;
    const list = children.get(r.parent);
    if (list) list.push(r);
    else children.set(r.parent, [r]);
  }
  const out = new Map<string, number>();
  for (const id of ids) {
    if (out.has(id)) continue;
    const seen = new Set<string>([id]);
    let count = 0;
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.pop() as string;
      for (const r of children.get(cur) ?? []) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          count += 1;
          queue.push(r.id);
        }
      }
    }
    out.set(id, count);
  }
  return out;
}

export function cardMark(replies: readonly Reply[], reply: Reply): string {
  const parts: string[] = [];
  if (reply.quote) parts.push('❝');
  if (reply.image) parts.push('📷');
  const n = replyCount(replies, reply.id);
  if (n > 0) parts.push(`💬${n}`);
  return parts.join(' ');
}

// カードの文を行に分ける（空の行は捨てる）。読む画面から来た AI のカードは、時刻の行を字のまま出さない（見出しと文だけ）
export function cardLines(reply: Pick<Reply, 'text' | 'by' | 'at'>): string[] {
  if (reply.by && reply.at?.kind) {
    const body = parseAiCardText(reply.text);
    return [body.head, ...body.rows.map((row) => row.text)].filter((s) => s !== '');
  }
  return reply.text.split('\n').map((s) => s.trim()).filter((s) => s !== '');
}

// 右上の印の席の幅（px）。印が無ければ席を取らない
export function markSeatWidth(mark: string): number {
  return mark === '' ? 0 : Math.max(24, [...mark].length * 11 + 4);
}

// 一枚の顔。画像・引用のカードは、題と印だけ（QB12）
export function cardFace(replies: readonly Reply[], reply: Reply, place: { x: number; y: number; saved: boolean }): CardFace {
  const lines = reply.text.split('\n').map((s) => s.trim()).filter((s) => s !== '');
  const flat = reply.quote || reply.image;
  const tags = visibleTags(reply.tags ?? []);
  const title = cardLabel(reply, BOARD_FACE.titleMax);
  const flowLines = flat ? [] : cardLines(reply);
  const color = cardColor(reply.tags ?? []);
  return {
    id: reply.id,
    x: place.x,
    y: place.y,
    saved: place.saved,
    title,
    body: flat ? '' : clip(lines.slice(1).join(' '), BOARD_FACE.bodyMax),
    tags: tags.slice(0, BOARD_FACE.tagsMax),
    moreTags: Math.max(0, tags.length - BOARD_FACE.tagsMax),
    mark: withColorSymbol(cardMark(replies, reply), color), // 色の記号は右上の印の席の先頭（MK7。席の幅もこの字で決まる）
    first: flowLines.length > 0 ? clip(flowLines[0], BOARD_FACE.flowMax) : title,
    rest: clip(flowLines.slice(1).join('\n'), BOARD_FACE.flowMax),
    bold: Boolean(flat) || flowLines.length > 1,
    who: reply.by ? reply.by.name.trim() || 'AI' : '',
    thumb: reply.image && !reply.quote ? reply.image : '',
    like: cardLike(reply.tags ?? []),
    color,
  };
}

// 一番上のカードの顔と位置。孤児（台帳に無い位置）は描かない（layoutCards は台帳のカードだけを返す）。読まない・書かない
//   place は形ごとの並べ方（既定は四角の layoutCards。六角は hexLayout：置いたカードは nodes の順で上に、仮のカードはその下。HX5）。顔の順は並べ方の順
export function boardFaces(replies: readonly Reply[], board: Board | null, place: (replies: readonly Reply[], board: Board | null) => BoardPlacement[] = layoutCards): CardFace[] {
  const byId = new Map(replies.map((r) => [r.id, r]));
  const out: CardFace[] = [];
  for (const p of place(replies, board)) {
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
  d: string; // path の d（三次ベジェ。band のときは短い直線）
  mid: { x: number; y: number }; // 曲線の真ん中（種類の名前を置く所）
  band?: number; // 縁から縁が短い線（六角の隣どうし。HX4）：曲線と矢じりをやめた短い帯の太さ（画素）。無ければ曲線
  anchor?: 'start' | 'middle' | 'end'; // 名札の text-anchor（六角の迂回の線だけ。名札を線から離れる向きに伸ばす。memo-card-board-route.ts）。無ければ middle
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
  return curveGeometry(p, q);
}

// 縁の点 p から q への曲線（三次ベジェ）の二つの制御点。曲げ方は curveGeometry と同じ（六角の線の迂回が、今の曲線がほかのカードの字に掛かるかを見るのに使う）
export function curveControls(p: { x: number; y: number }, q: { x: number; y: number }): { c1: { x: number; y: number }; c2: { x: number; y: number } } {
  const sx = q.x - p.x;
  const sy = q.y - p.y;
  const len = Math.hypot(sx, sy) || 1;
  const off = Math.min(60, len * 0.18);
  const nx = (-sy / len) * off;
  const ny = (sx / len) * off;
  return { c1: { x: p.x + sx * 0.33 + nx, y: p.y + sy * 0.33 + ny }, c2: { x: p.x + sx * 0.67 + nx, y: p.y + sy * 0.67 + ny } };
}

// 縁の点 p から q への曲線（edgeGeometry と六角の線で同じ曲げ方。HX4）。向きの左右で逆側へ膨らむ
export function curveGeometry(p: { x: number; y: number }, q: { x: number; y: number }): EdgeGeometry {
  const { c1, c2 } = curveControls(p, q);
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

// ボードの wheel の振り分け（左の盤面 sidebar.ts の wheel と同じ決まり）
//   Ctrl 付き（ピンチも含む）は拡大縮小、それ以外は移動。Shift で縦だけの動きは横へ回す。metaKey は見ない
export type WheelPlan = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number };

// ピンチ（Ctrl 付きの wheel）の拡大率。0.8〜1.25 に収める。結果が有限でなければ 1
export function pinchZoomFactor(deltaY: number, unit = 1): number {
  const f = Math.exp(-deltaY * unit * 0.01);
  if (!Number.isFinite(f)) return 1;
  return Math.min(1.25, Math.max(0.8, f));
}

// wheel の届いた量を、拡大縮小か移動かに振り分ける（deltaMode 1 は行、2 はページ）
export function wheelPlan(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey: boolean }, pageHeight: number): WheelPlan {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pageHeight : 1;
  if (e.ctrlKey) return { kind: 'zoom', factor: pinchZoomFactor(e.deltaY, unit) };
  let dx = e.deltaX * unit;
  let dy = e.deltaY * unit;
  if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
  return { kind: 'pan', dx, dy };
}

// ---------- 開いたときの見ている位置：最後に書いた辺りを読める大きさで（HX1。docs/plan-comment-board-hex.md §6.3） ----------
//   決めた位置は保存しない（呼ぶ側は touchView を通さない）。【決めごとに当たる：前は「保存した位置がいつも勝つ」（B1-4・B2-2）】
//   初期値（0,0,100%）のままのファイルは、前と同じく「見ている位置を保存していない」として扱う

export const READ_PAD = 2; // 読めるとみなす、面の縁からの余白（画面の画素）
export const OPEN_TOP_PAD = 4; // 上の区画で、最後に書いた辺りを置く面の上の端からの余白（画面の画素）
export const READ_ZOOM_MIN = 0.85; // 読める倍率の下限
export const OPEN_ZOOMS: readonly number[] = [1, 0.95, 0.9, 0.85]; // 決まり 3 で探す倍率（大きい順）
export const RECENT_MAX = 9; // 決まり 3 で数える最近のカードの数

export type Placed = { id: string; x: number; y: number };
export type Viewport = { w: number; h: number };

// 読む箱：カードの左上から、読めるかを見る箱（ボードの座標）。形ごとに渡す（四角はカード全体。六角は HX4）
export type ReadBox = (at: { x: number; y: number }) => Rect;
export const squareReadBox: ReadBox = (at) => ({ x: at.x, y: at.y, w: BOARD_CARD.w, h: BOARD_CARD.h });

// 一番上のカードを、最後に書いた順に（自分と返信〈返信の返信も〉の createdAt の最大が新しい順。同じ時刻なら id の文字順で後ろが先）
//   書き直した時刻（editedAt）は数えない。一番上まで辿れない返信（親が無い・輪）は数えない
export function recentTops(replies: readonly Reply[]): string[] {
  const byId = new Map(replies.map((r) => [r.id, r]));
  const time = (r: Reply) => (Number.isFinite(r.createdAt) ? r.createdAt : 0);
  const latest = new Map<string, number>();
  for (const r of replies) if (r.parent === null) latest.set(r.id, Math.max(latest.get(r.id) ?? -Infinity, time(r)));
  for (const r of replies) {
    if (r.parent === null) continue;
    let top: Reply | undefined = r;
    let steps = 0;
    while (top !== undefined && top.parent !== null && steps <= replies.length) {
      top = byId.get(top.parent);
      steps += 1;
    }
    if (top === undefined || top.parent !== null) continue;
    const t = latest.get(top.id);
    if (t !== undefined) latest.set(top.id, Math.max(t, time(r)));
  }
  return [...latest].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0)).map(([id]) => id);
}

// 描いているカードを、最後に書いた順に（recentTops の順。描いていないカードは飛ばす）
export function recentFaces<T extends Placed>(replies: readonly Reply[], faces: readonly T[]): T[] {
  const at = new Map<string, T>(faces.map((f) => [f.id, f]));
  const out: T[] = [];
  for (const id of recentTops(replies)) {
    const f = at.get(id);
    if (f) out.push(f);
  }
  return out;
}

// 最後に書いたカード：描いているカードの中で、返信を数えていちばん新しいもの（無ければ null）
//   開いたとき・隠したときの覚え・出したときの判定・「100%」で、この一つを使う
export function lastWritten<T extends Placed>(replies: readonly Reply[], faces: readonly T[]): T | null {
  return recentFaces(replies, faces)[0] ?? null;
}

// 読めるか：箱（ボードの座標）が、見ている位置で面の中（縁から pad）に丸ごと入っているか。面積の割合ではなく辺で見る。面に大きさが無ければ false
export function boxReadable(view: BoardView, box: Rect, viewport: Viewport, pad: number = READ_PAD): boolean {
  if (!(viewport.w > 0) || !(viewport.h > 0) || !(box.w > 0) || !(box.h > 0)) return false;
  const left = box.x * view.zoom + view.x;
  const top = box.y * view.zoom + view.y;
  const e = 1e-6; // 小数の誤差の分
  return left >= pad - e && top >= pad - e && left + box.w * view.zoom <= viewport.w - pad + e && top + box.h * view.zoom <= viewport.h - pad + e;
}

// 箱（ボードの座標）の何割が面の中に見えているか（0〜1。面積の割合）。面か箱に大きさが無ければ 0
export function boxVisibleRatio(view: BoardView, box: Rect, viewport: Viewport): number {
  const w = box.w * view.zoom;
  const h = box.h * view.zoom;
  if (!(viewport.w > 0) || !(viewport.h > 0) || !(w > 0) || !(h > 0)) return 0;
  const left = box.x * view.zoom + view.x;
  const top = box.y * view.zoom + view.y;
  const seenW = Math.max(0, Math.min(left + w, viewport.w) - Math.max(left, 0));
  const seenH = Math.max(0, Math.min(top + h, viewport.h) - Math.max(top, 0));
  return (seenW * seenH) / (w * h);
}

// 箱が読めるように、見ている位置を少しだけ動かす（倍率は変えない。HX2）。もう読めている・面に大きさが無ければ null
//   縦・横それぞれ、はみ出した側を面の縁（pad）に合わせる。面に入らない向きは、頭（上・左）を縁に合わせる（文の始めを見せる）
//   動かす量は整数（見ている位置は整数のまま）。頭を合わせるときは切り上げ、尻を合わせるときは切り捨てて、縁を割らない
//   動かす量が 0 のとき・範囲（clampView）で止まって今と同じ位置のときも null（要らない滑りと保存を走らせない）
export function viewToRead(view: BoardView, box: Rect, viewport: Viewport, pad: number = READ_PAD): BoardView | null {
  if (!(viewport.w > 0) || !(viewport.h > 0) || boxReadable(view, box, viewport, pad)) return null;
  const e = 1e-6;
  const shift = (start: number, size: number, room: number) => {
    if (size > room - 2 * pad + e || start < pad - e) return Math.ceil(pad - start - e);
    if (start + size > room - pad + e) return Math.floor(room - pad - start - size + e);
    return 0;
  };
  const dx = shift(box.x * view.zoom + view.x, box.w * view.zoom, viewport.w);
  const dy = shift(box.y * view.zoom + view.y, box.h * view.zoom, viewport.h);
  if (dx === 0 && dy === 0) return null;
  const next = panBy(view, dx, dy);
  return next.x === view.x && next.y === view.y && next.zoom === view.zoom ? null : next;
}

const isDefaultView = (v: BoardView) => v.x === DEFAULT_VIEW.x && v.y === DEFAULT_VIEW.y && v.zoom === DEFAULT_VIEW.zoom;

// 箱を倍率 zoom で面に置く見ている位置。横は真ん中。縦は center＝真ん中、top＝上の端に寄せる
//   上の余白は、入るなら OPEN_TOP_PAD（4）、入らなければ READ_PAD（2）まで詰める。切り捨てて余白を超えないようにし（下の辺を守る）、2 を割るときだけ 1 下げる
export function placeBox(box: Rect, zoom: number, viewport: Viewport, align: 'top' | 'center'): BoardView {
  const x = (viewport.w - box.w * zoom) / 2 - box.x * zoom;
  if (align === 'center') return clampView({ x, y: (viewport.h - box.h * zoom) / 2 - box.y * zoom, zoom });
  const ry = box.y * zoom;
  const want = Math.max(READ_PAD, Math.min(OPEN_TOP_PAD, viewport.h - READ_PAD - box.h * zoom));
  let y = Math.floor(want - ry);
  if (y + ry < READ_PAD - 1e-6) y += 1;
  return clampView({ x, y, zoom });
}

export interface RecentOpts {
  place: BoardPlace; // 上の区画（upper）は面の上の端、下の置き場（bottom）は真ん中に置く
  readBox?: ReadBox; // 既定は四角（squareReadBox）
  zooms?: readonly number[]; // 探す倍率（大きい順。既定は OPEN_ZOOMS）
  fallbackZoom?: number; // 1 枚も読めないとき、最後に書いたカードを真ん中に置く倍率（既定は READ_ZOOM_MIN）
}

export interface RecentView {
  view: BoardView;
  rule: 3 | 4;
  n: number; // 読める最近のカードの数（決まり 4 では 0）
}

// 最後に書いた辺り（決まり 3・4）の決め方。形ごとに渡す（四角は recentView。六角は HX4 の hexRecentView）
export type RecentFn = (replies: readonly Reply[], faces: readonly Placed[], viewport: Viewport, opts: RecentOpts) => RecentView | null;

// 最後に書いた辺り（決まり 3）：最近の N 枚（最後に書いた順。RECENT_MAX まで）がどれも読める最大の N を、倍率の大きい順に探す（N が同じなら大きい倍率）。その N 枚を囲む四角を置く
//   1 枚も読めなければ決まり 4：最後に書いたカードを fallbackZoom で真ん中に置く。描くカードが無ければ null
export function recentView(replies: readonly Reply[], faces: readonly Placed[], viewport: Viewport, opts: RecentOpts): RecentView | null {
  const readBox = opts.readBox ?? squareReadBox;
  const boxes = recentFaces(replies, faces)
    .slice(0, RECENT_MAX)
    .map((f) => readBox(f));
  if (boxes.length === 0) return null;
  const align = opts.place === 'upper' ? 'top' : 'center';
  let best: { view: BoardView; n: number } | null = null;
  for (const zoom of opts.zooms ?? OPEN_ZOOMS) {
    for (let n = boxes.length; n > (best?.n ?? 0); n--) {
      const group = boxes.slice(0, n);
      const bounds = rectBounds(group);
      if (!bounds) continue;
      const view = placeBox(bounds, zoom, viewport, align);
      if (group.every((b) => boxReadable(view, b, viewport))) {
        best = { view, n };
        break;
      }
    }
  }
  if (best) return { view: best.view, rule: 3, n: best.n };
  return { view: placeBox(boxes[0], opts.fallbackZoom ?? READ_ZOOM_MIN, viewport, 'center'), rule: 4, n: 0 };
}

export type OpeningRule = 1 | 2 | 3 | 4;

export interface OpeningView {
  view: BoardView;
  rule: OpeningRule; // 使った決まり（畳む・置き場の替えで、触っていない決まり 3 を計算し直すため）
  n: number; // 決まり 3 で読める最近のカードの数（ほかの決まりでは 0）
}

// 開いたときの見ている位置（決まり 1〜4。四角でも六角でも同じ決まりで、読む箱を替える）
//   1：保存した位置（読めた ok で、初期値のままでない。saved があればそれ）があり、倍率 0.85 以上で、最後に書いたカードが読めるなら、そのまま
//   2：全体が入る倍率（fitView）が 0.85 以上なら、全体（小さいメモは今と同じ）
//   3：最後に書いた辺り（recentView）。上の区画では面の上の端、下の置き場では真ん中に置く
//   4：どれも入らないとき、最後に書いたカードを 0.85 倍で真ん中に置く
//   描くカードが無いときは、今と同じく全体表示（決まり 2 とする）
//   readBox・recent は形ごとの読む箱と最後に書いた辺りの決め方（既定は四角。六角は HX4 の geo が渡す）
//   saved：形ごとにメモリに覚えた見ている位置（HX4）。あればファイルの位置の代わりに、決まり 1 の同じ確かめにかける（通らなければ決まり 2〜4）
export function openingView(load: LoadBoardResult | null, replies: readonly Reply[], faces: readonly Placed[], viewport: Viewport, opts: { place: BoardPlace; readBox?: ReadBox; recent?: RecentFn; saved?: BoardView }): OpeningView {
  const readBox = opts.readBox ?? squareReadBox;
  const all = rectBounds(faces.map((f) => readBox(f)));
  const fit = fitView(all, viewport);
  const last = lastWritten(replies, faces);
  if (!last) return { view: fit, rule: 2, n: 0 };
  const saved = opts.saved ?? (load?.state === 'ok' ? load.board.view : null);
  if (saved && !isDefaultView(saved) && saved.zoom >= READ_ZOOM_MIN && boxReadable(saved, readBox(last), viewport)) return { view: { ...saved }, rule: 1, n: 0 };
  if (all && fit.zoom >= READ_ZOOM_MIN && boxReadable(fit, all, viewport)) return { view: fit, rule: 2, n: 0 }; // 面が小さすぎて fitView が初期の位置を返したときは、全体が入っていないので使わない
  return (opts.recent ?? recentView)(replies, faces, viewport, { place: opts.place, readBox }) ?? { view: fit, rule: 2, n: 0 };
}

// 「100%」のボタン：倍率を 1.0 にする。1 枚選んでいればそのカードを真ん中に。選んでいなければ最後に書いた辺り（決まり 3 を 1.0 だけで探す。決まり 2 は使わない。入らなければ最後に書いたカードを 1.0 で真ん中に）
//   描くカードが無ければ、面の真ん中を保って 1.0 にする
export function actualSizeView(view: BoardView, replies: readonly Reply[], faces: readonly Placed[], viewport: Viewport, opts: { place: BoardPlace; selected: string | null; readBox?: ReadBox; recent?: RecentFn }): BoardView {
  const readBox = opts.readBox ?? squareReadBox;
  const one = opts.selected === null ? undefined : faces.find((f) => f.id === opts.selected);
  if (one) return placeBox(readBox(one), 1, viewport, 'center');
  const recent = (opts.recent ?? recentView)(replies, faces, viewport, { place: opts.place, readBox, zooms: [1], fallbackZoom: 1 });
  return recent ? recent.view : zoomAt(view, 1 / view.zoom, viewport.w / 2, viewport.h / 2);
}

// 隠して出したとき（同じメモ）：最後に書いたカードが隠す前（before）と替わっていて、読めていなければ、最後に書いた辺り（決まり 3。入らなければ 4）
//   動かさないとき（同じカード・読めている・描くカードが無い・面に大きさが無い）は null。保存はしない（呼ぶ側）
export function viewAfterShow(view: BoardView, replies: readonly Reply[], faces: readonly Placed[], viewport: Viewport, opts: { place: BoardPlace; before: string | null; readBox?: ReadBox; recent?: RecentFn }): RecentView | null {
  const readBox = opts.readBox ?? squareReadBox;
  const last = lastWritten(replies, faces);
  if (!last || last.id === opts.before || !(viewport.w > 0) || !(viewport.h > 0) || boxReadable(view, readBox(last), viewport)) return null;
  return (opts.recent ?? recentView)(replies, faces, viewport, { place: opts.place, readBox });
}

export interface FaceChange {
  dy: number; // 面の上端が動いた量（画面の画素。下へ動けば正）。置き場の替えでは 0
  rule: OpeningRule | null; // 開いたときに選んだ決まり
  touched: boolean; // 開いてから、見ている位置を変えた・カードを動かした
  selected: number; // 選んでいるカードの数
}

// 面が替わったとき（道具の列を畳む・開く、絞りの札の行の高さ、置き場の替え）の見ている位置。保存はしない（呼ぶ側）
//   開いてから触っておらず、選んでいるカードも無く、開いたときが決まり 1 でなければ、決まり 2〜4 を今の面で計算し直す（決まりも替わる）
//   ほか（決まり 1・触ったあと・選びがあるとき）は、上端が動いた分だけ view.y から引いて、カードを画面の上で止める
export function settleView(view: BoardView, replies: readonly Reply[], faces: readonly Placed[], viewport: Viewport, change: FaceChange, opts: { place: BoardPlace; readBox?: ReadBox; recent?: RecentFn }): { view: BoardView; rule: OpeningRule | null } {
  if (change.rule !== null && change.rule !== 1 && !change.touched && change.selected === 0 && viewport.w > 0 && viewport.h > 0) {
    const open = openingView(null, replies, faces, viewport, opts);
    return { view: open.view, rule: open.rule };
  }
  return { view: change.dy === 0 ? view : panBy(view, 0, -change.dy), rule: change.rule };
}

// 戻す・やり直すでカードを動かしたあと：動いたカード（左上の点）がどれも読めなければ、1 枚目が読める所への見ている位置（viewToRead）。どれか読めれば null（HX3）
//   端で遠くまで運んで離したあとの Ctrl+Z で、カードが面の外の元の位置へ戻って消えたように見えないように
export function viewToShowMoved(view: BoardView, moved: readonly { x: number; y: number }[], viewport: Viewport, readBox: ReadBox = squareReadBox): BoardView | null {
  if (moved.length === 0 || moved.some((m) => boxReadable(view, readBox(m), viewport))) return null;
  return viewToRead(view, readBox(moved[0]), viewport);
}

// 型を足したあと（TA2）：押したカードの箱（anchor。無ければ null）と、足したカードの箱（added）が読める所への見ている位置。倍率は変えない。動かさなくてよければ null
//   全部を囲む箱が、今の倍率で面（縁から READ_PAD）に入るなら、その箱を目当てにする。入らなければ、足した分だけを囲む箱を目当てにする
//   （箱 1 つだと、入らないとき押したカードの側に合い、離れた足した分が見えないため）
export function viewToReadAdded(view: BoardView, anchor: Rect | null, added: readonly Rect[], viewport: Viewport): BoardView | null {
  if (added.length === 0 || !(viewport.w > 0) || !(viewport.h > 0)) return null;
  const union = (boxes: readonly Rect[]): Rect => {
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
  };
  const fits = (box: Rect) => box.w * view.zoom <= viewport.w - 2 * READ_PAD + 1e-6 && box.h * view.zoom <= viewport.h - 2 * READ_PAD + 1e-6;
  const all = anchor ? union([anchor, ...added]) : union(added);
  return viewToRead(view, fits(all) ? all : union(added), viewport);
}

// ---------- 書く欄を開いたときの見ている位置（HX2） ----------

export const COMPOSE_KEEP_RATIO = 0.5; // 目当てのカードの読む箱がこれより多く見えていれば、書く欄を開いても見ている位置を動かさない

// 書く欄を開いたとき（面が低くなったあと）の見ている位置。目当て：書き直しているカード → 1 枚だけ選んでいるカード → 最後に書いたカード
//   目当ての読む箱が半分より多く見えていれば動かさない（null）。半分以下なら、読める所へ少しだけ寄せる（viewToRead）。保存はしない（呼ぶ側）
export function composeView(view: BoardView, replies: readonly Reply[], faces: readonly Placed[], viewport: Viewport, opts: { editing: string | null; selected: string | null; readBox?: ReadBox }): BoardView | null {
  const readBox = opts.readBox ?? squareReadBox;
  const pick = (id: string | null) => (id === null ? undefined : faces.find((f) => f.id === id));
  const target = pick(opts.editing) ?? pick(opts.selected) ?? lastWritten(replies, faces);
  if (!target) return null;
  const box = readBox(target);
  if (boxVisibleRatio(view, box, viewport) > COMPOSE_KEEP_RATIO) return null;
  return viewToRead(view, box, viewport);
}

// ［全体］。size は箱の大きさ（既定は四角。六角は 150×174）
export function fitAll(faces: readonly CardFace[], viewport: { w: number; h: number }, size: CardSize = BOARD_CARD): BoardView {
  return faces.length === 0 ? { ...DEFAULT_VIEW } : fitView(placementBounds(faces, size), viewport);
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
  if (load === null) return loadingNote(t('動かして'));
  if (load.state === 'unreadable') return unreadableBlockNote(t('カードは動かせません'), load.why, load.layout);
  return null;
}

export type MovePlan = { ok: true; board: Board; changed: boolean } | { ok: false; why: 'blocked' | 'notCard' };

// 何枚かを動かした結果のボード（元は変えない。保存は 1 回）。読めないボードは動かさない。台帳の一番上にないカードは入れない（1 枚もなければ notCard）
//   動かしたカードだけが入る（ほかのカードの位置・孤児・見ている位置はそのまま）。四角の決まり。六角のファイルは固める・上へ移すがあるので、
//   画面は読み込みの形で選ぶ planBoardMoves（memo-card-board-geo.ts）を通す（HX5）
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
//   raise（六角。HX5）：保存を待っているカードを顔の並びの後ろへ（待っている順に）。描く順が nodes の順なので、保存の前から、最後に動かしたカードを上に描く
export function withPending(faces: readonly CardFace[], pending: ReadonlyMap<string, { x: number; y: number }>, raise = false): CardFace[] {
  if (pending.size === 0) return [...faces];
  const out = faces.map((f) => {
    const p = pending.get(f.id);
    return p ? { ...f, x: p.x, y: p.y, saved: true } : f;
  });
  if (!raise) return out;
  const order = [...pending.keys()];
  const waiting = out.filter((f) => pending.has(f.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return [...out.filter((f) => !pending.has(f.id)), ...waiting];
}

// 保存の結果の文。ふつうの成功は静か（結果は面に見える）。初めての保存で控えを取ったときと、できなかったときだけ出す
//   layout：書く先のファイルの形（必ず渡す。読めない・読んだあとに変わったは、六角なら頭に「六角の並びは、」。HX5）
export function moveResultNote(result: SaveBoardResult, layout: BoardLayout): { text: string; tone: 'info' | 'warn' } | null {
  if (!result.ok) return { text: boardSaveMessage(result.why, layout), tone: 'warn' };
  return result.backedUp ? { text: t('位置を保存しました（もとのボードの写しも取りました）'), tone: 'info' } : null;
}
// ---------- 見ている位置の保存（B2-2） ----------

export const VIEW_SAVE_DELAY = 400; // パン・ズームが止まってから保存するまで（ミリ秒）

// 最後に見ている位置を変えた時刻（touchedAt。変えていなければ null）から、保存するまであと何ミリ秒か。null＝保存するものがない。0＝いま保存する
export function viewSaveWait(touchedAt: number | null, now: number, delay: number = VIEW_SAVE_DELAY): number | null {
  if (touchedAt === null) return null;
  return Math.max(0, touchedAt + delay - now);
}

export type ViewPlan = { ok: true; board: Board; changed: boolean } | { ok: false; why: 'blocked' | 'missing' };

// 見ている位置だけを変えたボード（元は変えない。カード・孤児はそのまま）。読めない・読み込み中は書かない。同じなら changed=false
//   六角のファイルがまだ無い（missing）ときは、見ている位置だけではファイルを作らない（missing。見ている位置はメモリに覚えるだけ。HX4 から。HX5）。四角は今のまま作る
export function planView(load: LoadBoardResult | null, view: BoardView, now: number): ViewPlan {
  if (load === null || load.state === 'unreadable') return { ok: false, why: 'blocked' };
  if (load.state === 'missing' && load.layout === 'hex') return { ok: false, why: 'missing' };
  const board = setView(load.board, view, now);
  return { ok: true, board, changed: board !== load.board };
}

// 見ている位置の保存の結果の文。うまくいったときは静か（パンのたびに出さない）。控えを取ったときと、できなかったときだけ出す。layout は moveResultNote と同じ
export function viewResultNote(result: SaveBoardResult, layout: BoardLayout): { text: string; tone: 'info' | 'warn' } | null {
  if (!result.ok) return { text: boardSaveMessage(result.why, layout), tone: 'warn' };
  return result.backedUp ? { text: t('見ている位置を保存しました（もとのボードの写しも取りました）'), tone: 'info' } : null;
}

// ---------- カードへ移る（メニューの［移る］。§5 の 13） ----------

export const CARD_VISIBLE_ENOUGH = 0.7; // これだけ見えていれば、見ている位置を動かさない

// カードの何割が面の中に見えているか（0〜1）。面に大きさが無ければ 0。計算は boxVisibleRatio（カードの箱で。size の既定は四角）
export function cardVisibleRatio(view: BoardView, at: { x: number; y: number }, viewport: { w: number; h: number }, size: CardSize = BOARD_CARD): number {
  return boxVisibleRatio(view, { x: at.x, y: at.y, w: size.w, h: size.h }, viewport);
}

// カードが十分に見えていなければ、真ん中に来る見ている位置を返す。見えていれば null（動かさない）。size は箱の大きさ（既定は四角）
export function viewToShowCard(view: BoardView, at: { x: number; y: number }, viewport: { w: number; h: number }, size: CardSize = BOARD_CARD): BoardView | null {
  if (cardVisibleRatio(view, at, viewport, size) >= CARD_VISIBLE_ENOUGH) return null;
  const left = at.x * view.zoom + view.x;
  const top = at.y * view.zoom + view.y;
  return panBy(view, (viewport.w - size.w * view.zoom) / 2 - left, (viewport.h - size.h * view.zoom) / 2 - top);
}

// ---------- 足したカード（下の一覧などで増えた分。光らせる・面の外なら札。置き直さない・保存しない。§5 の 10） ----------

export const ARRIVAL_MS = 12_000; // 札を出している長さ
export const ARRIVAL_FLASH_MS = 1_600; // 光らせる長さ（CSS の is-arrive と同じ）
const EDGE_CHIP_HALF_W = 80; // 札の幅の半分の見込み（面の端に寄せるとき）
const EDGE_CHIP_MARGIN_Y = 14;
const EDGE_CHIP_STEP_Y = 24; // 札が重なるときにずらす量

// 写しに新しく現れた一番上のカード（ボードの中から足した分〈pending にある〉を除く。作った順のまま）
export function arrivedCards(known: ReadonlySet<string>, replies: readonly Reply[], pending: { has(id: string): boolean }): string[] {
  return replies.filter((r) => r.parent === null && !known.has(r.id) && !pending.has(r.id)).map((r) => r.id);
}

export interface EdgeChip {
  arrow: '←' | '→' | '↑' | '↓';
  x: number; // 札の中心（面の左上からの画素）
  y: number;
}

// 札の向きと置き場所。向きは、カードがいちばん大きくはみ出している側。場所はカードの中心を面の中に寄せた所。ほかの札と重なれば下へずらす。size は箱の大きさ（既定は四角）
export function edgeChipAt(view: BoardView, at: { x: number; y: number }, viewport: { w: number; h: number }, placed: readonly { x: number; y: number }[], size: CardSize = BOARD_CARD): EdgeChip {
  const w = size.w * view.zoom;
  const h = size.h * view.zoom;
  const left = at.x * view.zoom + view.x;
  const top = at.y * view.zoom + view.y;
  const over: { arrow: EdgeChip['arrow']; n: number }[] = [
    { arrow: '←', n: Math.max(0, -left) },
    { arrow: '→', n: Math.max(0, left + w - viewport.w) },
    { arrow: '↑', n: Math.max(0, -top) },
    { arrow: '↓', n: Math.max(0, top + h - viewport.h) },
  ];
  let best = over[0];
  for (const o of over) if (o.n > best.n) best = o;
  const arrow = best.n > 0 ? best.arrow : '↓';
  const cx = left + w / 2;
  const cy = top + h / 2;
  const lo = EDGE_CHIP_HALF_W + 6;
  const hi = viewport.w - EDGE_CHIP_HALF_W - 6;
  const loY = EDGE_CHIP_MARGIN_Y;
  const hiY = viewport.h - EDGE_CHIP_MARGIN_Y;
  const x = lo <= hi ? Math.min(hi, Math.max(lo, cx)) : viewport.w / 2;
  let y = loY <= hiY ? Math.min(hiY, Math.max(loY, cy)) : viewport.h / 2;
  while (placed.some((q) => Math.abs(q.x - x) < 130 && Math.abs(q.y - y) < 22)) y += EDGE_CHIP_STEP_Y;
  return { arrow, x, y };
}

// ---------- 面の上に出す文 ----------

export interface BoardNote {
  text: string;
  tone: 'info' | 'warn' | '';
}

// 読み込み状態の文。null は読み込み中。読めない（unreadable）ときは理由つき（boardUnreadableNote）。六角のファイルなら頭に「六角の並びは、」（HX5）
export function boardNote(load: LoadBoardResult | null): BoardNote {
  if (load === null) return { text: BOARD_LOADING_NOTE, tone: 'info' };
  if (load.state === 'unreadable') return { text: `${layoutHead(load.layout)}${boardUnreadableNote(load.why)}`, tone: 'warn' };
  return { text: '', tone: '' };
}

// 読み込みの返りの使い方（HX5。画面の readBoard が使う）：'drop'＝捨てる、'use'＝覚えて使う、'kept'＝返りは捨て、覚え（known）を使う
//   current：読み込みの番・メモ・形がどれも今と同じ。waiting：保存を待っている、またはその鍵の保存が読んだあとに終わった（書いた回数が増えた）。
//   loaded：いまの読み込みがある。kept：その鍵の覚えがある。待っているときは保存のあとの形を上書きしない。ただし読み込み中のままにはしない（覚えか返りを使う）
export type LoadOutcome = 'drop' | 'use' | 'kept';

export function loadOutcome(o: { current: boolean; waiting: boolean; loaded: boolean; kept: boolean }): LoadOutcome {
  if (!o.current) return 'drop';
  if (!o.waiting) return 'use';
  if (o.loaded) return 'drop';
  return o.kept ? 'kept' : 'use';
}

export const boardEmptyText = BOARD_EMPTY_TEXT;