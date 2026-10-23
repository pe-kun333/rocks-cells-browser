// Grok Cards の出す場所（段 9）。DOM も localStorage も使わない
//   段 9 が無いときは、残っていても下の面。ホストへは upper か、戻すときの空だけを渡す

export type CardsPlace = 'bottom' | 'upper';

export function normalizeCardsPlace(stage9: boolean, raw: unknown): CardsPlace {
  return stage9 && raw === 'upper' ? 'upper' : 'bottom';
}

export function cardsTabLabel(place: CardsPlace): string {
  return place === 'upper' ? '↑ 上に出ています' : 'Grok Cards';
}

// null は送らない。段 9 が無く、上半分を出したことも無いときは、今までの setSidebar のまま
export function hostPlaceCommand(stage9: boolean, place: CardsPlace, sentUpper: boolean): '' | 'upper' | null {
  if (stage9 && place === 'upper') return 'upper';
  if (sentUpper) return '';
  return null;
}

// 上半分の境目。ratio は上側の割合（0 より大きく 1 より小さい）。下の帯の高さとは別
export const UPPER_SPLIT_MIN = 120;
export const UPPER_SPLIT_DEFAULT = 0.5;
export const UPPER_SPLIT_STEP = 20;

// 両方とも min 以上。高さが足りないときは半分。比率が数でなければ半分
export function clampUpperRatio(total: number, ratio: number, min = UPPER_SPLIT_MIN): number {
  if (!Number.isFinite(total) || total < min * 2) return UPPER_SPLIT_DEFAULT;
  if (!Number.isFinite(ratio)) return UPPER_SPLIT_DEFAULT;
  const lo = min / total;
  const hi = 1 - lo;
  return Math.min(hi, Math.max(lo, ratio));
}

// offset は、境目を除いた高さの上端からの位置
export function upperRatioFromOffset(total: number, offset: number, min = UPPER_SPLIT_MIN): number {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(offset)) return UPPER_SPLIT_DEFAULT;
  return clampUpperRatio(total, offset / total, min);
}

// deltaPx が正なら上側が伸びる
export function nudgeUpperRatio(total: number, ratio: number, deltaPx: number, min = UPPER_SPLIT_MIN): number {
  const base = Number.isFinite(ratio) ? ratio : UPPER_SPLIT_DEFAULT;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(deltaPx)) return clampUpperRatio(total, base, min);
  return clampUpperRatio(total, base + deltaPx / total, min);
}

// 段 9 が無いとき、0 や 1 や数でないときは、半分として読む（保存はしない）
export function readUpperRatioRaw(stage9: boolean, raw: unknown): number {
  if (!stage9 || typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw >= 1) return UPPER_SPLIT_DEFAULT;
  return raw;
}
