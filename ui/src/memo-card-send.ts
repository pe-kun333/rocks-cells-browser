// カード（一番上の返信）を、別のメモへ移す・写す計算（DOM も台帳も触らない）
//   ・カードは、その下の返信（💬）とタグと一緒に運ぶ。画像は同じ ID を指す
//   ・一緒に送るカード同士の関連は、新しい id でつなぎ直す。残るカードとの関連は切れる（写すときは、元の関連は元に残る）
//   ・呼び名は種類の id のまま運ぶ。画面の名前は、送り先のメモの呼称セットが決める（ここでは変えない）
//   ・送り先の並びの最後に、元の並び順のまま足す（rank は持たせず、時刻を送り先の後ろへずらす）
//   ・id は移すときも写すときも新しくする。1 つのメモの返信は MAX_REPLIES まで。超えるときは全部断る
import type { ReplyLink } from './memo-card-links';
import { pruneLinks } from './memo-card-links';
import { descendantsOf, MAX_REPLIES, newReplyId, orderedTops, type Reply } from './threads';

export type SendMode = 'move' | 'copy';

export interface LinkTravel {
  cut: number; // 送るカードと残るカードのあいだの関連（両向きを数える）
  kept: number; // 送るカード同士の関連（送り先に残る本数の目安。逆向きの「同じ」の二本目は、あとで捨てることがある）
  partners: string[]; // 残る側で、直接つながっている一番上のカード（並び順）
}

export type SendCardsResult =
  | {
      ok: true;
      from: Reply[];
      to: Reply[];
      cut: number;
      kept: number;
      tops: number;
      added: number;
      newTopIds: string[];
    }
  | { ok: false; why: 'empty' | 'missing' | 'full'; room?: number; need?: number };

// 送るカードと残るカードのあいだの関連と、一緒に送れば残る関連
export function linkTravel(replies: readonly Reply[], ids: readonly string[]): LinkTravel {
  const tops = new Set(replies.filter((r) => r.parent === null).map((r) => r.id));
  const sending = new Set(ids.filter((id) => tops.has(id)));
  let cut = 0;
  let kept = 0;
  const partner = new Set<string>();
  for (const reply of replies) {
    if (reply.parent !== null || !reply.links) continue;
    const fromIn = sending.has(reply.id);
    for (const link of reply.links) {
      if (!tops.has(link.to)) continue;
      const toIn = sending.has(link.to);
      if (fromIn && toIn) kept += 1;
      else if (fromIn !== toIn && (fromIn || toIn)) {
        cut += 1;
        partner.add(fromIn ? link.to : reply.id);
      }
    }
  }
  const partners = orderedTops(replies)
    .map((r) => r.id)
    .filter((id) => partner.has(id));
  return { cut, kept, partners };
}

// 関連でつながっている一番上のカード（無向。種にしたカードも含む。並び順）
export function linkedClosure(replies: readonly Reply[], ids: readonly string[]): string[] {
  const tops = orderedTops(replies);
  const topIds = new Set(tops.map((r) => r.id));
  const start = ids.filter((id) => topIds.has(id));
  const next = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  };
  for (const reply of replies) {
    if (reply.parent !== null || !reply.links) continue;
    for (const link of reply.links) {
      if (!topIds.has(reply.id) || !topIds.has(link.to) || reply.id === link.to) continue;
      add(reply.id, link.to);
      add(link.to, reply.id);
    }
  }
  const seen = new Set(start);
  const queue = [...start];
  while (queue.length > 0) {
    const id = queue.pop();
    if (!id) break;
    for (const other of next.get(id) ?? []) {
      if (seen.has(other)) continue;
      seen.add(other);
      queue.push(other);
    }
  }
  return tops.map((r) => r.id).filter((id) => seen.has(id));
}

// Shift＋クリックの範囲（並びの端から端まで。どちらかが見えなければ、押した 1 枚だけ）
export function rangeIds(order: readonly string[], anchor: string, target: string): string[] {
  const a = order.indexOf(anchor);
  const b = order.indexOf(target);
  if (a < 0 || b < 0) return target ? [target] : [];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return order.slice(lo, hi + 1);
}

