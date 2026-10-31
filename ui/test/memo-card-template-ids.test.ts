// 型を貼るときのカードの id の指定（B3-2a。sendReplies の ids）：命令側だけ。画面（下の区画・グリッド）は ids を付けないので変わらない
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

import { buildTemplateFromCards, type CardTemplate, TEMPLATE_LIMITS } from '../src/memo-card-templates';
import { MemoStore } from '../src/memocells';
import { MAX_REPLIES, orderedTops, REPLY_ID_RE, type Reply } from '../src/threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (id: string, text: string, createdAt: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text, createdAt, ...extra });

// 3 枚（甲 ← 乙、丙は離れている）の型。型のカードの順は 甲・乙・丙
function sampleTemplate(): CardTemplate {
  const src = [card('a', '甲\n本文', 1, { tags: ['考察'] }), card('b', '乙', 2, { links: [{ to: 'a', kind: 'ground' }] }), card('c', '丙', 3)];
  const built = buildTemplateFromCards(src, ['a', 'b', 'c'], { name: '三枚', folder: '議論', newId: () => 'tpl1', now: 5 });
  if (!built.ok) throw new Error('型を作れない');
  return built.template;
}

// n 枚（n ≤ 30）の型
function bigTemplate(n: number): CardTemplate {
  const src = Array.from({ length: n }, (_, i) => card(`k${i}`, `札 ${i}`, i + 1));
  const built = buildTemplateFromCards(
    src,
    src.map((r) => r.id),
    { name: `${n}枚`, folder: '調査', newId: () => 'tplbig', now: 5 },
  );
  if (!built.ok) throw new Error('型を作れない');
  return built.template;
}

async function store() {
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  const memos = new MemoStore();
  await memos.load();
  return memos;
}

const existingCards = () => [card('x', '既存1', 10, { rank: 0 }), card('y', '既存2', 11, { rank: 1 }), { id: 'y1', parent: 'y', text: '既存の返事', createdAt: 12 } as Reply];

async function memoWith(memos: MemoStore, q: number, replies: Reply[] = existingCards()) {
  const m = memos.add({ pos: { q, r: 0 }, text: `メモ ${q}`, replies });
  if (!m) throw new Error('add');
  return m.id;
}

// 台帳の返信とメモの更新時刻（断ったとき、何も変わっていないことの確かめ）
const snap = (memos: MemoStore, id: string) => JSON.stringify([memos.get(id)?.replies ?? [], memos.get(id)?.updatedAt]);

