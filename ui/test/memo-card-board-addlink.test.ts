import { describe, expect, it } from 'vitest';
import { addLinkFrom, linkAddPlan } from '../src/memo-card-board-edit';
import type { Reply } from '../src/threads';

const reply = (id: string): Reply => ({ id, parent: null, text: id, createdAt: 1000 });

describe('足すと同時に引く線（CB13）', () => {
  it('選んだカードの横へ足すときだけ、種類があれば引く', () => {
    expect(addLinkFrom({ dir: 'right', anchor: 'a', kind: 'next' })).toEqual({ from: 'a', kind: 'next' });
    expect(addLinkFrom({ dir: 'down', anchor: 'a', kind: 'ground' })).toEqual({ from: 'a', kind: 'ground' });
  });
  it('［決める］（dir なし）では引かない', () => {
    expect(addLinkFrom({ anchor: 'a', kind: 'next' })).toBeNull();
  });
  it('選びが 1 枚でない（anchor なし）なら引かない', () => {
    expect(addLinkFrom({ dir: 'right', kind: 'next' })).toBeNull();
  });
  it('既定「なし」では引かない', () => {
    expect(addLinkFrom({ dir: 'right', anchor: 'a', kind: '' })).toBeNull();
  });
  it('線は前のカードが持ち、新しいカードを指す（確認 2 の答え）', () => {
    const made = addLinkFrom({ dir: 'right', anchor: 'old', kind: 'next' });
    const plan = linkAddPlan([reply('old'), reply('new')], 'm', made!.from, 'new', made!.kind);
    expect(plan.ok && plan.command).toEqual({ command: 'changeReplyLinks', id: 'm', replyId: 'old', add: [{ to: 'new', kind: 'next' }], remove: [] });
  });
});
