// 段 HX1：開いたら最後に書いた辺りを読める大きさで。tab の配線を、ソースを読んで確かめる
//   決まりの計算（openingView・viewAfterShow・settleView・actualSizeView）は memo-card-board-view.test.ts
//   DOM の動き（畳んだときにカードが画面の上で止まる・置き場の替え・隠して出す・ボタンの焦点）は Windows の確かめ（計画書 §8.1 の確かめ A）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ZOOM_TITLE, zoomTexts } from '../src/memo-card-board-overview';
import { parseCss } from './theme-css';

const tab = readFile(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = readFile(new URL('../src/grok-cards.css', import.meta.url), 'utf8');

// from から to の手前まで。どちらかが見つからなければ throw（中身の無い確かめにしない）
const body = (from: string, to: string) => {
  const a = tab.indexOf(from);
  if (a < 0) throw new Error(`見つかりません：${from}`);
  const b = tab.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`見つかりません：${to}`);
  return tab.slice(a, b);
};

// クラスの一段目（字下げ 2）の宣言の名前と位置。this.view を書き換える所が、どの宣言の中かを見る
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
const sites = [...tab.matchAll(/this\.view = /g)].map((m) => ({ at: m.index ?? 0, name: memberAt(m.index ?? 0) }));

describe('開いたとき（needFit の所）', () => {
  const render = body('private renderBoard(', 'private build(');
  const open = render.slice(render.indexOf('if (this.needFit && this.loaded !== null) {'), render.indexOf('this.applyView();'));
  it('initialView の代わりに openingView を呼ぶ（上か下か、いまの形のファイルの読み込み、形ごとの読む箱と最後に書いた辺り、覚えた位置を渡す。HX4・HX5）', () => {
    expect(open.length).toBeGreaterThan(100);
    // this.loaded はいまの形のファイルの読み込み（四角は boards/、六角は boards-hex/。HX5）：決まり 1 はその形のファイルの見ている位置
    expect(open).toContain('openingView(this.loaded, replies, faces, composeOpen ? this.closedViewport() : vp, { place: this.place, readBox: this.readBox, recent: this.geo.recent, saved })');
    expect(tab).not.toContain('shapeLoad');
    expect(tab).not.toContain('initialView');
  });
  it('覚えた位置（形を替えたときはその形の覚え、六角でメモを開き直したときは六角の覚え）も、決まり 1 の確かめにかける（そのまま使わない。HX4）', () => {
    expect(open).toContain("const saved = this.openKept ?? (this.shape === 'hex' && snap ? this.shapeViews.get(boardKey('hex', snap.memoId)) : undefined);");
    expect(open.indexOf('this.openKept = null;')).toBeGreaterThan(open.indexOf('const saved = this.openKept'));
    expect(open.indexOf('this.openKept = null;')).toBeLessThan(open.indexOf('openingView('));
    expect(open).not.toContain('rule: 1 as const'); // 決まり 1 にするかは openingView が決める
    const set = body('private setShape(next: BoardLayout) {', '// ---------- 写真の行き先と題');
    expect(set).toContain('this.openKept = kept ? { ...kept } : null;');
    expect(set).toContain('this.needFit = true;');
    expect(set).not.toContain('this.view = ');
  });
  it('書く欄が開いたまま決め直すとき（形を替えたときなど）は、欄を閉じたあとの面で決め、そのあと欄を開いたときと同じ寄せ（HX2）をかける。HX4', () => {
    expect(open).toContain('const composeOpen = !this.compose.hidden;');
    expect(open).toContain('composeOpen ? this.closedViewport() : vp');
    const order = ['this.needFit = false;', 'openingView(', 'this.view = open.view;', 'this.dropComposeShift();', 'if (composeOpen) {', 'this.composeUntouched = true;', 'this.shiftForCompose();'].map((s) => open.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order); // 寄せの印を下ろしてから寄せる（寄せたあとに下ろすと、閉じても戻らない）
    // 寄せは書く欄を開いたときと同じ決まり：目当てが半分より多く見えていれば動かさない（composeView）。寄せたら、決め直した位置を戻す先に覚える
    const shift = body('private shiftForCompose() {', 'private restoreAfterCompose() {');
    expect(shift).toContain('if (this.hidden || this.needFit || this.drag?.moved) return;');
    expect(shift).toContain('const next = composeView(this.view,');
    expect(shift).toContain('if (!this.composeShift) this.composeShift = { before: this.view };');
    expect(body('private closedViewport()', 'private slideToRead(')).toContain('return { w: vp.w, h: vp.h + (this.compose.hidden ? 0 : this.compose.offsetHeight) };');
  });
  it('決めた位置は保存しない（touchView も保存の待ちも通さない）。選んだ決まりを覚え、触った印を下ろす', () => {
    expect(open).not.toContain('this.touchView(');
    expect(open).not.toContain('this.viewTouchedAt');
    expect(open).not.toContain('this.flushView(');
    expect(open).not.toContain('saveBoard(');
    expect(open).toContain('this.view = open.view;');
    expect(open).toContain('this.openRule = open.rule;');
    expect(open).toContain('this.viewTouched = false;');
  });
});

