// 自由配置ボードの計算（B1-1。形・検査・上限・仮の並び・座標の変換・孤児。DOM も保存も使わない）
import { describe, expect, it } from 'vitest';

import {
  BOARD_CARD,
  BOARD_FORMAT,
  BOARD_LIMITS,
  BOARD_VERSION,
  type Board,
  boardBackupName,
  boardFileName,
  boardToScreen,
  clampView,
  DEFAULT_VIEW,
  emptyBoard,
  fitView,
  layoutCards,
  liveRefs,
  moveNodes,
  orphanCount,
  panBy,
  parseBoard,
  placementBounds,
  pruneOrphans,
  screenDeltaToBoard,
  screenToBoard,
  serializeBoard,
  setView,
  slotPosition,
  splitNodes,
  toBoardFile,
  trimNodes,
  zoomAt,
} from '../src/memo-card-board';
import { TEMPLATE_GRID } from '../src/memo-card-templates';
import { CARD_COLUMNS, MAX_REPLIES, type Reply } from '../src/threads';

const card = (id: string, rank?: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text: id, createdAt: 1, ...(rank === undefined ? {} : { rank }), ...extra });
const file = (over: Record<string, unknown> = {}) => ({
  format: BOARD_FORMAT,
  version: BOARD_VERSION,
  memoId: 'm1abc',
  updatedAt: 100,
  view: { x: 10, y: 20, zoom: 0.5 },
  nodes: [{ ref: 'r1', x: 5, y: 6 }],
  ...over,
});
const ok = (raw: unknown, memoId = 'm1abc') => {
  const r = parseBoard(raw, { memoId });
  if (!r.ok) throw new Error(`読めるはずが ${r.why}`);
  return r;
};
const board = (nodes: { ref: string; x: number; y: number }[] = [], memoId = 'm1abc'): Board => ({ ...emptyBoard(memoId, 1), nodes });

describe('決まりの値', () => {
  it('カードの大きさ・隙間は型の TEMPLATE_GRID と同じ値を共有する（190×96・隙間 20）', () => {
    expect(BOARD_CARD).toEqual({ w: 190, h: 96, gap: 20 });
    expect(BOARD_CARD).toEqual({ w: TEMPLATE_GRID.cardW, h: TEMPLATE_GRID.cardH, gap: TEMPLATE_GRID.gap });
  });
  it('上限：300 件・±10,000・200 KB', () => {
    expect(BOARD_LIMITS.nodes).toBe(MAX_REPLIES);
    expect(BOARD_LIMITS.nodes).toBe(300);
    expect(BOARD_LIMITS.coord).toBe(10_000);
    expect(BOARD_LIMITS.fileBytes).toBe(200 * 1024);
    expect(BOARD_VERSION).toBe(1);
  });
});

describe('保存先の名前', () => {
  // src/storage.cpp の UiDataFile と同じ規則
  const cppRule = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+){0,3}\.json$/;
  it('boards/<メモ id>.json と、控え boards/<メモ id>-before-v1.json', () => {
    expect(boardFileName('m1abc2defgh12')).toBe('boards/m1abc2defgh12.json');
    expect(boardBackupName('m1abc2defgh12')).toBe('boards/m1abc2defgh12-before-v1.json');
  });
  it('C++ の名前の規則（段・文字・200 字）に合う。実際のメモ id（m<base36><乱数 4>）も通る', () => {
    const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    for (const name of [boardFileName(id), boardBackupName(id)]) {
      expect(name).not.toBeNull();
      expect(cppRule.test(name as string)).toBe(true);
      expect((name as string).length).toBeLessThanOrEqual(200);
    }
  });
  it('名前に使えないメモ id は null（書かない）', () => {
    for (const bad of ['', 'a/b', 'a.b', '../x', 'メモ', 'a b', 'x'.repeat(65)]) {
      expect(boardFileName(bad)).toBeNull();
      expect(boardBackupName(bad)).toBeNull();
    }
  });
});

