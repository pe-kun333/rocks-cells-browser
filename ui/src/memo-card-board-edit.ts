// ボードでカードを足す・消す・書き直す・タグ・線の計算（B2-3b。DOM も保存も使わない。ui/test/memo-card-board-edit.test.ts）
//   台帳を書くのは左だけ。ここは「左へ送る命令」を組み、送る前の確かめ（断られそうなことは先に文にする）と、送ったあとの確かめ（写しに現れたか）を決める
//   使う命令は既存のもの：addMemoComment（＋replyId。B2-3a）・removeReply・editReply・changeReplyTags・changeReplyLinks。新しい命令は無い
//   画面（ボタン・小窓・メニュー）は app/memo-board-tab.ts。ここで決めるのは：どのボタンが押せるか、足す場所、命令の中身、文
import { BOARD_CARD, BOARD_LIMITS, type BoardView, cleanCoord, screenToBoard } from './memo-card-board';
import type { LoadBoardResult } from './memo-card-board-store';
import { pasteToolNote } from './memo-card-board-paste';
import { ledgerFullNote, loadingNote, unreadableBlockNote } from './memo-card-board-texts';
import { visibleTags } from './grok-cards-tags';
import { cardLabel, changeLinkList, type LinkKind, linkKindInfo, LINK_KINDS, linkSentence, MAX_LINKS_PER_CARD, type ReplyLink } from './memo-card-links';
import { TEMPLATE_MIN_PICK } from './memo-card-template-store';
import { TEMPLATE_LIMITS } from './memo-card-templates';
import { cleanReplyText, MAX_REPLIES, newReplyId, replyIdProblem, type Reply } from './threads';
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
  if (load === null) return loadingNote('足して');
  if (load.state === 'unreadable') return unreadableBlockNote('カードは足せません', load.why);
  if (replies.length >= MAX_REPLIES) return ledgerFullNote('カードを足せません');
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

const overlaps = (a: Pt, b: Pt, size: { w: number; h: number }) => a.x < b.x + size.w && b.x < a.x + size.w && a.y < b.y + size.h && b.y < a.y + size.h;

export const SPOT_RINGS = 24; // 空きを探す輪の数（升目 1 つずつ外へ）

// 新しいカードを置く場所：見ている面（viewport。画素）の中央のカード 1 枚分。ほかのカードに重なるときは、仮の並びと同じ升目（190×96＋隙間）の
//   間隔で、中央に近い順に外へずらして、最初に重ならない所へ。±10,000 の外は使わない。見つからなければ null
export function spotForNewCard(view: BoardView, viewport: { w: number; h: number }, taken: readonly Pt[], size: { w: number; h: number } = BOARD_CARD): Pt | null {
  const c = viewport.w > 0 && viewport.h > 0 ? screenToBoard(view, viewport.w / 2, viewport.h / 2) : { x: size.w / 2, y: size.h / 2 };
  const base = { x: cleanCoord(c.x - size.w / 2), y: cleanCoord(c.y - size.h / 2) };
  const px = BOARD_CARD.w + BOARD_CARD.gap;
  const py = BOARD_CARD.h + BOARD_CARD.gap;
  const lim = BOARD_LIMITS.coord;
  const free = (p: Pt) => Math.abs(p.x) <= lim && Math.abs(p.y) <= lim && !taken.some((t) => overlaps(p, t, size));
  if (free(base)) return base;
  for (let r = 1; r <= SPOT_RINGS; r++) {
    const ring: { dx: number; dy: number }[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push({ dx, dy });
    ring.sort((a, b) => Math.hypot(a.dx * px, a.dy * py) - Math.hypot(b.dx * px, b.dy * py) || a.dy - b.dy || a.dx - b.dx);
    for (const { dx, dy } of ring) {
      const p = { x: base.x + dx * px, y: base.y + dy * py };
      if (free(p)) return p;
    }
  }
  return null;
}

// 足す命令（id は先に決める。B2-3a）。文は台帳と同じに整える（空なら null）
export function addCommand(memoId: string, id: string, text: string): RelayCommand | null {
  const clean = cleanReplyText(text);
  return clean ? { command: 'addMemoComment', id: memoId, text: clean, replyId: id } : null;
}

// 左の写しに、そのカードが一番上のカードとして現れたか
export const cardAppeared = (replies: readonly Reply[], id: string): boolean => topOf(replies, id) !== undefined;

// ---------- 消す ----------

export const deleteLabel = (n: number): string => (n >= 2 ? `${n}枚を削除` : '削除');

export function deleteTitle(n: number): string {
  if (n <= 0) return '先に消すカードを選んでください';
  return `選んだ ${n} 枚のカードを消します（確認はありません。Delete キーでも消せます。Ctrl+Z で元に戻せます）`;
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
  if (ids.length === 0) return { ok: false, note: '先に書き直すカードを選んでください' };
  if (ids.length > 1) return { ok: false, note: '書き直せるのは 1 枚ずつです（1 枚だけ選んでください）' };
  const reply = topOf(replies, ids[0]);
  if (!reply) return { ok: false, note: 'カードがもうありません' };
  if (reply.by) return { ok: false, note: 'AI が書いたカードは書き直せません' };
  return { ok: true, reply };
}

// 書き直す命令。文を空にできるのは、引用か画像があるときだけ（台帳と同じ）。文が変わらないときは null（何もしない）
export function editCommand(memoId: string, reply: Reply, text: string): { ok: true; command: RelayCommand } | { ok: false; note: string } {
  const clean = cleanReplyText(text);
  if (!clean && !reply.quote && !reply.image) return { ok: false, note: '文が空です（空にできるのは、引用か画像のあるカードだけです）' };
  if (clean === reply.text) return { ok: false, note: '文は変わっていません' };
  return { ok: true, command: { command: 'editReply', ref: memoRef(memoId), replyId: reply.id, text: clean } };
}

export const cardTextIs = (replies: readonly Reply[], id: string, text: string): boolean => topOf(replies, id)?.text === cleanReplyText(text);

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
    return { kind: k.kind, name, current, disabled: blocked, ...(current ? { hint: '今の種類' } : k.kind === 'same' && backSame ? { hint: `もう「${name}」です` } : {}) };
  });
}

