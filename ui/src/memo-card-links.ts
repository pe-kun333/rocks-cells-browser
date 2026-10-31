// 下の区画のカードの「関連」：一番上のカードどうしを結ぶ、種類つきの向きのある線（計画 docs/plan-memo-card-links.md）
//   ・持つのは元のカード（Reply.links）。「元 → 相手」で持ち、元のカードは相手の〈根拠・反論・続き・疑問〉と読む。「同じ」は向きの無い一組
//   ・一組の向きごとに 1 本（種類を変えると置き換え）。逆向きは別の 1 本。ただし逆向きの「同じ」は持たない（二本目は断る・捨てる）
//   ・返信の木（parent。💬）とは別物。木は変えない。書くのは左だけ（changeReplyLinks）
//   ・ここは DOM を使わない（種類の表・読み込み・足し引き・文の形。線の計算は L3 でここに足す）
import type { Reply } from './threads';

export type LinkKind = 'ground' | 'counter' | 'next' | 'same' | 'ask' | 'supplement'; // supplement：補足（試しで足した 6 つ目）

export interface ReplyLink {
  to: string; // 相手の一番上のカードの id
  kind: LinkKind;
}

// 矢じりの形（相手の側に付ける）。none は「同じ」（向きが無い）
export type LinkHead = 'triangle' | 'bar' | 'chevron' | 'none' | 'dot' | 'diamond';

export interface LinkKindInfo {
  kind: LinkKind;
  name: string; // 画面の名前
  color: string; // 線の色（明るい・暗い画面で同じ。タグの色・--accent の橙と見分けのつく色相）
  head: LinkHead;
  dashed: boolean;
}

// 種類の表（並びは画面の並び。色と形を変えるときは、ここだけを直す）
export const LINK_KINDS: readonly LinkKindInfo[] = [
  // theme: fixed begin：データの色（保存する値。描くときは data-colors.css でテーマの明るさの帯へ）
  { kind: 'ground', name: '根拠', color: '#2f9e6e', head: 'triangle', dashed: false },
  { kind: 'counter', name: '反論', color: '#d4493e', head: 'bar', dashed: false },
  { kind: 'next', name: '続き', color: '#3b7dd8', head: 'chevron', dashed: false },
  { kind: 'same', name: '同じ', color: '#8a8f99', head: 'none', dashed: false },
  { kind: 'ask', name: '疑問', color: '#8e5bd6', head: 'dot', dashed: true },
  { kind: 'supplement', name: '補足', color: '#c9a227', head: 'diamond', dashed: false }, // 黄土色・ひし形（橙の --accent・赤・緑と見分けのつく色相）
  // theme: fixed end
];

// 種類の名前を利用者が変えられる（試し）。色・形・種類の id は変えない。線には種類の id だけを保存する
//   画面の名前は、開いているメモが呼称セットを選んでいればそのセット、選んでいなければそのメモの linkNames。
//   どちらを渡すかは呼ぶ側（resolvedLinkKindNames）が決めて、ここへは決まった名前だけが来る
export const LINK_KIND_DEFAULT_NAMES: Readonly<Record<LinkKind, string>> = { ground: '根拠', counter: '反論', next: '続き', same: '同じ', ask: '疑問', supplement: '補足' };
export const LINK_KIND_NAME_MAX = 10;
// 変えた種類だけを持つ名前（MemoCell.linkNames と、呼称セットの names）。無い種類は元の名前
export type LinkKindNames = Partial<Record<LinkKind, string>>;
// 保存してあった名前を読む（知らない種類・空・文字でないものは捨てる。長すぎれば切る）。一つも無ければ undefined
export function parseLinkKindNames(raw: unknown): LinkKindNames | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const out: LinkKindNames = {};
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isLinkKind(kind) || typeof value !== 'string') continue;
    const v = value.trim().slice(0, LINK_KIND_NAME_MAX);
    if (v && v !== LINK_KIND_DEFAULT_NAMES[kind]) out[kind] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
