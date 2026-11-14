// 右の検索の［カードの ♥］と［まとめてコピー］の左の部品（MK9。計画 docs/plan-comment-board-marks.md §4.9）：memo-search.ts の searchCardHearts・cardHeadOf・cardHeartsCopy・cardHeartsCopyNote
import { describe, expect, it, vi } from 'vitest';

// memo-search.ts は memocells.ts（memoTitle・isSpecialCell）を読み、memocells.ts は bridge と data を読む（試験では偽物。card-marks.test.ts と同じ）
vi.mock('../src/bridge', () => ({ surface: 'left', send: () => {}, onMessage: () => {}, request: async () => null }));
vi.mock('../src/data', () => ({
  readData: async () => null,
  readDataChecked: async () => ({ status: 'missing' }),
  writeData: async () => true,
  deleteData: () => {},
  listData: async () => [],
}));

import { likeTag } from '../src/likes';
import { cardLines } from '../src/memo-card-board-view';
import { cardHeadOf, cardHeartsCopy, cardHeartsCopyNote, CARD_HEAD_MAX, HEART_COPY_MAX, searchCardHearts, searchMemos } from '../src/memo-search';
import type { MemoCell } from '../src/memocells';
import type { Reply } from '../src/threads';

const reply = (id: string, createdAt: number, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `${id} の文`, createdAt, ...over });
const memo = (id: string, replies: Reply[], over: Partial<MemoCell> = {}): MemoCell => ({
  id,
  sheet: 'main',
  pos: { q: 0, r: 0 },
  text: `${id} の題\n本文`,
  tags: [],
  liked: 0,
  island: null,
  replies,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});
const heart = (level: 1 | 2 | 3) => [likeTag(level)];
// 読む画面から来た AI のカード（reader-ai-card.ts の形：見出しと「▶ 時刻〔技法〕文」の行。at.kind があれば cardLines は AI の枝）
const AI_TEXT = '見出し\n▶ 0:05〔ボケ〕一つ目\n▶ 1:02 二つ目';
const AI_AT: NonNullable<Reply['at']> = { video: 'v1', spans: [{ key: 'k1', start: 0, end: 70 }], kind: 'tech' };
const ids = (items: { memoId: string; replyId?: string }[]) => items.map((i) => `${i.memoId}/${i.replyId}`);

describe('searchCardHearts：字が空でも ♥ のカードの行を返す', () => {
  const list = [
    memo('A', [
      reply('a1', 100, { tags: heart(1) }),
      reply('a2', 300, { tags: ['ふつう'] }), // ♥ が無い
      reply('a3', 200, { parent: 'a1', tags: heart(3) }), // 返信（一番上のカードでない）は ♥ のタグがあっても出さない
    ]),
    memo('B', [reply('b1', 250, { tags: ['x', likeTag(2)] })]),
  ];
  it('一番上のカードで ♥ のあるものだけ。字が空でも出す（searchMemos は字が空ならメモの行だけ）', () => {
    const found = searchCardHearts(list, { query: '', min: 1, limit: 30 });
    expect(ids(found.items)).toEqual(['B/b1', 'A/a1']);
    expect(found.total).toBe(2);
    expect(searchMemos(list, { query: '', sort: 'created', limit: 30 }).items.every((i) => i.kind === 'memo')).toBe(true);
  });
  it('特別なセル（入口・ボット・アプリ・撮影）は飛ばす', () => {
    const special = [
      memo('P', [reply('p1', 10, { tags: heart(3) })], { portal: 'sheet2' }),
      memo('Q', [reply('q1', 10, { tags: heart(3) })], { bot: 'bot1' }),
      memo('R', [reply('r1', 10, { tags: heart(3) })], { app: 'app1' }),
      memo('S', [reply('s1', 10, { tags: heart(3) })], { capture: 'cap1' }),
      memo('T', [reply('t1', 10, { tags: heart(3) })]),
    ];
    expect(ids(searchCardHearts(special, { query: '', min: 1, limit: 30 }).items)).toEqual(['T/t1']);
  });
  it('段の絞りは「この段以上」（［♥1 以上］［♥2 以上］［♥3］）', () => {
    const tiers = [memo('M', [reply('m1', 1, { tags: heart(1) }), reply('m2', 2, { tags: heart(2) }), reply('m3', 3, { tags: heart(3) })])];
    expect(ids(searchCardHearts(tiers, { query: '', min: 1, limit: 30 }).items)).toEqual(['M/m3', 'M/m2', 'M/m1']);
    expect(ids(searchCardHearts(tiers, { query: '', min: 2, limit: 30 }).items)).toEqual(['M/m3', 'M/m2']);
    expect(ids(searchCardHearts(tiers, { query: '', min: 3, limit: 30 }).items)).toEqual(['M/m3']);
  });
  it('♥ は値の一覧とぴったり同じタグだけを読む（手で付けた「♥:9」「♥2」は読まない）。2 つあれば高い段', () => {
    const odd = [
      memo('M', [
        reply('m1', 1, { tags: ['♥:9'] }),
        reply('m2', 2, { tags: ['♥2'] }),
        reply('m3', 3, { tags: [likeTag(1), likeTag(3)] }),
      ]),
    ];
    const found = searchCardHearts(odd, { query: '', min: 1, limit: 30 });
    expect(ids(found.items)).toEqual(['M/m3']);
    expect(found.items[0].cardLike).toBe(3);
  });
});

