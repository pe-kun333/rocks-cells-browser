// セルの範囲コピー・貼り付けと、保存した「セット」（六角メモの「定型」と同じ考え：決まった並びのタブを一手で開く）
//   ・コピーは、Windows のクリップボードに六角メモと同じ形（HTML に埋め込んだマスの写し＋並び）で書く。
//     なので、六角メモに貼るとリンク付きのマスが同じ並びで並び、六角メモでコピーしたマスもここに貼れる
//   ・ほかのアプリでコピーした URL の一覧も貼れる（1行に1つ）。URL の無い文章・六角メモの URL の無いマスは、メモのセルになる
//   ・セットの保存先：ui-data\cellsets.json
import { request } from './bridge';
import { readData, writeData } from './data';
import type { Hex } from './hex';
import { isSpecialCell, type MemoCell } from './memocells';
import { cleanComment, isTabLook, type Tab, type TabLook } from './tabs';
import { normalizeTags } from './tags';
import { parseAuthor, parseReplies, type Reply, type ReplyAuthor } from './threads';

// セルの中身（タブを開くのに要るもの。メモのセルなら memo）と、並び（基準のセルからの差）
export interface CellItem {
  dq: number;
  dr: number;
  url: string; // メモのセルは ''
  title: string;
  favicon?: string;
  tags?: string[];
  liked?: number;
  // メモのセル（image は六角形スクショの ID、replies はコメントのスレッド、by・label は AI の相棒が残したものの印。どれもこのブラウザの中だけ）
  memo?: { text: string; image?: string; replies?: Reply[]; by?: ReplyAuthor; label?: string };
  face?: CellFace; // タブの見た目（画像・コメント・見え方。このブラウザの中だけ）
}

export interface CellFace {
  image?: string;
  comment?: string;
  look?: TabLook;
}

// タブの見た目（何も付けていなければ undefined）
export function faceOfTab(t: Pick<Tab, 'image' | 'comment' | 'look'>): CellFace | undefined {
  if (!t.image && !t.comment && !t.look) return undefined;
  return { ...(t.image ? { image: t.image } : {}), ...(t.comment ? { comment: t.comment } : {}), ...(t.look ? { look: t.look } : {}) };
}

// 保存・コピーしてあった見た目を確かめながら読む
export function parseFace(raw: unknown): CellFace | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const f = raw as Record<string, unknown>;
  return faceOfTab({
    image: typeof f.image === 'string' && /^shot[0-9a-z]+$/.test(f.image) ? f.image : undefined,
    comment: cleanComment(f.comment) || undefined,
    look: isTabLook(f.look) ? f.look : undefined,
  });
}

export interface CellSet {
  id: string;
  name: string;
  createdAt: number;
  uses: number;
  lastUsedAt?: number;
  island?: { name: string; color: string }; // 島ごと保存したとき
  cells: CellItem[];
}

const FILE = 'cellsets.json';
const MAX_SETS = 100;
export const MAX_CELLS = 60; // 1回に貼る・保存するセルの数
const ATTR = 'data-hex-memo';

// ---------- 並び ----------

// 上の行から、行の中は左から（六角メモの「位置の順」と同じ）
export function byPosition(a: Hex, b: Hex) {
  return a.r - b.r || a.q + a.r / 2 - (b.q + b.r / 2);
}

// 並びの無いもの（URL の一覧など）を、まとまった形に並べる（1行に6つまで。行の頭をそろえる）
export function compactOffsets(count: number): Hex[] {
  const width = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(count * 1.5))));
  return Array.from({ length: count }, (_, i) => {
    const r = Math.floor(i / width);
    return { q: (i % width) - Math.floor(r / 2), r };
  });
}

