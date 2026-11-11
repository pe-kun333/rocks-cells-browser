// ボードでカードを足す・消す・書き直す・タグ・線の計算（B2-3b。DOM も保存も使わない。ui/test/memo-card-board-edit.test.ts）
//   台帳を書くのは左だけ。ここは「左へ送る命令」を組み、送る前の確かめ（断られそうなことは先に文にする）と、送ったあとの確かめ（写しに現れたか）を決める
//   使う命令は既存のもの：addMemoComment（＋replyId。B2-3a）・removeReply・editReply・changeReplyTags・changeReplyLinks。新しい命令は無い
//   画面（ボタン・小窓・メニュー）は app/memo-board-tab.ts。ここで決めるのは：どのボタンが押せるか、足す場所、命令の中身、文
import { t as tr } from './i18n';
import { BOARD_CARD, BOARD_LIMITS, type BoardLayout, type BoardView, boxesOverlap, cleanCoord, type GridStep, type Overlaps, SQUARE_STEP } from './memo-card-board';
import type { LoadBoardResult } from './memo-card-board-store';
import { boxVisibleRatio, READ_PAD } from './memo-card-board-view';
import { pasteToolNote } from './memo-card-board-paste';
import { centerSpot, ringSpot, spotAt } from './memo-card-board-spots';
import { ledgerFullNote, loadingNote, unreadableBlockNote } from './memo-card-board-texts';
import { visibleTags } from './grok-cards-tags';
import { cardLabel, changeLinkList, isLinkKind, type LinkKind, linkKindInfo, LINK_KINDS, linkSentence, MAX_LINKS_PER_CARD, type ReplyLink } from './memo-card-links';
import { TEMPLATE_MIN_PICK } from './memo-card-template-store';
import { TEMPLATE_LIMITS } from './memo-card-templates';
import { cleanReplyText, createdTops, MAX_REPLIES, newReplyId, replyIdProblem, type Reply } from './threads';
import type { RelayCommand } from './types';

export interface Pt {
  x: number;
  y: number;
}

const memoRef = (memoId: string) => ({ kind: 'memo' as const, id: memoId });
const topOf = (replies: readonly Reply[], id: string) => replies.find((r) => r.id === id && r.parent === null);

// 選んでいる id のうち、台帳の一番上のカードにあるもの（選んだ順のまま。重なりは除く）
export function liveSelection(replies: readonly Reply[], selected: readonly string[]): string[] {
  const tops = new Set(replies.filter((r) => r.parent === null).map((r) => r.id));
  return [...new Set(selected)].filter((id) => tops.has(id));
}

// ---------- 足す ----------

// カードを足せないときの文。足せるなら null。足すのは位置を保存するのが目的なので、読めない・読み込み中のボードには足さない（書かない）
export function addBlockedNote(load: LoadBoardResult | null, replies: readonly Reply[]): string | null {
  if (load === null) return loadingNote(tr('足して'));
  if (load.state === 'unreadable') return unreadableBlockNote(tr('カードは足せません'), load.why, load.layout);
  if (replies.length >= MAX_REPLIES) return ledgerFullNote(tr('カードを足せません'));
  return null;
}

// 新しいカードの id（newReplyId の形。台帳にまだ無いもの）。作れなければ null（ほとんど起きない）
export function makeReplyId(replies: readonly Reply[], make: () => string = newReplyId, tries = 8): string | null {
  for (let i = 0; i < tries; i++) {
    const id = make();
    if (replyIdProblem(replies, id) === null) return id;
  }
  return null;
}

export const SPOT_RINGS = 24; // 空きを探す輪の数（升目 1 つずつ外へ）