describe('searchCardHearts：並びと行の形', () => {
  it('カードを作った時刻の新しい順（書き直しの時刻は見ない）。同じなら memoId・replyId の文字順', () => {
    const list = [
      memo('B', [reply('b2', 50, { tags: heart(1) }), reply('b1', 50, { tags: heart(1) })]),
      memo('A', [reply('a1', 50, { tags: heart(1) }), reply('a0', 10, { tags: heart(1), editedAt: 999 })]),
    ];
    expect(ids(searchCardHearts(list, { query: '', min: 1, limit: 30 }).items)).toEqual(['A/a1', 'B/b1', 'B/b2', 'A/a0']);
  });
  it('行は kind reply・メモの題（40 字）・シート・作った時刻・カードの ♥・文の頭。メモの ♥（liked）は載せない。字が空なら抜き出しは無い', () => {
    const list = [memo('A', [reply('a1', 123, { tags: heart(2), text: '一行目\n二行目', by: { who: 'fable', name: 'フェイブル' } })], { liked: 3, sheet: 'sh1' })];
    const [row] = searchCardHearts(list, { query: '', min: 1, limit: 30 }).items;
    expect(row).toEqual({ kind: 'reply', memoId: 'A', replyId: 'a1', title: 'A の題', sheet: 'sh1', at: 123, by: 'フェイブル', cardLike: 2, cardHead: '一行目 二行目' });
    expect(row).not.toHaveProperty('liked');
    expect(row).not.toHaveProperty('snippet');
  });
  it('画像のメモの題・画像のカードの印。字の無いカード（写真だけ）は文の頭を載せない', () => {
    const list = [memo('A', [reply('a1', 1, { tags: heart(1), text: '', image: 'shot1' })], { text: '', image: 'shot0' })];
    const [row] = searchCardHearts(list, { query: '', min: 1, limit: 30 }).items;
    expect(row.title).toBe('（画像のメモ）');
    expect(row.image).toBe(true);
    expect(row).not.toHaveProperty('cardHead');
  });
});

describe('searchCardHearts：字があれば、その字にも合うもの（今のカードの行と同じ照らし方）', () => {
  const list = [
    memo('A', [
      reply('a1', 4, { tags: heart(1), text: '会議の メモ' }),
      reply('a2', 3, { tags: heart(1), text: '本文', quote: { text: '会議の資料', url: 'https://example.com/', title: '題' } }),
      reply('a3', 2, { tags: heart(1), text: '本文', quote: { text: '引用', url: 'https://example.com/', title: '会議の記録' } }),
      reply('a4', 1, { tags: [likeTag(1), '会議'], text: '本文' }), // タグは照らさない
      reply('a5', 5, { text: '会議' }), // ♥ が無い
    ]),
  ];
  it('文・引用・引用の題名で当たる。カードのタグでは当たらない。♥ の無いカードは字が合っても出さない', () => {
    const found = searchCardHearts(list, { query: '会議', min: 1, limit: 30 });
    expect(ids(found.items)).toEqual(['A/a1', 'A/a2', 'A/a3']);
    expect(found.items.map((i) => i.where)).toEqual(['reply', 'quote', 'quoteTitle']);
    expect(found.items[0].snippet?.text).toBe('会議の メモ');
    expect(found.items[0].cardHead).toBe('会議の メモ'); // 文の頭も運ぶ（右は抜き出しがあれば抜き出しを出す）
  });
  it('語はすべて含む（AND）。全角・半角、カタカナ・ひらがなの違いは今の照らし方のまま', () => {
    expect(ids(searchCardHearts(list, { query: '会議 めも', min: 1, limit: 30 }).items)).toEqual(['A/a1']);
    expect(ids(searchCardHearts(list, { query: '会議 無い語', min: 1, limit: 30 }).items)).toEqual([]);
  });
  it('印の値を字で探しても当たらない（タグは照らさない）', () => {
    expect(searchCardHearts(list, { query: likeTag(1), min: 1, limit: 30 }).total).toBe(0);
  });
});

