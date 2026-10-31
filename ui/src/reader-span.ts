// 六角で見る（動画の区間セル）の区間を、読む画面のマスの番号へ当てる関数と、マスごとに結んだカードの数（plan-reader-video の V0b。段 V0b）
//   ・区間（ReplySpan）はマスの指紋と始まり・終わりの秒。引くときは指紋を先に、だめなら時刻で当て直す（D19）
//   ・マスごとの結んだカードの数（▤n の元）：AI のカードは範囲の始まりのマスにだけ数える（S7）
//   ・純粋な関数だけ（DOM・window・時計・乱数を使わない）。型だけ reader-links.ts から読む
import type { ReplySpan } from './reader-links';

// 読む画面のマス（指紋と、動画のときの秒）。読む画面の Cell はこれを満たす
export interface SpanCell {
  key: string;
  start?: number;
  end?: number;
}

export const SPAN_SLACK = 2; // 時刻で当て直すときの、始まりのずれの許し（秒）

// 秒として使える数か（有限の数だけ通す）
const isSec = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw);

// マスの秒（始まりと終わりが両方数のときだけ。どちらかが無ければ null）
function timeOf(cell: SpanCell): { start: number; end: number } | null {
  return isSec(cell.start) && isSec(cell.end) ? { start: cell.start, end: cell.end } : null;
}

// 区間と、マスの秒が重なるか（端が触れるだけは重ならない。長さ 0 の区間は、始まりを含むマスを重なりとみなす）
function overlaps(time: { start: number; end: number }, span: ReplySpan): boolean {
  if (span.end <= span.start) return time.start <= span.start && span.start < time.end;
  return time.start < span.end && span.start < time.end;
}

// 区間のマスの番号（指紋が合えばその番号、無ければ時刻で当て直す。どちらも無ければ -1）
export function locateSpan(cells: readonly SpanCell[], span: ReplySpan): number {
  // 指紋が合うマス（同じ指紋が二つあれば前のもの）
  const byKey = cells.findIndex((cell) => cell.key === span.key);
  if (byKey !== -1) return byKey;
  // 時刻で当て直す：始まりのずれが許し以内で区間と重なるマスのうち、始まりが一番近いもの（同じなら番号の小さいもの）
  let best = -1;
  let bestGap = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const time = timeOf(cells[i]);
    if (!time) continue;
    const gap = Math.abs(time.start - span.start);
    if (gap > SPAN_SLACK || !overlaps(time, span)) continue;
    if (gap < bestGap) {
      best = i;
      bestGap = gap;
    }
  }
  return best;
}

// 区間にかかるマスの番号（小さい順。重なりなし）。時刻の当て直しの許しは使わず、区間と重なるマスを入れる
// 指紋か時刻で locateSpan が引けたマスも入れる（時刻の無いマスでも指紋が合えば入る）
export function cellsOfSpan(cells: readonly SpanCell[], span: ReplySpan): number[] {
  const hit = new Set<number>();
  for (let i = 0; i < cells.length; i++) {
    const time = timeOf(cells[i]);
    if (time && overlaps(time, span)) hit.add(i);
  }
  const located = locateSpan(cells, span);
  if (located !== -1) hit.add(located);
  return [...hit].sort((a, b) => a - b);
}

// マスごとに結んだカードの数（▤n の元。長さは cells.length）
//   ・AI でない項目：spans のそれぞれを locateSpan で引き、見つかったマスに 1 を足す（同じマスに何本当たっても 1 だけ）
//   ・AI の項目：spans[0] だけを引き、見つかったマスに 1 を足す（範囲の始まりのマスにだけ。決めごと S7）
export function countLinksByCell(cells: readonly SpanCell[], items: readonly { spans: readonly ReplySpan[]; ai?: boolean }[]): number[] {
  const counts = cells.map(() => 0);
  for (const item of items) {
    if (item.ai) {
      if (item.spans.length === 0) continue;
      const i = locateSpan(cells, item.spans[0]);
      if (i !== -1) counts[i] += 1;
      continue;
    }
    // 一つの項目が同じマスに何本当たっても、そのマスには 1 だけ足す
    const hit = new Set<number>();
    for (const span of item.spans) {
      const i = locateSpan(cells, span);
      if (i !== -1) hit.add(i);
    }
    for (const i of hit) counts[i] += 1;
  }
  return counts;
}

// そのマスに結んだ項目の番号（items の順。readerNow の元。V2b）。数え方は countLinksByCell と同じ
//   ・AI の項目は spans[0] が当たるマスだけ、ほかの項目は spans のどれかが当たるマス
export function itemsAtCell(cells: readonly SpanCell[], items: readonly { spans: readonly ReplySpan[]; ai?: boolean }[], index: number): number[] {
  const out: number[] = [];
  if (index < 0 || index >= cells.length) return out;
  items.forEach((item, n) => {
    const spans = item.ai ? item.spans.slice(0, 1) : item.spans;
    if (spans.some((span) => locateSpan(cells, span) === index)) out.push(n);
  });
  return out;
}
