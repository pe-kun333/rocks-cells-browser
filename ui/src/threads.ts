// コメントのスレッド：メモのセルの文章や、タブのメモを「元のポスト」にして、X の返信のように何段でもコメントをつなげる
//   ・返信は、元のポストの持ち主（メモのセル・タブのメモ）の中に、平らな一覧（parent で親を指す）で持つ
//   ・AI の相棒が書いた返信は by に、書いたキャラを残す
import { t } from './i18n';
import { parseLinks, pruneLinks, type ReplyLink } from './memo-card-links';
import { parseAt, type ReplyAt } from './reader-links';
import { normalizeTags } from './tags';

export interface Reply {
  id: string;
  parent: string | null; // 返信先の返信（null は元のポストへの返信）
  text: string; // 引用か画像があれば、空でもよい
  createdAt: number;
  by?: ReplyAuthor; // 書いた AI のキャラ（無ければ使う人）
  editedAt?: number; // 書き直した時刻（M2）
  quote?: ReplyQuote; // 引用（見せるのは M3。ここでは読み書きだけ）
  image?: string; // 画像の ID（shots\<ID>.json。形は /^shot[0-9a-z]+$/。見せるのは M3）
  file?: string; // ページ全体の画像を書き出したファイルの名前（M4）
  tags?: string[]; // カードのタグ（一番上のカードだけ。グループ＝タグ。下の区画で付ける。依頼②）
  links?: ReplyLink[]; // 関連（一番上のカードだけ。このカード → 相手の一番上のカード。10 本まで。memo-card-links.ts）
  rank?: number; // 並べた順（一番上のカードだけ。0 始まりの整数。無ければ後ろに作った順。下の区画で並べ替える。plan-memo-card-order の O1）
  at?: ReplyAt; // 結んだ区間（一番上のカードだけ。六角で見るの動画のマスとの線。reader-links.ts。plan-reader-video の V0）
}

export interface ReplyQuote {
  text: string; // ページの文（2,000字まで。前後の空白は取る）。空なら、画像の撮り元・ページのリンク
  url: string; // http・https だけ（2,048字まで。# から後ろは外して持つ）
  title: string; // ページの題名（200字まで）
}

// 返信を足すときに一緒に付けてよいもの（引用・画像・書き出したファイル・結んだ区間）
export interface ReplyExtra {
  quote?: ReplyQuote;
  image?: string;
  file?: string;
  at?: ReplyAt; // 一番上のカードにだけ付く（返信には付けない）
}

export interface ReplyAuthor {
  who: string; // キャラの id（main・fable・trio1 など）
  name: string; // 書いたときの名前
  model?: string;
  cost?: number; // 目安の料金（ドル）
}

// どのスレッドか（メモのセルの文章／タブのメモ）
export type ThreadRef = { kind: 'memo'; id: string } | { kind: 'note'; tabId: number; noteId: string };

// AI の相棒が返信を書いている途中（左サイドバーが持ち、右サイドバーにも知らせる）
export interface PendingReply {
  key: string; // スレッドの印（threadKey）
  parent: string | null;
  who: string;
  name: string;
}

export const MAX_REPLIES = 300; // 1つのスレッドの返信の数
export const MAX_REPLY_TEXT = 2000;
export const REPLY_FOLD = 280; // カードで先に見せる字数（上限ではない。相談2）
const MAX_QUOTE_TEXT = 2000;
const MAX_QUOTE_URL = 2048;
const MAX_QUOTE_TITLE = 200;
export const MAX_RANK = 1_000_000; // 番地（rank）の上限。これを越える次の行には置かず、ふつうの次の番地に足す

export const newReplyId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function threadKey(ref: ThreadRef): string {
  return ref.kind === 'memo' ? `m:${ref.id}` : `n:${ref.tabId}:${ref.noteId}`;
}

export function cleanReplyText(text: string): string {
  return [...String(text ?? '').replace(/\r\n?/g, '\n')].slice(0, MAX_REPLY_TEXT).join('').trim();
}

// その返信（null は元のポスト）への、直接の返信（古い順）
export function childrenOf(replies: readonly Reply[], parent: string | null): Reply[] {
  return replies.filter((r) => r.parent === parent).sort((a, b) => a.createdAt - b.createdAt);
}

