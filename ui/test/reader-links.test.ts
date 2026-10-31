// 六角で見る（動画の区間セル）とカードの線の形（plan-reader-video の V0a）：at の読み書き・動画の見分け・取り込み
import { afterEach, describe, expect, it, vi } from 'vitest';

// video-key.ts は youtube.ts・media.ts（bridge）と ai/history.ts（data）を読み込むので、偽物にする
vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async () => ({ status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { parseInterchange, planInterchange } from '../src/memo-interchange';
import { fingerprint } from '../src/ai/history';
import { cleanAtTitle, isVideoKey, MAX_AT_SPANS, parseAt, parseSpans, type ReplyAt, withLinkedSpans } from '../src/reader-links';
import { MemoStore } from '../src/memocells';
import { readerVideoKey, sameVideo } from '../src/reader/video-key';
import { cellKeys } from '../src/reader/store';
import { parseReplies, regraft, type Reply, withEdit, withReply } from '../src/threads';
import { world } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

const key1 = cellKeys(['ひとつめのマス'])[0];
const key2 = cellKeys(['ふたつめのマス'])[0];
const at = (over: Partial<ReplyAt> = {}): ReplyAt => ({ video: 'dQw4w9WgXcQ', title: 'テストの動画', spans: [{ key: key1, start: 12.5, end: 18 }], ...over });

describe('isVideoKey・parseSpans・cleanAtTitle', () => {
  it('動画の見分け：YouTube の 11 字か f:＋指紋。ほかは通さない', () => {
    expect(isVideoKey('dQw4w9WgXcQ')).toBe(true);
    expect(isVideoKey(`f:${fingerprint('file:///C:/x.mp4')}`)).toBe(true);
    for (const bad of ['', 'short', 'dQw4w9WgXcQx', 'f:', 'f:12', 'f:12:XYZ', 'file:///C:/x.mp4', 1, null]) expect(isVideoKey(bad)).toBe(false);
  });
  it('区間：形の合わないもの・同じ指紋の 2 本目を捨て、秒は 0.01 にそろえる。12 本まで', () => {
    const keys = cellKeys(Array.from({ length: 20 }, (_, i) => `マス ${i}`));
    expect(parseSpans([{ key: key1, start: 1.234, end: 2.345 }])).toEqual([{ key: key1, start: 1.23, end: 2.35 }]);
    expect(parseSpans([{ key: key1, start: 1, end: 2 }, { key: key1, start: 3, end: 4 }])).toHaveLength(1);
    expect(parseSpans([{ key: 'あ', start: 1, end: 2 }, { key: key2, start: 3, end: 2 }, { key: key2, start: -1, end: 2 }, { key: key2, start: Number.NaN, end: 2 }, 'x', null])).toEqual([]);
    expect(parseSpans(keys.map((key, i) => ({ key, start: i, end: i + 1 })))).toHaveLength(MAX_AT_SPANS);
    expect(parseSpans([{ key: `${key1}#2`, start: 0, end: 0 }])).toEqual([{ key: `${key1}#2`, start: 0, end: 0 }]);
    expect(parseSpans('x')).toEqual([]);
  });
  it('題：改行は空白に、前後の空白を取り、60 字まで。空なら無し', () => {
    expect(cleanAtTitle('  一行目\n二行目  ')).toBe('一行目 二行目');
    expect([...(cleanAtTitle('あ'.repeat(80)) ?? '')]).toHaveLength(60);
    expect(cleanAtTitle('   ')).toBeUndefined();
    expect(cleanAtTitle(3)).toBeUndefined();
  });
});

describe('parseAt', () => {
  it('合う形はそのまま（種類は合うときだけ）', () => {
    expect(parseAt(at())).toEqual(at());
    expect(parseAt(at({ kind: 'tech' }))).toEqual(at({ kind: 'tech' }));
    expect(parseAt({ ...at(), kind: 'weird' })).toEqual(at());
  });
  it('動画の見分けか区間が合わなければ全体を捨てる。題が合わなければ題だけ捨てる', () => {
    expect(parseAt({ ...at(), video: 'x' })).toBeUndefined();
    expect(parseAt({ ...at(), spans: [] })).toBeUndefined();
    expect(parseAt({ ...at(), spans: [{ key: 'bad', start: 0, end: 1 }] })).toBeUndefined();
    expect(parseAt({ ...at(), title: 5 })).toEqual({ video: 'dQw4w9WgXcQ', spans: at().spans });
    for (const bad of [null, 'x', [], 1]) expect(parseAt(bad)).toBeUndefined();
  });
});

describe('カードの at（threads.ts）', () => {
  const top = (over: Record<string, unknown> = {}) => ({ id: 'c1', parent: null, text: 'カード', createdAt: 100, ...over });
  it('parseReplies：一番上のカードの at だけ読む。返信の at・崩れた at は捨てる（カードは残る）', () => {
    const list = parseReplies([top({ at: at() }), { id: 'c2', parent: 'c1', text: '返信', createdAt: 101, at: at() }, top({ id: 'c3', at: { video: 'x' } })]);
    expect(list.find((r) => r.id === 'c1')?.at).toEqual(at());
    expect(list.find((r) => r.id === 'c2')?.at).toBeUndefined();
    expect(list.find((r) => r.id === 'c3')).toBeDefined();
    expect(list.find((r) => r.id === 'c3')?.at).toBeUndefined();
  });
  it('withReply：一番上のカードにだけ付ける（形は確かめる）。at だけで文の無いカードは作らない', () => {
    const made = withReply([], null, '書いた', undefined, { at: at() });
    expect(made?.reply.at).toEqual(at());
    const child = withReply(made?.replies ?? [], made?.reply.id ?? null, '返信', undefined, { at: at() });
    expect(child?.reply.at).toBeUndefined();
    expect(withReply([], null, '書いた', undefined, { at: { ...at(), video: 'x' } })?.reply.at).toBeUndefined();
    expect(withReply([], null, '', undefined, { at: at() })).toBeNull();
  });
  it('書き直し・写し（regraft）でも at は残る', () => {
    const base: Reply[] = [{ id: 'c1', parent: null, text: 'カード', createdAt: 100, at: at() }];
    expect(withEdit(base, 'c1', '直した')?.[0].at).toEqual(at());
    expect(regraft(base, null)[0].at).toEqual(at());
  });
});

describe('readerVideoKey・sameVideo', () => {
  it('YouTube：watch・shorts・live・?t= の違いでも同じ id', () => {
    expect(readerVideoKey('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s')).toBe('dQw4w9WgXcQ');
    expect(readerVideoKey('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(readerVideoKey('https://m.youtube.com/live/dQw4w9WgXcQ?feature=share')).toBe('dQw4w9WgXcQ');
    expect(readerVideoKey('https://www.youtube.com/watch?v=bad')).toBeNull();
    expect(sameVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=99s')).toBe(true);
    expect(sameVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=aaaaaaaaaaa')).toBe(false);
  });
  it('自分のファイル：f:＋ # を外した URL の指紋（場所は入らない）。ほかのページは null', () => {
    const url = 'file:///C:/Users/someone/videos/talk.mp4';
    const k = readerVideoKey(`${url}#x`);
    expect(k).toBe(`f:${fingerprint(url)}`);
    expect(k).not.toContain('someone');
    expect(isVideoKey(k)).toBe(true);
    expect(readerVideoKey('https://example.com/article')).toBeNull();
    expect(sameVideo('https://example.com/a', 'https://example.com/a')).toBe(false);
  });
});

describe('取り込み（memo-interchange）の at', () => {
  const doc = {
    format: 'hcb-memo-interchange',
    version: 1,
    memos: [
      {
        id: 'm1',
        text: '動画のメモ',
        replies: [
          { id: 'c1', parent: null, text: '結んだカード', createdAt: 1, at: at() },
          { id: 'c2', parent: null, text: '崩れた線', createdAt: 2, at: { video: 'x', spans: [] } },
          { id: 'c3', parent: 'c1', text: '返信', createdAt: 3, at: at() },
        ],
      },
    ],
  };
  it('一番上のカードの at は通る。崩れた at と返信の at は台帳に入らない', () => {
    const r = parseInterchange(doc);
    if (!r.ok) throw new Error(r.reason);
    const plan = planInterchange(r.doc, world());
    const replies = plan.cells[0].replies ?? [];
    const by = (key: string) => replies.find((x) => x.id === plan.map.cards.get('m1')?.get(key));
    expect(by('c1')?.at).toEqual(at());
    expect(by('c2')?.at).toBeUndefined();
    expect(by('c3')?.at).toBeUndefined();
    expect(r.problems.find((p) => p.code === 'unknownKey')).toBeUndefined(); // at は知っている項目
  });
});

describe('withLinkedSpans（今あるカードに線を足す・外す。V2a-1）', () => {
  const V = 'dQw4w9WgXcQ';
  const s1 = { key: key1, start: 12.5, end: 18 };
  const s2 = { key: key2, start: 20, end: 25 };
  it('線の無いカードに足す。同じ指紋は二重にしない。題は来たもの', () => {
    expect(withLinkedSpans(undefined, V, '題', [s1, s1], undefined)).toEqual({ ok: true, at: { video: V, title: '題', spans: [s1] } });
  });
  it('足す・外すを一度に。題が来なければ今の題、AI の種類は今のまま', () => {
    expect(withLinkedSpans(at({ kind: 'tech' }), V, undefined, [s2], [key1])).toEqual({ ok: true, at: { video: V, title: 'テストの動画', spans: [s2], kind: 'tech' } });
  });
  it('全部外れたら null。別の動画・12 本を超える・崩れた足し物・崩れた動画は断る', () => {
    expect(withLinkedSpans(at(), V, undefined, [], [key1])).toEqual({ ok: true, at: null });
    expect(withLinkedSpans(at(), 'aaaaaaaaaaa', undefined, [s2], [])).toEqual({ ok: false, why: 'video' });
    const many = cellKeys(Array.from({ length: 12 }, (_, i) => `別のマス ${i}`)).map((k, i) => ({ key: k, start: i, end: i + 1 }));
    expect(withLinkedSpans(at(), V, undefined, many, [])).toEqual({ ok: false, why: 'over' });
    expect(withLinkedSpans(at(), V, undefined, [{ key: 'bad', start: 0, end: 1 }], [])).toEqual({ ok: false, why: 'form' });
    expect(withLinkedSpans(undefined, 'x', undefined, [s1], [])).toEqual({ ok: false, why: 'form' });
  });
});

describe('MemoStore.setReplyAt（V2a-1）', () => {
  async function store() {
    vi.stubGlobal('window', { setTimeout, clearTimeout }); // MemoStore は保存を window.setTimeout で待つ
    const memos = new MemoStore();
    await memos.load();
    return memos;
  }
  it('一番上のカードの線を置き換える・外す。同じなら same。返信・無いカード・特別なセル・崩れた形は refused', async () => {
    const memos = await store();
    const m = memos.add({ pos: { q: 0, r: 0 }, text: 'メモ' });
    if (!m) throw new Error('add');
    const top = memos.addReply(m.id, null, 'カード');
    const child = top ? memos.addReply(m.id, top.id, '返信') : null;
    if (!top || !child) throw new Error('reply');
    expect(memos.setReplyAt(m.id, top.id, at())).toBe('changed');
    expect(memos.get(m.id)?.replies?.find((r) => r.id === top.id)?.at).toEqual(at());
    expect(memos.setReplyAt(m.id, top.id, at())).toBe('same');
    expect(memos.setReplyAt(m.id, child.id, at())).toBe('refused');
    expect(memos.setReplyAt(m.id, 'nope', at())).toBe('refused');
    expect(memos.setReplyAt(m.id, top.id, { ...at(), video: 'x' })).toBe('refused');
    expect(memos.setReplyAt(m.id, top.id, null)).toBe('changed');
    expect(memos.get(m.id)?.replies?.find((r) => r.id === top.id)).not.toHaveProperty('at');
    const portal = memos.add({ pos: { q: 1, r: 0 }, text: '', portal: 'sheetX' });
    if (portal) expect(memos.setReplyAt(portal.id, 'any', at())).toBe('refused');
  });
});
