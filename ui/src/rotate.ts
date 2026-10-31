// めぐる表示（docs/plan-rotating-display.md）
//   R1: 月の窓の「⟳ めぐる」で、単語帳のカードを、使う人が決めた間で1枚ずつ映す
//   R2: リマインダーも映す。まだ時間になっていないものを近い順に。両方に印があるときは交互
//   ・はじめは切ってある。AI は使わない（ひとことは R3 から）
//   ・単語帳の並びは「復習の時期が来たもの → 苦手なもの → ほか」。ほかは混ぜる。混ぜた並びは、カードが増えたり減ったりしたときだけ作り直す
//   ・ここは DOM を知らない（見せ方は panels/moon-window.ts）
import { t } from './i18n';
import type { Reminder } from './types';
import { isDue, isWeak, type VocabCard } from './vocab';

export type RotateKind = 'vocab' | 'reminder';

export const ROTATE_EVERY: readonly { ms: number; label: string }[] = [
  { ms: 30_000, label: t('30秒') },
  { ms: 60_000, label: t('1分') },
  { ms: 180_000, label: t('3分') },
  { ms: 300_000, label: t('5分') },
  { ms: 600_000, label: t('10分') },
];

// 単語帳のどのカードを映すか（K1）：全部／⟳ の印だけ／今日の復習と苦手だけ
export type RotateGrain = 'all' | 'marked' | 'due';
export const ROTATE_GRAINS: readonly RotateGrain[] = ['all', 'marked', 'due'];

export interface RotatePrefs {
  on: boolean;
  kinds: RotateKind[];
  everyMs: number;
  grain: RotateGrain;
  markNew: boolean; // 新しく入れるカードに ⟳ の印を付ける（入れる小窓の既定。左も読む。K1）
  nextBand: boolean; // 月の窓に「次は 14:30 …」の帯を出す（K3。既定は切）
}

export const ROTATE_DEFAULT: RotatePrefs = { on: false, kinds: ['vocab'], everyMs: 60_000, grain: 'all', markNew: false, nextBand: false };

const isKind = (k: unknown): k is RotateKind => k === 'vocab' || k === 'reminder';

export function cleanRotatePrefs(raw: unknown): RotatePrefs {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  // 保存が無いときは単語帳だけ。空の配列は、使う人が両方の印を外したときなので、そのまま残す
  const kinds = Array.isArray(r.kinds) ? [...new Set(r.kinds.filter(isKind))] : [...ROTATE_DEFAULT.kinds];
  const everyMs = ROTATE_EVERY.some((e) => e.ms === r.everyMs) ? (r.everyMs as number) : ROTATE_DEFAULT.everyMs;
  const grain = (ROTATE_GRAINS as readonly unknown[]).includes(r.grain) ? (r.grain as RotateGrain) : ROTATE_DEFAULT.grain;
  return { on: r.on === true, kinds, everyMs, grain, markNew: r.markNew === true, nextBand: r.nextBand === true };
}

// 月の窓の設定の置き場（localStorage）。左右のサイドバーは同じ origin なので、左の入れる小窓も読める（K1）
export const MOON_PREFS_KEY = 'honeycomb.moonWindow';

// 「新しく入れたカードに ⟳ を付ける」の今の設定（読めなければ付けない）
export function savedMarkNew(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(MOON_PREFS_KEY) ?? '{}') as { rotate?: unknown } | null;
    return cleanRotatePrefs(saved?.rotate).markNew;
  } catch {
    return false;
  }
}

export const everyLabel = (ms: number) => ROTATE_EVERY.find((e) => e.ms === ms)?.label ?? t('{0}秒', { 0: Math.round(ms / 1000) });

export type RotateTag = 'due' | 'weak' | 'other';

export function rotateTag(card: VocabCard, now = Date.now()): RotateTag {
  if (isDue(card, now)) return 'due';
  if (isWeak(card)) return 'weak';
  return 'other';
}

// 映す順のカードの id（時期が来たものは早い順、苦手は「もう一度」の多い順、ほかは混ぜる）
export function rotateOrder(cards: readonly VocabCard[], now = Date.now(), random: () => number = Math.random): string[] {
  const due = cards.filter((c) => rotateTag(c, now) === 'due').sort((a, b) => a.due - b.due);
  const weak = cards.filter((c) => rotateTag(c, now) === 'weak').sort((a, b) => b.lapses - a.lapses);
  const rest = cards.filter((c) => rotateTag(c, now) === 'other');
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...due, ...weak, ...rest].map((c) => c.id);
}