export type LinkPlan = { ok: true; command: RelayCommand } | { ok: false; note: string };

// 線を足す命令。左と同じ決まり（changeLinkList）で先に確かめ、断られる理由を文にする（グリッドの知らせと同じ文）
export function linkAddPlan(replies: readonly Reply[], memoId: string, from: string, to: string, kind: LinkKind): LinkPlan {
  const a = topOf(replies, from);
  const b = topOf(replies, to);
  if (!a || !b || from === to) return { ok: false, note: '結べませんでした（相手のカードがもう無いか、自分自身です）' };
  const done = changeLinkList(a.links ?? [], [{ to, kind }], [], (target, k) => target !== from && (k !== 'same' || !(b.links ?? []).some((l) => l.to === from && l.kind === 'same')));
  if (done.over) return { ok: false, note: `関連は 1 枚のカードから ${MAX_LINKS_PER_CARD} 本までです（ほかの関連を外してから付けてください）` };
  if (done.refused > 0) return { ok: false, note: 'その相手とは結べませんでした（相手のカードがもう無いか、もう「同じ」でつながっています）' };
  if (done.links === null) return { ok: false, note: `もう関連「${linkKindInfo(kind).name}」で結ばれています` };
  return { ok: true, command: { command: 'changeReplyLinks', id: memoId, replyId: from, add: [{ to, kind }], remove: [] } };
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

// 選びと台帳から、ボタンの押せるか・理由・文。load：ボードの読み込み状態（足すのはそれを見る）
export function toolState(input: { selected: readonly string[]; replies: readonly Reply[]; load: LoadBoardResult | null }): ToolState {
  const ids = liveSelection(input.replies, input.selected);
  const n = ids.length;
  const addNote = addBlockedNote(input.load, input.replies);
  const pasteNote = pasteToolNote(input.load, input.replies);
  const edit = editCheck(input.replies, input.selected);
  const one = n === 1;
  const oneNote = n === 0 ? '先にカードを 1 枚選んでください' : '1 枚だけ選んでください';
  const rels = one ? relationsOf(input.replies, ids[0]) : [];
  return {
    add: { enabled: addNote === null, note: addNote ?? 'いま見ている場所の真ん中に新しいカードを足します' },
    edit: { enabled: edit.ok, note: edit.ok ? '選んだカードの文を書き直します' : edit.note },
    remove: { enabled: n > 0, note: deleteTitle(n), label: deleteLabel(n) },
    tags: n > 0,
    linkAdd: { enabled: one, note: one ? '選んだカードから、別のカードへ関連（線）を引きます' : oneNote },
    paste: { enabled: pasteNote === null, note: pasteNote ?? '型を選んで、いま見ている場所の真ん中に貼ります（貼ったカードは全部選ばれます）' },
    template: { enabled: n >= TEMPLATE_MIN_PICK, note: templateBlockedNote(n) ?? '選んだカードと、そのあいだの関連を、型として登録します（置いた位置も覚えます）' },
    linkRemove: { enabled: one && rels.length > 0, note: !one ? oneNote : rels.length === 0 ? 'このカードにつながる線はありません' : '選んだカードにつながる線を、選んで外します' },
  };
}
// ---------- 型にする（B3-1） ----------

// 型にできない選び方の理由（できるなら null）。2 枚未満は押せない（ボタンが無効）、30 枚を超えるときは押したあとに断る
export function templateBlockedNote(n: number): string | null {
  if (n < TEMPLATE_MIN_PICK) return `${TEMPLATE_MIN_PICK}枚以上選ぶと、型にできます`;
  if (n > TEMPLATE_LIMITS.cards) return `型にできるのは ${TEMPLATE_LIMITS.cards} 枚までです（いま ${n} 枚選んでいます。選び直してください）`;
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