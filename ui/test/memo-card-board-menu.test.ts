import { describe, expect, it } from 'vitest';
import {
  cardCopyText,
  cardDate,
  cardFacts,
  cardFullText,
  cardHead,
  cardMenuEntries,
  cardTip,
  confirmListEntries,
  confirmPageEntries,
  confirmVideoEntries,
  MENU_TAG_CANDIDATES,
  readMenuEntries,
  TAG_POOL_CLASS,
  TAG_WRITE_LABEL,
  tagMenuEntries,
  tagMenuPool,
  TIP_TEXT_MAX,
  writtenNeighbors,
  type CardMenuActions,
  type CardMenuInput,
  type TagMenuInput,
} from '../src/memo-card-board-menu';
import type { MenuButton, MenuEntry } from '../src/panels/cell-menu';
import type { Reply } from '../src/threads';

const T = new Date(2026, 10, 2, 9, 5).getTime(); // 11/2 09:05
const reply = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: 'あいうえお', createdAt: T, ...over });

describe('cardDate', () => {
  it('月日は詰めず、時と分は 2 桁（11/2 09:05）', () => {
    expect(cardDate(T)).toBe('11/2 09:05');
    expect(cardDate(new Date(2026, 0, 15, 0, 7).getTime())).toBe('1/15 00:07');
  });
});

describe('cardFacts', () => {
  it('人のカード：あなた · 日時 · 字数（文の字数に合わせる）', () => {
    const r = reply('a', { text: 'あいうえおかきくけこさし' }); // 12 字
    expect(cardFacts([r], r)).toBe('あなた · 11/2 09:05 · 12 字');
  });

  it('AI のカード・返信 2・関連 1・引用あり：相棒 · 日時 · 字数 · 返信 · 関連 · ドメイン', () => {
    const ai = reply('r1', {
      by: { who: 'main', name: '相棒' },
      quote: { text: '引用の文', url: 'https://example.com/page', title: '題' },
      links: [{ to: 'r2', kind: 'next' }],
    });
    const replies: Reply[] = [ai, reply('r2'), reply('r3', { parent: 'r1' }), reply('r4', { parent: 'r1' })];
    expect(cardFacts(replies, ai)).toBe('相棒 · 11/2 09:05 · 5 字 · 返信 2 · 関連 1 · example.com');
  });

  it('引用の url が壊れている：ドメインだけ出ない。例外にならない', () => {
    const r = reply('q', { text: '本文', quote: { text: '引用', url: 'not a url', title: '題' } });
    expect(cardFacts([r], r)).toBe('あなた · 11/2 09:05 · 2 字');
  });

  it('AI の名前が空白だけなら AI', () => {
    const r = reply('s', { text: 'あ', by: { who: 'main', name: '  ' } });
    expect(cardFacts([r], r)).toBe('AI · 11/2 09:05 · 1 字');
  });

  it('文の無い画像のカード：字数の項目が出ない', () => {
    const r = reply('i', { text: '', image: 'shot1' });
    expect(cardFacts([r], r)).toBe('あなた · 11/2 09:05');
  });
});

describe('cardTip', () => {
  it('文の字数が 400 字ちょうどなら切らない', () => {
    const r = reply('b', { text: 'あ'.repeat(TIP_TEXT_MAX) });
    expect(cardTip([r], r)).toBe(`${'あ'.repeat(TIP_TEXT_MAX)}\nあなた · 11/2 09:05 · 400 字`);
  });

  it('401 字の文は 400 字＋… になり、2 行目が事実', () => {
    const r = reply('L', { text: 'あ'.repeat(401) });
    const lines = cardTip([r], r).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`${'あ'.repeat(TIP_TEXT_MAX)}…`);
    expect(lines[1]).toBe('あなた · 11/2 09:05 · 401 字');
  });

  it('複数行の文は改行でつなぐ（空の行は捨てる）', () => {
    const r = reply('m', { text: '一行目\n\n二行目' });
    expect(cardTip([r], r)).toBe('一行目\n二行目\nあなた · 11/2 09:05 · 8 字');
  });

  it('文が無い画像のカード：1 行目は（画像）', () => {
    const r = reply('i', { text: '', image: 'shot1' });
    expect(cardTip([r], r)).toBe('（画像）\nあなた · 11/2 09:05');
  });

  it('文が無いときは引用の文、次に引用の題、どれも無ければ（空）', () => {
    const withQuoteText = reply('x', { text: '', quote: { text: '引用の文', url: 'https://example.com', title: '題' } });
    expect(cardTip([withQuoteText], withQuoteText).split('\n')[0]).toBe('引用の文');
    const withTitle = reply('y', { text: '', quote: { text: '', url: 'https://example.com', title: '題' } });
    expect(cardTip([withTitle], withTitle).split('\n')[0]).toBe('題');
    const empty = reply('z', { text: '' });
    expect(cardTip([empty], empty).split('\n')[0]).toBe('（空）');
  });

  it('読む画面の AI のカード（by と at.kind）：説明に時刻の字が出ない', () => {
    const ai = reply('t', {
      text: 'AI のカード\n▶ 0:12〔ボケ〕一つ目\n▶ 1:05 二つ目',
      by: { who: 'main', name: '相棒' },
      at: { video: 'v1', spans: [{ key: 'k1', start: 12, end: 20 }], kind: 'bones' },
    });
    const tip = cardTip([ai], ai);
    expect(tip).not.toContain('0:12');
    expect(tip).not.toContain('1:05');
    expect(tip).not.toContain('▶');
    expect(tip).toBe(`AI のカード\n一つ目\n二つ目\n${cardFacts([ai], ai)}`);
  });
});

