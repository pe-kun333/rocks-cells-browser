// 段 MK4：右の検索の行の［上で開く］と、ボードの書く欄の書きかけの守り（docs/plan-comment-board-marks.md §4.4）
//   純粋な関数（board-open-plan.ts・memo-board-source.ts・memo-card-board-edit.ts）と、左の MemoPaneHost を runBoardOpen につないだときの写しの送り方、
//   左・ボード・右の配線の字面を確かめる。DOM の動き（当たる位置・置き場の替えの間の面の大きさ）は開発の画面と Windows の確かめ（計画 §9.3 の確かめ A の 5）
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unwrapT } from './source-text';

const sent = vi.hoisted(() => [] as Array<Record<string, any>>);
vi.mock('../src/bridge', () => ({ surface: 'left', send: (m: Record<string, any>) => void sent.push(m), onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async () => ({ status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { boardDraftBlocks, runBoardOpen } from '../src/board-open-plan';
import { boardFocusOf, boardFocusStep, boardSnapshot } from '../src/memo-board-source';
import { canReturnDraft, composeHasDraft } from '../src/memo-card-board-edit';
import { MemoPaneHost } from '../src/memo-pane-host';
import { isSpecialCell, type MemoCell } from '../src/memocells';
import { pathTo } from '../src/threads';
import type { MemoPaneView } from '../src/types';
import { code } from './helpers';

describe('boardDraftBlocks：ボードの書く欄の書きかけで、ボードを替えないか', () => {
  it('書きかけがあり、ボードが今見ているメモが開くメモと違うときだけ守る', () => {
    expect(boardDraftBlocks({ board: 'A', id: 'B', draft: true })).toBe(true);
    expect(boardDraftBlocks({ board: 'A', id: 'A', draft: true })).toBe(false); // 同じメモ：ボードは替わらない（欄は閉じない）
    expect(boardDraftBlocks({ board: 'A', id: 'B', draft: false })).toBe(false);
  });
  it('ボードがメモを見ていない（null）ときは守らない（ボードは null の写しでは書く欄を閉じないので、そのとき残った字は守れない。直していない穴。MK4 の記録）', () => {
    expect(boardDraftBlocks({ board: null, id: 'B', draft: true })).toBe(false);
  });
});

describe('runBoardOpen の書きかけの守り（偽物の関数で）', () => {
  function fake(o: { lower: string | null; id: string; usable?: boolean; board?: string | null; draft?: boolean; keep?: boolean }) {
    const calls: string[] = [];
    const done = runBoardOpen({
      lower: o.lower,
      id: o.id,
      usable: o.usable ?? true,
      board: o.board,
      draft: o.draft,
      setBoardMemo: (next) => {
        calls.push(`setBoardMemo:${next}`);
        return true;
      },
      open: (next) => void calls.push(`open:${next}`),
      askUpper: () => void calls.push('askUpper'),
      refuse: () => void calls.push('refuse'),
      ...(o.keep === false ? {} : { keepDraft: () => void calls.push('keepDraft') }),
    });
    return { done, calls };
  }
  it('書きかけがあって、ボードが別のメモ（A）を見ている：何も替えず keepDraft だけ（a・b・c のどの分かれでも）', () => {
    expect(fake({ lower: 'A', id: 'B', board: 'A', draft: true })).toEqual({ done: false, calls: ['keepDraft'] }); // a
    expect(fake({ lower: 'B', id: 'B', board: 'A', draft: true })).toEqual({ done: false, calls: ['keepDraft'] }); // b（ボードは別のメモ A を選んでいた）
    expect(fake({ lower: null, id: 'C', board: 'A', draft: true })).toEqual({ done: false, calls: ['keepDraft'] }); // c（ボードは A を選んでいた）
  });
  it('書きかけがあっても、ボードが同じメモを見ていれば今までどおり（替わらないので欄は閉じない）', () => {
    expect(fake({ lower: 'A', id: 'A', board: 'A', draft: true })).toEqual({ done: true, calls: ['setBoardMemo:null', 'askUpper'] });
    expect(fake({ lower: 'A', id: 'B', board: 'B', draft: true })).toEqual({ done: true, calls: ['setBoardMemo:B', 'askUpper'] });
    // c（下が閉じている）で、ボードが選んでいるメモと同じ：守らない。下に開いてから選びを外す（ボードの写しが A のまま途切れない。見直しの 1 件目）
    expect(fake({ lower: null, id: 'A', board: 'A', draft: true })).toEqual({ done: true, calls: ['open:A', 'setBoardMemo:null', 'askUpper'] });
  });
  it('書きかけが無い・ボードがメモを見ていない・守りの口を渡さないときは今までどおり', () => {
    expect(fake({ lower: 'A', id: 'B', board: 'A', draft: false })).toEqual({ done: true, calls: ['setBoardMemo:B', 'askUpper'] });
    expect(fake({ lower: null, id: 'C', board: null, draft: true })).toEqual({ done: true, calls: ['open:C', 'setBoardMemo:null', 'askUpper'] }); // c は下に開くのが先（見直しの 1 件目）
    expect(fake({ lower: 'A', id: 'B' })).toEqual({ done: true, calls: ['setBoardMemo:B', 'askUpper'] });
  });
  it('選べないメモは書きかけより先に断る（refuse だけ）。keepDraft を渡さなくても、守るときは何も替えない', () => {
    expect(fake({ lower: 'A', id: 'B', usable: false, board: 'A', draft: true })).toEqual({ done: false, calls: ['refuse'] });
    expect(fake({ lower: 'A', id: 'B', board: 'A', draft: true, keep: false })).toEqual({ done: false, calls: [] });
  });
});

describe('composeHasDraft：ボードの書く欄に書きかけがあるか（先例 canReturnDraft の逆）', () => {
  const add = { kind: 'add' } as const;
  const edit = { kind: 'edit', id: 'r1' } as const;
  it('閉じていて、待っている文が無ければ書きかけは無い', () => {
    expect(composeHasDraft({ open: null, text: '', photoTitle: false, waiting: 0 })).toBe(false);
  });
  it('足す欄は字があるときだけ（空白だけは無い）。書き直しの欄は開いていれば空でも書きかけ', () => {
    expect(composeHasDraft({ open: add, text: '', photoTitle: false, waiting: 0 })).toBe(false);
    expect(composeHasDraft({ open: add, text: ' \n　', photoTitle: false, waiting: 0 })).toBe(false);
    expect(composeHasDraft({ open: add, text: 'あ', photoTitle: false, waiting: 0 })).toBe(true);
    expect(composeHasDraft({ open: edit, text: '', photoTitle: false, waiting: 0 })).toBe(true);
    expect(composeHasDraft({ open: edit, text: '直す', photoTitle: false, waiting: 0 })).toBe(true);
  });
  it('開いている欄は canReturnDraft の逆（写真の題でなければ）', () => {
    for (const open of [add, edit]) for (const text of ['', ' ', '文']) expect(composeHasDraft({ open, text, photoTitle: false, waiting: 0 })).toBe(!canReturnDraft(open, text));
  });
  it('写真の題の欄（届くと空で開く）は、字があるときだけ', () => {
    expect(composeHasDraft({ open: edit, text: '', photoTitle: true, waiting: 0 })).toBe(false);
    expect(composeHasDraft({ open: edit, text: '題', photoTitle: true, waiting: 0 })).toBe(true);
  });
  it('断られて待っている文があれば、欄がどうでも書きかけ', () => {
    expect(composeHasDraft({ open: null, text: '', photoTitle: false, waiting: 1 })).toBe(true);
    expect(composeHasDraft({ open: edit, text: '', photoTitle: true, waiting: 2 })).toBe(true);
  });
});

describe('boardFocusStep：［上で開く］の頼みを、今ボードで当てるか', () => {
  const want = { memoId: 'A', replyId: 'r2', n: 3 };
  const faces = [{ id: 'r1' }, { id: 'r2' }];
  const base = { want, done: 2, hidden: false, memoId: 'A', loaded: true, needFit: false, sized: true, busy: false, faces };
  it('当てられる：番号が新しく、メモが同じで、そのカードが面にある', () => {
    expect(boardFocusStep(base)).toBe('hit');
  });
  it('頼みが無い・番号がもう当てたもの以下なら何もしない', () => {
    expect(boardFocusStep({ ...base, want: null })).toBe('none');
    expect(boardFocusStep({ ...base, done: 3 })).toBe('none');
    expect(boardFocusStep({ ...base, done: 4 })).toBe('none');
  });
  it('まだ当てられない間は待つ（番号を使わない）：隠れている・別のメモ・読み込み中・開いたときの位置の前・面の大きさが 0・つまむか範囲選択の途中', () => {
    for (const over of [{ hidden: true }, { memoId: 'B' }, { memoId: null }, { loaded: false }, { needFit: true }, { sized: false }, { busy: true }]) {
      expect(boardFocusStep({ ...base, ...over }), JSON.stringify(over)).toBe('wait');
    }
  });
  it('そのカードが面に無い（消えた・台帳にもう無い）ときは gone（当てずに一言）。待つ条件が先', () => {
    expect(boardFocusStep({ ...base, faces: [{ id: 'r1' }] })).toBe('gone');
    expect(boardFocusStep({ ...base, faces: [], loaded: false })).toBe('wait');
  });
});

// 本物の MemoPaneHost を runBoardOpen と focusBoard（左の openBoardCardUpper と同じ順）につなぎ、下の面の受け取り方（paint・paintBoardMemo）で、ボードが見る頼みを確かめる
describe('左の送り出し → ボードが見る写しの頼み（分かれ a・b・c）', () => {
  const store: Record<string, string> = {};
  const reply = (id: string, parent: string | null = null) => ({ id, parent, text: id, createdAt: 1 });
  const memo = (id: string) =>
    ({ id, sheet: 'main', text: id, tags: [], liked: 0, replies: [reply(`${id}-r1`), reply(`${id}-r2`), reply(`${id}-x`, `${id}-r2`)], createdAt: 1, updatedAt: 1, pos: { q: 0, r: 0 } }) as unknown as MemoCell;

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
    const pane = { view: null as MemoPaneView | null, boardMemoView: null as MemoPaneView | null };
    // ボードが受ける写しのメモの並び（下の面は paint・paintBoardMemo のたびにボードへ知らせ、ボードは refresh で写しを見る。送った順に 1 通ずつ）
    const trail: (string | null)[] = [];
    const deliver = () => {
      for (const m of sent.splice(0)) {
        if (m.type !== 'relay') continue;
        if (m.payload.kind === 'memoPane') pane.view = m.payload.view;
        else if (m.payload.kind === 'memoBoardView') pane.boardMemoView = m.payload.view;
        else continue;
        trail.push(boardSnapshot(pane.boardMemoView, pane.view)?.memoId ?? null);
      }
    };
    // 左の openBoardCardUpper と同じ順：runBoardOpen が開けたときだけ、一番上のカードに直して focusBoard
    const press = (id: string, replyId: string, draft = false) => {
      const cell = cells.get(id);
      const done = runBoardOpen({
        lower: host.openId,
        id,
        usable: !!cell && !isSpecialCell(cell),
        board: host.boardMemoId ?? host.openId,
        draft,
        setBoardMemo: (next) => host.setBoardMemo(next),
        open: (next) => host.open(next),
        askUpper: () => {},
        refuse: () => {},
      });
      if (done && cell) host.focusBoard(id, pathTo(cell.replies ?? [], replyId)[0]?.id ?? replyId);
      deliver();
      return done;
    };
    const seen = () => ({ snap: boardSnapshot(pane.boardMemoView, pane.view)?.memoId ?? null, focus: boardFocusOf(pane.boardMemoView, pane.view) });
    return { host, press, deliver, pane, seen, trail };
  }

  it('a. 下は A・B のカードを開く：ボードは B を見て、その写しに頼みが載る', () => {
    const s = setup([memo('A'), memo('B')]);
    s.host.open('A');
    s.deliver();
    expect(s.press('B', 'B-r1')).toBe(true);
    expect(s.seen()).toEqual({ snap: 'B', focus: { memoId: 'B', replyId: 'B-r1', n: 1 } });
    expect(s.pane.view?.boardFocus).toBeUndefined();
  });
  it('b. 下も A・A の返信の行：ボードは下に付いていき、下の写しに一番上のカードの頼みが載る', () => {
    const s = setup([memo('A'), memo('B')]);
    s.host.open('A');
    s.host.setBoardMemo('B');
    s.deliver();
    expect(s.press('A', 'A-x')).toBe(true);
    expect(s.seen()).toEqual({ snap: 'A', focus: { memoId: 'A', replyId: 'A-r2', n: 1 } });
    expect(s.pane.boardMemoView).toBeNull();
  });
  it('c. 下が閉じている：下にも開き、下の写しに頼みが載る（下の区画の focusReply は付けない＝下はカードへ移らない）', () => {
    const s = setup([memo('C')]);
    expect(s.press('C', 'C-r2')).toBe(true);
    expect(s.seen()).toEqual({ snap: 'C', focus: { memoId: 'C', replyId: 'C-r2', n: 1 } });
    expect(s.pane.view?.focusReply).toBeUndefined();
  });
  it('書きかけがあってボードが別のメモを見ていれば、何も替えず、頼みも載せない', () => {
    const s = setup([memo('A'), memo('B')]);
    s.host.open('A');
    s.deliver();
    expect(s.press('B', 'B-r1', true)).toBe(false);
    expect(s.seen()).toEqual({ snap: 'A', focus: null });
    expect(s.host.boardMemoId).toBeNull();
  });
  it('同じメモでもう一度押すと、番号が上がる（ボードはもう一度当てる）', () => {
    const s = setup([memo('A')]);
    s.host.open('A');
    s.deliver();
    s.press('A', 'A-r1');
    s.press('A', 'A-r2', true); // 書きかけがあっても、同じメモなら替わらないので開ける
    expect(s.seen().focus).toEqual({ memoId: 'A', replyId: 'A-r2', n: 2 });
  });
  // 見直しの 1 件目：c（下が閉じている）で、ボードが選んでいるメモ A をそのまま開く（board＝A・id＝A なので守らない）。
  //   選びを先に外すと、ボードは一度 null の写しを受けてメモが無い形になり、次の写し A を「メモが替わった」と見て書く欄を閉じる（書きかけが消える）。
  //   下を先に開いてから選びを外すので、ボードが受ける写しは A のまま途切れない
  it('c で、ボードが選んでいるメモをそのまま開く（書きかけあり）：ボードが受ける写しは A のまま（null を挟まない）', () => {
    const s = setup([memo('A'), memo('X')]);
    s.host.open('X');
    s.host.setBoardMemo('A');
    s.host.close(); // 下を閉じる。ボードは選んだ A を見たまま
    s.deliver();
    expect(s.seen().snap).toBe('A');
    s.trail.length = 0;
    expect(s.press('A', 'A-r1', true)).toBe(true);
    expect(s.trail.length).toBeGreaterThan(0);
    expect(s.trail).toEqual(s.trail.map(() => 'A'));
    expect(s.seen()).toEqual({ snap: 'A', focus: { memoId: 'A', replyId: 'A-r1', n: 1 } });
    expect(s.host.openId).toBe('A');
    expect(s.host.boardMemoId).toBeNull();
  });
  it('c で、ボードが別のメモ B を選んでいて書きかけが無い：ボードの写しは B から C へ一度で替わる（null を挟まない）', () => {
    const s = setup([memo('B'), memo('C')]);
    s.host.setBoardMemo('B');
    s.deliver();
    s.trail.length = 0;
    expect(s.press('C', 'C-r1')).toBe(true);
    expect(s.trail).not.toContain(null);
    expect(s.trail[s.trail.length - 1]).toBe('C');
    expect(s.seen().focus).toEqual({ memoId: 'C', replyId: 'C-r1', n: 1 });
  });
  // 番号を「大きいときだけ」（>）で比べるわけ：選びを外したとき、左は選んだメモの写し（null）だけを送り直し、下の写しは送り直さない。
  //   下の写しには前の頼み（小さい番号）が残るので、「違うときだけ」（!==）にすると、ボードが下に戻ったときに古い頼みが当たる
  it('選びを外したあとの下の写しには、前の小さい番号の頼みが残る。ボードは当てない（none）', () => {
    const s = setup([memo('A'), memo('B')]);
    s.host.open('A');
    s.deliver();
    s.press('A', 'A-r1'); // b：下の写しに n=1
    s.press('B', 'B-r1'); // a：B の写しに n=2（ボードはこれを当てて done＝2）
    s.host.setBoardMemo(null); // 名札の選び口で「下と同じ」に戻す
    s.deliver();
    const focus = s.seen().focus;
    expect(focus).toEqual({ memoId: 'A', replyId: 'A-r1', n: 1 });
    expect(boardFocusStep({ want: focus, done: 2, hidden: false, memoId: 'A', loaded: true, needFit: false, sized: true, busy: false, faces: [{ id: 'A-r1' }] })).toBe('none');
  });
});

const read = (path: string) => unwrapT(readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
const primary = read('../src/app/primary.ts');
const tab = read('../src/app/memo-board-tab.ts');
const panel = read('../src/panels/search-panel.ts');
const secondary = read('../src/app/secondary.ts');
const css = read('../src/search.css');
const types = read('../src/types.ts');
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
  it('右から左への openBoardCard（id と replyId は文字列）と、ボードから左への boardComposeDraft。写しの欄 boardFocus は focusReply と別', () => {
    const t = code(types);
    expect(t).toMatch(/\|\s*\{ command: 'openBoardCard'; id: string; replyId: string \}/);
    expect(t).toMatch(/\|\s*\{ command: 'boardComposeDraft'; busy: boolean \}/);
    expect(t).toMatch(/\n\s*boardFocus\?: \{ id: string; n: number \};/);
    expect(count(t, "command: 'openBoardCard'")).toBe(1);
    expect(count(t, "command: 'boardComposeDraft'")).toBe(1);
  });
});

describe('左（primary.ts）', () => {
  it('runCommand の openBoardCard：id と replyId の形を確かめてから、openBoardCardUpper を呼ぶだけ', () => {
    const body = code(cut(primary, "case 'openBoardCard': {", "case '"));
    expect(body).toMatch(/^case 'openBoardCard': \{\s*if \(typeof action\.id !== 'string' \|\| typeof action\.replyId !== 'string'\) break;\s*openBoardCardUpper\(action\.id, action\.replyId\);\s*break;\s*\}\s*$/);
    expect(count(code(primary), "case 'openBoardCard'")).toBe(1);
  });
  it('openBoardCardUpper：無いメモ・特別なセルは右の状態の行で断る → 「上のコメントボードで開く」と同じ道 → 開けたときだけ、一番上のカードに直して focusBoard', () => {
    const body = code(cut(primary, 'function openBoardCardUpper(id: string, replyId: string) {', '\n  }\n'));
    inOrder(body, ['const memo = memos.get(id);', 'if (!memo || isSpecialCell(memo)) {', "tellSearch('そのメモは、もうありません');", 'return;', 'if (!openBoardMemoUpper(id, true)) return;', 'memoPane.focusBoard(id, pathTo(memo.replies ?? [], replyId)[0]?.id ?? replyId);']);
    expect(body).not.toContain('openMemoPane'); // 下の区画の道（下の書きかけの守り）は通らない
    expect(body).not.toContain('runBoardOpen'); // 組み立ては openBoardMemoUpper の 1 か所だけ
    expect(count(code(primary), 'memoPane.focusBoard(')).toBe(1);
    expect(primary).toMatch(/import \{[^}]*\bpathTo\b[^}]*\} from '\.\.\/threads';/);
  });
  it('書きかけで替えなかったときの一言：左の一言と、右の検索の行から来たときだけ右の検索の状態の行（字は計画 §9.2 のまま。openMemoPane の fromSearch と同じ。見直し）', () => {
    const body = code(cut(primary, 'function tellBoardDraft(fromSearch: boolean) {', '\n  }\n'));
    expect(body).toContain("const text = 'ボードの書く欄に書きかけがあります。書き終えるか消してから開いてください';");
    inOrder(body, ['toast(text);', 'if (fromSearch) tellSearch(text);']);
    expect(count(code(primary), 'tellBoardDraft')).toBe(2); // 宣言・openBoardMemoUpper の keepDraft
    // 検索から来たと言うのは openBoardCardUpper だけ（左のセルの右クリック・右のメモの区画は今のまま openBoardMemoUpper(id)）
    expect(count(code(primary), 'openBoardMemoUpper(id, true)')).toBe(1);
    expect(code(primary)).toContain("run: () => openBoardMemoUpper(id) });");
    expect(code(primary)).toContain('openBoardMemoUpper(action.id);');
  });
  it('boardComposeDraft の印：宣言は memoPaneDraft のすぐ次。書くのは宣言・memoPaneReady・case の 3 か所。読むのは openBoardMemoUpper だけ', () => {
    expect(primary).toMatch(/let memoPaneDraft = false;[^\n]*\n\s*let boardComposeDraft = false;/);
    expect(count(code(primary), 'boardComposeDraft = ')).toBe(3);
    expect(count(code(primary), 'boardComposeDraft')).toBe(5); // 上の 3 か所・case の名前・draft: の 1 か所
    expect(code(cut(primary, 'function openBoardMemoUpper(id: string, fromSearch = false) {', '\n  }\n'))).toContain('draft: boardComposeDraft,');
  });
});

describe('ボード（memo-board-tab.ts）', () => {
  it('BoardSource の別の口 focus（写しの形は変えない）。当てる関数 takeFocus は boardFocusStep で決め、番号は当てたか一言を出したときだけ使う', () => {
    expect(tab).toMatch(/\n\s*focus\?\(\): BoardFocus \| null;/);
    const take = cut(tab, 'private takeFocus() {', '// ---------- 「［全体］の間」');
    inOrder(take, [
      'const want = this.source?.focus?.() ?? null;',
      'if (!want || want.n <= this.focusDone) return;',
      'const vp = this.viewport();',
      'boardFocusStep({ want, done: this.focusDone, hidden: this.hidden, memoId: this.memoId, loaded: this.loaded !== null, needFit: this.needFit, sized: vp.w > 0 && vp.h > 0, busy: this.drag !== null || this.marquee !== null, faces: this.faces })',
      "if (step !== 'hit' && step !== 'gone') return;",
      'this.focusDone = want.n;',
      "if (step === 'gone') {",
      "this.flash('カードがもうありません。メモだけ開きました', 'warn');",
      "this.endOverview('jump');",
      'this.setSelected(new Set([want.replyId]));',
      'this.showActualSize();',
    ]);
    expect(code(take)).not.toContain('this.view = '); // 位置は 100% の中の道（showActualSize）だけが書く（保存も同じ道）
    expect(count(code(tab), 'this.focusDone = ')).toBe(1);
  });
  it('当てる時：写しを受けたとき・出したとき（refresh の終わり。出したあとの位置の決め直しより後）と、読み込みが済んだとき（render のあと）', () => {
    const refresh = code(cut(tab, 'private refresh(show: boolean) {', 'private named<T>('));
    expect(refresh).toMatch(/if \(show\) this\.reopenAfterShow\(snap\.replies\);\s*if \(knownBefore\) this\.openPhotoTitle\(snap\.replies, knownBefore\);\s*this\.takeFocus\(\);\s*\}\s*$/);
    const loading = cut(tab, 'private readBoard(memoId: string) {', 'private rememberView() {');
    expect(loading).toMatch(/this\.render\(\);\s*this\.takeFocus\(\);/);
  });
  // 見直し：待つ理由（面の大きさが 0・開いたときの位置の前・つまむか範囲選択の途中）は、refresh と readBoard の外でも解ける。そこで当てないと、待った頼みが後の関係ない写し（タブの切り替えの pushNow など）で急に当たる
  it('待つ理由が解ける所でも当てる：面の大きさの変化（ResizeObserver の終わり。needFit の枝の外）・形の替え（setShape の終わり）・つまむか範囲選択を終える所（pointerup・pointercancel・lostpointercapture・blur）', () => {
    const ro = code(cut(tab, 'new ResizeObserver(() => {', '}).observe(this.stage);'));
    expect(ro).toMatch(/if \(this\.needFit && !this\.hidden\) this\.render\(\);[\s\S]*this\.paintArrivals\(\);\s*this\.takeFocus\(\);\s*$/); // 大きさだけを待っていた（needFit は下りていた）ときも当てる
    expect(code(cut(tab, 'private setShape(next: BoardLayout) {', '// ---------- 写真の行き先と題'))).toMatch(/this\.render\(\);\s*this\.paintShape\(\);\s*this\.takeFocus\(\);\s*\}\s*$/);
    expect(code(cut(tab, "this.stage.addEventListener('pointerup', (e) => {", "this.stage.addEventListener('pointercancel'"))).toMatch(/this\.dropDrag\(e\);\s*this\.finishMarquee\(e\);\s*this\.takeFocus\(\);\s*\}\);\s*$/);
    expect(code(cut(tab, "this.stage.addEventListener('pointercancel', (e) => {", "this.stage.addEventListener('lostpointercapture'"))).toMatch(/this\.cancelDrag\(\);\s*this\.takeFocus\(\);\s*\}\);\s*$/);
    expect(code(cut(tab, "this.stage.addEventListener('lostpointercapture', (e) => {", '});'))).toMatch(/this\.cancelDrag\(\);\s*this\.takeFocus\(\);\s*$/);
    expect(code(cut(tab, "window.addEventListener('blur', () => {", '});'))).toMatch(/this\.cancelDrag\(\);\s*this\.flushView\(\);\s*this\.takeFocus\(\);\s*$/);
    // つまむのを終える関数（endDrag・endMarquee・cancelDrag）の中では呼ばない（refresh・setShape・setHidden・setPlace の途中で呼ばれ、片づけの前に当たってしまうため）
    for (const fn of ['private endDrag() {', 'private endMarquee(cancel: boolean) {', 'cancelDrag(): boolean {']) expect(cut(tab, fn, '\n  }\n'), fn).not.toContain('takeFocus');
    expect(count(code(tab), 'this.takeFocus()')).toBe(8); // refresh・readBoard・ResizeObserver・setShape・pointerup・pointercancel・lostpointercapture・blur
  });
  // ボードの当たりを、待つ理由が解ける順に純粋な関数でなぞる（ボードの DOM は試験で組めないので、動かしてはいない）
  it('待ったあと大きさが付けば当たり、当てたあとは関係ない写しが来ても当たらない（boardFocusStep の並び）', () => {
    const want = { memoId: 'A', replyId: 'A-r1', n: 1 };
    const s = { want, done: 0, hidden: false, memoId: 'A', loaded: true, needFit: true, sized: false, busy: false, faces: [{ id: 'A-r1' }] };
    expect(boardFocusStep(s)).toBe('wait'); // 読み込みが済んだが、面の大きさが 0（needFit は立ったまま）
    expect(boardFocusStep({ ...s, needFit: false, sized: true })).toBe('hit'); // ResizeObserver：render で needFit が下り、大きさが付いた
    expect(boardFocusStep({ ...s, needFit: false, sized: true, done: 1 })).toBe('none'); // 当てた番号を覚えたあと：タブの切り替えの写しなどでは当たらない
    expect(boardFocusStep({ ...s, needFit: false, sized: true, busy: true })).toBe('wait'); // つまむ途中は待つ
    expect(boardFocusStep({ ...s, needFit: false, sized: true, busy: false })).toBe('hit'); // 離したら当たる（pointerup）
  });
  it('書きかけの知らせ：一つの関数（composeHasDraft）で求め、変わったときだけ左へ boardComposeDraft', () => {
    const report = cut(tab, 'private reportComposeDraft() {', 'private showRefused(');
    expect(report).toContain('const busy = composeHasDraft({ open: this.composing, text: this.composeText.value, photoTitle: this.photoTitleFor !== null, waiting: this.refusedDrafts.length });');
    expect(report).toMatch(/if \(busy === this\.composeDraftSent\) return;\s*this\.composeDraftSent = busy;\s*this\.ask\(\{ command: 'boardComposeDraft', busy \}\);/);
    expect(count(code(tab), 'this.composeDraftSent = ')).toBe(1);
  });
  it('知らせる所：開く（showCompose の終わり）・閉じる（closeCompose の終わり。待っていた文を戻したあと）・断られた文を戻す（returnDraft）・入力（別の input の受け口）。メモの替えは closeCompose を通る', () => {
    expect(code(cut(tab, 'private showCompose(', 'private paintComposeShape() {'))).toMatch(/this\.shiftForCompose\(\);\s*this\.reportComposeDraft\(\);\s*\}\s*$/);
    const close = cut(tab, 'private closeCompose() {', 'private submitCompose(');
    inOrder(close, ['this.refusedDrafts.shift()', 'else if (wasOpen) this.paintTools();', 'this.reportComposeDraft();']);
    expect(cut(tab, 'private returnDraft(', 'private reportComposeDraft(')).toMatch(/else this\.refusedDrafts\.push\(\{ mode, text \}\);\s*this\.reportComposeDraft\(\);/);
    expect(tab).toContain("this.composeText.addEventListener('input', () => this.reportComposeDraft());");
    expect(count(code(tab), 'this.reportComposeDraft()')).toBe(4);
    const changed = cut(tab, 'if (changed) {', 'this.memoId = snap.memoId;');
    inOrder(changed, ['this.refusedDrafts.length = 0;', 'this.closeCompose();']);
  });
});