describe('見ている位置を書き換える所', () => {
  // 開いたとき・出したとき・面が替わったとき（HX1）、書く欄を開いて寄せたとき・閉じて戻したとき（HX2）、つまんだまま端で動かす間・取り消して戻すとき（HX3。動いた位置は離したときに保存）。どれもその場では保存しない
  //   形を替えたとき（HX4）は needFit で開いたときの道（renderBoard）を通る
  const own = new Set(['renderBoard', 'reopenAfterShow', 'settleFace', 'shiftForCompose', 'restoreAfterCompose', 'edgePanFrame', 'cancelDrag']);
  it('決まった所（開いたとき・出したとき・面が替わったとき・書く欄で寄せる／戻すとき・端で動かす間・取り消し）のほかは、すぐあとで touchView を通る（保存の待ちに入る）', () => {
    expect(sites.length).toBeGreaterThanOrEqual(10);
    expect(new Set(sites.map((s) => s.name).filter((n) => own.has(n)))).toEqual(own);
    for (const s of sites) {
      if (own.has(s.name)) continue;
      expect(tab.slice(s.at, s.at + 400), `${s.name} の中の this.view =`).toContain('this.touchView()');
    }
  });
  it('決まった所は touchView を通さない（保存しない）', () => {
    for (const name of own) expect(memberBody(name), name).not.toContain('this.touchView(');
  });
});

describe('触った印', () => {
  it('touchView の頭（読めない・読み込み中で先に返る所より前）で立てる', () => {
    const touch = body('private touchView() {', 'private armViewTimer(');
    expect(touch.indexOf('this.viewTouched = true;')).toBeGreaterThan(-1);
    expect(touch.indexOf('this.viewTouched = true;')).toBeLessThan(touch.indexOf('return;'));
  });
  it('カードをつまんで動かし始めた（d.moved）ときも立てる', () => {
    expect(body('private moveDrag(', 'private dragPoint(')).toMatch(/d\.moved = true;\s*this\.viewTouched = true;/);
  });
});

