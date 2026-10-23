// めぐる表示の印（K1）：カードの rotate、updateCard の付け外し、粒の絞り、今日はもう出さない・あとで・月の欠け
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ file: null as unknown, writes: [] as unknown[] }));

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async () => (io.file === null ? { status: 'missing' } : { status: 'ok', value: io.file }),
  writeData: async (_name: string, value: unknown) => {
    io.writes.push(JSON.parse(JSON.stringify(value)));
    return true;
  },
  deleteData: () => {},
  listData: async () => [],
}));

import { buildRotateSlots, cleanRotatePrefs, grainCards, MOON_PREFS_KEY, savedMarkNew } from '../src/rotate';
import { cleanSnooze, emptySnooze, hiddenIds, moonLit, ripeIds, skipToday, snoozeLater, takeRipe, withDayStart } from '../src/rotate-snooze';
import { parseCard, type VocabCard, VocabStore } from '../src/vocab';

const NOW = new Date(2026, 9, 22, 14, 0, 0).getTime();
const DAY = 24 * 60 * 60_000;

function card(id: string, over: Partial<VocabCard> = {}): VocabCard {
  return { id, kind: 'word', front: `f-${id}`, back: `b-${id}`, createdAt: 1, level: 2, due: NOW + DAY, reviews: 1, lapses: 0, ...over };
}

