// 撮影の台帳（C1）。右サイドバーだけが読み書きする。AI には送らない。
//   ui-data\captures.json … 目次（画像の中身は入れない）
//   ui-data\captures\<id>.json … { version: 1, data: "data:image/jpeg;base64,..." }
//   画像の data URL は fetch しない（UI の CSP が data: への接続を止める。メモの分割 M3 と同じ）
import { request } from './bridge';
import { HIDDEN_TEXT, paintHide, type HideMode } from './capture-hide';
import { deleteData, readData, writeData } from './data';
import { likeLevel } from './likes';

export { HIDDEN_TEXT } from './capture-hide';

export const CAPTURE_LIMIT = 80;
export const COMMENT_MAX = 2000;
export const COMMENT_HINT = 280;
export const CAPTURE_LONG_EDGE = 1600;
export const MARK_NOTE_MAX = 80;
export const MARK_LIMIT = 40;
export const STROKE_LIMIT = 40;
export const STROKE_TEXT_MAX = 80;
export const BLUR_LIMIT = 20;
const IMAGE_URL_MAX = 1_500_000;

export const STROKE_KINDS = ['arrow', 'rect', 'marker', 'text'] as const;
export type StrokeKind = (typeof STROKE_KINDS)[number];

// 道具ごとの色。台帳に書くのはこの4つだけ（任意の文字は受け取らない）
export const STROKE_COLOR: Record<StrokeKind, string> = {
  arrow: '#c23b4a',
  rect: '#c23b4a',
  marker: '#e2b340',
  text: '#c23b4a',
};

export const STAMPS = [
  { id: 'good', emoji: '👍', label: 'ここがいい' },
  { id: 'star', emoji: '⭐', label: '大事' },
  { id: 'ask', emoji: '❓', label: 'あとで聞く' },
  { id: 'idea', emoji: '💡', label: 'アイデア' },
  { id: 'care', emoji: '⚠', label: '気になる' },
] as const;

export type StampId = (typeof STAMPS)[number]['id'];

export interface CaptureMark {
  id: string;
  stamp: StampId;
  x: number; // 画像の幅に対する割合（0〜1）
  y: number; // 画像の高さに対する割合（0〜1）
  note: string; // 一行。80字まで。空でもよい
  extra?: Record<string, unknown>; // この段階が知らない項目。保存するときに戻す
}

// 矢印・四角・蛍光ペン・文字。ピクセルには焼かない（C4）
export interface CaptureStroke {
  id: string;
  kind: StrokeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  text: string; // 文字の中身、または矢印・四角のひとこと（R4）。一行。80字まで
  extra?: Record<string, unknown>; // この段階が知らない項目。保存するときに戻す
}

// 隠した矩形。JPEG にも焼き込む。ここには場所と隠し方だけ残し、もう一度別の場所を隠せる（C4・R3）
export interface CaptureBlur {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  mode?: string; // 隠し方。'fill' | 'mosaic'。無いのは R3 より前（モザイク）。知らない値は塗りつぶし扱い（resolveHideMode）
  extra?: Record<string, unknown>; // この段階が知らない項目。保存するときに戻す
}

// この段階が読めなかった要素（知らないスタンプ・道具・色など）。メモリにだけ持ち、保存するときに元の場所へ戻す
export interface KeptPiece {
  at: number; // 読んだときの配列の添字
  raw: Record<string, unknown>; // 受け取ったままの要素（浅いコピー）
}

export interface CaptureSource {
  url: string;
  title: string;
}

// 中央のページの録画（C6）。mp4 自体は C++ が ui-data\captures\<id>.mp4 に書く。ここは長さと時刻だけ。
export interface CaptureVideo {
  seconds: number; // 0〜120
  bytes: number;
  times: number[]; // ミリ秒。4秒ごとと、最後。40個まで
}

// 盤面・下の区画の画像から送ったもの（依頼① I4）。省いてよい。version は 1 のまま（古い版は extra に残して書き戻す）
export const CAPTURE_FROM_KINDS = ['memoCard', 'cellImage', 'tabImage'] as const;
export type CaptureFromKind = (typeof CAPTURE_FROM_KINDS)[number];
export interface CaptureFrom {
  kind: CaptureFromKind;
  name?: string; // 送った元の名前（メモ・タブの題名など）。一行・80 字まで
}
export const FROM_NAME_MAX = 80;
export const CAPTURE_FROM_LABEL: Record<CaptureFromKind, string> = {
  memoCard: '下の区画のカードの画像',
  cellImage: '盤面のセルの画像',
  tabImage: 'タブの見た目の画像',
};

// 空白のかたまり（改行も）を 1 つの空白にして、80 字まで
export function clipFromName(text: string): string {
  return [...text.replace(/\s+/g, ' ').trim()].slice(0, FROM_NAME_MAX).join('').trim();
}

// kind と name だけを持つ形のときだけ読む。知らない kind・ほかのキーがあるものは undefined（呼び側が extra に残す）
export function cleanFrom(raw: unknown): CaptureFrom | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  for (const key of Object.keys(row)) if (key !== 'kind' && key !== 'name') return undefined;
  const kind = (CAPTURE_FROM_KINDS as readonly unknown[]).includes(row.kind) ? (row.kind as CaptureFromKind) : null;
  if (!kind) return undefined;
  if (row.name === undefined) return { kind };
  if (typeof row.name !== 'string') return undefined;
  const name = clipFromName(row.name);
  return { kind, ...(name ? { name } : {}) };
}

// 範囲の表示や大きく開く題名に使う。名前があれば「ラベル「名前」」
export function captureFromTitle(from: CaptureFrom): string {
  const label = CAPTURE_FROM_LABEL[from.kind];
  return from.name ? `${label}「${from.name}」` : label;
}

export const RECORD_LIMIT_SECONDS = 120;
export const RECORD_TIME_LIMIT = 40;
export const OCR_LINE_LIMIT = 240;
export const OCR_TEXT_MAX = 500;
export const PAGE_TEXT_MAX = 2000;
const VIDEO_BYTES_MAX = 96 * 1024 * 1024;
const VIDEO_TIME_MAX = RECORD_LIMIT_SECONDS * 1000;