// 押した名前を記録する偽物の動き
function fakeActions(): { calls: string[]; actions: CardMenuActions } {
  const calls: string[] = [];
  const rec = (name: string) => (r?: Reply) => {
    calls.push(r ? `${name}:${r.id}` : name);
  };
  return {
    calls,
    actions: { page: rec('page'), video: rec('video'), capture: rec('capture'), list: rec('list'), cell: rec('cell'), read: rec('read'), hop: rec('hop'), copy: rec('copy'), pin: rec('pin'), back: rec('back'), edit: rec('edit'), link: rec('link'), tags: rec('tags'), template: rec('template') },
  };
}

// 入力（テストごとに変える所だけ over で渡す）
const menuInput = (replies: Reply[], id: string, actions: CardMenuActions, over: Partial<CardMenuInput> = {}): CardMenuInput => ({
  replies,
  id,
  upper: false,
  other: false,
  actions,
  ...over,
});

// 項目の並びを短い形にする（種類と文だけ）
function shape(entries: MenuEntry[]): string[] {
  return entries.map((e) => {
    if (e === 'sep') return '―';
    if ('section' in e) return `[${e.section}]`;
    if ('row' in e) return `行:${e.row}`;
    if ('note' in e) return '囲み';
    if ('picture' in e) return '絵';
    if ('pills' in e) return '札';
    return `項目:${e.label}`;
  });
}

// 押せる項目の動き（押せない項目なら失敗）
function runOf(entry: MenuEntry | undefined): () => void {
  if (!entry || entry === 'sep' || !('run' in entry) || !entry.run) throw new Error('押せる項目ではない');
  return entry.run;
}

// 行の段のボタン（名前の行が無ければ失敗）
function rowButtons(entries: MenuEntry[], row: string): MenuButton[] {
  for (const e of entries) {
    if (e !== 'sep' && 'row' in e && e.row === row && 'buttons' in e) return e.buttons;
  }
  throw new Error(`行「${row}」が無い`);
}

const labelsOf = (buttons: MenuButton[]) => buttons.map((b) => b.label);

describe('cardHead', () => {
  it('人のカード：あなた · 日時 · 字数', () => {
    expect(cardHead(reply('a', { text: 'あいうえお' }))).toBe('あなた · 11/2 09:05 · 5 字');
  });

  it('AI（型番と 0.012 ドル）と書き直し済み', () => {
    const ai = reply('h', { text: 'あい', by: { who: 'main', name: '相棒', model: 'model-x', cost: 0.012 }, editedAt: T + 60_000 });
    expect(cardHead(ai)).toBe('相棒 · 11/2 09:05 · 2 字 · model-x · 約 $0.012 · 書き直し済み');
  });

  it('料金が 0 のときは出さない', () => {
    const ai = reply('z', { text: 'あ', by: { who: 'main', name: '相棒', cost: 0 } });
    expect(cardHead(ai)).toBe('相棒 · 11/2 09:05 · 1 字');
  });
});

