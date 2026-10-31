// 右の「検索」のうち、右サイドバーが持っているもの（タブ・撮影・データ置き場・単語帳・リマインダー）を右の中で探す部品
//   ・左から届くメモ・コメントの結果と合わせて並べる（mergeRows）
//   ・台帳は読むだけ。置き場は目次だけを探す（本文のファイルは読まない）
//   ・照合と抜き出しは search.ts（正規化の結果は、文が同じあいだ覚えて使い回す）
import { t as tr } from './i18n';
import { type CaptureItem, captureFromTitle, HIDDEN_TEXT } from './captures';
import { clockOf, dayLabel, triggerLabel } from './reminder-when';
import { fold, type Folded, hasAll, queryWords, type SearchItem, type Snippet, snippetOf } from './search';
import type { Tab } from './tabs';
import type { Reminder } from './types';
import { hostOf } from './util';
import { VAULT_KIND_LABELS, type VaultItem } from './vault';
import type { VocabCard } from './vocab';

export type LocalKind = 'tab' | 'capture' | 'vault' | 'vocab' | 'reminder';
export type SearchTarget = 'memo' | LocalKind; // 「対象」の切り替え（memo はコメントを含む）
export const SEARCH_TARGETS: readonly SearchTarget[] = ['memo', 'tab', 'capture', 'vault', 'vocab', 'reminder'];

// 右の中で探した 1 行
export interface LocalItem {
  kind: LocalKind;
  id: string; // タブは番号を文字にしたもの
  title: string; // 40 字まで
  label: string; // 種類の名前（「タブ」「撮影」「置き場・会話」「単語帳・言葉」など）
  at: number | null; // 並べ方の時刻。null はタブ（時刻が無い。時刻のある行の下にまとめる）
  lastUsed?: number; // タブだけ：今の起動で最後に表示した時刻（タブの群の中の並び）
  sheet?: string; // タブだけ：シートの id
  where?: string; // 当たった所の短い名前（「URL」「読んだ文字」など。題名に当たったときは無し）
  snippet?: Snippet;
}
export type PanelRow = SearchItem | LocalItem;

// 探す元（選んでいない対象・まだ届いていないものは undefined）
export interface LocalSources {
  tabs?: readonly Tab[];
  captures?: readonly CaptureItem[];
  vault?: readonly VaultItem[];
  vocab?: readonly VocabCard[];
  reminders?: readonly Reminder[]; // まだ鳴っていないリマインダー（左の台帳の写し）
}

const TITLE_MAX = 40;

const SCOPE_TITLE: Record<CaptureItem['scope'], string> = {
  center: tr('中央を撮ったもの'),
  window: tr('窓全体を撮ったもの'),
  desktop: tr('デスクトップを撮ったもの'),
  region: tr('範囲を撮ったもの'),
};

// 正規化の結果の覚え（文が同じあいだは使い回す。語があるときの 1 回の検索で使わなかったものは消す）
const foldCache = new Map<string, { src: string; folded: Folded }>();

function foldedOf(key: string, src: string, used: Set<string>): Folded {
  used.add(key);
  const cached = foldCache.get(key);
  if (cached && cached.src === src) return cached.folded;
  const folded = fold(src);
  foldCache.set(key, { src, folded });
  return folded;
}

// 40 字まで（コードポイントで数え、超えたら 40 字＋「…」。memocells.ts の memoTitle と同じ切り方）
function clip(text: string): string {
  const chars = [...text];
  return chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX).join('')}…` : text;
}

// 最初の空でない行（前後の空白は除く）
function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim())?.trim() ?? '';
}

const hashTags = (tags: readonly string[]) => tags.map((t) => `#${t}`).join(' ');

