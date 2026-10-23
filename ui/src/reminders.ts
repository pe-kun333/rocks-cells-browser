// リマインダーの台帳（左サイドバーが持つ。右サイドバーを閉じていても知らせられるように）
//   保存先：ui-data\reminders.json。時間になったら onFire を呼んで、台帳から外す（繰り返しは次の回に置き直す）
//   起動していない間に過ぎたものは、次に起動したときに「遅れて」知らせる
//   鳴ったもの・済み・延ばした・取り消したは ui-data\reminders-fired.json に新しい順に 50 件（K3）
import { readDataChecked, writeData } from './data';
import { nextRepeat } from './reminder-when';
import type { FiredReminder, FiredState, Reminder, ReminderBy, ReminderRepeat, ReminderTrigger } from './types';
import { parseLink, type VocabLink } from './vocab';

const FILE = 'reminders.json';
const FIRED_FILE = 'reminders-fired.json';
const CHECK_MS = 5_000;
export const MAX_REMINDERS = 100; // 時刻で鳴るもの。右が置く前に数えて「いっぱいです」を出す（K2。左の黙った落ちに頼らない）
export const MAX_TRIGGERS = 30; // 引き金で鳴るもの（K4。時刻のものとは別に数える）
export const MAX_FIRED = 50; // 鳴ったものの記録（K3）
const LOAD_RETRY_MS = 3000; // K0：台帳を読めなかったときの読み直しまでの間（メモの台帳と同じ）

