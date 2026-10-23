// 鳴ったあと（K3）：鳴ったものの記録・済み・取り消し・延ばした・繰り返し・書く順・読めない記録
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  reads: new Map<string, unknown[]>(),
  writes: [] as { name: string; value: unknown }[],
}));

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async (name: string) => {
    const queue = io.reads.get(name) ?? [{ status: 'missing' }];
    return queue.length > 1 ? queue.shift() : queue[0];
  },
  writeData: async (name: string, value: unknown) => {
    io.writes.push({ name, value: JSON.parse(JSON.stringify(value)) });
    return true;
  },
  deleteData: () => {},
  listData: async () => [],
}));

import { nextRepeat, repeatLabel, snoozedCopy } from '../src/reminder-when';
import { firedOf, MAX_FIRED, recordFired, ReminderStore, setFiredState } from '../src/reminders';
import type { FiredReminder, Reminder } from '../src/types';

const at = (month: number, day: number, h: number, m = 0, year = 2026) => new Date(year, month - 1, day, h, m).getTime();
const NOW = at(10, 22, 14, 0); // 2026-10-22（木）14:00
const ok = (value: unknown) => ({ status: 'ok', value });
const written = (name: string) => io.writes.filter((w) => w.name === name).map((w) => w.value);
const lastFired = () => (written('reminders-fired.json').at(-1) as { v: number; items: FiredReminder[] } | undefined)?.items;
const lastItems = () => written('reminders.json').at(-1) as Reminder[] | undefined;

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
  const starting = store.start();
  await vi.advanceTimersByTimeAsync(3000);
  await starting;
  return store;
}

describe('nextRepeat', () => {
  it('毎日・毎週は同じ時刻で、今より後の最初の回（何回過ぎていても 1 回）', () => {
    expect(nextRepeat(at(10, 22, 9), 'daily', NOW)).toBe(at(10, 23, 9));
    expect(nextRepeat(at(10, 15, 9), 'daily', NOW)).toBe(at(10, 23, 9));
    expect(nextRepeat(at(10, 22, 15), 'daily', NOW)).toBe(at(10, 23, 15));
    expect(nextRepeat(at(10, 20, 9), 'weekly', NOW)).toBe(at(10, 27, 9));
  });

  it('毎平日は土日を飛ばす', () => {
    expect(nextRepeat(at(10, 23, 9), 'weekdays', at(10, 23, 10))).toBe(at(10, 26, 9)); // 金 → 月
    expect(nextRepeat(at(10, 22, 9), 'weekdays', NOW)).toBe(at(10, 23, 9));
  });

  it('毎月は同じ日。その日が無い月は月末', () => {
    expect(nextRepeat(at(10, 22, 9), 'monthly', NOW)).toBe(at(11, 22, 9));
    expect(nextRepeat(at(1, 31, 9), 'monthly', at(1, 31, 10))).toBe(at(2, 28, 9));
  });

  it('名前', () => {
    expect(repeatLabel('weekdays')).toBe('毎平日');
  });
});

describe('記録の形', () => {
  it('新しいものを先頭に、同じ id は一つ、50 件まで', () => {
    let list: FiredReminder[] = [];
    for (let i = 0; i < MAX_FIRED + 5; i++) list = recordFired(list, firedOf(rem(`r${i}`), 'fired', NOW + i));
    expect(list).toHaveLength(MAX_FIRED);
    expect(list[0].id).toBe(`r${MAX_FIRED + 4}`);
    list = recordFired(list, firedOf(rem('r10'), 'done', NOW + 100));
    expect(list.filter((f) => f.id === 'r10')).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'r10', state: 'done' });
    expect(setFiredState(list, 'r10', 'snoozed')[0].state).toBe('snoozed');
  });

  it('古い tabId は指す先に読み替え、置いた人の無いものは相棒', () => {
    expect(firedOf(rem('a', { tabId: 7, title: '題' }), 'fired', NOW)).toMatchObject({ link: { kind: 'tab', id: 7 }, by: 'companion', title: '題' });
  });

  it('延ばした写しは繰り返しを持たず、元の id を持つ', () => {
    const copy = snoozedCopy(rem('a', { repeat: 'daily', by: 'user' }), NOW + 600_000, NOW);
    expect(copy).not.toHaveProperty('repeat');
    expect(copy).toMatchObject({ snoozedFrom: 'a', by: 'user', dueAt: NOW + 600_000 });
  });
});

