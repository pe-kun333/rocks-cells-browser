// Grok Cards の純な決まり（殻・数・列・タグ）。DOM も localStorage も使わない
import { describe, expect, it } from 'vitest';
import { cardArrivedLabel, countArrived, requestArrivedLabel, shellArrived, withArrivedLine } from '../src/grok-cards-arrived';
import { cardsTabLabel, clampUpperRatio, hostPlaceCommand, normalizeCardsPlace, nudgeUpperRatio, readUpperRatioRaw, upperRatioFromOffset, UPPER_SPLIT_DEFAULT, UPPER_SPLIT_MIN } from '../src/grok-cards-place';
import { draftCount, countLine } from '../src/grok-cards-count';
import { orderColumns, withAddedColumn } from '../src/grok-cards-columns';
import { cardFace, groupKind, queueNote } from '../src/grok-cards-face';
import { planAdd } from '../src/grok-cards-plan';
import { isMachineTag, parseAddress, parsePasted, parseSent, visibleTags, withPastedTag, withSentTag } from '../src/grok-cards-tags';
import { mergeRowLabel, resolveShellInput, shellCaption, shellDevForArrived, shellSize, shellView, type ShellInput } from '../src/nest-shell';

const base = (): ShellInput => ({
  open: false,
  merged: false,
  replies: 0,
  drafts: 0,
  arrived: 0,
  seats: 6,
  error: false,
  size: 60,
});

describe('殻の見え方', () => {
  it('閉じているときは銀の数、開くと札は消える', () => {
    const closed = shellView({ ...base(), replies: 2 });
    expect(closed.badge).toBe('count');
    expect(closed.badgeText).toBe('2');
    expect(closed.caption).toBe('返事 2');
    expect(closed.label).toBe('Grok Cards を開く（返事 2）');
    const open = shellView({ ...base(), open: true, replies: 2 });
    expect(open.badge).toBe('none');
    expect(open.caption).toBe('開いています');
    expect(open.label).toBe('Grok Cards を閉じる');
  });

  it('エラーの「!」は数より先。10 以上は 9+', () => {
    expect(shellView({ ...base(), replies: 4, error: true }).badgeText).toBe('!');
    expect(shellView({ ...base(), replies: 12 }).badgeText).toBe('9+');
  });

  it('合体のあいだは殻の札を出さない', () => {
    const view = shellView({ ...base(), merged: true, replies: 3, error: true });
    expect(view.badge).toBe('none');
    expect(view.merged).toBe(true);
  });

  it('届いた板は席の先頭から。空いた席は点線。6/6 でも隙間は残る（板は 6 枚）', () => {
    const view = shellView({ ...base(), seats: 4, arrived: 3 });
    expect(view.plates.map((p) => p.arrived)).toEqual([true, true, true, false, false, false]);
    expect(view.plates.map((p) => p.empty)).toEqual([false, false, false, false, true, true]);
    expect(view.caption).toBe('届いた 3/6');
    expect(shellView({ ...base(), arrived: 6 }).plates.every((p) => p.arrived && !p.empty)).toBe(true);
  });

  it('説明は開く・届いた・数の順。0 は出さない', () => {
    expect(shellCaption({ open: false, arrived: 0, drafts: 2, replies: 0 })).toBe('下書き 2');
    expect(shellCaption({ open: false, arrived: 0, drafts: 1, replies: 2 })).toBe('下書き 1・返事 2');
    expect(shellCaption({ open: false, arrived: 0, drafts: 0, replies: 0 })).toBe('');
    expect(countLine(0, 0)).toBe('');
  });

  it('開発用のピンは、渡した項目だけ上書きする', () => {
    const next = resolveShellInput(base(), { open: true, occupied: 2, size: 26 });
    expect(next.open).toBe(true);
    expect(next.seats).toBe(2);
    expect(next.size).toBe(26);
    expect(next.drafts).toBe(0);
  });

  it('輪の高さで 60 / 40 / 26', () => {
    expect(shellSize(155)).toBe(60);
    expect(shellSize(145)).toBe(60);
    expect(shellSize(129)).toBe(40);
    expect(shellSize(118)).toBe(40);
    expect(shellSize(100)).toBe(26);
  });

  it('合体の行は数と ▸', () => {
    expect(mergeRowLabel({ drafts: 1, replies: 2, arrived: 0 })).toBe('下書き 1・返事 2 ▸');
    expect(mergeRowLabel({ drafts: 0, replies: 0, arrived: 3 })).toBe('届いた 3/6 ▸');
    expect(mergeRowLabel({ drafts: 0, replies: 0, arrived: 0 })).toBe('合体 Grok ▸');
  });

  it('段 8 の分母は組の席数。開発用の arrived は段 8 では渡さない', () => {
    const states = ['replied', 'replied', 'working', 'sent'];
    expect(shellCaption({ open: false, arrived: 2, arrivedOf: 4, drafts: 1, replies: 0 })).toBe('届いた 2/4');
    expect(shellCaption({ open: false, arrived: 2, drafts: 1, replies: 0 })).toBe('届いた 2/6');
    expect(mergeRowLabel({ drafts: 1, replies: 0, arrived: 2, arrivedOf: 4 })).toBe('下書き 1・届いた 2/4 ▸');
    expect(shellView({ ...base(), arrived: 2, arrivedOf: 4, drafts: 1 }).label).toBe('Grok Cards を開く（下書き 1・届いた 2/4）');
    expect(cardArrivedLabel(states)).toBe('届いた 2/4');
    const kept = resolveShellInput({ ...base(), arrived: 2, arrivedOf: 4 }, { open: true });
    expect(kept.arrivedOf).toBe(4);
    expect(kept.open).toBe(true);
    expect(shellDevForArrived({ arrived: 5, drafts: 1 }, false)).toEqual({ arrived: 5, drafts: 1 });
    expect(shellDevForArrived({ arrived: 5, drafts: 1 }, true)).toEqual({ drafts: 1 });
    const real = resolveShellInput({ ...base(), arrived: 2, arrivedOf: 4 }, shellDevForArrived({ arrived: 0, open: true }, true));
    expect(real.arrived).toBe(2);
    expect(real.arrivedOf).toBe(4);
    expect(real.open).toBe(true);
  });
});

