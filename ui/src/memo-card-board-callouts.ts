// 吹き出し（MK8a。docs/plan-comment-board-marks.md §4.8）の計算。DOM も localStorage も使わない（ui/test/memo-card-board-callouts.test.ts）
//   「［全体］の間」だけ、印（♥・色）のカードの文の頭を、面の左右の空きに番号つきで出す。描くのは app/memo-board-callouts.ts、配線は app/memo-board-tab.ts
//   ここで決めること：
//   ・左右の空き：描いているカードの画面の外枠と、面の縁の差（面の中だけ。上下の帯は使わない。MK11）
//   ・席：空きが 200 以上ある側に、上から間 4 で積む（高さ 44・面の上下の余白 6・幅は「空き − 16」で 260 まで）
//   ・順：♥3 → ♥2 → 色 → ♥1（同じ組の中は作った時刻の新しい順）。印が 1 枚も無いボードでは最後に書いた 2 枚（頭に印は付けない）。
//     間の中では、印が替わったときのほか並べ替えない（前の順を受けて保つ）。出さないカード（絞り・検索で薄くした。MK8b で 📌）は、順を替えずに抜く
//   ・組と「＋n」：入らない分は最後の席を「＋n」にする（n は次の組の枚数。最後の組のあとは頭の組へ）。番号は組をまたいで通し。左右とも席が無ければ面の右上の札「＋n」だけ。
//     印が 1 枚も無いボードの 2 枚は、席の数までしか出さない（「＋n」の席も右上の札も出さない。席が無ければ何も出さない）
//   ・MK3 との組み：印のカードがあるとき、［全体］で左右に席が残る倍率までしか借りない（calloutFaceCap。fitView の丸めの分を見込む。memo-card-board-overview.ts の overviewNeedPx が使う）
//   MK8b：番号の小札の点（calloutBadgeAt。形ごとの点は memo-card-board-geo.ts の badge）・頭のダブルクリックの数え（calloutTap）・字の無いカードの絵（calloutShot）・
//     印の無いボードで前の順が 2 枚に足りないときだけ補う（MK8a の記録の (d)・案 A）・出したい組のカード（calloutLayout の keep。1 組の枚数が替わっても、そのカードの組を出す）
//   画面の字は textContent・属性だけで入れる（呼ぶ側）。字は計画 §9.2 の「＋n」（説明「次の n 枚」）と、番号・印の記号・カードの文だけ
import { t as tr } from './i18n';
import { type BoardView, boardToScreen, type CardSize, placementBounds } from './memo-card-board';
import { cardLines } from './memo-card-board-view';
import { type LikeLevel, MARK_SYMBOL, type MarkColor } from './likes';
import { PEEK_DOUBLE_MS } from './sheet-peek-logic';
import type { Reply } from './threads';

// 寸法（画面の画素）
export const CALLOUT = {
  h: 44, // 席（吹き出し 1 つ）の高さ
  gap: 4, // 席どうしの間（上から積む）
  pad: 6, // 面の上下の余白
  inset: 8, // 面の縁と、カードの外枠から席までの間（席の幅は 空き − 16）
  minBand: 200, // 席を出す側の空きの下限（これより狭い側には出さない。借りる高さの上限 calloutFaceCap も同じ値で決める）
  maxW: 260, // 席の幅の上限
  textMax: 40, // 文の頭の字数（2 行で切る。切ったら「…」）
} as const;

// 止まってから置き直すまでの長さ（見ている位置が動いた・つまむ・範囲選択・滑らせるときは隠し、最後の動きからこの長さで置き直す）
export const CALLOUT_WAIT_MS = 400;
// 借りる高さの上限から引く余り（画素）。下の区画は割合で境目を持つので、画素に戻すと面が少し高くなることがある（見込み。アプリの画素は測っていない）。
//   面が上限より 2px まで高くなっても、倍率は calloutFaceCap の cap を超えない（左右の席は残る）
export const CALLOUT_CAP_MARGIN = 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------- 左右の空き ----------