describe('ReminderStore の鳴ったあと', () => {
  it('鳴ったら記録を先に書き、台帳から外す。繰り返しは同じ id で次の回に置き直す', async () => {
    io.reads.set('reminders.json', [ok([rem('once', { dueAt: NOW - 60_000 }), rem('daily', { dueAt: at(10, 20, 9), repeat: 'daily' }), rem('later')])]);
    const fired: string[] = [];
    const store = await started((r) => fired.push(r.id));
    expect(fired.sort()).toEqual(['daily', 'once']);
    const order = io.writes.map((w) => w.name);
    expect(order.indexOf('reminders-fired.json')).toBeLessThan(order.indexOf('reminders.json'));
    expect(lastFired()?.map((f) => `${f.id}:${f.state}`).sort()).toEqual(['daily:fired', 'once:fired']);
    expect(lastItems()?.map((r) => r.id).sort()).toEqual(['daily', 'later']);
    expect(store.list().find((r) => r.id === 'daily')?.dueAt).toBe(at(10, 23, 9));
  });

  it('取り消すと「取り消した」を記録し、同じ id で置き直す（元に戻す）と記録を外す', async () => {
    io.reads.set('reminders.json', [ok([rem('a')])]);
    const store = await started();
    store.cancel('a');
    expect(store.list()).toEqual([]);
    expect(store.firedList()[0]).toMatchObject({ id: 'a', state: 'cancelled' });
    store.add(rem('a'));
    expect(store.firedList()).toEqual([]);
    expect(store.list().map((r) => r.id)).toEqual(['a']);
  });

  it('まだ鳴っていないものを済ませる：ふつうは外し、繰り返しは次の回へ進める', async () => {
    io.reads.set('reminders.json', [ok([rem('a'), rem('b', { dueAt: at(10, 22, 18), repeat: 'weekly' })])]);
    const store = await started();
    store.done('a');
    store.done('b');
    expect(store.list().map((r) => `${r.id}:${r.dueAt}`)).toEqual([`b:${at(10, 29, 18)}`]);
    expect(store.firedList().map((f) => `${f.id}:${f.state}`).sort()).toEqual(['a:done', 'b:done']);
  });

  it('鳴ったものの記録を済みにする（台帳は触らない）。延ばした写しを置くと、元の記録は「延ばした」', async () => {
    io.reads.set('reminders.json', [ok([rem('a', { dueAt: NOW - 1 }), rem('r', { dueAt: NOW - 1, repeat: 'daily' })])]);
    const store = await started();
    store.done('r', true); // 繰り返しの次の回は台帳に残る
    expect(store.list().map((r) => r.id)).toEqual(['r']);
    expect(store.firedList().find((f) => f.id === 'r')?.state).toBe('done');
    store.add(snoozedCopy(store.firedList().find((f) => f.id === 'a') as unknown as Reminder, NOW + 600_000, NOW));
    expect(store.firedList().find((f) => f.id === 'a')?.state).toBe('snoozed');
    const copy = store.list().find((r) => r.id !== 'r');
    expect(copy).toBeDefined();
    expect(copy).not.toHaveProperty('snoozedFrom'); // 台帳には残さない
  });

  it('記録が読めなければ書かない（鳴らすのは続ける）。知らない版も読めないと同じ', async () => {
    io.reads.set('reminders.json', [ok([rem('a', { dueAt: NOW - 1 })])]);
    io.reads.set('reminders-fired.json', [ok({ v: 2, items: [] })]);
    const fired: string[] = [];
    const store = await started((r) => fired.push(r.id));
    expect(fired).toEqual(['a']);
    expect(store.firedFailed).toBe(true);
    expect(written('reminders-fired.json')).toHaveLength(0);
    expect(store.firedList()[0]).toMatchObject({ id: 'a', state: 'fired' }); // この起動の間は見える
  });

  it('読めた記録はそのまま使い、新しい順にする', async () => {
    const old = { id: 'x', text: '前の', dueAt: 1, firedAt: 5, state: 'done' };
    const newer = { id: 'y', text: '後の', dueAt: 1, firedAt: 9, state: 'fired' };
    io.reads.set('reminders-fired.json', [ok({ v: 1, items: [old, newer, { id: 3 }] })]);
    const store = await started();
    expect(store.firedFailed).toBe(false);
    expect(store.firedList().map((f) => f.id)).toEqual(['y', 'x']);
  });
});
