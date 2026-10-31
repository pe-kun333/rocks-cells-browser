// 読む画面の「全体の地図」（帯の上の点・チャプターの区切り・900 マスの外）の純粋な関数（plan-reader-video の V6a。段 V6a）
//   ・地図を組む（overviewModel）：読む画面のマス・この動画と結んだカード・900 マスの外から、帯の上の位置（0〜1）に点・区切り・外を組む
//   ・帯の上の位置を秒に当てる（overviewTime）と、位置が 900 マスの外かを見る（overviewInCut）
//   ・900 マスの知らせの文（capNotice）
//   ・読み込むのは reader-ai-card.ts の secLabel だけ。純粋な関数だけ（DOM・window・Date.now・Math.random を使わない）。外へ送らない
import { t } from './i18n';
import { secLabel } from './reader-ai-card';

// 点の種類（heart＝♥、note＝マスのメモ、card＝この動画と結んだカード、ai＝AI のカード）
export type OverviewKind = 'heart' | 'note' | 'card' | 'ai';
export const OVERVIEW_KINDS: readonly OverviewKind[] = ['heart', 'note', 'card', 'ai'];
export const OVERVIEW_BUCKETS = 400; // 帯を 400 に分けた同じ枠に入る同じ種類の点は、一つにまとめる

// 地図に描くマス（読む画面の Cell と印から、主担当が組む）
export interface OverviewCell {
  head?: boolean;
  start?: number;
  end?: number;
  liked?: boolean; // ♥ がある
  note?: boolean; // マスのメモがある
}

// この動画と結んだカード（左の写し readerLinks の items から、主担当が組む）
export interface OverviewCard {
  spans: readonly { start: number }[];
  ai: boolean; // AI のカード（by がある）
}

export interface OverviewInput {
  duration: number; // 動画の長さ（秒）。使える秒でなければ、または 0 なら、分からない
  cells: readonly OverviewCell[];
  cards: readonly OverviewCard[];
  cut: { from: number; to: number } | null; // 900 マスの外（秒）。字幕は後ろ（from＝切った所、to＝字幕の終わり）、聞き取りは頭（from＝0、to＝残っている最初のマス）
}

export interface OverviewPoint {
  kind: OverviewKind;
  at: number; // 帯の上の位置（0〜1）
  sec: number; // 秒（まとめたときは、その枠でいちばん早い秒）
  count: number; // まとめた数（1 以上）
}

export interface OverviewModel {
  length: number; // 帯の全体の秒（0 なら地図を出さない）
  points: OverviewPoint[];
  chapters: { at: number; sec: number }[]; // チャプターの区切り
  cut: { from: number; to: number } | null; // 900 マスの外（0〜1）
}

