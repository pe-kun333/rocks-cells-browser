import { describe, expect, it } from 'vitest';
import { BOARD_CARD, BOARD_LIMITS, DEFAULT_VIEW, emptyBoard, parseBoard, serializeBoard, type Board } from '../src/memo-card-board';
import {
  BOARD_FACE,
  boardEmptyText,
  boardFaces,
  boardLinks,
  boardNote,
  cardFace,
  cardMark,
  DRAG_THRESHOLD,
  dimmedIds,
  dragPosition,
  edgeGeometry,
  fitAll,
  initialView,
  linkDimmed,
  moveBlockedNote,
  moveResultNote,
  pastThreshold,
  planMove,
  planMoves,
  planView,
  replyCount,
  searchText,
  searchWords,
  VIEW_SAVE_DELAY,
  viewResultNote,
  viewSaveWait,
  wheelZoomFactor,
  withPending,
} from '../src/memo-card-board-view';
import { boardSaveMessage, type LoadBoardResult, type SaveBoardResult } from '../src/memo-card-board-store';
import type { Reply } from '../src/threads';

let seq = 0;
const reply = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt: 1000 + seq++, ...over });
const board = (nodes: Board['nodes'], view = DEFAULT_VIEW): Board => ({ ...emptyBoard('m1', 5), view: { ...view }, nodes });
const ok = (b: Board): LoadBoardResult => ({ state: 'ok', memoId: 'm1', board: b, dropped: 0, raw: null, backupNeeded: false });

describe('cardFace（顔）', () => {
  it('題は 1 行目、本文の頭は 2 行目以降をつなげたもの', () => {
    const r = reply('r1', { text: '見積もりの比較\n保守は来期から\n1.3 倍' });
    const f = cardFace([r], r, { x: 10, y: 20, saved: true });
    expect(f).toMatchObject({ id: 'r1', x: 10, y: 20, saved: true, title: '見積もりの比較', body: '保守は来期から 1.3 倍', tags: [], moreTags: 0, mark: '' });
  });
  it('長い題・本文は切る', () => {
    const r = reply('r1', { text: `${'あ'.repeat(60)}\n${'い'.repeat(100)}` });
    const f = cardFace([r], r, { x: 0, y: 0, saved: false });
    expect([...f.title].length).toBe(BOARD_FACE.titleMax + 1);
    expect(f.title.endsWith('…')).toBe(true);
    expect([...f.body].length).toBe(BOARD_FACE.bodyMax + 1);
    expect(f.saved).toBe(false);
  });
  it('画像・引用のカードは題と印だけ（本文は出さない）', () => {
    const q = reply('r1', { text: '', quote: { text: 'ページの文', url: 'https://example.com/', title: '記事の題' } });
    const i = reply('r2', { text: '写真\n二行目', image: 'shot1' });
    expect(cardFace([q], q, { x: 0, y: 0, saved: true })).toMatchObject({ title: '記事の題', body: '', mark: '❝' });
    expect(cardFace([i], i, { x: 0, y: 0, saved: true })).toMatchObject({ title: '写真', body: '', mark: '📷' });
  });
  it('機械タグは出さない。タグは 3 つまで、残りは数', () => {
    const r = reply('r1', { tags: ['宛て:everyone', '調査', '送った:bot1', '価格', '貼った:x', '保守', '予算', '急ぎ'] });
    const f = cardFace([r], r, { x: 0, y: 0, saved: true });
    expect(f.tags).toEqual(['調査', '価格', '保守']);
    expect(f.moreTags).toBe(2);
    expect(JSON.stringify(f)).not.toMatch(/宛て:|送った:|貼った:/);
  });
  it('返信の数（返信の返信も）が印に出る', () => {
    const top = reply('r1');
    const rs = [top, reply('r2', { parent: 'r1' }), reply('r3', { parent: 'r2' }), reply('r4')];
    expect(replyCount(rs, 'r1')).toBe(2);
    expect(replyCount(rs, 'r4')).toBe(0);
    expect(cardMark(rs, top)).toBe('💬2');
    const q = reply('r5', { quote: { text: 'x', url: 'https://e.com/', title: 't' }, image: 's' });
    expect(cardMark([q], q)).toBe('❝ 📷');
  });
});

