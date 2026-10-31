// 依頼に載せられる URL（http・https だけ。? と # から後ろは送らない）
//   bot-send.ts と draft-materials.ts の両方から使う。ここは bot-replies の掃除関数だけを見る（DOM もファイルも知らない）
import { BOT_LIMITS, stripUrlQuery } from './bot-replies';

// schema の page.url と同じ。大文字の HTTP:// は通さない
const SEND_URL_RE = /^https?:\/\/[^?#\s]+$/;

export function sendableUrl(url: string | undefined): string {
  const clean = stripUrlQuery(String(url ?? '').trim());
  return clean.length <= BOT_LIMITS.urlChars && SEND_URL_RE.test(clean) ? clean : '';
}
