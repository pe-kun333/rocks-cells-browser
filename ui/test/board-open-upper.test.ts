// 「上のコメントボードで開く」：左のメモのセルの右クリック・右のメモの区画の右クリックから、ボードを上に出して、そのメモを見る
//   分かれ（boardOpenPlan）と呼ぶ順（runBoardOpen）・左の MemoPaneHost に当てたときの結果・配線の字面を確かめる。DOM を動かす確かめは開発画面で
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

import { boardOpenPlan, runBoardOpen } from '../src/board-open-plan';
import { MemoPaneHost } from '../src/memo-pane-host';
import { isSpecialCell, type MemoCell } from '../src/memocells';
import { code } from './helpers';
import { unwrapT } from './source-text';

describe('boardOpenPlan：下の区画とボードの替え方', () => {
  it('a. 下が別のメモを開いている：下はそのまま（開かない）。ボードだけがそのメモを見る', () => {
    expect(boardOpenPlan({ lower: 'A', id: 'B', usable: true })).toEqual({ ok: true, open: null, boardMemo: 'B' });
  });
  it('b. 下が同じメモを開いている：ボードの選びを外す（ボードは下のメモに付いていく）。下は開き直さない', () => {
    expect(boardOpenPlan({ lower: 'A', id: 'A', usable: true })).toEqual({ ok: true, open: null, boardMemo: null });
  });
  it('c. 下が閉じている：下にもそのメモを開き（ダブルクリックと同じ）、ボードの選びを外す', () => {
    expect(boardOpenPlan({ lower: null, id: 'B', usable: true })).toEqual({ ok: true, open: 'B', boardMemo: null });
  });
  it('d. 選べないメモ（無い・特別なセル）：下がどうでも断る（何も替えない）', () => {
    for (const lower of [null, 'A', 'B']) expect(boardOpenPlan({ lower, id: 'B', usable: false })).toEqual({ ok: false });
  });
});

describe('runBoardOpen：呼ぶ順と回数（偽物の関数で）', () => {
  function fake(lower: string | null, id: string, usable: boolean, accept = true) {
    const calls: string[] = [];
    const done = runBoardOpen({
      lower,
      id,
      usable,
      setBoardMemo: (next) => {
        calls.push(`setBoardMemo:${next}`);
        return accept;
      },
      open: (next) => void calls.push(`open:${next}`),
      askUpper: () => void calls.push('askUpper'),
      refuse: () => void calls.push('refuse'),
    });
    return { done, calls };
  }
  it('a. 下は A・B を開く：ボードだけ B を選び、上に出す頼みを 1 回。下は開かない', () => {
    expect(fake('A', 'B', true)).toEqual({ done: true, calls: ['setBoardMemo:B', 'askUpper'] });
  });
  it('b. 下も A・A を開く：ボードの選びを外し、上に出す頼みを 1 回。下は開き直さない', () => {
    expect(fake('A', 'A', true)).toEqual({ done: true, calls: ['setBoardMemo:null', 'askUpper'] });
  });
  it('c. 下が閉じている：選びを外す → 下に開く → 上に出す頼み、の順に 1 回ずつ', () => {
    expect(fake(null, 'C', true)).toEqual({ done: true, calls: ['setBoardMemo:null', 'open:C', 'askUpper'] });
  });
  it('d. 選べないメモ：refuse だけを呼ぶ（選びも、開くも、頼みもしない）', () => {
    for (const lower of [null, 'A', 'B']) expect(fake(lower, 'B', false)).toEqual({ done: false, calls: ['refuse'] });
  });
  it('setBoardMemo が断ったとき（間に消えたなど）：開かず、頼まず、refuse を呼ぶ', () => {
    expect(fake('A', 'B', true, false)).toEqual({ done: false, calls: ['setBoardMemo:B', 'refuse'] });
  });
});

