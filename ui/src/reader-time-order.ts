// 六角で見る（読む画面の下の区画）の「時刻順」の並びを組む関数（plan-reader-video の V2b-a。段 V2b-a）
//   ・動画ごとに組（題の仕切り）、組の中は結んだ区間の早い順。読む画面がその動画を開いていればチャプターの仕切りも入れる
//   ・結んでいないカードは loose へ（今見えている順のまま、いちばん後ろ）
//   ・純粋な関数だけ（DOM・window・時計・乱数を使わない）。型だけ reader-links.ts から読む
import type { ReplyAt } from './reader-links';

// 並べるカード（下の区画の Reply はこれを満たす）
export interface TimeOrderCard {
  id: string;
  at?: ReplyAt;
}

// 読む画面のチャプター（見出しのマスの始まりの秒と題）
export interface TimeChapter {
  start: number;
  title: string;
}

// 一つのチャプターの区切り（title が null：チャプターの一覧が無い動画、または最初のチャプターより前）
export interface TimeOrderSection<T> {
  title: string | null;
  start: number | null;
  cards: T[];
}

// 一本の動画の組
export interface TimeOrderGroup<T> {
  video: string;
  title: string; // 仕切りに出す動画の題
  count: number; // この組のカードの数
  sections: TimeOrderSection<T>[];
}

export interface TimeOrder<T> {
  groups: TimeOrderGroup<T>[];
  loose: T[]; // 結んでいないカード（at が無い）
}

export interface TimeOrderOptions {
  first?: string | null; // 先に出す動画（読む画面が開いている動画）
  chapters?: { video: string; chapters: readonly TimeChapter[] } | null; // この動画にだけチャプターの区切りを入れる
}

// 組の中で並べるための一枚（カード・その at・区間の一番早い始まり）
interface Entry<T> {
  card: T;
  at: ReplyAt;
  start: number;
}

// 秒として使える数か（有限の数だけ通す）
const isSec = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw);

// 数の大小で並べる（Infinity も比べられる。同じなら 0）
function compare(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// 結んだ区間の一番早い始まり（区間が空なら Infinity）
export function cardStart(at: ReplyAt): number {
  let start = Infinity;
  for (const span of at.spans) start = Math.min(start, span.start);
  return start;
}

// 使えるチャプター（始まりが 0 以上の有限の数、題が文字列）を、始まりの小さい順に（同じなら元の順）
function usableChapters(chapters: readonly TimeChapter[]): TimeChapter[] {
  return chapters
    .filter((c) => isSec(c.start) && c.start >= 0 && typeof c.title === 'string')
    .sort((a, b) => compare(a.start, b.start));
}

// 組の題（tops の順に見て、最初に空白でない題の trim した文字。どれも無ければ '動画'）
function groupTitle<T>(entries: readonly Entry<T>[]): string {
  for (const entry of entries) {
    const title = entry.at.title;
    if (typeof title === 'string' && title.trim() !== '') return title.trim();
  }
  return '動画';
}

// チャプターの区切りを作る：各カードは、始まりが一番大きいチャプターへ（どれも満たさなければ先頭の null の区切り）
//   ・sorted は組の中の順（始まりの小さい順）。chapters は使えるチャプターを始まりの小さい順にしたもの
//   ・区切りに入るのは、カードの入ったものだけ。順は null の区切り、そのあとチャプターの始まりの順
function chapterSections<T>(sorted: readonly Entry<T>[], chapters: readonly TimeChapter[]): TimeOrderSection<T>[] {
  const lead: T[] = [];
  const buckets: T[][] = chapters.map(() => []);
  for (const entry of sorted) {
    // 始まりが合うチャプターのうち最後のもの（並べてあるので、それが一番大きい始まり）
    let idx = -1;
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].start <= entry.start) idx = i;
    }
    if (idx === -1) lead.push(entry.card);
    else buckets[idx].push(entry.card);
  }
  const sections: TimeOrderSection<T>[] = [];
  if (lead.length > 0) sections.push({ title: null, start: null, cards: lead });
  chapters.forEach((chapter, i) => {
    if (buckets[i].length > 0) sections.push({ title: chapter.title, start: chapter.start, cards: buckets[i] });
  });
  return sections;
}

// 一本の動画の組を作る（組の中は始まりの小さい順。同じなら tops の順）
function buildGroup<T>(video: string, entries: readonly Entry<T>[], chapters: TimeOrderOptions['chapters']): TimeOrderGroup<T> {
  const sorted = [...entries].sort((a, b) => compare(a.start, b.start));
  const cards = sorted.map((entry) => entry.card);
  // この動画にだけ、使えるチャプターがあれば区切りを入れる。無ければ組の全部を一つの区切りに
  const usable = chapters && chapters.video === video ? usableChapters(chapters.chapters) : [];
  const sections: TimeOrderSection<T>[] = usable.length === 0 ? [{ title: null, start: null, cards }] : chapterSections(sorted, usable);
  return { video, title: groupTitle(entries), count: entries.length, sections };
}

// 一番上のカードの並び（今見えている順）から時刻順の並びを組む
//   ・at の無いカードは loose（tops の順のまま）
//   ・at のあるカードは動画ごとの組に分ける。組の順は、first の動画（カードがあれば）を先頭に、残りは最初に出てきた順
//   ・入力（tops・options）は変えない。返すカードは入力と同じもの
export function timeOrder<T extends TimeOrderCard>(tops: readonly T[], options: TimeOrderOptions = {}): TimeOrder<T> {
  const loose: T[] = [];
  const byVideo = new Map<string, Entry<T>[]>();
  for (const card of tops) {
    const at = card.at;
    if (!at) {
      loose.push(card);
      continue;
    }
    const entry: Entry<T> = { card, at, start: cardStart(at) };
    const list = byVideo.get(at.video);
    if (list) list.push(entry);
    else byVideo.set(at.video, [entry]);
  }
  let videos = [...byVideo.keys()];
  const first = options.first;
  if (typeof first === 'string' && byVideo.has(first)) {
    videos = [first, ...videos.filter((video) => video !== first)];
  }
  const groups = videos.map((video) => buildGroup(video, byVideo.get(video) ?? [], options.chapters));
  return { groups, loose };
}
