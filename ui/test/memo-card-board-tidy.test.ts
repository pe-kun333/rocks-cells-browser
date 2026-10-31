// ボードの「整理」と文面のそろえ（B4-1）：孤児の数・確認・整理の結果（memo-card-board-tidy.ts）、文の共通部品（memo-card-board-texts.ts）、画像・引用カードの顔、画面の配線
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BOARD_LIMITS, type Board, emptyBoard, orphanCount } from '../src/memo-card-board';
import { addBlockedNote } from '../src/memo-card-board-edit';
import { pasteToolNote } from '../src/memo-card-board-paste';
import { ledgerFullNote, loadingNote, nodesFullNote, unreadableBlockNote } from '../src/memo-card-board-texts';
import type { LoadBoardResult } from '../src/memo-card-board-store';
import { orphanNoteText, orphansOf, planTidy, TIDY_NONE_NOTE, TIDY_UNDO_NOTE, tidyButton, tidyConfirmMessage, tidyConfirmText, tidyDoneText } from '../src/memo-card-board-tidy';
import { undoBlockedNote, UndoStack, type UndoOp } from '../src/memo-card-board-undo';
import { boardEmptyText, boardFaces, boardNote, BOARD_FACE, moveBlockedNote } from '../src/memo-card-board-view';
import { cardLabel } from '../src/memo-card-links';
import { MAX_REPLIES, type Reply } from '../src/threads';

const card = (id: string, text: string, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text, createdAt: 1, ...extra });
const boardOf = (refs: string[]): Board => ({ ...emptyBoard('m1'), nodes: refs.map((ref, i) => ({ ref, x: i * 10, y: i * 5 })), view: { x: 7, y: 8, zoom: 1.5 } });
const okLoad = (board: Board): LoadBoardResult => ({ state: 'ok', memoId: 'm1', board, dropped: 0, raw: {}, backupNeeded: false });
const bad: LoadBoardResult = { state: 'unreadable', memoId: 'm1', why: 'failed' };

const readFileSync = (path: string, _enc: 'utf8') => readFile(new URL(path.startsWith('src/') ? '../' + path : path, import.meta.url), 'utf8');describe('孤児の数と文（B4-1 の 1）', () => {
  it('孤児が 1 つ以上のときだけ「（消したカードの位置が n 件残っています）」。0 件なら空', () => {
    expect(orphanNoteText(0)).toBe('');
    expect(orphanNoteText(1)).toBe('（消したカードの位置が 1 件残っています）');
    expect(orphanNoteText(12)).toBe('（消したカードの位置が 12 件残っています）');
  });

  it('orphansOf：台帳の一番上のカードに無い位置の数。返信は数えない。読み込み中・読めないは 0', () => {
    const replies = [card('a', 'A'), card('b', 'B'), { id: 'r', parent: 'a', text: 'ふ', createdAt: 2 } as Reply];
    expect(orphansOf(okLoad(boardOf(['a', 'b'])), replies)).toBe(0);
    expect(orphansOf(okLoad(boardOf(['a', 'x', 'y', 'r'])), replies)).toBe(3); // r は返信なので生きたカードではない
    expect(orphansOf(null, replies)).toBe(0);
    expect(orphansOf(bad, replies)).toBe(0);
    expect(orphansOf(okLoad(boardOf(['a', 'x'])), [])).toBe(2);
  });
});