describe('boardFaces / boardLinks', () => {
  it('一番上のカードだけ描く。返信は描かない。孤児の位置は描かない', () => {
    const rs = [reply('r1'), reply('r2'), reply('r3', { parent: 'r1' })];
    const b = board([
      { ref: 'r1', x: 500, y: 40 },
      { ref: 'gone', x: 0, y: 0 },
      { ref: 'r3', x: 9, y: 9 },
    ]);
    const faces = boardFaces(rs, b);
    expect(faces.map((f) => f.id).sort()).toEqual(['r1', 'r2']);
    expect(faces.find((f) => f.id === 'r1')).toMatchObject({ x: 500, y: 40, saved: true });
    expect(faces.find((f) => f.id === 'r2')?.saved).toBe(false);
  });
  it('ファイルが無い（null）ときは全部仮の位置（190×96・間隔 20 の升目）。保存の情報は作らない', () => {
    const rs = [reply('r1', { rank: 0 }), reply('r2', { rank: 1 }), reply('r3', { rank: 3 })];
    const faces = boardFaces(rs, null);
    expect(faces.every((f) => !f.saved)).toBe(true);
    const at = (id: string) => faces.find((f) => f.id === id);
    expect(at('r1')).toMatchObject({ x: 0, y: 0 });
    expect(at('r2')).toMatchObject({ x: BOARD_CARD.w + BOARD_CARD.gap, y: 0 });
    expect(at('r3')).toMatchObject({ x: 0, y: BOARD_CARD.h + BOARD_CARD.gap });
  });
  it('線：両端が描かれているものだけ。作った順', () => {
    const rs = [
      reply('r1', { createdAt: 10, links: [{ to: 'r2', kind: 'ground' }, { to: 'r9', kind: 'next' }] }),
      reply('r2', { createdAt: 5, links: [{ to: 'r1', kind: 'counter' }] }),
      reply('r3', { parent: 'r1', links: [{ to: 'r1', kind: 'same' }] }),
    ];
    const shown = new Set(['r1', 'r2']);
    expect(boardLinks(rs, shown)).toEqual([
      { from: 'r2', to: 'r1', kind: 'counter' },
      { from: 'r1', to: 'r2', kind: 'ground' },
    ]);
  });
  it('6 種の関連がすべて線になる', () => {
    const kinds = ['ground', 'counter', 'next', 'same', 'ask', 'supplement'] as const;
    const rs = [reply('r1', { links: kinds.map((kind, i) => ({ to: `t${i}`, kind })) }), ...kinds.map((_, i) => reply(`t${i}`))];
    const links = boardLinks(rs, new Set(rs.map((r) => r.id)));
    expect(links.map((l) => l.kind)).toEqual([...kinds]);
  });
});

describe('絞り込み', () => {
  const rs = [
    reply('r1', { text: '保守の見積もり', tags: ['調査', '宛て:everyone'] }),
    reply('r2', { text: '価格表', tags: ['予算'] }),
    reply('r3', { text: 'メモ', tags: [] }),
    reply('r4', { parent: 'r3', text: '返信に 保守費 と書いた' }),
  ];
  it('語：空白（全角も）で区切り、小文字にそろえ、5 語まで', () => {
    expect(searchWords('  保守　Abc  ')).toEqual(['保守', 'abc']);
    expect(searchWords('')).toEqual([]);
    expect(searchWords('a b c d e f g')).toHaveLength(5);
  });
  it('絞らなければ誰も薄くならない', () => {
    expect(dimmedIds(rs, null, []).size).toBe(0);
  });
  it('タグで絞る：合わないカードが薄くなる（返信は対象外）', () => {
    expect([...dimmedIds(rs, '調査', [])].sort()).toEqual(['r2', 'r3']);
  });
  it('語で絞る：本文・タグ・返信の文に全部の語がある。大文字小文字は同じ', () => {
    expect([...dimmedIds(rs, null, searchWords('保守'))].sort()).toEqual(['r2']);
    expect([...dimmedIds(rs, null, searchWords('保守 見積'))].sort()).toEqual(['r2', 'r3']);
    expect([...dimmedIds([reply('x', { text: 'Hello' })], null, searchWords('hello'))].length).toBe(0);
  });
  it('タグと語はどちらも合うものだけ残る', () => {
    expect([...dimmedIds(rs, '調査', searchWords('価格'))].sort()).toEqual(['r1', 'r2', 'r3']);
  });
  it('機械タグでは絞れない・検索にも掛からない', () => {
    expect(searchText(rs, rs[0])).not.toContain('宛て');
    expect([...dimmedIds(rs, '宛て:everyone', [])].sort()).toEqual(['r1', 'r2', 'r3']);
    expect([...dimmedIds(rs, null, searchWords('everyone'))].sort()).toEqual(['r1', 'r2', 'r3']);
  });
  it('線が薄くなるのは両端とも薄いとき', () => {
    const dim = new Set(['a', 'b']);
    expect(linkDimmed({ from: 'a', to: 'b', kind: 'next' }, dim)).toBe(true);
    expect(linkDimmed({ from: 'a', to: 'c', kind: 'next' }, dim)).toBe(false);
    expect(linkDimmed({ from: 'a', to: 'b', kind: 'next' }, new Set())).toBe(false);
  });
});

