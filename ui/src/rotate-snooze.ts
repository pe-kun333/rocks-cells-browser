// めぐる表示の 1 枚の「今日はもう出さない」「🔔 あとで」と、月の欠け（K1。docs/plan-cards.md §5 の 3〜6）
//   右だけの一時の記録（localStorage の honeycomb.rotateSnooze）。台帳は変えない
//   ここの計算は DOM を知らない。日付（today）は呼ぶ側が dayOf で渡す
export const SNOOZE_KEY = 'honeycomb.rotateSnooze';
export const LATER_MS = 60 * 60_000; // 🔔 あとで：1 時間後にもう一度
const MAX_IDS = 3000; // カードの上限と同じ
const MAX_LATER = 200;

export interface RotateSnooze {
  day: string; // ids の日（YYYY-MM-DD）。日が替わると ids は捨てる
  ids: string[]; // 今日はもう出さないカード
  later: { id: string; until: number }[]; // until まで出さず、過ぎたら次の入れ替えで 1 回だけ出す
  dayStart: { day: string; count: number } | null; // 今日の初めの「時期の来たカード」の数（月の欠けの分母）
}

export const emptySnooze = (today: string): RotateSnooze => ({ day: today, ids: [], later: [], dayStart: null });

// 読んだものを確かめる。日が替わっていたら、今日の分（ids・dayStart）を捨てる
export function cleanSnooze(raw: unknown, today: string): RotateSnooze {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const sameDay = r.day === today;
  const ids = sameDay && Array.isArray(r.ids) ? [...new Set(r.ids.filter((id): id is string => typeof id === 'string'))].slice(0, MAX_IDS) : [];
  const later: RotateSnooze['later'] = [];
  if (Array.isArray(r.later)) {
    for (const item of r.later) {
      const l = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      if (typeof l.id !== 'string' || typeof l.until !== 'number' || !Number.isFinite(l.until) || later.some((x) => x.id === l.id)) continue;
      later.push({ id: l.id, until: l.until });
      if (later.length >= MAX_LATER) break;
    }
  }
  const s = (typeof r.dayStart === 'object' && r.dayStart !== null ? r.dayStart : {}) as Record<string, unknown>;
  const dayStart = s.day === today && typeof s.count === 'number' && Number.isInteger(s.count) && s.count >= 0 ? { day: today, count: s.count } : null;
  return { day: today, ids, later, dayStart };
}

// 今日はもう出さない（あとでの予約は消す）
export function skipToday(s: RotateSnooze, id: string, today: string): RotateSnooze {
  const ids = s.day === today ? s.ids : [];
  return { ...s, day: today, ids: ids.includes(id) ? ids : [...ids, id].slice(-MAX_IDS), later: s.later.filter((l) => l.id !== id) };
}

// 🔔 あとで：ms のあいだ出さず、過ぎたら次の入れ替えで出す（同じカードは置き直す）
export function snoozeLater(s: RotateSnooze, id: string, now: number, ms = LATER_MS): RotateSnooze {
  return { ...s, later: [...s.later.filter((l) => l.id !== id), { id, until: now + ms }].slice(-MAX_LATER) };
}

// いま映さないカード：今日はもう出さないもの・あとでの時間がまだ来ていないもの
export function hiddenIds(s: RotateSnooze, today: string, now: number): Set<string> {
  const out = new Set(s.day === today ? s.ids : []);
  for (const l of s.later) if (l.until > now) out.add(l.id);
  return out;
}

// あとでの時間が来たもの（早い順）。今日はもう出さないものは除く
export function ripeIds(s: RotateSnooze, today: string, now: number): string[] {
  const skipped = new Set(s.day === today ? s.ids : []);
  return s.later
    .filter((l) => l.until <= now && !skipped.has(l.id))
    .sort((a, b) => a.until - b.until)
    .map((l) => l.id);
}

// 出したので、あとでの予約を消す
export function takeRipe(s: RotateSnooze, id: string): RotateSnooze {
  return { ...s, later: s.later.filter((l) => l.id !== id) };
}

// 今日の初めの枚数（月の欠けの分母）。今日まだ無ければ今の枚数にし、日中に増えたら増やす
export function withDayStart(s: RotateSnooze, today: string, dueNow: number): RotateSnooze {
  const start = s.dayStart?.day === today ? Math.max(s.dayStart.count, dueNow) : dueNow;
  if (s.dayStart?.day === today && s.dayStart.count === start) return s;
  return { ...s, dayStart: { day: today, count: start } };
}

// 月の明るさ（0〜1）：満月は今日の時期の来たカードが 0 枚。欠けは「残り ÷ 今日の初めの枚数」
export function moonLit(remaining: number, start: number): number {
  if (remaining <= 0 || start <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - remaining / start));
}

export function loadSnooze(today: string): RotateSnooze {
  try {
    return cleanSnooze(JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}'), today);
  } catch {
    return emptySnooze(today);
  }
}

export function saveSnooze(s: RotateSnooze) {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(s));
  } catch {
    // 保存できなくても、この起動の間は効く
  }
}