// 開いているメモの名前を表に当てる（区画がメモを開くたび。undefined なら元の名前）
export function applyLinkKindNames(names: LinkKindNames | undefined) {
  for (const k of LINK_KINDS as LinkKindInfo[]) k.name = names?.[k.kind] ?? LINK_KIND_DEFAULT_NAMES[k.kind];
}
// 呼び名を一時的に差し替えて fn を動かし、必ず元に戻す（同期の処理だけ。非同期の中身には使わない）。
//   ボードが下の区画とは別のメモを見ているとき、そのメモの呼び名でボードを描く・メニューを組むために使う（plan-board-memo-switch の M4）
export function withLinkKindNames<T>(names: LinkKindNames | undefined, fn: () => T): T {
  const infos = LINK_KINDS as LinkKindInfo[];
  const saved = infos.map((k) => k.name);
  applyLinkKindNames(names);
  try {
    return fn();
  } finally {
    infos.forEach((k, i) => void (k.name = saved[i]));
  }
}
// 一つの種類の名前を変えた、新しい名前の組（null か空・元と同じなら元に戻す）
export function withLinkKindName(names: LinkKindNames | undefined, kind: LinkKind, name: string | null): LinkKindNames | undefined {
  return parseLinkKindNames({ ...(names ?? {}), [kind]: name ?? '' });
}

export const MAX_LINKS_PER_CARD = 10; // 1 枚のカードから出す関連の数（タグの 10 と同じ数）
const ID_MAX = 64;

export function isLinkKind(value: unknown): value is LinkKind {
  return LINK_KINDS.some((k) => k.kind === value);
}

export function linkKindInfo(kind: LinkKind): LinkKindInfo {
  return LINK_KINDS.find((k) => k.kind === kind) ?? LINK_KINDS[0];
}

// 関連を一つ読む（形が崩れていれば null）
export function parseLink(raw: unknown): ReplyLink | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.to !== 'string' || !r.to || r.to.length > ID_MAX || !isLinkKind(r.kind)) return null;
  return { to: r.to, kind: r.kind };
}

// 保存してあった関連の並びを読む（形の崩れたもの・自分自身・同じ相手の二本目は捨てる。10 本まで）
//   相手が一番上のカードにあるか・逆向きの「同じ」は、カード全部を読んだあとで parseReplies が確かめる
export function parseLinks(raw: unknown, self: string): ReplyLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ReplyLink[] = [];
  for (const item of raw) {
    const link = parseLink(item);
    if (!link || link.to === self || out.some((l) => l.to === link.to)) continue;
    out.push(link);
    if (out.length >= MAX_LINKS_PER_CARD) break;
  }
  return out;
}

// 一番上のカードの関連を、相手のあるものだけに絞る（parseReplies の最後と、カードを消したあと）
//   ・相手が一番上のカードに無い関連を捨てる
//   ・同じ二枚のあいだの「同じ」が両向きにあれば、作った時刻の新しい方のカード（同じ時刻なら id の大きい方）が持つ一本を捨てる
//   変わったカードだけ新しい物にする（変わらなければ同じ配列を返す）
export function pruneLinks(replies: Reply[]): Reply[] {
  const tops = new Map<string, Reply>();
  for (const r of replies) if (r.parent === null) tops.set(r.id, r);
  const older = (a: Reply, b: Reply) => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
  let changed = false;
  const out = replies.map((r) => {
    if (!r.links) return r;
    const keep = r.parent !== null ? [] : r.links.filter((l) => {
      const other = tops.get(l.to);
      if (!other || other.id === r.id) return false;
      if (l.kind !== 'same') return true;
      const back = (other.links ?? []).some((b) => b.to === r.id && b.kind === 'same');
      return !back || older(r, other);
    });
    if (keep.length === r.links.length) return r;
    changed = true;
    const { links: _old, ...rest } = r;
    return keep.length > 0 ? { ...rest, links: keep } : rest;
  });
  return changed ? out : replies;
}