describe('届いた k/n', () => {
  const flying = ['replied', 'replied', 'replied', 'working', 'sent', 'late'];
  const done = ['replied', 'replied', 'error', 'stopped'];

  it('回答ありだけを数える。エラーと遅れは席の数に残る', () => {
    expect(countArrived(flying)).toEqual({ k: 3, n: 6 });
    expect(cardArrivedLabel(flying)).toBe('届いた 3/6');
    expect(cardArrivedLabel(done)).toBe('届いた 2/4');
    expect(cardArrivedLabel([])).toBe('');
    expect(cardArrivedLabel(null)).toBe('');
  });

  it('殻は届きかけのいちばん新しい組。終わった組は 0', () => {
    const groups = [
      { group: 2, states: flying },
      { group: 4, states: done },
      { group: 3, states: ['sent', 'replied'] },
    ];
    expect(shellArrived(groups)).toEqual({ k: 1, n: 2, group: 3 });
    expect(cardArrivedLabel(groups[2].states)).toBe('届いた 1/2');
    expect(shellArrived([{ group: 4, states: done }])).toEqual({ k: 0, n: 0, group: null });
    expect(shellArrived([])).toEqual({ k: 0, n: 0, group: null });
  });

  it('1 件の札は 0/1 か 1/1。帯は k が 0 なら足さない', () => {
    expect(requestArrivedLabel('replied')).toBe('届いた 1/1');
    expect(requestArrivedLabel('working')).toBe('届いた 0/1');
    expect(requestArrivedLabel('error')).toBe('届いた 0/1');
    expect(requestArrivedLabel('chat')).toBe('');
    expect(requestArrivedLabel(null)).toBe('');
    expect(withArrivedLine('下書き 1', 3, 6)).toBe('下書き 1・届いた 3/6');
    expect(withArrivedLine('', 3, 6)).toBe('届いた 3/6');
    expect(withArrivedLine('下書き 1', 0, 6)).toBe('下書き 1');
    expect(withArrivedLine('', 0, 6)).toBe('');
  });

  it('6/6 でも板は 6 枚のまま', () => {
    const full = shellView({ ...base(), arrived: 6, arrivedOf: 6 });
    expect(full.plates).toHaveLength(6);
    expect(full.plates.every((plate) => plate.arrived && !plate.empty)).toBe(true);
    expect(full.caption).toBe('届いた 6/6');
  });
});

