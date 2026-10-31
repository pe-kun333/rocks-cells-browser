// 動画の見分け（カードの線 at.video）と、同じ動画かを比べる（docs/plan-reader-video.md §6。段 V0）
//   ・YouTube は動画の id（watch?v=・shorts・live のどれでも同じ id）
//   ・自分の音声・動画のファイルは「f:」＋ URL の指紋（読む画面の記録の鍵 reader/store.ts と同じ、# から後ろを外した URL の指紋）。
//     ファイルの場所（個人の名前を含みうる）は台帳に書かない（plan §4）
//   ・ほかのページ（ライブキャプションで聞き取った文章のページなど）は null（線を結ばない）
import { fingerprint } from '../ai/history';
import { isMediaFileUrl } from './media';
import { videoIdOf } from './youtube';

export function readerVideoKey(url: string): string | null {
  const id = videoIdOf(url);
  if (id !== null) return /^[\w-]{11}$/.test(id) ? id : null;
  if (!isMediaFileUrl(url)) return null;
  return `f:${fingerprint(url.replace(/#.*$/, ''))}`;
}

// 同じ動画か（YouTube は ?t= などが違っても同じ id なら同じ。動画でないページどうしは false）
export function sameVideo(a: string, b: string): boolean {
  const x = readerVideoKey(a);
  return x !== null && x === readerVideoKey(b);
}
