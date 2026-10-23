// 画像の隠す候補を探す（依頼の小窓 v2・R7c・D15。docs/bot-cells/plan-request-v2.md §4.4・§6 R7c、見本 ② の点線の枠）
//   ・Windows の文字読み取り（C++ の readCaptureText → ocr.cpp の Windows.Media.Ocr。手元で読み、画像は外へ出さない）で行を読み、
//     メール・電話番号・鍵らしき文字（R2 の findSecretish）の行の矩形（画像に対する 0〜1）を返す。伏せ字帳の語は R2 で作っていないので見ない
//   ・返すのは種類と矩形だけ。行の文字（鍵の生の値も）は返さない・覚えない・ログに出さない
//   ・読み取りの無いビルド（unavailable）・日本語の認識データ無し（noJapanese）・ほかで読んでいる（busy）は、候補なしでわけだけ返す
//   ・DOM は知らない。描くのは panels/bot-image-edit.ts（面には関数として渡す。reader/ask.ts）
import { request } from './bridge';
import { findSecretish } from './bot-replies';
import type { ImageHintFound, ImageHintKind, ImageHintsOutcome } from './panels/bot-image-edit';

const MAIL_RE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE_RE = /0\d{1,4}-\d{1,4}-\d{3,4}/;
const DASH_RE = /[\u2010-\u2015\u2212\u30fc\uff0d]/g; // 文字読み取りが返す横棒のいろいろ（‐ ‑ ‒ – — ― − ー －）を - にそろえる
const MAX_HINTS = 20;
const READ_MS = 60_000;

// 1 行の文字が隠す候補か（鍵らしき文字 → メール → 電話番号の順）。全角は半角にそろえ、空白を詰めた文でも見る
export function hintKindOf(text: string): ImageHintKind | null {
  const plain = String(text ?? '').normalize('NFKC');
  const tight = plain.replace(/\s+/g, '');
  if (findSecretish(plain).count > 0 || findSecretish(tight).count > 0) return 'secret';
  if (MAIL_RE.test(tight)) return 'mail';
  if (PHONE_RE.test(tight.replace(DASH_RE, '-'))) return 'phone';
  return null;
}

const fraction = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null);

// 画像（JPEG の data URL）の文字を読み、隠す候補の矩形を返す。読めないときはわけだけ
export async function readImageHints(jpeg: string): Promise<ImageHintsOutcome> {
  const query = await request((requestId) => ({ type: 'readCaptureText', requestId, command: 'query' }), 4_000);
  if (!query || query.type !== 'captureText') return { ok: false, why: 'failed' };
  if (!query.ok) return { ok: false, why: 'unavailable' };
  const reply = await request((requestId) => ({ type: 'readCaptureText', requestId, command: 'read', id: '', image: jpeg }), READ_MS);
  if (!reply || reply.type !== 'captureText') return { ok: false, why: 'failed' };
  if (!reply.ok) {
    const why = reply.error === 'noJapanese' || reply.error === 'unavailable' || reply.error === 'busy' ? reply.error : 'failed';
    return { ok: false, why };
  }
  const hints: ImageHintFound[] = [];
  for (const line of Array.isArray(reply.lines) ? reply.lines : []) {
    if (hints.length >= MAX_HINTS) break;
    if (!line || typeof line.text !== 'string' || line.table || (typeof line.at === 'number' && line.at >= 0)) continue; // 表をつないだ行・録画の行は見ない
    const x = fraction(line.x);
    const y = fraction(line.y);
    const w = fraction(line.w);
    const h = fraction(line.h);
    if (x === null || y === null || !w || !h) continue;
    const kind = hintKindOf(line.text);
    if (kind) hints.push({ kind, x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) });
  }
  return { ok: true, hints };
}