// その時の関連に、外す・足すを当てる（外すのが先。足すで同じ相手に別の種類なら置き換え）
//   allow(to, kind)：その相手と結んでよいか（相手が一番上のカードにある・自分ではない・逆向きの「同じ」が無い）。持ち主が確かめる
//   links：変わらなければ null／over：10 本を超えた分を捨てた／refused：allow が断った数
//   外すのは「同じ相手・同じ種類」のときだけ（ほかの画面で種類が変わった関連を、黙って外さない）
export function changeLinkList(
  current: readonly ReplyLink[],
  add: readonly unknown[],
  remove: readonly unknown[],
  allow: (to: string, kind: LinkKind) => boolean,
): { links: ReplyLink[] | null; over: boolean; refused: number } {
  let next = [...current];
  for (const raw of remove) {
    const link = parseLink(raw);
    if (link) next = next.filter((l) => !(l.to === link.to && l.kind === link.kind));
  }
  let over = false;
  let refused = 0;
  for (const raw of add) {
    const link = parseLink(raw);
    if (!link) continue;
    const at = next.findIndex((l) => l.to === link.to);
    if (at >= 0 && next[at].kind === link.kind) continue;
    if (!allow(link.to, link.kind)) {
      refused += 1;
      continue;
    }
    if (at >= 0) {
      next[at] = link; // 同じ相手に別の種類：置き換え（並びの位置は変えない）
      continue;
    }
    if (next.length >= MAX_LINKS_PER_CARD) {
      over = true;
      continue;
    }
    next.push(link);
  }
  const same = next.length === current.length && next.every((l, i) => l.to === current[i].to && l.kind === current[i].kind);
  return { links: same ? null : next, over, refused };
}

// カードの題（線の title・一覧・まとめてコピーに使う）：文の 1 行目、無ければ引用の題名、無ければ（画像）
export function cardLabel(reply: Pick<Reply, 'text' | 'quote' | 'image'>, max: number): string {
  const line = reply.text.split('\n').find((s) => s.trim() !== '')?.trim() ?? '';
  const base = line || reply.quote?.title.trim() || (reply.quote?.text.trim().split('\n')[0] ?? '') || (reply.image ? '（画像）' : '（空）');
  const chars = [...base];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : base;
}

// 「元」は「相手」の根拠／「元」と「相手」は同じ（画面の文はすべてこの形にそろえる）
export function linkSentence(from: string, to: string, kind: LinkKind): string {
  const name = linkKindInfo(kind).name;
  return kind === 'same' ? `${from}と${to}は${name}` : `${from}は${to}の${name}`;
}

// ---------- 線（L3）：カードの隙間を通る直交の経路と、区間ごとの線路 ----------
//   ・カードの並び（grid）の行と列を、見えているカードの位置から読む。横の隙間＝行のあいだ（いちばん下は外周の下の余白）、縦の隙間＝列のあいだ（両端は外周の余白）
//   ・経路は一本道の決まり：相手が下（同じ行を含む）なら元の下の辺から下の横の隙間へ、上なら上の辺から上の横の隙間へ。
//     隣の行・同じ行なら、横の隙間を渡って相手の辺へ。離れた行なら、相手の列の側の縦の隙間で行を越え、相手の上（下）の横の隙間から入る
//   ・同じ隙間を並んで通る線は線路（track）を分ける（4px おき。隙間の真ん中から外へ）。線の順は渡された順（元のカードの作った順、同じ元なら付けた順）で、
//     前の線から先に線路を取るので、後ろに線を足しても前の線の線路は動かない。線どうしが交わる点はあってよい
//   ・線路が足りないとき：同じ種類（同じ色）の線だけ相乗りする。それでも足りなければ overflow（呼ぶ側が「選んだカード」に切り替えて知らせる）
//   ・横の隙間（row-gap と外周の下の余白）は要る線路の数で 24〜48px（rowGap を返す。呼ぶ側が CSS に入れて測り直し、もう一度呼ぶ）。縦の隙間は呼ぶ側の幅のまま（24px なら 5 本）

export interface Point {
  x: number;
  y: number;
}

// 包み（線の層）の左上からの、カードの位置と大きさ（offsetLeft・offsetTop・offsetWidth・offsetHeight）
export interface CardBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LinkLayout {
  width: number; // 線の層の幅（外周の余白を含む）
  height: number;
  cards: CardBox[]; // 見えている一番上のカード
  heads?: { y: number; h: number }[]; // 線を通さない行（つながり順の見出し。M4）
}

export interface DrawLink {
  from: string;
  to: string;
  kind: LinkKind;
}