// 今の並びを、カードの増減に合わせる（同じカードの組なら、並びはそのまま）
export function syncRotateOrder(order: readonly string[], cards: readonly VocabCard[], now = Date.now()): string[] {
  const ids = new Set(cards.map((c) => c.id));
  if (order.length === ids.size && order.every((id) => ids.has(id))) return [...order];
  return rotateOrder(cards, now);
}

export type RotateSlot = { kind: 'vocab'; id: string } | { kind: 'reminder'; id: string };

export const slotKey = (slot: RotateSlot) => `${slot.kind}:${slot.id}`;

export const sameSlot = (a: RotateSlot, b: RotateSlot) => a.kind === b.kind && a.id === b.id;

// まだ時間になっていないもの。近い順（同じ時刻なら、先に置いた順）。引き金のもの（K4。時刻では鳴らない）は入れない
export function upcomingReminders(reminders: readonly Reminder[], now = Date.now()): Reminder[] {
  return reminders.filter((r) => r.dueAt > now && !r.trigger).sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt);
}

// 片方だけならその順。両方なら「単語帳、リマインダー、単語帳、リマインダー…」。多い方の残りは、そのあとに続ける
export function weaveRotate(vocabIds: readonly string[], reminderIds: readonly string[]): RotateSlot[] {
  if (vocabIds.length === 0) return reminderIds.map((id) => ({ kind: 'reminder', id }));
  if (reminderIds.length === 0) return vocabIds.map((id) => ({ kind: 'vocab', id }));
  const out: RotateSlot[] = [];
  const n = Math.max(vocabIds.length, reminderIds.length);
  for (let i = 0; i < n; i++) {
    if (i < vocabIds.length) out.push({ kind: 'vocab', id: vocabIds[i] });
    if (i < reminderIds.length) out.push({ kind: 'reminder', id: reminderIds[i] });
  }
  return out;
}

// 映すカードを粒で絞る（K1）。marked は印の付いたもの、due は今日の復習か苦手のもの
export function grainCards(cards: readonly VocabCard[], grain: RotateGrain, now = Date.now()): VocabCard[] {
  if (grain === 'marked') return cards.filter((c) => c.rotate === true);
  if (grain === 'due') return cards.filter((c) => rotateTag(c, now) !== 'other');
  return [...cards];
}

export function buildRotateSlots(
  kinds: readonly RotateKind[],
  vocabCards: readonly VocabCard[],
  vocabOrder: readonly string[],
  reminders: readonly Reminder[],
  now = Date.now(),
  grain: RotateGrain = 'all',
): { slots: RotateSlot[]; vocabOrder: string[] } {
  let order = [...vocabOrder];
  let vocabIds: string[] = [];
  if (kinds.includes('vocab')) {
    const cards = grainCards(vocabCards, grain, now);
    order = syncRotateOrder(order, cards, now);
    const ids = new Set(cards.map((c) => c.id));
    vocabIds = order.filter((id) => ids.has(id));
  }
  const reminderIds = kinds.includes('reminder') ? upcomingReminders(reminders, now).map((r) => r.id) : [];
  return { slots: weaveRotate(vocabIds, reminderIds), vocabOrder: order };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// 「あと 25 分」。時間になったあとも、次に替わるまでは「まもなく」
export function remainingLabel(dueAt: number, now = Date.now()): string {
  const left = dueAt - now;
  if (left <= 0) return t('まもなく');
  if (left < MINUTE) return t('あと 1 分未満');
  if (left < HOUR) return t('あと {0} 分', { 0: Math.round(left / MINUTE) });
  if (left < DAY) {
    const hours = Math.floor(left / HOUR);
    const minutes = Math.round((left % HOUR) / MINUTE);
    if (minutes >= 60) return t('あと {0} 時間', { 0: hours + 1 });
    if (minutes === 0) return t('あと {0} 時間', { 0: hours });
    return t('あと {0} 時間 {1} 分', { 0: hours, 1: minutes });
  }
  const days = Math.floor(left / DAY);
  const hours = Math.round((left % DAY) / HOUR);
  if (hours >= 24) return t('あと {0} 日', { 0: days + 1 });
  if (hours === 0) return t('あと {0} 日', { 0: days });
  return t('あと {0} 日 {1} 時間', { 0: days, 1: hours });
}
