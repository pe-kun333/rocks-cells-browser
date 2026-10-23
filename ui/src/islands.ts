// 島：盤面でタブをまとめた集まり。名前と色を持ち、入っているタブは tab.island で示す
//   島を作るときは、入るタブをひとかたまりのセルへ寄せる（ほかのタブは動かさない。島どうしは1マスあける）
import { DIRECTIONS, type Hex, hexKey, hexToPixel } from './hex';
import type { Tab } from './tabs';
import { TAG_PALETTE } from './tags';
import type { Island } from './types';

export class IslandStore {
  private items: Island[] = [];
  private readonly listeners: (() => void)[] = [];

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  list(): Island[] {
    return [...this.items];
  }

  get(id: string | null) {
    return id === null ? undefined : this.items.find((i) => i.id === id);
  }

  replaceAll(islands: Island[]) {
    this.items = [...islands];
    this.emit();
  }

  add(island: Island) {
    this.items = [...this.items.filter((i) => i.id !== island.id), island];
    this.emit();
  }

  // 名前・色を変える（無い島は何もしない）
  update(id: string, patch: Partial<Pick<Island, 'name' | 'color'>>) {
    const at = this.items.findIndex((i) => i.id === id);
    if (at < 0) return;
    const next = { ...this.items[at], ...patch };
    if (next.name === this.items[at].name && next.color === this.items[at].color) return;
    this.items = this.items.map((i, n) => (n === at ? next : i));
    this.emit();
  }

  remove(id: string) {
    this.items = this.items.filter((i) => i.id !== id);
    this.emit();
  }