// 新しいカードを置く場所：見ている面（viewport。画素）の中央のカード 1 枚分。ほかのカードに重なるときは、仮の並びと同じ升目（190×96＋隙間）の
//   間隔で、右と下へずらして、最初に重ならない所へ（上や左へは出さない。2026-11-04、利用者の依頼）。升目の歩数が少ない順で、同じなら右を先に。
//   右と下が ±10,000 の外で使えないときだけ、上と左も中央に近い順に探す。±10,000 の外は使わない。見つからなければ null
//   size は箱の大きさ（真ん中）、step は升目の歩み（既定は四角の 210×116。ずらし shift があれば奇数の段を右へ：六角の噛み合わせ。HX4・HX5 の geo の口）、
//   overlaps は重なりの決め方（既定は四角の箱の重なり。六角は六角どうし。HX5）
export function spotForNewCard(view: BoardView, viewport: { w: number; h: number }, taken: readonly Pt[], size: { w: number; h: number } = BOARD_CARD, step: GridStep = SQUARE_STEP, overlaps: Overlaps = (a, b) => boxesOverlap(a, b, size)): Pt | null {
  // 探し方は memo-card-board-spots.ts（centerSpot・ringSpot）。型を置く升の順（spotsRightDown）と同じ輪の順を使う（TA1。答えは今までと同じ）
  return ringSpot(centerSpot(view, viewport, size), taken, step, overlaps, SPOT_RINGS);
}

// 新しいカードを、あるカード（anchor の左上）の右（right）か下（down）に置く場所：升目（190×96＋隙間）1 つずつその向きへ進み、
//   ほかのカードに重ならない最初の所へ。±10,000 の外・SPOT_RINGS 歩より先は使わない。見つからなければ null。grid は升目の歩み（既定は四角）、overlaps は重なりの決め方
//   升目にずらし（grid.shift。六角の 83）があるときの下（HX5。Shift+Enter）：k＝1〜24 の各歩で、k が奇数なら (x＋shift, y＋歩み×k) と (x−shift, y＋歩み×k)、
//   偶数なら (x, y＋歩み×k)。奇数の歩の二つは、起点の行（round(y÷歩み)）が偶数なら右下を先、奇数なら左下を先（続けて押すと縦のジグザグの 1 列になる）。
//   左下は「下」に数える（2026-11-04 の「上や左へは出さない」の中）。ずらしの無い四角は今のまま（同じ x の真下）
export function spotBeside(anchor: Pt, dir: 'right' | 'down', taken: readonly Pt[], size: { w: number; h: number } = BOARD_CARD, grid: GridStep = SQUARE_STEP, overlaps: Overlaps = (a, b) => boxesOverlap(a, b, size)): Pt | null {
  const step = dir === 'right' ? { x: grid.x, y: 0 } : { x: 0, y: grid.y };
  const shift = dir === 'down' ? (grid.shift ?? 0) : 0;
  const row = Math.round(anchor.y / grid.y);
  const rightFirst = ((row % 2) + 2) % 2 === 0;
  const lim = BOARD_LIMITS.coord;
  for (let k = 1; k <= SPOT_RINGS; k++) {
    const raw = { x: anchor.x + step.x * k, y: anchor.y + step.y * k };
    if (Math.abs(raw.x) > lim || Math.abs(raw.y) > lim) return null;
    const sides = shift !== 0 && k % 2 === 1 ? (rightFirst ? [shift, -shift] : [-shift, shift]) : [0];
    for (const dx of sides) {
      if (Math.abs(raw.x + dx) > lim) continue;
      const p = { x: cleanCoord(raw.x + dx), y: cleanCoord(raw.y) };
      if (!taken.some((t) => overlaps(p, t))) return p;
    }
  }
  return null;
}

