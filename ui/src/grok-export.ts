// Grok 用に書き出す（export.v1）：左の盤面のタブ・メモのセル・下の区画のカード・島・関連の線を、変わらない id 付きの JSON にする
//   ・Grok Bot（使う人の PC のファイルを読み書きできる外のアシスタント）が読んで、提案（patch.v1。grok-patch.ts）を書くための写し
//   ・id：タブは uid（起動し直しても変わらない）、メモのセルは id、カードは「メモの id ＋ カードの id」、島は id
//   ・入れないもの：ページの本文・画像（data URL）・クリップボード・鍵。URL は ? と # から後ろを外す
//   ・ここは DOM を使わない（組み立てと大きさの確かめだけ。書くのは呼ぶ側）
import type { BoardLink } from './board-links';
import { stripUrlQuery } from './bot-replies';
import type { MemoCell } from './memocells';
import type { Sheet } from './sheets';
import type { Tab } from './tabs';
import type { Island } from './types';

export const EXPORT_MAX_CHARS = 2 * 1024 * 1024; // 書き出す JSON の上限（文字数。おおよそ 2 MB）

export type ExportScope = 'sheet' | 'all' | 'selection';

export interface ExportInput {
  scope: ExportScope;
  sheet: string; // 今見ているシート
  sheets: readonly Sheet[];
  tabs: readonly Tab[];
  memos: readonly MemoCell[];
  islands: readonly Island[];
  boardLinks: readonly BoardLink[];
  kindNames: Record<string, string>; // 盤面の関連の種類の名前
  selection?: { tabs: number[]; memos: string[] }; // scope が selection のとき
  now?: Date;
}

export interface ExportCard {
  memo: string;
  id: string;
  parent: string | null;
  text: string;
  tags?: string[];
  links?: { to: string; kind: string }[];
  by?: string; // 書いた AI の名前（使う人なら無し）
  createdAt: string;
}

export interface GrokExport {
  v: 1;
  type: 'export';
  app: 'honeycomb';
  exportedAt: string; // ISO。提案の basedOn にそのまま入れてもらう
  scope: ExportScope;
  sheet: { id: string; name: string };
  sheets: { id: string; name: string }[];
  tabs: { uid: string; sheet: string; title: string; url: string; tags: string[]; island: string | null; comment?: string; notes?: { id: string; text: string }[]; liked?: number }[];
  memos: { id: string; sheet: string; kind: 'memo' | 'portal' | 'bot' | 'app' | 'capture'; title: string; text: string; tags: string[]; island: string | null; updatedAt: string }[];
  cards: ExportCard[];
  islands: { id: string; name: string; color: string }[];
  boardLinks: { id: string; from: string; to: string; kind: string }[];
  kinds: Record<string, string>;
  limits: { opsPerPatch: number; tagsPerItem: number; tagChars: number; memoChars: number; cardChars: number };
  cut?: { cardTextTo?: number; memoTextTo?: number }; // 大きすぎて文を短くしたとき
}

const iso = (ms: number) => new Date(Number.isFinite(ms) ? ms : 0).toISOString();
const cut = (text: string, max: number) => {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
};
const firstLine = (text: string) => text.split('\n').find((l) => l.trim())?.trim() ?? '';

function memoKind(m: MemoCell): GrokExport['memos'][number]['kind'] {
  return m.portal ? 'portal' : m.bot ? 'bot' : m.app ? 'app' : m.capture ? 'capture' : 'memo';
}

// 組み立てる。大きすぎれば、カードとメモの文を短くして組み直す。それでも大きければ null
export function buildExport(input: ExportInput, limits: GrokExport['limits']): { data: GrokExport; json: string } | null {
  for (const [cardMax, memoMax] of [
    [20_000, 5_000],
    [1_000, 1_000],
    [200, 300],
  ] as const) {
    const data = assemble(input, limits, cardMax, memoMax);
    const json = JSON.stringify(data, null, 1);
    if (json.length <= EXPORT_MAX_CHARS) return { data, json };
  }
  return null;
}

function assemble(input: ExportInput, limits: GrokExport['limits'], cardMax: number, memoMax: number): GrokExport {
  const pickSheet = (sheet: string) => input.scope === 'all' || sheet === input.sheet;
  const selTabs = new Set(input.selection?.tabs ?? []);
  const selMemos = new Set(input.selection?.memos ?? []);
  const tabs = input.tabs.filter((t) => (input.scope === 'selection' ? selTabs.has(t.id) : pickSheet(t.sheet)));
  const memos = input.memos.filter((m) => (input.scope === 'selection' ? selMemos.has(m.id) : pickSheet(m.sheet)));
  const refs = new Set([...tabs.map((t) => `t:${t.uid}`), ...memos.map((m) => `m:${m.id}`)]);
  const usedIslands = new Set([...tabs.map((t) => t.island), ...memos.map((m) => m.island)].filter((i): i is string => !!i));
  const cards: ExportCard[] = [];
  for (const m of memos) {
    for (const r of m.replies ?? []) {
      cards.push({
        memo: m.id,
        id: r.id,
        parent: r.parent,
        text: cut(r.text, cardMax),
        ...(r.tags?.length ? { tags: [...r.tags] } : {}),
        ...(r.links?.length ? { links: r.links.map((l) => ({ to: l.to, kind: l.kind })) } : {}),
        ...(r.by ? { by: r.by.name } : {}),
        createdAt: iso(r.createdAt),
      });
    }
  }
  const sheetName = (id: string) => input.sheets.find((s) => s.id === id)?.name ?? id;
  return {
    v: 1,
    type: 'export',
    app: 'honeycomb',
    exportedAt: (input.now ?? new Date()).toISOString(),
    scope: input.scope,
    sheet: { id: input.sheet, name: sheetName(input.sheet) },
    sheets: input.sheets.map((s) => ({ id: s.id, name: s.name })),
    tabs: tabs.map((t) => ({
      uid: t.uid,
      sheet: t.sheet,
      title: cut(t.title, 200),
      url: stripUrlQuery(t.url),
      tags: [...t.tags],
      island: t.island,
      ...(t.comment ? { comment: t.comment } : {}),
      ...(t.notes.length ? { notes: t.notes.map((n) => ({ id: n.id, text: cut(n.text, memoMax) })) } : {}),
      ...(t.liked ? { liked: t.liked } : {}),
    })),
    memos: memos.map((m) => ({
      id: m.id,
      sheet: m.sheet,
      kind: memoKind(m),
      title: cut(firstLine(m.text), 60),
      text: cut(m.text, memoMax),
      tags: [...m.tags],
      island: m.island,
      updatedAt: iso(m.updatedAt),
    })),
    cards,
    islands: input.islands.filter((i) => usedIslands.has(i.id)).map((i) => ({ id: i.id, name: i.name, color: i.color })),
    boardLinks: input.boardLinks.filter((l) => refs.has(l.from) || refs.has(l.to)).map((l) => ({ id: l.id, from: l.from, to: l.to, kind: l.kind })),
    kinds: { ...input.kindNames },
    limits,
    ...(cardMax < 20_000 ? { cut: { cardTextTo: cardMax, memoTextTo: memoMax } } : {}),
  };
}

// 書き出すファイルの名前（ui-data\exports\state-YYYYMMDD-HHMMSS.json）
export function exportFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `exports/state-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.json`;
}
