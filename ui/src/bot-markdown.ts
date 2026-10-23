// ボットの返事の Markdown を読みやすく出す、自前の小さな表示（第3段 S3.9。plan-s3-nest.md の S3.9）
//   ・返事は外から来た文：innerHTML・insertAdjacentHTML・DOMParser は使わない。要素は createElement で作り、文字は必ず textContent か text ノードで入れる
//     （HTML として解釈しない。外のライブラリも使わない）
//   ・対応する書き方：見出し（# 〜 ###。もっと深いものは ### 扱い）・段落と改行・**太字**・*斜体*・`コード`・``` のコードブロック（言語名は表示だけ。色付けなし）・
//     箇条書き（- * + と 1. の番号付き。入れ子は2段まで）・引用（>。2段まで）・横線（---）・表（| の表。列は 12 まで。崩れていたら普通の段落に戻す）・
//     リンク [文字](URL) と生の URL（https://…）
//   ・リンクは http: と https: だけ。それ以外（javascript: など）は文字のまま出す。押したときは呼んだ側（ボットの欄）が、ドメインを見せてから開く
//   ・画像 ![説明](URL) は読み込まない（「画像：説明」の文字だけ）
//   ・重くしない：入力は 2 万字まで。行は上から1回だけ見る（表の区切りの行を1行だけ先読み）。行の中の飾りも1回の走査で、
//     閉じの記号は「先へ進むだけ」の探し方にしているので、記号がいくつあっても字数に比例する。飾りの入れ子は 8 段・箇条書きと引用は 2 段まで
import { el } from './util';

export const BOT_MD_MAX_CHARS = 20_000; // 返事の文の上限（受け取るときと同じ）
export const BOT_MD_MAX_COLUMNS = 12; // 表の列の上限（超えたら普通の段落）
const MAX_QUOTE = 2; // 引用の入れ子
const MAX_EMPHASIS = 8; // 太字・斜体の入れ子（開いたまま待っている記号の数）
const MAX_LANG = 24; // コードブロックの言語名の字数

export interface BotMarkdownOptions {
  // リンクを押した（URL は http: か https: だと確かめたもの）。ドメインを見せてから開くのは呼んだ側
  openLink(url: string, from: HTMLElement): void;
  // リンクの data-key の頭（書き換えのあとも、キーボードの位置を同じリンクに残すため）
  keyPrefix?: string;
}

export interface BotMarkdownResult {
  element: HTMLElement;
  // 段落と改行のほかに整えたもの（見出し・太字・表・リンクなど）があった。false なら元の文と見た目はほぼ同じ
  formatted: boolean;
}

// 返事の文を Markdown として、要素の木にする（文字は全部 textContent。HTML にはしない）
export function renderBotMarkdown(text: string, options: BotMarkdownOptions): BotMarkdownResult {
  return new Renderer(options).run(text);
}

// http: と https: の URL だけを通す（それ以外・読めないものは null）
export function safeHttpUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(s); // 相対の URL は読めない（null）
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '？';
  }
}

// ---------- 行（ブロック） ----------

interface ListLevel {
  list: HTMLOListElement | HTMLUListElement;
  ordered: boolean;
  indent: number;
  li: HTMLLIElement;
}

interface OpenFence {
  ch: string;
  len: number;
  indent: number;
  depth: number; // 引用の深さ（中の行は、この数の > を外して読む）
  code: HTMLElement;
  lines: string[];
}

// まだ飾りを付けていない文（段落か、箇条書きの1項目）。閉じるときに1回だけ行の中を読む
interface TextBuffer {
  target: HTMLElement;
  lines: string[];
}

type Align = '' | 'left' | 'center' | 'right';

class Renderer {
  formatted = false;
  private readonly root = el('div', 'bot-md');
  private quotes: HTMLElement[] = []; // 開いている引用（長さ＝今の深さ）
  private buffer: TextBuffer | null = null;
  private lists: ListLevel[] = []; // 開いている箇条書き（2段まで）
  private listGap = false; // 箇条書きのあとに空行があった
  private fence: OpenFence | null = null;
  private linkNo = 0;

  constructor(private readonly options: BotMarkdownOptions) {}

