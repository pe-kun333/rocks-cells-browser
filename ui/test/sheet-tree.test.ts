import { describe, expect, it } from 'vitest';

import { buildSheetTree, isFolderSheet, rankSheetMatch, type TreeCell } from '../src/sheet-tree';

const sheets = (...ids: string[]) => ids.map((id) => ({ id }));
const door = (sheet: string, portal: string, q: number, r: number, createdAt = 1): TreeCell => ({ sheet, portal, pos: { q, r }, createdAt });

describe('buildSheetTree', () => {
  it('中は盤面の並び（上の行から、行の中は左から）。重なり・自分・メインは除く', () => {
    const t = buildSheetTree(sheets('main', 'a', 'b', 'c'), [door('main', 'b', 1, 1), door('main', 'a', 0, 0), door('main', 'a', 3, 3), door('main', 'main', 2, 0), door('a', 'a', 0, 0), door('a', 'main', 1, 0)]);
    expect(t.children('main')).toEqual(['a', 'b']);
    expect(t.children('a')).toEqual([]);
    expect(t.unreachable).toEqual(['c']);
  });

  it('ふつうのメモ（入口でない）は数えない。台帳に無い行き先も数えない', () => {
    const t = buildSheetTree(sheets('main', 'a'), [{ sheet: 'main', pos: { q: 0, r: 0 }, createdAt: 1 }, door('main', 'gone', 1, 0), door('main', 'a', 2, 0)]);
    expect(t.children('main')).toEqual(['a']);
  });

  it('親が 2 つ：メインからの最短。同じ深さなら古い入口。来た順の親があればそれ', () => {
    // main → work(11月01日) → topic、main → topic も。folder と work は同じ深さ
    const cells = [door('main', 'work', 0, 0, 1), door('main', 'folder', 1, 0, 2), door('work', 'topic', 0, 0, 50), door('folder', 'topic', 0, 0, 10), door('main', 'deep', 2, 0, 3), door('deep', 'x', 0, 0, 4), door('x', 'topic', 0, 0, 1)];
    const t = buildSheetTree(sheets('main', 'work', 'folder', 'topic', 'deep', 'x'), cells);
    expect(t.depth('topic')).toBe(2);
    expect(t.parentOf('topic')).toBe('folder'); // 深さ 1 の 2 つのうち、入口が古い方（x は深さ 2 で後ろ）
    expect(t.parentOf('topic', 'work')).toBe('work');
    expect(t.parentOf('topic', 'nobody')).toBe('folder');
    expect(t.path('topic')).toEqual(['main', 'folder', 'topic']);
    expect(t.parentOf('main')).toBeNull();
  });

  it('メインからたどれない輪（A↔B）は消えずに unreachable に出る。path は輪で止まる', () => {
    const t = buildSheetTree(sheets('main', 'a', 'b'), [door('a', 'b', 0, 0), door('b', 'a', 0, 0)]);
    expect(t.unreachable).toEqual(['a', 'b']);
    expect(t.depth('a')).toBeUndefined();
    expect(t.path('a')).toEqual(['b', 'a']);
  });

  it('メインからたどれる輪：深さは最初に届いた所。descendants は輪で止まり、自分を入れない', () => {
    const t = buildSheetTree(sheets('main', 'a', 'b', 'c'), [door('main', 'a', 0, 0), door('a', 'b', 0, 0), door('b', 'a', 0, 0), door('b', 'c', 1, 0)]);
    expect(t.depth('a')).toBe(1);
    expect(t.depth('b')).toBe(2);
    expect(t.parentOf('a')).toBe('main');
    expect([...t.descendants('a')].sort()).toEqual(['b', 'c']);
    expect(t.descendants('c').size).toBe(0);
  });

  it('どのシートも、木（メインから）か unreachable のどちらかに出る（100 枚）', () => {
    const ids = ['main', ...Array.from({ length: 99 }, (_, i) => `s${i}`)];
    const cells: TreeCell[] = [];
    for (let i = 0; i < 99; i += 3) cells.push(door(i === 0 ? 'main' : `s${i - 3}`, `s${i}`, i, 0));
    cells.push(door('s50', 's51', 0, 0), door('s51', 's50', 0, 0));
    const t = buildSheetTree(sheets(...ids), cells);
    for (const id of ids.slice(1)) expect(t.depth(id) !== undefined || t.unreachable.includes(id)).toBe(true);
    expect(t.unreachable).not.toContain('s3');
  });
});

describe('isFolderSheet', () => {
  it('タブが無く、入口だけがあるシート', () => {
    expect(isFolderSheet(0, [{ portal: 'a' }, { portal: 'b' }])).toBe(true);
    expect(isFolderSheet(0, [])).toBe(false);
    expect(isFolderSheet(1, [{ portal: 'a' }])).toBe(false);
    expect(isFolderSheet(0, [{ portal: 'a' }, {}])).toBe(false);
  });
});

describe('rankSheetMatch', () => {
  it('名前の頭 → 名前の中 → ひとこと・島の名前。空は null', () => {
    expect(rankSheetMatch('てく', 'てくのろじー', [])).toBe(0);
    expect(rankSheetMatch('ろじ', 'てくのろじー', [])).toBe(1);
    expect(rankSheetMatch('朝', '11月01日', ['朝のルーティン'])).toBe(2);
    expect(rankSheetMatch('無い', '11月01日', ['朝'])).toBeNull();
    expect(rankSheetMatch('  ', '11月01日', [])).toBeNull();
  });
});
