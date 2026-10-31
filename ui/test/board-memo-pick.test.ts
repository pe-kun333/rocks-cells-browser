// ボードの見るメモの名札と選び口（M3）：決まりの純関数（名札・メニュー・旗・貼り付けの帯）と、配線（ソースの形）の確かめ
import { readFileSync } from 'node:fs';
import { unwrapT } from './source-text';
import { describe, expect, it } from 'vitest';

import { BOARD_SEND_WINDOW_MS, RESET_LABEL, boardMemoInfo, memoTagOf, pickMode, pickerEntries, skipLowerSentBar, titleOf } from '../src/memo-board-pick';
import type { MenuEntry } from '../src/panels/cell-menu';
import type { MemoIndexItem } from '../src/memocells';

const read = (path: string) => unwrapT(readFileSync(new URL(path, import.meta.url), 'utf8'));
const A = { id: 'a', text: 'メモ A の見出し\n本文' };
const B = { id: 'b', text: '\n  メモ B  \n本文' };
const item = (id: string, title: string): MemoIndexItem => ({ id, sheet: 'main', title, tags: [], createdAt: 1, updatedAt: 1 });
const labels = (entries: MenuEntry[]) => entries.map((e) => (typeof e === 'string' ? '--' : 'section' in e ? `# ${e.section}` : 'note' in e ? `note:${e.note}` : 'label' in e ? e.label : '?'));

describe('boardMemoInfo：見ているメモと、下の区画との違い', () => {
  it('選んでいなければ下の区画のメモ（other なし・chosen なし）。どちらも無ければ null', () => {
    const info = boardMemoInfo(null, A)!;
    expect(info).toMatchObject({ shownId: 'a', shownTitle: 'メモ A の見出し', lowerId: 'a', chosen: false, other: false });
    expect(boardMemoInfo(null, null)).toBeNull();
  });
  it('別のメモを選ぶと other。見出しは最初の空でない行（前後の空白は除く）', () => {
    expect(boardMemoInfo(B, A)).toMatchObject({ shownId: 'b', shownTitle: 'メモ B', lowerId: 'a', lowerTitle: 'メモ A の見出し', chosen: true, other: true });
  });
  it('下の区画と同じメモを選んでいるときは chosen だが other ではない。下の区画が閉じていれば lowerId は null で other', () => {
    expect(boardMemoInfo(A, A)).toMatchObject({ chosen: true, other: false });
    expect(boardMemoInfo(B, null)).toMatchObject({ shownId: 'b', lowerId: null, other: true });
  });
  it('見出しは 16 字まで（超えたら …）。空なら「（空のメモ）」', () => {
    expect(titleOf('1234567890123456789')).toBe('1234567890123456…');
    expect(titleOf('   \n  ')).toBe('（空のメモ）');
  });
});

describe('pickMode・memoTagOf：名札', () => {
  const same = boardMemoInfo(null, A);
  const other = boardMemoInfo(B, A);
  it('上に出しているときだけ full（旗は廃止した）。下のボードでは選べない（static）', () => {
    expect(pickMode(same, { available: true, upper: true })).toBe('full');
    expect(pickMode(same, { available: true, upper: false })).toBe('static');
    expect(pickMode(same, { available: false, upper: true })).toBe('static');
    expect(pickMode(null, { available: true, upper: true })).toBe('static');
  });
  it('別のメモを見たまま下のボード：「下と同じに戻す」だけ押せる（reset）。戻れなくなるのを防ぐ', () => {
    expect(pickMode(other, { available: true, upper: false })).toBe('reset');
    expect(pickMode(other, { available: false, upper: false })).toBe('static');
    expect(pickMode(other, { available: true, upper: true })).toBe('full');
  });
  it('名札：別のメモは other（目立つ）、同じは same（控えめ）。選べるときだけ ▾ が付く', () => {
    expect(memoTagOf(other, 'full')).toMatchObject({ text: 'メモ：メモ B ▾', tone: 'other', pickable: true });
    expect(memoTagOf(other, 'static')).toMatchObject({ text: 'メモ：メモ B', tone: 'other', pickable: false });
    expect(memoTagOf(same, 'full')).toMatchObject({ text: 'メモ：メモ A の見出し ▾', tone: 'same', pickable: true });
    expect(memoTagOf(same, 'static')).toMatchObject({ text: 'メモ：メモ A の見出し', tone: 'same', pickable: false });
    expect(memoTagOf(null, 'full')).toBeNull();
  });
  it('別のメモの説明には下の区画のメモの名前が入る', () => {
    expect(memoTagOf(other, 'full')!.title).toContain('メモ A の見出し');
    expect(memoTagOf(other, 'full')!.title).toContain('別のメモ');
  });
});

