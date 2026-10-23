// 単語帳：言葉・問いのカードと、間をあけた復習（覚えた度合いは六角形の6辺で表す。六角メモの「進み具合」と同じ）
//   ・持ち主は左サイドバー（いつも動いているので、復習の時期を見て相棒に知らせられる）。保存先：ui-data\vocab.json
//   ・右サイドバーの「単語帳」パネルには写しを送り、変えたいときは左に頼む（六角で読む画面からも頼める）
import { readDataChecked, writeData } from './data';
import { samePage } from './threads';

export type CardKind = 'word' | 'quiz';
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export interface VocabCard {
  id: string;
  kind: CardKind; // 言葉 / 問い
  front: string; // 言葉・問い
  back: string; // 意味・答え
  example?: string; // ページの中の文など
  source?: { url: string; title: string }; // 見つけたページ
  createdAt: number;
  level: number; // 覚えた度合い（0〜6。六角形の明るい辺の数。6 で「覚えた」）
  due: number; // 次に復習する時刻
  reviews: number;
  lapses: number; // 「もう一度」の回数（多いものが苦手）
  lastReviewedAt?: number;
  sent?: boolean; // 六角メモへ送った
  link?: VocabLink; // 左の盤面のタブかメモのセル（無ければ、今までどおり）。K6 からは links の先頭の写し
  links?: CardLink[]; // リンクの並び（K6。本物。読むときは cardLinks）
  image?: CardImage; // 指す画像（K6。消えていたら「（消えた画像）」。AI には渡さない）
  rotate?: boolean; // めぐる表示の印 ⟳（K1。月の窓の ⚙ で「⟳ の印だけ」を選んだときに効く。無い・false は印なし）
  note?: string; // カードのメモ（K5b。500 字まで。AI・六角メモへは渡さない）
}

// 単語カードから移る先。1枚に1つ。セルが消えても、この項目は残す（押したときにわけを出す）
export type VocabLink = { kind: 'tab'; id: number; url?: string } | { kind: 'memo'; id: string }; // url：タブのページ（AR0。番号は起動ごとに変わるので、URL でも探す）

// カードのリンク（K6）：盤面のセルと、その役目（出典・関連）。1 枚に 6 つまで。本物は links、link は先頭の写し（古い版のため）
export type LinkRole = 'source' | 'related';
export type CardLink = VocabLink & { role?: LinkRole };
export const MAX_LINKS = 6;

// カードの画像（K6）：指すだけ（撮影の id か、shots の id〈画像ファイルのセル・下の区画のカードの画像〉）。写しは持たない
export type CardImage = { kind: 'shot' | 'capture'; id: string };

// 単語カードのタブへのリンクから、今のタブを探す（AR0）
//   番号のタブがあって URL が同じページならそれ → URL の同じページのタブ → 無ければ undefined。url の無い古いリンクは番号だけで探す
export function findVocabTab<T extends { id: number; url: string }>(tabs: readonly T[], link: { id: number; url?: string }): T | undefined {
  const byId = tabs.find((t) => t.id === link.id);
  if (!link.url) return byId;
  const url = link.url;
  if (byId && samePage(byId.url, url)) return byId;
  return tabs.find((t) => samePage(t.url, url));
}

// 新しく入れるカード（覚えた度合いなどは単語帳が決める）
export interface CardDraft {
  kind: CardKind;
  front: string;
  back: string;
  example?: string;
  source?: { url: string; title: string };
  link?: VocabLink; // 入れるとき、盤面のセルを1つ付ける（ページやメモから作ったカード）
  links?: CardLink[]; // 入れるときのリンクの並び（K6。あれば link より先）
  image?: CardImage; // 入れるときの画像（K6。撮影の区画・下の区画のカードから）
  rotate?: boolean; // 入れるときにめぐる表示の印を付ける（K1。入れる小窓で選ぶ）
  note?: string; // 入れるときのメモ（K5b）
}

// カードを直すときに来る項目（命令 updateCard と同じ。来たものだけ直す）
export interface CardPatch {
  front?: string;
  back?: string;
  example?: string;
  rotate?: boolean; // K1
  note?: string; // K5b（空なら消す）
  image?: CardImage | null; // K6（null で外す）
  due?: number; // K5b（「次は □ 日後」・評価の元に戻す）
  level?: number; // K5b（評価の元に戻す）
  reviews?: number; // K5b（同）
  lapses?: number; // K5b（同）
}

