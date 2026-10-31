// コメントのカードを足すときの id（B2-3a）：呼び出し側が決められる。省略したときは今までと同じ（グリッド側の足し方は変わらない）
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

import { MemoStore } from '../src/memocells';
import { MAX_REPLIES, newReplyId, REPLY_ID_RE, replyIdProblem, type Reply, withReply } from '../src/threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt: 100, ...over });

describe('replyIdProblem / REPLY_ID_RE（id の形と重なり）', () => {
  it('形：英数字・_・- の 1〜64 字（newReplyId の形も通る）', () => {
    for (const ok of ['a', 'r1', 'card_1-b', 'A9', 'x'.repeat(64), newReplyId()]) expect(REPLY_ID_RE.test(ok)).toBe(true);
    for (const bad of ['', ' ', 'a b', 'あ', 'a/b', 'a.b', '../x', 'a\n', 'x'.repeat(65), 'a:b']) expect(REPLY_ID_RE.test(bad)).toBe(false);
  });
  it('使える id は null、形が違えば form、もう台帳にあれば taken。文字列でないものは form', () => {
    const rs = [card('a'), card('b', { parent: 'a' })];
    expect(replyIdProblem(rs, 'c')).toBeNull();
    expect(replyIdProblem(rs, 'a')).toBe('taken');
    expect(replyIdProblem(rs, 'b')).toBe('taken'); // 返信（一番上でないカード）の id とも重ならない
    expect(replyIdProblem(rs, 'A')).toBeNull(); // 大文字小文字は別の id
    expect(replyIdProblem(rs, 'a b')).toBe('form');
    for (const v of [null, 1, undefined, {}, ['a']]) expect(replyIdProblem(rs, v)).toBe('form');
  });
});

describe('withReply の replyId', () => {
  it('省略：今までどおり newReplyId の形の id が付く（replyId を undefined で渡しても同じ）', () => {
    const base = [card('a')];
    const x = withReply(base, null, '新しい');
    const y = withReply(base, null, '新しい', undefined, undefined, undefined);
    for (const done of [x, y]) {
      expect(done).not.toBeNull();
      expect(done?.reply.id).toMatch(/^r[0-9a-z]+$/);
      expect(REPLY_ID_RE.test(done?.reply.id ?? '')).toBe(true);
      expect(done?.replies).toHaveLength(2);
      expect(done?.reply).toMatchObject({ parent: null, text: '新しい' });
      expect(Object.keys(done?.reply ?? {}).sort()).toEqual(['createdAt', 'id', 'parent', 'text']);
    }
    expect(x?.reply.id).not.toBe(y?.reply.id);
  });
  it('指定：その id で足される。ほかの項目（時刻の並び・引用・画像）は省略のときと同じ', () => {
    const base = [card('a', { createdAt: 5000 })];
    const done = withReply(base, null, '指定', undefined, { image: 'shotabc123' }, 'my_card-1');
    expect(done?.reply.id).toBe('my_card-1');
    expect(done?.reply.image).toBe('shotabc123');
    expect(done?.reply.createdAt).toBeGreaterThan(5000);
    expect(done?.replies.map((r) => r.id)).toEqual(['a', 'my_card-1']);
    expect(base).toHaveLength(1); // 元は変えない
  });
  it('重複：このメモにもう同じ id があれば、付け替えずに足さない（返信の id とも）', () => {
    const base = [card('a'), card('b', { parent: 'a' })];
    expect(withReply(base, null, 'x', undefined, undefined, 'a')).toBeNull();
    expect(withReply(base, null, 'x', undefined, undefined, 'b')).toBeNull();
    expect(base).toHaveLength(2);
  });
  it('不正な形：足さない（空・長すぎる・使えない字・文字列でない値）', () => {
    const base = [card('a')];
    for (const bad of ['', 'a b', 'あ', 'a/b', 'x'.repeat(65), '../x']) expect(withReply(base, null, 'x', undefined, undefined, bad)).toBeNull();
    expect(withReply(base, null, 'x', undefined, undefined, null as unknown as string)).toBeNull();
    expect(withReply(base, null, 'x', undefined, undefined, 5 as unknown as string)).toBeNull();
  });
  it('ほかの断り方（文が空・数の上限・返信先なし）は、id を指定しても今までどおり null', () => {
    expect(withReply([], null, '', undefined, undefined, 'ok1')).toBeNull();
    expect(withReply([card('a')], 'nope', 'x', undefined, undefined, 'ok1')).toBeNull();
    const full = Array.from({ length: MAX_REPLIES }, (_, i) => card(`c${i}`));
    expect(withReply(full, null, 'x', undefined, undefined, 'ok1')).toBeNull();
    expect(withReply(full.slice(0, MAX_REPLIES - 1), null, 'x', undefined, undefined, 'ok1')?.reply.id).toBe('ok1');
  });
  it('64 字ちょうどは通る', () => {
    expect(withReply([], null, 'x', undefined, undefined, 'x'.repeat(64))?.reply.id).toBe('x'.repeat(64));
  });
});