// 本物の MemoPaneHost を runBoardOpen につないだとき（下の区画とボードの写しの送り方）
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
    let refused = 0;
    const press = (id: string) => {
      const cell = cells.get(id);
      return runBoardOpen({
        lower: host.openId,
        id,
        usable: !!cell && !isSpecialCell(cell),
        setBoardMemo: (next) => host.setBoardMemo(next),
        open: (next) => host.open(next),
        askUpper: () => void (asked += 1),
        refuse: () => void (refused += 1),
      });
    };
    return { host, press, counts: () => ({ asked, refused }) };
  }
  const relays = () => sent.filter((m) => m.type === 'relay').map((m) => m.payload as Record<string, any>);

  it('a. 下は A：ボードだけ B を見る。下の memoPane は送らない（下はそのまま）', () => {
    const s = setup([memo('A'), memo('B')]);
    s.host.open('A');
    sent.length = 0;
    expect(s.press('B')).toBe(true);
    expect(s.host.openId).toBe('A');
    expect(s.host.boardMemoId).toBe('B');
    expect(relays().map((p) => p.kind)).toEqual(['memoBoardView']);
    expect(relays()[0].view.id).toBe('B');
    expect(s.counts()).toEqual({ asked: 1, refused: 0 });
  });
  it('b. 下は A・ボードは B：A で開くと、ボードの選びを外す（null を一度だけ送る）。下は A のまま', () => {
    const s = setup([memo('A'), memo('B')]);
    s.host.open('A');
    s.host.setBoardMemo('B');
    sent.length = 0;
    expect(s.press('A')).toBe(true);
    expect(s.host.openId).toBe('A');
    expect(s.host.boardMemoId).toBeNull();
    expect(relays()).toEqual([{ kind: 'memoBoardView', view: null }]);
  });
  it('c. 下が閉じている（ボードは前に B を選んでいた）：C を下に開き、ボードは下に付いていく。下の面を出す', () => {
    const s = setup([memo('B'), memo('C')]);
    s.host.setBoardMemo('B');
    sent.length = 0;
    expect(s.press('C')).toBe(true);
    expect(s.host.openId).toBe('C');
    expect(s.host.boardMemoId).toBeNull();
    expect(sent.some((m) => m.type === 'setSidebar' && m.side === 'memo' && m.visible === true)).toBe(true);
    expect(relays().find((p) => p.kind === 'memoPane')?.view.id).toBe('C');
  });
  it('d. 無いメモ・特別なセル：断る。下もボードも変えず、何も送らない', () => {
    const s = setup([memo('A'), memo('B'), memo('p1', { portal: 'x' }), memo('b1', { bot: 'x' }), memo('a1', { app: 'x' }), memo('c1', { capture: 'x' })]);
    s.host.open('A');
    s.host.setBoardMemo('B');
    sent.length = 0;
    for (const id of ['nope', 'p1', 'b1', 'a1', 'c1']) expect(s.press(id)).toBe(false);
    expect(s.host.openId).toBe('A');
    expect(s.host.boardMemoId).toBe('B');
    expect(sent).toEqual([]);
    expect(s.counts()).toEqual({ asked: 0, refused: 5 });
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

describe('左のメモのセルの右クリック（openCellMenu）', () => {
  it('ふつうのメモ 1 個のときの節にだけある。条件の無い文で、「書き直す」と同じ字下げ（「下に開いて書く／下の区画を閉じる」の分かれの外）', () => {
    const menu = bodyOf(primary, 'function openCellMenu(');
    const one = code(between(menu, 'if (info.memo !== null && total === 1) {', 'if (info.id !== null && total === 1) {'));
    const mine = lineWith(one, "label: '上のコメントボードで開く'");
    expect(mine.trim().startsWith("entries.push({ label: '上のコメントボードで開く'")).toBe(true);
    expect(mine).toMatch(/hint: 'ボードを上に出して見ます',\s*run: \(\) => openBoardMemoUpper\(id\) \}\);/);
    expect(indentOf(mine)).toBe(indentOf(lineWith(one, "label: '書き直す'")));
    // 並び：分かれ（閉じる／下に開いて書く）→ この項目 → 書き直す
    const order = ["label: '下の区画を閉じる'", "label: '下に開いて書く（中央を上下に分ける）'", "label: '上のコメントボードで開く'", "label: '書き直す'"].map((part) => one.indexOf(part));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });
  it('項目は盤面のメニューに 1 か所だけ。特別なセル（入口・ボット・アプリ・撮ったもの）は先に別のメニューへ分かれて戻る', () => {
    expect(count(code(primary), "'上のコメントボードで開く'")).toBe(1);
    const menu = code(bodyOf(primary, 'function openCellMenu('));
    const mine = menu.indexOf("'上のコメントボードで開く'");
    for (const branch of ['openPortalMenu', 'openBotMenu', 'openAppMenu', 'openCaptureMenu']) {
      const at = menu.search(new RegExp(`${branch}\\(portal, info\\);\\s*return;`));
      expect(at, branch).toBeGreaterThan(-1);
      expect(at).toBeLessThan(mine);
    }
  });
});

