// 自由配置ボードの保存の道（計画書 docs/plan-card-board.md の B1-2）
//   ・ここは DOM を使わない。ファイルの読み書きは、呼ぶ側が io（readDataChecked と writeData）を渡す（テストでは偽物を渡す）。型の保存
//     （memo-card-template-store.ts）と同じ作法
//   ・ui-data/boards/<メモ id>.json は { format:'honeycomb-board', version:1, memoId, updatedAt, view, nodes } （形は memo-card-board.ts）
//   ・読み込みは ok／missing／unreadable。読めなかった・版が新しい・形が合わない・メモ違い・大きすぎるときは unreadable で、書かない
//     （そのときの画面は、仮の並びで見せるだけ。位置は保存されない）
//   ・書くのは、読んだときの結果（LoadBoardResult）に対してだけ。1 つの書き手の前提なので、書く直前に読み直さずに、画面の持っている
//     最新の board 全体を書く（古い値で上書きしないための読み直しはしない）。ただし「ファイルが無い」と読んだあとに、ファイルができて
//     いたら書かない（見ていないファイルを上書きしない）
//   ・初めて書く前に、すでにあるファイル（読めた中身そのまま。読み捨てたノードも含む）の写しを boards/<メモ id>-before-v1.json に
//     1 回だけ取る（写しがもうあれば取らない。写せなければ書かない）。読み込みで捨てたノードがあるとき（dropped）も、ファイルがある
//     ので同じ道で写しが取られる
//   ・書く中身は toBoardFile／serializeBoard を通す：200 KB を超える・メモ id が名前に使えないときは書かない。300 件を超える board も
//     書かない（呼ぶ側が trimNodes で整える。黙って捨てない）
import { t } from './i18n';
import type { CheckedRead } from './data';
import {
  BOARD_LIMITS,
  type Board,
  boardBackupName,
  boardFileName,
  type BoardRefusal,
  emptyBoard,
  parseBoard,
  serializeBoard,
  toBoardFile,
} from './memo-card-board';

export interface BoardIo {
  read(name: string): Promise<CheckedRead<unknown>>;
  write(name: string, value: unknown): Promise<boolean>;
}

// 読んだ結果。書くときはこれを渡す（読めなかったものは書けない）
export type LoadBoardResult =
  | { state: 'ok'; memoId: string; board: Board; dropped: number; raw: unknown; backupNeeded: boolean } // raw：読んだままの中身（写しに使う）
  | { state: 'missing'; memoId: string; board: Board; dropped: 0; raw: null; backupNeeded: false } // まだ無い。空のボード（仮の並び）から始める
  | { state: 'unreadable'; memoId: string; why: 'name' | 'failed' | BoardRefusal };

// ボードのファイルを読む。unreadable：名前に使えないメモ id・返事が無い／壊れている・知らない版・形が合わない・メモ違い・大きすぎる
export async function loadBoard(io: BoardIo, memoId: string, now = 0): Promise<LoadBoardResult> {
  const name = boardFileName(memoId);
  if (!name) return { state: 'unreadable', memoId, why: 'name' };
  const read = await io.read(name);
  if (read.status === 'missing') return { state: 'missing', memoId, board: emptyBoard(memoId, now), dropped: 0, raw: null, backupNeeded: false };
  if (read.status === 'failed') return { state: 'unreadable', memoId, why: 'failed' };
  const parsed = parseBoard(read.value, { memoId });
  if (!parsed.ok) return { state: 'unreadable', memoId, why: parsed.why };
  return { state: 'ok', memoId, board: parsed.board, dropped: parsed.dropped, raw: read.value, backupNeeded: true };
}

export type SaveBoardFailure = 'unreadable' | 'name' | 'memo' | 'full' | 'size' | 'changed' | 'backup' | 'write';
export type SaveBoardResult = { ok: true; loaded: LoadBoardResult; backedUp: boolean } | { ok: false; why: SaveBoardFailure };

// board を保存する。読めなかった（unreadable）ものには書かない。成功したら、次に渡す loaded（書いたものを ok として読んだ形。写しはもう要らない）を返す
//   backedUp：この書き込みの前に写しを取った（true）／取らなかった（false。初めて・写しがもうある）
export async function saveBoard(io: BoardIo, loaded: LoadBoardResult, board: Board): Promise<SaveBoardResult> {
  if (loaded.state === 'unreadable') return { ok: false, why: 'unreadable' };
  const name = boardFileName(loaded.memoId);
  if (!name) return { ok: false, why: 'name' };
  if (board.memoId !== loaded.memoId) return { ok: false, why: 'memo' };
  if (board.nodes.length > BOARD_LIMITS.nodes) return { ok: false, why: 'full' };
  if (serializeBoard(board) === null) return { ok: false, why: 'size' };

  let backedUp = false;
  if (loaded.state === 'missing') {
    // 無いと読んだあとにファイルができていたら、書かない（見ていないファイルを上書きしない）
    const again = await io.read(name);
    if (again.status !== 'missing') return { ok: false, why: 'changed' };
  } else if (loaded.backupNeeded) {
    const backupName = boardBackupName(loaded.memoId);
    if (!backupName) return { ok: false, why: 'name' };
    const backup = await io.read(backupName);
    if (backup.status === 'failed') return { ok: false, why: 'backup' };
    if (backup.status === 'missing') {
      if (!(await io.write(backupName, loaded.raw))) return { ok: false, why: 'backup' };
      backedUp = true;
    }
  }

  const file = toBoardFile(board);
  if (!(await io.write(name, file))) return { ok: false, why: 'write' };
  const reread = parseBoard(file, { memoId: loaded.memoId });
  const saved = reread.ok ? reread.board : board;
  return { ok: true, backedUp, loaded: { state: 'ok', memoId: loaded.memoId, board: saved, dropped: 0, raw: file, backupNeeded: false } };
}

// 読めなかったときに、ボードの面に出す文（仮の並びで見せ、位置は保存されない）
export function boardUnreadableNote(why: 'name' | 'failed' | BoardRefusal): string {
  switch (why) {
    case 'version':
      return t('このボードは新しい版のアプリで作られたので読めません。位置は保存されません（仮の並びで見せています）');
    case 'name':
      return t('このメモのボードは保存できません（メモの名前が保存先に使えません）。位置は保存されません');
    default:
      return t('このボードは読めないので、位置は保存されません（仮の並びで見せています。ファイルは変えていません）');
  }
}

export function boardSaveMessage(why: SaveBoardFailure): string {
  switch (why) {
    case 'unreadable':
      return t('ボードのファイルを読めなかったので、位置を保存しませんでした（ファイルは変えていません）');
    case 'name':
      return t('このメモのボードは保存できません（メモの名前が保存先に使えません）');
    case 'memo':
      return t('ボードのメモが違うので、保存しませんでした');
    case 'full':
      return t('ボードに残せる位置は {0} 件までです。保存しませんでした', { 0: BOARD_LIMITS.nodes });
    case 'size':
      return t('ボードのファイルが大きすぎるので、保存しませんでした');
    case 'changed':
      return t('ボードのファイルが読んだあとに変わっていたので、保存しませんでした。開き直してください');
    case 'backup':
      return t('もとのボードの写しを取れなかったので、保存しませんでした');
    case 'write':
      return t('ボードの位置を保存できませんでした（書き込み：失敗）');
  }
}