// ボードの元に戻す・やり直し（B3-3b）：積み・命令・確かめ・文の計算（memo-card-board-undo.ts）と、左の台帳との組み合わせ、画面の配線
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

import { buildTemplateFromCards } from '../src/memo-card-templates';
import { deleteCommands, deleteTitle } from '../src/memo-card-board-edit';
import { emptyBoard } from '../src/memo-card-board';
import { planBoardPaste, planRepaste } from '../src/memo-card-board-paste';
import {
  addUndoCommand,
  linkKindOf,
  linkSetCommand,
  linkStateIs,
  mapOpIds,
  moveTargets,
  newUndoToken,
  opLabel,
  pasteUndoCommand,
  REDO_EMPTY_NOTE,
  restoreCommand,
  restoreMoves,
  UNDO_EMPTY_NOTE,
  UNDO_LIMIT,
  undoBlockedNote,
  undoButtons,
  undoDoneText,
  UndoStack,
  type UndoOp,
} from '../src/memo-card-board-undo';
import { isRestoreToken, MemoStore } from '../src/memocells';
import { DEFAULT_VIEW } from '../src/memo-card-board';
import type { LoadBoardResult } from '../src/memo-card-board-store';
import type { Reply } from '../src/threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (id: string, text: string, createdAt: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text, createdAt, ...extra });
const mv = (n: number): UndoOp => ({ kind: 'move', moves: [{ ref: `c${n}`, from: { x: 0, y: 0 }, to: { x: n, y: n } }] });
const okLoad = (): LoadBoardResult => ({ state: 'ok', board: emptyBoard('m1') } as unknown as LoadBoardResult);

describe('UndoStack（積み）', () => {
  it('積む→取り出す→成功したら反対側へ。新しい操作を積むとやり直しは空になる', () => {
    const s = new UndoStack();
    expect(s.take('undo')).toBeNull();
    s.push(mv(1));
    s.push(mv(2));
    expect(s.undoCount).toBe(2);
    const v = s.version;
    const op = s.take('undo');
    expect(op).toEqual(mv(2));
    expect(s.undoCount).toBe(1);
    if (op) s.finish('undo', op, v);
    expect(s.redoCount).toBe(1);
    expect(s.peekRedo()).toEqual(mv(2));
    const re = s.take('redo');
    if (re) s.finish('redo', re, s.version);
    expect(s.undoCount).toBe(2);
    expect(s.redoCount).toBe(0);
    // 戻してから別の操作をすると、やり直しは消える
    const again = s.take('undo');
    if (again) s.finish('undo', again, s.version);
    expect(s.redoCount).toBe(1);
    s.push(mv(3));
    expect(s.redoCount).toBe(0);
    expect(s.peekUndo()).toEqual(mv(3));
  });

  it('戻せなかったとき（finish しない）は、その 1 件だけ積みから外れる。ほかは残る', () => {
    const s = new UndoStack();
    s.push(mv(1));
    s.push(mv(2));
    s.push(mv(3));
    expect(s.take('undo')).toEqual(mv(3)); // 戻せなかった：finish しない
    expect(s.undoCount).toBe(2);
    expect(s.redoCount).toBe(0);
    expect(s.peekUndo()).toEqual(mv(2));
  });

  it(`${UNDO_LIMIT} 回まで：超えたら古いものから捨てる`, () => {
    const s = new UndoStack();
    for (let i = 0; i < UNDO_LIMIT + 10; i++) s.push(mv(i));
    expect(s.undoCount).toBe(UNDO_LIMIT);
    const order: number[] = [];
    for (let op = s.take('undo'); op; op = s.take('undo')) order.push(op.kind === 'move' ? op.moves[0].to.x : -1);
    expect(order[0]).toBe(UNDO_LIMIT + 9);
    expect(order[order.length - 1]).toBe(10); // 0〜9 は捨てられた
  });

  it('やり直しの積みも同じ数まで。clear で空になり、版が変わる。戻している最中に新しい操作が入ったら、戻した操作はやり直しへ入らない', () => {
    const s = new UndoStack();
    for (let i = 0; i < UNDO_LIMIT; i++) s.push(mv(i));
    for (let i = 0; i < UNDO_LIMIT; i++) {
      const op = s.take('undo');
      if (op) s.finish('undo', op, s.version);
    }
    expect(s.redoCount).toBe(UNDO_LIMIT);
    s.clear();
    expect(s.undoCount + s.redoCount).toBe(0);

    s.push(mv(1));
    const v = s.version;
    const op = s.take('undo');
    s.push(mv(2)); // 戻している最中に、新しい操作
    if (op) s.finish('undo', op, v);
    expect(s.redoCount).toBe(0);
    expect(s.peekUndo()).toEqual(mv(2));
    const before = s.version;
    s.clear();
    expect(s.version).not.toBe(before);
  });

  it('remapRedo：型を貼り直して id が替わったとき、やり直しの積みの古い id を新しい id に付け替える（全部の種類）', () => {
    const s = new UndoStack();
    const ops: UndoOp[] = [
      { kind: 'move', moves: [{ ref: 'old1', from: { x: 1, y: 1 }, to: { x: 2, y: 2 } }, { ref: 'keep', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }] },
      { kind: 'link', from: 'old1', to: 'old2', before: null, after: 'ground' },
      { kind: 'remove', ids: ['old2', 'keep'], at: { old2: { x: 9, y: 9 }, keep: { x: 1, y: 1 } }, token: 'ut' },
      { kind: 'add', id: 'old1', text: 'あ', at: { x: 0, y: 0 } },
    ];
    // やり直しの積みに入れる：積む→戻す、を順に
    for (const op of ops) s.push(op);
    for (let i = 0; i < ops.length; i++) {
      const op = s.take('undo');
      if (op) s.finish('undo', op, s.version);
    }
    s.remapRedo(new Map([['old1', 'new1'], ['old2', 'new2']]));
    const out: UndoOp[] = [];
    for (let op = s.take('redo'); op; op = s.take('redo')) out.push(op);
    expect(out).toEqual([
      { kind: 'move', moves: [{ ref: 'new1', from: { x: 1, y: 1 }, to: { x: 2, y: 2 } }, { ref: 'keep', from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }] },
      { kind: 'link', from: 'new1', to: 'new2', before: null, after: 'ground' },
      { kind: 'remove', ids: ['new2', 'keep'], at: { new2: { x: 9, y: 9 }, keep: { x: 1, y: 1 } }, token: 'ut' },
      { kind: 'add', id: 'new1', text: 'あ', at: { x: 0, y: 0 } },
    ]);
    const tpl = buildTemplateFromCards([card('a', '甲', 1), card('b', '乙', 2)], ['a', 'b'], { name: '二枚', folder: '議論', newId: () => 't1', now: 5 });
    if (!tpl.ok) throw new Error('型');
    expect(mapOpIds({ kind: 'paste', template: tpl.template, ids: ['old1', 'x'], at: [], token: 't' }, new Map([['old1', 'n']]))).toMatchObject({ ids: ['n', 'x'] });
  });
});

