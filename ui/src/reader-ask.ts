// 読む画面の「AI…」の頼み板の純粋な関数（plan-reader-video の V4a-1。段 V4a-1）
//   ・範囲：範囲のマスの番号（askRangeCells）と、頼み板・カードに出す範囲の名前（askRangeLabel）
//   ・送る字幕と料金の目安：送るマスの組み方と字数の上限（askPayload）、料金の目安（askEstimate）
//   ・答えの読み方（parseAskLines）、練習モードの決まった返事（practiceAskLines）、間（pauseLines。AI を使わない）、カードの見出し（askHead）
//   ・読み込むのは reader-ai-card.ts の secLabel と型 AiCardLine だけ。純粋な関数だけ（DOM・window・Date.now・Math.random を使わない）。外へ送らない
import { type AiCardLine, secLabel } from './reader-ai-card';

// 頼みの種類（分ける：技法の色・話の骨組み・天丼と伏線・間。応用：この型で別の話題）
export type AskKind = 'tech' | 'bones' | 'tendon' | 'pause' | 'apply';
// 話の種類（お笑い・講義）
export type AskLens = 'comedy' | 'lecture';
// 範囲（今のマス・選んだマス・このチャプター・全体）
export type AskRange = 'one' | 'picked' | 'chapter' | 'all';

export const ASK_KIND_NAME: Record<AskKind, string> = { tech: '技法の色', bones: '話の骨組み', tendon: '天丼と伏線', pause: '間', apply: 'この型で別の話題' };
export const ASK_LENS_NAME: Record<AskLens, string> = { comedy: 'お笑い', lecture: '講義' };
export const ASK_RANGE_NAME: Record<AskRange, string> = { one: '今のマス', picked: '選んだマス', chapter: 'このチャプター', all: '全体' };
// 札の名前（AI に選ばせる名前。練習モードの決まった返事にも使う）
export const ASK_TAGS: Record<AskLens, Record<'tech' | 'bones' | 'tendon', readonly string[]>> = {
  comedy: { tech: ['フリ', 'ボケ', 'ツッコミ', '天丼', '回収', 'すかし', '間'], bones: ['前振り', '重ねる', '期待させる', '裏切る', '回収'], tendon: ['天丼', '伏線', '回収'] },
  lecture: { tech: ['主張', '根拠', '例', '反論', 'まとめ', '問い'], bones: ['問い', '主張', '根拠', '例', 'まとめ'], tendon: ['くり返し', '伏線', '回収'] },
};
export const ASK_MAX_LINES = 40; // AI の答えから読む行の数の上限
export const ASK_SEND_CAP = 60_000; // 送る字幕の字数（コードポイント）の上限
export const ASK_TEXT_MAX = 120; // 1 行の文の字数（コードポイント）
export const ASK_TECH_MAX = 12; // 札の字数（コードポイント。reader-ai-card.ts の AI_TECH_MAX と同じ値）
export const PAUSE_MIN_GAP = 0.6; // 間とみなすマスとマスの空き（秒）
export const PAUSE_MAX_LINES = 12; // 間の行の数の上限
const CHAPTER_NAME_MAX = 20; // チャプターの名前の字数（コードポイント。超えたら … を付ける）

// 読む画面のマス（読む画面の Cell はこれを満たす）
export interface AskCell {
  text: string;
  head?: boolean; // 見出し（チャプター）のマス
  start?: number; // 秒
  end?: number; // 秒
}

// AI に送る 1 マス（n は送る順の番号 0〜。sec はそのマスの始まりの秒、t は secLabel(sec)）
export interface AskSent {
  n: number;
  sec: number;
  t: string;
  text: string;
}

// 送る字幕の全体（chars は入れた文の字数の合計、clipped は上限で切ったか）
export interface AskPayload {
  sent: AskSent[];
  chars: number; // 送る字幕の字数（コードポイント）
  clipped: boolean; // 上限で切った
}

// 空白（改行も）を一つの空白にまとめ、前後を取る
function squash(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

// 字数（コードポイント）で先頭 n 字を取る
function firstChars(s: string, n: number): string {
  return [...s].slice(0, n).join('');
}

// 頼みの話題：まとめて空なら「別の話題」
function topicOf(topic: string | undefined): string {
  return squash(topic ?? '') || '別の話題';
}

// 時刻のマスの始まりの秒（見出しでなく、始まりが有限の数のマス。ほかは undefined）
function startOf(cell: AskCell): number | undefined {
  if (cell.head) return undefined;
  const s = cell.start;
  return typeof s === 'number' && Number.isFinite(s) ? s : undefined;
}

// 番号 from 以上・to 未満の時刻のマスの番号（小さい順）
function timeIndices(cells: readonly AskCell[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) {
    if (startOf(cells[i]) !== undefined) out.push(i);
  }
  return out;
}

// 見出しのマスの番号（小さい順）
function headIndices(cells: readonly AskCell[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].head) out.push(i);
  }
  return out;
}

