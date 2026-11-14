// いいねの段階。タブとメモのセルの ♡（押すたびに 1→2→3→なし）で付く。タグの名前とは別。
import { lang, t as tr } from './i18n';

export type LikeLevel = 1 | 2 | 3;

export const LIKE_LABEL: Record<LikeLevel, string> = { 1: 'いいね1', 2: 'いいね2', 3: 'いいね3' };

// 盤面の ♥ の色（.like-mark と同じ語。テーマで替わる）
export const LIKE_COLOR = 'var(--heart)';

export function likeLevel(value: unknown): LikeLevel | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

// 押すたびに 1→2→3→なし（タブとメモのセルの ♡ と同じ回り方。MK6 の書く欄の ♡・下の区画のカードの ♡）
export const nextLike = (level: 0 | LikeLevel): 0 | LikeLevel => (level === 3 ? 0 : ((level + 1) as LikeLevel));

// ♡ のボタンの字（MK6）：なしは ♡、付いていれば ♥ と段（今の段が分かる形。下の区画のメモの ♡ と同じ）
export const likeButtonText = (level: 0 | LikeLevel): string => (level === 0 ? '♡' : `♥${level}`);

// ---------- カードの印（♥ と色。MK5。計画 docs/plan-comment-board-marks.md §3・§4.5） ----------
//   一番上のカードの tags に、決まった値の隠したタグで持つ（♥ は 3 段、色は 3 つの名前。種類ごとに 1 枚に 1 つ）
//   値の一覧とぴったり同じタグだけを印として読む（頭の字では読まない。手で付けた「♥:9」「色:赤」は、ふつうのタグのまま）
//   10 個の数えには入れる（今の決まりのまま）。隠すのは grok-cards-tags.ts の isMarkTag（isMachineTag も真にする）
export type MarkKind = 'like' | 'color';

export const MARK_COLORS = ['水', '若草', '赤紫'] as const; // 色の名前（意味は付けない。名前はタグの値になるので、替えると前の名前のカードは色を失う）
export type MarkColor = (typeof MARK_COLORS)[number];
// 画面に出す色の名前（英語版）。値（タグ）は日本語のまま。辞書の「水」は曜日の Wed なので、色の名前はここで引く
const MARK_COLOR_EN: Record<MarkColor, string> = { 水: 'Aqua', 若草: 'Leaf green', 赤紫: 'Magenta' };
export const markColorLabel = (name: MarkColor): string => (lang() === 'en' ? MARK_COLOR_EN[name] : name);

// 色の印の見た目（MK7）：
//   KEY はカードの data-mark-color の値と、テーマの語 --mark-<KEY>-soft（淡い地。themes.css・theme-check.css）の名前。CSS は grok-cards.css の MK7 の規則
//   SYMBOL は顔の記号（六角は上の三角の印の行の先頭、四角は右上の印の席の先頭）。強制色でも記号で分ける。
//   □ は小さく見えるので使わない。線の矢じりの ▲◆● と、◇ は使わない（線の種類と読み違えないように）
export const MARK_COLOR_KEY: Record<MarkColor, string> = { 水: 'mizu', 若草: 'wakakusa', 赤紫: 'akamurasaki' };
export const MARK_SYMBOL: Record<MarkColor, string> = { 水: '◎', 若草: '▢', 赤紫: '☆' };

// 印の記号を、ほかの印の頭に足す（色が無ければそのまま。四角の右上の印の席の字。つなぎは空白）
export const withColorSymbol = (mark: string, color: MarkColor | ''): string => (color === '' ? mark : mark === '' ? MARK_SYMBOL[color] : `${MARK_SYMBOL[color]} ${mark}`);

export const likeTag = (level: LikeLevel): string => `♥:${level}`;
export const colorTag = (name: MarkColor): string => `⬢:${name}`;

const LIKE_MARKS: readonly string[] = [likeTag(1), likeTag(2), likeTag(3)];
const COLOR_MARKS: readonly string[] = MARK_COLORS.map(colorTag);
export const markValues: readonly string[] = [...LIKE_MARKS, ...COLOR_MARKS]; // 印の値の全部（この 6 つだけ）

const marksOf = (kind: MarkKind): readonly string[] => (kind === 'like' ? LIKE_MARKS : COLOR_MARKS);

// カードの ♥ の段（いちばん高い段。値の一覧に無いものは読まない。無ければ 0）
export function cardLike(tags: readonly string[]): 0 | LikeLevel {
  let best = 0;
  for (const tag of tags) best = Math.max(best, LIKE_MARKS.indexOf(tag) + 1);
  return best as 0 | LikeLevel;
}

// カードの色の名前（並びの先に見つけた 1 つ。値の一覧に無いものは読まない。無ければ空）
export function cardColor(tags: readonly string[]): MarkColor | '' {
  for (const tag of tags) {
    const i = COLOR_MARKS.indexOf(tag);
    if (i >= 0) return MARK_COLORS[i];
  }
  return '';
}

// その種類の今の印の値（likeTag・colorTag の形。無ければ空）。命令・元に戻すは、この形で値を渡す
export function markOf(tags: readonly string[], kind: MarkKind): string {
  if (kind === 'like') {
    const level = cardLike(tags);
    return level === 0 ? '' : likeTag(level);
  }
  const name = cardColor(tags);
  return name === '' ? '' : colorTag(name);
}

// 命令で受けてよい値か（空＝外す、か、その種類の値の一覧にあるもの）
export const isMarkValue = (kind: MarkKind, value: string): boolean => value === '' || marksOf(kind).includes(value);

// その種類の最初の印の位置（無ければ -1）。外す前に覚えておき、付け直すときの at に渡す（memocells.ts の setReplyMark）
export const markAt = (tags: readonly string[], kind: MarkKind): number => tags.findIndex((tag) => marksOf(kind).includes(tag));

// その種類の印を全部外し、最初にあった印の位置に value を 1 つ置く（無ければ at の位置に足す。at を省けば後ろ。空なら外すだけ）。ほかのタグの並びは動かさない
//   at は、外す前の位置（markAt）を付け直すときに使う（外す → 付け直す で並びが元に戻る）。範囲の外は端に収める
//   変わらなければ null。新しく足して max 個を超えるなら 'full'（今ある印を替えるのは数えない）
export function withMark(tags: readonly string[], kind: MarkKind, value: string, max: number, at?: number): string[] | 'full' | null {
  const marks = marksOf(kind);
  const out: string[] = [];
  let placed = false;
  for (const tag of tags) {
    if (!marks.includes(tag)) out.push(tag);
    else if (!placed) {
      placed = true;
      if (value !== '') out.push(value);
    }
  }
  if (!placed && value !== '') {
    if (tags.length >= max) return 'full';
    out.splice(at === undefined ? out.length : Math.max(0, Math.min(at, out.length)), 0, value);
  }
  return out.length === tags.length && out.every((t, i) => t === tags[i]) ? null : out;
}

export const MARK_COUNT_NOTE = tr('（いいね・色の印も 1 つに数えます）'); // ふつうのタグの上限の断りの後ろに足す（印が付いているカードのときだけ。grok-cards-tags.ts の markCountNote）

// 印を足せない（タグがもう max 個）ときの断り
export const markFullNote = (kind: MarkKind, max: number): string =>
  (kind === 'like' ? tr('タグが {0} 個のカードには、いいねを付けられません', { 0: max }) : tr('タグが {0} 個のカードには、色を付けられません', { 0: max })) + MARK_COUNT_NOTE;
