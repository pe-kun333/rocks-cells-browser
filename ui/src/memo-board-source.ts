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

// ---------- 右の検索の［上で開く］（MK4。docs/plan-comment-board-marks.md §4.4） ----------

// ボードで選んで見せるカードの頼み（左が、ボードが見る写しにだけ載せる。n が当てたものより大きいときだけ当てる。
//   下の区画の focusReply の「違うときだけ」にしないのは、選びを外したとき左は選んだメモの写しだけを送り直し、下の写しに前の小さい番号の頼みが残るため）
export interface BoardFocusLike {
  id: string;
  boardFocus?: { id: string; n: number };
}

export interface BoardFocus {
  memoId: string; // 頼みが載っていた写しのメモ
  replyId: string; // 選ぶ一番上のカード（左が直したもの。台帳にもう無ければ、右の行のままの id）
  n: number;
}

// ボードが見る写し（選んだメモ ?? 下の区画のメモ。boardSnapshot と同じ選び方）に載っている頼み。写しの形（boardSnapshot）は変えず、別の口で渡す
export function boardFocusOf(chosen: BoardFocusLike | null, lower: BoardFocusLike | null): BoardFocus | null {
  const shown = chosen ?? lower;
  const focus = shown?.boardFocus;
  return shown && focus ? { memoId: shown.id, replyId: focus.id, n: focus.n } : null;
}

// 頼みを今どうするか。none：頼みが無い・もう当てた番号（何もしない）。wait：まだ当てられない（番号を使わずに待つ）。
//   gone：そのカードが面に無い（当てずに一言。番号は使う）。hit：選んで 100% で真ん中へ（番号を使う）
//   待つのは、隠れている・ボードがまだ別のメモ（写しを受ける前）・読み込み中・開いたときの位置を決める前（needFit）・面の大きさが 0・つまむか範囲選択の途中
export type BoardFocusStep = 'none' | 'wait' | 'gone' | 'hit';

export function boardFocusStep(o: {
  want: BoardFocus | null;
  done: number; // 当てた（か、一言を出した）いちばん新しい番号
  hidden: boolean;
  memoId: string | null; // ボードが今描いているメモ
  loaded: boolean;
  needFit: boolean;
  sized: boolean; // 面に大きさがある
  busy: boolean; // つまむ・範囲選択の途中
  faces: readonly { id: string }[]; // 面に描いているカード
}): BoardFocusStep {
  const want = o.want;
  if (!want || !(want.n > o.done)) return 'none';
  if (o.hidden || o.memoId !== want.memoId || !o.loaded || o.needFit || !o.sized || o.busy) return 'wait';
  return o.faces.some((f) => f.id === want.replyId) ? 'hit' : 'gone';
}

// 型にする・空欄を入れて貼る小窓の、元になるカードの写し。ボードから開いた小窓はボードが見ているメモ、選ぶ帯からの小窓は下の区画のメモ
export function templateSource<T extends BoardMemoLike>(fromBoard: boolean, chosen: T | null, lower: T | null): T | null {
  return fromBoard ? (chosen ?? lower) : lower;
}