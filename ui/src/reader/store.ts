// 六角で読んだページの印（♥・メモ・しおり・AI の要点）を、URL ごとに保存する（ui-data\reader\）
//   マスは本文の指紋で見分けるので、ページが少し変わっても、同じ文のマスには同じ印が戻る
import { fingerprint } from '../ai/history';
import { readData, writeData } from '../data';
import type { LiveComment } from './live-ai';
import type { LoopSet } from '../reader-loop';

export interface CellMark {
  liked: number; // ♥ の段階（0〜3）
  note?: string; // 自分のメモ
}

export interface ReaderAi {
  at: number;
  levels: Record<string, number>; // マス → 要点度（1〜3）
  terms: { key: string; term: string; explanation: string }[]; // 難しい語の解説
  cost: number;
}

export interface ReaderSaved {
  version: 1;
  url: string;
  title: string;
  savedAt: number;
  position: string | null; // しおり（最後に読んでいたマス）
  marks: Record<string, CellMark>;
  ai?: ReaderAi;
  comments?: LiveComment[]; // AI と一緒に見たときの、相棒のひとこと
  liveCells?: { text: string; start: number; end: number; para?: boolean }[]; // ライブキャプションで聞き取ったマス
  ja?: Record<string, string>; // 区間セルの日本語（マスの指紋 → 訳）
  drafts?: { key: string; text: string }[]; // 一行の欄の下書き（マスの指紋 → 書きかけ。古い順・10 まで。plan-reader-video の V1b）
  sets?: LoopSet[]; // 名前つきの組（選んだ区間と回し方。20 まで。読むときは parseLoopSets。plan-reader-video の V3b-3）
  aiSpent?: number; // この動画で頼み板の AI に使った額の目安（ドル。見せるだけ。この機能だけの上限は無い。plan-reader-video の V4a・D6）
}

export const MAX_DRAFTS = 10;
export const MAX_DRAFT_TEXT = 500;

// 保存してあった下書きを読む（形の合わないもの・空・同じマスの 2 つ目は捨てる。新しい 10 件まで）
export function parseDrafts(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const { key, text } = item as Record<string, unknown>;
    if (typeof key !== 'string' || !key || key.length > 40 || typeof text !== 'string') continue;
    const clean = [...text.trim()].slice(0, MAX_DRAFT_TEXT).join('');
    if (!clean || out.has(key)) continue;
    out.set(key, clean);
  }
  return new Map([...out].slice(-MAX_DRAFTS));
}

// マスの見分け方：本文の指紋＋同じ本文の何番目か
export function cellKeys(texts: string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((t) => {
    const print = fingerprint(t);
    const n = (seen.get(print) ?? 0) + 1;
    seen.set(print, n);
    return n === 1 ? print : `${print}#${n}`;
  });
}

function fileOf(url: string) {
  const key = url.replace(/#.*$/, '');
  return `reader/r${fingerprint(key).replace(/[^0-9a-z]/gi, '_')}.json`;
}

export async function loadReader(url: string): Promise<ReaderSaved | null> {
  const saved = await readData<ReaderSaved>(fileOf(url));
  return saved && saved.version === 1 && typeof saved.marks === 'object' ? saved : null;
}

export function saveReader(saved: ReaderSaved): Promise<boolean> {
  return writeData(fileOf(saved.url), saved);
}
