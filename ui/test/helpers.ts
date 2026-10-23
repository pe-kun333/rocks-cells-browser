// テストの道具：偽物の世界と id の作り手
import type { IdFactory, InterchangeWorld } from '../src/memo-interchange';

// 毎回同じ並びの id（重なりの検査を試すときは same を使う）
export function counterIds(prefix = ''): IdFactory {
  let n = 0;
  const next = (head: string) => () => `${head}${prefix}${(n++).toString(36)}`;
  return { sheet: next('sh'), island: next('i'), memo: next('m'), reply: next('r') };
}

export const NOW = Date.UTC(2026, 9, 17, 5, 0, 0); // 2026-10-17 14:00（日本）

export function world(over: Partial<InterchangeWorld> = {}): InterchangeWorld {
  return {
    now: NOW,
    ids: counterIds(),
    taken: new Set(),
    counts: { sheets: 3, memos: 10, islands: 2, boardLinks: 0 },
    limits: { sheets: 100, memos: 2000, islands: 50, boardLinks: 500 },
    sheetColor: () => '#2a9d8f',
    islandColor: (n) => ['#1d9bf0', '#00ba7c', '#f59e0b'][n % 3],
    portal: { sheet: 'main', pos: { q: 4, r: 4 } },
    ...over,
  };
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
