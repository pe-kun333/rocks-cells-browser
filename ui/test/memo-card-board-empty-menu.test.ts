// 段 TA4b・TA5・TA6・TA7：面の空きと題の帯の右クリックのメニューと、空きのダブルクリック（計画書 docs/plan-comment-board-templates.md）
//   メニューの中身は純粋な関数（memo-card-board-menu.ts の boardMenuEntries）。配線（memo-board-tab.ts）は字面で確かめる
//   置き場の計算（spotAt・pointSpot・cardNear・hexOutside）は memo-card-board-spots.test.ts・memo-card-board-select.test.ts・memo-card-board-hex.test.ts
//   パネルを通した動き（押した所に出る・縁の近く・書きかけを失わない）は、開発の画面と Windows の確かめ
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MenuEntry } from '../src/panels/cell-menu';
import { ASK_LABEL, boardMenuEntries, type BoardMenuInput, oldestCardText, selectedRowLabel, TEMPLATE_ADD_LABEL, TEMPLATE_CENTER_HEADING, TEMPLATE_HERE_HEADING, WRITE_CARD_LABEL, WRITE_HERE_HINT, WRITE_HERE_LABEL } from '../src/memo-card-board-menu';
import type { Reply } from '../src/threads';
import { code } from './helpers';
import { unwrapT } from './source-text';

