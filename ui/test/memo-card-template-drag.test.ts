// 型の窓から区画へドラッグして貼る：離したときの動きと知らせの文（純粋な部分）。つまみ自体は pointer-grab.ts（卓上の試験は無いので、操作は画面で確かめる）
import { describe, expect, it } from 'vitest';

import { dragNote, dropAction } from '../src/memo-card-template-palette';
import { pasteBlocked } from '../src/memo-card-template-store';
import { sampleTemplates } from '../src/memo-card-template-samples';

describe('dropAction（離したときにすること）', () => {
  it('区画の外なら、入りきるかどうかに関わらず何もしない', () => {
    expect(dropAction(false, null)).toBe('none');
    expect(dropAction(false, '300 枚を超えます')).toBe('none');
  });
  it('区画の上で入るなら貼る・入りきらないなら断る', () => {
    expect(dropAction(true, null)).toBe('paste');
    expect(dropAction(true, '300 枚を超えます')).toBe('refuse');
  });
  it('300 枚の上限は、クリックで貼るときと同じ pasteBlocked で決まる', () => {
    const t = sampleTemplates()[0];
    expect(dropAction(true, pasteBlocked(0, t.cards.length))).toBe('paste');
    expect(dropAction(true, pasteBlocked(300, t.cards.length))).toBe('refuse');
    expect(dropAction(true, pasteBlocked(300 - t.cards.length, t.cards.length))).toBe('paste');
    expect(dropAction(true, pasteBlocked(300 - t.cards.length + 1, t.cards.length))).toBe('refuse');
  });
});

describe('dragNote（つまんでいる間の知らせ）', () => {
  const t = { name: '賛成・反対・結論', cards: sampleTemplates()[0].cards };
  it('区画の外：札は題と枚数だけ。窓の行は「ここで離しても何もしない」', () => {
    const n = dragNote(t, false, null);
    expect(n.chip).toBe(`＋ 賛成・反対・結論（${t.cards.length}枚）`);
    expect(n.info).toContain('何もしません');
    expect(n.info).toContain('Esc');
    expect(n.error).toBe(false);
  });
  it('区画の上：離すと貼ると伝える', () => {
    const n = dragNote(t, true, null);
    expect(n.chip).toContain('離すと貼る');
    expect(n.info).toContain('賛成・反対・結論');
    expect(n.error).toBe(false);
  });
  it('区画の上でも入りきらないなら、理由を赤字で出す', () => {
    const blocked = pasteBlocked(300, t.cards.length) ?? '';
    expect(blocked).not.toBe('');
    const n = dragNote(t, true, blocked);
    expect(n.chip).toContain('貼れません');
    expect(n.info).toBe(blocked);
    expect(n.error).toBe(true);
  });
});