const NOTE_MAX = 500;
const DAY_MS = 24 * 60 * 60_000;
export const NEXT_DAYS_MAX = 365; // 「次は □ 日後」の上限（K5b）

// カードのメモ（K5b）：前後の空白を外し、500 字まで。空なら無し
export function cleanNote(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = [...raw.trim()].slice(0, NOTE_MAX).join('');
  return text || undefined;
}

// 「次は □ 日後」（K5b）：1〜365 日の整数にそろえ、今から n 日後の時刻
export function dueInDays(days: number, now = Date.now()): number {
  const n = Math.max(1, Math.min(NEXT_DAYS_MAX, Math.round(Number.isFinite(days) ? days : 1)));
  return now + n * DAY_MS;
}

export interface VocabState {
  cards: VocabCard[];
  notify: boolean; // 復習の時期を相棒が知らせる（1日1回、9時から）
  readFailed?: boolean; // 台帳を読めなかった（K0。この起動では書かない。右の区画が帯で知らせる）
}

const FILE = 'vocab.json';
const MAX_CARDS = 3000;
const LOAD_RETRY_MS = 3000; // K0：台帳を読めなかったときの読み直しまでの間（メモの台帳と同じ）
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// 覚えた度合い → 次の復習までの日数（6 は「覚えた」。それでも 30 日ごとに確かめる）
const INTERVAL_DAYS = [0, 1, 2, 4, 7, 15, 30];
export const NOTIFY_HOUR = 9;

export const newCardId = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// 答えたあとの、覚えた度合いと次の復習の時刻
export function schedule(card: Pick<VocabCard, 'level'>, grade: Grade, now = Date.now()): { level: number; due: number } {
  const level = card.level;
  switch (grade) {
    case 'again':
      return { level: Math.max(0, level - 2), due: now + 10 * MINUTE }; // 忘れた：少し後にもう一度
    case 'hard': {
      const next = Math.max(1, level);
      return { level: next, due: now + Math.max(1, Math.floor(INTERVAL_DAYS[next] / 2)) * DAY - 2 * 60 * MINUTE };
    }
    case 'good': {
      const next = Math.min(6, level + 1);
      return { level: next, due: now + INTERVAL_DAYS[next] * DAY - 2 * 60 * MINUTE };
    }
    case 'easy': {
      const next = Math.min(6, level + 2);
      return { level: next, due: now + Math.max(4, INTERVAL_DAYS[next]) * DAY - 2 * 60 * MINUTE };
    }
  }
}

// ボタンに添える「次はいつ」
export function intervalLabel(card: Pick<VocabCard, 'level'>, grade: Grade, now = Date.now()): string {
  const ms = schedule(card, grade, now).due - now;
  if (ms < 60 * MINUTE) return `${Math.max(1, Math.round(ms / MINUTE))}分`;
  const days = Math.round(ms / DAY);
  if (days < 14) return `${Math.max(1, days)}日`;
  if (days < 60) return `${Math.round(days / 7)}週間`;
  return `${Math.round(days / 30)}か月`;
}

export const isDue = (card: VocabCard, now = Date.now()) => card.due <= now;
export const isWeak = (card: VocabCard) => card.lapses >= 2 || (card.lapses >= 1 && card.level <= 2);

// 同じカードかどうか（言葉・問いの表記の揺れを少しならす）
export const cardKey = (kind: CardKind, front: string) => `${kind}:${front.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()}`;

export function cleanDraft(raw: unknown): CardDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? [...v.trim()].slice(0, max).join('') : '');
  const front = text(d.front, 400);
  const back = text(d.back, 1000);
  if (!front || !back) return null;
  const example = text(d.example, 300);
  const s = d.source as Record<string, unknown> | undefined;
  const url = typeof s?.url === 'string' ? s.url.slice(0, 500) : '';
  const source =
    /^https?:\/\//i.test(url) || /^file:\/\//i.test(url) ? { url, title: typeof s?.title === 'string' ? [...s.title].slice(0, 200).join('') : '' } : undefined;
  return { kind: d.kind === 'quiz' ? 'quiz' : 'word', front, back, example: example || undefined, source };
}

// ---------- 台帳（左サイドバーが持つ） ----------

export class VocabStore {
  private cards: VocabCard[] = [];
  private notifyOn = true;
  private notifiedDay = ''; // 最後に知らせた日（YYYY-MM-DD）
  private loaded = false; // 読み込みを終えた（読めなかったときも。写しを右へ送ってよい）
  private writable = false; // 台帳に書いてよい（読めた・ファイルが無かった。K0：読めなかったら書かない）
  private readonly listeners: (() => void)[] = [];
  private saveTimer = 0;