describe('edgeGeometry（曲線）', () => {
  const A = { x: 0, y: 0 };
  const B = { x: 400, y: 0 };
  it('縁から縁へ。始まりは A の右の縁、終わりは B の左の縁', () => {
    const g = edgeGeometry(A, B);
    expect(g).not.toBeNull();
    expect(g!.d.startsWith(`M${BOARD_CARD.w},${BOARD_CARD.h / 2} C`)).toBe(true);
    expect(g!.d.endsWith(` 400,${BOARD_CARD.h / 2}`)).toBe(true);
  });
  it('行きと帰りは逆側に膨らむ（真ん中の y が上下に分かれる）', () => {
    const ab = edgeGeometry(A, B)!;
    const ba = edgeGeometry(B, A)!;
    expect(ab.mid.x).toBeCloseTo(ba.mid.x, 0);
    const cy = BOARD_CARD.h / 2;
    expect((ab.mid.y - cy) * (ba.mid.y - cy)).toBeLessThan(0);
  });
  it('重なっているカード・同じ位置は線を引かない', () => {
    expect(edgeGeometry(A, { x: 0, y: 0 })).toBeNull();
    expect(edgeGeometry(A, { x: 100, y: 30 })).toBeNull();
  });
  it('斜めでも、縦でも描ける（有限の数だけ）', () => {
    for (const to of [{ x: 300, y: 250 }, { x: 0, y: 300 }, { x: -300, y: -200 }]) {
      const g = edgeGeometry(A, to);
      expect(g).not.toBeNull();
      expect(g!.d).not.toMatch(/NaN|Infinity/);
    }
  });
});

describe('ホイール・見ている位置', () => {
  it('上へ回すと拡大、下へ回すと縮小。0 は変えない。1 回で 0.5〜2 倍', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(-1e6)).toBe(2);
    expect(wheelZoomFactor(1e6)).toBe(0.5);
    expect(wheelZoomFactor(NaN)).toBe(1);
  });
  it('行・ページ単位の回し方は画素に直す', () => {
    expect(wheelZoomFactor(-3, 1)).toBeCloseTo(wheelZoomFactor(-48, 0));
    expect(wheelZoomFactor(-1, 2)).toBeCloseTo(wheelZoomFactor(-400, 0));
  });
  const faces = boardFaces([reply('r1', { rank: 0 }), reply('r2', { rank: 1 })], null);
  const vp = { w: 600, h: 400 };
  it('読めた（ok）ボードは保存した位置から。ファイルが無い・読めないときは全体表示', () => {
    expect(initialView(ok(board([], { x: 12, y: 34, zoom: 0.5 })), faces, vp)).toEqual({ x: 12, y: 34, zoom: 0.5 });
    const fit = fitAll(faces, vp);
    const missing: LoadBoardResult = { state: 'missing', memoId: 'm1', board: emptyBoard('m1', 0), dropped: 0, raw: null, backupNeeded: false };
    expect(initialView(missing, faces, vp)).toEqual(fit);
    expect(initialView({ state: 'unreadable', memoId: 'm1', why: 'failed' }, faces, vp)).toEqual(fit);
    expect(initialView(null, faces, vp)).toEqual(fit);
  });
  it('［全体］：全部のカードが面に入る。カードが無ければ初めの位置', () => {
    const v = fitAll(faces, vp);
    expect(v.zoom).toBeGreaterThan(0);
    const right = (BOARD_CARD.w * 2 + BOARD_CARD.gap) * v.zoom + v.x;
    expect(right).toBeLessThanOrEqual(vp.w);
    expect(v.x).toBeGreaterThanOrEqual(0);
    expect(fitAll([], vp)).toEqual(DEFAULT_VIEW);
  });
});

