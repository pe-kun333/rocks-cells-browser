// 段 D4：コメントカードを材料にする変換と、命令 askWithCards の形（純粋関数）。画面も台帳も触らない
import { describe, expect, it } from 'vitest';
import { serializeMaterials, tryTurnMaterialOn } from '../src/draft-materials';
import { CardMaterials, cleanAskWithCards, type CardReplyCopy } from '../src/app/draft-sources';

const card = (id: string, text: string, extra: Partial<CardReplyCopy> = {}): CardReplyCopy => ({
  id,
  parent: null,
  text,
  createdAt: 1,
  rank: 1,
  ...extra,
});

const collect = (replies: readonly CardReplyCopy[], ids: readonly string[], linked?: 'none' | 'one') =>
  CardMaterials.collect({ memoId: 'memo1', replies, ids, ...(linked ? { linked } : {}) });

describe('カード 1 枚', () => {
  it('本文と見えるタグ。機械のタグは出ない。印はオン', () => {
    const set = collect(
      [card('a', '朝の予定\n本文です', { tags: ['仕事', '宛て:b1', '送った:x', '貼った:y', 'メモ'] })],
      ['a'],
    );
    expect(set.dropped).toBe(0);
    expect(set.empty).toBe(0);
    expect(set.items).toHaveLength(1);
    const item = set.items[0]!;
    expect(item.kind).toBe('card');
    expect(item.on).toBe(true);
    expect(item.via).toBe('picked');
    expect(item.label).toBe('朝の予定');
    expect(item.text).toBe('朝の予定\n本文です');
    expect(item.tags).toEqual(['仕事', 'メモ']);
    expect(item.detail).toBe('タグ：仕事、メモ');
    expect(item.key).toBe('card:memo1/a');
    expect(item.ref).toEqual({ kind: 'card', memo: 'memo1', reply: 'a' });
    const wire = serializeMaterials(set.items);
    expect(wire.block).toBe('材料 1/1（コメントカード・タグ：仕事、メモ）：\n朝の予定\n本文です');
    const dumped = JSON.stringify(set);
    expect(dumped).not.toContain('宛て:');
    expect(dumped).not.toContain('送った:');
    expect(dumped).not.toContain('貼った:');
    expect(set.notes.some((line) => line.includes('中を見てから貼ってください'))).toBe(true);
  });
});

describe('入れないカード', () => {
  it('文が空（画像だけ・引用だけ）は empty。下の返信は一覧にも empty にも入らない', () => {
    const set = collect(
      [card('empty', ''), card('keep', '残す'), card('child', '子の返信', { parent: 'keep' })],
      ['empty', 'keep', 'child'],
    );
    expect(set.items.map((item) => item.ref)).toEqual([{ kind: 'card', memo: 'memo1', reply: 'keep' }]);
    expect(set.empty).toBe(1);
    expect(set.dropped).toBe(0);
    expect(JSON.stringify(set)).not.toContain('子の返信');
  });
});

describe('上限', () => {
  it('31 枚目は件数で外す。30 枚は残る', () => {
    const replies = Array.from({ length: 31 }, (_, i) => card(`c${i}`, `文${i}`, { rank: i, createdAt: i }));
    const set = collect(replies, replies.map((r) => r.id));
    expect(set.items).toHaveLength(30);
    expect(set.dropped).toBe(1);
    expect(set.items.some((item) => item.ref?.kind === 'card' && item.ref.reply === 'c30')).toBe(false);
    expect(set.notes.some((line) => line.includes('上限を超えた 1 件は外しました'))).toBe(true);
  });

  it('オンが 2,000 字×8 枚でも落とさず、7 件目と 8 件目の印を外す', () => {
    const text = 'あ'.repeat(2_000);
    const replies = Array.from({ length: 8 }, (_, i) => card(`c${i}`, text, { rank: i, createdAt: i }));
    const set = collect(replies, replies.map((r) => r.id));
    expect(set.items).toHaveLength(8);
    expect(set.dropped).toBe(0);
    expect(set.items.slice(0, 6).every((item) => item.on)).toBe(true);
    expect(set.items[6]?.on).toBe(false);
    expect(set.items[7]?.on).toBe(false);
    expect(set.notes.some((line) => line.includes('字数の上限を超える 2 件は印を外しました'))).toBe(true);
    const seventh = set.items[6]!;
    expect(tryTurnMaterialOn(set.items, seventh)).toContain('12,000');
    expect(seventh.on).toBe(false);
  });
});

