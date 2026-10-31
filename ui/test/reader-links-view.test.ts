// 結んだカードの写し（reader-links-view.ts）と、型で落とした区間の数（memo-card-templates.ts・memo-card-template-store.ts。段 V0d）
import { describe, expect, it, vi } from 'vitest';

// memocells.ts を読み込むので、偽物にする（reply-id.test.ts と同じ）
vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async () => ({ status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { describeTemplateReport } from '../src/memo-card-template-store';
import { buildTemplateFromCards } from '../src/memo-card-templates';
import { cellKeys } from '../src/reader/store';
import type { ReplyAt } from '../src/reader-links';
import { type LinkViewMemo, MAX_LINK_ITEMS, memoHead, readerLinksView } from '../src/reader-links-view';
import type { Reply } from '../src/threads';

const VIDEO = 'dQw4w9WgXcQ';
const key = cellKeys(['ひとつめのマス'])[0];
const at = (video: string, over: Partial<ReplyAt> = {}): ReplyAt => ({ video, spans: [{ key, start: 12.5, end: 18 }], ...over });
const card = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt: 100, ...over });
const memo = (id: string, text: string, replies: Reply[], over: Partial<LinkViewMemo> = {}): LinkViewMemo => ({ id, text, replies, ...over });

// メモ A（ふつう。c1〈VIDEO〉・c2〈at なし〉・c1 への返信 c3〈VIDEO〉）、メモ B（ふつう。c4〈VIDEO・AI・tech〉・c5〈別の動画〉）、メモ P（特別なセル。c6〈VIDEO〉）
function sample(): LinkViewMemo[] {
  return [
    memo('A', 'メモ A', [card('c1', { at: at(VIDEO) }), card('c2'), { id: 'c3', parent: 'c1', text: 'カード c3', createdAt: 101, at: at(VIDEO) }]),
    memo('B', 'メモ B', [card('c4', { at: at(VIDEO, { kind: 'tech' }), by: { who: 'main', name: '相棒' } }), card('c5', { at: at('aaaaaaaaaaa') })]),
    memo('P', 'ポータル', [card('c6', { at: at(VIDEO) })], { portal: 'https://example.com/' }),
  ];
}

describe('readerLinksView（結んだカードの写し）', () => {
  it('items は、その動画に結んだ一番上のカードだけ（返信と特別なセルは入らない）', () => {
    const view = readerLinksView(sample(), VIDEO, 'A');
    expect(view.video).toBe(VIDEO);
    expect(view.items).toEqual([
      { memoId: 'A', replyId: 'c1', spans: [{ key, start: 12.5, end: 18 }], ai: false, head: 'カード c1' },
      { memoId: 'B', replyId: 'c4', spans: [{ key, start: 12.5, end: 18 }], kind: 'tech', ai: true, head: 'カード c4' },
    ]);
  });

  it('target は結ぶ先のメモ。一番上のカードの一覧は並べた順で、video は結んでいるものにだけ付く', () => {
    expect(readerLinksView(sample(), VIDEO, 'A').target).toEqual({
      memoId: 'A',
      title: 'メモ A',
      replies: 3,
      max: 300,
      tops: [
        { replyId: 'c1', head: 'カード c1', video: VIDEO },
        { replyId: 'c2', head: 'カード c2' },
      ],
    });
  });

  it('memos は、この動画のカードがあるメモ（重ねず、items の順）。特別なセルと別の動画だけのメモは入らない（V1c）', () => {
    expect(readerLinksView(sample(), VIDEO, null).memos).toEqual([
      { memoId: 'A', title: 'メモ A' },
      { memoId: 'B', title: 'メモ B' },
    ]);
    expect(readerLinksView(sample(), 'aaaaaaaaaaa', null).memos).toEqual([{ memoId: 'B', title: 'メモ B' }]);
  });

  it('targetId が特別なセル・無い・null なら target は null', () => {
    for (const targetId of ['P', 'nope', null]) expect(readerLinksView(sample(), VIDEO, targetId).target).toBeNull();
  });

  it('items は MAX_LINK_ITEMS（600 件）で打ち切る', () => {
    const many = [0, 1, 2].map((m) => memo(`M${m}`, `メモ ${m}`, Array.from({ length: 300 }, (_, i) => card(`m${m}c${i}`, { at: at(VIDEO), createdAt: i }))));
    expect(MAX_LINK_ITEMS).toBe(600);
    const view = readerLinksView(many, VIDEO, null);
    expect(view.items).toHaveLength(600);
    expect(view.items[599]).toMatchObject({ memoId: 'M1', replyId: 'm1c299' }); // 1 つめの 300 件と 2 つめの 300 件で止まる
  });

  it('入力のメモも配列も変えない。items の spans は台帳の配列の写し', () => {
    const memos = sample();
    const before = structuredClone(memos);
    const view = readerLinksView(memos, VIDEO, 'A');
    expect(memos).toEqual(before);
    const ledgerSpans = memos[0].replies?.find((r) => r.id === 'c1')?.at?.spans;
    expect(view.items[0].spans).toEqual(ledgerSpans);
    expect(view.items[0].spans).not.toBe(ledgerSpans);
  });
});

