// ボードへ入れる写真の決まり（plan-comment-board-2 の §5 の 1〜3・段 CB7a）。DOM を持たない決まりだけ
//   写真の枚数の上限・題の欄を開いてよいか・足された写真のカードの見つけ方。配線は CB7b（主担当）
import { t as tr } from './i18n';
import type { Reply } from './threads';
import type { ComposeMode } from './memo-card-board-edit';
import { canReturnDraft } from './memo-card-board-edit';

export const PHOTO_BATCH_MAX = 10; // 一度に入れる写真の枚数
export const PHOTO_TITLE_LABEL = tr('この写真の題（一行。Esc で付けずに閉じる）');
export const PHOTO_TITLE_LATER = tr('題は F2 で付けられます');

// 入れようとした中から、写真（type が image/ で始まるもの）だけを順のまま残す。上限を越えた分は take に入れず、数を skipped にする。画像でないものは数えない
export function photoBatch<T extends { type: string }>(files: readonly T[]): { take: T[]; skipped: number } {
  const images = files.filter((f) => f.type.startsWith('image/'));
  const take = images.slice(0, PHOTO_BATCH_MAX);
  return { take, skipped: images.length - take.length };
}

// 入れきれなかった写真の数を伝える一行（呼ぶのは skipped が 1 以上のとき）
export function photoSkipNote(skipped: number): string {
  return tr('{0} 枚は入れませんでした（一度に {1} 枚まで）', { 0: skipped, 1: PHOTO_BATCH_MAX });
}

// 足された写真のカードの id。元のポストへの一番上のカードで、既知でなく、写真の ID が shot と同じ最初のもの。無ければ null
export function arrivedPhotoCard(replies: readonly Reply[], known: ReadonlySet<string>, shot: string): string | null {
  const hit = replies.find((r) => r.parent === null && !known.has(r.id) && r.image === shot);
  return hit ? hit.id : null;
}

// 題の欄を開いてよいか。ほかの所で処理中なら開かない。そうでなければ、欄を戻してよいかと同じ決まり（書きかけ・書き直しの欄は待つ）
export function canOpenPhotoTitle(o: { composing: ComposeMode | null; text: string; busyElsewhere: boolean }): boolean {
  if (o.busyElsewhere) return false;
  return canReturnDraft(o.composing, o.text);
}
