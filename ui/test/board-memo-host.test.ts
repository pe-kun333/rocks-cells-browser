// ボードが見るメモ（M1）：左の MemoPaneHost が「ボード用のメモ」を持ち、その写しを memoBoardView で下の面へ送る
//   使っていない間は何も送らない（今までと同じ）・設定は後方互換・消されたら null で知らせる。受け口（下の面）は M2
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

import { MemoPaneHost, readMemoPanePrefs, writeMemoPanePrefs } from '../src/memo-pane-host';
import type { MemoCell } from '../src/memocells';
import type { Reply } from '../src/threads';

const KEY = 'honeycomb.memoPane';
const store: Record<string, string> = {};

const reply = (id: string, text: string): Reply => ({ id, parent: null, text, createdAt: 1 });
const memo = (id: string, text: string, over: Record<string, unknown> = {}) =>
  ({ id, sheet: 'main', text, tags: [], liked: 0, replies: [reply(`${id}-r1`, `${text} のカード`)], createdAt: 1, updatedAt: 1, pos: { q: 0, r: 0 }, ...over }) as unknown as MemoCell;

// 偽の台帳・シート・タブ（host が使う分だけ）
function fakes(initial: MemoCell[]) {
  const cells = new Map(initial.map((m) => [m.id, m]));
  const memoListeners: Array<() => void> = [];
  const sheetListeners: Array<() => void> = [];
  const toasts: string[] = [];
  const memos = {
    get: (id: string) => cells.get(id),
    inSheet: () => [...cells.values()],
    onChange: (fn: () => void) => void memoListeners.push(fn),
  };
  const sheets = { get: () => undefined, onChange: (fn: () => void) => void sheetListeners.push(fn) };
  const tabs = { active: null, onChange: () => {} };
  const host = new MemoPaneHost({ memos: memos as never, sheets: sheets as never, store: tabs as never, toast: (t) => void toasts.push(t), onOpenChange: () => {} });
  return {
    host,
    cells,
    toasts,
    changeMemos: () => memoListeners.forEach((fn) => fn()),
    changeSheets: () => sheetListeners.forEach((fn) => fn()),
  };
}

const relays = () => sent.filter((m) => m.type === 'relay').map((m) => m.payload as Record<string, any>);
const kinds = () => relays().map((p) => p.kind);
const boardMsgs = () => relays().filter((p) => p.kind === 'memoBoardView');
const flush = () => vi.advanceTimersByTime(200);

beforeEach(() => {
  sent.length = 0;
  for (const k of Object.keys(store)) delete store[k];
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v), removeItem: (k: string) => void delete store[k] });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('設定（honeycomb.memoPane）の boardMemo：後方互換', () => {
  it('古い設定（boardMemo なし）は null で読める。ほかの項目は今までどおり', () => {
    store[KEY] = JSON.stringify({ height: 300, lastMemo: 'm1', listOpen: true, recent: ['m1', 'm2'] });
    expect(readMemoPanePrefs()).toEqual({ height: 300, lastMemo: 'm1', listOpen: true, recent: ['m1', 'm2'], boardMemo: null });
  });
  it('文字列の id だけ読む。空・数・オブジェクト・壊れた JSON・設定なしは null', () => {
    store[KEY] = JSON.stringify({ boardMemo: 'm9' });
    expect(readMemoPanePrefs().boardMemo).toBe('m9');
    for (const bad of ['', 5, {}, [], null, true]) {
      store[KEY] = JSON.stringify({ boardMemo: bad });
      expect(readMemoPanePrefs().boardMemo).toBeNull();
    }
    store[KEY] = '{壊れている';
    expect(readMemoPanePrefs().boardMemo).toBeNull();
    delete store[KEY];
    expect(readMemoPanePrefs().boardMemo).toBeNull();
  });
  it('高さなど別の項目を書いても boardMemo は残り、boardMemo を書いてもほかの項目は残る（下の面も同じ書き方で高さを書く）', () => {
    writeMemoPanePrefs({ boardMemo: 'm2', lastMemo: 'm1' });
    writeMemoPanePrefs({ height: 320 });
    expect(readMemoPanePrefs()).toMatchObject({ height: 320, lastMemo: 'm1', boardMemo: 'm2' });
    writeMemoPanePrefs({ boardMemo: null });
    expect(readMemoPanePrefs()).toMatchObject({ height: 320, lastMemo: 'm1', boardMemo: null });
  });
});