describe('parseBoard：読んで検査する', () => {
  it('ふつうの形はそのまま読める（dropped は 0）', () => {
    const r = ok(file());
    expect(r.dropped).toBe(0);
    expect(r.board).toEqual({ memoId: 'm1abc', updatedAt: 100, view: { x: 10, y: 20, zoom: 0.5 }, nodes: [{ ref: 'r1', x: 5, y: 6 }] });
  });
  it('toBoardFile で書いたものを読み戻せる', () => {
    const b: Board = { memoId: 'm1abc', updatedAt: 7, view: { x: -3, y: 4, zoom: 1.5 }, nodes: [{ ref: 'a', x: -10, y: 20 }, { ref: 'b', x: 30, y: 40 }] };
    expect(ok(toBoardFile(b)).board).toEqual(b);
  });
  it('object でないものは format で断る', () => {
    for (const bad of [null, undefined, 1, 'x', [], true]) expect(parseBoard(bad, { memoId: 'm1abc' })).toEqual({ ok: false, why: 'format' });
  });
  it('format が違う', () => {
    expect(parseBoard(file({ format: 'honeycomb-cardtpl' }), { memoId: 'm1abc' })).toEqual({ ok: false, why: 'format' });
  });
  it('今より大きい版・整数でない版・0 以下・数でない版は version で断る', () => {
    for (const v of [2, 99, 1.5, 0, -1, '1', null, undefined]) expect(parseBoard(file({ version: v }), { memoId: 'm1abc' })).toEqual({ ok: false, why: 'version' });
  });
  it('メモ id が食い違う・名前に使えないときは memo', () => {
    expect(parseBoard(file(), { memoId: 'mother' })).toEqual({ ok: false, why: 'memo' });
    expect(parseBoard(file({ memoId: 'a/b' }), { memoId: 'a/b' })).toEqual({ ok: false, why: 'memo' });
    expect(parseBoard(file({ memoId: 5 }), { memoId: 'm1abc' })).toEqual({ ok: false, why: 'memo' });
  });
  it('nodes が配列でなければ shape', () => {
    for (const bad of [undefined, null, {}, 'x', 3]) expect(parseBoard(file({ nodes: bad }), { memoId: 'm1abc' })).toEqual({ ok: false, why: 'shape' });
  });
  it('200 KB を超えたら size（ちょうど手前までは読める）', () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ ref: `r${i}`, x: 0, y: 0, pad: 'x'.repeat(30_000) }));
    expect(parseBoard(file({ nodes: big }), { memoId: 'm1abc' })).toEqual({ ok: false, why: 'size' });
    const small = Array.from({ length: 3 }, (_, i) => ({ ref: `r${i}`, x: 0, y: 0, pad: 'x'.repeat(30_000) }));
    expect(parseBoard(file({ nodes: small }), { memoId: 'm1abc' }).ok).toBe(true);
  });
  it('丸められない循環のある値は shape（落ちない）', () => {
    const loop: Record<string, unknown> = file();
    loop.self = loop;
    expect(parseBoard(loop, { memoId: 'm1abc' })).toEqual({ ok: false, why: 'shape' });
  });

  it('x・y は整数に丸め、±10,000 に収める。-0 は 0', () => {
    const r = ok(file({ nodes: [{ ref: 'a', x: 1.4, y: 1.6 }, { ref: 'b', x: 99999, y: -99999 }, { ref: 'c', x: -0.2, y: -0.4 }] }));
    expect(r.board.nodes).toEqual([{ ref: 'a', x: 1, y: 2 }, { ref: 'b', x: 10_000, y: -10_000 }, { ref: 'c', x: 0, y: 0 }]);
    expect(Object.is(r.board.nodes[2].x, 0)).toBe(true);
    expect(r.dropped).toBe(0);
  });
  it('悪いノード（ref・x・y の形）だけ捨てる。捨てた数を返す', () => {
    const r = ok(file({ nodes: [{ ref: 'ok1', x: 1, y: 2 }, null, 'x', { ref: 5, x: 1, y: 1 }, { ref: 'a/b', x: 1, y: 1 }, { ref: '', x: 1, y: 1 }, { ref: 'nan', x: NaN, y: 1 }, { ref: 'str', x: '1', y: 1 }, { ref: 'inf', x: 1, y: Infinity }, { ref: 'ok2', x: 3, y: 4 }] }));
    expect(r.board.nodes.map((n) => n.ref)).toEqual(['ok1', 'ok2']);
    expect(r.dropped).toBe(8);
  });
  it('同じ ref は先のものを残し、あとのものを捨てる', () => {
    const r = ok(file({ nodes: [{ ref: 'a', x: 1, y: 1 }, { ref: 'a', x: 9, y: 9 }, { ref: 'b', x: 2, y: 2 }] }));
    expect(r.board.nodes).toEqual([{ ref: 'a', x: 1, y: 1 }, { ref: 'b', x: 2, y: 2 }]);
    expect(r.dropped).toBe(1);
  });
  it('300 件を超える分は捨てる（先の 300 件を残し、捨てた数を返す）', () => {
    const nodes = Array.from({ length: 305 }, (_, i) => ({ ref: `r${i}`, x: i, y: 0 }));
    const r = ok(file({ nodes }));
    expect(r.board.nodes).toHaveLength(300);
    expect(r.board.nodes[299].ref).toBe('r299');
    expect(r.dropped).toBe(5);
  });
  it('view が無い・形が悪いときは初期の位置。zoom は 0.25〜2、位置は ±20,000 に収める', () => {
    expect(ok(file({ view: undefined })).board.view).toEqual(DEFAULT_VIEW);
    expect(ok(file({ view: 'x' })).board.view).toEqual(DEFAULT_VIEW);
    expect(ok(file({ view: { x: 'a', y: null, zoom: 'b' } })).board.view).toEqual(DEFAULT_VIEW);
    expect(ok(file({ view: { x: 1e9, y: -1e9, zoom: 50 } })).board.view).toEqual({ x: 20_000, y: -20_000, zoom: 2 });
    expect(ok(file({ view: { x: 0, y: 0, zoom: 0.001 } })).board.view.zoom).toBe(0.25);
  });
  it('updatedAt が数でない・負のときは 0', () => {
    for (const v of [undefined, 'x', -5, NaN, Infinity]) expect(ok(file({ updatedAt: v })).board.updatedAt).toBe(0);
    expect(ok(file({ updatedAt: 12.9 })).board.updatedAt).toBe(12);
  });
  it('知らない項目（文・タグなど）は読み捨てる。ノードの余分な項目も', () => {
    const r = ok(file({ text: 'ひみつ', tags: ['宛て:grok'], nodes: [{ ref: 'a', x: 1, y: 2, text: 'ひみつ', tags: ['送った:x'] }] }));
    expect(Object.keys(r.board).sort()).toEqual(['memoId', 'nodes', 'updatedAt', 'view']);
    expect(Object.keys(r.board.nodes[0]).sort()).toEqual(['ref', 'x', 'y']);
  });
  it('読んだ値を壊さない（入力を書き換えない）', () => {
    const raw = file({ nodes: [{ ref: 'a', x: 1.6, y: 2 }] });
    const copy = JSON.parse(JSON.stringify(raw));
    ok(raw);
    expect(raw).toEqual(copy);
  });
});

