// めぐる表示のひとこと（docs/plan-rotating-display.md の R3・R4、第7節）
//   設定・練習の文・覚えておくファイル。本物の呼び出しは ai/comment.ts
//   回数は第4節の1〜7。ここは DOM を知らない
import { t as tr } from './i18n';
import { readData, writeData } from './data';
import type { RotateKind } from './rotate';

export type CommentTeam = 'haiku' | 'sonnet';
export type CommentPlace = 'before' | 'after' | 'both';
export type CommentSpot = 'before' | 'after';

export const COMMENT_DWELL_MS = 10_000;
export const COMMENT_EVERY_DEFAULT_MS = 10 * 60_000;
export const COMMENT_CAP_DEFAULT = 10;
export const COMMENT_KEEP = 200;
const FILE = 'rotate/comments.json';

// 計画の料金表（1日10回で1か月）。上限を変えたときは、この表を日数の比で伸縮する
const PRICE = {
  haiku: { name: tr('ハイク組'), per: 0.0002, monthAt10: 0.05 },
  sonnet: { name: tr('ソネット三人組'), per: 0.003, monthAt10: 1 },
} as const;

export interface CommentPrefs {
  on: boolean;
  kinds: RotateKind[];
  team: CommentTeam;
  place: CommentPlace;
  everyMs: number;
  dailyCap: number;
}

export interface CommentConsent {
  kinds: RotateKind[];
  team: CommentTeam;
  place: CommentPlace;
}

export const COMMENT_DEFAULT: CommentPrefs = {
  on: false,
  kinds: ['vocab', 'reminder'],
  team: 'haiku',
  place: 'after',
  everyMs: COMMENT_EVERY_DEFAULT_MS,
  dailyCap: COMMENT_CAP_DEFAULT,
};

export interface CommentLine {
  name: string;
  text: string;
}

export interface CommentRecord {
  key: string;
  day: string;
  at: number;
  team: CommentTeam;
  practice: boolean;
  lines: CommentLine[];
  note?: string; // 失敗したときのわけ（ひとことは出さない。回数には数える）
}

export interface Dwell {
  key: string | null;
  ms: number;
  ticked: number;
}

const isKind = (k: unknown): k is RotateKind => k === 'vocab' || k === 'reminder';
const isTeam = (t: unknown): t is CommentTeam => t === 'haiku' || t === 'sonnet';
const isPlace = (p: unknown): p is CommentPlace => p === 'before' || p === 'after' || p === 'both';

export function clampMinutes(n: number): number {
  if (!Number.isFinite(n)) return 10;
  return Math.min(60, Math.max(5, Math.round(n)));
}

export function clampCap(n: number): number {
  if (!Number.isFinite(n)) return COMMENT_CAP_DEFAULT;
  return Math.min(50, Math.max(1, Math.round(n)));
}

export function cleanCommentPrefs(raw: unknown): CommentPrefs {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const kinds = Array.isArray(r.kinds) ? [...new Set(r.kinds.filter(isKind))] : [...COMMENT_DEFAULT.kinds];
  const everyMin = typeof r.everyMs === 'number' ? r.everyMs / 60_000 : 10;
  const dailyCap = typeof r.dailyCap === 'number' ? r.dailyCap : COMMENT_CAP_DEFAULT;
  return {
    on: r.on === true,
    kinds,
    team: isTeam(r.team) ? r.team : 'haiku',
    place: isPlace(r.place) ? r.place : 'after',
    everyMs: clampMinutes(everyMin) * 60_000,
    dailyCap: clampCap(dailyCap),
  };
}

export function cleanConsent(raw: unknown): CommentConsent | null {
  const r = (typeof raw === 'object' && raw !== null ? raw : null) as Record<string, unknown> | null;
  if (!r || !isTeam(r.team) || !Array.isArray(r.kinds)) return null;
  const kinds = [...new Set(r.kinds.filter(isKind))];
  if (kinds.length === 0) return null;
  // 場所の無い古い承諾は「答えの後」（R3 まで場所は無かった）
  return { kinds, team: r.team, place: isPlace(r.place) ? r.place : 'after' };
}