describe('使っていない間は今までと同じ（memoBoardView を送らない）', () => {
  it('開く・メモが変わる・シートが変わる・閉じる、のどこでも memoBoardView は 1 通も出ない', () => {
    const f = fakes([memo('m1', '一')]);
    f.host.open('m1');
    f.host.ready();
    f.changeMemos();
    f.changeSheets();
    flush();
    f.host.close();
    expect(kinds()).not.toContain('memoBoardView');
    expect(kinds().every((k) => k === 'memoPane' || k === 'memoPaneList')).toBe(true);
    expect(sent.filter((m) => m.type === 'setSidebar')).toHaveLength(3); // 起動で隠す・開く・閉じる（前と同じ）
  });
  it('開いていないとき、メモが変わっても何も送らない（前の早い戻りのまま）', () => {
    const f = fakes([memo('m1', '一')]);
    sent.length = 0;
    f.changeMemos();
    f.changeSheets();
    flush();
    expect(sent).toEqual([]);
  });
  it('null を外す呼び出し（選んでいないのに外す）も、何も送らない', () => {
    const f = fakes([memo('m1', '一')]);
    sent.length = 0;
    expect(f.host.setBoardMemo(null)).toBe(true);
    expect(sent).toEqual([]);
  });
});

describe('setBoardMemo：選ぶ・外す・断る', () => {
  it('選ぶと、そのメモの写しを memoBoardView で 1 通だけ送る。下の区画のメモ（current）は変わらず、memoPane は送らない', () => {
    const f = fakes([memo('m1', '一'), memo('m2', '二')]);
    f.host.open('m1');
    sent.length = 0;
    expect(f.host.setBoardMemo('m2')).toBe(true);
    expect(f.host.boardMemoId).toBe('m2');
    expect(f.host.openId).toBe('m1');
    expect(kinds()).toEqual(['memoBoardView']);
    const view = boardMsgs()[0].view;
    expect(view).toMatchObject({ id: 'm2', text: '二', replies: [{ id: 'm2-r1', text: '二 のカード' }] });
    expect(view.focusReply).toBeUndefined(); // 「このカードへ移る」頼みは下の区画のものだけ
    expect(readMemoPanePrefs().boardMemo).toBe('m2');
  });
  it('下の区画を開いていなくても選べる（写しは送る）。下の区画と同じメモを選んでもよい', () => {
    const f = fakes([memo('m1', '一')]);
    expect(f.host.setBoardMemo('m1')).toBe(true);
    expect(boardMsgs()).toHaveLength(1);
    f.host.open('m1');
    expect(kinds().filter((k) => k === 'memoPane')).toHaveLength(1);
    expect(boardMsgs()).toHaveLength(2); // open の push に、ボードの写しも載る
    expect(boardMsgs()[1].view.id).toBe('m1');
  });
  it('外すと null を一度だけ送る。もう一度外しても何も送らない。設定も null', () => {
    const f = fakes([memo('m2', '二')]);
    f.host.setBoardMemo('m2');
    sent.length = 0;
    expect(f.host.setBoardMemo(null)).toBe(true);
    expect(boardMsgs()).toEqual([{ kind: 'memoBoardView', view: null }]);
    expect(f.host.boardMemoId).toBeNull();
    expect(readMemoPanePrefs().boardMemo).toBeNull();
    sent.length = 0;
    f.host.setBoardMemo(null);
    expect(sent).toEqual([]);
  });
  it('無いメモ・特別なセル（入口・ボット・アプリ・取り込み）は断って false。送らず、今の選びも設定も変えない', () => {
    const f = fakes([memo('m1', '一'), memo('p1', '入口', { portal: 'x' }), memo('b1', 'ボット', { bot: 'x' }), memo('a1', 'アプリ', { app: 'x' }), memo('c1', '取り込み', { capture: 'x' })]);
    f.host.setBoardMemo('m1');
    sent.length = 0;
    for (const id of ['nope', 'p1', 'b1', 'a1', 'c1', '']) expect(f.host.setBoardMemo(id)).toBe(false);
    expect(sent).toEqual([]);
    expect(f.host.boardMemoId).toBe('m1');
    expect(readMemoPanePrefs().boardMemo).toBe('m1');
  });
});