// ［決める］（向きの無い足し方）の置き場（HX2）：最後に書いたカード（last の左上）が面に半分より多く見えていれば、その右（x＋210、同じ y）。
//   右が面の見えている幅を超えるか、ふさがっていれば、その下（同じ x、y＋116）。それもふさがっていれば null（呼ぶ側が spotForNewCard へ）
//   上や左へは出さない（2026-11-04、利用者の依頼）。±10,000 の外は使わない。view・viewport は書く欄を閉じたあとの面。step は升目の歩み（既定は四角）、overlaps は重なりの決め方
//   升目にずらし（step.shift。六角の 83）があるとき（HX5）：右は x＋166、下は右下（x＋shift, y＋144）を先、次に左下（x−shift, y＋144）。左下は「下」に数える。
//   右下・左下も、右と同じく面の見えている幅の中に入る所だけ（見本の決まり。ずらしの無い四角の下は今のまま幅を見ない）
export function spotNextToLast(view: BoardView, viewport: { w: number; h: number }, last: Pt | null, taken: readonly Pt[], size: { w: number; h: number } = BOARD_CARD, step: GridStep = SQUARE_STEP, overlaps: Overlaps = (a, b) => boxesOverlap(a, b, size)): Pt | null {
  if (!last || boxVisibleRatio(view, { x: last.x, y: last.y, w: size.w, h: size.h }, viewport) <= 0.5) return null;
  const lim = BOARD_LIMITS.coord;
  const free = (p: Pt) => Math.abs(p.x) <= lim && Math.abs(p.y) <= lim && !taken.some((t) => overlaps(p, t));
  const right = { x: last.x + step.x, y: last.y };
  const inWidth = (right.x + size.w) * view.zoom + view.x <= viewport.w - READ_PAD + 1e-6;
  if (inWidth && free(right)) return right;
  const shift = step.shift ?? 0;
  if (shift === 0) {
    const down = { x: last.x, y: last.y + step.y };
    return free(down) ? down : null;
  }
  const within = (p: Pt) => p.x * view.zoom + view.x >= READ_PAD - 1e-6 && (p.x + size.w) * view.zoom + view.x <= viewport.w - READ_PAD + 1e-6;
  for (const p of [{ x: last.x + shift, y: last.y + step.y }, { x: last.x - shift, y: last.y + step.y }]) if (within(p) && free(p)) return p;
  return null;
}

// 書く欄で足すカードの置き場（HX2）。dir（Ctrl+Enter＝右・Shift+Enter＝下）があれば、選んだ 1 枚（anchor）の横 → 真ん中から（spotForNewCard）。最後に書いたカードは使わない
//   dir が無い（［決める］）なら、最後に書いたカード（last）の右・下（spotNextToLast）→ 真ん中から。view・viewport は書く欄を閉じたあとの面。見つからなければ null
//   size・step・overlaps は箱の大きさと升目の歩みと重なりの決め方（既定は四角。HX4・HX5 の geo の口）
//   besideFallback：dir があって横に置けない（24 歩で見つからない・選んだ 1 枚が無い）ときの置き方。'center'（既定・四角）は真ん中から、
//   'last'（六角。HX5）は［決める］と同じ置き方（最後に書いたカードの右・下 → 真ん中から）
//   at（左上。TA4a）：空きで押した所に置く（spotAt）。向き・選んだ 1 枚・最後に書いたカードは見ない。そこから探しても置けないときだけ、上の今の決まりで置く
export function addSpot(input: { at?: Pt; dir?: 'right' | 'down'; anchor?: Pt; last: Pt | null; view: BoardView; viewport: { w: number; h: number }; taken: readonly Pt[]; size?: { w: number; h: number }; step?: GridStep; overlaps?: Overlaps; besideFallback?: 'center' | 'last' }): Pt | null {
  const { dir, anchor, last, view, viewport, taken } = input;
  const size = input.size ?? BOARD_CARD;
  const step = input.step ?? SQUARE_STEP;
  const overlaps = input.overlaps ?? ((a: Pt, b: Pt) => boxesOverlap(a, b, size));
  const here = input.at ? spotAt(input.at, taken, step, overlaps) : null;
  if (here) return here;
  const center = () => spotForNewCard(view, viewport, taken, size, step, overlaps);
  const byLast = () => spotNextToLast(view, viewport, last, taken, size, step, overlaps) ?? center();
  if (dir) return (anchor ? spotBeside(anchor, dir, taken, size, step, overlaps) : null) ?? (input.besideFallback === 'last' ? byLast() : center());
  return byLast();
}

