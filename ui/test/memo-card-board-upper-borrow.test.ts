// 段 MK3：「［全体］の間」だけ上の区画を高くする（境目を一時に下げる。docs/plan-comment-board-marks.md §4.3）
//   純粋な関数（memo-card-board-overview.ts の overviewNeedPx・overviewUpperWaits・upperGiveBackView、grok-cards-place.ts の borrowUpperRatio）と、
//   memo-pane.ts・grok-cards.ts・memo-board-tab.ts の配線（ソースを読んで確かめる。ui には DOM の試験の環境が無い）
//   DOM の動き（境目を書き換えた直後に面の大きさが新しくなるか・下 150px で窓が切れるか・下の区画の動かない部分の高さ・ピンチの止まりと y の寄せ）は開発の画面と Windows の確かめ（計画 §12 の 3・4・10・11、§9.3 の確かめ A の 4）。
//   どれもまだ見ていない（MK3 の記録）。ここで固めるのは、純粋な関数の数と、ソースの並び（動きの順そのものは試していない）
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BORROW_LOWER_MIN, BORROW_LOWER_SPARE, BORROW_TOTAL_MIN, borrowUpperRatio, clampUpperRatio, UPPER_SPLIT_MIN } from '../src/grok-cards-place';
import { type BoardView, fitView, placementBounds } from '../src/memo-card-board';
import { FIT_MAX_ZOOM, FIT_PAD, type OverviewEnd, overviewNeedPx, overviewUpperWaits, UPPER_BACK_MS, upperGiveBackView } from '../src/memo-card-board-overview';
import { VIEW_SAVE_DELAY } from '../src/memo-card-board-view';
import { code } from './helpers';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tab = read('../src/app/memo-board-tab.ts');
const pane = read('../src/app/memo-pane.ts');
const cards = read('../src/app/grok-cards.ts');
const paneCss = read('../src/memo-pane.css');