describe('cardFullText', () => {
  it('引用・本文・返信（返信の返信も作った順）を ── でつなぐ', () => {
    const top = reply('t', { text: '本文', quote: { text: '引用の文', url: 'https://example.com', title: '題' } });
    const r1 = reply('r1', { parent: 't', text: '一つ目', createdAt: T + 2000 });
    const r0 = reply('r0', { parent: 't', text: '先', createdAt: T + 1000 });
    const r2 = reply('r2', { parent: 'r1', text: '二つ目', createdAt: T + 3000, by: { who: 'main', name: '相棒' } });
    expect(cardFullText([top, r1, r2, r0], top)).toBe('❝ 引用の文\n──\n本文\n──\n💬 あなた：先\n💬 あなた：一つ目\n💬 相棒：二つ目');
  });

  it('読む画面の AI のカードは時刻の字を出さず（▶ も付けず）、技法を〔〕で残す', () => {
    const ai = reply('t', {
      text: 'AI のカード\n▶ 0:12〔ボケ〕一つ目\n▶ 1:05 二つ目',
      by: { who: 'main', name: '相棒' },
      at: { video: 'v1', spans: [{ key: 'k1', start: 12, end: 20 }], kind: 'bones' },
    });
    const full = cardFullText([ai], ai);
    expect(full).toBe('AI のカード\n0:12〔ボケ〕一つ目\n1:05 二つ目');
    expect(full).not.toContain('▶');
  });

  it('画像だけのカードは空', () => {
    const im = reply('i', { text: '', image: 'shot1' });
    expect(cardFullText([im], im)).toBe('');
  });
});

describe('cardCopyText', () => {
  it('引用の文（> ）・出どころ・本文・返信（- ）の行を改行でつなぐ', () => {
    const top = reply('t', { text: '本文\n二行目', quote: { text: '引用\n二行', url: 'https://example.com/p', title: ' 題 ' } });
    const r1 = reply('r1', { parent: 't', text: '返信\n改行', createdAt: T + 1000 });
    expect(cardCopyText([top, r1], top)).toBe('> 引用\n> 二行\n— [題](https://example.com/p)\n本文\n二行目\n- 返信 改行');
  });

  it('題名が空なら「ページ」', () => {
    const top = reply('t', { text: '', quote: { text: '', url: 'https://example.com/p', title: '  ' } });
    expect(cardCopyText([top], top)).toBe('— [ページ](https://example.com/p)');
  });
});

describe('writtenNeighbors', () => {
  it('先頭・中・末尾。同じ時刻は id の順。返信は数えない', () => {
    const m = reply('m', { createdAt: T });
    const b = reply('b', { createdAt: T }); // 同じ時刻なので id の順（b が先）
    const e = reply('e', { createdAt: T + 1000 });
    const under = reply('x', { parent: 'm', createdAt: T - 5000 }); // 返信。数えるなら一番前になる
    const list = [m, b, e, under];
    expect(writtenNeighbors(list, 'b')).toEqual({ prev: null, next: m });
    expect(writtenNeighbors(list, 'm')).toEqual({ prev: b, next: e });
    expect(writtenNeighbors(list, 'e')).toEqual({ prev: m, next: null });
    expect(writtenNeighbors(list, 'x')).toEqual({ prev: null, next: null });
    expect(writtenNeighbors(list, 'nope')).toEqual({ prev: null, next: null });
  });
});