// 足す置き場で避ける位置（addSpot の taken。HX5）：描いている位置（pos）と、保存を待っていてまだ描いていない位置（pending にあって pos に無いもの）。
//   足した結果を待つ間に続けて Ctrl+Enter・Shift+Enter で足すと、先のカードはまだ台帳に無いので描いていない。それも避けないと同じ所に二枚が重なる
export function takenSpots(pos: ReadonlyMap<string, Pt>, pending: ReadonlyMap<string, Pt>): Pt[] {
  const out = [...pos.values()].map((p) => ({ x: p.x, y: p.y }));
  for (const [ref, p] of pending) if (!pos.has(ref)) out.push({ x: p.x, y: p.y });
  return out;
}

// ---------- 書く欄の高さ（HX2。上の区画だけ） ----------

export const COMPOSE_LINE_PX = 18; // 上の区画の書く欄の 1 行の高さ（CSS の line-height と同じ）
export const COMPOSE_ROWS_MAX = 3; // 伸ばすのはここまで（あとは欄の中で送る）
const COMPOSE_TEXT_PAD = 4 + 4; // 上下の余白（CSS の padding 4px）
const COMPOSE_TEXT_BORDER = 1 + 1; // 上下の枠（CSS の border 1px）

// 上の区画の書く欄の高さ（画素。枠を含む）：字の高さ（scrollHeight。余白を含み、枠を含まない）に枠を足し、1 行から COMPOSE_ROWS_MAX 行の間に収める
export function composeTextHeight(scrollHeight: number): number {
  const min = COMPOSE_LINE_PX + COMPOSE_TEXT_PAD + COMPOSE_TEXT_BORDER;
  const max = COMPOSE_LINE_PX * COMPOSE_ROWS_MAX + COMPOSE_TEXT_PAD + COMPOSE_TEXT_BORDER;
  if (!Number.isFinite(scrollHeight)) return min;
  return Math.min(max, Math.max(min, Math.ceil(scrollHeight + COMPOSE_TEXT_BORDER)));
}

// 足す命令（id は先に決める。B2-3a）。文は台帳と同じに整える（空なら null）
export function addCommand(memoId: string, id: string, text: string): RelayCommand | null {
  const clean = cleanReplyText(text);
  return clean ? { command: 'addMemoComment', id: memoId, text: clean, replyId: id } : null;
}

// 左の写しに、そのカードが一番上のカードとして現れたか
export const cardAppeared = (replies: readonly Reply[], id: string): boolean => topOf(replies, id) !== undefined;

// ---------- 消す ----------

export const deleteLabel = (n: number): string => (n >= 2 ? tr('{0}枚を削除', { 0: n }) : tr('削除'));

export function deleteTitle(n: number): string {
  if (n <= 0) return tr('先に消すカードを選んでください');
  return tr('選んだ {0} 枚のカードを消します（確認はありません。Delete キーでも消せます。Ctrl+Z で元に戻せます）', { 0: n });
}

// 消す命令（一番上のカードだけ。下の返信も一緒に消える）。ボード上の位置は孤児として残る（B4 の整理で消す）
//   undoToken（B3-3b）：付けると左が消す前の返信全体を控え、restoreReplies で戻せる（何枚かを一度に消すときは全部に同じ token。左が 1 件にまとめる）
export function deleteCommands(memoId: string, replies: readonly Reply[], ids: readonly string[], undoToken?: string): RelayCommand[] {
  return liveSelection(replies, ids).map((replyId) => ({ command: 'removeReply', ref: memoRef(memoId), replyId, ...(undoToken !== undefined ? { undoToken } : {}) }));
}

