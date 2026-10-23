// 長い文章をマスに分けて、帯のように並べるための計算（六角メモの ribbon.js と同じ決まり）
//   分け方：空行で段落に、段落は文の区切り（。！？ や英文のピリオド）でマスの大きさ（目安 70 字）にまとめる。
//     1文が長すぎるときだけ、読点などで分ける。見出し（Markdown の # や、句点で終わらない短い行）は1マスにする。
//     箇条書きは項目の区切りを保ったまま、いくつかずつ1マスにまとめる。
//   並べ方：左から右へ perLine マスずつ。行の端では間をあけて次の行へ。段落は行の頭から始める。
//     見出しは1行を使い、前を少し多めにあける。

export interface Chunk {
  text: string;
  head: boolean; // 見出し
  para: boolean; // 段落（箇条書き・見出し）の最初のマス
}

export const CHUNK = 70; // 1マスの目安（スクロールせずに読める量）
const LIST_RE = /^(?:[-*・•●○◦▪]\s*|[0-9０-９]{1,3}[.．)）]\s+|[①-⑳])/;
const ENDERS = '。！？!?．';
const CLOSERS = '」』）)"\'”’】';

const len = (s: string) => [...s].length;

// 見出しらしい行：Markdown の #、または句点などで終わらない短い行
export function isHeading(line: string) {
  const t = line.trim();
  if (/^#{1,6}\s+\S/.test(t)) return true;
  if (!t || LIST_RE.test(t) || len(t) > 30) return false;
  if (/[。、，,．.！？!?」』）)：:；;]$/.test(t)) return false;
  return /^(?:第[0-9０-９一二三四五六七八九十百]+[章節部編話]|[0-9０-９]+(?:[.．][0-9０-９]+)*[.．、\s]|[■□◆◇●○▼▶【])/.test(t) || len(t) <= 20;
}

const headingText = (line: string) => line.trim().replace(/^#{1,6}\s+/, '').trim();

// 文に分ける（区切りの記号と、後ろの閉じかっこは前の文に付ける）
export function sentences(s: string): string[] {
  const out: string[] = [];
  const chars = [...s];
  let cur = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    cur += ch;
    const end = ENDERS.includes(ch) || (ch === '.' && (i + 1 >= chars.length || /\s/.test(chars[i + 1])));
    if (end) {
      while (i + 1 < chars.length && (ENDERS.includes(chars[i + 1]) || CLOSERS.includes(chars[i + 1]))) cur += chars[++i];
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// 目安より長い1文は、後ろ寄りの読点・空白で分ける（無ければ目安の長さで）
function breakLong(s: string, size: number): string[] {
  const chars = [...s];
  if (chars.length <= size) return [s];
  const out: string[] = [];
  let start = 0;
  while (chars.length - start > size) {
    let cut = -1;
    for (let i = start + size; i > start + Math.floor(size / 2); i--) {
      if ('、，,；;：: '.includes(chars[i - 1])) {
        cut = i;
        break;
      }
    }
    if (cut < 0) cut = start + size;
    out.push(chars.slice(start, cut).join('').trim());
    start = cut;
  }
  out.push(chars.slice(start).join('').trim());
  return out.filter(Boolean);
}

const joiner = (a: string, b: string) => (/[A-Za-z0-9.,;:!?)]$/.test(a) && /^[A-Za-z0-9(]/.test(b) ? ' ' : '');

// 単位（文・箇条書きの項目）を、目安の長さまで1マスにまとめる
function pack(units: string[], sep: string, size: number): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const unit of units) {
    for (const piece of breakLong(unit, size)) {
      const glue = cur ? sep || joiner(cur, piece) : '';
      if (cur && len(cur) + len(glue) + len(piece) > size) {
        chunks.push(cur);
        cur = piece;
      } else {
        cur += glue + piece;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// 文章 → マス
export function splitText(raw: string, size = CHUNK): Chunk[] {
  const text = String(raw || '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/ /g, ' ');
  const out: Chunk[] = [];
  const blocks = text.split(/\n[ \t　]*\n/);
  blocks.forEach((block, bi) => {
    // 1つの段落の中の改行：前の行が長く（20字以上）文の終わりでなければ、途中の折り返しとしてつなぐ
    const paras: string[] = [];
    let lastLine = '';
    for (const line of block.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const prev = paras[paras.length - 1];
      const cont =
        prev !== undefined &&
        len(lastLine) >= 20 &&
        !/[。！？!?．.」』）)】]$/.test(lastLine) &&
        !LIST_RE.test(t) &&
        !LIST_RE.test(lastLine) &&
        !/^#{1,6}\s/.test(t);
      if (cont) paras[paras.length - 1] = prev + joiner(prev, t) + t;
      else paras.push(t);
      lastLine = t;
    }
    const isLast = bi === blocks.length - 1;
    let list: string[] = [];
    const flushList = () => {
      if (!list.length) return;
      pack(list, '\n', size).forEach((t, i) => out.push({ text: t, head: false, para: i === 0 }));
      list = [];
    };
    paras.forEach((p, pi) => {
      const lastPara = isLast && pi === paras.length - 1;
      if (LIST_RE.test(p)) {
        list.push(p);
        return;
      }
      flushList();
      // 見出しは、後ろに本文が続くときだけ（最後の短い行はふつうの文として扱う）
      if (isHeading(p) && !lastPara) {
        out.push({ text: headingText(p), head: true, para: true });
        return;
      }
      pack(sentences(p), '', size).forEach((t, i) => out.push({ text: t, head: false, para: i === 0 }));
    });
    flushList();
  });
  return out;
}

// 並べる位置：{ dr: 最初の行からの行の差, c: 行の中での列 }
//   lineStep：行から行へ（3 = 間に2行あける。六角メモと同じ）、headStep：見出しの前
export function layout(chunks: Chunk[], perLine: number, lineStep = 3, headStep = 4): { dr: number; c: number }[] {
  const pos: { dr: number; c: number }[] = [];
  let dr = 0;
  let c = 0;
  let placed = false;
  const newLine = (step: number) => {
    if (!placed) return;
    dr += c === 0 ? step - lineStep : step; // もう行の頭にいるときは、足りない分だけあける
    c = 0;
  };
  for (const ch of chunks) {
    if (ch.head) {
      newLine(headStep);
      pos.push({ dr, c: 0 });
      placed = true;
      c = 1;
      newLine(lineStep); // 見出しは1行を使う
      continue;
    }
    if ((ch.para && c > 0) || c >= perLine) newLine(lineStep);
    pos.push({ dr, c });
    placed = true;
    c++;
  }
  return pos;
}

// 位置 → 軸座標。行の頭がそろうよう、行ごとに q をずらす
export const toAxial = ({ dr, c }: { dr: number; c: number }) => ({ q: -Math.floor(dr / 2) + c, r: dr });