export interface LinkPath extends DrawLink {
  d: string; // path の d（角は半径 6 の丸み）
  points: Point[]; // 角の点（丸める前。確かめ用）
}

export interface LinkRoute {
  paths: LinkPath[];
  rowGap: number; // 横の隙間に要る幅（24〜48）
  overflow: boolean; // 相乗りしても線路が足りなかった
}

const TRACK = 4; // 線路の間
const CORNER = 6;
export const LINK_GAP = 24; // 関連があるときの列の隙間と外周の余白（線路 5 本）
export const ROW_GAP_MIN = 24;
export const ROW_GAP_MAX = 48;
const NEAR = 2; // 同じ列・同じ行と見なす位置のずれ

// 幅 size の隙間に入る線路の数（真ん中から 4px おきに外へ。縁から 4px は空ける）
export function trackCapacity(size: number): number {
  return Math.max(1, 2 * Math.floor((size / 2 - TRACK) / TRACK) + 1);
}

// n 本の線路に要る横の隙間（24〜48）
export function rowGapFor(tracks: number): number {
  const need = 2 * TRACK + 2 * TRACK * Math.ceil(Math.max(0, tracks - 1) / 2);
  return Math.min(ROW_GAP_MAX, Math.max(ROW_GAP_MIN, need));
}

// 隙間 [a, b] の中の線路 t の位置（0 が真ん中、1 は -4、2 は +4、3 は -8 …）
function trackAt(a: number, b: number, t: number): number {
  const step = t === 0 ? 0 : (t % 2 === 1 ? -1 : 1) * Math.ceil(t / 2);
  return (a + b) / 2 + step * TRACK;
}

// 近い値をひとまとめにして、小さい順に並べる
function bands(values: number[]): number[] {
  const out: number[] = [];
  for (const v of [...values].sort((a, b) => a - b)) if (out.length === 0 || v - out[out.length - 1] > NEAR) out.push(v);
  return out;
}

const bandOf = (list: readonly number[], v: number) => list.findIndex((u) => Math.abs(u - v) <= NEAR);

interface Channel {
  key: string;
  a: number; // 隙間の始まり（横の隙間は y、縦の隙間は x）
  b: number;
}

interface Piece {
  a: number;
  b: number;
  kind: LinkKind;
}

