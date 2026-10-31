// ボード全体のキー・案内・配色・狭い幅（B4-2）：Delete の決め事（memo-card-board-keys.ts）と、画面の配線・CSS・C++ の静的な確かめ
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { deleteTitle } from '../src/memo-card-board-edit';
import { BOARD_KEY_HINT, boardKeyAction, type BoardKeyInput, KEYSHORTCUTS } from '../src/memo-card-board-keys';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const base: BoardKeyInput = { key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, repeat: false, typing: false, busy: false, modal: false };
const press = (over: Partial<BoardKeyInput> = {}) => boardKeyAction({ ...base, ...over });

describe('Delete キー（boardKeyAction）', () => {
  it('何も押さずに Delete だけ、書く欄にフォーカスが無いとき、他に開いているものが無いときだけ「消す」', () => {
    expect(press()).toBe('delete');
  });

  it('文字を書く欄にフォーカスがあるときは効かない', () => {
    expect(press({ typing: true })).toBeNull();
  });

  it('つまんでいる最中・範囲選択の最中・小窓や確認が開いているあいだは効かない', () => {
    expect(press({ busy: true })).toBeNull();
    expect(press({ modal: true })).toBeNull();
  });

  it('修飾キーつき・押しっぱなし・変換中は効かない', () => {
    expect(press({ ctrlKey: true })).toBeNull();
    expect(press({ metaKey: true })).toBeNull();
    expect(press({ shiftKey: true })).toBeNull();
    expect(press({ altKey: true })).toBeNull();
    expect(press({ repeat: true })).toBeNull();
    expect(press({ isComposing: true })).toBeNull();
  });

  it('Delete 以外のキーは、ここでは決めない（Esc・Ctrl+A・Ctrl+Z・Backspace・Space は既存の道）', () => {
    for (const key of ['Escape', 'a', 'z', 'y', 'Backspace', ' ', 'Enter', 'Del']) expect(press({ key })).toBeNull();
    expect(press({ key: 'a', ctrlKey: true })).toBeNull();
    expect(press({ key: 'z', ctrlKey: true })).toBeNull();
  });
});

describe('案内の文', () => {
  it('ボードの一言に、効くキーが全部入っている', () => {
    for (const part of ['ホイール：拡大縮小', '空きをドラッグ：移動', 'Shift＋ドラッグ：範囲選択', 'Ctrl+A：全選択', 'Delete：削除', 'Ctrl+Z：元に戻す', 'Esc：選びを外す']) expect(BOARD_KEY_HINT).toContain(part);
  });

  it('削除のツールチップに Delete と Ctrl+Z。選びが空なら先に選ぶよう案内', () => {
    expect(deleteTitle(2)).toContain('Delete キーでも消せます');
    expect(deleteTitle(2)).toContain('Ctrl+Z で元に戻せます');
    expect(deleteTitle(2)).toContain('2 枚');
    expect(deleteTitle(0)).toBe('先に消すカードを選んでください');
  });

  it('aria-keyshortcuts の値', () => {
    expect(KEYSHORTCUTS).toEqual({ remove: 'Delete', undo: 'Control+Z', redo: 'Control+Shift+Z Control+Y' });
  });
});

describe('画面の配線（静的）', () => {
  const tab = read('../src/app/memo-board-tab.ts');
  it('Delete は「削除」ボタンと同じ道（removeSelected）。押せないとき・選びが空のときは何もしない。ヒントは部品から', () => {
    expect(tab).toContain("from '../memo-card-board-keys'");
    expect(tab).toContain('BOARD_KEY_HINT');
    const at = tab.indexOf("=== 'delete'");
    expect(at).toBeGreaterThan(0);
    const block = tab.slice(at, at + 260);
    expect(block).toContain('this.removeBtn.disabled');
    expect(block).toContain('this.selected.size === 0');
    expect(block).toContain('this.removeSelected()');
    expect(block).toContain('e.preventDefault()');
  });

  it('modal には、書く小窓・整理の確認・線を引く途中・型の小窓を入れている。つまんでいる最中・範囲選択も見ている', () => {
    const at = tab.indexOf('const modal =');
    const line = tab.slice(at, tab.indexOf('\n', at));
    for (const part of ['this.composing !== null', '!this.tidyBar.hidden', 'this.linkFrom !== null', 'this.templateKey !== null', 'this.fillOpen']) expect(line).toContain(part);
    expect(tab).toContain('busy: this.drag !== null || this.marquee !== null');
  });

  it('既存のキー（Ctrl+A・Ctrl+Z 系・スペース）の分岐は残っている。Delete の分岐はそのあとのスペースの前', () => {
    const iA = tab.indexOf("e.key.toLowerCase() === 'a'");
    const iZ = tab.indexOf("zy === 'z'");
    const iD = tab.indexOf("=== 'delete'");
    const iS = tab.indexOf("e.code !== 'Space'");
    expect(iA).toBeGreaterThan(0);
    expect(iZ).toBeGreaterThan(iA);
    expect(iD).toBeGreaterThan(iZ);
    expect(iS).toBeGreaterThan(iD);
  });

  it('ボタンに aria-keyshortcuts を付ける', () => {
    expect(tab).toContain('KEYSHORTCUTS.remove');
    expect(tab).toContain('KEYSHORTCUTS.undo');
    expect(tab).toContain('KEYSHORTCUTS.redo');
  });
});