export const CAPTURE_SCOPES = ['center', 'window', 'desktop', 'region'] as const;
export type CaptureScope = (typeof CAPTURE_SCOPES)[number];
export type CaptureVia = 'wgc' | 'gdi';

// 読んだ1行（C7）。矩形は画像に対する割合。on が false の行は、あとで AI に渡さない
export interface CaptureOcrLine {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  on: boolean;
  table?: boolean; // 揃った表を `|` でつないだ追加の行
  at?: number; // 録画のミリ秒。静止画には付けない
}

export interface CaptureItem {
  id: string;
  createdAt: number;
  scope: CaptureScope;
  comment: string;
  liked: number; // 0〜3。タブやメモの ♥ とは別
  marks: CaptureMark[]; // 画像の上のスタンプ。ピクセルとは別
  strokes: CaptureStroke[]; // 矢印・四角・蛍光ペン・文字。ピクセルとは別
  blur: CaptureBlur[]; // 確認して JPEG に焼き込んだ矩形
  source?: CaptureSource; // 中央のページだけ。窓・デスクトップ・範囲には付けない
  via?: CaptureVia; // wgc は黄色い枠が出た。gdi は画面のコピー
  video?: CaptureVideo; // 中央の録画。代表の JPEG は今までどおりの画像。mp4 は別ファイル
  ocr?: CaptureOcrLine[]; // 読んだ行。空配列は「読んだが文字が無かった」
  pageText?: string; // 中央のページの本文。読むときに getPageText で取る。2,000字まで
  askedAt?: number; // 最後に AI へ頼んだ時刻。送るを押したとき
  from?: CaptureFrom; // 盤面・下の区画の画像から送った（I4）。scope は region
  extra?: Record<string, unknown>; // この段階が知らない項目。保存するときに戻す
  kept?: { marks: KeptPiece[]; strokes: KeptPiece[]; blur: KeptPiece[] }; // 読めなかった要素。メモリだけ。保存するときに戻す
}

interface CaptureIndex {
  version: 1;
  items: CaptureItem[];
}

const INDEX = 'captures.json';
// 目次を読めなかったとき、間をおいて読み直す（最大 2 回）。それでも読めなければ読み取り専用にする
const LOAD_RETRY_DELAYS_MS = [1000, 3000];
const ID_RE = /^c[0-9a-z]{6,32}$/;

export function isCaptureId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}
const MARK_ID_RE = /^m[0-9a-z]{4,24}$/;
const STROKE_ID_RE = /^s[0-9a-z]{4,24}$/;
const BLUR_ID_RE = /^k[0-9a-z]{4,24}$/;
const OCR_ID_RE = /^o[0-9a-z]{4,24}$/;
const KNOWN_KEYS = new Set(['id', 'createdAt', 'scope', 'comment', 'liked', 'source', 'marks', 'strokes', 'blur', 'via', 'video', 'ocr', 'pageText', 'askedAt', 'from', 'extra']);
// 要素ごとの既知のキー。これ以外は extra に入れて、保存するときに戻す
const MARK_KEYS = new Set(['id', 'stamp', 'x', 'y', 'note']);
const STROKE_KEYS = new Set(['id', 'kind', 'x1', 'y1', 'x2', 'y2', 'color', 'text']);
const BLUR_KEYS = new Set(['id', 'x', 'y', 'w', 'h', 'mode']);
const STAMP_IDS = new Set<string>(STAMPS.map((stamp) => stamp.id));
const STROKE_KIND_SET = new Set<string>(STROKE_KINDS);
const STROKE_COLOR_SET = new Set<string>(Object.values(STROKE_COLOR));

export function stampOf(id: string) {
  return STAMPS.find((stamp) => stamp.id === id);
}

export function newMarkId() {
  return newPieceId('m');
}

export function newStrokeId() {
  return newPieceId('s');
}

export function newBlurId() {
  return newPieceId('k');
}

export function newOcrId() {
  return newPieceId('o');
}

function newPieceId(prefix: string) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function clipMarkNote(text: string) {
  return clipLine(text, MARK_NOTE_MAX);
}

export function clipStrokeText(text: string) {
  return clipLine(text, STROKE_TEXT_MAX);
}

function clipLine(text: string, limit: number) {
  return [...text.replace(/[ \t]*\n[ \t]*/g, ' ')].slice(0, limit).join('');
}

export function captureImageName(id: string) {
  return `captures/${id}.json`;
}

export function newCaptureId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function clipComment(text: string) {
  return [...text].slice(0, COMMENT_MAX).join('');
}

function cleanSource(raw: unknown): CaptureSource | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  if (typeof row.url !== 'string' || typeof row.title !== 'string') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(row.url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  parsed.hash = '';
  const url = parsed.toString();
  if (url.length > 2048) return undefined;
  const title = [...row.title.replace(/\s+/g, ' ').trim()].slice(0, 200).join('');
  return { url, title };
}

export function sourceOf(url: string, title: string): CaptureSource | undefined {
  return cleanSource({ url, title });
}

function unit(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return Math.round(clamped * 10000) / 10000;
}