describe('選んでいる間：メモが変わったら再送する', () => {
  it('選んだメモの本文・カードが変わると、150 ミリ秒後に新しい写しが届く（下の区画 current の memoPane も今までどおり）', () => {
    const f = fakes([memo('m1', '一'), memo('m2', '二')]);
    f.host.open('m1');
    f.host.setBoardMemo('m2');
    sent.length = 0;
    f.cells.set('m2', memo('m2', '二（直した）', { replies: [reply('m2-r1', 'a'), reply('m2-r2', 'b')] }));
    f.changeMemos();
    expect(sent).toEqual([]); // すぐには送らない
    flush();
    expect(kinds()).toEqual(['memoPane', 'memoPaneList', 'memoBoardView']);
    expect(boardMsgs()[0].view).toMatchObject({ id: 'm2', text: '二（直した）' });
    expect(boardMsgs()[0].view.replies).toHaveLength(2);
  });
  it('下の区画を閉じていても（current なし）、選んだメモが変われば写しを送る', () => {
    const f = fakes([memo('m2', '二')]);
    f.host.setBoardMemo('m2');
    sent.length = 0;
    f.cells.set('m2', memo('m2', '二', { replies: [] }));
    f.changeMemos();
    flush();
    expect(boardMsgs()).toHaveLength(1);
    expect(boardMsgs()[0].view.replies).toEqual([]);
  });
  it('シートの変更でも再送する（選んでいる間だけ）', () => {
    const f = fakes([memo('m2', '二')]);
    sent.length = 0;
    f.changeSheets();
    flush();
    expect(sent).toEqual([]);
    f.host.setBoardMemo('m2');
    sent.length = 0;
    f.changeSheets();
    flush();
    expect(boardMsgs()).toHaveLength(1);
  });
  it('ready()（下の面の読み込み直し）でも、選んでいれば写しを送り直す', () => {
    const f = fakes([memo('m2', '二')]);
    f.host.setBoardMemo('m2');
    sent.length = 0;
    f.host.ready();
    expect(boardMsgs()).toHaveLength(1);
  });
});

describe('選んだメモが消されたとき', () => {
  it('選びを外し（設定も null）、null を一度だけ送り、短い知らせを出す。下の区画は閉じない', () => {
    const f = fakes([memo('m1', '一'), memo('m2', '二')]);
    f.host.open('m1');
    f.host.setBoardMemo('m2');
    sent.length = 0;
    f.cells.delete('m2');
    f.changeMemos();
    flush();
    expect(f.host.boardMemoId).toBeNull();
    expect(boardMsgs()).toEqual([{ kind: 'memoBoardView', view: null }]);
    expect(readMemoPanePrefs().boardMemo).toBeNull();
    expect(f.toasts).toEqual(['ボードで見ていたメモが消されたので、下の区画と同じ見方に戻しました']);
    expect(f.host.openId).toBe('m1');
    sent.length = 0;
    f.changeMemos();
    flush();
    expect(boardMsgs()).toEqual([]); // もう送らない
  });
  it('下の区画が開いていないときに消されても同じ（null を送り、知らせる）', () => {
    const f = fakes([memo('m2', '二')]);
    f.host.setBoardMemo('m2');
    sent.length = 0;
    f.cells.delete('m2');
    f.changeMemos();
    flush();
    expect(boardMsgs()).toEqual([{ kind: 'memoBoardView', view: null }]);
    expect(f.toasts).toHaveLength(1);
  });
  it('下の区画のメモと同じメモが消されたら、今までの「下の区画を閉じた」知らせも出る（そちらは変えない）', () => {
    const f = fakes([memo('m1', '一')]);
    f.host.open('m1');
    f.host.setBoardMemo('m1');
    f.cells.delete('m1');
    f.changeMemos();
    flush();
    expect(f.host.openId).toBeNull();
    expect(f.host.boardMemoId).toBeNull();
    expect(f.toasts).toContain('メモが消されたので、下の区画を閉じました');
  });
});