describe('文とボタン', () => {
  it('opLabel：操作の名前', () => {
    const tpl = buildTemplateFromCards([card('a', '甲', 1), card('b', '乙', 2)], ['a', 'b'], { name: '二枚', folder: '議論', newId: () => 't1', now: 5 });
    if (!tpl.ok) throw new Error('型');
    expect(opLabel(mv(1))).toBe('カードの移動');
    expect(opLabel({ kind: 'move', moves: [mv(1), mv(2)].flatMap((o) => (o.kind === 'move' ? o.moves : [])) })).toBe('カードの移動（2枚）');
    expect(opLabel({ kind: 'add', id: 'a', text: 'x', at: { x: 0, y: 0 } })).toBe('カードを足す');
    expect(opLabel({ kind: 'remove', ids: ['a'], at: {}, token: 'u1' })).toBe('削除');
    expect(opLabel({ kind: 'remove', ids: ['a', 'b', 'c'], at: {}, token: 'u1' })).toBe('削除（3枚）');
    expect(opLabel({ kind: 'link', from: 'a', to: 'b', before: null, after: 'ground' })).toBe('関連を付ける');
    expect(opLabel({ kind: 'link', from: 'a', to: 'b', before: 'ground', after: null })).toBe('関連を外す');
    expect(opLabel({ kind: 'link', from: 'a', to: 'b', before: 'ground', after: 'same' })).toBe('関連の種類を変える');
    expect(opLabel({ kind: 'paste', template: tpl.template, ids: ['a', 'b'], at: [], token: null })).toBe('型「二枚」の貼り付け');
    expect(undoDoneText(mv(1), 'undo')).toBe('「カードの移動」を元に戻しました');
    expect(undoDoneText(mv(1), 'redo')).toBe('「カードの移動」をやり直しました');
  });

  it('undoButtons：空・戻している最中・ボードに書けない・押せる（理由と何を戻すかをツールチップに）', () => {
    expect(undoButtons({ undo: null, redo: null, busy: false, load: okLoad() })).toEqual({ undo: { enabled: false, note: UNDO_EMPTY_NOTE }, redo: { enabled: false, note: REDO_EMPTY_NOTE } });
    const on = undoButtons({ undo: mv(1), redo: mv(2), busy: false, load: okLoad() });
    expect(on.undo).toEqual({ enabled: true, note: '「カードの移動」を元に戻します（Ctrl+Z）' });
    expect(on.redo).toEqual({ enabled: true, note: '「カードの移動」をやり直します（Ctrl+Shift+Z／Ctrl+Y）' });
    const busy = undoButtons({ undo: mv(1), redo: mv(2), busy: true, load: okLoad() });
    expect([busy.undo.enabled, busy.redo.enabled]).toEqual([false, false]);
    expect(busy.undo.note).toContain('途中');
    const loading = undoButtons({ undo: mv(1), redo: null, busy: false, load: null });
    expect(loading.undo.enabled).toBe(false);
    expect(loading.undo.note).toBe('ボードを読み込み中です。少し待ってから操作してください');
    expect(undoBlockedNote(null)).not.toBeNull();
    expect(undoBlockedNote(okLoad())).toBeNull();
    expect(undoBlockedNote({ state: 'unreadable', why: 'failed' } as unknown as LoadBoardResult)).toContain('元に戻せません（書き込みません）');
  });

  it('削除のツールチップは「Ctrl+Z で元に戻せます」（もう戻せないとは書かない）', () => {
    expect(deleteTitle(2)).toContain('Ctrl+Z で元に戻せます');
    expect(deleteTitle(2)).not.toContain('戻すことはできません');
  });
});