describe('カードを動かす（B2-1）', () => {
  const view = (zoom: number, x = 0, y = 0) => ({ x, y, zoom });
  it('ドラッグの位置：押した位置に、画面の動きをボードの量にして足す（拡大率で割る）', () => {
    expect(dragPosition({ x: 100, y: 50 }, { dx: 30, dy: -10 }, view(1))).toEqual({ x: 130, y: 40 });
    expect(dragPosition({ x: 100, y: 50 }, { dx: 30, dy: -10 }, view(2))).toEqual({ x: 115, y: 45 });
    expect(dragPosition({ x: 100, y: 50 }, { dx: 30, dy: -10 }, view(0.5))).toEqual({ x: 160, y: 30 });
  });
  it('見ている位置（パン）は動きの量に効かない。整数に丸める。±10,000 に収める', () => {
    expect(dragPosition({ x: 0, y: 0 }, { dx: 10, dy: 10 }, view(1, 500, -300))).toEqual({ x: 10, y: 10 });
    expect(dragPosition({ x: 0, y: 0 }, { dx: 10, dy: 10 }, view(3))).toEqual({ x: 3, y: 3 });
    const far = dragPosition({ x: 9990, y: -9990 }, { dx: 5000, dy: -5000 }, view(1));
    expect(far).toEqual({ x: BOARD_LIMITS.coord, y: -BOARD_LIMITS.coord });
  });
  it('つまむ動き：4 画素から', () => {
    expect(DRAG_THRESHOLD).toBe(4);
    expect(pastThreshold({ dx: 2, dy: 2 })).toBe(false);
    expect(pastThreshold({ dx: 3, dy: 3 })).toBe(true);
    expect(pastThreshold({ dx: 0, dy: -4 })).toBe(true);
  });

  const rs = [reply('r1', { rank: 0 }), reply('r2', { rank: 1 }), reply('r3', { parent: 'r1' })];
  const missing: LoadBoardResult = { state: 'missing', memoId: 'm1', board: emptyBoard('m1', 0), dropped: 0, raw: null, backupNeeded: false };
  it('動かせる：ファイルが無い・読めた。動かせない：読み込み中・読めない（理由つきの文）', () => {
    expect(moveBlockedNote(missing)).toBeNull();
    expect(moveBlockedNote(ok(board([])))).toBeNull();
    expect(moveBlockedNote(null)).toContain('読み込み中');
    const bad = moveBlockedNote({ state: 'unreadable', memoId: 'm1', why: 'version' });
    expect(bad).toContain('動かせません');
    expect(bad).toContain('新しい版');
  });
  it('動かした 1 枚だけがボードに入る。ほかの仮のカードは入らない', () => {
    const plan = planMove(missing, rs, 'r1', { x: 300, y: 80 }, 99);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changed).toBe(true);
    expect(plan.board.nodes).toEqual([{ ref: 'r1', x: 300, y: 80 }]);
    expect(plan.board.updatedAt).toBe(99);
    expect(plan.board.view).toEqual(DEFAULT_VIEW); // 見ている位置は保存しない（B2-2）
  });
  it('もとのボードは変えない。ほかの位置・孤児・見ている位置はそのまま。座標は整数・±10,000', () => {
    const b = board(
      [
        { ref: 'r2', x: 5, y: 6 },
        { ref: 'gone', x: 7, y: 8 },
      ],
      { x: 12, y: 34, zoom: 0.5 },
    );
    const before = JSON.stringify(b);
    const plan = planMove(ok(b), rs, 'r1', { x: 20000.6, y: -3.4 }, 5);
    expect(JSON.stringify(b)).toBe(before);
    if (!plan.ok) throw new Error('plan');
    expect(plan.board.nodes).toEqual([
      { ref: 'r2', x: 5, y: 6 },
      { ref: 'gone', x: 7, y: 8 },
      { ref: 'r1', x: BOARD_LIMITS.coord, y: -3 },
    ]);
    expect(plan.board.view).toEqual({ x: 12, y: 34, zoom: 0.5 });
  });
  it('保存した位置のカードをもう一度動かすと、その 1 枚の座標だけが替わる。同じ場所なら changed=false', () => {
    const b = board([{ ref: 'r1', x: 10, y: 10 }, { ref: 'r2', x: 50, y: 50 }]);
    const moved = planMove(ok(b), rs, 'r1', { x: 11, y: 10 }, 7);
    if (!moved.ok) throw new Error('plan');
    expect(moved.board.nodes).toEqual([{ ref: 'r1', x: 11, y: 10 }, { ref: 'r2', x: 50, y: 50 }]);
    const same = planMove(ok(b), rs, 'r1', { x: 10, y: 10 }, 7);
    expect(same).toMatchObject({ ok: true, changed: false });
  });
  it('読めないボード・読み込み中・台帳の一番上でないカード（返信・消えたカード）は動かさない', () => {
    expect(planMove({ state: 'unreadable', memoId: 'm1', why: 'failed' }, rs, 'r1', { x: 1, y: 1 }, 1)).toEqual({ ok: false, why: 'blocked' });
    expect(planMove(null, rs, 'r1', { x: 1, y: 1 }, 1)).toEqual({ ok: false, why: 'blocked' });
    expect(planMove(missing, rs, 'r3', { x: 1, y: 1 }, 1)).toEqual({ ok: false, why: 'notCard' });
    expect(planMove(missing, rs, 'gone', { x: 1, y: 1 }, 1)).toEqual({ ok: false, why: 'notCard' });
  });
  it('保存するファイルの中身：動かした 1 枚だけ（機械タグ・本文は入らない）。読み直しても同じ', () => {
    const rs2 = [reply('r1', { text: '秘密の本文', tags: ['宛て:everyone'] })];
    const plan = planMove(missing, rs2, 'r1', { x: 40, y: 60 }, 3);
    if (!plan.ok) throw new Error('plan');
    const text = serializeBoard(plan.board);
    expect(text).not.toBeNull();
    expect(text).not.toMatch(/秘密|宛て|everyone/);
    const reread = parseBoard(JSON.parse(text as string), { memoId: 'm1' });
    expect(reread.ok && reread.board.nodes).toEqual([{ ref: 'r1', x: 40, y: 60 }]);
  });
  it('保存を待っている位置は、顔に当てる（保存した扱い）。対象でない顔は変えない', () => {
    const faces = boardFaces(rs, null);
    const out = withPending(faces, new Map([['r1', { x: 300, y: 80 }]]));
    expect(out.find((f) => f.id === 'r1')).toMatchObject({ x: 300, y: 80, saved: true });
    expect(out.find((f) => f.id === 'r2')).toEqual(faces.find((f) => f.id === 'r2'));
    expect(withPending(faces, new Map())).toEqual(faces);
    expect(withPending(faces, new Map([['nope', { x: 1, y: 1 }]]))).toEqual(faces);
  });
  it('保存の結果の文：成功（控えを取ったときはその旨）と、失敗は boardSaveMessage の理由', () => {
    const loaded = ok(board([]));
    expect(moveResultNote({ ok: true, loaded, backedUp: false })).toEqual({ text: '位置を保存しました', tone: 'info' });
    expect(moveResultNote({ ok: true, loaded, backedUp: true }).text).toContain('写し');
    for (const why of ['unreadable', 'name', 'memo', 'full', 'size', 'changed', 'backup', 'write'] as const) {
      const r: SaveBoardResult = { ok: false, why };
      expect(moveResultNote(r)).toEqual({ text: boardSaveMessage(why), tone: 'warn' });
    }
  });
  it('初めの見ている位置：初期値のままの保存ファイルは、見ている位置を保存していないので全体表示', () => {
    const faces = boardFaces(rs, null);
    const vp = { w: 600, h: 400 };
    expect(initialView(ok(board([{ ref: 'r1', x: 0, y: 0 }])), faces, vp)).toEqual(fitAll(faces, vp));
  });
});
describe('boardNote（読み込み状態）', () => {
  it('読み込み中・読めない（理由つき）・仮の並び・何も出さない', () => {
    expect(boardNote(null, 0)).toEqual({ text: 'ボードを読み込み中です…', tone: 'info' });
    const bad = boardNote({ state: 'unreadable', memoId: 'm1', why: 'version' }, 3);
    expect(bad.tone).toBe('warn');
    expect(bad.text).toContain('新しい版');
    expect(boardNote({ state: 'unreadable', memoId: 'm1', why: 'failed' }, 0).tone).toBe('warn');
    expect(boardNote(ok(board([])), 2).text).toContain('仮の並び');
    expect(boardNote(ok(board([])), 0)).toEqual({ text: '', tone: '' });
    expect(boardEmptyText).toContain('カード');
  });
});