describe('C++ は触らない・Delete を先に取らない（browser.cpp）', () => {
  const cpp = read('../../src/browser.cpp');
  it('WatchShortcuts は Ctrl が押されているキーだけを見る。Delete・Esc は取らない', () => {
    const at = cpp.indexOf('void Browser::WatchShortcuts');
    const end = cpp.indexOf('// ---------- 配置とウィンドウ', at);
    const body = cpp.slice(at, end);
    expect(body).toContain('GetKeyState(VK_CONTROL) >= 0) return S_OK');
    expect(body).not.toMatch(/VK_DELETE|VK_ESCAPE|VK_BACK/);
    // 先に取る Ctrl＋キー：Z・A・Delete は無い
    const keys = [...body.matchAll(/case '(\w)':/g)].map((m) => m[1]);
    expect(keys).not.toContain('Z');
    expect(keys).not.toContain('A');
  });
});

describe('CSS（色を作らない・狭い幅）', () => {
  const css = read('../src/grok-cards.css');
  const b42 = css.slice(css.indexOf('/* B4-2：'));
  const pane = read('../src/memo-pane.css');
  const paneB42 = pane.slice(pane.indexOf('/* B4-2：'));

  it('B4-2 で足した CSS に、色の直書き（#… rgb( hsl( など）が無い。色は var(--…) だけ', () => {
    for (const text of [b42, paneB42]) {
      expect(text.length).toBeGreaterThan(50);
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|:\s*(white|black|gray|grey|red|blue|green)\b/);
    }
    expect(b42).toContain('var(--muted)');
    expect(b42).toContain('var(--text)');
  });

  it('ボード全体の CSS（.memo-board…）に、色の直書きが無い（もとから）', () => {
    const start = css.indexOf('.memo-board {');
    expect(start).toBeGreaterThan(0);
    const board = css.slice(start);
    expect(board).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it('入力欄の見本の字（placeholder）をテーマの変数にする：ボードの検索・書く小窓・型の小窓', () => {
    expect(b42).toMatch(/\.memo-board-search::placeholder,\s*\.memo-board-compose-text::placeholder\s*{[^}]*color: var\(--muted\);[^}]*opacity: 1;/);
    expect(paneB42).toMatch(/\.memo-pane-tpl-dialog \.memo-pane-tpl-name::placeholder\s*{[^}]*color: var\(--muted\);[^}]*opacity: 1;/);
  });

  it('狭い幅：ボタンは折り返さない・整理／線の帯は折り返せる・帯の文は縮められる・一言は幅内に収まる', () => {
    expect(b42).toMatch(/\.memo-board-tool,\s*\.memo-board-expand,\s*\.memo-board-fit\s*{[^}]*white-space: nowrap;/);
    expect(b42).toMatch(/\.memo-board-linkbar,\s*\.memo-board-tidybar\s*{[^}]*flex-wrap: wrap;/);
    expect(b42).toMatch(/\.memo-board-linkbar-text,\s*\.memo-board-tidybar-text\s*{[^}]*min-width: 0;/);
    expect(b42).toMatch(/\.memo-board-hint\s*{[^}]*max-width: calc\(100% - 16px\);/);
  });

  it('旗・命令・C++ の追加は無い（キーの部品は DOM にも bridge にも触らない）', () => {
    const keys = read('../src/memo-card-board-keys.ts');
    expect(keys).not.toMatch(/bridge|relay|localStorage|document\.|window\./);
  });
});