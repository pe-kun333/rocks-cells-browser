// ボードに型を貼る計算（B3-2b。DOM も保存も使わない。ui/test/memo-card-board-paste.test.ts）
//   貼る：型を選ぶと、見ている面の真ん中を基準に「一発で」貼る（ゴーストは作らない）。台帳へは sendReplies（copy・template）に、
//   区画が先に決めた ids（B3-2a）を付けて送る。台帳の写しに貼ったカードが現れてから、座標（基準＋型の dx,dy）を書く（B2-3b の足すと同じ道）
//   ここで決めるのは：貼れるか（断る文）・貼るカードの id・各カードの座標・送る命令。画面（メニュー・空欄の小窓・保存）は app/memo-board-tab.ts
import { t as tr } from './i18n';
import { BOARD_CARD, BOARD_LIMITS, type BoardView, boxesOverlap, type CardSize, cleanCoord, type GridStep, type NodeMove, type Overlaps, screenToBoard, splitNodes, SQUARE_STEP } from './memo-card-board';
import type { Pt } from './memo-card-board-select';
import { centerSpot, type Depth, type SpotAnchor, templateSpots } from './memo-card-board-spots';
import type { LoadBoardResult } from './memo-card-board-store';
import { ledgerFullNote, loadingNote, nodesFullNote, unreadableBlockNote } from './memo-card-board-texts';
import { pasteBlocked } from './memo-card-template-store';
import { type CardTemplate, parseTemplate } from './memo-card-templates';
import { CARD_COLUMNS, MAX_REPLIES, newReplyId, replyIdProblem, type Reply } from './threads';
import type { RelayCommand } from './types';

export const SPOT_GROUP_RINGS = 24; // 空きを探す輪の数（升目 1 つずつ外へ。B2-3b の足すと同じ）

// 型のカードの、基準からの位置（いちばん左・いちばん上を 0 にした差）。
//   dx・dy が全部 0 で 2 枚以上ある型（位置を持たない型）は、仮の並びと同じ升目（3 列・190×96＋隙間 20）に並べる。step は升目の歩み（既定は四角。
//   ずらし shift があれば奇数の段を右へ：六角の噛み合わせ。HX5。六角では今は通らない道：型は六角では押せない。型の dx・dy は四角の歩みで作られているため）
export function pasteOffsets(template: Pick<CardTemplate, 'cards'>, step: GridStep = SQUARE_STEP): Pt[] {
  const cards = template.cards;
  const px = step.x;
  const py = step.y;
  const shift = step.shift ?? 0;
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0);
  const flat = cards.length > 1 && cards.every((c) => num(c.dx) === 0 && num(c.dy) === 0);
  const raw = cards.map((c, i) => {
    const row = Math.floor(i / CARD_COLUMNS);
    return flat ? { x: (i % CARD_COLUMNS) * px + (row % 2 === 1 ? shift : 0), y: row * py } : { x: num(c.dx), y: num(c.dy) };
  });
  if (raw.length === 0) return [];
  const minX = Math.min(...raw.map((p) => p.x));
  const minY = Math.min(...raw.map((p) => p.y));
  return raw.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

// 型のカードの、生の位置の差（いちばん左・いちばん上を 0 にした dx・dy）。pasteOffsets と違い、位置を持たない型を升目に広げない（全部 0 のまま）。
//   基準つきで置くとき（templateSpots。TA1）に、型の中の重なりを見るのに使う。位置を持つ型では pasteOffsets と同じ値
export function rawOffsets(template: Pick<CardTemplate, 'cards'>): Pt[] {
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0);
  const raw = template.cards.map((c) => ({ x: num(c.dx), y: num(c.dy) }));
  if (raw.length === 0) return [];
  const minX = Math.min(...raw.map((p) => p.x));
  const minY = Math.min(...raw.map((p) => p.y));
  return raw.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

// 貼る一団の大きさ（カード 1 枚分を足した外枠）。card はカード 1 枚の箱（既定は四角）
export function groupSize(offsets: readonly Pt[], card: CardSize = BOARD_CARD): { w: number; h: number } {
  if (offsets.length === 0) return { w: card.w, h: card.h };
  return { w: Math.max(...offsets.map((p) => p.x)) + card.w, h: Math.max(...offsets.map((p) => p.y)) + card.h };
}

