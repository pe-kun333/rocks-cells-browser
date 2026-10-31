// ボードに型を貼る（B3-2b）：計算（基準・座標・ずらし・断り）と、台帳への貼り付け＋座標の保存・元に戻したあとの孤児の確かめ
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

import { BOARD_CARD, type Board, emptyBoard, layoutCards, orphanCount, splitNodes } from '../src/memo-card-board';
import { toolState } from '../src/memo-card-board-edit';
import { groupSize, makeReplyIds, pasteOffsets, pastedAppeared, planBoardPaste, pasteToolNote, spotForGroup } from '../src/memo-card-board-paste';
import type { LoadBoardResult } from '../src/memo-card-board-store';
import { planMoves } from '../src/memo-card-board-view';
import { buildTemplateFromCards, type CardTemplate } from '../src/memo-card-templates';
import { MemoStore } from '../src/memocells';
import { MAX_REPLIES, orderedTops, type Reply } from '../src/threads';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const px = BOARD_CARD.w + BOARD_CARD.gap; // 210
const py = BOARD_CARD.h + BOARD_CARD.gap; // 116
const card = (id: string, text: string, createdAt: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text, createdAt, ...extra });
const view = { x: 0, y: 0, zoom: 1 };
const ok = (board: Board): LoadBoardResult => ({ state: 'ok', memoId: board.memoId, board, dropped: 0, raw: {}, backupNeeded: true });
const missing = (memoId: string): LoadBoardResult => ({ state: 'missing', memoId, board: emptyBoard(memoId, 0), dropped: 0, raw: null, backupNeeded: false });

// 甲（0,0）・乙（右へ 210）・丙（下へ 116）。乙 → 甲 の関連
function sampleTemplate(name = '三枚'): CardTemplate {
  const src = [card('a', '甲\n本文', 1), card('b', '乙', 2, { links: [{ to: 'a', kind: 'ground' }] }), card('c', '丙', 3)];
  const built = buildTemplateFromCards(src, ['a', 'b', 'c'], {
    name,
    folder: '議論',
    newId: () => 'tpl1',
    now: 5,
    offsets: { a: { dx: 0, dy: 0 }, b: { dx: px, dy: 0 }, c: { dx: 0, dy: py } },
  });
  if (!built.ok) throw new Error('型を作れない');
  return built.template;
}

// 位置を持たない型（dx・dy が全部 0）の n 枚
function flatTemplate(n: number): CardTemplate {
  const t = bigTemplate(n);
  for (const c of t.cards) {
    c.dx = 0;
    c.dy = 0;
  }
  return t;
}

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

const seqIds = () => {
  let n = 0;
  return () => `p${n++}`;
};

