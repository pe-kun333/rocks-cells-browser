// 単語帳とリマインダーの台帳の土台（K0）：知らない項目を残す・読めなかったら書かない・待つ間に足したものを残す・閉じる直前に書く
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 偽物の読み書き：名前ごとに返す答えを順に並べる（尽きたら最後のものを返し続ける）。書いたものは写して残す
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

import { ReminderStore } from '../src/reminders';
import { parseCard, VocabStore } from '../src/vocab';

const FAILED = { status: 'failed' };
const ok = (value: unknown) => ({ status: 'ok', value });
const written = (name: string) => io.writes.filter((w) => w.name === name);

const savedCard = {
  id: 'v1',
  kind: 'word',
  front: 'apple',
  back: 'りんご',
  createdAt: 1,
  level: 2,
  due: 2,
  reviews: 3,
  lapses: 0,
  rotate: true, // 新しい版が足す項目（この版では知らない）
  future: { nested: [1, 2] },
};
const vocabFile = (cards: unknown[] = [savedCard]) => ({ version: 1, notify: true, notifiedDay: '', cards });

beforeEach(() => {
  io.reads.clear();
  io.writes.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// 読み直し（3 秒）を含めて読み終える
async function loaded(store: VocabStore) {
  const loading = store.load();
  await vi.advanceTimersByTimeAsync(3000);
  await loading;
  return store;
}

async function started(store: ReminderStore) {
  const starting = store.start();
  await vi.advanceTimersByTimeAsync(3000);
  await starting;
  return store;
}

describe('parseCard', () => {
  it('知らない項目はそのまま残し、知っている項目は確かめて組み直す', () => {
    const card = parseCard({ ...savedCard, front: '  apple  ', level: 9, link: { kind: 'tab', id: -1 }, example: 5 });
    expect(card).not.toBeNull();
    const out = JSON.parse(JSON.stringify(card));
    expect(out.front).toBe('apple');
    expect(out.level).toBe(6);
    expect(out).not.toHaveProperty('link'); // 読めないリンクは捨てる
    expect(out).not.toHaveProperty('example'); // 文字でない例文は捨てる
    expect(out.rotate).toBe(true);
    expect(out.future).toEqual({ nested: [1, 2] });
  });

  it('表か裏が無ければ読まない', () => {
    expect(parseCard({ ...savedCard, back: '' })).toBeNull();
    expect(parseCard('x')).toBeNull();
  });
});

describe('VocabStore の読み書き', () => {
  it('読めた台帳は、書き直しても知らない項目が残る（往復）', async () => {
    io.reads.set('vocab.json', [ok(vocabFile())]);
    const store = await loaded(new VocabStore());
    expect(store.loadFailed).toBe(false);
    store.grade('v1', 'good');
    store.flush();
    const files = written('vocab.json');
    expect(files).toHaveLength(1);
    const card = (files[0].value as { cards: Record<string, unknown>[] }).cards[0];
    expect(card.reviews).toBe(4);
    expect(card.rotate).toBe(true);
    expect(card.future).toEqual({ nested: [1, 2] });
  });

  it('flush は待っている分だけをすぐ書く。待っている分が無ければ書かない', async () => {
    io.reads.set('vocab.json', [ok(vocabFile())]);
    const store = await loaded(new VocabStore());
    store.flush();
    expect(written('vocab.json')).toHaveLength(0);
    store.setNotify(false);
    store.flush();
    expect(written('vocab.json')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(written('vocab.json')).toHaveLength(1); // 予約していた分は消えている
  });

  it('読み直しても読めなければ書かない。写しに印が付き、足したものは見える', async () => {
    io.reads.set('vocab.json', [FAILED, FAILED]);
    const store = await loaded(new VocabStore());
    expect(store.ready).toBe(true);
    expect(store.loadFailed).toBe(true);
    expect(store.add([{ kind: 'word', front: 'pear', back: 'なし' }])).toBe(1);
    store.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(written('vocab.json')).toHaveLength(0);
    const snap = store.snapshot();
    expect(snap.readFailed).toBe(true);
    expect(snap.cards.map((c) => c.front)).toEqual(['pear']);
  });

  it('一度目に読めなくても、読み直しで読めれば書ける', async () => {
    io.reads.set('vocab.json', [FAILED, ok(vocabFile())]);
    const store = await loaded(new VocabStore());
    expect(store.loadFailed).toBe(false);
    expect(store.snapshot().readFailed).toBeUndefined();
    expect(store.snapshot().cards).toHaveLength(1);
  });

  it('知らない版・形の違う中身は、読めないと同じに扱う', async () => {
    for (const value of [{ version: 2, cards: [] }, { version: 1 }, null, [savedCard]]) {
      io.reads.set('vocab.json', [ok(value)]);
      io.writes.length = 0;
      const store = await loaded(new VocabStore());
      expect(store.loadFailed).toBe(true);
      store.setNotify(false);
      store.flush();
      expect(written('vocab.json')).toHaveLength(0);
    }
  });

  it('ファイルが無ければ空から始めて書く', async () => {
    const store = await loaded(new VocabStore());
    expect(store.loadFailed).toBe(false);
    store.add([{ kind: 'word', front: 'pear', back: 'なし' }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(written('vocab.json')).toHaveLength(1);
  });

  it('読み込みを待つ間に足したカードは残す（同じ言葉は読んだ方）', async () => {
    io.reads.set('vocab.json', [FAILED, ok(vocabFile())]);
    const store = new VocabStore();
    const loading = store.load();
    await vi.advanceTimersByTimeAsync(1000); // 読み直しを待っている間
    store.add([
      { kind: 'word', front: 'Apple', back: '別の意味' },
      { kind: 'word', front: 'pear', back: 'なし' },
    ]);
    expect(written('vocab.json')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    await loading;
    const cards = store.snapshot().cards;
    expect(cards.map((c) => `${c.front}:${c.back}`)).toEqual(['apple:りんご', 'pear:なし']);
    await vi.advanceTimersByTimeAsync(500);
    expect(written('vocab.json')).toHaveLength(1);
  });
});

describe('ReminderStore の読み書き', () => {
  const later = Date.now() + 86_400_000;
  const saved = { id: 'r1', text: '休憩', dueAt: later, createdAt: 1, by: 'companion', future: true };
  const fresh = (id: string) => ({ id, text: '水を飲む', dueAt: later, createdAt: 2 });

  it('読めた台帳は、足して書き直しても知らない項目が残る', async () => {
    io.reads.set('reminders.json', [ok([saved])]);
    const store = await started(new ReminderStore(() => {}));
    store.add(fresh('r2'));
    const files = written('reminders.json');
    expect(files).toHaveLength(1);
    expect(files[0].value).toEqual([saved, fresh('r2')]);
  });

  it('読み直しても読めなければ書かない。足したものは一覧に出る', async () => {
    io.reads.set('reminders.json', [FAILED, FAILED]);
    const store = await started(new ReminderStore(() => {}));
    expect(store.loadFailed).toBe(true);
    store.add(fresh('r2'));
    store.cancel('r2');
    store.add(fresh('r3'));
    expect(written('reminders.json')).toHaveLength(0);
    expect(store.list().map((r) => r.id)).toEqual(['r3']);
  });

  it('配列でない中身は、読めないと同じに扱う', async () => {
    io.reads.set('reminders.json', [ok({ items: [saved] })]);
    const store = await started(new ReminderStore(() => {}));
    expect(store.loadFailed).toBe(true);
    store.add(fresh('r2'));
    expect(written('reminders.json')).toHaveLength(0);
  });

  it('ファイルが無ければ空から始めて書く', async () => {
    const store = await started(new ReminderStore(() => {}));
    expect(store.loadFailed).toBe(false);
    store.add(fresh('r2'));
    expect(written('reminders.json')).toHaveLength(1);
  });

  it('読み込みを待つ間に足したものは書かずに待ち、読めたあとに一緒に書く（id が重なれば読んだ方）', async () => {
    io.reads.set('reminders.json', [FAILED, ok([saved])]);
    const store = new ReminderStore(() => {});
    const starting = store.start();
    await vi.advanceTimersByTimeAsync(1000);
    store.add({ ...fresh('r1'), text: '上書きされない' });
    store.add(fresh('r2'));
    expect(written('reminders.json')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    await starting;
    expect(store.list().map((r) => `${r.id}:${r.text}`)).toEqual(['r1:休憩', 'r2:水を飲む']);
    expect(written('reminders.json')).toHaveLength(1);
  });
});