// 貼る一団の置き場所（基準＝一団の左上）：見ている面（viewport。画素）の中央に一団の中心が来る所。ほかのカード（taken）に 1 枚でも重なる・
//   ±10,000 の外に出るときは、仮の並びと同じ升目（190×96＋隙間）の間隔で、中央に近い順に一団ごと外へずらして、最初の空きへ（上下左右。カード 1 枚の spotForNewCard は右と下を先に探す）。見つからなければ null
//   card・step はカード 1 枚の箱と升目の歩み（既定は四角。HX4・HX5 の geo の口。ずらし shift があれば奇数の段を右へ）、overlaps は重なりの決め方（既定は四角の箱。六角は六角どうし。
//   六角の歩み・重なりで貼るのは、今は通らない道：型は六角では押せない）
export function spotForGroup(view: BoardView, viewport: { w: number; h: number }, taken: readonly Pt[], offsets: readonly Pt[], card: CardSize = BOARD_CARD, step: GridStep = SQUARE_STEP, overlaps: Overlaps = (a, b) => boxesOverlap(a, b, card)): Pt | null {
  const size = groupSize(offsets, card);
  const c = viewport.w > 0 && viewport.h > 0 ? screenToBoard(view, viewport.w / 2, viewport.h / 2) : { x: size.w / 2, y: size.h / 2 };
  const base = { x: cleanCoord(c.x - size.w / 2), y: cleanCoord(c.y - size.h / 2) };
  const px = step.x;
  const py = step.y;
  const shift = step.shift ?? 0;
  const lim = BOARD_LIMITS.coord;
  const free = (o: Pt) =>
    offsets.every((d) => {
      const p = { x: o.x + d.x, y: o.y + d.y };
      return Math.abs(p.x) <= lim && Math.abs(p.y) <= lim && !taken.some((t) => overlaps(p, t));
    });
  if (free(base)) return base;
  for (let r = 1; r <= SPOT_GROUP_RINGS; r++) {
    const ring: { dx: number; dy: number }[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push({ dx, dy });
    ring.sort((a, b) => Math.hypot(a.dx * px, a.dy * py) - Math.hypot(b.dx * px, b.dy * py) || a.dy - b.dy || a.dx - b.dx);
    for (const { dx, dy } of ring) {
      const o = { x: base.x + dx * px + (dy % 2 !== 0 ? shift : 0), y: base.y + dy * py };
      if (free(o)) return o;
    }
  }
  return null;
}

// 「型を貼る ▾」が押せないときの文。押せるなら null。貼るのは位置を保存するのが目的なので、読めない・読み込み中のボードには貼らない（書かない）
export function pasteToolNote(load: LoadBoardResult | null, replies: readonly Reply[]): string | null {
  if (load === null) return loadingNote(tr('貼って'));
  if (load.state === 'unreadable') return unreadableBlockNote(tr('型は貼れません'), load.why, load.layout);
  if (replies.length >= MAX_REPLIES) return ledgerFullNote(tr('型を貼れません'));
  return null;
}

// 貼るカードの id を n 個、先に決める（newReplyId の形。台帳にまだ無く、お互いにも重ならない）。決められなければ null（ほとんど起きない）
export function makeReplyIds(replies: readonly Reply[], n: number, make: () => string = newReplyId, tries = 8): string[] | null {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    let id: string | null = null;
    for (let k = 0; k < tries && id === null; k++) {
      const next = make();
      if (replyIdProblem(replies, next) === null && !ids.includes(next)) id = next;
    }
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
}

// 貼った全部のカードが、左の写しに一番上のカードとして現れたか
export const pastedAppeared = (replies: readonly Reply[], ids: readonly string[]): boolean => {
  const tops = new Set(replies.filter((r) => r.parent === null).map((r) => r.id));
  return ids.length > 0 && ids.every((id) => tops.has(id));
};

export const ANCHOR_FULL_NOTE = tr('置ける空きが見つかりませんでした'); // 基準つきで置けないとき（見ている場所を動かしても変わらないので、括弧の文は付けない）
export const VIEW_FULL_NOTE = tr('置ける空きが見つかりませんでした（見ている場所を動かしてからお試しください）'); // 面の真ん中から置けないとき（基準なし・題の帯から）

// 貼る道に渡す基準（TA1・TA5）。card・point は置き場の計算（SpotAnchor）と同じ。center は「真ん中」とだけ渡し、位置はここで、渡された面と見ている位置から決める
export type PasteAnchor = { kind: 'card'; at: Pt } | { kind: 'point'; at: Pt; corner?: Pt } | { kind: 'center' };
export const pasteDoneText = (name: string, n: number): string => tr('型「{0}」を貼りました（{1} 枚）', { 0: name, 1: n });

export type BoardPastePlan = { ok: true; ids: string[]; moves: NodeMove[]; command: RelayCommand; template: CardTemplate; origin: Pt } | { ok: false; note: string };

export interface BoardPasteInput {
  memoId: string;
  template: unknown; // 貼る型（空欄を埋めたあとのもの）
  replies: readonly Reply[]; // 左の写し（台帳の返信）
  load: LoadBoardResult | null;
  view: BoardView;
  viewport: { w: number; h: number };
  taken: readonly Pt[]; // いまボードに出ているカードの位置（重ならないように避ける）
  card?: CardSize; // カード 1 枚の箱・升目の歩み・重なりの決め方（形ごと。既定は四角。HX5 の geo の口。六角は今は通らない道：型は六角では押せない）
  step?: GridStep;
  overlaps?: Overlaps;
  make?: () => string; // 試験用：id の作り方
  anchor?: PasteAnchor; // 置く基準（TA1：カードの右クリックの「型を足す…」。TA5：空きで押した所・題の帯からの真ん中）。あれば templateSpots で置く。view・viewport を使うのは center だけ
  depth?: Depth; // 型の中の重なりの深さの決め方（形ごと。基準があるときだけ使う。既定は四角の箱）
}

// 型をボードに貼る計画。断るときは理由の文を返し、何も送らず何も書かない。
//   断る：型が読めない／読めない・読み込み中のボード／台帳に入りきらない（300）／ボードの座標が 300 を超える／id を決められない／置ける空きが無い
//   ボードの座標の数は、台帳にあるカードの座標＋貼る枚数で数える（台帳に無いカードの座標＝孤児は、保存のときに先に捨てられる）
// 貼る前の確かめ（断る文か、型と新しい id）。順：型の形→ボードを読めているか→台帳の 300→ボードの座標の 300→id
function checkPaste(input: Pick<BoardPasteInput, 'template' | 'replies' | 'load' | 'make'>): { ok: true; template: CardTemplate; ids: string[] } | { ok: false; note: string } {
  const parsed = parseTemplate(input.template);
  if (!parsed.ok) return { ok: false, note: tr('型を貼れませんでした（型の中身を読めません）') };
  const template = parsed.template;
  const n = template.cards.length;
  const blocked = pasteToolNote(input.load, input.replies);
  if (blocked) return { ok: false, note: blocked };
  const ledger = pasteBlocked(input.replies.length, n);
  if (ledger) return { ok: false, note: ledger };
  const load = input.load;
  if (load === null || load.state === 'unreadable') return { ok: false, note: tr('ボードを読み込めていません') };
  const saved = splitNodes(load.board, input.replies).live.length;
  if (saved + n > BOARD_LIMITS.nodes) {
    return { ok: false, note: nodesFullNote(BOARD_LIMITS.nodes - saved, n) };
  }
  const ids = makeReplyIds(input.replies, n, input.make);
  if (!ids) return { ok: false, note: tr('カードの id を決められませんでした。もう一度お試しください') };
  return { ok: true, template, ids };
}

// やり直し（B3-3b）：元に戻した型の貼り付けを、同じ型・同じ位置（at＝型のカードの順の座標）で貼り直す。id は新しく決める（元の id は台帳に戻らない）。断るときの文は planBoardPaste と同じ
export function planRepaste(input: Pick<BoardPasteInput, 'memoId' | 'template' | 'replies' | 'load' | 'make'> & { at: readonly Pt[] }): { ok: true; ids: string[]; moves: NodeMove[]; command: RelayCommand; template: CardTemplate } | { ok: false; note: string } {
  const checked = checkPaste(input);
  if (!checked.ok) return checked;
  const { template, ids } = checked;
  if (input.at.length !== ids.length) return { ok: false, note: tr('型を貼れませんでした（貼る位置が合いません）') };
  const lim = BOARD_LIMITS.coord;
  if (input.at.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > lim || Math.abs(p.y) > lim)) return { ok: false, note: tr('型を貼れませんでした（貼る位置がボードの外です）') };
  const moves = ids.map((ref, i) => ({ ref, x: input.at[i].x, y: input.at[i].y }));
  const command: RelayCommand = { command: 'sendReplies', from: '', replyIds: [], to: input.memoId, mode: 'copy', template, ids };
  return { ok: true, ids, moves, command, template };
}

