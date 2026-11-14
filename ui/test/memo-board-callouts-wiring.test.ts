// 段 MK8a・MK8b：吹き出しの層と配線（docs/plan-comment-board-marks.md §4.8）。ソースの形の確かめ（層 BoardCallouts を偽物の DOM で動かす確かめは memo-board-callouts.test.ts。tab の配線はここの字面だけ）
//   層の置き場（面の子で縮む層のすぐ後ろ）・出す時（［全体］）・隠す時（見ている位置が実際に替わった・つまむ・範囲選択・滑らせる）・置き直す時（止まって 400ms 後・面の大きさ・写し・絞り・📌）・
//   消す時（間の終わり）・applyView では受けない・押せるのは頭と「＋n」だけ・字は textContent だけ・CSS の値
//   MK8b：頭の押し（選ぶ・ダブルクリックで跳ぶ・右クリックでそのカードのメニュー）・「＋n」で次の組・右上の札・番号の小札・写真の絵・選んだ見た目・📌 の口・［全体］の始めの印
//   見た目（重なりの順・2 行で切れるか・字の幅・小札・輪）と、アプリの中で時計で隠して置き直す動き・押したときの動き（タグの行で面が低くなる所も）は、開発の画面と Windows の確かめ（確かめ C の 2〜4）。まだ見ていない
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { code } from './helpers';
import { parseCss } from './theme-css';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tab = read('../src/app/memo-board-tab.ts');
const layer = read('../src/app/memo-board-callouts.ts');
const pure = read('../src/memo-card-board-callouts.ts');
const css = read('../src/grok-cards.css');
const count = (s: string, part: string) => s.split(part).length - 1;
const between = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`見つかりません：${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`見つかりません：${to}`);
  return src.slice(a, b);
};
// 字が順に出てくる（どれかが無い・順が違えば落ちる）
const inOrder = (src: string, parts: readonly string[]) => {
  let at = -1;
  for (const p of parts) {
    const i = src.indexOf(p, at + 1);
    expect(i, p).toBeGreaterThan(at);
    at = i;
  }
};

describe('層の置き場（tab）', () => {
  it('層は面（stage）の子で、縮む層（world）のすぐ後ろ、範囲選択の枠より前（z を付けずに 縮む層＜吹き出し＜範囲選択の枠＜📌 の層）', () => {
    expect(tab).toContain('this.stage.append(this.world, this.callouts.layer, this.marqueeEl, this.emptyText);');
    expect(tab).toContain('this.root.append(this.pinLayer);'); // 📌 の層は面の外（root の子。上に重なる）のまま
    expect(count(code(tab), 'new BoardCallouts(')).toBe(1);
    // MK8b：時計の置き直しに加えて、頭の押しの口（選ぶ・跳ぶ・メニュー）を渡す
    expect(tab).toContain('private readonly callouts = new BoardCallouts({ paint: () => this.paintCallouts(), pick: (id) => this.pickCallout(id), jump: (id) => this.jumpToCallout(id), menu: (id, x, y, byKey) => this.calloutMenu(id, x, y, byKey) });');
  });
});

describe('出す・隠す・置き直す・消す（tab）', () => {
  const paint = between(tab, 'private paintCallouts(now = false) {', 'private pickCallout(');
  it('置く道は一つ（paintCallouts）：間でない・隠れているなら消す。止まるのを待っている間は時計に任せる（［全体］のときだけ待たない）。つまむ・範囲選択・パンの途中なら隠したまま待ち直す（押しただけのパン・枠の出ていない範囲選択は数えない）', () => {
    inOrder(paint, [
      'if (!this.overview || this.hidden) {',
      'this.callouts.clear();',
      'return;',
      'if (this.callouts.waiting && !now) return;',
      'const panMoved = this.pan !== null && (this.pan.x !== this.pan.sx || this.pan.y !== this.pan.sy);',
      'if (this.drag?.moved || (this.marquee && !this.marqueeEl.hidden) || panMoved) {',
      'this.callouts.later();',
      'return;',
      'this.callouts.show(',
    ]);
  });
  it('中身：描いているカード（描いている位置 this.pos・印・作った時刻）・面の大きさ・形の箱・最後に書いた順・薄くしたカード（dimmedIds）と 📌 で留めたカード（MK8b）・小札の点（geo.badge。MK8b）・文の頭（calloutText）と字の無いカードの絵（calloutShot。MK8b）', () => {
    expect(paint).toContain('const at = this.pos.get(f.id) ?? f;');
    expect(paint).toContain('{ id: f.id, x: at.x, y: at.y, like: f.like, color: f.color, createdAt: byId.get(f.id)?.createdAt ?? 0 }');
    inOrder(paint, ['const exclude = dimmedIds(replies, this.filterTag, this.words);', 'for (const id of this.pins.openIds(this.memoId)) exclude.add(id);', 'this.callouts.show(']);
    expect(paint).toContain('this.callouts.show({ view: this.view, viewport: this.viewport(), box: this.geo.box, cards, recent: recentTops(replies), exclude, badge: this.geo.badge }, (id) => {');
    expect(paint).toContain('const thumbs = new Map(this.faces.map((f) => [f.id, f.thumb]));');
    inOrder(paint, ["const text = reply ? calloutText(reply) : '';", "const shot = calloutShot(text, thumbs.get(id) ?? '');", 'return { text, shot, url: shot ? this.faceUrls.get(shot) : undefined };']);
    expect(code(paint)).not.toContain('this.view = '); // 見ている位置は替えない（保存の決まり opening.test.ts:81-95 の外）
  });
  it('出す：［全体］の終わり（覚える・借りる・合わせる・保存の待ちのあと。待たずに）', () => {
    const fit = between(tab, 'private fit() {', 'private actualSize() {');
    inOrder(fit, ['this.applyView();', 'this.touchView();', 'this.paintCallouts(true);']);
  });
  it('隠す：見ている位置が実際に替わったとき（touchView で、置いたときの位置と比べる。パン・矢印・ホイールの移動・滑らせる）。読めない・読み込み中で先に返る所より前', () => {
    const touch = between(tab, 'private touchView() {', 'private armViewTimer(');
    expect(touch).toContain('if (this.overview && this.callouts.movedFrom(this.view)) this.callouts.later();');
    expect(touch.indexOf('this.callouts.movedFrom(')).toBeLessThan(touch.indexOf('return;'));
  });
  it('隠す：つまんで動かし始めたとき（moveDrag の d.moved）・範囲選択の枠が出たとき（moveMarquee。Shift で押しただけの startMarquee では隠さない）', () => {
    const move = between(tab, 'private moveDrag(', 'private dragPoint(');
    expect(move).toMatch(/d\.moved = true;[\s\S]*?this\.dropComposeShift\(\);[^\n]*\n\s*if \(this\.overview\) this\.callouts\.later\(\);/);
    expect(between(tab, 'private startMarquee(', 'private moveMarquee(')).not.toContain('callouts');
    const marquee = between(tab, 'private moveMarquee(', 'private finishMarquee(');
    inOrder(marquee, ['const past = pastThreshold({ dx: r.w, dy: r.h });', 'if (past && this.marqueeEl.hidden && this.overview) this.callouts.later();', 'this.marqueeEl.hidden = !past;']);
  });
  it('置き直す（隠さない）：面の大きさが替わったとき（ResizeObserver。📌 と札のあいだ）・写しや絞り・検索が替わったとき（paintDim の終わり。renderBoard も通る）', () => {
    const ro = between(tab, 'new ResizeObserver(() => {', '}).observe(this.stage);');
    inOrder(ro, ['this.pins.place();', 'this.paintCallouts();', 'this.paintArrivals();', 'this.takeFocus();']);
    const dim = between(tab, 'private paintDim() {', '// ---------- 見ている位置');
    expect(dim).toMatch(/this\.paintCallouts\(\);[^\n]*\n\s*\}\s*$/);
    expect(between(tab, 'private renderBoard(', 'private build(')).toContain('this.paintDim();');
  });
  it('applyView では受けない（描き直しのたびに隠さない）', () => {
    expect(between(tab, 'private applyView() {', 'private paintZoom() {')).not.toContain('callouts');
    expect(between(tab, 'private applyView() {', 'private paintZoom() {')).not.toContain('paintCallouts');
  });
  it('消す：「［全体］の間」の終わり（どの理由でも。間でなければ何もしない所より後ろ、間を下ろす前）', () => {
    const end = between(tab, 'private endOverview(reason: OverviewEnd) {', 'private giveBackUpper(');
    inOrder(end, ['if (!o) return;', 'this.callouts.clear();', 'this.overview = null;']);
  });
  it('呼ぶ所の数：置く道 5（時計と「＋n」の口・面の大きさ・paintDim・［全体］・📌 の onChange。MK8b で 📌 を足した）、隠して待つ 4（touchView・moveDrag・moveMarquee・paintCallouts の中）、消す 2（endOverview・paintCallouts の中）', () => {
    const c = code(tab);
    expect(count(c, 'this.paintCallouts(')).toBe(5);
    expect(count(c, 'this.callouts.later();')).toBe(4);
    expect(count(c, 'this.callouts.clear();')).toBe(2);
    expect(count(c, 'this.callouts.show(')).toBe(1);
  });
});

describe('MK8b：頭の押し・📌・絵・選んだ見た目（tab）', () => {
  it('📌 の口：留めたカードの組が替わったら置き直す（onChange。省いてよい口）', () => {
    expect(tab).toContain("area: () => this.pinArea(), onChange: () => this.paintCallouts() });");
    expect(count(code(tab), 'new BoardPins(')).toBe(1);
  });
  it('左クリック：そのカードを選ぶだけ（選んだ見た目では作り直さない。つまむ・範囲選択・パン・線を引く途中は何もしない）', () => {
    const pick = between(tab, 'private pickCallout(id: string) {', 'private jumpToCallout(');
    expect(pick).toMatch(/if \(this\.drag \|\| this\.marquee \|\| this\.pan \|\| this\.linkFrom !== null \|\| !this\.pos\.has\(id\)\) return;\s*this\.setSelected\(new Set\(\[id\]\)\);\s*\}/);
  });
  it('ダブルクリック：選ぶ → endOverview(jump)（戻らない。借りた高さは戻す）→ ％の受け口 actualSize（1 枚を選んでいるので 100% で真ん中に）。つまむ・範囲選択・パン・線を引く途中は何もしない', () => {
    const jump = between(tab, 'private jumpToCallout(id: string) {', 'private calloutMenu(');
    expect(jump).toMatch(/^private jumpToCallout\(id: string\) \{\s*if \(!this\.overview \|\| this\.drag \|\| this\.marquee \|\| this\.pan \|\| this\.linkFrom !== null \|\| !this\.pos\.has\(id\)\) return;/);
    inOrder(jump, ['this.setSelected(new Set([id]));', "this.endOverview('jump');", 'this.actualSize();']);
    expect(code(jump)).not.toContain('this.view = '); // 見ている位置は ％の受け口が替える（保存も）
  });
  it('右クリック：onContextMenu と同じ止め（つまむ・範囲選択・パン・線を引く途中。メニューキーは書く欄などの小窓・メニューが開いている間も）を通し、選びの外なら選び直して、そのカードのメニュー（空きのメニューへ行かない）', () => {
    const menu = between(tab, 'private calloutMenu(id: string, x: number, y: number, byKey: boolean) {', '// ---------- 右の検索の［上で開く］');
    inOrder(menu, ['if (this.drag || this.marquee || this.pan) return;', 'if (this.linkFrom !== null) {', 'this.cancelLink();', 'return;', 'if (byKey && (this.modalOpen || this.menu?.isOpen)) return;', 'if (!this.selected.has(id)) this.setSelected(new Set([id]));', 'this.openCardMenu(id, x, y, null);', 'if (byKey) this.menu?.focusFirst();']);
    // 面のキーの道（onContextMenu のキーの枝）と同じ止め
    expect(between(tab, 'private onContextMenu(e: MouseEvent) {', 'const line = lineOfHit(target);')).toContain('if (!this.modalOpen && !this.menu?.isOpen) this.openMenuByKey();');
    expect(menu).not.toContain('openBoardMenu');
    expect(menu).not.toContain('menuAnchor');
    // 面の右クリックの受け口（root の 1 本）は替えていない。頭の右クリックは層（app/memo-board-callouts.ts）で受ける
    expect(count(code(tab), "this.root.addEventListener('contextmenu'")).toBe(1);
    expect(code(tab)).not.toMatch(/callouts?\.[\w.]*addEventListener/);
  });
  it('面の pointerdown：ボタン（頭・席の「＋n」）と押せない右上の札（.memo-board-callout-more）の上で戻る（パン・範囲選択・選びを外すを始めない）', () => {
    const down = between(tab, "this.stage.addEventListener('pointerdown', (e) => {", "this.stage.addEventListener('pointermove'");
    expect(down).toContain("if (e.target instanceof Element && e.target.closest('input, button, select, .memo-board-callout-more')) return;");
    expect(down.indexOf(".memo-board-callout-more')) return;")).toBeLessThan(down.indexOf('this.startMarquee(e);'));
  });
  it('dblclick と面の click の受け口は tab に足さない（頭の受け口は app/memo-board-callouts.ts）', () => {
    expect(tab).not.toContain("addEventListener('dblclick'");
    expect(tab).not.toMatch(/stage\.addEventListener\('click'/);
    expect(layer).not.toContain("addEventListener('dblclick'");
  });
  it('選んだ見た目：paintSelect で、作り直さずに頭の class を切り替える（カードの is-selected のすぐ後ろ）', () => {
    const sel = between(tab, 'private paintSelect() {', 'private paintFacts() {');
    inOrder(sel, ["for (const [id, node] of this.cardEls) node.classList.toggle('is-selected', this.selected.has(id));", 'this.callouts.paintSelected(this.selected);']);
    expect(count(code(tab), 'this.callouts.paintSelected(')).toBe(1);
  });
  it('絵：顔の絵が読めたとき（loadFace。カードの img を替える所）に、吹き出しの img も替える', () => {
    const load = between(tab, 'private loadFace(shot: string) {', '// ---------- 吹き出し');
    inOrder(load, ['this.faceUrls.set(shot, url);', 'if (img) img.src = url;', 'this.callouts.setPicture(shot, url);', '} else {']);
  });
  it('［全体］の始め：印のカードがあるか（hasCalloutMark）を渡す（全体の位置が今と同じでも始める。MK8a の記録の (c)）', () => {
    expect(between(tab, 'private fit() {', 'private actualSize() {')).toContain('marked: this.faces.some(hasCalloutMark) });');
  });
});

describe('層（app/memo-board-callouts.ts）', () => {
  it('層ははじめ隠す。置くたびに時計を消し、置いたときの見ている位置を覚える。中身が同じなら作り直さない（番号の小札は置くたびに作り直す。MK8b）', () => {
    expect(layer).toContain("readonly layer = el('div', 'memo-board-callouts');");
    expect(between(layer, 'constructor(', '\n  }\n')).toContain('this.layer.hidden = true;');
    const show = between(layer, 'show(input: CalloutInput, content: (id: string) => CalloutContent): void {', '\n  }\n');
    inOrder(show, [
      'window.clearTimeout(this.timer);',
      'this.timer = 0;',
      // MK8b：頭を押してからダブルクリックの間は、見ている位置が同じなら作り直さない（時計で置き直す。隠さない）
      'const hold = this.holdUntil - Date.now();',
      'if (hold > 0 && !this.layer.hidden && !this.movedFrom(input.view)) {',
      'this.timer = window.setTimeout(() => {',
      'this.deps.paint();',
      '}, hold);',
      'return;',
      'this.holdUntil = 0;',
      'this.at = { ...input.view };',
      'calloutLayout(input, this.order, this.page, this.keep)',
      'this.order = layout.order;',
      'this.page = layout.page;',
      'this.badgeBox.replaceChildren(...layout.badges.map((b) => this.badgeEl(b)));', // 小札は鍵より前（見ている位置で動く。押しを受けない）
      'this.layer.hidden = items.length === 0 && layout.more === null && layout.corner === 0;', // 層を見せるのはここだけ（中身が同じでも、later で隠した層を見せ直す）
      'if (key === this.key) return;',
      'const focused = this.focusedPart();', // 作り直す前に焦点を覚える
      'this.layer.replaceChildren(this.badgeBox, ...nodes);', // 小札の入れ物が頭（吹き出しより下に描く）
      'this.paintSelected(this.picked);', // 作り直したら、選んだ見た目を当て直す
      'back?.focus({ preventScroll: true });', // 焦点を戻す
    ]);
    expect(code(layer)).not.toMatch(/\bgen\b/); // 作り直しの回数では数えない（ダブルクリックの間は作り直さないので要らない）
    expect(count(code(layer), 'this.layer.hidden = true;')).toBe(3); // 作るとき・later・clear は隠す
    expect(count(code(layer), 'this.layer.hidden = ')).toBe(4); // 見せられるのは show の 1 行だけ
  });
  it('鍵（作り直すか）：吹き出しの中身・席・「＋n」・右上の札・面の幅。選んだ見た目と絵の data: は入れない（MK8a の記録の「MK8b へ」）', () => {
    const show = between(layer, 'show(input: CalloutInput, content: (id: string) => CalloutContent): void {', '\n  }\n');
    expect(show).toContain('return { ...item, head: calloutHead(item.n, item.like, item.color), text: c.text, shot: c.shot };');
    expect(show).toContain('const key = JSON.stringify([items, layout.more, layout.corner, input.viewport.w]);');
    expect(code(show.slice(0, show.indexOf('const key = ')))).not.toMatch(/picked|selected|url: c\.url/);
  });
  it('止まってから置き直す時計は 400ms（CALLOUT_WAIT_MS）。呼ぶたびに待ち直し、待つ間は隠す', () => {
    const later = between(layer, 'later(): void {', '\n  }\n');
    inOrder(later, ['this.layer.hidden = true;', 'window.clearTimeout(this.timer);', 'this.timer = window.setTimeout(', 'this.timer = 0;', 'this.deps.paint();', '}, CALLOUT_WAIT_MS);']);
  });
  it('実際に替わったか：置いたときの位置と、倍率と x・y をそのまま比べる（置いていなければ替わっていない）', () => {
    const moved = between(layer, 'movedFrom(view: BoardView): boolean {', '\n  }\n');
    expect(moved).toContain('return at !== null && (at.x !== view.x || at.y !== view.y || at.zoom !== view.zoom);');
  });
  it('消す：時計・置いた位置・順・組・出したい組のカード・鍵・頭の押しの数えと待ちを捨て、中を空にして隠す', () => {
    const clear = between(layer, 'clear(): void {', '\n  }\n');
    for (const part of ['window.clearTimeout(this.timer);', 'this.timer = 0;', 'this.at = null;', 'this.order = null;', 'this.page = 0;', 'this.keep = null;', "this.key = '';", 'this.tap = null;', 'this.holdUntil = 0;', 'this.heads.clear();', 'this.more = null;', 'this.layer.replaceChildren();', 'this.layer.hidden = true;']) expect(clear, part).toContain(part);
  });
  it('字は textContent だけ（el の第 3 引数・createTextNode・title）。HTML の字を入れない。class 名に四角のカードの名前を使わない。§9.2 に無い字（頭・小札の説明）を足さない', () => {
    expect(layer).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(layer).toContain("const head = el('button', 'memo-board-callout-head', text);");
    expect(layer).toContain('body.append(this.headEl(item.id, item.head));');
    expect(layer).toContain('if (item.text) body.append(document.createTextNode(item.text));');
    expect(layer).toContain("const node = el('button', 'memo-board-callout-more', calloutMoreText(n));");
    expect(layer).toContain("const corner = el('div', 'memo-board-callout-more', calloutMoreText(n));");
    expect(count(code(layer), '.title = calloutMoreTitle(n);')).toBe(2); // 席の「＋n」と右上の札。ほかに title は付けない
    expect(count(code(layer), '.title = ')).toBe(2);
    expect(code(layer)).not.toContain('aria-label');
    expect(layer).toContain("img.alt = '';");
    expect(layer).toContain("const node = el('span', 'memo-board-callout-badge', String(b.n));");
    expect(layer).not.toContain('memo-board-card');
    expect(pure).not.toContain('memo-board-card-');
  });
  it('右上の札は面の右上（上の余白 6・右の 8）。押せない（click の受け口が無い）。席の「＋n」は最後の席', () => {
    const corner = between(layer, 'private cornerEl(n: number): HTMLElement {', '\n  }\n');
    expect(corner).toContain("corner.classList.add('is-corner');");
    expect(corner).toContain('corner.style.top = `${CALLOUT.pad}px`;');
    expect(corner).toContain('corner.style.right = `${CALLOUT.inset}px`;');
    expect(corner).not.toContain("addEventListener('click'");
    expect(layer).toContain('if (layout.more) nodes.push(this.moreEl(layout.more.n, layout.more));');
    expect(layer).toContain('if (layout.corner > 0) nodes.push(this.cornerEl(layout.corner));');
  });
});

describe('MK8b：頭・「＋n」の受け口・小札・絵（app/memo-board-callouts.ts）', () => {
  it('頭はボタン：押しで焦点を取らない（pointerdown の preventDefault）。click で数える（dblclick は使わない）。右クリックは止めて（既定の動きと伝わり）、そのカードのメニューの口へ', () => {
    const head = between(layer, 'private headEl(id: string, text: string): HTMLButtonElement {', '\n  }\n');
    inOrder(head, [
      "head.type = 'button';",
      "head.addEventListener('pointerdown', (e) => e.preventDefault());",
      "head.addEventListener('click', () => this.press(id));",
      "head.addEventListener('contextmenu', (e) => {",
      'e.preventDefault();',
      'e.stopPropagation();',
      'const byKey = isKeyboardMenu(e);',
      'this.deps.menu(id, r ? r.right : e.clientX, r ? r.top : e.clientY, byKey);',
      'this.heads.set(id, head);',
    ]);
    expect(head).not.toContain("'wheel'"); // ホイールとピンチは止めない（面の受け口へ届く）
    expect(code(layer)).not.toContain("'wheel'");
  });
  it('頭の左クリック：calloutTap でダブルクリックならそのカードへ跳ぶ（jump）。そうでなければ選ぶ（pick）。1 回目からダブルクリックの間は作り直さない（holdUntil）。押したカードの組を出す（keep）', () => {
    const press = between(layer, 'private press(id: string): void {', '\n  }\n');
    inOrder(press, ['const t = calloutTap(this.tap, { id, at: Date.now() });', 'this.tap = t.next;', 'this.holdUntil = t.next ? t.next.at + PEEK_DOUBLE_MS : 0;', 'this.keep = id;', 'if (t.jump !== null) this.deps.jump(t.jump);', 'else this.deps.pick(id);']);
  });
  it('選んだ見た目：id から頭を引いて class を切り替える（作り直さない）', () => {
    const sel = between(layer, 'paintSelected(selected: ReadonlySet<string>): void {', '\n  }\n');
    expect(sel).toContain("for (const [id, head] of this.heads) head.classList.toggle('is-selected', this.picked.has(id));");
    expect(sel).not.toContain('replaceChildren');
  });
  it('席の「＋n」はボタン：押しで焦点を取らない。押すと、頭を押した間の待ち・数え・出したい組のカードを捨て、組の番を進めてすぐ置き直す（最後の組のあとは calloutPage が頭の組へ回す）', () => {
    const more = between(layer, 'private moreEl(n: number, r: CalloutRect): HTMLElement {', '\n  }\n');
    inOrder(more, [
      "node.type = 'button';",
      'node.title = calloutMoreTitle(n);',
      'placeAt(node, r);',
      "node.addEventListener('pointerdown', (e) => e.preventDefault());",
      "node.addEventListener('click', () => {",
      'window.clearTimeout(this.timer);',
      'this.timer = 0;',
      'this.holdUntil = 0;',
      'this.tap = null;',
      'this.keep = null;',
      'this.page += 1;',
      'this.deps.paint();',
      'this.more = node;',
    ]);
  });
  it('「＋n」の上の右クリックは何もしない（席の「＋n」と右上の札）', () => {
    expect(count(code(layer), 'this.quietMenu(')).toBe(2);
    const quiet = between(layer, 'private quietMenu(node: HTMLElement): void {', '\n  }\n');
    inOrder(quiet, ["node.addEventListener('contextmenu', (e) => {", 'e.preventDefault();', 'e.stopPropagation();']);
  });
  it('絵：字の無いカードだけ。読めていなければ隠して頭だけ。読めたら setPicture で、作り直さずに入れる', () => {
    const pic = between(layer, 'private pictureEl(shot: string, url: string | undefined): HTMLImageElement {', '\n  }\n');
    inOrder(pic, ["const img = el('img', 'memo-board-callout-picture');", 'img.dataset.shot = shot;', 'if (url) img.src = url;', 'img.hidden = !url;']);
    expect(layer).toMatch(/if \(item\.shot\) \{\s*box\.classList\.add\('has-picture'\);\s*box\.append\(this\.pictureEl\(item\.shot, urls\.get\(item\.id\)\)\);\s*\}/);
    const set = between(layer, 'setPicture(shot: string, url: string): void {', '\n  }\n');
    inOrder(set, ["this.layer.querySelectorAll<HTMLImageElement>('.memo-board-callout-picture')", 'if (img.dataset.shot !== shot) continue;', 'img.src = url;', 'img.hidden = false;']);
  });
  it('小札は読み上げない（番号は頭と同じ）', () => {
    expect(between(layer, 'constructor(', '\n  }\n')).toContain("this.badgeBox.setAttribute('aria-hidden', 'true');");
  });
});

describe('CSS（grok-cards.css の末尾）', () => {
  const rules = parseCss(css);
  const decls = (selector: string) => {
    const own = rules.filter((r) => r.at.length === 0 && r.selector === selector);
    if (own.length === 0) throw new Error(`見つかりません：${selector}`);
    return Object.assign({}, ...own.map((r) => Object.fromEntries(r.decls.map((d) => [d.prop, d.value])))) as Record<string, string>;
  };
  it('層：面いっぱいに重ね、押しを受けない。z は付けない（縮む層の後ろに置いた順で重なる）。display を書かない（hidden で隠す）', () => {
    const d = decls('.memo-board-callouts');
    expect(d).toEqual({ position: 'absolute', inset: '0', 'pointer-events': 'none' });
  });
  it('吹き出し：地 --surface・縁 1px --border・角 6・字 12px・高さ 44・字の色 --text。体は押しを受けない', () => {
    expect(decls('.memo-board-callout')).toMatchObject({ position: 'absolute', height: '44px', border: '1px solid var(--border)', 'border-radius': '6px', background: 'var(--surface)', color: 'var(--text)', 'font-size': '12px', overflow: 'hidden', 'pointer-events': 'none' });
    expect(decls('.memo-board-callout-text')).toMatchObject({ display: '-webkit-box', overflow: 'hidden', '-webkit-box-orient': 'vertical', '-webkit-line-clamp': '2' });
    // MK8b：頭はボタン（字の大きさは吹き出しのまま・太字・押しを受ける）。「＋n」も押しを受ける（右上の札は乗せたとき説明が出るように）
    const head = decls('.memo-board-callout-head');
    expect(head).toMatchObject({ color: 'var(--text)', 'font-weight': '700', font: 'inherit', border: '0', background: 'none', cursor: 'pointer', 'pointer-events': 'auto' });
    // 全体の button の規則（style.css の高さ 28・幅 28）を打ち消す（28 のままだと 1 行目が伸びて 2 行目が切れる。📌 の ✕ と同じ）
    expect(head).toMatchObject({ height: 'auto', 'min-width': '0' });
    const headRule = rules.find((r) => r.at.length === 0 && r.selector === '.memo-board-callout-head')!;
    const props = headRule.decls.map((d) => d.prop);
    expect(props.indexOf('font')).toBeLessThan(props.indexOf('font-weight')); // font の一括のあとに太字（一括が太字を消さないように）
    expect(decls('.memo-board-callout-more')).toMatchObject({ border: '1px dashed var(--border)', background: 'var(--surface)', color: 'var(--text)', 'font-family': 'inherit', cursor: 'pointer', 'pointer-events': 'auto' });
    expect(decls('.memo-board-callout-more.is-corner')).toMatchObject({ cursor: 'default' });
  });
  it('MK8b：番号の小札は直径 14 の丸（地 --text・字 --surface・字 10px の太字）。中心を点に合わせ、押しを受けない', () => {
    expect(decls('.memo-board-callout-badge')).toMatchObject({ position: 'absolute', 'min-width': '14px', height: '14px', 'border-radius': '7px', background: 'var(--text)', color: 'var(--surface)', 'font-size': '10px', 'font-weight': '700', 'line-height': '14px', transform: 'translate(-50%, -50%)', 'pointer-events': 'none' });
  });
  it('MK8b：選んだ頭（--accent-soft の地・--accent-ink の字・--accent-line の輪）・焦点の輪・写真の絵（高さ 34。押しを受けない）', () => {
    // 輪は内側（頭は文の箱の左上にあり、箱も吹き出しもはみ出しを切る）。選んだ頭に乗せても地は選んだまま（全体の button:hover の地より詳しく）
    expect(decls('.memo-board-callout-head.is-selected')).toEqual({ background: 'var(--accent-soft)', color: 'var(--accent-ink)', 'box-shadow': 'inset 0 0 0 1px var(--accent-line)' });
    expect(decls('.memo-board-callout-head.is-selected:hover')).toEqual({ background: 'var(--accent-soft)' });
    const focus = rules.find((r) => r.at.length === 0 && r.selector.includes('.memo-board-callout-head:focus-visible'));
    expect(focus?.selector).toContain('.memo-board-callout-more:focus-visible');
    expect(Object.fromEntries(focus!.decls.map((d) => [d.prop, d.value]))).toMatchObject({ outline: '2px solid var(--shell-focus)', 'outline-offset': '-2px' });
    expect(decls('.memo-board-callout.has-picture')).toMatchObject({ display: 'flex', 'align-items': 'center' });
    expect(decls('.memo-board-callout-picture')).toMatchObject({ height: '34px', 'object-fit': 'cover', 'pointer-events': 'none' });
  });
  it('MK8b：強制色では、小札に縁、選んだ頭に輪（地と影が消えるため）', () => {
    const forced = (selector: string) => Object.fromEntries((rules.find((r) => r.at.some((a) => a.includes('forced-colors: active')) && r.selector === selector)?.decls ?? []).map((d) => [d.prop, d.value]));
    expect(forced('.memo-board-callout-badge')).toEqual({ border: '1px solid CanvasText' });
    expect(forced('.memo-board-callout-head.is-selected')).toEqual({ outline: '2px solid Highlight', 'outline-offset': '-2px' });
  });
  it('吹き出しの規則は、四角のカードの名前を含まない・z-index を書かない・色はテーマの変数だけ', () => {
    const own = rules.filter((r) => r.selector.includes('memo-board-callout'));
    expect(own.length).toBeGreaterThanOrEqual(5);
    for (const r of own) {
      expect(r.selector, r.selector).not.toContain('.memo-board-card');
      expect(r.decls.map((d) => d.prop), r.selector).not.toContain('z-index');
      for (const d of r.decls) expect(d.value, `${r.selector} ${d.prop}`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
    }
  });
});
