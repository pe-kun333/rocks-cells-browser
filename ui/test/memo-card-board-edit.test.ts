import { describe, expect, it } from 'vitest';
import { BOARD_CARD, BOARD_LIMITS, DEFAULT_VIEW, emptyBoard } from '../src/memo-card-board';
import {
  addBlockedNote,
  addCommand,
  cardAppeared,
  cardsGone,
  cardTextIs,
  deleteCommands,
  deleteLabel,
  deleteTitle,
  editCheck,
  editCommand,
  kindChoices,
  linkAddPlan,
  linkIs,
  linkRemoveCommand,
  liveSelection,
  makeReplyId,
  relationsOf,
  SPOT_RINGS,
  spotForNewCard,
  tagCommands,
  tagFullCount,
  templateBlockedNote,
  templateOffsets,
  toolState,
  unionTags,
} from '../src/memo-card-board-edit';
import type { LoadBoardResult } from '../src/memo-card-board-store';
import { MAX_LINKS_PER_CARD } from '../src/memo-card-links';
import { buildTemplateFromCards } from '../src/memo-card-templates';
import { MAX_REPLIES, REPLY_ID_RE, type Reply } from '../src/threads';

const card = (id: string, over: Partial<Reply> = {}): Reply => ({ id, parent: null, text: `カード ${id}`, createdAt: 100, ...over });
const okLoad: LoadBoardResult = { state: 'missing', memoId: 'm1', board: emptyBoard('m1', 0), dropped: 0, raw: null, backupNeeded: false };
const view = (zoom = 1, x = 0, y = 0) => ({ x, y, zoom });
const vp = { w: 600, h: 400 };

describe('選びの整理', () => {
  it('台帳の一番上のカードだけ残す（返信・消えたカード・重なりは除く）。順は選んだ順', () => {
    const rs = [card('a'), card('b'), card('c', { parent: 'a' })];
    expect(liveSelection(rs, ['b', 'c', 'zz', 'a', 'b'])).toEqual(['b', 'a']);
    expect(liveSelection(rs, [])).toEqual([]);
  });
});

