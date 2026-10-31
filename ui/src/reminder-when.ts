// リマインダーの時刻の読み方と、置き直しの形（K2。docs/plan-cards.md §5 の 11・12）
//   DOM も台帳も知らない（vitest で確かめる）。時刻はこのパソコンの時刻
import { t as tr } from './i18n';
import type { Reminder, ReminderRepeat, ReminderTrigger } from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const MAX_AHEAD_MS = 400 * DAY; // 相棒の道具と同じ（400 日より先は置けない）
const WEEKDAYS = '日月火水木金土';

export const newReminderId = (now = Date.now()) => `r${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// 今日（dayOffset 日後）の h:m
function atClock(now: number, h: number, m: number, dayOffset = 0): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h, m).getTime();
}

// 今日の h:m。過ぎていれば翌日
function todayOrNext(now: number, h: number, m: number): number {
  const t = atClock(now, h, m);
  return t > now ? t : atClock(now, h, m, 1);
}

// 「10/24 14:30」：今年のその日。過ぎていれば来年。ない日（2/30 など）は読まない
function monthDay(now: number, month: number, day: number, h: number, m: number): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || h > 23 || m > 59) return null;
  const year = new Date(now).getFullYear();
  for (const y of [year, year + 1]) {
    const d = new Date(y, month - 1, day, h, m);
    if (d.getMonth() !== month - 1) return null;
    if (d.getTime() > now) return d.getTime();
  }
  return null;
}

// 文の頭の時刻の言い方（上から順に試す）
const WHEN_PATTERNS: [RegExp, (m: RegExpExecArray, now: number) => number | null][] = [
  [/^(\d{1,6})\s*分後/, (m, now) => now + Number(m[1]) * MINUTE],
  [/^(\d{1,5})\s*時間後/, (m, now) => now + Number(m[1]) * HOUR],
  [/^今夜/, (_, now) => todayOrNext(now, 21, 0)],
  [/^今日の夕方/, (_, now) => todayOrNext(now, 17, 0)],
  [/^明日の朝/, (_, now) => atClock(now, 9, 0, 1)],
  [/^明日\s*(\d{1,2})\s*時/, (m, now) => (Number(m[1]) <= 23 ? atClock(now, Number(m[1]), 0, 1) : null)],
  [/^来週/, (_, now) => atClock(now, 9, 0, 7)],
  [/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/, (m, now) => monthDay(now, Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]))],
];

// 文と時刻を一つの欄で（K2。計画書 §5 の 11）：文の頭が時刻の言い方なら、その時刻と残りの文。読めなければ null（押しボタンの時刻を使う）
//   全角の数字や記号も読む（NFKC）。残りの文の頭の「に」「、」などは外す。今より前・400 日より先は読まない
export function parseWhen(text: string, now: number): { dueAt: number; text: string } | null {
  const norm = text.normalize('NFKC').trim();
  for (const [pattern, when] of WHEN_PATTERNS) {
    const m = pattern.exec(norm);
    if (!m) continue;
    const dueAt = when(m, now);
    if (dueAt === null || !Number.isFinite(dueAt) || dueAt <= now || dueAt > now + MAX_AHEAD_MS) return null;
    const rest = norm
      .slice(m[0].length)
      .replace(/^[\s、,。.:：]*(?:には|に)?[\s、,。.:：]*/, '')
      .trim();
    return { dueAt, text: rest };
  }
  return null;
}

export interface PresetTime {
  key: 'm10' | 'h1' | 'evening' | 'morning' | 'week';
  label: string;
  dueAt: number;
}

// 押しボタンの時刻（K2）：10 分後・1 時間後・今日の夕方（17 時。過ぎたら出さない）・明日の朝（9 時）・来週（7 日後の 9 時）
//   延ばすときは「来週」を除いて使う
export function presetTimes(now: number): PresetTime[] {
  const out: PresetTime[] = [
    { key: 'm10', label: tr('10 分後'), dueAt: now + 10 * MINUTE },
    { key: 'h1', label: tr('1 時間後'), dueAt: now + HOUR },
  ];
  const evening = atClock(now, 17, 0);
  if (evening > now) out.push({ key: 'evening', label: tr('今日の夕方'), dueAt: evening });
  out.push({ key: 'morning', label: tr('明日の朝'), dueAt: atClock(now, 9, 0, 1) }, { key: 'week', label: tr('来週'), dueAt: atClock(now, 9, 0, 7) });
  return out;
}

// 鳴ったものを延ばす置き直し（K2・K3。計画書 §5 の 12）：同じ文・指す先・置いた人のまま、新しい id と時刻で
//   繰り返しは写さない（元の繰り返しは左で続いている）。引き金も写さない（延ばしたものは時刻で鳴らす。K4）
//   元の id を snoozedFrom に付ける（左が記録を「延ばした」にする）
export function snoozedCopy(reminder: Reminder, dueAt: number, now: number): Reminder {
  const { repeat: _repeat, snoozedFrom: _from, trigger: _trigger, ...rest } = reminder;
  return { ...rest, id: newReminderId(now), dueAt, createdAt: now, snoozedFrom: reminder.id };
}

// 引き金のサイト（K4。計画書 §5 の 16）：http・https のページのホスト（小文字、頭の www. は外す）。ほかは null
export function siteHost(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.host.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

// 引き金の札
export function triggerLabel(trigger: ReminderTrigger): string {
  return trigger.kind === 'site' ? tr('次に {0} を開いたとき', { 0: trigger.host }) : tr('次に起動したとき');
}

// 引き金で置くリマインダー（K4）：時刻では鳴らさないので、dueAt は作った時刻＋400 日（古い版でも 400 日は鳴らない）
export function triggeredReminder(text: string, trigger: ReminderTrigger, now: number, extra: Partial<Reminder> = {}): Reminder {
  return { ...extra, id: newReminderId(now), text, dueAt: now + MAX_AHEAD_MS, createdAt: now, trigger };
}

// 繰り返し（K3。計画書 §5 の 15）
export const REPEATS: readonly [ReminderRepeat, string][] = [
  ['daily', tr('毎日')],
  ['weekdays', tr('毎平日')],
  ['weekly', tr('毎週')],
  ['monthly', tr('毎月')],
];

export const repeatLabel = (repeat: ReminderRepeat) => REPEATS.find(([key]) => key === repeat)?.[1] ?? '';

// 鳴った時刻 dueAt から数えて、今より後の最初の回（閉じている間に何回も過ぎていても、次の 1 回だけ）
//   時刻（時・分）はそのまま。毎月はその日が無い月は月末（そのあとは月末から数える）。見つからなければ null
export function nextRepeat(dueAt: number, repeat: ReminderRepeat, now: number): number | null {
  const d = new Date(dueAt);
  const [y, m, day, h, min] = [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()];
  for (let i = 1; i <= 5000; i++) {
    let t: number;
    if (repeat === 'monthly') {
      const last = new Date(y, m + i + 1, 0).getDate();
      t = new Date(y, m + i, Math.min(day, last), h, min).getTime();
    } else if (repeat === 'weekly') {
      t = new Date(y, m, day + 7 * i, h, min).getTime();
    } else {
      const next = new Date(y, m, day + i, h, min);
      if (repeat === 'weekdays' && (next.getDay() === 0 || next.getDay() === 6)) continue;
      t = next.getTime();
    }
    if (t > now) return t;
  }
  return null;
}

// 日ごとの見出し（K2）：今日・明日・「10/24（金）」
export function dayLabel(dueAt: number, now: number): string {
  const tomorrow = atClock(now, 0, 0, 1);
  if (dueAt < tomorrow) return '今日';
  if (dueAt < atClock(now, 0, 0, 2)) return tr('明日');
  const d = new Date(dueAt);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

// 行の時刻「14:30」
export function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