const tab = unwrapT(readFileSync(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const member = (name: string) => {
  const start = tab.indexOf(`\n  private ${name}(`) >= 0 ? tab.indexOf(`\n  private ${name}(`) : tab.indexOf(`\n  private async ${name}(`);
  if (start < 0) throw new Error(`${name} が無い`);
  const end = tab.indexOf('\n  }\n', start);
  return tab.slice(start, end);
};
const count = (s: string, part: string) => s.split(part).length - 1;
const labels = (entries: MenuEntry[]) => entries.map((e) => (e === 'sep' ? '—' : 'label' in e ? e.label : 'row' in e ? e.row : 'section' in e ? e.section : '?'));

describe('空きのメニューの中身（boardMenuEntries）', () => {
  const boardMenu = (over: Partial<BoardMenuInput>) => boardMenuEntries({ where: 'stage', write: () => undefined, template: null, selected: null, tidy: null, ...over });
  const item = (e: MenuEntry | undefined) => {
    if (!e || e === 'sep' || !('label' in e)) throw new Error('項目でない');
    return e;
  };
  it('1 項目目は「ここに書く」。見出しは置かない。押すと write', () => {
    const ran: string[] = [];
    const entries = boardMenu({ write: () => void ran.push('write') });
    expect(labels(entries)).toEqual(['ここに書く']);
    expect(WRITE_HERE_LABEL).toBe('ここに書く');
    expect(item(entries[0]).disabled).toBeFalsy();
    item(entries[0]).run?.();
    expect(ran).toEqual(['write']);
  });
  it('2 項目目は「型を足す…」（TA5）。型の口が無ければ（template が null）出さない', () => {
    const ran: string[] = [];
    const entries = boardMenu({ write: () => void ran.push('write'), template: () => void ran.push('template') });
    expect(labels(entries)).toEqual(['ここに書く', '型を足す…']);
    expect(item(entries[1]).label).toBe(TEMPLATE_ADD_LABEL);
    item(entries[1]).run?.();
    expect(ran).toEqual(['template']);
  });
  it('題の帯から：1 項目目は「カードを書く」（小さい字 Enter）。型の見出しの字', () => {
    const entries = boardMenu({ where: 'bar', template: () => undefined });
    expect(labels(entries)).toEqual(['カードを書く', '型を足す…']);
    expect(item(entries[0]).label).toBe(WRITE_CARD_LABEL);
    expect(item(entries[0]).hint).toBe('Enter');
    expect(item(boardMenu({})[0]).hint).toBe('ダブルクリック'); // 空きのダブルクリックでも同じ動き（TA7）
    expect(WRITE_HERE_HINT).toBe('ダブルクリック');
    expect(TEMPLATE_HERE_HEADING).toBe('ここに型を足す');
    expect(TEMPLATE_CENTER_HEADING).toBe('真ん中に型を足す');
  });
  it('下の行（TA6）：選びがあれば「選んだ n 枚」［Grok に頼む］、消えたカードの位置があれば「整理」（小さい字 n 件）。区切りは、どちらかがあるときだけ', () => {
    const ran: string[] = [];
    const both = boardMenu({ template: () => undefined, selected: { n: 3, title: '説明', ask: () => void ran.push('ask') }, tidy: { n: 2, run: () => void ran.push('tidy') } });
    expect(labels(both)).toEqual(['ここに書く', '型を足す…', '—', '選んだ3枚', '整理']);
    const row = both[3];
    if (row === 'sep' || !('row' in row)) throw new Error('行でない');
    expect(row.buttons.map((b) => ({ label: b.label, title: b.title, close: b.close }))).toEqual([{ label: 'Grok に頼む', title: '説明', close: true }]);
    expect(ASK_LABEL).toBe('Grok に頼む');
    expect(selectedRowLabel(12)).toBe('選んだ12枚');
    row.buttons[0].run();
    expect(item(both[4]).hint).toBe('2 件');
    expect(item(both[4]).disabled).toBeFalsy();
    item(both[4]).run?.();
    expect(ran).toEqual(['ask', 'tidy']);
    expect(labels(boardMenu({ selected: { n: 1, title: '', ask: () => undefined } }))).toEqual(['ここに書く', '—', '選んだ1枚']);
    expect(labels(boardMenu({ where: 'bar', tidy: { n: 5, run: () => undefined } }))).toEqual(['カードを書く', '—', '整理']);
    expect(labels(boardMenu({ template: () => undefined }))).toEqual(['ここに書く', '型を足す…']); // 条件が合わない行は出さない（区切りも）
  });
  it('「型にする」の名前の元（空きから）：登録するカードのうち、作った順でいちばん古いカードの文', () => {
    const reply = (id: string, createdAt: number, text: string): Reply => ({ id, parent: null, text, createdAt });
    const rs = [reply('c', 30, '三番'), reply('a', 10, '一番'), reply('b', 20, '二番'), reply('d', 20, '二番の後')];
    expect(oldestCardText(rs, ['a', 'b', 'c'])).toBe('一番');
    expect(oldestCardText(rs, ['c', 'b'])).toBe('二番');
    expect(oldestCardText(rs, ['d', 'b'])).toBe('二番'); // 同じ時刻なら id の小さい方
    expect(oldestCardText(rs, ['x'])).toBe('');
    expect(oldestCardText(rs, [])).toBe('');
  });
});

describe('空きの右クリックの配線（字面。TA4b）', () => {
  const press = member('onContextMenu');
  it('受け口：替えるのは 2 行だけ。カードが無ければ、縁のすぐ外のカード → 空きのメニュー。あとの 2 行は今のまま', () => {
    expect(press).toContain("const id = target?.closest<HTMLElement>('.memo-board-card')?.dataset.card ?? this.cardNearPoint(e, target);");
    expect(press).toMatch(/if \(!id\) \{\s*this\.openBoardMenu\(e, target\);[^\n]*\n\s*return;\s*\}/);
    expect(press).toContain('if (!this.selected.has(id)) this.setSelected(new Set([id]));');
    expect(press).toContain('this.openCardMenu(id, e.clientX, e.clientY, null);');
    // 線・キーのメニュー・つまむ途中・線を引く途中の枝は、空きの枝より前（今の順のまま）
    for (const s of ['if (this.drag || this.marquee || this.pan) return;', 'if (this.linkFrom !== null) {', 'if (isKeyboardMenu(e)) {', 'const line = lineOfHit(target);']) expect(press.indexOf(s), s).toBeLessThan(press.indexOf('this.cardNearPoint(e, target)'));
    expect(press.indexOf('this.cardNearPoint(e, target)')).toBeGreaterThan(-1);
  });
  it('縁のすぐ外を見るのは、面の中だけ（題の帯・道具の列では見ない）。幅と離れは形ごとの口（geo）', () => {
    const near = member('cardNearPoint');
    expect(near).toContain('if (!target || !this.stage.contains(target)) return null;');
    expect(near).toContain('return cardNear(this.pos, this.boardPoint(e), this.geo.outside, this.geo.near);');
    expect(member('boardPoint')).toContain('return screenToBoard(this.view, e.clientX - rect.left, e.clientY - rect.top);');
  });
  it('空きのメニュー：面の中なら、押した所を置き場（左上）と角（押した点）にして、押した所に開く。題の帯の中なら、押した所の無い形で（TA5）。ほかは何も出さない', () => {
    const open = member('openBoardMenu');
    expect(open).toContain('if (!target) return;');
    expect(open).toContain('if (this.stage.contains(target)) {');
    expect(open).toContain("this.showBoardMenu(e.clientX, e.clientY, { kind: 'point', at: pointSpot(p, this.geo.box), corner: p });");
    expect(open).toContain("} else if (target.closest('.memo-board-bar')) this.showBoardMenu(e.clientX, e.clientY, { kind: 'center' });");
    expect(open.indexOf('this.stage.contains(target)')).toBeLessThan(open.indexOf(".closest('.memo-board-bar')"));
  });
  it('開く所は 1 つ：見るメモと命令の口があるときだけ。開くだけでは何も書かない。帯の「カードを書く」は focusCompose（openCompose を直に呼ばない）', () => {
    const show = member('showBoardMenu');
    expect(show).toContain('if (!this.cmds || !this.memoId || !snap) return;');
    expect(show).toContain("where: from.kind === 'point' ? 'stage' : 'bar',");
    expect(show).toContain("write: from.kind === 'point' ? () => this.writeHere(from.at) : () => void this.focusCompose(),");
    expect(show).toContain('template: this.cmds.template ? () => void this.openTemplateTier(from, { x, y }, () => this.showBoardMenu(x, y, from)) : null,'); // ← 戻る は、同じ所に空きのメニューを開き直す
    for (const s of ['this.ask(', 'saveBoard(', 'this.setPending(', 'this.touchView(', 'this.setSelected(', 'menuAnchor', 'this.openCompose(']) expect(code(show), s).not.toContain(s);
  });
  it('下の行（TA6）：［Grok に頼む］は道具の列と同じ入口（askSelected）と同じ説明の字。「整理」は今の openTidy で、書く欄が開いている間は出さない', () => {
    const show = member('showBoardMenu');
    expect(show).toContain('const picked = this.selected.size;');
    expect(show).toContain('const orphans = this.composing === null ? tidyButton({ load: this.loaded, replies: snap.replies, busy: this.undoBusy }).count : 0;');
    expect(show).toContain('selected: BOT_FEATURES && picked > 0 ? { n: picked, title: ASK_SELECTED_NOTE, ask: () => this.askSelected() } : null,');
    expect(show).toContain('tidy: orphans > 0 ? { n: orphans, run: () => this.openTidy() } : null,');
    expect(tab).toContain("const askNote = this.selected.size === 0 ? '先にカードを選んでください' : ASK_SELECTED_NOTE;");
    expect(count(tab, '選んだカードを材料にして、依頼の小窓を開きます（直接つながるカードは印を外して足します）')).toBe(1); // 説明の字は 1 か所（定数）
  });
  it('型の段（閉じている道）：一覧を読んだあと、形を替えた・つまむ／範囲選択／面の移動の途中・線を引く途中なら、何もしない。見出しは開いた所ごと', () => {
    const open = member('openTemplateTier');
    const closed = 'if (!wasOpen && (this.shape !== shape || this.drag || this.marquee || this.pan || this.linkFrom !== null)) return;';
    expect(open).toContain(closed);
    expect(open.indexOf('const shape = this.shape;')).toBeLessThan(open.indexOf('await hook.list()'));
    expect(open.indexOf('await hook.list()')).toBeLessThan(open.indexOf(closed));
    expect(open.indexOf(closed)).toBeLessThan(open.indexOf('menu.open(at.x, at.y, entries);'));
    expect(open).toContain("const heading = from.kind === 'point' ? TEMPLATE_HERE_HEADING : from.kind === 'center' ? TEMPLATE_CENTER_HEADING : reply ?");
    expect(open).toContain('gone: cardId !== null && !reply,');
    expect(open).toContain('pick: (t) => this.pickTemplate(t, from),');
    expect(member('pickTemplate')).toContain('this.pasteOnBoard(t, [], from);');
  });
  it('「ここに書く」：足す欄が開いていれば字を残して置き場だけ替える。ほかの欄・確かめが開いていれば一言で止める。どれも無ければ足す欄を開き、開けたときだけ置き場を入れる', () => {
    const write = member('writeHere');
    const order = ["if (this.composing?.kind === 'add') this.composeAt = at;", "else if (this.modalOpen) this.flash('開いている欄や確かめを閉じてから書いてください', 'info');", "this.openCompose({ kind: 'add' }, '');", 'if (!this.compose.hidden) this.composeAt = at;', 'if (!this.compose.hidden) this.composeText.focus();'].map((s) => write.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const s of ['this.closeCompose(', 'this.composeText.value =', 'this.cancelLink(', 'this.closeTidy(', 'this.closeTemplate(']) expect(code(write), s).not.toContain(s); // 書きかけ・確かめを閉じない
  });
  it('置き場の覚えを消す所は 3 つ：書く欄を閉じる・入れ替える（頭で）・形を替える', () => {
    expect(count(code(tab), 'this.composeAt = null;')).toBe(3);
    const show = member('showCompose');
    expect(show.indexOf('this.composeAt = null;')).toBeGreaterThan(-1);
    expect(show.indexOf('this.composeAt = null;')).toBeLessThan(show.indexOf('this.composing = mode;'));
    expect(member('closeCompose')).toContain('this.composeAt = null;');
    expect(member('setShape')).toContain('this.composeAt = null;');
    expect(count(code(tab), 'this.composeAt = at;')).toBe(2); // 入れるのは writeHere の 2 か所だけ
  });
  it('足す：置き場の覚えを addSpot の at に渡す（覚えが無ければ今のまま）', () => {
    expect(member('submitAdd')).toContain('const spot = addSpot({ at: this.composeAt ?? undefined, dir, anchor, last,');
  });
  it('空きのダブルクリック（TA7）：面の pointerup の空きの枝で数える。線をやめる押し・線の当たり・メニューを閉じるための押し・動かした押しは数えない', () => {
    const start = tab.indexOf("this.stage.addEventListener('pointerup', (e) => {");
    const up = tab.slice(start, tab.indexOf("this.stage.addEventListener('pointercancel'", start));
    expect(up).toContain('const plain = this.linkFrom === null && !p.line && !p.menu;');
    expect(up.indexOf('const plain = ')).toBeLessThan(up.indexOf('this.cancelLink();')); // 線を引く途中かは、やめる前に見る
    expect(up.indexOf('else this.setSelected(new Set());')).toBeLessThan(up.indexOf('this.tapEmpty(e, plain);')); // 選びを外すのは今のまま（1 回目でも 2 回目でも）
    expect(up).toContain('} else this.lastEmptyTap = null;');
    expect(tab).toContain('menu: this.menu?.isOpen === true };'); // 押した時にメニューが開いていたか（pan の控え）
  });
  it('数える所（tapEmpty）：命令の口が無い・欄や確かめが開いている・縁のすぐ外では数えない。ダブルクリックなら「ここに書く」と同じ動き（メニューは開かない）', () => {
    const tapFn = member('tapEmpty');
    expect(tapFn).toMatch(/if \(!plain \|\| !this\.cmds \|\| this\.modalOpen \|\| this\.cardNearPoint\(e, this\.stage\) !== null\) \{\s*this\.lastEmptyTap = null;\s*return;\s*\}/);
    expect(tapFn).toContain('const tap = emptyTap(this.lastEmptyTap, { x: e.clientX, y: e.clientY, t: Date.now() }, PEEK_DOUBLE_MS);');
    expect(tapFn).toContain('this.lastEmptyTap = tap.next;');
    expect(tapFn).toContain('if (tap.double) this.writeHere(pointSpot(this.boardPoint(e), this.geo.box));');
    for (const s of ['.open(', 'this.openCompose(', 'this.setSelected(']) expect(code(tapFn), s).not.toContain(s);
  });
  it('メモを替えたら、空きのダブルクリックも数え直す', () => {
    const refresh = tab.slice(tab.indexOf('const changed = snap.memoId !== this.memoId;'), tab.indexOf('this.memoId = snap.memoId;'));
    expect(refresh).toContain('this.clicks.reset();');
    expect(refresh).toContain('this.lastEmptyTap = null;');
  });
  it('受け口は足さない（dblclick・面の click）。メニューを作る所も増やさない', () => {
    expect(tab).not.toContain("addEventListener('dblclick'");
    expect(tab).not.toMatch(/stage\.addEventListener\('click'/);
    expect(count(code(tab), 'new CellMenu(')).toBe(1);
    expect(count(tab, "this.root.addEventListener('contextmenu', (e) => this.onContextMenu(e));")).toBe(1);
  });
});