// カードの隙間を通る線の経路を作る（純粋な関数。DOM を使わない）
export function routeCardLinks(layout: LinkLayout, links: readonly DrawLink[]): LinkRoute {
  const box = new Map(layout.cards.map((c) => [c.id, c]));
  const colX = bands(layout.cards.map((c) => c.x));
  const rowY = bands(layout.cards.map((c) => c.y));
  const colRight = colX.map((x) => Math.max(...layout.cards.filter((c) => Math.abs(c.x - x) <= NEAR).map((c) => c.x + c.w)));
  const rowBottom = rowY.map((y) => Math.max(...layout.cards.filter((c) => Math.abs(c.y - y) <= NEAR).map((c) => c.y + c.h)));
  const C = colX.length;
  const R = rowY.length;
  const heads = layout.heads ?? [];

  // 縦の隙間 j（0 は左の外周、C は右の外周）
  const vgap = (j: number): Channel => ({ key: `v${j}`, a: j === 0 ? 0 : colRight[j - 1], b: j === C ? layout.width : colX[j] });
  // 横の隙間 k（0 は上の外周、R は下の外周）。見出しがあれば、見出しの上と下に分ける
  const hgap = (k: number, side: 'below' | 'above'): Channel => {
    const top = k === 0 ? 0 : rowBottom[k - 1];
    const bottom = k === R ? layout.height : rowY[k];
    const inside = heads.filter((h) => h.y >= top - NEAR && h.y + h.h <= bottom + NEAR);
    if (inside.length === 0) return { key: `h${k}`, a: top, b: bottom };
    if (side === 'below') return { key: `h${k}u`, a: top, b: Math.min(...inside.map((h) => h.y)) };
    return { key: `h${k}d`, a: Math.max(...inside.map((h) => h.y + h.h)), b: bottom };
  };
  const below = (row: number) => hgap(row + 1, 'below'); // その行のすぐ下の横の隙間
  const above = (row: number) => hgap(row, 'above'); // その行のすぐ上の横の隙間
  const mid = (c: Channel) => (c.a + c.b) / 2;

  // 経路の骨組み（線路と出入口の位置はあとで決める）
  type Plan = {
    link: DrawLink;
    index: number;
    A: CardBox;
    B: CardBox;
    exit: 'top' | 'bottom';
    entry: 'top' | 'bottom';
    h1: Channel;
    v: Channel | null;
    h2: Channel | null;
  };
  const plans: Plan[] = [];
  links.forEach((link, index) => {
    const A = box.get(link.from);
    const B = box.get(link.to);
    if (!A || !B || A === B) return;
    const rA = bandOf(rowY, A.y);
    const rB = bandOf(rowY, B.y);
    const cA = bandOf(colX, A.x);
    const cB = bandOf(colX, B.x);
    const side = cA > cB ? vgap(cB + 1) : vgap(cB); // 相手の列の、元の側の縦の隙間（同じ列・1 列なら左）
    if (rB === rA) plans.push({ link, index, A, B, exit: 'bottom', entry: 'bottom', h1: below(rA), v: null, h2: null });
    else if (rB === rA + 1) plans.push({ link, index, A, B, exit: 'bottom', entry: 'top', h1: below(rA), v: null, h2: null });
    else if (rB > rA) plans.push({ link, index, A, B, exit: 'bottom', entry: 'top', h1: below(rA), v: side, h2: above(rB) });
    else if (rB === rA - 1) plans.push({ link, index, A, B, exit: 'top', entry: 'bottom', h1: above(rA), v: null, h2: null });
    else plans.push({ link, index, A, B, exit: 'top', entry: 'bottom', h1: above(rA), v: side, h2: below(rB) });
  });

  // 出入口：カードの辺ごとに、線の向かう先の x の順に並べ、辺を等分した位置に置く
  type End = { plan: Plan; role: 'exit' | 'entry'; toward: number };
  const ends = new Map<string, End[]>();
  const center = (c: CardBox) => c.x + c.w / 2;
  for (const plan of plans) {
    const towardA = plan.v ? mid(plan.v) : center(plan.B);
    const towardB = plan.v ? mid(plan.v) : center(plan.A);
    const keyA = `${plan.A.id}:${plan.exit}`;
    const keyB = `${plan.B.id}:${plan.entry}`;
    ends.set(keyA, [...(ends.get(keyA) ?? []), { plan, role: 'exit', toward: towardA }]);
    ends.set(keyB, [...(ends.get(keyB) ?? []), { plan, role: 'entry', toward: towardB }]);
  }
  const port = new Map<Plan, { exit: number; entry: number }>();
  for (const [key, list] of ends) {
    const card = box.get(key.slice(0, key.lastIndexOf(':')));
    if (!card) continue;
    const left = card.x + Math.min(10, card.w / 4);
    const span = card.w - 2 * (left - card.x);
    list.sort((p, q) => p.toward - q.toward || p.plan.index - q.plan.index || (p.role === 'exit' ? -1 : 1));
    list.forEach((end, i) => {
      const x = left + (span * (i + 1)) / (list.length + 1);
      const got = port.get(end.plan) ?? { exit: 0, entry: 0 };
      got[end.role] = x;
      port.set(end.plan, got);
    });
  }

  // 線路：隙間ごと・線路ごとに、通っている区間を覚える
  const used = new Map<string, Piece[][]>();
  let overflow = false;
  const take = (ch: Channel, from: number, to: number, kind: LinkKind, cap: number): number => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const tracks = used.get(ch.key) ?? [];
    used.set(ch.key, tracks);
    const hits = (t: number) => (tracks[t] ?? []).filter((p) => Math.min(hi, p.b) - Math.max(lo, p.a) > 1);
    let pick = -1;
    for (let t = 0; t < cap && pick < 0; t++) if (hits(t).length === 0) pick = t;
    for (let t = 0; t < cap && pick < 0; t++) if (hits(t).every((p) => p.kind === kind)) pick = t; // 同じ種類だけ相乗り
    if (pick < 0) {
      overflow = true;
      pick = 0;
    }
    (tracks[pick] ??= []).push({ a: lo, b: hi, kind });
    return pick;
  };
  const hCap = trackCapacity(ROW_GAP_MAX); // 横の隙間は広げられる
  const paths: LinkPath[] = [];
  for (const plan of plans) {
    const { A, B, link } = plan;
    const xA = port.get(plan)?.exit ?? center(A);
    const xB = port.get(plan)?.entry ?? center(B);
    const yA = plan.exit === 'bottom' ? A.y + A.h : A.y;
    const yB = plan.entry === 'bottom' ? B.y + B.h : B.y;
    let points: Point[];
    if (!plan.v || !plan.h2) {
      const t1 = Math.abs(xA - xB) < 1 ? 0 : take(plan.h1, xA, xB, link.kind, hCap);
      const y1 = trackAt(plan.h1.a, plan.h1.b, t1);
      points = [{ x: xA, y: yA }, { x: xA, y: y1 }, { x: xB, y: y1 }, { x: xB, y: yB }];
    } else {
      const xv0 = mid(plan.v);
      const t1 = take(plan.h1, xA, xv0, link.kind, hCap);
      const tv = take(plan.v, mid(plan.h1), mid(plan.h2), link.kind, trackCapacity(plan.v.b - plan.v.a));
      const t2 = take(plan.h2, xv0, xB, link.kind, hCap);
      const y1 = trackAt(plan.h1.a, plan.h1.b, t1);
      const xv = trackAt(plan.v.a, plan.v.b, tv);
      const y2 = trackAt(plan.h2.a, plan.h2.b, t2);
      points = [{ x: xA, y: yA }, { x: xA, y: y1 }, { x: xv, y: y1 }, { x: xv, y: y2 }, { x: xB, y: y2 }, { x: xB, y: yB }];
    }
    paths.push({ ...link, points, d: roundedPath(points) });
  }

  // 横の隙間（行のあいだと下の外周）に要る線路の数
  let most = 0;
  for (const [key, tracks] of used) if (key.startsWith('h')) most = Math.max(most, tracks.length);
  return { paths, rowGap: rowGapFor(most), overflow };
}