describe('起動し直したとき：前に選んだメモを、見つかったときに戻す', () => {
  it('台帳がまだ空の間は何も変えず（設定も消さず）、メモが現れたら戻して写しを送る', () => {
    store[KEY] = JSON.stringify({ height: 300, boardMemo: 'm2' });
    const f = fakes([]);
    f.changeMemos();
    flush();
    expect(f.host.boardMemoId).toBeNull();
    expect(sent.filter((m) => m.type === 'relay')).toEqual([]);
    expect(readMemoPanePrefs().boardMemo).toBe('m2');
    f.cells.set('m2', memo('m2', '二'));
    f.changeMemos();
    flush();
    expect(f.host.boardMemoId).toBe('m2');
    expect(boardMsgs()).toHaveLength(1);
    expect(boardMsgs()[0].view.id).toBe('m2');
  });
  it('ready() でも戻す。特別なセルになっていたら戻さない', () => {
    store[KEY] = JSON.stringify({ boardMemo: 'm2' });
    const f = fakes([memo('m2', '二')]);
    f.host.ready();
    expect(f.host.boardMemoId).toBe('m2');
    expect(boardMsgs()).toHaveLength(1);
    store[KEY] = JSON.stringify({ boardMemo: 'p1' });
    const g = fakes([memo('p1', '入口', { portal: 'x' })]);
    g.host.ready();
    expect(g.host.boardMemoId).toBeNull();
  });
  it('自分で選び直した・外したあとは、古い設定で戻さない', () => {
    store[KEY] = JSON.stringify({ boardMemo: 'm2' });
    const f = fakes([]);
    f.host.setBoardMemo(null);
    f.cells.set('m2', memo('m2', '二'));
    f.changeMemos();
    flush();
    expect(f.host.boardMemoId).toBeNull();
    expect(boardMsgs()).toEqual([]);
  });
});