  run(text: string): BotMarkdownResult {
    const src = text.length > BOT_MD_MAX_CHARS ? text.slice(0, BOT_MD_MAX_CHARS) : text;
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) i = this.line(lines, i);
    this.closeFence();
    this.closeBlocks();
    return { element: this.root, formatted: this.formatted };
  }

  private container(): HTMLElement {
    return this.quotes[this.quotes.length - 1] ?? this.root;
  }

  // 1行を読む。返すのは、読み終えた最後の行の番号（表は何行かまとめて読む）
  private line(lines: string[], i: number): number {
    const raw = lines[i];
    if (this.fence) {
      const f = this.fence;
      const q = stripQuotes(raw, f.depth);
      if (q.depth === f.depth) {
        if (isFenceClose(q.rest, f)) this.closeFence();
        else f.lines.push(dropIndent(q.rest, f.indent));
        return i;
      }
      this.closeFence(); // 引用が終わった：コードブロックもそこで終わり
    }
    const q = stripQuotes(raw, MAX_QUOTE); // 3段目からの > は文字のまま
    this.setDepth(q.depth);
    const rest = q.rest;
    if (!rest.trim()) {
      this.blank();
      return i;
    }
    const fence = fenceOpen(rest);
    if (fence && (fence.indent <= 3 || this.lists.length)) {
      if (this.lists.length && fence.indent >= 2) {
        // 項目の下に字下げして書いたコードブロック：その項目の中に置き、箇条書きは続ける
        this.flushBuffer();
        this.listGap = false;
        this.openFence(fence, q.depth, this.lists[this.lists.length - 1].li);
      } else {
        this.closeBlocks();
        this.openFence(fence, q.depth, this.container());
      }
      return i;
    }
    const heading = headingOf(rest);
    if (heading) {
      this.closeBlocks();
      const h = el((['h4', 'h5', 'h6'] as const)[heading.level - 1], `bot-md-h bot-md-h${heading.level}`);
      this.inline(heading.text, h);
      this.container().append(h);
      this.formatted = true;
      return i;
    }
    if (HR.test(rest)) {
      this.closeBlocks();
      this.container().append(el('hr', 'bot-md-hr'));
      this.formatted = true;
      return i;
    }
    const item = LIST_ITEM.exec(rest);
    if (item) {
      this.listItem(item, rest);
      return i;
    }
    // 表：この行に | があり、次の行（同じ引用の深さ）が区切りの行
    if (rest.includes('|') && i + 1 < lines.length) {
      const next = stripQuotes(lines[i + 1], MAX_QUOTE);
      if (next.depth === q.depth) {
        const end = this.table(lines, i, rest, next.rest, q.depth);
        if (end >= 0) return end;
      }
    }
    if (this.lists.length) {
      const deepest = this.lists[this.lists.length - 1];
      if (!this.listGap) {
        // 項目の続きの行（改行として足す）
        if (this.buffer) this.buffer.lines.push(rest.trim());
        else this.buffer = { target: appendTo(deepest.li, el('p', 'bot-md-p')), lines: [rest.trim()] };
        return i;
      }
      if (indentOf(rest) >= 2) {
        // 空行のあとの字下げした文：項目の中の新しい段落
        this.flushBuffer();
        this.listGap = false;
        this.buffer = { target: appendTo(deepest.li, el('p', 'bot-md-p')), lines: [rest.trim()] };
        return i;
      }
      this.closeBlocks();
    }
    if (!this.buffer) this.buffer = { target: appendTo(this.container(), el('p', 'bot-md-p')), lines: [] };
    this.buffer.lines.push(rest.trim());
    return i;
  }

  private setDepth(depth: number) {
    if (depth === this.quotes.length) return;
    this.closeBlocks();
    if (depth < this.quotes.length) {
      this.quotes.length = depth;
      return;
    }
    while (this.quotes.length < depth) {
      const quote = el('blockquote', 'bot-md-quote');
      this.container().append(quote);
      this.quotes.push(quote);
    }
    this.formatted = true;
  }

  private blank() {
    if (this.lists.length) {
      // 箇条書きは空行1つでは終わらない（次の行が項目か字下げなら続く）
      this.flushBuffer();
      this.listGap = true;
      return;
    }
    this.closeBlocks();
  }

  // 段落・箇条書きを閉じる（コードブロックと引用は別）
  private closeBlocks() {
    this.flushBuffer();
    this.lists = [];
    this.listGap = false;
  }

  private flushBuffer() {
    const b = this.buffer;
    if (!b) return;
    this.buffer = null;
    this.inline(b.lines.join('\n'), b.target);
  }

  private openFence(f: { ch: string; len: number; indent: number; lang: string }, depth: number, parent: HTMLElement) {
    const block = el('div', 'bot-md-codeblock');
    if (f.lang) {
      const lang = el('div', 'bot-md-lang', f.lang);
      lang.title = '書いてあった言語名（色付けはしません）';
      block.append(lang);
    }
    const pre = el('pre', 'bot-md-pre');
    pre.tabIndex = 0; // 横にはみ出したとき、キーボードでも動かせる
    const code = el('code');
    pre.append(code);
    block.append(pre);
    parent.append(block);
    this.fence = { ch: f.ch, len: f.len, indent: f.indent, depth, code, lines: [] };
    this.formatted = true;
  }

  private closeFence() {
    const f = this.fence;
    if (!f) return;
    this.fence = null;
    f.code.textContent = f.lines.join('\n'); // 閉じの ``` が無ければ、終わりまでをコードにする
  }

  private listItem(m: RegExpExecArray, rest: string) {
    const indent = indentOf(m[1]);
    const marker = m[2];
    const ordered = marker[0] >= '0' && marker[0] <= '9';
    let level = 0;
    if (this.lists.length) level = indent >= this.lists[0].indent + 2 ? 1 : 0; // もっと深い字下げも2段目
    else this.closeBlocks(); // 段落のすぐ下の項目：段落を閉じる
    this.flushBuffer();
    this.listGap = false;
    if (this.lists.length > level + 1) this.lists.length = level + 1;
    let cur: ListLevel | undefined = this.lists[level];
    if (cur && cur.ordered !== ordered) {
      this.lists.length = level; // 印の種類が変わった：新しい箇条書き
      cur = undefined;
    }
    const li = el('li');
    if (cur) {
      cur.list.append(li);
      cur.li = li;
    } else {
      const list = ordered ? el('ol', 'bot-md-list') : el('ul', 'bot-md-list');
      if (list instanceof HTMLOListElement) {
        const start = Number.parseInt(marker, 10);
        if (Number.isFinite(start) && start !== 1) list.start = start;
      }
      (level === 0 ? this.container() : this.lists[0].li).append(list);
      list.append(li);
      this.lists[level] = { list, ordered, indent, li };
      this.formatted = true;
    }
    this.buffer = { target: li, lines: [rest.slice(m[0].length).trim()] };
  }

  // 表（読めたら、読み終えた最後の行の番号。表でなければ -1）
  private table(lines: string[], i: number, headLine: string, delimLine: string, depth: number): number {
    const aligns = delimiterRow(delimLine);
    if (!aligns) return -1;
    const head = splitRow(headLine);
    if (head.length !== aligns.length || head.length > BOT_MD_MAX_COLUMNS) return -1; // 崩れている：普通の段落に
    this.closeBlocks();
    const wrap = el('div', 'bot-md-table');
    wrap.tabIndex = 0; // 横にはみ出したとき、キーボードでも動かせる
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', '表');
    const table = el('table');
    const thead = el('thead');
    thead.append(this.row(head, aligns, 'th'));
    const tbody = el('tbody');
    let j = i + 2;
    for (; j < lines.length; j++) {
      const q = stripQuotes(lines[j], MAX_QUOTE);
      if (q.depth !== depth || !q.rest.trim() || !q.rest.includes('|')) break;
      tbody.append(this.row(splitRow(q.rest), aligns, 'td'));
    }
    table.append(thead);
    if (tbody.childElementCount) table.append(tbody);
    wrap.append(table);
    this.container().append(wrap);
    this.formatted = true;
    return j - 1;
  }

  private row(cells: string[], aligns: Align[], tag: 'th' | 'td'): HTMLTableRowElement {
    const cols = aligns.length;
    // 列が多い行は、あふれた分を最後の列にまとめる（文を落とさない）。少ない行は空の列で埋める
    const fitted = cells.length > cols ? [...cells.slice(0, cols - 1), cells.slice(cols - 1).join(' | ')] : cells;
    const tr = el('tr');
    for (let c = 0; c < cols; c++) {
      const cell = el(tag);
      if (aligns[c]) cell.style.textAlign = aligns[c];
      this.inline(fitted[c] ?? '', cell);
      tr.append(cell);
    }
    return tr;
  }

  // ---------- 行の中（太字・斜体・コード・リンク） ----------

  // s を読んで target に足す。links が false のときはリンクを作らない（リンクの文字の中）
  private inline(s: string, target: HTMLElement, links = true) {
    const toks: Token[] = [];
    const openers: Record<DelimKey, number[]> = { '*1': [], '*2': [], '_1': [], '_2': [] };
    const ticks = new TickSeek(s);
    const closeBracket = new Seek(s, (c) => c === ']');
    const openBracket = new Seek(s, (c) => c === '[');
    const urlStop = new Seek(s, (c) => c === ')' || isSpace(c));
    let text = '';
    const pushText = () => {
      if (text) toks.push({ k: 'text', s: text });
      text = '';
    };
    const n = s.length;
    let i = 0;
    while (i < n) {
      const c = s[i];
      if (c === '\\' && i + 1 < n && ASCII_PUNCT.includes(s[i + 1])) {
        text += s[i + 1]; // \* などは記号そのもの
        i += 2;
        continue;
      }
      if (c === '`') {
        let len = 1;
        while (s[i + len] === '`') len++;
        const end = ticks.next(len, i + len);
        if (end < 0) {
          text += s.slice(i, i + len);
        } else {
          pushText();
          toks.push({ k: 'code', s: codeText(s.slice(i + len, end)) });
          len = end + len - i;
        }
        i += len;
        continue;
      }
      if (links && (c === '[' || (c === '!' && s[i + 1] === '['))) {
        const image = c === '!';
        const found = linkAt(s, image ? i + 1 : i, closeBracket, openBracket, urlStop);
        if (found) {
          if (image) {
            pushText();
            toks.push({ k: 'image', alt: found.label });
          } else if (found.url) {
            pushText();
            toks.push({ k: 'link', label: found.label, url: found.url });
          } else {
            text += s.slice(i, found.end); // http(s) でないリンク：文字のまま
          }
          i = found.end;
          continue;
        }
        text += c;
        i++;
        continue;
      }
      if (links && c === '<' && isUrlStart(s, i + 1)) {
        // <https://…>
        const end = urlEnd(s, i + 1, false);
        const url = s[end] === '>' ? safeHttpUrl(s.slice(i + 1, end)) : null;
        if (url) {
          pushText();
          toks.push({ k: 'link', label: s.slice(i + 1, end), url, plain: true });
          i = end + 1;
          continue;
        }
      }
      if (links && (c === 'h' || c === 'H') && isUrlStart(s, i) && !isWordAscii(s[i - 1])) {
        const end = urlEnd(s, i, true);
        const raw = s.slice(i, end);
        const url = raw.length > 8 ? safeHttpUrl(raw) : null;
        if (url) {
          pushText();
          toks.push({ k: 'link', label: raw, url, plain: true });
        } else {
          text += raw;
        }
        i = end;
        continue;
      }
      if (c === '*' || c === '_') {
        let len = 1;
        while (s[i + len] === c) len++;
        if (len > 3) {
          text += s.slice(i, i + len);
          i += len;
          continue;
        }
        const prev = i > 0 ? s[i - 1] : ' ';
        const next = i + len < n ? s[i + len] : ' ';
        let canOpen = !isSpace(next);
        let canClose = !isSpace(prev);
        if (c === '_') {
          // snake_case などの単語の中の _ は飾りにしない
          canOpen &&= !isWord(prev);
          canClose &&= !isWord(next);
        }
        pushText();
        const waiting = openers[`${c}1`].length + openers[`${c}2`].length > 0;
        const parts: (1 | 2)[] = len === 1 ? [1] : len === 2 ? [2] : canClose && waiting ? [1, 2] : [2, 1];
        for (const part of parts) delimiter(toks, openers, c, part, canOpen, canClose);
        i += len;
        continue;
      }
      text += c;
      i++;
    }
    pushText();
    this.build(toks, target);
  }

  private build(toks: Token[], target: HTMLElement) {
    const stack: HTMLElement[] = [target];
    let pending = ''; // 続けて並んだ文字は、まとめて1つの text ノードに
    const flush = () => {
      if (pending) appendText(stack[stack.length - 1], pending);
      pending = '';
    };
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.k === 'text') {
        pending += t.s;
        continue;
      }
      if (t.k === 'delim' && t.pair < 0) {
        pending += t.ch.repeat(t.n); // 相手のいない記号は文字のまま
        continue;
      }
      flush();
      const top = stack[stack.length - 1];
      if (t.k === 'code') {
        top.append(el('code', 'bot-md-code', t.s));
        this.formatted = true;
      } else if (t.k === 'link') {
        top.append(this.link(t.label, t.url, t.plain === true));
      } else if (t.k === 'image') {
        const img = el('span', 'bot-md-img', `画像：${t.alt.trim() || '（説明なし）'}`);
        img.title = 'ボットの返事の画像は読み込みません';
        top.append(img);
        this.formatted = true;
      } else if (t.pair > k) {
        const e = el(t.n === 2 ? 'strong' : 'em');
        top.append(e);
        stack.push(e);
        this.formatted = true;
      } else {
        stack.pop();
      }
    }
    flush();
  }

  // リンク：押すと、呼んだ側がドメインを見せてから開く（ここでは開かない。href も持たない）
  //   plain：生の URL（文字に飾りを付けない）
  private link(label: string, url: string, plain: boolean): HTMLElement {
    const a = el('span', 'bot-md-link');
    a.setAttribute('role', 'link');
    a.tabIndex = 0;
    if (this.options.keyPrefix) a.dataset.key = `${this.options.keyPrefix}-link-${this.linkNo}`;
    this.linkNo++;
    if (!label.trim()) a.textContent = url;
    else if (plain) a.textContent = label;
    else this.inline(label, a, false);
    a.title = `${url}\n押すと、ドメイン（${hostOf(url)}）を見せてから開きます`;
    const open = (e: Event) => {
      e.preventDefault();
      this.options.openLink(url, a);
    };
    a.addEventListener('click', open);
    a.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') open(e);
    });
    this.formatted = true;
    return a;
  }
}