describe('cardMenuEntries', () => {
  it('ふつうのカード：行くは下の一覧とセルだけ。囲みに scroll', () => {
    const { actions, calls } = fakeActions();
    const o = reply('o', { text: '本文' });
    const es = cardMenuEntries(menuInput([o], 'o', actions));
    expect(shape(es)).toEqual(['[あなた · 11/2 09:05 · 2 字]', '囲み', '行:行く', '行:編集', '行:']);
    expect(es[1]).toEqual({ note: '本文', scroll: true });
    expect(labelsOf(rowButtons(es, '行く'))).toEqual(['メモのタブで見る', 'セル']);
    rowButtons(es, '行く')[1].run();
    expect(calls).toEqual(['cell']);
  });

  it('引用のカード：↗ が出る。上に出しているときは close が false で、title に「下に戻して」', () => {
    const { actions, calls } = fakeActions();
    const q = reply('q', { text: '本文', quote: { text: '引用の文', url: 'https://example.com/page', title: '題' } });
    const down = rowButtons(cardMenuEntries(menuInput([q], 'q', actions)), '行く')[0];
    expect(down.label).toBe('↗ example.com');
    expect(down.title).toBe('↗ 題（example.com）');
    expect(down.close).toBe(true);
    const up = rowButtons(cardMenuEntries(menuInput([q], 'q', actions, { upper: true })), '行く')[0];
    expect(up.close).toBe(false);
    expect(up.title).toBe('↗ 題（example.com）（下に戻して開きます）');
    down.run();
    expect(calls).toEqual(['page:q']);
  });

  it('引用の url が ftp: なら ↗ は出ない', () => {
    const { actions } = fakeActions();
    const f = reply('f', { text: '本文', quote: { text: '', url: 'ftp://example.com/x', title: '題' } });
    expect(labelsOf(rowButtons(cardMenuEntries(menuInput([f], 'f', actions)), '行く'))).toEqual(['メモのタブで見る', 'セル']);
  });

  it('動画のカード：▶ 3:04 ほか 1。押すと読む画面の時刻', () => {
    const { actions, calls } = fakeActions();
    const v = reply('v', { text: '本文', at: { video: 'v1', title: '動画の題', spans: [{ key: 'k1', start: 184, end: 190 }, { key: 'k2', start: 300, end: 310 }] } });
    const b = rowButtons(cardMenuEntries(menuInput([v], 'v', actions)), '行く')[0];
    expect(b.label).toBe('▶ 3:04 ほか 1');
    expect(b.title).toBe('動画の題');
    expect(b.close).toBe(true);
    b.run();
    expect(calls).toEqual(['video:v']);
  });

  it('画像のカード：撮影へ。絵の項目は picture を渡したときだけ', () => {
    const { actions, calls } = fakeActions();
    const im = reply('i', { text: '', image: 'shot1' });
    const bare = cardMenuEntries(menuInput([im], 'i', actions));
    expect(shape(bare)).toEqual(['[あなた · 11/2 09:05]', '行:行く', '行:編集', '行:']);
    expect(labelsOf(rowButtons(bare, '行く'))).toEqual(['撮影へ', 'メモのタブで見る', 'セル']);
    expect(labelsOf(rowButtons(bare, '編集'))).toEqual(['書き直す', '関連線を足す', 'タグを足す…', '型を足す…']); // 文の無い画像のカードも、人のカードなので書き直せる
    const shot = rowButtons(bare, '行く')[0];
    expect(shot.close).toBe(true);
    shot.run();
    expect(calls).toEqual(['capture:i']);
    const withPic = cardMenuEntries(menuInput([im], 'i', actions, { picture: 'data:image/png;base64,AA' }));
    expect(withPic[1]).toEqual({ picture: 'data:image/png;base64,AA', alt: 'カードの画像' });
  });

  it('下の一覧の文は三通り（別のメモ・上・下）', () => {
    const { actions, calls } = fakeActions();
    const o = reply('o', { text: '本文' });
    const other = rowButtons(cardMenuEntries(menuInput([o], 'o', actions, { other: true })), '行く')[0];
    expect(other.label).toBe('下の一覧（替える）');
    expect(other.title).toBe('下の区画もこのメモに替えて、そのカードへ移ります');
    expect(other.close).toBe(false);
    const up = rowButtons(cardMenuEntries(menuInput([o], 'o', actions, { upper: true })), '行く')[0];
    expect(up.label).toBe('下の一覧');
    expect(up.title).toBe('下の一覧のそのカードへ移ります');
    expect(up.close).toBe(true);
    const down = rowButtons(cardMenuEntries(menuInput([o], 'o', actions)), '行く')[0];
    expect(down.label).toBe('メモのタブで見る');
    other.run();
    expect(calls).toEqual(['list:o']);
  });

  it('関連 6 本：5 行と「ほかに 1 本」。出る線・来る線・同じの文。読む・移るが read・hop を呼ぶ', () => {
    const { actions, calls } = fakeActions();
    const c = reply('c', {
      text: '中心',
      links: [
        { to: 'a', kind: 'ground' },
        { to: 'b', kind: 'same' },
        { to: 'd', kind: 'next' },
        { to: 'e', kind: 'counter' },
      ],
    });
    const replies: Reply[] = [
      c,
      reply('a', { text: 'ア' }),
      reply('b', { text: 'イ' }),
      reply('d', { text: 'ウ' }),
      reply('e', { text: 'エ' }),
      reply('g', { text: 'グ', links: [{ to: 'c', kind: 'ground' }] }), // 来る線（根拠）
      reply('h', { text: 'ホ', links: [{ to: 'c', kind: 'ask' }] }), // 来る線（疑問）。6 本目なので「ほかに」へ
    ];
    const es = cardMenuEntries(menuInput(replies, 'c', actions));
    expect(shape(es)).toEqual([
      '[あなた · 11/2 09:05 · 2 字]',
      '囲み',
      '行:行く',
      '行:これは「ア」の根拠',
      '行:これと「イ」は同じ',
      '行:これは「ウ」の続き',
      '行:これは「エ」の反論',
      '行:「グ」はこれの根拠',
      '[ほかに 1 本]',
      '行:書いた順',
      '行:編集',
      '行:',
    ]);
    const ground = rowButtons(es, 'これは「ア」の根拠');
    expect(labelsOf(ground)).toEqual(['読む', '移る']);
    ground[0].run();
    ground[1].run();
    rowButtons(es, '「グ」はこれの根拠')[1].run();
    expect(calls).toEqual(['read:a', 'hop:a', 'hop:g']);
  });

  it('書いた順の段：前と後ろのボタン（同じ時刻は id の順）', () => {
    const { actions, calls } = fakeActions();
    const o = reply('o', { text: '中間' });
    const before = reply('a', { text: '前の文' });
    const after = reply('z', { text: '後の文' });
    const es = cardMenuEntries(menuInput([o, before, after], 'o', actions));
    const nav = rowButtons(es, '書いた順');
    expect(labelsOf(nav)).toEqual(['← 前の文', '後の文 →']);
    expect(nav[0].title).toBe('前に書いた：前の文');
    nav[0].run();
    nav[1].run();
    expect(calls).toEqual(['hop:a', 'hop:z']);
  });

  it('移ってきたカードは先頭に「← 元のカードへ」（hint は元の題）', () => {
    const { actions, calls } = fakeActions();
    const o = reply('o', { text: '本文' });
    const back = reply('p', { text: '元の文' });
    const es = cardMenuEntries(menuInput([o], 'o', actions, { from: back }));
    expect(es[0]).toMatchObject({ label: '← 元のカードへ', hint: '元の文' });
    runOf(es[0])();
    expect(calls).toEqual(['back']);
  });

  it('📌 は上に出しているときだけ出す。押すと pin を呼ぶ', () => {
    const { actions, calls } = fakeActions();
    const o = reply('o', { text: '本文' });
    expect(labelsOf(rowButtons(cardMenuEntries(menuInput([o], 'o', actions)), ''))).toEqual(['コピー']);
    const upper = rowButtons(cardMenuEntries(menuInput([o], 'o', actions, { upper: true })), '');
    expect(labelsOf(upper)).toEqual(['📌 留める', 'コピー']);
    expect(upper[0].close).toBe(true);
    upper[0].run();
    expect(calls).toEqual(['pin:o']);
  });

  it('編集の行：書き直す・関連線を足す・タグを足す…・型を足す…の順。title と close。押すと edit・link・tags を呼ぶ', () => {
    const { actions, calls } = fakeActions();
    const o = reply('o', { text: '本文' });
    const edit = rowButtons(cardMenuEntries(menuInput([o], 'o', actions)), '編集');
    expect(edit.map((b) => ({ label: b.label, title: b.title, close: b.close }))).toEqual([
      { label: '書き直す', title: 'このカードの文を、書く欄で書き直します（F2 と同じ）', close: true },
      { label: '関連線を足す', title: 'このカードから線を引きます。次に相手のカードを左で押すと、種類を選べます', close: true },
      { label: 'タグを足す…', title: 'このカードにタグを足します', close: false },
      { label: '型を足す…', title: 'このカードの右と下に、型のカードを足します', close: false },
    ]);
    for (const b of edit) b.run();
    expect(calls).toEqual(['edit:o', 'link:o', 'tags:o', 'template:o']);
  });

  it('編集の行は折り返す。上に出しているとき・別のメモ・移ってきたカードでも同じ所（書いた順のあと、📌・コピーの前）に出る', () => {
    const { actions } = fakeActions();
    const o = reply('o', { text: '本文' });
    const es = cardMenuEntries(menuInput([o], 'o', actions));
    expect(es.find((e) => e !== 'sep' && 'row' in e && e.row === '編集')).toMatchObject({ row: '編集', wrap: true });
    const up = cardMenuEntries(menuInput([o], 'o', actions, { upper: true, other: true, from: reply('p', { text: '元の文' }) }));
    expect(shape(up)).toEqual(['項目:← 元のカードへ', '[あなた · 11/2 09:05 · 2 字]', '囲み', '行:行く', '行:編集', '行:']);
    expect(labelsOf(rowButtons(up, '編集'))).toEqual(['書き直す', '関連線を足す', 'タグを足す…', '型を足す…']);
  });

  it('AI のカード：書き直すは出さない（関連線を足す・タグを足す…・型を足す…だけ）', () => {
    const { actions, calls } = fakeActions();
    const ai = reply('a', { text: 'AI の文', by: { who: 'main', name: '相棒' } });
    const edit = rowButtons(cardMenuEntries(menuInput([ai], 'a', actions)), '編集');
    expect(labelsOf(edit)).toEqual(['関連線を足す', 'タグを足す…', '型を足す…']);
    edit[0].run();
    expect(calls).toEqual(['link:a']);
  });

  it('消えたカードは、段を一つだけ出す', () => {
    const { actions } = fakeActions();
    expect(cardMenuEntries(menuInput([], 'x', actions))).toEqual([{ section: 'このカードは、もうありません' }]);
    expect(cardMenuEntries(menuInput([], 'x', actions, { from: reply('p', { text: 'あ' }) }))).toEqual([{ section: 'このカードは、もうありません' }]);
  });
});

