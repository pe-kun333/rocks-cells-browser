// 右の「検索」のための、メモの台帳からの検索（左だけが使う。台帳は読むだけで、書き換えない）
//   ・対象：特別なセルでないメモの本文・タグと、そのコメント（一番上のカードも、その下の返信も）の文・引用
//   ・語が空なら、最近のメモの一覧（メモの行だけ）
//   ・正規化と抜き出しは search.ts（import を持たない部品）
import { t as tr } from './i18n';
//   ・右の検索の切り替え［カードの ♥］（MK9）は別の関数 searchCardHearts（字が空でも ♥ のカードの行を返す）。［まとめてコピー］の文は cardHeartsCopy
import { cardLike, type LikeLevel } from './likes';
import { cardLines } from './memo-card-board-view';
import { isSpecialCell, type MemoCell, memoTitle } from './memocells';
import { fold, type Folded, hasAll, queryWords, type SearchItem, type SearchSort, snippetOf } from './search';
import type { Reply } from './threads';

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

// 返す件数（1〜300。数でなければ 30）
const limitOf = (limit: number): number => (Number.isFinite(limit) ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit))) : DEFAULT_LIMIT);

// 行の題（メモの題名 40 字。字が無ければ画像のメモ・空のメモ）
const titleOf = (m: MemoCell): string => memoTitle(m, 40) || (m.image ? tr('（画像のメモ）') : tr('（空のメモ）'));