describe('toBoardFile・serializeBoard：書く形（機械タグ・文は入りようがない）', () => {
  it('決まった項目だけ。ボードの値にほかの項目が紛れても入らない', () => {
    const dirty = {
      memoId: 'm1abc',
      updatedAt: 5,
      view: { x: 1, y: 2, zoom: 1, extra: 'x' },
      nodes: [{ ref: 'a', x: 1, y: 2, text: 'カードの文', tags: ['宛て:grok', '送った:chat', '貼った:型'] }],
      text: 'メモの文',
      tags: ['宛て:grok'],
    } as unknown as Board;
    const out = toBoardFile(dirty);
    expect(Object.keys(out).sort()).toEqual(['format', 'memoId', 'nodes', 'updatedAt', 'version', 'view']);
    expect(Object.keys(out.nodes[0]).sort()).toEqual(['ref', 'x', 'y']);
    expect(Object.keys(out.view).sort()).toEqual(['x', 'y', 'zoom']);
    const text = JSON.stringify(out);
    for (const word of ['宛て', '送った', '貼った', 'カードの文', 'メモの文', 'tags', 'text']) expect(text).not.toContain(word);
  });
  it('座標・view は書く前にも整えて収める。形の悪い ref は書かない', () => {
    const out = toBoardFile({ memoId: 'm1abc', updatedAt: 1.9, view: { x: 1e9, y: 0, zoom: 9 }, nodes: [{ ref: 'a', x: 1e9, y: -0.4 }, { ref: 'a/b', x: 0, y: 0 }] });
    expect(out.updatedAt).toBe(1);
    expect(out.view).toEqual({ x: 20_000, y: 0, zoom: 2 });
    expect(out.nodes).toEqual([{ ref: 'a', x: 10_000, y: 0 }]);
  });
  it('serializeBoard：読み戻せる文字列。大きすぎる・メモ id が使えないときは null', () => {
    const b = board([{ ref: 'a', x: 1, y: 2 }]);
    const text = serializeBoard(b);
    expect(text).not.toBeNull();
    expect(ok(JSON.parse(text as string)).board.nodes).toEqual(b.nodes);
    expect(serializeBoard(board([], 'a/b'))).toBeNull();
    // 上限（300 件）の最大でも 200 KB に収まる
    const full = board(Array.from({ length: 300 }, (_, i) => ({ ref: `r${'x'.repeat(40)}${i}`, x: -10_000, y: -10_000 })));
    expect(serializeBoard(full)).not.toBeNull();
    // ref は 64 字まで・300 件でも 200 KB には届かない（大きくなりうるのは読むときの余分な項目で、それは parseBoard が size で断る）
    expect(new TextEncoder().encode(serializeBoard(full) as string).length).toBeLessThan(BOARD_LIMITS.fileBytes);
  });
});