describe('readMenuEntries', () => {
  it('読む段：先頭は「← 戻る」、行くの先頭は［移る］。関連・書いた順・コピーは無い', () => {
    const { actions, calls } = fakeActions();
    const c = reply('c', { text: '中心', links: [{ to: 'a', kind: 'ground' }] });
    const es = readMenuEntries(menuInput([c, reply('a', { text: 'ア' }), reply('z', { text: 'ゼ' })], 'c', actions));
    expect(shape(es)).toEqual(['項目:← 戻る', '[あなた · 11/2 09:05 · 2 字]', '囲み', '行:行く']);
    expect(labelsOf(rowButtons(es, '行く'))).toEqual(['移る', 'メモのタブで見る', 'セル']);
    rowButtons(es, '行く')[0].run();
    runOf(es[0])();
    expect(calls).toEqual(['hop:c', 'back']);
  });
});

describe('tagMenuPool（タグの段の候補）', () => {
  it('付いているものを除き、順を保つ', () => {
    expect(tagMenuPool(['甲', '乙', '丙', '丁'], ['甲', '丙'])).toEqual(['乙', '丁']);
    expect(tagMenuPool(['丁', '乙', '甲'], [])).toEqual(['丁', '乙', '甲']);
    expect(tagMenuPool([], ['甲'])).toEqual([]);
  });

  it(`先頭から ${MENU_TAG_CANDIDATES} 個まで（付いているものを除いたあとで数える）`, () => {
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(MENU_TAG_CANDIDATES).toBe(12);
    expect(tagMenuPool(many, ['t0', 't1'])).toEqual(many.slice(2, 14));
  });
});