describe('pickerEntries：メニュー', () => {
  const items = [item('a', 'メモ A'), item('b', 'メモ B'), item('c', 'メモ C')];
  const recent = [item('c', 'メモ C'), item('a', 'メモ A')];
  const make = (chosen: ReturnType<typeof boardMemoInfo>, mode: 'full' | 'reset', run = (_id: string | null) => {}) => pickerEntries({ items, recent, sheetName: 'メイン', info: chosen!, mode, run });
  it('先頭に「下の区画と同じに戻す」。最近開いたメモのあとに、同じシートのメモ（最近と重なるものは省く）', () => {
    expect(labels(make(boardMemoInfo(B, A), 'full'))).toEqual(['# ボードで見るメモ', RESET_LABEL, '--', '# 最近開いたメモ', 'メモ C', 'メモ A', '--', '# メインのメモ', 'メモ B']);
  });
  it('選んでいなければ、戻す項目は押せない。選んでいれば押せて、押すと null を渡す', () => {
    const got: Array<string | null> = [];
    const none = make(boardMemoInfo(null, A), 'full', (id) => void got.push(id));
    expect(none[1]).toMatchObject({ label: RESET_LABEL, disabled: true });
    const chosen = make(boardMemoInfo(B, A), 'full', (id) => void got.push(id));
    const reset = chosen[1] as { run?: () => void; disabled?: boolean };
    expect(reset.disabled).toBeUndefined();
    reset.run?.();
    expect(got).toEqual([null]);
  });
  it('メモを押すとその id を渡す。いま見ているメモは押せない（「見ています」）、下の区画のメモには「下の区画」', () => {
    const got: Array<string | null> = [];
    const entries = make(boardMemoInfo(B, A), 'full', (id) => void got.push(id));
    const aEntry = entries.find((e) => typeof e !== 'string' && 'label' in e && e.label === 'メモ A') as { hint?: string; run?: () => void };
    expect(aEntry.hint).toBe('下の区画');
    aEntry.run?.();
    expect(got).toEqual(['a']);
    const bEntry = entries.find((e) => typeof e !== 'string' && 'label' in e && e.label === 'メモ B') as { hint?: string; disabled?: boolean };
    expect(bEntry).toMatchObject({ hint: '見ています', disabled: true });
  });
  it('reset のメニューは「戻す」と、選べない理由の一言だけ（別のメモの一覧は出さない）', () => {
    const entries = make(boardMemoInfo(B, A), 'reset');
    expect(labels(entries)).toEqual(['# ボードで見るメモ', RESET_LABEL, 'note:別のメモを選べるのは、ボードを上に出しているあいだです。']);
  });
  it('一覧が空なら一言。メニューは 40 件までに切る', () => {
    expect(labels(pickerEntries({ items: [], recent: [], sheetName: '', info: boardMemoInfo(null, A)!, mode: 'full', run: () => {} }))).toContain('note:選べるメモがありません。');
    const many = Array.from({ length: 100 }, (_, i) => item(`m${i}`, `メモ${i}`));
    const out = pickerEntries({ items: many, recent: [], sheetName: 'メイン', info: boardMemoInfo(null, A)!, mode: 'full', run: () => {} });
    expect(out.filter((e) => typeof e !== 'string' && 'label' in e && e.label.startsWith('メモ')).length).toBe(40);
  });
});

describe('選び口の旗 honeycomb.boardMemoPicker は廃止した（常にオン）', () => {
  // コードの中のコメントではなく、実際の文だけを見る（行頭が // の行は外す）
  const code = (path: string) => read(path).split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  it('旧い鍵 honeycomb.boardMemoPicker を読む所が、ソースのどこにも無い', () => {
    for (const f of ['../src/card-board-stages.ts', '../src/app/memo-pane.ts', '../src/app/memo-board-tab.ts', '../src/app/grok-cards.ts', '../src/memo-board-pick.ts']) {
      expect(code(f), f).not.toMatch(/boardMemoPicker|BOARD_PICKER|boardPickerOn|boardPickerFromStorage|onBoardPicker/);
    }
  });
  it('旧い鍵 honeycomb.cardBoardStages も同じ（読む所・通知する所が無い）', () => {
    for (const f of ['../src/card-board-stages.ts', '../src/app/grok-cards.ts', '../src/app/memo-pane.ts']) {
      expect(code(f), f).not.toMatch(/cardBoardStages|CARD_BOARD_STAGES_KEY|boardStageOn|onBoardStages|boardStagesFromStorage|BOARD_DEFAULT_STAGES/);
    }
  });
});

describe('skipLowerSentBar：ボードが別のメモへ貼った直後の「元に戻す」の帯を、下の区画に出さない', () => {
  const base = { openMemo: 'b', lowerId: 'a', chosenId: 'b', boardSentAt: 1000, now: 1500 };
  it('ボードが（下とは別の）選んだメモへ貼った直後だけ true', () => {
    expect(skipLowerSentBar(base)).toBe(true);
  });
  it('選んでいない・下と同じメモ・送り先が別・ボードが送っていない・時間が過ぎた：今までどおり出す（false）', () => {
    expect(skipLowerSentBar({ ...base, chosenId: null })).toBe(false);
    expect(skipLowerSentBar({ ...base, chosenId: 'a', openMemo: 'a' })).toBe(false);
    expect(skipLowerSentBar({ ...base, openMemo: 'c' })).toBe(false);
    expect(skipLowerSentBar({ ...base, boardSentAt: null })).toBe(false);
    expect(skipLowerSentBar({ ...base, now: 1000 + BOARD_SEND_WINDOW_MS + 1 })).toBe(false);
    expect(skipLowerSentBar({ ...base, now: 999 })).toBe(false);
  });
});

