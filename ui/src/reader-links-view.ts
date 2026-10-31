// 結んだカードの写し（左が読む画面へ押すもの。段 V0d。plan-reader-video §6・§7.1）を組む純粋な関数
//   ・台帳（メモの一覧）から、その動画に結んだ一番上のカード（items）と、結ぶ先のメモ（target）を組む。保存はしない（D16）
//   ・押すのは V2a-1。ここは組むだけ。入力の配列もメモも変えない。DOM・window は使わない
import { cardLabel } from './memo-card-links';
import { isSpecialCell } from './memocells';
import type { ReaderLinkItem, ReaderLinksView, ReaderLinkTop } from './reader-links';
import { MAX_REPLIES, orderedTops, type Reply } from './threads';

// 写しを組むのに要るメモの項目（MemoCell はこれを満たす）
export interface LinkViewMemo {
  id: string;
  text: string;
  replies?: readonly Reply[];
  portal?: string;
  bot?: string;
  app?: string;
  capture?: string;
}

export const MAX_LINK_ITEMS = 600; // items の上限
export const MAX_LINK_MEMOS = 20; // memos（結ぶ先 ▾ の候補）の上限

const HEAD_CHARS = 40; // メモの題・カードの題の字数（コードポイント）

// メモの題：最初の空でない行の前後を取ったもの。40 字を超えたら 40 字＋「…」。空なら（無題のメモ）
export function memoHead(text: string): string {
  const line = text.split('\n').find((s) => s.trim() !== '')?.trim() ?? '';
  if (!line) return '（無題のメモ）';
  const chars = [...line];
  return chars.length > HEAD_CHARS ? `${chars.slice(0, HEAD_CHARS).join('')}…` : line;
}

// 結んだカードの写し：items は memos の順に、特別なセルでないメモの一番上のカードで、その動画に結んだもの（上限 MAX_LINK_ITEMS）
//   target は結ぶ先のメモ（targetId が null・無い・特別なセルなら null）。tops は並べた順の一番上のカードの全部
export function readerLinksView(memos: readonly LinkViewMemo[], video: string, targetId: string | null): ReaderLinksView {
  const items: ReaderLinkItem[] = [];
  for (const memo of memos) {
    if (items.length >= MAX_LINK_ITEMS) break;
    if (isSpecialCell(memo)) continue;
    for (const reply of orderedTops(memo.replies ?? [])) {
      if (items.length >= MAX_LINK_ITEMS) break;
      const at = reply.at;
      if (!at || at.video !== video) continue;
      items.push({
        memoId: memo.id,
        replyId: reply.id,
        spans: at.spans.map((s) => ({ ...s })), // 台帳の配列をそのまま渡さない
        ...(at.kind ? { kind: at.kind } : {}),
        ai: reply.by !== undefined,
        head: cardLabel(reply, HEAD_CHARS),
      });
    }
  }

  const hit = targetId === null ? undefined : memos.find((m) => m.id === targetId);
  const target = hit && !isSpecialCell(hit) ? targetOf(hit) : null;
  // この動画のカードがあるメモ（結ぶ先 ▾ の候補。V1c）
  const holders: { memoId: string; title: string }[] = [];
  for (const item of items) {
    if (holders.length >= MAX_LINK_MEMOS) break;
    if (holders.some((h) => h.memoId === item.memoId)) continue;
    const memo = memos.find((m) => m.id === item.memoId);
    if (memo) holders.push({ memoId: memo.id, title: memoHead(memo.text) });
  }
  return { video, target, items, memos: holders };
}

// 結ぶ先のメモの写し（返信の数と、一番上のカードの一覧）
function targetOf(memo: LinkViewMemo): NonNullable<ReaderLinksView['target']> {
  const replies = memo.replies ?? [];
  const tops: ReaderLinkTop[] = orderedTops(replies).map((reply) => ({
    replyId: reply.id,
    head: cardLabel(reply, HEAD_CHARS),
    ...(reply.at ? { video: reply.at.video } : {}),
  }));
  return { memoId: memo.id, title: memoHead(memo.text), replies: replies.length, max: MAX_REPLIES, tops };
}
