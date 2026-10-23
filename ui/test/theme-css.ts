// テストの道具：CSS を規則と宣言に分けて読む（テーマの塊の語と、決め打ちの色を数えるため）
// 入れ子の規則と、文字列の中の { } は扱わない（このリポジトリの CSS には無い）
import { readdirSync, readFileSync } from 'node:fs';

const SRC = new URL('../src/', import.meta.url);

// ui/src からの道（例 'style.css'・'app/memo-pane.ts'）
export function srcFiles(ext: string): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => p.endsWith(ext))
    .sort();
}

export function readSrc(name: string): string {
  return readFileSync(new URL(name, SRC), 'utf8');
}

export interface CssDecl {
  prop: string;
  value: string;
  offset: number; // 宣言の始まり（ファイルの中の位置）
}

export interface CssRule {
  selector: string;
  at: string[]; // 外側の @media などの前置き（外から順に）
  decls: CssDecl[];
}

// コメントを、同じ長さの空白にする（位置と改行を保つ）
export function blankComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
}

export function parseCss(text: string): CssRule[] {
  const src = blankComments(text);
  const rules: CssRule[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      stack.push(src.slice(start, i).trim());
      start = i + 1;
    } else if (ch === '}') {
      const prelude = stack.pop() ?? '';
      if (!prelude.startsWith('@')) {
        rules.push({ selector: prelude.replace(/\s+/g, ' '), at: stack.filter((p) => p.startsWith('@')), decls: parseDecls(src, start, i) });
      }
      start = i + 1;
    } else if (ch === ';' && (stack.length === 0 || stack[stack.length - 1].startsWith('@'))) {
      start = i + 1; // 規則の外の一行（@import など）
    }
  }
  return rules;
}

function parseDecls(src: string, from: number, to: number): CssDecl[] {
  const decls: CssDecl[] = [];
  let at = from;
  for (const part of src.slice(from, to).split(';')) {
    const colon = part.indexOf(':');
    if (colon > 0) {
      const lead = part.length - part.trimStart().length;
      decls.push({ prop: part.slice(0, colon).trim(), value: part.slice(colon + 1).trim(), offset: at + lead });
    }
    at += part.length + 1;
  }
  return decls;
}

// 選択子の並び（コンマ区切り）に selector がちょうど入っている規則の、語（--で始まる宣言）を集める。後に書いたものが勝つ
export function tokensOf(rules: CssRule[], selector: string, at: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.at.join('|') !== at.join('|')) continue;
    if (!rule.selector.split(',').some((s) => s.trim() === selector)) continue;
    for (const d of rule.decls) if (d.prop.startsWith('--')) out[d.prop.slice(2)] = d.value;
  }
  return out;
}

// var(--x) を、同じ組の中の値で置き換える（代わりの値 var(--x, y) は、x が無いときだけ y）
export function resolveTokens(tokens: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const resolve = (value: string, depth: number): string =>
    depth > 10
      ? value
      : value.replace(/var\(--([\w-]+)(?:,\s*([^)]+))?\)/g, (_, name: string, fallback?: string) =>
          name in tokens ? resolve(tokens[name], depth + 1) : (fallback ?? `var(--${name})`),
        );
  for (const [k, v] of Object.entries(tokens)) out[k] = resolve(v, 0);
  return out;
}