describe('型を貼る位置（基準・ずらし）', () => {
  it('型のカードの位置は、いちばん左・上を 0 にした差。位置を持たない型は 3 列の升目に並べる', () => {
    expect(pasteOffsets(sampleTemplate())).toEqual([
      { x: 0, y: 0 },
      { x: px, y: 0 },
      { x: 0, y: py },
    ]);
    // 負の位置や、左上が 0 でない型も、差にそろえる
    const shifted = sampleTemplate();
    shifted.cards[0].dx = -100;
    shifted.cards[0].dy = 40;
    shifted.cards[1].dx = 50;
    shifted.cards[1].dy = 40;
    shifted.cards[2].dx = -100;
    shifted.cards[2].dy = 300;
    expect(pasteOffsets(shifted)).toEqual([
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 0, y: 260 },
    ]);
    // 位置を持たない（全部 0）：番地の升目（3 列・190×96＋隙間 20）
    expect(pasteOffsets(flatTemplate(5))).toEqual([
      { x: 0, y: 0 },
      { x: px, y: 0 },
      { x: 2 * px, y: 0 },
      { x: 0, y: py },
      { x: px, y: py },
    ]);
    // 1 枚だけの型は (0,0) のまま（升目に並べる必要が無い）
    expect(pasteOffsets(flatTemplate(1))).toEqual([{ x: 0, y: 0 }]);
    expect(groupSize(pasteOffsets(sampleTemplate()))).toEqual({ w: px + BOARD_CARD.w, h: py + BOARD_CARD.h });
  });

  it('基準：見ている面の中央に一団の中心が来る（パン・ズームを考える）。空いていればずらさない', () => {
    const offsets = pasteOffsets(sampleTemplate());
    const size = groupSize(offsets);
    const spot = spotForGroup(view, { w: 1000, h: 600 }, [], offsets);
    expect(spot).toEqual({ x: Math.round(500 - size.w / 2), y: Math.round(300 - size.h / 2) });
    // パン（原点が右下へ 200,100 ずれている）とズーム 2 倍：中央の点はボード座標で ((500-200)/2, (300-100)/2) = (150, 100)
    const moved = spotForGroup({ x: 200, y: 100, zoom: 2 }, { w: 1000, h: 600 }, [], offsets);
    expect(moved).toEqual({ x: Math.round(150 - size.w / 2), y: Math.round(100 - size.h / 2) });
    // 大きさが 0（隠れている）ときも、貼れる位置を返す
    expect(spotForGroup(view, { w: 0, h: 0 }, [], offsets)).toEqual({ x: 0, y: 0 });
  });

  it('重なるときは、一団ごと升目の間隔で空きへずらす（中央に近い順）。1 枚でも重なれば全体をずらす', () => {
    const offsets = pasteOffsets(sampleTemplate());
    const base = spotForGroup(view, { w: 1000, h: 600 }, [], offsets);
    if (!base) throw new Error('base');
    // 一団のうち 丙（下の左）の位置にだけ既存のカードがある
    const taken = [{ x: base.x + 0, y: base.y + py }];
    const next = spotForGroup(view, { w: 1000, h: 600 }, taken, offsets);
    expect(next).not.toBeNull();
    expect(next).not.toEqual(base);
    if (!next) return;
    // 基準から升目の整数倍だけずれ、一団のどの位置も既存に重ならない
    expect(Math.abs((next.x - base.x) % px)).toBe(0);
    expect(Math.abs((next.y - base.y) % py)).toBe(0);
    for (const d of offsets) {
      const p = { x: next.x + d.x, y: next.y + d.y };
      expect(p.x < taken[0].x + BOARD_CARD.w && taken[0].x < p.x + BOARD_CARD.w && p.y < taken[0].y + BOARD_CARD.h && taken[0].y < p.y + BOARD_CARD.h).toBe(false);
    }

    // 空きが見つからない（輪の中が全部ふさがっている）：null
    const wall = [];
    for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) wall.push({ x: base.x + i * px, y: base.y + j * py });
    expect(spotForGroup(view, { w: 1000, h: 600 }, wall, offsets)).toBeNull();
  });

  it('座標は ±10,000 に収める：はみ出す置き場は使わない。収まる所が無ければ null', () => {
    const offsets = pasteOffsets(sampleTemplate());
    // 見ている場所が端：中央を基準にすると右下へはみ出す → 内側へずらした空きへ
    const edge = spotForGroup({ x: -10_000 + 500, y: -10_000 + 300, zoom: 1 }, { w: 1000, h: 600 }, [], offsets);
    expect(edge).not.toBeNull();
    for (const d of offsets) {
      expect(Math.abs((edge?.x ?? 0) + d.x)).toBeLessThanOrEqual(10_000);
      expect(Math.abs((edge?.y ?? 0) + d.y)).toBeLessThanOrEqual(10_000);
    }
    // 一団が ±10,000 の枠に入らないほど広い型：null
    const wide = sampleTemplate();
    wide.cards[0].dx = -10_000;
    wide.cards[1].dx = 10_000;
    expect(spotForGroup(view, { w: 1000, h: 600 }, [], pasteOffsets(wide))).toBeNull();
  });
});