describe('命令と確かめ', () => {
  it('newUndoToken：左の形（u で始まる 64 字以内）に通る。操作ごとに違う', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = newUndoToken();
      expect(isRestoreToken(t)).toBe(true);
      expect(t.length).toBeLessThanOrEqual(64);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
    expect(newUndoToken(0, () => 0)).toBe('u0000000');
    expect(isRestoreToken(newUndoToken(Number.MAX_SAFE_INTEGER, () => 0.999999999))).toBe(true);
  });

  it('命令：restoreReplies・足したカードを消す（undoToken なし）・undoSendReplies', () => {
    expect(restoreCommand('m1', 'ux')).toEqual({ command: 'restoreReplies', id: 'm1', token: 'ux' });
    expect(addUndoCommand('m1', 'r1')).toEqual({ command: 'removeReply', ref: { kind: 'memo', id: 'm1' }, replyId: 'r1' });
    expect('undoToken' in addUndoCommand('m1', 'r1')).toBe(false);
    expect(pasteUndoCommand('ut')).toEqual({ command: 'undoSendReplies', token: 'ut' });
  });

  it('deleteCommands：undoToken を付けると全部に同じ token。付けなければ今までどおり（キー自体が無い）', () => {
    const replies = [card('a', '甲', 1), card('b', '乙', 2), card('c', '丙', 3)];
    const withToken = deleteCommands('m1', replies, ['a', 'c', 'zzz'], 'ux1');
    expect(withToken).toEqual([
      { command: 'removeReply', ref: { kind: 'memo', id: 'm1' }, replyId: 'a', undoToken: 'ux1' },
      { command: 'removeReply', ref: { kind: 'memo', id: 'm1' }, replyId: 'c', undoToken: 'ux1' },
    ]);
    const plain = deleteCommands('m1', replies, ['a']);
    expect(plain).toEqual([{ command: 'removeReply', ref: { kind: 'memo', id: 'm1' }, replyId: 'a' }]);
    expect('undoToken' in plain[0]).toBe(false);
  });

  it('線：付ける・外す・種類を変える（置き換え）の戻し方。変えるものが無ければ命令なし', () => {
    expect(linkSetCommand('m', 'a', 'b', null, 'ground')).toEqual({ command: 'changeReplyLinks', id: 'm', replyId: 'a', add: [{ to: 'b', kind: 'ground' }], remove: [] });
    expect(linkSetCommand('m', 'a', 'b', 'ground', null)).toEqual({ command: 'changeReplyLinks', id: 'm', replyId: 'a', add: [], remove: [{ to: 'b', kind: 'ground' }] });
    expect(linkSetCommand('m', 'a', 'b', 'ground', 'same')).toEqual({ command: 'changeReplyLinks', id: 'm', replyId: 'a', add: [{ to: 'b', kind: 'same' }], remove: [] });
    expect(linkSetCommand('m', 'a', 'b', 'same', 'same')).toBeNull();
    expect(linkSetCommand('m', 'a', 'b', null, null)).toBeNull();
    const replies = [card('a', '甲', 1, { links: [{ to: 'b', kind: 'ground' }] }), card('b', '乙', 2)];
    expect(linkKindOf(replies, 'a', 'b')).toBe('ground');
    expect(linkKindOf(replies, 'b', 'a')).toBeNull();
    expect(linkStateIs(replies, 'a', 'b', 'ground')).toBe(true);
    expect(linkStateIs(replies, 'a', 'b', null)).toBe(false);
    expect(linkStateIs(replies, 'b', 'a', null)).toBe(true);
  });

  it('移動：戻すは from・やり直すは to。台帳に残っていないカードは含めない。消したカードの座標は at から', () => {
    const op: Extract<UndoOp, { kind: 'move' }> = { kind: 'move', moves: [{ ref: 'a', from: { x: 1, y: 2 }, to: { x: 10, y: 20 } }, { ref: 'gone', from: { x: 5, y: 5 }, to: { x: 6, y: 6 } }] };
    const replies = [card('a', '甲', 1)];
    expect(moveTargets(op, 'undo', replies)).toEqual([{ ref: 'a', x: 1, y: 2 }]);
    expect(moveTargets(op, 'redo', replies)).toEqual([{ ref: 'a', x: 10, y: 20 }]);
    expect(moveTargets(op, 'undo', [])).toEqual([]);
    expect(restoreMoves({ kind: 'remove', ids: ['a', 'b'], at: { a: { x: 3, y: 4 } }, token: 'u1' })).toEqual([{ ref: 'a', x: 3, y: 4 }]);
  });
});

