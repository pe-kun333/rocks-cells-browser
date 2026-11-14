// 段 MK2：「［全体］の間」と、％・Esc で全体の前へ戻る（docs/plan-comment-board-marks.md §4.2）
//   純粋な関数（memo-card-board-overview.ts）と、tab・grok-cards.ts の配線（ソースを読んで確かめる。ui には DOM の試験の環境が無い）
//   DOM の動き（戻るときに滑る・境目・焦点・ピンチ）は開発の画面と Windows の確かめ（計画 §9.3 の確かめ A の 3）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BoardView } from '../src/memo-card-board';
import { type OverviewEnd, overviewFaceMoved, overviewGoesBack, overviewStart, overviewUpperWaits, sameView, ZOOM_TITLE, zoomTexts } from '../src/memo-card-board-overview';
import { settleView } from '../src/memo-card-board-view';
import { code } from './helpers';

const tab = readFile(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cards = readFile(new URL('../src/app/grok-cards.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// from から to の手前まで。どちらかが見つからなければ throw（中身の無い確かめにしない）
const cut = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`見つかりません：${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`見つかりません：${to}`);
  return src.slice(a, b);
};
const body = (from: string, to: string) => cut(tab, from, to);
const count = (s: string, part: string) => s.split(part).length - 1;
// 並びの順：どれも見つかり、前から順に出てくる
const inOrder = (s: string, parts: string[]) => {
  const at = parts.map((p) => s.indexOf(p));
  expect(at.every((i) => i > -1), parts.join(' → ')).toBe(true);
  expect([...at].sort((a, b) => a - b), parts.join(' → ')).toEqual(at);
};

const view = (x: number, y: number, zoom: number): BoardView => ({ x, y, zoom });
const start = (over: Partial<Parameters<typeof overviewStart>[0]> = {}) => overviewStart({ loading: false, unreadable: false, cards: 22, ready: true, view: view(-120, -40, 1), fit: view(318, 6, 0.25), marked: false, ...over });

describe('sameView（全体の位置が今と同じか）', () => {
  it('倍率の差 0.005 未満、かつ x・y の差 1px 未満なら同じ', () => {
    expect(sameView(view(10, 20, 1), view(10, 20, 1))).toBe(true);
    expect(sameView(view(10, 20, 1), view(10.9, 19.1, 1.004))).toBe(true);
    expect(sameView(view(10, 20, 1), view(10, 20, 1.005))).toBe(false); // 倍率の差がちょうど 0.005（小数の誤差で 0.005 より少し小さく出ても、同じとはみなさない）
    expect(sameView(view(10, 20, 0.25), view(10, 20, 0.255))).toBe(false);
    expect(sameView(view(10, 20, 1), view(11, 20, 1))).toBe(false); // x の差がちょうど 1px
    expect(sameView(view(10, 20, 1), view(10, 21, 1))).toBe(false);
    expect(sameView(view(10, 20, 0.5), view(10, 20, 0.25))).toBe(false);
  });
});

describe('overviewStart（始めてよいか・覚える位置）', () => {
  it('始めるときは、押す直前の見ている位置（倍率と x・y）を写して覚える', () => {
    const now = view(-120, -40, 1);
    const o = start({ view: now });
    expect(o).toEqual({ before: { x: -120, y: -40, zoom: 1 } });
    expect(o?.before).not.toBe(now); // 写し（あとで今の位置が替わっても、覚えた位置は替わらない）
  });
  it('読み込み中・読めないボード・カード 0 枚では始めない', () => {
    expect(start({ loading: true })).toBeNull();
    expect(start({ unreadable: true })).toBeNull();
    expect(start({ cards: 0 })).toBeNull();
  });
  it('面の大きさが 0 か、開いたときの位置をまだ決めていない（ready でない）ときも始めない（覚えるのが開く前の位置になるため。MK2 の見直し）', () => {
    expect(start({ ready: false })).toBeNull();
    expect(start({ ready: true })).not.toBeNull();
  });
  it('全体の位置が今の位置と同じなら始めない（そのときの％は今までどおり 100%）', () => {
    expect(start({ view: view(318, 6, 0.25), fit: view(318, 6, 0.25) })).toBeNull();
    expect(start({ view: view(318.4, 6.6, 0.252), fit: view(318, 6, 0.25) })).toBeNull();
    expect(start({ view: view(319, 6, 0.25), fit: view(318, 6, 0.25) })).not.toBeNull(); // 1px ずれていれば始める
  });
  it('MK8b（MK8a の記録の (c)）：描いているカードに印があれば、全体の位置が今と同じでも始める（吹き出しを出すため）。覚える位置は今の位置', () => {
    expect(start({ view: view(318, 6, 0.25), fit: view(318, 6, 0.25), marked: true })).toEqual({ before: { x: 318, y: 6, zoom: 0.25 } });
    expect(start({ view: view(318.4, 6.6, 0.252), fit: view(318, 6, 0.25), marked: true })).toEqual({ before: { x: 318.4, y: 6.6, zoom: 0.252 } });
    expect(start({ marked: true })).toEqual(start({ marked: false })); // 同じでなければ、印によらず今までどおり
    // 印があっても、読み込み中・読めない・カード 0 枚・ready でないときは始めない
    for (const over of [{ loading: true }, { unreadable: true }, { cards: 0 }, { ready: false }]) expect(start({ ...over, view: view(318, 6, 0.25), fit: view(318, 6, 0.25), marked: true }), JSON.stringify(over)).toBeNull();
  });
});

describe('終わりの理由', () => {
  it('戻るのは return（％・Esc）だけ。ほかは終わるだけ', () => {
    const ends: OverviewEnd[] = ['return', 'zoom', 'memo', 'close', 'place', 'shape', 'hide', 'jump'];
    expect(ends.filter(overviewGoesBack)).toEqual(['return']);
  });
});

describe('overviewFaceMoved（面の上端が動いたとき）', () => {
  it('覚えた位置の y にも、今の位置と同じ差を足す（上端が下へ dy 動いたら dy を引く。x と倍率はそのまま）', () => {
    expect(overviewFaceMoved({ before: view(-120, -40, 1) }, 28)).toEqual({ before: { x: -120, y: -68, zoom: 1 } });
    expect(overviewFaceMoved({ before: view(-120, -40, 1) }, -28)).toEqual({ before: { x: -120, y: -12, zoom: 1 } });
    const o = { before: view(-120, -40, 1) };
    expect(overviewFaceMoved(o, 0)).toBe(o);
  });
  it('間は［全体］で触ったあとなので、今の位置の直し（settleView の触ったあと）と同じ差になる', () => {
    const before = view(-120, -40, 0.85);
    const now = view(318, 6, 0.25);
    for (const dy of [28, -28, 41]) {
      const moved = settleView(now, [], [], { w: 840, h: 300 }, { dy, rule: 2, touched: true, selected: 0 }, { place: 'upper' }).view;
      expect(overviewFaceMoved({ before }, dy).before.y - before.y).toBe(moved.y - now.y);
    }
  });
});

describe('zoomTexts（％の項目の字・説明・読み上げ）', () => {
  it('間でないとき：今までの字と説明（押すと 100%）', () => {
    expect(zoomTexts(0.25, null)).toEqual({ percent: 25, text: '25%', title: ZOOM_TITLE, label: '倍率 25%。押すと 100% にします' });
    expect(ZOOM_TITLE).toBe('100% にします（1 枚選んでいればそのカード、選んでいなければ最後に書いた辺りを見せます）');
  });
  it('間のとき：説明は「押すと全体の前（85%）に戻ります」。数は覚えた倍率（四捨五入）。字は今の倍率のまま', () => {
    expect(zoomTexts(0.25, view(-120, -40, 0.85))).toEqual({ percent: 25, text: '25%', title: '押すと全体の前（85%）に戻ります', label: '倍率 25%。押すと全体の前（85%）に戻ります' });
    expect(zoomTexts(0.485, view(0, 0, 1.234)).title).toBe('押すと全体の前（123%）に戻ります');
    expect(zoomTexts(0.485, view(0, 0, 1)).text).toBe('49%');
  });
});

describe('tab の配線（MK2）', () => {
  it('［全体］も％と同じく、マウスで押したときは焦点を取らない。ただし焦点が Esc を自分で受ける所（字の欄・書く欄の中）にあるときは、今までどおり焦点を移す（MK2 の見直し）', () => {
    // 欄に焦点を残すと、そのあとの Esc は欄のもの（書く欄は閉じて書きかけを捨てる。検索の欄は Esc の段で何もしない）になり、全体の前へ戻れない
    const down = cut(tab, "this.fitBtn.addEventListener('pointerdown', (e) => {", '});');
    expect(down).toContain('const active = document.activeElement;');
    expect(down).toContain('const ownsEsc = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || this.compose.contains(active);');
    expect(down).toMatch(/if \(!ownsEsc\) e\.preventDefault\(\);\s*$/);
    expect(count(down, 'preventDefault')).toBe(1);
    expect(tab.indexOf("this.fitBtn.addEventListener('pointerdown'")).toBeLessThan(tab.indexOf("this.fitBtn.addEventListener('click', () => this.fit());"));
    // 書く欄は、欄全体（種類の欄・ボタンも）で Esc を受けて閉じる。だから字の欄だけでなく書く欄の中のどこでも焦点を移す
    expect(tab).toMatch(/this\.compose\.addEventListener\('keydown', \(e\) => \{[\s\S]*?if \(e\.key === 'Escape'\) \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);[^\n]*\n\s*this\.closeCompose\(\);/);
  });
  it('状態は一つの欄（overview）。％の字・説明・読み上げは paintZoom 一つで書き、組み立てのときにも呼ぶ', () => {
    expect(tab).toContain('private overview: Overview | null = null;');
    expect(count(code(tab), 'this.overview = ')).toBe(3); // 始める（fit）・終える（endOverview）・上端の直し（settleFace）
    expect(count(code(tab), 'this.paintZoom();')).toBe(3); // 組み立て・applyView・終わるだけのとき（戻るときは applyView の中）
    const paint = body('private paintZoom() {', 'private loadFaces(');
    for (const write of ['this.zoomBtn.textContent = ', 'this.zoomBtn.title = ', "this.zoomBtn.setAttribute('aria-label'"]) {
      expect(count(code(tab), write), write).toBe(1); // 書くのは paintZoom の中だけ
      expect(paint, write).toContain(write);
    }
  });
  it('［全体］：間でなければ、全体の位置を出してから始めるかを決め、押す直前の位置を覚える。間に押し直したら合わせ直すだけ（覚えた位置は替えない）。保存は今までどおり', () => {
    const fit = body('private fit() {', 'private actualSize() {');
    expect(fit).toMatch(/^private fit\(\) \{\s*if \(this\.drag \|\| this\.marquee\) return;/);
    expect(fit).toContain('const next = fitAll(this.faces, this.viewport(), this.geo.box);');
    // 面の大きさが 0 か、開いたときの位置をまだ決めていない（needFit）ときは始めない（ready。fitAll の動きは今までどおり。MK2 の見直し）
    expect(fit).toContain('const ready = !this.needFit && vp.w > 0 && vp.h > 0;');
    // MK8b：印のカードがあるか（marked）も渡す（全体の位置が今と同じでも始めるため。MK8a の記録の (c)）
    expect(fit).toContain("if (!this.overview) this.overview = overviewStart({ loading: this.loaded === null, unreadable: this.loaded?.state === 'unreadable', cards: this.faces.length, ready, view: this.view, fit: next, marked: this.faces.some(hasCalloutMark) });");
    inOrder(fit, ['const next = fitAll(', 'const vp = this.viewport();', 'const ready = ', 'if (!this.overview) this.overview = overviewStart(', 'this.view = next;', 'this.applyView();', 'this.touchView();']);
    expect(fit).not.toContain('this.slide()'); // ［全体］は今までどおり滑らせない
  });
  it('％：間なら覚えた位置へ戻る（1 枚選んでいても）。間でなければ今の 100%（中の道 showActualSize は受け口と分ける）', () => {
    const size = body('private actualSize() {', 'private showActualSize() {');
    expect(size).toMatch(/if \(vp\.w <= 0 \|\| vp\.h <= 0 \|\| this\.drag \|\| this\.marquee\) return;\s*if \(this\.overview\) this\.endOverview\('return'\);\s*else this\.showActualSize\(\);/);
    expect(size).not.toContain('actualSizeView(');
    const inner = body('private showActualSize() {', 'private faceTop()');
    expect(inner).toMatch(/if \(vp\.w <= 0 \|\| vp\.h <= 0 \|\| this\.drag \|\| this\.marquee\) return;/);
    inOrder(inner, ['this.selected.size === 1 ? [...this.selected][0] : null', 'this.slide();', 'this.view = actualSizeView(', 'this.applyView();', 'this.touchView();']);
    expect(code(inner)).not.toContain('overview');
  });
  it('終える：間でなければ何もしない。戻るときは 境目を戻す → 面の大きさを読む → 220ms 滑らせる → 覚えた位置 → 保存。終わるだけのときは位置を替えず字を書き直す', () => {
    const end = body('private endOverview(reason: OverviewEnd) {', 'private giveBackUpper(');
    inOrder(end, ['const o = this.overview;', 'if (!o) return;', 'this.overview = null;', 'this.giveBackUpper();', 'if (overviewGoesBack(reason)) {', 'const vp = this.viewport();', 'this.slide();', 'this.view = { ...o.before };', 'this.applyView();', 'this.touchView();', 'this.paintZoom();']);
    expect(end).toMatch(/this\.touchView\(\);\s*return;\s*\}\s*this\.paintZoom\(\);/); // 戻ったときは applyView の中で字を書くので、ここで終わる
    expect(count(code(end), 'this.view = ')).toBe(1);
    expect(tab).toContain('private giveBackUpper('); // 境目を戻す口（MK3 で中身を足す）
  });
  it('Esc の口：inOverview と leaveOverview（つまむ・範囲選択の間は戻らない）', () => {
    expect(body('get inOverview(): boolean {', 'leaveOverview(): boolean {')).toContain('return this.overview !== null;');
    const leave = body('leaveOverview(): boolean {', 'private endOverview(');
    expect(leave).toMatch(/if \(!this\.overview \|\| this\.drag \|\| this\.marquee\) return false;\s*this\.endOverview\('return'\);\s*return true;/);
  });
  it('終わるだけの出来事は endOverview 一つで受ける。理由ごとの呼ぶ所は 1 か所（jump は MK4 の［上で開く］と MK8b の吹き出しの頭のダブルクリックの 2 か所）', () => {
    const c = code(tab);
    expect(count(c, "this.endOverview('return')")).toBe(2); // ％・Esc
    for (const reason of ['zoom', 'memo', 'close', 'place', 'shape', 'hide']) expect(count(c, `this.endOverview('${reason}')`), reason).toBe(1);
    expect(count(c, "this.endOverview('jump')")).toBe(2); // takeFocus・jumpToCallout（MK8b）
  });
  it('MK4：［上で開く］で当てるときは、選ぶ → 100% の前に「［全体］の間」を終える（戻らない。jump は待たずに借りた高さを戻す）', () => {
    const take = body('private takeFocus() {', '// ---------- 「［全体］の間」');
    inOrder(take, ["if (step === 'gone') {", "this.endOverview('jump');", 'this.setSelected(new Set([want.replyId]));', 'this.showActualSize();']);
    expect(overviewGoesBack('jump')).toBe(false);
    expect(overviewUpperWaits('jump')).toBe(false);
  });
  it('ピンチ・Ctrl＋ホイール：倍率が実際に替わったときだけ終える（zoomAt の前と後を比べる）。頭の 2 文より後ろ。2 本指で動かす（パン）では終えない', () => {
    const wheel = body("'wheel',", '{ passive: false },');
    expect(wheel).toMatch(/^'wheel',\s*\(e\) => \{\s*e\.preventDefault\(\);\s*if \(this\.drag \|\| this\.marquee\) return;/);
    const zoom = cut(wheel, "if (plan.kind === 'zoom') {", '} else {');
    inOrder(zoom, ['const zoom0 = this.view.zoom;', 'this.view = zoomAt(', "if (this.view.zoom !== zoom0) this.endOverview('zoom');"]);
    expect(cut(wheel, '} else {', 'this.applyView();')).not.toContain('endOverview');
    expect(body("this.stage.addEventListener('pointermove', (e) => {", "this.stage.addEventListener('pointerup'")).not.toContain('endOverview');
  });
  it('メモの替え・メモが閉じる：flushView より前（保存と覚え〈rememberView〉には全体の位置が入る。今までどおり）', () => {
    const closed = body('if (!snap) {', 'return;');
    inOrder(closed, ["this.endOverview('close');", 'this.flushView();', 'this.rememberView();']);
    const changed = body('if (changed) {', 'this.memoId = snap.memoId;');
    inOrder(changed, ['this.cancelDrag();', "this.endOverview('memo');", 'this.flushView();', 'this.rememberView();']);
  });
  it('形の替え：止める条件のあと、render より前（flushView より前）。置き場の替え：替わったときだけ、settleFace(0) より前。隠す：隠すときだけ、flushView より前', () => {
    const set = body('private setShape(next: BoardLayout) {', '// ---------- 写真の行き先と題');
    inOrder(set, ['const blocked = this.shapeBlockedNote();', 'this.cancelDrag();', "this.endOverview('shape');", 'this.flushView();', 'this.needFit = true;', 'this.render();']);
    const place = body('setPlace(available: boolean, upper: boolean) {', '// ---------- 見るメモの名札と選び口');
    expect(place).toContain("if (moved) this.endOverview('place');");
    inOrder(place, ['const moved =', "if (moved) this.endOverview('place');", 'if (moved) this.settleFace(0);']);
    const hide = body('setHidden(hidden: boolean) {', 'private noteHiddenLast(');
    const branch = cut(hide, 'if (hidden) {', 'this.closeTemplate();');
    inOrder(branch, ['this.cancelDrag();', "this.endOverview('hide');", 'this.flushView();']);
  });
  it('面の上端が動いたとき（settleFace）：覚えた位置の y にも同じ差を足す（守りのあと。保存しない）', () => {
    const settle = body('private settleFace(dy: number) {', '// 利用者が見ている位置を変えた');
    inOrder(settle, ['if (this.hidden || this.needFit || vp.w <= 0 || vp.h <= 0) return;', 'this.view = next.view;', 'if (this.overview) this.overview = overviewFaceMoved(this.overview, dy);']);
    expect(code(settle)).not.toContain('this.touchView(');
  });
});

describe('grok-cards.ts の Esc（MK2）', () => {
  it('下に置いているとき：間を知らせ、選びを外すの直後・縮めるより前に leaveOverview', () => {
    const esc = cut(cards, '  consumeEsc(e: KeyboardEvent): boolean {', 'private consumeBoardUpperEsc(');
    expect(esc).toContain('boardOverview: this.board?.inOverview');
    inOrder(esc, ["if (action === 'clear-selection') {", "if (action === 'leave-overview') {", 'this.board?.leaveOverview();', "if (action === 'shrink-board') {", 'this.showMemo();']);
  });
  it('上に出しているとき：間を知らせ、選びを外すの直後・焦点の止め（hasFocusInside）より前に leaveOverview', () => {
    const esc = cut(cards, 'private consumeBoardUpperEsc(', '  onOpen(open: boolean) {');
    expect(esc).toContain('boardOverview: board.inOverview');
    inOrder(esc, ["if (action === 'clear-selection') {", "if (action === 'leave-overview') {", 'board.leaveOverview();', 'board.hasFocusInside(target)']);
    expect(cut(esc, "if (action === 'leave-overview') {", 'board.hasFocusInside(target)')).toMatch(/^if \(action === 'leave-overview'\) \{\s*e\.preventDefault\(\);\s*board\.leaveOverview\(\);[^\n]*\n\s*return true;\s*\}/);
  });
});
