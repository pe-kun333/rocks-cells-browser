// 盤面（サイドバー）の上に出す「カードの小窓」の一覧（P1）。どのセルのカードを、どこに出しているか
//   tab は uid（起動し直しても変わらない名前）、memo（メモ・入口・ボット・アプリ・撮ったもの）は memo の id で覚える
//   いちどに出せるのは MAX_CARD_WINS 個まで。prefs（localStorage）に残して、次の起動でも同じ所に出す
export type CardWinKind = 'tab' | 'memo';

export interface CardWin {
  kind: CardWinKind;
  key: string;
  x: number;
  y: number;
}

export const MAX_CARD_WINS = 6;

export function sameWin(a: { kind: CardWinKind; key: string }, b: { kind: CardWinKind; key: string }) {
  return a.kind === b.kind && a.key === b.key;
}

// 新しく出す。すでに出ていれば前へ（一覧の最後へ）回すだけ。いっぱいなら、見つからなくなった物（alive が false）を先に外す
//   それでもいっぱいなら null（出せない）
export function openWin(list: readonly CardWin[], win: CardWin, alive: (w: CardWin) => boolean = () => true): CardWin[] | null {
  const existing = list.find((w) => sameWin(w, win));
  if (existing) return [...list.filter((w) => w !== existing), existing];
  let next = list.slice();
  if (next.length >= MAX_CARD_WINS) next = next.filter(alive);
  if (next.length >= MAX_CARD_WINS) return null;
  return [...next, win];
}

export function closeWin(list: readonly CardWin[], target: { kind: CardWinKind; key: string }): CardWin[] {
  return list.filter((w) => !sameWin(w, target));
}

export function moveWin(list: readonly CardWin[], target: { kind: CardWinKind; key: string }, pos: { x: number; y: number }): CardWin[] {
  return list.map((w) => (sameWin(w, target) ? { ...w, x: Math.round(pos.x), y: Math.round(pos.y) } : w));
}

// prefs から読む（壊れた物・重なった物は捨てる）
export function parseCardWins(raw: unknown): CardWin[] {
  if (!Array.isArray(raw)) return [];
  const out: CardWin[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const v = item as Record<string, unknown>;
    if ((v.kind !== 'tab' && v.kind !== 'memo') || typeof v.key !== 'string' || !v.key) continue;
    if (typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
    const win: CardWin = { kind: v.kind, key: v.key, x: v.x, y: v.y };
    if (out.some((w) => sameWin(w, win))) continue;
    out.push(win);
    if (out.length >= MAX_CARD_WINS) break;
  }
  return out;
}
