// ボードの保存の道（B1-2。読めなければ書かない・初回だけ写しを取る・200KB 超や不正 id は書かない）。偽の io でファイルの読み書きを真似る
import { describe, expect, it } from 'vitest';

import type { CheckedRead } from '../src/data';
import { type Board, boardBackupName, boardFileName, BOARD_FORMAT, BOARD_LIMITS, emptyBoard, moveNodes } from '../src/memo-card-board';
import { type BoardIo, boardSaveMessage, boardUnreadableNote, loadBoard, saveBoard, type SaveBoardFailure } from '../src/memo-card-board-store';

const ID = 'm1abc2defg';
const FILE = boardFileName(ID) as string;
const BACKUP = boardBackupName(ID) as string;

// 偽のファイル置き場。files に入れた値はそのまま読める（'FAIL' なら読めない）。writes に書いた順が残る
function fakeIo(files: Record<string, unknown> = {}, opts: { failWrite?: string; onRead?: (name: string) => void } = {}) {
  const store = new Map<string, unknown>(Object.entries(files));
  const writes: { name: string; value: unknown }[] = [];
  const reads: string[] = [];
  const io: BoardIo = {
    async read(name): Promise<CheckedRead<unknown>> {
      reads.push(name);
      opts.onRead?.(name);
      if (!store.has(name)) return { status: 'missing' };
      const value = store.get(name);
      return value === 'FAIL' ? { status: 'failed' } : { status: 'ok', value };
    },
    async write(name, value) {
      if (opts.failWrite === name) return false;
      writes.push({ name, value: structuredClone(value) });
      store.set(name, structuredClone(value));
      return true;
    },
  };
  return { io, store, writes, reads };
}

const fileOf = (nodes: unknown[] = [{ ref: 'r1', x: 5, y: 6 }], over: Record<string, unknown> = {}) => ({
  format: BOARD_FORMAT,
  version: 1,
  memoId: ID,
  updatedAt: 100,
  view: { x: 10, y: 20, zoom: 0.5 },
  nodes,
  ...over,
});

async function loaded(files: Record<string, unknown> = {}, opts: Parameters<typeof fakeIo>[1] = {}) {
  const f = fakeIo(files, opts);
  const l = await loadBoard(f.io, ID, 1);
  return { ...f, l };
}

describe('ボードのファイルを読む', () => {
  it('無ければ missing（空のボードから始める。仮の並び）', async () => {
    const { l, reads } = await loaded();
    expect(l).toEqual({ state: 'missing', memoId: ID, board: emptyBoard(ID, 1), dropped: 0, raw: null, backupNeeded: false });
    expect(reads).toEqual([FILE]);
  });
  it('読めれば ok。ボードと、捨てたノードの数・読んだままの中身が分かる', async () => {
    const raw = fileOf([{ ref: 'r1', x: 5, y: 6 }, { ref: 'bad/x', x: 1, y: 1 }]);
    const { l } = await loaded({ [FILE]: raw });
    expect(l.state).toBe('ok');
    if (l.state !== 'ok') return;
    expect(l.board.nodes).toEqual([{ ref: 'r1', x: 5, y: 6 }]);
    expect(l.dropped).toBe(1);
    expect(l.raw).toEqual(raw);
    expect(l.backupNeeded).toBe(true);
  });
  it('返事が無い・壊れている（failed）は unreadable', async () => {
    expect((await loaded({ [FILE]: 'FAIL' })).l).toEqual({ state: 'unreadable', memoId: ID, why: 'failed' });
  });
  it('知らない版・形が違う・メモ違い・大きすぎるは unreadable（理由つき）', async () => {
    expect((await loaded({ [FILE]: fileOf([], { version: 2 }) })).l).toEqual({ state: 'unreadable', memoId: ID, why: 'version' });
    expect((await loaded({ [FILE]: fileOf([], { format: 'x' }) })).l).toEqual({ state: 'unreadable', memoId: ID, why: 'format' });
    expect((await loaded({ [FILE]: fileOf([], { nodes: 'x' }) })).l).toEqual({ state: 'unreadable', memoId: ID, why: 'shape' });
    expect((await loaded({ [FILE]: fileOf([], { memoId: 'other' }) })).l).toEqual({ state: 'unreadable', memoId: ID, why: 'memo' });
    const big = Array.from({ length: 10 }, (_, i) => ({ ref: `r${i}`, x: 0, y: 0, pad: 'x'.repeat(30_000) }));
    expect((await loaded({ [FILE]: fileOf(big) })).l).toEqual({ state: 'unreadable', memoId: ID, why: 'size' });
    expect((await loaded({ [FILE]: 'ただの文字列' })).l).toEqual({ state: 'unreadable', memoId: ID, why: 'format' });
  });
  it('名前に使えないメモ id は読みに行かずに unreadable（name）', async () => {
    const f = fakeIo();
    expect(await loadBoard(f.io, 'a/b')).toEqual({ state: 'unreadable', memoId: 'a/b', why: 'name' });
    expect(f.reads).toEqual([]);
  });
  it('別のメモのボードは別のファイル（boards/<メモ id>.json）', async () => {
    const f = fakeIo({ [boardFileName('mother') as string]: fileOf([{ ref: 'z', x: 1, y: 1 }], { memoId: 'mother' }) });
    expect((await loadBoard(f.io, ID)).state).toBe('missing');
    expect((await loadBoard(f.io, 'mother')).state).toBe('ok');
  });
});

