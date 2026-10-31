// 段 D7：書き足した画像を新しい一番上のカードにする計画（ui/src/annotate-card-plan.ts）
import { readFileSync } from 'node:fs';
import { unwrapT } from './source-text';
import { describe, expect, it, vi } from 'vitest';
import { MAX_LINKS_PER_CARD } from '../src/memo-card-links';
import { planAnnotatedCard } from '../src/annotate-card-plan';
import { MAX_REPLIES } from '../src/threads';

const memo = (replies: { id: string; parent: string | null; links?: { to: string }[] }[] = [{ id: 'old', parent: null }]) => ({
  id: 'memo1',
  replies,
});

const plan = (
  patch: Partial<{ version: 'annotated' | 'original'; marks: number; questions: string; source: { kind: 'card'; reply: string } | { kind: 'face' }; memoId: string; memo: ReturnType<typeof memo> | null }> = {},
) =>
  planAnnotatedCard({
    version: 'annotated',
    marks: 1,
    questions: '',
    source: { kind: 'card', reply: 'old' },
    memoId: 'memo1',
    memo: memo(),
    ...patch,
  });

describe('planAnnotatedCard', () => {
  it('印がある一番上のカードは、新しいカードと元からの補足になる。書いた人の印は付けない', () => {
    const done = plan({ questions: '  <b>太字</b>\u0000です\r\n次  ' });
    expect(done).toEqual({
      ok: true,
      memo: 'memo1',
      text: '<b>太字</b>です\n次',
      link: { from: 'old', kind: 'supplement' },
    });
    expect(done).not.toHaveProperty('by');
  });

  it('印が無い・元の画像を選んだときは置かない', () => {
    const note = '書き足しが無いので、足しませんでした';
    expect(plan({ marks: 0, questions: '問い' })).toEqual({ ok: false, note });
    expect(plan({ version: 'original', marks: 3, questions: '問い' })).toEqual({ ok: false, note });
  });

  it('元のカードが無い・メモが違うときは、何も置く計画にしない', () => {
    const note = '元のカードが見つかりません';
    expect(plan({ memo: null })).toEqual({ ok: false, note });
    expect(plan({ memoId: 'memo1', memo: { id: 'other', replies: [{ id: 'old', parent: null }] } })).toEqual({ ok: false, note });
    expect(plan({ source: { kind: 'card', reply: 'gone' } })).toEqual({ ok: false, note });
  });

  it('返信 300 件・関連 10 本は、カードも線も置かない', () => {
    const full = Array.from({ length: MAX_REPLIES }, (_, i) => ({ id: i === 0 ? 'old' : `x${i}`, parent: null as string | null }));
    expect(plan({ memo: memo(full) })).toEqual({ ok: false, note: `返信は1つのメモに ${MAX_REPLIES} 件までです` });
    const links = Array.from({ length: MAX_LINKS_PER_CARD }, (_, i) => ({ to: `t${i}` }));
    expect(plan({ memo: memo([{ id: 'old', parent: null, links }]) })).toEqual({ ok: false, note: `関連は 1 枚のカードから ${MAX_LINKS_PER_CARD} 本までです` });
  });

  it('下の返信と、メモのセルの顔は、カードだけ置く。線は付けない', () => {
    expect(plan({ source: { kind: 'card', reply: 'child' }, memo: memo([{ id: 'top', parent: null }, { id: 'child', parent: 'top' }]) })).toEqual({
      ok: true,
      memo: 'memo1',
      text: '',
      link: null,
    });
    const links = Array.from({ length: MAX_LINKS_PER_CARD }, (_, i) => ({ to: `t${i}` }));
    expect(plan({ source: { kind: 'face' }, questions: '顔の問い', memo: memo([{ id: 'old', parent: null, links }]) })).toEqual({
      ok: true,
      memo: 'memo1',
      text: '顔の問い',
      link: null,
    });
  });

  it('箱の問いの制御文字は消え、HTML のタグは文字のまま残る。空の行は捨てる', () => {
    const done = plan({ questions: '\u0007<i>残す</i>\u202e\n\n  \u0000  \n二行目' });
    expect(done).toMatchObject({ ok: true, text: '<i>残す</i>\n二行目' });
  });
});