describe('整理ボタンと確認（B4-1 の 2・3）', () => {
  const replies = [card('a', 'A')];
  it('孤児があるときだけ押せる。ないとき・読み込み中・読めないときは理由つきで押せない', () => {
    const one = tidyButton({ load: okLoad(boardOf(['a', 'x'])), replies });
    expect(one.enabled).toBe(true);
    expect(one.count).toBe(1);
    expect(one.note).toContain('元のカードは消えません');
    expect(tidyButton({ load: okLoad(boardOf(['a'])), replies })).toEqual({ enabled: false, count: 0, note: TIDY_NONE_NOTE });
    expect(tidyButton({ load: okLoad(emptyBoard('m1')), replies })).toMatchObject({ enabled: false, count: 0 });
    const loading = tidyButton({ load: null, replies });
    expect(loading.enabled).toBe(false);
    expect(loading.note).toBe(loadingNote('整理して'));
    const unreadable = tidyButton({ load: bad, replies });
    expect(unreadable.enabled).toBe(false);
    expect(unreadable.note).toContain('書き込みません');
    expect(tidyButton({ load: okLoad(boardOf(['a', 'x'])), replies, busy: true })).toMatchObject({ enabled: false, count: 1 });
  });

  it('確認の文は決めた通り。積みに削除・貼り付けが残っているときだけ一言添える（整理しても戻したカードは元の位置）', () => {
    expect(tidyConfirmText(3)).toBe('消したカードの位置 3 件を整理します。元のカードは消えません');
    expect(tidyConfirmMessage(3, false)).toBe('消したカードの位置 3 件を整理します。元のカードは消えません');
    const withNote = tidyConfirmMessage(3, true);
    expect(withNote.startsWith('消したカードの位置 3 件を整理します。元のカードは消えません')).toBe(true);
    expect(withNote).toContain(TIDY_UNDO_NOTE);
    expect(withNote).not.toContain('仮の位置'); // 戻したカードは積みに控えた位置に出る（restoreMoves）ので、仮の位置とは書かない
    expect(tidyDoneText(3)).toBe('消したカードの位置 3 件を整理しました');
  });

  it('UndoStack.has：削除・貼り付けが（やり直しの側にも）残っているか', () => {
    const s = new UndoStack();
    const mv: UndoOp = { kind: 'move', moves: [{ ref: 'a', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }] };
    const rm: UndoOp = { kind: 'remove', ids: ['a'], at: { a: { x: 0, y: 0 } }, token: 'u-1' } as UndoOp;
    expect(s.has(['remove', 'paste'])).toBe(false);
    s.push(mv);
    expect(s.has(['remove', 'paste'])).toBe(false);
    s.push(rm);
    expect(s.has(['remove', 'paste'])).toBe(true);
    s.take('undo'); // 取り出しただけ（まだどちらの積みにも無い）
    expect(s.has(['remove', 'paste'])).toBe(false);
    s.finish('undo', rm, s.version);
    expect(s.has(['remove', 'paste'])).toBe(true); // やり直しの側
    s.clear();
    expect(s.has(['remove', 'paste', 'move'])).toBe(false);
  });
});

describe('planTidy（整理の結果）', () => {
  const replies = [card('a', 'A'), card('b', 'B')];
  it('孤児だけを落とす：生きたカードの位置・見ている位置・メモ id はそのまま。元の board は変えない', () => {
    const board = boardOf(['a', 'x', 'b', 'y']);
    const snapshot = JSON.stringify(board);
    const plan = planTidy(okLoad(board), replies, 99);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.removed).toBe(2);
    expect(plan.board.nodes).toEqual([{ ref: 'a', x: 0, y: 0 }, { ref: 'b', x: 20, y: 10 }]);
    expect(plan.board.view).toEqual({ x: 7, y: 8, zoom: 1.5 });
    expect(plan.board.memoId).toBe('m1');
    expect(plan.board.updatedAt).toBe(99);
    expect(JSON.stringify(board)).toBe(snapshot);
    expect(orphanCount(plan.board, replies)).toBe(0);
  });

  it('孤児が無ければ none（書かない）。読み込み中・読めないボードは blocked（書かない）', () => {
    expect(planTidy(okLoad(boardOf(['a', 'b'])), replies, 1)).toEqual({ ok: false, why: 'none' });
    expect(planTidy(okLoad(emptyBoard('m1')), replies, 1)).toEqual({ ok: false, why: 'none' });
    expect(planTidy(null, replies, 1)).toEqual({ ok: false, why: 'blocked' });
    expect(planTidy(bad, replies, 1)).toEqual({ ok: false, why: 'blocked' });
  });

  it('まだ無いボード（missing）でも孤児は無いので none。台帳が空なら全部が孤児として落ちる', () => {
    const missing: LoadBoardResult = { state: 'missing', memoId: 'm1', board: emptyBoard('m1'), dropped: 0, raw: null, backupNeeded: false };
    expect(planTidy(missing, replies, 1)).toEqual({ ok: false, why: 'none' });
    const all = planTidy(okLoad(boardOf(['x', 'y'])), [], 5);
    expect(all.ok && all.board.nodes).toEqual([]);
  });

  it('整理で空いた分、300 件の上限に余裕ができる（孤児は生きた数に入らない）', () => {
    const refs = Array.from({ length: BOARD_LIMITS.nodes }, (_, i) => `o${i}`);
    const board = boardOf(refs);
    const plan = planTidy(okLoad(board), [card('a', 'A')], 1);
    expect(plan.ok && plan.removed).toBe(BOARD_LIMITS.nodes);
    expect(plan.ok && plan.board.nodes.length).toBe(0);
  });
});