describe('ボードに貼る計画（断り・id・座標・命令）', () => {
  const existing = () => [card('x', '既存1', 10, { rank: 0 }), card('y', '既存2', 11, { rank: 1 })];

  it('貼れるとき：型の枚数ぶんの id・座標は基準＋型の dx,dy・sendReplies（ids つき）の命令。id は台帳と重ならない', () => {
    const plan = planBoardPaste({ memoId: 'm1', template: sampleTemplate(), replies: existing(), load: missing('m1'), view, viewport: { w: 1000, h: 600 }, taken: [], make: seqIds() });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ids).toEqual(['p0', 'p1', 'p2']);
    expect(plan.moves).toEqual([
      { ref: 'p0', x: plan.origin.x, y: plan.origin.y },
      { ref: 'p1', x: plan.origin.x + px, y: plan.origin.y },
      { ref: 'p2', x: plan.origin.x, y: plan.origin.y + py },
    ]);
    expect(plan.command).toMatchObject({ command: 'sendReplies', from: '', replyIds: [], to: 'm1', mode: 'copy', ids: ['p0', 'p1', 'p2'] });
    expect(plan.template.name).toBe('三枚');
    // 重ならない id：台帳に同じ id が出る make は飛ばして作り直す・お互いにも重ならない
    const clash = ['x', 'x', 'y', 'q1', 'q1', 'q2', 'q3'];
    let i = 0;
    expect(makeReplyIds(existing(), 3, () => clash[i++ % clash.length])).toEqual(['q1', 'q2', 'q3']);
    expect(makeReplyIds(existing(), 2, () => 'x')).toBeNull();
    // 位置を持たない型：升目（3 列）に並ぶ
    const flat = planBoardPaste({ memoId: 'm1', template: flatTemplate(4), replies: [], load: missing('m1'), view, viewport: { w: 1000, h: 600 }, taken: [], make: seqIds() });
    if (!flat.ok) throw new Error('flat');
    expect(flat.moves.map((m) => [m.x - flat.origin.x, m.y - flat.origin.y])).toEqual([
      [0, 0],
      [px, 0],
      [2 * px, 0],
      [0, py],
    ]);
  });

  it('断る：型が読めない・読み込み中・読めないボード・台帳に入りきらない（300）・空きが無い。送る命令は作らない', () => {
    const base = { memoId: 'm1', replies: existing(), view, viewport: { w: 1000, h: 600 }, taken: [] as { x: number; y: number }[] };
    const fail = (over: Partial<Parameters<typeof planBoardPaste>[0]>) => {
      const plan = planBoardPaste({ ...base, template: sampleTemplate(), load: missing('m1'), ...over });
      if (plan.ok) throw new Error('断られるはず');
      return plan.note;
    };
    expect(fail({ template: { version: 1, id: 'x' } })).toContain('読めません');
    expect(fail({ load: null })).toContain('読み込み中');
    expect(fail({ load: { state: 'unreadable', memoId: 'm1', why: 'failed' } })).toContain('書き込みません');
    const nearly = Array.from({ length: MAX_REPLIES - 2 }, (_, i) => card(`e${i}`, `既存 ${i}`, 100 + i, { rank: i }));
    expect(fail({ replies: nearly })).toContain('あと 2 枚まで、型は 3 枚');
    const full = Array.from({ length: MAX_REPLIES }, (_, i) => card(`e${i}`, `既存 ${i}`, 100 + i, { rank: i }));
    expect(fail({ replies: full })).toContain('300 件まで');
    // ちょうど入る（あと 3 枚）なら貼れる
    const exact = Array.from({ length: MAX_REPLIES - 3 }, (_, i) => card(`e${i}`, `既存 ${i}`, 100 + i, { rank: i }));
    expect(planBoardPaste({ ...base, template: sampleTemplate(), load: missing('m1'), replies: exact }).ok).toBe(true);
    // 空きが無い
    const wall = [];
    for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) wall.push({ x: (i - 2) * px, y: (j - 1) * py });
    expect(fail({ taken: wall })).toContain('空き');
    expect(pasteToolNote(missing('m1'), existing())).toBeNull();
  });

  it('ボードの座標の上限（300）：台帳にあるカードの座標＋貼る枚数で数える。台帳に無いカードの座標（孤児）は数えない（保存で先に捨てる）', () => {
    const live = Array.from({ length: 100 }, (_, i) => card(`e${i}`, `既存 ${i}`, 100 + i, { rank: i }));
    const orphans = Array.from({ length: 300 }, (_, i) => ({ ref: `gone${i}`, x: i, y: 0 }));
    const board: Board = { ...emptyBoard('m1', 1), nodes: [...live.map((r, i) => ({ ref: r.id, x: i * 5, y: 5000 })), ...orphans.slice(0, 200)] };
    expect(board.nodes).toHaveLength(300);
    const plan = planBoardPaste({ memoId: 'm1', template: sampleTemplate(), replies: live, load: ok(board), view, viewport: { w: 1000, h: 600 }, taken: [], make: seqIds() });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 保存すると、孤児から先に捨てて 300 に収まる（貼った 3 枚も、既存の 100 枚の座標も残る）
    const saved = planMoves(ok(board), [...live, ...plan.ids.map((id, i) => card(id, `貼った ${i}`, 500 + i))], plan.moves, 9);
    if (!saved.ok) throw new Error('save');
    expect(saved.board.nodes.length).toBeLessThanOrEqual(300);
    const refs = new Set(saved.board.nodes.map((n) => n.ref));
    for (const r of live) expect(refs.has(r.id)).toBe(true);
    for (const id of plan.ids) expect(refs.has(id)).toBe(true);
  });
});

