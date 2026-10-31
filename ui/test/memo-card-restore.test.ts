// 削除の取り消し（B3-3a。restoreReplies と removeReply の undoToken）：左の台帳の命令側だけ。画面（グリッド・下の区画・ボード）は何も送らないので変わらない
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ledger = vi.hoisted(() => ({ status: 'ok' as 'ok' | 'failed' }));

vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async (name: string) => {
    if (name !== 'memocells.json') return { status: 'missing' };
    return ledger.status === 'ok' ? { status: 'ok', value: { version: 1, memos: [] } } : { status: 'failed' };
  },
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { isRestoreToken, MemoStore, RESTORE_MAX_CHARS, RESTORE_MAX_ENTRIES } from '../src/memocells';
import { type Reply, withoutReply } from '../src/threads';

afterEach(() => {
  ledger.status = 'ok';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const card = (id: string, text: string, createdAt: number, extra: Partial<Reply> = {}): Reply => ({ id, parent: null, text, createdAt, ...extra });

// 甲 ← 乙（関連）、乙の返事 乙1、丙（離れている）。順は rank つき
const sample = (): Reply[] => [
  card('a', '甲', 1, { rank: 0, tags: ['考察'] }),
  card('b', '乙', 2, { rank: 1, links: [{ to: 'a', kind: 'ground' }] }),
  { id: 'b1', parent: 'b', text: '乙の返事', createdAt: 3 } as Reply,
  card('c', '丙', 4, { rank: 2, links: [{ to: 'b', kind: 'ground' }] }),
];

async function store() {
  vi.stubGlobal('window', { setTimeout: (fn: () => void) => fn(), clearTimeout });
  const memos = new MemoStore();
  await memos.load();
  return memos;
}

let seq = 0;
function memoWith(memos: MemoStore, replies: Reply[] = sample()) {
  const m = memos.add({ pos: { q: seq++, r: 0 }, text: `メモ ${seq}`, replies });
  if (!m) throw new Error('add');
  return m.id;
}

const repliesOf = (memos: MemoStore, id: string) => JSON.stringify(memos.get(id)?.replies ?? []);
const stamp = (memos: MemoStore, id: string) => JSON.stringify([memos.get(id)?.replies ?? [], memos.get(id)?.updatedAt]);

describe('removeReply（undoToken つき）→ restoreReplies', () => {
  it('消す→戻す：返信・関連・順・タグ・更新時刻が元どおり。保存の知らせは 1 回ずつ。戻したら控えは捨てる（2 回目は none）', async () => {
    const memos = await store();
    const id = memoWith(memos);
    const original = stamp(memos, id);
    let changes = 0;
    memos.onChange(() => changes++);

    memos.removeReply(id, 'b', 'ux1');
    expect(changes).toBe(1);
    expect(memos.get(id)?.replies?.map((r) => r.id)).toEqual(['a', 'c']); // b とその返事 b1 が消え、c の b への関連も外れる
    expect(memos.get(id)?.replies?.find((r) => r.id === 'c')?.links ?? []).toEqual([]);

    const done = memos.restoreReplies(id, 'ux1');
    expect(done).toEqual({ ok: true, count: 4 });
    expect(changes).toBe(2);
    expect(stamp(memos, id)).toBe(original);

    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: false, why: 'none' });
    expect(changes).toBe(2);
    expect(stamp(memos, id)).toBe(original);
  });

  it('そのあとメモが変わっていれば stale：何も変えない（保存の知らせも出さない）', async () => {
    const memos = await store();
    const id = memoWith(memos);
    memos.removeReply(id, 'b', 'ux1');
    memos.changeReplyTags(id, 'a', ['足したタグ'], []); // ボードの外での変更（左の画面のタグなど）
    const changed = stamp(memos, id);
    let changes = 0;
    memos.onChange(() => changes++);
    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: false, why: 'stale' });
    expect(stamp(memos, id)).toBe(changed);
    expect(changes).toBe(0);
    // 控えは残る（元の状態に戻れば戻せる、は仕様にしない。ここでは何も変わらないことだけ確かめる）
    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: false, why: 'stale' });
  });

  it('メモが消えていれば stale、別のメモの id では none。控えの無い token・形の悪い token は none', async () => {
    const memos = await store();
    const id = memoWith(memos);
    const other = memoWith(memos);
    memos.removeReply(id, 'b', 'ux1');
    expect(memos.restoreReplies(other, 'ux1')).toEqual({ ok: false, why: 'none' });
    expect(memos.restoreReplies(id, 'uzzz')).toEqual({ ok: false, why: 'none' });
    for (const bad of ['', 'x1', 'u!', `u${'a'.repeat(64)}`, 'ux 1']) expect(memos.restoreReplies(id, bad)).toEqual({ ok: false, why: 'none' });
    memos.remove(id);
    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: false, why: 'stale' });
  });

  it('2 回消して、新しい順に 2 回戻せる。古い方から戻そうとすると stale（新しい方を戻したあとなら戻せる）', async () => {
    const memos = await store();
    const id = memoWith(memos);
    const original = stamp(memos, id);
    memos.removeReply(id, 'c', 'ux1');
    const afterFirst = stamp(memos, id);
    memos.removeReply(id, 'a', 'ux2');
    expect(memos.get(id)?.replies?.map((r) => r.id)).toEqual(['b', 'b1']);

    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: false, why: 'stale' });
    expect(memos.restoreReplies(id, 'ux2')).toEqual({ ok: true, count: 3 });
    expect(stamp(memos, id)).toBe(afterFirst);
    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: true, count: 4 });
    expect(stamp(memos, id)).toBe(original);
  });

  it('ほかのメモと独立：A を消しても B の返信は触らない。B が変わっても A は戻せる（B は stale）。token は別のメモの id では使えない', async () => {
    const memos = await store();
    const a = memoWith(memos);
    const b = memoWith(memos);
    const aOriginal = stamp(memos, a);
    const bOriginal = stamp(memos, b);
    memos.removeReply(a, 'b', 'uA');
    memos.removeReply(b, 'a', 'uB');
    expect(stamp(memos, b)).not.toBe(bOriginal);
    memos.changeReplyTags(b, 'c', ['別のタグ'], []);
    const bChanged = stamp(memos, b);

    expect(memos.restoreReplies(b, 'uA')).toEqual({ ok: false, why: 'none' });
    expect(memos.restoreReplies(a, 'uB')).toEqual({ ok: false, why: 'none' });
    expect(memos.restoreReplies(b, 'uB')).toEqual({ ok: false, why: 'stale' });
    expect(memos.restoreReplies(a, 'uA')).toEqual({ ok: true, count: 4 });
    expect(stamp(memos, a)).toBe(aOriginal);
    expect(stamp(memos, b)).toBe(bChanged);
  });

  it('台帳が読めなかった起動では、控えず・戻さず・書かない', async () => {
    ledger.status = 'failed';
    const memos = await store();
    const id = memoWith(memos);
    const before = stamp(memos, id);
    memos.removeReply(id, 'b', 'ux1'); // 消す動きは今までどおり（控えだけ作らない）
    expect(stamp(memos, id)).not.toBe(before);
    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: false, why: 'ledger' });
  });
});