export function planBoardPaste(input: BoardPasteInput): BoardPastePlan {
  const checked = checkPaste(input);
  if (!checked.ok) return checked;
  const { template, ids } = checked;
  const command: RelayCommand = { command: 'sendReplies', from: '', replyIds: [], to: input.memoId, mode: 'copy', template, ids };
  if (input.anchor) {
    // 基準つき：型の中に重なりが無ければ形のまま、あれば右と下の升へ順に（計画 §4.1）。origin は 1 枚目の位置
    const from = input.anchor;
    const anchor: SpotAnchor = from.kind === 'center' ? { kind: 'center', at: centerSpot(input.view, input.viewport, input.card) } : from;
    const spots = templateSpots({ raw: rawOffsets(template), anchor, taken: input.taken, step: input.step, overlaps: input.overlaps, depth: input.depth });
    if (!spots || spots.length !== ids.length) return { ok: false, note: from.kind === 'center' ? VIEW_FULL_NOTE : ANCHOR_FULL_NOTE };
    return { ok: true, ids, moves: ids.map((ref, i) => ({ ref, x: spots[i].x, y: spots[i].y })), command, template, origin: spots[0] };
  }
  const offsets = pasteOffsets(template, input.step);
  const origin = spotForGroup(input.view, input.viewport, input.taken, offsets, input.card, input.step, input.overlaps);
  if (!origin) return { ok: false, note: VIEW_FULL_NOTE };
  const moves = ids.map((ref, i) => ({ ref, x: origin.x + offsets[i].x, y: origin.y + offsets[i].y }));
  return { ok: true, ids, moves, command, template, origin };
}