describe('tagMenuEntries（タグの段）', () => {
  // 押した名前を記録する入力（候補の pool はテストごとに渡す）
  function tagInput(replies: Reply[], id: string, pool: string[]): { calls: string[]; input: TagMenuInput } {
    const calls: string[] = [];
    return {
      calls,
      input: { replies, id, pool, back: () => calls.push('back'), add: (tag) => calls.push(`add:${tag}`), write: () => calls.push('write') },
    };
  }
  // 候補のボタンの見た目と閉じ方
  const looks = (buttons: MenuButton[]) => buttons.map((b) => ({ label: b.label, title: b.title, close: b.close, pressed: b.pressed }));

  it('並び：← 戻る → 見出し（カードの短い名前）→ 候補 → ［新しいタグを書く…］→ いちばん下に付いているタグ。候補は押しても段を閉じない。押すとそのタグを足す', () => {
    const t = reply('t', { text: 'タグを付けるカードの文です', tags: ['甲', '丙'] });
    const { calls, input } = tagInput([t], 't', tagMenuPool(['甲', '乙', '丙', '丁'], ['甲', '丙']));
    const es = tagMenuEntries(input);
    expect(shape(es)).toEqual(['項目:← 戻る', '[「タグを付けるカードの文で…」にタグを足す]', '行:候補', '項目:新しいタグを書く…', '囲み']);
    expect(es[4]).toEqual({ note: '付いているタグ：甲、丙' });
    expect(es[2]).toMatchObject({ row: '候補', wrap: true, className: TAG_POOL_CLASS });
    expect(TAG_POOL_CLASS).toBe('memo-board-tagpool'); // grok-cards.css の、押された印を太字にしない決まりと同じ名前
    const picks = rowButtons(es, '候補');
    expect(looks(picks)).toEqual([
      { label: '乙', title: 'タグ「乙」を付けます', close: false, pressed: false },
      { label: '丁', title: 'タグ「丁」を付けます', close: false, pressed: false },
    ]);
    expect(TAG_WRITE_LABEL).toBe('新しいタグを書く…');
    expect(es[3]).toMatchObject({ label: TAG_WRITE_LABEL, hint: 'Enter で付ける' });
    picks[1].run();
    runOf(es[3])();
    runOf(es[0])();
    expect(calls).toEqual(['add:丁', 'write', 'back']);
  });

  it('pool の全部を順のまま出す。もう付いているものは同じ所に同じ名前で、押された印（pressed: true・このカードに付いています・閉じない）で、押しても add を呼ばない。付いていないものは pressed: false（字を替えないので幅が変わらない）', () => {
    const t = reply('t', { text: '本文', tags: ['乙'] });
    const { calls, input } = tagInput([t], 't', ['丁', '乙', '甲']);
    const picks = rowButtons(tagMenuEntries(input), '候補');
    expect(looks(picks)).toEqual([
      { label: '丁', title: 'タグ「丁」を付けます', close: false, pressed: false },
      { label: '乙', title: 'このカードに付いています', close: false, pressed: true },
      { label: '甲', title: 'タグ「甲」を付けます', close: false, pressed: false },
    ]);
    picks[1].run();
    expect(calls).toEqual([]);
    picks[2].run();
    expect(calls).toEqual(['add:甲']);
  });

  it('タグが増えても、候補の行と書く項目までの形とボタンの位置は同じ（増えるのは、いちばん下の付いているタグの囲みだけ）', () => {
    const pool = ['甲', '乙', '丙'];
    const before = tagMenuEntries(tagInput([reply('t', { text: '本文' })], 't', pool).input);
    const after = tagMenuEntries(tagInput([reply('t', { text: '本文', tags: ['乙'] })], 't', pool).input);
    const more = tagMenuEntries(tagInput([reply('t', { text: '本文', tags: ['乙', '丙'] })], 't', pool).input);
    expect(shape(before)).toEqual(['項目:← 戻る', '[「本文」にタグを足す]', '行:候補', '項目:新しいタグを書く…']);
    expect(shape(after)).toEqual([...shape(before), '囲み']);
    expect(shape(more)).toEqual(shape(after));
    // 名前は変わらない（ボタンの幅が変わらず、後ろの候補がずれない）。変わるのは押された印だけ
    expect(labelsOf(rowButtons(before, '候補'))).toEqual(['甲', '乙', '丙']);
    expect(labelsOf(rowButtons(after, '候補'))).toEqual(['甲', '乙', '丙']);
    expect(labelsOf(rowButtons(more, '候補'))).toEqual(['甲', '乙', '丙']);
    expect(rowButtons(before, '候補').map((b) => b.pressed)).toEqual([false, false, false]);
    expect(rowButtons(after, '候補').map((b) => b.pressed)).toEqual([false, true, false]);
    expect(rowButtons(more, '候補').map((b) => b.pressed)).toEqual([false, true, true]);
    expect(more[4]).toEqual({ note: '付いているタグ：乙、丙' });
  });

  it('タグが無いカード：付いているタグの囲みは出さない。pool が空なら候補の行も出さず、書く項目だけ', () => {
    const t = reply('t', { text: '本文' });
    expect(shape(tagMenuEntries(tagInput([t], 't', []).input))).toEqual(['項目:← 戻る', '[「本文」にタグを足す]', '項目:新しいタグを書く…']);
    const tagged = reply('t', { text: '本文', tags: ['甲'] });
    expect(shape(tagMenuEntries(tagInput([tagged], 't', tagMenuPool(['甲'], ['甲'])).input))).toEqual(['項目:← 戻る', '[「本文」にタグを足す]', '項目:新しいタグを書く…', '囲み']);
  });

  it('機械のタグ（宛て:など）は、付いているタグの囲みに出さない', () => {
    const t = reply('t', { text: '本文', tags: ['宛て:相棒', '甲'] });
    expect(tagMenuEntries(tagInput([t], 't', []).input)[3]).toEqual({ note: '付いているタグ：甲' });
  });

  it('上限（10 個）のカード：上限の一言と付いているタグだけで、候補の行と書く項目は出さない', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `k${i}`);
    const t = reply('t', { text: '本文', tags: ten });
    const es = tagMenuEntries(tagInput([t], 't', ['新']).input);
    expect(shape(es)).toEqual(['項目:← 戻る', '[「本文」にタグを足す]', '囲み', '囲み']);
    expect(es[2]).toEqual({ note: 'タグは 1 つに 10 個までです。ほかのタグを外してから付けてください' });
    expect(es[3]).toEqual({ note: `付いているタグ：${ten.join('、')}` });
  });

  it('上限の手前（見えるタグ 9 個）：候補の行と［新しいタグを書く…］が出る。上限の一言は出ない', () => {
    const nine = Array.from({ length: 9 }, (_, i) => `k${i}`);
    const t = reply('t', { text: '本文', tags: nine });
    const es = tagMenuEntries(tagInput([t], 't', ['新']).input);
    expect(shape(es)).toEqual(['項目:← 戻る', '[「本文」にタグを足す]', '行:候補', '項目:新しいタグを書く…', '囲み']);
    expect(es[4]).toEqual({ note: `付いているタグ：${nine.join('、')}` });
    expect(labelsOf(rowButtons(es, '候補'))).toEqual(['新']);
  });

  it('機械のタグを含めて 10 個（宛て:相棒 と k0〜k8）：上限の一言と付いているタグの囲み（機械のタグは除く）だけ。候補の行と書く項目は出ない', () => {
    const tags = ['宛て:相棒', ...Array.from({ length: 9 }, (_, i) => `k${i}`)];
    const t = reply('t', { text: '本文', tags });
    const es = tagMenuEntries(tagInput([t], 't', ['新']).input);
    expect(shape(es)).toEqual(['項目:← 戻る', '[「本文」にタグを足す]', '囲み', '囲み']);
    expect(es[2]).toEqual({ note: 'タグは 1 つに 10 個までです。ほかのタグを外してから付けてください' });
    expect(es[3]).toEqual({ note: `付いているタグ：${tags.slice(1).join('、')}` });
  });

  it('機械のタグ（宛て:相棒）だけのカード：付いているタグの囲みは出ない', () => {
    const t = reply('t', { text: '本文', tags: ['宛て:相棒'] });
    expect(shape(tagMenuEntries(tagInput([t], 't', ['甲']).input))).toEqual(['項目:← 戻る', '[「本文」にタグを足す]', '行:候補', '項目:新しいタグを書く…']);
  });

  it('消えたカード・返信の id は、段を一つだけ出す', () => {
    expect(tagMenuEntries(tagInput([], 'x', ['甲']).input)).toEqual([{ section: 'このカードは、もうありません' }]);
    const under = reply('u', { parent: 't' });
    expect(tagMenuEntries(tagInput([reply('t'), under], 'u', ['甲']).input)).toEqual([{ section: 'このカードは、もうありません' }]);
  });
});

