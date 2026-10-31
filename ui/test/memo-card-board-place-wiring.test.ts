// 案 C・C3：上に出す配線（下の区画の面の差し替え）の静的な確かめ。DOM を動かす確かめは headless の dev 画面（手順は docs/card-board-test-guide.ja.md）
//   ここでは「段 "2" が無い人には今までのまま」「命令は今までの setSidebar だけ」「C++ ・旗の読み方は変えていない」を、配線の文面で固める
import { readFileSync as readFile } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BOARD_TAB_TITLE_UPPER, PLACE_BUTTON_LABEL, PLACE_BUTTON_TITLE, SPLIT_LABEL, boardTabLabel } from '../src/memo-card-board-place';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const cards = read('../src/app/grok-cards.ts');
const pane = read('../src/app/memo-pane.ts');
const tab = read('../src/app/memo-board-tab.ts');
const css = read('../src/grok-cards.css');

describe('ボタン・タブの文面', () => {
  it('上に出す／下に戻す。説明に「ページは隠れます」（出すほう）・「ページが見えるようになります」（戻すほう）', () => {
    expect(PLACE_BUTTON_LABEL).toEqual({ bottom: '上に出す', upper: '下に戻す' });
    expect(PLACE_BUTTON_TITLE.bottom).toContain('ページは隠れます');
    expect(PLACE_BUTTON_TITLE.upper).toContain('ページが見えるようになります');
  });
  it('上に出ているボードのタブは「↑ 上に出ています」。説明も下に戻すと分かる', () => {
    expect(boardTabLabel('upper')).toBe('↑ 上に出ています');
    expect(boardTabLabel('bottom')).toBe('ボード');
    expect(BOARD_TAB_TITLE_UPPER).toContain('下の面に戻します');
  });
  it('境目の名前は持ち主ごと', () => {
    expect(SPLIT_LABEL.cards).toMatch(/^Grok Cards とメモの境目/);
    expect(SPLIT_LABEL.board).toMatch(/^ボードとメモの境目/);
  });
});