// 入れると承諾した範囲。種類を足したとき、高い組（ソネット）へ変えたとき、渡すものが増える場所へ変えたときは、もう一度入れるまで動かない
export function consentCovers(consent: CommentConsent | null, prefs: CommentPrefs): boolean {
  if (!consent || prefs.kinds.length === 0) return false;
  if (!prefs.kinds.every((kind) => consent.kinds.includes(kind))) return false;
  const teamOk = consent.team === prefs.team || (consent.team === 'sonnet' && prefs.team === 'haiku');
  if (!teamOk) return false;
  if (!prefs.kinds.includes('vocab')) return true;
  if (consent.place === prefs.place) return true;
  // 「両方」を入れたあとは、片方だけに減らしても、もう一度入れなくてよい
  if (consent.place === 'both') return true;
  // 答えの後から答えの前へは、裏を渡さなくなるので、もう一度入れなくてよい
  return consent.place === 'after' && prefs.place === 'before';
}

export function dayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function commentsToday(records: readonly CommentRecord[], now = new Date()): number {
  const day = dayKey(now);
  return records.filter((record) => record.day === day).length;
}

export function commentFor(records: readonly CommentRecord[], key: string, now = new Date()): CommentRecord | null {
  const day = dayKey(now);
  return records.find((record) => record.key === key && record.day === day) ?? null;
}

// 単語帳は場所ごと。リマインダーに場所は無い。R3 の「vocab:id」は、答えのあととして読む
export function commentKey(slot: { kind: RotateKind; id: string }, place: CommentSpot): string {
  if (slot.kind === 'reminder') return `reminder:${slot.id}`;
  return place === 'before' ? `vocab:${slot.id}:before` : `vocab:${slot.id}:after`;
}

export function commentForPlace(
  records: readonly CommentRecord[],
  slot: { kind: RotateKind; id: string },
  place: CommentSpot,
  now = new Date(),
): CommentRecord | null {
  const saved = commentFor(records, commentKey(slot, place), now);
  if (saved) return saved;
  if (slot.kind === 'vocab' && place === 'after') return commentFor(records, `vocab:${slot.id}`, now);
  return null;
}

export function spotsFor(place: CommentPlace, kind: RotateKind): CommentSpot[] {
  if (kind === 'reminder') return ['after'];
  if (place === 'both') return ['before', 'after'];
  return place === 'before' ? ['before'] : ['after'];
}

// 今日まだ付けていない場所。両方のときは答えの前を先にする（同じ瞬間には1回だけ）
export function nextCommentSpot(
  prefs: Pick<CommentPrefs, 'place'>,
  slot: { kind: RotateKind; id: string },
  records: readonly CommentRecord[],
  now = Date.now(),
): CommentSpot | null {
  for (const place of spotsFor(prefs.place, slot.kind)) {
    if (!commentForPlace(records, slot, place, new Date(now))) return place;
  }
  return null;
}

// 今日のいちばん新しい記録が失敗（文が無く、わけがある）なら、そのわけ
export function failureNote(records: readonly CommentRecord[], now = new Date()): string {
  const day = dayKey(now);
  let latest: CommentRecord | null = null;
  for (const record of records) {
    if (record.day !== day) continue;
    if (!latest || record.at >= latest.at) latest = record;
  }
  if (latest && latest.lines.length === 0 && latest.note) return latest.note;
  return '';
}

export function lastCommentAt(records: readonly CommentRecord[]): number | null {
  let max = 0;
  for (const record of records) if (record.at > max) max = record.at;
  return max || null;
}

export function waitMs(lastAt: number | null, everyMs: number, now: number): number {
  if (lastAt == null) return 0;
  return Math.max(0, everyMs - (now - lastAt));
}

