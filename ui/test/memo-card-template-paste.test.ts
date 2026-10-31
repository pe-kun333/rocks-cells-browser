// 型を貼る（Phase 1c）：台帳の貼り付け・元に戻す・300 枚の上限・指紋が合わないとき、貼るメニューの純粋な部分
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async (name: string) => (name === 'memocells.json' ? { status: 'ok', value: { version: 1, memos: [] } } : { status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { pasteBlocked, TEMPLATE_EMPTY_HINT, templateMenuGroups, templateMenuLabel } from '../src/memo-card-template-store';
import { buildTemplateFromCards, type CardTemplate } from '../src/memo-card-templates';
import { MemoStore } from '../src/memocells';
import { CARD_COLUMNS, MAX_REPLIES, orderedTops, topSlots, type Reply } from '../src/threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (id: string, text: string, createdAt: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text, createdAt, ...extra });

// 3 枚（甲 ← 乙、丙は離れている）の型
function sampleTemplate(name = '三枚', folder: CardTemplate['folder'] = '議論'): CardTemplate {
  const src = [
    card('a', '甲\n本文', 1, { tags: ['考察'] }),
    card('b', '乙', 2, { links: [{ to: 'a', kind: 'ground' }] }),
    card('c', '丙', 3),
  ];
  const built = buildTemplateFromCards(src, ['a', 'b', 'c'], { name, folder, newId: () => 'tpl1', now: 5 });
  if (!built.ok) throw new Error('型を作れない');
  return built.template;
}

async function store() {
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  const memos = new MemoStore();
  await memos.load();
  return memos;
}

const existingCards = () => [
  card('x', '既存1', 10, { rank: 0 }),
  card('y', '既存2', 11, { rank: 1 }),
  { id: 'y1', parent: 'y', text: '既存の返事', createdAt: 12 } as Reply,
  card('z', '既存3', 13, { rank: 4 }),
];

describe('型を貼る（台帳）', () => {
  it('最後に置いてある番地の次に並び、既存のカードの rank・文・関連は変わらない。関連は貼ったカードの中だけ', async () => {
    const memos = await store();
    const to = memos.add({ pos: { q: 0, r: 0 }, text: '先', replies: existingCards() });
    expect(to).toBeTruthy();
    if (!to) return;
    const before = structuredClone(memos.get(to.id)?.replies ?? []);
    const done = memos.sendReplies({ template: sampleTemplate(), toId: to.id });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done).toMatchObject({ toId: to.id, created: false, tops: 3, added: 3, cut: 0, kept: 1, name: '三枚' });
    const after = memos.get(to.id)?.replies ?? [];
    // 既存は 1 つも変わらない（rank の振り直しなし）
    for (const old of before) expect(after.find((r) => r.id === old.id)).toEqual(old);
    expect(after).toHaveLength(before.length + 3);
    const added = after.filter((r) => !before.some((o) => o.id === r.id));
    expect(added.every((r) => r.rank === undefined && r.parent === null)).toBe(true);
    expect(added.every((r) => !['x', 'y', 'z', 'a', 'b', 'c'].includes(r.id))).toBe(true);
    // 並びは型の順のまま最後。番地は、いちばん後ろの rank（4）より後ろから続く
    const tops = orderedTops(after);
    expect(tops.map((r) => r.text)).toEqual(['既存1', '既存2', '既存3', '甲\n本文', '乙', '丙']);
    const slots = topSlots(after);
    const pasted = tops.slice(3).map((r) => slots.get(r.id));
    expect(pasted).toEqual([5, 6, 7]);
    expect(CARD_COLUMNS).toBe(3);
    // タグは持ち込む。関連は、貼った甲・乙のあいだだけ（既存へは出ない）
    expect(tops[3].tags).toEqual(['考察']);
    const [ka, kb] = [tops[3], tops[4]];
    expect(kb.links).toEqual([{ to: ka.id, kind: 'ground' }]);
    expect(ka.links).toBeUndefined();
    expect(tops[5].links).toBeUndefined();
    for (const old of after.filter((r) => before.some((o) => o.id === r.id))) expect(old.links).toBeUndefined();
    // 作った時刻は既存の最新より後
    expect(Math.min(...added.map((r) => r.createdAt))).toBeGreaterThan(13);
  });

  it('元に戻すと、貼る前の返信にそっくり戻る（元のメモは無い）。2 回目は none', async () => {
    const memos = await store();
    const to = memos.add({ pos: { q: 0, r: 0 }, text: '先', replies: existingCards() });
    if (!to) throw new Error('add');
    const before = structuredClone(memos.get(to.id)?.replies ?? []);
    const updated = memos.get(to.id)?.updatedAt;
    const done = memos.sendReplies({ template: sampleTemplate(), toId: to.id });
    if (!done.ok) throw new Error('paste');
    expect(memos.undoSend('違う')).toEqual({ ok: false, why: 'none' });
    expect(memos.undoSend(done.token)).toEqual({ ok: true });
    expect(memos.get(to.id)?.replies).toEqual(before);
    expect(memos.get(to.id)?.updatedAt).toBe(updated);
    expect(memos.undoSend(done.token)).toEqual({ ok: false, why: 'none' });
  });

  it('空のメモにも貼れ、元に戻すと空に戻る', async () => {
    const memos = await store();
    const to = memos.add({ pos: { q: 0, r: 0 }, text: '空' });
    if (!to) throw new Error('add');
    const done = memos.sendReplies({ template: sampleTemplate(), toId: to.id });
    if (!done.ok) throw new Error('paste');
    expect(orderedTops(memos.get(to.id)?.replies ?? []).map((r) => r.text)).toEqual(['甲\n本文', '乙', '丙']);
    expect(memos.undoSend(done.token)).toEqual({ ok: true });
    expect(memos.get(to.id)?.replies ?? []).toEqual([]);
  });

  it('貼ったあとにメモが変わっていたら（指紋が合わない）、元に戻せず、貼ったままになる', async () => {
    const memos = await store();
    const to = memos.add({ pos: { q: 0, r: 0 }, text: '先', replies: existingCards() });
    if (!to) throw new Error('add');
    const done = memos.sendReplies({ template: sampleTemplate(), toId: to.id });
    if (!done.ok) throw new Error('paste');
    const pastedTop = orderedTops(memos.get(to.id)?.replies ?? []).find((r) => r.text === '乙');
    expect(pastedTop).toBeTruthy();
    expect(memos.editReply(to.id, pastedTop?.id ?? '', '乙（直した）')).toBe(true);
    const mid = structuredClone(memos.get(to.id)?.replies);
    expect(memos.undoSend(done.token)).toEqual({ ok: false, why: 'stale' });
    expect(memos.get(to.id)?.replies).toEqual(mid);
  });

  it('貼り先のメモが消えていたら、元に戻せない（stale）', async () => {
    const memos = await store();
    const to = memos.add({ pos: { q: 0, r: 0 }, text: '先' });
    if (!to) throw new Error('add');
    const done = memos.sendReplies({ template: sampleTemplate(), toId: to.id });
    if (!done.ok) throw new Error('paste');
    memos.remove(to.id);
    expect(memos.undoSend(done.token)).toEqual({ ok: false, why: 'stale' });
  });

  it('貼ると 300 枚を超えるときは、全体を断る（何も書かず、元に戻す印も作らない）。ちょうど 300 枚なら貼れる', async () => {
    const memos = await store();
    const fill = (n: number) => Array.from({ length: n }, (_, i) => card(`f${i}`, `満${i}`, i + 1));
    const nearly = memos.add({ pos: { q: 0, r: 0 }, text: '満', replies: fill(MAX_REPLIES - 2) }); // あと 2 枚（型は 3 枚）
    if (!nearly) throw new Error('add');
    const before = structuredClone(memos.get(nearly.id)?.replies);
    const refused = memos.sendReplies({ template: sampleTemplate(), toId: nearly.id });
    expect(refused).toEqual({ ok: false, why: 'full', room: 2, need: 3 });
    expect(memos.get(nearly.id)?.replies).toEqual(before);
    expect(memos.undoSend('u')).toEqual({ ok: false, why: 'none' });
    const full = memos.add({ pos: { q: 1, r: 0 }, text: '満杯', replies: fill(MAX_REPLIES) });
    if (!full) throw new Error('add');
    expect(memos.sendReplies({ template: sampleTemplate(), toId: full.id })).toMatchObject({ ok: false, why: 'full', room: 0, need: 3 });
    const exact = memos.add({ pos: { q: 2, r: 0 }, text: '丁度', replies: fill(MAX_REPLIES - 3) });
    if (!exact) throw new Error('add');
    const ok = memos.sendReplies({ template: sampleTemplate(), toId: exact.id });
    expect(ok.ok).toBe(true);
    expect(memos.get(exact.id)?.replies).toHaveLength(MAX_REPLIES);
  });

  it('壊れた型・入口のメモ・無いメモには貼らない。型に混ざった機械のタグ（宛て:）は入らない', async () => {
    const memos = await store();
    const to = memos.add({ pos: { q: 0, r: 0 }, text: '先' });
    const portal = memos.add({ pos: { q: 1, r: 0 }, text: '', portal: 'shabc' });
    if (!to || !portal) throw new Error('add');
    expect(memos.sendReplies({ template: { version: 1, id: 'x' }, toId: to.id })).toEqual({ ok: false, why: 'invalid' });
    expect(memos.sendReplies({ template: null, toId: to.id })).toEqual({ ok: false, why: 'invalid' });
    expect(memos.sendReplies({ template: sampleTemplate(), toId: portal.id })).toEqual({ ok: false, why: 'to' });
    expect(memos.sendReplies({ template: sampleTemplate(), toId: 'nai' })).toEqual({ ok: false, why: 'to' });
    expect(memos.get(to.id)?.replies ?? []).toEqual([]);
    const dirty = sampleTemplate();
    dirty.cards[0].tags = ['宛て:誰か', '考察'];
    const done = memos.sendReplies({ template: dirty, toId: to.id });
    expect(done.ok).toBe(true);
    const tops = orderedTops(memos.get(to.id)?.replies ?? []);
    expect(tops[0].tags).toEqual(['考察']);
  });

  it('台帳を読めていないときは貼らない', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const memos = new MemoStore(); // load していない
    expect(memos.sendReplies({ template: sampleTemplate(), toId: 'm' })).toEqual({ ok: false, why: 'ledger' });
  });

  it('次に貼ると、元に戻す印は新しい方に替わる（直前の 1 件だけ）', async () => {
    const memos = await store();
    const to = memos.add({ pos: { q: 0, r: 0 }, text: '先' });
    if (!to) throw new Error('add');
    const first = memos.sendReplies({ template: sampleTemplate(), toId: to.id });
    const second = memos.sendReplies({ template: sampleTemplate('二つ目'), toId: to.id });
    if (!first.ok || !second.ok) throw new Error('paste');
    expect(memos.undoSend(first.token)).toEqual({ ok: false, why: 'none' });
    expect(memos.undoSend(second.token)).toEqual({ ok: true });
    expect(memos.get(to.id)?.replies).toHaveLength(3);
  });
});

