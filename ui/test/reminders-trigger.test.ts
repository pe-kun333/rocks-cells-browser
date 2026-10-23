// 引き金（K4）：サイト・起動での鳴らし方、時刻では鳴らさないこと、別の上限、カードから置いたもの
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ reads: new Map<string, unknown>(), writes: [] as { name: string; value: unknown }[] }));

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async (name: string) => (io.reads.has(name) ? { status: 'ok', value: io.reads.get(name) } : { status: 'missing' }),
  writeData: async (name: string, value: unknown) => {
    io.writes.push({ name, value: JSON.parse(JSON.stringify(value)) });
    return true;
  },
  deleteData: () => {},
  listData: async () => [],
}));

import { MAX_AHEAD_MS, siteHost, snoozedCopy, triggeredReminder, triggerLabel } from '../src/reminder-when';
import { firedOf, limitItems, MAX_REMINDERS, MAX_TRIGGERS, ReminderStore, reminderTrigger } from '../src/reminders';
import { upcomingReminders } from '../src/rotate';
import type { Reminder } from '../src/types';

const NOW = new Date(2026, 9, 22, 14, 0, 0).getTime();
const rem = (id: string, over: Partial<Reminder> = {}): Reminder => ({ id, text: `文${id}`, dueAt: NOW + 3600_000, createdAt: 1, ...over });

beforeEach(() => {
  io.reads.clear();
  io.writes.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function started(onFire: (r: Reminder, late: boolean) => void = () => {}) {
  const store = new ReminderStore(onFire);
  await store.start();
  return store;
}

describe('引き金の形', () => {
  it('サイトのホストは小文字で、頭の www. を外す。http・https のほかは無し', () => {
    expect(siteHost('https://WWW.Example.com/a?b')).toBe('example.com');
    expect(siteHost('http://news.example.com:8080/')).toBe('news.example.com:8080');
    expect(siteHost('file:///C:/a.html')).toBeNull();
    expect(siteHost('not a url')).toBeNull();
  });

  it('札の文と、引き金のリマインダー（作った時刻＋400 日）', () => {
    expect(triggerLabel({ kind: 'site', host: 'example.com' })).toBe('次に example.com を開いたとき');
    expect(triggerLabel({ kind: 'startup' })).toBe('次に起動したとき');
    const r = triggeredReminder('読む', { kind: 'startup' }, NOW, { by: 'user' });
    expect(r).toMatchObject({ text: '読む', dueAt: NOW + MAX_AHEAD_MS, createdAt: NOW, trigger: { kind: 'startup' }, by: 'user' });
  });

  it('読めない引き金は時刻のものとして扱う', () => {
    expect(reminderTrigger({ trigger: { kind: 'site', host: 'Ex.COM' } })).toEqual({ kind: 'site', host: 'ex.com' });
    expect(reminderTrigger({ trigger: { kind: 'site', host: '' } as never })).toBeUndefined();
    expect(reminderTrigger({ trigger: { kind: 'tab' } as never })).toBeUndefined();
  });

  it('上限は時刻のもの 100 件・引き金のもの 30 件を別に数える', () => {
    const timed = Array.from({ length: MAX_REMINDERS + 3 }, (_, i) => rem(`t${i}`, { dueAt: NOW + i }));
    const trig = Array.from({ length: MAX_TRIGGERS + 2 }, (_, i) => rem(`g${i}`, { createdAt: i, trigger: { kind: 'startup' } }));
    const kept = limitItems([...trig, ...timed]);
    expect(kept.filter((r) => !r.trigger)).toHaveLength(MAX_REMINDERS);
    expect(kept.filter((r) => r.trigger)).toHaveLength(MAX_TRIGGERS);
    expect(kept.some((r) => r.id === 'g0')).toBe(false); // 引き金は新しく置いたものを残す
    expect(kept.some((r) => r.id === `t${MAX_REMINDERS}`)).toBe(false); // 時刻は近いものを残す
  });

  it('めぐる表示と帯には引き金のものを出さない', () => {
    expect(upcomingReminders([rem('a'), rem('b', { trigger: { kind: 'startup' } })], NOW).map((r) => r.id)).toEqual(['a']);
  });

  it('延ばした写しは引き金を持たない（時刻で鳴らす）', () => {
    expect(snoozedCopy(rem('a', { trigger: { kind: 'startup' }, card: 'v1' }), NOW + 600_000, NOW)).toMatchObject({ dueAt: NOW + 600_000, card: 'v1', snoozedFrom: 'a' });
    expect(snoozedCopy(rem('a', { trigger: { kind: 'startup' } }), NOW + 600_000, NOW)).not.toHaveProperty('trigger');
  });

  it('記録に引き金とカードを写す', () => {
    expect(firedOf(rem('a', { trigger: { kind: 'site', host: 'x.com' }, card: 'v1' }), 'fired', NOW)).toMatchObject({ trigger: { kind: 'site', host: 'x.com' }, card: 'v1' });
  });
});

describe('ReminderStore の引き金', () => {
  const site = (id: string, host: string) => rem(id, { dueAt: NOW - 1, trigger: { kind: 'site', host } });

  it('起動したときは「次に起動したとき」を鳴らし、サイトの引き金は時刻が過ぎていても鳴らさない', async () => {
    io.reads.set('reminders.json', [rem('s', { dueAt: NOW + MAX_AHEAD_MS, trigger: { kind: 'startup' } }), site('w', 'example.com'), rem('t', { dueAt: NOW - 1 })]);
    const fired: string[] = [];
    const lateOf = new Map<string, boolean>();
    const store = await started((r, late) => {
      fired.push(r.id);
      lateOf.set(r.id, late);
    });
    expect(fired.sort()).toEqual(['s', 't']);
    expect(Object.fromEntries(lateOf)).toEqual({ s: false, t: true }); // 引き金のものは遅れではない
    expect(store.list().map((r) => r.id)).toEqual(['w']);
    await vi.advanceTimersByTimeAsync(10_000); // 5 秒ごとの見回りでも、サイトの引き金は鳴らない
    expect(fired.sort()).toEqual(['s', 't']);
  });

  it('サイトを開いたら、そのホストの引き金だけを 1 度鳴らす（記録に「鳴った」）', async () => {
    io.reads.set('reminders.json', [site('a', 'example.com'), site('b', 'other.com')]);
    const fired: string[] = [];
    const store = await started((r) => fired.push(r.id));
    store.checkSite('example.com');
    expect(fired).toEqual(['a']);
    expect(store.list().map((r) => r.id)).toEqual(['b']);
    expect(store.firedList()[0]).toMatchObject({ id: 'a', state: 'fired', trigger: { kind: 'site', host: 'example.com' } });
    store.checkSite('example.com');
    expect(fired).toEqual(['a']);
  });

  it('鳴る前に済ませた引き金は繰り返さない', async () => {
    const store = await started(); // 起動で鳴らさないよう、読み込みのあとに足す
    store.add(rem('a', { trigger: { kind: 'startup' }, repeat: 'daily', dueAt: NOW + MAX_AHEAD_MS }));
    store.done('a');
    expect(store.list()).toEqual([]);
    expect(store.firedList()[0]).toMatchObject({ id: 'a', state: 'done' });
  });
});
