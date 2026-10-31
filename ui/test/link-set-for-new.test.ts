// 新しいメモの呼称セット：直前に開いていたメモのセット。カードを新しいメモへ送るときは送り元。消えたセットは既定。既存のメモは変えない
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async (name: string) => (name === 'memocells.json' ? { status: 'ok', value: { version: 1, memos: [] } } : { status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { MAX_LINK_NAME_SETS, type LinkNameBook } from '../src/link-name-sets';
import { linkNameBookOfIds, linkSetForNewMemo, rememberedLinkSet } from '../src/link-set-for-new';
import { MemoStore, parseMemo } from '../src/memocells';
import type { Reply } from '../src/threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const book: LinkNameBook = {
  version: 1,
  sets: [
    { id: 'nread', name: '読書', names: { ground: '引用元' } },
    { id: 'nsrc', name: '送り元', names: { next: '次の章' } },
    { id: 'nplain', name: 'そのまま', names: {} },
  ],
};

const card = (partial: Partial<Reply> & Pick<Reply, 'id' | 'text'>): Reply => ({ parent: null, createdAt: 1, ...partial });

describe('付ける id', () => {
  it('直前のセットが台帳にあればそれを、選んでいなければ付けない', () => {
    expect(linkSetForNewMemo({ book, remembered: 'nread' })).toBe('nread');
    expect(linkSetForNewMemo({ book, remembered: 'nplain' })).toBe('nplain');
    expect(linkSetForNewMemo({ book, remembered: null })).toBeUndefined();
    expect(linkSetForNewMemo({ book, remembered: '' })).toBeUndefined();
  });

  it('台帳から消えたセット・壊れた id・空の台帳・まだ知らない台帳は、既定（付けない）', () => {
    const snapshot = JSON.parse(JSON.stringify(book)) as LinkNameBook;
    expect(linkSetForNewMemo({ book, remembered: 'ngone' })).toBeUndefined();
    expect(linkSetForNewMemo({ book, remembered: '壊れた id' })).toBeUndefined();
    expect(linkSetForNewMemo({ book: { version: 1, sets: [] }, remembered: 'nread' })).toBeUndefined();
    expect(linkSetForNewMemo({ book: null, remembered: 'nread' })).toBeUndefined();
    expect(book).toEqual(snapshot);
  });

  it('カードを新しいメモへ送るときは送り元のセット。送り元が選んでいなければ、直前の別セットには戻さない', () => {
    const source = { linkSet: 'nsrc' as const, text: '元' };
    expect(linkSetForNewMemo({ book, source })).toBe('nsrc');
    expect(linkSetForNewMemo({ book, source: { linkSet: undefined } })).toBeUndefined();
    expect(linkSetForNewMemo({ book, source: null })).toBeUndefined();
    expect(linkSetForNewMemo({ book, source: { linkSet: 'ngone' } })).toBeUndefined();
    expect(linkSetForNewMemo({ book: null, source })).toBeUndefined();
    expect(source).toEqual({ linkSet: 'nsrc', text: '元' });
    // 同じ台帳でも、ふつうの新しいメモは直前（送り元とは別）を使う
    expect(linkSetForNewMemo({ book, remembered: 'nread' })).toBe('nread');
  });
});

describe('直前のメモ', () => {
  const sets = new Map<string, string | undefined>([
    ['open', 'nread'],
    ['open-plain', undefined],
    ['last', 'nsrc'],
    ['broken', '壊れた id'],
  ]);
  const linkSetOf = (id: string) => sets.get(id);

  it('開いていればそのメモ。セットを選んでいなければ、閉じる前のメモには戻さない', () => {
    expect(rememberedLinkSet({ openId: 'open', lastMemoId: 'last', linkSetOf })).toBe('nread');
    expect(rememberedLinkSet({ openId: 'open-plain', lastMemoId: 'last', linkSetOf })).toBeNull();
  });

  it('閉じていれば最後に開いたメモ。どちらも無ければ既定。壊れた id は既定', () => {
    expect(rememberedLinkSet({ openId: null, lastMemoId: 'last', linkSetOf })).toBe('nsrc');
    expect(rememberedLinkSet({ openId: null, lastMemoId: null, linkSetOf })).toBeNull();
    expect(rememberedLinkSet({ openId: null, lastMemoId: 'missing', linkSetOf })).toBeNull();
    expect(rememberedLinkSet({ openId: 'broken', lastMemoId: 'last', linkSetOf })).toBeNull();
  });
});

describe('知らせた id の一覧', () => {
  it('壊れた id と重複を捨て、12 個まで、並びは残す', () => {
    const ids = ['n1', '壊れた id', 'n1', null, 'n2', 3, ...Array.from({ length: 20 }, (_, i) => `n${i + 3}`)];
    const listed = linkNameBookOfIds(ids);
    expect(listed.version).toBe(1);
    expect(listed.sets).toHaveLength(MAX_LINK_NAME_SETS);
    expect(listed.sets[0].id).toBe('n1');
    expect(listed.sets[1].id).toBe('n2');
    expect(listed.sets.map((s) => s.id)).not.toContain('壊れた id');
    expect(listed.sets[11].id).toBe('n12');
    expect(linkSetForNewMemo({ book: listed, remembered: 'n1' })).toBe('n1');
    expect(linkSetForNewMemo({ book: listed, remembered: 'n12' })).toBe('n12');
    expect(linkSetForNewMemo({ book: listed, remembered: 'n13' })).toBeUndefined();
    expect(ids[0]).toBe('n1');
  });
});

describe('台帳への付け方', () => {
  async function store() {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const memos = new MemoStore();
    await memos.load();
    return memos;
  }

  it('ふつうの新しいメモだけに付く。既存のメモ・特別なセルは変わらない。消えたあとの新しいメモは既定', async () => {
    const memos = await store();
    const old = memos.add({
      pos: { q: 0, r: 0 },
      text: '既存',
      replies: [card({ id: 'c1', text: '甲', links: [{ to: 'c2', kind: 'ground' }] }), card({ id: 'c2', text: '乙', createdAt: 2 })],
    });
    expect(old?.linkSet).toBeUndefined();
    let remembered: string | null = 'nread';
    let known: LinkNameBook | null = book;
    memos.useLinkSetForNewMemos(() => linkSetForNewMemo({ book: known, remembered }));
    expect(memos.get(old!.id)?.linkSet).toBeUndefined();

    let calls = 0;
    memos.useLinkSetForNewMemos(() => {
      calls += 1;
      return linkSetForNewMemo({ book: known, remembered });
    });
    expect(memos.add({ pos: { q: 1, r: 0 }, text: '', portal: 'shabc' })?.linkSet).toBeUndefined();
    expect(memos.add({ pos: { q: 2, r: 0 }, text: '', bot: 'b1234' })?.linkSet).toBeUndefined();
    expect(memos.add({ pos: { q: 3, r: 0 }, text: '', app: 'a1234' })?.linkSet).toBeUndefined();
    expect(memos.add({ pos: { q: 4, r: 0 }, text: '', capture: 'c123456' })?.linkSet).toBeUndefined();
    expect(calls).toBe(0);

    const neu = memos.add({ pos: { q: 5, r: 0 }, text: '新しい' });
    expect(neu?.linkSet).toBe('nread');
    expect(calls).toBe(1);
    expect(memos.get(old!.id)?.linkSet).toBeUndefined();
    expect(memos.get(old!.id)?.replies?.[0].links).toEqual([{ to: 'c2', kind: 'ground' }]);
    expect(parseMemo(JSON.parse(JSON.stringify(neu)))?.linkSet).toBe('nread');

    const picked = memos.add({ pos: { q: 6, r: 0 }, text: '指定', linkSet: 'nsrc' });
    expect(picked?.linkSet).toBe('nsrc');
    const broken = memos.add({ pos: { q: 7, r: 0 }, text: '壊れた指定', linkSet: '壊れた id' });
    expect(broken?.linkSet).toBe('nread');

    known = { version: 1, sets: book.sets.filter((s) => s.id !== 'nread') };
    const after = memos.add({ pos: { q: 8, r: 0 }, text: '消えたあと' });
    expect(after?.linkSet).toBeUndefined();
    expect(memos.get(neu!.id)?.linkSet).toBe('nread');
    expect(memos.get(old!.id)?.linkSet).toBeUndefined();

    remembered = null;
    const plain = memos.add({ pos: { q: 9, r: 0 }, text: '選んでいない' });
    expect(plain?.linkSet).toBeUndefined();
    expect(memos.get(neu!.id)?.linkSet).toBe('nread');
  });

  it('新しいメモへ送るときは create のセットだけ。送り元と、すでにある送り先は変えない。直前のセットは足さない', async () => {
    const memos = await store();
    memos.useLinkSetForNewMemos(() => 'nread');
    const from = memos.add({ pos: { q: 0, r: 0 }, text: '元', replies: [card({ id: 'a', text: '甲' })] });
    const dest = memos.add({ pos: { q: 1, r: 0 }, text: '先' });
    expect(from && dest).toBeTruthy();
    if (!from || !dest) return;
    expect(memos.setLinkSet(from.id, 'nsrc')).toBe(true);
    expect(memos.setLinkSet(dest.id, 'nplain')).toBe(true);
    const fromNames = memos.setLinkNames(from.id, { ground: '理由' });
    expect(fromNames).toBe(true);

    const stamped = linkSetForNewMemo({ book, source: memos.get(from.id) ?? null });
    expect(stamped).toBe('nsrc');
    const made = memos.sendReplies({
      fromId: from.id,
      replyIds: ['a'],
      toId: null,
      mode: 'copy',
      create: { pos: { q: 2, r: 0 }, text: '', ...(stamped ? { linkSet: stamped } : {}) },
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.created).toBe(true);
    expect(memos.get(made.toId)?.linkSet).toBe('nsrc');
    expect(memos.get(from.id)?.linkSet).toBe('nsrc');
    expect(memos.get(from.id)?.linkNames).toEqual({ ground: '理由' });
    expect(memos.get(dest.id)?.linkSet).toBe('nplain');
    expect(memos.undoSend(made.token).ok).toBe(true);
    expect(memos.get(made.toId)).toBeUndefined();
    expect(memos.get(from.id)?.linkSet).toBe('nsrc');
    expect(memos.get(from.id)?.replies?.some((r) => r.id === 'a')).toBe(true);

    const kept = memos.sendReplies({ fromId: from.id, replyIds: ['a'], toId: dest.id, mode: 'copy' });
    expect(kept.ok).toBe(true);
    expect(memos.get(dest.id)?.linkSet).toBe('nplain');
    expect(memos.get(from.id)?.linkSet).toBe('nsrc');

    const bad = memos.sendReplies({
      fromId: from.id,
      replyIds: ['a'],
      toId: null,
      mode: 'copy',
      create: { pos: { q: 4, r: 0 }, text: '', linkSet: '壊れた id' },
    });
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect(memos.get(bad.toId)?.linkSet).toBeUndefined();
    expect(memos.get(from.id)?.linkSet).toBe('nsrc');

    const noSet = memos.sendReplies({
      fromId: from.id,
      replyIds: ['a'],
      toId: null,
      mode: 'move',
      create: { pos: { q: 3, r: 0 }, text: '' },
    });
    expect(noSet.ok).toBe(true);
    if (!noSet.ok) return;
    expect(memos.get(noSet.toId)?.linkSet).toBeUndefined();
    expect(memos.get(from.id)?.linkSet).toBe('nsrc');
    expect(memos.get(dest.id)?.linkSet).toBe('nplain');
  });
});

describe('配線', () => {
  const primary = read('../src/app/primary.ts');
  const pane = read('../src/app/memo-pane.ts');
  const types = read('../src/types.ts');
  const cells = read('../src/memocells.ts');

  it('左は台帳を読むだけ。ふつうの新しいメモは直前、カードの新しいメモは送り元。下の区画が id を知らせる', () => {
    expect(primary).toContain('memos.useLinkSetForNewMemos(() => linkSetForNewMemo({ book: linkNameBook, remembered: rememberedLinkSetId() }))');
    expect(primary).toContain('openId: memoPane.openId');
    expect(primary).toContain('lastMemoId: readMemoPanePrefs().lastMemo');
    expect(primary).toContain('linkSetForNewMemo({ book: linkNameBook, source: memos.get(action.from) ?? null })');
    expect(primary).toContain("case 'noteLinkNameSetIds':");
    expect(primary).toContain('noteLinkNameBook(linkNameBookOfIds(action.ids), true)');
    expect(primary).toContain("if (read.status === 'ok') noteLinkNameBook(normalizeLinkNameBook(read.value), false);");
    expect(primary).toContain("else if (read.status === 'missing') noteLinkNameBook(emptyLinkNameBook(), false);");
    expect(primary).not.toMatch(/writeData\(\s*LINK_NAME_SETS_FILE/);
    // ＋新しいメモ・空いたセルのメモ・貼り付け（regraft したコメントを含む）は add のまま。セットは useLinkSetForNewMemos が付ける
    expect(primary).toContain("const placed = memos.add({ sheet: spot.sheet, pos: spot.pos, text: '', ...(spot.source ? { source: spot.source } : {}) });");
    expect(primary).toContain('const memo = memos.add({ sheet, pos: isTaken(at, sheet) ? placeCluster(allCells(sheet), 1, at)[0] : at, text });');
    expect(primary).toContain('memos.add({ sheet, pos: cellsAt[i], text: c.memo.text, tags: c.tags, liked: c.liked, island: islandId ?? null, image: c.memo.image, replies: c.memo.replies, by: c.memo.by, label: c.memo.label })');
    expect(types).toContain("{ command: 'noteLinkNameSetIds'; ids: string[] }");
    expect(pane).toMatch(/linkNameSets\.onChange\(\(\) => \{\s*refreshLinkNames\(\);\s*tellKnownLinkSets\(\);\s*\}\);/);
    expect(pane).toContain('if (!linkNameSets.ready || !linkNameSets.canWrite) return;');
    expect(pane).toContain("ask({ command: 'noteLinkNameSetIds', ids: linkNameSets.book.sets.map((s) => s.id) });");
    expect(pane).toContain('呼称セットは、いま開いているメモと同じにします');
    expect(pane).toContain('呼称セットは、このメモと同じにします');
    expect(cells).toContain('parseLinkSetId(draft.linkSet) ?? parseLinkSetId(this.newMemoLinkSet?.())');
    expect(cells).toContain('const linkSet = parseLinkSetId(draft.linkSet);');
  });
});