describe('台帳への貼り付けと座標の保存', () => {
  async function pasteOnce(memos: MemoStore, memoId: string, template: CardTemplate, board: Board) {
    const replies = memos.get(memoId)?.replies ?? [];
    const taken = layoutCards(replies, board).map((p) => ({ x: p.x, y: p.y }));
    const plan = planBoardPaste({ memoId, template, replies, load: ok(board), view, viewport: { w: 1000, h: 600 }, taken });
    if (!plan.ok) throw new Error(plan.note);
    if (plan.command.command !== 'sendReplies') throw new Error('command');
    const done = memos.sendReplies({ template: plan.command.template, toId: memoId, ids: plan.command.ids });
    return { plan, done };
  }

  it('貼ると台帳に指定の id で入り、現れてから座標を書く。貼ったカードは指定の位置に出て、既存のカードの位置は変わらない', async () => {
    const memos = await store();
    const m = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ', replies: [card('x', '既存1', 10, { rank: 0 }), card('y', '既存2', 11, { rank: 1 })] });
    if (!m) throw new Error('add');
    const board: Board = { ...emptyBoard(m.id, 1), nodes: [{ ref: 'x', x: 0, y: 0 }, { ref: 'y', x: 300, y: 0 }] };
    const beforeLayout = layoutCards(memos.get(m.id)?.replies ?? [], board);
    const { plan, done } = await pasteOnce(memos, m.id, sampleTemplate(), board);
    expect(done.ok).toBe(true);
    const after = memos.get(m.id)?.replies ?? [];
    expect(pastedAppeared(after, plan.ids)).toBe(true);
    expect(orderedTops(after).slice(-3).map((r) => r.id)).toEqual(plan.ids);
    expect(orderedTops(after).slice(-3).map((r) => r.text)).toEqual(['甲\n本文', '乙', '丙']);
    // 現れてから座標を書く（planMoves は台帳の一番上のカードだけを通す＝現れる前は 1 枚も入らない）
    const early = planMoves(ok(board), memos.get(m.id)?.replies?.filter((r) => !plan.ids.includes(r.id)) ?? [], plan.moves, 5);
    expect(early).toEqual({ ok: false, why: 'notCard' });
    const saved = planMoves(ok(board), after, plan.moves, 5);
    if (!saved.ok) throw new Error('save');
    const layout = layoutCards(after, saved.board);
    for (const [i, id] of plan.ids.entries()) expect(layout.find((p) => p.id === id)).toEqual({ id, x: plan.moves[i].x, y: plan.moves[i].y, saved: true });
    for (const p of beforeLayout) expect(layout.find((q) => q.id === p.id)).toEqual(p); // 既存の位置はそのまま
    // 貼ったカード同士・既存とは重ならない
    for (const a of layout) for (const b of layout) if (a.id < b.id) expect(a.x < b.x + BOARD_CARD.w && b.x < a.x + BOARD_CARD.w && a.y < b.y + BOARD_CARD.h && b.y < a.y + BOARD_CARD.h).toBe(false);
  });

  it('断られたときは台帳に現れない：座標は書かず、孤児は作らない。元に戻したあとの座標は孤児になるだけで害はない', async () => {
    const memos = await store();
    const m = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ', replies: [card('x', '既存1', 10, { rank: 0 })] });
    if (!m) throw new Error('add');
    const board: Board = { ...emptyBoard(m.id, 1), nodes: [{ ref: 'x', x: 0, y: 0 }] };
    // 断られる：左の台帳が id を断る（写しがもう古く、貼る id が台帳にあった）
    const { plan } = await pasteOnce(memos, m.id, sampleTemplate(), board);
    const afterFirst = JSON.stringify(memos.get(m.id)?.replies);
    const refused = memos.sendReplies({ template: sampleTemplate(), toId: m.id, ids: plan.ids }); // 同じ id をもう一度
    expect(refused).toEqual({ ok: false, why: 'ids', idsWhy: 'taken' });
    expect(JSON.stringify(memos.get(m.id)?.replies)).toBe(afterFirst);
    const cutShort = memos.get(m.id)?.replies?.filter((r) => !['q1', 'q2', 'q3'].includes(r.id)) ?? [];
    expect(pastedAppeared(cutShort, ['q1', 'q2', 'q3'])).toBe(false); // 現れなければ、座標は書かない（ボードは変わらない）
    // 元に戻す（undoSend）：貼ったカードが消える。保存した座標は台帳に無い参照＝孤児で、描かれない・ほかのカードの位置は変わらない
    const token = memos.sendReplies({ template: sampleTemplate('二つ目'), toId: m.id, ids: ['u1', 'u2', 'u3'] });
    if (!token.ok) throw new Error('paste2');
    const mid = memos.get(m.id)?.replies ?? [];
    const saved = planMoves(ok(board), mid, [{ ref: 'u1', x: 600, y: 0 }, { ref: 'u2', x: 810, y: 0 }, { ref: 'u3', x: 600, y: 116 }], 7);
    if (!saved.ok) throw new Error('save');
    expect(memos.undoSend(token.token)).toEqual({ ok: true });
    const undone = memos.get(m.id)?.replies ?? [];
    expect(JSON.stringify(undone)).toBe(afterFirst);
    expect(orphanCount(saved.board, undone)).toBe(3);
    expect(layoutCards(undone, saved.board).map((p) => p.id)).toEqual(layoutCards(undone, board).map((p) => p.id));
    expect(splitNodes(saved.board, undone).live.map((n) => n.ref)).toEqual(['x']);
    // 孤児があっても、もう一度貼れる（孤児は座標の数に入れず、保存のときに先に捨てる）
    const again = planBoardPaste({ memoId: m.id, template: sampleTemplate(), replies: undone, load: ok(saved.board), view, viewport: { w: 1000, h: 600 }, taken: [] });
    expect(again.ok).toBe(true);
  });
});