// 特別でないメモを探す。items：先頭から limit 件、total：当たった行の全部の数
export function searchMemos(list: readonly MemoCell[], req: SearchRequest): { items: SearchItem[]; total: number } {
  const limit = limitOf(req.limit);
  const words = queryWords(req.query);
  const rows: SearchItem[] = [];
  const used = new Set<string>();

  for (const m of list) {
    if (isSpecialCell(m)) continue;
    const title = titleOf(m);
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

// ---------- カードの ♥（MK9。計画 docs/plan-comment-board-marks.md §4.9） ----------
//   ・一番上のカード（parent === null）だけ（印は一番上のカードのタグにしか付かない）。特別なセルは飛ばす
//   ・段の絞り：min 以上（［♥1 以上］［♥2 以上］［♥3］）。♥ の段は likes.ts の cardLike（値の一覧とぴったり同じタグだけ）
//   ・字があれば、その字にも合うもの（今のカードの行と同じ照らし方：文・引用・引用の題名で「すべて含む」。カードのタグは照らさない）
//   ・並び：カードを作った時刻の新しい順（並べ方のボタンに従わない）。同じなら memoId・replyId
//   ・一覧（searchCardHearts）とまとめてコピー（cardHeartsCopy）は、同じ選び（heartCards）を通す（一覧とコピーの数がずれないように）

export interface HeartsRequest {
  query: string;
  min: LikeLevel; // この段以上
  limit: number;
}

export const CARD_HEAD_MAX = 40; // 行に出す文の頭の字数（コードポイント）
export const HEART_COPY_MAX = 300; // まとめてコピーの上限（新しい順の頭から）

// 選んだ 1 枚（folds は字があるときだけ。抜き出しに使う）
interface HeartPick {
  memo: MemoCell;
  reply: Reply;
  title: string;
  like: LikeLevel;
  folds: { text: Folded; quote: Folded; quoteName: Folded } | null;
}

// カードの文の頭：cardLines（AI のカードは見出しと文）を空白でつなぎ、40 字で切る（切ったら「…」）。字の無いカード（写真だけ・引用だけ）は空
//   ボードの吹き出しの calloutText（memo-card-board-callouts.ts。CALLOUT.textMax も 40）の写し。片方の切り方を替えるときは両方を替える
export function cardHeadOf(reply: Pick<Reply, 'text' | 'by' | 'at'>): string {
  const chars = [...cardLines(reply).join(' ')];
  return chars.length > CARD_HEAD_MAX ? `${chars.slice(0, CARD_HEAD_MAX).join('')}…` : chars.join('');
}

// 引用だけのカード（文が空）の行の頭：引用の題、無ければ引用の文の最初の行（ボードの顔の cardLabel と同じ順。40 字で切る）。引用が無ければ空（主担当の決め。MK9 の見直しのあと）
export function quoteHeadOf(reply: Pick<Reply, 'quote'>): string {
  const base = reply.quote?.title.trim() || (reply.quote?.text.trim().split('\n')[0]?.trim() ?? '');
  const chars = [...base];
  return chars.length > CARD_HEAD_MAX ? `${chars.slice(0, CARD_HEAD_MAX).join('')}…` : base;
}

// まとめてコピーの引用の行：ボードのカードの「コピー」（cardCopyText。memo-card-board-menu.ts）の頭と同じ形（引用の文は「> 」、出どころは「— [題](URL)」）。引用が無ければ空
function quoteCopyLines(reply: Pick<Reply, 'quote'>): string[] {
  if (!reply.quote) return [];
  const quote = reply.quote.text.trim();
  return [...(quote !== '' ? quote.split('\n').map((l) => `> ${l}`) : []), `— [${reply.quote.title.trim() || tr('ページ')}](${reply.quote.url})`];
}

// ♥ のカードを選んで並べる（一覧とコピーで共用）
function heartCards(list: readonly MemoCell[], query: string, min: LikeLevel): { picked: HeartPick[]; words: string[] } {
  const words = queryWords(query);
  // 正規化の覚えは searchMemos と同じ鍵で使い回す。使わなかった覚えを消すのは searchMemos だけ（ここで消すと、ふつうの検索の覚えまで消えるので）
  const used = new Set<string>();
  const picked: HeartPick[] = [];
  for (const m of list) {
    if (isSpecialCell(m)) continue;
    let title: string | null = null;
    for (const r of m.replies ?? []) {
      if (r.parent !== null) continue;
      const like = cardLike(r.tags ?? []);
      if (like === 0 || like < min) continue;
      let folds: HeartPick['folds'] = null;
      if (words.length > 0) {
        folds = {
          text: foldedOf(`r:${m.id}:${r.id}`, r.text, used),
          quote: foldedOf(`q:${m.id}:${r.id}`, r.quote?.text ?? '', used),
          quoteName: foldedOf(`qt:${m.id}:${r.id}`, r.quote?.title ?? '', used),
        };
        if (!hasAll(`${folds.text.text} ${folds.quote.text} ${folds.quoteName.text}`, words)) continue;
      }
      title ??= titleOf(m);
      picked.push({ memo: m, reply: r, title, like, folds });
    }
  }
  picked.sort((a, b) => b.reply.createdAt - a.reply.createdAt || compare(a.memo.id, b.memo.id) || compare(a.reply.id, b.reply.id));
  return { picked, words };
}

// 右の検索の［カードの ♥］：♥ のカードの行。items：先頭から limit 件（1〜300）、total：絞ったあとの全部の数
export function searchCardHearts(list: readonly MemoCell[], req: HeartsRequest): { items: SearchItem[]; total: number } {
  const { picked, words } = heartCards(list, req.query, req.min);
  const items = picked.slice(0, limitOf(req.limit)).map(({ memo: m, reply: r, title, like, folds }): SearchItem => {
    const head = cardHeadOf(r) || quoteHeadOf(r); // 引用だけのカードは引用の題（どのカードか分かるように）
    const row: SearchItem = {
      kind: 'reply',
      memoId: m.id,
      replyId: r.id,
      title,
      sheet: m.sheet,
      at: r.createdAt, // 作った時刻（並べ方のボタンに従わない）
      ...(r.by ? { by: r.by.name } : {}),
      ...(r.image ? { image: true } : {}),
      cardLike: like,
      ...(head !== '' ? { cardHead: head } : {}),
    };
    if (folds) {
      const found: [SearchItem['where'], ReturnType<typeof snippetOf>][] = [
        ['reply', snippetOf(r.text, folds.text, words)],
        ['quote', snippetOf(r.quote?.text ?? '', folds.quote, words)],
        ['quoteTitle', snippetOf(r.quote?.title ?? '', folds.quoteName, words)],
      ];
      const hit = found.find(([, snippet]) => snippet);
      if (hit?.[1]) {
        row.snippet = hit[1];
        row.where = hit[0];
      }
    }
    return row;
  });
  return { items, total: picked.length };
}

// ［まとめてコピー］の文：一覧と同じ条件（字・段）で台帳から組み直す。カードごとに「【メモの題】」の行、引用があれば引用の行（quoteCopyLines）、カードの文（cardLines を改行でつなぐ）、カードの間は空行。
//   新しい順の頭から 300 件まで。字の無いカード（写真だけ）も、題の行だけで数える（一覧の件数と合わせる）
//   count：写した件数、total：絞ったあとの全部の数（300 を超えたかを一言で分ける）
export function cardHeartsCopy(list: readonly MemoCell[], req: { query: string; min: LikeLevel }): { text: string; count: number; total: number } {
  const { picked } = heartCards(list, req.query, req.min);
  const head = picked.slice(0, HEART_COPY_MAX);
  const text = head.map((p) => [`【${p.title}】`, ...quoteCopyLines(p.reply), ...cardLines(p.reply)].join('\n')).join('\n\n');
  return { text, count: head.length, total: picked.length };
}

// まとめてコピーの一言（計画 §9.2）
export function cardHeartsCopyNote(count: number, total: number): string {
  if (count === 0) return tr('コピーするカードがありません');
  if (total > HEART_COPY_MAX) return tr('新しい {0} 件をコピーしました', { 0: HEART_COPY_MAX });
  return tr('{0} 件をコピーしました', { 0: count });
}

function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
