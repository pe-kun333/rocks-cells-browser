// シートの入れ子（docs/ideas-sheet-folders.md の候補 2）：入口から組む。台帳は足さない
//   ・あるシートの「中」＝そのシートの盤面にある入口の行き先（盤面での並び。上の行から、行の中は左から）
//   ・入口を集めたシート（タブもメモも無く、入口だけがある）を「フォルダ」と呼ぶ
//   ・1 つのシートに入口が何か所あってもよい。段の中身は、その盤面の入口を全部出す
//   ・道しるべ・↑・起動し直したあとの ← の親は 1 つに決める：来た順の親 → メインからの最短 → 同じ深さなら古い入口 → 台帳の順
//   ・メインからたどれないシートも、必ずどこかの段に出す（呼ぶ側が「たどれない」の段に並べる）

export interface TreeSheet {
  id: string;
}

export interface TreeCell {
  sheet: string; // 置いてあるシート
  portal?: string; // 入口なら行き先のシート
  pos: { q: number; r: number };
  createdAt: number;
}

export interface SheetTree {
  // そのシートの中（入口の行き先。重なりなし・自分とメインは除く）
  children(host: string): string[];
  // メインからの深さ（たどれなければ undefined）
  depth(id: string): number | undefined;
  // 親（道しるべ・↑・← に使う）。prefer：来た順の親など、先に使いたいシート
  parentOf(id: string, prefer?: string | null): string | null;
  // メイン → … → id（メインからたどれなければ、たどれる所まで親をさかのぼる。輪で止める）
  path(id: string, prefer?: string | null): string[];
  // 中の中まで（輪で止める。自分は入れない）
  descendants(id: string): Set<string>;
  // メインからたどれないシート（台帳の順。メインは除く）
  unreachable: string[];
}

const byPos = (a: { q: number; r: number }, b: { q: number; r: number }) => a.r - b.r || a.q + a.r / 2 - (b.q + b.r / 2);

export function buildSheetTree(sheets: readonly TreeSheet[], cells: readonly TreeCell[], main = 'main'): SheetTree {
  const known = new Set(sheets.map((s) => s.id));
  const order = new Map(sheets.map((s, i) => [s.id, i]));
  const portals = cells.filter((c) => c.portal && known.has(c.portal) && known.has(c.sheet) && c.portal !== c.sheet);
  // 中：host → 行き先（盤面の並び）
  const kids = new Map<string, string[]>();
  const byHost = new Map<string, TreeCell[]>();
  for (const c of portals) {
    const list = byHost.get(c.sheet) ?? [];
    list.push(c);
    byHost.set(c.sheet, list);
  }
  for (const [host, list] of byHost) {
    const out: string[] = [];
    for (const c of [...list].sort((a, b) => byPos(a.pos, b.pos))) {
      const target = c.portal as string;
      if (target === main || out.includes(target)) continue;
      out.push(target);
    }
    kids.set(host, out);
  }
  const children = (host: string) => kids.get(host) ?? [];
  // 深さ（メインから入口で）
  const depths = new Map<string, number>([[main, 0]]);
  const queue = [main];
  while (queue.length > 0) {
    const host = queue.shift() as string;
    const d = depths.get(host) as number;
    for (const k of children(host)) {
      if (depths.has(k)) continue;
      depths.set(k, d + 1);
      queue.push(k);
    }
  }
  // 親の候補：その行き先の入口がある host と、その host にある入口でいちばん古い時刻
  const hostsOf = new Map<string, Map<string, number>>();
  for (const c of portals) {
    const target = c.portal as string;
    if (target === main) continue;
    const m = hostsOf.get(target) ?? new Map<string, number>();
    const prev = m.get(c.sheet);
    if (prev === undefined || c.createdAt < prev) m.set(c.sheet, c.createdAt);
    hostsOf.set(target, m);
  }
  const parentOf = (id: string, prefer?: string | null): string | null => {
    if (id === main) return null;
    const hosts = hostsOf.get(id);
    if (!hosts || hosts.size === 0) return null;
    if (prefer && hosts.has(prefer)) return prefer;
    const rank = (h: string) => depths.get(h) ?? Number.POSITIVE_INFINITY;
    return (
      [...hosts.entries()].sort(
        (a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0),
      )[0]?.[0] ?? null
    );
  };
  const path = (id: string, prefer?: string | null): string[] => {
    const out = [id];
    const seen = new Set([id]);
    let cur: string | null = parentOf(id, prefer);
    while (cur && !seen.has(cur)) {
      out.push(cur);
      seen.add(cur);
      if (cur === main) break;
      cur = parentOf(cur);
    }
    return out.reverse();
  };
  const descendants = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...children(id)];
    while (stack.length > 0) {
      const k = stack.pop() as string;
      if (k === id || out.has(k)) continue;
      out.add(k);
      stack.push(...children(k));
    }
    return out;
  };
  const unreachable = sheets.map((s) => s.id).filter((id) => id !== main && !depths.has(id));
  return { children, depth: (id) => depths.get(id), parentOf, path, descendants, unreachable };
}

// フォルダ（入口を集めたシート）か：タブが無く、メモのセルが 1 つ以上あって全部が入口
export function isFolderSheet(tabCount: number, memos: readonly { portal?: string }[]): boolean {
  return tabCount === 0 && memos.length > 0 && memos.every((m) => !!m.portal);
}

// シートの一覧を字で絞る（全角・半角・かなをそろえるのは呼ぶ側の fold に任せる）
//   当たる順：名前の頭 → 名前の中 → 入口のひとこと・島の名前
export function rankSheetMatch(query: string, name: string, extras: readonly string[]): number | null {
  const q = query.trim();
  if (!q) return null;
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  if (extras.some((t) => t.includes(q))) return 2;
  return null;
}