describe('面が替わったとき（同じ処理の中で合わせる）', () => {
  it('道具の列：畳む・開く前の上端を読み、paintFold のあとで差を当てる', () => {
    const fold = body('private setToolsFolded(', 'private paintFold(');
    expect(fold.indexOf('const top = this.faceTop();')).toBeGreaterThan(-1);
    expect(fold.indexOf('const top = this.faceTop();')).toBeLessThan(fold.indexOf('this.paintFold();'));
    expect(fold.indexOf('this.paintFold();')).toBeLessThan(fold.indexOf('if (top !== null) this.settleFace(this.stage.offsetTop - top);'));
  });
  it('絞りの札の行：描く前後の上端を比べ、動いたときだけ当てる（出入りも折り返しも）', () => {
    const filter = body('private renderFilter(', 'private paintDim(');
    expect(filter.indexOf('const top = this.faceTop();')).toBeLessThan(filter.indexOf('this.filterBox.replaceChildren('));
    expect(filter.indexOf('this.filterBox.hidden = row === null;')).toBeLessThan(filter.indexOf('const dy = top === null ? 0 : this.stage.offsetTop - top;'));
    expect(filter).toContain('if (dy !== 0) this.settleFace(dy);');
  });
  it('置き場の替え：上か下かが替わったときだけ、root を移したあとで合わせる（上端の差は 0）', () => {
    const place = body('setPlace(available: boolean, upper: boolean) {', '// ---------- 見るメモの名札と選び口');
    expect(place.indexOf("const moved = (upper ? 'upper' : 'bottom') !== this.place;")).toBeGreaterThan(-1);
    expect(place.indexOf('const moved =')).toBeLessThan(place.indexOf("this.place = upper ? 'upper' : 'bottom';"));
    expect(place.indexOf("this.root.classList.toggle('is-upper', upper);")).toBeLessThan(place.indexOf('if (moved) this.settleFace(0);'));
  });
  it('隠れているとき・開く前は何もしない。決まり・触った印・選びの数・読む箱を settleView に渡す', () => {
    expect(body('private faceTop()', 'private settleFace(')).toContain('return this.hidden || this.needFit ? null : this.stage.offsetTop;');
    const settle = body('private settleFace(dy: number) {', '// 利用者が見ている位置を変えた');
    expect(settle).toContain('if (this.hidden || this.needFit || vp.w <= 0 || vp.h <= 0) return;');
    expect(settle).toContain('settleView(this.view, this.source?.get()?.replies ?? [], this.faces, vp, { dy, rule: this.openRule, touched: this.viewTouched, selected: this.selected.size }, { place: this.place, readBox: this.readBox, recent: this.geo.recent })');
    expect(settle).toContain('this.openRule = next.rule;');
  });
  it('ResizeObserver は needFit の描き直しなどだけ（持ち越す印で、あとから合わせない）', () => {
    const ro = body('new ResizeObserver(() => {', '}).observe(this.stage);');
    expect(ro).toContain('if (this.needFit && !this.hidden) this.render();');
    expect(ro).not.toContain('settleFace');
    for (const word of ['shiftFrom', 'refitPlace', 'armTopShift']) expect(tab).not.toContain(word);
  });
});

describe('隠して出したとき', () => {
  it('隠す前に、描いているカードの中で最後に書いたカードを覚える', () => {
    const hide = body('setHidden(hidden: boolean) {', 'private noteHiddenLast(');
    expect(hide.indexOf('if (hidden && !was) this.noteHiddenLast();')).toBeGreaterThan(-1);
    expect(hide.indexOf('if (hidden && !was) this.noteHiddenLast();')).toBeLessThan(hide.indexOf('this.hidden = hidden;'));
    expect(body('private noteHiddenLast() {', 'private reopenAfterShow(')).toContain('lastWritten(snap.replies, this.faces)?.id ?? null');
  });
  it('出したとき（同じメモ）は viewAfterShow に任せ、動かしたら決まりを覚え直す（保存しない）', () => {
    expect(tab).toContain('if (show) this.reopenAfterShow(snap.replies);');
    const reopen = body('private reopenAfterShow(', 'toggle() {');
    expect(reopen).toContain('before.memoId !== this.memoId || this.needFit');
    expect(reopen).toContain('viewAfterShow(this.view, replies, this.faces, this.viewport(), { place: this.place, before: before.id, readBox: this.readBox, recent: this.geo.recent })');
    expect(reopen).toContain('this.openRule = next.rule;');
    expect(reopen).toContain('this.viewTouched = false;');
  });
});

describe('読む箱（形ごと。HX4）', () => {
  it('一つの読む箱（いまの形の geo の箱）を、開いたとき・出したとき・面が替わったとき・書く欄を開いたとき・「100%」に渡す。足したあとの滑りは geo の slideBox（四角は読む箱、六角は箱が面に入らなければ文の帯。HX5）', () => {
    expect(tab).toContain('private get readBox(): ReadBox {\n    return this.geo.readBox;');
    expect(tab).toContain('private get geo(): BoardGeo {\n    return geoOf(this.shape);');
    expect(tab.split('readBox: this.readBox').length - 1).toBe(5);
    expect(body('private slideToRead(', 'private returnDraft(')).toContain('viewToRead(this.view, this.geo.slideBox(at, this.view.zoom, vp), vp)');
  });
  it('最後に書いた辺りの決め方（四角は recentView、六角は hexRecentView）を、開いたとき・出したとき・面が替わったとき・「100%」に渡す', () => {
    expect(tab.split('recent: this.geo.recent').length - 1).toBe(4);
  });
});

