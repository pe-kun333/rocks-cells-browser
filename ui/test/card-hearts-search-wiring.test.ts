// 右の検索の［カードの ♥］と［まとめてコピー］の配線（MK9。計画 docs/plan-comment-board-marks.md §4.9・§9.2）：字面の試験（パネルを偽物の DOM の上で動かす試験は card-hearts-search-panel.test.ts）
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unwrapT } from './source-text';
import { code } from './helpers';

const read = (path: string) => unwrapT(readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
const panel = read('../src/panels/search-panel.ts');
const secondary = read('../src/app/secondary.ts');
const primary = read('../src/app/primary.ts');
const types = read('../src/types.ts');
const css = read('../src/search.css');
const search = read('../src/search.ts');
const msearch = read('../src/memo-search.ts');
const count = (text: string, part: string) => text.split(part).length - 1;
const cut = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`見つかりません：${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b < 0) throw new Error(`見つかりません：${to}`);
  return src.slice(a, b);
};
const inOrder = (s: string, parts: string[]) => {
  const at = parts.map((p) => s.indexOf(p));
  expect(at.every((i) => i > -1), parts.join(' → ')).toBe(true);
  expect([...at].sort((a, b) => a - b), parts.join(' → ')).toEqual(at);
};

describe('命令の型（types.ts）', () => {
  it('searchMemos に省いてよい hearts（段）。新しい命令 copyCardHearts（字と段）。どちらも右から左（C++ は中継の中身を見ない）', () => {
    const t = code(types);
    expect(t).toMatch(/\|\s*\{ command: 'searchMemos'; seq: number; query: string; sort: SearchSort; limit: number; hearts\?: import\('\.\/likes'\)\.LikeLevel \}/);
    expect(t).toMatch(/\|\s*\{ command: 'copyCardHearts'; query: string; min: import\('\.\/likes'\)\.LikeLevel \}/);
    expect(count(t, "command: 'searchMemos'")).toBe(1);
    expect(count(t, "command: 'copyCardHearts'")).toBe(1);
  });
  it('行の型 SearchItem に cardLike と cardHead（メモの ♥ の liked とは別の欄）。search.ts は import を持たないまま（node の確かめの台本がそのまま読む）', () => {
    expect(search).toMatch(/\n\s*liked\?: number;[^\n]*\n\s*cardLike\?: number;[^\n]*\n\s*cardHead\?: string;/);
    expect(code(search)).not.toMatch(/^import /m);
  });
});

describe('左（primary.ts）', () => {
  it('searchMemos：hearts は likeLevel で確かめ、段があれば searchCardHearts（sort は使わない）、無ければ今の searchMemos。返事は今の searchResults', () => {
    const body = code(cut(primary, "case 'searchMemos': {", "case 'copyCardHearts': {"));
    inOrder(body, [
      'const hearts = likeLevel(action.hearts);',
      'const query = action.query.slice(0, 200);',
      'const found = !memos.ready ? { items: [], total: 0 } : hearts ? searchCardHearts(memos.list(), { query, min: hearts, limit }) : searchMemos(memos.list(), { query, sort, limit });',
      "payload: { kind: 'searchResults', seq: action.seq, ready: memos.ready, items: found.items, total: found.total }",
    ]);
    expect(body).toContain('!sidebars.right.visible) break;'); // 右が見えていなければ返さない（今のまま）
  });
  it('copyCardHearts の case：字と段の形を確かめてから、字を 200 字に切って copyCardHearts を呼ぶだけ', () => {
    const body = code(cut(primary, "case 'copyCardHearts': {", "case '"));
    expect(body).toMatch(/^case 'copyCardHearts': \{\s*const min = likeLevel\(action\.min\);\s*if \(typeof action\.query !== 'string' \|\| !min\) break;\s*void copyCardHearts\(action\.query\.slice\(0, 200\), min\);\s*break;\s*\}\s*$/);
    expect(count(code(primary), "case 'copyCardHearts'")).toBe(1);
  });
  it('copyCardHearts：台帳を読めていなければ今の準備中の字で断る → 台帳から組み直す（cardHeartsCopy）→ 0 件は一言だけ → ただの文で clipboardWrite（noHistory: true）→ 一言は右の検索の状態の行（tellSearch）', () => {
    const body = code(cut(primary, 'async function copyCardHearts(query: string, min: LikeLevel) {', '\n  }\n'));
    inOrder(body, ['if (!memos.ready) {', "tellSearch('メモ・コメントは準備中です（左がメモを読み込んでいます）');", 'return;', 'const built = cardHeartsCopy(memos.list(), { query, min });']);
    inOrder(body.slice(body.indexOf('const built = ')), [
      'if (built.count === 0) {',
      'tellSearch(cardHeartsCopyNote(0, 0));',
      'return;',
      "request((requestId) => ({ type: 'clipboardWrite', requestId, text: built.text, html: '', noHistory: true }), 8_000)",
      "const ok = answer?.type === 'clipboardWritten' && answer.ok;",
      "tellSearch(ok ? cardHeartsCopyNote(built.count, built.total) : 'コピーできませんでした');",
    ]);
    expect(body).not.toContain('toast('); // 一言は右の検索の状態の行だけ（今の右の一言の道）
    expect(count(code(primary), 'copyCardHearts(')).toBe(2); // 宣言・case
    expect(primary).toContain("import { cardHeartsCopy, cardHeartsCopyNote, searchCardHearts, searchMemos } from '../memo-search';");
  });
});

describe('右（secondary.ts・search-panel.ts）', () => {
  it('secondary：ask は段があるときだけ hearts の欄を付ける（切のときの命令の形は今のまま）。copyHearts → copyCardHearts', () => {
    expect(secondary).toContain("ask: (seq, query, sort, limit, hearts) => askLeft({ command: 'searchMemos', seq, query, sort, limit, ...(hearts ? { hearts } : {}) }),");
    expect(secondary).toContain("copyHearts: (query, min) => askLeft({ command: 'copyCardHearts', query, min }),");
  });
  it('口：ask に段（切なら null）、copyHearts（字と段）', () => {
    expect(panel).toMatch(/\n\s*ask\(seq: number, query: string, sort: SearchSort, limit: number, hearts: LikeLevel \| null\): void;/);
    expect(panel).toMatch(/\n\s*copyHearts\(query: string, min: LikeLevel\): void;/);
  });
  it('切り替えは覚えない：Prefs と loadPrefs は今の 3 つの欄だけ。切り替えと段はクラスの欄（区画を作るたびに切・♥1 以上）', () => {
    expect(code(cut(panel, 'interface Prefs {', '}'))).toMatch(/^interface Prefs \{\s*collapsed: boolean;\s*sort: SearchSort;\s*kinds: SearchTarget\[\];\s*$/);
    expect(cut(panel, 'function loadPrefs(): Prefs {', '\n}\n')).not.toMatch(/heart/i);
    expect(panel).toMatch(/\n\s*private hearts = false;\n\s*private heartMin: LikeLevel = 1;/);
    expect(code(panel)).not.toMatch(/this\.prefs\.heart/);
  });
  it('開くたびに切：検索をたたむと切り、♥ の結果も捨てる（たたむのは ▾ の押しだけ。開くのは ▸ と expand。動きは card-hearts-search-panel.test.ts）', () => {
    const fold = code(cut(panel, "this.fold.addEventListener('click', () => {", '});'));
    inOrder(fold, ['this.prefs.collapsed = !this.prefs.collapsed;', 'if (this.prefs.collapsed) {', 'this.hearts = false;', 'this.dropHeartsResult();', 'this.savePrefs();', 'this.renderFrame();']);
    expect(count(code(panel), 'this.prefs.collapsed = true')).toBe(0);
    expect(count(code(panel), 'this.hearts = false')).toBe(1);
  });
  it('字（計画 §9.2）：［カードの ♥］［♥1 以上］［♥2 以上］［♥3］［まとめてコピー］と状態の行「カードの ♥（新しい順）」。textContent（el の字）と属性だけ', () => {
    expect(panel).toContain("private readonly heartToggle = el('button', 'search-panel-heartbtn', 'カードの ♥');");
    expect(panel).toContain("private readonly heartCopy = el('button', 'search-panel-heartcopy', 'まとめてコピー');");
    expect(cut(panel, 'const HEART_BUTTONS: [LikeLevel, string][] = [', '];')).toMatch(/\[1, '♥1 以上'\],\s*\[2, '♥2 以上'\],\s*\[3, '♥3'\],/);
    expect(panel).toContain("const HEARTS_HEAD = 'カードの ♥（新しい順）';");
    expect(panel).not.toContain('innerHTML');
  });
  it('行の並び：対象の行の下に［カードの ♥］の行（切り替え → 段の絞りと［まとめてコピー］の箱）', () => {
    expect(panel).toContain('this.body.append(controls, kinds, hearts, this.status, this.list, this.more);');
    const build = cut(panel, "const hearts = el('div', 'search-panel-hearts');", 'this.status.setAttribute(');
    inOrder(build, ["hearts.setAttribute('aria-label', 'カードの ♥');", 'this.heartToggle.addEventListener(', 'for (const [level, label] of HEART_BUTTONS) {', 'this.heartOpts.append(button);', 'this.heartOpts.append(this.heartCopy);', 'hearts.append(this.heartToggle, this.heartOpts);']);
  });
  it('切り替え・段を押すと、描き直して頭から探し直す（今の並べ方・対象のボタンと同じ順）', () => {
    const toggle = cut(panel, 'this.heartToggle.addEventListener(', '});');
    inOrder(toggle, ['this.hearts = !this.hearts;', 'this.renderFrame();', 'this.resetPage();', 'this.schedule(0);']);
    const tier = cut(panel, 'for (const [level, label] of HEART_BUTTONS) {', 'this.heartButtons.set(level, button);');
    inOrder(tier, ['this.heartMin = level;', 'this.renderFrame();', 'this.resetPage();', 'this.schedule(0);']);
  });
  it('［まとめてコピー］は、出している結果の条件（shown の字と段）で左へ頼む（動きは card-hearts-search-panel.test.ts）', () => {
    const copy = cut(panel, "this.heartCopy.addEventListener('click', () => {", '});');
    expect(code(copy)).toMatch(/const shown = this\.shown;\s*if \(shown && shown\.hearts !== null\) this\.deps\.copyHearts\(shown\.query, shown\.hearts\);/);
  });
  it('探す：［カードの ♥］の間は、対象の選びによらず左に段を付けて頼む。右の中は探さない（compose・localChanged）', () => {
    const run = code(cut(panel, 'private run() {', 'private compose() {'));
    inOrder(run, ['const hearts = this.hearts ? this.heartMin : null;', 'hearts };', "if (hearts !== null || this.asked.kinds.includes('memo')) {", 'this.deps.ask(seq, query, this.prefs.sort, this.limit, hearts);']);
    expect(code(cut(panel, 'private compose() {', 'private renderFrame() {'))).toContain("const kinds = asked.hearts !== null ? [] : asked.kinds.filter((k): k is LocalKind => k !== 'memo');");
    expect(code(cut(panel, 'localChanged() {', 'private resetPage() {'))).toContain("if (this.asked.hearts !== null || !this.asked.kinds.some((k) => k !== 'memo')) return;");
  });
  it('描く：入れている間だけ段と［まとめてコピー］の箱を見せ、並べ方と対象のボタンは押せない。押した見た目は aria-pressed', () => {
    const frame = code(cut(panel, 'private renderFrame() {', 'private renderStatus('));
    expect(frame).toContain("this.heartToggle.setAttribute('aria-pressed', String(this.hearts));");
    expect(frame).toContain('this.heartOpts.hidden = !this.hearts;');
    expect(frame).toContain('for (const button of [...this.sortButtons.values(), ...this.kindButtons.values()]) button.disabled = this.hearts;');
  });
  it('状態の行と見出しの件数：［カードの ♥］の結果を出している間は、renderStatus が頭を付ける（一言にも）。ふつうの検索の文は今のまま（字が空なら最近のメモ…、当たらなければ「見つかりませんでした」）', () => {
    expect(code(cut(panel, 'private renderStatus(text: string) {', 'private statusOf('))).toMatch(
      /const head = this\.shown !== null && this\.shown\.hearts !== null \? HEARTS_HEAD : '';\s*this\.status\.textContent = \[head, text\]\.filter\(Boolean\)\.join\('　'\);/,
    );
    const status = code(cut(panel, 'private statusOf(shown: Shown): string {', 'private renderRows() {'));
    inOrder(status, ['if (shown.recent && shown.hearts === null) {', "'最近のメモ（新しい順）'", '} else if (shown.total === 0) {', "if (!shown.recent) main = '見つかりませんでした';", 'return [main, ...shown.notes].filter(Boolean).join(\'　\');']);
    expect(code(panel)).not.toMatch(/this\.status\.textContent = (?!\[head, text\])/); // 状態の行に書くのは renderStatus だけ
    expect(panel).toContain("this.sub.textContent = (this.shown.recent && this.shown.hearts === null) || this.shown.total === 0 ? '' : tr('{0} 件', { 0: this.shown.total });");
  });
  it('行：「💬 ♥2 メモの題」（段は題の枠の中の span）。字が空なら抜き出しの席に文の頭。［上で開く］は今のコメントの行の道のまま', () => {
    const row = code(cut(panel, 'private rowNode(item: SearchItem): HTMLElement {', 'private localRowNode('));
    inOrder(row, [
      "const title = el('span', 'search-row-title');",
      "if (item.cardLike) title.append(el('span', 'search-row-like', `♥${item.cardLike}`), ' ');",
      'title.append(item.title);',
      "main.append(el('span', 'search-row-icon', item.kind === 'reply' ? '💬' : item.image ? '🖼' : '📝'), title);",
      'if (item.snippet) main.append(snippetNode(item.snippet));',
      "else if (item.cardHead) main.append(el('span', 'search-row-snippet', item.cardHead));",
      "if (item.kind === 'reply' && item.replyId) {",
    ]);
    expect(code(cut(panel, 'private metaOf(item: SearchItem): string {', 'private savePrefs() {'))).not.toContain('cardLike'); // メモの ♥（liked）とは混ぜない
  });
});

describe('CSS（search.css）', () => {
  it('［カードの ♥］の行と箱（hidden で消える）。ボタンは並べ方・対象と同じ形。段の字は ♥ の色の語（決め打ちの色は書かない）', () => {
    expect(cut(css, '.search-panel-hearts {', '}')).toContain('display: flex;');
    expect(cut(css, '.search-panel-heartopts[hidden] {', '}')).toContain('display: none;');
    expect(css).toContain('.search-panel-sortbtn,\n.search-panel-kindbtn,\n.search-panel-heartbtn,\n.search-panel-heartmin {');
    expect(css).toContain('.search-panel-sortbtn.on,\n.search-panel-kindbtn.on,\n.search-panel-heartbtn.on,\n.search-panel-heartmin.on {');
    expect(cut(css, '.search-panel-heartcopy {', '}')).toContain('color: var(--accent-ink);');
    expect(cut(css, '.search-row-like {', '}')).toContain('color: var(--heart);');
  });
});

describe('字の数（計画 §9.2 のほかに足さない）', () => {
  it('［カードの ♥］の字は一度ずつ。コピーの一言は memo-search.ts の cardHeartsCopyNote だけ', () => {
    for (const text of ["'♥1 以上'", "'♥2 以上'", "'♥3'", "'まとめてコピー'", "'カードの ♥（新しい順）'"]) expect(count(panel, text), text).toBe(1);
    expect(count(panel, "'カードの ♥'")).toBe(2); // 切り替えのボタンの字と、行の group の名前（読み上げ。同じ字）
    expect(count(msearch, "'コピーするカードがありません'")).toBe(1);
    expect(count(msearch, "件をコピーしました', { 0: ")).toBe(2);
    expect(code(primary)).not.toContain('件をコピーしました');
  });
});
