// 段 HX5：六角で自由に動かす・別のファイル。純粋な関数を確かめる（DOM も保存の画面も使わない）
//   ファイルの決まり（名前・写し・format）と読み書き、六角の並び（置いたカード・仮のカード）、固める、動かしたカードを nodes の最後へ、
//   足す所（［決める］・Ctrl+Enter・Shift+Enter）、貼る所、見る位置、整理の文、geo の口、開き方の決まり 1
//   tab の配線（known の鍵・読み込みの照合・書く道 6 か所）は memo-card-board-hex-wiring.test.ts の字面。パネルを通した書き先（四角のファイルが変わらないこと）は開発画面と Windows の確かめ
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CheckedRead } from '../src/data';
import { BOARD_FORMAT, BOARD_HEX_FORMAT, BOARD_LIMITS, type Board, type BoardNode, type BoardView, boardBackupName, boardFileName, boardFileRules, BOARDS_FOLDER, BOARDS_HEX_FOLDER, boxesOverlap, emptyBoard, moveNodes, parseBoard, serializeBoard, SQUARE_STEP, toBoardFile } from '../src/memo-card-board';
import { addBlockedNote, addSpot, spotBeside, spotForNewCard, spotNextToLast, takenSpots } from '../src/memo-card-board-edit';
import { HEX_GEO, planBoardMoves, SQUARE_GEO } from '../src/memo-card-board-geo';
import { freezeHexBoard, HEX_BOX, HEX_STEP, hexBandBox, hexesOverlap, hexLayout, hexSlot, planHexMoves } from '../src/memo-card-board-hex';
import { ANCHOR_FULL_NOTE, groupSize, pasteOffsets, pasteToolNote, planBoardPaste, spotForGroup } from '../src/memo-card-board-paste';
import { type BoardIo, boardSaveMessage, type LoadBoardResult, loadBoard, saveBoard } from '../src/memo-card-board-store';
import { orphanNoteText, planTidy, TIDY_NONE_NOTE, tidyButton, tidyConfirmMessage, tidyDoneText, tidyNoneNote } from '../src/memo-card-board-tidy';
import { removeAt, restoreMoves, undoBlockedNote } from '../src/memo-card-board-undo';
import { boardFaces, boardNote, type CardFace, loadOutcome, moveBlockedNote, moveResultNote, openingView, planMoves, planView, viewResultNote, viewToRead, withPending } from '../src/memo-card-board-view';
import { buildTemplateFromCards } from '../src/memo-card-templates';
import type { Reply } from '../src/threads';

const reply = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt: 1000, ...over });
// 作った順に n 枚（c00 が最初）。六角の仮の並びでは c<i> は hexSlot(i)
const cards = (n: number) => Array.from({ length: n }, (_, i) => reply(`c${String(i).padStart(2, '0')}`, { createdAt: 100 + i }));
const vpOf = (h: number, w = 840) => ({ w, h });
const ID = 'm1abc2defg';
const board = (nodes: BoardNode[] = [], memoId = ID, view: BoardView = { x: 0, y: 0, zoom: 1 }): Board => ({ memoId, updatedAt: 1, view, nodes });
type Okay = Extract<LoadBoardResult, { state: 'ok' }>;
type Missing = Extract<LoadBoardResult, { state: 'missing' }>;
const hexMissing = (memoId = ID): Missing => ({ state: 'missing', layout: 'hex', memoId, board: emptyBoard(memoId, 0), dropped: 0, raw: null, backupNeeded: false });
const hexOk = (b: Board): Okay => ({ state: 'ok', layout: 'hex', memoId: b.memoId, board: b, dropped: 0, raw: toBoardFile(b, 'hex'), backupNeeded: false });
const sqMissing = (memoId = ID): Missing => ({ state: 'missing', layout: 'square', memoId, board: emptyBoard(memoId, 0), dropped: 0, raw: null, backupNeeded: false });
const sqOk = (b: Board): Okay => ({ state: 'ok', layout: 'square', memoId: b.memoId, board: b, dropped: 0, raw: toBoardFile(b), backupNeeded: false });
const posOf = (placements: readonly { id: string; x: number; y: number }[]) => new Map(placements.map((p) => [p.id, { x: p.x, y: p.y }]));
const slotNodes = (rs: readonly Reply[]) => rs.map((r, i) => ({ ref: r.id, ...hexSlot(i) }));
// 六角の開き方（決まり 1 の位置を持たない読み込みで）
const hexOpen = (rs: readonly Reply[], vp: { w: number; h: number }) => openingView(null, rs, boardFaces(rs, null, HEX_GEO.place), vp, { place: 'upper', readBox: HEX_GEO.readBox, recent: HEX_GEO.recent }).view;
// 六角の足す所（tab と同じく geo の口を渡す）
const hexAdd = (input: Omit<Parameters<typeof addSpot>[0], 'size' | 'step' | 'overlaps' | 'besideFallback'>) => addSpot({ ...input, size: HEX_GEO.box, step: HEX_GEO.step, overlaps: HEX_GEO.overlaps, besideFallback: HEX_GEO.besideFallback });