describe('ボードを保存する：読めなければ書かない', () => {
  it('unreadable には書かない（ファイルも写しも変えない・何も読まない）', async () => {
    for (const files of [{ [FILE]: 'FAIL' }, { [FILE]: fileOf([], { version: 2 }) }, { [FILE]: fileOf([], { nodes: 3 }) }]) {
      const { io, l, writes, store, reads } = await loaded(files);
      const before = structuredClone([...store.entries()]);
      const readsBefore = reads.length;
      const done = await saveBoard(io, l, moveNodes(emptyBoard(ID), [{ ref: 'a', x: 1, y: 2 }], 5));
      expect(done).toEqual({ ok: false, why: 'unreadable' });
      expect(writes).toEqual([]);
      expect([...store.entries()]).toEqual(before);
      expect(reads.length).toBe(readsBefore);
    }
  });
  it('名前に使えないメモ id には書かない', async () => {
    const f = fakeIo();
    const l = await loadBoard(f.io, 'a/b');
    expect(await saveBoard(f.io, l, emptyBoard('a/b'))).toEqual({ ok: false, why: 'unreadable' });
    expect(f.writes).toEqual([]);
  });
});

describe('ボードを保存する：ファイルが無いとき（初めて）', () => {
  it('写しは取らず、ボードのファイルだけ書く。中身は toBoardFile の形で、文もタグも入らない', async () => {
    const { io, l, writes } = await loaded();
    const board = moveNodes(l.state === 'missing' ? l.board : emptyBoard(ID), [{ ref: 'a', x: 10.4, y: -20 }], 50);
    const done = await saveBoard(io, l, board);
    expect(done.ok && done.backedUp).toBe(false);
    expect(writes.map((w) => w.name)).toEqual([FILE]);
    expect(writes[0].value).toEqual({
      format: BOARD_FORMAT,
      version: 1,
      memoId: ID,
      updatedAt: 50,
      view: { x: 0, y: 0, zoom: 1 },
      nodes: [{ ref: 'a', x: 10, y: -20 }],
    });
  });
  it('機械タグ・文が紛れた board でもファイルには入らない', async () => {
    const { io, l, writes } = await loaded();
    const dirty = { ...emptyBoard(ID, 9), nodes: [{ ref: 'a', x: 1, y: 2, text: 'ひみつ', tags: ['宛て:grok', '送った:chat', '貼った:型'] }] } as unknown as Board;
    expect((await saveBoard(io, l, dirty)).ok).toBe(true);
    const text = JSON.stringify(writes[0].value);
    for (const word of ['宛て', '送った', '貼った', 'ひみつ', 'tags', 'text']) expect(text).not.toContain(word);
  });
  it('書く前にもう一度見て、ファイルができていたら書かない（changed）', async () => {
    const f = fakeIo();
    const l = await loadBoard(f.io, ID, 1);
    f.store.set(FILE, fileOf([{ ref: 'other', x: 1, y: 1 }])); // 読んだあとに別のものが作った
    const done = await saveBoard(f.io, l, moveNodes(emptyBoard(ID), [{ ref: 'a', x: 1, y: 1 }], 2));
    expect(done).toEqual({ ok: false, why: 'changed' });
    expect(f.writes).toEqual([]);
    expect(f.store.get(FILE)).toEqual(fileOf([{ ref: 'other', x: 1, y: 1 }]));
  });
  it('書き込みに失敗したら write（次に渡す loaded は返らない）', async () => {
    const { io, l } = await loaded({}, { failWrite: FILE });
    expect(await saveBoard(io, l, moveNodes(emptyBoard(ID), [{ ref: 'a', x: 1, y: 1 }], 2))).toEqual({ ok: false, why: 'write' });
  });
});