// from から to の手前まで。どちらかが見つからなければ throw（中身の無い確かめにしない）
const cut = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`見つかりません：${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`見つかりません：${to}`);
  return src.slice(a, b);
};
const count = (s: string, part: string) => s.split(part).length - 1;
// 並びの順：どれも見つかり、前から順に出てくる
const inOrder = (s: string, parts: string[]) => {
  const at = parts.map((p) => s.indexOf(p));
  expect(at.every((i) => i > -1), parts.join(' → ')).toBe(true);
  expect([...at].sort((a, b) => a - b), parts.join(' → ')).toEqual(at);
};

// 外枠 w×h のボード（左上に 1 枚。大きさを外枠と同じにする）
const board = (w: number, h: number) => ({ placements: [{ x: 0, y: 0 }], size: { w, h } });
const need = (w: number, h: number, vw: number, vh: number) => {
  const b = board(w, h);
  return overviewNeedPx(b.placements, { w: vw, h: vh }, b.size);
};
// 幅で決まる倍率（fitView と同じ丸め：0.001）
const widthZoom = (w: number, vw: number) => Math.round(Math.min(Math.max(Math.min((vw - FIT_PAD * 2) / w, FIT_MAX_ZOOM), 0.25), 2) * 1000) / 1000;

describe('overviewNeedPx（上の区画に足してほしい高さ）', () => {
  it('目当ての倍率 z＝min((面の幅 − 36) ÷ 外枠の幅, 1.2)、要る高さ＝外枠の高さ × z ＋ 36。返すのは 要る高さ − 今の面の高さ（切り上げ）', () => {
    expect(need(814, 462, 840, 217)).toBe(276); // 六角 10 枚の仮の並び：z＝804/814≈0.988、要る高さ≈492.3
    expect(need(814, 750, 840, 217)).toBe(560); // 六角 20 枚：要る高さ≈776.8
    expect(need(518, 419, 840, 217)).toBe(322); // 置いたボードの外枠：z は 1.2 で止まる（要る高さ 538.8）
  });
  it('幅で決まり、全体も入っているときは 0 以下（借りない）', () => {
    expect(need(814, 462, 840, 600)).toBeLessThanOrEqual(0);
    expect(need(814, 462, 840, 493)).toBeLessThanOrEqual(0);
    expect(need(814, 462, 840, 492)).toBe(1);
  });
  it('下限 0.25 で止まって入りきらないボードは正（借りる）', () => {
    expect(need(814, 750, 200, 217)).toBe(7); // (200 − 36)/814 は 0.25 未満。要る高さ＝750×0.25＋36＝223.5
    expect(need(814, 3000, 840, 400)).toBeGreaterThan(0);
  });
  it('カードが無い・面の幅が余白（36）以下・高さが数でないときは 0', () => {
    expect(overviewNeedPx([], { w: 840, h: 217 })).toBe(0);
    expect(need(814, 462, 36, 217)).toBe(0);
    expect(need(814, 462, 0, 0)).toBe(0);
    expect(need(814, 462, 840, Number.NaN)).toBe(0);
  });
  it('外枠は fitAll と同じ（placementBounds。size を渡さなければ四角のカード）', () => {
    const placements = [
      { x: 0, y: 0 },
      { x: 600, y: 300 },
    ];
    const box = placementBounds(placements);
    expect(box).not.toBeNull();
    if (!box) return;
    const z = Math.min((840 - 36) / box.w, 1.2);
    expect(overviewNeedPx(placements, { w: 840, h: 217 })).toBe(Math.ceil(box.h * z + 36 - 217));
  });
  it('その高さだけ高くすると、［全体］（fitView）の倍率は幅で決まる倍率になる（1px 低いと、まだ高さで決まる）', () => {
    for (const [w, h, vw, vh] of [
      [814, 462, 840, 217],
      [814, 750, 840, 217],
      [814, 894, 840, 313],
      [518, 419, 840, 217],
      [814, 1182, 840, 413],
    ]) {
      const n = need(w, h, vw, vh);
      const bounds = { x: 0, y: 0, w, h };
      expect(fitView(bounds, { w: vw, h: vh + n }).zoom, `${w}×${h}`).toBe(widthZoom(w, vw));
      // 1px 低い面では、高さで決まる倍率（丸める前）が幅で決まる倍率より小さい（fitView は 0.001 に丸めるので、丸める前で比べる）
      expect((vh + n - 1 - FIT_PAD * 2) / h, `${w}×${h} の 1px 低い面`).toBeLessThan(Math.min((vw - FIT_PAD * 2) / w, FIT_MAX_ZOOM));
    }
  });
});

describe('borrowUpperRatio（借りたあとの上の割合）', () => {
  it('上は今の高さ＋needPx まで。下の床は max(150, 動かない部分＋8)', () => {
    expect(BORROW_LOWER_MIN).toBe(150);
    expect(BORROW_LOWER_SPARE).toBe(8);
    expect(borrowUpperRatio(508, 0.5, 200, 112)).toBeCloseTo(358 / 508); // 床 150（下調べの表の 0.705）
    expect(borrowUpperRatio(508, 0.5, 200, 144)).toBeCloseTo(356 / 508); // 床 152
    expect(borrowUpperRatio(508, 0.5, 50, 112)).toBeCloseTo(304 / 508); // 要るだけ
    expect(borrowUpperRatio(900, 0.5, 79, 112)).toBeCloseTo(529 / 900);
    expect(borrowUpperRatio(508, 0.5, 200, Number.NaN)).toBeCloseTo(358 / 508); // 測れなければ 150
  });
  it('needPx が 0 以下・全体が 240 未満なら借りない', () => {
    expect(BORROW_TOTAL_MIN).toBe(UPPER_SPLIT_MIN * 2);
    expect(borrowUpperRatio(508, 0.5, 0, 112)).toBeNull();
    expect(borrowUpperRatio(508, 0.5, -30, 112)).toBeNull();
    expect(borrowUpperRatio(508, 0.5, Number.NaN, 112)).toBeNull();
    expect(borrowUpperRatio(239, 0.3, 500, 0)).toBeNull();
    expect(borrowUpperRatio(Number.NaN, 0.5, 200, 112)).toBeNull();
  });
  it('今の上より狭めない（今の上が床の許す所より高ければ借りない）', () => {
    expect(borrowUpperRatio(508, 0.8, 200, 112)).toBeNull(); // 上 406 ＞ 508 − 150
    expect(borrowUpperRatio(508, 358 / 508, 200, 112)).toBeNull(); // もう床まで
    expect(borrowUpperRatio(300, 0.5, 200, 112)).toBeNull(); // 上 150、床 150
    expect(borrowUpperRatio(508, 0.5, 200, 400)).toBeNull(); // 動かない部分が高い：床 408
  });
  it('借りたら、上は今より高く、下は床以上・120 以上', () => {
    for (const total of [300, 508, 700, 900]) {
      for (const ratio of [0.2, 0.35, 0.5, 0.6]) {
        for (const px of [1, 40, 200, 2000]) {
          for (const fixed of [0, 112, 144, 200]) {
            const next = borrowUpperRatio(total, ratio, px, fixed);
            if (next === null) continue;
            const floor = Math.max(150, fixed + 8);
            expect(next * total).toBeGreaterThan(clampUpperRatio(total, ratio) * total);
            expect(next * total).toBeLessThanOrEqual(clampUpperRatio(total, ratio) * total + px + 1e-9);
            expect((1 - next) * total).toBeGreaterThanOrEqual(floor - 1e-9); // 借りる（null でない）ときは、今の下が床より高い。下は床までしか狭めない
            expect((1 - next) * total).toBeGreaterThanOrEqual(UPPER_SPLIT_MIN - 1e-9);
          }
        }
      }
    }
  });
});

describe('ピンチで終えたあと', () => {
  it('高さを戻すのを待つのは zoom だけ。ほかの理由はその場で戻す', () => {
    const ends: OverviewEnd[] = ['return', 'zoom', 'memo', 'close', 'place', 'shape', 'hide', 'jump'];
    expect(ends.filter(overviewUpperWaits)).toEqual(['zoom']);
  });
  it('待つ長さは 400ms（保存の待ちと同じ）', () => {
    expect(UPPER_BACK_MS).toBe(400);
    expect(UPPER_BACK_MS).toBe(VIEW_SAVE_DELAY);
  });
  it('戻すときは、面の真ん中に見えていた点が真ん中に残るよう、y を高さの差の半分だけ動かす（倍率と x はそのまま）', () => {
    const v: BoardView = { x: 10, y: 40, zoom: 0.5 };
    const back = upperGiveBackView(v, 400, 254);
    expect(back).toEqual({ x: 10, y: -33, zoom: 0.5 });
    const centerOf = (view: BoardView, h: number) => (h / 2 - view.y) / view.zoom; // 面の真ん中に見えるボードの y
    expect(centerOf(back, 254)).toBeCloseTo(centerOf(v, 400));
    expect(upperGiveBackView(v, 300, 300)).toBe(v);
    expect(upperGiveBackView(v, Number.NaN, 300)).toBe(v);
  });
});

describe('memo-pane.ts の配線（MK3）', () => {
  const borrow = cut(pane, 'function borrowUpper(needPx: number): boolean {', '\n  }\n');
  const release = cut(pane, 'function releaseUpper() {', '\n  }\n');
  it('借りる前の割合は、上の境目の割合の隣の閉じた変数（保存しない）', () => {
    expect(pane).toContain('let upperBorrowedFrom: number | null = null;');
    expect(pane.indexOf('let upperBorrowedFrom')).toBeGreaterThan(pane.indexOf('let upperRatio = UPPER_SPLIT_DEFAULT;'));
  });
  it('borrowUpper：上に出していて、持ち主がボードで、まだ借りていず、下の区画で窓が開いていないときだけ。量は borrowUpperRatio。覚えてから、保存しない道で下げる', () => {
    expect(borrow).toContain("if (upperBorrowedFrom !== null || upperOwner !== 'board' || !root.classList.contains('is-cards-upper') || lowerWindowOpen()) return false;");
    expect(borrow).toContain('const next = borrowUpperRatio(splittableHeight(), upperRatio, needPx, lowerFixedHeight());');
    expect(borrow).toContain('if (next === null) return false;');
    inOrder(borrow, ['if (next === null) return false;', 'upperBorrowedFrom = upperRatio;', 'setUpperRatio(next, false);', 'return true;']);
    expect(code(borrow)).not.toMatch(/writeOwnerRatio|writeBoardUpperRatio|, true\)/);
  });
  it('releaseUpper：上に出していて、持ち主がボードで、借りているときだけ。覚えた割合をそのまま入れて並べ直す（保存しない・clamp しない）', () => {
    expect(release).toMatch(/^function releaseUpper\(\) \{\s*if \(upperBorrowedFrom === null \|\| upperOwner !== 'board' \|\| !root\.classList\.contains\('is-cards-upper'\)\) return;/);
    inOrder(release, ['upperRatio = upperBorrowedFrom;', 'upperBorrowedFrom = null;', 'layoutUpperSplit();', 'placeOpenWindows();']);
    expect(code(release)).not.toMatch(/setUpperRatio|writeOwnerRatio|writeBoardUpperRatio/);
  });
  it('戻したら、開いている窓と並びに出したカードを置き直す（借りている間に開いた窓は狭い下に合わせて置かれている。窓の大きさが替わったときと同じ関数）', () => {
    const place = cut(pane, 'function placeOpenWindows() {', '\n  }\n');
    for (const call of ['if (!listWindow.hidden) placeListWindow();', 'if (!linkBar.hidden) placeLinkBar();', 'if (!linkPicker.hidden) placeLinkPicker();', 'if (!tplDialog.hidden) placeTplDialog();', 'if (!tplPalette.hidden) placeTplPalette();', 'if (!tplFill.hidden) placeTplFill();', 'if (!tplImport.hidden) placeTplImport();', 'if (!tplAsk.hidden) placeTplAsk();', 'listPops.place();']) expect(place, call).toContain(call);
    expect(pane).toContain("window.addEventListener('resize', () => placeOpenWindows());");
    expect(code(borrow)).not.toContain('placeOpenWindows'); // 借りるときは窓が開いていない（lowerWindowOpen で断る）
  });
  it('つまみに触ったら借りた状態を終える（捨てる所は 4 つ：つまみの pointerdown・setUpperRatio の保存の枝・持ち主が替わる枝・上をやめる枝）', () => {
    const c = code(pane);
    expect(count(c, 'upperBorrowedFrom = null;')).toBe(5); // 4 つ＋返すとき
    expect(cut(pane, "handle.addEventListener('pointerdown', (e) => {", 'try {')).toMatch(/pointerId = e\.pointerId;\s*upperBorrowedFrom = null;/);
    const set = cut(pane, 'function setUpperRatio(next: number, persist: boolean) {', '\n  }\n');
    expect(set).toMatch(/layoutUpperSplit\(\);\s*if \(!persist\) return;\s*upperBorrowedFrom = null;[^\n]*\n\s*writeOwnerRatio\(upperRatio\);/);
    const owner = cut(pane, 'if (on && onNow && owner !== upperOwner) {', 'return;');
    expect(owner).toMatch(/upperOwner = owner;\s*upperBorrowedFrom = null;/);
    inOrder(owner, ['upperBorrowedFrom = null;', 'upperRatio = readOwnerRatio();']);
    const off = cut(pane, 'unwatchUpperSplit();\n    upperBorrowedFrom = null;', "root.classList.remove('is-cards-upper');");
    expect(off).toContain('upperOwner = \'cards\';');
    // 矢印・Home・End・ダブルクリックは保存の枝を通る（keydown の頭は今のまま。保存は持ち主ごとの関数の 2 か所だけ）
    expect(pane.match(/writeOwnerRatio\(/g)).toHaveLength(2);
    expect(cut(pane, "handle.addEventListener('dblclick'", ');')).toContain('setUpperRatio(UPPER_SPLIT_DEFAULT, true');
  });
  it('窓の見方：一覧の窓・線の選び・型の小窓・空欄の小窓・取り込み・依頼の小窓（ほか、大きく見た画像・書き足しの面・マップ・浮いたカードの層の、並びに出したカードと「このカードの関連」の欄）', () => {
    const open = cut(pane, 'const lowerWindowOpen = () =>', '\n');
    for (const w of ['listWindow', 'linkBar', 'linkPicker', 'tplDialog', 'tplPalette', 'tplFill', 'tplImport', 'tplAsk', 'light', 'annotateLayer', 'cardMap.isOpen', 'listPops.size > 0', 'relMenu.isOpen']) expect(open, w).toContain(w);
    expect(open).toContain('.some((w) => !w.hidden)');
  });
  it('下の区画の動かない部分：下の包みの高さから伸び縮みする所（主の枠・メモが無いときの案内）を引き、書く欄を足す。借りるときに測る', () => {
    const fixed = cut(pane, 'function lowerFixedHeight(): number {', '\n  }\n');
    expect(fixed).toContain("root.querySelector(':scope > .memo-pane-lower')");
    expect(fixed).toContain('let fixed = lower.clientHeight;');
    expect(fixed).toContain('for (const grow of [main, empty]) if (grow.parentElement === lower && shown(grow)) fixed -= grow.offsetHeight;');
    expect(fixed).toContain('if (shown(main) && shown(compose)) fixed += compose.offsetHeight;');
  });
  it('ボードへの道：mountGrokCards に borrowUpper と releaseUpper を渡す（新しい命令は無い）', () => {
    const mount = cut(pane, 'const grokCardsUi = mountGrokCards({', '\n  });\n');
    expect(mount).toMatch(/setCardsUpper,\s*borrowUpper,[^\n]*\n\s*releaseUpper,/);
    expect(code(pane)).not.toMatch(/command: '\w*(?:[Bb]orrow|[Rr]elease)Upper/);
  });
  it('区画を閉じるとき（［閉じる］と、何も無いときの Esc は閉じる命令より前。左から閉じたときは、区画が隠れたという知らせで。高さの守りの外）も戻す', () => {
    const closeBtn = cut(pane, "close.addEventListener('click', () => {", '\n  });');
    inOrder(closeBtn, ['flush();', 'releaseUpper();', "ask({ command: 'memoPaneClose' });"]);
    const esc = cut(pane, 'if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;\n    e.preventDefault();\n    flush();', "ask({ command: 'memoPaneClose' });");
    expect(esc).toContain('releaseUpper();');
    // 高さの守り（!drag・高さの数）の枝の後ろで、別の if として見る（つまんでいる間・高さの数が無い知らせでも戻す）。setVisible のあと
    const sidebars = code(cut(pane, "} else if (msg.type === 'sidebars' && !drag", '\n  });\n'));
    expect(sidebars).toMatch(/grokCardsUi\.setVisible\(msg\.state\.memo\.visible !== false\);\s*\}\s*if \(msg\.type === 'sidebars' && msg\.state\.memo\?\.visible === false\) releaseUpper\(\);\s*$/);
    expect(count(code(pane), 'releaseUpper();')).toBe(3);
  });
  it('境目に transition は付けない（面の大きさを読んだとき、動いている途中の大きさにならないように）', () => {
    const upperCss = cut(paneCss, '.memo-pane.is-cards-upper > .grok-cards-upper,', '.memo-pane.is-cards-upper .memo-pane-split {');
    expect(upperCss).not.toContain('transition');
  });
});

describe('grok-cards.ts の配線（MK3）', () => {
  it('MountOpts の 2 つの口を、ボードの BoardCommands へそのまま渡す', () => {
    const opts = cut(cards, 'interface MountOpts {', '\n}\n');
    expect(opts).toContain('borrowUpper?(needPx: number): boolean;');
    expect(opts).toContain('releaseUpper?(): void;');
    const ensure = cut(cards, 'private ensureBoard() {', 'private paintBoardTab(');
    expect(ensure).toContain('borrowUpper: this.o.borrowUpper, releaseUpper: this.o.releaseUpper });');
  });
  it('Esc の段（consumeBoardUpperEsc）は替えない（戻すのはボードの leaveOverview の中）', () => {
    const esc = cut(cards, 'private consumeBoardUpperEsc(', '  onOpen(open: boolean) {');
    expect(esc).not.toMatch(/borrowUpper|releaseUpper/);
  });
});

describe('memo-board-tab.ts の配線（MK3）', () => {
  it('BoardCommands に borrowUpper（借りたら true）と releaseUpper。upperBorrowed は足さない', () => {
    const cmds = cut(tab, 'export interface BoardCommands {', '\n}\n');
    expect(cmds).toContain('borrowUpper?(needPx: number): boolean;');
    expect(cmds).toContain('releaseUpper?(): void;');
    expect(tab).not.toContain('upperBorrowed');
  });
  it('［全体］：守り → 戻し待ちなら先に戻す → 全体の位置 → 覚える（MK2）→ 間なら上を高くし、面を読み直して合わせ直す → 保存', () => {
    const fit = cut(tab, 'private fit() {', 'private actualSize() {');
    inOrder(fit, ['if (this.drag || this.marquee) return;', 'this.flushGiveBack();', 'const next = fitAll(this.faces, this.viewport(), this.geo.box);', 'if (!this.overview) this.overview = overviewStart(', 'this.view = next;', 'if (this.overview && this.borrowForOverview(vp)) this.view = fitAll(this.faces, this.viewport(), this.geo.box);', 'this.applyView();', 'this.touchView();']);
  });
  it('借りる量は overviewNeedPx（fitAll と同じカードと箱、今の面）。上に出しているときだけ頼む', () => {
    const borrow = cut(tab, 'private borrowForOverview(vp: { w: number; h: number }): boolean {', '\n  }\n');
    expect(borrow).toContain("if (this.place !== 'upper' || !this.cmds?.borrowUpper) return false;");
    expect(borrow).toContain('const need = overviewNeedPx(this.faces, vp, this.geo.box);');
    expect(borrow).toContain('return need > 0 && this.cmds.borrowUpper(need);');
    expect(count(code(tab), 'borrowUpper(')).toBe(1);
    expect(count(code(tab), 'this.borrowForOverview(')).toBe(1);
  });
  it('終える：待っていればその場で戻す（zoom のほか）。間を終えたら、zoom は時計、ほかはその場で戻す（戻るときは境目を戻してから面を読む）', () => {
    const end = cut(tab, 'private endOverview(reason: OverviewEnd) {', 'private giveBackUpper(');
    expect(end).toMatch(/^private endOverview\(reason: OverviewEnd\) \{\s*if \(!overviewUpperWaits\(reason\)\) this\.flushGiveBack\(\);/);
    expect(end).toMatch(/this\.overview = null;\s*if \(overviewUpperWaits\(reason\)\) this\.armGiveBack\(\);\s*else this\.giveBackUpper\(\);\s*if \(overviewGoesBack\(reason\)\) \{\s*const vp = this\.viewport\(\);/);
  });
  it('戻す口：時計を消して、下の区画の releaseUpper（寄せない。間をそのまま終えるとき）。待っていればだけ戻す口（flushGiveBack）は、時計と同じ道（giveBackCentered。y も寄せる）で、［全体］・100%・終わりの頭から', () => {
    const give = cut(tab, 'private giveBackUpper() {', '\n  }\n');
    inOrder(give, ['window.clearTimeout(this.upperTimer);', 'this.upperTimer = 0;', 'this.cmds?.releaseUpper?.();']);
    const flush = cut(tab, 'private flushGiveBack() {', '\n  }\n');
    expect(flush).toMatch(/^private flushGiveBack\(\) \{\s*if \(this\.upperTimer === 0\) return;/);
    inOrder(flush, ['if (this.upperTimer === 0) return;', 'window.clearTimeout(this.upperTimer);', 'this.upperTimer = 0;', 'this.giveBackCentered();']);
    expect(code(flush)).not.toContain('giveBackUpper'); // 寄せない道を通らない（［全体］が覚える位置・保存する位置が、高い面での位置のまま残らないように）
    expect(count(code(tab), 'this.flushGiveBack();')).toBe(3); // endOverview・fit・showActualSize
    expect(count(code(tab), 'this.cmds?.releaseUpper?.();')).toBe(2); // giveBackUpper と giveBackCentered
    expect(count(code(tab), 'this.giveBackCentered();')).toBe(2); // 時計と flushGiveBack
  });
  it('ピンチの時計：400ms。つまむ・範囲選択・パンの途中なら待ち直す。戻すのは giveBackCentered（戻す前と後の面の高さを読み、高さが替わったときだけ y を寄せて保存する）', () => {
    const arm = cut(tab, 'private armGiveBack() {', 'private borrowForOverview(');
    expect(arm).toContain('}, UPPER_BACK_MS);');
    expect(arm).toMatch(/if \(this\.drag \|\| this\.marquee \|\| this\.pan\) \{\s*this\.armGiveBack\(\);\s*return;\s*\}/);
    inOrder(arm, ['window.clearTimeout(this.upperTimer);', 'this.upperTimer = window.setTimeout(', 'this.upperTimer = 0;', 'this.armGiveBack();', 'this.giveBackCentered();', '}, UPPER_BACK_MS);']);
    const centered = cut(tab, 'private giveBackCentered() {', '\n  }\n');
    inOrder(centered, ['const h0 = this.stage.clientHeight;', 'this.cmds?.releaseUpper?.();', 'const h1 = this.viewport().h;', 'if (h0 <= 0 || h1 <= 0 || h1 === h0) return;', 'this.view = upperGiveBackView(this.view, h0, h1);', 'this.applyView();', 'this.touchView();']);
    expect(count(code(tab), 'upperGiveBackView(')).toBe(1);
    // 時計を書くのは giveBackUpper（1 か所）・flushGiveBack（1 か所）・armGiveBack（2 か所）の中だけ（保存の時計 viewTimer とは別）
    expect(count(code(tab), 'this.upperTimer = ')).toBe(4);
    expect(count(code(cut(tab, 'private giveBackUpper() {', '\n  }\n')), 'this.upperTimer = ')).toBe(1);
    expect(count(code(cut(tab, 'private flushGiveBack() {', '\n  }\n')), 'this.upperTimer = ')).toBe(1);
    expect(count(code(arm), 'this.upperTimer = ')).toBe(2);
    expect(code(centered)).not.toContain('this.upperTimer');
  });
  it('100%（showActualSize）：つまむ・範囲選択の間でなければ、面を読む前に戻し待ちを流す（あとで時計が 100% の位置を y で動かさない）。％の受け口 actualSize は MK2 のまま（間なら endOverview の頭で流れる）', () => {
    const inner = cut(tab, 'private showActualSize() {', 'private faceTop()');
    expect(inner).toMatch(/^private showActualSize\(\) \{\s*if \(!this\.drag && !this\.marquee\) this\.flushGiveBack\(\);/);
    inOrder(inner, ['this.flushGiveBack();', 'const vp = this.viewport();', 'if (vp.w <= 0 || vp.h <= 0 || this.drag || this.marquee) return;', 'this.view = actualSizeView(']);
    const size = cut(tab, 'private actualSize() {', 'private showActualSize() {');
    expect(size).toMatch(/if \(this\.overview\) this\.endOverview\('return'\);\s*else this\.showActualSize\(\);/);
  });
  it('wheel：頭の 2 文はそのまま。戻しを待っている間は、wheel のたびに待ち直す（止まってから戻す）', () => {
    const wheel = cut(tab, "'wheel',", '{ passive: false },');
    expect(wheel).toMatch(/^'wheel',\s*\(e\) => \{\s*e\.preventDefault\(\);\s*if \(this\.drag \|\| this\.marquee\) return;/);
    inOrder(wheel, ["if (this.view.zoom !== zoom0) this.endOverview('zoom');", 'this.applyView();', 'this.touchView();', 'if (this.upperTimer !== 0) this.armGiveBack();']);
  });
  it('ResizeObserver で借りる・戻す・合わせ直すをしない（境目を書いた同じ処理の中で面を読む）', () => {
    const ro = cut(tab, 'new ResizeObserver(() => {', '}).observe(this.stage);');
    for (const word of ['settleFace', 'borrow', 'GiveBack', 'releaseUpper', 'fitAll']) expect(ro, word).not.toContain(word);
  });
  it('上に出している間は［拡大］を隠す決まりはそのまま（借りるのは境目だけ）', () => {
    expect(tab).toContain('this.btn.hidden = !boardExpandShown(upper);');
    expect(code(cut(tab, 'private borrowForOverview(', '\n  }\n'))).not.toMatch(/this\.api|toggle\(|apply\(/);
  });
});