export const cardsGone = (replies: readonly Reply[], ids: readonly string[]): boolean => ids.every((id) => !replies.some((r) => r.id === id));

// ---------- 書き直す（1 枚だけ。使う人のカードだけ） ----------

export type EditCheck = { ok: true; reply: Reply } | { ok: false; note: string };

// 書き直せるか：1 枚だけ・一番上のカード・使う人のカード（AI の返信は書き直せない＝左も断る）
export function editCheck(replies: readonly Reply[], selected: readonly string[]): EditCheck {
  const ids = liveSelection(replies, selected);
  if (ids.length === 0) return { ok: false, note: tr('先に書き直すカードを選んでください') };
  if (ids.length > 1) return { ok: false, note: tr('書き直せるのは 1 枚ずつです（1 枚だけ選んでください）') };
  const reply = topOf(replies, ids[0]);
  if (!reply) return { ok: false, note: tr('カードがもうありません') };
  if (reply.by) return { ok: false, note: tr('AI が書いたカードは書き直せません') };
  return { ok: true, reply };
}

// 書き直す命令。文を空にできるのは、引用か画像があるときだけ（台帳と同じ）。文が変わらないときは null（何もしない）
export function editCommand(memoId: string, reply: Reply, text: string): { ok: true; command: RelayCommand } | { ok: false; note: string } {
  const clean = cleanReplyText(text);
  if (!clean && !reply.quote && !reply.image) return { ok: false, note: tr('文が空です（空にできるのは、引用か画像のあるカードだけです）') };
  if (clean === reply.text) return { ok: false, note: tr('文は変わっていません') };
  return { ok: true, command: { command: 'editReply', ref: memoRef(memoId), replyId: reply.id, text: clean } };
}

export const cardTextIs = (replies: readonly Reply[], id: string, text: string): boolean => topOf(replies, id)?.text === cleanReplyText(text);

// ---------- 断られた文を書く欄へ戻す ----------

export type ComposeMode = { kind: 'add' } | { kind: 'edit'; id: string };

// いま欄へ戻してよいか。欄が閉じている・足す欄が空のまま開いているなら戻す。書いている最中は待つ（書きかけを壊さない・変換を切らない）。書き直す欄は空でも待つ（どのカードの文かが替わってしまう）
export function canReturnDraft(open: ComposeMode | null, current: string): boolean {
  return open === null || (open.kind === 'add' && current.trim() === '');
}

// 戻す欄の種類。書き直すカードがもう無ければ足す欄へ（書き直す欄のままだと、決めたときに「カードがもうありません」で文が消える）
export function returnMode(mode: ComposeMode, replies: readonly Reply[]): ComposeMode {
  return mode.kind === 'edit' && !cardAppeared(replies, mode.id) ? { kind: 'add' } : mode;
}

// ---------- タグ（選んだ全部に） ----------