describe('「100%」のボタン', () => {
  it('押せるボタン。押しても焦点を取らない。字は今の倍率、読み上げの名前は倍率と押したときのこと', () => {
    expect(tab).toContain("private readonly zoomBtn = el('button', 'memo-board-zoom', '100%');");
    expect(tab).toContain("this.zoomBtn.type = 'button';");
    expect(tab).toContain("this.zoomBtn.addEventListener('pointerdown', (e) => e.preventDefault());");
    expect(tab).toContain("this.zoomBtn.addEventListener('click', () => this.actualSize());");
    expect(tab).toContain('right.append(this.search, this.fitBtn, this.zoomBtn);');
    // 字・説明・読み上げは一つの関数（paintZoom → zoomTexts）で書き、applyView から呼ぶ（MK2。「［全体］の間」の始まり・終わりからも）
    const apply = body('private applyView(', 'private loadFaces(');
    expect(apply).toContain('this.paintZoom();');
    const paint = body('private paintZoom() {', 'private loadFaces(');
    expect(paint).toContain('const z = zoomTexts(this.view.zoom, this.overview?.before ?? null);');
    expect(paint).toContain('this.zoomBtn.textContent = z.text;');
    expect(paint).toContain('this.zoomBtn.title = z.title;');
    expect(paint).toContain("this.zoomBtn.setAttribute('aria-label', z.label);");
    expect(zoomTexts(0.85, null)).toEqual({ percent: 85, text: '85%', title: ZOOM_TITLE, label: '倍率 85%。押すと 100% にします' });
    expect(tab).not.toContain('zoomLabel');
  });
  it('1 枚選んでいればそのカード、ほかは最後に書いた辺り（actualSizeView）。保存する（touchView）', () => {
    const size = body('private showActualSize() {', 'private faceTop()'); // 100% の中の道（％の受け口 actualSize と分けた。MK2）
    expect(size).toContain('this.selected.size === 1 ? [...this.selected][0] : null');
    expect(size).toContain('actualSizeView(this.view, this.source?.get()?.replies ?? [], this.faces, vp, { place: this.place, selected, readBox: this.readBox, recent: this.geo.recent })');
    expect(size.indexOf('this.applyView();')).toBeLessThan(size.indexOf('this.touchView();'));
  });
  it('CSS（parseCss）：ボタンの枠・地・余白を消し、字は前と同じ色と大きさ。乗せたときの色と焦点の輪がある。色はテーマの変数だけ', () => {
    const rules = parseCss(css);
    const decls = (selector: string) => {
      const rule = rules.find((r) => r.at.length === 0 && r.selector.split(',').map((s) => s.trim()).includes(selector));
      if (!rule) throw new Error(`見つかりません：${selector}`);
      return Object.fromEntries(rule.decls.map((d) => [d.prop, d.value]));
    };
    expect(decls('.memo-board-zoom')).toEqual({ 'min-width': '34px', padding: '0', border: '0', background: 'none', color: 'var(--muted)', font: 'inherit', 'text-align': 'right', cursor: 'pointer' });
    expect(decls('.memo-board-zoom:hover')).toEqual({ color: 'var(--accent-ink)' });
    expect(decls('.memo-board-zoom:focus-visible')).toEqual({ outline: '2px solid var(--shell-focus)', 'outline-offset': '2px' });
    const zoomRules = rules.filter((r) => r.selector.includes('.memo-board-zoom'));
    expect(zoomRules.length).toBe(3);
    for (const r of zoomRules) for (const d of r.decls) expect(d.value, `${r.selector} ${d.prop}`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});
