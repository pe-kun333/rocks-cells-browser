// 段 D6：返事をカードにする計画（ui/src/reply-card-plan.ts）
import { describe, expect, it } from 'vitest';
import { MAX_LINKS_PER_CARD } from '../src/memo-card-links';
import { planReplyCard, REPLY_CARD_TEXT_MAX } from '../src/reply-card-plan';
import { MAX_REPLIES } from '../src/threads';

const memo = (replies: { id: string; parent: string | null; links?: { to: string }[] }[] = [{ id: 'old', parent: null }]) => ({
  id: 'memo1',
  replies,
});

describe('planReplyCard', () => {
  it('掃除した文を、Grok Bot の一番上のカードと、元への補足の線にする', () => {
    const plan = planReplyCard({ text: '  <b>太字</b>\u0000です\r\n次  ', origin: { memo: 'memo1', reply: 'old' }, memo: memo() });
    expect(plan).toEqual({
      ok: true,
      memo: 'memo1',
      text: '<b>太字</b>です\n次',
      by: { who: 'bot', name: 'Grok Bot' },
      link: { from: 'old', kind: 'supplement' },
    });
  });

  it('元のカードが無い・一番上でない・メモが違うときは、何も置く計画にしない', () => {
    const missing = '元のカードが見つかりません';
    expect(planReplyCard({ text: '文', origin: null, memo: memo() })).toEqual({ ok: false, note: missing });
    expect(planReplyCard({ text: '文', origin: { memo: 'memo1', reply: 'old' }, memo: null })).toEqual({ ok: false, note: missing });
    expect(planReplyCard({ text: '文', origin: { memo: 'other', reply: 'old' }, memo: memo() })).toEqual({ ok: false, note: missing });
    expect(planReplyCard({ text: '文', origin: { memo: 'memo1', reply: 'gone' }, memo: memo() })).toEqual({ ok: false, note: missing });
    expect(planReplyCard({ text: '文', origin: { memo: 'memo1', reply: 'old' }, memo: memo([{ id: 'old', parent: 'top' }]) })).toEqual({ ok: false, note: missing });
  });

  it('空の文・20,000 字超え・返信の上限・関連 10 本は断る', () => {
    expect(planReplyCard({ text: ' \u0000\n ', origin: { memo: 'memo1', reply: 'old' }, memo: memo() })).toEqual({ ok: false, note: '返事の文がありません' });
    const long = 'あ'.repeat(REPLY_CARD_TEXT_MAX + 1);
    expect(planReplyCard({ text: long, origin: { memo: 'memo1', reply: 'old' }, memo: memo() }).ok).toBe(false);
    expect(planReplyCard({ text: 'あ'.repeat(REPLY_CARD_TEXT_MAX), origin: { memo: 'memo1', reply: 'old' }, memo: memo() }).ok).toBe(true);
    const full = Array.from({ length: MAX_REPLIES }, (_, i) => ({ id: i === 0 ? 'old' : `x${i}`, parent: null as string | null }));
    expect(planReplyCard({ text: '文', origin: { memo: 'memo1', reply: 'old' }, memo: memo(full) })).toMatchObject({ ok: false });
    const links = Array.from({ length: MAX_LINKS_PER_CARD }, (_, i) => ({ to: `t${i}` }));
    expect(planReplyCard({ text: '文', origin: { memo: 'memo1', reply: 'old' }, memo: memo([{ id: 'old', parent: null, links }]) })).toMatchObject({ ok: false });
  });
});