describe('ボードを保存する：すでにファイルがあるとき（初回だけ写し）', () => {
  const original = fileOf([{ ref: 'r1', x: 5, y: 6 }]);
  it('最初の書き込みの前に、読んだままの中身を boards/<id>-before-v1.json に 1 回だけ写し、そのあと本体を書く（この順）', async () => {
    const { io, l, writes } = await loaded({ [FILE]: original });
    if (l.state !== 'ok') throw new Error('ok のはず');
    const done = await saveBoard(io, l, moveNodes(l.board, [{ ref: 'r2', x: 1, y: 2 }], 10));
    expect(done.ok && done.backedUp).toBe(true);
    expect(writes.map((w) => w.name)).toEqual([BACKUP, FILE]);
    expect(writes[0].value).toEqual(original);
    expect((writes[1].value as { nodes: unknown[] }).nodes).toEqual([{ ref: 'r1', x: 5, y: 6 }, { ref: 'r2', x: 1, y: 2 }]);
  });
  it('2 回目以降は写しを取らない（返ってきた loaded で続けて保存する）', async () => {
    const { io, l, writes } = await loaded({ [FILE]: original });
    if (l.state !== 'ok') throw new Error('ok のはず');
    const first = await saveBoard(io, l, moveNodes(l.board, [{ ref: 'r2', x: 1, y: 2 }], 10));
    if (!first.ok) throw new Error('書けるはず');
    expect(first.loaded.state === 'ok' && first.loaded.backupNeeded).toBe(false);
    expect(first.loaded.state === 'ok' && first.loaded.board.nodes).toHaveLength(2);
    const second = await saveBoard(io, first.loaded, moveNodes((first.loaded as { board: Board }).board, [{ ref: 'r3', x: 3, y: 3 }], 11));
    expect(second.ok && second.backedUp).toBe(false);
    expect(writes.map((w) => w.name)).toEqual([BACKUP, FILE, FILE]);
  });
  it('写しがもうあれば、作り直さない（古い写しを守る）', async () => {
    const oldBackup = fileOf([{ ref: 'old', x: 0, y: 0 }]);
    const { io, l, writes, store } = await loaded({ [FILE]: original, [BACKUP]: oldBackup });
    if (l.state !== 'ok') throw new Error('ok のはず');
    const done = await saveBoard(io, l, moveNodes(l.board, [{ ref: 'r2', x: 1, y: 2 }], 10));
    expect(done.ok && done.backedUp).toBe(false);
    expect(writes.map((w) => w.name)).toEqual([FILE]);
    expect(store.get(BACKUP)).toEqual(oldBackup);
  });
  it('写しの有無が読めない（failed）なら書かない（本体も変えない）', async () => {
    const { io, l, writes, store } = await loaded({ [FILE]: original, [BACKUP]: 'FAIL' });
    if (l.state !== 'ok') throw new Error('ok のはず');
    expect(await saveBoard(io, l, moveNodes(l.board, [{ ref: 'r2', x: 1, y: 2 }], 10))).toEqual({ ok: false, why: 'backup' });
    expect(writes).toEqual([]);
    expect(store.get(FILE)).toEqual(original);
  });
  it('写しが書けなければ、本体を書かない', async () => {
    const { io, l, writes, store } = await loaded({ [FILE]: original }, { failWrite: BACKUP });
    if (l.state !== 'ok') throw new Error('ok のはず');
    expect(await saveBoard(io, l, moveNodes(l.board, [{ ref: 'r2', x: 1, y: 2 }], 10))).toEqual({ ok: false, why: 'backup' });
    expect(writes).toEqual([]);
    expect(store.get(FILE)).toEqual(original);
  });
  it('本体が書けなければ write（写しは残る）', async () => {
    const { io, l, store } = await loaded({ [FILE]: original }, { failWrite: FILE });
    if (l.state !== 'ok') throw new Error('ok のはず');
    expect(await saveBoard(io, l, moveNodes(l.board, [{ ref: 'r2', x: 1, y: 2 }], 10))).toEqual({ ok: false, why: 'write' });
    expect(store.get(BACKUP)).toEqual(original);
    expect(store.get(FILE)).toEqual(original);
  });
});