describe('カードを足す', () => {
  it('足せない：読み込み中・読めないボード・300 件。足せる：ファイルが無い・読めた', () => {
    expect(addBlockedNote(null, [])).toContain('読み込み中');
    expect(addBlockedNote({ state: 'unreadable', memoId: 'm1', why: 'version' }, [])).toContain('新しい版');
    expect(addBlockedNote({ state: 'unreadable', memoId: 'm1', why: 'version' }, [])).toContain('書き込みません');
    expect(addBlockedNote(okLoad, [])).toBeNull();
    const full = Array.from({ length: MAX_REPLIES }, (_, i) => card(`c${i}`));
    expect(addBlockedNote(okLoad, full)).toContain(`${MAX_REPLIES}`);
    expect(addBlockedNote(okLoad, full.slice(0, MAX_REPLIES - 1))).toBeNull();
  });
  it('id：newReplyId の形で、台帳にまだ無いもの。重なったら作り直す。作れなければ null', () => {
    const id = makeReplyId([card('a')]);
    expect(id).not.toBeNull();
    expect(REPLY_ID_RE.test(id ?? '')).toBe(true);
    let n = 0;
    const seq = () => ['a', 'a', 'b', 'fresh'][n++] ?? 'x';
    expect(makeReplyId([card('a'), card('b')], seq)).toBe('fresh');
    expect(makeReplyId([card('a')], () => 'a', 3)).toBeNull();
    expect(makeReplyId([], () => 'bad id', 3)).toBeNull();
  });
  it('足す命令：addMemoComment に replyId。文は整える。空なら null', () => {
    expect(addCommand('m1', 'r9', '  新しいカード \r\n 本文 ')).toEqual({ command: 'addMemoComment', id: 'm1', text: '新しいカード \n 本文', replyId: 'r9' });
    expect(addCommand('m1', 'r9', '   ')).toBeNull();
  });
  it('置く場所：見ている面の真ん中（カード 1 枚分）。拡大・パンを反映する', () => {
    // zoom 1・パンなし：面の中心（300,200）がカードの中心
    expect(spotForNewCard(view(), vp, [])).toEqual({ x: 300 - 95, y: 200 - 48 });
    // zoom 2・パン (100, 50)：中心の画面点 (300,200) → ボード ((300-100)/2, (200-50)/2) = (100, 75)
    expect(spotForNewCard(view(2, 100, 50), vp, [])).toEqual({ x: 100 - 95, y: 75 - 48 });
    const p = spotForNewCard(view(), vp, []);
    expect(Number.isInteger(p?.x) && Number.isInteger(p?.y)).toBe(true);
  });
  it('面の大きさが 0 のときも、0 付近に置く', () => {
    const p = spotForNewCard(view(), { w: 0, h: 0 }, []);
    expect(p).toEqual({ x: 0, y: 0 });
  });
  it('重なるときは、升目（190×96＋隙間 20）の間隔で外へ。重ならない最初の場所', () => {
    const base = spotForNewCard(view(), vp, []) as { x: number; y: number };
    const pitchX = BOARD_CARD.w + BOARD_CARD.gap;
    const pitchY = BOARD_CARD.h + BOARD_CARD.gap;
    const here = spotForNewCard(view(), vp, [base]);
    expect(here).not.toEqual(base);
    // 中心に近い順なので、縦の隣（96+20＝116）が横の隣（210）より先
    expect(here).toEqual({ x: base.x, y: base.y - pitchY });
    // 縦の隣 2 つが塞がっていれば、次に近いところ
    const next = spotForNewCard(view(), vp, [base, { x: base.x, y: base.y - pitchY }, { x: base.x, y: base.y + pitchY }]);
    expect(next).toEqual({ x: base.x - pitchX, y: base.y });
    // 結果は、どのカードにも重ならない
    for (const t of [base]) {
      const o = here as { x: number; y: number };
      expect(o.x < t.x + BOARD_CARD.w && t.x < o.x + BOARD_CARD.w && o.y < t.y + BOARD_CARD.h && t.y < o.y + BOARD_CARD.h).toBe(false);
    }
  });
  it('少しだけ重なっていても重なりとして避ける。ぴったり隣（隙間つき）は避けない', () => {
    const base = spotForNewCard(view(), vp, []) as { x: number; y: number };
    expect(spotForNewCard(view(), vp, [{ x: base.x + BOARD_CARD.w - 1, y: base.y }])).not.toEqual(base);
    expect(spotForNewCard(view(), vp, [{ x: base.x + BOARD_CARD.w + BOARD_CARD.gap, y: base.y }])).toEqual(base);
  });
  it('±10,000 の外は使わない。探しても見つからなければ null', () => {
    const p = spotForNewCard(view(1, -(BOARD_LIMITS.coord * 1 - 300), 0), vp, []);
    expect(Math.abs(p?.x ?? 0)).toBeLessThanOrEqual(BOARD_LIMITS.coord);
    // 全部の升目を塞ぐ
    const taken: { x: number; y: number }[] = [];
    const base = spotForNewCard(view(), vp, []) as { x: number; y: number };
    for (let dy = -SPOT_RINGS; dy <= SPOT_RINGS; dy++) for (let dx = -SPOT_RINGS; dx <= SPOT_RINGS; dx++) taken.push({ x: base.x + dx * 210, y: base.y + dy * 116 });
    expect(spotForNewCard(view(), vp, taken)).toBeNull();
  });
  it('左の写しに現れたか（一番上のカードとして）', () => {
    const rs = [card('a'), card('b', { parent: 'a' })];
    expect(cardAppeared(rs, 'a')).toBe(true);
    expect(cardAppeared(rs, 'b')).toBe(false);
    expect(cardAppeared(rs, 'zz')).toBe(false);
  });
});

