// 右の「検索」のための、メモの台帳からの検索（左だけが使う。台帳は読むだけで、書き換えない）
//   ・対象：特別なセルでないメモの本文・タグと、そのコメント（一番上のカードも、その下の返信も）の文・引用
//   ・語が空なら、最近のメモの一覧（メモの行だけ）
//   ・正規化と抜き出しは search.ts（import を持たない部品）
import { isSpecialCell, type MemoCell, memoTitle } from './memocells';
import { fold, type Folded, hasAll, queryWords, type SearchItem, type SearchSort, snippetOf } from './search';

export interface SearchRequest {
  query: string;
  sort: SearchSort;
  limit: number;
}

const MAX_LIMIT = 300;
const DEFAULT_LIMIT = 30;

// 正規化の結果の覚え（文が同じあいだは使い回す。1 回の検索で使わなかったものは消す）
const foldCache = new Map<string, { src: string; folded: Folded }>();

function foldedOf(key: string, src: string, used: Set<string>): Folded {
  used.add(key);
  const cached = foldCache.get(key);
  if (cached && cached.src === src) return cached.folded;
  const folded = fold(src);
  foldCache.set(key, { src, folded });
  return folded;
}

// 特別でないメモを探す。items：先頭から limit 件、total：当たった行の全部の数
export function searchMemos(list: readonly MemoCell[], req: SearchRequest): { items: SearchItem[]; total: number } {
  const limit = Number.isFinite(req.limit) ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(req.limit))) : DEFAULT_LIMIT;
  const words = queryWords(req.query);
  const rows: SearchItem[] = [];
  const used = new Set<string>();

  for (const m of list) {
    if (isSpecialCell(m)) continue;
    const title = memoTitle(m, 40) || (m.image ? '（画像のメモ）' : '（空のメモ）');
    const replies = m.replies ?? [];
    // 作った時刻と更新の時刻（♥ でも updatedAt は進むので、それも更新に数える）
    const memoCreated = m.createdAt;
    let memoUpdated = m.updatedAt;
    for (const r of replies) memoUpdated = Math.max(memoUpdated, r.editedAt ?? r.createdAt);
    const pick = (created: number, updated: number) => (req.sort === 'created' ? created : updated);

    const memoRow = (): SearchItem => {
      const liked = m.liked > 0 ? Math.min(3, Math.max(1, Math.round(m.liked))) : 0;
      return {
        kind: 'memo',
        memoId: m.id,
        title,
        sheet: m.sheet,
        at: pick(memoCreated, memoUpdated),
        ...(m.by ? { by: m.by.name } : {}),
        ...(m.image ? { image: true } : {}),
        ...(liked ? { liked } : {}),
      };
    };

    if (words.length === 0) {
      rows.push(memoRow());
      continue;
    }

    // メモの行：本文とタグの文
    const tagText = m.tags.map((t) => `#${t}`).join(' ');
    const body = foldedOf(`t:${m.id}`, m.text, used);
    const tags = foldedOf(`g:${m.id}`, tagText, used);
    if (hasAll(`${body.text} ${tags.text}`, words)) {
      const row = memoRow();
      const inText = snippetOf(m.text, body, words);
      const snippet = inText ?? snippetOf(tagText, tags, words);
      if (snippet) {
        row.snippet = snippet;
        row.where = inText ? 'text' : 'tags';
      }
      rows.push(row);
    }

    // コメントの行：カードの文と引用
    for (const r of replies) {
      const quoteText = r.quote?.text ?? '';
      const quoteTitle = r.quote?.title ?? '';
      const text = foldedOf(`r:${m.id}:${r.id}`, r.text, used);
      const quote = foldedOf(`q:${m.id}:${r.id}`, quoteText, used);
      const quoteName = foldedOf(`qt:${m.id}:${r.id}`, quoteTitle, used);
      if (!hasAll(`${text.text} ${quote.text} ${quoteName.text}`, words)) continue;
      const row: SearchItem = {
        kind: 'reply',
        memoId: m.id,
        replyId: r.id,
        title,
        sheet: m.sheet,
        at: pick(r.createdAt, r.editedAt ?? r.createdAt),
        ...(r.by ? { by: r.by.name } : {}),
        ...(r.image ? { image: true } : {}),
      };
      const found: [SearchItem['where'], ReturnType<typeof snippetOf>][] = [
        ['reply', snippetOf(r.text, text, words)],
        ['quote', snippetOf(quoteText, quote, words)],
        ['quoteTitle', snippetOf(quoteTitle, quoteName, words)],
      ];
      const hit = found.find(([, snippet]) => snippet);
      if (hit?.[1]) {
        row.snippet = hit[1];
        row.where = hit[0];
      }
      rows.push(row);
    }
  }

  // 使わなかった覚えを消す（語が空のときは何も覚えていない）
  if (words.length > 0) for (const key of [...foldCache.keys()]) if (!used.has(key)) foldCache.delete(key);

  // 新しい順。同じなら、メモの行が先。それでも同じなら id の文字順
  rows.sort(
    (a, b) =>
      b.at - a.at ||
      (a.kind === b.kind ? 0 : a.kind === 'memo' ? -1 : 1) ||
      compare(a.memoId, b.memoId) ||
      compare(a.replyId ?? '', b.replyId ?? ''),
  );
  return { items: rows.slice(0, limit), total: rows.length };
}

function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