// ---------- 行の形 ----------

const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+/;

// 先頭の > を max 個まで外す（> の前は空白 3 つまで、後ろの空白は1つ外す）
function stripQuotes(line: string, max: number): { depth: number; rest: string } {
  let depth = 0;
  let k = 0;
  while (depth < max) {
    let j = k;
    while (j < line.length && j - k < 3 && line[j] === ' ') j++;
    if (line[j] !== '>') break;
    j++;
    if (line[j] === ' ' || line[j] === '\t') j++;
    k = j;
    depth++;
  }
  return { depth, rest: depth ? line.slice(k) : line };
}

function indentOf(s: string): number {
  let w = 0;
  for (const c of s) {
    if (c === ' ') w++;
    else if (c === '\t') w += 4;
    else break;
  }
  return w;
}

function dropIndent(s: string, n: number): string {
  let k = 0;
  while (k < n && s[k] === ' ') k++;
  return s.slice(k);
}

function headingOf(s: string): { level: 1 | 2 | 3; text: string } | null {
  const m = /^ {0,3}(#{1,6})(?=[ \t]|$)/.exec(s);
  if (!m) return null; // 「#0003」のような、# のすぐ後ろに字があるものは見出しにしない
  let text = s.slice(m[0].length).trim();
  let k = text.length;
  while (k > 0 && text[k - 1] === '#') k--;
  if (k < text.length && (k === 0 || text[k - 1] === ' ' || text[k - 1] === '\t')) text = text.slice(0, k).trim(); // 閉じの ###
  return { level: Math.min(3, m[1].length) as 1 | 2 | 3, text };
}

function fenceOpen(s: string): { ch: string; len: number; indent: number; lang: string } | null {
  const m = /^([ \t]*)(`{3,}|~{3,})/.exec(s);
  if (!m) return null; // 字下げが 4 つ以上のものは、箇条書きの中だけ（呼ぶ側で見る）
  const info = s.slice(m[0].length);
  if (m[2][0] === '`' && info.includes('`')) return null;
  const lang = (info.trim().split(/\s+/, 1)[0] ?? '').replace(/[^\p{L}\p{N}+#._-]/gu, '').slice(0, MAX_LANG);
  return { ch: m[2][0], len: m[2].length, indent: indentOf(m[1]), lang };
}

function isFenceClose(s: string, f: OpenFence): boolean {
  const m = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(s); // 項目の中のコードブロックは、閉じも字下げしてある
  return !!m && m[1][0] === f.ch && m[1].length >= f.len;
}

// 表の区切りの行（|---|:---:|---:|）。区切りでなければ null
function delimiterRow(line: string): Align[] | null {
  if (!line.includes('|')) return null;
  const aligns: Align[] = [];
  for (const cell of splitRow(line)) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : '');
  }
  return aligns;
}

// 表の1行を列に分ける（\| は列の区切りにしない）
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && s[k + 1] === '|') {
      cur += '|';
      k++;
    } else if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function appendTo<T extends HTMLElement>(parent: HTMLElement, child: T): T {
  parent.append(child);
  return child;
}

// ---------- 行の中の形 ----------

type DelimKey = '*1' | '*2' | '_1' | '_2';

type Token =
  | { k: 'text'; s: string }
  | { k: 'code'; s: string }
  | { k: 'link'; label: string; url: string; plain?: boolean }
  | { k: 'image'; alt: string }
  | { k: 'delim'; ch: '*' | '_'; n: 1 | 2; pair: number };

const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

// 太字・斜体の記号：開いて待っている同じ記号があれば閉じる。間に開いたまま残っている別の記号は、もう閉じられないので文字に戻す
//   （どの記号も1回だけ積んで1回だけ外すので、全体で字数に比例する。入れ子が正しくなる）
function delimiter(toks: Token[], openers: Record<DelimKey, number[]>, ch: '*' | '_', n: 1 | 2, canOpen: boolean, canClose: boolean) {
  const key: DelimKey = `${ch}${n}`;
  const idx = toks.length;
  const tok: Token = { k: 'delim', ch, n, pair: -1 };
  toks.push(tok);
  const waiting = openers[key];
  if (canClose && waiting.length) {
    const o = waiting.pop() as number;
    tok.pair = o;
    (toks[o] as Extract<Token, { k: 'delim' }>).pair = idx;
    for (const list of Object.values(openers)) while (list.length && list[list.length - 1] > o) list.pop();
    return;
  }
  const open = Object.values(openers).reduce((sum, list) => sum + list.length, 0);
  if (canOpen && open < MAX_EMPHASIS) waiting.push(idx);
}

// ある字を「先へ進むだけ」で探す（呼ぶたびに from が増えていく使い方なら、全体で1回の走査）
class Seek {
  private found = -1;
  private done = false;
  constructor(
    private readonly s: string,
    private readonly hit: (c: string) => boolean,
  ) {}

  next(from: number): number {
    if (this.found >= from) return this.found;
    if (this.done) return -1;
    for (let k = Math.max(from, this.found + 1); k < this.s.length; k++) {
      if (this.hit(this.s[k])) return (this.found = k);
    }
    this.done = true;
    return -1;
  }
}

// 同じ長さの ` の並び（コードの閉じ）を探す。並びの場所は最初に1回だけ集める
class TickSeek {
  private runs: Map<number, number[]> | null = null;
  private readonly cursor = new Map<number, number>();
  constructor(private readonly s: string) {}

  next(len: number, from: number): number {
    if (!this.runs) {
      this.runs = new Map();
      for (let k = 0; k < this.s.length; ) {
        if (this.s[k] !== '`') {
          k++;
          continue;
        }
        let l = 1;
        while (this.s[k + l] === '`') l++;
        const list = this.runs.get(l) ?? [];
        list.push(k);
        this.runs.set(l, list);
        k += l;
      }
    }
    const list = this.runs.get(len);
    if (!list) return -1;
    let c = this.cursor.get(len) ?? 0;
    while (c < list.length && list[c] < from) c++;
    this.cursor.set(len, c);
    return c < list.length ? list[c] : -1;
  }
}

function codeText(s: string): string {
  const t = s.replace(/\n/g, ' ');
  return t.length >= 2 && t.startsWith(' ') && t.endsWith(' ') && t.trim() ? t.slice(1, -1) : t;
}

// [文字](URL) を読む（at は [ の場所）。形でなければ null。URL が http(s) でなければ url は null（文字のまま出す）
function linkAt(s: string, at: number, closeBracket: Seek, openBracket: Seek, urlStop: Seek): { label: string; url: string | null; end: number } | null {
  const close = closeBracket.next(at + 1);
  if (close < 0 || s[close + 1] !== '(') return null;
  const inner = openBracket.next(at + 1);
  if (inner >= 0 && inner < close) return null; // [ の入れ子は見ない（内側の [ から読み直す）
  const start = close + 2;
  let end = urlStop.next(start);
  if (end < 0 || s[end] !== ')') return null;
  if (s[end + 1] === ')' && s.slice(start, end).includes('(')) end++; // …/Foo_(bar) のような括弧の入った URL
  let raw = s.slice(start, end);
  if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1);
  return { label: s.slice(at + 1, close), url: safeHttpUrl(raw), end: end + 1 };
}

function isUrlStart(s: string, i: number): boolean {
  const head = s.slice(i, i + 8).toLowerCase();
  return head.startsWith('http://') || head.startsWith('https://');
}

// URL に使える字（ASCII の見える字。< > " ` { } | \ ^ [ ] は除く）
function isUrlChar(code: number): boolean {
  if (code < 0x21 || code > 0x7e) return false;
  return !'<>"`{}|\\^[]'.includes(String.fromCharCode(code));
}

// 生の URL の終わり（trim なら、終わりの句読点と、開きの無い閉じ括弧を外す）
function urlEnd(s: string, i: number, trim: boolean): number {
  let e = i;
  let opens = 0;
  let closes = 0;
  while (e < s.length && isUrlChar(s.charCodeAt(e))) {
    if (s[e] === '(') opens++;
    else if (s[e] === ')') closes++;
    e++;
  }
  if (!trim) return e;
  while (e > i) {
    const c = s[e - 1];
    if (`.,;:!?'*_`.includes(c)) {
      e--;
    } else if (c === ')' && closes > opens) {
      closes--;
      e--;
    } else {
      break;
    }
  }
  return e;
}

function isSpace(c: string): boolean {
  return /\s/.test(c);
}

function isWord(c: string): boolean {
  return /[\p{L}\p{N}]/u.test(c);
}

function isWordAscii(c: string | undefined): boolean {
  return !!c && /[A-Za-z0-9]/.test(c);
}

// 文字を足す（改行は <br>）。文字は text ノードだけ
function appendText(parent: HTMLElement, s: string) {
  const parts = s.split('\n');
  parts.forEach((part, k) => {
    if (k > 0) parent.append(el('br'));
    if (part) parent.append(document.createTextNode(part));
  });
}

// ---------- 回答カード（第3段 S3.10。plan-s3-nest.md の S3.10）：返事の文を「要約・注意・出典・そのほか」に分ける ----------
//   ・文だけを見る（DOM は使わない）。右の回答カード（写しの 4,000 字）と、左の「タブに残す」（記録から読み直した全文）で同じ分け方を使う
//   ・見出し（# 〜 ######）の名前が「要約」「注意」（注意点）「出典」のものを探す（後ろの「：」・太字の **・「（3つまで）」のような添え書きは見ない。
//     コードの囲み ``` の中は見ない）。節は次の見出し（段は問わない）まで。同じ名前の節が2つ以上あれば、つなげる
//   ・いちばん最後の「## Vision」の節（visions.ts の extractVision と同じ見分け：同じか上の段の見出しか、中身のあとの --- まで）は本文から外す（Vision は札で出す）
//   ・要約・注意・出典の見出しがどれも無ければ found は false（呼ぶ側は、全体〔Vision の節を外したもの〕を本文として今までどおり出す）
//   ・軽い返事（依頼の小窓 v2・R9・D19）：見出し「一行の答え」「次の一手」「どのくらい確か」の節も同じ探し方で拾い、本文から外す
//     （oneLine・next・confidence。1段落にまとめた文。返事の決まりと、用意した役の文の終わりで、はじめに書いてもらうよう頼んでいる）。
//     found には数えない（要約・注意・出典が無ければ、出典のチップは今までどおり出さない）。light：3つのどれかがあった

export interface BotAnswerSource {
  url: string | null; // http: と https: だけ。リンクの無い出典（「〇〇の投稿」など）は null（文字だけ出す）
  label: string;
}

export interface BotAnswerParts {
  found: boolean; // 要約・注意・出典 の見出しが1つでもあった
  summary: string; // 要約（1段落にまとめた文。太字・リンクなどの書き方はそのまま）
  summaryText: string; // 要約の節の全体（Markdown の文のまま。「続きとして」の要点の行を作る。依頼の小窓 v2・R5）
  caution: string; // 注意（Markdown の文のまま）
  sources: BotAnswerSource[]; // 「## 出典」の中のリンクと、リンクの無い行（ANSWER_SOURCES_MAX まで）
  body: string; // 要約・注意・出典・Vision・軽い返事の 3 つの節を外した残り（Markdown の文のまま）
  vision: boolean; // Vision の節を外した
  // 軽い返事（R9）：一行の答え・次の一手・どのくらい確か（それぞれ 1 段落にまとめた文。太字・リンクなどの書き方はそのまま。無ければ空）
  oneLine: string;
  next: string;
  confidence: string;
  light: boolean; // 3 つのどれかの見出しがあった
}

export const ANSWER_SOURCES_MAX = 12; // 出典のチップの数
const ANSWER_SOURCE_LABEL = 40; // リンクの無い出典の字数
const ANSWER_FENCE_RE = /^\s{0,3}(```|~~~)/; // visions.ts と同じ
const ANSWER_HEADING_RE = /^\s{0,3}(#{1,6})\s(.*)$/;
const ANSWER_VISION_RE = /^\s{0,3}(#{1,6})\s*(?:grok\s*)?visions?\b/i; // visions.ts の VISION_HEAD_RE と同じものに当たる
const ANSWER_NAME_RE = /^(?:\*\*|__)?\s*(要約|注意点?|出典|一行の答え|次の一手|どのくらい確かか?)\s*(?:[（(][^）)\n]{0,20}[）)])?\s*(?:\*\*|__)?\s*[:：]?\s*$/;
const ANSWER_RULE_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const LIST_MARK_RE = /^\s*(?:[-*+・•]|\d{1,9}[.)])\s+/;

type AnswerKind = 'summary' | 'caution' | 'sources' | 'vision' | 'oneLine' | 'next' | 'confidence';
type PickedKind = Exclude<AnswerKind, 'vision'>;

function answerKind(text: string): AnswerKind | null {
  const name = ANSWER_NAME_RE.exec(text.replace(/[ \t]+#+[ \t]*$/, '').trim())?.[1];
  if (!name) return null;
  if (name === '要約') return 'summary';
  if (name === '出典') return 'sources';
  if (name === '一行の答え') return 'oneLine';
  if (name === '次の一手') return 'next';
  if (name.startsWith('どのくらい確か')) return 'confidence';
  return 'caution';
}

// 返事の文を分ける（上の説明のとおり。行は上から2回だけ見る）
export function botAnswerParts(text: string): BotAnswerParts {
  const lines = String(text ?? '').slice(0, BOT_MD_MAX_CHARS).replace(/\r\n?/g, '\n').split('\n');
  const heads: { i: number; level: number; kind: AnswerKind | null }[] = [];
  let fence = false;
  lines.forEach((line, i) => {
    if (ANSWER_FENCE_RE.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const v = ANSWER_VISION_RE.exec(line);
    if (v) {
      heads.push({ i, level: v[1].length, kind: 'vision' });
      return;
    }
    const h = ANSWER_HEADING_RE.exec(line);
    if (h) heads.push({ i, level: h[1].length, kind: answerKind(h[2]) });
  });
  // Vision はいちばん最後の1つだけ（前のものは、ふつうの見出し）
  const lastVision = heads.map((h) => h.kind).lastIndexOf('vision');
  heads.forEach((h, k) => {
    if (h.kind === 'vision' && k !== lastVision) h.kind = null;
  });
  const removed = new Array<boolean>(lines.length).fill(false);
  const picked: Record<PickedKind, string[]> = { summary: [], caution: [], sources: [], oneLine: [], next: [], confidence: [] };
  heads.forEach((h, k) => {
    if (!h.kind) return;
    let end = lines.length;
    if (h.kind === 'vision') {
      const next = heads.slice(k + 1).find((n) => n.level <= h.level);
      end = next ? next.i : lines.length;
      // 中身のあとの区切りの線 --- まで（コードの囲みの中は見ない）
      let inFence = false;
      let content = false;
      for (let j = h.i + 1; j < end; j++) {
        if (ANSWER_FENCE_RE.test(lines[j])) inFence = !inFence;
        else if (!inFence && ANSWER_RULE_RE.test(lines[j]) && content) {
          end = j;
          break;
        }
        if (lines[j].trim()) content = true;
      }
    } else {
      end = heads[k + 1]?.i ?? lines.length;
      picked[h.kind].push(trimBlock(lines.slice(h.i + 1, end)));
    }
    for (let j = h.i; j < end; j++) removed[j] = true;
  });
  const found = heads.some((h) => h.kind === 'summary' || h.kind === 'caution' || h.kind === 'sources');
  // 要約の節：最初の段落だけを太字の1段落に。続き（箇条書きなど）は本文の頭に回す
  const summary = splitFirstParagraph(picked.summary.filter(Boolean).join('\n\n'));
  const rest = trimBlock(lines.filter((_, j) => !removed[j]));
  // 軽い返事の 3 つ（R9）：節の全体を 1 段落に（コードの囲みは落とす。箇条書きの印は外してつなぐ）
  const light = (kind: 'oneLine' | 'next' | 'confidence') => oneParagraph(picked[kind].filter(Boolean).join('\n'));
  return {
    found,
    summary: oneParagraph(summary.first),
    summaryText: picked.summary.filter(Boolean).join('\n\n'),
    caution: picked.caution.filter(Boolean).join('\n\n'),
    sources: sourcesOf(picked.sources.join('\n')),
    body: [summary.rest, rest].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n'),
    vision: lastVision >= 0,
    oneLine: light('oneLine'),
    next: light('next'),
    confidence: light('confidence'),
    light: heads.some((h) => h.kind === 'oneLine' || h.kind === 'next' || h.kind === 'confidence'),
  };
}

// 最初の段落（空の行か、ふつうの行から箇条書きに変わる所まで。箇条書きで始まるなら、続く項目まで）と、その残り
function splitFirstParagraph(s: string): { first: string; rest: string } {
  const lines = s.split('\n');
  let a = 0;
  while (a < lines.length && !lines[a].trim()) a++;
  if (a < lines.length && ANSWER_FENCE_RE.test(lines[a])) return { first: '', rest: s.trim() }; // コードで始まる要約は、そのまま本文に
  const list = LIST_MARK_RE.test(lines[a] ?? '');
  let b = a;
  while (b < lines.length && lines[b].trim() && !ANSWER_FENCE_RE.test(lines[b]) && (list || b === a || !LIST_MARK_RE.test(lines[b]))) b++;
  return { first: lines.slice(a, b).join('\n'), rest: trimBlock(lines.slice(b)) };
}

// 前後の空の行と、終わりの区切りの線 --- を落とす
function trimBlock(lines: readonly string[]): string {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && (!lines[b - 1].trim() || ANSWER_RULE_RE.test(lines[b - 1]))) b--;
  return lines.slice(a, b).join('\n');
}

// 要約を1段落に（引用の >・箇条書きの印・「要約：」の札を外し、行をつなぐ。日本語どうしは空白なしでつなぐ）
function oneParagraph(s: string): string {
  const cjk = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;
  let out = '';
  for (const raw of s.split('\n')) {
    const line = raw.replace(/^\s{0,3}(?:>\s?)+/, '').replace(LIST_MARK_RE, '').trim();
    if (!line || ANSWER_RULE_RE.test(line) || ANSWER_FENCE_RE.test(line)) continue;
    out = !out ? line : cjk.test(out.slice(-1)) && cjk.test(line[0]) ? out + line : `${out} ${line}`;
  }
  return out.replace(/^(?:\*\*|__)?要約(?:\*\*|__)?\s*[:：]\s*/, '');
}

// 飾りの記号を外した、ふつうの1行（[文字](URL) は文字だけ・**・__・`・見出しの # を外す）
export function plainLine(s: string): string {
  return s
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cutLabel(s: string, max: number): string {
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : s;
}

// 「## 出典」の中身から：[文字](URL)・生の URL はリンクに（http(s) だけ）、リンクの無い行は文字だけの出典に
function sourcesOf(s: string): BotAnswerSource[] {
  const out: BotAnswerSource[] = [];
  const seen = new Set<string>();
  const push = (url: string | null, label: string) => {
    const key = url ?? `t:${label}`;
    if (out.length >= ANSWER_SOURCES_MAX || !label || seen.has(key)) return;
    seen.add(key);
    out.push({ url, label });
  };
  const re = /!?\[([^\]\n]{0,200})\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"\n]*")?\s*\)|https?:\/\/[^\s<>"'`）」』\]]+/g;
  let fence = false;
  for (const raw of s.split('\n')) {
    if (ANSWER_FENCE_RE.test(raw)) fence = !fence;
    const line = raw.replace(/^\s{0,3}(?:>\s?)+/, '').replace(LIST_MARK_RE, '').trim();
    if (fence || !line || ANSWER_RULE_RE.test(line) || ANSWER_FENCE_RE.test(line)) continue;
    const matches = [...line.matchAll(re)];
    if (!matches.length) {
      push(null, cutLabel(plainLine(line), ANSWER_SOURCE_LABEL));
      continue;
    }
    const rest = plainLine(line.replace(re, ' ').replace(/[\s:：\-–—|｜]+$/, '').replace(/^[\s:：\-–—|｜]+/, ''));
    for (const m of matches) {
      const isLink = m[0].startsWith('[') || m[0].startsWith('![');
      const url = safeHttpUrl(isLink ? (m[2] ?? '') : m[0].replace(/[.,;:!?。、）)]+$/, ''));
      const label = cutLabel(plainLine(isLink ? (m[1] ?? '') : '') || (matches.length === 1 ? rest : '') || (url ? hostOf(url) : ''), ANSWER_SOURCE_LABEL);
      if (url && !m[0].startsWith('![')) push(url, label);
      else if (label) push(null, label); // http(s) でないリンク・画像：文字だけ（開かない）
    }
  }
  return out;
}

// 「続けて聞く」の頭に入れる、要約の1行（要約が無ければ一行の答え〔R9〕、それも無ければ本文の最初の行。飾りの記号は外す）
export function botAnswerLine(text: string, max = 80): string {
  const p = botAnswerParts(text);
  for (const source of [p.summary, p.oneLine, p.body]) {
    for (const raw of source.split('\n')) {
      if (ANSWER_FENCE_RE.test(raw) || ANSWER_RULE_RE.test(raw) || /^\s*\|/.test(raw)) continue;
      const line = plainLine(raw.replace(/^\s{0,3}(?:>\s?)+/, '').replace(LIST_MARK_RE, ''));
      if (line) return cutLabel(line, max);
    }
  }
  return '';
}

// 受け取り箱の「まず 1 枚」の表の「返事の一言」（R9）：一行の答えがあればそれ、無ければ botAnswerLine と同じ（要約の1行・本文の最初の行）
export function botAnswerOneLine(text: string, max = 80): string {
  const one = plainLine(botAnswerParts(text).oneLine);
  return one ? cutLabel(one, max) : botAnswerLine(text, max);
}

// 「続きとして」の要点の行（依頼の小窓 v2・R5・D11）：要約の節を、箇条書きなら項目ごと・段落なら段落ごとに 1 行にする。
//   要約の節が無ければ、本文の頭の 3 つ（段落・項目）。見出し・コード・表・区切りの線は飛ばし、飾りの記号は外す（plainLine）。
//   1 行は max 字まで、全部で count 行まで。小窓は印を付けた行だけを「添えた情報」の枠の「前の返事 #0010（データ）：」に入れる
export function botAnswerPoints(text: string, max = 200, count = 8): string[] {
  const p = botAnswerParts(text);
  const blocks: string[][] = [];
  let block: string[] | null = null;
  let fence = false;
  for (const raw of (p.summaryText || p.body).split('\n')) {
    if (ANSWER_FENCE_RE.test(raw)) {
      fence = !fence;
      block = null;
      continue;
    }
    const line = raw.replace(/^\s{0,3}(?:>\s?)+/, '');
    if (fence || !line.trim() || ANSWER_RULE_RE.test(line) || ANSWER_HEADING_RE.test(line) || /^\s*\|/.test(line)) {
      block = null;
      continue;
    }
    if (!block || LIST_MARK_RE.test(line)) {
      block = [];
      blocks.push(block);
    }
    block.push(line);
  }
  const lines = blocks.map((b) => cutLabel(plainLine(oneParagraph(b.join('\n'))), max - 1)).filter(Boolean); // 切ったら「…」を足して max 字
  return lines.slice(0, p.summaryText ? count : Math.min(3, count));
}

// 「タブに残す」の文（タブのメモ・右のメモ）：見出しの行・要約（無ければ本文の頭）・出典（links があれば links、無ければ「## 出典」）
export function botAnswerNoteText(text: string, info: { botName: string; no?: string; links?: readonly { url: string; title?: string }[] }, max = 2000): string {
  const p = botAnswerParts(text);
  const lines = [`Grok の回答${info.no ? ` ${info.no}` : ''}（${info.botName}）`];
  const summary = p.summary ? plainLine(p.summary) : '';
  const one = p.oneLine ? plainLine(p.oneLine) : '';
  if (summary) lines.push(`要約：${summary}`);
  else if (one) lines.push(`答え：${cutLabel(one, 300)}`); // 軽い返事の一行の答え（R9。本文から外したので、ここで拾う）
  else {
    const head = plainLine(p.body.split('\n').filter((l) => !ANSWER_FENCE_RE.test(l) && !ANSWER_RULE_RE.test(l)).join(' '));
    if (head) lines.push(`回答：${cutLabel(head, 300)}`);
  }
  if (p.caution) lines.push(`⚠ 注意：${cutLabel(plainLine(p.caution.split('\n').map((l) => l.replace(LIST_MARK_RE, '')).join(' ')), 300)}`);
  const links = (info.links ?? []).flatMap((l) => {
    const url = safeHttpUrl(l.url);
    return url ? [{ url, label: l.title ? cleanLabel(l.title) : '' }] : [];
  });
  const sources = links.length ? links : p.sources;
  if (sources.length) {
    lines.push('出典：');
    for (const s of sources) lines.push(`・${[s.label, s.url].filter(Boolean).join(' ')}`);
  }
  return cutLabel(lines.join('\n'), max);
}

function cleanLabel(s: string): string {
  return cutLabel(plainLine(s), ANSWER_SOURCE_LABEL);
}