export class ReminderStore {
  private items: Reminder[] = [];
  private fired: FiredReminder[] = []; // 鳴ったものの記録（新しい順。K3）
  private loaded = false; // 読み込みを終えた（読めなかったときも）
  private writable = false; // 台帳に書いてよい（読めた・ファイルが無かった。K0：読めなかったら書かない）
  private firedWritable = false; // 鳴ったものの記録に書いてよい（K3。読めなかったら書かない）
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly onFire: (reminder: Reminder, late: boolean) => void) {}

  async start() {
    // K0：「本当に無い」と「あるのに読めない」を分ける。読めなかったら 3 秒後に 1 回だけ読み直す
    //   それでも読めなければ、この起動では台帳に書かない（空で上書きしない）。待つ間に足したものは、この起動の間は鳴らす
    //   鳴ったものの記録（K3）も同じ。どちらかが読めなくても、もう片方は使う
    let [read, firedRead] = await Promise.all([readReminderLedger(), readFiredLedger()]);
    if (read === 'unreadable' || firedRead === 'unreadable') {
      await new Promise((resolve) => window.setTimeout(resolve, LOAD_RETRY_MS));
      if (read === 'unreadable') read = await readReminderLedger();
      if (firedRead === 'unreadable') firedRead = await readFiredLedger();
    }
    const earlyFired = this.fired; // 読み込みを待つ間の記録（id が重なれば待つ間の方が新しい）
    if (firedRead !== 'unreadable' && firedRead !== 'missing') {
      this.fired = earlyFired.reduceRight((list, rec) => recordFired(list, rec), firedRead.slice(0, MAX_FIRED));
    }
    this.firedWritable = firedRead !== 'unreadable';
    if (this.firedWritable && earlyFired.length > 0) this.saveFired();
    const early = this.items; // 読み込みを待つ間に足したもの（id が重なれば読んだ方）
    if (read !== 'unreadable' && read !== 'missing') {
      const known = new Set(read.map((r) => r.id));
      this.items = [...read, ...early.filter((r) => !known.has(r.id))];
      this.items = limitItems(this.items); // 時刻のものは 100 件、引き金のものは 30 件まで（K4）
    }
    this.writable = read !== 'unreadable';
    this.loaded = true;
    if (this.writable && early.length > 0) this.save(); // 待つ間に足したものを書く
    this.check(true);
    window.setInterval(() => this.check(false), CHECK_MS);
    this.emit();
  }

  // 読み直しても台帳を読めなかった（この起動では書かない）
  get loadFailed() {
    return this.loaded && !this.writable;
  }

  // 鳴ったものの記録を読めなかった（K3。この起動では記録に書かない）
  get firedFailed() {
    return this.loaded && !this.firedWritable;
  }

  get ready() {
    return this.loaded;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  list(): Reminder[] {
    return [...this.items].sort((a, b) => a.dueAt - b.dueAt);
  }

  // 鳴ったものの記録（新しい順。K3）
  firedList(): FiredReminder[] {
    return [...this.fired];
  }

  // 置く・置き直す。延ばした写し（snoozedFrom）なら、元の記録を「延ばした」にする（K3）
  //   同じ id で置き直したもの（取り消し・済みの「元に戻す」）は、その記録を外す
  add(reminder: Reminder) {
    if (!isReminder(reminder)) return;
    const { snoozedFrom, ...rest } = reminder;
    let fired = this.fired;
    if (typeof snoozedFrom === 'string' && fired.some((f) => f.id === snoozedFrom && f.state === 'fired')) fired = setFiredState(fired, snoozedFrom, 'snoozed');
    if (fired.some((f) => f.id === rest.id && (f.state === 'cancelled' || f.state === 'done'))) fired = fired.filter((f) => f.id !== rest.id);
    if (fired !== this.fired) {
      this.fired = fired;
      this.saveFired();
    }
    this.items = this.items.filter((r) => r.id !== rest.id);
    this.items.push(rest);
    this.items = limitItems(this.items); // 時刻のものは 100 件、引き金のものは 30 件まで（K4）
    this.save();
  }

  // 鳴る前に取り消す。記録に「取り消した」を書いてから台帳から外す（K3。繰り返しは丸ごと消える）
  cancel(id: string) {
    const reminder = this.items.find((r) => r.id === id);
    if (!reminder) return;
    this.record(firedOf(reminder, 'cancelled', Date.now()));
    this.items = this.items.filter((r) => r.id !== id);
    this.save();
  }

  // 済み（K3）。fired：鳴ったものの記録を済みにする（台帳は触らない）
  //   そうでなければ、まだ鳴っていないものを済ませる：記録に「済み」を書き、繰り返しは次の回へ、ほかは台帳から外す
  done(id: string, fired = false) {
    if (fired) {
      if (!this.fired.some((f) => f.id === id && f.state !== 'done')) return;
      this.fired = setFiredState(this.fired, id, 'done');
      this.saveFired();
      this.emit();
      return;
    }
    const reminder = this.items.find((r) => r.id === id);
    if (!reminder) return;
    const now = Date.now();
    this.record(firedOf(reminder, 'done', now));
    const repeat = reminderTrigger(reminder) ? undefined : reminderRepeat(reminder);
    const next = repeat ? nextRepeat(reminder.dueAt, repeat, Math.max(now, reminder.dueAt)) : null;
    this.items = this.items.filter((r) => r.id !== id);
    if (next !== null) this.items.push({ ...reminder, dueAt: next });
    this.save();
  }

  // 時間になったもの：記録に「鳴った」を書いてから（途中で閉じても失わない。二重になったら id で一つ）、台帳から外す
  //   繰り返しは、鳴った時刻から数えて今より後の最初の回に、同じ id で置き直す（閉じている間に何回も過ぎていても 1 回だけ鳴らす。K3）
  //   引き金のものは時刻では鳴らさない。起動したとき（startup）は「次に起動したとき」の引き金を鳴らす（K4）
  private check(startup: boolean) {
    if (!this.loaded) return;
    const now = Date.now();
    const due = this.items.filter((r) => {
      const trigger = reminderTrigger(r);
      return trigger ? startup && trigger.kind === 'startup' : r.dueAt <= now;
    });
    this.ring(due, now, startup);
  }

  // このサイトを開いた（K4。左が表示中のタブを別のホストから移したとき・そのホストのタブに切り替えたときに呼ぶ）
  checkSite(host: string) {
    if (!this.loaded) return;
    const due = this.items.filter((r) => {
      const trigger = reminderTrigger(r);
      return trigger?.kind === 'site' && trigger.host === host;
    });
    this.ring(due, Date.now(), false);
  }

  // 鳴らす：記録を先に書いてから、台帳から外す（繰り返しは次の回へ置き直す）
  private ring(due: readonly Reminder[], now: number, late: boolean) {
    if (due.length === 0) return;
    const ids = new Set(due.map((r) => r.id));
    for (const reminder of due) this.fired = recordFired(this.fired, firedOf(reminder, 'fired', now));
    this.saveFired();
    const again: Reminder[] = [];
    for (const reminder of due) {
      const repeat = reminderTrigger(reminder) ? undefined : reminderRepeat(reminder);
      const next = repeat ? nextRepeat(reminder.dueAt, repeat, now) : null;
      if (next !== null) again.push({ ...reminder, dueAt: next });
    }
    this.items = [...this.items.filter((r) => !ids.has(r.id)), ...again];
    this.save();
    // 引き金のもの（K4）は「起動していない間に過ぎた」ものではないので、遅れの印を付けない
    for (const reminder of due) this.onFire(reminder, late && !reminderTrigger(reminder));
  }

  private record(rec: FiredReminder) {
    this.fired = recordFired(this.fired, rec);
    this.saveFired();
  }

  private save() {
    if (this.writable) void writeData(FILE, this.items); // 読み込む前・読めなかった台帳に書くと、前のリマインダーを消してしまう
    this.emit();
  }

  // 記録を書く（K3）。読めなかった記録・読み込む前には書かない。台帳より先に呼ぶ（書く順で、途中で閉じても失わない）
  private saveFired() {
    if (this.firedWritable) void writeData(FIRED_FILE, { v: 1, items: this.fired });
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

// 台帳を 1 回読む（K0）：読めたもの・missing（ファイルが無い）・unreadable（返事が無い・壊れている・配列でない）
async function readReminderLedger(): Promise<Reminder[] | 'missing' | 'unreadable'> {
  const read = await readDataChecked<unknown>(FILE);
  if (read.status === 'missing') return 'missing';
  if (read.status === 'failed' || !Array.isArray(read.value)) return 'unreadable';
  return read.value.filter(isReminder);
}

// 誰が置いたか（K2）：無い・読めないものは相棒（K2 より前に置けたのは相棒だけ）
export function reminderBy(reminder: Pick<Reminder, 'by'>): ReminderBy {
  return reminder.by === 'user' ? 'user' : 'companion';
}

// 指す先（K2）：link を確かめて読む。無ければ古い tabId をタブの番号として読み替える（URL は無い）
export function reminderLink(reminder: Pick<Reminder, 'link' | 'tabId'>): VocabLink | undefined {
  const link = parseLink(reminder.link);
  if (link) return link;
  const id = reminder.tabId;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? { kind: 'tab', id } : undefined;
}

// 引き金（K4）：知っている形のほかは引き金にしない（時刻で鳴るものとして扱う）
export function reminderTrigger(reminder: Pick<Reminder, 'trigger'>): ReminderTrigger | undefined {
  const t = reminder.trigger as unknown;
  if (typeof t !== 'object' || t === null) return undefined;
  const r = t as Record<string, unknown>;
  if (r.kind === 'startup') return { kind: 'startup' };
  if (r.kind === 'site' && typeof r.host === 'string' && r.host.length > 0 && r.host.length <= 253) return { kind: 'site', host: r.host.toLowerCase() };
  return undefined;
}

// 時刻のもの・引き金のものを、それぞれの上限まで（K4）。時刻のものは近い順に、引き金のものは新しく置いた順に残す
export function limitItems(items: readonly Reminder[]): Reminder[] {
  const timed = items.filter((r) => !reminderTrigger(r)).sort((a, b) => a.dueAt - b.dueAt);
  const triggered = items.filter((r) => reminderTrigger(r)).sort((a, b) => b.createdAt - a.createdAt);
  return [...timed.slice(0, MAX_REMINDERS), ...triggered.slice(0, MAX_TRIGGERS)];
}

// 繰り返し（K3）：知っている値のほかは繰り返さない
export function reminderRepeat(reminder: Pick<Reminder, 'repeat'>): ReminderRepeat | undefined {
  const r = reminder.repeat;
  return r === 'daily' || r === 'weekdays' || r === 'weekly' || r === 'monthly' ? r : undefined;
}

// ---------- 鳴ったものの記録（K3。計画書 §5 の 14） ----------

// 記録の 1 件：文・時刻・指す先・置いた人・題名・繰り返しを写す（指す先は確かめて読んだもの）
export function firedOf(reminder: Reminder, state: FiredState, at: number): FiredReminder {
  const link = reminderLink(reminder);
  const repeat = reminderRepeat(reminder);
  const trigger = reminderTrigger(reminder);
  return {
    ...(trigger ? { trigger } : {}),
    ...(typeof reminder.card === 'string' ? { card: reminder.card } : {}),
    id: reminder.id,
    text: reminder.text,
    dueAt: reminder.dueAt,
    firedAt: at,
    state,
    ...(link ? { link } : {}),
    by: reminderBy(reminder),
    ...(reminder.title ? { title: reminder.title } : {}),
    ...(repeat ? { repeat } : {}),
  };
}

// 新しい記録を先頭に（同じ id は一つにする）。max 件まで（古いものから消す）
export function recordFired(list: readonly FiredReminder[], rec: FiredReminder, max = MAX_FIRED): FiredReminder[] {
  return [rec, ...list.filter((f) => f.id !== rec.id)].slice(0, max);
}

export function setFiredState(list: readonly FiredReminder[], id: string, state: FiredState): FiredReminder[] {
  return list.map((f) => (f.id === id ? { ...f, state } : f));
}

const FIRED_STATES: readonly FiredState[] = ['fired', 'done', 'snoozed', 'cancelled'];

export function isFired(value: unknown): value is FiredReminder {
  if (typeof value !== 'object' || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.id === 'string' &&
    typeof f.text === 'string' &&
    typeof f.dueAt === 'number' &&
    typeof f.firedAt === 'number' &&
    (FIRED_STATES as readonly unknown[]).includes(f.state)
  );
}

// 記録を 1 回読む（K3）：読めたもの・missing（ファイルが無い）・unreadable（返事が無い・壊れている・知らない版や形）
async function readFiredLedger(): Promise<FiredReminder[] | 'missing' | 'unreadable'> {
  const read = await readDataChecked<{ v?: unknown; items?: unknown } | null>(FIRED_FILE);
  if (read.status === 'missing') return 'missing';
  if (read.status === 'failed') return 'unreadable';
  const saved = read.value;
  if (!saved || typeof saved !== 'object' || saved.v !== 1 || !Array.isArray(saved.items)) return 'unreadable';
  return saved.items.filter(isFired).sort((a, b) => b.firedAt - a.firedAt);
}

export function isReminder(value: unknown): value is Reminder {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.text === 'string' && typeof r.dueAt === 'number' && typeof r.createdAt === 'number';
}
