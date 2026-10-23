// 相棒への頼みごとのボタン：6つで1組の「セット」（いくつでも作って切り替える）と、「その他」の文言の一覧。
// 保存先は ui-data\phrases.json（右サイドバーだけが使う）
import { readData, writeData } from '../data';

// summarize・explain・quiz：決まった頼み方（要約・選んだ言葉の解説・クイズ）
// send：文言をそのまま相棒に送る　fill：文言を入力欄に入れる（続きを書いてから送る）
export type PhraseKind = 'summarize' | 'explain' | 'quiz' | 'send' | 'fill';

export interface Phrase {
  label: string; // ボタンに出す名前
  kind: PhraseKind;
  text: string; // send・fill の文言
  page: boolean; // send のとき、表示中のページを添える
}

export interface PhraseSet {
  id: string;
  name: string;
  buttons: (Phrase | null)[]; // いつも6つ（null は空き）
}

export interface PhraseBook {
  version: 1;
  current: string; // 使っているセット
  sets: PhraseSet[];
  others: Phrase[];
}

export const BUTTONS = 6;
export const MAX_SETS = 12;
export const MAX_OTHERS = 40;
export const LABEL_MAX = 14;
export const TEXT_MAX = 1000;

export const KIND_LABELS: Record<PhraseKind, string> = {
  send: '文言を送る',
  fill: '入力欄に入れる（送らない）',
  summarize: 'このページを要約',
  explain: '選んだ言葉を解説',
  quiz: 'クイズ',
};

// 編集の欄で選ぶときの短い名前
export const KIND_SHORT: Record<PhraseKind, string> = {
  send: '文言を送る',
  fill: '入力欄へ',
  summarize: '要約',
  explain: '解説',
  quiz: 'クイズ',
};

export const isFixed = (kind: PhraseKind) => kind === 'summarize' || kind === 'explain' || kind === 'quiz';

const FILE = 'phrases.json';
const KINDS: PhraseKind[] = ['send', 'fill', 'summarize', 'explain', 'quiz'];

const send = (label: string, text: string, page = true): Phrase => ({ label, kind: 'send', text, page });
const fixed = (label: string, kind: PhraseKind): Phrase => ({ label, kind, text: '', page: true });

export function defaultBook(): PhraseBook {
  return {
    version: 1,
    current: 'usual',
    sets: [
      {
        id: 'usual',
        name: 'いつもの',
        buttons: [
          fixed('ページを要約', 'summarize'),
          fixed('言葉を解説', 'explain'),
          fixed('クイズ', 'quiz'),
          send('要点を3つ', 'このページの要点を3つ、短くまとめてください。'),
          send('やさしく', 'このページの内容を、中学生にもわかる言葉で説明してください。'),
          send('別の見方', 'このページの主張に対する反論や、別の見方を教えてください。'),
        ],
      },
      {
        id: 'learn',
        name: '学ぶ',
        buttons: [
          send('ことばを3つ', 'このページで覚えておくとよい言葉を3つ、意味と一緒に教えてください。'),
          fixed('クイズ', 'quiz'),
          send('身近な例', 'このページの内容について、身近な例を1つ出してください。'),
          send('なぜ？', 'このページで説明されていることは、なぜそうなるのですか？'),
          { label: 'わたしの理解', kind: 'fill', text: 'わたしの理解では、', page: true },
          send('次に読むなら', 'このページの続きを調べるなら、どんな言葉で探すとよいですか？'),
        ],
      },
    ],
    others: [
      send('もっとくわしく', 'さっきの説明を、もう少しくわしく教えてください。', false),
      send('一言でいうと？', 'このページを一言でいうと？'),
      send('英語で言うと？', '今の話を英語で言うと、どうなりますか？', false),
      send('ありがとう！', 'ありがとう！', false),
    ],
  };
}

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

// 表示名が空なら、文言の頭から作る
export function labelOf(p: Pick<Phrase, 'label' | 'kind' | 'text'>) {
  const label = clean(p.label, LABEL_MAX);
  if (label) return label;
  if (isFixed(p.kind)) return KIND_LABELS[p.kind];
  const text = p.text.replace(/\s+/g, ' ').trim();
  return [...text].length > LABEL_MAX ? `${[...text].slice(0, LABEL_MAX - 1).join('')}…` : text;
}

// 読み込んだもの（や編集したもの）を、使える形にそろえる。使えないものは null
export function parsePhrase(v: unknown): Phrase | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const kind = KINDS.includes(r.kind as PhraseKind) ? (r.kind as PhraseKind) : 'send';
  const text = isFixed(kind) ? '' : clean(r.text, TEXT_MAX);
  if (!isFixed(kind) && !text) return null;
  const p: Phrase = { label: '', kind, text, page: r.page !== false };
  p.label = labelOf({ label: clean(r.label, LABEL_MAX), kind, text });
  return p;
}

export function normalizeBook(v: unknown): PhraseBook {
  const fallback = defaultBook();
  if (typeof v !== 'object' || v === null) return fallback;
  const r = v as Record<string, unknown>;
  const sets: PhraseSet[] = (Array.isArray(r.sets) ? r.sets : [])
    .map((s: unknown, i: number) => {
      const o = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
      const raw = Array.isArray(o.buttons) ? o.buttons : [];
      const buttons = Array.from({ length: BUTTONS }, (_, k) => parsePhrase(raw[k]));
      return { id: clean(o.id, 40) || `s${i}`, name: clean(o.name, 20) || `セット${i + 1}`, buttons };
    })
    .slice(0, MAX_SETS);
  if (sets.length === 0) return fallback;
  const others = (Array.isArray(r.others) ? r.others : []).map(parsePhrase).filter((p): p is Phrase => p !== null).slice(0, MAX_OTHERS);
  const current = sets.some((s) => s.id === r.current) ? (r.current as string) : sets[0].id;
  return { version: 1, current, sets, others };
}

export async function loadPhrases(): Promise<PhraseBook> {
  return normalizeBook(await readData<unknown>(FILE));
}

export function savePhrases(book: PhraseBook) {
  return writeData(FILE, book);
}

export const newSetId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