describe('文のそろえ（B4-1 の 6）：型は「動作 ＋ 理由」。読めないときは「（書き込みません）」＋読めない理由', () => {
  it('部品：読み込み中・読めない・台帳がいっぱい・位置がいっぱい', () => {
    expect(loadingNote('動かして')).toBe('ボードを読み込み中です。少し待ってから動かしてください');
    expect(unreadableBlockNote('カードは動かせません', 'failed')).toBe('カードは動かせません（書き込みません）。このボードは読めないので、位置は保存されません（仮の並びで見せています。ファイルは変えていません）');
    expect(ledgerFullNote('カードを足せません')).toBe(`カードを足せません（1 つのメモに入るのは ${MAX_REPLIES} 件までです）`);
    expect(nodesFullNote(0, 5)).toBe(`型を貼れませんでした（ボードに残せる位置は ${BOARD_LIMITS.nodes} 件までです。あと 0 件、型は 5 枚です）`);
    expect(nodesFullNote(-3, 5)).toContain('あと 0 件');
  });

  it('どの道具も同じ型：読み込み中は同じ書き出し、読めないときは「（書き込みません）」、300 件は「件までです」', () => {
    const none: Reply[] = [];
    const lines = [moveBlockedNote(null), addBlockedNote(null, none), pasteToolNote(null, none), undoBlockedNote(null), tidyButton({ load: null, replies: none }).note];
    for (const s of lines) expect(s).toMatch(/^ボードを読み込み中です。少し待ってから.+ください$/);
    const unreadable = [moveBlockedNote(bad), addBlockedNote(bad, none), pasteToolNote(bad, none), undoBlockedNote(bad), tidyButton({ load: bad, replies: none }).note];
    for (const s of unreadable) expect(s).toMatch(/^.+（書き込みません）。このボードは読めないので/);
    const full = Array.from({ length: MAX_REPLIES }, (_, i) => card(`c${i}`, `c${i}`));
    for (const s of [addBlockedNote(okLoad(emptyBoard('m1')), full), pasteToolNote(okLoad(emptyBoard('m1')), full)]) expect(s).toMatch(new RegExp(`^.+（1 つのメモに入るのは ${MAX_REPLIES} 件までです）$`));
  });

  it('読み込み中・空の文：見た目に出す文は変えない（空は「カードがまだありません」）', () => {
    expect(boardNote(null, 0).text).toBe('ボードを読み込み中です…');
    expect(boardEmptyText).toBe('このメモにはカードがまだありません');
    expect(boardNote({ state: 'unreadable', memoId: 'm1', why: 'failed' }, 0).tone).toBe('warn');
  });

  it('動作は同じ：読めないボードは動かせず、動かせるなら null', () => {
    expect(moveBlockedNote(okLoad(emptyBoard('m1')))).toBeNull();
    expect(addBlockedNote(okLoad(emptyBoard('m1')), [])).toBeNull();
  });
});

