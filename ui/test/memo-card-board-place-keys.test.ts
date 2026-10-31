// 案 C・C4：上に出しているあいだのキー・Esc・フォーカスの決まり（純関数の表）と、配線の静的な確かめ
//   DOM を動かす確かめは headless の dev 画面（手順は docs/card-board-test-guide.ja.md の 4.6）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { escAction } from '../src/grok-cards-tabs';
import { BOARD_KEY_HINT, boardKeysActive, type KeyFocus, keyFocusOf } from '../src/memo-card-board-keys';
import { escActionFor } from '../src/memo-card-board-place';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const tab = read('../src/app/memo-board-tab.ts');
const cards = read('../src/app/grok-cards.ts');
const pane = read('../src/app/memo-pane.ts');

const FOCI: KeyFocus[] = ['board', 'outside', 'none'];

describe('boardKeysActive（フォーカス × 最後に押した所 × 置き場）', () => {
  it('下に出している（今まで・段 "2" 無しも同じ）ときは、場所を問わず常に受ける', () => {
    for (const f of FOCI) for (const out of [false, true]) expect(boardKeysActive(false, f, out)).toBe(true);
  });
  it('上に出しているとき：ボードの面の中は受ける（最後に押した所が下の帯でなければ）', () => {
    expect(boardKeysActive(true, 'board', false)).toBe(true);
    expect(boardKeysActive(true, 'board', true)).toBe(false); // ボードのボタンにフォーカスがあるまま、下の帯の空きを押した
  });
  it('上に出しているとき：下のメモの帯・境目・その小窓（ボードの外）は受けない', () => {
    expect(boardKeysActive(true, 'outside', false)).toBe(false);
    expect(boardKeysActive(true, 'outside', true)).toBe(false);
  });
  it('上に出しているとき：フォーカスがどこにも無いときは、最後に押した所が下の帯でなければ受ける', () => {
    expect(boardKeysActive(true, 'none', false)).toBe(true);
    expect(boardKeysActive(true, 'none', true)).toBe(false);
  });
});

describe('keyFocusOf', () => {
  it('ボードの中が先／body など何も無いなら none／それ以外は外', () => {
    expect(keyFocusOf(true, false)).toBe('board');
    expect(keyFocusOf(true, true)).toBe('board');
    expect(keyFocusOf(false, true)).toBe('none');
    expect(keyFocusOf(false, false)).toBe('outside');
  });
});

describe('上のボードの Esc（escActionFor）', () => {
  const o = { picker: false };
  it('つまんで（範囲選択して）いれば取り消す。欄の中でもつまんでいれば取り消す', () => {
    expect(escActionFor('memo', { ...o, inField: false, boardDragging: true, boardSelected: true }, true)).toBe('cancel-drag');
    expect(escActionFor('memo', { ...o, inField: true, boardDragging: true }, true)).toBe('cancel-drag');
  });
  it('つまんでいなければ、選びを外す。欄の中なら何もしない', () => {
    expect(escActionFor('memo', { ...o, inField: false, boardSelected: true }, true)).toBe('clear-selection');
    expect(escActionFor('memo', { ...o, inField: true, boardSelected: true }, true)).toBe('ignore');
  });
  it('縮める・メモを出す・下へ戻す、は決してしない（選びも無ければ何もしない）', () => {
    for (const expanded of [false, true, undefined]) {
      for (const field of [false, true]) {
        const a = escActionFor('memo', { ...o, inField: field, boardExpanded: expanded, boardSelected: false }, true);
        expect(a).toBe('ignore');
      }
    }
    const all = new Set<string>();
    for (const drag of [false, true]) for (const sel of [false, true]) for (const field of [false, true]) for (const ex of [false, true]) all.add(escActionFor('memo', { ...o, inField: field, boardExpanded: ex, boardDragging: drag, boardSelected: sel }, true));
    expect([...all].sort()).toEqual(['cancel-drag', 'clear-selection', 'ignore']);
  });
  it('下に出している（上に出していない）ときは、今までの escAction と全部同じ', () => {
    for (const t of ['memo', 'cards', 'board'] as const) {
      for (const picker of [false, true]) for (const field of [false, true]) for (const ex of [false, true]) for (const drag of [false, true]) for (const sel of [false, true]) {
        const opts = { inField: field, picker, boardExpanded: ex, boardDragging: drag, boardSelected: sel };
        expect(escActionFor(t, opts, false)).toBe(escAction(t, opts));
      }
    }
  });
});

