import { describe, expect, it } from 'vitest';

import { MAX_MOVED, parseSheetUse, SheetUse } from '../src/sheet-use';
import { SheetStore } from '../src/sheets';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe('parseSheetUse', () => {
  it('壊れた値・知らない id は捨てる', () => {
    expect(parseSheetUse(null)).toEqual({ seen: {}, moved: [] });
    const s = parseSheetUse({ seen: { main: 5, 'bad id': 3, sha: -1, shb: 'x', shc: 9 }, moved: ['sha', 'sha', 'nope!', 'shb', 'shc', 'shd'] });
    expect(s.seen).toEqual({ main: 5, shc: 9 });
    expect(s.moved).toEqual(['sha', 'shb', 'shc'].slice(0, MAX_MOVED));
  });
});

describe('SheetUse', () => {
  it('起動し直しても、見た時刻と移した先が残る', () => {
    const store = memory();
    const a = new SheetUse(store);
    a.markSeen('sha', 100);
    a.markMoved('shb');
    a.markMoved('shc');
    a.markMoved('shb');
    const b = new SheetUse(store);
    expect(b.seenAt('sha')).toBe(100);
    expect(b.moved(() => true)).toEqual(['shb', 'shc']);
    expect(b.moved((id) => id !== 'shb')).toEqual(['shc']);
  });

  it('prune で消えたシートを外す', () => {
    const store = memory();
    const a = new SheetUse(store);
    a.markSeen('sha', 1);
    a.markSeen('shb', 2);
    a.markMoved('sha');
    a.prune((id) => id === 'shb');
    const b = new SheetUse(store);
    expect(b.seenAt('sha')).toBeUndefined();
    expect(b.seenAt('shb')).toBe(2);
    expect(b.moved(() => true)).toEqual([]);
  });
});

describe('SheetStore.recent と最後に見た時刻', () => {
  it('起動し直した直後でも、見た時刻の新しい順（今のシートが先頭。見ていないシートは台帳の順で後ろ）', () => {
    const store = new SheetStore();
    store.replaceAll(
      [
        { id: 'main', name: 'メイン', color: '#d9891a', createdAt: 0 },
        { id: 'sha', name: 'A', color: '#2a9d8f', createdAt: 1 },
        { id: 'shb', name: 'B', color: '#2a9d8f', createdAt: 2 },
        { id: 'shc', name: 'C', color: '#2a9d8f', createdAt: 3 },
      ],
      'main',
    );
    const seen: Record<string, number> = { shc: 30, sha: 10 };
    store.setSeenSource((id) => seen[id]);
    expect(store.recent().map((s) => s.id)).toEqual(['main', 'shc', 'sha', 'shcaptures', 'shb']);
  });

  it('見た時刻が無いときは、今までどおり（今 → 戻る順 → 台帳の順）', () => {
    const store = new SheetStore();
    const a = store.add('A') as { id: string };
    const b = store.add('B') as { id: string };
    store.setCurrent(a.id);
    store.setCurrent(b.id);
    expect(store.recent().map((s) => s.id).slice(0, 3)).toEqual([b.id, a.id, 'main']);
  });
});
