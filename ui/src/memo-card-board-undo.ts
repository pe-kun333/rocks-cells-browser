// ボードの元に戻す・やり直しの計算（B3-3b。DOM も保存も使わない。ui/test/memo-card-board-undo.test.ts）
//   積み（UndoStack）：移動・足す・消す・線・型の貼り付けを 50 回まで。メモを切り替えたら捨てる（画面側の clear）。新しい操作を積むと「やり直し」の積みは空になる
//   戻し方（QB8・計画書 §9）：移動＝座標を戻す／足す＝そのカード（事前に決めた id）を removeReply（undoToken なし）／消す＝restoreReplies（B3-3a。削除のたびの undoToken）／
//   線＝逆の changeReplyLinks／型の貼り付け＝undoSendReplies（既存）。やり直し：移動＝座標／足す＝同じ id で足し直す／消す＝新しい undoToken で消し直す／線＝もう一度／貼り付け＝貼り直し（id は新しい）
//   ここで決めるのは：積みの動き・命令の中身・確かめ（写しにどうなれば成功か）・ボタンの文。台帳を書くのは左だけ（命令を送るだけ）。画面は app/memo-board-tab.ts
import type { NodeMove } from './memo-card-board';
import type { LoadBoardResult } from './memo-card-board-store';
import type { Pt } from './memo-card-board-select';
import { loadingNote, unreadableBlockNote } from './memo-card-board-texts';
import type { LinkKind } from './memo-card-links';
import type { CardTemplate } from './memo-card-templates';
import type { Reply } from './threads';
import type { RelayCommand } from './types';

export const UNDO_LIMIT = 50; // 戻せる回数（やり直しの積みも同じ数まで）

export const UNDO_STALE_NOTE = '戻せませんでした（そのあとにメモが変わっています）';
export const REDO_STALE_NOTE = 'やり直せませんでした（そのあとにメモが変わっています）';
export const UNDO_EMPTY_NOTE = '戻せる操作がありません';
export const REDO_EMPTY_NOTE = 'やり直せる操作がありません';

export type UndoOp =
  | { kind: 'move'; moves: { ref: string; from: Pt; to: Pt }[] }
  | { kind: 'add'; id: string; text: string; at: Pt }
  | { kind: 'remove'; ids: string[]; at: Record<string, Pt>; token: string } // token：消したときに付けた undoToken（restoreReplies で使う）。at：消す前の座標
  | { kind: 'link'; from: string; to: string; before: LinkKind | null; after: LinkKind | null } // from→to の線の種類（無ければ null）の、操作の前と後
  | { kind: 'paste'; template: CardTemplate; ids: string[]; at: Pt[]; token: string | null }; // at：貼ったカードの座標（ids と同じ順）。token：左が返した undoSend の印（まだ届かなければ null）

export type UndoDir = 'undo' | 'redo';

export class UndoStack {
  private done: UndoOp[] = [];
  private undone: UndoOp[] = [];
  private ver = 0;

  // 積みの版（新しい操作を積む・捨てるたびに変わる）。戻している最中に新しい操作が入ったかを見る
  get version(): number {
    return this.ver;
  }

  get undoCount(): number {
    return this.done.length;
  }

  get redoCount(): number {
    return this.undone.length;
  }

  // 新しい操作を積む（やり直しの積みは空になる。UNDO_LIMIT を超えたら古いものから捨てる）
  push(op: UndoOp) {
    this.done.push(op);
    if (this.done.length > UNDO_LIMIT) this.done.splice(0, this.done.length - UNDO_LIMIT);
    this.undone = [];
    this.ver += 1;
  }

  // 積み（やり直しも含む）に、この種類の操作が 1 つでも残っているか（整理の確認に一言添えるため）
  has(kinds: readonly UndoOp['kind'][]): boolean {
    return this.done.some((o) => kinds.includes(o.kind)) || this.undone.some((o) => kinds.includes(o.kind));
  }

  clear() {
    this.done = [];
    this.undone = [];
    this.ver += 1;
  }

  peekUndo(): UndoOp | null {
    return this.done[this.done.length - 1] ?? null;
  }

  peekRedo(): UndoOp | null {
    return this.undone[this.undone.length - 1] ?? null;
  }

  // 戻す・やり直す操作を積みから取り出す（成功したら finish で反対側へ。失敗したらそのまま捨てる＝その 1 件だけ積みから外れる）
  take(dir: UndoDir): UndoOp | null {
    return (dir === 'undo' ? this.done : this.undone).pop() ?? null;
  }

  // 取り出した操作が成功した：反対側の積みへ。取り出したあとに新しい操作が積まれていたら（版が違えば）入れない
  finish(dir: UndoDir, op: UndoOp, version: number) {
    if (version !== this.ver) return;
    const to = dir === 'undo' ? this.undone : this.done;
    to.push(op);
    if (to.length > UNDO_LIMIT) to.splice(0, to.length - UNDO_LIMIT);
  }

  // 型の貼り直しで id が替わった：やり直しの積みの中の、古い id を新しい id に置き換える
  remapRedo(map: ReadonlyMap<string, string>) {
    if (map.size === 0) return;
    this.undone = this.undone.map((op) => mapOpIds(op, map));
  }
}

const mapId = (map: ReadonlyMap<string, string>, id: string) => map.get(id) ?? id;

// 操作の中の id を置き換えた写し（元は変えない）
export function mapOpIds(op: UndoOp, map: ReadonlyMap<string, string>): UndoOp {
  switch (op.kind) {
    case 'move':
      return { kind: 'move', moves: op.moves.map((m) => ({ ...m, ref: mapId(map, m.ref) })) };
    case 'add':
      return { ...op, id: mapId(map, op.id) };
    case 'remove':
      return { ...op, ids: op.ids.map((id) => mapId(map, id)), at: Object.fromEntries(Object.entries(op.at).map(([id, p]) => [mapId(map, id), p])) };
    case 'link':
      return { ...op, from: mapId(map, op.from), to: mapId(map, op.to) };
    case 'paste':
      return { ...op, ids: op.ids.map((id) => mapId(map, id)) };
  }
}

