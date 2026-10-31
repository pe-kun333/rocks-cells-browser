// 段 D7：書き足した画像を、同じメモの新しい一番上のカードにする計画。DOM も台帳も知らない。
//   書き足した版（印が 1 つ以上）だけ置く。元の画像を選んだ・印が無いときは置かない（元の複製は作らない）。
//   書いた人の印は付けない。parent は呼ぶ側が null にする。rank も引用も付けない。
//   元が一番上のカードなら、そのカードから新しいカードへ関連を 1 本（種類は補足）。すでに 10 本なら、カードも線も置かない。
//   下の返信・メモのセルの顔は、カードだけ置く（線は付けない。関連の上限では断らない）。
//   箱の問いは行のまま。制御文字は消し、HTML のタグは文字のまま残す。空の行は捨て、9 行・1 行 200 字まで。
import { cleanBotLine } from './bot-replies';
import { MAX_LINKS_PER_CARD } from './memo-card-links';
import { MAX_REPLIES } from './threads';

const QUESTION_LINE_MAX = 200;
const QUESTION_LINES_MAX = 9;

export const isShotImageId = (id: string) => id.length <= 64 && /^shot[0-9a-z]+$/.test(id);

export interface AnnotatedCardSource {
  id: string;
  parent: string | null;
  links?: readonly { to: string }[];
}

export interface AnnotatedCardMemo {
  id: string;
  replies: readonly AnnotatedCardSource[];
}

export type AnnotatedCardPlan =
  | { ok: true; memo: string; text: string; link: { from: string; kind: 'supplement' } | null }
  | { ok: false; note: string };

const NONE = '書き足しが無いので、足しませんでした';
const MISSING = '元のカードが見つかりません';
const GONE = 'その画像は、もうありません';

// 箱の問いを、カードの文にする（制御文字は消える。タグは残る）
export function annotatedQuestionText(raw: string): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => [...cleanBotLine(line)].slice(0, QUESTION_LINE_MAX).join(''))
    .filter(Boolean)
    .slice(0, QUESTION_LINES_MAX)
    .join('\n');
}

export function planAnnotatedCard(input: {
  version: 'annotated' | 'original';
  marks: number;
  questions: string;
  source: { kind: 'card'; reply: string } | { kind: 'face' };
  memoId: string;
  memo: AnnotatedCardMemo | null;
}): AnnotatedCardPlan {
  if (input.version !== 'annotated' || input.marks < 1) return { ok: false, note: NONE };
  const text = annotatedQuestionText(input.questions);
  const memo = input.memo && input.memo.id === input.memoId ? input.memo : null;
  if (!memo) return { ok: false, note: input.source.kind === 'face' ? GONE : MISSING };
  if (memo.replies.length >= MAX_REPLIES) return { ok: false, note: `返信は1つのメモに ${MAX_REPLIES} 件までです` };
  const from = input.source;
  if (from.kind === 'face') return { ok: true, memo: memo.id, text, link: null };
  const source = memo.replies.find((reply) => reply.id === from.reply);
  if (!source) return { ok: false, note: MISSING };
  if (source.parent !== null) return { ok: true, memo: memo.id, text, link: null };
  if ((source.links ?? []).length >= MAX_LINKS_PER_CARD) return { ok: false, note: `関連は 1 枚のカードから ${MAX_LINKS_PER_CARD} 本までです` };
  return { ok: true, memo: memo.id, text, link: { from: source.id, kind: 'supplement' } };
}
