import { describe, expect, it } from 'vitest';
import { BOARD_CARD, BOARD_LIMITS, type BoardView, DEFAULT_VIEW, emptyBoard, parseBoard, type Rect, rectBounds, serializeBoard, type Board } from '../src/memo-card-board';
import {
  actualSizeView,
  BOARD_FACE,
  boardEmptyText,
  boardFaces,
  boardLinks,
  boardNote,
  boxReadable,
  cardFace,
  type CardFace,
  cardLines,
  cardMark,
  cardVisibleRatio,
  DRAG_THRESHOLD,
  dimmedIds,
  dragPosition,
  edgeGeometry,
  type FaceChange,
  fitAll,
  lastWritten,
  linkDimmed,
  markSeatWidth,
  moveBlockedNote,
  moveResultNote,
  OPEN_TOP_PAD,
  OPEN_ZOOMS,
  openingView,
  pastThreshold,
  planMove,
  planMoves,
  planView,
  READ_PAD,
  READ_ZOOM_MIN,
  RECENT_MAX,
  recentFaces,
  recentTops,
  recentView,
  replyCount,
  searchText,
  searchWords,
  settleView,
  squareReadBox,
  VIEW_SAVE_DELAY,
  viewAfterShow,
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
const ok = (b: Board): LoadBoardResult => ({ state: 'ok', layout: 'square', memoId: 'm1', board: b, dropped: 0, raw: null, backupNeeded: false });

// HX1 の試験の道具。作った順に n 枚（c00 が最初）。仮の 3 列の並び：c<i> は (i % 3 × 210, ⌊i / 3⌋ × 116)
const cards = (n: number) => Array.from({ length: n }, (_, i) => reply(`c${String(i).padStart(2, '0')}`, { createdAt: 100 + i }));
const missingLoad: LoadBoardResult = { state: 'missing', layout: 'square', memoId: 'm1', board: emptyBoard('m1', 0), dropped: 0, raw: null, backupNeeded: false };
const faceOf = (faces: readonly CardFace[], id: string) => {
  const f = faces.find((x) => x.id === id);
  if (!f) throw new Error(id);
  return f;
};
const readable = (view: BoardView, faces: readonly CardFace[], id: string, vp: { w: number; h: number }) => boxReadable(view, squareReadBox(faceOf(faces, id)), vp);

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
  it('流し込む文：一行だけは文の全部（240 字で切り、超えたら「…」）。rest は空、太字にしない', () => {
    const one = reply('r1', { text: '一行だけの長い文'.repeat(30) });
    expect(cardFace([one], one, { x: 0, y: 0, saved: true })).toMatchObject({ first: '一行だけの長い文'.repeat(30), rest: '', bold: false });
    const long = reply('r2', { text: '一行だけの長い文'.repeat(40) });
    const f = cardFace([long], long, { x: 0, y: 0, saved: true });
    expect([...f.first].length).toBe(BOARD_FACE.flowMax + 1);
    expect(f.first.endsWith('…')).toBe(true);
    expect(f.rest).toBe('');
  });
  it('流し込む文：空の行は捨て、1 行目は太字、2 行目から rest（改行でつなぐ）', () => {
    const r = reply('r1', { text: '見積もり\n保守は来期\n\n1.3 倍' });
    expect(cardLines(r)).toEqual(['見積もり', '保守は来期', '1.3 倍']);
    expect(cardFace([r], r, { x: 0, y: 0, saved: true })).toMatchObject({ first: '見積もり', rest: '保守は来期\n1.3 倍', bold: true, who: '' });
  });
  it('流し込む文：引用・画像のカードは題が first、rest は空、太字。空のカードは（空）で太字なし', () => {
    const q = reply('r1', { text: '', quote: { text: 'ページの文', url: 'https://example.com/', title: '記事の題' } });
    expect(cardFace([q], q, { x: 0, y: 0, saved: true })).toMatchObject({ first: '記事の題', rest: '', bold: true });
    const i = reply('r2', { text: '写真\n二行目', image: 'shot1' });
    expect(cardFace([i], i, { x: 0, y: 0, saved: true })).toMatchObject({ first: '写真', rest: '', bold: true });
    const e = reply('r3', { text: '' });
    expect(cardFace([e], e, { x: 0, y: 0, saved: true })).toMatchObject({ first: '（空）', bold: false });
  });
  it('AI の印：who は書き手の名前（空白だけなら AI）。人のカードは空', () => {
    const ai = reply('r1', { by: { who: 'main', name: '相棒' } });
    expect(cardFace([ai], ai, { x: 0, y: 0, saved: true }).who).toBe('相棒');
    const blank = reply('r2', { by: { who: 'main', name: '  ' } });
    expect(cardFace([blank], blank, { x: 0, y: 0, saved: true }).who).toBe('AI');
    const human = reply('r3');
    expect(cardFace([human], human, { x: 0, y: 0, saved: true }).who).toBe('');
  });
  it('読む画面の AI のカードは時刻の字を出さず見出しと文だけ。kind が無ければ今の分け方', () => {
    const text = '見出し\n▶ 0:12〔ボケ〕一つ目\n▶ 1:05 二つ目';
    const at = { video: 'v', spans: [{ key: 'k', start: 0, end: 1 }] };
    const r = reply('r1', { text, by: { who: 'main', name: '相棒' }, at: { ...at, kind: 'tech' } });
    const f = cardFace([r], r, { x: 0, y: 0, saved: true });
    expect(f).toMatchObject({ first: '見出し', rest: '一つ目\n二つ目', bold: true, who: '相棒' });
    expect(f.rest).not.toMatch(/\d:\d\d/);
    const plain = reply('r2', { text, by: { who: 'main', name: '相棒' }, at: { ...at } });
    expect(cardFace([plain], plain, { x: 0, y: 0, saved: true })).toMatchObject({ first: '見出し', rest: '▶ 0:12〔ボケ〕一つ目\n▶ 1:05 二つ目' });
  });
  it('印の席の幅：印が無ければ 0、字数 × 11 ＋ 4（最低 24）', () => {
    expect(markSeatWidth('')).toBe(0);
    expect(markSeatWidth('💬2')).toBe(26);
    expect(markSeatWidth('❝ 💬12')).toBe(59);
    expect(markSeatWidth('📷')).toBe(24);
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
  const two = [reply('r1', { rank: 0 }), reply('r2', { rank: 1 })];
  const faces = boardFaces(two, null);
  const vp = { w: 600, h: 400 };
  const open = (load: LoadBoardResult | null) => openingView(load, two, faces, vp, { place: 'bottom' });
  it('開いたとき：保存した倍率が 0.85 より小さければ使わない。小さいメモは全体（決まり 2）。ファイルが無い・読めないときも全体', () => {
    const fit = { view: fitAll(faces, vp), rule: 2, n: 0 };
    expect(fit.view.zoom).toBe(1.2);
    expect(open(ok(board([], { x: 12, y: 34, zoom: 0.5 })))).toEqual(fit);
    const missing: LoadBoardResult = { state: 'missing', layout: 'square', memoId: 'm1', board: emptyBoard('m1', 0), dropped: 0, raw: null, backupNeeded: false };
    expect(open(missing)).toEqual(fit);
    expect(open({ state: 'unreadable', layout: 'square', memoId: 'm1', why: 'failed' })).toEqual(fit);
    expect(open(null)).toEqual(fit);
  });
  it('開いたとき：保存した位置は、倍率 0.85 以上で最後に書いたカードが読めるならそのまま（決まり 1）。読めなければ使わない', () => {
    expect(open(ok(board([], { x: 30, y: 40, zoom: 0.9 })))).toEqual({ view: { x: 30, y: 40, zoom: 0.9 }, rule: 1, n: 0 });
    expect(open(ok(board([], { x: 30, y: 40, zoom: 2 })))).toEqual({ view: fitAll(faces, vp), rule: 2, n: 0 }); // r2 の右の辺が面の外
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
  const missing: LoadBoardResult = { state: 'missing', layout: 'square', memoId: 'm1', board: emptyBoard('m1', 0), dropped: 0, raw: null, backupNeeded: false };
  it('動かせる：ファイルが無い・読めた。動かせない：読み込み中・読めない（理由つきの文）', () => {
    expect(moveBlockedNote(missing)).toBeNull();
    expect(moveBlockedNote(ok(board([])))).toBeNull();
    expect(moveBlockedNote(null)).toContain('読み込み中');
    const bad = moveBlockedNote({ state: 'unreadable', layout: 'square', memoId: 'm1', why: 'version' });
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
    expect(planMove({ state: 'unreadable', layout: 'square', memoId: 'm1', why: 'failed' }, rs, 'r1', { x: 1, y: 1 }, 1)).toEqual({ ok: false, why: 'blocked' });
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
  it('保存の結果の文：ふつうの成功は null（控えを取ったときはその旨）と、失敗は boardSaveMessage の理由', () => {
    const loaded = ok(board([]));
    expect(moveResultNote({ ok: true, loaded, backedUp: false }, 'square')).toBeNull();
    expect(moveResultNote({ ok: true, loaded, backedUp: true }, 'square')?.text).toContain('写し');
    for (const why of ['unreadable', 'name', 'memo', 'full', 'size', 'changed', 'backup', 'write'] as const) {
      const r: SaveBoardResult = { ok: false, why };
      expect(moveResultNote(r, 'square')).toEqual({ text: boardSaveMessage(why, 'square'), tone: 'warn' });
    }
  });
  it('開いたときの見ている位置：初期値のままの保存ファイルは、見ている位置を保存していないので使わない（最後に書いたカードがその位置で読めても、小さいメモは全体表示）', () => {
    const saved = board([{ ref: 'r1', x: 20, y: 20 }]);
    const faces = boardFaces(rs, saved);
    const vp = { w: 600, h: 400 };
    expect(lastWritten(rs, faces)?.id).toBe('r1'); // 返信 r3 を数える
    expect(readable(DEFAULT_VIEW, faces, 'r1', vp)).toBe(true);
    expect(fitAll(faces, vp)).not.toEqual(DEFAULT_VIEW);
    expect(openingView(ok(saved), rs, faces, vp, { place: 'bottom' })).toEqual({ view: fitAll(faces, vp), rule: 2, n: 0 });
  });
});
describe('boardNote（読み込み状態）', () => {
  it('読み込み中・読めない（理由つき）・何も出さない', () => {
    expect(boardNote(null)).toEqual({ text: 'ボードを読み込み中です…', tone: 'info' });
    const bad = boardNote({ state: 'unreadable', layout: 'square', memoId: 'm1', why: 'version' });
    expect(bad.tone).toBe('warn');
    expect(bad.text).toContain('新しい版');
    expect(boardNote({ state: 'unreadable', layout: 'square', memoId: 'm1', why: 'failed' }).tone).toBe('warn');
    expect(boardNote(ok(board([])))).toEqual({ text: '', tone: '' });
    expect(boardEmptyText).toContain('カード');
  });
});

describe('まとめて動かす・見ている位置の保存（B2-2）', () => {
  const rs = [reply('r1', { rank: 0 }), reply('r2', { rank: 1 }), reply('r3', { rank: 2 }), reply('rr', { parent: 'r1' })];
  const missing: LoadBoardResult = { state: 'missing', layout: 'square', memoId: 'm1', board: emptyBoard('m1', 0), dropped: 0, raw: null, backupNeeded: false };
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
    expect(planMoves({ state: 'unreadable', layout: 'square', memoId: 'm1', why: 'version' }, rs, [{ ref: 'r1', x: 1, y: 1 }], 1)).toEqual({ ok: false, why: 'blocked' });
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
    expect(planView({ state: 'unreadable', layout: 'square', memoId: 'm1', why: 'failed' }, { x: 5, y: 6, zoom: 0.5 }, 2)).toEqual({ ok: false, why: 'blocked' });
    expect(planView(null, { x: 5, y: 6, zoom: 0.5 }, 2)).toEqual({ ok: false, why: 'blocked' });
  });
  it('見ている位置の保存のあと開き直す：倍率 0.85 以上で最後に書いたカードが読めれば保存した位置、0.8 なら使わない（全体）。初期値のままなら全体表示', () => {
    const faces = boardFaces(rs, null);
    const vp = { w: 600, h: 400 };
    const fit = { view: fitAll(faces, vp), rule: 2, n: 0 };
    expect(fit.view.zoom).toBe(0.925);
    const plan = planView(missing, { x: 30, y: 40, zoom: 0.8 }, 2);
    if (!plan.ok) throw new Error('plan');
    expect(openingView(ok(plan.board), rs, faces, vp, { place: 'bottom' })).toEqual(fit);
    const near = planView(missing, { x: 30, y: 40, zoom: 0.9 }, 2);
    if (!near.ok) throw new Error('plan');
    expect(openingView(ok(near.board), rs, faces, vp, { place: 'bottom' })).toEqual({ view: { x: 30, y: 40, zoom: 0.9 }, rule: 1, n: 0 }); // 最後に書いたのは返信のある r1
    const moved = board([{ ref: 'r1', x: 20, y: 20 }], DEFAULT_VIEW); // r1 を原点から離す：初期値の位置でも読める
    const mf = boardFaces(rs, moved);
    expect(readable(DEFAULT_VIEW, mf, 'r1', vp)).toBe(true);
    expect(openingView(ok(moved), rs, mf, vp, { place: 'bottom' })).toEqual({ view: fitAll(mf, vp), rule: 2, n: 0 });
  });
  it('見ている位置の保存の結果の文：うまくいったときは静か。控えを取ったときと失敗だけ出す', () => {
    const loaded = ok(board([]));
    expect(viewResultNote({ ok: true, loaded, backedUp: false }, 'square')).toBeNull();
    expect(viewResultNote({ ok: true, loaded, backedUp: true }, 'square')?.text).toContain('写し');
    for (const why of ['unreadable', 'name', 'memo', 'full', 'size', 'changed', 'backup', 'write'] as const) {
      expect(viewResultNote({ ok: false, why }, 'square')).toEqual({ text: boardSaveMessage(why, 'square'), tone: 'warn' });
    }
  });
});

// ---------- HX1：開いたら最後に書いた辺りを読める大きさで ----------

const vpOf = (h: number, w = 840) => ({ w, h });
const upper = { place: 'upper' as const };
const rs14 = cards(14);
const f14 = boardFaces(rs14, null);
const rs15 = cards(15);
const f15 = boardFaces(rs15, null);

// 決まり 3 の中身を、置き方の計算（placeBox）を使わずに形で確かめる
//   最初の n 枚が読める・n+1 枚はどの倍率でも面に入らない・選んだ倍率より大きい倍率では n 枚が入らない
//   横は真ん中。縦は、上の区画では上の端（入るなら 4、入らなければ 2 まで詰める）、下の置き場では真ん中
const fitsAt = (rect: Rect, zoom: number, vp: { w: number; h: number }) => rect.w * zoom <= vp.w - 2 * READ_PAD + 1e-6 && rect.h * zoom <= vp.h - 2 * READ_PAD + 1e-6;
const groupRect = (faces: readonly CardFace[]) => {
  const r = rectBounds(faces.map((f) => squareReadBox(f)));
  if (!r) throw new Error('カードが無い');
  return r;
};
function expectRecent(o: { view: BoardView; rule: number; n: number }, rs: readonly Reply[], faces: readonly CardFace[], vp: { w: number; h: number }, place: 'upper' | 'bottom') {
  expect(o.rule).toBe(3);
  const order = recentFaces(rs, faces);
  const most = Math.min(RECENT_MAX, order.length);
  expect(o.n).toBeGreaterThan(0);
  expect(o.n).toBeLessThanOrEqual(most);
  const group = order.slice(0, o.n);
  for (const f of group) expect(readable(o.view, faces, f.id, vp), f.id).toBe(true);
  if (o.n < most) for (const z of OPEN_ZOOMS) expect(fitsAt(groupRect(order.slice(0, o.n + 1)), z, vp), `${o.n + 1} 枚・${z} 倍`).toBe(false);
  for (const z of OPEN_ZOOMS) if (z > o.view.zoom) expect(fitsAt(groupRect(group), z, vp), `${o.n} 枚・${z} 倍`).toBe(false);
  const rect = groupRect(group);
  const z = o.view.zoom;
  const left = rect.x * z + o.view.x;
  const top = rect.y * z + o.view.y;
  expect(Math.abs(left - (vp.w - rect.w * z) / 2)).toBeLessThanOrEqual(0.5 + 1e-6);
  if (place === 'upper') {
    const want = Math.max(READ_PAD, Math.min(OPEN_TOP_PAD, vp.h - READ_PAD - rect.h * z));
    expect(top).toBeGreaterThan(want - 1);
    expect(top).toBeLessThanOrEqual(want + 1e-6);
  } else {
    expect(Math.abs(top - (vp.h - rect.h * z) / 2)).toBeLessThanOrEqual(0.5 + 1e-6);
  }
}

describe('最後に書いたカード（HX1）', () => {
  it('recentTops：一番上のカードごとに、自分と返信（返信の返信も）の createdAt の最大で、新しい順に並べる', () => {
    const rs = [
      reply('a', { createdAt: 10 }),
      reply('b', { createdAt: 20 }),
      reply('c', { createdAt: 30 }),
      reply('a1', { parent: 'a', createdAt: 25 }),
      reply('a2', { parent: 'a1', createdAt: 40 }),
    ];
    expect(recentTops(rs)).toEqual(['a', 'c', 'b']);
  });
  it('書き直した時刻（editedAt）は数えない（カードも返信も）', () => {
    const one = [reply('a', { createdAt: 10, editedAt: 999 }), reply('b', { createdAt: 20 })];
    expect(lastWritten(one, boardFaces(one, null))?.id).toBe('b');
    const two = [reply('a', { createdAt: 10 }), reply('b', { createdAt: 20 }), reply('a1', { parent: 'a', createdAt: 15, editedAt: 999 })];
    expect(lastWritten(two, boardFaces(two, null))?.id).toBe('b');
  });
  it('recentTops：同じ時刻なら id の文字順で後ろが先。一番上まで辿れない返信（親が無い・輪）は数えない', () => {
    expect(recentTops([reply('a', { createdAt: 5 }), reply('b', { createdAt: 5 })])).toEqual(['b', 'a']);
    expect(recentTops([reply('a', { createdAt: 5 }), reply('b', { createdAt: 6 }), reply('x', { parent: 'gone', createdAt: 99 })])).toEqual(['b', 'a']);
    expect(recentTops([reply('a', { createdAt: 5 }), reply('p', { parent: 'q', createdAt: 50 }), reply('q', { parent: 'p', createdAt: 60 })])).toEqual(['a']);
    expect(recentTops([])).toEqual([]);
    expect(recentTops([reply('x', { parent: 'gone' })])).toEqual([]);
  });
  it('lastWritten：描いているカードの中で、返信を数えていちばん新しいもの。描いていないカードは飛ばす。無ければ null', () => {
    const rs = [reply('a', { createdAt: 10 }), reply('b', { createdAt: 20 }), reply('c', { createdAt: 30 }), reply('a1', { parent: 'a', createdAt: 40 })];
    const faces = boardFaces(rs, null);
    expect(recentFaces(rs, faces).map((f) => f.id)).toEqual(['a', 'c', 'b']);
    expect(lastWritten(rs, faces)?.id).toBe('a');
    expect(lastWritten(rs, faces.filter((f) => f.id !== 'a'))?.id).toBe('c');
    expect(lastWritten(rs, [])).toBeNull();
    expect(lastWritten([], faces)).toBeNull();
  });
});

describe('読めるか（HX1：面積の割合ではなく辺で見る）', () => {
  const vp = { w: 400, h: 200 };
  const box = { x: 0, y: 0, w: BOARD_CARD.w, h: BOARD_CARD.h };
  it('箱が面の中（縁から 2px）に丸ごと入っていれば読める。1px でも余白に掛かれば読めない', () => {
    expect(READ_PAD).toBe(2);
    expect(boxReadable({ x: 2, y: 2, zoom: 1 }, box, vp)).toBe(true);
    expect(boxReadable({ x: 1, y: 2, zoom: 1 }, box, vp)).toBe(false);
    expect(boxReadable({ x: 2, y: 1, zoom: 1 }, box, vp)).toBe(false);
    expect(boxReadable({ x: 400 - 2 - 190, y: 200 - 2 - 96, zoom: 1 }, box, vp)).toBe(true);
    expect(boxReadable({ x: 400 - 1 - 190, y: 2, zoom: 1 }, box, vp)).toBe(false);
    expect(boxReadable({ x: 2, y: 200 - 1 - 96, zoom: 1 }, box, vp)).toBe(false);
  });
  it('9 割以上見えていても、下の辺が面の外なら読めない', () => {
    const view = { x: 10, y: 110, zoom: 1 }; // 下へ 6px はみ出す（余白を入れて 8px）
    expect(cardVisibleRatio(view, { x: 0, y: 0 }, vp)).toBeGreaterThan(0.9);
    expect(boxReadable(view, box, vp)).toBe(false);
  });
  it('倍率に合わせて箱を見る。面に大きさが無ければ読めない', () => {
    expect(boxReadable({ x: 2, y: 2, zoom: 2 }, box, vp)).toBe(true); // 380×192
    expect(boxReadable({ x: 2, y: 2, zoom: 2 }, { ...box, x: 10 }, vp)).toBe(false);
    expect(boxReadable({ x: 2, y: 2, zoom: 1 }, box, { w: 0, h: 0 })).toBe(false);
  });
  it('ほかの形の箱（六角の 150×173.2 など）も同じ関数で見る', () => {
    expect(boxReadable({ x: 0, y: 4, zoom: 1 }, { x: 100, y: 0, w: 150, h: 173.2 }, { w: 840, h: 180 })).toBe(true);
    expect(boxReadable({ x: 0, y: 4, zoom: 1 }, { x: 100, y: 0, w: 150, h: 175 }, { w: 840, h: 180 })).toBe(false);
  });
});

describe('開いたときの見ている位置（HX1：openingView の決まり 1〜4）', () => {
  const open = (rs: readonly Reply[], faces: readonly CardFace[], vp: { w: number; h: number }, place: 'upper' | 'bottom', load: LoadBoardResult | null = missingLoad) => openingView(load, rs, faces, vp, { place });

  it('決めごとの数', () => {
    expect([READ_ZOOM_MIN, OPEN_TOP_PAD, RECENT_MAX]).toEqual([0.85, 4, 9]);
    expect(OPEN_ZOOMS).toEqual([1, 0.95, 0.9, 0.85]);
  });

  it('上の区画の寄せ：上の余白は入るなら 4、入らなければ 2 まで詰める。14 枚は面 218 で余白 4、217 で 3、216 で 2 のまま 1.0 倍・5 枚。215 は入らず 0.95 倍・5 枚', () => {
    const cases: [number, BoardView][] = [
      [218, { x: 115, y: -344, zoom: 1 }],
      [217, { x: 115, y: -345, zoom: 1 }],
      [216, { x: 115, y: -346, zoom: 1 }],
      [215, { x: 130, y: -327, zoom: 0.95 }],
    ];
    for (const [h, view] of cases) {
      const o = open(rs14, f14, vpOf(h), 'upper');
      expect(o, `面 ${h}`).toEqual({ view, rule: 3, n: 5 });
      expectRecent(o, rs14, f14, vpOf(h), 'upper');
    }
    const top = (h: number) => {
      const v = open(rs14, f14, vpOf(h), 'upper').view;
      return faceOf(f14, 'c09').y * v.zoom + v.y; // 5 枚の組の上の辺
    };
    expect([top(218), top(217), top(216)]).toEqual([4, 3, 2]);
  });

  it('14 枚・面 209（上の区画）：0.95 倍で 5 枚を上の端（余白 4）に置く', () => {
    const o = open(rs14, f14, vpOf(209), 'upper');
    expect(o).toEqual({ view: { x: 130, y: -327, zoom: 0.95 }, rule: 3, n: 5 });
    expectRecent(o, rs14, f14, vpOf(209), 'upper');
    expect(readable(o.view, f14, 'c08', vpOf(209))).toBe(false);
  });

  it('14 枚・面 217（下の置き場）：真ん中に置いて 1.0 倍で 5 枚', () => {
    const o = open(rs14, f14, vpOf(217), 'bottom');
    expect(o).toEqual({ view: { x: 115, y: -345, zoom: 1 }, rule: 3, n: 5 });
    expectRecent(o, rs14, f14, vpOf(217), 'bottom');
  });

  it('14 枚・面 180・146：1.0 倍で最後の行の 2 枚（上の区画は上の端、下の置き場は真ん中）', () => {
    const cases: [number, 'upper' | 'bottom', BoardView][] = [
      [180, 'upper', { x: 220, y: -460, zoom: 1 }],
      [180, 'bottom', { x: 220, y: -422, zoom: 1 }],
      [146, 'upper', { x: 220, y: -460, zoom: 1 }],
      [146, 'bottom', { x: 220, y: -439, zoom: 1 }],
    ];
    for (const [h, place, view] of cases) {
      const o = open(rs14, f14, vpOf(h), place);
      expect(o, `面 ${h}・${place}`).toEqual({ view, rule: 3, n: 2 });
      expectRecent(o, rs14, f14, vpOf(h), place);
    }
  });

  it('14 枚・面 88（書く欄を開いた高さ）：上の区画も下の置き場も 0.85 倍で 2 枚', () => {
    for (const place of ['upper', 'bottom'] as const) {
      const o = open(rs14, f14, vpOf(88), place);
      expect(o, place).toEqual({ view: { x: 250, y: -391, zoom: 0.85 }, rule: 3, n: 2 });
      expectRecent(o, rs14, f14, vpOf(88), place);
    }
  });

  it('15 枚：最後の行が 3 枚そろう。面 217 は 1.0 倍で 6 枚、180・146 は 1.0 倍で 3 枚、88 は 0.85 倍で 3 枚（上の区画と下の置き場）', () => {
    const cases: [number, 'upper' | 'bottom', BoardView, number][] = [
      [217, 'upper', { x: 115, y: -345, zoom: 1 }, 6],
      [217, 'bottom', { x: 115, y: -345, zoom: 1 }, 6],
      [180, 'upper', { x: 115, y: -460, zoom: 1 }, 3],
      [180, 'bottom', { x: 115, y: -422, zoom: 1 }, 3],
      [146, 'upper', { x: 115, y: -460, zoom: 1 }, 3],
      [146, 'bottom', { x: 115, y: -439, zoom: 1 }, 3],
      [88, 'upper', { x: 161, y: -391, zoom: 0.85 }, 3],
      [88, 'bottom', { x: 161, y: -391, zoom: 0.85 }, 3],
    ];
    for (const [h, place, view, n] of cases) {
      const o = open(rs15, f15, vpOf(h), place);
      expect(o, `面 ${h}・${place}`).toEqual({ view, rule: 3, n });
      expectRecent(o, rs15, f15, vpOf(h), place);
    }
  });

  it('40 枚・高い面（840×700）：最近のカードは 9 枚まで数える（16 枚が入る面でも 9 枚・1.0 倍）', () => {
    const rs = cards(40);
    const faces = boardFaces(rs, null);
    const vp = vpOf(700);
    expect(fitAll(faces, vp).zoom).toBeLessThan(READ_ZOOM_MIN); // 全体は入らない
    expect(fitsAt(groupRect(recentFaces(rs, faces).slice(0, 16)), 1, vp)).toBe(true);
    const o = open(rs, faces, vp, 'bottom');
    expect(o).toEqual({ view: { x: 115, y: -1032, zoom: 1 }, rule: 3, n: RECENT_MAX });
    expectRecent(o, rs, faces, vp, 'bottom');
  });

  it('どれも入らない（面 840×60・幅 150・30×30）ときは、最後に書いたカードを 0.85 倍で真ん中に置く（決まり 4）', () => {
    expect(open(rs14, f14, vpOf(60), 'upper')).toEqual({ view: { x: 161, y: -405, zoom: 0.85 }, rule: 4, n: 0 });
    expect(open(rs14, f14, { w: 150, h: 217 }, 'bottom')).toEqual({ view: { x: -184, y: -327, zoom: 0.85 }, rule: 4, n: 0 });
    expect(open(rs14, f14, { w: 30, h: 30 }, 'bottom').rule).toBe(4); // fitView が初期の位置（100%）を返す小さな面でも、全体とはみなさない
  });

  it('決まり 1：保存した倍率 0.5・0.8・0.849 は使わない。0.9 と、ちょうど 0.85 で最後に書いたカードが読めればそのまま', () => {
    const recent = { view: { x: 115, y: -345, zoom: 1 }, rule: 3, n: 5 };
    const saved = (view: BoardView) => open(rs14, f14, vpOf(217), 'upper', ok(board([], view)));
    expect(saved({ x: 0, y: 0, zoom: 0.5 })).toEqual(recent);
    const at08 = { x: 0, y: -300, zoom: 0.8 };
    expect(readable(at08, f14, 'c13', vpOf(217))).toBe(true); // 読めても 0.85 より小さい
    expect(saved(at08)).toEqual(recent);
    const at0849 = { x: 0, y: -350, zoom: 0.849 };
    expect(readable(at0849, f14, 'c13', vpOf(217))).toBe(true);
    expect(saved(at0849)).toEqual(recent);
    expect(saved({ x: 0, y: -350, zoom: 0.85 })).toEqual({ view: { x: 0, y: -350, zoom: 0.85 }, rule: 1, n: 0 });
    expect(saved({ x: 0, y: -400, zoom: 0.9 })).toEqual({ view: { x: 0, y: -400, zoom: 0.9 }, rule: 1, n: 0 });
  });

  it('決まり 1：保存した位置で最後に書いたカードが見えていない・9 割見えていても辺が外なら使わない', () => {
    const recent = { view: { x: 115, y: -345, zoom: 1 }, rule: 3, n: 5 };
    expect(open(rs14, f14, vpOf(217), 'upper', ok(board([], { x: 0, y: 0, zoom: 0.9 })))).toEqual(recent);
    const mostly = { x: 0, y: -280, zoom: 0.9 };
    expect(cardVisibleRatio(mostly, faceOf(f14, 'c13'), vpOf(217))).toBeGreaterThan(0.9);
    expect(open(rs14, f14, vpOf(217), 'upper', ok(board([], mostly)))).toEqual(recent);
  });

  it('決まり 1：初期値の位置（0,0,100%）は、最後に書いたカードがそこで読めても使わない。少しでも動かした位置なら使う', () => {
    const two = cards(2);
    const nodes = [{ ref: 'c01', x: 50, y: 50 }]; // 最後に書いた c01 を原点から離す
    const faces = boardFaces(two, board(nodes));
    const vp = { w: 600, h: 400 };
    expect(lastWritten(two, faces)?.id).toBe('c01');
    expect(readable(DEFAULT_VIEW, faces, 'c01', vp)).toBe(true);
    expect(fitAll(faces, vp)).not.toEqual(DEFAULT_VIEW);
    expect(open(two, faces, vp, 'bottom', ok(board(nodes, DEFAULT_VIEW)))).toEqual({ view: fitAll(faces, vp), rule: 2, n: 0 });
    expect(open(two, faces, vp, 'bottom', ok(board(nodes, { x: 1, y: 0, zoom: 1 })))).toEqual({ view: { x: 1, y: 0, zoom: 1 }, rule: 1, n: 0 });
  });

  it('決まり 2：全体が入る倍率がちょうど 0.85 なら全体。それより小さければ決まり 3', () => {
    const two = cards(2);
    const faces = boardFaces(two, null); // 400×96
    const just = { w: 376, h: 400 }; // (376 − 36) ÷ 400 ＝ 0.85
    expect(fitAll(faces, just).zoom).toBe(0.85);
    expect(open(two, faces, just, 'bottom')).toEqual({ view: fitAll(faces, just), rule: 2, n: 0 });
    const less = { w: 375, h: 400 };
    expect(fitAll(faces, less).zoom).toBeLessThan(0.85);
    const o = open(two, faces, less, 'bottom');
    expect(o).toEqual({ view: { x: 8, y: 157, zoom: 0.9 }, rule: 3, n: 2 });
    expectRecent(o, two, faces, less, 'bottom');
  });

  it('返信を数える：古いカードに返信すると、そのカードが最後に書いたカードになる', () => {
    const rs = [...rs14, reply('a1', { parent: 'c00', createdAt: 1000 })];
    const faces = boardFaces(rs, null);
    const o = open(rs, faces, vpOf(217), 'upper');
    expect(o).toEqual({ view: { x: 325, y: 4, zoom: 1 }, rule: 3, n: 1 });
    expectRecent(o, rs, faces, vpOf(217), 'upper');
    // c13 が読める保存した位置でも、最後に書いた c00 が読めないので使わない
    expect(open(rs, faces, vpOf(217), 'upper', ok(board([], { x: 0, y: -400, zoom: 0.9 }))).rule).toBe(3);
  });

  it('カードが無いときは今と同じく全体表示（決まり 2）', () => {
    expect(open([], [], vpOf(217), 'upper')).toEqual({ view: DEFAULT_VIEW, rule: 2, n: 0 });
    expect(open([], [], vpOf(217), 'upper', ok(board([], { x: 12, y: 34, zoom: 1 })))).toEqual({ view: DEFAULT_VIEW, rule: 2, n: 0 });
  });

  it('読む箱は形ごとに渡せる（六角は HX4）：低い箱なら、四角が 0.95 倍になる面 209 でも 1.0 倍で 5 枚', () => {
    const low = (at: { x: number; y: number }) => ({ x: at.x, y: at.y, w: BOARD_CARD.w, h: 40 });
    expect(open(rs14, f14, vpOf(209), 'upper').view.zoom).toBe(0.95);
    expect(openingView(missingLoad, rs14, f14, vpOf(209), { place: 'upper', readBox: low })).toEqual({ view: { x: 115, y: -344, zoom: 1 }, rule: 3, n: 5 });
  });

  it('recentView：倍率を絞って探せる。1 枚も読めなければ fallbackZoom で真ん中。カードが無ければ null', () => {
    expect(recentView(rs14, f14, vpOf(209), { place: 'upper', zooms: [1] })).toEqual({ view: { x: 220, y: -460, zoom: 1 }, rule: 3, n: 2 });
    expect(recentView(rs14, f14, vpOf(88), { place: 'upper', zooms: [1], fallbackZoom: 1 })).toEqual({ view: { x: 115, y: -468, zoom: 1 }, rule: 4, n: 0 });
    expect(recentView([], [], vpOf(217), upper)).toBeNull();
  });
});

describe('隠して出したとき（HX1：viewAfterShow）', () => {
  const view = { x: 115, y: -345, zoom: 1 }; // 14 枚の最後の 5 枚が読める位置（面 217）
  const vp = vpOf(217);
  it('最後に書いたカードが隠す前と同じなら動かさない', () => {
    expect(viewAfterShow(view, rs14, f14, vp, { place: 'upper', before: 'c13' })).toBeNull();
  });
  it('替わっても、読めていれば動かさない', () => {
    expect(readable(view, f15, 'c14', vp)).toBe(true);
    expect(viewAfterShow(view, rs15, f15, vp, { place: 'upper', before: 'c13' })).toBeNull();
  });
  it('替わって読めていなければ、最後に書いた辺りへ（決まり 3）', () => {
    const rs = [...rs14, reply('a1', { parent: 'c00', createdAt: 1000 })];
    const faces = boardFaces(rs, null);
    expect(readable(view, faces, 'c00', vp)).toBe(false);
    expect(viewAfterShow(view, rs, faces, vp, { place: 'upper', before: 'c13' })).toEqual({ view: { x: 325, y: 4, zoom: 1 }, rule: 3, n: 1 });
    expect(viewAfterShow(view, rs, faces, vp, { place: 'bottom', before: 'c13' })).toEqual({ view: { x: 325, y: 61, zoom: 1 }, rule: 3, n: 1 });
  });
  it('いちばん新しいカードが描かれていないときは、描いているカードの中で比べる', () => {
    const rs = [...rs14, reply('zz', { createdAt: 5000 })];
    expect(viewAfterShow(view, rs, f14, vp, { place: 'upper', before: 'c13' })).toBeNull();
  });
  it('カードが無い・面に大きさが無いときは動かさない', () => {
    expect(viewAfterShow(view, [], [], vp, { place: 'upper', before: null })).toBeNull();
    const rs = [...rs14, reply('a1', { parent: 'c00', createdAt: 1000 })];
    expect(viewAfterShow(view, rs, boardFaces(rs, null), { w: 0, h: 0 }, { place: 'upper', before: 'c13' })).toBeNull();
  });
});

describe('面が替わったとき（HX1：settleView）', () => {
  const opened = { x: 115, y: -345, zoom: 1 }; // 面 217 で開いた位置（決まり 3）
  const change = (over: Partial<FaceChange>): FaceChange => ({ dy: 0, rule: 3, touched: false, selected: 0, ...over });
  const settle = (view: BoardView, vp: { w: number; h: number }, over: Partial<FaceChange>, place: 'upper' | 'bottom' = 'upper', rs: readonly Reply[] = rs14, faces: readonly CardFace[] = f14) => settleView(view, rs, faces, vp, change(over), { place });

  it('道具の列を畳む（上端が 37 上へ）：決まり 1 は y を +37 して、カードを画面の上で止める', () => {
    expect(settle({ x: 0, y: -400, zoom: 0.9 }, vpOf(254), { dy: -37, rule: 1 })).toEqual({ view: { x: 0, y: -363, zoom: 0.9 }, rule: 1 });
  });
  it('絞りの札の行が出る（上端が 30 下へ）：触ったあとは y を −30 するだけ', () => {
    expect(settle(opened, vpOf(187), { dy: 30, touched: true })).toEqual({ view: { x: 115, y: -375, zoom: 1 }, rule: 3 });
  });
  it('触っていない決まり 3：今の面で計算し直す（217 → 180 で 1.0 倍・2 枚、戻すと 1.0 倍・5 枚）', () => {
    const narrow = settle(opened, vpOf(180), { dy: 37 });
    expect(narrow).toEqual({ view: { x: 220, y: -460, zoom: 1 }, rule: 3 });
    expect(settle(narrow.view, vpOf(217), { dy: -37 })).toEqual({ view: opened, rule: 3 });
  });
  it('触っていない決まり 2：全体を面に合わせ直す。決まり 3 からでも、全体が入る面になれば決まり 2 に替わる', () => {
    const two = cards(2);
    const faces = boardFaces(two, null);
    const big = { w: 600, h: 400 };
    const low = { w: 600, h: 200 };
    expect(settle(fitAll(faces, big), low, { dy: 200, rule: 2 }, 'bottom', two, faces)).toEqual({ view: fitAll(faces, low), rule: 2 });
    expect(settle(opened, vpOf(800), { dy: -37 })).toEqual({ view: fitAll(f14, vpOf(800)), rule: 2 });
  });
  it('触っていない決まり 4：面が広がれば決まり 3 になる', () => {
    const tiny = open4();
    expect(tiny.rule).toBe(4);
    expect(settle(tiny.view, vpOf(217), { dy: -37, rule: 4 })).toEqual({ view: opened, rule: 3 });
  });
  it('選んでいるカードがあるときは計算し直さず、上端の差を引くだけ（選んだカードが面から消えない）', () => {
    expect(settle(opened, vpOf(254), { dy: -37, selected: 1 })).toEqual({ view: { x: 115, y: -308, zoom: 1 }, rule: 3 });
  });
  it('決まり 1 と、触ったあとは、上端の差を引くだけ', () => {
    expect(settle(opened, vpOf(180), { dy: 37, rule: 1 })).toEqual({ view: { x: 115, y: -382, zoom: 1 }, rule: 1 });
    expect(settle(opened, vpOf(180), { dy: 37, touched: true })).toEqual({ view: { x: 115, y: -382, zoom: 1 }, rule: 3 });
  });
  it('置き場の替え（上端の差 0）：触っていなければ新しい置き場で計算し直し、触ったあとは位置を保つ', () => {
    expect(settle(opened, vpOf(299), {}, 'bottom')).toEqual({ view: { x: 161, y: -187, zoom: 0.85 }, rule: 3 });
    expect(settle(opened, vpOf(299), { touched: true }, 'bottom')).toEqual({ view: opened, rule: 3 });
  });
  it('開く前（決まりが無い）は上端の差を引くだけ', () => {
    expect(settle(opened, vpOf(217), { dy: 10, rule: null })).toEqual({ view: { x: 115, y: -355, zoom: 1 }, rule: null });
  });

  function open4() {
    return openingView(missingLoad, rs14, f14, vpOf(60), upper);
  }
});

describe('「100%」のボタン（HX1：actualSizeView）', () => {
  const far = { x: 0, y: 0, zoom: 0.4 };
  it('1 枚選んでいれば、そのカードを真ん中に 1.0 倍', () => {
    expect(actualSizeView(far, rs14, f14, vpOf(217), { place: 'upper', selected: 'c05' })).toEqual({ x: -95, y: -55, zoom: 1 });
  });
  it('選んでいなければ（描いていないカードを指していても）、最後に書いた辺りを 1.0 倍だけで探す（面 209 では、開いたときの 0.95 倍・5 枚ではなく 1.0 倍・2 枚）', () => {
    expect(openingView(missingLoad, rs14, f14, vpOf(209), upper).view.zoom).toBe(0.95);
    expect(actualSizeView(far, rs14, f14, vpOf(209), { place: 'upper', selected: null })).toEqual({ x: 220, y: -460, zoom: 1 });
    expect(actualSizeView(far, rs14, f14, vpOf(209), { place: 'upper', selected: 'gone' })).toEqual({ x: 220, y: -460, zoom: 1 });
    expect(actualSizeView(far, rs14, f14, vpOf(217), { place: 'upper', selected: null })).toEqual({ x: 115, y: -345, zoom: 1 });
  });
  it('1.0 倍で 1 枚も読めない面（88）では、最後に書いたカードを 1.0 倍で真ん中に', () => {
    expect(actualSizeView(far, rs14, f14, vpOf(88), { place: 'upper', selected: null })).toEqual({ x: 115, y: -468, zoom: 1 });
  });
  it('全体（決まり 2）は使わない：小さいメモでも 1.0 倍', () => {
    const small = cards(2);
    expect(actualSizeView({ x: 0, y: 0, zoom: 1.2 }, small, boardFaces(small, null), { w: 600, h: 400 }, { place: 'bottom', selected: null })).toEqual({ x: 100, y: 152, zoom: 1 });
  });
  it('カードが無ければ、面の真ん中を保って 1.0 倍', () => {
    expect(actualSizeView({ x: 10, y: 20, zoom: 0.5 }, [], [], { w: 600, h: 400 }, { place: 'upper', selected: null })).toEqual({ x: -280, y: -160, zoom: 1 });
  });
});