// その返信（null は元のポスト）の下にある返信の数（孫も含む）
export function countUnder(replies: readonly Reply[], parent: string | null): number {
  return parent === null ? replies.length : descendantsOf(replies, parent).length;
}

// その返信の下にある返信（孫も含む。親が先）
export function descendantsOf(replies: readonly Reply[], id: string): Reply[] {
  const out: Reply[] = [];
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const child of childrenOf(replies, current ?? null)) {
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

// 元のポストから、その返信までの道（元のポストのすぐ下の返信が先頭）
export function pathTo(replies: readonly Reply[], id: string | null): Reply[] {
  const path: Reply[] = [];
  let current = id === null ? undefined : replies.find((r) => r.id === id);
  while (current && path.length < MAX_REPLIES) {
    path.unshift(current);
    const parent = current.parent;
    current = parent === null ? undefined : replies.find((r) => r.id === parent);
  }
  return path;
}

// 呼び出し側が決めてよい返信の id の形（newReplyId の形も入る。ボードの ref・メモの id と同じ字種・字数）
export const REPLY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// 呼び出し側が決めた id が使えない理由。使える（このメモの台帳にまだ無い）なら null。ほかのメモとは重なってよい（id はメモの中だけで決まる）
export function replyIdProblem(replies: readonly Reply[], id: unknown): 'form' | 'taken' | null {
  if (typeof id !== 'string' || !REPLY_ID_RE.test(id)) return 'form';
  return replies.some((r) => r.id === id) ? 'taken' : null;
}

// 返信を足す（返信先が無い・文が空で引用も画像も無い・数の上限・決めた id が使えないなら null）
//   extra の形が合わない項目は、その項目だけ付けない
//   replyId：呼び出し側が id を決めたいとき（B2-3a。省略すると今までどおり newReplyId）。形が合わない・このメモにもう同じ id があるときは、付け替えずに足さない（null）
export function withReply(
  replies: readonly Reply[],
  parent: string | null,
  text: string,
  by?: ReplyAuthor,
  extra?: ReplyExtra,
  replyId?: string,
): { replies: Reply[]; reply: Reply } | null {
  const clean = cleanReplyText(text);
  const quote = extra?.quote ? parseQuote(extra.quote) : undefined;
  const image = parseImageId(extra?.image);
  const file = parseFileName(extra?.file);
  const at = parent === null && extra?.at ? parseAt(extra.at) : undefined;
  if ((!clean && !quote && !image) || replies.length >= MAX_REPLIES) return null;
  if (parent !== null && !replies.some((r) => r.id === parent)) return null;
  if (replyId !== undefined && replyIdProblem(replies, replyId) !== null) return null;
  // 同じミリ秒に続けて足しても並びが崩れないように、いちばん新しい返信より後の時刻にする
  const latest = replies.reduce((max, r) => Math.max(max, r.createdAt), 0);
  const reply: Reply = {
    id: replyId ?? newReplyId(),
    parent,
    text: clean,
    createdAt: Math.max(Date.now(), latest + 1),
    ...(by ? { by } : {}),
    ...(quote ? { quote } : {}),
    ...(image ? { image } : {}),
    ...(file ? { file } : {}),
    ...(at ? { at } : {}),
  };
  return { replies: [...replies, reply], reply };
}

// 使う人の返信（by が無いもの）の文を書き直す。書き直した時刻を付ける
//   文を空にできるのは、引用か画像があるときだけ。相棒の返信は書き直せない（null）
export function withEdit(replies: readonly Reply[], id: string, text: string): Reply[] | null {
  const reply = replies.find((r) => r.id === id);
  if (!reply || reply.by) return null;
  const clean = cleanReplyText(text);
  if (!clean && !reply.quote && !reply.image) return null;
  const editedAt = Date.now();
  return replies.map((r) => (r.id === id ? { ...r, text: clean, editedAt } : r));
}

// 返信を消す（その下の返信も一緒に）。消えたカードへの関連も、ほかのカードから外す
export function withoutReply(replies: readonly Reply[], id: string): Reply[] {
  const gone = new Set([id, ...descendantsOf(replies, id).map((r) => r.id)]);
  return pruneLinks(replies.filter((r) => !gone.has(r.id)));
}

// 一番上のカードの並び（並べた順）：rank の小さい順 → rank の無いものは後ろに作った順 → id の文字順
//   左（台帳）と下の区画の両方が使う。返信の木（childrenOf）・つながり順・線の順は作った順のまま
export function byOrder(a: Reply, b: Reply): number {
  const ra = a.rank ?? Infinity;
  const rb = b.rank ?? Infinity;
  if (ra !== rb) return ra < rb ? -1 : 1; // Infinity どうしを引くと NaN になるので比べる
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// 一番上のカードを、並べた順で
export function orderedTops(replies: readonly Reply[]): Reply[] {
  return replies.filter((r) => r.parent === null).sort(byOrder);
}

// 一番上のカードを、作った順で（同じ時刻なら id の文字順。線路の取る順など、並べ替えに左右されないもの）
export function createdTops(replies: readonly Reply[]): Reply[] {
  return replies.filter((r) => r.parent === null).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------- 試し：カードの置き場（rank を 3 列の升目の番地として読む。番地 = 行 × 3 ＋ 列。間を空けてよい） ----------
//   ・台帳の形は変えない（rank は 0 始まりの整数のまま）。前の版や書き出し・取り込みは、並べた順として読む（間は詰まって見える）
//   ・rank の無いカード（並べたことのないメモ・新しく足したカード）は、最後のカードの次の番地から作った順に
export const CARD_COLUMNS = 3;

// 一番上のカードの番地（並べた順に。重なる・逆になる番地は、前のカードの次へずらす）
export function topSlots(replies: readonly Reply[]): Map<string, number> {
  const out = new Map<string, number>();
  let prev = -1;
  for (const r of orderedTops(replies)) {
    const slot = r.rank !== undefined && r.rank > prev ? r.rank : prev + 1;
    out.set(r.id, slot);
    prev = slot;
  }
  return out;
}

// 番地に空きがあるか（最後のカードより前に、カードの無い番地がある）
export function hasSlotGaps(replies: readonly Reply[]): boolean {
  let i = 0;
  for (const slot of topSlots(replies).values()) if (slot !== i++) return true;
  return false;
}

// 置いてよい番地のいちばん後ろ：使っている行の次の 1 行まで
export function lastPlaceableSlot(slots: ReadonlyMap<string, number>): number {
  const max = Math.max(-1, ...slots.values());
  const rows = max < 0 ? 0 : Math.floor(max / CARD_COLUMNS) + 1;
  return (rows + 1) * CARD_COLUMNS - 1;
}

// 一番下のカードがある行の、次の行の 1 列目（番地 = (最後の行 + 1) × 3）。カードが 0 枚なら 0。
//   その番地が MAX_RANK か lastPlaceableSlot を越えるなら null（ふつうの次の番地に足す）
export function nextRowSlot(replies: readonly Reply[]): number | null {
  const slots = topSlots(replies);
  const slot = slots.size === 0 ? 0 : (Math.floor(Math.max(...slots.values()) / CARD_COLUMNS) + 1) * CARD_COLUMNS;
  if (slot > MAX_RANK || slot > lastPlaceableSlot(slots)) return null;
  return slot;
}

// 足す前に、次の行へ置くか・ふつうの次の番地に落ちるかを決める。件数の上限で足せないときは null
export function nextRowAddPlan(replies: readonly Reply[]): { slot: number; nextRow: boolean } | null {
  if (replies.length >= MAX_REPLIES) return null;
  const wanted = nextRowSlot(replies);
  if (wanted !== null) return { slot: wanted, nextRow: true };
  const slots = topSlots(replies);
  const slot = slots.size === 0 ? 0 : Math.max(...slots.values()) + 1;
  return { slot, nextRow: false };
}

// 足したあとの状態の行（置いた行と列。1 始まり）。nextRow が false のときは、ふつうの次の番地に落ちたこと
export function addedCardPlaceText(slot: number, nextRow: boolean): string {
  const where = t('{0} 行目の {1} 列目', { 0: Math.floor(slot / CARD_COLUMNS) + 1, 1: (slot % CARD_COLUMNS) + 1 });
  return nextRow ? t('コメントを {0}に足しました', { 0: where }) : t('次の行には置けないので、{0}に足しました', { 0: where });
}

// 番地の表を rank に書いた返信（一番上のカード全部に rank。返信の位置と中身は変えない）。変わらなければ null
function withSlots(replies: readonly Reply[], next: ReadonlyMap<string, number>): Reply[] | null {
  let changed = false;
  const out = replies.map((r) => {
    const n = r.parent === null ? next.get(r.id) : undefined;
    if (n === undefined || r.rank === n) return r;
    changed = true;
    return { ...r, rank: n };
  });
  return changed ? out : null;
}

// 一番上のカード replyId を、一番上のカード before の前へ（null は最後のカードの次へ）動かす（差し込み）
//   ・before と、元の場所の間がすき間なく続いていれば、その間のカードを一つずつずらす（今までの並べ替えと同じ。穴はできない）
//   ・間に空きがあれば、before から後ろへ、次の空きまでのカードを一つずつ後ろへ押す（元の場所は空く。ほかの空きは残す）
//   動かせない（replyId・before が一番上のカードに無い・before が自分）・番地が変わらないときは null
export function withMovedTop(replies: readonly Reply[], replyId: string, before: string | null): Reply[] | null {
  if (before === replyId) return null;
  const slots = topSlots(replies);
  const from = slots.get(replyId);
  if (from === undefined) return null;
  if (before !== null && !slots.has(before)) return null;
  const others = new Map([...slots].filter(([id]) => id !== replyId));
  const byslot = new Map([...others].map(([id, n]): [number, string] => [n, id]));
  const target = before === null ? Math.max(-1, ...others.values()) + 1 : (others.get(before) as number);
  const next = new Map(others);
  const contiguous = (a: number, b: number) => {
    for (let n = a; n <= b; n++) if (!byslot.has(n)) return false;
    return true;
  };
  if (from < target && contiguous(from + 1, target - 1)) {
    // 後ろへ：間のカードを一つずつ前へ
    for (let n = from + 1; n < target; n++) next.set(byslot.get(n) as string, n - 1);
    next.set(replyId, target - 1);
  } else {
    // 前へ（元の場所までのカードを一つずつ後ろへ）・間に空きがある：before から次の空きまで押す
    let n = target;
    while (byslot.has(n)) n++;
    for (let k = n - 1; k >= target; k--) next.set(byslot.get(k) as string, k + 1);
    next.set(replyId, target);
  }
  if ([...next].every(([id, n]) => slots.get(id) === n)) return null;
  return withSlots(replies, next);
}

// withReply のあと、一番上のカード（parent が null）だけを nextRowSlot の番地へ置く。
//   返信は今までどおり（slot は null。番地は動かさない）。次の行に置けないときは、足したカードを動かさない（ふつうの次の番地）。
//   ほかのカードの番地は動かさない（withPlacedTop。rank の無いカードは、今見えている番地のまま rank になる）。
//   すでにその番地なら rank は書かない。足せなければ null（withReply と同じ。件数の上限も含む）
export function withReplyOnNextRow(
  replies: readonly Reply[],
  parent: string | null,
  text: string,
  by?: ReplyAuthor,
  extra?: ReplyExtra,
  replyId?: string,
): { replies: Reply[]; reply: Reply; slot: number | null; nextRow: boolean } | null {
  const added = withReply(replies, parent, text, by, extra, replyId);
  if (!added) return null;
  if (parent !== null) return { replies: added.replies, reply: added.reply, slot: null, nextRow: false };
  const wanted = nextRowSlot(replies);
  const natural = topSlots(added.replies).get(added.reply.id) ?? null;
  if (wanted === null) return { replies: added.replies, reply: added.reply, slot: natural, nextRow: false };
  if (natural === wanted) return { replies: added.replies, reply: added.reply, slot: wanted, nextRow: true };
  const placed = withPlacedTop(added.replies, added.reply.id, wanted);
  if (!placed) return { replies: added.replies, reply: added.reply, slot: natural, nextRow: false };
  const reply = placed.find((r) => r.id === added.reply.id) ?? added.reply;
  return { replies: placed, reply, slot: wanted, nextRow: true };
}

// 一番上のカード replyId を、空いた番地 slot に置く。埋まっている・置けない番地（使っている行の次の行より後ろ）・同じ所なら null
export function withPlacedTop(replies: readonly Reply[], replyId: string, slot: number): Reply[] | null {
  const slots = topSlots(replies);
  const from = slots.get(replyId);
  if (from === undefined || !Number.isInteger(slot) || slot < 0 || slot === from) return null;
  if (slot > lastPlaceableSlot(slots) || slot > MAX_RANK) return null;
  for (const [id, n] of slots) if (n === slot && id !== replyId) return null;
  const next = new Map(slots);
  next.set(replyId, slot);
  return withSlots(replies, next);
}

// 空きを詰める（並べた順のまま 0, 1, 2… に振り直す）。空きが無ければ null
export function withPackedTops(replies: readonly Reply[]): Reply[] | null {
  if (!hasSlotGaps(replies)) return null;
  const next = new Map(orderedTops(replies).map((r, i): [string, number] => [r.id, i]));
  return withSlots(replies, next);
}

// 並べた順を消す（一番上のカード全部の rank を外し、作った順に戻す）。rank が一つも無ければ null
export function withoutTopOrder(replies: readonly Reply[]): Reply[] | null {
  if (!replies.some((r) => r.rank !== undefined)) return null;
  return replies.map((r) => {
    if (r.rank === undefined) return r;
    const { rank: _old, ...rest } = r;
    return rest;
  });
}

// コピー・貼り付け用：その返信の下の返信を、新しい元のポストへの返信として付け直す（id は新しくする）
//   関連は相手の id も新しくする。写す範囲の外を指す関連は捨てる（スレッドを丸ごと写すときだけ関連が残る）
export function regraft(replies: readonly Reply[], under: string | null): Reply[] {
  const source = under === null ? [...replies] : descendantsOf(replies, under);
  const ids = new Map(source.map((r) => [r.id, newReplyId() + Math.random().toString(36).slice(2, 4)]));
  return source.map((r) => {
    const { links, ...rest } = r;
    const moved = (links ?? []).flatMap((l) => {
      const to = ids.get(l.to);
      return to ? [{ to, kind: l.kind }] : [];
    });
    return {
      ...rest,
      id: ids.get(r.id) ?? r.id,
      parent: r.parent === under || r.parent === null ? null : (ids.get(r.parent) ?? null),
      ...(moved.length > 0 ? { links: moved } : {}),
    };
  });
}

// 保存してあった「書いた AI のキャラ」を読む（形が崩れていれば undefined）
export function parseAuthor(raw: unknown): ReplyAuthor | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const by = raw as Record<string, unknown>;
  if (typeof by.who !== 'string' || typeof by.name !== 'string') return undefined;
  return {
    who: by.who,
    name: by.name.slice(0, 20),
    ...(typeof by.model === 'string' ? { model: by.model } : {}),
    ...(typeof by.cost === 'number' && Number.isFinite(by.cost) ? { cost: by.cost } : {}),
  };
}

// 引用（url が http・https のときだけ。# から後ろは持たない。形が崩れれば undefined）
export function parseQuote(raw: unknown): ReplyQuote | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const q = raw as Record<string, unknown>;
  if (typeof q.url !== 'string' || typeof q.text !== 'string' || typeof q.title !== 'string') return undefined;
  const hash = q.url.indexOf('#');
  const url = (hash >= 0 ? q.url.slice(0, hash) : q.url).trim();
  if (!url || [...url].length > MAX_QUOTE_URL) return undefined;
  try {
    const protocol = new URL(url).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return undefined;
  } catch {
    return undefined;
  }
  return {
    text: [...q.text.replace(/\r\n?/g, '\n').trim()].slice(0, MAX_QUOTE_TEXT).join(''),
    url,
    title: [...q.title.trim()].slice(0, MAX_QUOTE_TITLE).join(''),
  };
}

// 同じページか（# 以降と、最後の / の有る無しは見ない）
export function samePage(a: string, b: string) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (u: URL) => u.pathname.replace(/\/+$/, '');
    return x.origin === y.origin && path(x) === path(y) && x.search === y.search;
  } catch {
    return false;
  }
}

