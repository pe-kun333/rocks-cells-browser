// カードを別のメモへ移す・写す（計算と、台帳の 1 回の書き込み・元に戻す）
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async (name: string) => (name === 'memocells.json' ? { status: 'ok', value: { version: 1, memos: [] } } : { status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { linkedClosure, linkTravel, rangeIds, sendCards, sendWarning } from '../src/memo-card-send';
import { MemoStore } from '../src/memocells';
import { MAX_REPLIES, orderedTops, type Reply } from '../src/threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function card(partial: Partial<Reply> & Pick<Reply, 'id' | 'text' | 'createdAt'>): Reply {
  return { parent: null, ...partial };
}

const ids = () => {
  let n = 0;
  return () => `n${(n++).toString(36)}`;
};

describe('カードを別のメモへ送る計算', () => {
  it('移すと、返信とタグが送り先の最後に付き、元からは消え、id は新しくなる', () => {
    const from = [
      card({ id: 'a', text: '甲', createdAt: 1, tags: ['考察'], image: 'shotabc', quote: { text: '引用', url: 'https://example.com/a', title: '頁' } }),
      { id: 'a1', parent: 'a', text: '返事', createdAt: 2 },
      card({ id: 'b', text: '乙', createdAt: 3, links: [{ to: 'a', kind: 'next' as const }] }),
    ];
    const to = [card({ id: 'd', text: '先', createdAt: 10, rank: 0 }), card({ id: 'e', text: '次', createdAt: 11, rank: 5 })];
    const before = structuredClone(from);
    const done = sendCards({ from, to, ids: ['a'], mode: 'move', newId: ids() });
    expect(from).toEqual(before);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.from.map((r) => r.id)).toEqual(['b']);
    expect(done.from[0].links).toBeUndefined();
    expect(orderedTops(done.to).map((r) => r.text)).toEqual(['先', '次', '甲']);
    const moved = orderedTops(done.to)[2];
    expect(moved.id).not.toBe('a');
    expect(moved.rank).toBeUndefined();
    expect(moved.tags).toEqual(['考察']);
    expect(moved.image).toBe('shotabc');
    expect(moved.quote?.title).toBe('頁');
    expect(moved.createdAt).toBeGreaterThan(11);
    const child = done.to.find((r) => r.text === '返事');
    expect(child?.parent).toBe(moved.id);
    expect(child?.id).not.toBe('a1');
    expect(done.cut).toBe(1);
    expect(done.added).toBe(2);
  });

  it('写すと元の関連は残り、写しは一緒に送ったカード同士の関連だけを持つ', () => {
    const from = [
      card({ id: 'a', text: '甲', createdAt: 1, links: [{ to: 'b', kind: 'ground' as const }, { to: 'c', kind: 'ask' as const }] }),
      card({ id: 'b', text: '乙', createdAt: 2, links: [{ to: 'a', kind: 'counter' as const }] }),
      card({ id: 'c', text: '丙', createdAt: 3 }),
    ];
    const before = structuredClone(from);
    const done = sendCards({ from, to: [], ids: ['b', 'a'], mode: 'copy', newId: ids() });
    expect(from).toEqual(before);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.from).toEqual(from);
    expect(orderedTops(done.to).map((r) => r.text)).toEqual(['甲', '乙']);
    const copyA = orderedTops(done.to)[0];
    const copyB = orderedTops(done.to)[1];
    expect(copyA.links).toEqual([{ to: copyB.id, kind: 'ground' }]);
    expect(copyB.links).toEqual([{ to: copyA.id, kind: 'counter' }]);
    expect(done.cut).toBe(1);
    expect(done.kept).toBe(2);
    expect(linkTravel(from, ['a', 'b'])).toMatchObject({ cut: 1, kept: 2, partners: ['c'] });
  });

  it('一緒に送った「同じ」は一本にし、残るカードとの関連は切る本数を数える', () => {
    const from = [
      card({ id: 'a', text: '甲', createdAt: 1, links: [{ to: 'b', kind: 'same' as const }] }),
      card({ id: 'b', text: '乙', createdAt: 2, links: [{ to: 'a', kind: 'same' as const }, { to: 'c', kind: 'next' as const }] }),
      card({ id: 'c', text: '丙', createdAt: 3, links: [{ to: 'a', kind: 'ask' as const }] }),
    ];
    const done = sendCards({ from, to: [card({ id: 'd', text: '先', createdAt: 9 })], ids: ['a', 'b'], mode: 'move', newId: ids() });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const tops = orderedTops(done.to);
    expect(tops.map((r) => r.text)).toEqual(['先', '甲', '乙']);
    const links = tops.flatMap((r) => r.links ?? []);
    expect(links).toHaveLength(1);
    expect(links[0].kind).toBe('same');
    expect(done.cut).toBe(2);
    expect(done.from.map((r) => r.id)).toEqual(['c']);
    expect(done.from[0].links).toBeUndefined();
  });

  it('送り先の件数を超えるときは、どちらも変えない', () => {
    const to = Array.from({ length: MAX_REPLIES - 1 }, (_, i) => card({ id: `d${i}`, text: `先${i}`, createdAt: i + 1 }));
    const from = [card({ id: 'a', text: '甲', createdAt: 1 }), { id: 'a1', parent: 'a', text: '返事', createdAt: 2 }];
    const done = sendCards({ from, to, ids: ['a'], mode: 'move', newId: ids() });
    expect(done).toEqual({ ok: false, why: 'full', room: 1, need: 2 });
  });

  it('一番上でない id や空は断る', () => {
    const from = [card({ id: 'a', text: '甲', createdAt: 1 }), { id: 'a1', parent: 'a', text: '返事', createdAt: 2 }];
    expect(sendCards({ from, to: [], ids: ['a1'], mode: 'copy' }).ok).toBe(false);
    expect(sendCards({ from, to: [], ids: [], mode: 'move' })).toEqual({ ok: false, why: 'empty' });
    expect(sendCards({ from, to: [], ids: ['無い'], mode: 'move' })).toEqual({ ok: false, why: 'missing' });
  });

  it('つながっているカードと、Shift の範囲', () => {
    const replies = [
      card({ id: 'a', text: '甲', createdAt: 1, links: [{ to: 'b', kind: 'next' as const }] }),
      card({ id: 'b', text: '乙', createdAt: 2, links: [{ to: 'c', kind: 'ground' as const }] }),
      card({ id: 'c', text: '丙', createdAt: 3 }),
      card({ id: 'd', text: '丁', createdAt: 4 }),
    ];
    expect(linkedClosure(replies, ['c'])).toEqual(['a', 'b', 'c']);
    expect(linkedClosure(replies, ['d'])).toEqual(['d']);
    expect(rangeIds(['a', 'b', 'c', 'd'], 'c', 'a')).toEqual(['a', 'b', 'c']);
    expect(rangeIds(['a', 'b'], 'z', 'a')).toEqual(['a']);
    expect(sendWarning('move', 2, 1)).toBe('関連 2 本が切れます。残る関連の呼び名は、送り先のメモの呼称に従います');
    expect(sendWarning('copy', 2, 0)).toBe('写しには、残るカードとの関連 2 本は入りません');
    expect(sendWarning('move', 0, 3)).toBeNull();
  });
});