export function waitLabel(ms: number): string {
  if (ms <= 0) return tr('次のひとことは、いま出せます');
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return tr('次のひとことまで あと {0} 分', { 0: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? tr('次のひとことまで あと {0} 時間', { 0: hours }) : tr('次のひとことまで あと {0} 時間 {1} 分', { 0: hours, 1: rest });
}

// 画面に映しているあいだだけ溜める。隠れている・たたんでいる・⏸・設定を開いている間は溜めない（溜めた分は残す）
export function commentVisible(gate: {
  sidebarOpen: boolean;
  pageVisible: boolean;
  collapsed: boolean;
  paused: boolean;
  settingsOpen: boolean;
  rotateShown: boolean;
}): boolean {
  return gate.sidebarOpen && gate.pageVisible && !gate.collapsed && !gate.paused && !gate.settingsOpen && gate.rotateShown;
}

export function advanceDwell(state: Dwell, now: number, visible: boolean, key: string | null): Dwell {
  if (!visible || !key) return { ...state, ticked: now };
  const same = state.key === key;
  let ms = same ? state.ms : 0;
  if (same && state.ticked > 0) ms += Math.min(2_000, Math.max(0, now - state.ticked));
  return { key, ms, ticked: now };
}

export function money(amount: number): string {
  if (amount >= 1) return `$${Math.round(amount)}`;
  if (amount >= 0.01) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(4)}`;
}

export function teamChoiceLabel(team: CommentTeam): string {
  const price = PRICE[team];
  return tr('{0}（1回 約 {1}）', { 0: price.name, 1: money(price.per) });
}

export function commentKeepText(lines: readonly CommentLine[]): string {
  const body = lines.map((line) => `${line.name}：${line.text}`).join('　');
  return body ? tr('月の窓のひとこと　{0}', { 0: body }) : tr('月の窓のひとこと');
}

export function priceText(team: CommentTeam, dailyCap: number, place: CommentPlace = 'after', vocab = true): string {
  const price = PRICE[team];
  const doubled = vocab && place === 'both';
  const month = price.monthAt10 * (dailyCap / 10);
  const per = doubled ? tr('単語帳の1枚は2回ぶん（答えの前とあと）で、約 {0}。', { 0: money(price.per * 2) }) : tr('1回 約 {0}。', { 0: money(price.per) });
  const extra = doubled ? tr('1日の回数と、ひとことの間も、1枚で2回ぶん数えます。') : '';
  return tr('{0}は、{1}1日 {2} 回までで、1か月 約 {3}。{4}', { 0: price.name, 1: per, 2: dailyCap, 3: money(month), 4: extra });
}

// 答えの前。答え・訳・言い換え・綴りは入れない（カードの中身も入れない）
const VOCAB_BEFORE_LINES = [
  tr('答えはまだ言いません。どんなときに使うか、みんなで考えてみましょう。'),
  tr('最初の音だけを手がかりに、声に出してみましょう。'),
  tr('まだ開けなくて大丈夫です。表から、場面を想像してみましょう。'),
];

const VOCAB_LINES = [
  tr('表を見て、一度声に出してみましょう。'),
  tr('裏と照らして、自分の言葉で言えるか見てみましょう。'),
  tr('今日はここまで。またあとで思い出せるか、見てみましょう。'),
];

const REMINDER_LINES = [
  tr('この知らせを、時間までに思い出せるようにしておきましょう。'),
  tr('残りの時間だけを見て、いま急ぐかどうかを決めましょう。'),
  tr('終わったら、このリマインダーは用済みです。'),
];

// 練習用。名前は組の3体まで。中身は決まった文（ページのアドレスや題名は入れない）
export function practiceLines(names: readonly string[], kind: RotateKind, place: CommentSpot = 'after'): CommentLine[] {
  const who = (names.length > 0 ? names : [tr('ツクシ'), tr('ホタル'), tr('モミジ')]).slice(0, 3);
  const texts = kind === 'reminder' ? REMINDER_LINES : place === 'before' ? VOCAB_BEFORE_LINES : VOCAB_LINES;
  return who.map((name, index) => ({ name, text: tr('（練習）{0}', { 0: texts[index] ?? texts[0] }) }));
}

function isRecord(value: unknown): value is CommentRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  if (!(typeof r.key === 'string' && typeof r.day === 'string' && typeof r.at === 'number' && isTeam(r.team) && Array.isArray(r.lines))) return false;
  return r.note == null || typeof r.note === 'string';
}

export async function loadComments(): Promise<CommentRecord[]> {
  const raw = await readData<{ v?: unknown; items?: unknown }>(FILE);
  if (!raw || raw.v !== 1 || !Array.isArray(raw.items)) return [];
  return raw.items.filter(isRecord).slice(-COMMENT_KEEP);
}

export async function rememberComment(record: CommentRecord): Promise<CommentRecord[]> {
  const current = await loadComments();
  const without = current.filter((item) => !(item.key === record.key && item.day === record.day));
  const items = [...without, record].slice(-COMMENT_KEEP);
  await writeData(FILE, { v: 1, items });
  return items;
}