// 引用元のボタンの文（↗ 題名（ドメイン））。題名が空なら「ページ」
export function quoteSourceLabel(quote: ReplyQuote): string {
  let host = '';
  try {
    host = new URL(quote.url).hostname;
  } catch {
    host = '';
  }
  const title = quote.title.trim() || t('ページ');
  return host ? `↗ ${title}（${host}）` : `↗ ${title}`;
}

// その文の所へ飛ぶ URL（url#:~:text=）。40字以下は全部を1つ。それより長ければ最初の20字と最後の20字
//   encodeURIComponent のあと、- , & も符号にする（区切りと取り違えないように）
export function quoteFragmentUrl(url: string, text: string): string {
  const hash = url.indexOf('#');
  const base = hash >= 0 ? url.slice(0, hash) : url;
  const chars = [...text];
  if (chars.length === 0) return base;
  const enc = (part: string) => encodeURIComponent(part).replaceAll('-', '%2D').replaceAll(',', '%2C').replaceAll('&', '%26');
  const body = chars.length <= 40 ? enc(chars.join('')) : `${enc(chars.slice(0, 20).join(''))},${enc(chars.slice(-20).join(''))}`;
  return `${base}#:~:text=${body}`;
}

// #:~:text= の始めと終わり。区切りのコンマは符号にしていない方（本文のコンマは %2C）
function textFragmentParts(fragmentUrl: string): { start: string; end: string } | null {
  const hashAt = fragmentUrl.indexOf('#');
  if (hashAt < 0) return null;
  const hash = fragmentUrl.slice(hashAt + 1);
  const marker = ':~:text=';
  const at = hash.indexOf(marker);
  if (at < 0) return null;
  let raw = hash.slice(at + marker.length);
  const amp = raw.indexOf('&');
  if (amp >= 0) raw = raw.slice(0, amp);
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return '';
    }
  };
  const comma = raw.indexOf(',');
  const start = decode(comma < 0 ? raw : raw.slice(0, comma));
  const end = comma < 0 ? start : decode(raw.slice(comma + 1));
  if (!start.trim()) return null;
  return { start, end: end.trim() ? end : start };
}

