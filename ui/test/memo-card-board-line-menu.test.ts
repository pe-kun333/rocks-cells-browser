import { describe, expect, it, vi } from 'vitest';
import { lineMenuEntries } from '../src/memo-card-board-menu';
import { isKeyboardMenu } from '../src/memo-card-board-keys';

const base = () => ({
  sentence: 'A は B の根拠',
  fromLabel: 'A',
  toLabel: 'B',
  choices: [
    { kind: 'ground' as const, name: '根拠', current: true, disabled: false },
    { kind: 'next' as const, name: '続き', current: false, disabled: false },
    { kind: 'same' as const, name: '同じ', current: false, disabled: true },
  ],
  goFrom: vi.fn(),
  goTo: vi.fn(),
  setKind: vi.fn(),
  remove: vi.fn(),
});

describe('線のメニュー（CB15）', () => {
  it('文・元へ移る・相手へ移る・種類・この関連 の順', () => {
    const items = lineMenuEntries(base());
    expect(items[0]).toEqual({ section: 'A は B の根拠' });
    expect(items[1]).toMatchObject({ label: '元へ移る', hint: 'A' });
    expect(items[2]).toMatchObject({ label: '相手へ移る', hint: 'B' });
    expect(items[3]).toBe('sep');
    expect(items[4]).toMatchObject({ row: '種類' });
    expect(items[5]).toMatchObject({ row: 'この関連' });
  });
  it('今の種類は押した印。押せない種類は出さない。今の種類を押しても何も送らない', () => {
    const o = base();
    const row = lineMenuEntries(o)[4] as { buttons: { label: string; pressed?: boolean; run: () => void }[] };
    expect(row.buttons.map((b) => [b.label, b.pressed])).toEqual([['根拠', true], ['続き', false]]);
    row.buttons[0].run();
    expect(o.setKind).not.toHaveBeenCalled();
    row.buttons[1].run();
    expect(o.setKind).toHaveBeenCalledWith('next');
  });
  it('外すは二度押し', () => {
    const row = lineMenuEntries(base())[5] as { buttons: { confirm?: string }[] };
    expect(row.buttons[0].confirm).toBeTruthy();
  });
});

describe('キーで開いたメニューの見分け（CB14）', () => {
  it('位置が 0,0・ボタンが -1・種類が空ならキー', () => {
    expect(isKeyboardMenu({ clientX: 0, clientY: 0, button: 2 })).toBe(true);
    expect(isKeyboardMenu({ clientX: 10, clientY: 10, button: -1 })).toBe(true);
    expect(isKeyboardMenu({ clientX: 10, clientY: 10, button: 2, pointerType: '' })).toBe(true);
    expect(isKeyboardMenu({ clientX: 10, clientY: 10, button: 2 })).toBe(false);
    expect(isKeyboardMenu({ clientX: 10, clientY: 10, button: 2, pointerType: 'mouse' })).toBe(false);
  });
});