describe('控えの上限', () => {
  it(`件数：${RESTORE_MAX_ENTRIES} 件まで。超えたら古いものから捨てる（残りは新しい順に戻せる）`, async () => {
    const memos = await store();
    const many = Array.from({ length: RESTORE_MAX_ENTRIES + 5 }, (_, i) => card(`k${i}`, `札 ${i}`, i + 1));
    const id = memoWith(memos, many);
    const originals: string[] = [stamp(memos, id)];
    for (let i = 0; i < many.length; i++) {
      memos.removeReply(id, `k${i}`, `u${i}`);
      originals.push(stamp(memos, id));
    }
    expect(memos.get(id)?.replies).toEqual([]);
    // 古い 5 件（u0〜u4）は捨てられた
    for (let i = many.length - 1; i >= 5; i--) {
      expect(memos.restoreReplies(id, `u${i}`)).toMatchObject({ ok: true });
      expect(stamp(memos, id)).toBe(originals[i]);
    }
    for (let i = 0; i < 5; i++) expect(memos.restoreReplies(id, `u${i}`)).toEqual({ ok: false, why: 'none' });
    expect(stamp(memos, id)).toBe(originals[5]);
  });

  it(`文字数：合計 ${RESTORE_MAX_CHARS} 字を超えたら古いものから捨てる。1 件だけで超えるものは控えない`, async () => {
    const memos = await store();
    // 1 枚 2000 字（上限）× 300 枚のメモ：1 件の控えは約 124 万字（消す前＋消した後の写し）。3 件で約 370 万字は収まる
    const big = (n: number, tag: string, chars = 2000) => Array.from({ length: n }, (_, i) => card(`${tag}${i}`, 'あ'.repeat(chars), i + 1));
    const m1 = memoWith(memos, big(300, 'p'));
    const m2 = memoWith(memos, big(300, 'q'));
    const m3 = memoWith(memos, big(300, 'r'));
    const m4 = memoWith(memos, big(300, 's'));
    memos.removeReply(m1, 'p0', 'u1');
    memos.removeReply(m2, 'q0', 'u2');
    memos.removeReply(m3, 'r0', 'u3');
    memos.removeReply(m4, 's0', 'u4'); // 4 件目で超える → いちばん古い u1 を捨てる
    expect(memos.restoreReplies(m1, 'u1')).toEqual({ ok: false, why: 'none' });
    for (const [m, t] of [[m4, 'u4'], [m3, 'u3'], [m2, 'u2']] as const) expect(memos.restoreReplies(m, t)).toMatchObject({ ok: true, count: 300 });

    // 実際の返信は 1 枚 2000 字・300 枚までなので 1 件で上限を超えることは無いが、念のため（ストアの中身を直に大きくして）確かめる
    const huge = memoWith(memos, big(1, 'h'));
    const live = memos.get(huge);
    if (!live) throw new Error('huge');
    live.replies = big(30, 'h', 100_000);
    memos.removeReply(huge, 'h0', 'u5');
    expect(memos.get(huge)?.replies).toHaveLength(29); // 消す動きは今までどおり
    expect(memos.restoreReplies(huge, 'u5')).toEqual({ ok: false, why: 'none' });
  });

  it('同じ token で続けて消すと 1 件にまとまり、一度に全部戻る（B3-3b：何枚かを一度に消す）。間に別の変更が入ったときは置き換わる', async () => {
    const memos = await store();
    const id = memoWith(memos);
    const original = stamp(memos, id);
    memos.removeReply(id, 'c', 'ux1');
    memos.removeReply(id, 'a', 'ux1'); // 同じ操作で続けて消す（前の「消した後」＝今回の「消す前」）
    expect(memos.get(id)?.replies?.map((r) => r.id)).toEqual(['b', 'b1']);
    expect(memos.restoreReplies(id, 'ux1')).toMatchObject({ ok: true, count: 4 });
    expect(stamp(memos, id)).toBe(original);
    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: false, why: 'none' });

    // 間に別の変更（タグ）が入ってから同じ token を使い直した：前の控えは捨てて、あとの控えだけ
    memos.removeReply(id, 'c', 'ux2');
    memos.changeReplyTags(id, 'a', ['足したタグ'], []);
    const mid = stamp(memos, id);
    memos.removeReply(id, 'a', 'ux2');
    expect(memos.restoreReplies(id, 'ux2')).toMatchObject({ ok: true, count: 3 });
    expect(stamp(memos, id)).toBe(mid);
    expect(memos.restoreReplies(id, 'ux2')).toEqual({ ok: false, why: 'none' });
  });

  it('同じ token で 60 枚を続けて消しても控えは 1 件（50 件の上限に掛からない）。一度に全部戻る', async () => {
    const memos = await store();
    const many = Array.from({ length: 60 }, (_, i) => card(`k${i}`, `札 ${i}`, i + 1));
    const id = memoWith(memos, many);
    const original = stamp(memos, id);
    for (let i = 0; i < 60; i++) memos.removeReply(id, `k${i}`, 'ubatch');
    expect(memos.get(id)?.replies).toEqual([]);
    expect(memos.restoreReplies(id, 'ubatch')).toEqual({ ok: true, count: 60 });
    expect(stamp(memos, id)).toBe(original);
  });
});