describe('sendReplies の ids（型を貼るときのカードの id の指定）', () => {
  it('省略：今までどおり（id は自動で newReplyId の形・型の順に並ぶ）。ids を undefined で渡しても同じ。下の区画の呼び出しは ids を付けない', async () => {
    const memos = await store();
    const to = await memoWith(memos, 0);
    const before = structuredClone(memos.get(to)?.replies ?? []);
    const done = memos.sendReplies({ template: sampleTemplate(), toId: to });
    const again = memos.sendReplies({ template: sampleTemplate(), toId: to, ids: undefined });
    for (const d of [done, again]) {
      expect(d.ok).toBe(true);
      expect(d).toMatchObject({ toId: to, created: false, tops: 3, added: 3, cut: 0, kept: 1, name: '三枚' });
    }
    const after = memos.get(to)?.replies ?? [];
    expect(after).toHaveLength(before.length + 6);
    for (const old of before) expect(after.find((r) => r.id === old.id)).toEqual(old);
    const added = after.filter((r) => !before.some((o) => o.id === r.id));
    expect(added.every((r) => /^r[0-9a-z]+$/.test(r.id) && REPLY_ID_RE.test(r.id))).toBe(true);
    expect(orderedTops(after).slice(-6).map((r) => r.text)).toEqual(['甲\n本文', '乙', '丙', '甲\n本文', '乙', '丙']);
    expect(new Set(after.map((r) => r.id)).size).toBe(after.length);
    // 画面側（区画・グリッド）は ids を付けない
    for (const file of ['../src/app/memo-pane.ts', '../src/panels/memo-pad.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8').split(/\r?\n/);
      for (const line of src) if (line.includes("command: 'sendReplies'")) expect(line).not.toMatch(/\bids\s*:/);
    }
  });

  it('指定：その id が型のカードの順（甲・乙・丙）に付く。関連は指定の id どうしに付け替わり、既存は変わらず、元に戻せる', async () => {
    const memos = await store();
    const to = await memoWith(memos, 0);
    const before = structuredClone(memos.get(to)?.replies ?? []);
    const done = memos.sendReplies({ template: sampleTemplate(), toId: to, ids: ['p-1', 'P_2', 'x'.repeat(64)] });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done).toMatchObject({ toId: to, created: false, tops: 3, added: 3, kept: 1, name: '三枚' });
    const after = memos.get(to)?.replies ?? [];
    for (const old of before) expect(after.find((r) => r.id === old.id)).toEqual(old);
    expect(after).toHaveLength(before.length + 3);
    const tops = orderedTops(after).slice(-3);
    expect(tops.map((r) => r.id)).toEqual(['p-1', 'P_2', 'x'.repeat(64)]);
    expect(tops.map((r) => r.text)).toEqual(['甲\n本文', '乙', '丙']);
    expect(tops.every((r) => r.parent === null && r.rank === undefined)).toBe(true);
    expect(tops[0].tags).toEqual(['考察']);
    expect(tops[1].links).toEqual([{ to: 'p-1', kind: 'ground' }]);
    expect(tops[2].links).toBeUndefined();
    // 30 枚ちょうどの型に 30 個の id
    const wide = await memoWith(memos, 1, []);
    const ids30 = Array.from({ length: TEMPLATE_LIMITS.cards }, (_, i) => `n${i}`);
    const wideDone = memos.sendReplies({ template: bigTemplate(30), toId: wide, ids: ids30 });
    expect(wideDone.ok).toBe(true);
    if (!wideDone.ok) return;
    expect(orderedTops(memos.get(wide)?.replies ?? []).map((r) => r.id)).toEqual(ids30);
    // 元に戻すと、貼る前の返信に戻る（指定の id も消える）
    expect(memos.undoSend(wideDone.token)).toEqual({ ok: true });
    expect(memos.get(wide)?.replies ?? []).toEqual([]);
    expect(memos.get(to)?.replies).toEqual(after);
  });

  it('不正：形が違う・数が貼る枚数と合わない・配列でない指定は、何も付け替えず何も作らずに断る', async () => {
    const memos = await store();
    const to = await memoWith(memos, 0);
    const memoCount = memos.list().length;
    const before = snap(memos, to);
    const forms: unknown[] = [
      ['', 'b', 'c'],
      ['a b', 'b', 'c'],
      ['あ', 'b', 'c'],
      ['a/b', 'b', 'c'],
      ['../x', 'b', 'c'],
      ['x'.repeat(65), 'b', 'c'],
      [1, 'b', 'c'],
      [null, 'b', 'c'],
      [['a'], 'b', 'c'],
      'abc',
      null,
      { 0: 'a', 1: 'b', 2: 'c', length: 3 },
    ];
    for (const ids of forms) expect(memos.sendReplies({ template: sampleTemplate(), toId: to, ids: ids as string[] })).toEqual({ ok: false, why: 'ids', idsWhy: 'form' });
    for (const ids of [[], ['n1'], ['n1', 'n2'], ['n1', 'n2', 'n3', 'n4']]) {
      expect(memos.sendReplies({ template: sampleTemplate(), toId: to, ids })).toEqual({ ok: false, why: 'ids', idsWhy: 'count' });
    }
    expect(snap(memos, to)).toBe(before);
    expect(memos.list()).toHaveLength(memoCount);
    // 型が読めないときは、ids があっても今までの断り方（invalid）。貼り先がないときも今までどおり（to）
    expect(memos.sendReplies({ template: { version: 1, id: 'x' }, toId: to, ids: ['n1'] })).toEqual({ ok: false, why: 'invalid' });
    expect(memos.sendReplies({ template: sampleTemplate(), toId: 'nai', ids: ['n1', 'n2', 'n3'] })).toEqual({ ok: false, why: 'to' });
    expect(snap(memos, to)).toBe(before);
  });

  it('重複：指定の中の重なりも、台帳の既存 id（返信の id も）との重なりも、全体を断る（1 つでも重なれば何も入らない）', async () => {
    const memos = await store();
    const to = await memoWith(memos, 0);
    const before = snap(memos, to);
    expect(memos.sendReplies({ template: sampleTemplate(), toId: to, ids: ['n1', 'n2', 'n1'] })).toEqual({ ok: false, why: 'ids', idsWhy: 'dup' });
    expect(memos.sendReplies({ template: sampleTemplate(), toId: to, ids: ['n1', 'n1', 'n1'] })).toEqual({ ok: false, why: 'ids', idsWhy: 'dup' });
    expect(memos.sendReplies({ template: sampleTemplate(), toId: to, ids: ['n1', 'x', 'n3'] })).toEqual({ ok: false, why: 'ids', idsWhy: 'taken' });
    expect(memos.sendReplies({ template: sampleTemplate(), toId: to, ids: ['n1', 'n2', 'y1'] })).toEqual({ ok: false, why: 'ids', idsWhy: 'taken' });
    expect(snap(memos, to)).toBe(before);
    // 大文字小文字は別の id。一度貼った id をもう一度は使えない（貼ったカードの id とも重ならない）
    expect(memos.sendReplies({ template: sampleTemplate(), toId: to, ids: ['X', 'Y1', 'n3'] }).ok).toBe(true);
    const mid = snap(memos, to);
    expect(memos.sendReplies({ template: sampleTemplate(), toId: to, ids: ['q1', 'q2', 'n3'] })).toEqual({ ok: false, why: 'ids', idsWhy: 'taken' });
    expect(snap(memos, to)).toBe(mid);
  });

  it('上限：31 個以上の指定は断る。貼ると 300 枚を超えるときも、id を指定していても全体を断る。ids をカードの送り（型なし）に付けても動かない', async () => {
    const memos = await store();
    const to = await memoWith(memos, 0);
    const before = snap(memos, to);
    for (const n of [31, 40, 300]) {
      const ids = Array.from({ length: n }, (_, i) => `n${i}`);
      expect(memos.sendReplies({ template: sampleTemplate(), toId: to, ids })).toEqual({ ok: false, why: 'ids', idsWhy: 'limit' });
      expect(memos.sendReplies({ template: bigTemplate(30), toId: to, ids })).toEqual({ ok: false, why: 'ids', idsWhy: 'limit' });
    }
    // 30 個の指定でも、3 枚の型とは数が合わない
    expect(memos.sendReplies({ template: sampleTemplate(), toId: to, ids: Array.from({ length: 30 }, (_, i) => `n${i}`) })).toEqual({ ok: false, why: 'ids', idsWhy: 'count' });
    expect(snap(memos, to)).toBe(before);
    // 入りきらない：あと 2 枚まで（型は 3 枚）。指定が正しくても断り、何も書かない
    const nearly = await memoWith(
      memos,
      1,
      Array.from({ length: MAX_REPLIES - 2 }, (_, i) => card(`e${i}`, `既存 ${i}`, 100 + i, { rank: i })),
    );
    const nearlyBefore = snap(memos, nearly);
    expect(memos.sendReplies({ template: sampleTemplate(), toId: nearly, ids: ['n1', 'n2', 'n3'] })).toMatchObject({ ok: false, why: 'full', room: 2, need: 3 });
    expect(snap(memos, nearly)).toBe(nearlyBefore);
    // ちょうど入る（あと 3 枚）なら入る
    const exact = await memoWith(
      memos,
      2,
      Array.from({ length: MAX_REPLIES - 3 }, (_, i) => card(`e${i}`, `既存 ${i}`, 100 + i, { rank: i })),
    );
    expect(memos.sendReplies({ template: sampleTemplate(), toId: exact, ids: ['n1', 'n2', 'n3'] }).ok).toBe(true);
    expect(memos.get(exact)?.replies).toHaveLength(MAX_REPLIES);
    // 型のない送りに ids があっても、台帳へは何も送られない（命令の受け口で断る。台帳側はそもそも型のときだけ ids を読む）
    const src = readFileSync(new URL('../src/app/primary.ts', import.meta.url), 'utf8');
    expect(src).toContain('if (action.ids !== undefined) {');
  });

  it('ほかのメモと独立：別のメモにある id は使える。同じ id を別々のメモに指定でき、片方の貼り付けはもう片方を変えない', async () => {
    const memos = await store();
    const one = await memoWith(memos, 0, [card('same', 'メモ 1 の既存', 10, { rank: 0 })]);
    const two = await memoWith(memos, 1, [card('n2', 'メモ 2 の既存', 10, { rank: 0 })]);
    const twoBefore = snap(memos, two);
    // メモ 2 にある id 'n2' は、メモ 1 の貼り付けに使える
    expect(memos.sendReplies({ template: sampleTemplate(), toId: one, ids: ['n1', 'n2', 'n3'] }).ok).toBe(true);
    expect(orderedTops(memos.get(one)?.replies ?? []).map((r) => r.id)).toEqual(['same', 'n1', 'n2', 'n3']);
    expect(snap(memos, two)).toBe(twoBefore);
    // 同じ id の組を別のメモにも使える。同じメモには二度使えない
    expect(memos.sendReplies({ template: sampleTemplate(), toId: two, ids: ['n1', 'x2', 'n3'] }).ok).toBe(true);
    expect(orderedTops(memos.get(two)?.replies ?? []).map((r) => r.id)).toEqual(['n2', 'n1', 'x2', 'n3']);
    expect(memos.sendReplies({ template: sampleTemplate(), toId: two, ids: ['n1', 'x2', 'n3'] })).toEqual({ ok: false, why: 'ids', idsWhy: 'taken' });
    // メモ 1 は、メモ 2 の貼り付けと断りの影響を受けない
    expect(orderedTops(memos.get(one)?.replies ?? []).map((r) => r.id)).toEqual(['same', 'n1', 'n2', 'n3']);
  });
});