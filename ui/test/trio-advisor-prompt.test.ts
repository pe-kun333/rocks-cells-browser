// 三人組の先生つき（docs/plan-trio-advisor.md の P2）：指示文に足す段落
//   指示文は会話ごとに保存して送り続ける。先生なしの体の指示文が 1 文字でも変わると、
//   これから始まる会話すべての指示文が変わるので、「足さないときは今までと同じ」を確かめる
import { describe, expect, it } from 'vitest';

import { characterSystemPrompt, TRIO_ADVISOR_PROMPT } from '../src/ai/prompts';

const BASE = {
  name: 'ジン',
  persona: '事実を確かめる',
  abilities: ['Web 検索'],
  unit: { name: 'ソネット三人組', mates: [{ name: 'ルカ', blurb: '見る' }, { name: 'モモ', blurb: '残す' }] },
};

describe('characterSystemPrompt：三人組の先生つき', () => {
  it('trioAdvisor を付けない・false のときは、同じ指示文（段落は入らない）', () => {
    const plain = characterSystemPrompt(BASE);
    expect(characterSystemPrompt({ ...BASE, trioAdvisor: false })).toBe(plain);
    expect(characterSystemPrompt({ ...BASE, trioAdvisor: undefined })).toBe(plain);
    expect(plain).not.toContain('先生に見てもらう');
    expect(plain).not.toContain('advisor');
  });

  it('trioAdvisor のときは、今までの指示文の後ろに段落を足すだけ', () => {
    const plain = characterSystemPrompt(BASE);
    expect(characterSystemPrompt({ ...BASE, trioAdvisor: true })).toBe(plain + TRIO_ADVISOR_PROMPT);
  });

  it('段落：道具の名前・1 回まで・使わない頼みに従うこと・先生に向けた一文が入り、「必ず」は無い', () => {
    for (const word of ['advisor', '1つの返事で1回まで', '先生を使わないでください', '先生へ']) expect(TRIO_ADVISOR_PROMPT).toContain(word);
    expect(TRIO_ADVISOR_PROMPT).not.toContain('必ず');
  });

  it('ハイク組の取次の先生（ask_advisor）の段落とは別（両方は付かないが、付けても混ざらない）', () => {
    const haiku = characterSystemPrompt({ ...BASE, advisor: true });
    expect(haiku).toContain('ask_advisor');
    expect(haiku).not.toContain('先生に見てもらう');
  });
});