describe('removeReply の今までの動き（変わらない）', () => {
  it('undoToken なし：今までどおり消す。控えは作らない。保存の知らせは 1 回', async () => {
    const memos = await store();
    const id = memoWith(memos);
    const expected = withoutReply(structuredClone(memos.get(id)?.replies ?? []), 'b');
    let changes = 0;
    memos.onChange(() => changes++);
    memos.removeReply(id, 'b');
    expect(memos.get(id)?.replies).toEqual(expected);
    expect(changes).toBe(1);
    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: false, why: 'none' });
  });

  it('undoToken あり：消した結果は token なしと同じ。メモの更新時刻は変えない', async () => {
    const memos = await store();
    const a = memoWith(memos);
    const b = memoWith(memos);
    const updatedA = memos.get(a)?.updatedAt;
    const updatedB = memos.get(b)?.updatedAt;
    memos.removeReply(a, 'b');
    memos.removeReply(b, 'b', 'ux1');
    expect(repliesOf(memos, b)).toBe(repliesOf(memos, a));
    expect(memos.get(a)?.updatedAt).toBe(updatedA);
    expect(memos.get(b)?.updatedAt).toBe(updatedB);
  });

  it('何も消えないとき（返信の id が無い）・メモが無い・返信が無いメモ：今までどおり。控えは作らない・例外も出ない', async () => {
    const memos = await store();
    const id = memoWith(memos);
    const before = stamp(memos, id);
    memos.removeReply(id, 'nothing', 'ux1');
    expect(stamp(memos, id)).toBe(before);
    expect(memos.restoreReplies(id, 'ux1')).toEqual({ ok: false, why: 'none' });
    expect(() => memos.removeReply('no-such-memo', 'a', 'ux2')).not.toThrow();
    const empty = memos.add({ pos: { q: 99, r: 9 }, text: '空' });
    expect(() => memos.removeReply(empty?.id ?? '', 'a', 'ux3')).not.toThrow();
  });

  it('形の悪い undoToken をストアに直接渡しても、消す動きは同じで控えだけ作らない（命令の入口は別に断る）', async () => {
    const memos = await store();
    const id = memoWith(memos);
    memos.removeReply(id, 'c', 'bad token!');
    expect(memos.get(id)?.replies?.map((r) => r.id)).toEqual(['a', 'b', 'b1']);
    expect(memos.restoreReplies(id, 'bad token!')).toEqual({ ok: false, why: 'none' });
  });
});