describe('左の処理（openBoardMemoUpper・askBoardUpper・memoPaneReady・区画を閉じたとき）', () => {
  it('openBoardMemoUpper：runBoardOpen を呼ぶだけ。下の区画の世話役と左の一言をつなぐ', () => {
    const body = code(bodyOf(primary, 'function openBoardMemoUpper(id: string) {'));
    expect(body).toMatch(/runBoardOpen\(\{/);
    expect(body).toMatch(/lower:\s*memoPane\.openId,/);
    expect(body).toMatch(/usable:\s*!!memo && !isSpecialCell\(memo\),/);
    expect(body).toMatch(/setBoardMemo:\s*\(next\) => memoPane\.setBoardMemo\(next\),/);
    expect(body).toMatch(/open:\s*\(next\) => memoPane\.open\(next\),/);
    expect(body).toMatch(/askUpper:\s*askBoardUpper,/);
    expect(body).toMatch(/refuse:\s*\(\) => toast\('そのメモは、ボードで開けません/);
    expect(body).not.toContain('openMemoPane'); // 書きかけの守りの道は通らない（1c）
  });
  it('askBoardUpper：下の面がまだ動いていなければ印を立て、送る。送るのは sendBoardUpper の 1 か所だけ', () => {
    expect(code(bodyOf(primary, 'function askBoardUpper() {'))).toMatch(/boardUpperWanted = !memoReady;\s*sendBoardUpper\(\);/);
    expect(code(bodyOf(primary, 'function sendBoardUpper() {'))).toMatch(/send\(\{ type: 'relay', to: 'memo', payload: \{ kind: 'showBoardUpper' \} \}\);/);
    expect(count(code(primary), "kind: 'showBoardUpper'")).toBe(1);
    expect(count(code(primary), 'sendBoardUpper()')).toBe(3); // 宣言・頼む所・送り直す所
  });
  it('memoPaneReady：Grok Cards のあとで、印が立っていて下の区画が開いているときだけ送り直す。どちらでも印は下ろす', () => {
    const ready = code(between(primary, "case 'memoPaneReady':", "case '"));
    // 「下で開く」の 2 行（board-open-lower.test.ts）が、上の 2 行のすぐあと・break の前に入る
    expect(ready).toMatch(/memoReady = true;[\s\S]*grokCards\.onMemoReady\(\);\s*if \(boardUpperWanted && memoPane\.isOpen\(\)\) sendBoardUpper\(\);\s*boardUpperWanted = false;\s*if \(lowerBoardWanted && memoPane\.isOpen\(\)\) sendLowerBoard\(\);\s*lowerBoardWanted = false;\s*break;/);
  });
  it('区画を閉じたとき（onOpenChange(null)）：印を下ろす。印は区画の世話役より前に置く', () => {
    const wanted = primary.indexOf('let boardUpperWanted = false;');
    const host = primary.indexOf('const memoPane = new MemoPaneHost({');
    expect(wanted).toBeGreaterThan(-1);
    expect(host).toBeGreaterThan(wanted);
    expect(count(code(primary), 'let boardUpperWanted')).toBe(1);
    const hooks = code(between(primary, 'const memoPane = new MemoPaneHost({', '});'));
    expect(hooks).toMatch(/onOpenChange: \(id\) => \{\s*if \(id === null\) boardUpperWanted = false;/);
  });
  it('runCommand の openBoardMemo：id の形（文字列）を確かめてから、同じ処理を呼ぶだけ', () => {
    const body = code(between(primary, "case 'openBoardMemo': {", "case '"));
    expect(body).toMatch(/if \(typeof action\.id !== 'string'\) break;\s*openBoardMemoUpper\(action\.id\);\s*break;\s*\}\s*$/);
    expect(count(code(primary), 'openBoardMemoUpper(')).toBe(3); // 宣言・盤面のメニュー・右からの命令
  });
});

describe('命令の型と、下の面の受け口', () => {
  it('types.ts：右から左への openBoardMemo（id は文字列）と、左から下の面への showBoardUpper', () => {
    const t = code(types);
    expect(t).toMatch(/\|\s*\{ command: 'openBoardMemo'; id: string \}/);
    expect(t).toMatch(/\|\s*\{ kind: 'showBoardUpper' \}/);
  });
  it('memo-pane.ts：showBoardUpper を受けて、GrokCardsMount の新しい口を呼ぶ', () => {
    const p = code(pane);
    expect(p).toMatch(/msg\.type === 'relayed' && msg\.payload\.kind === 'showBoardUpper'\) grokCardsUi\.showBoardUpper\(\);/);
    expect(count(p, 'showBoardUpper')).toBe(2);
  });
  it('grok-cards.ts：口は宣言・旗の無いときの空の実装・本体の 3 か所。本体は［上に出す］と同じ placeBoard、すでに上なら何もしない', () => {
    const c = code(cards);
    expect(c).toMatch(/\n\s*showBoardUpper\(\): void;/);
    expect(code(between(cards, "if (!cardsStageOn('3')) {", 'return new GrokCardsView(o);'))).toMatch(/showBoardUpper\(\)\s*\{\s*\},/);
    expect(c).toMatch(/\n\s*showBoardUpper\(\) \{\s*if \(this\.isBoardUpper\(\)\) return;\s*this\.placeBoard\('upper'\);\s*\}/);
    expect(count(c, 'showBoardUpper')).toBe(3);
  });
  it('ボードの部品・Grok Cards は、今までどおり setBoardMemo も memoBoardView も知らない（新しい名前は別の字）', () => {
    for (const f of ['../src/app/memo-board-tab.ts', '../src/app/grok-cards.ts']) {
      const s = code(read(f));
      expect(s).not.toContain('setBoardMemo');
      expect(s).not.toContain('memoBoardView');
    }
  });
});

describe('右のメモの区画の右クリック（memo-pad.ts の menuFor）', () => {
  it('特別なセルでないとき、セルとコメントのどちらにも出す。条件の無い文で、「コメントへ移る／セルへ移る」と同じ字下げ。押すと左へ openBoardMemo を頼む', () => {
    const menu = code(between(pad, 'private menuFor(', '// ---------- 蜂の巣'));
    const plain = between(menu, 'if (!special) {', "if (!special) entries.push({ label: 'コピー'");
    const mine = lineWith(plain, "label: '上のコメントボードで開く'");
    expect(mine.trim().startsWith("entries.push({ label: '上のコメントボードで開く'")).toBe(true);
    expect(mine).toMatch(/hint: 'ボードを上に出して見ます',\s*run: \(\) => this\.deps\.askLeft\(\{ command: 'openBoardMemo', id: memo\.id \}\) \}\);/);
    const move = lineWith(plain, "label: 'コメントへ移る'");
    expect(move).toContain("label: 'セルへ移る'");
    expect(indentOf(mine)).toBe(indentOf(move));
    expect(plain.indexOf(mine)).toBeGreaterThan(plain.indexOf(move));
    expect(count(code(pad), "'上のコメントボードで開く'")).toBe(1);
  });
});

describe('1c の前提：閉じると左には書きかけ無しと知らせ、次に開くと欄を空にする（ダブルクリックと同じ。変わったら 1c の守りを考え直す）', () => {
  it('下の面：書きかけは開いているメモがあるときだけ。閉じる（view が null）と reportDraft で知らせ、開き直す（switched）と欄と書き直しを空にする', () => {
    expect(code(pane)).toMatch(/function hasDraft\(\) \{\s*return !!view && \(/);
    const closing = code(between(pane, 'if (!next) {', 'return;'));
    expect(closing).toContain('reportDraft();');
    const switched = code(between(pane, 'if (switched) {', "comment.value = '';"));
    expect(switched).toContain('cardEdits.clear();');
  });
  it('左：openMemoPane の書きかけの守りは、下が開いていて別のメモのときだけ', () => {
    expect(code(primary)).toMatch(/memoPaneDraft && memoPane\.openId !== null && memoPane\.openId !== memo\.id\) \{/);
  });
});
