// 「下書き n」の数え方（帯・殻・札で一つ。計画 §3）
//   ・「送った:」の無いカード
//   ・順番待ちのうち、カードのいちばん新しい「送った:」が gN の組に入っていないもの
//   1 件ずつの順番待ち（組が無い）は、段 5 まではいつも数える
import { parseSent } from './grok-cards-tags';

export interface CountCard {
  tags: readonly string[];
}

export interface CountQueue {
  id: string;
  group?: number;
}

export function draftCount(cards: readonly CountCard[], queue: readonly CountQueue[]): number {
  const linked = new Set<number>();
  let unsent = 0;
  for (const card of cards) {
    const sent = parseSent(card.tags);
    if (!sent) {
      unsent += 1;
      continue;
    }
    if (sent.group !== null) linked.add(sent.group);
  }
  let waiting = 0;
  for (const item of queue) {
    if (item.group === undefined || !linked.has(item.group)) waiting += 1;
  }
  return unsent + waiting;
}

// 0 の側は出さない。両方 0 なら空（静か）
export function countLine(drafts: number, replies: number): string {
  const parts: string[] = [];
  if (drafts > 0) parts.push(`下書き ${drafts}`);
  if (replies > 0) parts.push(`返事 ${replies}`);
  return parts.join('・');
}