describe('token の形・命令の受け口・画面が変わらないこと', () => {
  it('isRestoreToken：u で始まる 64 字以内の [A-Za-z0-9_-]', () => {
    expect(isRestoreToken('u')).toBe(true);
    expect(isRestoreToken(`u${'a'.repeat(63)}`)).toBe(true);
    expect(isRestoreToken('um1x-_Z9')).toBe(true);
    for (const bad of ['', 'a1', 'U1', `u${'a'.repeat(64)}`, 'u 1', 'u/1', 'u1\n', 'あ', 12, null, undefined, {}]) expect(isRestoreToken(bad as never)).toBe(false);
  });

  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('左（primary.ts）が removeReply の undoToken と restoreReplies を受ける。形が悪い token は何も消さずに断り、id・token の形を検査する', () => {
    const primary = read('../src/app/primary.ts');
    expect(primary).toContain("case 'restoreReplies':");
    expect(primary).toMatch(/action\.undoToken !== undefined && !isRestoreToken\(action\.undoToken\)/);
    expect(primary).toMatch(/memos\.removeReply\(action\.ref\.id, action\.replyId, action\.undoToken\)/);
    expect(primary).toMatch(/typeof action\.id !== 'string' \|\| !isRestoreToken\(action\.token\)/);
    expect(primary).toContain('memos.restoreReplies(action.id, action.token)');
    const types = read('../src/types.ts');
    expect(types).toContain("{ command: 'restoreReplies'; id: string; token: string }");
    expect(types).toMatch(/command: 'removeReply'; ref: ThreadRef; replyId: string; undoToken\?: string/);
  });

  it('送るのはボードの Undo（B3-3b）だけ：下の区画・右の区画・グリッドの送り手は restoreReplies も undoToken も使わない', () => {
    const senders = ['../src/app/memo-pane.ts', '../src/app/secondary.ts', '../src/panels/memo-pad.ts', '../src/memo-card-board-paste.ts'];
    for (const file of senders) expect(read(file), file).not.toMatch(/restoreReplies|undoToken/);
    expect(read('../src/memo-card-board-undo.ts')).toContain("command: 'restoreReplies'");
    expect(read('../src/memo-card-board-edit.ts')).toContain('undoToken');
  });
});