describe('書き足しの配線', () => {
  const read = (path: string) => unwrapT(readFileSync(new URL(path, import.meta.url), 'utf8'));

  it('小窓の決めるボタンの文は今のまま。カード用の文は、渡したときだけ使う', () => {
    const edit = read('../src/panels/bot-image-edit.ts');
    expect(edit).toContain("done: '小窓に戻る（画像を付けて）'");
    expect(edit).toContain("done: '書き足した版を足す'");
    expect(read('../src/reader/ask.ts')).toContain('new BotImageEdit(readImageHints)');
  });

  it('下の区画は「書き足す…」から足す。書き足しただけでは写しもクリップボードも呼ばない', () => {
    const pane = read('../src/app/memo-pane.ts');
    expect(pane).toContain("label: '書き足す…'");
    expect(pane).toContain("command: 'addAnnotatedCard'");
    expect(pane).not.toContain('botShotSave');
    expect(pane).not.toContain('clipboardWriteImage');
    const primary = read('../src/app/primary.ts');
    expect(primary).toContain("label: '書き足す…'");
    const at = primary.indexOf("case 'addAnnotatedCard'");
    expect(at).toBeGreaterThan(-1);
    const block = primary.slice(at, primary.indexOf('case ', at + 20));
    expect(block).toContain('placeAnnotatedCard');
    expect(block).not.toContain('botShotSave');
    expect(block).not.toContain('clipboardWriteImage');
  });
});

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async (name: string) => (name === 'memocells.json' ? { status: 'ok', value: { version: 1, memos: [] } } : { status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

describe('MemoStore.placeAnnotatedCard', () => {
  async function store() {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const { MemoStore } = await import('../src/memocells');
    const memos = new MemoStore();
    await memos.load();
    return memos;
  }

  it('新しい一番上のカードを足す。元の画像は残り、補足が 1 本付く。updatedAt は変えない', async () => {
    const memos = await store();
    const memo = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ' });
    if (!memo) throw new Error('add');
    const origin = memos.addReply(memo.id, null, '元', undefined, { image: 'shotold1' });
    if (!origin) throw new Error('reply');
    const updated = memos.get(memo.id)?.updatedAt;
    const placed = memos.placeAnnotatedCard(memo.id, 'shotnew1', '  <b>問い</b>\u0000  ', origin.id);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const replies = memos.get(memo.id)?.replies ?? [];
    expect(replies).toHaveLength(2);
    expect(replies[0].image).toBe('shotold1');
    expect(replies[0].links).toEqual([{ to: placed.replyId, kind: 'supplement' }]);
    expect(replies[1]).toMatchObject({ id: placed.replyId, parent: null, text: '<b>問い</b>', image: 'shotnew1' });
    expect(replies[1].by).toBeUndefined();
    expect(replies[1].rank).toBeUndefined();
    expect(memos.get(memo.id)?.updatedAt).toBe(updated);
    expect(memos.undoSend(placed.token)).toEqual({ ok: true });
    const restored = memos.get(memo.id)?.replies ?? [];
    expect(restored).toHaveLength(1);
    expect(restored[0].image).toBe('shotold1');
    expect(restored[0].links).toBeUndefined();
  });

  it('下の返信とセルの顔は線を付けない。関連 10 本・読めない台帳・壊れた id は足さない', async () => {
    const memos = await store();
    const memo = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ' });
    if (!memo) throw new Error('add');
    const top = memos.addReply(memo.id, null, '上');
    const child = top ? memos.addReply(memo.id, top.id, '下', undefined, { image: 'shotchild' }) : null;
    if (!top || !child) throw new Error('reply');
    const fromChild = memos.placeAnnotatedCard(memo.id, 'shotchild2', '', child.id);
    expect(fromChild.ok).toBe(true);
    expect(memos.get(memo.id)?.replies?.find((r) => r.id === child.id)?.links).toBeUndefined();
    const face = memos.placeAnnotatedCard(memo.id, 'shotface1', '顔');
    expect(face.ok).toBe(true);
    const capped = memos.add({ pos: { q: 2, r: 0 }, text: '満杯' });
    if (!capped) throw new Error('add');
    const origin = memos.addReply(capped.id, null, '元', undefined, { image: 'shotold1' });
    if (!origin) throw new Error('origin');
    const add = [];
    for (let i = 0; i < MAX_LINKS_PER_CARD; i += 1) {
      const target = memos.addReply(capped.id, null, `相手${i}`);
      if (!target) throw new Error('target');
      add.push({ to: target.id, kind: 'supplement' as const });
    }
    expect(memos.changeReplyLinks(capped.id, origin.id, add, []).result).toBe('changed');
    const before = structuredClone(memos.get(capped.id)?.replies);
    expect(memos.placeAnnotatedCard(capped.id, 'shotmore', '問い', origin.id)).toEqual({ ok: false, note: `関連は 1 枚のカードから ${MAX_LINKS_PER_CARD} 本までです` });
    expect(memos.get(capped.id)?.replies).toEqual(before);
    expect(memos.placeAnnotatedCard(memo.id, 'shot-bad', '問い', top.id)).toEqual({ ok: false, note: 'その画像は、もうありません' });
    const { MemoStore } = await import('../src/memocells');
    const unread = new MemoStore();
    expect(unread.placeAnnotatedCard('m', 'shotok', '問い')).toEqual({ ok: false, note: '台帳を読めませんでした' });
  });
});