describe('カードを消す', () => {
  it('ラベル：1 枚は「削除」、2 枚以上は「n枚を削除」（押す前に文で見せる）', () => {
    expect(deleteLabel(1)).toBe('削除');
    expect(deleteLabel(3)).toBe('3枚を削除');
    expect(deleteTitle(3)).toContain('3 枚');
    expect(deleteTitle(3)).toContain('確認はありません');
    expect(deleteTitle(0)).toContain('選んでください');
  });
  it('命令：一番上のカードだけ、1 枚につき removeReply（memo のスレッド）', () => {
    const rs = [card('a'), card('b'), card('c', { parent: 'a' })];
    expect(deleteCommands('m1', rs, ['b', 'c', 'a', 'zz'])).toEqual([
      { command: 'removeReply', ref: { kind: 'memo', id: 'm1' }, replyId: 'b' },
      { command: 'removeReply', ref: { kind: 'memo', id: 'm1' }, replyId: 'a' },
    ]);
    expect(deleteCommands('m1', rs, [])).toEqual([]);
  });
  it('消えたか', () => {
    const rs = [card('a'), card('b')];
    expect(cardsGone(rs, ['x', 'y'])).toBe(true);
    expect(cardsGone(rs, ['x', 'a'])).toBe(false);
  });
});

describe('書き直す', () => {
  const rs = [card('a'), card('b', { by: { who: 'main', name: 'Grok' } }), card('q', { text: '元の文', quote: { text: '引用', url: 'https://example.com/', title: '題' } }), card('r', { parent: 'a' })];
  it('1 枚だけ・使う人のカードだけ', () => {
    expect(editCheck(rs, ['a'])).toMatchObject({ ok: true });
    expect(editCheck(rs, [])).toMatchObject({ ok: false });
    expect(editCheck(rs, ['a', 'q'])).toMatchObject({ ok: false, note: expect.stringContaining('1 枚') });
    expect(editCheck(rs, ['b'])).toMatchObject({ ok: false, note: expect.stringContaining('AI') });
    expect(editCheck(rs, ['r'])).toMatchObject({ ok: false });
  });
  it('命令：整えた文。文を空にできるのは引用か画像のあるカードだけ。変わらなければ送らない', () => {
    const a = rs[0];
    expect(editCommand('m1', a, ' 直した\r\n文 ')).toEqual({ ok: true, command: { command: 'editReply', ref: { kind: 'memo', id: 'm1' }, replyId: 'a', text: '直した\n文' } });
    expect(editCommand('m1', a, '   ')).toMatchObject({ ok: false, note: expect.stringContaining('空') });
    expect(editCommand('m1', rs[2], '')).toMatchObject({ ok: true });
    expect(editCommand('m1', a, 'カード a')).toMatchObject({ ok: false, note: expect.stringContaining('変わっていません') });
  });
  it('書き直せたか（整えた文と台帳の文が同じ）', () => {
    expect(cardTextIs(rs, 'a', ' カード a ')).toBe(true);
    expect(cardTextIs(rs, 'a', '別')).toBe(false);
  });
});

describe('タグ（選んだ全部に）', () => {
  const rs = [card('a', { tags: ['調査', '予算', '宛て:everyone'] }), card('b', { tags: ['調査'] }), card('c'), card('d', { parent: 'a', tags: ['返信'] })];
  it('選んだカードのタグの集まり：機械タグは出さない。多いものが先', () => {
    expect(unionTags(rs, ['a', 'b', 'c'])).toEqual(['調査', '予算']);
    expect(unionTags(rs, ['c'])).toEqual([]);
    expect(unionTags(rs, ['d'])).toEqual([]); // 返信は対象外
    expect(unionTags(rs, ['a']).join()).not.toContain('宛て');
  });
  it('命令：選んだ一番上のカード 1 枚につき changeReplyTags（差分）。足し引きが空なら無し', () => {
    expect(tagCommands('m1', rs, ['a', 'c', 'd'], ['新'], [])).toEqual([
      { command: 'changeReplyTags', id: 'm1', replyId: 'a', add: ['新'], remove: [] },
      { command: 'changeReplyTags', id: 'm1', replyId: 'c', add: ['新'], remove: [] },
    ]);
    expect(tagCommands('m1', rs, ['a', 'b'], [], ['調査'])).toHaveLength(2);
    expect(tagCommands('m1', rs, ['a'], [], [])).toEqual([]);
  });
  it('上限（10 個）：もう付けられないカードの数', () => {
    const full = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const rs2 = [card('a', { tags: full }), card('b', { tags: ['x'] }), card('c', { tags: [...full.slice(0, 9), '新'] })];
    expect(tagFullCount(rs2, ['a', 'b', 'c'], '新', 10)).toBe(1);
    expect(tagFullCount(rs2, ['a'], 't1', 10)).toBe(0); // もう付いているので数えない
  });
});