// 要素の知らないキー。受け取った要素が extra（メモリ上の形）を持っていれば、その中のキーも知らないキーとして残す。
// 既知のキーは extra に入れない（保存するとき、既知のキーを上書きさせない）
function extraOfPiece(row: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> | undefined {
  const entries: [string, unknown][] = [];
  const nested = row.extra;
  const hasNested = !!nested && typeof nested === 'object' && !Array.isArray(nested);
  if (hasNested) for (const [key, value] of Object.entries(nested)) if (!known.has(key)) entries.push([key, value]);
  for (const [key, value] of Object.entries(row)) {
    if (known.has(key) || (key === 'extra' && hasNested)) continue;
    entries.push([key, value]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

interface SortedPieces<T> {
  known: T[];
  kept: KeptPiece[];
}

// 配列を「既知の形になった要素」と「id は合うが既知の形にならない要素（kept）」に分ける。id が合わない・オブジェクトでないものは捨てる。
// 上限は既知と kept を別々に数える
function sortPieces<T>(raw: unknown, limit: number, idRe: RegExp, build: (row: Record<string, unknown>, id: string) => T | null): SortedPieces<T> {
  const known: T[] = [];
  const kept: KeptPiece[] = [];
  if (!Array.isArray(raw)) return { known, kept };
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || !idRe.test(row.id)) continue;
    const piece = build(row, row.id);
    // 上限は既知と kept で別々に数える（読む画面と setX は既知だけで上限を数えるので、書いたものがそのまま読み戻る）。
    // at は受け入れた要素の通し番号（捨てた要素で、戻す位置がずれないように）
    if (piece) {
      if (known.length < limit) known.push(piece);
    } else if (kept.length < limit) {
      kept.push({ at: known.length + kept.length, raw: { ...row } });
    }
  }
  return { known, kept };
}

function sortMarks(raw: unknown): SortedPieces<CaptureMark> {
  return sortPieces(raw, MARK_LIMIT, MARK_ID_RE, (row, id) => {
    if (typeof row.stamp !== 'string' || !STAMP_IDS.has(row.stamp)) return null;
    const x = unit(row.x);
    const y = unit(row.y);
    if (x === null || y === null) return null;
    const extra = extraOfPiece(row, MARK_KEYS);
    return { id, stamp: row.stamp as StampId, x, y, note: typeof row.note === 'string' ? clipMarkNote(row.note) : '', ...(extra ? { extra } : {}) };
  });
}

function sortStrokes(raw: unknown): SortedPieces<CaptureStroke> {
  return sortPieces(raw, STROKE_LIMIT, STROKE_ID_RE, (row, id) => {
    if (typeof row.kind !== 'string' || !STROKE_KIND_SET.has(row.kind)) return null;
    if (typeof row.color !== 'string' || !STROKE_COLOR_SET.has(row.color)) return null;
    const x1 = unit(row.x1);
    const y1 = unit(row.y1);
    const x2 = unit(row.x2);
    const y2 = unit(row.y2);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    const kind = row.kind as StrokeKind;
    const text = typeof row.text === 'string' ? clipStrokeText(row.text) : ''; // 文字以外（矢印・四角）のひとことも持つ（R4 F4）
    if (kind === 'text' && !text) return null;
    const extra = extraOfPiece(row, STROKE_KEYS);
    return { id, kind, x1, y1, x2, y2, color: row.color, text, ...(extra ? { extra } : {}) };
  });
}

// 割合の矩形を整える。4桁に丸め、0〜1 に収め（右と下は画像の外へ出る分を縮める）、幅か高さが 0.01 未満なら null
function fitRect(raw: { x?: unknown; y?: unknown; w?: unknown; h?: unknown }): HideRect | null {
  const x = unit(raw.x);
  const y = unit(raw.y);
  const w = unit(raw.w);
  const h = unit(raw.h);
  if (x === null || y === null || w === null || h === null) return null;
  const width = x + w > 1 ? Math.round((1 - x) * 10000) / 10000 : w;
  const height = y + h > 1 ? Math.round((1 - y) * 10000) / 10000 : h;
  if (width < 0.01 || height < 0.01) return null;
  return { x, y, w: width, h: height };
}

function fitRects(rects: readonly HideRect[]): HideRect[] {
  const fitted: HideRect[] = [];
  for (const rect of rects) {
    const fit = fitRect(rect);
    if (fit) fitted.push(fit);
  }
  return fitted;
}

function sortBlurs(raw: unknown): SortedPieces<CaptureBlur> {
  return sortPieces(raw, BLUR_LIMIT, BLUR_ID_RE, (row, id) => {
    const rect = fitRect(row);
    if (!rect) return null;
    // mode が文字列でないのは、この段階が知らない形。消さずに kept へ回す（文字列なら、知らない値でもそのまま往復させる）
    if (row.mode !== undefined && typeof row.mode !== 'string') return null;
    const extra = extraOfPiece(row, BLUR_KEYS);
    return { id, ...rect, ...(typeof row.mode === 'string' ? { mode: row.mode } : {}), ...(extra ? { extra } : {}) };
  });
}

// 呼び口が使う形。既知の要素だけを返す（kept は cleanItem が sortX で取る）
export function cleanMarks(raw: unknown): CaptureMark[] {
  return sortMarks(raw).known;
}

export function cleanStrokes(raw: unknown): CaptureStroke[] {
  return sortStrokes(raw).known;
}

export function cleanBlurs(raw: unknown): CaptureBlur[] {
  return sortBlurs(raw).known;
}

export function cleanVideo(raw: unknown): CaptureVideo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  if (typeof row.seconds !== 'number' || !Number.isFinite(row.seconds)) return undefined;
  const seconds = Math.round(row.seconds);
  if (seconds < 0 || seconds > RECORD_LIMIT_SECONDS) return undefined;
  if (typeof row.bytes !== 'number' || !Number.isFinite(row.bytes)) return undefined;
  const bytes = Math.round(row.bytes);
  if (bytes < 0 || bytes > VIDEO_BYTES_MAX) return undefined;
  if (!Array.isArray(row.times)) return undefined;
  const times: number[] = [];
  for (const item of row.times) {
    if (times.length >= RECORD_TIME_LIMIT) break;
    if (typeof item !== 'number' || !Number.isFinite(item)) continue;
    const ms = Math.round(item);
    if (ms < 0 || ms > VIDEO_TIME_MAX) continue;
    times.push(ms);
  }
  if (times.length === 0) times.push(0);
  return { seconds, bytes, times };
}

export function cleanOcr(raw: unknown): CaptureOcrLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: CaptureOcrLine[] = [];
  for (const item of raw) {
    if (lines.length >= OCR_LINE_LIMIT) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || !OCR_ID_RE.test(row.id)) continue;
    if (typeof row.text !== 'string') continue;
    const text = clipOcrText(row.text);
    if (!text) continue;
    const x = unit(row.x);
    const y = unit(row.y);
    const w = unit(row.w);
    const h = unit(row.h);
    if (x === null || y === null || w === null || h === null) continue;
    const at = typeof row.at === 'number' && Number.isFinite(row.at) ? Math.round(row.at) : undefined;
    lines.push({
      id: row.id,
      text,
      x,
      y,
      w,
      h,
      on: row.on !== false,
      ...(row.table === true ? { table: true } : {}),
      ...(at !== undefined && at >= 0 && at <= VIDEO_TIME_MAX ? { at } : {}),
    });
  }
  return lines;
}