// 偽のファイル置き場（memo-card-board-store.test.ts と同じ作り）。files に入れた値はそのまま読める（'FAIL' なら読めない）。writes に書いた順が残る
function fakeIo(files: Record<string, unknown> = {}, opts: { failWrite?: string } = {}) {
  const store = new Map<string, unknown>(Object.entries(files));
  const writes: { name: string; value: unknown }[] = [];
  const reads: string[] = [];
  const io: BoardIo = {
    async read(name): Promise<CheckedRead<unknown>> {
      reads.push(name);
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

describe('ファイルの決まり（形で選ぶ口は一つ：boardFileRules）', () => {
  it('四角は boards/<id>.json・format honeycomb-board、六角は boards-hex/<id>.json・format honeycomb-board-hex。写しはそれぞれの置き場の <id>-before-v1.json', () => {
    expect([BOARD_FORMAT, BOARD_HEX_FORMAT, BOARDS_FOLDER, BOARDS_HEX_FOLDER]).toEqual(['honeycomb-board', 'honeycomb-board-hex', 'boards', 'boards-hex']);
    expect(boardFileRules('square')).toMatchObject({ layout: 'square', format: 'honeycomb-board' });
    expect(boardFileRules('hex')).toMatchObject({ layout: 'hex', format: 'honeycomb-board-hex' });
    expect(boardFileRules('hex').name(ID)).toBe(`boards-hex/${ID}.json`);
    expect(boardFileRules('hex').backupName(ID)).toBe(`boards-hex/${ID}-before-v1.json`);
    expect(boardFileRules('square').name(ID)).toBe(`boards/${ID}.json`);
    expect(boardFileName(ID, 'hex')).toBe(boardFileRules('hex').name(ID));
    expect(boardBackupName(ID, 'hex')).toBe(boardFileRules('hex').backupName(ID));
    expect(boardFileName(ID)).toBe(`boards/${ID}.json`); // 形を渡さなければ四角（今のまま）
    expect(boardBackupName(ID)).toBe(`boards/${ID}-before-v1.json`);
  });
  it('名前に使える文字は四角と同じ（使えないメモ id は、どちらの形でも null）。C++ の名前の規則（段・文字・200 字）に、64 字のメモ id でも合う', () => {
    for (const bad of ['', 'a/b', 'a.b', '../x', 'メモ', 'a b', 'x'.repeat(65)]) {
      for (const layout of ['square', 'hex'] as const) {
        expect(boardFileRules(layout).name(bad), `${layout} ${bad}`).toBeNull();
        expect(boardFileRules(layout).backupName(bad), `${layout} ${bad}`).toBeNull();
      }
    }
    // src/storage.cpp の UiDataFile の正規表現（R"(…)" の中）と字数の上限を、C++ の元の字から取り出して使う（JS の写しを別に持たない）
    const cpp = readFileSync(new URL('../../src/storage.cpp', import.meta.url), 'utf8');
    const raw = /UiDataFile\(const std::string& name\) \{\s*static const std::regex pattern\(R"\((.*?)\)"\);/.exec(cpp)?.[1];
    const max = Number(/if \(name\.size\(\) > (\d+) \|\| !std::regex_match\(name, pattern\)\) return std::nullopt;/.exec(cpp)?.[1]);
    expect(raw).toBeDefined();
    expect(max).toBe(200);
    const cppRule = new RegExp(raw as string);
    expect(cppRule.test('boards/m1.json')).toBe(true); // 取り出した規則が働くこと（今の四角の名前）
    expect(cppRule.test('a/b/c/d/e.json')).toBe(false); // 段は 4 つまで
    expect(cppRule.test('boards/m1.txt')).toBe(false);
    for (const id of [ID, 'x'.repeat(64)]) {
      for (const name of [boardFileName(id, 'hex'), boardBackupName(id, 'hex')]) {
        expect(cppRule.test(name as string), name as string).toBe(true);
        expect((name as string).length).toBeLessThanOrEqual(max);
      }
    }
  });
  it('読むときは、その形の format だけを通す（四角のファイルを六角として、六角のファイルを四角として読まない）。中身の形は同じで format だけが違う', () => {
    const b = board([{ ref: 'a', x: 5, y: 6 }], 'm1abc');
    expect(toBoardFile(b, 'hex')).toEqual({ ...toBoardFile(b), format: 'honeycomb-board-hex' });
    expect(parseBoard(toBoardFile(b, 'hex'), { memoId: 'm1abc', layout: 'hex' })).toEqual({ ok: true, board: b, dropped: 0 });
    expect(parseBoard(toBoardFile(b, 'hex'), { memoId: 'm1abc' })).toEqual({ ok: false, why: 'format' });
    expect(parseBoard(toBoardFile(b, 'hex'), { memoId: 'm1abc', layout: 'square' })).toEqual({ ok: false, why: 'format' });
    expect(parseBoard(toBoardFile(b), { memoId: 'm1abc', layout: 'hex' })).toEqual({ ok: false, why: 'format' });
    expect(JSON.parse(serializeBoard(b, 'hex') as string).format).toBe('honeycomb-board-hex');
    expect(JSON.parse(serializeBoard(b) as string).format).toBe('honeycomb-board');
  });
});

describe('読み書き（loadBoard・saveBoard は layout で決まりを選ぶ）', () => {
  const sqName = boardFileName(ID) as string;
  const hexName = boardFileName(ID, 'hex') as string;
  const hexBackup = boardBackupName(ID, 'hex') as string;
  const squareFile = toBoardFile(board([{ ref: 'c00', x: 900, y: 900 }]));
  const hexFile = toBoardFile(board([{ ref: 'c00', x: 10, y: 20 }]), 'hex');
  it('六角は boards-hex/<id>.json だけを読む。四角のファイルがあっても missing（四角の位置を六角として使わない）', async () => {
    const f = fakeIo({ [sqName]: squareFile });
    expect(await loadBoard(f.io, ID, 1, 'hex')).toEqual({ state: 'missing', layout: 'hex', memoId: ID, board: emptyBoard(ID, 1), dropped: 0, raw: null, backupNeeded: false });
    expect(f.reads).toEqual([hexName]);
    const ok = await loadBoard(fakeIo({ [hexName]: hexFile }).io, ID, 1, 'hex');
    expect(ok).toMatchObject({ state: 'ok', layout: 'hex', memoId: ID, backupNeeded: true });
    expect(ok.state === 'ok' && ok.board.nodes).toEqual([{ ref: 'c00', x: 10, y: 20 }]);
  });
  it('六角の置き場に四角の format のファイルがあれば読まない（unreadable・format）。四角の置き場の六角の format も同じ。どの結果も layout を持つ', async () => {
    expect(await loadBoard(fakeIo({ [hexName]: squareFile }).io, ID, 1, 'hex')).toEqual({ state: 'unreadable', layout: 'hex', memoId: ID, why: 'format' });
    expect(await loadBoard(fakeIo({ [sqName]: hexFile }).io, ID, 1, 'square')).toEqual({ state: 'unreadable', layout: 'square', memoId: ID, why: 'format' });
    expect(await loadBoard(fakeIo({ [hexName]: 'FAIL' }).io, ID, 1, 'hex')).toEqual({ state: 'unreadable', layout: 'hex', memoId: ID, why: 'failed' });
    const bad = fakeIo();
    expect(await loadBoard(bad.io, 'a/b', 1, 'hex')).toEqual({ state: 'unreadable', layout: 'hex', memoId: 'a/b', why: 'name' });
    expect(bad.reads).toEqual([]);
  });
  it('六角のファイルが無いときの初めての書き込みは boards-hex/<id>.json だけ（写しは取らない）。返りの loaded も六角で、続けて書いても四角のファイルは一度も書かない', async () => {
    const f = fakeIo({ [sqName]: squareFile });
    const l = await loadBoard(f.io, ID, 1, 'hex');
    if (l.state !== 'missing') throw new Error('missing のはず');
    const first = await saveBoard(f.io, l, moveNodes(l.board, [{ ref: 'a', x: 1, y: 2 }], 5));
    if (!first.ok) throw new Error('書けるはず');
    expect(first.backedUp).toBe(false);
    expect(first.loaded).toMatchObject({ state: 'ok', layout: 'hex', memoId: ID, backupNeeded: false });
    if (first.loaded.state !== 'ok') throw new Error('ok のはず');
    const second = await saveBoard(f.io, first.loaded, moveNodes(first.loaded.board, [{ ref: 'b', x: 3, y: 4 }], 6));
    expect(second.ok && second.loaded.layout).toBe('hex');
    expect(f.writes.map((w) => w.name)).toEqual([hexName, hexName]);
    expect((f.writes[0].value as { format: string }).format).toBe('honeycomb-board-hex');
    expect((f.writes[1].value as { nodes: unknown[] }).nodes).toEqual([{ ref: 'a', x: 1, y: 2 }, { ref: 'b', x: 3, y: 4 }]);
    expect(f.store.get(sqName)).toEqual(squareFile);
  });
  it('六角のファイルがあるとき：初めて書く前に boards-hex/<id>-before-v1.json へ読んだままの中身を一度だけ写す（2 回目は写さない）', async () => {
    const f = fakeIo({ [hexName]: hexFile, [sqName]: squareFile });
    const l = await loadBoard(f.io, ID, 1, 'hex');
    if (l.state !== 'ok') throw new Error('ok のはず');
    const first = await saveBoard(f.io, l, moveNodes(l.board, [{ ref: 'c00', x: 30, y: 40 }], 5));
    if (!first.ok) throw new Error('書けるはず');
    expect(first.backedUp).toBe(true);
    const second = await saveBoard(f.io, first.loaded, moveNodes((first.loaded as { board: Board }).board, [{ ref: 'c00', x: 50, y: 60 }], 6));
    expect(second.ok && second.backedUp).toBe(false);
    expect(f.writes.map((w) => w.name)).toEqual([hexBackup, hexName, hexName]);
    expect(f.writes[0].value).toEqual(hexFile);
    expect(f.store.get(sqName)).toEqual(squareFile);
    expect(f.writes.some((w) => w.name.startsWith('boards/'))).toBe(false);
  });
  it('書いたあとの読み直しも六角の決まりで（返りの board は、書いたファイルを六角として読んだ形。丸めた位置）', async () => {
    const f = fakeIo();
    const l = await loadBoard(f.io, ID, 1, 'hex');
    const done = await saveBoard(f.io, l, { ...emptyBoard(ID, 2), nodes: [{ ref: 'a', x: 10.4, y: -0.4 }] });
    expect(done.ok && done.loaded).toMatchObject({ state: 'ok', layout: 'hex', board: { nodes: [{ ref: 'a', x: 10, y: 0 }] } });
  });
  it('六角の保存の失敗と写しの道：書けない（write）・写しの有無が読めない（backup）・写しがもうある（写さない）・無いと読んだあとにできた（changed）。どれも boards/ の名前は読まず書かない', async () => {
    const original = toBoardFile(board([{ ref: 'c00', x: 10, y: 20 }]), 'hex');
    const one = { ref: 'c00', x: 30, y: 40 };
    const touchesSquare = (io: ReturnType<typeof fakeIo>) => [...io.reads, ...io.writes.map((w) => w.name)].some((n) => n.startsWith('boards/'));
    // 本体が書けない：写しは取ったあとで、本体は元のまま
    const w = fakeIo({ [hexName]: original }, { failWrite: hexName });
    const lw = await loadBoard(w.io, ID, 1, 'hex');
    if (lw.state !== 'ok') throw new Error('ok のはず');
    expect(await saveBoard(w.io, lw, moveNodes(lw.board, [one], 5))).toEqual({ ok: false, why: 'write' });
    expect(w.store.get(hexName)).toEqual(original);
    expect(w.store.get(hexBackup)).toEqual(original);
    // 写しの有無が読めない：何も書かない
    const b = fakeIo({ [hexName]: original, [hexBackup]: 'FAIL' });
    const lb = await loadBoard(b.io, ID, 1, 'hex');
    if (lb.state !== 'ok') throw new Error('ok のはず');
    expect(await saveBoard(b.io, lb, moveNodes(lb.board, [one], 5))).toEqual({ ok: false, why: 'backup' });
    expect(b.writes).toEqual([]);
    // 写しがもうある：作り直さない（本体だけ書く）
    const old = toBoardFile(board([{ ref: 'old', x: 0, y: 0 }]), 'hex');
    const e = fakeIo({ [hexName]: original, [hexBackup]: old });
    const le = await loadBoard(e.io, ID, 1, 'hex');
    if (le.state !== 'ok') throw new Error('ok のはず');
    const done = await saveBoard(e.io, le, moveNodes(le.board, [one], 5));
    expect(done.ok && done.backedUp).toBe(false);
    expect(e.writes.map((x) => x.name)).toEqual([hexName]);
    expect(e.store.get(hexBackup)).toEqual(old);
    // 無いと読んだあとに六角のファイルができていた：書かない（見ていないファイルを上書きしない）
    const c = fakeIo();
    const lc = await loadBoard(c.io, ID, 1, 'hex');
    c.store.set(hexName, original);
    expect(await saveBoard(c.io, lc, moveNodes(emptyBoard(ID), [one], 5))).toEqual({ ok: false, why: 'changed' });
    expect(c.writes).toEqual([]);
    expect(c.store.get(hexName)).toEqual(original);
    for (const io of [w, b, e, c]) expect(touchesSquare(io)).toBe(false);
  });
  it('LoadBoardResult は三つの形のどれも layout を必ず持つ（型で。落とすと六角の位置を四角のファイルへ書いてしまうため）', () => {
    // @ts-expect-error layout の無い missing は LoadBoardResult にならない
    const noLayout: LoadBoardResult = { state: 'missing', memoId: ID, board: emptyBoard(ID), dropped: 0, raw: null, backupNeeded: false };
    // @ts-expect-error layout の無い unreadable も同じ
    const noLayoutBad: LoadBoardResult = { state: 'unreadable', memoId: ID, why: 'failed' };
    expect([noLayout.state, noLayoutBad.state]).toEqual(['missing', 'unreadable']);
  });
});

describe('六角の並び（置いたカード・仮のカード。HX5）', () => {
  it('置いたカードはファイルの位置、仮のカードは作った順の番。描く順は仮のカードが先（下）、置いたカードは nodes の順（上）。孤児は描かない', () => {
    const rs = cards(5);
    const b = board([{ ref: 'c02', x: 1000, y: 0 }, { ref: 'gone', x: 0, y: 0 }, { ref: 'c00', x: 2000, y: 0 }]);
    expect(hexLayout(rs, b)).toEqual([
      { id: 'c01', x: 166, y: 0, saved: false },
      { id: 'c03', x: 498, y: 0, saved: false },
      { id: 'c04', x: 664, y: 0, saved: false },
      { id: 'c02', x: 1000, y: 0, saved: true },
      { id: 'c00', x: 2000, y: 0, saved: true },
    ]);
    expect(boardFaces(rs, b, HEX_GEO.place).map((f) => f.id)).toEqual(['c01', 'c03', 'c04', 'c02', 'c00']); // 顔の順（DOM の順）も同じ
  });
  it('置いたカードと重なる番の仮のカードだけを、並びの最後の後ろ（番 5〜）の空いた番へ回す。ほかの仮のカードは動かさない', () => {
    const rs = cards(5);
    const b = board([{ ref: 'c00', x: 170, y: 10 }]); // c01 の番 (166, 0) に重なる
    expect(hexesOverlap({ x: 170, y: 10 }, hexSlot(1))).toBe(true);
    expect(hexesOverlap({ x: 170, y: 10 }, hexSlot(5))).toBe(false);
    expect(posOf(hexLayout(rs, b))).toEqual(
      new Map([
        ['c01', hexSlot(5)],
        ['c02', hexSlot(2)],
        ['c03', hexSlot(3)],
        ['c04', hexSlot(4)],
        ['c00', { x: 170, y: 10 }],
      ]),
    );
  });
  it('回す先の番も置いたカードと重なれば、その次の空いた番（重なりは六角どうし）', () => {
    const rs = cards(5);
    const b = board([{ ref: 'c00', x: 170, y: 10 }, { ref: 'c04', x: 85, y: 140 }]); // c01 を押し出し、番 5 (83, 144) もふさぐ
    expect(hexesOverlap({ x: 85, y: 140 }, hexSlot(5))).toBe(true);
    const at = posOf(hexLayout(rs, b));
    expect(at.get('c01')).toEqual(hexSlot(6));
    expect(at.get('c02')).toEqual(hexSlot(2));
    expect(at.get('c03')).toEqual(hexSlot(3));
  });
  it('仮のカードが二枚以上回るとき：回す先の番は一枚ずつ先へ進む（回したカードどうしも、置いたカードとも重ならない）', () => {
    const rs = cards(5);
    const b = board([{ ref: 'c00', x: 170, y: 10 }, { ref: 'c04', x: 340, y: 10 }]); // c01 の番 (166, 0) と c02 の番 (332, 0) に重なる
    const out = hexLayout(rs, b);
    const at = posOf(out);
    expect(at.get('c01')).toEqual(hexSlot(5));
    expect(at.get('c02')).toEqual(hexSlot(6));
    expect(at.get('c03')).toEqual(hexSlot(3));
    const loose = out.filter((p) => !p.saved);
    for (let i = 0; i < loose.length; i++) for (let j = i + 1; j < loose.length; j++) expect(hexesOverlap(loose[i], loose[j]), `${loose[i].id}-${loose[j].id}`).toBe(false);
    for (const p of loose) for (const n of b.nodes) expect(hexesOverlap(p, n), `${p.id}-${n.ref}`).toBe(false);
  });
  it('孤児（台帳に無い位置）は仮のカードを押さない（c01 の番に孤児があっても、c01 はその番のまま）', () => {
    const rs = cards(5);
    expect(posOf(hexLayout(rs, board([{ ref: 'gone', ...hexSlot(1) }]))).get('c01')).toEqual(hexSlot(1));
  });
  it('±10,000 の中に空いた番が無ければ、元の番のまま（重ねて置く）', () => {
    const rs = cards(300);
    // c00 だけが仮のカード。c01 が c00 の番をふさぎ、c02〜c16 が並びの最後の後ろの番（300〜314。行 66〜69）を全部ふさぐ。番 315 は行 70（y 10,080）で範囲の外
    expect(hexSlot(314).y).toBeLessThanOrEqual(BOARD_LIMITS.coord);
    expect(hexSlot(315).y).toBeGreaterThan(BOARD_LIMITS.coord);
    const nodes: BoardNode[] = [{ ref: 'c01', ...hexSlot(0) }];
    for (let k = 0; k < 15; k++) nodes.push({ ref: rs[2 + k].id, ...hexSlot(300 + k) });
    for (let i = 17; i < 300; i++) nodes.push({ ref: rs[i].id, ...hexSlot(i) });
    const at = posOf(hexLayout(rs, board(nodes)));
    expect(at.get('c00')).toEqual(hexSlot(0));
  });
});

describe('固める（六角で初めて位置を書くとき。計画 §6.2 の 2）', () => {
  const rs14 = cards(14);
  const moved = { ref: 'c03', x: 1000, y: 50 };
  const first = planHexMoves(hexMissing(), rs14, [moved], 7);
  if (!first.ok) throw new Error('書けるはず');
  it('初めての書き込みで、描いているカード全部の仮の位置が入り、動かしたカードが nodes の最後に来る（同じ 1 回の書き込み）', () => {
    expect(first.changed).toBe(true);
    expect(first.board.nodes).toHaveLength(14);
    expect(first.board.nodes[13]).toEqual(moved);
    expect(first.board.nodes.slice(0, 13)).toEqual(slotNodes(rs14).filter((n) => n.ref !== 'c03'));
    expect(first.board.updatedAt).toBe(7);
    expect(first.board.view).toEqual({ x: 0, y: 0, zoom: 1 }); // 見る位置を触っていない（view を渡さない）ときは初期の位置のまま（開いただけの位置は保存しない）
  });
  it('つまむ・位置を戻す：固める前でも、どのカードも元と同じ所（仮の位置）なら書かない', () => {
    const load = hexMissing();
    expect(planHexMoves(load, rs14, [{ ref: 'c03', ...hexSlot(3) }], 7)).toEqual({ ok: true, board: load.board, changed: false });
    expect(planHexMoves(load, rs14, [{ ref: 'c03', ...hexSlot(3) }, { ref: 'c04', ...hexSlot(4) }], 7)).toMatchObject({ changed: false });
  });
  it('足す道（writeSame）：固める前に、足す位置が仮の番と同じでも書いて固める（足したカードは nodes の最後）', () => {
    const rs15 = [...rs14, reply('new1', { createdAt: 10_000 })];
    expect(hexLayout(rs15).find((p) => p.id === 'new1')).toEqual({ id: 'new1', ...hexSlot(14), saved: false });
    expect(planHexMoves(hexMissing(), rs15, [{ ref: 'new1', ...hexSlot(14) }], 7)).toMatchObject({ changed: false }); // つまむ道なら書かない
    const plan = planHexMoves(hexMissing(), rs15, [{ ref: 'new1', ...hexSlot(14) }], 7, { writeSame: true });
    if (!plan.ok) throw new Error('書けるはず');
    expect(plan.changed).toBe(true);
    expect(plan.board.nodes).toEqual(slotNodes(rs15));
    expect(plan.board.nodes[14]).toEqual({ ref: 'new1', ...hexSlot(14) });
    expect(planBoardMoves(hexMissing(), rs15, [{ ref: 'new1', ...hexSlot(14) }], 7, { writeSame: true })).toEqual(plan);
  });
  it('足し直し（writeSame）でも、もう置いた位置のまま（同じ所）なら書かない（順も変えない）', () => {
    const load = hexOk(first.board);
    expect(planHexMoves(load, rs14, [{ ref: 'c05', ...hexSlot(5) }], 9, { writeSame: true })).toEqual({ ok: true, board: load.board, changed: false });
  });
  it('六角のファイルを初めて作るとき（missing を固める）、見る位置を触っていれば（view を渡せば）その位置を入れる。ファイルがあれば入れない。四角は使わない', () => {
    const view: BoardView = { x: 33.4, y: -284, zoom: 0.9 };
    const made = planHexMoves(hexMissing(), rs14, [moved], 7, { view });
    expect(made.ok && made.board.view).toEqual({ x: 33, y: -284, zoom: 0.9 }); // clampView で整える
    const fileView: BoardView = { x: 1, y: 2, zoom: 1 };
    const kept = planHexMoves(hexOk(board([{ ref: 'gone', x: 5, y: 5 }], ID, fileView)), rs14, [moved], 7, { view });
    expect(kept.ok && kept.board.view).toEqual(fileView);
    const sq = planBoardMoves(sqMissing(), rs14, [moved], 7, { view });
    expect(sq.ok && sq.board.view).toEqual({ x: 0, y: 0, zoom: 1 }); // 四角は今のまま（見る位置は、見る位置の保存で書く）
  });
  it('固めても、受け取った読み込み（load とそのボード）は書き換えない（見る位置を渡しても・足す道〈writeSame〉でも）', () => {
    const missing = hexMissing();
    const orphanOnly = hexOk(board([{ ref: 'gone', x: 5, y: 5 }]));
    const keep = structuredClone([missing, orphanOnly]);
    const view: BoardView = { x: 9, y: 9, zoom: 1 };
    planHexMoves(missing, rs14, [moved], 7);
    const made = planHexMoves(missing, rs14, [moved], 7, { view, writeSame: true }); // ファイルが無いときに見る位置を入れる道
    const same = planHexMoves(missing, rs14, [{ ref: 'c03', ...hexSlot(3) }], 7, { view, writeSame: true }); // 仮の番のまま足す道
    planHexMoves(orphanOnly, rs14, [moved], 7, { writeSame: true, view });
    freezeHexBoard(missing.board, rs14, 7);
    freezeHexBoard(orphanOnly.board, rs14, 7);
    expect([missing, orphanOnly]).toEqual(keep);
    expect(made.ok && made.board.view).toEqual(view); // 書く方のボードには入る
    expect(same.ok && same.board.view).toEqual(view);
    expect(missing.board.view).toEqual({ x: 0, y: 0, zoom: 1 });
  });
  it('孤児だけのファイルは、まだ固めていない：仮の位置に戻すだけなら書かない（board は読み込みのボードそのもの）', () => {
    const load = hexOk(board([{ ref: 'gone', x: 5, y: 5 }]));
    const plan = planHexMoves(load, rs14, [{ ref: 'c01', ...hexSlot(1) }], 7);
    expect(plan).toEqual({ ok: true, board: load.board, changed: false });
    expect(plan.ok && plan.board).toBe(load.board);
  });
  it('位置が有限でない動きは入れない（それだけなら notCard。固めない）', () => {
    expect(planHexMoves(hexMissing(), rs14, [{ ref: 'c03', x: Number.NaN, y: 1 }], 7)).toEqual({ ok: false, why: 'notCard' });
    const mixed = planHexMoves(hexMissing(), rs14, [{ ref: 'c03', x: Number.NaN, y: 1 }, { ref: 'c04', x: 900, y: 900 }], 7);
    if (!mixed.ok) throw new Error('書けるはず');
    expect(mixed.board.nodes).toHaveLength(14);
    expect(mixed.board.nodes[13]).toEqual({ ref: 'c04', x: 900, y: 900 });
    expect(mixed.board.nodes.find((n) => n.ref === 'c03')).toEqual({ ref: 'c03', ...hexSlot(3) });
  });
  it('2 回目からは触ったカードだけ：ほかのカードの位置はそのままで、動かしたカードを nodes の最後へ', () => {
    const second = planHexMoves(hexOk(first.board), rs14, [{ ref: 'c05', x: 10, y: 600 }], 8);
    if (!second.ok) throw new Error('書けるはず');
    expect(second.changed).toBe(true);
    expect(second.board.nodes).toHaveLength(14);
    expect(second.board.nodes[13]).toEqual({ ref: 'c05', x: 10, y: 600 });
    expect(second.board.nodes.slice(0, 13)).toEqual(first.board.nodes.filter((n) => n.ref !== 'c05'));
    const before = posOf(hexLayout(rs14, first.board));
    const after = posOf(hexLayout(rs14, second.board));
    for (const [id, p] of before) if (id !== 'c05') expect(after.get(id), id).toEqual(p); // 描く位置も、ほかのカードは変わらない
  });
  it('置いた位置のまま（同じ所）なら書かない（固めたあと）', () => {
    const load = hexOk(first.board);
    expect(planHexMoves(load, rs14, [moved], 9)).toEqual({ ok: true, board: load.board, changed: false });
  });
  it('固めたあとに左で足したカード（ファイルに無い）は仮の並びの番に出て、同じ所に置いても位置を書く（あとで置いたカードに押されて動かないように）', () => {
    const rs15 = [...rs14, reply('new1', { createdAt: 10_000 })];
    const at = hexLayout(rs15, first.board).find((p) => p.id === 'new1');
    expect(at).toEqual({ id: 'new1', ...hexSlot(14), saved: false });
    const plan = planHexMoves(hexOk(first.board), rs15, [{ ref: 'new1', ...hexSlot(14) }], 9);
    if (!plan.ok) throw new Error('書けるはず');
    expect(plan.changed).toBe(true);
    expect(plan.board.nodes).toHaveLength(15);
    expect(plan.board.nodes[14]).toEqual({ ref: 'new1', ...hexSlot(14) });
    expect(plan.board.nodes.slice(0, 14)).toEqual(first.board.nodes);
  });
  it('固めたあとに足したカードの番を、置いたカードがふさいでいれば、並びの最後の後ろの空いた番に出る（ほかのカードは動かない）', () => {
    const blocked = planHexMoves(hexOk(first.board), rs14, [{ ref: 'c00', ...hexSlot(14) }], 9); // 次に足すカードの番 14 に c00 を置く
    if (!blocked.ok) throw new Error('書けるはず');
    const rs15 = [...rs14, reply('new1', { createdAt: 10_000 })];
    const at = posOf(hexLayout(rs15, blocked.board));
    expect(at.get('new1')).toEqual(hexSlot(15));
    for (const n of blocked.board.nodes) expect(at.get(n.ref), n.ref).toEqual({ x: n.x, y: n.y });
  });
  it('ファイルに孤児（消したカードの位置）しか無ければ、まだ固めていない：生きたカード全部を孤児の後ろに足す（孤児はそのまま）', () => {
    const rs = cards(3);
    const b = board([{ ref: 'gone', x: 5, y: 5 }]);
    expect(freezeHexBoard(b, rs, 4).nodes).toEqual([{ ref: 'gone', x: 5, y: 5 }, ...slotNodes(rs)]);
    const plan = planHexMoves(hexOk(b), rs, [{ ref: 'c01', x: 400, y: 400 }], 4);
    expect(plan.ok && plan.board.nodes.map((n) => n.ref)).toEqual(['gone', 'c00', 'c02', 'c01']);
    const frozen = freezeHexBoard(b, rs, 4);
    expect(freezeHexBoard(frozen, rs, 5)).toBe(frozen); // 生きたカードの位置が一つでもあれば、もう固めない
  });
  it('固めて 300 件を超えるなら、孤児から（古い順に）捨てる：孤児 200・生きたカード 120 を、足す道（writeSame）で仮の番のまま固めても 300 件以下で、生きたカードは全部入り、書ける', async () => {
    const rs120 = cards(120);
    const orphans = Array.from({ length: 200 }, (_, i) => ({ ref: `gone${i}`, x: -9000, y: i * 10 }));
    const load = hexOk(board(orphans));
    const plan = planHexMoves(load, rs120, [{ ref: 'c119', ...hexSlot(119) }], 7, { writeSame: true });
    if (!plan.ok) throw new Error('書けるはず');
    expect(plan.changed).toBe(true);
    expect(plan.board.nodes.length).toBeLessThanOrEqual(BOARD_LIMITS.nodes);
    expect(plan.board.nodes).toHaveLength(BOARD_LIMITS.nodes); // 320 件から孤児を 20 件
    const refs = plan.board.nodes.map((n) => n.ref);
    for (const r of rs120) expect(refs, r.id).toContain(r.id);
    expect(refs.filter((r) => r.startsWith('gone'))).toEqual(orphans.slice(20).map((n) => n.ref)); // 先頭（古い）20 件を捨てる
    expect(plan.board.nodes.slice(180)).toEqual(slotNodes(rs120)); // 生きたカードは仮の位置のまま、作った順
    expect(freezeHexBoard(load.board, rs120, 7).nodes).toHaveLength(BOARD_LIMITS.nodes);
    expect(load.board.nodes).toHaveLength(200); // 読み込みは変えない
    const { io } = fakeIo({ [`boards-hex/${ID}.json`]: toBoardFile(load.board, 'hex') });
    expect((await saveBoard(io, load, plan.board)).ok).toBe(true); // 300 件を超えると書けない（full）
  });
  it('台帳の一番上にないカードは入れない・読めない読み込みには書かない（四角の planMoves と同じ断り方）', () => {
    expect(planHexMoves(hexMissing(), rs14, [{ ref: 'nope', x: 1, y: 1 }], 1)).toEqual({ ok: false, why: 'notCard' });
    expect(planHexMoves(null, rs14, [moved], 1)).toEqual({ ok: false, why: 'blocked' });
    expect(planHexMoves({ state: 'unreadable', layout: 'hex', memoId: ID, why: 'failed' }, rs14, [moved], 1)).toEqual({ ok: false, why: 'blocked' });
  });
  it('四角の計画（planMoves）は今のまま：固めない・順を変えない', () => {
    const b = board([{ ref: 'c01', x: 1, y: 1 }, { ref: 'c02', x: 2, y: 2 }]);
    const plan = planMoves(sqOk(b), rs14, [{ ref: 'c01', x: 9, y: 9 }], 3);
    expect(plan.ok && plan.board.nodes).toEqual([{ ref: 'c01', x: 9, y: 9 }, { ref: 'c02', x: 2, y: 2 }]);
    expect(planMoves(sqMissing(), rs14, [moved], 3)).toMatchObject({ ok: true, changed: true, board: { nodes: [moved] } });
  });
  it('planBoardMoves は読み込みの形で選ぶ（四角は planMoves、六角は planHexMoves。読み込みが無ければ書かない）', () => {
    expect(planBoardMoves(sqMissing(), rs14, [moved], 3)).toEqual(planMoves(sqMissing(), rs14, [moved], 3));
    expect(planBoardMoves(hexMissing(), rs14, [moved], 3)).toEqual(planHexMoves(hexMissing(), rs14, [moved], 3));
    expect(planBoardMoves(null, rs14, [moved], 3)).toEqual({ ok: false, why: 'blocked' });
  });
});

describe('消して戻す（六角：消すときは、ファイルに位置のあるカードだけ戻す先を覚える。HX5 の見直しの直し）', () => {
  const rs14 = cards(14);
  const without = (rs: readonly Reply[], id: string) => rs.filter((r) => r.id !== id);
  const removeOp = (ids: string[], at: Record<string, { x: number; y: number }>) => ({ kind: 'remove' as const, ids, at, token: 'u1' });
  it('removeAt：四角は描いている位置、六角はファイルに位置のあるカード（saved）だけ。描いていないカードは前に覚えた位置', () => {
    const faces = [{ id: 'a', x: 1, y: 2, saved: false }, { id: 'b', x: 3, y: 4, saved: true }];
    expect(removeAt(['a', 'b'], faces, 'square')).toEqual({ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } });
    expect(removeAt(['a', 'b'], faces, 'hex')).toEqual({ b: { x: 3, y: 4 } });
    expect(removeAt(['a', 'c'], faces, 'hex', { a: { x: 9, y: 9 }, c: { x: 7, y: 7 } })).toEqual({ c: { x: 7, y: 7 } });
    expect(removeAt(['a', 'c'], faces, 'square', { c: { x: 7, y: 7 } })).toEqual({ a: { x: 1, y: 2 }, c: { x: 7, y: 7 } });
  });
  it('固める前に消す → 別のカードを動かして固める → 戻す → 戻す：消したカードは仮の並びに出て、詰まって固まったカードの真上に重ならない', () => {
    // 消す：c05 は仮の位置 (83, 144)。ファイルに位置が無いので覚えない
    const removed = removeOp(['c05'], removeAt(['c05'], boardFaces(rs14, null, HEX_GEO.place), 'hex'));
    expect(removed.at).toEqual({});
    const rs13 = without(rs14, 'c05');
    expect(posOf(hexLayout(rs13)).get('c06')).toEqual(hexSlot(5)); // c06 が c05 の番へ詰まる（仮の並びの性質）
    // c00 を動かして固める（c06 は (83, 144) で書かれる）→ Ctrl+Z で c00 を戻す
    const froze = planHexMoves(hexMissing(), rs13, [{ ref: 'c00', x: 1000, y: 50 }], 7);
    if (!froze.ok) throw new Error('書けるはず');
    const back = planHexMoves(hexOk(froze.board), rs13, [{ ref: 'c00', x: 0, y: 0 }], 8);
    if (!back.ok) throw new Error('書けるはず');
    // Ctrl+Z で c05 を戻す：戻す位置が無い（restoreMoves は空）ので書かず、仮の並びに出る
    expect(restoreMoves(removed)).toEqual([]);
    const shown = hexLayout(rs14, back.board);
    const c05 = shown.find((p) => p.id === 'c05');
    const c06 = shown.find((p) => p.id === 'c06');
    if (!c05 || !c06) throw new Error('描くはず');
    expect(c06).toMatchObject({ ...hexSlot(5), saved: true });
    expect(c05).toMatchObject({ ...hexSlot(14), saved: false }); // c06 と重なる番なので、並びの最後の後ろの空いた番へ回る
    for (const p of shown) if (p.id !== 'c05') expect(hexesOverlap(c05, p), p.id).toBe(false);
  });
  it('固める前に消す → ［決める］で足す（固める）→ 足したのを戻す → 消したのを戻す：消したカードはどのカードとも重ならない', () => {
    const removed = removeOp(['c05'], removeAt(['c05'], boardFaces(rs14, null, HEX_GEO.place), 'hex'));
    const rs13 = without(rs14, 'c05');
    const view = hexOpen(rs13, vpOf(217));
    const spot = hexAdd({ last: hexSlot(12), view, viewport: vpOf(217), taken: [...posOf(hexLayout(rs13)).values()] });
    if (!spot) throw new Error('置けるはず');
    const added = [...rs13, reply('new1', { createdAt: 10_000 })];
    const froze = planHexMoves(hexMissing(), added, [{ ref: 'new1', ...spot }], 7, { writeSame: true });
    if (!froze.ok) throw new Error('書けるはず');
    // 足したのを戻すと new1 は台帳から消え、位置は孤児として残る。消したのを戻す：c05 は位置を持たない
    expect(restoreMoves(removed)).toEqual([]);
    const shown = hexLayout(rs14, froze.board);
    const c05 = shown.find((p) => p.id === 'c05');
    if (!c05) throw new Error('描くはず');
    expect(c05.saved).toBe(false);
    for (const p of shown) if (p.id !== 'c05') expect(hexesOverlap(c05, p), p.id).toBe(false);
  });
  it('置いたカードを消して戻すと、覚えた位置へ戻る（孤児として残った位置と同じなら書かない）', () => {
    const froze = planHexMoves(hexMissing(), rs14, [{ ref: 'c00', x: 1000, y: 50 }], 7);
    if (!froze.ok) throw new Error('書けるはず');
    const removed = removeOp(['c03'], removeAt(['c03'], boardFaces(rs14, froze.board, HEX_GEO.place), 'hex'));
    expect(removed.at).toEqual({ c03: hexSlot(3) });
    expect(restoreMoves(removed)).toEqual([{ ref: 'c03', ...hexSlot(3) }]);
    expect(planHexMoves(hexOk(froze.board), rs14, restoreMoves(removed), 9)).toMatchObject({ ok: true, changed: false });
  });
});

describe('動かしたカードを nodes の最後へ（moveNodes の raise・withPending の raise）', () => {
  const b = board([{ ref: 'a', x: 0, y: 0 }, { ref: 'b', x: 1, y: 1 }, { ref: 'c', x: 2, y: 2 }]);
  it('raise：書くときは、動かしたカードを動かした順に後ろへ。ほかの順はそのまま。位置がどれも変わらなければ同じ board（順も変えない）', () => {
    expect(moveNodes(b, [{ ref: 'b', x: 5, y: 5 }, { ref: 'a', x: 6, y: 6 }], 2, undefined, { raise: true }).nodes).toEqual([
      { ref: 'c', x: 2, y: 2 },
      { ref: 'b', x: 5, y: 5 },
      { ref: 'a', x: 6, y: 6 },
    ]);
    expect(moveNodes(b, [{ ref: 'a', x: 9, y: 9 }, { ref: 'd', x: 3, y: 3 }], 2, undefined, { raise: true }).nodes.map((n) => n.ref)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveNodes(b, [{ ref: 'a', x: 0, y: 0 }], 2, undefined, { raise: true })).toBe(b);
    expect(moveNodes(b, [{ ref: 'a', x: 9, y: 9 }], 2).nodes.map((n) => n.ref)).toEqual(['a', 'b', 'c']); // raise が無ければ今のまま
  });
  it('保存を待っているカードは、六角では顔の並びの後ろ（待っている順）。四角は今のまま', () => {
    const faces = ['p', 'q', 'r', 's'].map((id, i) => ({ id, x: i, y: 0, saved: false }) as unknown as CardFace);
    const pending = new Map([
      ['r', { x: 50, y: 50 }],
      ['p', { x: 60, y: 60 }],
    ]);
    expect(withPending(faces, pending, true).map((f) => [f.id, f.x, f.saved])).toEqual([
      ['q', 1, false],
      ['s', 3, false],
      ['r', 50, true],
      ['p', 60, true],
    ]);
    expect(withPending(faces, pending).map((f) => f.id)).toEqual(['p', 'q', 'r', 's']);
  });
});

describe('足す所（六角。計画 §6.3。重なりは hexesOverlap だけ）', () => {
  const rs14 = cards(14);
  const taken14 = [...posOf(hexLayout(rs14)).values()];
  it('［決める］14 枚・面 217：最後に書いた c13 の右は面の外、右下も面の外なので、左下 (581, 432)', () => {
    const view = hexOpen(rs14, vpOf(217));
    expect(view).toEqual({ x: 13, y: -284, zoom: 1 });
    expect(hexAdd({ last: hexSlot(13), view, viewport: vpOf(217), taken: taken14 })).toEqual({ x: 581, y: 432 });
  });
  it('［決める］15 枚・面 217：最後に書いた c14 の右 (249, 432)（並びの次の番と同じ所）', () => {
    const rs15 = cards(15);
    const view = hexOpen(rs15, vpOf(217));
    expect(view).toEqual({ x: 262, y: -428, zoom: 1 });
    expect(hexAdd({ last: hexSlot(14), view, viewport: vpOf(217), taken: [...posOf(hexLayout(rs15)).values()] })).toEqual(hexSlot(15));
  });
  it('［決める］18 枚・面 217：右は面の外なので右下 (664, 576)。右下がふさがっていれば左下 (498, 576)', () => {
    const rs18 = cards(18);
    const view = hexOpen(rs18, vpOf(217));
    expect(view).toEqual({ x: 13, y: -428, zoom: 1 });
    const taken = [...posOf(hexLayout(rs18)).values()];
    expect(hexAdd({ last: hexSlot(17), view, viewport: vpOf(217), taken })).toEqual({ x: 664, y: 576 });
    expect(hexAdd({ last: hexSlot(17), view, viewport: vpOf(217), taken: [...taken, { x: 664, y: 576 }] })).toEqual({ x: 498, y: 576 });
  });
  it('［決める］左下が面の左の外に出るときは使わない（右も右下もふさがっていれば、真ん中から）', () => {
    const view: BoardView = { x: 13, y: -284, zoom: 1 };
    const vp = vpOf(400);
    const taken = [...posOf(hexLayout(cards(10))).values(), { x: 166, y: 288 }, { x: 83, y: 432 }]; // 最後に書いた c09 (0, 288) の右と右下をふさぐ
    expect(spotNextToLast(view, vp, { x: 0, y: 288 }, taken, HEX_BOX, HEX_STEP, hexesOverlap)).toBeNull(); // 左下 (−83, 432) は面の左の外
    expect(hexAdd({ last: { x: 0, y: 288 }, view, viewport: vp, taken })).toEqual(spotForNewCard(view, vp, taken, HEX_BOX, HEX_STEP, hexesOverlap));
  });
  it('［決める］右もどちらの下もふさがっていれば、面の真ん中から六角の歩み（166・144・奇数の段は 83 右）で右・下・右下（spotForNewCard）', () => {
    const rs15 = cards(15);
    const view = hexOpen(rs15, vpOf(217));
    const taken = [...posOf(hexLayout(rs15)).values(), { x: 249, y: 432 }, { x: 166, y: 576 }, { x: 0, y: 576 }];
    expect(spotNextToLast(view, vpOf(217), hexSlot(14), taken, HEX_BOX, HEX_STEP, hexesOverlap)).toBeNull();
    const spot = hexAdd({ last: hexSlot(14), view, viewport: vpOf(217), taken });
    expect(spot).toEqual(spotForNewCard(view, vpOf(217), taken, HEX_BOX, HEX_STEP, hexesOverlap));
    expect(spot).toEqual({ x: 332, y: 594 }); // 真ん中 (83, 450) は c14 と重なり、右 (249, 450)・下（右下）(166, 594) もふさがっている
    expect(taken.some((t) => hexesOverlap(spot!, t))).toBe(false);
  });
  it('［決める］最後に書いたカードが面に半分より多く見えていなければ、面の真ん中から', () => {
    const far: BoardView = { x: 5000, y: 5000, zoom: 1 };
    expect(hexAdd({ last: hexSlot(13), view: far, viewport: vpOf(217), taken: taken14 })).toEqual(spotForNewCard(far, vpOf(217), taken14, HEX_BOX, HEX_STEP, hexesOverlap));
  });
  it('Ctrl+Enter：選んだ 1 枚の右へ 166 ずつ（14 枚の c05 からは c06〜c08 を飛ばして (747, 144)）', () => {
    const view = hexOpen(rs14, vpOf(217));
    expect(hexAdd({ dir: 'right', anchor: hexSlot(5), last: hexSlot(13), view, viewport: vpOf(217), taken: taken14 })).toEqual({ x: 747, y: 144 });
  });
  it('Shift+Enter：起点の行（round(y÷144)）が偶数なら右下を先（c13 の行 2 → (747, 432)）、奇数なら左下を先（c08 の行 1：左下・右下ともふさがっているので、2 段下の真下 (581, 432)）', () => {
    const view = hexOpen(rs14, vpOf(217));
    expect(hexAdd({ dir: 'down', anchor: hexSlot(13), last: hexSlot(13), view, viewport: vpOf(217), taken: taken14 })).toEqual({ x: 747, y: 432 });
    expect(spotBeside(hexSlot(8), 'down', taken14, HEX_BOX, HEX_STEP, hexesOverlap)).toEqual({ x: 581, y: 432 });
    // 奇数の行は左下が先：c08 の左下（c12）と右下（c13）を両方外すと、左下 (498, 288)（右下が先なら (664, 288) になる）
    expect(spotBeside(hexSlot(8), 'down', taken14.filter((t) => t.y !== 288 || (t.x !== 498 && t.x !== 664)), HEX_BOX, HEX_STEP, hexesOverlap)).toEqual({ x: 498, y: 288 });
  });
  it('Shift+Enter を続けて押すと、縦のジグザグの 1 列になる（右下・左下・右下…）', () => {
    const taken = [{ x: 0, y: 0 }];
    let anchor = { x: 0, y: 0 };
    const got: { x: number; y: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const p = spotBeside(anchor, 'down', taken, HEX_BOX, HEX_STEP, hexesOverlap);
      if (!p) throw new Error('置けるはず');
      got.push(p);
      taken.push(p);
      anchor = p;
    }
    expect(got).toEqual([
      { x: 83, y: 144 },
      { x: 0, y: 288 },
      { x: 83, y: 432 },
      { x: 0, y: 576 },
      { x: 83, y: 720 },
    ]);
  });
  it('避ける位置（takenSpots）：描いている位置と、保存を待っていてまだ描いていない位置（描いているカードの待ちは、描いている位置で数える）', () => {
    const pos = new Map([['a', { x: 0, y: 0 }], ['b', { x: 166, y: 0 }]]);
    const pending = new Map([['b', { x: 999, y: 999 }], ['new1', { x: 332, y: 0 }]]);
    expect(takenSpots(pos, pending)).toEqual([{ x: 0, y: 0 }, { x: 166, y: 0 }, { x: 332, y: 0 }]);
    expect(takenSpots(pos, new Map())).toEqual([{ x: 0, y: 0 }, { x: 166, y: 0 }]);
  });
  it('足した結果を待つ間に、同じ 1 枚を選んだまま続けて Ctrl+Enter・Shift+Enter で足しても、二枚目は一枚目と重ならない（待っている位置も避ける）', () => {
    const view = hexOpen(rs14, vpOf(217));
    const pos = posOf(hexLayout(rs14));
    for (const dir of ['right', 'down'] as const) {
      const input = { dir, anchor: hexSlot(13), last: hexSlot(13), view, viewport: vpOf(217) };
      const first = hexAdd({ ...input, taken: takenSpots(pos, new Map()) });
      if (!first) throw new Error('置けるはず');
      const second = hexAdd({ ...input, taken: takenSpots(pos, new Map([['new1', first]])) }); // 一枚目はまだ台帳に無い（描いていない）
      if (!second) throw new Error('置けるはず');
      expect(hexesOverlap(first, second), dir).toBe(false);
      expect(hexAdd({ ...input, taken: takenSpots(pos, new Map()) }), dir).toEqual(first); // 待っている位置を避けなければ、同じ所（前の穴）
    }
  });
  it('負の行でも偶数・奇数で決める（y −144 は行 −1＝奇数なので左下が先）', () => {
    expect(spotBeside({ x: 0, y: -144 }, 'down', [{ x: 0, y: -144 }], HEX_BOX, HEX_STEP, hexesOverlap)).toEqual({ x: -83, y: 0 });
    expect(spotBeside({ x: 0, y: -288 }, 'down', [{ x: 0, y: -288 }], HEX_BOX, HEX_STEP, hexesOverlap)).toEqual({ x: 83, y: -144 });
  });
  it('24 歩で見つからなければ、六角は［決める］と同じ置き方（最後に書いたカードの右・下 → 真ん中から）。四角の決まり（center）は真ん中から', () => {
    const view: BoardView = { x: 0, y: 0, zoom: 1 };
    const vp = vpOf(600);
    const row = Array.from({ length: 25 }, (_, k) => ({ x: 166 * k, y: 0 }));
    const last = { x: 0, y: 300 };
    const taken = [...row, last];
    expect(spotBeside({ x: 0, y: 0 }, 'right', taken, HEX_BOX, HEX_STEP, hexesOverlap)).toBeNull();
    const hex = hexAdd({ dir: 'right', anchor: { x: 0, y: 0 }, last, view, viewport: vp, taken });
    expect(hex).toEqual({ x: 166, y: 300 }); // 最後に書いたカードの右
    expect(hex).toEqual(hexAdd({ last, view, viewport: vp, taken }));
    const center = addSpot({ dir: 'right', anchor: { x: 0, y: 0 }, last, view, viewport: vp, taken, size: HEX_BOX, step: HEX_STEP, overlaps: hexesOverlap, besideFallback: 'center' });
    expect(center).toEqual(spotForNewCard(view, vp, taken, HEX_BOX, HEX_STEP, hexesOverlap));
    expect(center).not.toEqual(hex);
  });
  it('選んだ 1 枚が無いとき（六角）も［決める］と同じ置き方', () => {
    const view = hexOpen(rs14, vpOf(217));
    for (const dir of ['right', 'down'] as const) expect(hexAdd({ dir, last: hexSlot(13), view, viewport: vpOf(217), taken: taken14 })).toEqual({ x: 581, y: 432 });
  });
  it('±10,000 を出たら止める（右・下とも）', () => {
    expect(spotBeside({ x: 9_900, y: 0 }, 'right', [], HEX_BOX, HEX_STEP, hexesOverlap)).toBeNull();
    expect(spotBeside({ x: 0, y: 9_900 }, 'down', [], HEX_BOX, HEX_STEP, hexesOverlap)).toBeNull();
    expect(spotBeside({ x: 9_950, y: 0 }, 'down', [], HEX_BOX, HEX_STEP, hexesOverlap)).toEqual({ x: 9_867, y: 144 }); // 右下が範囲の外なら左下（行 0 は右下が先）
  });
  it('重なりは六角どうしだけ（箱 150×174 で比べると、斜めの隣がふさがって見えて 2 段下に行ってしまう）。隙間は足さない', () => {
    expect(spotBeside({ x: 0, y: 0 }, 'down', [{ x: 0, y: 0 }], HEX_BOX, HEX_STEP, hexesOverlap)).toEqual({ x: 83, y: 144 });
    expect(spotBeside({ x: 0, y: 0 }, 'down', [{ x: 0, y: 0 }], HEX_BOX, HEX_STEP)).toEqual({ x: 0, y: 288 }); // 既定（箱の重なり）なら
    expect(spotBeside({ x: 0, y: 0 }, 'right', [{ x: 0, y: 0 }, { x: 150, y: 0 }], HEX_BOX, { x: 150, y: 144 }, hexesOverlap)).toEqual({ x: 150 * 2, y: 0 }); // 辺が接するだけなら重ならないが、同じ所は重なる
  });
  it('at（空きで押した所。TA4a）：向き・選んだ 1 枚・最後に書いたカードを見ずに、押した所へ。ふさがっていれば近くの升へ。at が無ければ今のまま', () => {
    const view: BoardView = { x: 0, y: 0, zoom: 1 };
    const taken = [{ x: 0, y: 0 }];
    const input = { last: { x: 0, y: 0 }, view, viewport: vpOf(600), taken };
    expect(hexAdd({ ...input, at: { x: 400, y: 300 } })).toEqual({ x: 400, y: 300 });
    expect(hexAdd({ ...input, at: { x: 400, y: 300 }, dir: 'down', anchor: { x: 0, y: 0 } })).toEqual({ x: 400, y: 300 });
    expect(hexAdd({ ...input, at: { x: 100, y: 0 } })).toEqual({ x: 166, y: 0 });
    expect(hexAdd({ ...input, at: { x: -500, y: -400 } })).toEqual({ x: -500, y: -400 }); // 上や左でも、押した所
    expect(addSpot({ ...input, at: { x: 105, y: 0 } })).toEqual({ x: 210, y: 0 }); // 四角（既定）
    expect(hexAdd({ ...input })).toEqual(hexAdd({ ...input, at: undefined }));
    // 押した所からどこを探しても置けないときだけ、今の決まり（ここでは、どこも重なるので null）
    expect(addSpot({ ...input, at: { x: 5, y: 5 }, overlaps: () => true })).toBeNull();
  });
  it('四角（ずらしの無い升目・箱の重なり・besideFallback center）は今のまま', () => {
    const sq = boardFaces(rs14, null);
    const taken = [...posOf(sq).values()];
    const view: BoardView = { x: 115, y: -345, zoom: 1 };
    const input = { last: { x: 210, y: 464 }, view, viewport: vpOf(217), taken };
    expect(addSpot({ ...input, size: SQUARE_GEO.box, step: SQUARE_GEO.step, overlaps: SQUARE_GEO.overlaps, besideFallback: SQUARE_GEO.besideFallback })).toEqual(addSpot(input));
    for (const dir of ['right', 'down'] as const) {
      expect(addSpot({ ...input, dir, anchor: { x: 0, y: 116 }, size: SQUARE_GEO.box, step: SQUARE_GEO.step, overlaps: SQUARE_GEO.overlaps, besideFallback: SQUARE_GEO.besideFallback })).toEqual(addSpot({ ...input, dir, anchor: { x: 0, y: 116 } }));
      expect(addSpot({ ...input, dir, size: SQUARE_GEO.box, step: SQUARE_GEO.step, overlaps: SQUARE_GEO.overlaps, besideFallback: SQUARE_GEO.besideFallback })).toEqual(spotForNewCard(view, vpOf(217), taken)); // 選んだ 1 枚が無ければ真ん中から（最後に書いたカードは使わない）
    }
  });
});

describe('足したあとの滑り（slideToRead の目当て：geo の slideBox。六角の低い面では文の帯）', () => {
  const rs14 = cards(14);
  const right = { x: hexSlot(13).x + HEX_STEP.x, y: hexSlot(13).y }; // 最後に書いた c13 (664, 288) を選んで Ctrl+Enter：右 (830, 288)
  const slide = (view: BoardView, at: { x: number; y: number }, vp: { w: number; h: number }) => viewToRead(view, HEX_GEO.slideBox(at, view.zoom, vp), vp);
  it('目当て：箱（150×174）がその倍率で面に入れば箱（面 178 まではちょうど入る）、入らなければ文の帯。四角はいつも読む箱', () => {
    expect(HEX_GEO.slideBox(right, 1, vpOf(217))).toEqual(HEX_GEO.readBox(right));
    expect(HEX_GEO.slideBox(right, 1, vpOf(178))).toEqual(HEX_GEO.readBox(right)); // 174 ＝ 178 − 2×2
    expect(HEX_GEO.slideBox(right, 1, vpOf(177))).toEqual(hexBandBox(right));
    expect(HEX_GEO.slideBox(right, 0.5, vpOf(120))).toEqual(HEX_GEO.readBox(right)); // 87 ≦ 116
    expect(HEX_GEO.slideBox(right, 1, vpOf(120))).toEqual(hexBandBox(right));
    expect(SQUARE_GEO.slideBox(right, 1, vpOf(88))).toEqual(SQUARE_GEO.readBox(right));
  });
  it('面 120：帯が見えていれば、Ctrl+Enter で足しても見ている位置を変えない（箱の上の端に合わせて縦に動かさない）', () => {
    const view = hexOpen(rs14, vpOf(120));
    expect(view).toEqual({ x: -319, y: -315, zoom: 1 }); // 決まり 4：最後に書いた c13 の帯を真ん中に
    expect(slide(view, right, vpOf(120))).toBeNull();
    expect(viewToRead(view, HEX_GEO.readBox(right), vpOf(120))).toEqual({ ...view, y: -286 }); // 箱で見ると、足すたびに縦に動いていた（前の動き）
  });
  it('面 88：帯（86.6）も 84 に入らないので、帯の上の端を縁（2）に合わせる（−331 → −329。2px）。その右へもう一度足しても動かない', () => {
    const view = hexOpen(rs14, vpOf(88));
    expect(view).toEqual({ x: -319, y: -331, zoom: 1 });
    const next = slide(view, right, vpOf(88));
    expect(next).toEqual({ ...view, y: -329 });
    expect(slide(next as BoardView, { x: right.x + HEX_STEP.x, y: right.y }, vpOf(88))).toBeNull();
  });
});

describe('geo の口（HX5 で足したもの：歩み・重なり・横に置けないときの置き方・並べ方）', () => {
  it('四角は今の歩み（210×116）と箱の重なり、六角は 166・144・83 と六角どうしの重なり', () => {
    expect(SQUARE_GEO.step).toBe(SQUARE_STEP);
    expect(HEX_GEO.step).toBe(HEX_STEP);
    expect(HEX_STEP).toEqual({ x: 166, y: 144, shift: 83 });
    expect([SQUARE_GEO.besideFallback, HEX_GEO.besideFallback]).toEqual(['center', 'last']);
    const pairs: [{ x: number; y: number }, { x: number; y: number }][] = [[{ x: 0, y: 0 }, { x: 83, y: 144 }], [{ x: 0, y: 0 }, { x: 149, y: 0 }], [{ x: 0, y: 0 }, { x: 189, y: 95 }], [{ x: 0, y: 0 }, { x: 0, y: 173 }]];
    for (const [a, b] of pairs) {
      expect(SQUARE_GEO.overlaps(a, b), `${b.x},${b.y}`).toBe(boxesOverlap(a, b));
      expect(HEX_GEO.overlaps(a, b), `${b.x},${b.y}`).toBe(hexesOverlap(a, b));
    }
    expect(HEX_GEO.overlaps({ x: 0, y: 0 }, { x: 83, y: 144 })).toBe(false); // 斜めの隣
    expect(boxesOverlap({ x: 0, y: 0 }, { x: 83, y: 144 }, HEX_BOX)).toBe(true); // 箱で比べると重なりに数えてしまう
  });
  it('六角の並べ方は渡したファイルを使う（board が無ければ仮の並び）', () => {
    const rs = cards(3);
    const b = board([{ ref: 'c01', x: 900, y: 900 }]);
    expect(HEX_GEO.place(rs, b)).toEqual(hexLayout(rs, b));
    expect(HEX_GEO.place(rs, b).find((p) => p.id === 'c01')).toEqual({ id: 'c01', x: 900, y: 900, saved: true });
  });
});

describe('貼る所（六角の大きさ・歩み・重なり。基準の無い道は、六角では通らない：道具の列の型は六角では押せない。基準つきの道は TA1・TA2）', () => {
  const flat = (n: number) => ({ cards: Array.from({ length: n }, () => ({ dx: 0, dy: 0 })) }) as never;
  it('位置を持たない型は 3 列の升目に、六角の歩みで並べる（奇数の段は 83 右。六角どうしは重ならない）。四角は今のまま', () => {
    const hex = pasteOffsets(flat(5), HEX_STEP);
    expect(hex).toEqual([
      { x: 0, y: 0 },
      { x: 166, y: 0 },
      { x: 332, y: 0 },
      { x: 83, y: 144 },
      { x: 249, y: 144 },
    ]);
    for (let i = 0; i < hex.length; i++) for (let j = i + 1; j < hex.length; j++) expect(hexesOverlap(hex[i], hex[j]), `${i}-${j}`).toBe(false);
    expect(pasteOffsets(flat(5), SQUARE_STEP)).toEqual(pasteOffsets(flat(5)));
  });
  it('置き場は六角の箱で真ん中を決め、ふさがっていれば六角の歩みで外へ。どのカードも六角どうしで重ならない', () => {
    const offsets = pasteOffsets(flat(4), HEX_STEP);
    const view: BoardView = { x: 0, y: 0, zoom: 1 };
    const vp = vpOf(600);
    const size = groupSize(offsets, HEX_BOX);
    expect(size).toEqual({ w: 332 + 150, h: 144 + 174 });
    const base = spotForGroup(view, vp, [], offsets, HEX_BOX, HEX_STEP, hexesOverlap);
    expect(base).toEqual({ x: Math.round(420 - size.w / 2), y: Math.round(300 - size.h / 2) });
    const taken = [{ x: base!.x + 10, y: base!.y + 10 }];
    const moved = spotForGroup(view, vp, taken, offsets, HEX_BOX, HEX_STEP, hexesOverlap);
    expect(moved).not.toEqual(base);
    expect(moved).toEqual({ x: 262, y: -3 }); // 真ん中 (179, 141) の上の段（奇数の段は 83 右）。箱の重なり・ずらし無しなら別の所になる
    for (const d of offsets) expect(taken.some((t) => hexesOverlap({ x: moved!.x + d.x, y: moved!.y + d.y }, t))).toBe(false);
  });
  it('planBoardPaste に形の口を渡すと、六角の歩みと重なりで置く（渡さなければ四角のまま）', () => {
    const src = cards(4);
    const built = buildTemplateFromCards(src, src.map((r) => r.id), { name: '四枚', folder: '調査', newId: () => 'tpl1', now: 5 });
    if (!built.ok) throw new Error('型を作れない');
    const template = built.template;
    for (const c of template.cards) {
      c.dx = 0; // 位置を持たない型
      c.dy = 0;
    }
    let n = 0;
    const input = { memoId: ID, template, replies: [], load: hexMissing(), view: { x: 0, y: 0, zoom: 1 }, viewport: vpOf(600), taken: [], make: () => `id${(n += 1)}` };
    const hex = planBoardPaste({ ...input, card: HEX_GEO.box, step: HEX_GEO.step, overlaps: HEX_GEO.overlaps });
    if (!hex.ok) throw new Error(hex.note);
    expect(hex.moves.map((m) => ({ x: m.x - hex.origin.x, y: m.y - hex.origin.y }))).toEqual(pasteOffsets(template, HEX_STEP));
    n = 0;
    const sq = planBoardPaste({ ...input, load: sqMissing() });
    if (!sq.ok) throw new Error(sq.note);
    expect(sq.moves.map((m) => ({ x: m.x - sq.origin.x, y: m.y - sq.origin.y }))).toEqual(pasteOffsets(template));
  });
  it('基準（押したカード）を渡すと、面の真ん中ではなく、そのカードの右と下に置く（TA1）。型の中で重なる型は升へ順に、重ならない型は形のまま', () => {
    const src = cards(4);
    const built = buildTemplateFromCards(src, src.map((r) => r.id), { name: '四枚', folder: '調査', newId: () => 'tpl1', now: 5 });
    if (!built.ok) throw new Error('型を作れない');
    const template = built.template; // 番地から作った位置：(0,0)(210,0)(420,0)(0,116)。六角では上下の 2 枚が重なる
    let n = 0;
    const anchor = { kind: 'card' as const, at: { x: 37, y: 51 } };
    const input = { memoId: ID, template, replies: [], load: hexMissing(), view: { x: 0, y: 0, zoom: 1 }, viewport: vpOf(600), taken: [anchor.at], make: () => `id${(n += 1)}`, anchor };
    const hex = planBoardPaste({ ...input, card: HEX_GEO.box, step: HEX_GEO.step, overlaps: HEX_GEO.overlaps, depth: HEX_GEO.depth });
    if (!hex.ok) throw new Error(hex.note);
    expect(hex.moves).toEqual([
      { ref: 'id1', x: 37 + 166, y: 51 },
      { ref: 'id2', x: 37 + 83, y: 51 + 144 },
      { ref: 'id3', x: 37 + 249, y: 51 + 144 },
      { ref: 'id4', x: 37 + 332, y: 51 },
    ]);
    expect(hex.origin).toEqual({ x: 37 + 166, y: 51 });
    expect(hex.command).toMatchObject({ command: 'sendReplies', to: ID, mode: 'copy', ids: ['id1', 'id2', 'id3', 'id4'] });
    n = 0;
    const sq = planBoardPaste({ ...input, load: sqMissing() }); // 四角では重ならないので、形のまま右の升から
    if (!sq.ok) throw new Error(sq.note);
    expect(sq.moves.map((m) => ({ x: m.x, y: m.y }))).toEqual([
      { x: 37 + 210, y: 51 },
      { x: 37 + 420, y: 51 },
      { x: 37 + 630, y: 51 },
      { x: 37 + 210, y: 51 + 116 },
    ]);
    // 空きで押した所が基準（TA5）：カードが 0 枚・六角のファイルが無い面でも通る。1 枚目は押した所、残りは右と下の升
    n = 0;
    const at = { x: 425, y: 213 };
    const here = planBoardPaste({ ...input, taken: [], anchor: { kind: 'point', at, corner: { x: 500, y: 300 } }, card: HEX_GEO.box, step: HEX_GEO.step, overlaps: HEX_GEO.overlaps, depth: HEX_GEO.depth });
    if (!here.ok) throw new Error(here.note);
    expect(here.moves.map((m) => ({ x: m.x, y: m.y }))).toEqual([at, { x: at.x + 166, y: at.y }, { x: at.x + 83, y: at.y + 144 }, { x: at.x + 249, y: at.y + 144 }]);
    expect(here.origin).toEqual(at);
    // 面の真ん中が基準（題の帯から）：位置は、渡した面と見ている位置から決める（今の「足す」と同じ真ん中）
    n = 0;
    const mid = planBoardPaste({ ...input, taken: [], anchor: { kind: 'center' }, card: HEX_GEO.box, step: HEX_GEO.step, overlaps: HEX_GEO.overlaps, depth: HEX_GEO.depth });
    if (!mid.ok) throw new Error(mid.note);
    expect(mid.origin).toEqual(spotForNewCard(input.view, input.viewport, [], HEX_GEO.box, HEX_GEO.step, HEX_GEO.overlaps));
    expect(mid.moves[1]).toMatchObject({ x: mid.origin.x + 166, y: mid.origin.y });
    // 真ん中から置けないときは、今の文（括弧つき。見ている場所を動かすと答えが変わる）
    const midFull = planBoardPaste({ ...input, anchor: { kind: 'center' }, overlaps: () => true });
    expect(midFull).toEqual({ ok: false, note: '置ける空きが見つかりませんでした（見ている場所を動かしてからお試しください）' });
    // 置ける空きが無いときは、括弧の無い文で断る
    const full = planBoardPaste({ ...input, overlaps: () => true });
    expect(full).toEqual({ ok: false, note: ANCHOR_FULL_NOTE });
  });
});

describe('見る位置（六角のファイルが無いとき、見る位置だけではファイルを作らない）', () => {
  const view: BoardView = { x: 30, y: -40, zoom: 0.9 };
  it('六角の missing は書かない（missing）。四角の missing は今のとおり作る。六角のファイルがあれば見る位置を書く', () => {
    expect(planView(hexMissing(), view, 5)).toEqual({ ok: false, why: 'missing' });
    expect(planView(sqMissing(), view, 5)).toMatchObject({ ok: true, changed: true, board: { view } });
    expect(planView(hexOk(board([{ ref: 'c00', x: 0, y: 0 }])), view, 5)).toMatchObject({ ok: true, changed: true, board: { view, nodes: [{ ref: 'c00', x: 0, y: 0 }] } });
    expect(planView(null, view, 5)).toEqual({ ok: false, why: 'blocked' });
  });
  it('開き方の決まり 1 は、いまの形のファイルの見ている位置（六角のファイルの view）。覚えた位置（saved）があればそちらが先', () => {
    const rs14 = cards(14);
    const faces = boardFaces(rs14, null, HEX_GEO.place);
    const fileView: BoardView = { x: 20, y: -280, zoom: 1 }; // 最後に書いたカード（664, 288）が読める
    const load = hexOk(board([], ID, fileView));
    const opts = { place: 'upper' as const, readBox: HEX_GEO.readBox, recent: HEX_GEO.recent };
    expect(openingView(load, rs14, faces, vpOf(217), opts)).toEqual({ view: fileView, rule: 1, n: 0 });
    const kept: BoardView = { x: 15, y: -283, zoom: 1 }; // これも最後に書いたカードが読める、ファイルとは別の位置
    expect(openingView(load, rs14, faces, vpOf(217), { ...opts, saved: kept })).toEqual({ view: kept, rule: 1, n: 0 });
    expect(openingView(hexMissing(), rs14, faces, vpOf(217), opts).rule).toBe(3); // ファイルが無ければ初期の位置なので決まり 2〜4
  });
});

describe('孤児と［整理］（いまの形のファイルだけを数え、六角では文の頭に「六角の並びは、」）', () => {
  const rs = cards(2);
  const withOrphan = board([{ ref: 'c00', x: 0, y: 0 }, { ref: 'gone', x: 5, y: 5 }]);
  it('数えるのは渡した読み込み（いまの形のファイル）だけ。説明の頭は読み込みの形で決める', () => {
    const hex = tidyButton({ load: hexOk(withOrphan), replies: rs });
    expect(hex).toMatchObject({ enabled: true, count: 1 });
    expect(hex.note.startsWith('六角の並びは、')).toBe(true);
    const sq = tidyButton({ load: sqOk(withOrphan), replies: rs });
    expect(sq.note.startsWith('六角')).toBe(false);
    expect(tidyButton({ load: hexOk(board([{ ref: 'c00', x: 0, y: 0 }])), replies: rs })).toEqual({ enabled: false, count: 0, note: tidyNoneNote('hex') });
    expect(tidyButton({ load: hexMissing(), replies: rs })).toMatchObject({ enabled: false, count: 0 });
  });
  it('文：六角では頭に「六角の並びは、」。四角（形を渡さないとき）は今の字のまま', () => {
    expect(orphanNoteText(2, 'hex')).toBe('（六角の並びは、消したカードの位置が 2 件残っています）');
    expect(orphanNoteText(2)).toBe('（消したカードの位置が 2 件残っています）');
    expect(orphanNoteText(0, 'hex')).toBe('');
    expect(tidyConfirmMessage(3, false, 'hex')).toBe('六角の並びは、消したカードの位置 3 件を整理します。元のカードは消えません');
    expect(tidyConfirmMessage(3, true, 'hex').startsWith('六角の並びは、消したカードの位置 3 件を整理します')).toBe(true);
    expect(tidyConfirmMessage(3, false)).toBe('消したカードの位置 3 件を整理します。元のカードは消えません');
    expect(tidyDoneText(3, 'hex')).toBe('六角の並びは、消したカードの位置 3 件を整理しました');
    expect(tidyNoneNote('hex')).toBe('六角の並びは、整理する位置はありません');
    expect(tidyNoneNote()).toBe(TIDY_NONE_NOTE);
  });
  it('整理は渡したボードの孤児だけを落とす（六角のファイルを整理しても、四角のファイルの中身は関わらない）', () => {
    const plan = planTidy(hexOk(withOrphan), rs, 9);
    expect(plan.ok && plan.board.nodes).toEqual([{ ref: 'c00', x: 0, y: 0 }]);
  });
});

describe('読み込みの返りの使い方（loadOutcome。画面の readBoard が使う）', () => {
  it('番・メモ・形が今と違えば捨てる。保存を待っていなければ使う。待っているなら、いまの読み込みがあれば捨て、無ければ覚えか返りを使う（読み込み中のままにしない）', () => {
    const at = (current: boolean, waiting: boolean, loaded: boolean, kept: boolean) => loadOutcome({ current, waiting, loaded, kept });
    for (const w of [false, true]) for (const l of [false, true]) for (const k of [false, true]) expect(at(false, w, l, k)).toBe('drop');
    for (const l of [false, true]) for (const k of [false, true]) expect(at(true, false, l, k)).toBe('use');
    expect(at(true, true, true, true)).toBe('drop');
    expect(at(true, true, true, false)).toBe('drop');
    expect(at(true, true, false, true)).toBe('kept');
    expect(at(true, true, false, false)).toBe('use');
  });
});

describe('読めないときの文（六角のファイルなら頭に「六角の並びは、」）', () => {
  it('面の文と、断る文（動かす・足す・戻す・貼る・整理）', () => {
    const hexBad: LoadBoardResult = { state: 'unreadable', layout: 'hex', memoId: ID, why: 'failed' };
    const sqBad: LoadBoardResult = { state: 'unreadable', layout: 'square', memoId: ID, why: 'failed' };
    expect(boardNote(hexBad)).toEqual({ text: `六角の並びは、${boardNote(sqBad).text}`, tone: 'warn' });
    expect(boardNote(sqBad).text.startsWith('六角')).toBe(false);
    const pairs: [string | null, string | null][] = [
      [moveBlockedNote(hexBad), moveBlockedNote(sqBad)],
      [addBlockedNote(hexBad, []), addBlockedNote(sqBad, [])],
      [undoBlockedNote(hexBad), undoBlockedNote(sqBad)],
      [pasteToolNote(hexBad, []), pasteToolNote(sqBad, [])],
      [tidyButton({ load: hexBad, replies: [] }).note, tidyButton({ load: sqBad, replies: [] }).note],
    ];
    for (const [hex, sq] of pairs) {
      expect(sq?.startsWith('六角')).toBe(false);
      expect(hex).toBe(`六角の並びは、${sq}`);
    }
  });
  it('保存できなかった文も、書く先が六角のファイルなら、読めない・読んだあとに変わったの頭に「六角の並びは、」（ほかの理由と四角は今のまま）', () => {
    for (const why of ['unreadable', 'changed'] as const) {
      expect(boardSaveMessage(why, 'hex')).toBe(`六角の並びは、${boardSaveMessage(why, 'square')}`);
      expect(moveResultNote({ ok: false, why }, 'hex')).toEqual({ text: boardSaveMessage(why, 'hex'), tone: 'warn' });
      expect(viewResultNote({ ok: false, why }, 'hex')).toEqual({ text: boardSaveMessage(why, 'hex'), tone: 'warn' });
    }
    expect(boardSaveMessage('unreadable', 'square')).toBe('ボードのファイルを読めなかったので、位置を保存しませんでした（ファイルは変えていません）');
    expect(boardSaveMessage('changed', 'square')).toBe('ボードのファイルが読んだあとに変わっていたので、保存しませんでした。開き直してください');
    for (const why of ['name', 'memo', 'full', 'size', 'backup', 'write'] as const) expect(boardSaveMessage(why, 'hex'), why).toBe(boardSaveMessage(why, 'square'));
  });
});