describe('型の貼り直し（planRepaste）', () => {
  const tpl = () => {
    const built = buildTemplateFromCards([card('a', '甲', 1), card('b', '乙', 2, { links: [{ to: 'a', kind: 'ground' }] })], ['a', 'b'], { name: '二枚', folder: '議論', newId: () => 't1', now: 5, offsets: { a: { dx: 0, dy: 0 }, b: { dx: 210, dy: 0 } } });
    if (!built.ok) throw new Error('型');
    return built.template;
  };
  const input = { memoId: 'm1', template: tpl(), replies: [card('x', '既存', 9)], load: okLoad(), at: [{ x: 100, y: 200 }, { x: 310, y: 200 }] };

  it('同じ型・同じ位置・新しい id で貼る命令を作る（ids は型のカードと同じ数・順）', () => {
    const plan = planRepaste(input);
    if (!plan.ok) throw new Error(plan.note);
    expect(plan.ids).toHaveLength(2);
    expect(plan.ids.every((id) => id !== 'x')).toBe(true);
    expect(plan.moves).toEqual([{ ref: plan.ids[0], x: 100, y: 200 }, { ref: plan.ids[1], x: 310, y: 200 }]);
    expect(plan.command).toMatchObject({ command: 'sendReplies', from: '', replyIds: [], to: 'm1', mode: 'copy', ids: plan.ids });
    const other = planRepaste(input);
    if (!other.ok) throw new Error(other.note);
    expect(other.ids).not.toEqual(plan.ids); // 貼るたびに新しい id
  });

  it('断る：位置の数が違う・ボードの外・読み込み中・読めない・台帳が 300 件・型が読めない（何も送らない）', () => {
    expect(planRepaste({ ...input, at: [{ x: 0, y: 0 }] })).toMatchObject({ ok: false });
    expect(planRepaste({ ...input, at: [{ x: 99999, y: 0 }, { x: 0, y: 0 }] })).toMatchObject({ ok: false });
    expect(planRepaste({ ...input, load: null })).toMatchObject({ ok: false });
    expect(planRepaste({ ...input, load: { state: 'unreadable', why: 'failed' } as unknown as LoadBoardResult })).toMatchObject({ ok: false });
    const full = Array.from({ length: 299 }, (_, i) => card(`k${i}`, 'x', i));
    expect(planRepaste({ ...input, replies: full })).toMatchObject({ ok: false });
    expect(planRepaste({ ...input, template: { nope: 1 } })).toMatchObject({ ok: false });
  });

  it('planBoardPaste の断り方は今までどおり（共通の確かめに移しただけ）', () => {
    const view = { ...DEFAULT_VIEW };
    const refused = planBoardPaste({ memoId: 'm1', template: tpl(), replies: [], load: null, view, viewport: { w: 800, h: 600 }, taken: [] });
    expect(refused).toEqual({ ok: false, note: 'ボードを読み込み中です。少し待ってから貼ってください' });
    const ok = planBoardPaste({ memoId: 'm1', template: tpl(), replies: [], load: okLoad(), view, viewport: { w: 800, h: 600 }, taken: [] });
    expect(ok.ok).toBe(true);
  });
});

