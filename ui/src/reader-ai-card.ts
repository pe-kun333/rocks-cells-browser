// AI のカードの本文の形（plan-reader-video の V0c。段 V0c）：見出しと「▶ 時刻〔技法〕文」の行を組む・読み戻す
//   ・組む（aiCardText）：見出しは空白をまとめ、空なら「AI のカード」。文が空の行は書かない。秒が数で 0 以上なら時刻の行、ほかは文だけ
//   ・読み戻す（parseAiCardText）：改行を \n にそろえ、空の行を捨てる。1 行目が時刻の形でなければ見出し。時刻の形の行は timed、ほかは plain
//   ・時刻の札（secLabel）は reader/youtube.ts の timeLabel と同じ結果。youtube.ts は bridge を読むので import せず、中身を写す
//   ・純粋な関数だけ（DOM・window・Date.now・Math.random を使わない）。外へ送らない

// 組むときの 1 行（AI の構造化出力から作る）
export interface AiCardLine {
  sec: number; // 秒
  tech?: string; // 技法の札（例「ボケ」。無くてよい）
  text: string; // 文
}

// 読み戻した 1 行
export type AiCardRow =
  | { kind: 'timed'; sec: number; label: string; tech?: string; text: string } // label は secLabel(sec)
  | { kind: 'plain'; text: string }; // 形の読めない行は、そのまま字で出す

// 読み戻した本文（見出しが無いときは head が ''）
export interface AiCardBody {
  head: string;
  rows: AiCardRow[];
}

export const AI_TECH_MAX = 12; // 技法の札の字数（コードポイント）
export const AI_CARD_UNTITLED = 'AI のカード'; // 見出しが空のとき

// 時刻の行の形：「▶ 時刻」のあとに、任意で〔技法〕と文。時刻は h:mm:ss か m:ss。時刻の直後が数字かコロンなら時刻として読まない
const AI_LINE_RE = /^▶\s*(?:(\d{1,2}):(\d{2}):(\d{2})|(\d{1,3}):(\d{2}))(?![\d:])(?:\s*〔([^〕\n]{1,12})〕)?\s*(.*)$/u;

// 秒を札の時刻にする：1 時間未満は m:ss、1 時間からは h:mm:ss（分と秒は 2 桁）。数でない・無限は 0:00
export function secLabel(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const s = Math.max(0, Math.floor(sec)); // 負は 0、小数は切り捨て
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

// 空白（改行も）を一つの空白にまとめ、前後を取る
function squash(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

// 技法の札：〔〕を取り、空白をまとめ、AI_TECH_MAX 字（コードポイント）まで。空なら ''（技法なし）
function techOf(raw: string | undefined): string {
  const t = squash((raw ?? '').replace(/[〔〕]/g, ''));
  return [...t].slice(0, AI_TECH_MAX).join('').trim(); // 切ったあとの末尾の空白も取る
}

// 本文を組む：見出し（空なら AI_CARD_UNTITLED）と行を \n でつなぐ。字数では切らない
export function aiCardText(head: string, lines: readonly AiCardLine[]): string {
  const out = [squash(head) || AI_CARD_UNTITLED];
  for (const line of lines) {
    const text = squash(line.text);
    if (!text) continue; // 文が空の行は書かない
    if (!Number.isFinite(line.sec) || line.sec < 0) {
      out.push(text); // 秒が数でない・無限・負は、文だけ
      continue;
    }
    const time = `▶ ${secLabel(line.sec)}`;
    const tech = techOf(line.tech);
    out.push(tech ? `${time}〔${tech}〕${text}` : `${time} ${text}`);
  }
  return out.join('\n');
}

// 1 行を読む：時刻の形（分と秒は 0〜59）なら timed、ほかは plain（文は前後を取ったもの）
function readRow(line: string): AiCardRow {
  const m = AI_LINE_RE.exec(line);
  if (!m) return { kind: 'plain', text: line };
  let sec: number;
  if (m[1] !== undefined) {
    // h:mm:ss：分と秒は 0〜59
    if (Number(m[2]) > 59 || Number(m[3]) > 59) return { kind: 'plain', text: line };
    sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  } else {
    // m:ss：秒は 0〜59
    if (Number(m[5]) > 59) return { kind: 'plain', text: line };
    sec = Number(m[4]) * 60 + Number(m[5]);
  }
  const label = secLabel(sec);
  const tech = (m[6] ?? '').trim(); // 括弧が無い・空なら技法なし
  const text = (m[7] ?? '').trim();
  return tech ? { kind: 'timed', sec, label, tech, text } : { kind: 'timed', sec, label, text };
}

// 本文を読み戻す：改行を \n にそろえ、空の行を捨てる。1 行目が時刻の形でなければ見出し（時刻の形なら head は ''）
export function parseAiCardText(text: string): AiCardBody {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 0) return { head: '', rows: [] };
  const [first, ...rest] = lines;
  const firstRow = readRow(first);
  if (firstRow.kind === 'plain') return { head: first, rows: rest.map((l) => readRow(l)) };
  return { head: '', rows: [firstRow, ...rest.map((l) => readRow(l))] };
}

// ---------- 2,000 字を超えるカードを分ける（plan-reader-video の V4b・D5） ----------

export const AI_CARD_MAX = 2000; // カードの本文の上限（threads.ts の MAX_REPLY_TEXT と同じ値）

// 分けた 1 枚（見出しと行）
export interface AiCardPart {
  head: string;
  lines: AiCardLine[];
}

const lengthOf = (head: string, lines: readonly AiCardLine[]) => [...aiCardText(head, lines)].length;

// 行を、本文が max 字に収まるように前から詰めて分ける。2 枚目からは見出しに「・続き n」
function chunk(head: string, lines: readonly AiCardLine[], max: number): AiCardPart[] {
  const parts: AiCardPart[] = [];
  let now: AiCardLine[] = [];
  const headOf = (n: number) => (n === 0 ? head : `${head}・続き ${n + 1}`);
  for (const line of lines) {
    if (now.length > 0 && lengthOf(headOf(parts.length), [...now, line]) > max) {
      parts.push({ head: headOf(parts.length), lines: now });
      now = [];
    }
    now.push(line);
  }
  if (now.length > 0 || parts.length === 0) parts.push({ head: headOf(parts.length), lines: now });
  return parts;
}

// AI のカードを分ける：本文が max 字に収まれば 1 枚。超えるなら、chapterOf（行の秒 → チャプターの名前。無ければ null）で
//   続いた同じチャプターの行を 1 枚に（見出しに「（チャプターの名前）」）。それでも超える 1 枚は、行の途中で分ける
//   行は秒の順に並んでいるものとする。入力は変えない
export function splitAiCard(head: string, lines: readonly AiCardLine[], chapterOf: (sec: number) => string | null, max = AI_CARD_MAX): AiCardPart[] {
  if (lengthOf(head, lines) <= max) return [{ head, lines: [...lines] }];
  const groups: { name: string | null; lines: AiCardLine[] }[] = [];
  for (const line of lines) {
    const name = chapterOf(line.sec);
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.lines.push(line);
    else groups.push({ name, lines: [line] });
  }
  if (groups.length <= 1) return chunk(head, lines, max);
  return groups.flatMap((g) => chunk(g.name ? `${head}（${g.name}）` : head, g.lines, max));
}
