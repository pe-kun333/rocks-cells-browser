// 棚の「ポータル」PT2 の配線（ソースの形）の確かめ（docs/plan-portal-cells.md §4.2）
//   ポータルのマスは reservedIn でふさぐ。元の場所へ戻すタブはポータルを見ない。シートを消したら外す（アーカイブでは残す）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unwrapT } from './source-text';

const read = (path: string) => unwrapT(readFileSync(new URL(path, import.meta.url), 'utf8'));
const primary = read('../src/app/primary.ts');
const count = (text: string, part: string) => text.split(part).length - 1;
const bodyOf = (text: string, start: string) => {
  const from = text.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  const rest = text.slice(from + start.length);
  const next = rest.search(/\n  (?:\/\/ |function |async function )/);
  return rest.slice(0, next < 0 ? rest.length : next);
};
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from, to);
};

describe('primary.ts：ポータルのマスをふさぐ', () => {
  it('WaypointStore を 1 つだけ作り、reservedIn より前（sheetSlots のそば）に置く', () => {
    expect(count(primary, 'new WaypointStore(')).toBe(1);
    const made = primary.indexOf('const waypoints = new WaypointStore();');
    expect(made).toBeGreaterThan(primary.indexOf('const sheetSlots = new BoardSheetSlots();'));
    expect(made).toBeLessThan(primary.indexOf('store.blocked = (h, sheet) =>'));
    expect(made).toBeLessThan(primary.indexOf('function reservedIn(sheet: string): Hex[] {'));
    expect(primary).toContain('waypoints.setExists((id) => !!sheets.get(id));');
  });
  it('reservedIn は予約に加えて、keepPlaceNow が偽のときだけポータルのマスを返す', () => {
    const body = bodyOf(primary, 'function reservedIn(sheet: string): Hex[] {');
    expect(body).toContain('waypoints.hexes(sheet)');
    expect(body).toContain('keepPlaceNow');
    expect(body).toMatch(/return keepPlaceNow \? held : \[\.\.\.held, \.\.\.waypoints\.hexes\(sheet\)\];/);
  });
  it('withKeepPlace は入る前の値を finally で戻す', () => {
    expect(primary).toContain('let keepPlaceNow = false;');
    const body = bodyOf(primary, 'function withKeepPlace<T>(fn: () => T): T {');
    expect(body).toContain('const before = keepPlaceNow;');
    expect(body).toContain('keepPlaceNow = true;');
    expect(body).toMatch(/finally \{\s*keepPlaceNow = before;/);
  });
});

describe('primary.ts：元の場所へ戻すタブはポータルを見ない', () => {
  it('keepPlace を付けるのは 3 か所だけ（起動の並べ・アーカイブを戻す・開き直す〈元のシートのときだけ〉）', () => {
    expect(count(primary, 'keepPlace: true')).toBe(2);
    expect(count(primary, 'keepPlace: sheet === item.sheet')).toBe(1);
    const hello = bodyOf(primary, 'function handleHello(');
    const saved = hello.slice(hello.indexOf('for (const t of saved.tabs) {'));
    expect(saved.slice(0, saved.indexOf('createTab()'))).toContain('keepPlace: true');
    expect(bodyOf(primary, 'async function restoreArchive(')).toContain('keepPlace: true');
    expect(bodyOf(primary, 'function reopenClosed(')).toContain('keepPlace: sheet === item.sheet');
  });
  it('requestTab：元の場所が空いているときだけポータルを見ずに置き、ふさがっていればふつうの置き方に戻す', () => {
    expect(primary).toMatch(/keepPlace\?: boolean;/);
    const body = bodyOf(primary, 'function requestTab(');
    expect(body).toContain('const keepPlace = !!options.keepPlace && !!home && !withKeepPlace(() => isTaken(home, sheet));');
    expect(body).toContain('if (!keepPlace && pos && isTaken(pos, sheet)) pos = nearestFree(pos, (h) => isTaken(h, sheet));');
    expect(body).toContain('pending.set(requestId, { ...options, sheet, pos, keepPlace });');
  });
  it('tabCreated：keepPlace の Pending のときは store.add を withKeepPlace の中で呼ぶ', () => {
    const body = between(primary, "case 'tabCreated': {", "case 'tabUpdated':");
    expect(body).toContain('const add = () => store.add(msg.id, {');
    expect(count(body, 'store.add(')).toBe(1);
    expect(body).toMatch(/if \(info\?\.keepPlace\) withKeepPlace\(add\);[^\n]*\n\s*else add\(\);/);
  });
  it('UI だけが読み込み直されたとき：store.add の for 全体を withKeepPlace で包む', () => {
    const body = bodyOf(primary, 'function handleHello(');
    const wrapped = between(body, 'withKeepPlace(() => {', '\n      });');
    expect(wrapped).toMatch(/^withKeepPlace\(\(\) => \{\s*for \(const \{ id, \.\.\.info \} of \[\.\.\.msg\.tabs\]/);
    expect(wrapped).toContain('store.add(id, {');
    expect(wrapped).toContain('store.update(id, info);');
    expect(count(body, 'store.add(')).toBe(1);
  });
});

describe('primary.ts：シートの寿命', () => {
  it('removeSheet：消したときだけ外す（アーカイブでは残す）', () => {
    const body = bodyOf(primary, 'function removeSheet(');
    expect(body).toContain("if (done === 'removed') waypoints.dropSheet(id, sessionWritable);");
    expect(count(body, 'dropSheet(')).toBe(1);
  });
  it('unpackSheet：出した元のシートのポータルを数えてから外し、知らせに足す', () => {
    const body = bodyOf(primary, 'function unpackSheet(');
    const counted = body.indexOf('const droppedWaypoints = waypoints.list(target).length;');
    expect(counted).toBeGreaterThan(-1);
    expect(counted).toBeLessThan(body.indexOf('sheets.remove(target);'));
    // 「撮ったもの」は sheets.remove が断るので、消えたときだけ外し、外したときだけ知らせに足す
    expect(body).toMatch(/sheets\.remove\(target\);\s*(?:\/\/.*\s*)?const waypointsDropped = !sheets\.get\(target\) && waypoints\.dropSheet\(target, sessionWritable\);/);
    expect(body).toContain("waypointsDropped && droppedWaypoints > 0 ? tr('（ポータル {0} 個は外しました）', { 0: droppedWaypoints }) :");
  });
  it('dropEmptySheet：消す所で外す。空の判定は今のまま', () => {
    const body = between(primary, "case 'dropEmptySheet': {", "case 'showRightSheet':");
    expect(body).toMatch(/if \(empty\) \{\s*sheets\.remove\(id\);\s*waypoints\.dropSheet\(id, sessionWritable\);/);
    expect(body).not.toContain('waypoints.list(');
    expect(body).not.toContain('waypoints.hexes(');
  });
  it('アーカイブの一覧の「消す」：盤面に無く、同じシートのアーカイブがほかに無いときだけ外す', () => {
    const body = between(primary, 'deleteArchive(meta.id);', 'render();');
    // 外す判定は list から消した後（先だと、消す行そのものに当たって外れない）
    expect(body).toMatch(/list\.splice\(list\.indexOf\(meta\), 1\);[\s\S]*if \(!sheets\.get\(meta\.sheet\.id\) && !list\.some\(\(m\) => m\.sheet\.id === meta\.sheet\.id\)\) waypoints\.dropSheet\(meta\.sheet\.id, sessionWritable\);/);
  });
  it('archiveSheet の中（取りやめの片づけ）では外さない', () => {
    expect(bodyOf(primary, 'async function archiveSheet(')).not.toContain('dropSheet(');
  });
  it('dropSheet を呼ぶのは 4 か所だけ。sheets.remove( の数は今のまま（4）', () => {
    expect(count(primary, 'waypoints.dropSheet(')).toBe(4);
    expect(count(primary, 'sheets.remove(')).toBe(4);
  });
  it('startSessionSaving で書かなかった分を書く', () => {
    expect(bodyOf(primary, 'function startSessionSaving(')).toContain('waypoints.flush();');
  });
  it('ほかの窓が書いたら読み直す（鍵が同じか null のとき）', () => {
    expect(primary).toMatch(
      /window\.addEventListener\('storage', \(e\) => \{\s*if \(e\.key === WAYPOINT_STORE_KEY \|\| e\.key === null\) waypoints\.reload\(\);/,
    );
  });
});

// PT3a：盤面と小窓にポータルを描く（docs/plan-portal-cells.md §4.3）
const sidebar = read('../src/sidebar.ts');
const mainTs = read('../src/main.ts');
const waypointsCss = read('../src/waypoints.css');

describe('sidebar.ts：盤面にポータルを描く', () => {
  it('setWaypoints で口を覚えて描き直しを頼む。既定は空', () => {
    expect(sidebar).toMatch(/private waypointsOf: \(sheet: string\) => readonly \{ slot: number; hex: Hex \}\[\] = \(\) => \[\];/);
    const body = between(sidebar, 'setWaypoints(get: (sheet: string) => readonly { slot: number; hex: Hex }[]) {', '\n  }');
    expect(body).toContain('this.waypointsOf = get;');
    expect(body).toContain('this.requestRender();');
  });
  it('セルの無いポータルの層は gridPath の直後。under の層はタブを描く for の後・ドラッグの前', () => {
    const body = between(sidebar, 'private renderBoard() {', 'this.svg.replaceChildren(world);');
    const grid = body.indexOf('world.append(this.gridPath());');
    const open = body.indexOf('const openWaypoints = this.waypointLayer(');
    expect(grid).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(grid);
    expect(body.slice(grid + 'world.append(this.gridPath());'.length, open)).not.toContain('world.append(');
    expect(open).toBeLessThan(body.indexOf('for (const island of this.islands)'));
    // 層を足す行も、層を作る行のすぐ後（島・セルより前）
    const openAppend = body.indexOf('if (openWaypoints) world.append(openWaypoints);');
    expect(openAppend).toBeGreaterThan(open);
    expect(openAppend).toBeLessThan(body.indexOf('const tabs = this.tabsHere();'));
    const tabsLoop = body.indexOf('for (const tab of tabs) {');
    const under = body.indexOf('const coveredWaypoints = this.waypointLayer(');
    const dragged = body.indexOf('const dragged = drag && this.store.get(drag.id);');
    expect(tabsLoop).toBeGreaterThan(-1);
    expect(under).toBeGreaterThan(tabsLoop);
    expect(under).toBeLessThan(dragged);
    const underAppend = body.indexOf('if (coveredWaypoints) world.append(coveredWaypoints);');
    expect(underAppend).toBeGreaterThan(under);
    expect(underAppend).toBeLessThan(dragged);
    // セルがあるかは、このシートのタブとメモの両方で見る。空いたマスは顔、セルのあるマスは under
    expect(body).toContain('const tab = this.store.tabAt(h, this.sheet);');
    expect(body).toContain('const memo = this.memos.at(h, this.sheet);');
    expect(body).toContain("return (!!tab && !(lifted?.kind === 'cell' && lifted.id === tab.id)) || (!!memo && !(lifted?.kind === 'memo' && lifted.id === memo.id));");
    expect(body).toContain('this.waypointLayer(waypoints.filter((w) => !covered(w.hex)), false);');
    expect(body).toContain('this.waypointLayer(waypoints.filter((w) => covered(w.hex)), true);');
    expect(body).toContain('this.waypointsOf(this.sheet)');
  });
  it('waypointLayer：無いときは層を足さない。番号は slot + 1、title は顔だけ、data-id・data-memo は付けない', () => {
    const body = between(sidebar, 'private waypointLayer(', '// 画面に見えている範囲だけ');
    expect(body).toContain('if (list.length === 0) return null;');
    expect(body).toContain('String(slot + 1)');
    expect(body).toContain("svgEl('g', { class: 'waypoint', 'data-waypoint': n })");
    expect(body).toContain("svgEl('g', { class: 'waypoint under' })");
    expect(body).toContain("tr('ポータル {0}（右クリックで操作）', { 0: n })");
    expect(count(body, "svgEl('title'")).toBe(1);
    expect(body).not.toMatch(/data-id|data-memo/);
  });
  it('空いたマスのダブルクリック：createAt の前にポータルのマスを外す', () => {
    const at = sidebar.indexOf('this.actions.createAt(hex);');
    expect(at).toBeGreaterThan(-1);
    const before = sidebar.slice(sidebar.lastIndexOf('const hex = pixelToHex(w.x, w.y, CELL);', at), at);
    expect(before).toMatch(/if \(this\.waypointsOf\(this\.sheet\)\.some\(\(p\) => hexKey\(p\.hex\) === hexKey\(hex\)\)\) return;/);
  });
});

describe('primary.ts：本の盤面と入口の小窓へ渡す', () => {
  it('sidebar.setWaypoints と peekBoard?.setWaypoints を呼び、小窓を作る所でも渡す', () => {
    expect(primary).toContain('const waypointsOf = (sheet: string) => waypoints.list(sheet);');
    // 起動時に 1 回、waypoints が変わるたびに onChange の中で 1 回
    expect(count(primary, 'sidebar.setWaypoints(waypointsOf);')).toBe(2);
    expect(primary.indexOf('sidebar.setWaypoints(waypointsOf);')).toBeLessThan(primary.indexOf('waypoints.onChange(() => {'));
    const wired = between(primary, 'waypoints.onChange(() => {', '\n  });');
    expect(wired).toContain('sidebar.setWaypoints(waypointsOf);');
    expect(wired).toContain('peekBoard?.setWaypoints(waypointsOf);');
    expect(between(primary, 'makeBoard: (root, previewOpts) => {', 'return peekBoard;')).toContain('peekBoard.setWaypoints(waypointsOf);');
  });
  it('sidebarDeps の本体に waypoints は入れない', () => {
    const deps = between(primary, 'const sidebarDeps: SidebarDeps = {', '\n  };');
    expect(deps).not.toContain('waypoint');
  });
});

describe('main.ts と waypoints.css', () => {
  it('waypoints.css を data-colors.css より前に読む', () => {
    const css = mainTs.indexOf("import './waypoints.css';");
    expect(css).toBeGreaterThan(-1);
    expect(css).toBeLessThan(mainTs.indexOf("import './data-colors.css';"));
  });
  it('.waypoint の規則があり、under は pointer-events: none', () => {
    expect(waypointsCss).toMatch(/\.waypoint-hex \{/);
    expect(waypointsCss).toMatch(/\.waypoint\.under \{\s*pointer-events: none;\s*\}/);
    expect(waypointsCss).not.toMatch(/\.cell\b/);
  });
});

// PT3b：ポータルのメニュー（置く・動かす・番号を替える・外す・まん中へ。docs/plan-portal-cells.md §4.3・§9.2）
describe('primary.ts：openCellMenu のポータルの分岐', () => {
  it('ポータルのメニューの分岐は、特別なセルの 4 つの分岐より後・entries を組むより前', () => {
    const menu = bodyOf(primary, 'function openCellMenu(');
    const mine = menu.indexOf('openWaypointMenu(waypointSlot, info.x, info.y);');
    expect(mine).toBeGreaterThan(-1);
    for (const branch of ['openPortalMenu', 'openBotMenu', 'openAppMenu', 'openCaptureMenu']) {
      const at = menu.search(new RegExp(`${branch}\\(portal, info\\);\\s*return;`));
      expect(at, branch).toBeGreaterThan(-1);
      expect(at).toBeLessThan(mine);
    }
    expect(mine).toBeLessThan(menu.indexOf('const entries: MenuEntry[] = [];'));
    // セルを押していないときだけ。小窓のセルのマスでは引かない。変数は portal と別の名前
    expect(menu).toContain('const waypointHex = info.hex ? (clickedTab?.pos ?? clickedMemo?.pos ?? info.hex) : null;');
    expect(menu).toContain('const waypointSlot = waypointHex && !offSheet ? waypoints.slotAt(sheets.current, waypointHex) : -1;');
    expect(menu).toMatch(/if \(info\.id === null && info\.memo === null && waypointSlot >= 0\) \{\s*openWaypointMenu\(waypointSlot, info\.x, info\.y\);\s*return;\s*\}/);
  });
  it('セルのメニュー：ふつうのセルの段の終わりに「ポータル n ▸」を 1 行（sheetJumpEntries より前）', () => {
    const menu = bodyOf(primary, 'function openCellMenu(');
    const cell = between(menu, 'entries.push({ section: total > 1 ?', '} else {');
    const row = cell.indexOf("entries.push({ label: tr('ポータル {0} ▸', { 0: slot + 1 }), run: () => openWaypointMenu(slot, info.x, info.y) });");
    expect(row).toBeGreaterThan(cell.indexOf("label: 'Ctrl+クリックで選び足す・Shift+クリックで範囲'"));
    expect(cell).toMatch(/if \(waypointSlot >= 0\) \{\s*const slot = waypointSlot;/);
    expect(count(primary, "▸', { 0: slot + 1 }), run: () => openWaypointMenu(")).toBe(1);
  });
  it('空いたマスの「このセルに」：クリップボードの画像の行の後・アプリのセルの前。置く行は 6 つ未満のときだけ', () => {
    const menu = bodyOf(primary, 'function openCellMenu(');
    const empty = between(menu, "entries.push({ section: 'このセルに' });", 'pasteEntry = {');
    const clip = empty.indexOf('entries.push(clipEntry);');
    const put = empty.indexOf("label: 'ここにポータルを置く'");
    const move = empty.indexOf("label: 'ポータルをここへ動かす ▸'");
    const apps = empty.indexOf('entries.push(...appPlaceEntries(at, info.x, info.y));');
    expect(clip).toBeGreaterThan(-1);
    expect(put).toBeGreaterThan(clip);
    expect(move).toBeGreaterThan(put);
    expect(apps).toBeGreaterThan(move);
    expect(empty).toContain('const placed = waypoints.list(sheets.current).map((p) => p.slot);');
    expect(empty).toContain(
      "if (placed.length < WAYPOINT_SLOTS) entries.push({ label: 'ここにポータルを置く', hint: tr('{0} 番', { 0: freeWaypointSlot(placed) + 1 }), run: () => placeWaypoint(at) });",
    );
    expect(empty).toContain("if (placed.length > 0) entries.push({ label: 'ポータルをここへ動かす ▸', run: () => openWaypointMoveMenu(at, info.x, info.y) });");
    expect(count(primary, "'ここにポータルを置く'")).toBe(1);
  });
});

describe('primary.ts：ポータルのメニューと操作', () => {
  it('ポータルのメニュー：見出し・まん中へ（jumpToWaypoint）・番号を替える ▸・外す', () => {
    const body = bodyOf(primary, 'function openWaypointMenu(');
    expect(body).toContain("{ section: tr('ポータル {0}', { 0: slot + 1 }) },");
    expect(body).toContain("{ label: 'まん中へ', run: () => jumpToWaypoint(slot) },");
    expect(body).toContain("{ label: '番号を替える ▸', run: () => openWaypointSlotMenu(slot, x, y) },");
    expect(body).toContain("{ label: '外す', hint: '置き直せます', run: () => removeWaypoint(slot) },");
  });
  it('番号のメニュー：見出し・1〜6 番。今の番号は押せない。入れ替え・空き', () => {
    const body = bodyOf(primary, 'function openWaypointSlotMenu(');
    expect(body).toContain("{ section: tr('ポータル {0} の番号', { 0: slot + 1 }) }");
    expect(body).toContain('const used = waypoints.list(sheets.current).map((p) => p.slot);');
    expect(body).toContain('waypointSlotRows(slot, used)');
    expect(body).toContain("const label = tr('{0} 番', { 0: row.slot + 1 });");
    expect(body).toContain("if (row.state === 'current') entries.push({ label, disabled: true });");
    expect(body).toContain("hint: row.state === 'used' ? '入れ替え' : '空き', run: () => renumberWaypoint(slot, row.slot)");
  });
  it('動かす先を選ぶメニュー：見出しと、あるポータルだけの行', () => {
    const body = bodyOf(primary, 'function openWaypointMoveMenu(');
    expect(body).toContain("{ section: 'どのポータルをここへ動かすか' }");
    expect(body).toContain("for (const p of waypoints.list(sheets.current)) entries.push({ label: tr('ポータル {0}', { 0: p.slot + 1 }), run: () => moveWaypointHere(p.slot, at) });");
  });
  it('jumpToWaypoint：一覧の表示と書きかけを見てから sidebar.centerOn。番号が無ければ何もしない', () => {
    const body = bodyOf(primary, 'function jumpToWaypoint(');
    const none = body.indexOf('if (!hex) return;');
    const large = body.indexOf("if (prefs.mode === 'large') {");
    const busy = body.indexOf('if (editorsBusy()) {');
    const center = body.indexOf('sidebar.centerOn(hex);');
    expect(none).toBeGreaterThan(-1);
    expect(large).toBeGreaterThan(none);
    expect(busy).toBeGreaterThan(large);
    expect(center).toBeGreaterThan(busy);
    expect(body).toContain("toast('一覧の表示のあいだは使えません（盤面の表示で使えます）');");
    expect(body).toContain("toast('書きかけの欄を「残す」か「やめる」で閉じてから押してください');");
    expect(count(body, 'sidebar.centerOn(')).toBe(1);
    expect(body).toContain('const hex = waypoints.list(sheets.current).find((p) => p.slot === slot)?.hex;');
    expect(body).toMatch(/toast\('一覧の表示のあいだは使えません（盤面の表示で使えます）'\);\s*return;/);
    expect(body).toMatch(/toast\('書きかけの欄を「残す」か「やめる」で閉じてから押してください'\);\s*return;/);
  });
  it('置けるかは waypointPlaceBlock で見る（読み込み・ふさがり・新しい版・数）。理由ごとの知らせ', () => {
    const body = bodyOf(primary, 'function waypointBlockNote(');
    expect(body).toContain('ready: sessionReady && memos.ready,');
    expect(body).toContain('taken: isTaken(hex, sheet),');
    expect(body).toContain('const sheet = sheets.current;');
    expect(body).toContain('locked: waypoints.locked,');
    expect(body).toContain('full: countFull && waypoints.list(sheet).length >= WAYPOINT_SLOTS,');
    expect(body).toContain("if (block === 'locked') return WAYPOINT_LOCKED_NOTE;");
    expect(body).toContain("if (block === 'loading') return '読み込みが終わってから置けます';");
    expect(body).toContain('if (block) return WAYPOINT_TAKEN_NOTE;');
    expect(primary).toContain("const WAYPOINT_LOCKED_NOTE = 'ポータルの記録が新しい版の形なので、変えられません';");
    expect(primary).toContain("const WAYPOINT_TAKEN_NOTE = 'そのマスには置けません（ふさがっています）';");
    expect(primary).toContain('const waypointFailNote = () => (waypoints.locked ? WAYPOINT_LOCKED_NOTE : WAYPOINT_TAKEN_NOTE);');
    expect(primary).toContain("const WAYPOINT_GONE_NOTE = 'そのポータルは、もうありません';");
  });
  it('置く・動かす・番号を替える・外す：今のシートに Date.now() で。知らせの字', () => {
    const place = bodyOf(primary, 'function placeWaypoint(');
    expect(place).toContain('waypointBlockNote(hex, true)');
    expect(place).toMatch(/const note = waypointBlockNote\(hex, true\);\s*if \(note\) \{\s*toast\(note\);\s*return;\s*\}/);
    expect(place).toContain('waypoints.place(sheets.current, hex, Date.now())');
    expect(place).toContain("toast(slot === null ? waypointFailNote() : tr('ポータル {0} を置きました（棚の「ポータル」から押すと、ここへ来ます）', { 0: slot + 1 }));");
    const move = bodyOf(primary, 'function moveWaypointHere(');
    expect(move).toContain('waypointBlockNote(hex, false)');
    expect(move).toMatch(/const note = waypointBlockNote\(hex, false\);\s*if \(note\) \{\s*toast\(note\);\s*return;\s*\}/);
    expect(move).toContain('waypoints.moveTo(sheets.current, slot, hex, Date.now())');
    expect(move).toContain("toast(moved ? tr('ポータル {0} をここへ動かしました', { 0: slot + 1 }) : waypointFailNote());");
    const renumber = bodyOf(primary, 'function renumberWaypoint(');
    expect(renumber).toContain('toast(WAYPOINT_LOCKED_NOTE);');
    expect(renumber).toContain('waypoints.setSlot(sheets.current, from, to, Date.now())');
    expect(renumber).toContain("if (done === 'swapped') toast(tr('ポータル {0} と {1} を入れ替えました', { 0: from + 1, 1: to + 1 }));");
    expect(renumber).toContain("else if (done === 'moved') toast(tr('ポータル {0} を {1} 番にしました', { 0: from + 1, 1: to + 1 }));");
    expect(renumber).toContain('else toast(waypointGoneNote());');
    const remove = bodyOf(primary, 'function removeWaypoint(');
    expect(remove).toContain('toast(WAYPOINT_LOCKED_NOTE);');
    expect(remove).toContain('waypoints.remove(sheets.current, slot, Date.now())');
    expect(remove).toContain("toast(removed ? tr('ポータル {0} を外しました', { 0: slot + 1 }) : waypointGoneNote());");
  });
});

describe('primary.ts：入口の小窓の空いたマスのメニュー', () => {
  it('のぞいているシートのポータルのマスでは「メモを書く」を出さず、押せない 1 行だけ', () => {
    const body = bodyOf(primary, 'function openPeekEmptyMenu(');
    expect(body).toContain('const waypointSlot = waypoints.slotAt(sheet, hex);');
    expect(body).toMatch(
      /waypointSlot >= 0\s*\? \[\{ section: plan\.heading \}, \{ label: tr\('ポータル \{0\} のマスです（このシートを開くと操作できます）', \{ 0: waypointSlot \+ 1 \}\), disabled: true \}\]\s*: \[\{ section: plan\.heading \}, \{ label: plan\.write\.label, run: \(\) => writeNewMemo\(hex, '', sheet, board, true\) \}\],/,
    );
    expect(body).not.toContain('openWaypointMenu');
    expect(count(body, 'writeNewMemo(')).toBe(1);
  });
});

// PT4：棚の札「ポータル」と番号のチップ（docs/plan-portal-cells.md §4.4・§9.2）
const prefsTs = read('../src/prefs.ts');

describe('prefs.ts：棚の欄に「ポータル」', () => {
  it('ShelfView の型と pick の並びの両方に waypoints。既定は downloads のまま', () => {
    expect(prefsTs).toMatch(/export type ShelfView = [^;]*'waypoints'[^;]*;/);
    expect(prefsTs).toMatch(/shelfView: pick\(saved\.shelfView, \[[^\]]*'waypoints'[^\]]*\], 'downloads'\),/);
    for (const v of ['downloads', 'closed', 'captures', 'sheets']) {
      expect(prefsTs).toMatch(new RegExp(`export type ShelfView = [^;]*'${v}'[^;]*;`));
      expect(prefsTs).toMatch(new RegExp(String.raw`shelfView: pick\(saved\.shelfView, \[[^\]]*'${v}'[^\]]*\], 'downloads'\),`));
    }
  });
});

describe('primary.ts：棚の札「ポータル」とチップ', () => {
  it('SHELF_VIEWS の頭が「ポータル」。札は 5 つ', () => {
    const views = between(primary, 'const SHELF_VIEWS: { id: ShelfView; label: string }[] = [', '];');
    expect(views).toMatch(/\[\s*\{ id: 'waypoints', label: 'ポータル' \},\s*\{ id: 'downloads', label: 'ダウンロード' \},/);
    expect(count(views, "{ id: '")).toBe(5);
  });
  it('renderShelf：waypoints の枝があり、最後の素の else はシートのまま', () => {
    const body = bodyOf(primary, 'function renderShelf() {');
    expect(body).toContain("if (prefs.shelfView === 'waypoints') {");
    expect(body).toContain('shelfItems.replaceChildren(...waypointChips());');
    expect(body).toMatch(/else if \(prefs\.shelfView === 'captures'\) shelfItems\.replaceChildren\(\.\.\.captureChips\(\)\);\s*else shelfItems\.replaceChildren\(\.\.\.sheetChips\(\)\);\s*shelfItems\.scrollLeft = 0;/);
  });
  it('renderShelf：waypointChipsKey で比べ、同じならチップの段を作り直さない。ほかの欄・たたんだときは覚えを消す', () => {
    expect(primary).toContain('let waypointChipsShown: string | null = null;');
    const body = bodyOf(primary, 'function renderShelf() {');
    expect(body).toMatch(/if \(!open\) \{\s*shelfItems\.replaceChildren\(\);\s*waypointChipsShown = null;\s*return;\s*\}/);
    expect(body).toMatch(
      /if \(prefs\.shelfView === 'waypoints'\) \{\s*\/\/[^\n]*\n\s*const key = \(waypoints\.locked \? 'locked\|' : ''\) \+ waypointChipsKey\(sheets\.current, waypoints\.list\(sheets\.current\)\.map\(\(p\) => p\.slot\)\);\s*if \(key !== waypointChipsShown\) \{\s*shelfItems\.replaceChildren\(\.\.\.waypointChips\(\)\);\s*shelfItems\.scrollLeft = 0;\s*waypointChipsShown = key;\s*\}\s*return;\s*\}\s*waypointChipsShown = null;\s*if \(prefs\.shelfView === 'downloads'\)/,
    );
    // 札の段は毎回作り直す（たたむ・欄の振り分けより前）
    expect(body.indexOf('shelfTabs.replaceChildren(')).toBeLessThan(body.indexOf('if (!open) {'));
  });
  it('waypointChips：今のシートの番号の順。押すと jumpToWaypoint、右クリックで openWaypointMenu。空の文と title', () => {
    const body = bodyOf(primary, 'function waypointChips(): HTMLElement[] {');
    expect(body).toContain('const list = waypoints.list(sheets.current);');
    expect(body).toContain(
      "if (list.length === 0) return [shelfEmpty('ポータルはまだありません（盤面の空いたマスを右クリック →「ここにポータルを置く」。シートごとに 6 つまで）')];",
    );
    expect(body).toContain("const chip = el('button', 'download-chip shelf-waypoint', String(slot + 1));");
    expect(body).toContain("chip.type = 'button';");
    expect(body).toContain("chip.title = tr('ポータル {0}。押すと盤面のまん中へ。右クリックで、ほかの操作', { 0: slot + 1 });");
    expect(body).toContain("chip.setAttribute('aria-label', chip.title);");
    expect(body).toContain("chip.addEventListener('click', () => jumpToWaypoint(slot));");
    expect(body).toMatch(/chip\.addEventListener\('contextmenu', \(event\) => \{\s*event\.preventDefault\(\);\s*openWaypointMenu\(slot, event\.clientX, event\.clientY\);/);
    // メニューの「まん中へ」も同じ jumpToWaypoint を通す
    expect(bodyOf(primary, 'function openWaypointMenu(')).toContain("{ label: 'まん中へ', run: () => jumpToWaypoint(slot) },");
  });
  it('描き直し：waypoints.onChange は waypoints の欄のとき、sheets.onChange は sheets か waypoints の欄のとき', () => {
    expect(primary).toMatch(/waypoints\.onChange\(\(\) => \{\s*if \(prefs\.shelfView === 'waypoints'\) renderShelf\(\);\s*\}\);/);
    expect(primary).toMatch(/sheets\.onChange\(\(\) => \{\s*if \(prefs\.shelfView === 'sheets' \|\| prefs\.shelfView === 'waypoints'\) renderShelf\(\);\s*\}\);/);
    // 棚の口は、棚の要素を作った後に付ける
    expect(primary.indexOf("if (prefs.shelfView === 'waypoints') renderShelf();")).toBeGreaterThan(primary.indexOf("const shelfItems = el('div', 'download-shelf-items');"));
  });
  it('置いた知らせに、棚から来られることを足す', () => {
    expect(bodyOf(primary, 'function placeWaypoint(')).toContain(
      "toast(slot === null ? waypointFailNote() : tr('ポータル {0} を置きました（棚の「ポータル」から押すと、ここへ来ます）', { 0: slot + 1 }));",
    );
  });
});

describe('waypoints.css：棚のチップ', () => {
  it('.download-chip.shelf-waypoint と :hover:not(:disabled) の規則。clip-path は疑似要素だけ', () => {
    expect(waypointsCss).toMatch(/\.download-chip\.shelf-waypoint \{/);
    expect(waypointsCss).toMatch(/\.download-chip\.shelf-waypoint:hover:not\(:disabled\) \{/);
    expect(waypointsCss).toMatch(/\.download-chip\.shelf-waypoint:hover:not\(:disabled\)::after \{\s*background: var\(--hover\);/);
    expect(waypointsCss).toMatch(/\.download-chip\.shelf-waypoint:focus-visible \{/);
    // clip-path を書く規則は、選択子がすべて ::before か ::after のものだけ
    for (const m of waypointsCss.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!m[2].includes('clip-path')) continue;
      for (const sel of m[1].split(',').map((t) => t.replace(/\/\*[\s\S]*?\*\//g, '').trim())) expect(sel).toMatch(/::(?:before|after)$/);
    }
    expect(waypointsCss).not.toMatch(/var\(--sheet/);
  });
  it('六角と番号が見えるための宣言', () => {
    // 選択子（コンマで分けて、空白を詰めた形）→ 中身
    const rules = new Map<string, string>();
    for (const m of waypointsCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      rules.set(m[1].split(',').map((t) => t.trim()).join(', '), m[2]);
    }
    const rule = (sel: string): string => {
      const body = rules.get(sel);
      expect(body, sel).toBeDefined();
      return body ?? '';
    };
    const chip = rule('.download-chip.shelf-waypoint');
    for (const d of ['position: relative;', 'isolation: isolate;', 'border-color: transparent;', 'background: transparent;', 'color: var(--accent-ink);']) expect(chip).toContain(d);
    const both = rule('.download-chip.shelf-waypoint::before, .download-chip.shelf-waypoint::after');
    for (const d of ['position: absolute;', 'z-index: -1;']) expect(both).toContain(d);
    expect(rule('.download-chip.shelf-waypoint::before')).toContain('background: var(--accent-line);');
    expect(rule('.download-chip.shelf-waypoint::after')).toContain('background: var(--surface);');
    expect(rule('.download-chip.shelf-waypoint:hover:not(:disabled)').trim()).toBe('background: transparent;');
    const focus = rule('.download-chip.shelf-waypoint:focus-visible');
    expect(focus).toContain('outline: 2px solid var(--accent-line);');
    expect(focus).not.toMatch(/outline:\s*none/);
  });
});
