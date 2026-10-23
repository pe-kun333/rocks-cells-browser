// 見た目のテーマの一覧（計画書 docs/plan-themes.md）。色の値は style.css（蜜蝋）と themes.css（ほか）にあり、ここは名前・明暗・並びだけ
// kind：light（明るい）・dark（暗い）・hc（明るい側の形で、線が濃い）。部品の CSS は明暗を <html> の data-kind で分ける

export type ThemeKind = 'light' | 'dark' | 'hc';

export interface ThemeInfo {
  id: string;
  ja: string; // 画面に出す名前
  kind: ThemeKind;
}

// 並びは小窓の並び（上の段に明るい 8、下の段に中間と暗い 5）
export const THEMES: readonly ThemeInfo[] = [
  { id: 'mitsurou', ja: '蜜蝋', kind: 'light' },
  { id: 'hakuji', ja: '白磁', kind: 'light' },
  { id: 'kinari', ja: '生成り', kind: 'light' },
  { id: 'koshi', ja: '古紙', kind: 'light' },
  { id: 'wakaba', ja: '若葉', kind: 'light' },
  { id: 'akatsuki', ja: '暁', kind: 'light' },
  { id: 'kirara', ja: '雲母', kind: 'light' },
  { id: 'sumishiro', ja: '墨と白', kind: 'hc' },
  { id: 'hakubo', ja: '薄暮', kind: 'dark' },
  { id: 'sumi', ja: '炭', kind: 'dark' },
  { id: 'yorunosu', ja: '夜の巣', kind: 'dark' },
  { id: 'aozu', ja: '青図', kind: 'dark' },
  { id: 'kokuban', ja: '黒板', kind: 'dark' },
];

export function findTheme(id: unknown): ThemeInfo | undefined {
  return THEMES.find((t) => t.id === id);
}