describe('線', () => {
  const rs = [
    card('a', { links: [{ to: 'b', kind: 'ground' }, { to: 'c', kind: 'next' }] }),
    card('b', { links: [{ to: 'c', kind: 'same' }] }),
    card('c', { links: [{ to: 'a', kind: 'ask' }] }),
    card('d'),
    card('r', { parent: 'a' }),
  ];
  it('種類の選び方：6 つ。いまの種類・逆向きの「同じ」で押せないもの', () => {
    const k = kindChoices(rs, 'a', 'b');
    expect(k).toHaveLength(6);
    expect(k?.find((x) => x.kind === 'ground')).toMatchObject({ current: true, hint: '今の種類' });
    expect(k?.find((x) => x.kind === 'same')).toMatchObject({ disabled: false });
    // c → b の向きに「同じ」を足す：b → c の「同じ」がもうあるので押せない
    const back = kindChoices(rs, 'c', 'b');
    expect(back?.find((x) => x.kind === 'same')).toMatchObject({ disabled: true });
    expect(back?.find((x) => x.kind === 'ground')).toMatchObject({ disabled: false });
    expect(kindChoices(rs, 'a', 'a')).toBeNull();
    expect(kindChoices(rs, 'a', 'r')).toBeNull(); // 返信は結べない
    expect(kindChoices(rs, 'a', 'zz')).toBeNull();
  });
  it('足す命令：changeReplyLinks（差分）。同じ相手に別の種類は置き換え。同じ種類はもうある', () => {
    expect(linkAddPlan(rs, 'm1', 'a', 'd', 'counter')).toEqual({ ok: true, command: { command: 'changeReplyLinks', id: 'm1', replyId: 'a', add: [{ to: 'd', kind: 'counter' }], remove: [] } });
    expect(linkAddPlan(rs, 'm1', 'a', 'b', 'counter')).toMatchObject({ ok: true }); // ground → counter の置き換え
    expect(linkAddPlan(rs, 'm1', 'a', 'b', 'ground')).toMatchObject({ ok: false, note: expect.stringContaining('もう関連') });
  });
  it('足せない理由はグリッドと同じ文：逆向きの「同じ」・上限 10 本・相手がいない', () => {
    expect(linkAddPlan(rs, 'm1', 'c', 'b', 'same')).toEqual({ ok: false, note: 'その相手とは結べませんでした（相手のカードがもう無いか、もう「同じ」でつながっています）' });
    const many = [card('s', { links: Array.from({ length: MAX_LINKS_PER_CARD }, (_, i) => ({ to: `t${i}`, kind: 'next' as const })) }), card('new'), ...Array.from({ length: MAX_LINKS_PER_CARD }, (_, i) => card(`t${i}`))];
    expect(linkAddPlan(many, 'm1', 's', 'new', 'next')).toEqual({ ok: false, note: `関連は 1 枚のカードから ${MAX_LINKS_PER_CARD} 本までです（ほかの関連を外してから付けてください）` });
    expect(linkAddPlan(many, 'm1', 's', 't0', 'ground')).toMatchObject({ ok: true }); // 置き換えは上限に掛からない
    expect(linkAddPlan(rs, 'm1', 'a', 'zz', 'next')).toMatchObject({ ok: false });
    expect(linkAddPlan(rs, 'm1', 'a', 'r', 'next')).toMatchObject({ ok: false });
    expect(linkAddPlan(rs, 'm1', 'a', 'a', 'next')).toMatchObject({ ok: false });
  });
  it('このカードにつながる線：出る線が先、来る線があと。文つき', () => {
    const rel = relationsOf(rs, 'a');
    expect(rel.map((r) => [r.outgoing, r.source, r.other, r.kind])).toEqual([
      [true, 'a', 'b', 'ground'],
      [true, 'a', 'c', 'next'],
      [false, 'c', 'c', 'ask'],
    ]);
    expect(rel[0].sentence).toBe('カード aはカード bの根拠');
    expect(rel[2].sentence).toBe('カード cはカード aの疑問');
    expect(relationsOf(rs, 'd')).toEqual([]);
    expect(relationsOf(rs, 'r')).toEqual([]);
  });
  it('外す命令：出る線は元＝このカード、来る線は元＝相手のカード（replyId は線を持つカード）', () => {
    const [out, , inc] = relationsOf(rs, 'a');
    expect(linkRemoveCommand('m1', out, 'a')).toEqual({ command: 'changeReplyLinks', id: 'm1', replyId: 'a', add: [], remove: [{ to: 'b', kind: 'ground' }] });
    expect(linkRemoveCommand('m1', inc, 'a')).toEqual({ command: 'changeReplyLinks', id: 'm1', replyId: 'c', add: [], remove: [{ to: 'a', kind: 'ask' }] });
  });
  it('付いたか', () => {
    expect(linkIs(rs, 'a', 'b', 'ground')).toBe(true);
    expect(linkIs(rs, 'a', 'b', 'next')).toBe(false);
    expect(linkIs(rs, 'zz', 'b', 'next')).toBe(false);
  });
});

