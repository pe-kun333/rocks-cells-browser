// コメント用に写す（段 V6b。plan-reader-video・docs/wip/2026-10-29/specs/v6b.md）
//   ・左が台帳全体から、その動画と結んだ自分のカードを時刻の順に集めて返す（exportCards）
//   ・読む画面が、左からの返事を確かめ（parseExportCards）、「m:ss 文」の行にして欄に出す（commentText）
//   ・貼って投稿するのは利用者。字幕の本文と AI の文は入れない。純粋な関数だけ（DOM・window・Date.now・Math.random は使わない）。入力は変えない
import { isSpecialCell } from './memocells';
import { secLabel } from './reader-ai-card';
import type { LinkViewMemo } from './reader-links-view';
import { orderedTops } from './threads';

export const MAX_EXPORT_CARDS = 300; // 集めるカードの上限
export const COMMENT_MAX = 10000; // YouTube のコメントの字数の上限の目安（超えても切らない。知らせるだけ）

// 写す 1 枚（秒は結んだ区間のいちばん早い始まり）
export interface ExportCard {
  sec: number;
  text: string;
}

// 空白（改行も）を一つの空白にまとめ、前後を取る
function squash(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

// 使える秒：有限の数で 0 以上
function usableSec(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

// 台帳の順に、その動画と結んだ自分のカードを集める（特別なセル・AI のカード・やり取りのカード・字幕だけのカードは飛ばす）
export function exportCards(memos: readonly LinkViewMemo[], video: string): ExportCard[] {
  const out: ExportCard[] = [];
  for (const memo of memos) {
    if (out.length >= MAX_EXPORT_CARDS) break;
    if (isSpecialCell(memo)) continue;
    for (const reply of orderedTops(memo.replies ?? [])) {
      if (out.length >= MAX_EXPORT_CARDS) break;
      const at = reply.at;
      if (!at || at.video !== video) continue;
      if (reply.by !== undefined || at.kind !== undefined) continue;
      let sec = Infinity;
      for (const span of at.spans) {
        if (usableSec(span.start) && span.start < sec) sec = span.start;
      }
      if (sec === Infinity) continue;
      const text = squash(reply.text);
      if (!text) continue;
      out.push({ sec, text });
    }
  }
  return out.sort((a, b) => a.sec - b.sec); // Array.prototype.sort は安定（同じ秒は取った順のまま）
}

// 左からの返事を確かめる。配列でなければ null。頭から MAX_EXPORT_CARDS 個までを見て、合うものだけを残す
export function parseExportCards(raw: unknown): ExportCard[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ExportCard[] = [];
  for (const item of raw.slice(0, MAX_EXPORT_CARDS)) {
    if (typeof item !== 'object' || item === null) continue;
    const { sec, text } = item as { sec?: unknown; text?: unknown };
    if (!usableSec(sec) || typeof text !== 'string') continue;
    const t = squash(text);
    if (!t) continue;
    out.push({ sec, text: t });
  }
  return out.sort((a, b) => a.sec - b.sec);
}

// 欄に出す文：1 枚を 1 行「m:ss 文」にし、改行でつなぐ。字数の上限を超えても切らず、over で知らせる
export function commentText(cards: readonly ExportCard[]): { text: string; lines: number; chars: number; over: boolean } {
  if (cards.length === 0) return { text: '', lines: 0, chars: 0, over: false };
  const text = cards.map((c) => `${secLabel(c.sec)} ${c.text}`).join('\n');
  const chars = [...text].length;
  return { text, lines: cards.length, chars, over: chars > COMMENT_MAX };
}
