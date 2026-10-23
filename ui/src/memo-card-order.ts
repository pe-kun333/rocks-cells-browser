// 下の区画のカードの並べ替えの純粋な関数（DOM を持たない。node でも確かめられる。plan-memo-card-order の O2・O3）
//   ・台帳を書くのは左だけ。区画は「この id の前へ」を頼み、写しが追いつくまでは、頼んだ並べ替え（待ち）を写しに当てて見せる
//   ・並び（byOrder）と、並べ替えた返信を作る関数（withMovedTop・withoutTopOrder）は threads.ts（左と区画の両方が使う）
import { orderedTops, type Reply, topSlots, withMovedTop, withoutTopOrder, withPackedTops, withPlacedTop } from './threads';

// 頼んだ並べ替えで、写しがまだ追いついていないもの（at：頼んだ時刻。古いものは区画が捨てる）
export type PendingOrder =
  | { kind: 'move'; id: string; before: string | null; at: number }
  | { kind: 'reset'; at: number }
  | { kind: 'place'; id: string; slot: number; at: number } // 試し：空いた番地へ置く
  | { kind: 'pack'; at: number }; // 試し：空きを詰める

// 写しの返信に、待ちの並べ替えを頼んだ順に当てた返信（区画で見せる並び。当てられない待ちは飛ばす）
export function withPending(replies: readonly Reply[], pending: readonly PendingOrder[]): readonly Reply[] {
  let out = replies;
  for (const p of pending) {
    const next =
      p.kind === 'reset' ? withoutTopOrder(out) : p.kind === 'pack' ? withPackedTops(out) : p.kind === 'place' ? withPlacedTop(out, p.id, p.slot) : withMovedTop(out, p.id, p.before);
    if (next) out = next;
  }
  return out;
}

// 写しがもう満たしている待ちか（動かしたカードが before の直前〈null なら最後〉にある・並べた順が無い）。
//   カードか before が無くなった待ちも、もう当てられないので満たしたものとする
function settled(replies: readonly Reply[], p: PendingOrder): boolean {
  if (p.kind === 'reset') return !replies.some((r) => r.rank !== undefined);
  if (p.kind === 'pack') {
    let i = 0;
    for (const slot of topSlots(replies).values()) if (slot !== i++) return false;
    return true;
  }
  if (p.kind === 'place') {
    const slot = topSlots(replies).get(p.id);
    return slot === undefined || slot === p.slot;
  }
  const ids = orderedTops(replies).map((r) => r.id);
  const i = ids.indexOf(p.id);
  if (i < 0) return true;
  if (p.before === null) return i === ids.length - 1;
  const j = ids.indexOf(p.before);
  return j < 0 || i === j - 1;
}

// 写しが届いたとき、先頭から捨ててよい待ちの数：写しが満たしている、いちばん後ろの待ちまで
//   （左は頼んだ順に当てるので、それより前の待ちは済んでいる。満たしていない古い待ちを当て直すと、並びが戻ってしまう）
export function settledCount(replies: readonly Reply[], pending: readonly PendingOrder[]): number {
  for (let k = pending.length - 1; k >= 0; k--) if (settled(replies, pending[k])) return k + 1;
  return 0;
}