describe('ボタンの状態（toolState）', () => {
  const rs = [card('a', { links: [{ to: 'b', kind: 'next' }] }), card('b'), card('c', { by: { who: 'main', name: 'Grok' } })];
  it('何も選んでいない：足すだけ押せる', () => {
    const s = toolState({ selected: [], replies: rs, load: okLoad });
    expect(s.add.enabled).toBe(true);
    expect([s.edit.enabled, s.remove.enabled, s.linkAdd.enabled, s.linkRemove.enabled, s.tags]).toEqual([false, false, false, false, false]);
    expect(s.remove.label).toBe('削除');
  });
  it('1 枚選んだ：すべて押せる（線を外すのは線のあるカードだけ。書き直すのは使う人のカードだけ）', () => {
    const a = toolState({ selected: ['a'], replies: rs, load: okLoad });
    expect([a.edit.enabled, a.remove.enabled, a.linkAdd.enabled, a.linkRemove.enabled, a.tags]).toEqual([true, true, true, true, true]);
    const b = toolState({ selected: ['b'], replies: rs, load: okLoad });
    expect(b.linkRemove.enabled).toBe(true); // 来る線がある
    const c = toolState({ selected: ['c'], replies: rs, load: okLoad });
    expect([c.edit.enabled, c.linkRemove.enabled]).toEqual([false, false]);
    expect(c.edit.note).toContain('AI');
    expect(c.linkRemove.note).toContain('ありません');
  });
  it('複数選んだ：削除とタグだけ。ボタンは「n枚を削除」。編集・線は 1 枚のときだけ（理由を出す）', () => {
    const s = toolState({ selected: ['a', 'b'], replies: rs, load: okLoad });
    expect([s.remove.enabled, s.tags, s.edit.enabled, s.linkAdd.enabled, s.linkRemove.enabled]).toEqual([true, true, false, false, false]);
    expect(s.remove.label).toBe('2枚を削除');
    expect(s.linkAdd.note).toContain('1 枚だけ');
    expect(s.edit.note).toContain('1 枚');
  });
  it('足すのは、ボードが読めないとき・読み込み中・300 件のとき押せない（理由つき）', () => {
    expect(toolState({ selected: [], replies: rs, load: null }).add).toMatchObject({ enabled: false, note: expect.stringContaining('読み込み中') });
    expect(toolState({ selected: [], replies: rs, load: { state: 'unreadable', memoId: 'm1', why: 'failed' } }).add.enabled).toBe(false);
    const full = Array.from({ length: MAX_REPLIES }, (_, i) => card(`c${i}`));
    expect(toolState({ selected: [], replies: full, load: okLoad }).add.enabled).toBe(false);
  });
  it('消えたカードを選んだままでも、数えない', () => {
    const s = toolState({ selected: ['gone'], replies: rs, load: okLoad });
    expect(s.remove.enabled).toBe(false);
    expect(DEFAULT_VIEW.zoom).toBe(1);
  });
});