export interface CalloutBands {
  left: number; // 面の左の縁から、カードの外枠の左端まで（画素。0〜面の幅）
  right: number; // カードの外枠の右端から、面の右の縁まで
}

// 描いているカード（位置は箱の左上。ボードの座標）の外枠を画面へ移し、面の縁との差を取る。外枠が面からはみ出す向きは 0。カードが無い・面に大きさが無ければ null
export function calloutBands(view: BoardView, cards: readonly { x: number; y: number }[], box: CardSize, viewport: { w: number; h: number }): CalloutBands | null {
  const b = placementBounds(cards, box);
  if (!b || !(viewport.w > 0) || !(viewport.h > 0)) return null;
  const x0 = b.x * view.zoom + view.x;
  const x1 = (b.x + b.w) * view.zoom + view.x;
  return { left: clamp(x0, 0, viewport.w), right: clamp(viewport.w - x1, 0, viewport.w) };
}

// ---------- 席 ----------

export interface CalloutSide {
  n: number; // 席の数（0＝この側には出さない）
  x: number; // 席の左端（面の左上からの画素）
  w: number; // 席の幅
}

export interface CalloutSeats {
  perSide: number; // 片側に積める数（面の高さで決まる）
  left: CalloutSide;
  right: CalloutSide;
  total: number; // 左右の合わせ
}

// 片側に積める数：面の上下の余白 6 の間に、高さ 44 を間 4 で（面 217 で 4、400 で 8、176 で 3）
export const calloutPerSide = (faceH: number): number => (Number.isFinite(faceH) ? Math.max(0, Math.floor((faceH - 2 * CALLOUT.pad + CALLOUT.gap) / (CALLOUT.h + CALLOUT.gap))) : 0);

// 左右の席。空きが 200 以上ある側だけ、幅は 空き − 16（260 まで）。左の列は面の左の端から 8、右の列は面の右の端から 8 に寄せる
export function calloutSeats(bands: CalloutBands | null, viewport: { w: number; h: number }): CalloutSeats {
  const perSide = bands ? calloutPerSide(viewport.h) : 0;
  const side = (band: number, left: boolean): CalloutSide => {
    if (perSide === 0 || !(band >= CALLOUT.minBand)) return { n: 0, x: 0, w: 0 };
    const w = Math.min(band - 2 * CALLOUT.inset, CALLOUT.maxW);
    return { n: perSide, x: left ? CALLOUT.inset : viewport.w - CALLOUT.inset - w, w };
  };
  const left = side(bands?.left ?? 0, true);
  const right = side(bands?.right ?? 0, false);
  return { perSide, left, right, total: left.n + right.n };
}

// ---------- 順 ----------

export interface CalloutCard {
  id: string;
  x: number; // 描いている位置（箱の左上。ボードの座標）
  y: number;
  like: 0 | LikeLevel; // ♥ の段（MK5 の印）
  color: MarkColor | ''; // 色の印の名前
  createdAt: number; // カードを作った時刻（同じ組の中の新しい順）
}

export interface CalloutOrder {
  key: string; // 印の鍵（描いているカードの印の組。替わったら並べ直す）
  ids: readonly string[]; // 席の順（出さないカードも含む。出すときに抜く）
  marked: boolean; // 印のカードを並べた（false＝印が無いので最後に書いた 2 枚。頭に印を付けない）
}

const hasMark = (c: { like: number; color: string }) => c.like > 0 || c.color !== '';

// 組：♥3 → ♥2 → 色 → ♥1。1 枚は 1 度だけ、いちばん前の組に入る（♥2 と色のカードは ♥2、♥1 と色のカードは色）
const groupOf = (c: CalloutCard): number => (c.like === 3 ? 0 : c.like === 2 ? 1 : c.color !== '' ? 2 : 3);
const timeOf = (c: CalloutCard) => (Number.isFinite(c.createdAt) ? c.createdAt : 0);

// 印の鍵：描いているカードの印（id・段・色）を id の順に並べた字。印が 1 枚も無ければ 'r'（最後に書いた 2 枚）
export function calloutMarksKey(cards: readonly CalloutCard[]): string {
  const marked = cards.filter(hasMark).map((c) => `${c.id}\t${c.like}\t${c.color}`);
  return marked.length === 0 ? 'r' : `m\n${marked.sort().join('\n')}`;
}

