// 「下で開く」：右のメモの区画の右クリックから、中央の下の区画のボードで、そのメモを見る
//   分かれ（lowerBoardPlan）と呼ぶ順（runLowerBoardOpen）・左の MemoPaneHost に当てたときの結果・配線の字面を確かめる。DOM を動かす確かめは開発画面で
//   書き方は board-open-upper.test.ts（「上のコメントボードで開く」）に合わせる
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as Array<Record<string, any>>);
vi.mock('../src/bridge', () => ({ surface: 'left', send: (m: Record<string, any>) => void sent.push(m), onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async () => ({ status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { lowerBoardPlan, runLowerBoardOpen } from '../src/board-open-plan';
import { noticeTarget } from '../src/memo-board-pick';
import { MemoPaneHost } from '../src/memo-pane-host';
import { isSpecialCell, type MemoCell } from '../src/memocells';
import { code } from './helpers';
import { unwrapT } from './source-text';

describe('lowerBoardPlan：下の区画とボードの替え方', () => {
  it('a. 選べないメモ（無い・特別なセル）：下がどうでも、書きかけがあってもなくても断る（何も替えない）', () => {
    for (const lower of [null, 'A', 'B']) for (const draft of [false, true]) expect(lowerBoardPlan({ lower, id: 'B', usable: false, draft })).toEqual({ ok: false });
  });
  it('b. 下が同じメモを開いている：ボードの選びを外す（ボードは下のメモに付いていく）。下は開き直さない（書きかけがあっても同じ）', () => {
    for (const draft of [false, true]) expect(lowerBoardPlan({ lower: 'A', id: 'A', usable: true, draft })).toEqual({ ok: true, open: null, boardMemo: null, keptDraft: false });
  });
  it('c. 下が閉じている：下にそのメモを開き（ダブルクリックと同じ）、ボードの選びを外す', () => {
    for (const draft of [false, true]) expect(lowerBoardPlan({ lower: null, id: 'B', usable: true, draft })).toEqual({ ok: true, open: 'B', boardMemo: null, keptDraft: false });
  });
  it('d. 下が別のメモで、書きかけが無い：下もそのメモに替え（左のカードの「下で開く」と同じ）、ボードの選びを外す', () => {
    expect(lowerBoardPlan({ lower: 'A', id: 'B', usable: true, draft: false })).toEqual({ ok: true, open: 'B', boardMemo: null, keptDraft: false });
  });
  it('e. 下が別のメモで、書きかけがある：下は替えない（書きかけを消さない）。ボードだけがそのメモを見て、そのことを知らせる', () => {
    expect(lowerBoardPlan({ lower: 'A', id: 'B', usable: true, draft: true })).toEqual({ ok: true, open: null, boardMemo: 'B', keptDraft: true });
  });
});

describe('runLowerBoardOpen：呼ぶ順と回数（偽物の関数で）', () => {
  function fake(lower: string | null, id: string, usable: boolean, draft: boolean, accept = true) {
    const calls: string[] = [];
    const done = runLowerBoardOpen({
      lower,
      id,
      usable,
      draft,
      setBoardMemo: (next) => {
        calls.push(`setBoardMemo:${next}`);
        return accept;
      },
      open: (next) => void calls.push(`open:${next}`),
      askLower: () => void calls.push('askLower'),
      tellKept: () => void calls.push('tellKept'),
      refuse: () => void calls.push('refuse'),
    });
    return { done, calls };
  }
  const times = (calls: string[], head: string) => calls.filter((c) => c === head || c.startsWith(`${head}:`)).length;

  it('a. 選べないメモ：refuse だけを呼ぶ（選びも、開くも、頼みも、知らせもしない）', () => {
    for (const lower of [null, 'A', 'B']) for (const draft of [false, true]) expect(fake(lower, 'B', false, draft)).toEqual({ done: false, calls: ['refuse'] });
  });
  it('b. 下も A・A を開く：ボードの選びを外し、下に出す頼みを 1 回。下は開き直さない・知らせない（書きかけがあっても同じ）', () => {
    for (const draft of [false, true]) expect(fake('A', 'A', true, draft)).toEqual({ done: true, calls: ['setBoardMemo:null', 'askLower'] });
  });
  it('c. 下が閉じている：選びを外す → 下に開く → 下に出す頼み、の順に 1 回ずつ', () => {
    expect(fake(null, 'C', true, false)).toEqual({ done: true, calls: ['setBoardMemo:null', 'open:C', 'askLower'] });
  });
  it('d. 下は A・書きかけ無し・B を開く：選びを外す → 下に B を開く → 下に出す頼み。知らせない', () => {
    expect(fake('A', 'B', true, false)).toEqual({ done: true, calls: ['setBoardMemo:null', 'open:B', 'askLower'] });
  });
  it('e. 下は A・書きかけあり・B を開く：ボードだけ B を選ぶ → 下に出す頼み → 知らせ。下は開かない', () => {
    expect(fake('A', 'B', true, true)).toEqual({ done: true, calls: ['setBoardMemo:B', 'askLower', 'tellKept'] });
  });
  it('setBoardMemo が断ったとき（間に消えたなど）：開かず、頼まず、知らせず、refuse を呼ぶ', () => {
    expect(fake('A', 'B', true, true, false)).toEqual({ done: false, calls: ['setBoardMemo:B', 'refuse'] });
    expect(fake('A', 'B', true, false, false)).toEqual({ done: false, calls: ['setBoardMemo:null', 'refuse'] });
    expect(fake(null, 'B', true, false, false)).toEqual({ done: false, calls: ['setBoardMemo:null', 'refuse'] });
  });
  it('回数の表：頼みは b〜e で 1 回・知らせは e だけ 1 回・open は c と d で 1 回（b と e は 0 回）・refuse は a だけ', () => {
    const rows: Array<[string, ReturnType<typeof fake>, { askLower: number; tellKept: number; open: number; refuse: number }]> = [
      ['a', fake('A', 'B', false, true), { askLower: 0, tellKept: 0, open: 0, refuse: 1 }],
      ['b', fake('A', 'A', true, true), { askLower: 1, tellKept: 0, open: 0, refuse: 0 }],
      ['c', fake(null, 'B', true, false), { askLower: 1, tellKept: 0, open: 1, refuse: 0 }],
      ['d', fake('A', 'B', true, false), { askLower: 1, tellKept: 0, open: 1, refuse: 0 }],
      ['e', fake('A', 'B', true, true), { askLower: 1, tellKept: 1, open: 0, refuse: 0 }],
    ];
    for (const [name, got, want] of rows) {
      const seen = { askLower: times(got.calls, 'askLower'), tellKept: times(got.calls, 'tellKept'), open: times(got.calls, 'open'), refuse: times(got.calls, 'refuse') };
      expect(seen, name).toEqual(want);
    }
  });
});

// 本物の MemoPaneHost を runLowerBoardOpen につないだとき（下の区画とボードの写しの送り方）
describe('MemoPaneHost につないだとき', () => {
  const store: Record<string, string> = {};
  const reply = (id: string) => ({ id, parent: null, text: 'カード', createdAt: 1 });
  const memo = (id: string, over: Record<string, unknown> = {}) =>
    ({ id, sheet: 'main', text: id, tags: [], liked: 0, replies: [reply(`${id}-r1`)], createdAt: 1, updatedAt: 1, pos: { q: 0, r: 0 }, ...over }) as unknown as MemoCell;

  beforeEach(() => {
    sent.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] });
  });
  afterEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup(initial: MemoCell[]) {
    const cells = new Map(initial.map((m) => [m.id, m]));
    const memos = { get: (id: string) => cells.get(id), inSheet: () => [...cells.values()], onChange: () => {} };
    const host = new MemoPaneHost({ memos: memos as never, sheets: { get: () => undefined, onChange: () => {} } as never, store: { active: null, onChange: () => {} } as never, toast: () => {}, onOpenChange: () => {} });
    let asked = 0;
    let told = 0;
    let refused = 0;
    const press = (id: string, draft = false) => {
      const cell = cells.get(id);
      return runLowerBoardOpen({
        lower: host.openId,
        id,
        usable: !!cell && !isSpecialCell(cell),
        draft,
        setBoardMemo: (next) => host.setBoardMemo(next),
        open: (next) => host.open(next),
        askLower: () => void (asked += 1),
        tellKept: () => void (told += 1),
        refuse: () => void (refused += 1),
      });
    };
    return { host, press, counts: () => ({ asked, told, refused }) };
  }
  const relays = () => sent.filter((m) => m.type === 'relay').map((m) => m.payload as Record<string, any>);

  it('a. 無いメモ・特別なセル：断る。下もボードも変えず、何も送らない', () => {
    const s = setup([memo('A'), memo('B'), memo('p1', { portal: 'x' }), memo('b1', { bot: 'x' }), memo('a1', { app: 'x' }), memo('c1', { capture: 'x' })]);
    s.host.open('A');
    s.host.setBoardMemo('B');
    sent.length = 0;
    for (const id of ['nope', 'p1', 'b1', 'a1', 'c1']) expect(s.press(id, true)).toBe(false);
    expect(s.host.openId).toBe('A');
    expect(s.host.boardMemoId).toBe('B');
    expect(sent).toEqual([]);
    expect(s.counts()).toEqual({ asked: 0, told: 0, refused: 5 });
  });
  it('b. 下は A・ボードは B：A で開くと、ボードの選びを外す（null を一度だけ送る）。下は A のまま（開き直さない）', () => {
    const s = setup([memo('A'), memo('B')]);
    s.host.open('A');
    s.host.setBoardMemo('B');
    sent.length = 0;
    expect(s.press('A', true)).toBe(true);
    expect(s.host.openId).toBe('A');
    expect(s.host.boardMemoId).toBeNull();
    expect(relays()).toEqual([{ kind: 'memoBoardView', view: null }]);
    expect(s.counts()).toEqual({ asked: 1, told: 0, refused: 0 });
  });
  it('c. 下が閉じている（ボードは前に B を選んでいた）：C を下に開き、ボードは下に付いていく。下の面を出す', () => {
    const s = setup([memo('B'), memo('C')]);
    s.host.setBoardMemo('B');
    sent.length = 0;
    expect(s.press('C')).toBe(true);
    expect(s.host.openId).toBe('C');
    expect(s.host.boardMemoId).toBeNull();
    expect(sent.some((m) => m.type === 'setSidebar' && m.side === 'memo' && m.visible === true)).toBe(true);
    expect(relays()[0]).toEqual({ kind: 'memoBoardView', view: null });
    expect(relays().find((p) => p.kind === 'memoPane')?.view.id).toBe('C');
    expect(s.counts()).toEqual({ asked: 1, told: 0, refused: 0 });
  });
  it('d. 下は A・書きかけ無し：B を押すと、下も B に替わり、ボードは下に付いていく（選んでいなければ memoBoardView は送らない）', () => {
    const s = setup([memo('A'), memo('B')]);
    s.host.open('A');
    sent.length = 0;
    expect(s.press('B', false)).toBe(true);
    expect(s.host.openId).toBe('B');
    expect(s.host.boardMemoId).toBeNull();
    expect(relays().find((p) => p.kind === 'memoPane')?.view.id).toBe('B');
    expect(relays().some((p) => p.kind === 'memoBoardView')).toBe(false);
    expect(s.counts()).toEqual({ asked: 1, told: 0, refused: 0 });
  });
  it('d. 下は A・ボードは C・書きかけ無し：B を押すと、ボードの選びを外して（null を一度だけ）、下を B に替える', () => {
    const s = setup([memo('A'), memo('B'), memo('C')]);
    s.host.open('A');
    s.host.setBoardMemo('C');
    sent.length = 0;
    expect(s.press('B', false)).toBe(true);
    expect(s.host.openId).toBe('B');
    expect(s.host.boardMemoId).toBeNull();
    expect(relays()[0]).toEqual({ kind: 'memoBoardView', view: null });
    expect(relays().filter((p) => p.kind === 'memoBoardView')).toHaveLength(1);
    expect(relays().find((p) => p.kind === 'memoPane')?.view.id).toBe('B');
  });
  it('e. 下は A・書きかけあり：B を押すと、下は A のまま（memoPane を送らない）。ボードだけ B を見て、知らせを 1 回', () => {
    const s = setup([memo('A'), memo('B')]);
    s.host.open('A');
    sent.length = 0;
    expect(s.press('B', true)).toBe(true);
    expect(s.host.openId).toBe('A');
    expect(s.host.boardMemoId).toBe('B');
    expect(relays().map((p) => p.kind)).toEqual(['memoBoardView']);
    expect(relays()[0].view.id).toBe('B');
    expect(s.counts()).toEqual({ asked: 1, told: 1, refused: 0 });
  });
  it('e の知らせの出し先：ボードが B・下が A のとき、B のことの知らせはボードの一言欄だけに出る（下の面の noticeTarget）', () => {
    expect(noticeTarget({ memo: 'B', lowerId: 'A', chosenId: 'B' })).toBe('board');
  });
});

const read = (path: string) => unwrapT(readFileSync(new URL(path, import.meta.url), 'utf8'));
const primary = read('../src/app/primary.ts');
const pane = read('../src/app/memo-pane.ts');
const cards = read('../src/app/grok-cards.ts');
const pad = read('../src/panels/memo-pad.ts');
const types = read('../src/types.ts');
const count = (text: string, part: string) => text.split(part).length - 1;
const bodyOf = (text: string, start: string) => {
  const from = text.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  const rest = text.slice(from + start.length);
  const next = rest.search(/\n  (?:\/\/ |function |async function |let |const )/);
  return rest.slice(0, next < 0 ? rest.length : next);
};
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from, to);
};
// その字を含む行（1 行だけのはず）
const lineWith = (text: string, part: string) => {
  const lines = text.split(/\r?\n/).filter((line) => line.includes(part));
  expect(lines, part).toHaveLength(1);
  return lines[0];
};
const indentOf = (line: string) => line.length - line.trimStart().length;

