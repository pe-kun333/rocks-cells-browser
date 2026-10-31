// 六角で見る（動画の区間セル）のマスと、下の区画のコメントのカードを結ぶ線の形（docs/plan-reader-video.md §6。段 V0）
//   ・線はカードの任意の欄 at に持つ（一番上のカードだけ。台帳の版は上げない。マスのメモとカードは別のもの。D1）
//   ・動画の見分け：YouTube は動画の id（11 字）、自分のファイルは「f:」＋ URL の指紋（ファイルの場所は書かない。reader/video-key.ts）
//   ・区間：マスの指紋（reader/store.ts の cellKeys の形）と、始まり・終わりの秒。引くときは指紋を先に、だめなら時刻で当て直す（D19）
//   ・この形を読むのは左（台帳）・下の区画・読む画面。どれもこの parseAt で形を確かめる

// AI のカードの種類（見えるタグにはしない。D5）：技法・骨組み・天丼と伏線・間・応用・やり取り
export type ReaderAiKind = 'tech' | 'bones' | 'tendon' | 'pause' | 'apply' | 'talk';
export const READER_AI_KINDS: readonly ReaderAiKind[] = ['tech', 'bones', 'tendon', 'pause', 'apply', 'talk'];

export interface ReplySpan {
  key: string; // マスの指紋（cellKeys の形。同じ本文の 2 つ目からは #2・#3…）
  start: number; // 秒
  end: number;
}

export interface ReplyAt {
  video: string; // 動画の見分け（YouTube は動画の id、自分のファイルは f:＋指紋）
  title?: string; // 動画の題の頭（動画の札・時刻順の仕切り用。60 字まで）
  spans: ReplySpan[]; // 結んだ区間（1〜12 本。AI のカードは頼んだ範囲の 1 本）
  kind?: ReaderAiKind; // AI のカードの種類（AI のカードだけ）
}

// ---------- 左が読む画面へ押す「結んだカードの写し」（保存しない。D16。組むのは reader-links-view.ts） ----------
//   items：台帳全体から、その動画に結んだ一番上のカード（別のメモに入ったカードも数える。Q2）
//   target：結ぶ先のメモ（今下の区画で開いているメモ。無い・特別なセルなら null ＝ 最初に書くときに動画のメモを作る）

export interface ReaderLinkItem {
  memoId: string;
  replyId: string;
  spans: ReplySpan[];
  kind?: ReaderAiKind;
  ai: boolean; // AI のカード（by がある）
  head: string; // カードの題（cardLabel の 40 字）
}

export interface ReaderLinkTop {
  replyId: string;
  head: string; // カードの題（cardLabel の 40 字）
  video?: string; // このカードがもう結んでいる動画（別の動画なら「カードと結ぶ…」で選べない。1 枚のカードは 1 本の動画だけ）
}

export interface ReaderLinkTarget {
  memoId: string;
  title: string; // メモの頭の 1 行（40 字）
  replies: number; // このメモの返信の数（上限 max に近ければ読む画面が残りを出す）
  max: number;
  tops: ReaderLinkTop[]; // 一番上のカード（並べた順。「カードと結ぶ…」の一覧の元）
}

export interface ReaderLinksView {
  video: string;
  target: ReaderLinkTarget | null;
  items: ReaderLinkItem[];
  memos: { memoId: string; title: string }[]; // この動画のカードがあるメモ（「結ぶ先 ▾」の候補。items の順に重ねずに 20 まで。V1c）
}

// 読む画面の今のマス（readerNow。読む画面 → 下の区画の落ちてもよい連絡。V2b）
//   key・start・end：今のマス（見出しのマスなら、その次のマス）　replyIds：そのマスと結んだカード（左の写しで、▤n と同じ数え方）
export interface ReaderNow {
  video: string;
  title?: string; // 動画の題の頭（＋コメントで結ぶときの at.title）
  key: string;
  start: number;
  end: number;
  replyIds: string[];
}

// 読む画面から左への頼みを断った理由（readerCardDone の reason。読む画面は書きかけを下書きに戻す。D18）
//   full：返信が 300　special：特別なセル（入口・ボット・アプリ・撮ったもの）　gone：メモかカードがもう無い
//   ledger：台帳を読めていない　form：形が合わない・id がもう使われている　video：カードが別の動画に結んである　over：区間が 12 本を超える
export type ReaderRefusal = 'full' | 'special' | 'gone' | 'ledger' | 'form' | 'video' | 'over';