export function clipOcrText(text: string) {
  return [...text.replace(/[ \t]*\n[ \t]*/g, ' ')].slice(0, OCR_TEXT_MAX).join('').trim();
}

export function cleanPageText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = [...raw].slice(0, PAGE_TEXT_MAX).join('');
  return text.length > 0 ? text : undefined;
}

// ホストが返した行に、台帳用の id を付ける。チェックは初め付いている
export function ocrLinesFromHost(raw: unknown): CaptureOcrLine[] {
  if (!Array.isArray(raw)) return [];
  const staged: unknown[] = [];
  for (const item of raw) {
    if (staged.length >= OCR_LINE_LIMIT) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    staged.push({ ...row, id: newOcrId(), on: true });
  }
  return dropTableDuplicates(cleanOcr(staged));
}

// 表の行（`|` でつないだ行）があるとき、中心がその矩形の中に入る元の行は外す（同じ文字を二度出さない）。
// 録画は、同じ時刻（at）の表の行だけを見る。表の行は on のまま
function dropTableDuplicates(lines: CaptureOcrLine[]): CaptureOcrLine[] {
  const tables = lines.filter((line) => line.table === true);
  if (tables.length === 0) return lines;
  return lines.map((line) => {
    if (line.table === true) return line;
    const cx = line.x + line.w / 2;
    const cy = line.y + line.h / 2;
    const inside = tables.some((table) => table.at === line.at && cx >= table.x && cx <= table.x + table.w && cy >= table.y && cy <= table.y + table.h);
    return inside ? { ...line, on: false } : line;
  });
}

// ぼかしの矩形と重なる読んだ行は、文字を「（隠した）」にして外す（行の位置は残す）。
//   横に少しでも重なり、縦の重なりが行の高さの 30% 以上なら重なりとみなす。録画の行（at 付き）も区別しない
export function hideBlurredLines(lines: readonly CaptureOcrLine[], blur: readonly CaptureBlur[]): CaptureOcrLine[] {
  if (blur.length === 0) return lines.map((line) => ({ ...line }));
  return lines.map((line) => {
    if (line.text === HIDDEN_TEXT) return { ...line };
    const covered = blur.some((region) => {
      const dx = Math.min(region.x + region.w, line.x + line.w) - Math.max(region.x, line.x);
      const dy = Math.min(region.y + region.h, line.y + line.h) - Math.max(region.y, line.y);
      return dx > 0 && line.h > 0 && dy >= line.h * 0.3;
    });
    return covered ? { ...line, text: HIDDEN_TEXT, on: false } : { ...line };
  });
}

function extraOf(row: Record<string, unknown>) {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) if (!KNOWN_KEYS.has(key)) extra[key] = value;
  return Object.keys(extra).length > 0 ? extra : undefined;
}

function cleanItem(raw: unknown): CaptureItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !ID_RE.test(row.id)) return null;
  const scope = row.scope === 'center' || row.scope === 'window' || row.scope === 'desktop' || row.scope === 'region' ? row.scope : null;
  if (!scope) return null;
  if (typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)) return null;
  const comment = typeof row.comment === 'string' ? clipComment(row.comment) : '';
  const liked = likeLevel(row.liked) ?? 0;
  const source = scope === 'center' ? cleanSource(row.source) : undefined;
  const via = row.via === 'wgc' || row.via === 'gdi' ? row.via : undefined;
  const video = cleanVideo(row.video);
  const ocr = Array.isArray(row.ocr) ? cleanOcr(row.ocr) : undefined;
  const pageText = cleanPageText(row.pageText);
  const askedAt = typeof row.askedAt === 'number' && Number.isFinite(row.askedAt) && row.askedAt > 0 ? Math.round(row.askedAt) : undefined;
  const from = cleanFrom(row.from);
  // 読めない from（知らない kind・ほかのキーつき）は、丸ごと extra に残す（KNOWN_KEYS に入れたので extraOf では消える）
  const baseExtra = extraOf(row);
  const extra = row.from !== undefined && !from ? { ...baseExtra, from: row.from } : baseExtra;
  const marks = sortMarks(row.marks);
  const strokes = sortStrokes(row.strokes);
  const blur = sortBlurs(row.blur);
  const hasKept = marks.kept.length + strokes.kept.length + blur.kept.length > 0;
  return {
    id: row.id,
    createdAt: row.createdAt,
    scope,
    comment,
    liked,
    marks: marks.known,
    strokes: strokes.known,
    blur: blur.known,
    ...(source ? { source } : {}),
    ...(via ? { via } : {}),
    ...(video ? { video } : {}),
    ...(ocr ? { ocr } : {}),
    ...(pageText ? { pageText } : {}),
    ...(askedAt ? { askedAt } : {}),
    ...(from ? { from } : {}),
    ...(extra ? { extra } : {}),
    ...(hasKept ? { kept: { marks: marks.kept, strokes: strokes.kept, blur: blur.kept } } : {}),
  };
}

// 既知の要素は extra を平らに戻し、kept の要素は読んだときの添字（at）の昇順で元の場所へ差し戻す
function pieceRows<T extends { extra?: Record<string, unknown> }>(known: readonly T[], kept: readonly KeptPiece[] | undefined): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = known.map(({ extra, ...rest }) => ({ ...rest, ...extra }));
  if (kept) for (const piece of [...kept].sort((a, b) => a.at - b.at)) rows.splice(Math.min(piece.at, rows.length), 0, { ...piece.raw });
  return rows;
}