describe('型を貼るメニューの純粋な部分', () => {
  it('貼る前の確かめ：入れば null、入らなければ、あと何枚・型は何枚・上限が分かる文', () => {
    expect(pasteBlocked(0, 30)).toBeNull();
    expect(pasteBlocked(MAX_REPLIES - 3, 3)).toBeNull();
    const msg = pasteBlocked(MAX_REPLIES - 2, 3);
    expect(msg).toContain('あと 2 枚');
    expect(msg).toContain('型は 3 枚');
    expect(msg).toContain(String(MAX_REPLIES));
    expect(pasteBlocked(MAX_REPLIES + 5, 1)).toContain('あと 0 枚');
  });
  it('フォルダごとにまとめる（決まった順。空のフォルダは出さない）。名前には枚数が付く', () => {
    const a = sampleTemplate('A', '計画');
    const b = { ...sampleTemplate('B', '議論'), id: 'b' };
    const c = { ...sampleTemplate('C', '計画'), id: 'c' };
    const groups = templateMenuGroups([a, b, c]);
    expect(groups.map((g) => g.folder)).toEqual(['議論', '計画']);
    expect(groups[1].items.map((t) => t.name)).toEqual(['A', 'C']);
    expect(templateMenuGroups([])).toEqual([]);
    expect(templateMenuLabel(a)).toBe('A（3枚）');
    expect(TEMPLATE_EMPTY_HINT).toContain('型にする');
  });
});