describe('MemoStore.addReply の replyId（台帳への書き込み）', () => {
  async function store() {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const memos = new MemoStore();
    await memos.load();
    return memos;
  }

  it('省略：今までどおり（id は自動、台帳に 1 枚増える）', async () => {
    const memos = await store();
    const m = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ' });
    if (!m) throw new Error('add');
    const a = memos.addReply(m.id, null, '一つ目');
    const b = memos.addReply(m.id, null, '二つ目');
    expect(a && b).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
    expect(memos.get(m.id)?.replies?.map((r) => r.text)).toEqual(['一つ目', '二つ目']);
  });
  it('指定：その id で台帳に入る。同じ id をもう一度は断り、台帳は変わらない', async () => {
    const memos = await store();
    const m = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ' });
    if (!m) throw new Error('add');
    const first = memos.addReply(m.id, null, '指定した', undefined, undefined, 'fixed-1');
    expect(first?.id).toBe('fixed-1');
    const before = structuredClone(memos.get(m.id)?.replies);
    expect(memos.addReply(m.id, null, '同じ id', undefined, undefined, 'fixed-1')).toBeNull();
    expect(memos.addReply(m.id, null, '不正', undefined, undefined, 'a b')).toBeNull();
    expect(memos.get(m.id)?.replies).toEqual(before);
    // 自動の id で足したカードの id も、あとから指定で重ねられない
    const auto = memos.addReply(m.id, null, '自動');
    expect(auto).toBeTruthy();
    expect(memos.addReply(m.id, null, '重ねる', undefined, undefined, auto?.id)).toBeNull();
  });
  it('ほかのメモとは独立：別のメモでは同じ id を使える', async () => {
    const memos = await store();
    const m1 = memos.add({ pos: { q: 0, r: 0 }, text: '一' });
    const m2 = memos.add({ pos: { q: 1, r: 0 }, text: '二' });
    if (!m1 || !m2) throw new Error('add');
    expect(memos.addReply(m1.id, null, '甲', undefined, undefined, 'same')?.id).toBe('same');
    expect(memos.addReply(m2.id, null, '乙', undefined, undefined, 'same')?.id).toBe('same');
    expect(memos.addReply(m1.id, null, '甲 2', undefined, undefined, 'same')).toBeNull();
    expect(memos.get(m2.id)?.replies).toHaveLength(1);
  });
});

describe('グリッド側のコメント追加は変わらない', () => {
  it('下の区画（memo-pane.ts）は addMemoComment に replyId を付けない（今までの呼び出しのまま）', () => {
    const src = readFileSync(new URL('../src/app/memo-pane.ts', import.meta.url), 'utf8').split(/\r?\n/);
    let calls = 0;
    src.forEach((line, i) => {
      if (!line.includes("'addMemoComment'")) return;
      calls += 1;
      expect(src.slice(i, i + 8).join('\n')).not.toMatch(/replyId/);
    });
    expect(calls).toBeGreaterThanOrEqual(5);
  });
  it('左の受け口（primary.ts）は、replyId があるときだけ検査し、省略時は検査を通らない（addReply にそのまま undefined）', () => {
    const src = readFileSync(new URL('../src/app/primary.ts', import.meta.url), 'utf8');
    const at = src.indexOf("case 'addMemoComment'");
    const block = src.slice(at, src.indexOf("case 'changeReplyTags'", at));
    expect(block).toContain('action.replyId !== undefined && replyIdProblem(');
    expect(block).toContain('action.replyId)');
    expect(block).toContain('返信が多すぎます');
  });
});