describe('読み込みで捨てたノードがあるとき（dropped）', () => {
  it('捨てたノードも含む読んだままのファイルを写してから書く（写しがまだ無いとき）', async () => {
    const raw = fileOf([{ ref: 'good', x: 1, y: 1 }, { ref: 'a/b', x: 2, y: 2 }, { ref: 'nan', x: 'x', y: 2 }]);
    const { io, l, writes } = await loaded({ [FILE]: raw });
    if (l.state !== 'ok') throw new Error('ok のはず');
    expect(l.dropped).toBe(2);
    const done = await saveBoard(io, l, moveNodes(l.board, [{ ref: 'new', x: 3, y: 3 }], 4));
    expect(done.ok && done.backedUp).toBe(true);
    expect(writes[0]).toEqual({ name: BACKUP, value: raw });
    expect((writes[1].value as { nodes: { ref: string }[] }).nodes.map((n) => n.ref)).toEqual(['good', 'new']);
  });
  it('捨てるものが無ければ ok のまま（dropped 0）。写しはファイルがあるので同じ道で取られる', async () => {
    const { io, l, writes } = await loaded({ [FILE]: fileOf() });
    if (l.state !== 'ok') throw new Error('ok のはず');
    expect(l.dropped).toBe(0);
    await saveBoard(io, l, moveNodes(l.board, [{ ref: 'x', x: 1, y: 1 }], 4));
    expect(writes.map((w) => w.name)).toEqual([BACKUP, FILE]);
  });
});

describe('書かない場合（大きさ・件数・メモ違い）', () => {
  it('300 件を超える board は書かない（full）。黙って捨てない', async () => {
    const { io, l, writes } = await loaded();
    const nodes = Array.from({ length: BOARD_LIMITS.nodes + 1 }, (_, i) => ({ ref: `r${i}`, x: i, y: 0 }));
    expect(await saveBoard(io, l, { ...emptyBoard(ID), nodes })).toEqual({ ok: false, why: 'full' });
    expect(writes).toEqual([]);
  });
  it('ちょうど 300 件は書ける（200 KB に収まる）', async () => {
    const { io, l, writes } = await loaded();
    const nodes = Array.from({ length: BOARD_LIMITS.nodes }, (_, i) => ({ ref: `r${'x'.repeat(50)}${i}`, x: -10_000, y: 10_000 }));
    expect((await saveBoard(io, l, { ...emptyBoard(ID), nodes })).ok).toBe(true);
    expect(writes).toHaveLength(1);
  });
  it('メモが違う board は書かない（memo）', async () => {
    const { io, l, writes } = await loaded();
    expect(await saveBoard(io, l, emptyBoard('mother'))).toEqual({ ok: false, why: 'memo' });
    expect(writes).toEqual([]);
  });
  it('上限いっぱい（300 件・長い ref・端の座標）でも 200 KB に収まるので、size で断られる形は作れない（size は念のための備え）', async () => {
    const { io, l, writes } = await loaded();
    const nodes = Array.from({ length: BOARD_LIMITS.nodes }, (_, i) => ({ ref: `r${'x'.repeat(58)}${i}`, x: -10_000, y: 10_000 }));
    expect((await saveBoard(io, l, { ...emptyBoard(ID), nodes })).ok).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(writes[0].value, null, 1)).length).toBeLessThan(BOARD_LIMITS.fileBytes);
  });
});

describe('画面に出す文', () => {
  it('読めない理由ごとの文。仮の並びで見せ、保存されないことが分かる', () => {
    for (const why of ['failed', 'format', 'shape', 'size', 'memo'] as const) expect(boardUnreadableNote(why)).toContain('位置は保存されません');
    expect(boardUnreadableNote('version')).toContain('新しい版');
    expect(boardUnreadableNote('name')).toContain('保存できません');
  });
  it('保存の失敗ごとの文（どれも空でない）', () => {
    const all: SaveBoardFailure[] = ['unreadable', 'name', 'memo', 'full', 'size', 'changed', 'backup', 'write'];
    for (const why of all) expect(boardSaveMessage(why).length).toBeGreaterThan(5);
    expect(boardSaveMessage('unreadable')).toContain('ファイルは変えていません');
    expect(boardSaveMessage('full')).toContain('300');
  });
});