describe('つながったカード', () => {
  it('直接の 1 段だけ。既定はオフ。元のカードが分かり、付けたときだけ文に入る', () => {
    const replies = [
      card('a', '朝の予定', { links: [{ to: 'b' }] }),
      card('b', '根拠の文', { links: [{ to: 'c' }] }),
      card('c', '二段先'),
    ];
    const set = collect(replies, ['a'], 'one');
    expect(set.items.map((item) => (item.ref?.kind === 'card' ? item.ref.reply : ''))).toEqual(['a', 'b']);
    const linked = set.items[1]!;
    expect(linked.on).toBe(false);
    expect(linked.via).toBe('linked');
    expect(linked.detail).toBe('元：カード『朝の予定』');
    expect(serializeMaterials(set.items).block).not.toContain('根拠の文');
    expect(tryTurnMaterialOn(set.items, linked)).toBeNull();
    expect(linked.on).toBe(true);
    expect(serializeMaterials(set.items).block).toContain('根拠の文');
  });

  it('選んだカードと重なる相手は、選んだ側の 1 件のまま', () => {
    const replies = [card('a', '選んだ', { links: [{ to: 'b' }] }), card('b', '両方')];
    const set = collect(replies, ['a', 'b'], 'one');
    expect(set.items).toHaveLength(2);
    const both = set.items.find((item) => item.ref?.kind === 'card' && item.ref.reply === 'b');
    expect(both?.on).toBe(true);
    expect(both?.via).toBe('picked');
  });

  it('つながったカードは 10 枚まで', () => {
    const links = Array.from({ length: 12 }, (_, i) => ({ to: `t${i}` }));
    const replies = [card('a', '元', { links }), ...links.map((link, i) => card(link.to, `先${i}`, { rank: i + 1 }))];
    const set = collect(replies, ['a'], 'one');
    const linked = set.items.filter((item) => item.via === 'linked');
    expect(linked).toHaveLength(10);
    expect(set.items.some((item) => item.ref?.kind === 'card' && item.ref.reply === 't10')).toBe(false);
    expect(set.items.some((item) => item.ref?.kind === 'card' && item.ref.reply === 't11')).toBe(false);
  });

  it('オンが 12,000 字に達しているとき、つながったカードの印は付かない', () => {
    const text = 'あ'.repeat(2_000);
    const replies = [
      ...Array.from({ length: 6 }, (_, i) => card(`c${i}`, text, { rank: i, links: i === 0 ? [{ to: 'extra' }] : [] })),
      card('extra', '足す文', { rank: 9 }),
    ];
    const set = collect(replies, ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'], 'one');
    const extra = set.items.find((item) => item.ref?.kind === 'card' && item.ref.reply === 'extra');
    expect(extra?.on).toBe(false);
    expect(extra?.via).toBe('linked');
    expect(tryTurnMaterialOn(set.items, extra!)).toContain('12,000');
    expect(extra?.on).toBe(false);
  });
});

describe('askWithCards の形', () => {
  it('memo と replies を整え、30 件を超えず、壊れた id は落とす', () => {
    const replies = Array.from({ length: 32 }, (_, i) => `r${i}`);
    replies.splice(3, 0, 'だめ な', '', 'r0');
    const cleaned = cleanAskWithCards({ memo: 'memo1', replies, linked: 'one' });
    expect(cleaned?.memo).toBe('memo1');
    expect(cleaned?.linked).toBe('one');
    expect(cleaned?.replies).toHaveLength(30);
    expect(cleaned?.replies[0]).toBe('r0');
    expect(cleaned?.replies).not.toContain('r30');
    expect(cleaned?.replies).not.toContain('r31');
    expect(cleaned?.replies).not.toContain('だめ な');
    expect(cleaned?.replies.filter((id) => id === 'r0')).toHaveLength(1);
  });

  it('linked の知らない値は none。宛て先は *all かボットの id だけ', () => {
    expect(cleanAskWithCards({ memo: 'memo1', replies: ['a'], linked: 'two' })?.linked).toBe('none');
    expect(cleanAskWithCards({ to: '*all' })).toEqual({ memo: '', replies: [], linked: 'none', to: '*all' });
    expect(cleanAskWithCards({ to: 'b1234' })?.to).toBe('b1234');
    expect(cleanAskWithCards({ to: 'all' })).toBeNull();
    expect(cleanAskWithCards({ memo: 'だめ', replies: ['a'] })).toBeNull();
    expect(cleanAskWithCards({ replies: ['a'] })).toBeNull();
  });
});