describe('左の台帳との組み合わせ（ボードが送る命令を台帳に当てる）', () => {
  async function store() {
    vi.stubGlobal('window', { setTimeout: (fn: () => void) => fn(), clearTimeout });
    const memos = new MemoStore();
    await memos.load();
    return memos;
  }
  const sample = (): Reply[] => [card('a', '甲', 1, { rank: 0 }), card('b', '乙', 2, { rank: 1, links: [{ to: 'a', kind: 'ground' }] }), { id: 'b1', parent: 'b', text: '乙の返事', createdAt: 3 } as Reply, card('c', '丙', 4, { rank: 2, links: [{ to: 'b', kind: 'ground' }] })];
  const snap = (memos: MemoStore, id: string) => JSON.stringify(memos.get(id)?.replies ?? []);

  function apply(memos: MemoStore, memoId: string, cmd: ReturnType<typeof deleteCommands>[number]) {
    if (cmd.command !== 'removeReply' || cmd.ref.kind !== 'memo') throw new Error('removeReply ではない');
    memos.removeReply(cmd.ref.id, cmd.replyId, cmd.undoToken);
    expect(cmd.ref.id).toBe(memoId);
  }

  it('削除（何枚か・同じ undoToken）→ restoreReplies で 1 回で全部（関連・順・返事ごと）戻る→消し直し（新しい token）→もう一度戻る', async () => {
    const memos = await store();
    const m = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ', replies: sample() });
    if (!m) throw new Error('add');
    const original = snap(memos, m.id);
    const token = newUndoToken();
    for (const cmd of deleteCommands(m.id, memos.get(m.id)?.replies ?? [], ['a', 'b', 'c'], token)) apply(memos, m.id, cmd);
    expect(memos.get(m.id)?.replies).toEqual([]);
    expect(memos.restoreReplies(m.id, token)).toMatchObject({ ok: true, count: 4 });
    expect(snap(memos, m.id)).toBe(original);

    const again = newUndoToken(Date.now() + 1);
    for (const cmd of deleteCommands(m.id, memos.get(m.id)?.replies ?? [], ['b', 'c'], again)) apply(memos, m.id, cmd);
    expect(memos.get(m.id)?.replies?.map((r) => r.id)).toEqual(['a']);
    expect(memos.restoreReplies(m.id, token)).toEqual({ ok: false, why: 'none' }); // 前の印は使い切り
    expect(memos.restoreReplies(m.id, again)).toMatchObject({ ok: true, count: 4 });
    expect(snap(memos, m.id)).toBe(original);
  });

  it('削除を 2 回→新しい順に 2 回戻せる。間にボードの外の変更（タグ）が入ると戻せない（stale）で、台帳は変わらない', async () => {
    const memos = await store();
    const m = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ', replies: sample() });
    if (!m) throw new Error('add');
    const original = snap(memos, m.id);
    const t1 = newUndoToken(1);
    const t2 = newUndoToken(2);
    for (const cmd of deleteCommands(m.id, memos.get(m.id)?.replies ?? [], ['c'], t1)) apply(memos, m.id, cmd);
    for (const cmd of deleteCommands(m.id, memos.get(m.id)?.replies ?? [], ['a'], t2)) apply(memos, m.id, cmd);
    expect(memos.restoreReplies(m.id, t2)).toMatchObject({ ok: true });
    expect(memos.restoreReplies(m.id, t1)).toMatchObject({ ok: true });
    expect(snap(memos, m.id)).toBe(original);

    const t3 = newUndoToken(3);
    for (const cmd of deleteCommands(m.id, memos.get(m.id)?.replies ?? [], ['a'], t3)) apply(memos, m.id, cmd);
    memos.changeReplyTags(m.id, 'c', ['別のタグ'], []);
    const changed = snap(memos, m.id);
    expect(memos.restoreReplies(m.id, t3)).toEqual({ ok: false, why: 'stale' });
    expect(snap(memos, m.id)).toBe(changed);
  });

  it('足したカードの Undo＝同じ id の removeReply（undoToken なし）。やり直し＝同じ id で足し直せる', async () => {
    const memos = await store();
    const m = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ', replies: sample() });
    if (!m) throw new Error('add');
    const original = snap(memos, m.id);
    expect(memos.addReply(m.id, null, '新しい札', undefined, undefined, 'rnew1')?.id).toBe('rnew1'); // 事前に決めた id で足す（B2-3a）
    expect(memos.get(m.id)?.replies?.some((r) => r.id === 'rnew1')).toBe(true);
    memos.removeReply(m.id, 'rnew1'); // Undo：undoToken なし
    expect(snap(memos, m.id)).toBe(original);
    expect(memos.restoreReplies(m.id, 'unone')).toEqual({ ok: false, why: 'none' }); // 控えは作っていない
    expect(memos.addReply(m.id, null, '新しい札', undefined, undefined, 'rnew1')?.id).toBe('rnew1'); // Redo：同じ id で足し直せる
  });
});

