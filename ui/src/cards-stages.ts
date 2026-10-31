// Grok Cards の段の旗（localStorage honeycomb.cardsStages。例 ["1","2","4"]）
//   【段 "3" は常にオン（2026-10-25・利用者の指示「旗を本体に反映」）】段 "3"（Grok Cards の枠・タブ・パネル・中継・保存。ボードもこの枠の中に入る）は、旗を読まず**常にオン**。鍵に "3" が入っていなくても・鍵が [] でも、オン。
//     **ほかの段（1・2・4〜9）は今までどおり旗のまま**：鍵が無い・壊れている・その段が入っていなければオフ（段 "3" がオンでも、ほかの段はオンにならない）。値は書き換えない
//     元に戻す（旗の版へ）：この変更のコミットを `git revert`（docs/plan-board-memo-switch.md §7）
//   空なら、殻も帯も札も出さない。新しい鍵も書かない
//   数の写し（下書きのタグ・順番待ちの id・返事の数）は、段 2 以降がオンのときだけ書く
//   届いた k/n の写しは、段 8 がオンのときだけ書く。段 8 が無いときは、残っていても読まない
//   出す場所（下の面 / 上の半分）は、段 9 がオンのときだけ書く。段 9 が無いときは、残っていても下の面として読む
//   上半分の境目の比率は、段 9 がオンのときだけ書く。下の帯の高さ（honeycomb.memoPane）とは別の鍵
import { withArrivedLine } from './grok-cards-arrived';
import { normalizeCardsPlace, readUpperRatioRaw, UPPER_SPLIT_DEFAULT, type CardsPlace } from './grok-cards-place';
import { draftCount, countLine } from './grok-cards-count';
import type { ShellDev, ShellSize } from './nest-shell';

export const CARDS_STAGES_KEY = 'honeycomb.cardsStages';
export const CARDS_DEV_KEY = 'honeycomb.cardsDevState';
export const CARDS_OPEN_KEY = 'honeycomb.cardsOpen';
export const CARDS_QUEUE_KEY = 'honeycomb.cardsQueue';
export const CARDS_TAGS_KEY = 'honeycomb.cardsTags';
export const CARDS_REPLIES_KEY = 'honeycomb.cardsReplies';
export const CARDS_ARRIVED_KEY = 'honeycomb.cardsArrived';
export const CARDS_COLUMNS_KEY = 'honeycomb.cardsColumns';
export const CARDS_PLACE_KEY = 'honeycomb.cardsPlace';
export const CARDS_UPPER_RATIO_KEY = 'honeycomb.cardsUpperRatio';
export const CARDS_SHEET_KEY = 'honeycomb.cardsSheetId';

const EVENT = 'honeycomb-cards';

export interface CardsDevState extends ShellDev {
  size?: ShellSize;
  overdue?: boolean;
}

export interface QueueSnap {
  id: string;
  botId: string;
  group?: number;
}

export interface CardTagSnap {
  id: string;
  tags: string[];
}

function readRaw(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

// 保存されている文字列（無ければ null）から、旗として入っている段を読む（壊れた値・配列以外・鍵が無いときは空）。段 "3" はここには関係なく、cardsStageOn が常にオンにする
export function cardsStagesFromStorage(raw: string | null): readonly unknown[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function cardsStageOn(stage: string): boolean {
  if (stage === '3') return true; // 常にオン（旗は読まない）。ほかの段は下で旗を読む
  try {
    return cardsStagesFromStorage(localStorage.getItem(CARDS_STAGES_KEY)).some((item) => item === stage);
  } catch {
    return false;
  }
}

function countingOn(): boolean {
  return cardsStageOn('2') || cardsStageOn('3') || cardsStageOn('4');
}

function poke() {
  window.dispatchEvent(new Event(EVENT));
}

export function onCardsStore(fn: () => void): () => void {
  const storage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith('honeycomb.cards')) fn();
  };
  window.addEventListener('storage', storage);
  window.addEventListener(EVENT, fn);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener(EVENT, fn);
  };
}

