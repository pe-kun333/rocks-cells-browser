// コメント用に写す（reader-export.ts。段 V6b）
import { describe, expect, it, vi } from 'vitest';

// memocells.ts を読み込むので、偽物にする（reader-links-view.test.ts と同じ）
vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async () => ({ status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { COMMENT_MAX, MAX_EXPORT_CARDS, commentText, exportCards, parseExportCards } from '../src/reader-export';
import type { ReplySpan } from '../src/reader-links';
import type { LinkViewMemo } from '../src/reader-links-view';
import type { Reply } from '../src/threads';

const VIDEO = 'dQw4w9WgXcQ';
const span = (start: number): ReplySpan => ({ key: 'k', start, end: start + 5 });
const card = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt: 100, ...over });
const memo = (id: string, text: string, replies: Reply[], over: Partial<LinkViewMemo> = {}): LinkViewMemo => ({ id, text, replies, ...over });

// メモ A（ふつう）：c1（ここが好き・184 秒）、c2（天丼 2 回目・75.5 秒と 320 秒）、c3（文が空・引用あり）、c4（AI・tech）、c5（別の動画）、c6（結んでいない）、c1 への返信 c7
function sampleA(): LinkViewMemo {
  return memo('A', 'メモ A', [
    card('c1', { text: 'ここが好き', at: { video: VIDEO, spans: [span(184)] } }),
    card('c2', { text: '天丼\n2 回目', at: { video: VIDEO, spans: [span(320), span(75.5)] } }),
    card('c3', { text: '', quote: { text: 'ページの文', url: 'https://example.com/', title: '題' }, at: { video: VIDEO, spans: [span(10)] } }),
    card('c4', { text: 'AI の文', by: { who: 'main', name: 'Claude' }, at: { video: VIDEO, spans: [span(20)], kind: 'tech' } }),
    card('c5', { text: '別の動画', at: { video: 'aaaaaaaaaaa', spans: [span(30)] } }),
    card('c6', { text: '結んでいない' }),
    { id: 'c7', parent: 'c1', text: '返信', createdAt: 101, at: { video: VIDEO, spans: [span(40)] } },
  ]);
}

// メモ P（特別なセル）：c8（VIDEO・50 秒）
function sampleP(): LinkViewMemo {
  return memo('P', 'ポータル', [card('c8', { text: '特別', at: { video: VIDEO, spans: [span(50)] } })], { portal: 'https://example.com/' });
}

// この動画と結んだ、写せる一番上のカード（作った時刻 createdAt の順に並ぶ）
const ok = (id: string, sec: number, createdAt: number): Reply => card(id, { text: `文 ${id}`, createdAt, at: { video: VIDEO, spans: [span(sec)] } });

describe('exportCards（台帳からコメント用の枚数を集める）', () => {
  it('特別なセル・返信・AI・やり取り・別の動画・字幕だけ・結んでいないものは入らず、秒の早い順に並ぶ', () => {
    expect(exportCards([sampleA(), sampleP()], VIDEO)).toEqual([
      { sec: 75.5, text: '天丼 2 回目' },
      { sec: 184, text: 'ここが好き' },
    ]);
  });

  it('by があるカード（やり取りのカード）は入らない', () => {
    const m = memo('T', 'やり取り', [
      card('t1', { text: 'やり取り', by: { who: 'main', name: '相棒' }, at: { video: VIDEO, spans: [span(5)], kind: 'talk' } }),
      card('t2', { text: 'AI だけ', by: { who: 'main', name: '相棒' }, at: { video: VIDEO, spans: [span(6)] } }),
      card('t3', { text: 'kind だけ', at: { video: VIDEO, spans: [span(7)], kind: 'tech' } }),
      card('t4', { text: 'ふつう', at: { video: VIDEO, spans: [span(8)] } }),
    ]);
    expect(exportCards([m], VIDEO)).toEqual([{ sec: 8, text: 'ふつう' }]);
  });

  it('使える start が 1 つも無い区間だけのカードは入らない。使えるものが混ざれば、使える中でいちばん早い秒', () => {
    const m = memo('S', '区間', [
      card('s1', { text: '使えない', at: { video: VIDEO, spans: [{ key: 'k', start: -1, end: 2 }, { key: 'k', start: NaN, end: 3 }, { key: 'k', start: Infinity, end: 4 }] } }),
      card('s2', { text: '混ざる', at: { video: VIDEO, spans: [{ key: 'k', start: -1, end: 2 }, span(7), span(9)] } }),
    ]);
    expect(exportCards([m], VIDEO)).toEqual([{ sec: 7, text: '混ざる' }]);
  });

  it('MAX_EXPORT_CARDS（300 枚）で止める。メモの順・カードの順で先のものが残る', () => {
    expect(MAX_EXPORT_CARDS).toBe(300);
    const a = memo('A', 'メモ A', Array.from({ length: 200 }, (_, i) => ok(`a${i}`, i, i)));
    const b = memo('B', 'メモ B', Array.from({ length: 200 }, (_, i) => ok(`b${i}`, 1000 + i, i)));
    const out = exportCards([a, b], VIDEO);
    expect(out).toHaveLength(300);
    expect(out[0]).toEqual({ sec: 0, text: '文 a0' });
    expect(out[out.length - 1]).toEqual({ sec: 1099, text: '文 b99' });
    expect(out.some((c) => c.text === '文 b100')).toBe(false);
  });

  it('同じ秒の 2 枚は取った順のまま（作った順）', () => {
    const m = memo('M', 'メモ', [ok('x2', 10, 200), ok('x1', 10, 100)]);
    expect(exportCards([m], VIDEO)).toEqual([
      { sec: 10, text: '文 x1' },
      { sec: 10, text: '文 x2' },
    ]);
  });

  it('入力のメモも配列も変えない', () => {
    const memos = [sampleA(), sampleP()];
    const before = structuredClone(memos);
    exportCards(memos, VIDEO);
    expect(memos).toEqual(before);
  });
});

