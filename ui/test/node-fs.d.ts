// テストだけで使う node:fs の型（@types/node は入れていない。vitest は CSS を ?raw でも空にするので、CSS はこれで読む）
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
  export function readdirSync(path: URL, options: { recursive: true; encoding: 'utf8' }): string[];
}