describe('memoHead（メモの題）', () => {
  it('最初の空でない行の前後を取る', () => {
    expect(memoHead('\n  動画のメモ \n本文')).toBe('動画のメモ');
  });

  it('40 字（コードポイント）まで。41 字以上は 40 字＋「…」', () => {
    expect(memoHead('あ'.repeat(40))).toBe('あ'.repeat(40));
    expect(memoHead('あ'.repeat(41))).toBe(`${'あ'.repeat(40)}…`);
    expect(memoHead('😀'.repeat(41))).toBe(`${'😀'.repeat(40)}…`);
  });

  it('空・空白だけなら（無題のメモ）', () => {
    expect(memoHead('')).toBe('（無題のメモ）');
    expect(memoHead(' \n \t\n')).toBe('（無題のメモ）');
  });
});

describe('型で落とした区間（skipped.spans）', () => {
  it('選んだカードのうち at のあるものを数え、型のカードには at が入らない', () => {
    const replies = [card('a', { text: '論点', rank: 0, at: at(VIDEO) }), card('b', { text: '賛成', rank: 1, at: at(VIDEO) }), card('c', { text: '反対', rank: 2 })];
    const done = buildTemplateFromCards(replies, ['a', 'b', 'c'], { name: '賛成・反対', newId: () => 'tpl1', now: 1 });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.report.skipped.spans).toBe(2);
    expect(done.report.skipped).toEqual({ children: 0, images: 0, quotes: 0, machineTags: 0, spans: 2 });
    for (const c of done.template.cards) expect('at' in c).toBe(false);
  });

  it('at が無ければ spans の項目は付かない（今の report と同じ形）', () => {
    const done = buildTemplateFromCards([card('a', { text: '論点', rank: 0 })], ['a'], { name: 'n', newId: () => 'tpl1', now: 1 });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect('spans' in done.report.skipped).toBe(false);
    expect(done.report.skipped).toEqual({ children: 0, images: 0, quotes: 0, machineTags: 0 });
  });
});

describe('describeTemplateReport（含めないもの・結んだ区間）', () => {
  it('区間が 1 以上なら「含めないもの」の末尾に「結んだ区間」を足す', () => {
    expect(describeTemplateReport({ cards: 1, links: 0, cutLinks: 0, skipped: { children: 0, images: 0, quotes: 0, machineTags: 0, spans: 1 } })).toEqual({
      counts: '1枚・関連 0本',
      excluded: '含めないもの：画像 0・引用 0・返信 0・外へ出る関連 0本・結んだ区間 1',
    });
  });

  it('区間が 0 なら今の文のまま（「なし」の判定も変わらない）', () => {
    expect(describeTemplateReport({ cards: 1, links: 0, cutLinks: 0, skipped: { children: 0, images: 0, quotes: 0, machineTags: 0, spans: 0 } }).excluded).toBe('含めないもの：なし');
    expect(describeTemplateReport({ cards: 3, links: 2, cutLinks: 1, skipped: { children: 1, images: 2, quotes: 3, machineTags: 4, spans: 0 } }).excluded).toBe(
      '含めないもの：画像 2・引用 3・返信 1・外へ出る関連 1本',
    );
  });
});