// ---------- 文 ----------

export function opLabel(op: UndoOp): string {
  switch (op.kind) {
    case 'move':
      return op.moves.length > 1 ? `カードの移動（${op.moves.length}枚）` : 'カードの移動';
    case 'add':
      return 'カードを足す';
    case 'remove':
      return op.ids.length > 1 ? `削除（${op.ids.length}枚）` : '削除';
    case 'link':
      return op.before === null ? '関連を付ける' : op.after === null ? '関連を外す' : '関連の種類を変える';
    case 'paste':
      return `型「${op.template.name}」の貼り付け`;
  }
}

// ボードに書けないとき（読み込み中・読めない）の文。書けるなら null。戻す・やり直すは座標も書くので、どの操作でもボードに書けることを求める
export function undoBlockedNote(load: LoadBoardResult | null): string | null {
  if (load === null) return loadingNote('操作して');
  if (load.state === 'unreadable') return unreadableBlockNote('元に戻せません', load.why);
  return null;
}

export interface UndoButtons {
  undo: { enabled: boolean; note: string };
  redo: { enabled: boolean; note: string };
}

// 道具の列の「元に戻す」「やり直す」の押せるか・ツールチップ（押せない理由か、何を戻すか）
export function undoButtons(input: { undo: UndoOp | null; redo: UndoOp | null; busy: boolean; load: LoadBoardResult | null }): UndoButtons {
  if (input.busy) return { undo: { enabled: false, note: '元に戻している途中です' }, redo: { enabled: false, note: '元に戻している途中です' } };
  const blocked = undoBlockedNote(input.load);
  return {
    undo: input.undo === null ? { enabled: false, note: UNDO_EMPTY_NOTE } : blocked ? { enabled: false, note: blocked } : { enabled: true, note: `「${opLabel(input.undo)}」を元に戻します（Ctrl+Z）` },
    redo: input.redo === null ? { enabled: false, note: REDO_EMPTY_NOTE } : blocked ? { enabled: false, note: blocked } : { enabled: true, note: `「${opLabel(input.redo)}」をやり直します（Ctrl+Shift+Z／Ctrl+Y）` },
  };
}

// 成功の一言
export const undoDoneText = (op: UndoOp, dir: UndoDir): string => `「${opLabel(op)}」を${dir === 'undo' ? '元に戻しました' : 'やり直しました'}`;

// ---------- 命令・確かめ ----------

const memoRef = (memoId: string) => ({ kind: 'memo' as const, id: memoId });

// 削除の取り消しの印（restoreReplies の token）。u で始まる 64 字以内の [A-Za-z0-9_-]（左の isRestoreToken が通す形）。操作ごとに新しい
export function newUndoToken(now: number = Date.now(), rand: () => number = Math.random): string {
  const r = Math.floor(rand() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `u${now.toString(36)}${r}`;
}

export const restoreCommand = (memoId: string, token: string): RelayCommand => ({ command: 'restoreReplies', id: memoId, token });

// 足したカードを消す（undoToken は付けない。事前に決めた id なので確実）
export const addUndoCommand = (memoId: string, id: string): RelayCommand => ({ command: 'removeReply', ref: memoRef(memoId), replyId: id });

export const pasteUndoCommand = (token: string): RelayCommand => ({ command: 'undoSendReplies', token });

// from→to の線を、いまの種類（cur。無ければ null）から target（無ければ null＝外す）へ変える命令。同じ相手に別の種類を足すと置き換わる（左の決まり）。変えるものが無ければ null
export function linkSetCommand(memoId: string, from: string, to: string, cur: LinkKind | null, target: LinkKind | null): RelayCommand | null {
  if (cur === target) return null;
  if (target === null) return cur === null ? null : { command: 'changeReplyLinks', id: memoId, replyId: from, add: [], remove: [{ to, kind: cur }] };
  return { command: 'changeReplyLinks', id: memoId, replyId: from, add: [{ to, kind: target }], remove: [] };
}

const topOf = (replies: readonly Reply[], id: string) => replies.find((r) => r.id === id && r.parent === null);

// from→to の線の種類（無ければ null）
export const linkKindOf = (replies: readonly Reply[], from: string, to: string): LinkKind | null => topOf(replies, from)?.links?.find((l) => l.to === to)?.kind ?? null;

// 左の写しで、from→to の線が kind（null＝無い）になっているか
export const linkStateIs = (replies: readonly Reply[], from: string, to: string, kind: LinkKind | null): boolean => linkKindOf(replies, from, to) === kind;

// 座標を戻す・やり直す動き（台帳の一番上に残っているカードだけ。無ければ空）
export function moveTargets(op: Extract<UndoOp, { kind: 'move' }>, dir: UndoDir, replies: readonly Reply[]): NodeMove[] {
  const tops = new Set(replies.filter((r) => r.parent === null).map((r) => r.id));
  return op.moves.filter((m) => tops.has(m.ref)).map((m) => ({ ref: m.ref, x: (dir === 'undo' ? m.from : m.to).x, y: (dir === 'undo' ? m.from : m.to).y }));
}

// 消したカードを戻したあとの座標（消す前の座標）
export const restoreMoves = (op: Extract<UndoOp, { kind: 'remove' }>): NodeMove[] => op.ids.filter((id) => op.at[id] !== undefined).map((id) => ({ ref: id, x: op.at[id].x, y: op.at[id].y }));
