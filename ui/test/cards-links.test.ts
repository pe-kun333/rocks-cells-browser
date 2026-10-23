// リンクと画像（K6）：複数のリンクの読み書き・古い link との往復・指す画像・セルからの逆引き・このページのカード
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

import { cardLinks, cardsLinkedTo, cardsOnPage, MAX_LINKS, parseCard, parseCardLinks, parseImage, type VocabCard, VocabStore } from '../src/vocab';

const card = (id: string, over: Partial<VocabCard> = {}): VocabCard => ({ id, kind: 'word', front: `f-${id}`, back: 'b', createdAt: 1, level: 1, due: 1, reviews: 0, lapses: 0, ...over });

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

async function loaded(cards: VocabCard[]) {
  io.file = { version: 1, notify: true, notifiedDay: '', cards };
  const store = new VocabStore();
  await store.load();
  return store;
}

describe('リンクの並び', () => {
  it('読めないもの・同じセルの二つ目を捨て、役目は出典・関連だけ、6 つまで', () => {
    const raw = [
      { kind: 'memo', id: 'm1', role: 'source' },
      { kind: 'memo', id: 'm1', role: 'related' }, // 同じセル
      { kind: 'tab', id: 3, url: 'https://example.com/', role: 'other' }, // 役目は捨てる
      { kind: 'tab', id: -1 }, // 読めない
      ...Array.from({ length: 8 }, (_, i) => ({ kind: 'memo', id: `m${i + 2}` })),
    ];
    const links = parseCardLinks(raw)!;
    expect(links).toHaveLength(MAX_LINKS);
    expect(links[0]).toEqual({ kind: 'memo', id: 'm1', role: 'source' });
    expect(links[1]).toEqual({ kind: 'tab', id: 3, url: 'https://example.com/' });
    expect(parseCardLinks([])).toBeUndefined();
    expect(parseCardLinks('x')).toBeUndefined();
  });

  it('links が無ければ古い link を 1 つとして読む', () => {
    expect(cardLinks(card('a', { link: { kind: 'memo', id: 'm1' } }))).toEqual([{ kind: 'memo', id: 'm1' }]);
    expect(cardLinks(card('a'))).toEqual([]);
  });

  it('並びを入れかえると、link には先頭を役目なしで写す（古い版のため）。空なら両方外す', async () => {
    const store = await loaded([card('a', { link: { kind: 'memo', id: 'm0' } })]);
    store.setLinks('a', [
      { kind: 'tab', id: 2, url: 'https://example.com/a', role: 'source' },
      { kind: 'memo', id: 'm1', role: 'related' },
    ]);
    let a = store.snapshot().cards[0];
    expect(a.links).toHaveLength(2);
    expect(a.link).toEqual({ kind: 'tab', id: 2, url: 'https://example.com/a' });
    store.setLinks('a', []);
    a = store.snapshot().cards[0];
    expect(a).not.toHaveProperty('links');
    expect(a).not.toHaveProperty('link');
  });

  it('古い命令（1 つの link）は並びを 1 つにする', async () => {
    const store = await loaded([card('a', { links: [{ kind: 'memo', id: 'm1' }, { kind: 'memo', id: 'm2' }], link: { kind: 'memo', id: 'm1' } })]);
    store.setLink('a', { kind: 'memo', id: 'm9' });
    expect(cardLinks(store.snapshot().cards[0])).toEqual([{ kind: 'memo', id: 'm9' }]);
    store.setLink('a', null);
    expect(cardLinks(store.snapshot().cards[0])).toEqual([]);
  });

  it('入れるときの並び（無ければ link）と、parseCard の往復', async () => {
    const store = await loaded([]);
    store.add([
      { kind: 'word', front: 'x', back: 'y', links: [{ kind: 'memo', id: 'm1', role: 'source' }], image: { kind: 'shot', id: 'shot1' } },
      { kind: 'word', front: 'z', back: 'w', link: { kind: 'memo', id: 'm2' } },
    ]);
    const [x, z] = store.snapshot().cards;
    expect(x).toMatchObject({ links: [{ kind: 'memo', id: 'm1', role: 'source' }], link: { kind: 'memo', id: 'm1' }, image: { kind: 'shot', id: 'shot1' } });
    expect(z).toMatchObject({ links: [{ kind: 'memo', id: 'm2' }], link: { kind: 'memo', id: 'm2' } });
    expect(parseCard(JSON.parse(JSON.stringify(x)))).toMatchObject({ links: x.links, image: x.image });
  });
});

describe('指す画像', () => {
  it('撮影か shots の id だけ。id は英数字と - _', () => {
    expect(parseImage({ kind: 'capture', id: 'cap-1' })).toEqual({ kind: 'capture', id: 'cap-1' });
    expect(parseImage({ kind: 'shot', id: '../x' })).toBeUndefined();
    expect(parseImage({ kind: 'file', id: 'a' })).toBeUndefined();
  });

  it('付ける・外す（null）。読めない値では変えない', async () => {
    const store = await loaded([card('a')]);
    store.update('a', { image: { kind: 'shot', id: 'shot9' } });
    expect(store.snapshot().cards[0].image).toEqual({ kind: 'shot', id: 'shot9' });
    store.update('a', { image: { kind: 'bad', id: 'x' } as never });
    expect(store.snapshot().cards[0].image).toEqual({ kind: 'shot', id: 'shot9' });
    store.update('a', { image: null });
    expect(store.snapshot().cards[0]).not.toHaveProperty('image');
  });
});

describe('逆引き', () => {
  const cards = [
    card('m', { links: [{ kind: 'memo', id: 'm1' }] }),
    card('tu', { link: { kind: 'tab', id: 9, url: 'https://example.com/a#x' } }), // 番号は古いが同じページ
    card('ti', { link: { kind: 'tab', id: 5 } }), // URL の無い古いリンクは番号で
    card('src', { source: { url: 'https://example.com/a', title: 'A' } }),
  ];

  it('セルを指すカード：メモは id、タブは URL があれば同じページ、無ければ番号', () => {
    expect(cardsLinkedTo(cards, { kind: 'memo', id: 'm1' }).map((c) => c.id)).toEqual(['m']);
    expect(cardsLinkedTo(cards, { kind: 'tab', id: 2, url: 'https://example.com/a' }).map((c) => c.id)).toEqual(['tu']);
    expect(cardsLinkedTo(cards, { kind: 'tab', id: 5, url: 'https://other.com/' }).map((c) => c.id)).toEqual(['ti']);
  });

  it('このページから作ったカード：出典が同じページ', () => {
    expect(cardsOnPage(cards, 'https://example.com/a#top').map((c) => c.id)).toEqual(['src']);
    expect(cardsOnPage(cards, '')).toEqual([]);
  });
});