export const MAX_AT_SPANS = 12;
export const MAX_AT_TITLE = 60;
const MAX_SPAN_SEC = 1_000_000; // 区間の秒の上限（長い配信でも届かない大きさ）
const VIDEO_RE = /^(?:[\w-]{11}|f:\d{1,9}:[0-9a-f]{1,8})$/;
const SPAN_KEY_RE = /^\d{1,9}:[0-9a-f]{1,8}(?:#\d{1,4})?$/;

const isRecord = (raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null && !Array.isArray(raw);

// 動画の見分けの形か（YouTube の動画の id か、f:＋指紋）
export function isVideoKey(raw: unknown): raw is string {
  return typeof raw === 'string' && VIDEO_RE.test(raw);
}

export function isReaderAiKind(raw: unknown): raw is ReaderAiKind {
  return typeof raw === 'string' && (READER_AI_KINDS as readonly string[]).includes(raw);
}

// 秒を 0.01 秒にそろえる（台帳を小さく保つ）
const roundSec = (sec: number) => Math.round(sec * 100) / 100;

// 区間を 1 本読む（形が合わなければ null）
export function parseSpan(raw: unknown): ReplySpan | null {
  if (!isRecord(raw)) return null;
  const { key, start, end } = raw;
  if (typeof key !== 'string' || !SPAN_KEY_RE.test(key)) return null;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || end > MAX_SPAN_SEC) return null;
  return { key, start: roundSec(start), end: roundSec(end) };
}

// 区間の並びを読む：形の合わないもの・同じ指紋の 2 本目は捨てる。12 本まで（並びは来た順のまま。先頭が「最初の区間」）
export function parseSpans(raw: unknown): ReplySpan[] {
  if (!Array.isArray(raw)) return [];
  const out: ReplySpan[] = [];
  for (const item of raw) {
    if (out.length >= MAX_AT_SPANS) break;
    const span = parseSpan(item);
    if (span && !out.some((s) => s.key === span.key)) out.push(span);
  }
  return out;
}

// 動画の題の頭（改行は空白に、前後の空白を取り、60 字まで。空なら undefined）
export function cleanAtTitle(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat ? [...flat].slice(0, MAX_AT_TITLE).join('') : undefined;
}

// 今あるカードの線に区間を足す・外す（readerLink。段 V2a-1）。外すのはマスの指紋で、足すのは形の合う区間だけ（同じ指紋は足さない）
//   カードが別の動画に結んであれば video、合わせて 12 本を超えるなら over、足すものが全部崩れていれば form。全部外れたら at は null
//   題は来たものがあれば置き換え、無ければ今のまま。AI のカードの種類は今のまま
export function withLinkedSpans(
  at: ReplyAt | undefined,
  video: string,
  title: unknown,
  add: unknown,
  remove: unknown,
): { ok: true; at: ReplyAt | null } | { ok: false; why: 'video' | 'over' | 'form' } {
  if (!isVideoKey(video)) return { ok: false, why: 'form' };
  if (at && at.video !== video) return { ok: false, why: 'video' };
  const rawAdd = Array.isArray(add) ? add : [];
  const adds = parseSpans(rawAdd.slice(0, MAX_AT_SPANS + 1));
  if (rawAdd.length > 0 && adds.length === 0) return { ok: false, why: 'form' };
  const gone = new Set(Array.isArray(remove) ? remove.filter((k): k is string => typeof k === 'string') : []);
  const spans = (at?.spans ?? []).filter((s) => !gone.has(s.key));
  for (const span of adds) if (!spans.some((s) => s.key === span.key)) spans.push(span);
  if (spans.length > MAX_AT_SPANS) return { ok: false, why: 'over' };
  if (spans.length === 0) return { ok: true, at: null };
  const name = cleanAtTitle(title) ?? at?.title;
  return { ok: true, at: { video, ...(name ? { title: name } : {}), spans, ...(at?.kind ? { kind: at.kind } : {}) } };
}

// 保存してあった「結んだ区間」を読む（動画の見分けか区間が合わなければ undefined。題と種類は、合わなければその項目だけ捨てる）
export function parseAt(raw: unknown): ReplyAt | undefined {
  if (!isRecord(raw) || !isVideoKey(raw.video)) return undefined;
  const spans = parseSpans(raw.spans);
  if (spans.length === 0) return undefined;
  const title = cleanAtTitle(raw.title);
  return {
    video: raw.video,
    ...(title ? { title } : {}),
    spans,
    ...(isReaderAiKind(raw.kind) ? { kind: raw.kind } : {}),
  };
}