describe('型にする（B3-1）', () => {
  it('2 枚未満は押せない・31 枚以上は押したあとに理由つきで断る・その間は通る', () => {
    expect(templateBlockedNote(0)).toContain('2枚以上');
    expect(templateBlockedNote(1)).toContain('2枚以上');
    expect(templateBlockedNote(2)).toBeNull();
    expect(templateBlockedNote(30)).toBeNull();
    expect(templateBlockedNote(31)).toContain('30 枚まで');
    expect(templateBlockedNote(31)).toContain('31 枚');
  });
  it('ボタンの状態：2 枚未満は無効（理由つき）、2〜30 枚は有効、31 枚以上は有効のまま（押すと理由）', () => {
    const many = Array.from({ length: 31 }, (_, i) => card(`m${i}`));
    const state = (ids: string[]) => toolState({ selected: ids, replies: many, load: okLoad }).template;
    expect(state([])).toMatchObject({ enabled: false, note: expect.stringContaining('2枚以上') });
    expect(state(['m0'])).toMatchObject({ enabled: false });
    expect(state(['m0', 'm1'])).toMatchObject({ enabled: true, note: expect.stringContaining('型として登録') });
    expect(state(many.map((r) => r.id).slice(0, 30)).enabled).toBe(true);
    expect(state(many.map((r) => r.id))).toMatchObject({ enabled: true, note: expect.stringContaining('30 枚まで') });
  });
  it('消えたカードを選んだままでも、数えない', () => {
    expect(toolState({ selected: ['m0', 'gone'], replies: [card('m0')], load: okLoad }).template.enabled).toBe(false);
  });
  it('配置：選んだ中でいちばん左・いちばん上を 0 にした、ボード座標の差', () => {
    const pos = new Map([
      ['a', { x: 100, y: 50 }],
      ['b', { x: 330, y: 90 }],
      ['c', { x: 80, y: 360 }],
      ['z', { x: -9000, y: -9000 }],
    ]);
    expect(templateOffsets(['a', 'b', 'c'], pos)).toEqual({ a: { dx: 20, dy: 0 }, b: { dx: 250, dy: 40 }, c: { dx: 0, dy: 310 } });
    expect(templateOffsets(['a', 'b'], pos)).toEqual({ a: { dx: 0, dy: 0 }, b: { dx: 230, dy: 40 } }); // 選んでいない z は含めない
  });
  it('配置：負の座標・小数・1 枚だけでも成り立つ。位置の分からないカードがあれば null', () => {
    const pos = new Map([
      ['a', { x: -300.4, y: -10.2 }],
      ['b', { x: -70.1, y: 20.6 }],
    ]);
    expect(templateOffsets(['a', 'b'], pos)).toEqual({ a: { dx: 0, dy: 0 }, b: { dx: 230, dy: 31 } });
    expect(templateOffsets(['a'], pos)).toEqual({ a: { dx: 0, dy: 0 } });
    expect(templateOffsets(['a', 'nope'], pos)).toBeNull();
    expect(templateOffsets([], pos)).toBeNull();
    expect(templateOffsets(['a'], new Map([['a', { x: Number.NaN, y: 0 }]]))).toBeNull();
  });
  it('並べ替えても同じ（選んだ順に左右されない）', () => {
    const pos = new Map([
      ['a', { x: 10, y: 10 }],
      ['b', { x: 240, y: 10 }],
    ]);
    expect(templateOffsets(['b', 'a'], pos)).toEqual(templateOffsets(['a', 'b'], pos));
  });
  it('ボードの座標から作った配置が、型の配置としてそのまま使える（buildTemplateFromCards）', () => {
    const rs = [card('a'), card('b')];
    const off = templateOffsets(['a', 'b'], new Map([['a', { x: 500, y: 500 }], ['b', { x: 730, y: 620 }]]));
    const r = buildTemplateFromCards(rs, ['a', 'b'], { name: '型', offsets: off ?? undefined });
    expect(r.ok && r.template.cards.map((c) => [c.dx, c.dy])).toEqual([[0, 0], [230, 120]]);
  });
});