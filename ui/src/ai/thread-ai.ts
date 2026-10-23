// コメントのスレッドに、相棒（今の会話のメンバー）が返信を1つ書く。左サイドバー（メモとタブの持ち主）で動かす
//   ・1回ごとに独立した頼み方（会話の流れは持たない）。スレッドの流れは <thread> に入れて渡す
//   ・キーと設定は、右の相棒と同じもの（キーは C++ から、設定は localStorage の honeycomb.ai）
import { BLOCK_NOTE, pageIsBlocked } from '../blocklist';
import { childrenOf, pathTo, type Reply } from '../threads';
import { type Cast, type CharacterId, effortOf, MAIN_NAME, modelOf, nameOf, parseCast, personaOf } from './characters';
import { costOf, createTransport, MODELS, type ModelId } from './client';
import { MAIN_PERSONA, nowLine, threadReplySystemPrompt } from './prompts';

export interface AiSettings {
  apiKey: string | null;
  practice: boolean;
  model: ModelId; // Claude のモデル（⚙ で選んだもの）
  cast: Cast;
}

// スレッドの元のポスト
export interface ThreadPost {
  text: string;
  createdAt: number;
  author: string; // 書いた人（使う人・AI（要約）など）
  context: string; // どこのコメントか（メモのセル・ページ「…」のメモ）
}

export interface WrittenReply {
  text: string;
  model: string;
  cost: number;
}

export class ThreadReplyError extends Error {}

const MAX_POST = 3000;
const MAX_LINE = 800;
const MAX_QUOTE = 300; // 引用の文（題名・アドレスは別に、文だけ切る）
const MAX_SIBLINGS = 10;

// 右の相棒の設定を読む（キーは別に渡す）
export function readAiSettings(apiKey: string | null): AiSettings {
  let saved: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem('honeycomb.ai') ?? '{}');
    if (typeof raw === 'object' && raw !== null) saved = raw as Record<string, unknown>;
  } catch {
    // 読めなければ初期の設定
  }
  return {
    apiKey,
    practice: saved.practice === true,
    model: MODELS.some((m) => m.id === saved.model) ? (saved.model as ModelId) : MODELS[0].id,
    cast: parseCast(saved),
  };
}

// who が、parent（null は元のポスト）への返信を1つ書く
export async function writeThreadReply(post: ThreadPost, replies: readonly Reply[], parent: string | null, who: CharacterId, settings: AiSettings): Promise<WrittenReply> {
  const transport = createTransport(settings.apiKey, settings.practice);
  if (!transport) throw new ThreadReplyError('API キーを設定すると、相棒が返信できます（右の相棒の ⚙ から）');
  const name = nameOf(settings.cast, who);
  const persona = who === 'main' ? MAIN_PERSONA : personaOf(settings.cast, who);
  const model = modelOf(settings.cast, who, settings.model);
  const result = await transport.reply({
    model,
    system: threadReplySystemPrompt(name, persona),
    messages: [{ role: 'user', content: [{ type: 'text', text: await threadPrompt(post, replies, parent, who, name) }] }],
    cache: false, // 1回きり（同じ前の部分で、もう一度頼むことはない）
    effort: effortOf(who),
    onText: () => undefined,
    signal: new AbortController().signal,
  });
  if (result.stopReason === 'refusal') throw new ThreadReplyError(`${name}は、この内容には返信できませんでした`);
  // 名前の前置き（「ルカ：」）が付いていたら外す
  const text = result.text.trim().replace(new RegExp(`^${escapeRegExp(name)}\\s*[：:]\\s*`), '');
  if (!text) throw new ThreadReplyError(`${name}の返信が空でした`);
  return { text, model: result.model, cost: transport.practice ? 0 : costOf(result.usage, result.model) };
}

// 引用を1行にする。渡し止めのサイトは、題名・アドレス・文を渡さず BLOCK_NOTE（呼ぶ直前に読み直す）
async function quoteLine(reply: Reply): Promise<string | null> {
  const quote = reply.quote;
  if (!quote) return null;
  if (await pageIsBlocked(quote.url)) return BLOCK_NOTE;
  const title = quote.title.trim() || 'ページ';
  return `引用（${title}）：${clip(quote.text, MAX_QUOTE)}`;
}

// スレッドの流れ（元のポスト → 返信先までの道 → 返信先にもう付いている返信）
//   引用は「引用（題名）：文」の1行。画像と、書き出したファイルは渡さない
export async function threadPrompt(post: ThreadPost, replies: readonly Reply[], parent: string | null, who: CharacterId, name: string): Promise<string> {
  const authorOf = (r: Reply) => (r.by ? (r.by.who === who ? `${r.by.name}（あなた）` : r.by.name) : '使う人');
  const line = (author: string, at: number, text: string, mark: boolean) =>
    `${mark ? '→ ' : '・'}${author}（${dateOf(at)}）：${clip(text, MAX_LINE)}`;
  const push = async (parts: string[], reply: Reply, mark: boolean) => {
    parts.push(line(authorOf(reply), reply.createdAt, reply.text, mark));
    const quoted = await quoteLine(reply);
    if (quoted) parts.push(quoted);
  };
  const path = pathTo(replies, parent);
  const siblings = childrenOf(replies, parent).slice(-MAX_SIBLINGS);
  const parts = [
    `元のポスト［${post.context}］${parent === null ? '（→ これに返信する）' : ''}`,
    `${post.author}（${dateOf(post.createdAt)}）：${clip(post.text, MAX_POST)}`,
  ];
  if (path.length > 0) {
    parts.push('', '返信の流れ（上から順に。→ が返信する相手）');
    for (let i = 0; i < path.length; i++) await push(parts, path[i], i === path.length - 1);
  }
  if (siblings.length > 0) {
    parts.push('', '返信する相手に、もう付いている返信（同じことは書かない）');
    for (const r of siblings) await push(parts, r, false);
  }
  const body = parts.join('\n').replaceAll('</thread>', '</ thread>');
  const target = parent === null ? '元のポスト' : '→ の付いた返信';
  return `${nowLine()}
<thread>
${body}
</thread>
${target}に、${name === MAIN_NAME ? 'いつもの相棒の Claude' : name}として返信を1つ書いてください。`;
}

// 文字（コードポイント）で切る（絵文字の半分だけが残ると、API が読めない）
function clip(text: string, max: number) {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dateOf(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
