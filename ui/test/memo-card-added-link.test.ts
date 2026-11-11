// 下の欄から足したカードに引く線（CC3。つなぐ ▾）：左で決まりを確かめ（addedLinkPlan）、台帳へ送る（MemoStore）
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

import { addedLinkPlan } from '../src/memo-card-board-edit';
import { MemoStore } from '../src/memocells';
import type { Reply } from '../src/threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (id: string, createdAt: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt, ...extra });

describe('addedLinkPlan：頼まれていない・形が違う', () => {
  const rs = [card('a', 100), card('b', 200)];
  it('頼まれていない（undefined・null・文字列）は null', () => {
    for (const raw of [undefined, null, 'a']) expect(addedLinkPlan(raw, rs, 'm', 'b')).toBeNull();
  });
  it('形が違う（from が数・kind が知らない字）は null', () => {
    expect(addedLinkPlan({ from: 1, kind: 'next' }, rs, 'm', 'b')).toBeNull();
    expect(addedLinkPlan({ from: 'a', kind: 'zzz' }, rs, 'm', 'b')).toBeNull();
  });
});

describe('addedLinkPlan：直前のカードから引く', () => {
  const rs = [card('a', 100), card('b', 200), card('c', 300)]; // c が足したカード
  it('直前のカードから → ok', () => {
    expect(addedLinkPlan({ from: 'b', kind: 'next' }, rs, 'm', 'c')).toEqual({ ok: true, from: 'b', kind: 'next' });
  });
  it('from が直前でなければ、線は引かず知らせる', () => {
    const r = addedLinkPlan({ from: 'a', kind: 'next' }, rs, 'm', 'c');
    expect(r?.ok).toBe(false);
    expect(r && !r.ok ? r.note : '').toBe('直前のカードが替わったので、線は引きませんでした');
  });
  it('直前は作った順で決まる（並べ替えた rank に左右されない）。返信と、あとから作った返信は数えない', () => {
    const rs2 = [card('a', 100, { rank: 0 }), card('b', 200, { rank: 9 }), card('r', 250, { parent: 'b' }), card('c', 300), card('r2', 350, { parent: 'b' })];
    expect(addedLinkPlan({ from: 'b', kind: 'next' }, rs2, 'm', 'c')).toEqual({ ok: true, from: 'b', kind: 'next' });
    expect(addedLinkPlan({ from: 'a', kind: 'next' }, rs2, 'm', 'c')).toMatchObject({ ok: false });
  });
  it('足したカード自身は数えない（直前の判定から外す）', () => {
    const rs3 = [card('a', 100), card('c', 300)];
    expect(addedLinkPlan({ from: 'a', kind: 'next' }, rs3, 'm', 'c')).toEqual({ ok: true, from: 'a', kind: 'next' });
  });
  it('from が足した前の最新で、もう 10 本持っている → 関連の上限の文', () => {
    const many = Array.from({ length: 10 }, (_, i) => card(`t${i}`, 10 + i));
    const from = card('from', 200, { links: many.map((t) => ({ to: t.id, kind: 'next' as const })) });
    const r = addedLinkPlan({ from: 'from', kind: 'ground' }, [...many, from, card('to', 300)], 'm', 'to');
    expect(r?.ok).toBe(false);
    expect(r && !r.ok ? r.note : '').toMatch(/^カードは足しましたが線は引けませんでした（関連は 1 枚のカードから 10 本までです/);
  });
});

describe('addedLinkPlan：photo（拡大で見ている写真のカードから）', () => {
  const rs = [card('a', 100), card('b', 200), card('r', 250, { parent: 'b' }), card('c', 300)];
  it('from が直前でなくても、一番上のカードなら ok', () => {
    expect(addedLinkPlan({ from: 'a', kind: 'next', photo: true }, rs, 'm', 'c')).toEqual({ ok: true, from: 'a', kind: 'next' });
  });
  it('from が返信・無い id なら「結べませんでした」で始まる文', () => {
    for (const from of ['r', 'zz']) {
      const r = addedLinkPlan({ from, kind: 'next', photo: true }, rs, 'm', 'c');
      expect(r?.ok).toBe(false);
      expect(r && !r.ok ? r.note : '').toMatch(/^カードは足しましたが線は引けませんでした（結べませんでした/);
    }
  });
  it('from と to が同じ → ok: false', () => {
    const r = addedLinkPlan({ from: 'c', kind: 'next', photo: true }, rs, 'm', 'c');
    expect(r?.ok).toBe(false);
    expect(r && !r.ok ? r.note : '').toMatch(/^カードは足しましたが線は引けませんでした（結べませんでした/);
  });
  it('同じ種類の線がもうある（from が to へ同じ種類を持つ）→ もう関連', () => {
    const rs4 = [card('a', 100, { links: [{ to: 'c', kind: 'next' }] }), card('c', 300)];
    const r = addedLinkPlan({ from: 'a', kind: 'next', photo: true }, rs4, 'm', 'c');
    expect(r?.ok).toBe(false);
    expect(r && !r.ok ? r.note : '').toContain('もう関連');
  });
});

describe('MemoStore：左で線を引く流れ', () => {
  async function store() {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const memos = new MemoStore();
    await memos.load();
    return memos;
  }

  it('足したあと線を引くと、古いカードだけが線を持つ', async () => {
    const memos = await store();
    const m = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ' });
    if (!m) throw new Error('add');
    const a = memos.addReply(m.id, null, '一つ目', undefined, undefined, 'card-a');
    const b = memos.addReply(m.id, null, '二つ目', undefined, undefined, 'card-b');
    if (!a || !b) throw new Error('reply');
    const plan = addedLinkPlan({ from: a.id, kind: 'next' }, memos.get(m.id)?.replies ?? [], m.id, b.id);
    expect(plan).toEqual({ ok: true, from: 'card-a', kind: 'next' });
    if (!plan || !plan.ok) throw new Error('plan');
    expect(memos.changeReplyLinks(m.id, plan.from, [{ to: b.id, kind: plan.kind }], []).result).toBe('changed');
    const reps = memos.get(m.id)?.replies ?? [];
    expect(reps.find((r) => r.id === 'card-a')?.links).toEqual([{ to: 'card-b', kind: 'next' }]);
    expect(reps.find((r) => r.id === 'card-b')?.links ?? []).toEqual([]);
  });
});

describe('primary.ts と types.ts の字（つなぐ ▾）', () => {
  it('addMemoComment の塊に addedLinkPlan と changeReplyLinks がある', () => {
    const src = readFileSync(new URL('../src/app/primary.ts', import.meta.url), 'utf8');
    const at = src.indexOf("case 'addMemoComment'");
    const block = src.slice(at, src.indexOf("case 'changeReplyTags'", at));
    expect(block).toContain('addedLinkPlan(action.linkFrom,');
    expect(block).toContain('memos.changeReplyLinks(action.id, linkPlan.from,');
  });
  it('types.ts の addMemoComment の行に linkFrom?: AddedLinkFrom', () => {
    const src = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
    const line = src.split(/\r?\n/).find((l) => l.includes("command: 'addMemoComment'")) ?? '';
    expect(line).toContain('linkFrom?: AddedLinkFrom');
  });
});
