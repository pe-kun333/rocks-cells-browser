// ボードが見るメモの写しの選び方（plan-board-memo-switch の M2）。DOM を持たない決まりだけ
//   選んだメモの写し（左の memoBoardView）があればそれ、無ければ下の区画のメモ（今までどおり）
import type { Reply } from './threads';

export interface BoardMemoLike {
  id: string;
  replies: readonly Reply[];
}

// ボードに渡す「いまのメモのカードの写し」
export function boardSnapshot(chosen: BoardMemoLike | null, lower: BoardMemoLike | null): { memoId: string; replies: readonly Reply[] } | null {
  const shown = chosen ?? lower;
  return shown ? { memoId: shown.id, replies: shown.replies } : null;
}

// 型にする・空欄を入れて貼る小窓の、元になるカードの写し。ボードから開いた小窓はボードが見ているメモ、選ぶ帯からの小窓は下の区画のメモ
export function templateSource<T extends BoardMemoLike>(fromBoard: boolean, chosen: T | null, lower: T | null): T | null {
  return fromBoard ? (chosen ?? lower) : lower;
}