  async load() {
    // K0：「本当に無い」と「あるのに読めない」を分ける。読めなかったら 3 秒後に 1 回だけ読み直す
    //   それでも読めなければ、この起動では台帳に書かない（空で上書きしない）
    let read = await readVocabLedger();
    if (read === 'unreadable') {
      await new Promise((resolve) => window.setTimeout(resolve, LOAD_RETRY_MS));
      read = await readVocabLedger();
    }
    const early = this.cards; // 読み込みを待つ間に足したカード
    if (read !== 'unreadable' && read !== 'missing') {
      this.notifyOn = read.notify;
      this.notifiedDay = read.notifiedDay;
      this.cards = read.cards;
      const known = new Set(this.cards.map((c) => cardKey(c.kind, c.front)));
      for (const card of early) {
        if (known.has(cardKey(card.kind, card.front)) || this.cards.length >= MAX_CARDS) continue;
        known.add(cardKey(card.kind, card.front));
        this.cards.push(card);
      }
    }
    this.writable = read !== 'unreadable';
    this.loaded = true;
    this.emit();
    if (this.writable && early.length > 0) this.changed(); // 待つ間に足したカードを書く
  }

  get ready() {
    return this.loaded;
  }

  // 読み直しても台帳を読めなかった（この起動では書かない）
  get loadFailed() {
    return this.loaded && !this.writable;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  snapshot(): VocabState {
    return { cards: [...this.cards], notify: this.notifyOn, ...(this.loadFailed ? { readFailed: true } : {}) };
  }

  // 入れる（同じ言葉・問いがもうあれば入れない）。入れた数を返す
  add(drafts: CardDraft[]): number {
    const known = new Set(this.cards.map((c) => cardKey(c.kind, c.front)));
    const now = Date.now();
    let added = 0;
    for (const raw of drafts) {
      const single = parseLink(raw.link);
      const links = parseCardLinks(raw.links) ?? (single ? [single] : undefined);
      const d = cleanDraft(raw);
      if (!d || known.has(cardKey(d.kind, d.front)) || this.cards.length >= MAX_CARDS) continue;
      known.add(cardKey(d.kind, d.front));
      const note = cleanNote(raw.note);
      const image = parseImage(raw.image);
      const card: VocabCard = {
        id: newCardId(),
        ...d,
        createdAt: now,
        level: 0,
        due: now,
        reviews: 0,
        lapses: 0,
        ...(raw.rotate === true ? { rotate: true } : {}),
        ...(note ? { note } : {}),
        ...(image ? { image } : {}),
      };
      if (links) withLinks(card, links);
      this.cards.push(card);
      added++;
    }
    if (added > 0) this.changed();
    return added;
  }

  // 表・裏・例文を直す（表と裏の両方が来たときだけ。例文が来なければ消す。今までどおり）
  // めぐる表示の印を付け外す（K1。rotate が来たときだけ）。メモ（K5b。空なら消す）
  // 時期と度合い（K5b。「次は □ 日後」と評価の元に戻す。来た項目だけ。読めない値は使わない）。ほかの項目は変えない
  update(id: string, patch: CardPatch) {
    const card = this.cards.find((c) => c.id === id);
    if (!card) return;
    let changed = false;
    if (patch.front !== undefined && patch.back !== undefined) {
      const merged = cleanDraft({ ...card, front: patch.front, back: patch.back, example: patch.example });
      if (merged) {
        card.front = merged.front;
        card.back = merged.back;
        card.example = merged.example;
        changed = true;
      }
    }
    if (typeof patch.rotate === 'boolean' && (card.rotate === true) !== patch.rotate) {
      if (patch.rotate) card.rotate = true;
      else delete card.rotate;
      changed = true;
    }
    if (patch.note !== undefined) {
      const note = cleanNote(patch.note);
      if (note !== card.note) {
        if (note) card.note = note;
        else delete card.note;
        changed = true;
      }
    }
    if (patch.image !== undefined) {
      const image = patch.image === null ? undefined : parseImage(patch.image);
      if ((patch.image === null || image) && JSON.stringify(image) !== JSON.stringify(card.image)) {
        if (image) card.image = image;
        else delete card.image;
        changed = true;
      }
    }
    const count = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined);
    const due = typeof patch.due === 'number' && Number.isFinite(patch.due) && patch.due > 0 ? patch.due : undefined;
    const level = count(patch.level, 6);
    const reviews = count(patch.reviews, 1_000_000);
    const lapses = count(patch.lapses, 1_000_000);
    if (due !== undefined && due !== card.due) {
      card.due = due;
      changed = true;
    }
    if (level !== undefined && level !== card.level) {
      card.level = level;
      changed = true;
    }
    if (reviews !== undefined && reviews !== card.reviews) {
      card.reviews = reviews;
      changed = true;
    }
    if (lapses !== undefined && lapses !== card.lapses) {
      card.lapses = lapses;
      changed = true;
    }
    if (changed) this.changed();
  }