// 選んだカードに付いているタグ（機械タグは出さない）。多くのカードに付いているものが先、同じ数なら先に見つけた順
export function unionTags(replies: readonly Reply[], ids: readonly string[]): string[] {
  const count = new Map<string, number>();
  for (const id of liveSelection(replies, ids)) {
    for (const tag of visibleTags(topOf(replies, id)?.tags ?? [])) count.set(tag, (count.get(tag) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

// タグを付ける・外す命令（選んだカード 1 枚につき 1 つ。足し引きの差分。左がその時のタグに当てて、10 個の上限を守る）
export function tagCommands(memoId: string, replies: readonly Reply[], ids: readonly string[], add: readonly string[], remove: readonly string[]): RelayCommand[] {
  if (add.length === 0 && remove.length === 0) return [];
  return liveSelection(replies, ids).map((replyId) => ({ command: 'changeReplyTags', id: memoId, replyId, add: [...add], remove: [...remove] }));
}

// 1 枚のカードに付けられるか（上限の 10 個）を、送る前に確かめる：付けられない（もう上限）カードの数
export function tagFullCount(replies: readonly Reply[], ids: readonly string[], tag: string, max: number): number {
  return liveSelection(replies, ids).filter((id) => {
    const tags = topOf(replies, id)?.tags ?? [];
    return !tags.includes(tag) && tags.length >= max;
  }).length;
}

// ---------- 線（1 枚を選んで足す・外す） ----------

export interface KindChoice {
  kind: LinkKind;
  name: string;
  current: boolean; // いまの種類
  disabled: boolean; // 逆向きの「同じ」がもうあるとき
  hint?: string;
}

// 相手を決めたときの、6 つの種類の選び方（元は一番上のカード、相手も一番上のカード・元と別）。結べない組なら null
export function kindChoices(replies: readonly Reply[], from: string, to: string): KindChoice[] | null {
  const a = topOf(replies, from);
  const b = topOf(replies, to);
  if (!a || !b || from === to) return null;
  const now = a.links?.find((l) => l.to === to)?.kind;
  const backSame = (b.links ?? []).some((l) => l.to === from && l.kind === 'same');
  return LINK_KINDS.map((k) => {
    const name = linkKindInfo(k.kind).name;
    const current = now === k.kind;
    const blocked = k.kind === 'same' && backSame && now !== 'same';
    return { kind: k.kind, name, current, disabled: blocked, ...(current ? { hint: tr('今の種類') } : k.kind === 'same' && backSame ? { hint: tr('もう「{0}」です', { 0: name }) } : {}) };
  });
}

export type LinkPlan = { ok: true; command: RelayCommand } | { ok: false; note: string };

// 足すと同時に引く線（CB13）。Ctrl+Enter・Shift+Enter で、選んだカードの横へ足すときだけ（［決める］では引かない）。
//   向きは 前のカード（選んでいたカード）→ 新しいカード（確認 2 の答え。今の引き方のまま）
export function addLinkFrom(o: { dir?: 'right' | 'down'; anchor?: string; kind: LinkKind | '' }): { from: string; kind: LinkKind } | null {
  return o.dir && o.anchor !== undefined && o.kind !== '' ? { from: o.anchor, kind: o.kind } : null;
}

// 線を足す命令。左と同じ決まり（changeLinkList）で先に確かめ、断られる理由を文にする（グリッドの知らせと同じ文）
export function linkAddPlan(replies: readonly Reply[], memoId: string, from: string, to: string, kind: LinkKind): LinkPlan {
  const a = topOf(replies, from);
  const b = topOf(replies, to);
  if (!a || !b || from === to) return { ok: false, note: tr('結べませんでした（相手のカードがもう無いか、自分自身です）') };
  const done = changeLinkList(a.links ?? [], [{ to, kind }], [], (target, k) => target !== from && (k !== 'same' || !(b.links ?? []).some((l) => l.to === from && l.kind === 'same')));
  if (done.over) return { ok: false, note: tr('関連は 1 枚のカードから {0} 本までです（ほかの関連を外してから付けてください）', { 0: MAX_LINKS_PER_CARD }) };
  if (done.refused > 0) return { ok: false, note: tr('その相手とは結べませんでした（相手のカードがもう無いか、もう「同じ」でつながっています）') };
  if (done.links === null) return { ok: false, note: tr('もう関連「{0}」で結ばれています', { 0: linkKindInfo(kind).name }) };
  return { ok: true, command: { command: 'changeReplyLinks', id: memoId, replyId: from, add: [{ to, kind }], remove: [] } };
}

// 下の欄から足したカードに引く線（CC3。つなぐ ▾）。photo：拡大で見ている写真のカードから引く
export interface AddedLinkFrom {
  from: string;
  kind: LinkKind;
  photo?: true;
}

export type AddedLink = { ok: true; from: string; kind: LinkKind } | { ok: false; note: string };

// 左が足した直後に呼ぶ。replies は足したあとの並び、to は足したカード。頼まれていない・形が違うときは null（線は引かず、何も知らせない）
//   from は区画の見込み（写しの時点の最新）。足す前の直前のカードと違えば引かない（写しの遅れの間に続けて足した・ボードや写真が別のカードを足した）
export function addedLinkPlan(raw: unknown, replies: readonly Reply[], memoId: string, to: string): AddedLink | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { from, kind, photo } = raw as { from?: unknown; kind?: unknown; photo?: unknown };
  if (typeof from !== 'string' || !isLinkKind(kind)) return null;
  if (photo !== true && createdTops(replies.filter((r) => r.id !== to)).at(-1)?.id !== from) {
    return { ok: false, note: tr('直前のカードが替わったので、線は引きませんでした') };
  }
  const plan = linkAddPlan(replies, memoId, from, to, kind);
  return plan.ok ? { ok: true, from, kind } : { ok: false, note: tr('カードは足しましたが線は引けませんでした（{0}）', { 0: plan.note }) };
}

export interface Relation {
  source: string; // 線を持っている元のカード（外すときの replyId）
  other: string; // 線の反対側のカード
  kind: LinkKind;
  outgoing: boolean; // このカードから出る線
  sentence: string; // 「A は B の根拠」
}

// このカードにつながる線（出る線が先、来る線があと。作った順）。外す相手を選ぶ一覧に使う
export function relationsOf(replies: readonly Reply[], id: string): Relation[] {
  const me = topOf(replies, id);
  if (!me) return [];
  const label = (r: Reply) => cardLabel(r, 12);
  const out: Relation[] = [];
  const tops = replies.filter((r) => r.parent === null);
  for (const l of me.links ?? []) {
    const other = tops.find((r) => r.id === l.to);
    if (other && other.id !== id) out.push({ source: id, other: other.id, kind: l.kind, outgoing: true, sentence: linkSentence(label(me), label(other), l.kind) });
  }
  for (const r of tops) {
    if (r.id === id) continue;
    for (const l of r.links ?? []) if (l.to === id) out.push({ source: r.id, other: r.id, kind: l.kind, outgoing: false, sentence: linkSentence(label(r), label(me), l.kind) });
  }
  return out;
}

// 線を外す命令（外すのは、同じ相手・同じ種類だけ。左がそう決めている）
export function linkRemoveCommand(memoId: string, rel: Relation, self: string): RelayCommand {
  const to = rel.outgoing ? rel.other : self;
  const link: ReplyLink = { to, kind: rel.kind };
  return { command: 'changeReplyLinks', id: memoId, replyId: rel.source, add: [], remove: [link] };
}

export const linkIs = (replies: readonly Reply[], from: string, to: string, kind: LinkKind): boolean => topOf(replies, from)?.links?.some((l) => l.to === to && l.kind === kind) === true;

// ---------- ボタンの状態 ----------

export interface ToolButton {
  enabled: boolean;
  note: string; // 押せないときの理由（title に出す）。押せるなら説明
}

export interface ToolState {
  add: ToolButton;
  edit: ToolButton;
  remove: ToolButton & { label: string };
  tags: boolean; // タグの行を出すか（選んだカードがあるとき）
  linkAdd: ToolButton;
  linkRemove: ToolButton;
  template: ToolButton;
  paste: ToolButton; // 型を貼る ▾（B3-2b。選びには関係しない）
}

// 六角の表示（HX4・HX5）で押せないボタンの文。型は四角の並びの位置（四角の歩み）で作られているので、六角では貼る・型にするを押せない
export const HEX_TEMPLATE_NOTE = tr('六角の表示では、ここからは型にできません（カードの右クリックの「型を足す…」か、四角に戻すと使えます）');
export const HEX_PASTE_NOTE = tr('六角の表示では、ここからは型を貼れません（カードの右クリックの「型を足す…」か、四角に戻すと使えます）');

// 選びと台帳から、ボタンの押せるか・理由・文。load：ボードの読み込み状態（足すのはそれを見る）。layout：いまの形（六角では型の 2 つを押せない。既定は四角）
//   足す置き場の決まりは、四角と六角で同じ言い方（六角の「下」は右下か左下。HX5）
export function toolState(input: { selected: readonly string[]; replies: readonly Reply[]; load: LoadBoardResult | null; layout?: BoardLayout }): ToolState {
  const ids = liveSelection(input.replies, input.selected);
  const n = ids.length;
  const hex = input.layout === 'hex';
  const addNote = addBlockedNote(input.load, input.replies);
  const pasteNote = hex ? HEX_PASTE_NOTE : pasteToolNote(input.load, input.replies);
  const edit = editCheck(input.replies, input.selected);
  const one = n === 1;
  const oneNote = n === 0 ? tr('先にカードを 1 枚選んでください') : tr('1 枚だけ選んでください');
  const rels = one ? relationsOf(input.replies, ids[0]) : [];
  return {
    add: { enabled: addNote === null, note: addNote ?? tr('新しいカードを足します（最後に書いたカードが見えていればその右か下、見えていなければいま見ている場所の真ん中に）') },
    edit: { enabled: edit.ok, note: edit.ok ? tr('選んだカードの文を書き直します') : edit.note },
    remove: { enabled: n > 0, note: deleteTitle(n), label: deleteLabel(n) },
    tags: n > 0,
    linkAdd: { enabled: one, note: one ? tr('選んだカードから、別のカードへ関連（線）を引きます') : oneNote },
    paste: { enabled: pasteNote === null, note: pasteNote ?? tr('型を選んで、いま見ている場所の真ん中に貼ります（貼ったカードは全部選ばれます）') },
    template: hex ? { enabled: false, note: HEX_TEMPLATE_NOTE } : { enabled: n >= TEMPLATE_MIN_PICK, note: templateBlockedNote(n) ?? tr('選んだカードと、そのあいだの関連を、型として登録します（置いた位置も覚えます）') },
    linkRemove: { enabled: one && rels.length > 0, note: !one ? oneNote : rels.length === 0 ? tr('このカードにつながる線はありません') : tr('選んだカードにつながる線を、選んで外します') },
  };
}
// ---------- 型にする（B3-1） ----------

// 型にできない選び方の理由（できるなら null）。2 枚未満は押せない（ボタンが無効）、30 枚を超えるときは押したあとに断る
export function templateBlockedNote(n: number): string | null {
  if (n < TEMPLATE_MIN_PICK) return tr('{0}枚以上選ぶと、型にできます', { 0: TEMPLATE_MIN_PICK });
  if (n > TEMPLATE_LIMITS.cards) return tr('型にできるのは {0} 枚までです（いま {1} 枚選んでいます。選び直してください）', { 0: TEMPLATE_LIMITS.cards, 1: n });
  return null;
}

// ボードの座標から、型の配置（dx・dy）を作る：選んだカードのうち、いちばん左・いちばん上を 0 にした差（ボードのカードの大きさは型の目安と同じ）。
//   位置の分からないカードが 1 枚でもあれば null（呼ぶ側は番地から作る道へ戻る）
export function templateOffsets(ids: readonly string[], pos: ReadonlyMap<string, Pt>): Record<string, { dx: number; dy: number }> | null {
  const pts: [string, Pt][] = [];
  for (const id of ids) {
    const at = pos.get(id);
    if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return null;
    pts.push([id, at]);
  }
  if (pts.length === 0) return null;
  const minX = Math.min(...pts.map(([, p]) => p.x));
  const minY = Math.min(...pts.map(([, p]) => p.y));
  const out: Record<string, { dx: number; dy: number }> = {};
  for (const [id, p] of pts) out[id] = { dx: Math.round(p.x - minX), dy: Math.round(p.y - minY) };
  return out;
}