// 使える秒（有限の数で 0 以上）
function usable(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

// lo〜hi に収める
function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// 時刻のマス（頭でなく、始まりが使える秒）の始まり。違えば null
function timedStart(c: OverviewCell): number | null {
  if (c.head || !usable(c.start)) return null;
  return c.start;
}

// 区切りのマス（頭で、始まりが使える秒）の始まり。違えば null
function chapterStart(c: OverviewCell): number | null {
  if (!c.head || !usable(c.start)) return null;
  return c.start;
}

// 帯の上の位置の枠（0 から OVERVIEW_BUCKETS - 1 まで）
function bucketOf(at: number): number {
  return Math.min(OVERVIEW_BUCKETS - 1, Math.floor(at * OVERVIEW_BUCKETS));
}

// 全体の地図を組む（入力は変えない）
export function overviewModel(input: OverviewInput): OverviewModel {
  // 900 マスの外は、from・to が使える秒で to > from のときだけ使う
  const cut = input.cut !== null && usable(input.cut.from) && usable(input.cut.to) && input.cut.to > input.cut.from ? input.cut : null;
  const cutTo = cut ? cut.to : 0;

  // 時刻のマスと区切りのマスの終わり（終わりが使えなければ始まり）のいちばん後ろ
  let lastEnd = 0;
  for (const c of input.cells) {
    const s = timedStart(c) ?? chapterStart(c);
    if (s !== null) lastEnd = Math.max(lastEnd, usable(c.end) ? c.end : s);
  }

  // 帯の全体の秒（動画の長さ・マスの終わり・900 マスの外の後ろの、いちばん大きい値）
  const length = Math.max(usable(input.duration) ? input.duration : 0, lastEnd, cutTo);
  if (length <= 0) return { length: 0, points: [], chapters: [], cut: null };

  // まとめる前の点（種類と秒）
  const raw: { kind: OverviewKind; sec: number }[] = [];
  for (const c of input.cells) {
    const s = timedStart(c);
    if (s === null) continue;
    if (c.liked) raw.push({ kind: 'heart', sec: s });
    if (c.note) raw.push({ kind: 'note', sec: s });
  }
  for (const card of input.cards) {
    if (!card.ai) {
      // この動画と結んだカードは、区間ごとに 1 つ
      for (const span of card.spans) {
        if (usable(span.start)) raw.push({ kind: 'card', sec: span.start });
      }
      continue;
    }
    // AI のカードは、範囲の始まり（使える始まりのいちばん小さい値）を 1 つだけ。使える始まりが無ければ描かない
    let first: number | null = null;
    for (const span of card.spans) {
      if (usable(span.start) && (first === null || span.start < first)) first = span.start;
    }
    if (first !== null) raw.push({ kind: 'ai', sec: first });
  }

  // 同じ種類・同じ枠の点は一つにまとめる（count を足し、sec と at は一番早いもの）
  const merged = new Map<string, OverviewPoint>();
  for (const r of raw) {
    const at = clamp(r.sec / length, 0, 1);
    const key = `${r.kind}:${bucketOf(at)}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { kind: r.kind, at, sec: r.sec, count: 1 });
    } else {
      prev.count += 1;
      if (r.sec < prev.sec) {
        prev.sec = r.sec;
        prev.at = at;
      }
    }
  }
  // 並び：種類の順（OVERVIEW_KINDS）、同じ種類の中は秒の早い順
  const points = Array.from(merged.values()).sort(
    (a, b) => OVERVIEW_KINDS.indexOf(a.kind) - OVERVIEW_KINDS.indexOf(b.kind) || a.sec - b.sec,
  );

  // チャプターの区切り：同じ枠に入るものは、早い方だけ残す
  const chapterByBucket = new Map<number, { at: number; sec: number }>();
  for (const c of input.cells) {
    const s = chapterStart(c);
    if (s === null) continue;
    const at = clamp(s / length, 0, 1);
    const b = bucketOf(at);
    const prev = chapterByBucket.get(b);
    if (!prev || s < prev.sec) chapterByBucket.set(b, { at, sec: s });
  }
  const chapters = Array.from(chapterByBucket.values()).sort((a, b) => a.sec - b.sec);

  return {
    length,
    points,
    chapters,
    cut: cut ? { from: clamp(cut.from / length, 0, 1), to: clamp(cut.to / length, 0, 1) } : null,
  };
}

// 帯の上の位置（0〜1）を秒に当てる（位置は 0〜1 に収め、有限の数でなければ 0。地図が 0 秒なら 0）
export function overviewTime(model: OverviewModel, fraction: number): number {
  if (model.length <= 0) return 0;
  const f = Number.isFinite(fraction) ? clamp(fraction, 0, 1) : 0;
  return f * model.length;
}

// 位置が 900 マスの外（cut の from から to まで。両端を含む）かどうか
export function overviewInCut(model: OverviewModel, fraction: number): boolean {
  return model.cut !== null && model.cut.from <= fraction && fraction <= model.cut.to;
}

// 900 マスの知らせの文（side は end＝字幕を後ろで切った、start＝聞き取りで古いマスを外した）
export function capNotice(c: { side: 'end' | 'start'; at: number; duration: number; total: number; kept: number }): string {
  if (c.side === 'start') {
    return t('聞き取りの区間セルは {0} マスまでなので、{1} より前の {2} マスを外しました（外したマスは記録にも残りません。全体の地図の斜線の所）', { 0: c.kept, 1: secLabel(c.at), 2: c.total - c.kept });
  }
  if (usable(c.duration) && c.duration > 0) {
    return t('この動画は {0} ありますが、区間セルは {1} マスまでなので、{2} から後ろは入っていません（字幕は全部で {3} マス分。全体の地図の斜線の所）', { 0: secLabel(c.duration), 1: c.kept, 2: secLabel(c.at), 3: c.total });
  }
  return t('区間セルは {0} マスまでなので、{1} から後ろは入っていません（字幕は全部で {2} マス分。全体の地図の斜線の所）', { 0: c.kept, 1: secLabel(c.at), 2: c.total });
}