// 角を丸めた path（同じ点・まっすぐ並んだ点は省く）
function roundedPath(points: readonly Point[]): string {
  const pts: Point[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    pts.push(p);
  }
  for (let i = pts.length - 2; i >= 1; i--) {
    const [p, c, n] = [pts[i - 1], pts[i], pts[i + 1]];
    if ((Math.abs(p.x - c.x) < 0.5 && Math.abs(c.x - n.x) < 0.5) || (Math.abs(p.y - c.y) < 0.5 && Math.abs(c.y - n.y) < 0.5)) pts.splice(i, 1);
  }
  if (pts.length < 2) return '';
  const f = (v: number) => String(Math.round(v * 10) / 10);
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, c, n] = [pts[i - 1], pts[i], pts[i + 1]];
    const lin = Math.hypot(c.x - p.x, c.y - p.y);
    const lout = Math.hypot(n.x - c.x, n.y - c.y);
    const r = Math.min(CORNER, lin / 2, lout / 2);
    const ax = c.x + ((p.x - c.x) / lin) * r;
    const ay = c.y + ((p.y - c.y) / lin) * r;
    const bx = c.x + ((n.x - c.x) / lout) * r;
    const by = c.y + ((n.y - c.y) / lout) * r;
    d += ` L${f(ax)} ${f(ay)} Q${f(c.x)} ${f(c.y)} ${f(bx)} ${f(by)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${f(last.x)} ${f(last.y)}`;
}

// 描く線：見えているカードどうしの関連だけを、元のカードの順（tops の順。区画は作った順で渡す＝並べ替えても線路の取る順は替わらない）・付けた順に
export function visibleLinks(tops: readonly Reply[], visible: ReadonlySet<string>): DrawLink[] {
  const out: DrawLink[] = [];
  for (const card of tops) {
    if (!visible.has(card.id)) continue;
    for (const link of card.links ?? []) if (visible.has(link.to)) out.push({ from: card.id, to: link.to, kind: link.kind });
  }
  return out;
}