function toRow(item: CaptureItem) {
  const { extra, kept, ...known } = item;
  return {
    ...known,
    marks: pieceRows(known.marks, kept?.marks),
    strokes: pieceRows(known.strokes, kept?.strokes),
    blur: pieceRows(known.blur, kept?.blur),
    ...extra,
  };
}

export type FitFailure = 'decode' | 'empty' | 'canvas' | 'encode';

// 長い辺 1,600 の JPEG（品質 0.85）。src は data: の URL だけ
export async function fitCaptureImage(src: string): Promise<{ dataUrl: string } | { error: FitFailure }> {
  if (!src.startsWith('data:image/')) return { error: 'decode' };
  const img = await loadImage(src);
  if (!img) return { error: 'decode' };
  if (img.naturalWidth < 1 || img.naturalHeight < 1) return { error: 'empty' };
  try {
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = longEdge > CAPTURE_LONG_EDGE ? CAPTURE_LONG_EDGE / longEdge : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'canvas' };
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    if (!jpegUrl(dataUrl)) return { error: 'encode' };
    return { dataUrl };
  } catch {
    return { error: 'canvas' };
  }
}

function jpegUrl(value: string) {
  return /^data:image\/jpeg;base64,./.test(value) && value.length <= IMAGE_URL_MAX;
}