// 置き場を決めるための、見えているカードの矩形（並びの順。自分を含む。座標は同じ基準なら何でもよい）
export interface DropBox {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// 置き場（dropIndexAt の答え）
//   index：自分を含めて数えた「前にあるカードの数」（自分を除いた位置へは dropPos で直す）。row：置き場のある行
//   mark：印を添えるカード（boxes の番号）と側（before＝左〈1 列なら上〉の隙間／after＝右〈1 列なら下〉の隙間）。oneColumn：1 列か（印は横の線）
export interface DropAt {
  index: number;
  row: number;
  mark: { box: number; side: 'before' | 'after' } | null;
  oneColumn: boolean;
}

// ポインターの位置から置き場を決める（ドラッグ。O3）
//   カードを上端で行に分ける。ポインターより上にある行はその枚数を数え、ポインターの行では中心より左にあるカードを数える
//   行と行の隙間は下の行の先頭。いちばん上の行より上は 0、いちばん下の行より下は最後。1 列のときは、カードの中心より上か下か
//   印は、ポインターの行の中の「入る番目のカードの左の隙間」、その行の最後なら「行の最後のカードの右の隙間」
export function dropIndexAt(boxes: readonly DropBox[], point: { x: number; y: number }): DropAt {
  const at = dropSlot(boxes, point);
  const oneColumn = at.rows.every((r) => r.end - r.start === 1);
  if (boxes.length === 0) return { index: 0, row: 0, mark: null, oneColumn };
  const row = at.rows[at.row];
  const mark = at.index < row.end ? { box: at.index, side: 'before' as const } : { box: row.end - 1, side: 'after' as const };
  return { index: at.index, row: at.row, mark, oneColumn };
}

function dropSlot(boxes: readonly DropBox[], point: { x: number; y: number }): { index: number; row: number; rows: { start: number; end: number; top: number; bottom: number }[] } {
  if (boxes.length === 0) return { index: 0, row: 0, rows: [] };
  const rows: { start: number; end: number; top: number; bottom: number }[] = [];
  boxes.forEach((b, i) => {
    const last = rows[rows.length - 1];
    if (last && Math.abs(b.top - last.top) < Math.max(4, (last.bottom - last.top) / 2)) {
      last.end = i + 1;
      last.bottom = Math.max(last.bottom, b.bottom);
    } else {
      rows.push({ start: i, end: i + 1, top: b.top, bottom: b.bottom });
    }
  });
  const oneColumn = rows.every((r) => r.end - r.start === 1);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (point.y < row.top) return { index: row.start, row: r, rows }; // この行より上（行と行の隙間は下の行の先頭）
    if (point.y > row.bottom && r < rows.length - 1) continue;
    if (oneColumn) {
      const b = boxes[row.start];
      return { index: point.y < (b.top + b.bottom) / 2 ? row.start : row.start + 1, row: r, rows };
    }
    if (point.y > row.bottom) return { index: boxes.length, row: r, rows }; // いちばん下の行より下は最後
    let index = row.start;
    for (let i = row.start; i < row.end; i++) if ((boxes[i].left + boxes[i].right) / 2 < point.x) index = i + 1;
    return { index, row: r, rows };
  }
  return { index: boxes.length, row: rows.length - 1, rows };
}

// dropIndexAt の index（自分を含めて数えた数）を、自分を除いた列の位置に直す（自分より後ろなら 1 引く。一覧の行のドラッグと同じ手当て）
//   返した位置が from と同じなら、元の位置（何もしない）
export function dropPos(index: number, from: number): number {
  return index > from ? index - 1 : index;
}

// 見えている列 visible（自分を含む。待ちを当てた並び）の id のカードを、自分を除いた列の pos 番目へ動かす命令の before
//   all：全体の並び（自分を含む。待ちを当てた並び）。絞りで隠れたカードは、触らずに順だけを保つ（落とした先の見えているカードの直前に入る）
//   列の最後へ動かすときは、全体の並び（自分を除く）で「最後に見えていたカードの次のカード」の前（無ければ null＝最後）
//   undefined：動かない（id が列に無い・pos が今の位置・列が自分だけ）
export function beforeFor(all: readonly string[], visible: readonly string[], id: string, pos: number): string | null | undefined {
  const from = visible.indexOf(id);
  if (from < 0) return undefined;
  const rest = visible.filter((v) => v !== id);
  if (rest.length === 0) return undefined;
  const at = Math.max(0, Math.min(Math.trunc(pos), rest.length));
  if (at === from) return undefined;
  if (at < rest.length) return rest[at];
  const others = all.filter((v) => v !== id);
  const i = others.indexOf(rest[rest.length - 1]);
  return i >= 0 && i + 1 < others.length ? others[i + 1] : null;
}