describe('trimNodes：300 件を超えるときの整理', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ref: `r${i}`, x: i, y: 0 }));
  it('上限以下はそのまま（コピー）', () => {
    const nodes = many(5);
    const out = trimNodes(nodes);
    expect(out).toEqual(nodes);
    expect(out).not.toBe(nodes);
  });
  it('live を渡さないと後ろから捨てる', () => {
    const out = trimNodes(many(8), undefined, 5);
    expect(out.map((n) => n.ref)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });
  it('孤児を先頭（古い）から捨て、足りなければ後ろから捨てる', () => {
    const live = new Set(['r1', 'r3', 'r5', 'r6', 'r7']);
    // 8 件→5 件：孤児は r0・r2・r4。3 件とも捨てれば足りる
    expect(trimNodes(many(8), live, 5).map((n) => n.ref)).toEqual(['r1', 'r3', 'r5', 'r6', 'r7']);
    // 8 件→3 件：孤児 3 件を捨ててもあと 2 件多い → 後ろから r7・r6 を捨てる
    expect(trimNodes(many(8), live, 3).map((n) => n.ref)).toEqual(['r1', 'r3', 'r5']);
    // 孤児が 1 件だけで 3 件多い → 孤児 r0 を捨て、あと 2 件を後ろから（r7・r6）
    expect(trimNodes(many(8), new Set(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']), 5).map((n) => n.ref)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  });
});

describe('moveNodes・setView：更新（元は変えない）', () => {
  it('仮の位置だったカードを動かすとノードが足される。動かしたものは座標が変わる', () => {
    const b0 = board([{ ref: 'a', x: 0, y: 0 }]);
    const b1 = moveNodes(b0, [{ ref: 'a', x: 50, y: 60 }, { ref: 'b', x: 7.6, y: -3.2 }], 99);
    expect(b1.nodes).toEqual([{ ref: 'a', x: 50, y: 60 }, { ref: 'b', x: 8, y: -3 }]);
    expect(b1.updatedAt).toBe(99);
    expect(b0.nodes).toEqual([{ ref: 'a', x: 0, y: 0 }]);
    expect(b0.updatedAt).toBe(1);
  });
  it('座標は ±10,000 に収める。形の悪い ref・数でない座標は無視する', () => {
    const b = moveNodes(board(), [{ ref: 'a', x: 5e5, y: -5e5 }, { ref: 'a/b', x: 1, y: 1 }, { ref: 'c', x: NaN, y: 1 }], 5);
    expect(b.nodes).toEqual([{ ref: 'a', x: 10_000, y: -10_000 }]);
  });
  it('何も変わらなければ同じ board を返す（保存しない目印）', () => {
    const b0 = board([{ ref: 'a', x: 1, y: 2 }]);
    expect(moveNodes(b0, [{ ref: 'a', x: 1, y: 2 }], 9)).toBe(b0);
    expect(moveNodes(b0, [], 9)).toBe(b0);
    expect(moveNodes(b0, [{ ref: 'bad/x', x: 1, y: 1 }], 9)).toBe(b0);
  });
  it('300 件を超えるときは孤児から入れ替える', () => {
    const nodes = Array.from({ length: 300 }, (_, i) => ({ ref: `r${i}`, x: i, y: 0 }));
    const live = new Set(nodes.map((n) => n.ref).filter((r) => r !== 'r0'));
    live.add('new');
    const b = moveNodes(board(nodes), [{ ref: 'new', x: 1, y: 1 }], 5, live);
    expect(b.nodes).toHaveLength(300);
    expect(b.nodes.some((n) => n.ref === 'r0')).toBe(false);
    expect(b.nodes.some((n) => n.ref === 'new')).toBe(true);
  });
  it('setView：収めて入れる。変わらなければ同じ board', () => {
    const b0 = board();
    const b1 = setView(b0, { x: 5.4, y: 6, zoom: 9 }, 3);
    expect(b1.view).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(b1.updatedAt).toBe(3);
    expect(setView(b1, { x: 5, y: 6, zoom: 2 }, 4)).toBe(b1);
    expect(b0.view).toEqual(DEFAULT_VIEW);
  });
});

describe('孤児（台帳に無い・一番上でない ref）', () => {
  const replies: Reply[] = [card('a', 0), card('b', 1), { id: 'b1', parent: 'b', text: '返信', createdAt: 2 }];
  it('liveRefs は一番上のカードだけ', () => {
    expect([...liveRefs(replies)].sort()).toEqual(['a', 'b']);
  });
  it('消えたカード・返信の返信を指す ref は孤児', () => {
    const b = board([{ ref: 'a', x: 1, y: 1 }, { ref: 'gone', x: 2, y: 2 }, { ref: 'b1', x: 3, y: 3 }]);
    const { live, orphans } = splitNodes(b, replies);
    expect(live.map((n) => n.ref)).toEqual(['a']);
    expect(orphans.map((n) => n.ref)).toEqual(['gone', 'b1']);
    expect(orphanCount(b, replies)).toBe(2);
  });
  it('pruneOrphans は孤児だけ消す。孤児が無ければ同じ board', () => {
    const b = board([{ ref: 'a', x: 1, y: 1 }, { ref: 'gone', x: 2, y: 2 }]);
    const p = pruneOrphans(b, replies, 8);
    expect(p.nodes).toEqual([{ ref: 'a', x: 1, y: 1 }]);
    expect(p.updatedAt).toBe(8);
    expect(b.nodes).toHaveLength(2);
    expect(pruneOrphans(p, replies, 9)).toBe(p);
  });
});

describe('仮の並び（番地を升目に写す）', () => {
  const stepX = BOARD_CARD.w + BOARD_CARD.gap;
  const stepY = BOARD_CARD.h + BOARD_CARD.gap;
  it('slotPosition：番地 = 行 × 3 ＋ 列 → (列 × 210, 行 × 116)', () => {
    expect(CARD_COLUMNS).toBe(3);
    expect(slotPosition(0)).toEqual({ x: 0, y: 0 });
    expect(slotPosition(2)).toEqual({ x: 2 * stepX, y: 0 });
    expect(slotPosition(3)).toEqual({ x: 0, y: stepY });
    expect(slotPosition(7)).toEqual({ x: stepX, y: 2 * stepY });
    expect(slotPosition(-4)).toEqual({ x: 0, y: 0 });
    expect(slotPosition(1.9)).toEqual({ x: stepX, y: 0 });
  });
  it('board が無い（読めない・まだ無い）ときは全部仮の位置。台帳の並び（rank 順）', () => {
    const replies = [card('c', 2), card('a', 0), card('b', 1), card('d', 3)];
    const out = layoutCards(replies, null);
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(out.every((p) => !p.saved)).toBe(true);
    expect(out.map((p) => [p.x, p.y])).toEqual([[0, 0], [stepX, 0], [2 * stepX, 0], [0, stepY]]);
  });
  it('番地の間（rank の空き）は升目の空きとして残る。rank の無いカードは最後の次から作った順', () => {
    const replies = [card('a', 0), card('b', 4), card('n1', undefined, { createdAt: 5 }), card('n2', undefined, { createdAt: 6 })];
    const out = layoutCards(replies, null);
    expect(out.map((p) => [p.id, p.x, p.y])).toEqual([
      ['a', 0, 0],
      ['b', stepX, stepY],
      ['n1', 2 * stepX, stepY],
      ['n2', 0, 2 * stepY],
    ]);
  });
  it('返信の返信は描かない。機械タグのカードも 1 枚の置き場所として並ぶ（置き場所には文もタグも無い）', () => {
    const replies = [card('a', 0, { tags: ['宛て:grok'] }), { id: 'a1', parent: 'a', text: '返信', createdAt: 2 }, card('b', 1, { tags: ['送った:chat', '貼った:型'] })];
    const out = layoutCards(replies, null);
    expect(out.map((p) => p.id)).toEqual(['a', 'b']);
    for (const p of out) expect(Object.keys(p).sort()).toEqual(['id', 'saved', 'x', 'y']);
  });
  it('保存した位置はそのまま（saved）。ほかは仮の位置', () => {
    const replies = [card('a', 0), card('b', 1), card('c', 2)];
    const out = layoutCards(replies, board([{ ref: 'b', x: 500, y: -200 }]));
    expect(out.find((p) => p.id === 'b')).toEqual({ id: 'b', x: 500, y: -200, saved: true });
    expect(out.find((p) => p.id === 'a')).toEqual({ id: 'a', x: 0, y: 0, saved: false });
    expect(out.find((p) => p.id === 'c')).toEqual({ id: 'c', x: 2 * stepX, y: 0, saved: false });
  });
  it('仮の位置が保存したカードに重なるときは、重ならない最初の空きの升目へずらす（保存はしない）', () => {
    const replies = [card('a', 0), card('b', 1), card('c', 2)];
    // b を a の升目（0,0）に重ねて保存した → a の仮の位置は b と重なる → 次の升目へ。c は元の升目のまま
    const b0 = board([{ ref: 'b', x: 0, y: 0 }]);
    const out = layoutCards(replies, b0);
    expect(out.find((p) => p.id === 'a')).toEqual({ id: 'a', x: stepX, y: 0, saved: false });
    expect(out.find((p) => p.id === 'c')).toEqual({ id: 'c', x: 2 * stepX, y: 0, saved: false });
    expect(b0.nodes).toEqual([{ ref: 'b', x: 0, y: 0 }]);
  });
  it('ずらした仮の位置どうしも重ならない。ふれるだけ（隙間 0）は重なりではない', () => {
    const replies = [card('a', 0), card('b', 1), card('c', 2), card('d', 3)];
    // 保存した x は a の升目の少しずれ：(100,0) は升目 0（0〜190）・升目 1（210〜400）に掛かる
    const out = layoutCards(replies, board([{ ref: 'd', x: 100, y: 0 }]));
    const rects = out.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap = a.x < b.x + BOARD_CARD.w && b.x < a.x + BOARD_CARD.w && a.y < b.y + BOARD_CARD.h && b.y < a.y + BOARD_CARD.h;
        expect(overlap).toBe(false);
      }
    // ふれるだけ：保存したカードがちょうど w だけ右（190,0）にあっても、升目 0 の a は動かない
    const touch = layoutCards([card('a', 0), card('z', 1)], board([{ ref: 'z', x: BOARD_CARD.w, y: 0 }]));
    expect(touch.find((p) => p.id === 'a')).toEqual({ id: 'a', x: 0, y: 0, saved: false });
  });
  it('決まった結果（同じ入力なら同じ並び）。300 枚でも終わる', () => {
    const replies = Array.from({ length: 300 }, (_, i) => card(`r${i}`, i));
    const nodes = Array.from({ length: 150 }, (_, i) => ({ ref: `r${i * 2}`, x: (i % 10) * 105, y: Math.floor(i / 10) * 58 }));
    const a = layoutCards(replies, board(nodes));
    const b = layoutCards(replies, board(nodes));
    expect(a).toEqual(b);
    expect(a).toHaveLength(300);
    expect(a.filter((p) => p.saved)).toHaveLength(150);
  });
  it('台帳に無い ref のノードは置き場所に出ない（孤児は描かない）', () => {
    const out = layoutCards([card('a', 0)], board([{ ref: 'gone', x: 5, y: 5 }, { ref: 'a', x: 9, y: 9 }]));
    expect(out).toEqual([{ id: 'a', x: 9, y: 9, saved: true }]);
  });
  it('カードが 0 枚なら空', () => {
    expect(layoutCards([], null)).toEqual([]);
  });
});

describe('座標の変換・パン・ズーム', () => {
  const view = { x: 40, y: -20, zoom: 0.5 };
  it('ボード⇄画面は往復して戻る', () => {
    const s = boardToScreen(view, 100, 60);
    expect(s).toEqual({ x: 90, y: 10 });
    expect(screenToBoard(view, s.x, s.y)).toEqual({ x: 100, y: 60 });
    for (const z of [0.25, 0.7, 1, 2]) {
      const v = { x: 13, y: -7, zoom: z };
      const p = screenToBoard(v, 200, 150);
      const back = boardToScreen(v, p.x, p.y);
      expect(back.x).toBeCloseTo(200, 9);
      expect(back.y).toBeCloseTo(150, 9);
    }
  });
  it('screenDeltaToBoard：画面でつまんだ量を zoom で割る', () => {
    expect(screenDeltaToBoard({ x: 0, y: 0, zoom: 0.5 }, 10, -4)).toEqual({ x: 20, y: -8 });
    expect(screenDeltaToBoard({ x: 99, y: 99, zoom: 2 }, 10, -4)).toEqual({ x: 5, y: -2 });
  });
  it('panBy：位置を動かす。±20,000 に収める。zoom は変えない', () => {
    expect(panBy(view, 10, 5)).toEqual({ x: 50, y: -15, zoom: 0.5 });
    expect(panBy(view, 1e9, -1e9)).toEqual({ x: 20_000, y: -20_000, zoom: 0.5 });
  });
  it('zoomAt：指した点の下のボードの点が動かない', () => {
    const v0 = { x: 30, y: 10, zoom: 1 };
    const before = screenToBoard(v0, 200, 120);
    const v1 = zoomAt(v0, 1.5, 200, 120);
    const after = screenToBoard(v1, 200, 120);
    expect(v1.zoom).toBe(1.5);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });
  it('zoomAt：zoom は 0.25〜2 に収まり、収まった倍率の分だけ動く。不正な倍率は何もしない', () => {
    const top = zoomAt({ x: 0, y: 0, zoom: 1.9 }, 10, 50, 50);
    expect(top.zoom).toBe(2);
    const bottom = zoomAt({ x: 0, y: 0, zoom: 0.3 }, 0.01, 50, 50);
    expect(bottom.zoom).toBe(0.25);
    const v = { x: 1, y: 2, zoom: 1 };
    for (const f of [0, -1, NaN, Infinity]) expect(zoomAt(v, f, 0, 0)).toBe(v);
  });
  it('clampView：数でない値は 0・zoom は 1', () => {
    expect(clampView({ x: NaN, y: Infinity, zoom: NaN })).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe('全体表示 fitView', () => {
  const vp = { w: 900, h: 250 };
  it('カードが無い・面が小さすぎるときは初期の位置', () => {
    expect(fitView(null, vp)).toEqual(DEFAULT_VIEW);
    expect(fitView({ x: 0, y: 0, w: 100, h: 100 }, { w: 30, h: 250 })).toEqual(DEFAULT_VIEW);
    expect(fitView({ x: 0, y: 0, w: 0, h: 10 }, vp)).toEqual(DEFAULT_VIEW);
  });
  it('1 枚だけなら 1.2 倍までで中央に置く', () => {
    const b = placementBounds([{ x: 0, y: 0 }]);
    expect(b).toEqual({ x: 0, y: 0, w: 190, h: 96 });
    const v = fitView(b, vp);
    expect(v.zoom).toBe(1.2);
    const c = boardToScreen(v, 95, 48);
    expect(c.x).toBeCloseTo(450, 0);
    expect(c.y).toBeCloseTo(125, 0);
  });
  it('広いボードは縮めて収める（余白 18）。四角が面の中に入る', () => {
    const b = placementBounds([{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 0, y: 300 }, { x: 900, y: 300 }]) as { x: number; y: number; w: number; h: number };
    const v = fitView(b, vp);
    const tl = boardToScreen(v, b.x, b.y);
    const br = boardToScreen(v, b.x + b.w, b.y + b.h);
    expect(tl.x).toBeGreaterThanOrEqual(18 - 1);
    expect(tl.y).toBeGreaterThanOrEqual(18 - 1);
    expect(br.x).toBeLessThanOrEqual(vp.w - 18 + 1);
    expect(br.y).toBeLessThanOrEqual(vp.h - 18 + 1);
    expect(v.zoom).toBeLessThan(1);
  });
  it('巨大なボードでも zoom は 0.25 より小さくならない', () => {
    const v = fitView({ x: 0, y: 0, w: 100_000, h: 100_000 }, vp);
    expect(v.zoom).toBe(0.25);
  });
  it('placementBounds：負の座標も含めて囲む。空は null', () => {
    expect(placementBounds([])).toBeNull();
    expect(placementBounds([{ x: -100, y: 10 }, { x: 50, y: -30 }])).toEqual({ x: -100, y: -30, w: 340, h: 136 });
  });
});