describe('下書きの数', () => {
  it('送ったカードは数えない。結ばれていない順番待ちは数える', () => {
    const cards = [{ tags: ['宛て:b1111'] }, { tags: ['宛て:b2222', '送った:g3'] }];
    const queue = [
      { id: 'a', group: 3 },
      { id: 'b', group: 3 },
      { id: 'c', group: 4 },
      { id: 'd' },
    ];
    expect(draftCount(cards, queue)).toBe(3);
  });

  it('いちばんうしろの送った: の組だけを結ぶ', () => {
    const cards = [{ tags: ['送った:g1', '送った:g9'] }];
    expect(draftCount(cards, [{ id: 'a', group: 1 }])).toBe(1);
    expect(draftCount(cards, [{ id: 'a', group: 9 }])).toBe(0);
  });
});

describe('列の順', () => {
  const names = new Map([
    ['bseat1', '調査'],
    ['bseat2', '要約'],
  ]);

  it('みんな、席の順、下書きのある席の外', () => {
    const cols = orderColumns({
      dock: ['bseat1', 'bseat2'],
      extra: ['bseat2', 'bextra1'],
      savedOrder: [],
      hidden: [],
      names,
    });
    expect(cols.map((c) => c.key)).toEqual(['all', 'bot:bseat1', 'bot:bseat2', 'bot:bextra1']);
    expect(cols[0].title).toBe('みんな');
    expect(cols[3].title).toBe('宛て先なし（もと：bextra1）');
    expect(cols[1].title).toBe('調査');
  });

  it('保存した順を先に、隠した列は出さない。足りない既定は後ろ', () => {
    const cols = orderColumns({
      dock: ['bseat1', 'bseat2'],
      extra: [],
      savedOrder: ['bot:bseat2', 'all', 'bot:nope'],
      hidden: ['bot:bseat1'],
      names,
    });
    expect(cols.map((c) => c.key)).toEqual(['bot:bseat2', 'all']);
  });
});

describe('宛て先のタグ', () => {
  it('宛て: が二つなら、最初を使い、二つだと分かる', () => {
    const parsed = parseAddress(['メモ', '宛て:b1111aaaa', '宛て:b2222bbbb']);
    expect(parsed).toEqual({ address: 'b1111aaaa', duplicate: true });
    expect(parseAddress(['宛て:all']).address).toBe('all');
    expect(parseAddress(['ただのタグ'])).toEqual({ address: null, duplicate: false });
  });

  it('送った: はうしろの方。機械のタグはふつうの一覧から外す', () => {
    expect(parseSent(['送った:g2', '送った:memo'])).toEqual({ raw: 'memo', group: null });
    expect(parseSent(['送った:g4'])?.group).toBe(4);
    expect(isMachineTag('宛て:b1111')).toBe(true);
    expect(isMachineTag('送った:g1')).toBe(true);
    expect(isMachineTag('貼った:g1')).toBe(true);
    expect(visibleTags(['調べる', '宛て:b1111', '送った:g1', '貼った:g1'])).toEqual(['調べる']);
  });

  it('送ったは最後の 1 件。付け直すと貼ったは外れる。貼ったはうしろ', () => {
    const sent = withSentTag(['宛て:b1111aaaa', '送った:g1', '貼った:g1'], 'hb-20261020-0001-ab12');
    expect(sent.filter((tag) => tag.startsWith('送った:'))).toEqual(['送った:hb-20261020-0001-ab12']);
    expect(sent.some((tag) => tag.startsWith('貼った:'))).toBe(false);
    const pasted = withPastedTag(sent);
    expect(pasted).toEqual(['宛て:b1111aaaa', '送った:hb-20261020-0001-ab12', '貼った:hb-20261020-0001-ab12']);
    expect(parsePasted(['貼った:g1', '貼った:g2'])).toBe('g2');
    expect(withPastedTag(['宛て:b1111aaaa'])).toBeNull();
  });
});