describe('確かめの段（confirm）', () => {
  it('ページ：項目の文。下に戻して開くとやめるの run', () => {
    let n = 0;
    const run = () => {
      n += 1;
    };
    const q = reply('q', { quote: { text: '', url: 'https://example.com/a', title: '題' } });
    const es = confirmPageEntries(q, run);
    expect(shape(es)).toEqual(['[ページはボードの裏に隠れています]', '囲み', '項目:下に戻して開く', '項目:やめる']);
    expect(es[1]).toEqual({ note: '上に出している間はページが見えません。ボードを下に戻してからページを開きます。\n↗ 題（example.com）' });
    runOf(es[2])();
    expect(n).toBe(1);
    runOf(es[3])();
    expect(n).toBe(1);
  });

  it('動画：項目の文。下に戻して開くで run が呼ばれる', () => {
    let n = 0;
    const es = confirmVideoEntries(() => {
      n += 1;
    });
    expect(shape(es)).toEqual(['[読む画面はボードの裏に開きます]', '囲み', '項目:下に戻して開く', '項目:やめる']);
    expect(es[1]).toEqual({ note: 'ボードを下に戻してから読む画面を開きます。' });
    runOf(es[2])();
    expect(n).toBe(1);
  });

  it('一覧：項目の文。替えて見るで run が呼ばれる', () => {
    let n = 0;
    const es = confirmListEntries('題のメモ', () => {
      n += 1;
    });
    expect(shape(es)).toEqual(['[下の一覧は別のメモです]', '囲み', '項目:下の区画もこのメモに替えて見る', '項目:やめる']);
    expect(es[1]).toEqual({ note: '下の区画を「題のメモ」に替えてから、そのカードへ移ります。下に書きかけがあるときは替えません。' });
    runOf(es[2])();
    expect(n).toBe(1);
  });
});
