// カードの印（♥・色。MK5。計画 docs/plan-comment-board-marks.md §3・§4.5）：値・隠す・台帳の置き換え・断り・控え・Grok・元に戻す・顔・断りの文
import { afterEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ ledger: 'ok' as 'ok' | 'failed', writes: [] as string[] }));

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async (name: string) => {
    if (name !== 'memocells.json') return { status: 'missing' };
    return io.ledger === 'ok' ? { status: 'ok', value: { version: 1, memos: [] } } : { status: 'failed' };
  },
  writeData: async (name: string) => {
    io.writes.push(name);
    return true;
  },
  deleteData: () => {},
  listData: async () => [],
}));

import { dropMarkValues, isMachineTag, isMarkTag, markCountNote, visibleTags } from '../src/grok-cards-tags';
import { buildExport, type ExportInput } from '../src/grok-export';
import { parseOp, type PatchWorld, planPatch, type GrokPatch } from '../src/grok-patch';
import { cardColor, cardLike, colorTag, isMarkValue, likeTag, MARK_COLORS, MARK_COUNT_NOTE, markAt, markFullNote, markOf, markValues, withMark } from '../src/likes';
import { tagFullMarkNote } from '../src/memo-card-board-edit';
import { hexFaceInfo } from '../src/memo-card-board-hex';
import { tagMenuEntries, type TagMenuInput } from '../src/memo-card-board-menu';
import { markCommand, markFull, markNow, markStateIs, mapOpIds, opLabel, undoButtons, UndoStack, type UndoOp } from '../src/memo-card-board-undo';
import { cardFace } from '../src/memo-card-board-view';
import type { LoadBoardResult } from '../src/memo-card-board-store';
import { emptyBoard } from '../src/memo-card-board';
import { buildTemplateFromCards } from '../src/memo-card-templates';
import { type MemoCell, MemoStore } from '../src/memocells';
import { normalizeTag } from '../src/tags';
import type { Reply } from '../src/threads';

