// フェイブルレター：フェイブルが一時的に進化して（考える深さ max）深く考えた返事で、あとで読み返す価値のある考察を、
// 題名と短い手紙にして提案する。残すかどうかは使う人が決める
//   ・残したレターは右サイドバーが持つ（ui-data\letters.json）。一覧から、盤面に置く・コピー・教材にする（単語帳）
//   ・提案するかどうかの判定（LetterJudge）は差し替えられる。今はフェイブル自身の判断だけ（ほかの方式の案は docs/ideas-next.md）
//   ・レターは3段：3行の要点 → 手紙 → 元の会話（残したときの、使う人の発言とフェイブルの返事）
//   ・「公開してよい」の印（使う人だけが付ける）を付けたレターは、右サイドバーの上の「月の窓」に映る
import type Anthropic from '@anthropic-ai/sdk';
import { readData, writeData } from '../data';
import { parseAuthor, type ReplyAuthor } from '../threads';

export const PROPOSE_LETTER = 'propose_letter'; // 前の形（題名と手紙）。この形で話し始めた会話のためだけに残す
export const PROPOSE_LETTER_V2 = 'propose_letter_v2'; // 今の形（題名・3行の要点・手紙）
export const MAX_LETTERS = 500;
export const MAX_LETTER_TITLE = 40;
export const MAX_LETTER_BODY = 800;
export const MAX_LETTER_POINT = 60; // 要点の1行
const MAX_CHAT_QUESTION = 2000;
const MAX_CHAT_REPLY = 8000;
const FILE = 'letters.json';

// フェイブルの道具：レターを提案する（ここでは見せるだけ。残すかどうかは使う人が画面で決める）
//   道具の文は、会話の途中で変えると考えた跡が使えなくなる。形を変えるときは、新しい名前の道具を足し、前の道具はそのまま残す
//   前の形：この道具で話し始めた会話でだけ渡す（文を変えない）
export const PROPOSE_LETTER_TOOL: Anthropic.Beta.BetaTool = {
  name: PROPOSE_LETTER,
  description:
    '一時的に進化して深く考えた返事の中で、使う人があとで読み返す価値のある洞察が得られたときだけ、それを「フェイブルレター」（題名と短い手紙）にして使う人に提案します。残すかどうかは使う人が決めます。title は20字ほどの題名、body はあなたの語り口で書く400字ほどの手紙（使う人に宛てて）。ふだんの深さの返事では使えません。1つの返事で1回まで。',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '題名（20字ほど）' },
      body: { type: 'string', description: '手紙の本文（400字ほど）' },
    },
    required: ['title', 'body'],
  },
};

// 今の形：題名・3行の要点・手紙
export const PROPOSE_LETTER_V2_TOOL: Anthropic.Beta.BetaTool = {
  name: PROPOSE_LETTER_V2,
  description:
    '一時的に進化して深く考えた返事の中で、使う人があとで読み返す価値のある洞察が得られたときだけ、それを「フェイブルレター」にして使う人に提案します。残すかどうかは使う人が決めます。レターは3段で読まれます：まず points（3行の要点）、次に body（手紙）、読みたい人はその次に元の会話。title は20字ほどの題名。points はちょうど3つの短い行（それぞれ30字ほど）で、1行目は何について考えたか、2行目は気づいたこと、3行目は次に試せることか、残る問い。body はあなたの語り口で、使う人に宛てた400字ほどの手紙。ふだんの深さの返事では使えません。1つの返事で1回まで。',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '題名（20字ほど）' },
      points: {
        type: 'array',
        items: { type: 'string' },
        description: '3行の要点（ちょうど3つ。何について考えたか・気づいたこと・次に試せることか残る問い）',
      },
      body: { type: 'string', description: '手紙の本文（400字ほど）' },
    },
    required: ['title', 'points', 'body'],
  },
};

// レターを提案する道具か（前の形・今の形）
export const isLetterTool = (name: string) => name === PROPOSE_LETTER || name === PROPOSE_LETTER_V2;

export interface LetterProposal {
  title: string;
  points?: string[]; // 3行の要点（前の形のレターには無い）
  body: string;
}

// 元の会話（レターを残したときの、使う人の発言と、キャラの返事）
export interface LetterChat {
  question: string;
  reply: string;
}

export interface Letter extends LetterProposal {
  id: string;
  by: ReplyAuthor; // 書いたキャラ
  createdAt: number;
  conversationId?: string; // 提案された会話
  question?: string; // 提案のもとになった、使う人の発言
  pageTitle?: string;
  pageUrl?: string;
  studied?: number; // 教材にして、単語帳に入れたカードの数
  studiedFronts?: string[]; // 教材にして入れたカードの表（同じカードを数え直さない・作り直さない）
  chat?: LetterChat; // 元の会話（前に残したレターには無い。そのときは会話を開いて見る）
  publishable?: boolean; // 公開してよい（使う人だけが付ける）。付けたものが「月の窓」に映る
}

// 提案の判定。ok でなければ使う人には見せない。mark は提案に添える印（今は使っていない。ジンが確かめた印などの案）
export interface LetterVerdict {
  ok: boolean;
  mark?: string;
  reason?: string;
}
export type LetterJudge = (proposal: LetterProposal, context: { speakerName: string }) => Promise<LetterVerdict>;

// 今の判定：フェイブル自身が「提案する」と決めたら、そのまま使う人に見せる
export const selfJudge: LetterJudge = async () => ({ ok: true });