describe('道具の列・画面のつなぎ', () => {
  it('「型を貼る ▾」は選びに関係なく、読み込めていて台帳に空きがあるときだけ押せる', () => {
    const replies = [card('x', '既存', 1)];
    expect(toolState({ selected: [], replies, load: missing('m1') }).paste.enabled).toBe(true);
    expect(toolState({ selected: ['x'], replies, load: missing('m1') }).paste.enabled).toBe(true);
    const off = toolState({ selected: [], replies, load: null }).paste;
    expect(off.enabled).toBe(false);
    expect(off.note).toContain('読み込み中');
    expect(toolState({ selected: [], replies, load: { state: 'unreadable', memoId: 'm1', why: 'failed' } }).paste.enabled).toBe(false);
    const full = Array.from({ length: MAX_REPLIES }, (_, i) => card(`e${i}`, `既存 ${i}`, 100 + i));
    expect(toolState({ selected: [], replies: full, load: missing('m1') }).paste.enabled).toBe(false);
  });

  it('ボードの面は、命令を送ってから現れるのを待ち、現れたあとで保存する（順序）。下の区画の貼り付けは ids を付けない', () => {
    const tab = readFileSync(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8');
    const start = tab.indexOf('private pasteOnBoard(');
    const end = tab.indexOf('private startEdit(', start) > 0 ? tab.indexOf('private startEdit(', start) : tab.length;
    const body = tab.slice(start, end);
    expect(start).toBeGreaterThan(0);
    const iAsk = body.indexOf('this.ask(plan.command)');
    const iWatch = body.indexOf('pastedAppeared(rs, ids)');
    const iSave = body.indexOf('saveBoard(');
    const iSelect = body.indexOf('this.setSelected(new Set(ids))');
    expect(iAsk).toBeGreaterThan(0);
    expect(iWatch).toBeGreaterThan(iAsk);
    expect(iSelect).toBeGreaterThan(iWatch);
    expect(iSave).toBeGreaterThan(iSelect);
    expect(body.slice(0, iWatch)).not.toContain('saveBoard(');
    const pane = readFileSync(new URL('../src/app/memo-pane.ts', import.meta.url), 'utf8').split(/\r?\n/);
    for (const line of pane) if (line.includes("command: 'sendReplies'")) expect(line).not.toMatch(/\bids\s*:/);
  });
});