describe('配線（ソースの形）', () => {
  const tab = read('../src/app/memo-board-tab.ts');
  const pane = read('../src/app/memo-pane.ts');
  const cards = read('../src/app/grok-cards.ts');
  const css = read('../src/grok-cards.css');
  it('ボードの部品は旗の鍵・命令名を知らない。メモの一覧・名札の元・選ぶ道は hook（source.info・cmds.pick）から取る', () => {
    expect(tab).not.toMatch(/honeycomb\.boardMemoPicker|boardPickerOn|BOARD_PICKER|enabled\(\)/);
    expect(tab).toContain('this.source?.info?.()');
    expect(tab).toContain('pick.pick(id)');
    expect(tab).toContain("pickMode(info, { available: !!pick, upper: this.place === 'upper' })");
  });
  it('名札はボードの見出しの行に常に置く（選び口は上に出しているときだけ）', () => {
    expect(tab).toMatch(/bar\.append\(el\('span', 'memo-board-title', 'ボード'\), this\.memoTag, this\.count, this\.orphanEl\)/);
    expect(tab).toMatch(/refresh\(show: boolean\) \{\s*this\.paintMemoTag\(\);/);
    expect(tab).toMatch(/this\.root\.classList\.toggle\('is-upper', upper\);\s*this\.paintMemoTag\(\);/);
  });
  it('下の面：見るメモの名札の元は boardMemoInfo(boardMemoView, view)、一覧は sheetItems・recentItems、選ぶと setBoardMemo（null で戻す）', () => {
    expect(pane).toContain('info: () => boardMemoInfo(boardMemoView, view)');
    expect(pane).toContain('list: () => ({ items: sheetItems, recent: recentItems, sheetName: listSheetName })');
    expect(pane).toContain("pick: (id) => ask({ command: 'setBoardMemo', id })");
    expect(pane).not.toContain('boardPickerOn');
  });
  it('Grok Cards はボードに pick と boardAsk を渡すだけ（無ければ今までの ask）', () => {
    expect(cards).toContain('pick: this.o.boardPick');
    expect(cards).toContain('(this.o.boardAsk ?? this.o.ask)(action)');
  });
  it('ボードから開いた型の小窓は、下の区画の選びが変わっても閉じない（ボードが自分で閉じる）', () => {
    expect(pane).toMatch(/!tplSaving && !tplFromBoard && !sameIds\(selectedIds\(\), tplIds\)/);
  });
  it('型の貼り付けの帯：ボードが別のメモへ貼ったときは下の区画に出さない（ボードの Undo には渡す）。命令は sendReplies の時刻だけ覚える', () => {
    expect(pane).toMatch(/if \(!boardOwn\) showSent\(/);
    expect(pane).toMatch(/boardUndoSendListeners\.forEach\(\(fn\) => fn\(sent\.token, sent\.memo\)\)/);
    expect(pane).toContain("if (action.command === 'sendReplies') boardSentAt = Date.now();");
  });
  it('上のボードのメニュー（選び口など）の Esc は、メニューを閉じるだけ（下の区画を閉じない）。メニューの中の押下もボードの中として数える', () => {
    expect(tab).toMatch(/this\.menuEsc = e\.key === 'Escape' && e\.target instanceof Node && !!this\.menu\?\.isOpen && this\.menu\.node\.contains\(e\.target\) \? e : null;/);
    expect(tab).toContain('ownsMenu(e: Event): boolean');
    expect(tab).toContain('this.root.contains(e.target) || !!this.menu?.node.contains(e.target)');
    expect(cards).toMatch(/if \(board\.ownsMenu\(e\)\) \{\s*e\.preventDefault\(\);[^\n]*\n\s*return true;\s*\}\s*if \(!board\.keysAllowed\(e\.target\)\) return false;/);
  });
  it('CSS：別のメモのときの名札と帯の色は既存のテーマ変数だけ', () => {
    const block = css.slice(css.indexOf('M3：ボードが見ているメモの名札'));
    expect(block).toContain('.memo-board.is-other-memo .memo-board-bar');
    expect(block).toContain('.memo-board-memotag.is-other');
    expect(block.match(/var\(--[a-z-]+\)/g)!.every((v) => /--(border|muted|accent-line|accent-soft|accent-ink|shell-focus)/.test(v))).toBe(true);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
  it('C++ は変えない：命令・中継の型は M1 のまま（M3 で足した命令は無い）', () => {
    const types = read('../src/types.ts');
    expect(types.match(/command: 'setBoardMemo'/g)).toHaveLength(1);
    expect(types.match(/kind: 'memoBoardView'/g)).toHaveLength(1);
  });
});