export function readCardsDevState(): CardsDevState {
  const raw = readRaw(CARDS_DEV_KEY);
  if (!raw || typeof raw !== 'object') return {};
  const v = raw as Record<string, unknown>;
  const dev: CardsDevState = {};
  if (typeof v.open === 'boolean') dev.open = v.open;
  if (typeof v.merged === 'boolean') dev.merged = v.merged;
  if (typeof v.error === 'boolean') dev.error = v.error;
  if (typeof v.replies === 'number') dev.replies = v.replies;
  if (typeof v.drafts === 'number') dev.drafts = v.drafts;
  if (typeof v.arrived === 'number') dev.arrived = v.arrived;
  if (typeof v.occupied === 'number') dev.occupied = v.occupied;
  if (v.size === 26 || v.size === 40 || v.size === 60) dev.size = v.size;
  if (typeof v.overdue === 'boolean') dev.overdue = v.overdue;
  return dev;
}

export function readCardsOpen(): boolean {
  if (!cardsStageOn('3')) return false;
  try {
    return localStorage.getItem(CARDS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCardsOpen(open: boolean) {
  if (!cardsStageOn('3')) return;
  try {
    const next = open ? '1' : '0';
    if (localStorage.getItem(CARDS_OPEN_KEY) === next) return;
    localStorage.setItem(CARDS_OPEN_KEY, next);
  } catch {
    return;
  }
  poke();
}

export function readQueue(): QueueSnap[] {
  const raw = readRaw(CARDS_QUEUE_KEY);
  if (!Array.isArray(raw)) return [];
  const out: QueueSnap[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    if (typeof v.id !== 'string' || typeof v.botId !== 'string') continue;
    out.push({ id: v.id, botId: v.botId, ...(typeof v.group === 'number' ? { group: v.group } : {}) });
  }
  return out;
}

export function readCardTags(): CardTagSnap[] {
  const raw = readRaw(CARDS_TAGS_KEY);
  if (!Array.isArray(raw)) return [];
  const out: CardTagSnap[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    if (typeof v.id !== 'string' || !Array.isArray(v.tags)) continue;
    out.push({ id: v.id, tags: v.tags.filter((tag): tag is string => typeof tag === 'string') });
  }
  return out;
}

export interface ArrivedSnap {
  k: number;
  n: number;
  group: number | null;
}

const QUIET_ARRIVED: ArrivedSnap = { k: 0, n: 0, group: null };

// 段 8 が無いときは 0（鍵が残っていても読まない。段 1〜7 の殻は今までどおり）
export function readArrived(): ArrivedSnap {
  if (!cardsStageOn('8')) return QUIET_ARRIVED;
  const raw = readRaw(CARDS_ARRIVED_KEY);
  if (!raw || typeof raw !== 'object') return QUIET_ARRIVED;
  const v = raw as Record<string, unknown>;
  const n = typeof v.n === 'number' && v.n > 0 ? Math.floor(v.n) : 0;
  if (n === 0) return QUIET_ARRIVED;
  const k = typeof v.k === 'number' && v.k > 0 ? Math.floor(v.k) : 0;
  const group = typeof v.group === 'number' && v.group > 0 ? Math.floor(v.group) : null;
  return { k, n, group };
}

export function publishArrived(snap: ArrivedSnap) {
  if (!cardsStageOn('8')) return;
  const n = Math.max(0, Math.floor(snap.n));
  const k = n > 0 ? Math.max(0, Math.floor(snap.k)) : 0;
  const group = snap.group !== null && snap.group > 0 ? Math.floor(snap.group) : null;
  writeJson(CARDS_ARRIVED_KEY, { k, n, group });
}

export function readReplies(): number {
  try {
    const n = Number(localStorage.getItem(CARDS_REPLIES_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function writeColumnPrefs(order: readonly string[], hidden: readonly string[]) {
  if (!cardsStageOn('7')) return;
  writeJson(CARDS_COLUMNS_KEY, { v: 1, order: [...order], hidden: [...hidden] });
}

export function readCardsPlace(): CardsPlace {
  if (!cardsStageOn('9')) return 'bottom';
  return normalizeCardsPlace(true, readRaw(CARDS_PLACE_KEY));
}

export function writeCardsPlace(place: CardsPlace) {
  if (!cardsStageOn('9')) return;
  writeJson(CARDS_PLACE_KEY, place === 'upper' ? 'upper' : 'bottom');
}

export function readUpperRatio(): number {
  if (!cardsStageOn('9')) return UPPER_SPLIT_DEFAULT;
  return readUpperRatioRaw(true, readRaw(CARDS_UPPER_RATIO_KEY));
}

// 札の再描画はしない（ドラッグの途中で下書きの欄を作り直さない）。同じ文書では storage が飛ばない
export function writeUpperRatio(ratio: number) {
  if (!cardsStageOn('9')) return;
  const next = readUpperRatioRaw(true, ratio);
  try {
    const text = JSON.stringify(next);
    if (localStorage.getItem(CARDS_UPPER_RATIO_KEY) === text) return;
    localStorage.setItem(CARDS_UPPER_RATIO_KEY, text);
  } catch {
    return;
  }
}

export function readColumnPrefs(): { order: string[]; hidden: string[] } {
  const raw = readRaw(CARDS_COLUMNS_KEY);
  if (!raw || typeof raw !== 'object') return { order: [], hidden: [] };
  const v = raw as Record<string, unknown>;
  const order = Array.isArray(v.order) ? v.order.filter((item): item is string => typeof item === 'string') : [];
  const hidden = Array.isArray(v.hidden) ? v.hidden.filter((item): item is string => typeof item === 'string') : [];
  return { order, hidden };
}

function writeJson(key: string, value: unknown) {
  try {
    const text = JSON.stringify(value);
    if (localStorage.getItem(key) === text) return;
    localStorage.setItem(key, text);
  } catch {
    return;
  }
  poke();
}

export function publishQueue(items: readonly { id: string; botId: string; group?: number }[]) {
  if (!countingOn()) return;
  writeJson(
    CARDS_QUEUE_KEY,
    items.map((item) => ({ id: item.id, botId: item.botId, ...(item.group !== undefined ? { group: item.group } : {}) })),
  );
}

export function publishCardTags(items: readonly CardTagSnap[]) {
  if (!countingOn()) return;
  writeJson(
    CARDS_TAGS_KEY,
    items.map((item) => ({ id: item.id, tags: item.tags })),
  );
}

export function publishReplies(n: number) {
  if (!countingOn()) return;
  const next = String(Math.max(0, Math.floor(n)) || 0);
  try {
    if (localStorage.getItem(CARDS_REPLIES_KEY) === next) return;
    localStorage.setItem(CARDS_REPLIES_KEY, next);
  } catch {
    return;
  }
  poke();
}

// 帯・殻・札が同じ関数で数える。開発用のピンがあれば、三方ともそれに合わせる
export function shownCounts(): { drafts: number; replies: number } {
  const dev = readCardsDevState();
  const drafts = typeof dev.drafts === 'number' ? dev.drafts : draftCount(readCardTags(), readQueue());
  const replies = typeof dev.replies === 'number' ? dev.replies : readReplies();
  return { drafts: Math.max(0, Math.floor(drafts)), replies: Math.max(0, Math.floor(replies)) };
}

export function shownCountLine(): string {
  const counts = shownCounts();
  const line = countLine(counts.drafts, counts.replies);
  if (!cardsStageOn('8')) return line;
  const arrived = readArrived();
  return withArrivedLine(line, arrived.k, arrived.n);
}
