// 段 HX4・HX5：正六角の顔と並び・六角のファイル。tab・六角の顔・CSS の配線を、ソースを読んで確かめる（ui には DOM の試験の環境が無い）
//   計算（並び・重なり・線・範囲選択・開き方・Shift＋矢印・geo の四角の答え）は memo-card-board-hex.test.ts、HX5 の計算（ファイルの決まり・固める・足す所）は memo-card-board-hex-move.test.ts
//   見た目と当たり（多角形だけが押しを受ける・乗せたときの説明・強制色）と、パネルを通した書き先（四角のファイルが変わらないこと）は開発画面と Windows の確かめ
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARRIVAL_FLASH_MS } from '../src/memo-card-board-view';
import { code } from './helpers';
import { unwrapT } from './source-text';
import { parseCss } from './theme-css';

const tab = unwrapT(readFile(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const face = unwrapT(readFile(new URL('../src/app/memo-board-hex.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const css = readFile(new URL('../src/grok-cards.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// from から to の手前まで。どちらかが見つからなければ throw（中身の無い確かめにしない）
const body = (from: string, to: string) => {
  const a = tab.indexOf(from);
  if (a < 0) throw new Error(`見つかりません：${from}`);
  const b = tab.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`見つかりません：${to}`);
  return tab.slice(a, b);
};
// クラスの一段目（字下げ 2）の宣言の名前と位置（opening.test.ts と同じ読み方）
const members = [...tab.matchAll(/^ {2}(?:(?:private|readonly|get|async|static) )*(\w+)\s*\(/gm)].map((m) => ({ name: m[1], at: m.index ?? 0 }));
const memberAt = (at: number) => {
  let name = '';
  for (const m of members) {
    if (m.at > at) break;
    name = m.name;
  }
  return name;
};
const memberBody = (name: string) => {
  const i = members.findIndex((m) => m.name === name);
  if (i < 0) throw new Error(`見つかりません：${name}`);
  return tab.slice(members[i].at, members[i + 1]?.at ?? tab.length);
};
// 数える・否定の確かめは、行の注釈を除いた字（code。helpers.ts）で比べる
const count = (s: string, part: string) => s.split(part).length - 1;

describe('形の覚えと切り替え', () => {
  it('localStorage の鍵は honeycomb.boardShape 一つ。hex のときだけ六角（上と下で共通・全部のメモ）', () => {
    expect(tab).toContain("const BOARD_SHAPE_KEY = 'honeycomb.boardShape';");
    expect(body('function readBoardShape(): BoardLayout {', 'function writeBoardShape(')).toContain("return localStorage.getItem(BOARD_SHAPE_KEY) === 'hex' ? 'hex' : 'square';");
    expect(tab).toContain('private shape: BoardLayout = readBoardShape();');
    expect(body('private setShape(next: BoardLayout) {', '// ---------- 写真の行き先と題')).toContain('writeBoardShape(next);');
  });
  it('題の帯の「⬡ 六角」と道具の列の「⬡」。字は固定（あとから字を書き換えない）', () => {
    expect(tab).toContain("private readonly shapeBtn = el('button', 'memo-board-shape', '⬡ 六角');");
    expect(tab).toContain("private readonly shapeTool = el('button', 'memo-board-tool memo-board-shape-tool', '⬡');");
    expect(code(tab)).not.toMatch(/this\.shape(Btn|Tool)\.textContent =/);
    expect(tab).toContain('[this.shapeTool, () => this.toggleShape()]');
  });
  it('題の帯へは別の append で、右の並びの頭に足す（見出しの並び・倍率の並びの字面は今のまま）', () => {
    expect(tab).toMatch(/bar\.append\(this\.titleBtn, this\.memoTag, this\.count, this\.orphanEl\);/);
    expect(tab).toContain('right.append(this.shapeBtn);');
    expect(tab.indexOf('right.append(this.shapeBtn);')).toBeLessThan(tab.indexOf('right.append(this.search, this.fitBtn, this.zoomBtn);'));
  });
  it('どちらのボタンも、押しても焦点を取らない。aria-pressed で押している状態（六角）を出す。説明は止めている理由か、形ごとの文', () => {
    const bind = body('private bindShape() {', 'private paintShape() {');
    expect(bind).toMatch(/for \(const b of \[this\.shapeBtn, this\.shapeTool\]\) \{[\s\S]*?b\.addEventListener\('pointerdown', \(e\) => e\.preventDefault\(\)\);[\s\S]*?\}/);
    expect(bind).toContain("this.shapeTool.setAttribute('aria-label', '六角で表示');");
    // 押したときの動きは一つのボタンに一つだけ（道具の列のボタンは buildTools の並びで受ける。二度付けると押しても元に戻ってしまう）
    expect(count(code(tab), 'this.shapeBtn.addEventListener(\'click\', () => this.toggleShape());')).toBe(1);
    expect(code(tab)).not.toMatch(/this\.shapeTool\.addEventListener\('click'/);
    expect(code(bind)).not.toMatch(/\bb\.addEventListener\('click'/);
    expect(count(code(tab), 'this.toggleShape()')).toBe(2);
    const paint = body('private paintShape() {', 'private toggleShape() {');
    expect(paint).toContain("const title = this.shapeBlockedNote() ?? (hex ? SHAPE_TITLE_ON : SHAPE_TITLE_OFF);");
    expect(paint).toMatch(/for \(const b of \[this\.shapeBtn, this\.shapeTool\]\) \{\s*b\.setAttribute\('aria-pressed', String\(hex\)\);\s*b\.title = title;/);
    expect(tab).toContain("const SHAPE_TITLE_OFF = '六角で表示します。四角と六角の並びは別々に残ります';");
    expect(body('private paintToolsBoard() {', 'const snap = this.source?.get() ?? null;')).toContain('this.paintShape();'); // 道具の列を描くたびに（隠れているときも）
  });
  it('替えるとき：止める条件を先に見て、止めたら一言とボタンの説明で理由を出す', () => {
    const set = body('private setShape(next: BoardLayout) {', '// ---------- 写真の行き先と題');
    expect(set).toMatch(/const blocked = this\.shapeBlockedNote\(\);\s*if \(blocked\) \{\s*this\.flash\(blocked, 'warn'\);\s*this\.paintShape\(\);\s*return;\s*\}/);
    const blocked = body('private shapeBlockedNote(): string | null {', 'private bindShape() {');
    expect(blocked).toContain('if (this.drag !== null || this.marquee !== null)'); // つまんでいる・範囲選択の途中
    expect(blocked).toContain('if (this.pending.size > 0)'); // 保存を待っている
    expect(blocked).toContain('if (this.placing > 0 || this.undoBusy)'); // 足す・消す・貼る・戻すの結果を待っている
  });
  it('替えるとき：メモを替えるときの片づけにそろえる（見ている位置を替える前に flushView）。書く欄と選びは残す', () => {
    const set = body('private setShape(next: BoardLayout) {', '// ---------- 写真の行き先と題');
    const order = ['this.shapeBlockedNote()', 'this.cancelDrag();', 'this.flushView();', 'this.closeTidy(false);', 'this.menu?.close();', 'this.cancelLink();', 'this.closeTemplate();', "this.renderKey = '';", 'this.rememberView();', 'this.shape = next;', 'this.needFit = true;'].map((s) => set.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(code(set)).not.toContain('this.view = '); // 見ている位置は開いたときの道（renderBoard の needFit）で決める
    expect(code(set)).not.toMatch(/closeCompose\(|setSelected\(|resetUndo\(/);
    expect(code(set)).not.toContain('this.touchView(');
  });
  it('替えるとき（HX5）：新しい形のファイルの読み込みにする。覚え（known）があればそれ、無ければ読む（形を替えたあと、開き方を決め直す前。読めない覚えは下の試験）', () => {
    const set = body('private setShape(next: BoardLayout) {', '// ---------- 写真の行き先と題');
    expect(set.indexOf('this.shape = next;')).toBeLessThan(set.indexOf('this.useShapeBoard();'));
    expect(set.indexOf('this.useShapeBoard();')).toBeLessThan(set.indexOf('this.needFit = true;'));
    const use = memberBody('useShapeBoard');
    expect(use).toContain('const kept = this.known.get(boardKey(this.shape, memoId));');
    expect(use.indexOf('const kept = ')).toBeLessThan(use.indexOf('this.loaded = usable;'));
  });
  it('替えるとき：道具の列（［整理］・孤児の注の出入り）を描いてから、開き方を決める（描き直しの中）', () => {
    const set = body('private setShape(next: BoardLayout) {', '// ---------- 写真の行き先と題');
    expect(set.indexOf('this.needFit = true;')).toBeLessThan(set.indexOf('this.paintTools();'));
    expect(set.indexOf('this.paintTools();')).toBeGreaterThan(-1);
    expect(set.indexOf('this.paintTools();')).toBeLessThan(set.indexOf('this.render();'));
  });
  it('見ている位置は形ごと・メモごとにメモリに覚え、出すときは開き方の決まり 1 で確かめる（保存しない）', () => {
    const set = body('private setShape(next: BoardLayout) {', '// ---------- 写真の行き先と題');
    expect(set).toContain('const kept = this.memoId ? this.shapeViews.get(boardKey(next, this.memoId)) : undefined;');
    expect(set).toContain('this.openKept = kept ? { ...kept } : null;');
    expect(body('private rememberView() {', 'private shapeBlockedNote(')).toContain('this.shapeViews.set(key, { ...this.viewAfterClose() });');
    expect(tab).toContain('const SHAPE_VIEWS_MAX = 60;');
  });
  it('メモを替える・閉じる前に覚える（memoId を替える 2 か所の両方で、flushView のすぐあと）。形を替えたときの覚えは捨てる', () => {
    const changed = body('if (changed) {', 'this.memoId = snap.memoId;');
    expect(changed).toMatch(/this\.flushView\(\);[^\n]*\n\s*this\.rememberView\(\);/);
    const closed = body('if (!snap) {', 'return;');
    expect(closed).toMatch(/this\.flushView\(\);[^\n]*\n\s*this\.rememberView\(\);/);
    expect(closed.indexOf('this.rememberView();')).toBeLessThan(closed.indexOf('this.memoId = null;'));
    expect(closed).toContain('this.openKept = null;');
    expect(body('if (changed) {', 'const knownBefore')).toContain('this.openKept = null;');
    expect(count(code(tab), 'this.rememberView();')).toBe(3); // 形を替える・メモを替える・メモが閉じる
  });
});

describe('形ごとの口（geo）を使う所', () => {
  it('形に関わる所は this.geo だけを使い、四角の寸法を直に使わない', () => {
    expect(code(tab)).not.toMatch(/BOARD_CARD/);
    expect(tab).toContain('private get geo(): BoardGeo {\n    return geoOf(this.shape);');
    expect(tab).toContain('boardFaces(replies, board, this.geo.place)');
    expect(count(code(tab), 'this.geo.edge(')).toBe(2); // 描くとき（lineGeometry。route の無い形＝四角と、時間の上限を超えた線）と、つまんで動かす間。六角の描くときは route（下の試験）
    expect(tab).toContain('marqueeHits(this.view, a, at, this.pos, this.geo.box, this.geo.hits)');
    expect(tab).toContain('nearestInDirection(from, this.pos, BOARD_ARROW_DIR[e.key], this.geo.nearest)');
    expect(count(code(tab), 'centerMostCard(this.pos, this.view, this.viewport(), this.geo.center)')).toBe(2);
    expect(tab).toContain('fitAll(this.faces, this.viewport(), this.geo.box)');
    expect(count(code(tab), 'cardVisibleRatio(this.view, at, viewport, this.geo.box)')).toBe(2);
    expect(tab).toContain('viewToShowCard(this.view, at, this.viewport(), this.geo.box)');
    expect(tab).toContain('edgeChipAt(this.view, at, viewport, placed, this.geo.box)');
  });
  it('メニュー・📌・［移る］の出し口は 3 か所とも geo の出し口（六角は右の縦の辺の上の端）', () => {
    expect(count(code(tab), 'const anchor = this.geo.menuAnchor(at);')).toBe(3);
    expect(count(code(tab), 'boardToScreen(this.view, anchor.x, anchor.y)')).toBe(3);
    for (const name of ['openMenuByKey', 'pinAnchor', 'hopToCard']) expect(memberBody(name), name).toContain('this.geo.menuAnchor(at)');
  });
  it('右クリックとダブルクリックのメニューは、押した所に開く（四角と同じ。出し口は使わない）', () => {
    expect(memberBody('onContextMenu')).toContain('this.openCardMenu(id, e.clientX, e.clientY, null);');
    expect(memberBody('dropDrag')).toContain('this.openCardMenu(d.ref, e.clientX, e.clientY, null);');
    for (const name of ['onContextMenu', 'dropDrag']) expect(code(memberBody(name)), name).not.toContain('menuAnchor');
  });
  it('線の形：全部を作り直すとき（build）は lineGeometry に両端のほかの描いているカードを渡す（route のある形＝六角は迂回の道、無い形＝四角は edge）。つまんで運ぶ間（placeCards）は edge だけ', () => {
    const build = memberBody('build');
    expect(build).toContain('const spent: RouteSpent = { ms: 0, over: 0 };');
    expect(build).toContain('const geom = this.lineGeometry(a, b, () => faces.filter((f) => f.id !== link.from && f.id !== link.to), spent);');
    expect(build).toMatch(/this\.paintLineNames\(\);\n\s*this\.noteRouteBudget\(spent\);\n\s*\}/);
    expect(code(build)).not.toContain('this.geo.edge(');
    expect(code(build)).not.toContain('this.geo.route(');
    const place = body('private placeCards(', 'private endDrag(');
    expect(count(code(place), 'this.geo.edge(')).toBe(1);
    expect(code(place)).not.toContain('route');
    expect(code(place)).not.toContain('lineGeometry');
    expect(count(code(tab), 'this.geo.route(')).toBe(1); // 迂回の道を呼ぶのは lineGeometry の 1 か所だけ
    expect(code(tab).match(/geo\.route\b/g)?.length).toBe(4); // lineGeometry の有るかの確かめ 2 つと呼ぶ所、routeLines の有るかの確かめ
    expect(count(code(tab), 'this.lineGeometry(')).toBe(2); // build と routeLines
  });
  it('迂回の時間の上限：lineGeometry は迂回の計算に使った時間を performance.now() で数え、合わせて ROUTE_BUDGET_MS に届いたら残りの線を edge で描いて数える。超えたことは console に一度だけ', () => {
    expect(tab).toContain("import { ROUTE_BUDGET_MS } from '../memo-card-board-route';");
    expect(tab).toContain('type RouteSpent = { ms: number; over: number };');
    const geometry = memberBody('lineGeometry');
    expect(geometry).toContain('private lineGeometry(a: Pt, b: Pt, others: () => readonly Pt[], spent: RouteSpent): EdgeGeometry | null {');
    expect(code(geometry)).toContain(
      [
        '    if (this.geo.route && spent.ms < ROUTE_BUDGET_MS) {',
        '      const t0 = performance.now();',
        '      const geom = this.geo.route(a, b, others());',
        '      spent.ms += performance.now() - t0;',
        '      return geom;',
        '    }',
        '    if (this.geo.route) spent.over += 1;',
        '    return this.geo.edge(a, b);',
        '  }',
      ].join('\n'),
    );
    const note = memberBody('noteRouteBudget');
    expect(code(note)).toContain('if (spent.over === 0 || this.routeBudgetNoted) return;\n    this.routeBudgetNoted = true;\n    console.info(');
    expect(note).toContain('${ROUTE_BUDGET_MS}ms');
    expect(count(code(tab), 'console.')).toBe(1);
    expect(count(code(tab), 'this.noteRouteBudget(spent);')).toBe(2); // build と routeLines
    expect(tab).toContain('private routeBudgetNoted = false;');
  });
  it('Esc で取り消した・同じ所で離した（鍵が変わらず build が呼ばれない）ときは、動かしたカードにつながる線だけを routeLines で迂回の道に描き直す。四角（route が無い）は何もしない', () => {
    const lines = memberBody('routeLines');
    expect(code(lines)).toContain(
      [
        '  private routeLines(ids: Iterable<string>) {',
        '    if (!this.geo.route) return;',
        '    const moved = new Set(ids);',
        '    const spent: RouteSpent = { ms: 0, over: 0 };',
        '    for (const line of this.lineEls) {',
        '      if (!moved.has(line.from) && !moved.has(line.to)) continue;',
        '      const a = this.pos.get(line.from);',
        '      const b = this.pos.get(line.to);',
        '      const others = () => [...this.pos].filter(([id]) => id !== line.from && id !== line.to).map(([, p]) => p);',
        '      this.paintLine(line, a && b ? this.lineGeometry(a, b, others, spent) : null);',
        '    }',
        '    this.noteRouteBudget(spent);',
        '  }',
      ].join('\n'),
    );
    const cancel = memberBody('cancelDrag');
    expect(code(cancel)).toMatch(/const drawn = this\.renderKey;\s*if \(this\.dirty\) this\.render\(\);\s*if \(back\.positions && this\.renderKey === drawn\) this\.routeLines\(back\.positions\.keys\(\)\);/);
    expect(cancel.indexOf('if (back.positions) this.placeCards(back.positions);')).toBeLessThan(cancel.indexOf('this.routeLines('));
    const commit = memberBody('commitMove');
    expect(code(commit)).toMatch(/if \(!first\.changed && !moves\.some\(\(m\) => this\.pending\.has\(m\.ref\)\)\) \{\s*const drawn = this\.renderKey;\s*this\.render\(\);\s*if \(this\.renderKey === drawn\) this\.routeLines\(moves\.map\(\(m\) => m\.ref\)\);\s*after\?\.\(true\);\s*return;\s*\}/);
    expect(count(code(tab), 'this.routeLines(')).toBe(3); // 取り消すとき・同じ所で離したとき・待っている位置へそのまま戻して離したとき
  });
  it('保存を待つ道（setPending のあと）でも、描き直しの鍵が変わらなければ（待っている位置へそのまま戻して離した）、動かしたカードの線を routeLines で描き直す', () => {
    const commit = memberBody('commitMove');
    expect(code(commit)).toMatch(
      /const token = \+\+this\.seq;\s*for \(const m of moves\) this\.setPending\(m\.ref, m, token\);\s*const drawn = this\.renderKey;\s*this\.render\(\);\s*if \(this\.renderKey === drawn\) this\.routeLines\(moves\.map\(\(m\) => m\.ref\)\);\s*const replies = snap\.replies;/,
    );
    expect(count(code(commit), 'this.routeLines(moves.map((m) => m.ref));')).toBe(2); // 同じ所で離した枝と、保存を待つ道
    expect(count(code(commit), 'const drawn = this.renderKey;')).toBe(2);
  });
  it('線は描くときもつまんで動かす間も paintLine で形を当てる（短い線の帯は矢じりを外して太さで描く）', () => {
    expect(body('private build(', 'private renderFilter(')).toContain('this.paintLine(line, geom);');
    expect(body('private placeCards(', 'private endDrag(')).toContain('this.paintLine(line, a && b ? this.geo.edge(a, b) : null);');
    const paint = body('private paintLine(line: LineEl, geom: EdgeGeometry | null) {', '// 絞り込みの札の列');
    // 名札の寄せ：形に anchor があればそれ（六角の迂回の線）、無ければ今のまま middle。名札の位置と同じ「形がある」枝で当てる
    expect(code(paint)).toMatch(
      /if \(geom\) \{\s*line\.label\.setAttribute\('x', String\(geom\.mid\.x\)\);\s*line\.label\.setAttribute\('y', String\(geom\.mid\.y\)\);\s*line\.label\.setAttribute\('text-anchor', geom\.anchor \?\? 'middle'\);\s*\}/,
    );
    expect(count(code(tab), "setAttribute('text-anchor'")).toBe(2); // 作るときの middle と、paintLine
    expect(code(memberBody('build'))).toContain("label.setAttribute('text-anchor', 'middle');");
    expect(paint).toContain('const band = geom?.band;');
    expect(paint).toContain("line.path.style.strokeWidth = band ? String(band) : '';");
    expect(paint).toMatch(/if \(band \|\| !line\.marker\) line\.path\.removeAttribute\('marker-end'\);\s*else line\.path\.setAttribute\('marker-end', line\.marker\);/);
  });
  it('六角のカードは app/memo-board-hex.ts の顔で描き、四角と同じく cardEls に入れる（選び・光り・薄くするはこれに頼る）。仮の印（四角の破線）は付けない', () => {
    const build = body('private build(', 'private renderFilter(');
    expect(build).toContain('const info = hexInfo?.get(f.id);');
    expect(build).toContain('hexCardEl(f, info, f.thumb ? this.faceUrls.get(f.thumb) : undefined)');
    const hexPart = build.slice(build.indexOf('if (info) {'), build.indexOf("const card = el('div', 'memo-board-card');"));
    expect(hexPart.length).toBeGreaterThan(50);
    expect(hexPart).toContain('frag.append(hex);');
    expect(hexPart).toContain('this.cardEls.set(f.id, hex);');
    expect(hexPart).toContain('continue;');
    expect(code(hexPart)).not.toContain('is-provisional');
    expect(code(face)).not.toContain('is-provisional');
  });
  it('描き直しの鍵に形を入れる（形を替えたら必ず作り直す）。六角は三角の字（日時・印・タグ・題）も入れる（✎ などは顔の文だけでは替わらない）。四角の鍵は今のまま', () => {
    const render = body('private renderBoard(', 'private build(');
    expect(render).toContain("const hexInfo = this.shape === 'hex' ? hexFaceInfos(replies, faces, links) : null;");
    expect(render).toContain('const key = JSON.stringify([snap?.memoId ?? null, this.shape, faces, links, linkNamesKey(), ...(hexInfo ? [[...hexInfo]] : [])]);');
    expect(render).toContain('this.build(replies, faces, links, hexInfo);');
  });
});

describe('速さ（描き直すたびに通る所。動きは変えない。HX4）', () => {
  const hexSrc = unwrapT(readFile(new URL('../src/memo-card-board-hex.ts', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  it('六角の三角の字は、返信の数を一回でまとめて数える（カードごとに全部の返信をなめない）', () => {
    const at = hexSrc.indexOf('export function hexFaceInfos(');
    expect(at).toBeGreaterThan(-1);
    const infos = hexSrc.slice(at);
    expect(infos).toContain('const replied = replyCounts(replies, faces.map((f) => f.id));');
    expect(infos).toContain('hexFaceInfo(replies, reply, counts.get(f.id) ?? 0, replied.get(f.id) ?? 0)');
    expect(code(infos)).not.toContain('replyCount(');
  });
  it('build は renderBoard が作った線（links）を受け取り、boardLinks を計算し直さない', () => {
    const build = body('private build(', 'private renderFilter(');
    expect(build).toContain('links: readonly DrawLink[]');
    expect(build).toContain('for (const link of links) {');
    expect(code(build)).not.toContain('boardLinks(');
    expect(count(code(tab), 'boardLinks(')).toBe(1); // renderBoard の 1 か所だけ
    expect(body('private renderBoard(', 'private build(')).toContain('const links = boardLinks(replies, new Set(faces.map((f) => f.id)));');
  });
});

describe('六角の顔（app/memo-board-hex.ts）', () => {
  it('div は .memo-board-card.is-hex。押したカードを探す印（data-card）と位置は四角と同じ書き方。SVG の多角形の顔と内側の選びの輪。svg は読み上げない', () => {
    expect(face).toContain("const card = el('div', 'memo-board-card is-hex');");
    expect(face).toContain('card.dataset.card = f.id;');
    expect(face).toContain('card.style.left = `${f.x}px`;');
    expect(face).toContain('card.style.top = `${f.y}px`;');
    expect(tab).toContain(".closest<HTMLElement>('.memo-board-card')"); // 押した所（多角形）からカードの div をたどる
    expect(face).toContain("svg.setAttribute('aria-hidden', 'true');");
    expect(face).toContain("face.classList.add('memo-board-hex-face');");
    expect(face).toContain("ring.classList.add('memo-board-hex-ring');");
    expect(face).toContain("face.setAttribute('pathLength', '60');");
    expect(face).toContain('const RING_POINTS = points(HEX.h / 2 - RING_IN);');
    expect(face).toContain('const RING_IN = 4;');
  });
  it('字は textContent だけ（el と createTextNode）。上の三角に印（日時は出さない）、真ん中に文（1 行目の太字は四角と同じ）、下の三角にタグ 1 つと +n か書き手', () => {
    expect(code(face)).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
    expect(face).not.toContain('memo-board-hex-date'); // 上の三角に日時は出さない（2026-11-09 の利用者の依頼）
    expect(face).toContain("for (const mark of info.marks) top.append(el('span', 'memo-board-hex-mark', mark));");
    expect(face).toContain("const flow = el('div', 'memo-board-card-flow');");
    expect(face).toContain("flow.append(f.bold ? el('span', 'memo-board-card-first', f.first) : document.createTextNode(f.first));");
    expect(face).toMatch(/if \(info\.who\) bottom\.append\(el\('span', 'memo-board-hex-who', info\.who\)\);\s*else if \(info\.title\) bottom\.append\(el\('span', 'memo-board-hex-title', info\.title\)\);\s*else if \(info\.tag\) bottom\.append\(el\('span', 'memo-board-hex-tag', info\.tag\)\);/);
    expect(face).toContain("if (info.more > 0) bottom.append(el('span', 'memo-board-hex-more', `+${info.more}`));");
  });
  it('写真だけのカードは真ん中に絵（四角と同じ class の img なので、読んだ絵は今の道で差し替わる）。文は出さない', () => {
    expect(face).toMatch(/if \(f\.thumb\) \{\s*card\.classList\.add\('has-thumb'\);\s*const img = el\('img', 'memo-board-card-thumb'\);/);
    expect(tab).toContain(".querySelector<HTMLImageElement>('.memo-board-card-thumb')");
  });
});

describe('形ごとのファイルに書く（書く道 6 か所は、操作を始めたときの形の鍵で known を引く。HX5）', () => {
  const sites = [...tab.matchAll(/await saveBoard\(/g)].map((m) => memberAt(m.index ?? 0));
  it('HX4 の関所（coordsWritable）・六角でつまめない文は無い。保存の計画は読み込みの形で選ぶ planBoardMoves（四角の planMoves を直に呼ばない）', () => {
    expect(code(tab)).not.toContain('coordsWritable');
    expect(code(tab)).not.toContain('HEX_MOVE_NOTE');
    expect(code(tab)).not.toContain('planMoves(');
    expect(count(code(tab), 'planBoardMoves(')).toBe(5); // commitMove の 2 か所（先の確かめと保存の列）・足す・貼る・戻したカードの保存
    for (const name of ['commitMove', 'submitAdd', 'pasteOnBoard', 'savePlaced']) expect(memberBody(name), name).toContain('planBoardMoves(base ?? null, replies,');
  });
  it('saveBoard を呼ぶのは 6 か所。どれも保存の列より前に「形:メモ」の鍵を取り、列の中ではその鍵だけで known を引いて覚える', () => {
    expect([...sites].sort()).toEqual(['commitMove', 'flushView', 'pasteOnBoard', 'runTidy', 'savePlaced', 'submitAdd']);
    const keys: Record<string, string> = {
      flushView: 'const key = boardKey(layout, memoId);',
      commitMove: 'const key = boardKey(layout, memoId);',
      runTidy: 'const key = boardKey(shape, memoId);',
      submitAdd: 'const key = boardKey(geo.layout, memoId);',
      pasteOnBoard: 'const key = boardKey(geo.layout, memoId);',
      savePlaced: 'const key = boardKey(layout, memoId);',
    };
    for (const name of sites) {
      const b = memberBody(name);
      const at = b.indexOf(keys[name]);
      const queue = b.indexOf('this.enqueue(');
      expect(at, name).toBeGreaterThan(-1);
      expect(queue, name).toBeGreaterThan(at); // 鍵は列に入れる前に取る（待つ間に形を替えても、始めたときの形のファイルに書く）
      const task = b.slice(queue);
      expect(task, name).toContain('this.known.get(key)');
      expect(task, name).toContain('this.settle(key, result);');
      expect(code(task), name).not.toContain('this.shape');
    }
    for (const name of ['flushView', 'commitMove']) {
      const b = memberBody(name);
      expect(b.indexOf('const layout = this.shape;'), name).toBeGreaterThan(-1);
      expect(b.indexOf('const layout = this.shape;'), name).toBeLessThan(b.indexOf('const key = boardKey(layout, memoId);'));
    }
    expect(code(tab)).not.toMatch(/this\.known\.get\(memoId\)|this\.settle\(memoId,|this\.setLoaded\(memoId,/);
  });
  it('保存できなかった文は、書く先の形を渡して作る（六角なら、読めない・読んだあとに変わったの頭に「六角の並びは、」。文の中身は hex-move の試験）', () => {
    expect(memberBody('flushView')).toContain('const note = viewResultNote(result, layout);');
    expect(memberBody('flushView')).toContain("this.flash(boardSaveMessage('write', layout), 'warn');");
    const commit = memberBody('commitMove');
    expect(commit).toContain("this.flash(boardSaveMessage('unreadable', layout), 'warn');");
    expect(commit).toContain('const note = moveResultNote(result, layout);');
    expect(commit).toContain("this.flash(boardSaveMessage('write', layout), 'warn');");
    expect(memberBody('runTidy')).toContain('boardSaveMessage(result.why, shape)');
    expect(memberBody('runTidy')).toContain("boardSaveMessage('write', shape)");
    expect(memberBody('submitAdd')).toContain('boardSaveMessage(result.why, geo.layout)');
    expect(memberBody('pasteOnBoard')).toContain('boardSaveMessage(result.why, geo.layout)');
    expect(memberBody('savePlaced')).toContain('boardSaveMessage(result.why, layout)');
    expect(count(code(tab), 'boardSaveMessage(')).toBe(8); // 上の 8 か所だけ（形を渡さない呼び出しは無い）
    expect(count(code(tab), 'ResultNote(')).toBe(2);
  });
  it('known は「形:メモ」の組で 60 件まで。鍵の作り方は一つ（boardKey。形ごとの見ている位置の覚えも同じ鍵）', () => {
    expect(tab).toContain('const KNOWN_MAX = 60;');
    expect(tab).toContain('function boardKey(shape: BoardLayout, memoId: string): string {\n  return `${shape}:${memoId}`;');
    expect(code(tab)).not.toContain('shapeViewKey');
  });
  it('setLoaded：結果の形とメモが鍵と違えば捨てる。いまの形とメモの鍵のときだけ this.loaded にする。保存が終わるたびに書いた回数を進める', () => {
    const set = body('private setLoaded(key: string, result: LoadBoardResult) {', 'private settle(');
    expect(set.indexOf('if (boardKey(result.layout, result.memoId) !== key) return;')).toBeGreaterThan(-1);
    expect(set.indexOf('if (boardKey(result.layout, result.memoId) !== key) return;')).toBeLessThan(set.indexOf('this.known.set(key, result);'));
    expect(set).toContain('if (this.memoId !== null && key === boardKey(this.shape, this.memoId)) this.loaded = result;');
    const settle = memberBody('settle');
    expect(settle).toContain('this.wrote.set(key, (this.wrote.get(key) ?? 0) + 1);');
    expect(settle.indexOf('this.wrote.set(')).toBeLessThan(settle.indexOf('this.setLoaded(key, result.loaded);'));
  });
  it('読み込み：いまの形のファイルを読む（読むのはここ一か所）。返りの使い方は loadOutcome に任せる（番・メモ・形・保存を待っているか・いまの読み込み・覚え。組み合わせは hex-move の試験）', () => {
    expect(count(code(tab), 'loadBoard(')).toBe(1);
    const read = memberBody('readBoard');
    expect(read).toContain('const layout = this.shape;');
    expect(read).toContain('loadBoard(readOnlyIo, memoId, Date.now(), layout)');
    expect(read).toContain('const wrote = this.wrote.get(key) ?? 0;');
    expect(read).toMatch(/const outcome = loadOutcome\(\{\s*current: seq === this\.loadSeq && this\.memoId === memoId && this\.shape === layout,\s*waiting: this\.pending\.size > 0 \|\| \(this\.wrote\.get\(key\) \?\? 0\) !== wrote,\s*loaded: this\.loaded !== null,\s*kept: this\.known\.has\(key\),\s*\}\);/);
    expect(read).toMatch(/if \(outcome === 'drop'\) return;\s*if \(outcome === 'kept'\) this\.loaded = this\.known\.get\(key\) \?\? null;\s*else this\.setLoaded\(key, result\);/);
    expect(read.indexOf("if (outcome === 'drop') return;")).toBeLessThan(read.indexOf('this.render();'));
    expect(tab).toContain('if (changed || show) this.readBoard(snap.memoId);');
  });
  it('形を替えたとき、覚え（known）が読めないもの（unreadable）なら使わずに読み直す', () => {
    const use = memberBody('useShapeBoard');
    expect(use).toContain("const usable = kept && kept.state !== 'unreadable' ? kept : null;");
    expect(use).toContain('this.loaded = usable;');
    expect(use).toMatch(/if \(usable\) this\.loadSeq \+= 1;[^\n]*\n\s*else this\.readBoard\(memoId\);/);
  });
  it('つまむの近道（変わらなければ列に入れない）は、保存を待っているカードを含むときは使わない（列の中で、待っている保存のあとの形と比べる）', () => {
    const commit = memberBody('commitMove');
    expect(commit).toContain('if (!first.changed && !moves.some((m) => this.pending.has(m.ref))) {');
    expect(commit.indexOf('if (!first.changed && !moves.some(')).toBeLessThan(commit.indexOf('this.setPending('));
    expect(code(commit)).not.toMatch(/if \(!first\.changed\) \{/);
  });
  it('保存を待つ位置は setPending だけで置き、入れ直して順の後ろへ回す（六角は最後に動かしたカードを上に描く）', () => {
    expect(memberBody('setPending')).toMatch(/this\.pending\.delete\(ref\);\s*this\.pending\.set\(ref, \{ x: at\.x, y: at\.y, seq \}\);/);
    expect(count(code(tab), 'this.pending.set(')).toBe(1);
    expect(count(code(tab), 'this.setPending(')).toBe(6); // 動かす・足す・型を貼る・足し直す・消したのを戻す・型の貼り直し
  });
  it('六角のファイルを初めて作る書き込みには、見る位置そのものを変えていれば（viewMoved）今の位置を入れる（freezeView。変えていなければ初期の位置のまま。つまむだけでは入れない）', () => {
    expect(memberBody('freezeView')).toContain('return this.viewMoved ? { ...this.viewToSave() } : undefined;');
    expect(code(memberBody('freezeView'))).not.toContain('viewTouched'); // viewTouched はつまみ始めただけでも立つ
    expect(memberBody('commitMove')).toContain('planBoardMoves(base ?? null, replies, moves, Date.now(), { view })');
    expect(memberBody('submitAdd')).toContain('{ writeSame: true, view }');
    expect(memberBody('savePlaced')).toContain('{ writeSame: opts.writeSame, view }');
    for (const name of ['commitMove', 'submitAdd', 'savePlaced']) {
      const b = memberBody(name);
      expect(b.indexOf('const view = this.freezeView();'), name).toBeGreaterThan(-1);
      expect(b.indexOf('const view = this.freezeView();'), name).toBeLessThan(b.indexOf('this.enqueue('));
    }
    // 足す道は、滑らせて（slideToRead）から見る位置を取る（滑らせた位置を入れる）
    const add = memberBody('submitAdd');
    expect(add.indexOf('this.slideToRead(')).toBeGreaterThan(-1);
    expect(add.indexOf('this.slideToRead(')).toBeLessThan(add.indexOf('const view = this.freezeView();'));
  });
  it('viewMoved：立てるのは touchView の頭だけ（パン・ホイール・矢印・［全体］・倍率・足したあとの滑りはどれも touchView を通る）。つまみ始めでは立てない。下ろすのは viewTouched を下ろす 2 か所。取り消したら押した時の値に戻す', () => {
    const touch = memberBody('touchView');
    expect(touch).toMatch(/this\.viewTouched = true;[^\n]*\n\s*this\.viewMoved = true;/);
    expect(touch.indexOf('this.viewMoved = true;')).toBeLessThan(touch.indexOf('return;'));
    expect(count(code(tab), 'this.viewMoved = true;')).toBe(1);
    expect(code(memberBody('moveDrag'))).not.toContain('viewMoved');
    for (const name of ['renderBoard', 'reopenAfterShow']) expect(memberBody(name), name).toMatch(/this\.viewTouched = false;\s*this\.viewMoved = false;/);
    expect(count(code(tab), 'this.viewTouched = false;')).toBe(2);
    expect(count(code(tab), 'this.viewMoved = false;')).toBe(2);
    expect(memberBody('pressCard')).toContain('touched0: this.viewTouched, viewMoved0: this.viewMoved,');
    expect(memberBody('cancelDrag')).toMatch(/this\.viewTouched = d\.touched0;\s*this\.viewMoved = d\.viewMoved0;/);
    expect(count(code(tab), 'this.viewMoved = ')).toBe(4);
  });
  it('開いたときの決まり 1 は、いまの形のファイルの見ている位置（覚えた位置 saved があればそちらを先に。HX4 のまま）', () => {
    expect(body('private renderBoard(', 'private build(')).toContain('openingView(this.loaded, replies, faces,');
  });
  it('見ている位置の保存：形で止めない（六角のファイルが無いときは planView が断る）', () => {
    const flush = memberBody('flushView');
    expect(flush).toContain('if (!memoId) return;');
    expect(flush).toContain('const plan = planView(base ?? null, view, Date.now());');
  });
  it('足す・消す・貼るの結果を待っている間は形を替えない（増やした数だけ必ず減らす）', () => {
    const add = memberBody('submitAdd');
    expect(add.indexOf('this.placing += 1;')).toBeLessThan(add.indexOf('this.ask(cmd);'));
    expect(add).toMatch(/cardAppeared\(rs, id\), \(ok\) => \{\s*this\.placing -= 1;/);
    expect(count(code(tab), 'this.placing += 1;')).toBe(3);
    expect(count(code(tab), 'this.placing -= 1;')).toBe(3);
    expect(memberBody('removeSelected')).toMatch(/this\.placing \+= 1;[^\n]*\n\s*this\.watch\(memoId, \(rs\) => cardsGone\(rs, ids\), \(ok\) => \{\s*this\.placing -= 1;/);
    expect(memberBody('pasteOnBoard')).toMatch(/pastedAppeared\(rs, ids\), \(ok\) => \{\s*this\.placing -= 1;/);
  });
});

describe('六角でも動かす・足す・消す・貼る（位置を決めて書く。HX5）', () => {
  it('つまめるかは、いまの形のファイルの読み込みで決める（四角と同じ決まり。面の data-movable も、つまんで動かし始めるときの止めも）', () => {
    expect(body('private renderBoard(', 'private build(')).toContain('this.stage.dataset.movable = String(snap !== null && moveBlockedNote(this.loaded) === null);');
    expect(body('private moveDrag(', 'private dragPoint(')).toMatch(/const blocked = moveBlockedNote\(this\.loaded\);\s*if \(blocked\) \{\s*this\.flash\(blocked, 'warn'\);[^\n]*\n\s*this\.endDrag\(\);\s*return;/);
  });
  it('六角は、保存を待っているカードを顔の並びの後ろ（上）へ（最後に動かしたカードを、保存の前から上に描く）', () => {
    expect(body('private renderBoard(', 'private build(')).toContain('withPending(boardFaces(replies, board, this.geo.place), this.pending, this.shape === \'hex\')');
  });
  it('足す：置き場は形ごとの箱・歩み・重なり・横に置けないときの置き方（geo）で決め、位置を必ず持つ。最後に書いたカードはどの足し方にも渡す（四角の向きのある足し方では addSpot が使わない）', () => {
    const add = memberBody('submitAdd');
    expect(add).toContain('const lastFace = lastWritten(snap.replies, this.faces);');
    expect(add).toContain('addSpot({ at: this.composeAt ?? undefined, dir, anchor, last, view: this.viewAfterClose(), viewport: this.closedViewport(), taken, size: geo.box, step: geo.step, overlaps: geo.overlaps, besideFallback: geo.besideFallback })');
    // 避ける位置は、描いている位置と、保存を待っていてまだ描いていない位置（結果を待つ間に続けて足したカード。takenSpots の中身は hex-move の試験）
    expect(add).toContain('const taken = takenSpots(this.pos, this.pending);');
    expect(add.indexOf('const taken = takenSpots(')).toBeLessThan(add.indexOf('const spot = addSpot('));
    expect(add).toContain('this.setPending(id, spot, token);');
    expect(add).toContain("this.pushUndo({ kind: 'add', id, text: replies.find((r) => r.id === id)?.text ?? text, at: { x: spot.x, y: spot.y } }, geo.layout);");
    expect(code(add)).not.toMatch(/\bhex\b/); // HX4 の六角だけの道（置き場を探さない・仮の並びの最後へ滑らせる）は無い
  });
  it('足したあとの滑りは、どの足し方でも（四角と六角の両方。HX2 は［決める］だけだった。上の区画の面 217 では、下に足したカードが見えないため）', () => {
    const add = memberBody('submitAdd');
    expect(add).toContain('if (this.memoId === memoId) this.slideToRead(this.pos.get(id) ?? spot);');
    expect(code(add)).not.toContain('!dir &&');
    // 滑らせる目当ては geo の slideBox（六角の低い面では文の帯。目当ての決め方は hex-move の試験）
    expect(memberBody('slideToRead')).toContain('this.slideTo(viewToRead(this.view, this.geo.slideBox(at, this.view.zoom, vp), vp));');
    expect(code(memberBody('slideToRead'))).not.toContain('this.readBox(');
  });
  it('足す道は、仮の番と同じ所でも書く（writeSame。六角は固める）。変わらなければ静かに終える。足し直しも同じ', () => {
    const add = memberBody('submitAdd');
    expect(add).toContain('{ writeSame: true, view }');
    expect(add).toMatch(/if \(!plan\.changed\) \{\s*if \(this\.memoId === memoId\) this\.quietSuccess\(\);[^\n]*\n\s*return;\s*\}/);
    expect(memberBody('runUndo')).toContain("'カードは足しましたが、位置は保存できませんでした', { writeSame: true });");
  });
  it('消すときに覚える戻す先は removeAt（六角はファイルに位置のあるカードだけ。消し直すときも）。戻す位置が一つも無ければ savePlaced を呼ばない', () => {
    const remove = memberBody('removeSelected');
    expect(remove).toContain('const at = removeAt(ids, this.faces, this.shape);');
    expect(remove.indexOf('const at = removeAt(')).toBeLessThan(remove.indexOf('deleteCommands('));
    const run = memberBody('runUndo');
    expect(run).toContain('const at = removeAt(ids, this.faces, this.shape, op.at);');
    expect(run).toMatch(/if \(moves\.length === 0\) this\.flash\(undoDoneText\(op, dir\), 'info'\);[^\n]*\n\s*else this\.savePlaced\(memoId, shape, moves, token, undoDoneText\(op, dir\), 'カードは戻しましたが、位置は保存できませんでした'\);/);
  });
  it('型を貼る道は、基準が無ければ（道具の列から）、六角では pasteOnBoard の頭で止める。基準があれば（カードの右クリックの「型を足す…」。TA2）六角でも通し、基準の右と下に置く。geo の口で置き、始めたときの形の鍵で書く', () => {
    const paste = memberBody('pasteOnBoard');
    expect(paste).toMatch(/if \(from === undefined && this\.shape === 'hex'\) \{\s*this\.flash\(HEX_PASTE_NOTE, 'warn'\);\s*return;\s*\}/);
    expect(paste.indexOf("if (from === undefined && this.shape === 'hex') {")).toBeLessThan(paste.indexOf('planBoardPaste('));
    // 基準は、押したカード（今の位置）か、空きのメニューを開いた所（押した所・面の真ん中。TA5）
    expect(paste).toContain("const anchor: PasteAnchor | undefined = anchorAt ? { kind: 'card', at: anchorAt } : from && from.kind !== 'card' ? from : undefined;");
    // 基準があるとき：保存を待っている位置も避ける・形ごとの重なりの深さを渡す・読める所へ寄せてから、見ている位置を控えて、同じ所でも書く（六角は初めてなら固める）
    expect(paste).toContain('taken: anchor ? takenSpots(this.pos, this.pending) : [...this.pos.values()]');
    expect(paste).toContain('depth: geo.depth, ...(anchor ? { anchor } : {})');
    expect(paste).toContain('viewToReadAdded(this.view, anchorAt ? geo.readBox(anchorAt) : null, moves.map((m) => geo.readBox(m)), this.viewport())'); // 空きからは、足した分だけを目当てに
    expect(paste.indexOf('this.slideTo(viewToReadAdded(')).toBeLessThan(paste.indexOf('const view = this.freezeView();'));
    expect(paste.indexOf('const view = this.freezeView();')).toBeLessThan(paste.indexOf('this.enqueue('));
    expect(paste).toContain('planBoardMoves(base ?? null, replies, moves, Date.now(), { writeSame: true, view })');
    expect(paste.indexOf('this.commitMove([{ ref: anchorId')).toBeLessThan(paste.indexOf('this.ask(plan.command)'));
    expect(paste).toContain('card: geo.box, step: geo.step, overlaps: geo.overlaps');
    expect(paste).toContain('this.pushPaste(memoId, plan.template, ids, moves, askedAt, geo.layout);');
  });
});

describe('六角で押せないもの・形ごとに出すもの', () => {
  it('［整理］と「消したカードの位置が n 件残っています」は、いまの形のファイルだけを数えて出す（六角では文の頭に「六角の並びは、」）', () => {
    const paint = body('private paintToolsBoard() {', 'private paintTagRow(');
    expect(paint).toContain('const tb = tidyButton({ load: this.loaded, replies: snap.replies, busy: this.undoBusy });');
    expect(paint).toContain('this.orphanEl.textContent = orphanNoteText(tb.count, this.shape);');
    expect(paint).toContain('this.orphanEl.hidden = tb.count === 0;');
    expect(code(paint)).not.toContain('tidyBtn.hidden');
    expect(paint).toContain("tidyConfirmMessage(tb.count, this.undo.has(['remove', 'paste']), this.shape)");
    const open = memberBody('openTidy');
    expect(open).toContain('if (!snap) return;');
    expect(open).toContain("tidyConfirmMessage(tb.count, this.undo.has(['remove', 'paste']), this.shape)");
    const run = memberBody('runTidy');
    expect(run).toContain('tidyDoneText(plan.removed, shape)');
    expect(run).toContain("plan.why === 'none' ? tidyNoneNote(shape)");
  });
  it('道具の列の型を貼る・型にするは六角では押せない（toolState に形を渡す）。道具の列から押す道も止める（カードの右クリックの「型を足す…」は別の道。TA2）', () => {
    expect(body('private paintToolsBoard() {', 'private paintTagRow(')).toContain('toolState({ selected: [...this.selected], replies: snap.replies, load: this.loaded, layout: this.shape })');
    expect(memberBody('openTemplate')).toMatch(/if \(this\.shape === 'hex'\) \{\s*this\.flash\(HEX_TEMPLATE_NOTE, 'info'\);/);
    const menu = memberBody('openPasteMenu');
    expect(menu).toContain("const blocked = this.shape === 'hex' ? HEX_PASTE_NOTE : pasteToolNote(this.loaded, snap.replies);");
    // 一覧を読む間（await）に六角へ替えたときも、メニューを出さない
    expect(menu.indexOf("if (this.shape === 'hex') return;")).toBeGreaterThan(menu.indexOf('await hook.list()'));
    expect(menu.indexOf("if (this.shape === 'hex') return;")).toBeLessThan(menu.indexOf('this.getMenu().open('));
  });
  it('書く欄の説明は、四角と六角で同じ字（HX4 の「並びの最後に出る」の字は無い）。形を替えても書く欄の形は描き直さない', () => {
    expect(code(tab)).not.toMatch(/COMPOSE_[A-Z_]*_HEX/);
    expect(code(tab)).not.toContain('並びの最後に');
    expect(code(body('private setShape(next: BoardLayout) {', '// ---------- 写真の行き先と題'))).not.toContain('this.paintComposeShape();');
  });
});

describe('元に戻すの積み：始めたときの形の印（UndoOp の外。形が違えば取り出さない。HX4）', () => {
  it('積むときは、始めたときの形を付ける（既定は今の形。線は結果を待つ間に形を替えられるので始めたときに取っておく）', () => {
    expect(tab).toMatch(/private pushUndo\(op: UndoOp, layout: BoardLayout = this\.shape\) \{\s*this\.undo\.push\(op, layout\);/);
    for (const name of ['chooseKindBoard', 'removeLink']) expect(count(code(memberBody(name)), 'const layout = this.shape;'), name).toBe(1); // 線の 2 つは、送る前に取っておく（readBoard の同じ字は読む形）
    expect(memberBody('chooseKindBoard')).toContain('this.pushUndo({ kind: \'link\', from, to, before, after: kind }, layout);');
    expect(memberBody('removeLink')).toContain("this.pushUndo({ kind: 'link', from: rel.source, to, before: rel.kind, after: null }, layout);");
  });
  it('取り出す前に覗き、形が違えば取り出さずに一言出す。ボタンも形の印で押せなくする', () => {
    const run = memberBody('runUndo');
    expect(run.indexOf('const layout = this.undo.peekLayout(dir);')).toBeGreaterThan(-1);
    expect(run.indexOf('const layout = this.undo.peekLayout(dir);')).toBeLessThan(run.indexOf('const op = this.undo.take(dir);'));
    expect(run).toMatch(/if \(layout !== null && peeked && layout !== this\.shape\) \{\s*this\.flash\(undoLayoutNote\(peeked, dir, layout\), 'info'\);\s*return;\s*\}/);
    expect(body('private paintToolsBoard() {', 'private paintTagRow(')).toContain("layout: { now: this.shape, undo: this.undo.peekLayout('undo'), redo: this.undo.peekLayout('redo') }");
  });
  it('六角で始めた操作も位置を持つ（HX5）：足し直すときはどの形でも位置を待ち、戻した・やり直したカードは始めたときの形のファイルへ書く', () => {
    const run = memberBody('runUndo');
    expect(run).toContain('const shape = this.shape;');
    expect(run.indexOf('const shape = this.shape;')).toBeGreaterThan(run.indexOf('const op = this.undo.take(dir);'));
    expect(run).toContain('this.setPending(op.id, at, token);');
    expect(code(run)).not.toContain('if (!at)');
    expect(count(code(run), 'this.savePlaced(memoId, shape, ')).toBe(3); // 足し直す・消したのを戻す・型を貼り直す
    expect(run).toContain('this.undo.finish(dir, next, version, this.shape);'); // やり直しで作る操作の印は、そのときの形
    expect(tab).toContain('private savePlaced(memoId: string, layout: BoardLayout, moves: readonly NodeMove[], token: number, okText: string, failText: string, opts: { writeSame?: boolean } = {}) {');
  });
  it('位置を戻すだけ（消したのを戻す・型の貼り直し）なら、もうその位置にあれば書かない（足し直しは writeSame で書く）', () => {
    expect(memberBody('savePlaced')).toMatch(/if \(!saved\.changed\) \{\s*if \(this\.memoId === memoId\) this\.flash\(okText, 'info'\);\s*return;\s*\}/);
  });
});

describe('grok-cards.css：六角のカード（HX4 の節）', () => {
  const rules = parseCss(css);
  const at = css.indexOf('/* HX4：正六角のカード');
  const block = css.slice(at);
  const sel = (r: { selector: string }) => r.selector.split(',').map((s) => s.trim());
  // その選択子だけを持つ規則（並べた規則の一つとして書いたものは数えない）の宣言。同じものが二つあれば後ろが勝つ
  const decls = (selector: string, media = '') => {
    const own = rules.filter((r) => (media ? r.at.includes(media) : r.at.length === 0) && sel(r).length === 1 && sel(r)[0] === selector);
    if (own.length === 0) {
      const listed = rules.find((r) => (media ? r.at.includes(media) : r.at.length === 0) && sel(r).includes(selector));
      if (!listed) throw new Error(`見つかりません：${selector}`);
      return Object.fromEntries(listed.decls.map((d) => [d.prop, d.value]));
    }
    return Object.assign({}, ...own.map((r) => Object.fromEntries(r.decls.map((d) => [d.prop, d.value])))) as Record<string, string>;
  };
  const combos = ['', '.is-selected', '.is-dragging', '.is-selected.is-dragging', '.is-link-source', '.is-arrive', '.is-provisional', '.has-thumb'].map((s) => `.memo-board-stage .memo-board-card.is-hex${s}`);
  // 詳しさ（クラス・属性・疑似クラスの数）。ここで使う形（要素名・id なし）だけを数える
  const specificity = (selector: string) => (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;

  it('HX4 の節はファイルの後ろ（四角のカードの規則の全部より後ろ）', () => {
    expect(at).toBeGreaterThan(0);
    const squareRules = rules.filter((r) => r.selector.includes('.memo-board-card') && !r.selector.includes('is-hex'));
    expect(squareRules.length).toBeGreaterThan(10);
    for (const r of squareRules) expect(r.decls[0]?.offset ?? 0, r.selector).toBeLessThan(at);
  });
  it('打ち消し：is-hex とその状態の組の全部に、overflow・枠・角の丸め・地・影・輪・余白・動きを、四角のカードの規則の詳しさの最大以上で', () => {
    const rule = rules.find((r) => r.at.length === 0 && sel(r).includes(combos[0]));
    expect(rule).toBeDefined();
    expect(sel(rule!)).toEqual(combos);
    expect(Object.fromEntries(rule!.decls.map((d) => [d.prop, d.value]))).toEqual({ overflow: 'visible', border: '0', 'border-radius': '0', background: 'none', 'box-shadow': 'none', outline: 'none', padding: '0', animation: 'none' });
    // 四角の規則のうち、カードそのもの（いちばん右の選択子が .memo-board-card…）に、打ち消す性質を書くものの詳しさの最大（@media の中も数える）
    const props = /^(overflow|border|border-[\w-]+|background|background-[\w-]+|box-shadow|outline|outline-[\w-]+|padding|padding-[\w-]+|animation|animation-[\w-]+)$/;
    const squareMax = Math.max(
      ...rules
        .filter((r) => (r.decls[0]?.offset ?? 0) < at && r.decls.some((d) => props.test(d.prop)))
        .flatMap((r) => sel(r))
        .filter((s) => !s.includes('is-hex') && /\.memo-board-card(?![\w-])[^\s]*$/.test(s))
        .map(specificity),
    );
    expect(squareMax).toBeGreaterThanOrEqual(3); // 今は .memo-board-card.is-selected.is-dragging（0,3,0）
    for (const s of sel(rule!)) expect(specificity(s), s).toBeGreaterThanOrEqual(squareMax);
  });
  it('箱は 150×174。div は押せず、多角形の顔だけが押しを受ける（visiblePainted）。svg は外へはみ出して描ける', () => {
    expect(decls('.memo-board-stage .memo-board-card.is-hex')).toMatchObject({ width: '150px', height: '174px', 'pointer-events': 'none', isolation: 'isolate', '--board-card-lines': '5' });
    expect(decls('.memo-board-hex-svg')).toMatchObject({ overflow: 'visible', 'pointer-events': 'none' });
    expect(decls('.memo-board-hex-face')).toMatchObject({ fill: 'var(--surface)', stroke: 'var(--border)', 'stroke-width': '1.5', 'pointer-events': 'visiblePainted' });
    expect(decls('.memo-board-hex-ring')).toMatchObject({ display: 'none', fill: 'none', stroke: 'var(--accent-line)', 'stroke-width': '3', 'pointer-events': 'none' });
  });
  it('選んだカードは上に描き、内側の輪を出す。線の元は顔の縁の破線。足したカードは顔の地を光らせる', () => {
    expect(decls('.memo-board-stage .memo-board-card.is-hex.is-selected')).toEqual({ 'z-index': '1' });
    expect(decls('.memo-board-stage .memo-board-card.is-hex.is-selected .memo-board-hex-ring')).toEqual({ display: 'inline' });
    expect(decls('.memo-board-stage .memo-board-card.is-hex.is-link-source .memo-board-hex-face')).toMatchObject({ stroke: 'var(--accent-line)', 'stroke-dasharray': '3 2' });
    expect(decls('.memo-board-stage .memo-board-card.is-hex.is-arrive .memo-board-hex-face')).toEqual({ animation: `memo-board-hex-arrive ${ARRIVAL_FLASH_MS / 1000}s ease-out` }); // 光る長さは四角と同じ（ARRIVAL_FLASH_MS）
  });
  it('文の流し込みは別のセレクタ（.memo-board-card-flow のままの規則は一つ）。写真は真ん中に 72×96（上から 39）', () => {
    expect(decls('.memo-board-card.is-hex .memo-board-card-flow')).toMatchObject({ 'max-width': '100%' });
    expect(rules.filter((r) => r.selector === '.memo-board-card-flow')).toHaveLength(1);
    expect(decls('.memo-board-card.is-hex .memo-board-card-thumb')).toEqual({ left: '39px', top: '39px', width: '72px', height: '96px' });
    expect(decls('.memo-board-card.is-hex.has-thumb .memo-board-hex-top')).toMatchObject({ top: '27px' });
  });
  it('上と下の三角の 1 行：中央寄せの固定の箱（幅 82）。上は入らない印を次の行へ回して隠す、下は折り返さない。タグは 56px で「…」', () => {
    expect(decls('.memo-board-hex-top')).toMatchObject({ top: '30px', 'flex-wrap': 'wrap' });
    expect(decls('.memo-board-hex-bottom')).toMatchObject({ top: '131px', 'flex-wrap': 'nowrap' });
    const both = rules.find((r) => r.at.length === 0 && sel(r).join(',') === '.memo-board-hex-top,.memo-board-hex-bottom');
    expect(Object.fromEntries((both?.decls ?? []).map((d) => [d.prop, d.value]))).toMatchObject({ position: 'absolute', left: '34px', width: '82px', height: '12px', overflow: 'hidden', 'justify-content': 'center', 'font-size': '10px' });
    expect(decls('.memo-board-hex-tag')).toMatchObject({ 'max-width': '56px', 'text-overflow': 'ellipsis', overflow: 'hidden' });
    expect(decls('.memo-board-hex-title')).toMatchObject({ 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis' }); // 写真の題も行の箱の幅で「…」
  });
  it('動きを減らす設定の規則は別の @media の塊（四角の塊は一つの規則のまま）', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.memo-board-card\.is-arrive \{\n    animation: none;\n    outline: 2px solid var\(--accent-line\);\n  \}\n\}/);
    expect(decls('.memo-board-stage .memo-board-card.is-hex.is-arrive .memo-board-hex-face', '@media (prefers-reduced-motion: reduce)')).toMatchObject({ animation: 'none', stroke: 'var(--accent-line)' });
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.memo-board-stage \.memo-board-card\.is-hex\.is-arrive \.memo-board-hex-face \{/);
  });
  it('強制色：顔は Canvas／CanvasText、選びの輪と線の元は Highlight', () => {
    expect(decls('.memo-board-stage .memo-board-card.is-hex .memo-board-hex-face', '@media (forced-colors: active)')).toEqual({ fill: 'Canvas', stroke: 'CanvasText' });
    expect(decls('.memo-board-stage .memo-board-card.is-hex .memo-board-hex-ring', '@media (forced-colors: active)')).toEqual({ stroke: 'Highlight' });
    expect(decls('.memo-board-stage .memo-board-card.is-hex.is-link-source .memo-board-hex-face', '@media (forced-colors: active)')).toEqual({ stroke: 'Highlight' });
  });
  it('色は今のテーマの変数だけ（直書き・名前の色・oklch を使わない）。切り替えのボタンの押している見た目も同じ変数', () => {
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|:\s*(white|black|gray|grey|red|blue|green)\b/);
    const vars = new Set([...block.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]));
    expect([...vars].sort()).toEqual(['--accent-ink', '--accent-line', '--accent-soft', '--border', '--muted', '--shell-focus', '--surface', '--text']);
    expect(decls('.memo-board-shape[aria-pressed=\'true\']')).toEqual({ 'border-color': 'var(--accent-line)', background: 'var(--accent-soft)', color: 'var(--accent-ink)', 'font-weight': '700' });
    expect(decls('.memo-board-tool.memo-board-shape-tool[aria-pressed=\'true\']')).toEqual({ 'border-color': 'var(--accent-line)', background: 'var(--accent-soft)', color: 'var(--accent-ink)', 'font-weight': '700' });
  });
});
