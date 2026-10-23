// 単語カードの「表示だけ」の計算（K5a。docs/plan-cards.md §5 の 20〜24）
//   台帳は変えない。DOM も使わない（vitest で確かめる）
import type { CardKind, VocabCard } from './vocab';

const DAY = 24 * 60 * 60_000;

// ---------- 例文の伏せ方 ----------

export interface ClozePart {
  text: string;
  hidden: boolean; // 伏せる（押すと見える）
}

// 例文の中の表の言葉を伏せる（大文字小文字は同じに見る）。問いのカードは伏せない
//   英字の言葉は、前に英字が続くところ（語の途中）では伏せない。後ろは続いてよい（runs・glanceable の頭も伏せる）
export function clozeParts(example: string, front: string, kind: CardKind): ClozePart[] {
  const word = front.trim();
  if (kind === 'quiz' || !word || word.length > example.length) return [{ text: example, hidden: false }];
  const latin = /^[A-Za-z][A-Za-z' -]*$/.test(word);
  const pattern = new RegExp(`${latin ? '(?<![A-Za-z])' : ''}${escapeRegExp(word)}`, 'giu');
  const parts: ClozePart[] = [];
  let at = 0;
  for (const m of example.matchAll(pattern)) {
    const start = m.index ?? 0;
    if (start > at) parts.push({ text: example.slice(at, start), hidden: false });
    parts.push({ text: m[0], hidden: true });
    at = start + m[0].length;
  }
  if (at < example.length || parts.length === 0) parts.push({ text: example.slice(at), hidden: false });
  return parts;
}

export const hasCloze = (parts: readonly ClozePart[]) => parts.some((p) => p.hidden);

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- 向き（逆向きは回だけ） ----------

// 逆向き：言葉のカードは裏を見せて表を答える。問いのカードは向きを変えない
export function promptSide(card: Pick<VocabCard, 'kind' | 'front' | 'back'>, reverse: boolean): { prompt: string; answer: string; reversed: boolean } {
  return reverse && card.kind === 'word' ? { prompt: card.back, answer: card.front, reversed: true } : { prompt: card.front, answer: card.back, reversed: false };
}

// ---------- 打って答える ----------

export interface TypedPart {
  text: string;
  ok: boolean; // 答えの同じ位置の文字と合う（金）／合わない（赤）
}

// 打った文字を、答えの同じ位置の文字と比べる（NFKC・大文字小文字・空白の続きはならす）。表示だけ（評価は人が付ける）
export function compareTyped(typed: string, answer: string): { parts: TypedPart[]; exact: boolean } {
  const a = normChars(answer);
  const t = normChars(typed);
  const parts: TypedPart[] = [];
  t.forEach((ch, i) => {
    const ok = a[i] === ch;
    const last = parts[parts.length - 1];
    if (last && last.ok === ok) last.text += ch;
    else parts.push({ text: ch, ok });
  });
  return { parts, exact: t.length > 0 && t.length === a.length && t.every((ch, i) => ch === a[i]) };
}

function normChars(text: string): string[] {
  return [...text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()];
}

// ---------- 選ぶ（4 択。練習として扱い、正解に評価は付けない） ----------

export interface Choices {
  options: string[]; // 4 つ
  answer: number; // 正しいものの位置
}

// 混ぜる 3 つは、同じ種類・同じ出典・同じ度合いのカードの答えを先に取る（足りなければほかから）
//   答えが重なるものは一つにする。3 つ取れなければ null（ボタンを出さない）
export function pickChoices(card: VocabCard, cards: readonly VocabCard[], reverse = false, random: () => number = Math.random): Choices | null {
  const answerOf = (c: VocabCard) => promptSide(c, reverse).answer;
  const correct = answerOf(card);
  const seen = new Set([normKey(correct)]);
  const ranked = cards
    .filter((c) => c.id !== card.id)
    .map((c) => ({
      text: answerOf(c),
      score: (c.kind === card.kind ? 4 : 0) + (sameSource(c, card) ? 2 : 0) + (c.level === card.level ? 1 : 0),
      tie: random(),
    }))
    .sort((a, b) => b.score - a.score || a.tie - b.tie);
  const others: string[] = [];
  for (const r of ranked) {
    const key = normKey(r.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    others.push(r.text);
    if (others.length === 3) break;
  }
  if (others.length < 3) return null;
  const answer = Math.min(3, Math.floor(random() * 4));
  const options = [...others];
  options.splice(answer, 0, correct);
  return { options, answer };
}

function normKey(text: string) {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function sameSource(a: Pick<VocabCard, 'source'>, b: Pick<VocabCard, 'source'>) {
  if (!a.source || !b.source) return false;
  return a.source.url.split('#')[0] === b.source.url.split('#')[0];
}

// ---------- 暦の予報 ----------

export interface ForecastDay {
  start: number; // その日の 0 時（この端末の時刻）
  count: number; // その日に時期が来る枚数（今日の分には、もう過ぎたカードも入れる）
}

// 今日から days 日（今日を含む）の各日に時期が来る枚数。過ぎた日は出さない
export function forecastDays(cards: readonly Pick<VocabCard, 'due'>[], now = Date.now(), days = 14): ForecastDay[] {
  const d = new Date(now);
  const starts = Array.from({ length: days + 1 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime());
  const out = starts.slice(0, days).map((start) => ({ start, count: 0 }));
  for (const card of cards) {
    if (card.due < starts[1]) {
      out[0].count += 1;
      continue;
    }
    for (let i = 1; i < days; i++) {
      if (card.due < starts[i + 1]) {
        out[i].count += 1;
        break;
      }
    }
  }
  return out;
}

// ---------- 枯れかけ ----------

export const WILT_DAYS = 7;

// 時期を過ぎた日数（過ぎていなければ 0）。一度も復習していないカードは数えない（覚えていないものは枯れない）
export function overdueDays(card: Pick<VocabCard, 'due' | 'reviews'>, now = Date.now()): number {
  if (card.reviews === 0 || card.due >= now) return 0;
  return Math.floor((now - card.due) / DAY);
}

export const isWilting = (card: Pick<VocabCard, 'due' | 'reviews'>, now = Date.now()) => overdueDays(card, now) >= WILT_DAYS;

// ---------- 読み上げ ----------

// 表の言葉の言語：ASCII だけなら英語、ほかは日本語
export function speechLang(text: string): 'en' | 'ja' {
  return /^[\x00-\x7F]*$/.test(text) ? 'en' : 'ja';
}

// この端末の中の声（localService）だけから、言語の合う声を選ぶ（既定の声を先に）。無ければ null（ボタンを出さない）
export function pickVoice<V extends { lang: string; localService: boolean; default?: boolean }>(voices: readonly V[], lang: 'en' | 'ja'): V | null {
  const local = voices.filter((v) => v.localService && v.lang.toLowerCase().startsWith(lang));
  return local.find((v) => v.default) ?? local[0] ?? null;
}
