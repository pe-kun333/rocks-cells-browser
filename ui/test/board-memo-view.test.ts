// ボードが見るメモ（M2）：下の面が memoBoardView を受けて、ボードに渡す写しを「選んだメモ ?? 下の区画のメモ」にする
//   選んでいなければ今までどおり。A（下）と B（ボード）を同時に編集しても取り違えない・同じメモでも壊れない・B が消えたら下と同じに戻る
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

import { boardSnapshot, templateSource } from '../src/memo-board-source';
import { addCommand, deleteCommands, linkAddPlan, tagCommands } from '../src/memo-card-board-edit';
import { addUndoCommand, restoreCommand } from '../src/memo-card-board-undo';
import { MemoPaneHost } from '../src/memo-pane-host';
import type { MemoCell } from '../src/memocells';
import type { Reply } from '../src/threads';
import type { MemoPaneView, RelayCommand } from '../src/types';

const reply = (id: string, text: string): Reply => ({ id, parent: null, text, createdAt: 1 });
const view = (id: string, replies: Reply[] = [reply(`${id}-r1`, `${id} の 1`), reply(`${id}-r2`, `${id} の 2`)]) => ({ id, replies }) as unknown as MemoPaneView;
const memo = (id: string, text: string, replies?: Reply[]) =>
  ({ id, sheet: 'main', text, tags: [], liked: 0, replies: replies ?? [reply(`${id}-r1`, `${id} の 1`), reply(`${id}-r2`, `${id} の 2`)], createdAt: 1, updatedAt: 1 }) as unknown as MemoCell;

describe('boardSnapshot：選んだメモがあればそれ、無ければ下の区画のメモ', () => {
  it('選んでいなければ今までどおり（下の区画のメモの id と写し）。下も無ければ null', () => {
    const a = view('A');
    expect(boardSnapshot(null, a)).toEqual({ memoId: 'A', replies: a.replies });
    expect(boardSnapshot(null, null)).toBeNull();
  });
  it('選んだメモがあれば、下の区画のメモに関わらずそれ（下は A・ボードは B）', () => {
    const a = view('A');
    const b = view('B');
    expect(boardSnapshot(b, a)).toEqual({ memoId: 'B', replies: b.replies });
    expect(boardSnapshot(b, a)?.memoId).not.toBe(a.id);
  });
  it('下の区画を閉じていても、選んだメモは出る', () => {
    const b = view('B');
    expect(boardSnapshot(b, null)).toEqual({ memoId: 'B', replies: b.replies });
  });
  it('写しは同じ配列のまま渡す（コピーしない＝ボードの描き直しの判定が変わらない）', () => {
    const a = view('A');
    expect(boardSnapshot(null, a)?.replies).toBe(a.replies);
  });
});

describe('templateSource：型にする・空欄の小窓の元になる写し', () => {
  it('ボードから開いた小窓はボードが見ているメモ、選ぶ帯からの小窓は下の区画のメモ', () => {
    const a = view('A');
    const b = view('B');
    expect(templateSource(true, b, a)).toBe(b);
    expect(templateSource(false, b, a)).toBe(a);
  });
  it('選んでいなければ、どちらも下の区画のメモ（今までどおり）。下が無ければ null', () => {
    const a = view('A');
    expect(templateSource(true, null, a)).toBe(a);
    expect(templateSource(false, null, a)).toBe(a);
    expect(templateSource(true, null, null)).toBeNull();
    expect(templateSource(false, view('B'), null)).toBeNull(); // 選ぶ帯は下の区画が無ければ開かない
  });
});