describe('右のメモの区画の右クリック（memo-pad.ts の menuFor）', () => {
  it('セルとコメントの右クリックは同じ menuFor。特別なセルかどうかは isSpecialCell で決める', () => {
    expect(pad).toMatch(/private menuFor\(memo: RightMemo, from: 'cell' \| 'post'\): MenuEntry\[\] \{/);
    expect(code(between(pad, 'private menuFor(', '// ---------- 蜂の巣'))).toContain('const special = isSpecialCell(memo);');
  });
  it('特別なセルでないとき、セルとコメントのどちらにも出す。条件の無い文で、「コメントへ移る／セルへ移る」と「上のコメントボードで開く」の間・同じ字下げ。押すと左へ openLowerBoard を頼む', () => {
    const menu = code(between(pad, 'private menuFor(', '// ---------- 蜂の巣'));
    const plain = between(menu, 'if (!special) {', "if (!special) entries.push({ label: 'コピー'");
    const mine = lineWith(plain, "label: '下で開く'");
    expect(mine.trim().startsWith("entries.push({ label: '下で開く'")).toBe(true);
    // 行を丸ごと縛る（disabled などを足しても通らないように。行の末の注釈は code() が消し、空白は \s* で受ける）
    expect(mine).toMatch(/^\s*entries\.push\(\{ label: '下で開く', hint: '下の区画のボードで見ます', run: \(\) => this\.deps\.askLeft\(\{ command: 'openLowerBoard', id: memo\.id \}\) \}\);\s*$/);
    // if (!special) { の中の文の並びを丸ごと縛る（前の行に条件を置いても通らないように）
    expect(plain).toMatch(/^if \(!special\) \{\s*entries\.push\(from === 'cell' \? [^\n]*\);\s*entries\.push\(\{ label: '下で開く', [^\n]*\);\s*entries\.push\(\{ label: '上のコメントボードで開く', [^\n]*\);\s*\}\s*$/);
    expect(mine).not.toContain('from'); // セルかコメントかで分けない
    const move = lineWith(plain, "label: 'コメントへ移る'");
    expect(move).toContain("label: 'セルへ移る'");
    const upper = lineWith(plain, "label: '上のコメントボードで開く'");
    expect(indentOf(mine)).toBe(indentOf(move));
    expect(indentOf(mine)).toBe(indentOf(upper));
    // 並び：コメントへ移る／セルへ移る → 下で開く → 上のコメントボードで開く
    expect(plain.indexOf(mine)).toBeGreaterThan(plain.indexOf(move));
    expect(plain.indexOf(mine)).toBeLessThan(plain.indexOf(upper));
    expect(count(code(pad), "'下で開く'")).toBe(1);
    expect(count(code(pad), "command: 'openLowerBoard'")).toBe(1);
  });
});

describe('左の処理（openOnLowerBoard・askLowerBoard・memoPaneReady・区画を閉じたとき）', () => {
  it('openOnLowerBoard：runLowerBoardOpen を呼ぶだけ。下の区画の世話役・書きかけの印・左の一言・ボードの一言欄への知らせをつなぐ', () => {
    const body = code(bodyOf(primary, 'function openOnLowerBoard(id: string) {'));
    expect(body).toMatch(/^\s*const memo = memos\.get\(id\);\s*runLowerBoardOpen\(\{/);
    expect(body).toMatch(/lower:\s*memoPane\.openId,\s*id,\s*usable:/); // id はすり替えない（id: memoPane.openId ?? id などで通らないように）
    expect(body).toMatch(/usable:\s*!!memo && !isSpecialCell\(memo\),/);
    expect(body).toMatch(/draft:\s*memoPaneDraft,/);
    expect(body).toMatch(/setBoardMemo:\s*\(next\) => memoPane\.setBoardMemo\(next\),/);
    expect(body).toMatch(/open:\s*\(next\) => memoPane\.open\(next\),/);
    expect(body).toMatch(/askLower:\s*askLowerBoard,/);
    expect(body).toMatch(/tellKept:\s*\(\) => tellMemo\('メモのタブに書きかけがあるので、そちらはそのままにして、ボードだけでこのメモを開きました', \{ memo: id \}\),/);
    expect(body).toMatch(/refuse:\s*\(\) => toast\('そのメモは、ボードで開けません（もう無いか、特別なセルです）'\),/);
    expect(body).toMatch(/\}\);\s*\}\s*$/); // runLowerBoardOpen の呼び出しで終わる（ほかの処理を足していない）
    expect(body).not.toContain('openMemoPane'); // 書きかけの守りは runLowerBoardOpen の e で持つ
  });
  it('askLowerBoard：上の印を下ろし、下の面がまだ動いていなければ下の印を立て、送る。送るのは sendLowerBoard の 1 か所だけ', () => {
    expect(code(bodyOf(primary, 'function askLowerBoard() {'))).toMatch(/^\s*boardUpperWanted = false;\s*lowerBoardWanted = !memoReady;\s*sendLowerBoard\(\);\s*\}\s*$/);
    expect(code(bodyOf(primary, 'function sendLowerBoard() {'))).toMatch(/^\s*send\(\{ type: 'relay', to: 'memo', payload: \{ kind: 'showLowerBoard' \} \}\);\s*\}\s*$/);
    expect(count(code(primary), "kind: 'showLowerBoard'")).toBe(1);
    expect(count(code(primary), 'sendLowerBoard()')).toBe(3); // 宣言・頼む所・送り直す所
    expect(count(code(primary), 'askLowerBoard')).toBe(2); // 宣言・openOnLowerBoard
  });
  it('askBoardUpper：先に下の印を下ろし、そのあとは今までどおり（上と下の頼みは、あとの頼みが勝つ）', () => {
    expect(code(bodyOf(primary, 'function askBoardUpper() {'))).toMatch(/^\s*lowerBoardWanted = false;\s*boardUpperWanted = !memoReady;\s*sendBoardUpper\(\);\s*\}\s*$/);
  });
  it('印を書く所は、どちらも 5 か所（宣言・区画を閉じたとき・上の頼み・下の頼み・memoPaneReady）', () => {
    expect(count(code(primary), 'lowerBoardWanted = ')).toBe(5);
    expect(count(code(primary), 'boardUpperWanted = ')).toBe(5);
  });
  it('memoPaneReady：上の 2 行のすぐあとで、下の印が立っていて下の区画が開いているときだけ送り直す。どちらでも印は下ろす', () => {
    const ready = code(between(primary, "case 'memoPaneReady':", "case '"));
    expect(ready).toMatch(/grokCards\.onMemoReady\(\);\s*if \(boardUpperWanted && memoPane\.isOpen\(\)\) sendBoardUpper\(\);\s*boardUpperWanted = false;\s*if \(lowerBoardWanted && memoPane\.isOpen\(\)\) sendLowerBoard\(\);\s*lowerBoardWanted = false;\s*break;\s*$/);
    expect(ready).toMatch(/memoPaneDraft = false;/); // 下の面が読み込み直された＝書きかけは無い（e の守りの前提）
  });
  it('区画を閉じたとき（onOpenChange(null)）：下の印も下ろす。印は上の印のすぐあと・区画の世話役より前に置く', () => {
    const upper = primary.indexOf('let boardUpperWanted = false;');
    const lower = primary.indexOf('let lowerBoardWanted = false;');
    const host = primary.indexOf('const memoPane = new MemoPaneHost({');
    expect(upper).toBeGreaterThan(-1);
    expect(lower).toBeGreaterThan(upper);
    expect(host).toBeGreaterThan(lower);
    expect(count(code(primary), 'let lowerBoardWanted')).toBe(1);
    const hooks = code(between(primary, 'const memoPane = new MemoPaneHost({', '});'));
    expect(hooks).toMatch(/onOpenChange: \(id\) => \{\s*if \(id === null\) boardUpperWanted = false;\s*if \(id === null\) lowerBoardWanted = false;/);
  });
  it('runCommand の openLowerBoard：id の形（文字列）を確かめてから、openOnLowerBoard を呼ぶだけ', () => {
    const body = code(between(primary, "case 'openLowerBoard': {", "case '"));
    expect(body).toMatch(/^case 'openLowerBoard': \{\s*if \(typeof action\.id !== 'string'\) break;\s*openOnLowerBoard\(action\.id\);\s*break;\s*\}\s*$/);
    expect(count(code(primary), "case 'openLowerBoard'")).toBe(1);
    expect(count(code(primary), 'openOnLowerBoard(')).toBe(2); // 宣言・右からの命令（盤面のメニューには足さない）
  });
  it('左のメモのセルの右クリック（openCellMenu）には足さない（依頼は右の区画だけ。左には「下に開いて書く」が既にある）', () => {
    const menu = code(bodyOf(primary, 'function openCellMenu('));
    expect(menu).not.toContain('openOnLowerBoard');
    expect(menu).toContain("label: '下に開いて書く（中央を上下に分ける）'");
    expect(count(code(primary), "'下で開く'")).toBe(0);
  });
  it('e の守りの前提：書きかけの印は、下の面の知らせ（memoPaneDraft）で立て下ろしする', () => {
    expect(code(between(primary, "case 'memoPaneDraft':", "case '"))).toMatch(/^case 'memoPaneDraft':\s*memoPaneDraft = action\.busy === true;\s*break;\s*$/);
  });
});