describe('画像・引用カード（B4-1 の 5）：顔の題は cardLabel と同じ文。表示は変えない', () => {
  const quote = { url: 'https://example.com/', title: 'ページの題', text: '引用の本文\n二行目' };
  const cases: [string, Reply][] = [
    ['画像だけ', card('i', '', { image: { w: 1, h: 1, dataUrl: 'data:image/png;base64,AA==' } as unknown as Reply['image'] })],
    ['引用だけ', card('q', '', { quote })],
    ['引用に一言', card('q2', 'ひとこと\n詳しく', { quote })],
    ['画像に一言', card('i2', 'この図', { image: { w: 1, h: 1, dataUrl: 'data:image/png;base64,AA==' } as unknown as Reply['image'] })],
    ['長い題', card('l', 'あ'.repeat(80), { quote })],
    ['空', card('e', '')],
  ];
  for (const [name, reply] of cases) {
    it(`${name}：題＝cardLabel(…, ${BOARD_FACE.titleMax})、本文は空、印は ❝・📷`, () => {
      const faces = boardFaces([reply], null);
      expect(faces).toHaveLength(1);
      expect(faces[0].title).toBe(cardLabel(reply, BOARD_FACE.titleMax));
      if (reply.quote || reply.image) expect(faces[0].body).toBe('');
      expect(faces[0].mark).toBe([reply.quote ? '❝' : '', reply.image ? '📷' : ''].filter(Boolean).join(' '));
    });
  }

  it('題の付け方は cardLabel だけ（見た目の文を別に作らない）', () => {
    expect(cardLabel(cases[0][1], 36)).toBe('（画像）');
    expect(cardLabel(cases[1][1], 36)).toBe('ページの題');
    const src = readFileSync('src/memo-card-board-view.ts', 'utf8');
    expect(src).not.toMatch(/'（画像）'|'（引用）'|quote\?*\.title\s*\|\|/);
  });
});

describe('画面の配線（静的）', () => {
  const tab = readFileSync('src/app/memo-board-tab.ts', 'utf8');
  it('整理ボタン・孤児の件数・確認の小窓があり、整理は積みに入れず、追加の控えも作らない', () => {
    expect(tab).toMatch(/orphanEl/);
    expect(tab).toMatch(/\[this\.tidyBtn, \(\) => this\.openTidy\(\)\]/);
    expect(tab).toMatch(/this\.tidyBar\.hidden = false/);
    const run = tab.slice(tab.indexOf('private runTidy()'), tab.indexOf('private paintTools()'));
    expect(run).toContain('planTidy(');
    expect(run).toContain('saveBoard(');
    expect(run).not.toMatch(/pushUndo|undo\.push|resetUndo|backup/i); // 積みに入れない・控えを足さない
    expect(run).toContain('snap.replies'); // 保存の直前の台帳で数え直す
  });

  it('押すと確認（決めるまで書かない）。openTidy は saveBoard を呼ばない', () => {
    const open = tab.slice(tab.indexOf('private openTidy()'), tab.indexOf('private closeTidy('));
    expect(open).not.toContain('saveBoard(');
    expect(open).not.toContain('enqueue(');
    expect(tab).toMatch(/tidyOk\.addEventListener\('click', \(\) => this\.runTidy\(\)\)/);
  });

  it('C++ は触らない（旗・命令の追加なし）：整理は ui-data の保存だけ', () => {
    const tidySrc = readFileSync('src/memo-card-board-tidy.ts', 'utf8');
    expect(tidySrc).not.toMatch(/relay|bridge|sendReplies|removeReply/);
  });
});