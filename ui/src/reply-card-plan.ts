// 段 D6：返事を新しい一番上のカードにする計画。DOM も台帳も知らない。
//   本文は cleanBotText のあと 20,000 字まで（grok-patch の card.add と同じ上限）。超えたら切らずに断る。
//   書いた人は「Grok Bot」。元のカードから新しいカードへ、関連を 1 本（種類は補足）足す計画を返す。
//   元が無い・一番上のカードでない・返信が 300 件・関連が 10 本なら、置く計画にしない（台帳は呼ぶ側が何も書かない）。
import { t } from './i18n';
import { cleanBotText } from './bot-replies';
import { MAX_LINKS_PER_CARD } from './memo-card-links';
import { MAX_REPLIES } from './threads';

export const REPLY_CARD_TEXT_MAX = 20_000;

export const REPLY_CARD_BY = { who: 'bot', name: 'Grok Bot' } as const;

export interface ReplyCardSource {
  id: string;
  parent: string | null;
  links?: readonly { to: string }[];
}

export interface ReplyCardMemo {
  id: string;
  replies: readonly ReplyCardSource[];
}

export type ReplyCardPlan =
  | {
      ok: true;
      memo: string;
      text: string;
      by: { who: 'bot'; name: 'Grok Bot' };
      link: { from: string; kind: 'supplement' };
    }
  | { ok: false; note: string };

const MISSING = t('元のカードが見つかりません');

export function planReplyCard(input: { text: string; origin: { memo: string; reply: string } | null; memo: ReplyCardMemo | null }): ReplyCardPlan {
  const origin = input.origin;
  const memo = input.memo;
  const source = origin && memo && memo.id === origin.memo ? memo.replies.find((reply) => reply.id === origin.reply) : undefined;
  if (!origin || !memo || !source || source.parent !== null) return { ok: false, note: MISSING };
  const text = cleanBotText(input.text);
  if (!text) return { ok: false, note: t('返事の文がありません') };
  if ([...text].length > REPLY_CARD_TEXT_MAX) return { ok: false, note: t('返事が長すぎます（{0} 字まで）', { 0: REPLY_CARD_TEXT_MAX.toLocaleString('ja-JP') }) };
  if (memo.replies.length >= MAX_REPLIES) return { ok: false, note: t('返信は1つのメモに {0} 件までです', { 0: MAX_REPLIES }) };
  if ((source.links ?? []).length >= MAX_LINKS_PER_CARD) return { ok: false, note: t('関連は 1 枚のカードから {0} 本までです', { 0: MAX_LINKS_PER_CARD }) };
  return { ok: true, memo: memo.id, text, by: { who: REPLY_CARD_BY.who, name: REPLY_CARD_BY.name }, link: { from: source.id, kind: 'supplement' } };
}