// MK4：右の検索の［上で開く］。選ぶカードの頼みは、ボードが見る写しにだけ載せる（setBoardMemo・open の中では送らない。送る数を固めた上の試験は今のまま）
describe('focusBoard：ボードで選んで見せるカードの頼み（MK4）', () => {
  it('選んだメモがあれば、その写し（memoBoardView）に載せて 1 通だけ送り直す。下の区画の写しには載せない', () => {
    const f = fakes([memo('m1', '一'), memo('m2', '二')]);
    f.host.open('m1');
    f.host.setBoardMemo('m2');
    sent.length = 0;
    f.host.focusBoard('m2', 'm2-r1');
    expect(kinds()).toEqual(['memoBoardView']);
    expect(boardMsgs()[0].view).toMatchObject({ id: 'm2', boardFocus: { id: 'm2-r1', n: 1 } });
    expect(boardMsgs()[0].view.focusReply).toBeUndefined(); // 下の区画の「このカードへ移る」とは別の欄
    sent.length = 0;
    f.host.ready(); // 下の面が読み込み直されても、写しに載ったまま（番号は同じ。作り直したボードは番号を 0 から数えるので、もう一度当てる。下の区画の focusReply と同じ）
    expect(relays().find((p) => p.kind === 'memoPane')?.view.boardFocus).toBeUndefined();
    expect(boardMsgs()[0].view.boardFocus).toEqual({ id: 'm2-r1', n: 1 });
  });
  it('選んだメモが無ければ（ボードは下に付いていく）、下の区画の写しに載せて送り直す。番号は頼むたびに上がる', () => {
    const f = fakes([memo('m1', '一')]);
    f.host.open('m1');
    sent.length = 0;
    f.host.focusBoard('m1', 'm1-r1');
    expect(kinds()).toEqual(['memoPane', 'memoPaneList']); // ボードの写しは選んでいないので送らない（今までどおり）
    expect(relays()[0].view).toMatchObject({ id: 'm1', boardFocus: { id: 'm1-r1', n: 1 } });
    sent.length = 0;
    f.host.focusBoard('m1', 'm1-r1');
    expect(relays()[0].view.boardFocus).toEqual({ id: 'm1-r1', n: 2 });
  });
  it('頼みのメモと違う写しには載せない。見るメモを選び直したら頼みを捨てる', () => {
    const f = fakes([memo('m1', '一'), memo('m2', '二')]);
    f.host.open('m1');
    f.host.focusBoard('m2', 'm2-r1'); // 下は m1、選んだメモも無い：載せる写しが無い
    expect(relays().every((p) => p.view?.boardFocus === undefined)).toBe(true);
    f.host.focusBoard('m1', 'm1-r1');
    f.host.setBoardMemo('m2'); // 選び直した：頼みは捨てる（m2 の写しにも、m1 の写しにも載らない）
    f.host.setBoardMemo(null);
    sent.length = 0;
    f.host.ready();
    expect(relays().every((p) => p.view?.boardFocus === undefined)).toBe(true);
  });
  it('どちらも無い（下が閉じていて、選んだメモも無い）ときは何も送らない', () => {
    const f = fakes([memo('m1', '一')]);
    sent.length = 0;
    f.host.focusBoard('m1', 'm1-r1');
    expect(sent).toEqual([]);
  });
  // 見直し：頼みに寿命が無いと、当たらなかった頼みが、あとでそのメモを開き直したときに急に当たる
  it('ボードが下に付いていく間に、下が別のメモへ替わる・閉じると、頼みを捨てる（開き直しても載らない）', () => {
    const f = fakes([memo('m1', '一'), memo('m2', '二')]);
    f.host.open('m1');
    f.host.focusBoard('m1', 'm1-r1');
    f.host.open('m2'); // 別のメモへ
    f.host.open('m1');
    sent.length = 0;
    f.host.ready();
    expect(relays().find((p) => p.kind === 'memoPane')?.view.boardFocus).toBeUndefined();
    f.host.focusBoard('m1', 'm1-r1');
    f.host.close(); // 閉じる
    f.host.open('m1');
    sent.length = 0;
    f.host.ready();
    expect(relays().find((p) => p.kind === 'memoPane')?.view.boardFocus).toBeUndefined();
  });
  it('同じメモを開き直すときは捨てない（番号も同じ）。選んだメモがあるときは、下を替えても閉じても捨てない（ボードは下を見ていない）', () => {
    const f = fakes([memo('m1', '一'), memo('m2', '二'), memo('m3', '三')]);
    f.host.open('m1');
    f.host.focusBoard('m1', 'm1-r1');
    sent.length = 0;
    f.host.open('m1');
    expect(relays().find((p) => p.kind === 'memoPane')?.view.boardFocus).toEqual({ id: 'm1-r1', n: 1 });
    f.host.setBoardMemo('m2');
    f.host.focusBoard('m2', 'm2-r1');
    f.host.open('m3');
    f.host.close();
    sent.length = 0;
    f.host.ready();
    expect(boardMsgs()[0].view.boardFocus).toEqual({ id: 'm2-r1', n: 2 });
  });
});

describe('命令の型と受け口（画面はまだ変えない）', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('types.ts：setBoardMemo（id は文字列か null）と memoBoardView（view は写しか null）が宣言されている', () => {
    const t = src('../src/types.ts');
    expect(t).toMatch(/command: 'setBoardMemo'; id: string \| null/);
    expect(t).toMatch(/kind: 'memoBoardView'; view: MemoPaneView \| null/);
  });
  it('左（primary.ts）：setBoardMemo は memoPane.setBoardMemo へ渡し、断られたら知らせる。id の形（文字列か null）を確かめる', () => {
    const p = src('../src/app/primary.ts');
    const at = p.indexOf("case 'setBoardMemo'");
    expect(at).toBeGreaterThan(0);
    const body = p.slice(at, at + 600);
    expect(body).toContain('memoPane.setBoardMemo(action.id)');
    expect(body).toContain("typeof action.id !== 'string'");
    expect(body).toContain('tellMemo(');
  });
  it('setBoardMemo を送るのは下の面（選び口の hook。M3）だけ。ボードの部品・Grok Cards は命令名も memoBoardView も知らない（hook 越しに頼む）', () => {
    for (const f of ['../src/app/memo-board-tab.ts', '../src/app/grok-cards.ts']) {
      const s = src(f);
      expect(s).not.toContain('setBoardMemo');
      expect(s).not.toContain('memoBoardView');
    }
    expect(src('../src/app/memo-pane.ts')).toContain("ask({ command: 'setBoardMemo', id })");
  });
});