// 「今のマス」：番号が範囲外（整数でない番号も含む）なら []。見出しなら、その後ろで最初の時刻のマス。時刻のマスなら [そのマス]、ほかは []
function oneCells(cells: readonly AskCell[], current: number): number[] {
  if (!Number.isInteger(current) || current < 0 || current >= cells.length) return [];
  if (!cells[current].head) return startOf(cells[current]) === undefined ? [] : [current];
  for (let i = current + 1; i < cells.length; i++) {
    if (startOf(cells[i]) !== undefined) return [i];
  }
  return [];
}

// 「選んだマス」：picked のうち、範囲内の整数で時刻のマスのもの（重なりを除いて小さい順）
function pickedCells(cells: readonly AskCell[], picked: readonly number[]): number[] {
  const hit = new Set<number>();
  for (const i of picked) {
    if (Number.isInteger(i) && i >= 0 && i < cells.length && startOf(cells[i]) !== undefined) hit.add(i);
  }
  return [...hit].sort((a, b) => a - b);
}

// 「このチャプター」：current 以下で一番後ろの見出しの次から、次の見出しまで。最初の見出しより前なら 0 から最初の見出しまで。見出しが無ければ []
function chapterCells(cells: readonly AskCell[], current: number): number[] {
  const heads = headIndices(cells);
  if (heads.length === 0) return [];
  const at = Math.min(Math.max(current, 0), cells.length - 1); // 番号を 0〜cells.length - 1 に収める
  let h = -1; // current 以下で一番大きい見出し（無ければ -1）
  for (const i of heads) {
    if (i <= at) h = i;
  }
  if (h === -1) return timeIndices(cells, 0, heads[0]);
  const next = heads.find((i) => i > h);
  return timeIndices(cells, h + 1, next ?? cells.length);
}

// 範囲のマスの番号（小さい順・重なりなし。時刻のマスだけ）
export function askRangeCells(cells: readonly AskCell[], range: AskRange, current: number, picked: readonly number[]): number[] {
  if (range === 'one') return oneCells(cells, current);
  if (range === 'picked') return pickedCells(cells, picked);
  if (range === 'chapter') return chapterCells(cells, current);
  return timeIndices(cells, 0, cells.length); // 全体
}

// チャプターの名前：indices の最初より前で一番近い見出しの文（20 字を超えたら 20 字と …）。見出しが無ければ「このチャプター」
function chapterName(cells: readonly AskCell[], first: number): string {
  for (let i = first - 1; i >= 0; i--) {
    if (!cells[i].head) continue;
    const name = squash(cells[i].text);
    if (!name) return ASK_RANGE_NAME.chapter; // 見出しの文が空なら、範囲の名前のまま
    return [...name].length > CHAPTER_NAME_MAX ? `${firstChars(name, CHAPTER_NAME_MAX)}…` : name;
  }
  return ASK_RANGE_NAME.chapter;
}

// 頼み板とカードの見出しに出す範囲の名前（indices が空なら範囲の名前そのまま）
export function askRangeLabel(cells: readonly AskCell[], range: AskRange, indices: readonly number[]): string {
  if (indices.length === 0) return ASK_RANGE_NAME[range];
  const first = cells[indices[0]];
  const last = cells[indices[indices.length - 1]];
  const from = secLabel(first.start ?? 0);
  const span = `${from}〜${secLabel(last.end ?? last.start ?? 0)}`;
  if (range === 'one') return `${ASK_RANGE_NAME.one}（${from}）`;
  if (range === 'picked') return `選んだ ${indices.length} の区間（${span}）`;
  if (range === 'chapter') return `${chapterName(cells, indices[0])}（${span}）`;
  return `${ASK_RANGE_NAME.all}（${span}）`;
}

// 送る字幕：indices の順に時刻のマスだけを送る形にする。文の字数を足して cap を超えるところで止めて clipped。1 つ目のマスは超えても入れる
export function askPayload(cells: readonly AskCell[], indices: readonly number[], cap = ASK_SEND_CAP): AskPayload {
  const sent: AskSent[] = [];
  let chars = 0;
  for (const i of indices) {
    const sec = startOf(cells[i]);
    if (sec === undefined) continue;
    const text = squash(cells[i].text);
    const len = [...text].length;
    if (sent.length > 0 && chars + len > cap) return { sent, chars, clipped: true };
    sent.push({ n: sent.length, sec, t: secLabel(sec), text });
    chars += len;
  }
  return { sent, chars, clipped: false };
}

