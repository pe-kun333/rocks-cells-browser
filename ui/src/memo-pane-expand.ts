// 下の区画の［拡大］［縮小］の決まり（DOM も localStorage も使わない。ui/test/memo-pane-expand.test.ts）
//   区画は別の面なので、窓の高さは分からない。広げる先は「画面の使える高さ（screen.availHeight）の 7 割」（計画 §10 案 A）
//   高さを変える道は、つまみと同じ（setSidebar と writeMemoPanePrefs。呼ぶのは memo-pane.ts）
//   拡大前の高さは、画面（この関数の状態）だけで覚える。保存しない。保存されるのは今の高さだけ（開き直しても保たれる）
import { t } from './i18n';
import { clampMemoPaneHeight, MEMO_PANE_DEFAULT } from './memo-pane-limits';

export const EXPAND_RATIO = 0.7;
export const EXPAND_FLOOR = MEMO_PANE_DEFAULT + 120; // 画面が小さくても、広げ先はこれ以上
export const EXPAND_FALLBACK = 700; // 画面の高さが分からないとき
export const EXPAND_SLACK = 8; // これだけ手前なら「広げてある」とみなす

export interface ExpandState {
  height: number; // 今の高さ
  before: number | null; // ［拡大］で広げる前の高さ（広げていなければ null）
}

export function expandTarget(availHeight: number): number {
  if (!Number.isFinite(availHeight) || availHeight <= 0) return clampMemoPaneHeight(EXPAND_FALLBACK);
  return clampMemoPaneHeight(Math.max(EXPAND_FLOOR, Math.round(availHeight * EXPAND_RATIO)));
}

export function isExpanded(height: number, availHeight: number): boolean {
  return height >= expandTarget(availHeight) - EXPAND_SLACK;
}

// 戻す高さ：覚えている拡大前の高さ。無い・今より高い（おかしい）ときは既定の高さ
export function restoreHeight(state: ExpandState): number {
  const { before, height } = state;
  if (before !== null && Number.isFinite(before) && before < height - EXPAND_SLACK) return clampMemoPaneHeight(before);
  return MEMO_PANE_DEFAULT;
}

// ［拡大］［縮小］ボタン：広げてあれば戻し、そうでなければ広げる
export function toggleExpand(state: ExpandState, availHeight: number): ExpandState {
  if (isExpanded(state.height, availHeight)) return { height: restoreHeight(state), before: null };
  return { height: expandTarget(availHeight), before: clampMemoPaneHeight(state.height) };
}

// 縮小だけ（Esc・ボードのタブを離れるとき）。広げてなければ null（何もしない）
export function shrinkExpand(state: ExpandState, availHeight: number): ExpandState | null {
  if (!isExpanded(state.height, availHeight)) return null;
  return { height: restoreHeight(state), before: null };
}

// ボードのタブを離れるとき：このタブの［拡大］で広げたときだけ戻す（前から高かったときは、そのまま）
export function leaveExpand(state: ExpandState, availHeight: number): ExpandState | null {
  if (state.before === null) return null;
  return shrinkExpand(state, availHeight);
}

export function expandLabel(expanded: boolean): string {
  return expanded ? t('縮小') : t('拡大');
}