// タブとメモのセルから、コピー・保存するセルの中身を作る（いちばん左上のセルが基準）
//   シートへの入口は入れない（行き先のシートはこのブラウザの中のもの。コピーしても意味が無い）
//   ボットのセルも入れない（ボットは写さない。盤面の中で「もう1つ置く」だけ）。六角メモへ送るものも、この中身から作る
//   撮ったもののセルも入れない（見返す場所。画像は撮影の台帳にある）
export function cellsOfTabs(tabs: Tab[], memos: MemoCell[] = []): CellItem[] {
  type Source = { pos: Hex; item: Omit<CellItem, 'dq' | 'dr'> };
  const sources: Source[] = [
    ...tabs
      .filter((t) => /^https?:\/\//i.test(t.url))
      .map((t) => ({
        pos: t.pos,
        item: { url: t.url, title: t.title, favicon: t.favicon || undefined, tags: t.tags.length > 0 ? [...t.tags] : undefined, liked: t.liked || undefined, face: faceOfTab(t) },
      })),
    ...memos.filter((m) => !isSpecialCell(m)).map((m) => ({
      pos: m.pos,
      item: {
        url: '',
        title: '',
        tags: m.tags.length > 0 ? [...m.tags] : undefined,
        liked: m.liked || undefined,
        memo: { text: m.text, image: m.image, ...(m.replies?.length ? { replies: m.replies } : {}), ...(m.by ? { by: m.by, ...(m.label ? { label: m.label } : {}) } : {}) },
      },
    })),
  ];
  const list = sources.sort((a, b) => byPosition(a.pos, b.pos)).slice(0, MAX_CELLS);
  const base = list[0]?.pos;
  if (!base) return [];
  return list.map((s) => ({ dq: s.pos.q - base.q, dr: s.pos.r - base.r, ...s.item }));
}

// ---------- クリップボード（六角メモと同じ形） ----------

function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(b64: string) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

// 六角メモのマスの形（クリップボード・受け取り口の両方で使う）
export function hexMemoRecords(cells: CellItem[]) {
  const now = new Date().toISOString();
  return cells.map((c) => ({
    text: c.memo ? c.memo.text : c.title || c.url,
    createdAt: now,
    updatedAt: now,
    likedLevel: c.liked ?? 0,
    liked: (c.liked ?? 0) > 0,
    bookmarked: false,
    comments: [],
    ...(c.tags?.length ? { tags: c.tags } : {}),
    ...(c.memo ? {} : { urls: [{ url: c.url, title: c.title || undefined }] }),
  }));
}

// クリップボードに書く。nonce はこのブラウザでコピーしたものを見分ける印
export async function writeCellsToClipboard(cells: CellItem[], nonce: string): Promise<boolean> {
  const records = hexMemoRecords(cells);
  const text = cells.map((c) => (c.memo ? c.memo.text : c.title ? `${c.title}\n${c.url}` : c.url)).join('\n\n');
  // コメントのスレッドとタブの見た目は、このブラウザの中だけで使う（六角メモは読まない）
  const replies = cells.map((c) => c.memo?.replies ?? []);
  // AI の相棒が残したもの（考察・レター）の印も、このブラウザの中だけで使う
  const authors = cells.map((c) => (c.memo?.by ? { by: { who: c.memo.by.who, name: c.memo.by.name }, ...(c.memo.label ? { label: c.memo.label } : {}) } : null));
  const faces = cells.map((c) => c.face ?? null);
  const payload = {
    v: 1,
    nonce,
    cut: false,
    from: 'rocks-cells-browser',
    record: records[0],
    records,
    offsets: cells.map((c) => ({ dq: c.dq, dr: c.dr })),
    text,
    ...(replies.some((r) => r.length > 0) ? { hcReplies: replies } : {}),
    ...(authors.some(Boolean) ? { hcAuthors: authors } : {}),
    ...(faces.some((f) => f) ? { hcFaces: faces } : {}),
  };
  const html = `<div ${ATTR}="${toBase64(JSON.stringify(payload))}">${escapeHtml(text).replace(/\r?\n/g, '<br>')}</div>`;
  const reply = await request((requestId) => ({ type: 'clipboardWrite', requestId, text, html }), 5_000);
  return reply?.type === 'clipboardWritten' && reply.ok;
}

export type ClipContent =
  // セル（このブラウザでコピーしたもの＝ours、または六角メモのマス。URL の無いマスはメモのセルになる。空のマスは貼らない＝skipped）
  | { kind: 'cells'; cells: CellItem[]; shaped: boolean; skipped: number; ours: boolean; nonce: string }
  | { kind: 'urls'; cells: CellItem[]; text: string } // ほかのアプリでコピーした URL の一覧（text は元の文章）
  | { kind: 'text'; text: string } // URL の無い文章（メモのセルにする）
  | { kind: 'none' };

export async function readClipboard(): Promise<ClipContent> {
  const reply = await request((requestId) => ({ type: 'clipboardRead', requestId }), 5_000);
  if (reply?.type !== 'clipboard') return { kind: 'none' };
  return parseClipboard(reply.text, reply.html);
}

const URL_RE = /https?:\/\/[^\s<>"'）」』】]+/gi;

export function parseClipboard(text: string, html: string): ClipContent {
  const m = new RegExp(`${ATTR}="([A-Za-z0-9+/=]+)"`).exec(html || '');
  if (m) {
    try {
      const payload = JSON.parse(fromBase64(m[1])) as Record<string, unknown>;
      const records = Array.isArray(payload.records) ? payload.records : payload.record ? [payload.record] : [];
      const offsets = Array.isArray(payload.offsets) && payload.offsets.length >= records.length ? (payload.offsets as unknown[]) : null;
      const threads = payload.from === 'rocks-cells-browser' && Array.isArray(payload.hcReplies) ? (payload.hcReplies as unknown[]) : [];
      const authors = payload.from === 'rocks-cells-browser' && Array.isArray(payload.hcAuthors) ? (payload.hcAuthors as unknown[]) : [];
      const faces = payload.from === 'rocks-cells-browser' && Array.isArray(payload.hcFaces) ? (payload.hcFaces as unknown[]) : [];
      const cells: CellItem[] = [];
      let skipped = 0;
      let shaped = !!offsets;
      records.slice(0, MAX_CELLS).forEach((raw, i) => {
        const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
        const text = typeof r.text === 'string' ? r.text : '';
        const link = Array.isArray(r.urls) ? (r.urls as { url?: unknown; title?: unknown }[]).find((u) => typeof u?.url === 'string' && /^https?:\/\//i.test(u.url)) : undefined;
        // このブラウザでコピーしたメモのセルは urls を持たない（文章に URL があっても、タブにしない）
        const ours = payload.from === 'rocks-cells-browser';
        const url = typeof link?.url === 'string' ? link.url : ours && !Array.isArray(r.urls) ? '' : (text.match(URL_RE)?.[0] ?? '');
        const o = offsets?.[i] as { dq?: unknown; dr?: unknown } | undefined;
        if (!url) {
          // URL の無いマスは、メモのセルとして貼る（空のマスは飛ばす）
          if (!text.trim()) {
            skipped++;
            return;
          }
          if (!o || !Number.isInteger(o.dq) || !Number.isInteger(o.dr)) shaped = false;
          const level = Number(r.likedLevel);
          const replies = parseReplies(threads[i]);
          const mark = (typeof authors[i] === 'object' && authors[i] !== null ? authors[i] : {}) as { by?: unknown; label?: unknown };
          const by = parseAuthor(mark.by);
          const label = by && typeof mark.label === 'string' ? [...mark.label.trim()].slice(0, 10).join('') : '';
          cells.push({
            dq: Number(o?.dq) || 0,
            dr: Number(o?.dr) || 0,
            url: '',
            title: '',
            tags: normalizeTags(r.tags),
            liked: Number.isInteger(level) && level > 0 ? Math.min(3, level) : undefined,
            memo: { text: text.slice(0, 5000), ...(replies.length > 0 ? { replies } : {}), ...(by ? { by: { who: by.who, name: by.name }, ...(label ? { label } : {}) } : {}) },
          });
          return;
        }
        if (!o || !Number.isInteger(o.dq) || !Number.isInteger(o.dr)) shaped = false;
        // 見出し：リンクの題名、無ければ本文から URL を除いた最初の行
        const firstLine = text.replace(url, '').split('\n').find((l) => l.trim())?.trim() ?? '';
        const likedLevel = Number(r.likedLevel);
        const face = parseFace(faces[i]);
        cells.push({
          dq: Number(o?.dq) || 0,
          dr: Number(o?.dr) || 0,
          url,
          title: (typeof link?.title === 'string' && link.title) || firstLine.slice(0, 200),
          tags: normalizeTags(r.tags),
          liked: Number.isInteger(likedLevel) && likedLevel > 0 ? Math.min(3, likedLevel) : undefined,
          ...(face ? { face } : {}),
        });
      });
      if (!shaped) compactOffsets(cells.length).forEach((h, i) => Object.assign(cells[i], { dq: h.q, dr: h.r }));
      return {
        kind: 'cells',
        cells,
        shaped,
        skipped,
        ours: payload.from === 'rocks-cells-browser',
        nonce: typeof payload.nonce === 'string' ? payload.nonce : '',
      };
    } catch {
      // 読めない HTML は、ふつうの文字として扱う
    }
  }
  const urls = [...new Set((text || '').match(URL_RE) ?? [])].slice(0, MAX_CELLS);
  if (urls.length === 0) return text && text.trim() ? { kind: 'text', text: text.trim().slice(0, 5000) } : { kind: 'none' };
  const shape = compactOffsets(urls.length);
  return { kind: 'urls', text: text.trim().slice(0, 5000), cells: urls.map((url, i) => ({ dq: shape[i].q, dr: shape[i].r, url, title: '' })) };
}

// ---------- 保存したセット ----------

export class CellSetStore {
  private sets: CellSet[] = [];
  private readonly listeners: (() => void)[] = [];

  async load() {
    const saved = await readData<{ version?: unknown; sets?: unknown }>(FILE);
    this.sets = saved && saved.version === 1 && Array.isArray(saved.sets) ? saved.sets.map(parseSet).filter((s): s is CellSet => !!s) : [];
    this.emit();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  // よく使う・最近使ったものから
  list(): CellSet[] {
    return [...this.sets].sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt));
  }

  get(id: string) {
    return this.sets.find((s) => s.id === id);
  }

  add(name: string, cells: CellItem[], island?: CellSet['island']): CellSet {
    const set: CellSet = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: cleanName(name) || 'セット', createdAt: Date.now(), uses: 0, island, cells: cells.slice(0, MAX_CELLS) };
    this.sets = [set, ...this.sets].slice(0, MAX_SETS);
    this.save();
    return set;
  }

  rename(id: string, name: string) {
    const set = this.get(id);
    if (!set || !cleanName(name)) return;
    set.name = cleanName(name);
    this.save();
  }

  remove(id: string) {
    this.sets = this.sets.filter((s) => s.id !== id);
    this.save();
  }

  used(id: string) {
    const set = this.get(id);
    if (!set) return;
    set.uses += 1;
    set.lastUsedAt = Date.now();
    this.save();
  }

  private save() {
    void writeData(FILE, { version: 1, sets: this.sets });
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

function cleanName(name: string) {
  return [...name.replace(/\s+/g, ' ').trim()].slice(0, 30).join('');
}

function parseSet(raw: unknown): CellSet | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !Array.isArray(s.cells)) return null;
  const cells: CellItem[] = [];
  for (const c of s.cells) {
    const x = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
    if (!Number.isInteger(x.dq) || !Number.isInteger(x.dr)) continue;
    const memo = x.memo as { text?: unknown; image?: unknown; replies?: unknown; by?: unknown; label?: unknown } | undefined;
    if (memo && typeof memo.text === 'string') {
      const replies = parseReplies(memo.replies);
      // AI の相棒が残したもの（考察・レター）の印も、保存したセットから戻す
      const by = parseAuthor(memo.by);
      const label = by && typeof memo.label === 'string' ? [...memo.label.trim()].slice(0, 10).join('') : '';
      cells.push({
        dq: x.dq as number,
        dr: x.dr as number,
        url: '',
        title: '',
        tags: normalizeTags(x.tags),
        liked: typeof x.liked === 'number' ? Math.max(0, Math.min(3, Math.round(x.liked))) || undefined : undefined,
        memo: {
          text: memo.text.slice(0, 5000),
          image: typeof memo.image === 'string' ? memo.image : undefined,
          ...(replies.length > 0 ? { replies } : {}),
          ...(by ? { by: { who: by.who, name: by.name }, ...(label ? { label } : {}) } : {}),
        },
      });
      continue;
    }
    if (typeof x.url !== 'string' || !/^https?:\/\//i.test(x.url)) continue;
    const face = parseFace(x.face);
    cells.push({
      dq: x.dq as number,
      dr: x.dr as number,
      url: x.url,
      title: typeof x.title === 'string' ? x.title : '',
      favicon: typeof x.favicon === 'string' ? x.favicon : undefined,
      tags: normalizeTags(x.tags),
      liked: typeof x.liked === 'number' ? Math.max(0, Math.min(3, Math.round(x.liked))) || undefined : undefined,
      ...(face ? { face } : {}),
    });
  }
  if (cells.length === 0) return null;
  const island = s.island as { name?: unknown; color?: unknown } | undefined;
  return {
    id: s.id,
    name: typeof s.name === 'string' ? cleanName(s.name) || 'セット' : 'セット',
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    uses: typeof s.uses === 'number' ? s.uses : 0,
    lastUsedAt: typeof s.lastUsedAt === 'number' ? s.lastUsedAt : undefined,
    island: island && typeof island.name === 'string' && typeof island.color === 'string' ? { name: island.name, color: island.color } : undefined,
    cells: cells.slice(0, MAX_CELLS),
  };
}