// 右の中で探す。語が空のとき：タブは出さず、ほかは全部を行にする
export function searchLocal(src: LocalSources, query: string): LocalItem[] {
  const words = queryWords(query);
  const rows: LocalItem[] = [];
  const used = new Set<string>();

  // 欄の並び（where が '' の欄は題名の欄）を見て、行にするか決める。欄は語があるときだけ作る
  const add = (row: LocalItem, fields: () => [string, string][]) => {
    if (words.length === 0) {
      rows.push(row);
      return;
    }
    const list = fields();
    const folds = list.map(([, text], n) => foldedOf(`${row.kind}:${row.id}:${n}`, text, used));
    if (!hasAll(folds.map((f) => f.text).join(' '), words)) return;
    for (let n = 0; n < list.length; n++) {
      const snippet = snippetOf(list[n][1], folds[n], words);
      if (!snippet) continue;
      row.snippet = snippet;
      if (list[n][0]) row.where = list[n][0];
      break;
    }
    rows.push(row);
  };

  // タブには時刻が無いので、字が無いときは出さない
  if (words.length > 0) {
    for (const tab of src.tabs ?? []) {
      add(
        {
          kind: 'tab',
          id: String(tab.id),
          title: clip(tab.title || hostOf(tab.url) || tab.url || tr('新しいタブ')),
          label: tr('タブ'),
          at: null,
          lastUsed: tab.lastUsed,
          sheet: tab.sheet,
        },
        () => [
          ['', tab.title],
          ['URL', tab.url],
          [tr('タグ'), hashTags(tab.tags)],
          [tr('ひとこと'), tab.comment ?? ''],
          [tr('タブのメモ'), tab.notes.map((n) => n.text).join('\n')],
          [tr('タブのメモのコメント'), tab.notes.flatMap((n) => (n.replies ?? []).map((r) => r.text)).join('\n')],
        ],
      );
    }
  }

  for (const item of src.captures ?? []) {
    const title = clip(firstLine(item.comment)) || (item.source?.title ? clip(item.source.title) : '') || (item.from ? clip(captureFromTitle(item.from)) : '') || (item.video ? tr('録画') : SCOPE_TITLE[item.scope]);
    add({ kind: 'capture', id: item.id, title, label: item.video ? tr('撮影・録画') : tr('撮影'), at: item.createdAt }, () => [
      ['', item.comment],
      [tr('ページ名'), item.source?.title ?? ''],
      [tr('送った元'), item.from?.name ?? ''],
      [tr('スタンプ'), item.marks.map((m) => m.note).join('\n')],
      [tr('線の文字'), item.strokes.map((s) => s.text).join('\n')],
      // 読んだ文字：チェックが入り、表の追加の行でなく、隠していない、空でない行だけ（pageText は探さない）
      [tr('読んだ文字'), (item.ocr ?? []).filter((l) => l.on && !l.table && l.text !== HIDDEN_TEXT && l.text.trim()).map((l) => l.text).join('\n')],
    ]);
  }

  for (const item of src.vault ?? []) {
    add({ kind: 'vault', id: item.id, title: clip(item.title.trim()) || tr('（題名なし）'), label: tr('置き場・{0}', { 0: VAULT_KIND_LABELS[item.kind] }), at: item.createdAt }, () => [
      ['', item.title],
      [tr('はじめの文'), item.preview],
      [tr('タグ'), hashTags(item.tags)],
      [tr('ページ名'), item.source.pageTitle ?? ''],
      [tr('話した人'), [item.source.speaker ?? '', ...(item.source.members ?? [])].join(' ')],
      [tr('トピック'), item.source.topic ?? ''],
    ]);
  }

  for (const card of src.vocab ?? []) {
    add({ kind: 'vocab', id: card.id, title: clip(firstLine(card.front)) || tr('（空のカード）'), label: card.kind === 'quiz' ? tr('単語帳・問い') : tr('単語帳・言葉'), at: card.createdAt }, () => [
      ['', card.front],
      [tr('意味・答え'), card.back],
      [tr('例文'), card.example ?? ''],
      [tr('ページ名'), card.source?.title ?? ''],
    ]);
  }

  // リマインダーは左の台帳の写し（まだ鳴っていないもの）を探す。題名は本文の 1 行目
  for (const r of src.reminders ?? []) {
    add({ kind: 'reminder', id: r.id, title: clip(firstLine(r.text)) || tr('（空のリマインダー）'), label: tr('リマインダー・{0}', { 0: r.trigger ? triggerLabel(r.trigger) : `${dayLabel(r.dueAt, Date.now())} ${clockOf(r.dueAt)}` }), at: r.createdAt }, () => [
      ['', r.text],
      [tr('指す先'), r.title ?? ''],
    ]);
  }

  // 使わなかった覚えを消す（語が空のときは何も覚えていない）
  if (words.length > 0) for (const key of [...foldCache.keys()]) if (!used.has(key)) foldCache.delete(key);
  return rows;
}

// 同じ時刻のときの並び（左の行を先に、種類ごとに）
const RANK: Record<PanelRow['kind'], number> = { memo: 0, reply: 1, capture: 2, vault: 3, vocab: 4, reminder: 5, tab: 6 };

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// 左の行は memoId・replyId の順（memo-search.ts の並びと同じ）、右の行は id
// （種類が同じ行どうしで呼ぶので、左と右が混ざることはない）
function idOrder(a: PanelRow, b: PanelRow): number {
  if ('memoId' in a) return 'memoId' in b ? compare(a.memoId, b.memoId) || compare(a.replyId ?? '', b.replyId ?? '') : 0;
  return 'memoId' in b ? 0 : compare(a.id, b.id);
}

const lastUsedOf = (row: PanelRow) => ('memoId' in row ? 0 : (row.lastUsed ?? 0));
const idOf = (row: PanelRow) => ('memoId' in row ? row.memoId : row.id);

// 左のメモ・コメントの上位と、右の中の結果を、1 本に並べて先頭から limit 件を返す
//   ・時刻のある行が先、タブ（時刻なし）が後ろ
//   ・時刻のある行どうし：新しい順 → 種類の順 → id の文字順
//   ・タブどうし：最後に表示した順 → id の文字順
export function mergeRows(memo: readonly SearchItem[], local: readonly LocalItem[], limit: number): PanelRow[] {
  const rows: PanelRow[] = [...memo, ...local];
  rows.sort((a, b) => {
    const ta = a.at;
    const tb = b.at;
    if (ta !== null && tb === null) return -1;
    if (ta === null && tb !== null) return 1;
    if (ta !== null && tb !== null) return tb - ta || RANK[a.kind] - RANK[b.kind] || idOrder(a, b);
    return lastUsedOf(b) - lastUsedOf(a) || compare(idOf(a), idOf(b));
  });
  return rows.slice(0, limit);
}