describe('キーの案内は変えない（C4-4）', () => {
  it('BOARD_KEY_HINT は B4-2 のまま', () => {
    expect(BOARD_KEY_HINT).toBe('ホイール：拡大縮小／空きをドラッグ：移動／Shift＋ドラッグ：範囲選択／Ctrl+A：全選択／Delete：削除／Ctrl+Z：元に戻す／Esc：選びを外す');
  });
});

describe('memo-board-tab.ts の配線（C4）', () => {
  it('ボードのキー（Ctrl+A・Ctrl+Z 系・Delete・スペース）は、受けてよいかを最初に確かめる。その前には何も決めない', () => {
    const w = tab.slice(tab.indexOf("window.addEventListener('keydown'"));
    const head = w.slice(0, w.indexOf('const inField'));
    expect(head).toContain('if (this.hidden) return;');
    expect(head).toContain('if (!this.keysAllowed(e.target)) return;');
    expect(head.indexOf('this.hidden')).toBeLessThan(head.indexOf('keysAllowed'));
  });
  it('最後に押した所は、window の pointerdown（捕まえる側）で、ボードの面の外かどうかを覚える。ボードを押したら下の帯のフォーカスを外す（上のときだけ）', () => {
    expect(tab).toMatch(/window\.addEventListener\(\s*'pointerdown',\s*\(e\) => \{\s*const inside = e\.target instanceof Node && \(this\.root\.contains\(e\.target\) \|\| !!this\.menu\?\.node\.contains\(e\.target\)\);[^\n]*\n\s*this\.pointerOutside = !inside;/);
    expect(tab).toMatch(/if \(inside && this\.place === 'upper'\) \{\s*const active = document\.activeElement;\s*if \(active instanceof HTMLElement && active !== document\.body && !this\.root\.contains\(active\)\) active\.blur\(\);/);
    expect(tab).toMatch(/this\.root\.addEventListener\('focusin', \(\) => \{\s*this\.pointerOutside = false;/);
  });
  it('受けてよいかは、置き場が上のときだけ絞る（下は常に受ける）', () => {
    expect(tab).toContain("boardKeysActive(this.place === 'upper', keyFocusOf(inBoard, bare), this.pointerOutside)");
  });
  it('矢印キー・Home・End はボードの全体のキーでは受けない（境目の矢印キーと取り合わない）', () => {
    const w = tab.slice(tab.indexOf("window.addEventListener('keydown'"), tab.indexOf("window.addEventListener('keyup'"));
    expect(w).not.toMatch(/'Arrow(?:Up|Down|Left|Right)'|'Home'|'End'|'PageUp'|'PageDown'/);
  });
});

describe('memo-pane.ts の境目（C4-2・C4-5）', () => {
  it('境目の矢印キー・Home・End は、境目そのものの keydown だけで受ける。Delete は受けない（素通りで、ボードは外にあるので消えない）', () => {
    const i = pane.indexOf("handle.addEventListener('keydown', (e) => {\r\n      const total = splittableHeight();");
    expect(i).toBeGreaterThan(-1);
    const h = pane.slice(i, pane.indexOf('});', i));
    expect(h).toContain("'ArrowUp'");
    expect(h).toContain("'ArrowDown'");
    expect(h).toContain("'Home'");
    expect(h).toContain("'End'");
    expect(h).not.toContain('Delete');
    expect(pane).toContain('split.tabIndex = 0;');
  });
});

describe('grok-cards.ts の上のボードの Esc（C4-3）', () => {
  it('取り消す→選びを外す、まで。縮めない・showMemo しない・下へ戻さない', () => {
    const s = cards.slice(cards.indexOf('private consumeBoardUpperEsc'), cards.indexOf('  onOpen(open: boolean) {'));
    expect(s).toContain("escActionFor('memo'");
    expect(s).toContain('board.cancelDrag()');
    expect(s).toContain('board.clearSelection()');
    expect(s).not.toMatch(/shrink\(|showMemo\(|placeBoard\(|requestPlaced\(|setCardsPlace\(|writeBoardPlace/);
  });
  it('上に出していない・フォーカスが下の帯のときは、メモの今までの Esc に任せる（false を返す）', () => {
    const s = cards.slice(cards.indexOf('private consumeBoardUpperEsc'), cards.indexOf('  onOpen(open: boolean) {'));
    expect(s).toContain('if (!board || !this.isBoardUpper()) return false;');
    expect(s).toContain('if (!board.keysAllowed(e.target)) return false;'); // M3：その前に、ボードのメニューの Esc だけは先に受ける（ownsMenu）
  });
});