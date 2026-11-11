// ボードの「整理」（B4-1）：台帳から消えたカードの位置（孤児）を、利用者が押したときだけボードのファイルから消す
//   DOM も localStorage も使わない（ui/test/memo-card-board-tidy.test.ts）。描くのは app/memo-board-tab.ts
//   孤児は描かれず、数えるだけ。整理で消えるのは孤児の位置だけ（生きているカード・台帳・見ている位置はそのまま）。元に戻す・やり直しの積みには入れない
//   追加の控えは作らない（初めての保存で取る -before-v1 の写しで足りる）
import { t } from './i18n';
//   数えて片づけるのは、いまの形のファイルだけ（HX5。読み込み load がその形のファイル）。六角では文の頭に「六角の並びは、」を付けて、どちらのファイルの話かを分ける
import { type Board, type BoardLayout, orphanCount, pruneOrphans } from './memo-card-board';
import { layoutHead as head, loadingNote, unreadableBlockNote } from './memo-card-board-texts';
import type { LoadBoardResult } from './memo-card-board-store';
import type { Reply } from './threads';

export const TIDY_LABEL = t('整理');
export const TIDY_NONE_NOTE = t('整理する位置はありません');

// 整理する位置が無いときの文（形ごと。四角は TIDY_NONE_NOTE のまま）
export const tidyNoneNote = (layout: BoardLayout = 'square') => `${head(layout)}${TIDY_NONE_NOTE}`;

// ボード上部に小さく出す文。孤児が無ければ空（何も出さない）
export const orphanNoteText = (n: number, layout: BoardLayout = 'square') => (n > 0 ? t('（{0}消したカードの位置が {1} 件残っています）', { 0: head(layout), 1: n }) : '');

export const tidyConfirmText = (n: number, layout: BoardLayout = 'square') => t('{0}消したカードの位置 {1} 件を整理します。元のカードは消えません', { 0: head(layout), 1: n });

// 元に戻す・やり直しの積みに「削除」「型の貼り付け」が残っているときの一言。整理しても、戻したカードは積みに控えた位置に出る
export const TIDY_UNDO_NOTE = t('元に戻す・やり直しの積みはそのまま残り、戻したカードも元の位置に出ます');

export const tidyDoneText = (n: number, layout: BoardLayout = 'square') => t('{0}消したカードの位置 {1} 件を整理しました', { 0: head(layout), 1: n });

// 読めない・読み込み中のボードには孤児を数えない（0）
export function orphansOf(load: LoadBoardResult | null, replies: readonly Reply[]): number {
  if (load === null || load.state === 'unreadable') return 0;
  return orphanCount(load.board, replies);
}

export interface TidyButton {
  enabled: boolean;
  count: number;
  note: string; // ボタンの説明（押せないときは理由）
}

// 押せるか・数・説明。数えるのは load（いまの形のファイル）だけで、説明の頭は load の形で決める（HX5）
export function tidyButton(input: { load: LoadBoardResult | null; replies: readonly Reply[]; busy?: boolean }): TidyButton {
  const { load, replies } = input;
  if (load === null) return { enabled: false, count: 0, note: loadingNote(t('整理して')) };
  if (load.state === 'unreadable') return { enabled: false, count: 0, note: unreadableBlockNote(t('整理できません'), load.why, load.layout) };
  const count = orphanCount(load.board, replies);
  if (count === 0) return { enabled: false, count, note: tidyNoneNote(load.layout) };
  if (input.busy) return { enabled: false, count, note: t('いまは整理できません（操作の途中です）') };
  return { enabled: true, count, note: t('{0}台帳から消えたカードの位置だけを、ボードのファイルから消します。元のカードは消えません', { 0: head(load.layout) }) };
}

// 確認の文（積みに削除・貼り付けが残っているときは、一言添える）。layout は整理するファイルの形（既定は四角）
export function tidyConfirmMessage(count: number, undoHasDelete: boolean, layout: BoardLayout = 'square'): string {
  return undoHasDelete ? `${tidyConfirmText(count, layout)}（${TIDY_UNDO_NOTE}）` : tidyConfirmText(count, layout);
}

export type TidyPlan = { ok: true; board: Board; removed: number } | { ok: false; why: 'blocked' | 'none' };

// 整理した結果のボード（元は変えない）。読めない・読み込み中は blocked、孤児が無ければ none。孤児だけを落とす（replies は保存の直前の台帳を渡す）
export function planTidy(load: LoadBoardResult | null, replies: readonly Reply[], now: number): TidyPlan {
  if (load === null || load.state === 'unreadable') return { ok: false, why: 'blocked' };
  const removed = orphanCount(load.board, replies);
  if (removed === 0) return { ok: false, why: 'none' };
  return { ok: true, board: pruneOrphans(load.board, replies, now), removed };
}