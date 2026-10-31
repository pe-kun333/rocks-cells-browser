// 小窓（入口先のシートの小窓）の空いたセル右クリック →「メモを書く」の配線（ソースの形）の確かめ
//   入口先のシートに作る・今のシートには作らない・本盤面と小窓の既存の操作は変わらない
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sidebar = read('../src/sidebar.ts');
const primary = read('../src/app/primary.ts');
const count = (text: string, part: string) => text.split(part).length - 1;
const bodyOf = (text: string, start: string) => {
  const from = text.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  const rest = text.slice(from + start.length);
  const next = rest.search(/\n  (?:\/\/ |function |async function )/);
  return rest.slice(0, next < 0 ? rest.length : next);
};

describe('sidebar.ts：小窓の右クリック', () => {
  it('新しい操作 peekEmptyMenu は任意（無ければ今までどおり空いた所は何も出さない）。宣言と使う所の 2 か所だけ（コメント以外）', () => {
    expect(sidebar).toMatch(/peekEmptyMenu\?\(hex: Hex, x: number, y: number\): void;/);
    expect(sidebar).toMatch(/this\.actions\.peekEmptyMenu\?\.\(pixelToHex\(at\.x, at\.y, CELL\), e\.clientX, e\.clientY\);\s*return;/);
    expect(count(sidebar, 'peekEmptyMenu?')).toBe(2);
  });
  it('空いた所だけが新しい道：セルがあるときの contextMenu の呼び出し（小窓・本盤面）は今のまま', () => {
    expect(count(sidebar, 'this.actions.contextMenu({ id, memo, hex: pixelToHex(w.x, w.y, CELL), x: e.clientX, y: e.clientY });')).toBe(2);
    expect(sidebar).toMatch(/this\.actions\.prepareContextSelection\?\.\(id, memo\);\s*this\.actions\.contextMenu\(/);
  });
  it('本盤面の右クリックは peekEmptyMenu を使わない（本盤面の contextmenu の中に出てこない）', () => {
    const from = sidebar.indexOf("svg.addEventListener('contextmenu'");
    const to = sidebar.indexOf("svg.addEventListener('pointercancel'");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    expect(sidebar.slice(from, to)).not.toContain('peekEmptyMenu');
  });
  it('小窓のダブルクリックでは今までどおり作らない（allowCreate=false）', () => {
    expect(sidebar).toMatch(/this\.openDoubleClick\(e, false\);/);
  });
});

describe('primary.ts：入口先のシートに作る', () => {
  it('小窓の盤面だけに peekEmptyMenu を渡す。小窓の空いたセルのタブ作成（createAt）は noop のまま、本盤面の createAt も今のまま', () => {
    expect(count(primary, 'peekEmptyMenu:')).toBe(1);
    expect(primary).toContain('peekEmptyMenu: (hex, x, y) => openPeekEmptyMenu(hex, x, y)');
    expect(primary).toContain('createAt: noop,');
    expect(primary).toContain('createAt: (pos) => createTab(HOME_URL, pos),');
    const peekStart = primary.indexOf('peekBoard = new Sidebar(');
    const peekEnd = primary.indexOf('peekBoard.copyLook(sidebar);');
    expect(primary.slice(peekStart, peekEnd)).toContain('peekEmptyMenu:');
    expect(primary.slice(0, peekStart)).not.toContain('peekEmptyMenu:');
  });
  it('writeNewMemo はシートと盤面を引数にできる（ふだんは今のシートと本盤面）。本盤面の呼び出しは今のまま', () => {
    expect(primary).toContain("function writeNewMemo(at: Hex, initial = '', sheet = sheets.current, board: Sidebar = sidebar, inPeek = false) {");
    expect(primary).toContain("entries.push({ label: 'メモを書く', run: () => writeNewMemo(at) });");
    expect(primary).toContain('run: () => writeNewMemo(at, text) };');
    expect(count(primary, 'writeNewMemo(')).toBe(4); // 宣言・本盤面のメニュー 2 か所・小窓 1 か所
  });
  it('小窓の保存：シートがあるか確かめ、消えていたら作らず知らせる。上限の一言も出す。showMemo は呼ばない', () => {
    const body = bodyOf(primary, 'function writeNewMemo(');
    const peek = body.slice(body.indexOf('if (inPeek) {'), body.indexOf('const memo = memos.add'));
    expect(peek).toContain('const name = sheets.get(sheet)?.name ?? null;');
    expect(peek).toContain('peekMemoNote({ sheetName: name, created: !!made })');
    expect(peek).toContain('toast(note)');
    expect(peek).not.toContain('showMemo');
    expect(peek).not.toContain('sheets.current'); // 今のシートには作らない
    expect(body.slice(body.indexOf('const memo = memos.add'))).toContain('preview.showMemo(memo.id)'); // 本盤面は今までどおり
  });
  it('書き込み欄は小窓の盤面のセルの近くに出す（board.anchorOfHex）。本盤面のときは sidebar のまま', () => {
    expect(primary).toContain('memoEditor.open(board.anchorOfHex(at), heading, initial,');
  });
  it('openPeekEmptyMenu：開いた時点の入口先シート id（sheetPeek.sheetId）を覚えて渡す。sheets.current は使わない。シートが無いときは出さない', () => {
    const body = bodyOf(primary, 'function openPeekEmptyMenu(');
    expect(body).toContain('const sheet = sheetPeek.sheetId;');
    expect(body).toContain('peekEmptyMenuPlan(');
    expect(body).toContain("writeNewMemo(hex, '', sheet, board, true)");
    expect(body).toContain('if (!sheet || !board || !plan) return;');
    expect(body).not.toContain('sheets.current');
  });
  it('Esc・シート移動・小窓の扱いは今のまま（欄が先に Esc を受ける／シートを変えると欄と小窓を閉じる／書きかけは移動を止める）', () => {
    expect(primary).toContain('escBlocked: () => cellMenu.isOpen || memoEditor.isOpen || faceEditor.isOpen,');
    const after = bodyOf(primary, 'function afterSheetChange() {');
    expect(after).toContain('memoEditor.close();');
    expect(after).toContain('sheetPeek.close();');
    expect(primary).toContain('const editorsBusy = () => faceEditor.isDirty || memoEditor.hasText;');
  });
  it('小窓を閉じる・中のシートが変わると、小窓用の書き込み欄もしまう（ほかの欄は巻き込まない）', () => {
    expect(primary).toMatch(/dismissTabDetail: \(\) => \{\s*preview\.releasePeekPin\(\);\s*if \(peekEditing && memoEditor\.isOpen\) memoEditor\.close\(\);[^\n]*\s*peekEditing = false;\s*\},/);
    expect(primary).toContain('peekEditing = inPeek;');
    expect(count(primary, 'peekEditing = false;')).toBeGreaterThanOrEqual(5); // 保存・書き直す・ボットに頼む・やめる・小窓の閉じ
  });
  it('Ctrl+V は今のシートのまま（小窓用の貼り付けは足していない）', () => {
    expect(primary).not.toMatch(/function openPeekEmptyMenu[\s\S]{0,800}pasteAt/);
  });
});