// 料金の目安（ドル）：入力は 字数 × 1.2 ＋ 1 マスあたり 15 ＋ 900（指示文）。書く分は low が 500、high が多いときの値（600 ＋ 1 マスあたり 40、4000 まで）
export function askEstimate(payload: { chars: number; sent: readonly unknown[] }, price: { input: number; output: number }): { input: number; low: number; high: number } {
  const input = Math.round(payload.chars * 1.2) + payload.sent.length * 15 + 900;
  const outputHigh = Math.min(4000, 600 + payload.sent.length * 40);
  const low = (input * price.input + 500 * price.output) / 1_000_000;
  const high = (input * price.input + outputHigh * price.output) / 1_000_000;
  return { input, low, high };
}

// AI の答えの 1 行を読む（使えない形なら null）：n は送った番号の範囲内の整数、文はまとめて空でないもの（ASK_TEXT_MAX 字まで）、札は文字列なら 〔〕を除いて ASK_TECH_MAX 字まで（空なら札なし）
function readAskLine(item: unknown, sent: readonly AskSent[]): AiCardLine | null {
  if (typeof item !== 'object' || item === null) return null;
  const { n, tech, text } = item as { n?: unknown; tech?: unknown; text?: unknown };
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= sent.length) return null;
  if (typeof text !== 'string') return null;
  const body = firstChars(squash(text), ASK_TEXT_MAX);
  if (body === '') return null;
  const label = typeof tech === 'string' ? firstChars(squash(tech.replace(/[〔〕]/g, '')), ASK_TECH_MAX) : '';
  const sec = sent[n].sec;
  return label ? { sec, tech: label, text: body } : { sec, text: body };
}

// AI の答え（JSON を読んだ値）を本文の行にする：lines を前から見て、使えるものを ASK_MAX_LINES 行まで。sec の小さい順（同じなら元の順）
export function parseAskLines(raw: unknown, sent: readonly AskSent[]): AiCardLine[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const lines = (raw as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  const out: AiCardLine[] = [];
  for (const item of lines) {
    if (out.length >= ASK_MAX_LINES) break;
    const line = readAskLine(item, sent);
    if (line) out.push(line);
  }
  return out.sort((a, b) => a.sec - b.sec); // sort は同じ値なら元の順を保つ
}

// 練習モードの決まった返事（料金なし）：行の数は min(6, 文の数)。札は回す（応用は話の骨組みの札）。文は決まった形（応用は題を入れる）
export function practiceAskLines(kind: Exclude<AskKind, 'pause'>, lens: AskLens, sent: readonly AskSent[], topic?: string): AiCardLine[] {
  if (sent.length === 0) return [];
  const tags = kind === 'apply' ? ASK_TAGS[lens].bones : ASK_TAGS[lens][kind];
  const count = Math.min(6, sent.length);
  const out: AiCardLine[] = [];
  for (let i = 0; i < count; i++) {
    const at = sent[Math.floor((i * sent.length) / count)];
    const tag = tags[i % tags.length];
    const text = kind === 'apply'
      ? `（練習モード）「${topicOf(topic)}」の${tag}にあたる一文が入ります`
      : `（練習モード）「${firstChars(at.text, 16)}」について、ここに説明が入ります`;
    out.push({ sec: at.sec, tech: tag, text });
  }
  return out;
}

// 間（AI を使わない・料金なし）：indices の隣り合う時刻のマスの空きが PAUSE_MIN_GAP 秒以上のもの。空きの大きい順に PAUSE_MAX_LINES 個まで選び、sec の小さい順に並べる
export function pauseLines(cells: readonly AskCell[], indices: readonly number[]): AiCardLine[] {
  const gaps: { gap: number; sec: number; text: string }[] = [];
  for (let k = 0; k + 1 < indices.length; k++) {
    const a = indices[k];
    const b = indices[k + 1];
    if (b !== a + 1) continue;
    const startA = startOf(cells[a]);
    const startB = startOf(cells[b]);
    if (startA === undefined || startB === undefined) continue;
    const gap = startB - (cells[a].end ?? startA);
    if (gap >= PAUSE_MIN_GAP) gaps.push({ gap, sec: startB, text: firstChars(squash(cells[b].text), 24) });
  }
  return gaps
    .sort((x, y) => y.gap - x.gap) // 空きの大きい順（同じなら前のもの）
    .slice(0, PAUSE_MAX_LINES)
    .sort((x, y) => x.sec - y.sec)
    .map((g) => ({ sec: g.sec, tech: `間 ${g.gap.toFixed(1)}秒`, text: `「${g.text}」の前` }));
}

// カードの見出し：この型は題と範囲、間は「間・範囲」、そのほかは技法・骨組みなど（講義のときは「（講義）」）と範囲
export function askHead(kind: AskKind, lens: AskLens, rangeLabel: string, topic?: string): string {
  if (kind === 'apply') return `この型で「${topicOf(topic)}」・${rangeLabel}`;
  if (kind === 'pause') return `間・${rangeLabel}`;
  return `${ASK_KIND_NAME[kind]}${lens === 'lecture' ? '（講義）' : ''}・${rangeLabel}`;
}