describe('画面の配線（ソースの確かめ）', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const tab = () => read('../src/app/memo-board-tab.ts');

  it('キー：Ctrl+Z＝戻す／Ctrl+Shift+Z・Ctrl+Y＝やり直す。文字の欄・つまんでいる間は効かせない。Ctrl+Shift+Y は取らない', () => {
    const src = tab();
    expect(src).toMatch(/\(e\.ctrlKey \|\| e\.metaKey\) && !e\.altKey && !e\.isComposing && \(zy === 'z' \|\| \(zy === 'y' && !e\.shiftKey\)\)/);
    expect(src).toMatch(/closest\('input, textarea, select, \[contenteditable\]'\)/);
    expect(src).toMatch(/if \(typing \|\| this\.drag \|\| this\.marquee\) return;/);
    expect(src).toMatch(/this\.runUndo\(zy === 'y' \|\| e\.shiftKey \? 'redo' : 'undo'\)/);
    expect(src).toContain("if (this.hidden) return;"); // ボードのタブが開いているときだけ（キーの受け口の先頭）
  });

  it('道具の列に「元に戻す」「やり直す」。メモを替えたら積みを捨てる。印は左から受ける', () => {
    const src = tab();
    expect(src).toContain("[this.undoBtn, () => this.runUndo('undo')]");
    expect(src).toContain("[this.redoBtn, () => this.runUndo('redo')]");
    expect(src.match(/this\.resetUndo\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain('cmds?.onUndoSend?.');
    expect(read('../src/app/memo-pane.ts')).toContain('boardUndoSendListeners.forEach');
    expect(read('../src/app/grok-cards.ts')).toContain('onUndoSend: this.o.boardNotices?.onUndoSend');
  });

  it('操作を積む場所：移動・足す・消す・線を付ける・外す・型の貼り付け（QB8 の範囲。書き直し・タグは積まない）', () => {
    const src = tab();
    for (const kind of ["kind: 'add'", "kind: 'remove'", "kind: 'link'", 'this.recordMove(', 'this.pushPaste(']) expect(src).toContain(kind);
    expect(src).not.toMatch(/pushUndo\(\{ kind: '(edit|tag)/);
  });

  it('戻している最中に左が「元に戻せませんでした」と知らせたら、3 秒待たずに失敗にする（二重に終えない）。戻せなければその 1 件だけ積みから外す（finish しない）', () => {
    const src = tab();
    expect(src).toContain("text.startsWith('元に戻せませんでした')");
    expect(src).toContain('if (settled) return;');
    expect(src).toContain('const op = this.undo.take(dir);');
    expect(src).toContain('this.undo.finish(dir, next, version);');
    expect(src).toContain('if (this.undoBusy || this.hidden) return;'); // 戻している最中は受けない
  });

  it('C++ は Ctrl+Z・Ctrl+Y（Shift なし）を取らない（Ctrl+Shift+Y だけ別の動き）。Ctrl+A と同じくページに届く', () => {
    const cpp = read('../../src/browser.cpp');
    expect(cpp).not.toMatch(/case 'Z'/);
    expect(cpp).toMatch(/case 'Y':\s*\r?\n\s*if \(shift\) action = "captureCenter"/);
  });
});