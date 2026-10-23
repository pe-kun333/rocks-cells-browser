// 取り込みの戻し方（UndoStep の importSheet）：指紋・形の検査・変わったところの数
import { describe, expect, it } from 'vitest';
import { fingerprint, type ImportSheetUndo, type ImportView, importChanges, importSheetState, isBackup, type PatchWorld, undoStep } from '../src/grok-patch';

const u: ImportSheetUndo = { r: 'importSheet', sheet: 'shnew1', memos: ['ma', 'mb'], portals: ['mp'], islands: ['i1'], boardLinks: ['bl1'], extra: 'ixabc' };

function view(): ImportView & { memos: { id: string; sheet: string; portal?: string; updatedAt: number; text: string; replies?: { id: string; text: string; editedAt?: number; rank?: number }[] }[]; boardLinks: { id: string; from: string; to: string }[] } {
  return {
    sheet: true,
    memos: [
      { id: 'ma', sheet: 'shnew1', updatedAt: 1, text: 'A', replies: [{ id: 'r1', text: 'カード', rank: 0 }] },
      { id: 'mb', sheet: 'shnew1', updatedAt: 2, text: 'B' },
      { id: 'mp', sheet: 'main', portal: 'shnew1', updatedAt: 3, text: '' },
      { id: 'mz', sheet: 'main', updatedAt: 4, text: 'ほかのシート' },
    ],
    tabs: 0,
    islandMembers: () => 2,
    boardLinks: [
      { id: 'bl1', from: 'm:ma', to: 'm:mb' },
      { id: 'blx', from: 'm:mz', to: 'm:mz2' },
    ],
  };
}

const worldOf = (v: ImportView, log: string[] = []) => ({ importView: () => v, removeImport: (_u: ImportSheetUndo, mode: string) => log.push(mode) }) as unknown as PatchWorld;

describe('importSheet の指紋', () => {
  it('シートが無ければ gone', () => {
    expect(fingerprint(worldOf({ ...view(), sheet: false }), u)).toBe('gone');
  });
  it('同じ様子なら同じ。メモの updatedAt・カードの文・並び・タブ・線・島で変わる', () => {
    const base = fingerprint(worldOf(view()), u);
    expect(fingerprint(worldOf(view()), u)).toBe(base);
    const touch = (f: (v: ReturnType<typeof view>) => void) => {
      const v = view();
      f(v);
      return fingerprint(worldOf(v), u);
    };
    expect(touch((v) => (v.memos[0].updatedAt = 9))).not.toBe(base);
    expect(touch((v) => (v.memos[0].replies = [{ id: 'r1', text: 'カード', rank: 1 }]))).not.toBe(base);
    expect(touch((v) => (v.memos[0].replies = [{ id: 'r1', text: '直した', editedAt: 5, rank: 0 }]))).not.toBe(base);
    expect(touch((v) => (v.tabs = 1))).not.toBe(base);
    expect(touch((v) => v.boardLinks.push({ id: 'bl2', from: 'm:mz', to: 'm:mp' }))).not.toBe(base); // ほかのシートから入口への線
    expect(touch((v) => (v.islandMembers = () => 3))).not.toBe(base);
    expect(touch((v) => v.memos.push({ id: 'mnew', sheet: 'shnew1', updatedAt: 5, text: '足した' }))).not.toBe(base);
    expect(touch((v) => (v.memos[3].updatedAt = 99))).toBe(base); // ほかのシートのメモは見ない
  });
  it('変わったところの数（小窓）', () => {
    const after = fingerprint(worldOf(view()), u);
    const v = view();
    v.memos[0].updatedAt = 9;
    v.memos.push({ id: 'mnew', sheet: 'shnew1', updatedAt: 5, text: '足した' });
    v.memos.splice(1, 1); // mb を消した
    v.tabs = 2;
    v.boardLinks.push({ id: 'bl2', from: 'm:mz', to: 'm:ma' });
    v.islandMembers = () => 3;
    const now = importSheetState(u, v);
    expect(now).not.toBeNull();
    expect(importChanges(u, after, now!)).toEqual({ edited: 1, added: 1, removed: 1, tabs: 2, links: 1, islandMembers: 1 });
  });
  it('戻す（指紋が同じとき）はシートごと消す', () => {
    const log: string[] = [];
    undoStep(worldOf(view(), log), u);
    expect(log).toEqual(['sheet']);
  });
});

describe('控えの形の検査（validUndo）', () => {
  const backup = (undo: unknown) => ({ v: 1, id: 'ixabc', patchId: 'ix:x', title: 't', source: 'file', appliedAt: 'a', steps: [{ label: 'l', undo, after: '{}' }], skipped: 0 });
  it('正しい形を通す', () => {
    expect(isBackup(backup(u))).toBe(true);
  });
  it('崩れた形は通さない', () => {
    expect(isBackup(backup({ ...u, sheet: 'main' }))).toBe(false);
    expect(isBackup(backup({ ...u, memos: [1] }))).toBe(false);
    expect(isBackup(backup({ ...u, extra: '../x' }))).toBe(false);
    expect(isBackup(backup({ ...u, islands: undefined }))).toBe(false);
  });
});