afterEach(() => {
  io.ledger = 'ok';
  io.writes = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (id: string, text: string, createdAt: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text, createdAt, ...extra });
const ten = (n = 10) => Array.from({ length: n }, (_, i) => `t${i}`);

async function store() {
  vi.stubGlobal('window', { setTimeout: (fn: () => void) => fn(), clearTimeout });
  const memos = new MemoStore();
  await memos.load();
  return memos;
}

let seq = 0;
function memoWith(memos: MemoStore, replies: Reply[]) {
  const m = memos.add({ pos: { q: 100 + seq++, r: 0 }, text: `メモ ${seq}`, replies });
  if (!m) throw new Error('add');
  return m.id;
}

const repliesOf = (memos: MemoStore, id: string) => JSON.stringify(memos.get(id)?.replies ?? []);
const tagsOf = (memos: MemoStore, id: string, replyId: string) => memos.get(id)?.replies?.find((r) => r.id === replyId)?.tags;

describe('値（likes.ts）', () => {
  it('値は 6 つ：♥:1〜3 と ⬢:水・⬢:若草・⬢:赤紫。どれも normalizeTag をそのまま通る（台帳の読み込みで形が変わらない）', () => {
    expect(markValues).toEqual(['♥:1', '♥:2', '♥:3', '⬢:水', '⬢:若草', '⬢:赤紫']);
    expect([likeTag(1), likeTag(2), likeTag(3)]).toEqual(['♥:1', '♥:2', '♥:3']);
    expect(MARK_COLORS.map(colorTag)).toEqual(['⬢:水', '⬢:若草', '⬢:赤紫']);
    for (const v of markValues) expect(normalizeTag(v)).toBe(v);
  });

  it('cardLike：いちばん高い段。値の一覧に無いもの（♥:9・♥:0・U+FE0F 付き・空白入り）は読まない', () => {
    expect(cardLike([])).toBe(0);
    expect(cardLike(['考察', '♥:2'])).toBe(2);
    expect(cardLike(['♥:1', 'a', '♥:3'])).toBe(3);
    expect(cardLike(['♥:9', '♥:0', '♥️:2', '♥: 1', '♥:'])).toBe(0);
  });

  it('cardColor：並びの先に見つけた色の名前。値の一覧に無いもの（色:赤・⬢:赤）は読まない', () => {
    expect(cardColor([])).toBe('');
    expect(cardColor(['a', '⬢:若草', '⬢:水'])).toBe('若草');
    expect(cardColor(['色:赤', '⬢:赤', '⬢水'])).toBe('');
  });

  it('markOf：その種類の今の値（無ければ空）。isMarkValue：空か、その種類の値の一覧にあるものだけ', () => {
    expect(markOf(['♥:1', '♥:3', '⬢:水'], 'like')).toBe('♥:3');
    expect(markOf(['♥:1', '⬢:水'], 'color')).toBe('⬢:水');
    expect(markOf(['a'], 'like')).toBe('');
    expect(isMarkValue('like', '')).toBe(true);
    expect(isMarkValue('like', '♥:2')).toBe(true);
    expect(isMarkValue('like', '⬢:水')).toBe(false);
    expect(isMarkValue('color', '⬢:赤紫')).toBe(true);
    expect(isMarkValue('color', '♥:1')).toBe(false);
    expect(isMarkValue('like', '♥:9')).toBe(false);
  });

  it('withMark：最初にあった印の位置に置き、ほかの印は外す。無ければ後ろに足す。空なら外すだけ。変わらなければ null', () => {
    expect(withMark(['a', 'b'], 'like', '♥:1', 10)).toEqual(['a', 'b', '♥:1']);
    expect(withMark(['a', '♥:1', 'b'], 'like', '♥:2', 10)).toEqual(['a', '♥:2', 'b']);
    expect(withMark(['♥:1', 'a', '♥:3'], 'like', '', 10)).toEqual(['a']);
    expect(withMark(['♥:1', 'a', '♥:3'], 'like', '♥:2', 10)).toEqual(['♥:2', 'a']);
    expect(withMark(['a', '♥:2'], 'like', '♥:2', 10)).toBeNull();
    expect(withMark(['a'], 'like', '', 10)).toBeNull();
    expect(withMark(['⬢:水', '♥:1'], 'color', '⬢:赤紫', 10)).toEqual(['⬢:赤紫', '♥:1']); // ほかの種類の印は動かさない
    expect(withMark(['♥:9', '色:赤'], 'like', '♥:1', 10)).toEqual(['♥:9', '色:赤', '♥:1']); // 手で付けたふつうのタグは印でない
  });

  it('withMark の at：印が無いときだけ、その位置に足す（範囲の外は端へ）。印があるときは使わない。markAt：その種類の最初の印の位置（無ければ -1）', () => {
    expect(withMark(['a', 'b'], 'like', '♥:1', 10, 1)).toEqual(['a', '♥:1', 'b']);
    expect(withMark(['a', 'b'], 'like', '♥:1', 10, 0)).toEqual(['♥:1', 'a', 'b']);
    expect(withMark(['a', 'b'], 'like', '♥:1', 10, 9)).toEqual(['a', 'b', '♥:1']);
    expect(withMark(['a', 'b'], 'like', '♥:1', 10, -3)).toEqual(['♥:1', 'a', 'b']);
    expect(withMark(['a', '♥:2', 'b'], 'like', '♥:1', 10, 0)).toEqual(['a', '♥:1', 'b']);
    expect(withMark(ten(), 'like', '♥:1', 10, 0)).toBe('full');
    expect(markAt(['a', '⬢:水', '♥:2', '♥:1'], 'like')).toBe(2);
    expect(markAt(['a', '⬢:水', '♥:2'], 'color')).toBe(1);
    expect(markAt(['a', '♥:9'], 'like')).toBe(-1);
  });

  it('withMark の 10 個：新しく足して超えるなら full。今ある印を替える・外すのは数えない', () => {
    expect(withMark(ten(), 'like', '♥:1', 10)).toBe('full');
    expect(withMark([...ten(9), '♥:1'], 'like', '♥:3', 10)).toEqual([...ten(9), '♥:3']);
    expect(withMark([...ten(9), '♥:1'], 'like', '', 10)).toEqual(ten(9));
    expect(withMark([...ten(9), '♥:1'], 'color', '⬢:水', 10)).toBe('full');
    expect(withMark(ten(), 'like', '', 10)).toBeNull();
  });

  it('断りの文（計画 §9.2 の字）', () => {
    expect(markFullNote('like', 10)).toBe('タグが 10 個のカードには、いいねを付けられません（いいね・色の印も 1 つに数えます）');
    expect(markFullNote('color', 10)).toBe('タグが 10 個のカードには、色を付けられません（いいね・色の印も 1 つに数えます）');
    expect(MARK_COUNT_NOTE).toBe('（いいね・色の印も 1 つに数えます）');
  });
});

describe('隠す（grok-cards-tags.ts）', () => {
  it('isMarkTag は値の一覧とぴったり同じものだけ（頭の字では見ない）', () => {
    for (const v of markValues) expect(isMarkTag(v)).toBe(true);
    for (const v of ['♥:9', '♥:0', '♥:', '♥️:1', '♥:1 ', '#♥:1', '色:赤', '⬢:赤', '⬢:', 'いいね1', '♥']) expect(isMarkTag(v), v).toBe(false);
  });

  it('isMachineTag は印も真にする。visibleTags は印を除き、人が手で付けた ♥:9・色:赤 は見えるまま', () => {
    for (const v of markValues) expect(isMachineTag(v)).toBe(true);
    expect(visibleTags(['考察', '♥:2', '⬢:水', '♥:9', '色:赤', '宛て:b1111'])).toEqual(['考察', '♥:9', '色:赤']);
  });

  it('markCountNote：印が付いているときだけ、断りの後ろに足す一言', () => {
    expect(markCountNote(['a', '♥:1'])).toBe('（いいね・色の印も 1 つに数えます）');
    expect(markCountNote(['a', '⬢:赤紫'])).toBe('（いいね・色の印も 1 つに数えます）');
    expect(markCountNote(['a', '♥:9'])).toBe('');
    expect(markCountNote([])).toBe('');
  });

  it('dropMarkValues：ふつうのタグの命令の add・remove から、整えたあとに印になる値を捨てる（「#♥:1」「＃⬢:水」も）。ほかはそのまま（字でない値も。左の changeTagList が読み捨てる）', () => {
    expect(dropMarkValues(['新', '♥:1', '#♥:1', '＃⬢:水', ' ⬢:赤紫', '♥ :3', '♥:9', '色:赤', 3, null])).toEqual(['新', '♥:9', '色:赤', 3, null]);
    expect(dropMarkValues([])).toEqual([]);
    expect(dropMarkValues('♥:1')).toEqual([]);
    expect(dropMarkValues(undefined)).toEqual([]);
  });
});

describe('台帳（MemoStore.setReplyMark）', () => {
  it('§4.5 の例 1：♥ を 1→2→3→なし で、返信の JSON が元に戻る（タグ・関連・並びのあるカード。項目 tags の位置も動かない）', async () => {
    const memos = await store();
    const id = memoWith(memos, [card('a', '甲', 1, { tags: ['考察', '本'], links: [{ to: 'b', kind: 'ground' }], rank: 0 }), card('b', '乙', 2, { rank: 1 })]);
    const original = repliesOf(memos, id);
    const keys = Object.keys(memos.get(id)!.replies![0]);
    for (const level of [1, 2, 3] as const) {
      expect(memos.setReplyMark(id, 'a', 'like', likeTag(level))).toEqual({ ok: true, changed: true });
      expect(tagsOf(memos, id, 'a')).toEqual(['考察', '本', likeTag(level)]);
      expect(Object.keys(memos.get(id)!.replies![0])).toEqual(keys);
    }
    expect(memos.setReplyMark(id, 'a', 'like', '')).toEqual({ ok: true, changed: true });
    expect(repliesOf(memos, id)).toBe(original);
  });

  it('§4.5 の例 2：♥ の印が 2 つあるカードで外すと両方消える。付けると最初の位置に 1 つだけ', async () => {
    const memos = await store();
    const id = memoWith(memos, [card('a', '甲', 1, { tags: ['♥:1', '考察', '♥:3'] }), card('b', '乙', 2, { tags: ['♥:2', '本', '♥:1'] })]);
    expect(tagsOf(memos, id, 'a')).toEqual(['♥:1', '考察', '♥:3']); // 読み込みでは両方残る
    expect(memos.setReplyMark(id, 'a', 'like', '')).toEqual({ ok: true, changed: true });
    expect(tagsOf(memos, id, 'a')).toEqual(['考察']);
    expect(memos.setReplyMark(id, 'b', 'like', '♥:3')).toEqual({ ok: true, changed: true });
    expect(tagsOf(memos, id, 'b')).toEqual(['♥:3', '本']);
  });

  it('項目 tags の無い返信：足すと後ろに付き、外すと項目ごと消えて JSON が元に戻る。色も同じ', async () => {
    const memos = await store();
    const id = memoWith(memos, [card('a', '甲', 1, { links: [{ to: 'b', kind: 'ground' }], rank: 0 }), card('b', '乙', 2, { rank: 1 })]);
    const original = repliesOf(memos, id);
    expect('tags' in memos.get(id)!.replies![0]).toBe(false);
    memos.setReplyMark(id, 'a', 'color', '⬢:若草');
    const keys = Object.keys(memos.get(id)!.replies![0]);
    expect(keys[keys.length - 1]).toBe('tags');
    expect(tagsOf(memos, id, 'a')).toEqual(['⬢:若草']);
    memos.setReplyMark(id, 'a', 'like', '♥:2');
    expect(tagsOf(memos, id, 'a')).toEqual(['⬢:若草', '♥:2']);
    memos.setReplyMark(id, 'a', 'like', '');
    memos.setReplyMark(id, 'a', 'color', '');
    expect(repliesOf(memos, id)).toBe(original);
  });

  it('付けて外せば、待っている削除の取り消し（指紋）が通る', async () => {
    const memos = await store();
    const id = memoWith(memos, [card('a', '甲', 1, { tags: ['考察'], rank: 0 }), card('b', '乙', 2, { rank: 1 })]);
    memos.removeReply(id, 'b', 'ux1');
    memos.setReplyMark(id, 'a', 'like', '♥:2');
    memos.setReplyMark(id, 'a', 'like', '');
    expect(memos.restoreReplies(id, 'ux1')).toMatchObject({ ok: true });
    expect(memos.get(id)?.replies?.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('外して付け直す（元に戻す）と、返信の JSON が外す前に戻る：印だけで線・並びのある読み込み直したカード・印のあとにほかのタグ・2 種類の印', async () => {
    const memos = await store();
    // add は parseReplies を通る（読み込み直したのと同じ項目の並び：tags が links・rank より前）
    const id = memoWith(memos, [
      card('a', '甲', 1, { tags: ['♥:2'], links: [{ to: 'b', kind: 'ground' }], rank: 0 }),
      card('b', '乙', 2, { tags: ['x', '♥:1', 'y'], rank: 1 }),
      card('c', '丙', 3, { tags: ['♥:2', '⬢:水'], links: [{ to: 'a', kind: 'ground' }], rank: 2 }),
    ]);
    const original = repliesOf(memos, id);
    expect(Object.keys(memos.get(id)!.replies![0])).toEqual(['id', 'parent', 'text', 'createdAt', 'tags', 'links', 'rank']);
    memos.setReplyMark(id, 'a', 'like', '');
    expect('tags' in memos.get(id)!.replies![0]).toBe(false);
    memos.setReplyMark(id, 'a', 'like', '♥:2');
    expect(repliesOf(memos, id)).toBe(original);
    memos.setReplyMark(id, 'b', 'like', '');
    expect(tagsOf(memos, id, 'b')).toEqual(['x', 'y']);
    memos.setReplyMark(id, 'b', 'like', '♥:1');
    expect(tagsOf(memos, id, 'b')).toEqual(['x', '♥:1', 'y']);
    memos.setReplyMark(id, 'c', 'like', '');
    memos.setReplyMark(id, 'c', 'like', '♥:2');
    expect(repliesOf(memos, id)).toBe(original);
    // 2 種類とも外して、逆の順に付け直す（ボードの Ctrl+Z の順）
    memos.setReplyMark(id, 'c', 'like', '');
    memos.setReplyMark(id, 'c', 'color', '');
    expect('tags' in memos.get(id)!.replies![2]).toBe(false);
    memos.setReplyMark(id, 'c', 'color', '⬢:水');
    memos.setReplyMark(id, 'c', 'like', '♥:2');
    expect(repliesOf(memos, id)).toBe(original);
  });

  it('外して付け直す：tags が後ろにあるカード（changeReplyTags のあと）も、付けてからの「外す → 付け直す（やり直し）」も、JSON が戻る', async () => {
    const memos = await store();
    const id = memoWith(memos, [card('a', '甲', 1, { tags: ['考察', '♥:2'], links: [{ to: 'b', kind: 'ground' }], rank: 0 }), card('b', '乙', 2, { rank: 1 })]);
    memos.changeReplyTags(id, 'a', [], ['考察']);
    const keys = Object.keys(memos.get(id)!.replies![0]);
    expect(keys[keys.length - 1]).toBe('tags');
    const moved = repliesOf(memos, id);
    memos.setReplyMark(id, 'a', 'like', '');
    memos.setReplyMark(id, 'a', 'like', '♥:2');
    expect(repliesOf(memos, id)).toBe(moved);
    // 項目の無いカード：付ける → 外す（元に戻す）→ 付ける（やり直し）
    memos.setReplyMark(id, 'b', 'color', '⬢:赤紫');
    const marked = repliesOf(memos, id);
    memos.setReplyMark(id, 'b', 'color', '');
    memos.setReplyMark(id, 'b', 'color', '⬢:赤紫');
    expect(repliesOf(memos, id)).toBe(marked);
  });

  it('外したあとにタグが変わっていれば、覚えた位置は使わず後ろに足す。替える（♥1→♥2）は今の位置のまま', async () => {
    const memos = await store();
    const id = memoWith(memos, [card('a', '甲', 1, { tags: ['x', '♥:1', 'y'] })]);
    memos.setReplyMark(id, 'a', 'like', '');
    memos.changeReplyTags(id, 'a', ['z'], []);
    memos.setReplyMark(id, 'a', 'like', '♥:1');
    expect(tagsOf(memos, id, 'a')).toEqual(['x', 'y', 'z', '♥:1']);
    memos.setReplyMark(id, 'a', 'like', '♥:3');
    expect(tagsOf(memos, id, 'a')).toEqual(['x', 'y', 'z', '♥:3']);
  });

  it('間に削除を挟む：消す → 印を外す → 付け直す のあと、削除の取り消し（restoreReplies）が通る（印だけで線・並びのあるカード・印のあとにほかのタグ）', async () => {
    const memos = await store();
    const id = memoWith(memos, [
      card('a', '甲', 1, { tags: ['♥:2'], links: [{ to: 'b', kind: 'ground' }], rank: 0 }),
      card('b', '乙', 2, { tags: ['x', '⬢:水', 'y'], rank: 1 }),
      card('c', '丙', 3, { rank: 2 }),
    ]);
    const original = repliesOf(memos, id);
    memos.removeReply(id, 'c', 'ux1');
    memos.setReplyMark(id, 'a', 'like', '');
    memos.setReplyMark(id, 'b', 'color', '');
    memos.setReplyMark(id, 'b', 'color', '⬢:水');
    memos.setReplyMark(id, 'a', 'like', '♥:2');
    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: true, count: 3 });
    expect(repliesOf(memos, id)).toBe(original);
  });

  it('型の貼り付けの取り消し（undoSend）も、貼ったあとの印の「付けて外す」「外して付け直す」で指紋が崩れない', async () => {
    const memos = await store();
    const built = buildTemplateFromCards([card('t1', '型の甲', 1), card('t2', '型の乙', 2)], ['t1', 't2'], { name: '二枚', folder: '議論', newId: () => 'tpl1', now: 5 });
    if (!built.ok) throw new Error('型を作れない');
    const id = memoWith(memos, [card('a', '甲', 1, { tags: ['♥:2'], links: [{ to: 'b', kind: 'ground' }], rank: 0 }), card('b', '乙', 2, { rank: 1 })]);
    const original = repliesOf(memos, id);
    const done = memos.sendReplies({ template: built.template, toId: id });
    if (!done.ok) throw new Error('貼れない');
    memos.setReplyMark(id, 'a', 'like', '');
    memos.setReplyMark(id, 'a', 'like', '♥:2');
    memos.setReplyMark(id, 'b', 'color', '⬢:若草');
    memos.setReplyMark(id, 'b', 'color', '');
    expect(memos.undoSend(done.token)).toEqual({ ok: true });
    expect(repliesOf(memos, id)).toBe(original);
  });

  it('10 個の断り：新しく足して超えるなら full（台帳は変えない）。今ある印を替える・外すのは通る', async () => {
    const memos = await store();
    const id = memoWith(memos, [card('a', '甲', 1, { tags: ten() }), card('b', '乙', 2, { tags: [...ten(9), '♥:1'] })]);
    const before = repliesOf(memos, id);
    expect(memos.setReplyMark(id, 'a', 'like', '♥:1')).toEqual({ ok: false, why: 'full' });
    expect(memos.setReplyMark(id, 'b', 'color', '⬢:水')).toEqual({ ok: false, why: 'full' });
    expect(repliesOf(memos, id)).toBe(before);
    expect(memos.setReplyMark(id, 'b', 'like', '♥:3')).toEqual({ ok: true, changed: true });
    expect(tagsOf(memos, id, 'b')).toEqual([...ten(9), '♥:3']);
    expect(memos.setReplyMark(id, 'b', 'like', '')).toEqual({ ok: true, changed: true });
    expect(tagsOf(memos, id, 'b')).toEqual(ten(9));
  });

  it('変わらなければ changed: false（知らせも書きもしない）。値の一覧に無い値・種類の違う値・返信のカード・無いカード・無いメモは refused', async () => {
    const memos = await store();
    const id = memoWith(memos, [card('a', '甲', 1, { tags: ['♥:2'] }), { id: 'a1', parent: 'a', text: '返事', createdAt: 2 } as Reply]);
    let changes = 0;
    memos.onChange(() => changes++);
    expect(memos.setReplyMark(id, 'a', 'like', '♥:2')).toEqual({ ok: true, changed: false });
    expect(memos.setReplyMark(id, 'a', 'color', '')).toEqual({ ok: true, changed: false });
    expect(memos.setReplyMark(id, 'a', 'like', '♥:9')).toEqual({ ok: false, why: 'refused' });
    expect(memos.setReplyMark(id, 'a', 'like', '⬢:水')).toEqual({ ok: false, why: 'refused' });
    expect(memos.setReplyMark(id, 'a1', 'like', '♥:1')).toEqual({ ok: false, why: 'refused' });
    expect(memos.setReplyMark(id, 'zz', 'like', '♥:1')).toEqual({ ok: false, why: 'refused' });
    expect(memos.setReplyMark('nothing', 'a', 'like', '♥:1')).toEqual({ ok: false, why: 'refused' });
    expect(changes).toBe(0);
    await new Promise((r) => setTimeout(r, 0)); // 控えは読んでから書く（非同期）ので、待ってから見る
    expect(io.writes).not.toContain('memocells-before-card-marks.json');
  });

  it('台帳を読めなかった起動では refused', async () => {
    io.ledger = 'failed';
    const memos = await store();
    expect(memos.setReplyMark('m', 'a', 'like', '♥:1')).toEqual({ ok: false, why: 'refused' });
  });

  it('メモの updatedAt は進めない。初めて書く前に 1 回だけ控え memocells-before-card-marks.json（2 回目からは書かない）', async () => {
    const memos = await store();
    const id = memoWith(memos, [card('a', '甲', 1), card('b', '乙', 2)]);
    const at = memos.get(id)!.updatedAt;
    io.writes = [];
    memos.setReplyMark(id, 'a', 'like', '♥:1');
    memos.setReplyMark(id, 'b', 'color', '⬢:水');
    memos.setReplyMark(id, 'a', 'like', '');
    await new Promise((r) => setTimeout(r, 0));
    expect(memos.get(id)!.updatedAt).toBe(at);
    expect(io.writes.filter((n) => n === 'memocells-before-card-marks.json')).toHaveLength(1);
    expect(io.writes).not.toContain('memocells-before-card-tags.json');
  });

  it('ふつうのタグの付け外し（changeReplyTags）でも、印は残って数えに入る（10 個を超える分は足すほうが落ちる）', async () => {
    const memos = await store();
    const id = memoWith(memos, [card('a', '甲', 1, { tags: [...ten(9), '♥:2'] })]);
    expect(memos.changeReplyTags(id, 'a', ['新'], [])).toEqual({ result: 'same', over: true });
    expect(tagsOf(memos, id, 'a')).toEqual([...ten(9), '♥:2']);
  });
});

describe('Grok', () => {
  const memo = (replies: Reply[]): MemoCell => ({ id: 'm1', sheet: 'main', pos: { q: 0, r: 0 }, text: 'メモ', tags: [], liked: 0, island: null, replies, createdAt: 1, updatedAt: 2 });
  const input = (dropMarks?: boolean): ExportInput => ({
    scope: 'all',
    sheet: 'main',
    sheets: [{ id: 'main', name: 'メイン', color: '#000000', createdAt: 0 }],
    tabs: [],
    memos: [memo([card('a', '甲', 1, { tags: ['考察', '♥:2', '⬢:水', '♥:9'] }), card('b', '乙', 2, { tags: ['♥:1'] })])],
    islands: [],
    boardLinks: [],
    kindNames: {},
    ...(dropMarks === undefined ? {} : { dropMarks }),
  });
  const limits = { opsPerPatch: 200, tagsPerItem: 10, tagChars: 30, memoChars: 5000, cardChars: 20_000 };

  it('書き出し：dropMarks のときだけ印を落とす（タグが印だけのカードは tags を書かない）。落とさない書き出し（当てる前の写し）には残る', () => {
    const sent = buildExport(input(true), limits)!.data.cards;
    expect(sent.map((c) => c.tags)).toEqual([['考察', '♥:9'], undefined]);
    const kept = buildExport(input(), limits)!.data.cards;
    expect(kept.map((c) => c.tags)).toEqual([['考察', '♥:2', '⬢:水', '♥:9'], ['♥:1']]);
    expect(buildExport(input(false), limits)!.data.cards.map((c) => c.tags)).toEqual(kept.map((c) => c.tags));
  });

  it('提案：tags.add・tags.remove・card.add・memo.create は印の値を通さない（整えたあとの字で見る）。印だけなら noTags', () => {
    const t = { card: { memo: 'm1', id: 'a' } };
    expect(parseOp({ op: 'tags.add', target: t, tags: ['新', '♥:3', '#⬢:赤紫', '♥:9'] })).toMatchObject({ tags: ['新', '♥:9'] });
    expect(parseOp({ op: 'tags.remove', target: t, tags: ['♥:2'] })).toBe('noTags');
    expect(parseOp({ op: 'card.add', memo: 'm1', parent: null, text: '新しい', tags: ['♥:1', '本'] })).toMatchObject({ tags: ['本'] });
    expect(parseOp({ op: 'memo.create', text: 'メモ', tags: ['⬢:水', '題'] })).toMatchObject({ tags: ['題'] });
  });

  const world = (tags: string[]): PatchWorld =>
    ({
      memo: (id: string) => (id === 'm1' ? { id: 'm1', sheet: 'main', text: 'メモ', tags: [], island: null, special: false, updatedAt: 1, replies: [{ id: 'a', parent: null, text: '甲', tags, createdAt: 1 }] } : undefined),
      maxTags: 10,
    }) as unknown as PatchWorld;
  const patch = (ops: GrokPatch['ops']): GrokPatch => ({ v: 1, type: 'patch', id: 'p', title: '', note: '', basedOn: null, ops });

  it('提案の一覧：前後の字は印を出さない。上限は印も数える（生のまま）。超えたら断りに印の一言', () => {
    const [ok] = planPatch(patch([{ op: 'tags.add', target: { kind: 'card', memo: 'm1', id: 'a' }, tags: ['新'] }]), world(['考察', '♥:2']));
    expect(ok.status).toBe('ok');
    expect(ok.before).toBe('#考察');
    expect(ok.after).toBe('#考察 #新');
    const [full] = planPatch(patch([{ op: 'tags.add', target: { kind: 'card', memo: 'm1', id: 'a' }, tags: ['新'] }]), world([...ten(9), '⬢:水']));
    expect(full.status).toBe('refused');
    expect(full.notes).toEqual(['タグは 1 つに 10 個までです（いいね・色の印も 1 つに数えます）']);
    const [plain] = planPatch(patch([{ op: 'tags.add', target: { kind: 'card', memo: 'm1', id: 'a' }, tags: ['新'] }]), world(ten()));
    expect(plain.notes).toEqual(['タグは 1 つに 10 個までです']);
    const [onlyMark] = planPatch(patch([{ op: 'tags.add', target: { kind: 'card', memo: 'm1', id: 'a' }, tags: ['新'] }]), world(['♥:1']));
    expect([onlyMark.before, onlyMark.after]).toEqual(['（なし）', '#新']);
  });
});

describe('元に戻す（mark）', () => {
  const like = (before: string, after: string): UndoOp => ({ kind: 'mark', id: 'a', mark: 'like', before, after });
  const color = (before: string, after: string): UndoOp => ({ kind: 'mark', id: 'a', mark: 'color', before, after });
  const okLoad = (): LoadBoardResult => ({ state: 'ok', layout: 'square', board: emptyBoard('m1') }) as unknown as LoadBoardResult;
  const bad = { state: 'unreadable', layout: 'square', why: 'failed' } as unknown as LoadBoardResult;

  it('opLabel：いいね・色を 付ける・外す・変える（計画 §9.2 の字）', () => {
    expect(opLabel(like('', '♥:1'))).toBe('いいねを付ける');
    expect(opLabel(like('♥:1', ''))).toBe('いいねを外す');
    expect(opLabel(like('♥:1', '♥:2'))).toBe('いいねを変える');
    expect(opLabel(color('', '⬢:水'))).toBe('色を付ける');
    expect(opLabel(color('⬢:水', ''))).toBe('色を外す');
    expect(opLabel(color('⬢:水', '⬢:赤紫'))).toBe('色を変える');
  });

  it('mapOpIds：カードの id を付け替える（ほかはそのまま）', () => {
    expect(mapOpIds(like('', '♥:1'), new Map([['a', 'n1']]))).toEqual({ kind: 'mark', id: 'n1', mark: 'like', before: '', after: '♥:1' });
    expect(mapOpIds(like('', '♥:1'), new Map([['x', 'n1']]))).toEqual(like('', '♥:1'));
  });

  it('積み：印は形を持たない（peekLayout が null。やり直しへ移っても null）。ほかの操作は今までどおり形を持つ', () => {
    const s = new UndoStack();
    s.push(like('', '♥:1'), 'hex');
    expect(s.peekLayout('undo')).toBeNull();
    const op = s.take('undo')!;
    s.finish('undo', op, s.version, 'hex');
    expect(s.peekLayout('redo')).toBeNull();
    s.push({ kind: 'add', id: 'b', text: 'x', at: { x: 0, y: 0 } }, 'hex');
    expect(s.peekLayout('undo')).toBe('hex');
  });

  it('undoButtons：次が印なら、読み込み中・読めないボード・形の違いでも押せる。次がほかの操作なら今までどおり止める', () => {
    for (const load of [null, bad]) {
      const b = undoButtons({ undo: like('', '♥:1'), redo: color('⬢:水', ''), busy: false, load, layout: { now: 'square', undo: 'hex', redo: 'hex' } });
      expect(b.undo).toEqual({ enabled: true, note: '「いいねを付ける」を元に戻します（Ctrl+Z）' });
      expect(b.redo).toEqual({ enabled: true, note: '「色を外す」をやり直します（Ctrl+Shift+Z／Ctrl+Y）' });
    }
    const mv: UndoOp = { kind: 'move', moves: [{ ref: 'a', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }] };
    expect(undoButtons({ undo: mv, redo: like('', '♥:1'), busy: false, load: null }).undo.enabled).toBe(false);
    expect(undoButtons({ undo: mv, redo: like('', '♥:1'), busy: false, load: null }).redo.enabled).toBe(true);
    expect(undoButtons({ undo: mv, redo: null, busy: false, load: okLoad(), layout: { now: 'square', undo: 'hex', redo: null } }).undo.enabled).toBe(false);
    expect(undoButtons({ undo: like('', '♥:1'), redo: null, busy: true, load: okLoad() }).undo.enabled).toBe(false); // 戻している途中は止める
  });

  it('命令と確かめ：markCommand は setReplyMark。markNow・markStateIs は一番上のカードの今の値。markFull は新しく足して 10 個を超えるときだけ', () => {
    expect(markCommand('m1', 'a', 'color', '⬢:水')).toEqual({ command: 'setReplyMark', id: 'm1', replyId: 'a', kind: 'color', value: '⬢:水' });
    const rs = [card('a', '甲', 1, { tags: ['♥:1', '♥:3'] }), card('b', '乙', 2, { tags: ten() }), { id: 'a1', parent: 'a', text: '返事', createdAt: 3 } as Reply];
    expect(markNow(rs, 'a', 'like')).toBe('♥:3');
    expect(markNow(rs, 'a', 'color')).toBe('');
    expect(markNow(rs, 'a1', 'like')).toBeNull();
    expect(markNow(rs, 'zz', 'like')).toBeNull();
    expect(markStateIs(rs, 'a', 'like', '♥:3')).toBe(true);
    expect(markStateIs(rs, 'b', 'like', '')).toBe(true);
    expect(markStateIs(rs, 'zz', 'like', '')).toBe(false); // 無いカードは、どの値にもなっていない
    expect(markFull(rs, 'b', 'like', '♥:1', 10)).toBe(true);
    expect(markFull(rs, 'b', 'like', '', 10)).toBe(false);
    expect(markFull(rs, 'a', 'like', '♥:2', 10)).toBe(false);
  });
});

describe('顔と断りの文', () => {
  it('CardFace と HexFaceInfo に like（0〜3）と color（名前か空）。顔のタグには印を出さない', () => {
    const a = card('a', '甲', 1, { tags: ['考察', '♥:2', '⬢:赤紫'] });
    const face = cardFace([a], a, { x: 0, y: 0, saved: true });
    expect(face).toMatchObject({ like: 2, color: '赤紫', tags: ['考察'], moreTags: 0 });
    expect(hexFaceInfo([a], a, 0)).toMatchObject({ like: 2, color: '赤紫', tag: '考察', more: 0 });
    const ai = card('b', '乙', 2, { tags: ['♥:3'], by: { who: 'grok', name: 'Grok' } });
    expect(hexFaceInfo([ai], ai, 0)).toMatchObject({ like: 3, color: '', more: 0, who: 'Grok' });
    const photo = card('p', '題', 3, { image: 'shot1', tags: ['⬢:水'] });
    expect(hexFaceInfo([photo], photo, 0)).toMatchObject({ like: 0, color: '水', title: '題', more: 0 });
    const plain = card('c', '丙', 4);
    expect(cardFace([plain], plain, { x: 0, y: 0, saved: true })).toMatchObject({ like: 0, color: '' });
  });

  it('タグの段の上限：印が付いているカードだけ、断りの後ろに一言。付いているタグの囲みに印は出さない', () => {
    const input = (tags: string[]): TagMenuInput => ({ replies: [card('t', '本文', 1, { tags })], id: 't', pool: [], back: () => {}, add: () => {}, write: () => {} });
    const marked = tagMenuEntries(input([...ten(9), '♥:1']));
    expect(marked[2]).toEqual({ note: 'タグは 1 つに 10 個までです。ほかのタグを外してから付けてください（いいね・色の印も 1 つに数えます）' });
    expect(marked[3]).toEqual({ note: `付いているタグ：${ten(9).join('、')}` });
    const plain = tagMenuEntries(input(ten()));
    expect(plain[2]).toEqual({ note: 'タグは 1 つに 10 個までです。ほかのタグを外してから付けてください' });
    const room = tagMenuEntries(input(['考察', '⬢:水']));
    expect(room.map((e) => (typeof e === 'object' && 'note' in e ? e.note : null)).filter(Boolean)).toEqual(['付いているタグ：考察']);
  });

  it('ボードのタグの上限（tagFullMarkNote）：止まったカードに印があるときだけ一言。印が止まっていない別のカードにだけあるときは出さない', () => {
    const rs = [
      card('m', '印つきで満杯', 1, { tags: [...ten(9), '♥:1'] }),
      card('p', '印なしで満杯', 2, { tags: ten() }),
      card('r', '印つきで空きあり', 3, { tags: ['考察', '⬢:水'] }),
    ];
    expect(tagFullMarkNote(rs, ['m'], ['新'], 10)).toBe(MARK_COUNT_NOTE);
    expect(tagFullMarkNote(rs, ['p', 'm', 'r'], ['新'], 10)).toBe(MARK_COUNT_NOTE);
    expect(tagFullMarkNote(rs, ['p'], ['新'], 10)).toBe('');
    expect(tagFullMarkNote(rs, ['p', 'r'], ['新'], 10)).toBe(''); // 印は止まっていない r にだけある
    expect(tagFullMarkNote(rs, ['m'], ['t0'], 10)).toBe(''); // もう付いているタグは止まらない
    expect(tagFullMarkNote(rs, ['m'], [], 10)).toBe('');
  });
});