beforeEach(() => {
  io.file = null;
  io.writes.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('カードの印 rotate', () => {
  it('parseCard は true だけを印として読み、ほかは項目ごと書かない', () => {
    expect(parseCard(card('a', { rotate: true }))?.rotate).toBe(true);
    const out = JSON.parse(JSON.stringify(parseCard({ ...card('b'), rotate: 'yes' })));
    expect(out).not.toHaveProperty('rotate');
  });

  it('updateCard の rotate は印だけを付け外しし、表と裏は変えない。入れるときにも付けられる', async () => {
    io.file = { version: 1, notify: true, notifiedDay: '', cards: [card('a', { example: '例' })] };
    const store = new VocabStore();
    await store.load();
    store.update('a', { rotate: true });
    store.flush();
    expect((io.writes.at(-1) as { cards: VocabCard[] }).cards[0]).toMatchObject({ front: 'f-a', back: 'b-a', example: '例', rotate: true });
    store.update('a', { front: undefined, back: undefined, example: undefined, rotate: false });
    store.flush();
    expect((io.writes.at(-1) as { cards: VocabCard[] }).cards[0]).not.toHaveProperty('rotate');
    const writes = io.writes.length;
    store.update('a', { rotate: false }); // 変わらなければ書かない
    store.flush();
    expect(io.writes).toHaveLength(writes);
    store.add([{ kind: 'word', front: 'new', back: '新', rotate: true }, { kind: 'word', front: 'plain', back: '並' }]);
    const cards = store.snapshot().cards;
    expect(cards.find((c) => c.front === 'new')?.rotate).toBe(true);
    expect(cards.find((c) => c.front === 'plain')).not.toHaveProperty('rotate');
  });

  it('表と裏が来たときは今までどおり直し、例文が来なければ消す', async () => {
    io.file = { version: 1, notify: true, notifiedDay: '', cards: [card('a', { example: '例', rotate: true })] };
    const store = new VocabStore();
    await store.load();
    store.update('a', { front: ' 新しい表 ', back: '新しい裏', example: undefined });
    const a = store.snapshot().cards[0];
    expect(a).toMatchObject({ front: '新しい表', back: '新しい裏', rotate: true });
    expect(a.example).toBeUndefined();
  });
});

describe('月の窓の設定', () => {
  it('grain と markNew の既定と、読めない値', () => {
    expect(cleanRotatePrefs(undefined)).toMatchObject({ grain: 'all', markNew: false });
    expect(cleanRotatePrefs({ grain: 'marked', markNew: true })).toMatchObject({ grain: 'marked', markNew: true });
    expect(cleanRotatePrefs({ grain: 'some', markNew: 'yes' })).toMatchObject({ grain: 'all', markNew: false });
  });

  it('savedMarkNew は月の窓の設定の置き場を読む（読めなければ付けない）', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    expect(savedMarkNew()).toBe(false);
    store.set(MOON_PREFS_KEY, JSON.stringify({ rotate: { markNew: true } }));
    expect(savedMarkNew()).toBe(true);
    store.set(MOON_PREFS_KEY, '{壊れた');
    expect(savedMarkNew()).toBe(false);
  });
});

describe('粒の絞り', () => {
  const cards = [
    card('due', { due: NOW - 1 }),
    card('weak', { lapses: 2 }),
    card('mark', { rotate: true }),
    card('plain'),
  ];

  it('全部・印だけ・今日の復習と苦手だけ', () => {
    expect(grainCards(cards, 'all', NOW).map((c) => c.id)).toEqual(['due', 'weak', 'mark', 'plain']);
    expect(grainCards(cards, 'marked', NOW).map((c) => c.id)).toEqual(['mark']);
    expect(grainCards(cards, 'due', NOW).map((c) => c.id)).toEqual(['due', 'weak']);
  });

  it('buildRotateSlots は粒で絞る。印が 0 枚でもリマインダーは回る', () => {
    const reminder = { id: 'r1', text: '休憩', dueAt: NOW + 60_000, createdAt: 1 };
    const marked = buildRotateSlots(['vocab', 'reminder'], cards, [], [reminder], NOW, 'marked');
    expect(marked.slots).toEqual([
      { kind: 'vocab', id: 'mark' },
      { kind: 'reminder', id: 'r1' },
    ]);
    const none = buildRotateSlots(['vocab', 'reminder'], [card('plain')], [], [reminder], NOW, 'marked');
    expect(none.slots).toEqual([{ kind: 'reminder', id: 'r1' }]);
  });
});

describe('今日はもう出さない・あとで', () => {
  const today = '2026-10-22';

  it('日が替わると今日の分は捨て、あとでの予約は残す', () => {
    const saved = { day: '2026-10-21', ids: ['a'], later: [{ id: 'b', until: NOW + 1 }, { id: 'b', until: 0 }, { id: 3 }], dayStart: { day: '2026-10-21', count: 5 } };
    expect(cleanSnooze(saved, today)).toEqual({ day: today, ids: [], later: [{ id: 'b', until: NOW + 1 }], dayStart: null });
    expect(cleanSnooze({ ...saved, day: today, dayStart: { day: today, count: 4 } }, today)).toMatchObject({ ids: ['a'], dayStart: { day: today, count: 4 } });
    expect(cleanSnooze('x', today)).toEqual(emptySnooze(today));
  });

  it('今日はもう出さないものと、時間の来ていないあとでを隠し、時間が来たら出す', () => {
    let s = emptySnooze(today);
    s = skipToday(s, 'a', today);
    s = snoozeLater(s, 'b', NOW);
    s = snoozeLater(s, 'c', NOW - 2 * 60 * 60_000); // もう時間が来ている
    expect([...hiddenIds(s, today, NOW)].sort()).toEqual(['a', 'b']);
    expect(ripeIds(s, today, NOW)).toEqual(['c']);
    expect(ripeIds(s, today, NOW + 60 * 60_000)).toEqual(['c', 'b']);
    s = takeRipe(s, 'c');
    expect(ripeIds(s, today, NOW)).toEqual([]);
    s = skipToday(s, 'b', today); // 今日はもう出さないにすると、あとでの予約は消える
    expect(s.later).toEqual([]);
    expect(s.ids).toEqual(['a', 'b']);
  });
});

describe('月の欠け', () => {
  const today = '2026-10-22';

  it('今日の初めの枚数を覚え、日中に増えたら増やす', () => {
    let s = withDayStart(emptySnooze(today), today, 8);
    expect(s.dayStart).toEqual({ day: today, count: 8 });
    expect(withDayStart(s, today, 3)).toBe(s); // 減っても分母はそのまま（変わらなければ同じもの）
    s = withDayStart(s, today, 10);
    expect(s.dayStart).toEqual({ day: today, count: 10 });
    expect(withDayStart(s, '2026-10-23', 2).dayStart).toEqual({ day: '2026-10-23', count: 2 });
  });

  it('残りが 0 なら満月。残り ÷ 初めの枚数だけ欠ける', () => {
    expect(moonLit(0, 8)).toBe(1);
    expect(moonLit(0, 0)).toBe(1);
    expect(moonLit(2, 8)).toBe(0.75);
    expect(moonLit(8, 8)).toBe(0);
    expect(moonLit(9, 8)).toBe(0);
  });
});