// 印の無いボードで出す枚数（最後に書いた 2 枚）
const RECENT_PICK = 2;

// 席の順。prev：間の中の前の順（印の鍵が同じなら並べ替えず、消えた・描いていないカードだけ抜く。押して選んでも、文や作った時刻が替わっても動かない）。
//   印のカードがあれば ♥3 → ♥2 → 色 → ♥1（同じ組の中は作った時刻の新しい順、同じなら id の順）。出さないカード（exclude）も順には入れ、出すときに抜く（絞りを替えても並べ替えない）。
//   印が無ければ、最後に書いた順（recent。recentTops）の頭から、描いていて出せるカードを 2 枚。
//   MK8b（MK8a の記録の (d)・案 A）：印の無いボードで、前の順が 2 枚に足りない（描かなくなった・始めたときに薄かった）ときだけ、足りない分を最後に書いた順から補う
//   （描いていて出せる、まだ順に無いカード。出している分の順は保つ。2 枚あれば、薄くなっても補わない）
export function calloutOrder(cards: readonly CalloutCard[], recent: readonly string[], exclude: ReadonlySet<string>, prev: CalloutOrder | null): CalloutOrder {
  const key = calloutMarksKey(cards);
  const drawn = new Set(cards.map((c) => c.id));
  const pickable = (id: string) => drawn.has(id) && !exclude.has(id);
  if (prev && prev.key === key) {
    const ids = prev.ids.filter((id) => drawn.has(id));
    if (!prev.marked && ids.length < RECENT_PICK) ids.push(...recent.filter((id) => pickable(id) && !ids.includes(id)).slice(0, RECENT_PICK - ids.length));
    return ids.length === prev.ids.length && ids.every((id, i) => id === prev.ids[i]) ? prev : { key, ids, marked: prev.marked };
  }
  const marked = cards.filter(hasMark);
  if (marked.length > 0) {
    const ids = [...marked].sort((a, b) => groupOf(a) - groupOf(b) || timeOf(b) - timeOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((c) => c.id);
    return { key, ids, marked: true };
  }
  return { key, ids: recent.filter(pickable).slice(0, RECENT_PICK), marked: false };
}

// ---------- 組と「＋n」 ----------

export interface CalloutPage {
  start: number; // この組の頭の、並びの中の位置（番号は start＋1 から。組をまたいで通し）
  count: number; // この組で席に出す枚数
  more: number; // 最後の席の「＋n」の n（次の組の枚数。最後の組のあとは頭の組。無ければ 0）
  corner: number; // 席が無いときの、面の右上の札「＋n」の n（出す枚数の全部。無ければ 0）
  page: number; // 組の番（0 から。範囲の外は回して収める）
  pages: number; // 組の数（出すカードが無ければ 0）
}

// total 枚を seats 席に。入れば 1 組。入らなければ、最後の席を「＋n」にして seats − 1 枚ずつの組にする。席が 1 つ以下なら右上の札だけ
//   （印の無いボードの 2 枚は、呼ぶ側 calloutLayout が total を席の数までにして渡すので、ここへは来ない）
export function calloutPage(total: number, seats: number, page: number): CalloutPage {
  if (!(total > 0)) return { start: 0, count: 0, more: 0, corner: 0, page: 0, pages: 0 };
  if (total <= seats) return { start: 0, count: total, more: 0, corner: 0, page: 0, pages: 1 };
  if (seats <= 1) return { start: 0, count: 0, more: 0, corner: total, page: 0, pages: 1 };
  const per = seats - 1;
  const pages = Math.ceil(total / per);
  const p = ((Math.floor(Number.isFinite(page) ? page : 0) % pages) + pages) % pages;
  const start = p * per;
  const next = ((p + 1) % pages) * per;
  return { start, count: Math.min(per, total - start), more: Math.min(per, total - next), corner: 0, page: p, pages };
}

// count 個（吹き出し。「＋n」は入れない：最後の席 lastSeat）を左右の列へ：前半を左、後半を右（数をそろえる。片側が満ちたら、もう片側へ）。並びは左の上から、次に右の上から
export function calloutSlots(count: number, seats: CalloutSeats): { side: 'left' | 'right'; k: number }[] {
  const cl = seats.left.n;
  const cr = seats.right.n;
  const want = Math.max(0, Math.min(count, cl + cr));
  let nl = Math.min(cl, Math.ceil(want / 2));
  const nr = Math.min(cr, want - nl);
  nl = Math.min(cl, want - nr);
  const out: { side: 'left' | 'right'; k: number }[] = [];
  for (let k = 0; k < nl; k++) out.push({ side: 'left', k });
  for (let k = 0; k < nr; k++) out.push({ side: 'right', k });
  return out;
}

// 最後の席（「＋n」の席）：右の列の下の端。右に席が無ければ左の列の下の端。席が無ければ undefined
export function lastSeat(seats: CalloutSeats): { side: 'left' | 'right'; k: number } | undefined {
  if (seats.right.n > 0) return { side: 'right', k: seats.right.n - 1 };
  if (seats.left.n > 0) return { side: 'left', k: seats.left.n - 1 };
  return undefined;
}

// ---------- 全部 ----------

export interface CalloutInput {
  view: BoardView; // 今の見ている位置
  viewport: { w: number; h: number }; // 面の大きさ
  box: CardSize; // カードの箱の大きさ（形ごと）
  cards: readonly CalloutCard[]; // 描いているカード（描いている位置・印・作った時刻）
  recent: readonly string[]; // 最後に書いた順（recentTops。印が無いときの 2 枚）
  exclude: ReadonlySet<string>; // 出さないカード（絞り・検索で薄くしたカードと、📌 で留めたカード。MK8b）
  badge: { x: number; y: number }; // 番号の小札を置く点（箱の左上から。形ごとの geo.badge：四角は左上の角、六角は上の頂点。MK8b）
}

export interface CalloutRect {
  x: number; // 面の左上からの画素
  y: number;
  w: number;
  h: number;
}

export interface CalloutItem extends CalloutRect {
  id: string;
  n: number; // 番号（組をまたいで通し）
  like: 0 | LikeLevel; // 頭の印（印が無いボードの 2 枚では 0）
  color: MarkColor | '';
}

// 番号の小札（MK8b）：吹き出しと同じ番号を、カードの上の頂点（四角は左上の角）に出す。x・y は小札の中心（面の左上からの画素。面の外にもなる）
export interface CalloutBadge {
  id: string;
  n: number;
  x: number;
  y: number;
}

export interface CalloutLayout {
  order: CalloutOrder; // 次に渡す前の順（間の中で保つ）
  items: CalloutItem[]; // 出す吹き出し
  more: (CalloutRect & { n: number }) | null; // 最後の席の「＋n」
  corner: number; // 席が無いときの、面の右上の札「＋n」の n（無ければ 0）
  page: number;
  pages: number;
  badges: CalloutBadge[]; // 番号の小札（今の組で出す吹き出しのカードだけ。順は items と同じ）
}

const seatRect = (seats: CalloutSeats, s: { side: 'left' | 'right'; k: number }): CalloutRect => {
  const side = seats[s.side];
  return { x: side.x, y: CALLOUT.pad + s.k * (CALLOUT.h + CALLOUT.gap), w: side.w, h: CALLOUT.h };
};

// 番号の小札の中心（面の左上からの画素）：カードの描いている位置（箱の左上。ボードの座標）に形ごとの点（geo.badge）を足して、画面へ移す
export const calloutBadgeAt = (view: BoardView, at: { x: number; y: number }, badge: { x: number; y: number }): { x: number; y: number } => boardToScreen(view, at.x + badge.x, at.y + badge.y);

// 吹き出しの置き場の全部。prev：間の中の前の順（calloutOrder）。page：組の番。
//   keep（MK8b）：出したい組のカード（押した頭のカード・前に出していた組の頭。呼ぶ側が持つ）。組が 2 つ以上あり、keep が page の組に無ければ、keep の入る組を出す
//   （1 回目の選びでタグの行が出て面が低くなる、などで 1 組の枚数が替わっても、押した頭・見ていた組が別の組へ移らないように）。見つからなければ page のまま
export function calloutLayout(input: CalloutInput, prev: CalloutOrder | null, page: number, keep: string | null = null): CalloutLayout {
  const order = calloutOrder(input.cards, input.recent, input.exclude, prev);
  const byId = new Map(input.cards.map((c) => [c.id, c]));
  const shown = order.ids.filter((id) => byId.has(id) && !input.exclude.has(id));
  const seats = calloutSeats(calloutBands(input.view, input.cards, input.box, input.viewport), input.viewport);
  // 印の無いボードの 2 枚は、席の数まで（席が 1 つなら 1 枚、無ければ何も出さない。「＋n」の席も右上の札も出さない）
  const total = order.marked ? shown.length : Math.min(shown.length, seats.total);
  let pg = calloutPage(total, seats.total, page);
  const at = keep === null ? -1 : shown.indexOf(keep);
  if (pg.pages > 1 && at >= 0 && at < total && (at < pg.start || at >= pg.start + pg.count)) pg = calloutPage(total, seats.total, Math.floor(at / (seats.total - 1))); // 組が 2 つ以上なら、1 組は 席 − 1 枚
  const slots = calloutSlots(pg.count, seats);
  const items: CalloutItem[] = [];
  for (let i = 0; i < pg.count && i < slots.length; i++) {
    const card = byId.get(shown[pg.start + i]) as CalloutCard;
    items.push({ ...seatRect(seats, slots[i]), id: card.id, n: pg.start + i + 1, like: order.marked ? card.like : 0, color: order.marked ? card.color : '' });
  }
  // 「＋n」は組によらず最後の席（右の列の下の端。右に席が無ければ左の列の下の端。MK8b）：続けて押しても同じ所に当たる（最後の組は枚数が少ないので、枚数の次の席にすると動く）。
  //   組の枚数は 席 − 1 以下なので、左右の席の数が同じ（片側は 0）なら、吹き出しはこの席に来ない
  const moreSlot = pg.more > 0 ? lastSeat(seats) : undefined;
  const badges = items.map((i) => ({ id: i.id, n: i.n, ...calloutBadgeAt(input.view, byId.get(i.id) as CalloutCard, input.badge) }));
  return { order, items, more: moreSlot ? { ...seatRect(seats, moreSlot), n: pg.more } : null, corner: pg.corner, page: pg.page, pages: pg.pages, badges };
}

// ---------- 字 ----------

// 頭：番号と印（「♥2」・色の記号）。印が無いボードの 2 枚は番号だけ（呼ぶ側が like 0・color 空で渡す）
export function calloutHead(n: number, like: 0 | LikeLevel, color: MarkColor | ''): string {
  const parts = [String(n)];
  if (like > 0) parts.push(`♥${like}`);
  if (color !== '') parts.push(MARK_SYMBOL[color]);
  return parts.join(' ');
}

// 文の頭：カードの文の行（cardLines。AI のカードは見出しと文）を空白でつなぎ、40 字で切る（切ったら「…」）。字が無い（写真だけ・引用だけ）カードは空（頭だけを出す。絵は MK8b）
export function calloutText(reply: Pick<Reply, 'text' | 'by' | 'at'>): string {
  const chars = [...cardLines(reply).join(' ')];
  return chars.length > CALLOUT.textMax ? `${chars.slice(0, CALLOUT.textMax).join('')}…` : chars.join('');
}

// 「＋n」の字と説明（§9.2）
export const calloutMoreText = (n: number): string => `＋${n}`;
export const calloutMoreTitle = (n: number): string => tr('次の {0} 枚', { 0: n });

// 吹き出しに出す顔の絵（MK8b）：字の無いカード（文の頭が空）だけ、顔の絵（CardFace の thumb。shots の id）。字があれば・顔の絵が無ければ空（頭だけ）
export const calloutShot = (text: string, thumb: string): string => (text === '' ? thumb : '');

// ---------- 頭の押し（MK8b） ----------

// 前に頭を押した（カードの id・時刻）
export interface CalloutTap {
  id: string;
  at: number;
}

// 頭の左クリック：前の押しから ms 以内に、同じカードの頭を押したらダブルクリック（jump にそのカード）。dblclick は使わない（カードのダブルクリックと同じ数え方）。
//   別のカードの頭なら、押したカードの 1 回目に数え直す。2 回目が同じ頭に当たるように、層（app/memo-board-callouts.ts の show）は 1 回目の押しから ms の間、
//   見ている位置が同じなら吹き出しを作り直さない（1 回目の選びでタグの行が出て面が低くなり、席の数が替わっても）。ダブルクリックのあとは数え直す（next は null）
export function calloutTap(prev: CalloutTap | null, now: CalloutTap, ms: number = PEEK_DOUBLE_MS): { jump: string | null; next: CalloutTap | null } {
  if (prev && now.at - prev.at >= 0 && now.at - prev.at <= ms && prev.id === now.id) return { jump: prev.id, next: null };
  return { jump: null, next: now };
}

// ---------- MK3 との組み（§4.8） ----------

// 印のカードがあるか（overviewNeedPx に渡すカードの顔。like・color の無いものは印なし）
export const hasCalloutMark = (p: { like?: number; color?: string }): boolean => (p.like ?? 0) > 0 || (p.color ?? '') !== '';

// 借りたあとの面の高さの上限（画素）。［全体］は外枠（frame。ボードの座標の x と大きさ）を面の真ん中に置くので、左右の空きは 半分＝(面の幅 − 外枠の幅 × 倍率) ÷ 2 に近い。
//   ただし fitView は、x を丸める前の倍率 z で出して整数に丸め（ずれ e は ±0.5 まで）、倍率を 0.001 に丸める（zr。d＝zr − z は ±0.0005 まで）。
//   そのため 左の空き＝半分 ＋ 外枠の x × d ＋ e、右の空き＝半分 −（外枠の x ＋ 外枠の幅）× d − e。外枠の端のうち原点から遠いほうを far とすると、
//   半分が 200 ＋ 0.5 ＋ far × 0.0005 以上なら、左右とも 200 以上残る（計算で言えること。ui/test/memo-card-board-callouts.test.ts の掃き出しでも確かめる）。
//   その倍率 cap＝(面の幅 − 400 − 1 − far × 0.001) ÷ 外枠の幅 まで借りる：上限＝外枠の高さ × cap ＋ 余白 2 つ（切り捨て）− 余り CALLOUT_CAP_MARGIN（面が 2px 高くなっても倍率は cap 以下）。
//   now：今の面の［全体］の倍率（丸めたもの）／target：借りて目指す倍率（overviewNeedPx の目当て）。上限をかけないときは null：
//   今の面ですでに左右に席が無い（now が (面の幅 − 400) ÷ 外枠の幅 より大きい。今の面で左右とも空きが 200 以上なら、now はこれ以下。0.25 で止まっても席が無いボードも）・
//   cap が目当ての倍率に届く（借りても席は残る）・外枠に幅が無い。now がこれ以下で cap より大きい（今の面の席がすでに境目にある）ときは、上限が今の面より低くなり、借りない
export function calloutFaceCap(frame: { x: number; w: number; h: number }, faceW: number, now: number, target: number, pad: number): number | null {
  if (!(frame.w > 0) || !(frame.h > 0) || !Number.isFinite(frame.x)) return null;
  if (!((faceW - 2 * CALLOUT.minBand) / frame.w >= now)) return null;
  const far = Math.max(Math.abs(frame.x), Math.abs(frame.x + frame.w));
  const cap = (faceW - 2 * CALLOUT.minBand - 1 - far * 0.001) / frame.w;
  if (cap >= target) return null;
  return Math.floor(frame.h * cap + pad * 2) - CALLOUT_CAP_MARGIN;
}