describe('commentText（欄に出す文）', () => {
  it('例：1 行「m:ss 文」を改行でつなぐ。字数はコードポイント（改行も 1 字）', () => {
    const cards = exportCards([sampleA(), sampleP()], VIDEO);
    expect(commentText(cards)).toEqual({ text: '1:15 天丼 2 回目\n3:04 ここが好き', lines: 2, chars: 23, over: false });
  });

  it('空の配列なら空の文', () => {
    expect(commentText([])).toEqual({ text: '', lines: 0, chars: 0, over: false });
  });

  it('COMMENT_MAX を超えると over が真（切らない）。ちょうどなら偽', () => {
    expect(COMMENT_MAX).toBe(10000);
    const over = commentText([{ sec: 0, text: 'あ'.repeat(COMMENT_MAX) }]); // 「0:00 」（5 字）＋ 10000 字
    expect(over).toMatchObject({ lines: 1, chars: COMMENT_MAX + 5, over: true });
    expect(over.text).toBe(`0:00 ${'あ'.repeat(COMMENT_MAX)}`);
    expect(commentText([{ sec: 0, text: 'あ'.repeat(COMMENT_MAX - 5) }])).toMatchObject({ chars: COMMENT_MAX, over: false });
  });

  it('1 時間を超える秒は「時:分:秒」の形で行の頭に出る', () => {
    expect(commentText([{ sec: 3725, text: 'x' }]).text).toBe('1:02:05 x');
  });
});

describe('parseExportCards（左からの返事を確かめる）', () => {
  it('合わない要素は捨て、まとめて、秒の早い順に並べ直す。余計な項目は落とす', () => {
    expect(parseExportCards([{ sec: 5, text: ' a\nb ' }, { sec: -1, text: 'x' }, { sec: 3, text: '  ' }, { sec: 1, text: 'c', extra: 1 }, 'z'])).toEqual([
      { sec: 1, text: 'c' },
      { sec: 5, text: 'a b' },
    ]);
  });

  it('null・文字列の sec・有限でない sec・文字列でない text は捨てる', () => {
    expect(parseExportCards([null, { sec: '3', text: 'x' }, { sec: Infinity, text: 'y' }, { sec: 2, text: 1 }, { sec: 2, text: 'd' }])).toEqual([{ sec: 2, text: 'd' }]);
  });

  it('頭から 300 個までを見る', () => {
    const many = Array.from({ length: 301 }, (_, i) => ({ sec: i, text: `t${i}` }));
    const out = parseExportCards(many);
    expect(out).toHaveLength(300);
    expect(out?.[299]).toEqual({ sec: 299, text: 't299' });
  });

  it('配列でなければ null。空の配列は空の配列', () => {
    expect(parseExportCards('x')).toBeNull();
    expect(parseExportCards({ sec: 1, text: 'x' })).toBeNull();
    expect(parseExportCards([])).toEqual([]);
  });

  it('入力を変えない', () => {
    const raw = [{ sec: 5, text: ' a ' }, { sec: 1, text: 'b' }];
    const before = structuredClone(raw);
    parseExportCards(raw);
    expect(raw).toEqual(before);
  });
});