// ページの中で引用を色づけて、そこまでスクロールするスクリプト（左が、タブが見えて読み終わってから渡す）
//   プログラムから開いた #:~:text= は、Chromium が色を付けないことがある。ページの中で範囲を塗る
//   空白・改行は比べない（選んだ文の改行と、ページの文のつなぎ方が合わないことがある）
//   塗る色は作ったスタイルシート（adoptedStyleSheets）で置く。ページの CSP に止められない。だめなら <style>
//   それも置けないページだけ、人が押した扱いでリンクをクリックして、ブラウザ自身の色に頼む
export function quoteMarkScript(fragmentUrl: string): string {
  const parts = textFragmentParts(fragmentUrl);
  if (!parts) return '';
  const start = JSON.stringify(parts.start);
  const end = JSON.stringify(parts.end);
  const href = JSON.stringify(fragmentUrl);
  return `(() => {
  const start = ${start};
  const end = ${end};
  const href = ${href};
  const squash = (s) => s.replace(/\\s+/g, '');
  const wantStart = squash(start);
  const wantEnd = squash(end);
  if (!wantStart) return { found: false };
  const root = document.body || document.documentElement;
  if (!root) return { found: false };
  const hiddenOf = new Map();
  const hidden = (el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (hiddenOf.has(el)) return hiddenOf.get(el);
    const cs = getComputedStyle(el);
    const result = cs.display === 'none' || cs.visibility === 'hidden' || hidden(el.parentElement);
    hiddenOf.set(el, result);
    return result;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chars = [];
  let flat = '';
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent || parent.closest('script, style, noscript, textarea, input, template')) continue;
    if (hidden(parent)) continue;
    const text = node.textContent || '';
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (/\\s/.test(ch)) continue;
      flat += ch;
      chars.push({ node: node, offset: i });
    }
  }
  const at = flat.indexOf(wantStart);
  if (at < 0) {
    try {
      const plain = start.replace(/\\s+/g, ' ').trim().slice(0, 80);
      if (plain && window.find && window.find(plain, false, false, true)) return { found: true, painted: false };
    } catch (e) {}
    return { found: false };
  }
  let to = at + wantStart.length - 1;
  if (wantEnd && wantEnd !== wantStart) {
    const endAt = flat.indexOf(wantEnd, at + wantStart.length);
    if (endAt >= 0) to = endAt + wantEnd.length - 1;
  }
  const fromPos = chars[at];
  const toPos = chars[to];
  if (!fromPos || !toPos) return { found: false };
  const range = document.createRange();
  try {
    range.setStart(fromPos.node, fromPos.offset);
    range.setEnd(toPos.node, toPos.offset + 1);
  } catch (e) {
    return { found: false };
  }
  const mark = fromPos.node.parentElement;
  if (mark && mark.scrollIntoView) mark.scrollIntoView({ block: 'center', inline: 'nearest' });
  // theme: fixed begin：ページに差し込む引用の印（ページの中の色）
  const rule = '::highlight(honeycomb-quote){background-color:#ffd24a;color:#1a1a1a}';
  // theme: fixed end
  let painted = false;
  if (window.CSS && CSS.highlights && window.Highlight) {
    try {
      let sheet = window.__honeycombQuoteSheet;
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(rule);
        window.__honeycombQuoteSheet = sheet;
      }
      if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      painted = true;
    } catch (e) {}
    if (!painted) {
      try {
        let style = document.getElementById('honeycomb-quote-style');
        if (!style) {
          style = document.createElement('style');
          style.id = 'honeycomb-quote-style';
          style.textContent = rule;
          (document.head || document.documentElement).appendChild(style);
        }
        painted = !!(style.sheet && style.sheet.cssRules.length);
      } catch (e) {}
    }
    if (painted) {
      try {
        CSS.highlights.set('honeycomb-quote', new Highlight(range));
      } catch (e) {
        painted = false;
      }
    }
  }
  if (!painted) {
    try {
      const hash = href.indexOf('#');
      const frag = hash >= 0 ? href.slice(hash) : '';
      if (frag.indexOf(':~:text=') >= 0) {
        const a = document.createElement('a');
        a.href = String(location.href).split('#')[0] + frag;
        a.style.display = 'none';
        (document.body || document.documentElement).appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e) {}
  }
  return { found: true, painted: painted };
})()`;
}