describe('まとめて動かす・見ている位置の保存（B2-2）', () => {
  const rs = [reply('r1', { rank: 0 }), reply('r2', { rank: 1 }), reply('r3', { rank: 2 }), reply('rr', { parent: 'r1' })];
  const missing: LoadBoardResult = { state: 'missing', memoId: 'm1', board: emptyBoard('m1', 0), dropped: 0, raw: null, backupNeeded: false };
  it('planMoves：何枚かを 1 回の保存の形にする。動かしたカードだけが入り、ほかの位置・孤児・見ている位置はそのまま', () => {
    const b = board([{ ref: 'r1', x: 10, y: 10 }, { ref: 'orphan', x: 5, y: 5 }, { ref: 'r3', x: 70, y: 70 }], { x: 40, y: -20, zoom: 1.5 });
    const plan = planMoves(ok(b), rs, [{ ref: 'r1', x: 20, y: 20 }, { ref: 'r2', x: 300, y: 0 }], 9);
    if (!plan.ok) throw new Error('plan');
    expect(plan.changed).toBe(true);
    expect(plan.board.nodes).toEqual([{ ref: 'r1', x: 20, y: 20 }, { ref: 'orphan', x: 5, y: 5 }, { ref: 'r3', x: 70, y: 70 }, { ref: 'r2', x: 300, y: 0 }]);
    expect(plan.board.view).toEqual({ x: 40, y: -20, zoom: 1.5 });
    expect(plan.board.updatedAt).toBe(9);
    expect(b.nodes[0]).toEqual({ ref: 'r1', x: 10, y: 10 }); // 元は変えない
  });
  it('planMoves：台帳の一番上でないカード（返信・消えたカード）は入れない。1 枚もなければ notCard', () => {
    const mixed = planMoves(missing, rs, [{ ref: 'rr', x: 1, y: 1 }, { ref: 'gone', x: 2, y: 2 }, { ref: 'r2', x: 3, y: 3 }], 1);
    if (!mixed.ok) throw new Error('plan');
    expect(mixed.board.nodes).toEqual([{ ref: 'r2', x: 3, y: 3 }]);
    expect(planMoves(missing, rs, [{ ref: 'rr', x: 1, y: 1 }], 1)).toEqual({ ok: false, why: 'notCard' });
    expect(planMoves(missing, rs, [], 1)).toEqual({ ok: false, why: 'notCard' });
  });
  it('planMoves：読めない・読み込み中は動かさない。全部が同じ位置なら changed=false', () => {
    expect(planMoves({ state: 'unreadable', memoId: 'm1', why: 'version' }, rs, [{ ref: 'r1', x: 1, y: 1 }], 1)).toEqual({ ok: false, why: 'blocked' });
    expect(planMoves(null, rs, [{ ref: 'r1', x: 1, y: 1 }], 1)).toEqual({ ok: false, why: 'blocked' });
    const b = board([{ ref: 'r1', x: 10, y: 10 }, { ref: 'r2', x: 20, y: 20 }]);
    expect(planMoves(ok(b), rs, [{ ref: 'r1', x: 10, y: 10 }, { ref: 'r2', x: 20, y: 20 }], 1)).toMatchObject({ ok: true, changed: false });
  });
  it('planMoves：1 枚のときは planMove と同じ', () => {
    const one = planMove(missing, rs, 'r1', { x: 40, y: 60 }, 3);
    expect(planMoves(missing, rs, [{ ref: 'r1', x: 40, y: 60 }], 3)).toEqual(one);
  });
  it('planMoves：保存するファイルの中身は座標だけ。複数を動かしても本文・機械タグは入らない。読み直しても同じ', () => {
    const rs2 = [reply('r1', { text: '秘密の本文', tags: ['宛て:everyone'] }), reply('r2', { text: '別の本文', tags: ['送った:x'] })];
    const plan = planMoves(missing, rs2, [{ ref: 'r1', x: 1, y: 2 }, { ref: 'r2', x: 3, y: 4 }], 3);
    if (!plan.ok) throw new Error('plan');
    const text = serializeBoard(plan.board) as string;
    expect(text).not.toMatch(/秘密|別の本文|宛て|送った|everyone/);
    const reread = parseBoard(JSON.parse(text), { memoId: 'm1' });
    expect(reread.ok && reread.board.nodes).toEqual([{ ref: 'r1', x: 1, y: 2 }, { ref: 'r2', x: 3, y: 4 }]);
  });

  it('見ている位置の保存の待ち：止まって 0.4 秒後。動き続けているあいだは待ち続ける。変えていなければ保存するものなし', () => {
    expect(VIEW_SAVE_DELAY).toBe(400);
    expect(viewSaveWait(null, 1000)).toBeNull();
    expect(viewSaveWait(1000, 1000)).toBe(400);
    expect(viewSaveWait(1000, 1100)).toBe(300);
    expect(viewSaveWait(1000, 1400)).toBe(0);
    expect(viewSaveWait(1000, 5000)).toBe(0);
    // 動き続ける：最後に変えた時刻が新しくなるので、待ちが延びる
    expect(viewSaveWait(1300, 1400)).toBe(300);
    expect(viewSaveWait(1000, 1200, 1000)).toBe(800);
  });
  it('planView：見ている位置だけが替わる（カード・孤児はそのまま）。収める（clampView）。同じなら changed=false', () => {
    const b = board([{ ref: 'r1', x: 10, y: 10 }, { ref: 'orphan', x: 5, y: 5 }]);
    const plan = planView(ok(b), { x: 120.4, y: -30.6, zoom: 1.2345 }, 8);
    if (!plan.ok) throw new Error('plan');
    expect(plan.changed).toBe(true);
    expect(plan.board.view).toEqual({ x: 120, y: -31, zoom: 1.235 });
    expect(plan.board.nodes).toEqual(b.nodes);
    expect(plan.board.updatedAt).toBe(8);
    const far = planView(ok(b), { x: 999999, y: -999999, zoom: 9 }, 8);
    if (!far.ok) throw new Error('plan');
    expect(far.board.view).toEqual({ x: BOARD_LIMITS.viewCoord, y: -BOARD_LIMITS.viewCoord, zoom: BOARD_LIMITS.zoomMax });
    expect(planView(ok(b), DEFAULT_VIEW, 8)).toMatchObject({ ok: true, changed: false });
  });
  it('planView：ファイルが無ければ（空のボードに）見ている位置だけを入れる。読めない・読み込み中は書かない', () => {
    const plan = planView(missing, { x: 5, y: 6, zoom: 0.5 }, 2);
    if (!plan.ok) throw new Error('plan');
    expect(plan.board.nodes).toEqual([]);
    expect(plan.board.view).toEqual({ x: 5, y: 6, zoom: 0.5 });
    expect(planView({ state: 'unreadable', memoId: 'm1', why: 'failed' }, { x: 5, y: 6, zoom: 0.5 }, 2)).toEqual({ ok: false, why: 'blocked' });
    expect(planView(null, { x: 5, y: 6, zoom: 0.5 }, 2)).toEqual({ ok: false, why: 'blocked' });
  });
  it('見ている位置の保存のあと、開き直すと保存した位置で開く（初期値のままなら全体表示は残る）', () => {
    const faces = boardFaces(rs, null);
    const vp = { w: 600, h: 400 };
    const plan = planView(missing, { x: 30, y: 40, zoom: 0.8 }, 2);
    if (!plan.ok) throw new Error('plan');
    expect(initialView(ok(plan.board), faces, vp)).toEqual({ x: 30, y: 40, zoom: 0.8 });
    expect(initialView(ok(board([], DEFAULT_VIEW)), faces, vp)).toEqual(fitAll(faces, vp));
  });
  it('見ている位置の保存の結果の文：うまくいったときは静か。控えを取ったときと失敗だけ出す', () => {
    const loaded = ok(board([]));
    expect(viewResultNote({ ok: true, loaded, backedUp: false })).toBeNull();
    expect(viewResultNote({ ok: true, loaded, backedUp: true })?.text).toContain('写し');
    for (const why of ['unreadable', 'name', 'memo', 'full', 'size', 'changed', 'backup', 'write'] as const) {
      expect(viewResultNote({ ok: false, why })).toEqual({ text: boardSaveMessage(why), tone: 'warn' });
    }
  });
});