// 道具の入力から、提案の題名・要点・本文を取り出す（長すぎる分は切る。題名か本文が空なら null。要点は3つまで、無くてもよい）
export function cleanProposal(input: unknown): LetterProposal | null {
  const r = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const clip = (v: unknown, max: number) => (typeof v === 'string' ? [...v.replace(/\r\n?/g, '\n').trim()].slice(0, max).join('').trim() : '');
  const title = clip(r.title, MAX_LETTER_TITLE).replace(/\s*\n\s*/g, ' ');
  const body = clip(r.body, MAX_LETTER_BODY);
  const points = (Array.isArray(r.points) ? r.points : [])
    .map((p) => clip(p, MAX_LETTER_POINT).replace(/\s*\n\s*/g, ' ').replace(/^(?:[・\-*•]\s*|\d{1,2}[.)）](?!\d)\s*|[（(]\d{1,2}[)）]\s*)/, '').trim())
    .filter(Boolean)
    .slice(0, 3);
  return title && body ? { title, ...(points.length > 0 ? { points } : {}), body } : null;
}

// 元の会話を、残せる長さにする（無ければ undefined）
export function cleanChat(question: string | undefined, reply: string | undefined): LetterChat | undefined {
  const clip = (v: string | undefined, max: number) => [...(v ?? '').trim()].slice(0, max).join('');
  const chat = { question: clip(question, MAX_CHAT_QUESTION), reply: clip(reply, MAX_CHAT_REPLY) };
  return chat.reply ? chat : undefined;
}

// レターを、メモのセルの文章にする（最初の行が題名＝メモの見出しになる）
export function letterText(letter: Pick<Letter, 'title' | 'points' | 'body' | 'by' | 'createdAt'>): string {
  const d = new Date(letter.createdAt);
  const points = letter.points?.length ? `${letter.points.map((p) => `・${p}`).join('\n')}\n\n` : '';
  return `${letter.title}\n\n${points}${letter.body}\n\n— ${letter.by.name}（${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}）`;
}

export class LetterStore {
  private letters: Letter[] = []; // 新しい順
  private readonly listeners: (() => void)[] = [];
  private loaded = false;
  private saveTimer = 0;

  async load() {
    const saved = await readData<{ version?: unknown; letters?: unknown }>(FILE);
    if (saved && saved.version === 1 && Array.isArray(saved.letters)) {
      const seen = new Set<string>();
      this.letters = saved.letters
        .map(parseLetter)
        .filter((l): l is Letter => !!l && !seen.has(l.id) && !!seen.add(l.id))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_LETTERS);
    }
    this.loaded = true;
    this.emit();
  }

  get ready() {
    return this.loaded;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  list(): readonly Letter[] {
    return this.letters;
  }

  get(id: string | undefined) {
    return id ? this.letters.find((l) => l.id === id) : undefined;
  }

  get full() {
    return this.letters.length >= MAX_LETTERS;
  }

  // 残す（いっぱいなら null。古いレターを勝手に消さない）
  add(draft: Omit<Letter, 'id' | 'createdAt'>): Letter | null {
    if (this.full) return null;
    const letter: Letter = { ...draft, id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now() };
    this.letters.unshift(letter);
    this.changed();
    return letter;
  }

  // 教材にして単語帳に入れたカード（このレターから初めて入れたものだけ数える）。新しく数えた枚数を返す
  markStudied(id: string, fronts: string[]): number {
    const letter = this.get(id);
    if (!letter) return 0;
    const known = new Set(letter.studiedFronts ?? []);
    const fresh = [...new Set(fronts)].filter((f) => f && !known.has(f));
    if (fresh.length === 0) return 0;
    letter.studied = (letter.studied ?? 0) + fresh.length;
    letter.studiedFronts = [...known, ...fresh].slice(-100);
    this.changed();
    return fresh.length;
  }

  // 公開してよい（月の窓に映す）の印。使う人だけが付ける
  setPublishable(id: string, on: boolean) {
    const letter = this.get(id);
    if (!letter || !!letter.publishable === on) return;
    if (on) letter.publishable = true;
    else delete letter.publishable;
    this.changed();
  }

  remove(id: string) {
    const before = this.letters.length;
    this.letters = this.letters.filter((l) => l.id !== id);
    if (this.letters.length !== before) this.changed();
  }

  private changed() {
    this.emit();
    if (!this.loaded) return; // 読み込む前に書くと、前のレターを消してしまう
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void writeData(FILE, { version: 1, letters: this.letters }), 300);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

function parseLetter(raw: unknown): Letter | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const proposal = cleanProposal(r);
  const by = parseAuthor(r.by);
  if (typeof r.id !== 'string' || !proposal || !by) return null;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
  const pageUrl = typeof r.pageUrl === 'string' && /^https?:\/\//i.test(r.pageUrl) ? r.pageUrl.slice(0, 2000) : undefined;
  return {
    id: r.id,
    ...proposal,
    by: { who: by.who, name: by.name },
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
    conversationId: str(r.conversationId, 40),
    question: str(r.question, 200),
    pageTitle: str(r.pageTitle, 200),
    pageUrl,
    studied: typeof r.studied === 'number' && Number.isFinite(r.studied) && r.studied > 0 ? Math.round(r.studied) : undefined,
    studiedFronts: Array.isArray(r.studiedFronts) ? r.studiedFronts.filter((f): f is string => typeof f === 'string').map((f) => f.slice(0, 200)).slice(-100) : undefined,
    chat: parseChat(r.chat),
    publishable: r.publishable === true ? true : undefined,
  };
}

function parseChat(raw: unknown): LetterChat | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const c = raw as Record<string, unknown>;
  return cleanChat(typeof c.question === 'string' ? c.question : '', typeof c.reply === 'string' ? c.reply : '');
}