// 下の面の受け取り方の写し（memo-pane.ts の paint・paintBoardMemo と同じ決まり）を、左の MemoPaneHost の送り出しにつないで確かめる
describe('左の送り出し → 下の面の受け取り → ボードが見る写し', () => {
  const store: Record<string, string> = {};
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
    const memoListeners: Array<() => void> = [];
    const memos = { get: (id: string) => cells.get(id), inSheet: () => [...cells.values()], onChange: (fn: () => void) => void memoListeners.push(fn) };
    const sheets = { get: () => undefined, onChange: () => {} };
    const host = new MemoPaneHost({ memos: memos as never, sheets: sheets as never, store: { active: null, onChange: () => {} } as never, toast: () => {}, onOpenChange: () => {} });
    // 下の面：届いた順に view / boardMemoView を持つ（paint・paintBoardMemo と同じ）
    const pane = { view: null as MemoPaneView | null, boardMemoView: null as MemoPaneView | null, boardCalls: 0 };
    const deliver = () => {
      for (const m of sent.splice(0)) {
        if (m.type !== 'relay') continue;
        if (m.payload.kind === 'memoPane') pane.view = m.payload.view;
        else if (m.payload.kind === 'memoBoardView') {
          pane.boardMemoView = m.payload.view;
          pane.boardCalls += 1;
        }
      }
    };
    const snap = () => boardSnapshot(pane.boardMemoView, pane.view);
    const change = (m: MemoCell) => {
      cells.set(m.id, m);
      memoListeners.forEach((fn) => fn());
      vi.advanceTimersByTime(200);
      deliver();
    };
    const remove = (id: string) => {
      cells.delete(id);
      memoListeners.forEach((fn) => fn());
      vi.advanceTimersByTime(200);
      deliver();
    };
    return { host, pane, snap, deliver, change, remove };
  }

  it('下は A・ボードは B：ボードが見るのは B、下の区画の view は A のまま。選びを外すと A に戻る', () => {
    const s = setup([memo('A', 'あ'), memo('B', 'い')]);
    s.host.open('A');
    s.deliver();
    expect(s.snap()?.memoId).toBe('A');
    s.host.setBoardMemo('B');
    s.deliver();
    expect(s.snap()?.memoId).toBe('B');
    expect(s.pane.view?.id).toBe('A');
    s.host.setBoardMemo(null);
    s.deliver();
    expect(s.snap()?.memoId).toBe('A');
    expect(s.pane.boardMemoView).toBeNull();
  });

  it('ボードの編集命令（足す・消す・タグ・線・元に戻す）は、ボードが見ている B の id で作られ、A の id は出てこない', () => {
    const s = setup([memo('A', 'あ'), memo('B', 'い')]);
    s.host.open('A');
    s.host.setBoardMemo('B');
    s.deliver();
    const snap = s.snap()!;
    const link = linkAddPlan(snap.replies, snap.memoId, 'B-r1', 'B-r2', 'ground');
    const cmds: Array<RelayCommand | null> = [
      addCommand(snap.memoId, 'rNew', '新しい'),
      ...deleteCommands(snap.memoId, snap.replies, ['B-r1'], 'u1'),
      ...tagCommands(snap.memoId, snap.replies, ['B-r1', 'B-r2'], ['案'], []),
      link.ok ? link.command : null,
      restoreCommand(snap.memoId, 'u1'),
      addUndoCommand(snap.memoId, 'rNew'),
    ];
    expect(cmds.every((c) => c !== null)).toBe(true);
    const text = JSON.stringify(cmds);
    expect(text).toContain('"B"');
    expect(text).not.toContain('"A"');
    expect(cmds.length).toBe(7); // 足す 1・消す 1・タグ 2・線 1・戻す 1・足した分を消す 1
    // A の id のカードは B のボードの写しに無い（取り違えると消す・タグ・線の命令が 0 件になる）
    expect(deleteCommands(snap.memoId, snap.replies, ['A-r1'])).toEqual([]);
  });

  it('A と B を同時に編集しても取り違えない：B の変更は B の写しだけ、A の変更は下の区画の view だけを変える', () => {
    const s = setup([memo('A', 'あ'), memo('B', 'い')]);
    s.host.open('A');
    s.host.setBoardMemo('B');
    s.deliver();
    s.change(memo('B', 'い', [reply('B-r1', '直した')]));
    expect(s.snap()?.memoId).toBe('B');
    expect(s.snap()?.replies.map((r) => r.text)).toEqual(['直した']);
    expect(s.pane.view?.replies).toHaveLength(2); // 下の区画の A は変わらない
    s.change(memo('A', 'あ', [reply('A-r1', 'A を直した'), reply('A-r2', 'x'), reply('A-r3', 'y')]));
    expect(s.pane.view?.replies).toHaveLength(3);
    expect(s.snap()?.replies.map((r) => r.text)).toEqual(['直した']); // ボードの B はそのまま
  });

  it('A と B が同じメモ：同じ写しを見る。壊れず、外すと下の区画の同じメモのまま', () => {
    const s = setup([memo('A', 'あ')]);
    s.host.open('A');
    s.host.setBoardMemo('A');
    s.deliver();
    expect(s.snap()?.memoId).toBe('A');
    expect(s.pane.boardMemoView?.id).toBe('A');
    s.change(memo('A', 'あ', [reply('A-r1', '一枚だけ')]));
    expect(s.snap()?.replies).toHaveLength(1);
    expect(s.pane.view?.replies).toHaveLength(1);
    s.host.setBoardMemo(null);
    s.deliver();
    expect(s.snap()).toEqual({ memoId: 'A', replies: s.pane.view!.replies });
  });

  it('B が消されて null が来ると、ボードは下の区画のメモ（A）の見方に戻る', () => {
    const s = setup([memo('A', 'あ'), memo('B', 'い')]);
    s.host.open('A');
    s.host.setBoardMemo('B');
    s.deliver();
    expect(s.snap()?.memoId).toBe('B');
    s.remove('B');
    expect(s.pane.boardMemoView).toBeNull();
    expect(s.snap()?.memoId).toBe('A');
    expect(s.host.boardMemoId).toBeNull();
  });

  it('下の区画を閉じても、選んだ B は見える。B が消えれば何も無し（null）', () => {
    const s = setup([memo('A', 'あ'), memo('B', 'い')]);
    s.host.open('A');
    s.host.setBoardMemo('B');
    s.host.close();
    s.deliver();
    expect(s.pane.view).toBeNull();
    expect(s.snap()?.memoId).toBe('B');
    s.remove('B');
    expect(s.snap()).toBeNull();
  });

  it('下の区画で別のメモ（C）を開いても、選んだ B はそのまま。選んでいなければボードは下に付いてくる（今までどおり）', () => {
    const s = setup([memo('A', 'あ'), memo('B', 'い'), memo('C', 'う')]);
    s.host.open('A');
    s.deliver();
    s.host.open('C');
    s.deliver();
    expect(s.snap()?.memoId).toBe('C'); // 選んでいない：下に付いてくる
    s.host.setBoardMemo('B');
    s.host.open('A');
    s.deliver();
    expect(s.pane.view?.id).toBe('A');
    expect(s.snap()?.memoId).toBe('B'); // 選んだ：下を替えても B
  });
});

