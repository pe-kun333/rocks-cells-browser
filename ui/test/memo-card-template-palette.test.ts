// 型の窓（Phase 2）の純粋な部分：検索・絞り込み・矢印で選ぶ・ゴーストの番地（実際の貼り付けと一致）・サムネイル
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async (name: string) => (name === 'memocells.json' ? { status: 'ok', value: { version: 1, memos: [] } } : { status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { buildTemplateFromCards, type CardTemplate, TEMPLATE_GRID } from '../src/memo-card-templates';
import {
  ghostSlots,
  ghostSummary,
  isPaletteKey,
  keepSelection,
  moveSelection,
  paletteMeta,
  paletteOrder,
  queryWords,
  searchTemplates,
  templateHaystack,
  thumbLayout,
} from '../src/memo-card-template-palette';
import { MemoStore } from '../src/memocells';
import { MAX_REPLIES, orderedTops, topSlots, type Reply } from '../src/threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (id: string, text: string, createdAt: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text, createdAt, ...extra });

function make(id: string, name: string, folder: CardTemplate['folder'], texts: string[], links: [number, number][] = [], tags: string[] = []): CardTemplate {
  const src = texts.map((t, i) => card(`c${i}`, t, i + 1, i === 0 && tags.length ? { tags } : {}));
  for (const [a, b] of links) src[a] = { ...src[a], links: [...(src[a].links ?? []), { to: `c${b}`, kind: 'ground' as const }] };
  const done = buildTemplateFromCards(src, src.map((r) => r.id), { name, folder, newId: () => id, now: 1 });
  if (!done.ok) throw new Error('型を作れない');
  return done.template;
}

const pro = make('t1', '賛成・反対・結論', '議論', ['賛成\n理由を書く', '反対', '結論'], [[1, 0]]);
const cause = make('t2', '原因→対策→確認', '計画', ['原因', '対策', '確認'], [[1, 0], [2, 1]], ['Ｐｌａｎ']);
const memo = make('t3', '調査メモ', '調査', ['出典', '要点']);
const all = [pro, cause, memo];

describe('型の検索・絞り込み', () => {
  it('語が空なら全部。名前・フォルダ・カードの題や本文・タグに当たる', () => {
    expect(searchTemplates(all, '')).toEqual(all);
    expect(searchTemplates(all, '   ')).toEqual(all);
    expect(searchTemplates(all, '結論').map((t) => t.id)).toEqual(['t1']);
    expect(searchTemplates(all, '調査').map((t) => t.id)).toEqual(['t3']); // 名前とフォルダ
    expect(searchTemplates(all, '理由').map((t) => t.id)).toEqual(['t1']); // 本文
    expect(searchTemplates(all, 'plan').map((t) => t.id)).toEqual(['t2']); // タグ（全角・大文字も同じ）
    expect(searchTemplates(all, '計画').map((t) => t.id)).toEqual(['t2']);
  });
  it('語は全部当たる型だけ（AND）。全角の空白でも区切る。当たらなければ空', () => {
    expect(searchTemplates(all, '原因 確認').map((t) => t.id)).toEqual(['t2']);
    expect(searchTemplates(all, '原因　出典')).toEqual([]);
    expect(searchTemplates(all, 'ないことば')).toEqual([]);
    expect(queryWords('  ＡＢＣ　 def ')).toEqual(['abc', 'def']);
  });
  it('フォルダで絞る。検索と重ねると両方に合うものだけ', () => {
    expect(searchTemplates(all, '', '議論').map((t) => t.id)).toEqual(['t1']);
    expect(searchTemplates(all, '', 'その他')).toEqual([]);
    expect(searchTemplates(all, '原因', '議論')).toEqual([]);
    expect(searchTemplates(all, '原因', '計画').map((t) => t.id)).toEqual(['t2']);
  });
  it('見えている並びは、フォルダの順（議論・調査・計画・その他）で、中は元の順', () => {
    expect(paletteOrder(all).map((t) => t.id)).toEqual(['t1', 't3', 't2']);
    expect(templateHaystack(memo)).toContain('出典');
    expect(paletteMeta(cause)).toBe('計画・3枚・関連 2本・そのまま');
  });
});

describe('矢印・Home・End で選ぶ', () => {
  const ids = ['a', 'b', 'c'];
  it('下・上で動き、端では反対の端へ回る', () => {
    expect(moveSelection(ids, 'a', 'ArrowDown')).toBe('b');
    expect(moveSelection(ids, 'c', 'ArrowDown')).toBe('a');
    expect(moveSelection(ids, 'b', 'ArrowUp')).toBe('a');
    expect(moveSelection(ids, 'a', 'ArrowUp')).toBe('c');
  });
  it('Home・End。選びが無い・並びに無いときは、下なら先頭・上なら末尾。空なら null', () => {
    expect(moveSelection(ids, 'b', 'Home')).toBe('a');
    expect(moveSelection(ids, 'b', 'End')).toBe('c');
    expect(moveSelection(ids, null, 'ArrowDown')).toBe('a');
    expect(moveSelection(ids, 'zz', 'ArrowUp')).toBe('c');
    expect(moveSelection([], 'a', 'ArrowDown')).toBeNull();
    expect(isPaletteKey('Home')).toBe(true);
    expect(isPaletteKey('Enter')).toBe(false);
  });
  it('絞り込みで選びが消えたら先頭に。残っていればそのまま', () => {
    expect(keepSelection(ids, 'b')).toBe('b');
    expect(keepSelection(ids, 'x')).toBe('a');
    expect(keepSelection([], 'x')).toBeNull();
    expect(keepSelection(ids, null)).toBe('a');
  });
});

describe('ゴースト（入る番地の予告）', () => {
  it('空のメモ：0・1・2 番。次の行へ続く', () => {
    const five = make('t5', '五枚', '議論', ['1', '2', '3', '4', '5']);
    const r = ghostSlots(five, []);
    expect(r).toEqual({ ok: true, slots: [0, 1, 2, 3, 4], first: 0, rows: 2 });
  });
  it('最後に置いてある番地の次から（間の空きは使わない）。既存の rank は変えない', () => {
    const existing = [card('x', '一', 10, { rank: 0 }), card('y', '二', 11, { rank: 1 }), card('z', '三', 12, { rank: 4 })];
    const before = structuredClone(existing);
    const r = ghostSlots(pro, existing);
    expect(r).toEqual({ ok: true, slots: [5, 6, 7], first: 5, rows: 2 });
    expect(existing).toEqual(before);
  });
  it('rank の無い既存カードだけのときも、並びの最後の次', () => {
    const existing = [card('x', '一', 10), card('y', '二', 11)];
    const r = ghostSlots(memo, existing);
    expect(r).toEqual({ ok: true, slots: [2, 3], first: 2, rows: 2 });
  });
  it('300 枚を超えるときは full（あと何枚か付き）。壊れた型は invalid', () => {
    const existing = Array.from({ length: MAX_REPLIES - 2 }, (_, i) => card(`f${i}`, `満${i}`, i + 1));
    expect(ghostSlots(pro, existing)).toEqual({ ok: false, why: 'full', room: 2, need: 3 });
    expect(ghostSlots({ ...pro, cards: [] } as CardTemplate, [])).toEqual({ ok: false, why: 'invalid' });
  });
  it('予告の番地は、実際に貼ったあとの番地と一致する', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const memos = new MemoStore();
    await memos.load();
    const to = memos.add({ pos: { q: 0, r: 0 }, text: '先', replies: [card('x', '一', 10, { rank: 0 }), card('y', '二', 11, { rank: 2 }), { id: 'y1', parent: 'y', text: '返事', createdAt: 12 } as Reply] });
    if (!to) throw new Error('add');
    for (const t of [pro, cause]) {
      const ghost = ghostSlots(t, memos.get(to.id)?.replies ?? []);
      expect(ghost.ok).toBe(true);
      if (!ghost.ok) return;
      const done = memos.sendReplies({ template: t, toId: to.id });
      expect(done.ok).toBe(true);
      const after = memos.get(to.id)?.replies ?? [];
      const slots = topSlots(after);
      const tops = orderedTops(after);
      const real = tops.slice(tops.length - t.cards.length).map((r) => slots.get(r.id));
      expect(real).toEqual(ghost.slots);
    }
  });
  it('入る番地の文：1 枚・複数枚・断り', () => {
    expect(ghostSummary({ ok: true, slots: [5], first: 5, rows: 1 })).toBe('2 行目の 3 列目に入ります');
    expect(ghostSummary({ ok: true, slots: [5, 6, 7], first: 5, rows: 2 })).toBe('2 行目の 3 列目から 3 行目の 2 列目まで、3 枚が入ります');
    expect(ghostSummary({ ok: false, why: 'full', room: 2, need: 3 })).toContain('あと 2 枚');
    expect(ghostSummary({ ok: false, why: 'invalid' })).toContain('読めません');
  });
});

describe('サムネイルの形', () => {
  const box = { w: 96, h: 56 };
  it('カードの数だけ四角ができ、箱の中に収まる。型ごとに形が違う', () => {
    for (const t of all) {
      const lay = thumbLayout(t, box);
      expect(lay.cards).toHaveLength(t.cards.length);
      for (const c of lay.cards) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w).toBeLessThanOrEqual(box.w);
        expect(c.y + c.h).toBeLessThanOrEqual(box.h);
      }
    }
    expect(JSON.stringify(thumbLayout(pro, box).cards)).not.toBe(JSON.stringify(thumbLayout(memo, box).cards));
  });
  it('関連の線は、型の中の関連の数だけ。両端は四角の縁（中心ではない）', () => {
    const lay = thumbLayout(cause, box);
    expect(lay.links).toHaveLength(2);
    for (const link of lay.links) {
      const a = lay.cards.find((c) => c.key === link.from);
      const b = lay.cards.find((c) => c.key === link.to);
      expect(a && b).toBeTruthy();
      if (!a || !b) continue;
      const onEdge = (c: typeof a, x: number, y: number) =>
        (Math.abs(x - c.x) < 0.02 || Math.abs(x - (c.x + c.w)) < 0.02 || Math.abs(y - c.y) < 0.02 || Math.abs(y - (c.y + c.h)) < 0.02) &&
        x >= c.x - 0.02 && x <= c.x + c.w + 0.02 && y >= c.y - 0.02 && y <= c.y + c.h + 0.02;
      expect(onEdge(a, link.x1, link.y1)).toBe(true);
      expect(onEdge(b, link.x2, link.y2)).toBe(true);
    }
    expect(thumbLayout(memo, box).links).toEqual([]);
  });
  it('大きくしすぎない（1 枚の型でも、元の大きさの 0.4 倍まで）。空の型は空', () => {
    const one = make('t9', '一枚', 'その他', ['だけ']);
    const lay = thumbLayout(one, { w: 400, h: 300 });
    expect(lay.cards[0].w).toBeCloseTo(TEMPLATE_GRID.cardW * 0.4, 1);
    expect(thumbLayout({ ...one, cards: [], links: [] }, box)).toEqual({ w: 96, h: 56, cards: [], links: [] });
  });
  it('種類が「疑問」の関連は破線', () => {
    const asked = { ...pro, links: pro.links.map((l) => ({ ...l, kind: 'ask' as const })) };
    expect(thumbLayout(asked, box).links.every((l) => l.dashed)).toBe(true);
    expect(thumbLayout(pro, box).links.every((l) => !l.dashed)).toBe(true);
  });
});