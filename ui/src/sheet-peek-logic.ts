// 試し：シートの入口の「小窓」（行き先のシートをのぞく）の、画面に関わらない計算
//   ・2回押しを自分で数える（dblclick は待たない。描き直しで的が変わっても数えられるように）
//   ・小窓の中の盤面の、はじめの位置（シートのセルを囲む四角のまん中を、小窓のまん中に）
//   ・小窓の置き場所（押した入口のすぐ下。入らなければすぐ上。盤面の中に収める）

export const PEEK_DOUBLE_MS = 400; // これより短い間に2回押したらダブルクリック（盤面と同じ）
export const PEEK_ZOOM = 0.75; // 小窓のはじめの拡大率
export const PEEK_MARGIN = 8; // 盤面の端からの空き（左右で 16px 狭い）
export const PEEK_HEIGHT_RATIO = 0.45; // 盤面の高さに対する小窓の高さ

type Point = { x: number; y: number };
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

// 2回押しを数える。press が返すのは、ダブルクリックになったときの1回目の key（ならなければ null）
//   sticky：1回目で押した所の中身が変わる（小窓の中で入口を押すと、小窓が行き先のシートに変わる）。
//   そのときは2回目の的が何であっても、短い間ならダブルクリックとして数える
export class ClickCounter {
  private last: { key: string; at: number; sticky: boolean } | null = null;

  constructor(private readonly ms = PEEK_DOUBLE_MS) {}

  press(key: string | null, now: number, sticky = false): string | null {
    const last = this.last;
    if (last && now - last.at <= this.ms && (last.sticky || (key !== null && last.key === key))) {
      this.last = null;
      return last.key;
    }
    this.last = key === null ? null : { key, at: now, sticky };
    return null;
  }

  reset() {
    this.last = null;
  }
}

// セルの中心（拡大率 1 の盤面の座標）を囲む四角のまん中が、大きさ size の窓のまん中に来る pan。セルが無ければ原点をまん中に
export function centerPan(points: readonly Point[], size: { width: number; height: number }, zoom: number): Point {
  if (points.length === 0) return { x: size.width / 2, y: size.height / 2 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { x: size.width / 2 - cx * zoom, y: size.height / 2 - cy * zoom };
}

// 小窓の大きさと場所（area・anchor は同じ座標。area は盤面の四角、anchor は押した入口のセル）
//   幅は盤面の幅 − 16px、高さは盤面の高さの 45%。入口のすぐ下に入らなければすぐ上、どちらも入らなければ広い方に寄せて盤面の中に収める
export function peekBox(anchor: Box | null, area: Box, gap = 6): Box {
  const width = Math.max(120, area.width - PEEK_MARGIN * 2);
  const height = Math.max(120, Math.min(area.height - PEEK_MARGIN * 2, Math.round(area.height * PEEK_HEIGHT_RATIO)));
  const left = area.left + (area.width - width) / 2;
  const minTop = area.top + PEEK_MARGIN;
  const maxTop = area.top + area.height - PEEK_MARGIN - height;
  if (!anchor) return { left, top: clampNum(area.top + (area.height - height) / 2, minTop, maxTop), width, height };
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - height;
  if (below <= maxTop) return { left, top: below, width, height };
  if (above >= minTop) return { left, top: above, width, height };
  // どちらにも入らない：広い方で、入口に重ならない高さまで低くする（それでも 120px 無ければ、重なってもよい）
  const roomBelow = area.top + area.height - PEEK_MARGIN - below;
  const roomAbove = anchor.top - gap - minTop;
  const room = Math.max(roomBelow, roomAbove);
  const h = Math.max(Math.min(height, room), Math.min(120, height));
  const top = roomBelow >= roomAbove ? below : anchor.top - gap - h;
  return { left, top: clampNum(top, minTop, area.top + area.height - PEEK_MARGIN - h), width, height: h };
}

// 動かした小窓を盤面の中に収める（引いた後の左上）
export function clampBox(box: Box, area: Box): Box {
  const left = clampNum(box.left, area.left, area.left + area.width - box.width);
  const top = clampNum(box.top, area.top, area.top + area.height - box.height);
  return { ...box, left, top };
}

function clampNum(v: number, lo: number, hi: number) {
  return hi < lo ? lo : Math.min(hi, Math.max(lo, v));
}
