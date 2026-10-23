// いいねの段階。タブとメモのセルの ♡（押すたびに 1→2→3→なし）で付く。タグの名前とは別。
export type LikeLevel = 1 | 2 | 3;

export const LIKE_LABEL: Record<LikeLevel, string> = { 1: 'いいね1', 2: 'いいね2', 3: 'いいね3' };

// 盤面の ♥ の色（.like-mark と同じ語。テーマで替わる）
export const LIKE_COLOR = 'var(--heart)';

export function likeLevel(value: unknown): LikeLevel | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}