function parseImageId(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length <= 64 && /^shot[0-9a-z]+$/.test(raw) ? raw : undefined;
}

function parseRank(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= MAX_RANK ? raw : undefined;
}

function parseFileName(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.includes('..')) return undefined;
  return /^[A-Za-z0-9._-]{1,80}\.(jpg|png)$/.test(raw) ? raw : undefined;
}

// 保存してあった返信を読む（形の崩れたもの・親の無いものは捨てる）
//   新しい項目は、形が合うときだけ残す（合わなければ、その項目だけ捨てる）
//   文が空でも、引用か画像があれば残す
export function parseReplies(raw: unknown): Reply[] {
  if (!Array.isArray(raw)) return [];
  const list: Reply[] = [];
  for (const item of raw.slice(0, MAX_REPLIES)) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id) continue;
    const quote = parseQuote(r.quote);
    const image = parseImageId(r.image);
    const file = parseFileName(r.file);
    const text = typeof r.text === 'string' ? cleanReplyText(r.text) : '';
    if (!text && !quote && !image) continue;
    const by = parseAuthor(r.by);
    const editedAt = typeof r.editedAt === 'number' && Number.isFinite(r.editedAt) ? r.editedAt : undefined;
    const tags = typeof r.parent === 'string' ? [] : normalizeTags(r.tags); // 一番上のカードだけ（返信のタグは読まない）
    const links = typeof r.parent === 'string' ? [] : parseLinks(r.links, r.id); // 関連も一番上のカードだけ（相手は最後に確かめる）
    const rank = typeof r.parent === 'string' ? undefined : parseRank(r.rank); // 並べた順も一番上のカードだけ
    const at = typeof r.parent === 'string' ? undefined : parseAt(r.at); // 結んだ区間も一番上のカードだけ
    list.push({
      id: r.id,
      parent: typeof r.parent === 'string' ? r.parent : null,
      text,
      createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
      ...(by ? { by } : {}),
      ...(editedAt !== undefined ? { editedAt } : {}),
      ...(quote ? { quote } : {}),
      ...(image ? { image } : {}),
      ...(file ? { file } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(links.length > 0 ? { links } : {}),
      ...(rank !== undefined ? { rank } : {}),
      ...(at ? { at } : {}),
    });
  }
  // 親が見つからない返信（と、その下）は捨てる。同じ id が2つあれば後のものを捨てる
  const seen = new Set<string>();
  const unique = list.filter((r) => !seen.has(r.id) && seen.add(r.id));
  const ok = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of unique) {
      if (!ok.has(r.id) && (r.parent === null || ok.has(r.parent))) {
        ok.add(r.id);
        changed = true;
      }
    }
  }
  // 関連は、相手が一番上のカードに残っているものだけ（逆向きの「同じ」の二本目も捨てる）
  return pruneLinks(unique.filter((r) => ok.has(r.id)));
}
