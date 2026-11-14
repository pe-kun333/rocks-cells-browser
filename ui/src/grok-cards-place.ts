// Grok Cards の出す場所（段 9）。DOM も localStorage も使わない
//   段 9 が無いときは、残っていても下の面。ホストへは upper か、戻すときの空だけを渡す
import { t } from './i18n';

export type CardsPlace = 'bottom' | 'upper';

export function normalizeCardsPlace(stage9: boolean, raw: unknown): CardsPlace {
  return stage9 && raw === 'upper' ? 'upper' : 'bottom';
}

export function cardsTabLabel(place: CardsPlace): string {
  return place === 'upper' ? t('↑ 上に出ています') : 'Grok Cards';
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

// ボードの「［全体］の間」だけ上を高くする（MK3。docs/plan-comment-board-marks.md §4.3）。下の区画は床まで狭めてよい（答え 7）
export const BORROW_LOWER_MIN = 150; // 下の区画の床（画素）
export const BORROW_LOWER_SPARE = 8; // 下の区画の動かない部分（帯・書く欄など）に足す少し
export const BORROW_TOTAL_MIN = UPPER_SPLIT_MIN * 2; // 全体の高さ（境目を除く）がこれ未満なら借りない（240）

// 借りたあとの上の割合。借りないときは null。total：境目を除いた高さ／ratio：今の割合（見えている値は clampUpperRatio）／
//   needPx：上に足してほしい高さ（ボードが出す）／lowerFixed：下の区画の動かない部分の高さ（借りるときに測る）。
//   下の床は max(150, 動かない部分 ＋ 8)。上は今の高さ＋needPx まで、床が許す所まで。今の上より狭めない（広げられなければ null）
export function borrowUpperRatio(total: number, ratio: number, needPx: number, lowerFixed: number): number | null {
  if (!Number.isFinite(total) || total < BORROW_TOTAL_MIN || !Number.isFinite(needPx) || needPx <= 0) return null;
  const floor = Math.max(BORROW_LOWER_MIN, (Number.isFinite(lowerFixed) ? Math.max(0, lowerFixed) : 0) + BORROW_LOWER_SPARE);
  const upperNow = clampUpperRatio(total, ratio) * total;
  const upperNext = Math.min(upperNow + needPx, total - floor);
  if (!(upperNext > upperNow)) return null;
  return clampUpperRatio(total, upperNext / total);
}

// 段 9 が無いとき、0 や 1 や数でないときは、半分として読む（保存はしない）
export function readUpperRatioRaw(stage9: boolean, raw: unknown): number {
  if (!stage9 || typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw >= 1) return UPPER_SPLIT_DEFAULT;
  return raw;
}