  // まだ使われていない色（無ければ順番に）
  nextColor(): string {
    const used = new Set(this.items.map((i) => i.color));
    return TAG_PALETTE.find((c) => !used.has(c)) ?? TAG_PALETTE[this.items.length % TAG_PALETTE.length];
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export function newIslandId() {
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// 島ごとに、入るタブの行き先を決める。戻り値：タブ → 行き先のセル
//   ・それぞれの島は、入るタブの今の位置の「まん中」にいちばん近いタブのセルから、近い順に空いたセルを使う
//   ・島に入らないタブのセルと、先に置いた島のまわり1マスは使わない
//   others：タブ以外でふさがっているセル（メモのセル）
export function layoutIslands(tabs: Tab[], groups: { tabIds: number[] }[], others: Hex[] = []): Map<number, Hex> {
  const moving = new Set(groups.flatMap((g) => g.tabIds));
  const taken = new Set([...tabs.filter((t) => !moving.has(t.id)).map((t) => hexKey(t.pos)), ...others.map(hexKey)]);
  const blocked = new Set<string>(); // 先に置いた島のセルと、そのまわり
  const result = new Map<number, Hex>();
  const byId = new Map(tabs.map((t) => [t.id, t]));

  const ordered = [...groups].sort((a, b) => b.tabIds.length - a.tabIds.length);
  for (const group of ordered) {
    const members = group.tabIds.map((id) => byId.get(id)).filter((t): t is Tab => !!t && !result.has(t.id));
    if (members.length === 0) continue;
    members.sort((a, b) => a.order - b.order);
    const anchor = centerMember(members).pos;
    const cells = freeCellsNear(anchor, members.length, (h) => taken.has(hexKey(h)) || blocked.has(hexKey(h)));
    members.forEach((tab, i) => result.set(tab.id, cells[i]));
    for (const cell of cells) {
      taken.add(hexKey(cell));
      blocked.add(hexKey(cell));
      for (const d of DIRECTIONS) blocked.add(hexKey({ q: cell.q + d.q, r: cell.r + d.r }));
    }
  }
  return result;
}

// 新しいタブのための、ひとかたまりの空いたセル（ほかのタブとは1マスあける）
//   keepWith：もうある島のセル。あれば、その島にくっつけて広げる
export function placeCluster(tabs: { pos: Hex }[], count: number, near: Hex, keepWith: Hex[] = []): Hex[] {
  const taken = new Set(tabs.map((t) => hexKey(t.pos)));
  const own = new Set(keepWith.map(hexKey));
  const nearOthers = new Set<string>();
  for (const t of tabs) {
    if (own.has(hexKey(t.pos))) continue;
    for (const d of DIRECTIONS) nearOthers.add(hexKey({ q: t.pos.q + d.q, r: t.pos.r + d.r }));
  }
  const blocked = (h: Hex) => taken.has(hexKey(h)) || nearOthers.has(hexKey(h));
  const anchor = keepWith.length > 0 ? keepWith[0] : freeCellsNear(near, 1, blocked)[0];
  return freeCellsNear(anchor, count, blocked);
}

// 決まった形（offsets）をまるごと置ける場所：形のどのセルも空いていて、ほかのタブと1マスあく場所を、near から近い順に探す
//   戻り値：offsets と同じ並びの行き先のセル
export function placeShape(tabs: { pos: Hex }[], offsets: Hex[], near: Hex): Hex[] {
  const taken = new Set(tabs.map((t) => hexKey(t.pos)));
  const nearOthers = new Set(taken);
  for (const t of tabs) for (const d of DIRECTIONS) nearOthers.add(hexKey({ q: t.pos.q + d.q, r: t.pos.r + d.r }));
  const fits = (a: Hex) => offsets.every((o) => !nearOthers.has(hexKey({ q: a.q + o.q, r: a.r + o.r })));
  const seen = new Set([hexKey(near)]);
  const queue: Hex[] = [near];
  for (let i = 0; i < queue.length && i < 20_000; i++) {
    const h = queue[i];
    if (fits(h)) return offsets.map((o) => ({ q: h.q + o.q, r: h.r + o.r }));
    for (const d of DIRECTIONS) {
      const next = { q: h.q + d.q, r: h.r + d.r };
      if (!seen.has(hexKey(next))) {
        seen.add(hexKey(next));
        queue.push(next);
      }
    }
  }
  // 見つからなければ、いちばん下のタブのさらに下へ
  const bottom = Math.max(0, ...tabs.map((t) => t.pos.r)) + 2;
  return offsets.map((o) => ({ q: near.q + o.q, r: bottom + o.r }));
}

// 入るタブの位置のまん中に、いちばん近いタブ
function centerMember(members: Tab[]): Tab {
  const points = members.map((t) => hexToPixel(t.pos, 1));
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  let best = members[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  members.forEach((tab, i) => {
    const d = (points[i].x - cx) ** 2 + (points[i].y - cy) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = tab;
    }
  });
  return best;
}

// start から近い順（幅優先）に、使えるセルを count 個
function freeCellsNear(start: Hex, count: number, isTaken: (h: Hex) => boolean): Hex[] {
  const cells: Hex[] = [];
  const seen = new Set([hexKey(start)]);
  const queue: Hex[] = [start];
  for (let i = 0; i < queue.length && cells.length < count; i++) {
    const h = queue[i];
    if (!isTaken(h)) cells.push(h);
    for (const d of DIRECTIONS) {
      const next = { q: h.q + d.q, r: h.r + d.r };
      const key = hexKey(next);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return cells;
}

// 六角形の辺 i（頂点 i と i+1 の間。頂点 0 は真上、時計回り）の向こう側にあるセルの向き
export const EDGE_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
];

// 島の名前の文字の大きさ（盤面の座標で）。盤面を縮めても、画面の上で min px より小さくしない（大きくしたときは base のまま）
export function islandLabelSize(zoom: number, base = 10, min = 10, max = 28): number {
  const z = zoom > 0 && Number.isFinite(zoom) ? zoom : 1;
  return Math.min(max, Math.max(base, min / z));
}

// 島に入れるときの名前の案：はじめのセルの題名（20字まで）。無ければ「島 n」
export function islandNameSuggestion(titles: string[], count: number): string {
  const first = titles.map((t) => t.trim()).find((t) => t.length > 0);
  return first ? [...first].slice(0, 20).join('') : `島 ${count + 1}`;
}
