// ページの本文を、見出し・段落・箇条書きの形を保って取り出す（六角セルに組み直すため）
//   ・記事らしい所（article → main → body）から、メニュー・ヘッダー・広告などを除いて集める
//   ・見出しは「# 見出し」、箇条書きは「- 項目」、段落の間は空行（六角メモの「分けて貼り付け」と同じ形の文章にする）
//   ・ページの中で動かすのは、この決まったスクリプトだけ（C++ の evalInTab 経由）
import { request } from '../bridge';

export interface ExtractedPage {
  title: string;
  url: string;
  lang: string;
  text: string;
  truncated: boolean;
}

const MAX_CHARS = 60_000;

const EXTRACT_SCRIPT = `(() => {
  const MAX = ${MAX_CHARS};
  const root = document.querySelector('article') || document.querySelector('main, [role="main"]') || document.body;
  const SKIP = 'nav, header, footer, aside, script, style, noscript, template, form, button, svg, canvas, iframe, [aria-hidden="true"], [hidden], [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';
  const BLOCK = 'h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, figcaption, dt, dd, th, td';
  const items = [];
  let size = 0;
  for (const el of root.querySelectorAll(BLOCK)) {
    const skip = el.closest(SKIP);
    if (skip && root.contains(skip)) continue;
    if (el.querySelector(BLOCK)) continue; // 中の段落のほうで集める
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const tag = el.tagName;
    const raw = tag === 'PRE' ? el.innerText : el.innerText.replace(/\\s+/g, ' ');
    const text = raw.trim();
    if (!text) continue;
    const kind = /^H[1-6]$/.test(tag) ? 'h' : tag === 'LI' || tag === 'DD' || tag === 'DT' ? 'li' : 'p';
    items.push({ kind, text });
    size += text.length;
    if (size > MAX) break;
  }
  let text = '';
  let prev = '';
  for (const { kind, text: t } of items) {
    if (kind === 'h') text += '\\n\\n# ' + t.replace(/\\n/g, ' ') + '\\n\\n';
    else if (kind === 'li') text += (prev === 'li' ? '\\n' : '\\n\\n') + '- ' + t;
    else text += '\\n\\n' + t;
    prev = kind;
  }
  // 段落の形が取れないページ（div だけで組まれたもの）は、見えている文章をそのまま使う
  const all = (root.innerText || '').trim();
  if (text.trim().length < Math.min(all.length * 0.4, 2000)) text = all;
  return {
    title: document.title || '',
    url: location.href,
    lang: document.documentElement.lang || '',
    text: text.trim().slice(0, MAX),
    truncated: text.trim().length > MAX,
  };
})()`;

// 表示中のタブ（または tabId）の本文を取り出す。ページを読み込み中なら、少し待ってやり直す
export async function extractPage(tabId: number, timeoutMs = 20_000): Promise<ExtractedPage | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const reply = await request((requestId) => ({ type: 'evalInTab', requestId, id: tabId, script: EXTRACT_SCRIPT }), 15_000);
    if (reply?.type === 'evalResult' && reply.ok && reply.value && typeof reply.value === 'object') {
      const v = reply.value as Partial<ExtractedPage>;
      if (typeof v.text === 'string' && v.text.trim()) {
        return { title: v.title ?? '', url: v.url ?? '', lang: v.lang ?? '', text: v.text, truncated: v.truncated === true };
      }
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}