describe('右の検索（search-panel.ts・secondary.ts・search.css）', () => {
  const row = cut(panel, 'private rowNode(item: SearchItem): HTMLElement {', 'private localRowNode(');
  it('コメントの行（replyId がある）にだけ［上で開く］。説明・焦点の鍵・もう無いメモの守り（guard）を通す。メモの行・右の中の行には出さない', () => {
    expect(row).toContain("if (item.kind === 'reply' && item.replyId) {");
    expect(row).toContain("const upper = el('button', 'search-row-upper', '上で開く');");
    expect(row).toContain("upper.type = 'button';");
    expect(row).toContain('upper.dataset.focusKey = `${key}:upper`;');
    expect(row).toContain("upper.title = '上のボードで、このカードを開きます';");
    expect(row).toContain('upper.addEventListener(\'click\', guard(() => this.deps.openBoard(item.memoId, replyId)));');
    expect(cut(panel, 'private localRowNode(', 'private localMetaOf(')).not.toContain('search-row-upper');
    expect(count(panel, "'上で開く'")).toBe(1);
  });
  it('小さいボタンは横の箱（search-row-actions）に入れ、［上で開く］→［盤面で見る］の順。行は大きいボタンと箱の 2 つ', () => {
    inOrder(row, ["const actions = el('div', 'search-row-actions');", 'actions.append(upper);', "const board = el('button', 'search-row-board', '盤面で見る');", 'actions.append(board);', 'row.append(main, actions);']);
  });
  it('右の口 openBoard → 左へ openBoardCard（id と replyId だけ）', () => {
    expect(panel).toMatch(/\n\s*openBoard\(memoId: string, replyId: string\): void;/);
    expect(secondary).toContain("openBoard: (id, replyId) => askLeft({ command: 'openBoardCard', id, replyId }),");
  });
  it('CSS：箱は右寄せの横並び。［上で開く］は［盤面で見る］と同じ形（色はテーマの変数だけ）', () => {
    const actions = cut(css, '.search-row-actions {', '}');
    expect(actions).toContain('display: flex;');
    expect(actions).toContain('align-self: flex-end;');
    const small = cut(css, '.search-row-upper,\n.search-row-board {', '}');
    expect(small).toContain('color: var(--accent-ink);');
    expect(small).toContain('height: 20px;');
    expect(css).not.toMatch(/\.search-row-board \{[^}]*align-self/); // 右寄せは箱が受け持つ
  });
});