  remove(id: string) {
    this.cards = this.cards.filter((c) => c.id !== id);
    this.changed();
  }

  grade(id: string, grade: Grade) {
    const card = this.cards.find((c) => c.id === id);
    if (!card) return;
    const now = Date.now();
    Object.assign(card, schedule(card, grade, now));
    card.reviews += 1;
    if (grade === 'again') card.lapses += 1;
    card.lastReviewedAt = now;
    this.changed();
  }

  markSent(ids: string[]) {
    const set = new Set(ids);
    for (const c of this.cards) if (set.has(c.id)) c.sent = true;
    this.changed();
  }

  setNotify(on: boolean) {
    this.notifyOn = on;
    this.changed();
  }

  // 盤面のセルへのリンクを 1 つにする・外す（null で外す。K6 からは並び全体を入れかえる）。ほかの項目は変えない
  setLink(id: string, link: VocabLink | null) {
    const next = link === null ? [] : parseLink(link);
    if (next === undefined) return;
    this.setLinks(id, Array.isArray(next) ? next : [next]);
  }

  // リンクの並びを入れかえる（K6。読めないもの・同じセルの二つ目は捨て、6 つまで。空なら外す）。link には先頭を写す
  setLinks(id: string, raw: unknown) {
    const card = this.cards.find((c) => c.id === id);
    if (!card) return;
    const links = parseCardLinks(raw) ?? [];
    if (JSON.stringify(cardLinks(card)) === JSON.stringify(links) && (links.length === 0 || card.links)) return;
    withLinks(card, links);
    this.changed();
  }

  // 今日まだ知らせていなくて、復習の時期のカードがあれば、その数（知らせたことにする）
  takeDueNotice(now = new Date()): number {
    if (!this.loaded || !this.notifyOn || now.getHours() < NOTIFY_HOUR) return 0;
    const today = dayOf(now);
    if (this.notifiedDay === today) return 0;
    const due = this.cards.filter((c) => isDue(c, now.getTime())).length;
    if (due === 0) return 0;
    this.notifiedDay = today;
    this.changed();
    return due;
  }

  private changed() {
    this.emit();
    if (!this.writable) return; // 読み込む前・読めなかった台帳に書くと、前のカードを消してしまう
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 500);
  }

  // 書くのを待っている分を、待たずに書く（終わるとき。K0）。待っている分が無ければ書かない
  flush() {
    if (this.saveTimer === 0) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (this.writable) void writeData(FILE, { version: 1, notify: this.notifyOn, notifiedDay: this.notifiedDay, cards: this.cards });
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export function dayOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 台帳を 1 回読む（K0）：読めた中身・missing（ファイルが無い）・unreadable（返事が無い・壊れている・知らない版や形）
async function readVocabLedger(): Promise<{ notify: boolean; notifiedDay: string; cards: VocabCard[] } | 'missing' | 'unreadable'> {
  const read = await readDataChecked<{ version?: unknown; notify?: unknown; notifiedDay?: unknown; cards?: unknown } | null>(FILE);
  if (read.status === 'missing') return 'missing';
  if (read.status === 'failed') return 'unreadable';
  const saved = read.value;
  if (!saved || typeof saved !== 'object' || saved.version !== 1 || !Array.isArray(saved.cards)) return 'unreadable';
  return {
    notify: saved.notify !== false,
    notifiedDay: typeof saved.notifiedDay === 'string' ? saved.notifiedDay : '',
    cards: saved.cards.map(parseCard).filter((c): c is VocabCard => !!c),
  };
}

// 台帳の 1 枚を読む。知っている項目は確かめて組み直し、知らない項目はそのまま残す
//   （K0。新しい版が足した項目を、この版で開いて書いても消さない。読めない値の知っている項目は捨てる）
export function parseCard(raw: unknown): VocabCard | null {
  const d = cleanDraft(raw);
  if (!d) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    ...r,
    id: typeof r.id === 'string' ? r.id : newCardId(),
    ...d,
    createdAt: num(r.createdAt, Date.now()),
    level: Math.max(0, Math.min(6, Math.round(num(r.level, 0)))),
    due: num(r.due, Date.now()),
    reviews: Math.max(0, Math.round(num(r.reviews, 0))),
    lapses: Math.max(0, Math.round(num(r.lapses, 0))),
    lastReviewedAt: typeof r.lastReviewedAt === 'number' ? r.lastReviewedAt : undefined,
    sent: r.sent === true || undefined,
    link: parseLink(r.link),
    links: parseCardLinks(r.links), // K6
    image: parseImage(r.image), // K6
    rotate: r.rotate === true || undefined, // K1：true のほかは印なし（項目ごと書かない）
    note: cleanNote(r.note), // K5b
  };
}