const day = 24 * 60 * 60 * 1000;
const face = (over: Partial<Parameters<typeof cardFace>[0]> = {}) =>
  cardFace({
    tags: ['宛て:b1111aaaa'],
    stage6: false,
    stage7: false,
    now: 10 * day,
    request: null,
    groupStates: null,
    requestsReady: false,
    queueLeft: false,
    overdue: false,
    ...over,
  });

describe('札の状態', () => {
  const sent = ['宛て:b1111aaaa', '送った:hb-20261020-0001-ab12'];

  it('段 6 の前は灰のコピーした。段 6 で貼る前と返事待ちに分かれる', () => {
    expect(face({ tags: sent }).label).toBe('コピーした（貼ったかは分かりません）');
    expect(face({ tags: sent, stage6: true }).kind).toBe('unpasted');
    expect(face({ tags: withPastedTag(sent) ?? sent, stage6: true }).kind).toBe('waiting');
  });

  it('段 7 は返事・遅れ・期限。記録が無ければ期限切れ。dev のつまみも同じ', () => {
    const now = 40 * day;
    expect(face({ tags: sent, stage7: true, requestsReady: true, now }).kind).toBe('expired');
    expect(face({ tags: sent, stage7: true, request: { state: 'late', createdAt: now }, now }).kind).toBe('late');
    expect(face({ tags: sent, stage7: true, request: { state: 'replied', createdAt: now }, now }).kind).toBe('replied');
    expect(face({ tags: sent, stage6: true, stage7: true, request: { state: 'sent', createdAt: now }, now }).kind).toBe('unpasted');
    const old = face({
      tags: sent,
      stage7: true,
      now,
      request: { state: 'replied', createdAt: now - 31 * day },
    });
    expect(old.kind).toBe('expired');
    expect(face({ tags: sent, overdue: true }).kind).toBe('expired');
    expect(groupKind(['sent', 'late', 'replied'])).toBe('late');
    expect(groupKind(['replied', 'stopped'])).toBe('replied');
  });

  it('順番待ちは 1 日前から文が変わる', () => {
    const now = 10 * day;
    expect(queueNote(now - 2 * day, now).soon).toBe(false);
    expect(queueNote(now - 6 * day, now)).toEqual({ text: 'あと 1 日で順番待ちから外れます', soon: true });
  });
});

describe('列を足す', () => {
  it('今の列のうしろに足し、隠していた列は戻す', () => {
    const next = withAddedColumn(['all', 'bot:bseat1'], ['bot:bseat2'], 'bot:bseat2');
    expect(next).toEqual({ order: ['all', 'bot:bseat1', 'bot:bseat2'], hidden: [] });
    expect(withAddedColumn(['all'], [], 'all')).toBeNull();
  });
});

