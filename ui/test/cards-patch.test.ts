// 台帳を触るカードの中身（K5b）：メモ・「次は □ 日後」・評価の元に戻す
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ file: null as unknown }));

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async () => (io.file === null ? { status: 'missing' } : { status: 'ok', value: io.file }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { cleanNote, dueInDays, NEXT_DAYS_MAX, parseCard, type VocabCard, VocabStore } from '../src/vocab';

const NOW = new Date(2026, 9, 22, 14, 0, 0).getTime();
const DAY = 24 * 60 * 60_000;
const card = (over: Partial<VocabCard> = {}): VocabCard => ({ id: 'a', kind: 'word', front: 'apple', back: 'りんご', createdAt: 1, level: 3, due: NOW + DAY, reviews: 4, lapses: 1, ...over });

beforeEach(() => {
  io.file = null;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function loaded(cards: VocabCard[]) {
  io.file = { version: 1, notify: true, notifiedDay: '', cards };
  const store = new VocabStore();
  await store.load();
  return store;
}

describe('メモ', () => {
  it('前後の空白を外し 500 字まで。空・文字でないものは無し。parseCard も同じ', () => {
    expect(cleanNote('  覚え方：林檎  ')).toBe('覚え方：林檎');
    expect([...(cleanNote('あ'.repeat(600)) ?? '')]).toHaveLength(500);
    expect(cleanNote('   ')).toBeUndefined();
    expect(cleanNote(3)).toBeUndefined();
    expect(parseCard({ ...card(), note: ' メモ ' })?.note).toBe('メモ');
    expect(JSON.parse(JSON.stringify(parseCard({ ...card(), note: '' })))).not.toHaveProperty('note');
  });

  it('入れるときのメモ、直す（空なら消す）。表と裏は変えない', async () => {
    const store = await loaded([card()]);
    store.add([{ kind: 'word', front: 'pear', back: 'なし', note: ' 秋の果物 ' }]);
    expect(store.snapshot().cards.find((c) => c.front === 'pear')?.note).toBe('秋の果物');
    store.update('a', { note: '赤い' });
    expect(store.snapshot().cards[0]).toMatchObject({ front: 'apple', back: 'りんご', note: '赤い' });
    store.update('a', { note: '' });
    expect(store.snapshot().cards[0]).not.toHaveProperty('note');
  });
});

describe('「次は □ 日後」', () => {
  it('1〜365 日の整数にそろえる', () => {
    expect(dueInDays(3, NOW)).toBe(NOW + 3 * DAY);
    expect(dueInDays(0, NOW)).toBe(NOW + DAY);
    expect(dueInDays(2.6, NOW)).toBe(NOW + 3 * DAY);
    expect(dueInDays(9999, NOW)).toBe(NOW + NEXT_DAYS_MAX * DAY);
    expect(dueInDays(Number.NaN, NOW)).toBe(NOW + DAY);
  });

  it('時期だけを変え、度合いは変えない', async () => {
    const store = await loaded([card()]);
    store.update('a', { due: dueInDays(10, NOW) });
    expect(store.snapshot().cards[0]).toMatchObject({ due: NOW + 10 * DAY, level: 3, reviews: 4 });
  });
});

describe('評価の元に戻す', () => {
  it('評価のあとに、前の時期・度合い・回数へ戻せる', async () => {
    const store = await loaded([card()]);
    const before = { ...store.snapshot().cards[0] };
    store.grade('a', 'again');
    expect(store.snapshot().cards[0]).toMatchObject({ level: 1, reviews: 5, lapses: 2 });
    store.update('a', { due: before.due, level: before.level, reviews: before.reviews, lapses: before.lapses });
    expect(store.snapshot().cards[0]).toMatchObject({ due: before.due, level: 3, reviews: 4, lapses: 1 });
  });

  it('読めない値（範囲の外・小数・数でない）は使わない', async () => {
    const store = await loaded([card()]);
    store.update('a', { level: 7, reviews: -1, lapses: 1.5, due: Number.NaN });
    expect(store.snapshot().cards[0]).toMatchObject({ level: 3, reviews: 4, lapses: 1, due: NOW + DAY });
  });
});