// 読めないリンクは捨てる（カード自体は残す。古い vocab.json にこの項目は無い）
export function parseLink(raw: unknown): VocabLink | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'tab' && typeof r.id === 'number' && Number.isInteger(r.id) && r.id > 0) {
    const url = typeof r.url === 'string' && r.url.length <= 4000 && /^(https?|file):/i.test(r.url) ? r.url : undefined;
    return url ? { kind: 'tab', id: r.id, url } : { kind: 'tab', id: r.id };
  }
  if (r.kind === 'memo' && typeof r.id === 'string' && /^m[0-9a-z]+$/i.test(r.id)) return { kind: 'memo', id: r.id };
  return undefined;
}

export const sameCell = (a: VocabLink, b: VocabLink) => a.kind === b.kind && a.id === b.id;

// カードのリンクを読む（K6）：links が本物。無ければ古い link を 1 つ
export function cardLinks(card: Pick<VocabCard, 'link' | 'links'>): CardLink[] {
  if (card.links && card.links.length > 0) return card.links;
  return card.link ? [card.link] : [];
}

// リンクの並びを確かめる（K6）：読めないもの・同じセルの二つ目は捨て、6 つまで。役目は「出典」「関連」のほかは無し。空なら undefined
export function parseCardLinks(raw: unknown): CardLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CardLink[] = [];
  for (const item of raw) {
    const link = parseLink(item);
    if (!link || out.some((l) => sameCell(l, link))) continue;
    const role = (item as Record<string, unknown>).role;
    out.push(role === 'source' || role === 'related' ? { ...link, role } : link);
    if (out.length >= MAX_LINKS) break;
  }
  return out.length > 0 ? out : undefined;
}

// リンクの並びを書く（K6）：本物は links。link には先頭を役目なしで写す（古い版はこれだけを読む）。空なら両方外す
function withLinks(card: VocabCard, links: readonly CardLink[]) {
  if (links.length === 0) {
    delete card.links;
    delete card.link;
    return;
  }
  card.links = [...links];
  const { role: _role, ...first } = links[0];
  card.link = first as VocabLink;
}

// 指す画像を確かめる（K6）。id はファイルの名前に使うので、英数字と - _ だけ
export function parseImage(raw: unknown): CardImage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if ((r.kind === 'shot' || r.kind === 'capture') && typeof r.id === 'string' && /^[0-9a-z_-]{1,64}$/i.test(r.id)) return { kind: r.kind, id: r.id };
  return undefined;
}

// このセルを指すカード（K6。セルの右クリック「つながったカード」）：メモは id。タブは番号が同じ（URL があれば同じページ）か、URL が同じページ
export function cardsLinkedTo(cards: readonly VocabCard[], cell: { kind: 'tab'; id: number; url: string } | { kind: 'memo'; id: string }): VocabCard[] {
  return cards.filter((card) =>
    cardLinks(card).some((link) => {
      if (cell.kind === 'memo') return link.kind === 'memo' && link.id === cell.id;
      if (link.kind !== 'tab') return false;
      if (link.url) return samePage(link.url, cell.url);
      return link.id === cell.id;
    }),
  );
}

// このページから作ったカード（K6。「このページ n 枚」）：出典が同じページのもの
export function cardsOnPage(cards: readonly VocabCard[], url: string): VocabCard[] {
  if (!url) return [];
  return cards.filter((card) => card.source && samePage(card.source.url, url));
}