describe('searchCardHearts：件数', () => {
  const many = [memo('M', Array.from({ length: 320 }, (_, n) => reply(`r${String(n).padStart(3, '0')}`, n, { tags: heart(1) })))];
  it('items は先頭から limit 件（1〜300）、total は絞ったあとの全部の数', () => {
    const found = searchCardHearts(many, { query: '', min: 1, limit: 30 });
    expect(found.items).toHaveLength(30);
    expect(found.total).toBe(320);
    expect(found.items[0].replyId).toBe('r319');
    expect(searchCardHearts(many, { query: '', min: 1, limit: 1000 }).items).toHaveLength(300);
    expect(searchCardHearts(many, { query: '', min: 1, limit: 0 }).items).toHaveLength(1);
    expect(searchCardHearts(many, { query: '', min: 1, limit: Number.NaN }).items).toHaveLength(30);
  });
});

describe('cardHeadOf：行に出すカードの文の頭', () => {
  it('cardLines を空白でつなぎ、40 字で切る（切ったら「…」。コードポイントで数える）', () => {
    expect(cardHeadOf(reply('x', 1, { text: '  一行目  \n\n二行目' }))).toBe('一行目 二行目');
    const long = '😀'.repeat(CARD_HEAD_MAX + 5);
    expect(cardHeadOf(reply('x', 1, { text: long }))).toBe(`${'😀'.repeat(CARD_HEAD_MAX)}…`);
    expect(cardHeadOf(reply('x', 1, { text: 'あ'.repeat(CARD_HEAD_MAX) }))).toBe('あ'.repeat(CARD_HEAD_MAX));
    expect(cardHeadOf(reply('x', 1, { text: '' }))).toBe('');
  });
  it('AI のカード（by と at.kind がある）は見出しと行の文だけ（時刻の行の「▶ 0:05〔技法〕」は落ちる）。at が無ければ字のまま', () => {
    const r = reply('x', 1, { text: AI_TEXT, by: { who: 'fable', name: 'フェイブル' }, at: AI_AT });
    expect(cardLines(r)).toEqual(['見出し', '一つ目', '二つ目']); // AI の枝を通っている
    expect(cardHeadOf(r)).toBe('見出し 一つ目 二つ目');
    const plain = reply('x', 1, { text: AI_TEXT, by: { who: 'fable', name: 'フェイブル' } }); // at が無い：ふつうの枝
    expect(cardHeadOf(plain)).toBe('見出し ▶ 0:05〔ボケ〕一つ目 ▶ 1:02 二つ目');
  });
});