describe('台帳への送りと元に戻す', () => {
  async function store() {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const memos = new MemoStore();
    await memos.load();
    return memos;
  }

  const sample = [
    card({ id: 'a', text: '甲', createdAt: 1, tags: ['考察'] }),
    { id: 'a1', parent: 'a', text: '返事', createdAt: 2 },
    card({ id: 'b', text: '乙', createdAt: 3 }),
  ];

  it('移すと 1 回で両方変わり、元に戻すと返信が戻る。そのあとに書き直すと戻せない', async () => {
    const memos = await store();
    const from = memos.add({ pos: { q: 0, r: 0 }, text: '元', replies: sample });
    const to = memos.add({ pos: { q: 1, r: 0 }, text: '先' });
    expect(from && to).toBeTruthy();
    if (!from || !to) return;
    const moved = memos.sendReplies({ fromId: from.id, replyIds: ['a'], toId: to.id, mode: 'move' });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(memos.get(from.id)?.replies?.map((r) => r.text)).toEqual(['乙']);
    const destTops = orderedTops(memos.get(to.id)?.replies ?? []);
    expect(destTops.map((r) => r.text)).toEqual(['甲']);
    expect(destTops[0].tags).toEqual(['考察']);
    expect(destTops[0].id).not.toBe('a');
    const child = memos.get(to.id)?.replies?.find((r) => r.text === '返事');
    expect(child?.parent).toBe(destTops[0].id);
    expect(memos.undoSend('違う')).toEqual({ ok: false, why: 'none' });
    expect(memos.undoSend(moved.token)).toEqual({ ok: true });
    expect(memos.get(from.id)?.replies?.map((r) => r.id)).toEqual(['a', 'a1', 'b']);
    expect(memos.get(to.id)?.replies ?? []).toEqual([]);
    expect(memos.undoSend(moved.token)).toEqual({ ok: false, why: 'none' });

    const again = memos.sendReplies({ fromId: from.id, replyIds: ['a'], toId: to.id, mode: 'copy' });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const copied = orderedTops(memos.get(to.id)?.replies ?? [])[0];
    expect(memos.editReply(to.id, copied.id, '書き直した')).toBe(true);
    expect(memos.undoSend(again.token)).toEqual({ ok: false, why: 'stale' });
    expect(memos.get(from.id)?.replies?.some((r) => r.id === 'a')).toBe(true);
  });

  it('新しいメモへ移し、元に戻すとそのメモを消す。いっぱい・同じメモ・入口は断る', async () => {
    const memos = await store();
    const from = memos.add({ pos: { q: 0, r: 0 }, text: '元', replies: sample });
    const portal = memos.add({ pos: { q: 2, r: 0 }, text: '', portal: 'shabc' });
    expect(from && portal).toBeTruthy();
    if (!from || !portal) return;
    const made = memos.sendReplies({
      fromId: from.id,
      replyIds: ['b', 'a'],
      toId: null,
      mode: 'move',
      create: { pos: { q: 3, r: 0 }, text: '' },
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.created).toBe(true);
    expect(orderedTops(memos.get(made.toId)?.replies ?? []).map((r) => r.text)).toEqual(['甲', '乙']);
    expect(memos.get(from.id)?.replies ?? []).toEqual([]);
    expect(memos.undoSend(made.token).ok).toBe(true);
    expect(memos.get(made.toId)).toBeUndefined();
    expect(memos.get(from.id)?.replies?.map((r) => r.text)).toEqual(['甲', '返事', '乙']);

    const fullTo = memos.add({
      pos: { q: 4, r: 0 },
      text: '満',
      replies: Array.from({ length: MAX_REPLIES }, (_, i) => card({ id: `f${i}`, text: `満${i}`, createdAt: i + 1 })),
    });
    expect(fullTo).toBeTruthy();
    if (!fullTo) return;
    const refused = memos.sendReplies({ fromId: from.id, replyIds: ['a'], toId: fullTo.id, mode: 'copy' });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.why).toBe('full');
    expect(memos.get(from.id)?.replies?.some((r) => r.id === 'a')).toBe(true);
    expect(memos.sendReplies({ fromId: from.id, replyIds: ['a'], toId: from.id, mode: 'move' })).toMatchObject({ ok: false, why: 'same' });
    expect(memos.sendReplies({ fromId: from.id, replyIds: ['a'], toId: portal.id, mode: 'move' })).toMatchObject({ ok: false, why: 'to' });
    expect(memos.sendReplies({ fromId: portal.id, replyIds: ['a'], toId: fullTo.id, mode: 'copy' })).toMatchObject({ ok: false, why: 'from' });
  });
});