// 録画の代表の画像を作れなかったときの、仮の画像（640×360）。mp4 は残っているので、カードだけは作る。作れなければ null
export function placeholderRecordImage(seconds: number): string | null {
  try {
    const shown = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 40px "Yu Gothic UI", "Meiryo UI", sans-serif';
    ctx.fillText(`録画 ${shown} 秒`, canvas.width / 2, 150);
    ctx.font = '26px "Yu Gothic UI", "Meiryo UI", sans-serif';
    ctx.fillText('代表の画像を作れませんでした', canvas.width / 2, 214);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return jpegUrl(dataUrl) ? dataUrl : null;
  } catch {
    return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// 目次（captures.json）の読みの状態。ready のときだけ書く。readonly は読めなかったので、上書きしないために書かない
export type CaptureStoreState = 'loading' | 'ready' | 'readonly';
// 読めなかったわけ。timeout＝返事が来ない　broken＝中身が壊れている　version＝新しい版の形　unreadable＝画像はあるのに目次を開けない
export type CaptureLoadFailure = 'timeout' | 'broken' | 'version' | 'unreadable';

type IndexRead = { ok: true; items: CaptureItem[] } | { ok: false; failure: CaptureLoadFailure };

function pause(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

// ---- 隠す（R3）。右の店が、ファイルの画像を自分で読んで塗る、たった一つの入口 ----
export interface HideRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// rects … 画像に塗る場所（割合）。lineIds … 画像は塗らず、文字だけ隠す読んだ行（録画の別の時刻の行など）
export interface HideRequest {
  rects: HideRect[];
  mode: HideMode;
  lineIds?: string[];
}

// saved：一覧（captures.json）まで書けたか。false のときは画像は塗れているが、開き直すと読んだ文字が戻ることがある
export type HideResult =
  | { ok: true; image: string; blur: CaptureBlur[]; undo: boolean; saved: boolean }
  | { ok: false; reason: 'readonly' | 'missing' | 'image' | 'limit' | 'write' | 'none' | 'stale' };

// onHidden の受け手へ渡すもの。undo は、この撮影を今「隠すのを取り消す」で戻せるか
export interface CaptureHidden {
  id: string;
  image: string;
  blur: CaptureBlur[];
  undo: boolean;
}

// 隠す前の写し（1 枠。メモリだけ）。取り消しは、これを戻す
interface HideUndo {
  id: string;
  image: string; // 隠す前の画像（ファイルにあった JPEG）
  blur: CaptureBlur[];
  lines: { id: string; text: string; on: boolean }[]; // この隠しで「（隠した）」にした行の、元の文字とチェック
  added: string[]; // この隠しで足した矩形の id
}

function sameIdSet(a: readonly string[], b: readonly string[]) {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

// 保存した JPEG を読み、矩形を塗って 0.85 の JPEG にし直す。1 つでも塗れなければ null（塗れなかった矩形を、隠したことにしない）
async function paintImage(src: string, rects: readonly HideRect[], mode: HideMode): Promise<string | null> {
  if (!src.startsWith('data:image/')) return null;
  const img = await loadImage(src);
  if (!img || img.naturalWidth < 1 || img.naturalHeight < 1) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    for (const rect of rects) if (!paintHide(ctx, canvas.width, canvas.height, rect, mode)) return null;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return jpegUrl(dataUrl) ? dataUrl : null;
  } catch {
    return null;
  }
}

export class CaptureStore {
  private list: CaptureItem[] = [];
  private loadState: CaptureStoreState = 'loading';
  private loadFailure: CaptureLoadFailure | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  // hide・unhide・dropVideo を一つずつ流す列（右のカードと読む画面から同時に隠しても、2 つめは 1 つめの書き込みのあとにファイルを読む）
  private work: Promise<unknown> = Promise.resolve();
  private lastHide: HideUndo | null = null;
  private readonly listeners: (() => void)[] = [];
  private readonly hiddenListeners: ((ev: CaptureHidden) => void)[] = [];
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.load();
  }

  get items(): readonly CaptureItem[] {
    return this.list;
  }

  get state(): CaptureStoreState {
    return this.loadState;
  }

  get failure(): CaptureLoadFailure | null {
    return this.loadFailure;
  }

  get isLoaded() {
    return this.loadState === 'ready';
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  // 隠した・取り消したあとに届く（右のカードと読む画面が、新しい画像と矩形を知るため）
  onHidden(fn: (ev: CaptureHidden) => void) {
    this.hiddenListeners.push(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private emitHidden(ev: CaptureHidden) {
    for (const fn of this.hiddenListeners) {
      try {
        fn(ev);
      } catch {
        // 受け手の失敗で、隠した結果を失敗にしない
      }
    }
  }

  // 前の仕事のあとに job を流す。job が例外で落ちても、列は止めない（落ちた仕事の呼び手には、そのまま例外を返す）
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.work.then(job);
    this.work = run.catch(() => undefined);
    return run;
  }

  // 読めなかったら、間をおいて読み直す。それでも読めなければ readonly（一覧は空のまま。目次は書かない）
  private async load() {
    let failure: CaptureLoadFailure = 'timeout';
    for (let attempt = 0; ; attempt++) {
      const read = await this.readIndex();
      if (read.ok) {
        this.list = read.items;
        this.loadFailure = null;
        this.loadState = 'ready';
        this.emit();
        return;
      }
      failure = read.failure;
      if (attempt >= LOAD_RETRY_DELAYS_MS.length) break;
      await pause(LOAD_RETRY_DELAYS_MS[attempt]);
    }
    this.loadFailure = failure;
    this.loadState = 'readonly';
    this.emit();
  }

  // readData と違い、「返事が無い」「壊れている」「本当に無い」を分けて返す
  private async readIndex(): Promise<IndexRead> {
    const reply = await request((requestId) => ({ type: 'readData', name: INDEX, requestId }));
    if (reply?.type !== 'dataRead') return { ok: false, failure: 'timeout' };
    if (reply.text === null) {
      // C++ が「ファイルが無い」と添えたときだけ空の一覧。あるのに読めないときは書かない
      return reply.missing === true ? { ok: true, items: [] } : { ok: false, failure: 'unreadable' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(reply.text);
    } catch {
      return { ok: false, failure: 'broken' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, failure: 'broken' };
    const saved = parsed as Partial<Record<keyof CaptureIndex, unknown>>;
    if (saved.version !== 1) return { ok: false, failure: 'version' };
    if (!Array.isArray(saved.items)) return { ok: false, failure: 'broken' };
    const items = saved.items.map(cleanItem).filter((item): item is CaptureItem => item !== null);
    // 前の版でぼかしたカードは、読んだ行が元の文字のまま残っていることがある。読んだ時点で隠す（書くのは次の保存）
    return { ok: true, items: items.map((item) => (item.ocr && item.blur.length > 0 ? { ...item, ocr: hideBlurredLines(item.ocr, item.blur) } : item)) };
  }

  // 目次を書く。読めていない（loading・readonly）ときは書かずに false
  private saveIndex(): Promise<boolean> {
    if (this.loadState !== 'ready') return Promise.resolve(false);
    const snapshot = { version: 1 as const, items: this.list.map(toRow) };
    const next = this.queue.then(() => writeData(INDEX, snapshot)).catch(() => false);
    this.queue = next;
    return next;
  }

  async add(
    image: string,
    source?: CaptureSource,
    scope: CaptureScope = 'center',
    via?: CaptureVia,
    from?: CaptureFrom,
  ): Promise<{ ok: true; item: CaptureItem } | { ok: false; reason: 'full' | 'write' | 'readonly' }> {
    await this.ready;
    if (this.loadState !== 'ready') return { ok: false, reason: 'readonly' };
    if (this.list.length >= CAPTURE_LIMIT) return { ok: false, reason: 'full' };
    const id = newCaptureId();
    if (!(await writeData(captureImageName(id), { version: 1, data: image }))) return { ok: false, reason: 'write' };
    const page = scope === 'center' ? source : undefined;
    const kept = from ? cleanFrom(from) : undefined;
    const item: CaptureItem = {
      id,
      createdAt: Date.now(),
      scope,
      comment: '',
      liked: 0,
      marks: [],
      strokes: [],
      blur: [],
      ...(page ? { source: page } : {}),
      ...(via ? { via } : {}),
      ...(kept ? { from: kept } : {}),
    };
    this.list = [item, ...this.list];
    this.emit();
    return this.keepAdded(item);
  }

  // 録画の代表画像。id は C++ が書いた mp4 と同じ。mp4 は、ここでは消さない（呼び側が、失敗の種類を見て決める）
  async addRecorded(
    id: string,
    image: string,
    source: CaptureSource | undefined,
    video: CaptureVideo,
  ): Promise<{ ok: true; item: CaptureItem } | { ok: false; reason: 'full' | 'write' | 'readonly' }> {
    await this.ready;
    if (this.loadState !== 'ready') return { ok: false, reason: 'readonly' };
    if (!ID_RE.test(id) || this.list.some((item) => item.id === id)) return { ok: false, reason: 'write' };
    if (this.list.length >= CAPTURE_LIMIT) return { ok: false, reason: 'full' };
    const clip = cleanVideo(video);
    if (!clip || !jpegUrl(image)) return { ok: false, reason: 'write' };
    if (!(await writeData(captureImageName(id), { version: 1, data: image }))) return { ok: false, reason: 'write' };
    const item: CaptureItem = {
      id,
      createdAt: Date.now(),
      scope: 'center',
      comment: '',
      liked: 0,
      marks: [],
      strokes: [],
      blur: [],
      video: clip,
      ...(source ? { source } : {}),
    };
    this.list = [item, ...this.list];
    this.emit();
    return this.keepAdded(item);
  }

  // 足した項目を目次に書く。書けなかったら、一覧から外して画像のファイルも消す（目次に無い画像を残さない）
  private async keepAdded(item: CaptureItem): Promise<{ ok: true; item: CaptureItem } | { ok: false; reason: 'write' }> {
    if (await this.saveIndex()) return { ok: true, item };
    this.list = this.list.filter((row) => row.id !== item.id);
    deleteData(captureImageName(item.id));
    this.emit();
    // 返事が時間切れでも、実は書けていたことがある。項目の無い目次でもう一度書いておく
    void this.saveIndex();
    return { ok: false, reason: 'write' };
  }

  async setComment(id: string, text: string) {
    await this.ready;
    if (this.loadState !== 'ready') return;
    const comment = clipComment(text);
    const index = this.list.findIndex((item) => item.id === id);
    if (index < 0 || this.list[index].comment === comment) return;
    this.list = this.list.map((item, n) => (n === index ? { ...item, comment } : item));
    this.emit();
    await this.saveIndex();
  }

  async setLiked(id: string, liked: number) {
    await this.ready;
    if (this.loadState !== 'ready') return;
    const level = liked === 0 ? 0 : (likeLevel(liked) ?? 0);
    const index = this.list.findIndex((item) => item.id === id);
    if (index < 0 || this.list[index].liked === level) return;
    this.list = this.list.map((item, n) => (n === index ? { ...item, liked: level } : item));
    this.emit();
    await this.saveIndex();
  }

  async setMarks(id: string, marks: CaptureMark[]) {
    await this.ready;
    if (this.loadState !== 'ready') return;
    const index = this.list.findIndex((item) => item.id === id);
    if (index < 0) return;
    const clean = cleanMarks(marks);
    if (JSON.stringify(this.list[index].marks) === JSON.stringify(clean)) return;
    this.list = this.list.map((item, n) => (n === index ? { ...item, marks: clean } : item));
    this.emit();
    await this.saveIndex();
  }

  async setStrokes(id: string, strokes: CaptureStroke[]) {
    await this.ready;
    if (this.loadState !== 'ready') return;
    const index = this.list.findIndex((item) => item.id === id);
    if (index < 0) return;
    const clean = cleanStrokes(strokes);
    if (JSON.stringify(this.list[index].strokes) === JSON.stringify(clean)) return;
    this.list = this.list.map((item, n) => (n === index ? { ...item, strokes: clean } : item));
    this.emit();
    await this.saveIndex();
  }

  // 隠す。右のカードからも読む画面からも、ここを通る（R3）。
  //   画像は、右の画面のキャッシュではなくファイルから読む（前の隠しがいつも焼かれた画像から塗るため）。
  //   読んだ行のうち、矩形と重なるものと lineIds の行は、文字を「（隠した）」にして外す。
  //   隠す前の画像・矩形・読んだ行は 1 段だけ持ち、unhide で戻せる（メモリだけ。次の hide・remove などで捨てる）
  hide(id: string, req: HideRequest): Promise<HideResult> {
    return this.serial(() => this.hideNow(id, req));
  }

  private async hideNow(id: string, req: HideRequest): Promise<HideResult> {
    await this.ready;
    if (this.loadState !== 'ready') return { ok: false, reason: 'readonly' };
    const first = this.list.find((item) => item.id === id);
    if (!first) return { ok: false, reason: 'missing' };
    const rects = fitRects(req.rects);
    const lineSet = new Set(req.lineIds ?? []);
    if (rects.length === 0 && lineSet.size === 0) return { ok: false, reason: 'none' };
    if (first.blur.length + rects.length > BLUR_LIMIT) return { ok: false, reason: 'limit' };
    // ファイルが本当の画像。右の画面が持っている画像は使わない
    const before = await this.loadImage(id);
    if (!before) return { ok: false, reason: 'image' };
    const mode: HideMode = req.mode === 'mosaic' ? 'mosaic' : 'fill';
    let image = before;
    if (rects.length > 0) {
      const painted = await paintImage(before, rects, mode);
      if (!painted) return { ok: false, reason: 'image' };
      if (!(await writeData(captureImageName(id), { version: 1, data: painted }))) return { ok: false, reason: 'write' };
      image = painted;
    }
    // 書いている間にカードが消されたら、書いた画像は消す
    const index = this.list.findIndex((item) => item.id === id);
    if (index < 0) {
      if (rects.length > 0) deleteData(captureImageName(id));
      return { ok: false, reason: 'missing' };
    }
    const current = this.list[index];
    if (rects.length === 0 && !(current.ocr ?? []).some((line) => lineSet.has(line.id) && line.text !== HIDDEN_TEXT)) {
      return { ok: false, reason: 'none' }; // 画像は塗らず、隠す行も無い
    }
    const used = new Set(current.blur.map((row) => row.id));
    const added: CaptureBlur[] = rects.map((rect) => {
      let blurId = newBlurId();
      while (used.has(blurId)) blurId = newBlurId();
      used.add(blurId);
      return { id: blurId, ...rect, mode };
    });
    const blur = [...current.blur, ...added];
    let ocr = current.ocr ? hideBlurredLines(current.ocr, blur) : undefined;
    if (ocr && lineSet.size > 0) {
      ocr = ocr.map((line) => (lineSet.has(line.id) && line.text !== HIDDEN_TEXT ? { ...line, text: HIDDEN_TEXT, on: false } : line));
    }
    // 取り消しで戻すのは、この隠しで「（隠した）」にした行だけ（あとで別の行のチェックを切り替えても、それは戻さない）
    const nextById = new Map((ocr ?? []).map((line) => [line.id, line]));
    const changed = (current.ocr ?? [])
      .filter((line) => line.text !== HIDDEN_TEXT && nextById.get(line.id)?.text === HIDDEN_TEXT)
      .map((line) => ({ id: line.id, text: line.text, on: line.on }));
    this.lastHide = {
      id,
      image: before,
      blur: [...current.blur],
      lines: changed,
      added: added.map((row) => row.id),
    };
    this.list = this.list.map((item, n) => (n === index ? { ...item, blur, ...(ocr ? { ocr } : {}) } : item));
    // 画像の知らせは一覧の保存を待たずに出す（カードが「古い画像＋新しい枠」で一瞬描かれないように）
    this.emit();
    this.emitHidden({ id, image, blur: [...blur], undo: true });
    const saved = await this.saveIndex();
    return { ok: true, image, blur: [...blur], undo: true, saved };
  }

  // 「隠すのを取り消す」。いちばん新しい hide を戻す（1 段）。あとから別の場所を隠していたら stale で戻さない
  unhide(id: string): Promise<HideResult> {
    return this.serial(() => this.unhideNow(id));
  }

  private async unhideNow(id: string): Promise<HideResult> {
    await this.ready;
    if (this.loadState !== 'ready') return { ok: false, reason: 'readonly' };
    const undo = this.lastHide;
    if (!undo || undo.id !== id) return { ok: false, reason: 'none' };
    const first = this.list.find((item) => item.id === id);
    if (!first) return { ok: false, reason: 'missing' };
    if (!sameIdSet(first.blur.map((row) => row.id), [...undo.blur.map((row) => row.id), ...undo.added])) return { ok: false, reason: 'stale' };
    // 矩形を足さなかった hide（文字だけ隠した）は、画像が変わっていない。書き直さない
    if (undo.added.length > 0 && !(await writeData(captureImageName(id), { version: 1, data: undo.image }))) return { ok: false, reason: 'write' };
    const index = this.list.findIndex((item) => item.id === id);
    if (index < 0) {
      if (undo.added.length > 0) deleteData(captureImageName(id));
      return { ok: false, reason: 'missing' };
    }
    const current = this.list[index];
    const blur = undo.blur.map((row) => ({ ...row }));
    // この隠しで「（隠した）」にした行だけを、元の文字とチェックに戻す（行は id で引く。読み直しで行が替わっていれば、写しはもう捨ててある）
    const original = new Map(undo.lines.map((line) => [line.id, line]));
    const ocr = current.ocr?.map((line) => {
      const back = original.get(line.id);
      return back && line.text === HIDDEN_TEXT ? { ...line, text: back.text, on: back.on } : line;
    });
    this.lastHide = null;
    this.list = this.list.map((item, n) => (n === index ? { ...item, blur, ...(ocr ? { ocr } : {}) } : item));
    this.emit();
    this.emitHidden({ id, image: undo.image, blur: [...blur], undo: false });
    const saved = await this.saveIndex();
    return { ok: true, image: undo.image, blur: [...blur], undo: false, saved };
  }

  // この撮影を今「隠すのを取り消す」で戻せるか
  canUndo(id: string): boolean {
    return this.lastHide?.id === id;
  }

  // 取り消しの写しを捨てる。id を省くと全部
  //   いま捨てたうえで、列（serial）の後ろでももう一度捨てる（閉じる途中に流れていた隠すが、あとで写しを立て直さないように）
  forgetUndo(id?: string) {
    const drop = () => {
      if (id === undefined || this.lastHide?.id === id) this.lastHide = null;
    };
    drop();
    void this.serial(async () => drop());
  }

  // 録画の記録（video）を外して保存する。mp4 のファイルは、呼ぶ側が先に消す。成功で true。
  //   読んだ行は残す。代表の画像（最後の時刻）の行だけ at を外し、ほかの時刻の行は at を残す
  //   （録画が無くなっても「代表の画像に無い行」と分かるように。その行を隠すときは文字だけにする）
  dropVideo(id: string): Promise<boolean> {
    return this.serial(async () => {
      await this.ready;
      if (this.loadState !== 'ready') return false;
      const index = this.list.findIndex((item) => item.id === id);
      if (index < 0) return false;
      if (!this.list[index].video) return true; // もう無い
      this.list = this.list.map((item, n) => {
        if (n !== index) return item;
        const copy: CaptureItem = { ...item };
        const last = item.video?.times[item.video.times.length - 1];
        delete copy.video;
        if (copy.ocr) {
          copy.ocr = copy.ocr.map((line) => {
            if (line.at !== last) return line;
            const { at: _at, ...rest } = line;
            return rest;
          });
        }
        return copy;
      });
      this.emit();
      return this.saveIndex();
    });
  }

  // 「AIに頼む」で送った時刻。カードのほかの項目は変えない
  async setAsked(id: string) {
    await this.ready;
    if (this.loadState !== 'ready') return;
    const index = this.list.findIndex((item) => item.id === id);
    if (index < 0) return;
    const askedAt = Date.now();
    this.list = this.list.map((item, n) => (n === index ? { ...item, askedAt } : item));
    this.emit();
    await this.saveIndex();
  }

  // pageText を省くと本文は変えない。null は消す（窓・デスクトップ）。文字列は 2,000 字まで残す。
  // 渡した行で ocr を置き換える。成功した「文字を読む」は、前の行を残さない。
  // ぼかしと重なる行は、ここで文字を隠す（読み直しとチェックの切り替えの両方がここを通る）
  async setOcr(id: string, lines: CaptureOcrLine[], pageText?: string | null) {
    await this.ready;
    if (this.loadState !== 'ready') return;
    const index = this.list.findIndex((item) => item.id === id);
    if (index < 0) return;
    const current = this.list[index];
    const clean = hideBlurredLines(cleanOcr(lines), current.blur);
    let nextText = current.pageText;
    if (pageText === null) nextText = undefined;
    else if (typeof pageText === 'string') nextText = cleanPageText(pageText);
    if (JSON.stringify(current.ocr ?? []) === JSON.stringify(clean) && current.pageText === nextText) return;
    // 読み直しで行の id が変わったら、隠す前の行の写しは合わない（チェックの切り替えは同じ id なので残す）
    if (this.lastHide?.id === id && !sameIdSet((current.ocr ?? []).map((line) => line.id), clean.map((line) => line.id))) this.lastHide = null;
    this.list = this.list.map((item, n) => {
      if (n !== index) return item;
      const copy: CaptureItem = { ...item, ocr: clean };
      if (nextText) copy.pageText = nextText;
      else delete copy.pageText;
      return copy;
    });
    this.emit();
    await this.saveIndex();
  }

  async remove(id: string) {
    await this.ready;
    if (this.loadState !== 'ready') return;
    if (!this.list.some((item) => item.id === id)) return;
    this.list = this.list.filter((item) => item.id !== id);
    if (this.lastHide?.id === id) this.lastHide = null;
    this.emit();
    deleteData(captureImageName(id));
    await this.saveIndex();
  }

  async loadImage(id: string): Promise<string | null> {
    if (!ID_RE.test(id)) return null;
    const saved = await readData<{ data?: unknown }>(captureImageName(id));
    return typeof saved?.data === 'string' && saved.data.startsWith('data:image/jpeg') ? saved.data : null;
  }
}