// 送る前の確かめの文。切れる関連が無ければ null（呼び名の一言は、送ったあとの知らせに出す）
export function sendWarning(mode: SendMode, cut: number, kept: number): string | null {
  if (cut <= 0) return null;
  const head = mode === 'move' ? `関連 ${cut} 本が切れます` : `写しには、残るカードとの関連 ${cut} 本は入りません`;
  return kept > 0 ? `${head}。残る関連の呼び名は、送り先のメモの呼称に従います` : head;
}

// カードを送ったあとの、元と送り先の返信。入力の配列と中身は変えない
export function sendCards(input: {
  from: readonly Reply[];
  to: readonly Reply[];
  ids: readonly string[];
  mode: SendMode;
  newId?: () => string;
}): SendCardsResult {
  const wanted = [...new Set(input.ids.filter((id) => id))];
  if (wanted.length === 0) return { ok: false, why: 'empty' };
  const tops = orderedTops(input.from);
  const topIds = new Set(tops.map((r) => r.id));
  if (wanted.some((id) => !topIds.has(id))) return { ok: false, why: 'missing' };
  const sending = tops.filter((r) => wanted.includes(r.id));
  const pieces: Reply[] = [];
  for (const top of sending) pieces.push(top, ...descendantsOf(input.from, top.id));
  const need = pieces.length;
  const room = MAX_REPLIES - input.to.length;
  if (need > room) return { ok: false, why: 'full', room: Math.max(0, room), need };

  const travel = linkTravel(input.from, wanted);
  const used = new Set<string>([...input.from, ...input.to].map((r) => r.id));
  const make = input.newId ?? newReplyId;
  const idMap = new Map<string, string>();
  for (const reply of pieces) {
    let id = make();
    let guard = 0;
    while (used.has(id)) {
      guard += 1;
      id = guard > 8 ? `${make()}${guard.toString(36)}` : make();
      if (guard > 40) break;
    }
    used.add(id);
    idMap.set(reply.id, id);
  }
  const latest = input.to.reduce((max, r) => Math.max(max, r.createdAt), 0);
  const earliest = pieces.reduce((min, r) => Math.min(min, r.createdAt), Number.POSITIVE_INFINITY);
  const shift = Number.isFinite(earliest) ? Math.max(0, latest + 1 - earliest) : 0;
  const sentTops = new Set(sending.map((r) => r.id));
  const copies = pieces.map((reply) => copySent(reply, idMap, shift, sentTops));
  const gone = new Set(pieces.map((r) => r.id));
  const nextFrom = input.mode === 'move' ? pruneLinks(input.from.filter((r) => !gone.has(r.id))) : input.from.slice();
  const nextTo = pruneLinks([...input.to, ...copies]);
  const newTopIds = sending.map((r) => idMap.get(r.id) ?? r.id);
  const arrived = new Set(newTopIds);
  let kept = 0;
  for (const reply of nextTo) if (arrived.has(reply.id)) kept += reply.links?.length ?? 0;
  return { ok: true, from: nextFrom, to: nextTo, cut: travel.cut, kept, tops: sending.length, added: need, newTopIds };
}

function copySent(reply: Reply, idMap: ReadonlyMap<string, string>, shift: number, sentTops: ReadonlySet<string>): Reply {
  const copy = structuredClone(reply);
  copy.id = idMap.get(reply.id) ?? reply.id;
  copy.parent = reply.parent === null ? null : (idMap.get(reply.parent) ?? null);
  copy.createdAt = reply.createdAt + shift;
  delete copy.rank;
  if (reply.parent !== null || !reply.links?.length) {
    delete copy.links;
    return copy;
  }
  const links: ReplyLink[] = [];
  for (const link of reply.links) {
    if (!sentTops.has(link.to)) continue;
    const to = idMap.get(link.to);
    if (!to || to === copy.id) continue;
    links.push({ to, kind: link.kind });
  }
  if (links.length > 0) copy.links = links;
  else delete copy.links;
  return copy;
}
