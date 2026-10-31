// 英語の辞書に無い文を数える（node 22.6 以降。型は取り除いて動く）
//   node scripts/i18n-check.ts            まとめだけ
//   node scripts/i18n-check.ts --list     未訳の文を並べる
//   node scripts/i18n-check.ts --json     まとめを JSON で（台本 rebuild-public.ps1 から読む用）
//   node scripts/i18n-check.ts --strict   未訳が 1 件でもあれば終わりのコード 1
// 訳さないファイル（公開版で既定オフの Grok 用の画面など）は src/locales/i18n-ignore.json に書く
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDictionary, htmlTexts } from '../src/i18n-scan.ts';

const ui = fileURLToPath(new URL('..', import.meta.url));
const src = join(ui, 'src');
const dict = JSON.parse(readFileSync(join(src, 'locales', 'en.json'), 'utf8')) as Record<string, string>;
const ignore = (JSON.parse(readFileSync(join(src, 'locales', 'i18n-ignore.json'), 'utf8')) as { patterns: string[] }).patterns.map((p) => new RegExp(p));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const all = walk(src).map((p) => ({ path: relative(src, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }));
const sources = all.filter((s) => !ignore.some((r) => r.test(s.path)) && s.path !== 'i18n-scan.ts');
const html = htmlTexts(readFileSync(join(ui, 'index.html'), 'utf8')).filter((s) => s !== '日本語'); // 言語の選びの「日本語」は訳さない
const r = checkDictionary(sources, html, dict);
const htmlMissing = html.filter((s) => !Object.prototype.hasOwnProperty.call(dict, s));
const args = new Set(process.argv.slice(2));

if (args.has('--json')) {
  console.log(JSON.stringify({ keys: r.keys, translated: r.translated, missing: r.missing.length, htmlMissing: htmlMissing.length, unwrapped: r.unwrapped, files: sources.length, ignoredFiles: all.length - sources.length }));
} else {
  console.log(`t() の文 ${r.keys} 件（訳あり ${r.translated}・未訳 ${r.missing.length}）／index.html の文 ${html.length} 件（未訳 ${htmlMissing.length}）`);
  console.log(`まだ t() で包んでいない日本語の文字列：${r.unwrapped} 件（${sources.length} ファイル。訳さないファイル ${all.length - sources.length} 件は数えない）`);
  if (r.unused.length) console.log(`辞書にあるが使っていない文：${r.unused.length} 件`);
  if (args.has('--list')) for (const k of [...r.missing, ...htmlMissing]) console.log(`  未訳: ${k}`);
}
if (args.has('--strict') && r.missing.length + htmlMissing.length > 0) process.exit(1);
