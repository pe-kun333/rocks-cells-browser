// 下の区画の高さの範囲（DOM も bridge も使わない。memo-pane-host.ts が再び出す）
export const MEMO_PANE_MIN = 120;
export const MEMO_PANE_MAX = 1600;
export const MEMO_PANE_DEFAULT = 300;

export function clampMemoPaneHeight(n: number) {
  if (!Number.isFinite(n)) return MEMO_PANE_DEFAULT;
  return Math.max(MEMO_PANE_MIN, Math.min(MEMO_PANE_MAX, Math.round(n)));
}