describe('下書きを書く前', () => {
  const room = { writable: true, loadFailed: false, sheetRoom: true, memoRoom: true };

  it('台帳を読めないときは残す', () => {
    const refused = planAdd({ ...room, text: '  頼む  ', writable: false });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.keep).toBe(true);
  });

  it('空は残す。鍵に似た字は残さずに知らせる', () => {
    expect(planAdd({ ...room, text: '   ' }).ok).toBe(false);
    const secret = planAdd({ ...room, text: 'sk-abcdefgh' });
    expect(secret.ok).toBe(true);
    if (secret.ok) {
      expect(secret.secret).toBe(true);
      expect(secret.notice).toBe('鍵のような字があります');
      expect(secret.text).toBe('sk-abcdefgh');
    }
  });
});

describe('出す場所', () => {
  it('段 9 が無いときは下の面。upper だけが上の半分', () => {
    expect(normalizeCardsPlace(false, 'upper')).toBe('bottom');
    expect(normalizeCardsPlace(false, 'bottom')).toBe('bottom');
    expect(normalizeCardsPlace(true, 'upper')).toBe('upper');
    expect(normalizeCardsPlace(true, 'bottom')).toBe('bottom');
    expect(normalizeCardsPlace(true, 'side')).toBe('bottom');
    expect(normalizeCardsPlace(true, null)).toBe('bottom');
  });

  it('タブの文。ホストへは出すときと、戻すときだけ', () => {
    expect(cardsTabLabel('upper')).toBe('↑ 上に出ています');
    expect(cardsTabLabel('bottom')).toBe('Grok Cards');
    expect(hostPlaceCommand(true, 'upper', false)).toBe('upper');
    expect(hostPlaceCommand(true, 'bottom', true)).toBe('');
    expect(hostPlaceCommand(false, 'bottom', true)).toBe('');
    expect(hostPlaceCommand(false, 'upper', false)).toBe(null);
    expect(hostPlaceCommand(false, 'bottom', false)).toBe(null);
    expect(hostPlaceCommand(true, 'bottom', false)).toBe(null);
  });

  it('境目は両方 120 以上。足りない高さは半分。段 9 が無い比率は読まない', () => {
    expect(clampUpperRatio(800, 0.4)).toBeCloseTo(0.4);
    expect(clampUpperRatio(800, 0.01)).toBeCloseTo(UPPER_SPLIT_MIN / 800);
    expect(clampUpperRatio(800, 0.99)).toBeCloseTo(1 - UPPER_SPLIT_MIN / 800);
    expect(clampUpperRatio(200, 0.2)).toBe(UPPER_SPLIT_DEFAULT);
    expect(clampUpperRatio(0, 0.2)).toBe(UPPER_SPLIT_DEFAULT);
    expect(clampUpperRatio(800, Number.NaN)).toBe(UPPER_SPLIT_DEFAULT);
    expect(upperRatioFromOffset(800, 400)).toBeCloseTo(0.5);
    expect(upperRatioFromOffset(800, 0)).toBeCloseTo(UPPER_SPLIT_MIN / 800);
    expect(upperRatioFromOffset(800, 800)).toBeCloseTo(1 - UPPER_SPLIT_MIN / 800);
    expect(nudgeUpperRatio(800, 0.5, -20)).toBeCloseTo(0.475);
    expect(nudgeUpperRatio(800, UPPER_SPLIT_MIN / 800, -20)).toBeCloseTo(UPPER_SPLIT_MIN / 800);
    expect(readUpperRatioRaw(false, 0.25)).toBe(UPPER_SPLIT_DEFAULT);
    expect(readUpperRatioRaw(true, 0.25)).toBe(0.25);
    expect(readUpperRatioRaw(true, 0)).toBe(UPPER_SPLIT_DEFAULT);
    expect(readUpperRatioRaw(true, 1)).toBe(UPPER_SPLIT_DEFAULT);
    expect(readUpperRatioRaw(true, '0.25')).toBe(UPPER_SPLIT_DEFAULT);
  });
});