describe('grok-cards.ts の配線', () => {
  it('ホストへの命令は今までの setSidebar だけ（新しい命令を足していない）。持ち主から決める', () => {
    expect(cards.match(/send\(\{ type: 'setSidebar'/g)).toHaveLength(2);
    expect(cards).toContain("send({ type: 'setSidebar', side: 'memo', place: 'upper', visible: true });");
    expect(cards).toContain("send({ type: 'setSidebar', side: 'memo', place: '' });");
    expect(cards).toContain('hostCommandFor(owner, this.sentUpper)');
    expect(cards).not.toContain('hostPlaceCommand');
  });
  it('ボードを上に出す分岐は、旗の廃止後も今までの形のまま（boardUpperEnabled は常に true）', () => {
    expect(cards).toMatch(/private isBoardUpper\(\): boolean \{\s*return !!this\.board && boardUpperEnabled\(\) && !this\.isUpper\(\) && readBoardPlace\(\) === 'upper';/);
    expect(cards).toMatch(/onBoardPlace\(\(\) => \{\s*if \(this\.placing \|\| !\(boardUpperEnabled\(\) \|\| this\.boardUp\)\) return;/);
    expect(cards).toContain('if (boardUpperEnabled()) this.notice = settleBoardPlace();');
    expect(cards).toMatch(/if \(boardUpperEnabled\(\) \|\| this\.boardUp\) this\.applyPlace\(\); \/\/ 置き場も組み替える\s*else this\.applyChrome\(\);/);
    expect(cards).toMatch(/const placeOn = boardUpperEnabled\(\);\s*if \(this\.board && \(placeOn \|\| this\.placeUi\)\)/);
  });
  it('段 "2" が無いときの Grok Cards の置き場は今までどおり writeCardsPlace を直接呼ぶ', () => {
    expect(cards).toMatch(/private setCardsPlace\(place: CardsPlace\) \{\s*if \(!this\.board \|\| !boardUpperEnabled\(\)\) \{\s*writeCardsPlace\(place\);\s*return;/);
    expect(cards).toContain("this.setCardsPlace('bottom');");
    expect(cards).toContain('button.addEventListener(\'click\', () => this.setCardsPlace(place));');
  });
  it('置き場を書く最中は面を組み替えず、書き終えてから 1 回だけ（途中の「両方なし」で空の place を送らない）', () => {
    expect(cards).toMatch(/this\.placing = true;\s*try \{\s*note = requestPlace\(req\)\.note;\s*\} finally \{\s*this\.placing = false;\s*\}\s*this\.applyPlace\(\);/);
    expect(cards).toContain('if (this.placing) return;');
  });
  it('持ち主が替わるときは、持たないほうを先に下の枠へ戻してから上の入れ物へ入れる', () => {
    const sync = cards.slice(cards.indexOf('private syncUpperDom'), cards.indexOf('private pushHost'));
    expect(sync.indexOf("down(owner === 'cards' ? this.board?.root : this.root)")).toBeGreaterThan(-1);
    expect(sync.indexOf('down(owner')).toBeLessThan(sync.indexOf('this.o.setCardsUpper(true, owner)'));
    expect(sync.indexOf('down(this.board?.root);')).toBeLessThan(sync.indexOf('this.o.setCardsUpper(false)'));
  });
  it('ボードが上に出るとき、下でボードを見ていたなら下のタブはメモへ（広げた高さは戻す）', () => {
    expect(cards).toMatch(/if \(bu && this\.tab === 'board'\) \{\s*this\.leaveBoard\(\);\s*this\.tab = 'memo';\s*\}/);
  });
  it('Esc の決まり（下に出しているとき・Grok Cards・段 "2" 無し）は C4 でも変えない', () => {
    expect(cards).toContain('const action = escAction(this.tab,');
    // メモのタブのときの Esc は、ボードを上に出しているときだけ専用の道。出していなければ今までどおり false
    expect(cards).toContain("if (this.tab === 'memo') return this.consumeBoardUpperEsc(e);");
    expect(cards).toContain('if (!board || !this.isBoardUpper()) return false;');
    expect(cards).toContain('if (!board.keysAllowed(e.target)) return false;');
  });
});

describe('memo-pane.ts の配線', () => {
  it('setCardsUpper は持ち主を受ける（既定は Grok Cards）。割合の鍵は持ち主ごと', () => {
    expect(pane).toContain("function setCardsUpper(on: boolean, owner: 'cards' | 'board' = 'cards')");
    expect(pane).toContain("(upperOwner === 'board' ? readBoardUpperRatio() : readUpperRatio())");
    expect(pane).toContain("(upperOwner === 'board' ? writeBoardUpperRatio(ratio) : writeUpperRatio(ratio))");
    // 割合の保存は持ち主ごとの関数だけを通る（直接 writeUpperRatio を呼ぶ所は無い）
    expect(pane.match(/writeUpperRatio\(/g)).toHaveLength(1);
    expect(pane.match(/writeOwnerRatio\(/g)).toHaveLength(2); // 境目を離したとき・矢印キー等で変えたとき
  });
  it('上の入れ物を片づけるときは Grok Cards の根もボードの面も下の枠へ戻す', () => {
    expect(pane).toContain("upper.querySelectorAll(':scope > .grok-cards, :scope > .memo-board')");
  });
});

describe('memo-board-tab.ts の配線', () => {
  it('ボタンは最初は隠れていて、上に出せる（段 "2"）と下の区画が言ったときだけ出す。上のあいだは［拡大］を隠す', () => {
    expect(tab).toMatch(/this\.placeBtn\.hidden = true;/);
    expect(tab).toContain('this.placeBtn.hidden = !available || !this.cmds?.place;');
    expect(tab).toContain('this.btn.hidden = !boardExpandShown(upper);');
    expect(tab).toContain("this.cmds?.place?.request(this.place === 'upper' ? 'bottom' : 'upper')");
  });
});

describe('CSS・C++・旗', () => {
  it('ボタンの見た目は既存の部品（ボタンの共通の規則）に足すだけ。折り返さない。新しい色は作らない', () => {
    expect(css).toMatch(/\.memo-board-expand,\s*\.memo-board-place,\s*\.memo-board-fit\s*{\s*padding: 1px 10px;/);
    expect(css).toMatch(/\.memo-board-place\s*{\s*white-space: nowrap;\s*}/);
    const rule = css.slice(css.indexOf('.memo-board-place {'), css.indexOf('.memo-board-place {') + 80);
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });
  it('旗の廃止：上に出すは常にオン（boardUpperEnabled は true を返すだけ）。段 "3" は cardsStageOn が常にオンにし、ほかの段は旗のまま', () => {
    const stages = read('../src/card-board-stages.ts');
    expect(stages).toMatch(/export function boardUpperEnabled\(\): boolean \{\s*return true;\s*\}/);
    const cardsStages = read('../src/cards-stages.ts');
    expect(cardsStages).toMatch(/export function cardsStageOn\(stage: string\): boolean \{\s*if \(stage === '3'\) return (?:true|BOT_FEATURES);/);
    expect(cardsStages).toContain('cardsStagesFromStorage(localStorage.getItem(CARDS_STAGES_KEY)).some((item) => item === stage)');
  });
  it('新しい命令・型は足していない（types.ts・bridge.ts は触らない）', () => {
    expect(cards).not.toMatch(/command: '(?:placeBoard|boardPlace|upperBoard)/);
    expect(tab).not.toMatch(/command: '(?:placeBoard|boardPlace|upperBoard)/);
  });
});