describe('cardHeartsCopy：まとめてコピーの文（左が同じ条件で台帳から組み直す）', () => {
  const list = [
    memo('A', [reply('a1', 10, { tags: heart(2), text: '一行目\n\n  二行目  ' }), reply('a2', 30, { tags: heart(1), text: '', image: 'shot1' })]),
    memo('B', [reply('b1', 20, { tags: heart(3), text: '会議の文' })], { text: 'B の題' }),
    memo('C', [reply('c1', 40, { text: '♥ なし' })]),
  ];
  it('カードごとに「【メモの題】」の行とカードの文（cardLines を改行でつなぐ）。カードの間は空行。新しい順', () => {
    const built = cardHeartsCopy(list, { query: '', min: 1 });
    expect(built.text).toBe('【A の題】\n\n【B の題】\n会議の文\n\n【A の題】\n一行目\n二行目');
    expect(built.count).toBe(3);
    expect(built.total).toBe(3);
  });
  it('字の無いカード（写真だけ）も題の行だけで数える（一覧の件数と合わせる）', () => {
    const built = cardHeartsCopy(list, { query: '', min: 1 });
    expect(built.text.startsWith('【A の題】\n\n')).toBe(true);
  });
  it('一覧と同じ選び：段と字の絞りが同じで、件数が一覧の total と合う', () => {
    for (const [query, min] of [['', 1], ['', 2], ['', 3], ['会議', 1], ['無い語', 1]] as const) {
      const built = cardHeartsCopy(list, { query, min });
      const found = searchCardHearts(list, { query, min, limit: 300 });
      expect(built.count, `${query}:${min}`).toBe(found.total);
      expect(built.text.split('\n\n').filter(Boolean).map((block) => block.split('\n')[0]), `${query}:${min}`).toEqual(found.items.map((i) => `【${i.title}】`));
    }
    expect(cardHeartsCopy(list, { query: '会議', min: 1 }).text).toBe('【B の題】\n会議の文');
  });
  it('AI のカードは見出しと行の文を 1 行ずつ（時刻の印は落ちる）', () => {
    const ai = [memo('A', [reply('a1', 1, { tags: heart(1), text: AI_TEXT, by: { who: 'fable', name: 'フェイブル' }, at: AI_AT })])];
    expect(cardHeartsCopy(ai, { query: '', min: 1 }).text).toBe('【A の題】\n見出し\n一つ目\n二つ目');
  });
  it('引用だけのカード（文が空）は、行の頭が引用の題（無ければ引用の文の最初の行）。コピーは引用の行をボードの「コピー」と同じ形で入れる（主担当の決め。MK9 の見直しのあと）', () => {
    const quoted = [memo('A', [reply('a1', 1, { tags: heart(1), text: '', quote: { text: '引用の文\n二行目', url: 'https://example.com/', title: '引用の題' } })])];
    const [row] = searchCardHearts(quoted, { query: '', min: 1, limit: 30 }).items;
    expect(row.cardHead).toBe('引用の題');
    expect(cardHeartsCopy(quoted, { query: '', min: 1 })).toEqual({ text: '【A の題】\n> 引用の文\n> 二行目\n— [引用の題](https://example.com/)', count: 1, total: 1 });
    const untitled = [memo('A', [reply('a1', 1, { tags: heart(1), text: '', quote: { text: '\n  最初の行  \n次', url: 'https://example.com/', title: ' ' } })])];
    expect(searchCardHearts(untitled, { query: '', min: 1, limit: 30 }).items[0].cardHead).toBe('最初の行');
    expect(cardHeartsCopy(untitled, { query: '', min: 1 }).text).toBe('【A の題】\n> 最初の行  \n> 次\n— [ページ](https://example.com/)');
  });
  it('文と引用のあるカード：行の頭は文。コピーは引用の行のあとに文', () => {
    const both = [memo('A', [reply('a1', 1, { tags: heart(2), text: '私の考え', quote: { text: '引用の文', url: 'https://example.com/', title: '引用の題' } })])];
    expect(searchCardHearts(both, { query: '', min: 1, limit: 30 }).items[0].cardHead).toBe('私の考え');
    expect(cardHeartsCopy(both, { query: '', min: 1 }).text).toBe('【A の題】\n> 引用の文\n— [引用の題](https://example.com/)\n私の考え');
  });
  it('0 件なら空の文', () => {
    expect(cardHeartsCopy(list, { query: '無い語', min: 1 })).toEqual({ text: '', count: 0, total: 0 });
  });
  it('上限 300 件（新しい順の頭から）。total は全部の数', () => {
    const many = [memo('M', Array.from({ length: 305 }, (_, n) => reply(`r${String(n).padStart(3, '0')}`, n, { tags: heart(1), text: `文${n}` })))];
    const built = cardHeartsCopy(many, { query: '', min: 1 });
    expect(built.count).toBe(HEART_COPY_MAX);
    expect(built.total).toBe(305);
    const blocks = built.text.split('\n\n');
    expect(blocks).toHaveLength(300);
    expect(blocks[0]).toBe('【M の題】\n文304');
    expect(blocks[299]).toBe('【M の題】\n文5');
  });
});

describe('cardHeartsCopyNote：一言（計画 §9.2）', () => {
  it('n 件・0 件・300 を超えたとき', () => {
    expect(cardHeartsCopyNote(3, 3)).toBe('3 件をコピーしました');
    expect(cardHeartsCopyNote(300, 300)).toBe('300 件をコピーしました');
    expect(cardHeartsCopyNote(0, 0)).toBe('コピーするカードがありません');
    expect(cardHeartsCopyNote(300, 301)).toBe('新しい 300 件をコピーしました');
  });
});