describe('命令の型と、下の面の受け口', () => {
  it('types.ts：右から左への openLowerBoard（id は文字列。RelayCommand）と、左から下の面への showLowerBoard（RelayPayload）', () => {
    const t = code(types);
    const commands = between(t, 'export type RelayCommand =', 'export type RelayPayload =');
    expect(commands).toMatch(/\|\s*\{ command: 'openLowerBoard'; id: string \}/);
    const payloads = t.slice(t.indexOf('export type RelayPayload ='));
    expect(payloads).toMatch(/\|\s*\{ kind: 'showLowerBoard' \}/);
    expect(count(t, "command: 'openLowerBoard'")).toBe(1);
    expect(count(t, "kind: 'showLowerBoard'")).toBe(1);
  });
  it('memo-pane.ts：showLowerBoard を受けて、GrokCardsMount の新しい口を呼ぶ（showBoardUpper の受け口のすぐ次）', () => {
    const p = code(pane);
    expect(p).toMatch(/else if \(msg\.type === 'relayed' && msg\.payload\.kind === 'showBoardUpper'\) grokCardsUi\.showBoardUpper\(\);\s*else if \(msg\.type === 'relayed' && msg\.payload\.kind === 'showLowerBoard'\) grokCardsUi\.showLowerBoard\(\);/);
    expect(count(p, 'showLowerBoard')).toBe(2);
  });
  it('grok-cards.ts：口は宣言・旗の無いときの空の実装・本体の 3 か所', () => {
    const c = code(cards);
    expect(c).toMatch(/\n\s*showLowerBoard\(\): void;/);
    expect(code(between(cards, "if (!cardsStageOn('3')) {", 'return new GrokCardsView(o);'))).toMatch(/showLowerBoard\(\)\s*\{\s*\},/);
    expect(count(c, 'showLowerBoard')).toBe(3);
  });
  it('grok-cards.ts の本体：置き場が上なら［下に戻す］と同じ placeBoard(\'bottom\')、そうでなければ showBoard。ほかの処理は足さない', () => {
    const body = code(between(cards, '\n  showLowerBoard() {', '\n  }'));
    expect(body).toMatch(/^\s*showLowerBoard\(\) \{\s*if \(readBoardPlace\(\) === 'upper'\) this\.placeBoard\('bottom'\);\s*else this\.showBoard\(\);\s*$/);
  });
  it('前提：placeBoard・showBoard の守り（ボードが無ければ何もしない。下に戻したら下の帯でボードを見せる。すでにボードのタブなら何もしない）', () => {
    const c = code(cards);
    expect(c).toMatch(/private placeBoard\(to: 'upper' \| 'bottom'\) \{\s*if \(!this\.board \|\| !boardUpperEnabled\(\)\) return;\s*const note = this\.requestPlaced\(\{ who: 'board', to \}\);\s*if \(to === 'bottom'\) this\.showBoard\(\);/);
    expect(c).toMatch(/private showBoard\(\) \{\s*if \(boardTabClick\(this\.tab\) === 'stay' \|\| !this\.board\) return;/);
    expect(c).toMatch(/import \{[^}]*\breadBoardPlace\b[^}]*\} from '\.\.\/card-board-stages';/);
  });
  it('ボードの部品・Grok Cards は、今までどおり setBoardMemo も memoBoardView も知らない（新しい名前は別の字）', () => {
    for (const f of ['../src/app/memo-board-tab.ts', '../src/app/grok-cards.ts']) {
      const s = code(read(f));
      expect(s).not.toContain('setBoardMemo');
      expect(s).not.toContain('memoBoardView');
    }
  });
});