describe('下の面（memo-pane.ts）の配線', () => {
  const pane = readFileSync(new URL('../src/app/memo-pane.ts', import.meta.url), 'utf8');
  const fn = (name: string) => {
    const at = pane.indexOf(`function ${name}(`);
    expect(at).toBeGreaterThan(0);
    const next = pane.indexOf('\n  function ', at + 10);
    return pane.slice(at, next > 0 ? next : at + 4000);
  };
  it('memoBoardView を受ける枝があり、paintBoardMemo は下の区画の view に触らず、ボードに知らせる', () => {
    expect(pane).toMatch(/msg\.payload\.kind === 'memoBoardView'\) paintBoardMemo\(msg\.payload\.view\)/);
    const body = fn('paintBoardMemo');
    expect(body).toContain('boardMemoView = next');
    expect(body).toContain('boardListeners.forEach');
    expect(body).not.toMatch(/\bview = /);
  });
  it('boardSource.get は boardSnapshot(boardMemoView, view)（選んでいなければ下の区画のメモ）', () => {
    expect(pane).toContain('get: () => boardSnapshot(boardMemoView, view)');
    expect(pane).not.toContain('get: () => (view ? { memoId: view.id');
  });
  it('ボードから開く小窓（型にする・空欄・保存・数の表示）は、下の区画の view.replies を直接読まない（tplSource を通す）', () => {
    for (const name of ['openTplDialog', 'saveTplDialog', 'refreshTplPreview', 'submitTplFill']) {
      const body = fn(name);
      expect(body, name).toContain('tplSource(');
      expect(body, name).not.toContain('view.replies');
    }
    expect(fn('tplSource')).toContain('templateSource(fromBoard, boardMemoView, view)');
  });
  it('ボードの部品側（memo-board-tab.ts・grok-cards.ts）は、写しの出どころを知らない（boardMemoView・setBoardMemo が無い）', () => {
    for (const f of ['../src/app/memo-board-tab.ts', '../src/app/grok-cards.ts']) {
      const s = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(s).not.toContain('boardMemoView');
      expect(s).not.toContain('setBoardMemo');
    }
  });
  it('ボードの部品は、メモの id をすべて source.get() の memoId から取る（下の区画の view・開いているメモの id を持たない）', () => {
    const tab = readFileSync(new URL('../src/app/memo-board-tab.ts', import.meta.url), 'utf8');
    expect(tab).not.toMatch(/readMemoPanePrefs|openId|lastMemo|view\.id/);
    expect(tab).toMatch(/const snap = this\.source\?\.get\(\)/);
  });
});