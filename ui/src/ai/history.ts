// 会話の保存（UI の保存場所の conversations\ に、会話ごとに1ファイル。目次は index.json）
import type Anthropic from '@anthropic-ai/sdk';
import { deleteData, readData, writeData } from '../data';
import type { ChatEntry } from './companion';

export interface SavedConversation {
  version: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  totalCost: number;
  system?: string; // この会話で使った指示文（続きを話すときも同じものを使う）
  history: Anthropic.Beta.BetaMessageParam[]; // Claude に送る履歴（考えた跡も含めて、そのまま）
  entries: ChatEntry[]; // 画面に出す記録
  sentPages: [string, string][]; // 送ったページ（URL と本文の指紋）
  // Claude 以外のキャラの、それぞれの会話の流れ（Claude とは別に持つ。キーはキャラの id）
  voices?: Record<string, SavedVoice>;
  shared?: SharedLine[]; // この会話であったこと（キャラどうしで聞かせ合う記録）
  heard?: Record<string, number>; // キャラごとに、shared のどこまで聞いたか（seq）
  teamTurn?: number; // ハイク組が2つの班で話すとき、次に「ハイク組へ」「みんなへ」に答える班
  banterTurn?: number; // 同じく、次に掛け合いでひとこと返す班
  // 前の形（二人目の相棒まで）。読むときだけ使う
  backlog?: string[]; // Claude がまだ聞いていない、二人目の相棒とのやりとり
  second?: SavedVoice & { backlog: string[] };
}

export interface SavedVoice {
  system: string;
  name?: string; // この会話での名前（指示文を作ったときの名前）
  deeper?: boolean; // この会話で、進化の合図の道具を渡している（前の形。今は tools に入る）
  tools?: string[]; // この会話で、そのキャラに渡している道具の名前（会話の途中では変えない）
  model?: string; // この会話で、そのキャラが使うモデル（初めて話したときに決め、会話の途中では変えない。無ければ今の設定）
  history: Anthropic.Beta.BetaMessageParam[];
  sentPages: [string, string][];
}

// キャラどうしで聞かせ合う、会話の記録の1行
export interface SharedLine {
  seq: number;
  from: string; // 話したキャラの id（使う人・出来事は 'user'）
  text: string;
  except?: string[]; // 聞かせないキャラ（その場で直接聞いたキャラ）
  only?: string[]; // このキャラだけに聞かせる（前の形から読んだ行）
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  totalCost: number;
  turns: number;
}

const INDEX = 'conversations/index.json';
const MAX_KEPT = 200;
let queue: Promise<unknown> = Promise.resolve(); // 目次の書き換えが重ならないように順番に

export function newConversationId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function loadIndex(): Promise<ConversationSummary[]> {
  const index = await readData<ConversationSummary[]>(INDEX);
  return Array.isArray(index) ? index : [];
}

export async function loadConversation(id: string): Promise<SavedConversation | null> {
  const saved = await readData<SavedConversation>(`conversations/${id}.json`);
  return saved && saved.version === 1 && Array.isArray(saved.history) && Array.isArray(saved.entries) ? saved : null;
}

export function saveConversation(conversation: SavedConversation): Promise<unknown> {
  queue = queue.then(async () => {
    await writeData(`conversations/${conversation.id}.json`, conversation);
    const summary: ConversationSummary = {
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      totalCost: conversation.totalCost,
      turns: conversation.entries.filter((e) => e.role === 'user').length,
    };
    const index = (await loadIndex()).filter((s) => s.id !== conversation.id);
    index.unshift(summary);
    for (const old of index.splice(MAX_KEPT)) deleteData(`conversations/${old.id}.json`);
    await writeData(INDEX, index);
  });
  return queue;
}

export function deleteConversation(id: string): Promise<unknown> {
  queue = queue.then(async () => {
    deleteData(`conversations/${id}.json`);
    await writeData(
      INDEX,
      (await loadIndex()).filter((s) => s.id !== id),
    );
  });
  return queue;
}

// 本文の指紋（同じページの同じ本文かどうかを見分けるだけ。FNV-1a）
export function fingerprint(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
