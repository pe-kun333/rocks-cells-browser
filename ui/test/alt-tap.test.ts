// Alt を単独で押して離したかの見分け（下の書く欄と上のボードの書く欄を行き来する）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AltTap, type AltKeyEvent } from '../src/alt-tap';

const key = (name: string, over: Partial<AltKeyEvent> = {}): AltKeyEvent => ({ key: name, ctrlKey: false, shiftKey: false, metaKey: false, isComposing: false, repeat: false, ...over });

describe('AltTap', () => {
  it('Alt を単独で押して離すと 1 回だけ true', () => {
    const tap = new AltTap();
    expect(tap.down(key('Alt'))).toBe(true);
    expect(tap.up(key('Alt'))).toBe(true);
    expect(tap.up(key('Alt'))).toBe(false);
  });
  it('押しっぱなしの繰り返しでは、離したときの 1 回のまま', () => {
    const tap = new AltTap();
    tap.down(key('Alt'));
    expect(tap.down(key('Alt', { repeat: true }))).toBe(true);
    expect(tap.up(key('Alt'))).toBe(true);
  });
  it('間にほかのキーを押すと数えない（Alt+Tab・Alt+←・Alt+半角/全角）', () => {
    for (const other of ['Tab', 'ArrowLeft', 'Zenkaku', 'F4', '1']) {
      const tap = new AltTap();
      tap.down(key('Alt'));
      expect(tap.down(key(other, { })), other).toBe(false);
      expect(tap.up(key('Alt')), other).toBe(false);
    }
  });
  it('Ctrl・Shift・Meta と一緒なら数えない', () => {
    for (const over of [{ ctrlKey: true }, { shiftKey: true }, { metaKey: true }]) {
      const tap = new AltTap();
      expect(tap.down(key('Alt', over))).toBe(false);
      expect(tap.up(key('Alt'))).toBe(false);
    }
  });
  it('日本語の変換中は数えない（押すときも、離すときも）', () => {
    const a = new AltTap();
    expect(a.down(key('Alt', { isComposing: true }))).toBe(false);
    expect(a.up(key('Alt'))).toBe(false);
    const b = new AltTap();
    b.down(key('Alt'));
    expect(b.up(key('Alt', { isComposing: true }))).toBe(false);
  });
  it('AltGr は数えない。Alt を押さずに離しても数えない', () => {
    const tap = new AltTap();
    expect(tap.down(key('AltGraph'))).toBe(false);
    expect(tap.up(key('AltGraph'))).toBe(false);
    expect(tap.up(key('Alt'))).toBe(false);
  });
  it('ほかの窓へ移った・マウスを押した（reset）あとは数えない', () => {
    const tap = new AltTap();
    tap.down(key('Alt'));
    tap.reset();
    expect(tap.up(key('Alt'))).toBe(false);
  });
  it('ほかのキーを離しても、Alt の押し始めは消えない', () => {
    const tap = new AltTap();
    tap.down(key('Alt'));
    expect(tap.up(key('x'))).toBe(false);
    expect(tap.up(key('Alt'))).toBe(true);
  });
});

describe('配線（ソースの形）', () => {
  const pane = readFileSync(new URL('../src/app/memo-pane.ts', import.meta.url), 'utf8');
  it('Alt で動くのは、ボードを上に出しているときの二つの書く欄の中だけ（全体のキーにしない）', () => {
    expect(pane).toContain('grokCardsUi.boardUpperShown() && comment.getClientRects().length > 0 && !cardMap.isOpen && (target === comment || grokCardsUi.inBoardCompose(target))');
  });
});
