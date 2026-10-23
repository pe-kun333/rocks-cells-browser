// 取り込みファイル（hcb-memo-interchange v1）を「新しいシート」として取り込む計算（設計 design-interchange-import.md）
//   ・ここは DOM も保存も使わない（node だけで試せる。ui/test/memo-interchange.test.ts）
//   ・形の読み口（parseInterchange）→ 付け替え表（buildIdMap）→ 計画（planInterchange：つなぎ直し・置き場所・並び・書き手・時刻・長文の分け・extra）
//   ・当てる（台帳に足す・控え・記録・戻す）のは app/interchange-flow.ts
//   ・ファイルの中の id は付け替えの鍵にしか使わない。シート・島・メモ・カード・線は全部手元で新しく作る（§5）
//   ・memocells.ts・session.ts は data.ts（C++ とのやりとり）を読み込むので import しない。同じ数・同じ直し方をここに置き、テストで同じか確かめる
import { cleanBotLine, cleanBotText, cutChars } from './bot-replies';
import { type BoardLink, type CellRef, findDuplicate } from './board-links';
import { type Hex, hexKey, nearestFree } from './hex';
import { isLinkKind, type LinkKind, MAX_LINKS_PER_CARD, pruneLinks, type ReplyLink } from './memo-card-links';
import type { MemoCell } from './memocells';
import { normalizeSheetName } from './sheets';
import { normalizeTag, normalizeTags } from './tags';
import { MAX_REPLIES, MAX_REPLY_TEXT, parseQuote, type Reply, type ReplyAuthor } from './threads';

export const INTERCHANGE_FORMAT = 'hcb-memo-interchange';
export const INTERCHANGE_VERSION = 1;

// 台帳の上限（memocells.ts・threads.ts と同じ数。テストで同じか確かめる）
export const IX_LIMITS = {
  memoText: 5000, // memocells.ts の MAX_MEMO_TEXT
  cardText: MAX_REPLY_TEXT, // 2,000（D2：変えない。超えた分は「（続き）」の返信に分ける）
  cards: MAX_REPLIES, // 1 メモのカード 300
  label: 10, // memocells.ts の cleanLabel
  byName: 20, // threads.ts の parseAuthor
  posAbs: 1000, // pos の q・r の絶対値がこれを超えれば自動で置く（設計で決めた値）
  timeMin: Date.UTC(2000, 0, 1), // 時刻の下限（§8）
  timeAhead: 24 * 60 * 60 * 1000, // 時刻の上限は「今＋1 日」
} as const;

export const IMPORT_WHO = 'import'; // 取り込んだもの（by の無いもの・キャラのふりをするもの）の書き手（D1）
export const IMPORT_LABEL = '取り込み';
export const OPINION_LABEL = '意見';
export const CONTINUED = '（続き）'; // 長いカードを分けた返信の頭（D2）
export const MEMO_OVERFLOW = '本文の続き'; // 長いメモの文の続き（一番上のカード、rank 0）

// ---------- 見分け（3 つの入口で共通） ----------

export type JsonKind = 'interchange' | 'patch' | 'unknown';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// 取り込みファイルか、Grok の提案（patch.v1）か。提案の印は parsePatch の頭（grok-patch.ts）と同じ type === 'patch'
export function detectJsonKind(raw: unknown): JsonKind {
  if (isRecord(raw) && raw.format === INTERCHANGE_FORMAT) return 'interchange';
  if (isRecord(raw) && raw.type === 'patch') return 'patch';
  return 'unknown';
}

// ---------- 気づいたこと（一覧の頭に理由別に出す） ----------

export type IxProblemCode =
  | 'unknownKey' // 知らない項目（x_ で始まらないもの。extra に残す）
  | 'droppedField' // 受けない項目（portal・image など。extra に残す）
  | 'badMemo' // メモの形が崩れている（オブジェクトでない）
  | 'badCard' // カードの形が崩れている
  | 'badIsland'
  | 'badBoardLink'
  | 'dupMemoId' // 同じ id のメモ（後のものは別のメモとして取り込む）
  | 'dupCardId'
  | 'dupIslandId'
  | 'otherSheet' // メモの sheet が最上位の sheet.id と違う（全部新しいシートへ入れる）
  | 'orphanCard' // 親の見つからない返信（一番上のカードに上げる）
  | 'danglingCardLink' // 相手のいないカードの関連（落とす）
  | 'crossMemoLink' // 別のメモのカードを指す関連（v1 は落として extra に）
  | 'badLinkKind' // 知らない種類の関連・線
  | 'cardLinksOver' // 1 枚 10 本を超えた関連
  | 'sameBack' // 逆向きの「同じ」の二本目
  | 'danglingBoardLink' // 相手のいない盤面の線
  | 'tabBoardLink' // タブへの線（v1 は取り込まない）
  | 'dupBoardLink' // 重なる・自分自身への線
  | 'boardLinksOver' // 盤面の線の上限（500）
  | 'islandMissing' // 島が見つからないメモ（島なし）
  | 'islandsOver' // 島の上限（50）で作らなかった島
  | 'posMoved' // 重なった位置を近くに動かした
  | 'posAuto' // 位置が無い・壊れているので自動で置いた
  | 'timeFixed' // 範囲の外の時刻を今の時刻にした
  | 'longCard' // 2,000 字を超えたカードを「（続き）」に分けた
  | 'longMemo' // 5,000 字を超えたメモの文を「本文の続き」に分けた
  | 'cardsOver' // 1 メモ 300 枚を超えて落としたカード
  | 'tagsCut' // タグを 10 個・30 字に直した
  | 'authorReplaced'; // キャラのふりをする・知らない書き手を「取り込み」にした

export interface IxProblem {
  code: IxProblemCode;
  count: number;
}

const PROBLEM_TEXT: Record<IxProblemCode, (n: number) => string> = {
  unknownKey: (n) => `知らない項目 ${n} 個（残しておきます）`,
  droppedField: (n) => `取り込まない項目 ${n} 個（画像・入口など。残しておきます）`,
  badMemo: (n) => `形の崩れたメモ ${n} 個（取り込みません）`,
  badCard: (n) => `形の崩れたカード ${n} 枚（取り込みません）`,
  badIsland: (n) => `形の崩れた島 ${n} 個（取り込みません）`,
  badBoardLink: (n) => `形の崩れた盤面の線 ${n} 本（取り込みません）`,
  dupMemoId: (n) => `同じ id のメモ ${n} 個（別のメモとして取り込みます）`,
  dupCardId: (n) => `同じ id のカード ${n} 枚（別のカードとして取り込みます）`,
  dupIslandId: (n) => `同じ id の島 ${n} 個（後のものは使いません）`,
  otherSheet: (n) => `別のシートの印のメモ ${n} 個（同じ新しいシートに入れます）`,
  orphanCard: (n) => `親の見つからない返信 ${n} 枚（一番上のカードにします）`,
  danglingCardLink: (n) => `相手のいないカードの関連 ${n} 本（落とします）`,
  crossMemoLink: (n) => `別のメモのカードへの関連 ${n} 本（v1 は取り込みません）`,
  badLinkKind: (n) => `知らない種類の関連・線 ${n} 本（落とします）`,
  cardLinksOver: (n) => `1 枚 10 本を超えた関連 ${n} 本（落とします）`,
  sameBack: (n) => `逆向きの「同じ」の二本目 ${n} 本（落とします）`,
  danglingBoardLink: (n) => `相手のいない盤面の線 ${n} 本（落とします）`,
  tabBoardLink: (n) => `タブへの線 ${n} 本（v1 は取り込みません）`,
  dupBoardLink: (n) => `重なる・自分への盤面の線 ${n} 本（落とします）`,
  boardLinksOver: (n) => `盤面の線の上限（500）を超える ${n} 本（落とします）`,
  islandMissing: (n) => `島が見つからないメモ ${n} 個（島なしで取り込みます）`,
  islandsOver: (n) => `島の上限（50）で作れない島 ${n} 個（そのメモは島なし）`,
  posMoved: (n) => `重なった位置 ${n} 個（近くに動かしました）`,
  posAuto: (n) => `位置の無いメモ ${n} 個（近くに置きました）`,
  timeFixed: (n) => `範囲の外の時刻 ${n} 個（今の時刻にしました）`,
  longCard: (n) => `2,000 字を超えたカード ${n} 枚（「${CONTINUED}」の返信に分けました）`,
  longMemo: (n) => `5,000 字を超えたメモ ${n} 個（「${MEMO_OVERFLOW}」のカードに分けました）`,
  cardsOver: (n) => `1 メモ 300 枚を超えたカード ${n} 枚（落とします）`,
  tagsCut: (n) => `直したタグ ${n} 個（10 個・30 字まで）`,
  authorReplaced: (n) => `書き手を「${IMPORT_LABEL}」にしたもの ${n} 個`,
};

export function problemText(p: IxProblem): string {
  return PROBLEM_TEXT[p.code](p.count);
}

class ProblemCounter {
  private readonly counts = new Map<IxProblemCode, number>();
  add(code: IxProblemCode, n = 1) {
    if (n > 0) this.counts.set(code, (this.counts.get(code) ?? 0) + n);
  }
  list(): IxProblem[] {
    return [...this.counts].map(([code, count]) => ({ code, count }));
  }
}

function mergeProblems(...lists: IxProblem[][]): IxProblem[] {
  const c = new ProblemCounter();
  for (const list of lists) for (const p of list) c.add(p.code, p.count);
  return c.list();
}

// ---------- 形の読み口 ----------

export interface IxCard {
  key: string; // 付け替えの鍵（ファイルの id。無い・重なれば #<メモ>.<番号>）
  index: number; // メモの中の順
  parent: string | null; // 親の鍵（ファイルの値のまま。つなぎ直しは計画で）
  text: string;
  createdAt: unknown;
  editedAt: unknown;
  by: unknown;
  rank: unknown;
  tags: unknown;
  links: unknown;
  quote: unknown;
  keep: Record<string, unknown>; // x_*（黙って残す）
  unknown: Record<string, unknown>; // 知らない項目（残して数える）
  dropped: Record<string, unknown>; // 受けない項目（image・file）
}

export interface IxMemo {
  key: string;
  index: number; // ファイルの memos の中の順
  sheet: unknown;
  pos: unknown;
  text: string;
  tags: unknown;
  liked: unknown;
  island: string | null; // 島の鍵（ファイルの値）
  by: unknown;
  label: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  cards: IxCard[];
  keep: Record<string, unknown>;
  unknown: Record<string, unknown>;
  dropped: Record<string, unknown>; // portal・bot・app・capture・image・source・linkNames・linkSet
}

export interface IxIsland {
  key: string;
  index: number;
  name: string;
  color: unknown;
  keep: Record<string, unknown>;
  unknown: Record<string, unknown>;
}

export interface IxBoardLink {
  index: number;
  from: unknown;
  to: unknown;
  kind: unknown;
  raw: unknown;
}

export interface IxDropped {
  where: string; // memos[3]・memos[0].replies[2] など
  reason: string;
  raw: unknown;
}

export interface InterchangeDoc {
  version: 1;
  generatedAt?: string;
  sheet: { name: string; color: unknown; id?: unknown; createdAt?: unknown; keep: Record<string, unknown>; unknown: Record<string, unknown> };
  botName?: string; // x_grokBot.botName（書き手の名前の候補。§7）
  requestNote?: string; // x_grokBot.requestNote（一覧の頭に出す）
  islands: IxIsland[];
  memos: IxMemo[];
  boardLinks: IxBoardLink[];
  top: Record<string, unknown>; // 最上位の x_*（x_grokBot も）
  topUnknown: Record<string, unknown>; // 最上位の知らない項目
  dropped: IxDropped[]; // 形の崩れたもの（原文のまま）
}

export type InterchangeReason = 'notJson' | 'badFormat' | 'badVersion' | 'noMemos';

export const INTERCHANGE_REASON_TEXT: Record<InterchangeReason, string> = {
  notJson: 'ファイルを読めませんでした',
  badFormat: 'このファイルは取り込めません',
  badVersion: '新しい版の取り込みファイルです（v1 まで読めます）',
  noMemos: '取り込めるメモがありません',
};

export type InterchangeParse = { ok: true; doc: InterchangeDoc; problems: IxProblem[] } | { ok: false; reason: InterchangeReason; version?: number };

const TOP_KEYS = new Set(['format', 'version', 'generatedAt', 'sheet', 'islands', 'memos', 'boardLinks']);
const SHEET_KEYS = new Set(['id', 'name', 'color', 'createdAt']);
const ISLAND_KEYS = new Set(['id', 'name', 'color']);
const MEMO_KEYS = new Set(['id', 'sheet', 'pos', 'text', 'tags', 'liked', 'island', 'replies', 'by', 'label', 'createdAt', 'updatedAt']);
const MEMO_DROP = new Set(['portal', 'bot', 'app', 'capture', 'image', 'source', 'linkNames', 'linkSet']);
const CARD_KEYS = new Set(['id', 'parent', 'text', 'createdAt', 'editedAt', 'by', 'rank', 'tags', 'links', 'quote']);
const CARD_DROP = new Set(['image', 'file']);
const BOARD_LINK_KEYS = new Set(['id', 'from', 'to', 'kind']);

// 知らない項目を 3 つに分ける（x_*：黙って残す／受けない項目／知らない項目）
function sortKeys(raw: Record<string, unknown>, known: Set<string>, drop: Set<string> = new Set()) {
  const keep: Record<string, unknown> = {};
  const unknown: Record<string, unknown> = {};
  const dropped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (known.has(k)) continue;
    if (k.startsWith('x_')) keep[k] = v;
    else if (drop.has(k)) dropped[k] = v;
    else unknown[k] = v;
  }
  return { keep, unknown, dropped };
}

const count = (o: Record<string, unknown>) => Object.keys(o).length;
const fileKey = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
const cleanText = (v: unknown): string => (typeof v === 'string' ? cleanBotText(v) : '');

// 文から JSON を読む（読めなければ null）
export function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// 形だけ確かめる（全体を断るのは §4.1 の時だけ。崩れた所は数えて落とす）
export function parseInterchange(raw: unknown): InterchangeParse {
  if (raw === undefined) return { ok: false, reason: 'notJson' };
  if (!isRecord(raw) || raw.format !== INTERCHANGE_FORMAT) return { ok: false, reason: 'badFormat' };
  if (raw.version !== INTERCHANGE_VERSION) {
    const v = typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : undefined;
    return { ok: false, reason: 'badVersion', ...(v !== undefined ? { version: v } : {}) };
  }
  if (!Array.isArray(raw.memos) || raw.memos.length === 0) return { ok: false, reason: 'noMemos' };
  const problems = new ProblemCounter();
  const dropped: IxDropped[] = [];

  const top = sortKeys(raw, TOP_KEYS);
  problems.add('unknownKey', count(top.unknown));
  const grok = isRecord(top.keep.x_grokBot) ? top.keep.x_grokBot : undefined;

  const rawSheet = isRecord(raw.sheet) ? raw.sheet : {};
  const sheetKeys = sortKeys(rawSheet, SHEET_KEYS);
  problems.add('unknownKey', count(sheetKeys.unknown));
  const sheetId = rawSheet.id;

  // 島
  const islands: IxIsland[] = [];
  const islandKeys = new Set<string>();
  (Array.isArray(raw.islands) ? raw.islands : []).forEach((item, index) => {
    if (!isRecord(item)) {
      problems.add('badIsland');
      dropped.push({ where: `islands[${index}]`, reason: 'badIsland', raw: item });
      return;
    }
    const key = fileKey(item.id);
    if (!key || islandKeys.has(key)) {
      // 島はメモが鍵で指すだけなので、鍵の無い・重なった島は使えない（後のものを落とす）
      problems.add(key ? 'dupIslandId' : 'badIsland');
      dropped.push({ where: `islands[${index}]`, reason: key ? 'dupIslandId' : 'badIsland', raw: item });
      return;
    }
    islandKeys.add(key);
    const k = sortKeys(item, ISLAND_KEYS);
    problems.add('unknownKey', count(k.unknown));
    islands.push({ key, index, name: typeof item.name === 'string' ? item.name : '', color: item.color, keep: k.keep, unknown: k.unknown });
  });

  // メモとカード
  const memos: IxMemo[] = [];
  const memoKeys = new Set<string>();
  raw.memos.forEach((item, index) => {
    if (!isRecord(item)) {
      problems.add('badMemo');
      dropped.push({ where: `memos[${index}]`, reason: 'badMemo', raw: item });
      return;
    }
    let key = fileKey(item.id);
    if (key && memoKeys.has(key)) {
      problems.add('dupMemoId');
      key = null;
    }
    key ??= `#${index}`;
    memoKeys.add(key);
    const k = sortKeys(item, MEMO_KEYS, MEMO_DROP);
    problems.add('unknownKey', count(k.unknown));
    problems.add('droppedField', count(k.dropped));
    if (sheetId !== undefined && item.sheet !== undefined && item.sheet !== sheetId) problems.add('otherSheet');
    const cards: IxCard[] = [];
    const cardKeys = new Set<string>();
    (Array.isArray(item.replies) ? item.replies : []).forEach((card, j) => {
      if (!isRecord(card)) {
        problems.add('badCard');
        dropped.push({ where: `memos[${index}].replies[${j}]`, reason: 'badCard', raw: card });
        return;
      }
      let ckey = fileKey(card.id);
      if (ckey && cardKeys.has(ckey)) {
        problems.add('dupCardId');
        ckey = null;
      }
      ckey ??= `#${index}.${j}`;
      cardKeys.add(ckey);
      const ck = sortKeys(card, CARD_KEYS, CARD_DROP);
      problems.add('unknownKey', count(ck.unknown));
      problems.add('droppedField', count(ck.dropped));
      cards.push({
        key: ckey,
        index: j,
        parent: fileKey(card.parent),
        text: cleanText(card.text),
        createdAt: card.createdAt,
        editedAt: card.editedAt,
        by: card.by,
        rank: card.rank,
        tags: card.tags,
        links: card.links,
        quote: card.quote,
        keep: ck.keep,
        unknown: ck.unknown,
        dropped: ck.dropped,
      });
    });
    memos.push({
      key,
      index,
      sheet: item.sheet,
      pos: item.pos,
      text: cleanText(item.text),
      tags: item.tags,
      liked: item.liked,
      island: fileKey(item.island),
      by: item.by,
      label: item.label,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      cards,
      keep: k.keep,
      unknown: k.unknown,
      dropped: k.dropped,
    });
  });
  if (memos.length === 0) return { ok: false, reason: 'noMemos' };

  // 盤面の線（形の確かめとつなぎ直しは計画で）
  const boardLinks: IxBoardLink[] = [];
  (Array.isArray(raw.boardLinks) ? raw.boardLinks : []).forEach((item, index) => {
    if (!isRecord(item)) {
      problems.add('badBoardLink');
      dropped.push({ where: `boardLinks[${index}]`, reason: 'badBoardLink', raw: item });
      return;
    }
    problems.add('unknownKey', count(sortKeys(item, BOARD_LINK_KEYS).unknown));
    boardLinks.push({ index, from: item.from, to: item.to, kind: item.kind, raw: item });
  });

  const doc: InterchangeDoc = {
    version: 1,
    ...(typeof raw.generatedAt === 'string' ? { generatedAt: raw.generatedAt.slice(0, 64) } : {}),
    sheet: {
      name: typeof rawSheet.name === 'string' ? rawSheet.name : '',
      color: rawSheet.color,
      ...(sheetId !== undefined ? { id: sheetId } : {}),
      ...(rawSheet.createdAt !== undefined ? { createdAt: rawSheet.createdAt } : {}),
      keep: sheetKeys.keep,
      unknown: sheetKeys.unknown,
    },
    ...(grok && typeof grok.botName === 'string' && cleanBotLine(grok.botName) ? { botName: cleanBotLine(grok.botName) } : {}),
    ...(grok && typeof grok.requestNote === 'string' && cleanBotText(grok.requestNote) ? { requestNote: cleanBotText(grok.requestNote) } : {}),
    islands,
    memos,
    boardLinks,
    top: top.keep,
    topUnknown: top.unknown,
    dropped,
  };
  return { ok: true, doc, problems: problems.list() };
}

// 文から読む（大きさは呼ぶ側が import-limits.ts で先に確かめる）
export function parseInterchangeText(text: string): InterchangeParse {
  return parseInterchange(readJson(text));
}

// ---------- 付け替え表 ----------

export interface IdFactory {
  sheet: () => string; // sheets.ts の newSheetId
  island: () => string; // islands.ts の newIslandId
  memo: () => string; // memocells.ts の newMemoId
  reply: () => string; // threads.ts の newReplyId
}

export interface IdMap {
  sheet: { from: string | null; to: string };
  islands: Map<string, string>; // 島の鍵 → 新しい id
  memos: Map<string, string>; // メモの鍵 → 新しい id
  cards: Map<string, Map<string, string>>; // メモの鍵 → （カードの鍵 → 新しい id）。カードはメモごとの表（関連・親は同じメモの中しか指せない）
}

// 新しい id を作る（使った id・手元の台帳の id と重なれば作り直す。newReplyId は時刻＋4 字なので、同じミリ秒に何枚も作ると重なりうる）
function freshId(make: () => string, used: Set<string>): string {
  for (let i = 0; i < 64; i++) {
    const id = make();
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
  // 64 回重なるのは make が同じ値しか返さないとき（テストの偽物など）。後ろに番号を足して必ず別にする
  const base = make();
  let n = 2;
  while (used.has(`${base}${n.toString(36)}`)) n++;
  const id = `${base}${n.toString(36)}`;
  used.add(id);
  return id;
}

// 全部の鍵に新しい id を振る。taken：手元の台帳にある id（シート・島・メモ・カード）
export function buildIdMap(doc: InterchangeDoc, ids: IdFactory, taken: ReadonlySet<string> = new Set()): IdMap {
  const used = new Set(taken);
  const sheetFrom = typeof doc.sheet.id === 'string' ? doc.sheet.id : null;
  const map: IdMap = { sheet: { from: sheetFrom, to: freshId(ids.sheet, used) }, islands: new Map(), memos: new Map(), cards: new Map() };
  for (const island of doc.islands) map.islands.set(island.key, freshId(ids.island, used));
  for (const memo of doc.memos) {
    map.memos.set(memo.key, freshId(ids.memo, used));
    const cards = new Map<string, string>();
    for (const card of memo.cards) cards.set(card.key, freshId(ids.reply, used));
    map.cards.set(memo.key, cards);
  }
  return map;
}

// ---------- 時刻・書き手・長文・並び・位置（小さな純粋な関数） ----------

// ファイルの時刻を保つ。有限の数で 2000-01-01〜今＋1 日の範囲のものだけ。外れたら今、無ければ fallback
export function clampTime(value: unknown, now: number, fallback = now): { value: number; fixed: boolean } {
  if (typeof value === 'number' && Number.isFinite(value) && value >= IX_LIMITS.timeMin && value <= now + IX_LIMITS.timeAhead) {
    return { value: Math.round(value), fixed: false };
  }
  // 無いものは fallback（カードならメモの時刻）、範囲の外は今（§8）
  return value === undefined ? { value: fallback, fixed: false } : { value: now, fixed: true };
}

// 出どころの名前（by の無いものに付ける。x_grokBot.botName ＋「の下書き」。無ければ「取り込み」）
export function sourceName(botName?: string): string {
  return botName ? cutChars(`${botName}の下書き`, IX_LIMITS.byName).text : IMPORT_LABEL;
}

export interface Attribution {
  by: ReplyAuthor;
  label: string; // メモの label（カードでは使わない）
  original?: unknown; // 替えた・捨てた by の元の値（extra の by へ）
  replaced: boolean; // by はあったが「取り込み」に替えた（キャラのふり・知らない who）
}

// 書き手の印（§7）。使う人として見せない：by の無いもの・who が bot でないものは全部 import
//   ・who:"bot" は名前（20 字）だけ残す。model・cost は料金の表示に混ざらないよう捨てて extra へ
//   ・ファイルの中で「使う人が書いた」と主張する手段は作らない（by:null や who:"user" も import）
export function attributeAuthor(raw: unknown, source: string, rawLabel?: unknown): Attribution {
  const fileLabel = typeof rawLabel === 'string' ? cutChars(cleanBotLine(rawLabel), IX_LIMITS.label).text : '';
  if (isRecord(raw) && raw.who === 'bot' && typeof raw.name === 'string' && cleanBotLine(raw.name)) {
    const name = cutChars(cleanBotLine(raw.name), IX_LIMITS.byName).text;
    const extra = raw.model !== undefined || raw.cost !== undefined || Object.keys(raw).some((k) => k !== 'who' && k !== 'name');
    return { by: { who: 'bot', name }, label: fileLabel || OPINION_LABEL, ...(extra ? { original: raw } : {}), replaced: false };
  }
  const by: ReplyAuthor = { who: IMPORT_WHO, name: source };
  if (raw === undefined) return { by, label: fileLabel || IMPORT_LABEL, replaced: false };
  return { by, label: fileLabel || IMPORT_LABEL, original: raw, replaced: true };
}

// 長い文を max 字ずつに分ける（サロゲートペアを割らない）。空なら [''] を返す
export function splitChars(text: string, max: number): string[] {
  const chars = [...text];
  if (chars.length <= max) return [text];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += max) out.push(chars.slice(i, i + max).join(''));
  return out;
}

// カードの文を、2,000 字の本体と「（続き）」の返信に分ける（D2。上限は変えず、捨てない）
//   続きの返信は「（続き）」＋改行で始め、それも含めて 2,000 字に収める
export function splitLongText(text: string, max: number = IX_LIMITS.cardText): string[] {
  const chars = [...text];
  if (chars.length <= max) return [text];
  const head = chars.slice(0, max).join('');
  const prefix = `${CONTINUED}\n`;
  const room = max - [...prefix].length;
  const rest = splitChars(chars.slice(max).join(''), room).map((part) => prefix + part);
  return [head, ...rest];
}

// メモの文を 5,000 字の本文と、続き（「本文の続き」＋改行で始まるカードの文）に分ける。続きが無ければ null
export function splitMemoText(text: string, max: number = IX_LIMITS.memoText): { text: string; overflow: string | null } {
  const chars = [...text];
  if (chars.length <= max) return { text, overflow: null };
  return { text: chars.slice(0, max).join(''), overflow: `${MEMO_OVERFLOW}\n${chars.slice(max).join('')}` };
}

// 一番上のカードの並びを 0,1,2… に詰め直す（rank → ファイルの順。rank の無いものは後ろに、ファイルの順で）
export function normalizeRanks<T>(items: readonly T[], rankOf: (item: T) => unknown): Map<T, number> {
  const decorated = items.map((item, order) => {
    const r = rankOf(item);
    return { item, order, rank: typeof r === 'number' && Number.isFinite(r) ? r : Number.POSITIVE_INFINITY };
  });
  decorated.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return new Map(decorated.map((d, i) => [d.item, i]));
}

// ファイルの pos を読む（数なら丸める。無い・壊れている・大きすぎれば null＝自動で置く）
export function readPos(raw: unknown): Hex | null {
  if (!isRecord(raw)) return null;
  const q = raw.q;
  const r = raw.r;
  if (typeof q !== 'number' || typeof r !== 'number' || !Number.isFinite(q) || !Number.isFinite(r)) return null;
  const pos = { q: Math.round(q), r: Math.round(r) };
  return Math.abs(pos.q) > IX_LIMITS.posAbs || Math.abs(pos.r) > IX_LIMITS.posAbs ? null : pos;
}

export interface PlaceResult {
  pos: Map<string, Hex>; // メモの鍵 → 位置
  moved: number; // 重なって近くに動かした数
  auto: number; // 位置が無く自動で置いた数
}

// 新しいシート（空）での位置を決める（§6.1）
//   ・ファイルの順に、pos のよいメモから置く。重なれば近くの空きへ
//   ・pos の無いメモは、同じ島で先に置いたメモの近くへ（島の無いものは 0,0 から）
export function placeMemos(memos: readonly { key: string; pos: unknown; island: string | null }[]): PlaceResult {
  const taken = new Set<string>();
  const out = new Map<string, Hex>();
  const islandAnchor = new Map<string, Hex>();
  let moved = 0;
  let auto = 0;
  const isTaken = (h: Hex) => taken.has(hexKey(h));
  const put = (key: string, h: Hex, island: string | null) => {
    taken.add(hexKey(h));
    out.set(key, h);
    if (island && !islandAnchor.has(island)) islandAnchor.set(island, h);
  };
  const later: { key: string; island: string | null }[] = [];
  for (const m of memos) {
    const pos = readPos(m.pos);
    if (!pos) {
      later.push(m);
      continue;
    }
    if (isTaken(pos)) {
      moved++;
      put(m.key, nearestFree(pos, isTaken), m.island);
    } else put(m.key, pos, m.island);
  }
  for (const m of later) {
    auto++;
    const near = (m.island && islandAnchor.get(m.island)) || { q: 0, r: 0 };
    put(m.key, isTaken(near) ? nearestFree(near, isTaken) : near, m.island);
  }
  return { pos: out, moved, auto };
}

// 島の名前（session.ts の normalizeIslandName と同じ直し方。session.ts は data.ts を読み込むのでここに置く）
export function islandName(name: string): string {
  return [...name.trim().replace(/\s+/g, ' ')].slice(0, 20).join('') || normalizeTag(name) || '島';
}

const COLOR_RE = /^#[0-9a-f]{6}$/i;

// ---------- 計画 ----------

export interface InterchangeWorld {
  now: number;
  ids: IdFactory;
  taken: ReadonlySet<string>; // 手元の台帳にある id（重ならないように）
  counts: { sheets: number; memos: number; islands: number; boardLinks: number };
  limits: { sheets: number; memos: number; islands: number; boardLinks: number }; // 100・2000・50・500
  sheetColor: () => string; // sheets.nextColor()
  islandColor: (n: number) => string; // 空いた島の色（n 個目に作る島）
  portal: { sheet: string; pos: Hex } | null; // 今のシートに入口を置く位置（置けなければ null）
}

export interface InterchangeChoice {
  memos?: ReadonlySet<string>; // 取り込むメモの鍵（無ければ全部）
  skipIslands?: ReadonlySet<string>; // 作らない島の鍵（そのメモは島なし）
  portal?: boolean; // 今のシートに入口を置く（D3。既定は置く）
}

export interface MemoRow {
  key: string;
  id: string; // 新しい id
  title: string; // 一覧の題（文の 1 行目）
  island: string | null; // 島の鍵（作る島だけ。作らなければ null）
  pos: Hex;
  selected: boolean;
  cards: number; // カード（分けて増えた分も含む）
  botCards: number; // by.who=bot のカード
  cardLinks: number;
  tags: number;
  bot: boolean; // メモ自身が by.who=bot
  opinions: string[]; // x_opinion の印（「補足 0.85」など）
}

export interface IslandRow {
  key: string;
  id: string;
  name: string;
  color: string;
  memoKeys: string[];
  create: boolean; // 作る（上限・選び方で作らないものは false）
  overLimit: boolean; // 島の上限で作れない
}

export interface PlannedBoardLink {
  from: CellRef; // m:<新しい id>
  to: CellRef;
  kind: LinkKind;
  fromKey: string;
  toKey: string;
  selected: boolean; // 両端のメモを選んだ時だけ
}

export interface InterchangeExtra {
  v: 1;
  importId: string;
  importedAt: number;
  source: string;
  format: typeof INTERCHANGE_FORMAT;
  version: 1;
  generatedAt?: string;
  sheet: { to: string; from: { id?: unknown; createdAt?: unknown }; keep?: Record<string, unknown>; unknown?: Record<string, unknown> };
  top: Record<string, unknown>; // 最上位の x_* と知らない項目
  ids: { islands: Record<string, string>; memos: Record<string, string>; cards: Record<string, Record<string, string>> };
  islands: Record<string, Record<string, unknown>>; // 新しい島の id → x_* など
  memos: Record<string, Record<string, unknown>>; // 新しいメモの id → x_*・unknown・dropped
  cards: Record<string, Record<string, Record<string, unknown>>>; // 新しいメモの id → 新しいカードの id → x_layout・x_opinion など
  by: Record<string, unknown>; // "m…" か "m…/r…" → 替えた・捨てた by の元の値
  dropped: IxDropped[];
}

export interface InterchangePlan {
  map: IdMap;
  sheet: { id: string; name: string; color: string };
  islands: IslandRow[];
  rows: MemoRow[]; // 全部のメモ（選んでいないものも）
  cells: MemoCell[]; // 足すメモ（選んだものだけ。parseMemo を通る形・新しい id・位置・by・時刻つき）
  portal: { sheet: string; pos: Hex } | null;
  boardLinks: PlannedBoardLink[]; // 全部（selected で絞る）
  problems: IxProblem[];
  totals: { memos: number; cards: number; botCards: number; importCards: number; cardLinks: number; boardLinks: number; islands: number };
  blocked: string | null; // 反映を押せない理由（null なら押せる）
  overMemos: number; // メモの上限を超える数（あと n 個外す）
  buildExtra: (importId: string, source: string, importedAt: number) => InterchangeExtra;
}

const OPINION_STANCE: Record<string, string> = { supplement: '補足', caution: '注意', question: '疑問', counter: '反論', agree: '賛成', ground: '根拠' };

function opinionMark(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const stance = typeof raw.stance === 'string' ? (OPINION_STANCE[raw.stance] ?? cutChars(cleanBotLine(raw.stance), 10).text) : '意見';
  const conf = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? ` ${Math.round(raw.confidence * 100) / 100}` : '';
  return `${stance}${conf}`;
}

function titleOf(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return cutChars(line.trim(), 40).text || '（文なし）';
}

// 計画を作る（何も変えない）。map を渡せば同じ id を使う（一覧のチェックを変えるたびに作り直しても id が変わらない）
//   map の id が手元の台帳と重なっていれば（開いてから当てるまでに増えたとき）、作り直す
export function planInterchange(doc: InterchangeDoc, world: InterchangeWorld, choice: InterchangeChoice = {}, given?: IdMap, parseProblems: IxProblem[] = []): InterchangePlan {
  const map = given && !idMapCollides(given, world.taken) ? given : buildIdMap(doc, world.ids, world.taken);
  const problems = new ProblemCounter();
  const now = world.now;
  const source = sourceName(doc.botName);
  const selectedKey = (key: string) => !choice.memos || choice.memos.has(key);

  // extra（新しい id で引ける形）
  const xIslands: InterchangeExtra['islands'] = {};
  const xMemos: InterchangeExtra['memos'] = {};
  const xCards: InterchangeExtra['cards'] = {};
  const xBy: InterchangeExtra['by'] = {};
  const xDropped: IxDropped[] = [...doc.dropped];
  const putExtra = (bag: Record<string, unknown>, key: string, value: Record<string, unknown>) => {
    const clean = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && !(isRecord(v) && Object.keys(v).length === 0)));
    if (Object.keys(clean).length > 0) bag[key] = clean;
  };

  // 島（上限：今の数＋作る数 ≤ 50。足りない分は作らず、そのメモは島なし）
  const usedIslands = new Set(doc.memos.filter((m) => selectedKey(m.key) && m.island).map((m) => m.island as string));
  let room = Math.max(0, world.limits.islands - world.counts.islands);
  let made = 0;
  const islands: IslandRow[] = doc.islands.map((i) => {
    const id = map.islands.get(i.key) as string;
    const wanted = usedIslands.has(i.key) && !choice.skipIslands?.has(i.key);
    const fits = room > 0;
    if (wanted && fits) room--;
    if (wanted && !fits) problems.add('islandsOver');
    const color = typeof i.color === 'string' && COLOR_RE.test(i.color) ? i.color : world.islandColor(made);
    if (wanted && fits) made++;
    putExtra(xIslands, id, { ...i.keep, ...(count(i.unknown) ? { unknown: i.unknown } : {}) });
    return { key: i.key, id, name: islandName(cleanBotLine(i.name)), color, memoKeys: doc.memos.filter((m) => m.island === i.key).map((m) => m.key), create: wanted && fits, overLimit: wanted && !fits };
  });
  const islandOf = new Map(islands.filter((i) => i.create).map((i) => [i.key, i.id]));
  const knownIsland = new Set(doc.islands.map((i) => i.key));
  const rowIsland = new Map(islands.filter((i) => i.create).map((i) => [i.key, i.key]));

  // 位置（全部のメモで決める。選び方で位置が変わらないように）
  const placed = placeMemos(doc.memos);
  problems.add('posMoved', placed.moved);
  problems.add('posAuto', placed.auto);

  // カードの鍵がどのメモのものか（別のメモのカードを指す関連を見分ける）
  const cardOwner = new Map<string, string>();
  for (const m of doc.memos) for (const c of m.cards) if (!cardOwner.has(c.key)) cardOwner.set(c.key, m.key);

  const rows: MemoRow[] = [];
  const cells: MemoCell[] = [];
  let totalCards = 0;
  let botCards = 0;
  let importCards = 0;
  let cardLinks = 0;

  for (const m of doc.memos) {
    const memoId = map.memos.get(m.key) as string;
    const cardIds = map.cards.get(m.key) as Map<string, string>;
    const selected = selectedKey(m.key);
    const memoProblems = new ProblemCounter();
    const xm: Record<string, Record<string, unknown>> = {};

    // メモの時刻・書き手・文
    const created = clampTime(m.createdAt, now);
    const updatedRaw = clampTime(m.updatedAt, now, created.value);
    const updated = Math.max(created.value, updatedRaw.value);
    memoProblems.add('timeFixed', Number(created.fixed) + Number(updatedRaw.fixed));
    const author = attributeAuthor(m.by, source, m.label);
    if (author.original !== undefined) xBy[memoId] = author.original;
    if (author.replaced) memoProblems.add('authorReplaced');
    const split = splitMemoText(m.text);
    if (split.overflow) memoProblems.add('longMemo');
    const tags = normalizeTags(m.tags);
    const rawTags = Array.isArray(m.tags) ? m.tags.length : 0;
    memoProblems.add('tagsCut', Math.max(0, rawTags - tags.length));
    if (m.island && !knownIsland.has(m.island)) memoProblems.add('islandMissing');

    // カード：親をつなぎ直す（親の無い返信は一番上へ）
    const replies: Reply[] = [];
    const ids = new Set(m.cards.map((c) => c.key));
    const parentOf = new Map<string, string | null>();
    for (const c of m.cards) {
      const p = c.parent !== null && ids.has(c.parent) && c.parent !== c.key ? c.parent : null;
      if (c.parent !== null && p === null) memoProblems.add('orphanCard');
      parentOf.set(c.key, p);
    }
    // 親をたどって輪になっているもの（a→b→a）も一番上に上げる
    for (const c of m.cards) {
      const seen = new Set<string>([c.key]);
      let cur = parentOf.get(c.key) ?? null;
      while (cur !== null) {
        if (seen.has(cur)) {
          parentOf.set(c.key, null);
          memoProblems.add('orphanCard');
          break;
        }
        seen.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
    }
    const tops = m.cards.filter((c) => parentOf.get(c.key) === null);
    const rank = normalizeRanks(tops, (c) => c.rank);
    const overflowCard = split.overflow !== null;
    const cardsX: Record<string, Record<string, unknown>> = {};

    // 長いメモの続き：rank 0 の一番上のカード（＋さらに長ければ「（続き）」の返信）
    if (split.overflow) {
      const parts = splitLongText(split.overflow);
      let parent: string | null = null;
      parts.forEach((text, i) => {
        const id = freshId(world.ids.reply, usedAll(map, world.taken, replies));
        replies.push({ id, parent, text, createdAt: created.value, by: author.by, ...(i === 0 ? { rank: 0 } : {}) });
        parent = id;
      });
    }

    for (const c of m.cards) {
      const id = cardIds.get(c.key) as string;
      const parentKey = parentOf.get(c.key) ?? null;
      const top = parentKey === null;
      const cc = clampTime(c.createdAt, now, created.value);
      const ce = c.editedAt === undefined ? null : clampTime(c.editedAt, now, cc.value);
      memoProblems.add('timeFixed', Number(cc.fixed) + Number(ce?.fixed ?? 0));
      const ca = attributeAuthor(c.by, source);
      if (ca.original !== undefined) xBy[`${memoId}/${id}`] = ca.original;
      if (ca.replaced) memoProblems.add('authorReplaced');
      const quote = parseQuote(c.quote);
      const parts = splitLongText(c.text);
      if (parts.length > 1) memoProblems.add('longCard');
      const x: Record<string, unknown> = { ...c.keep };
      if (count(c.unknown)) x.unknown = c.unknown;
      if (count(c.dropped)) x.dropped = c.dropped;
      if (quote === undefined && c.quote !== undefined) x.dropped = { ...((x.dropped as Record<string, unknown>) ?? {}), quote: c.quote };
      // 返信のタグ・関連・rank は台帳が読まないので extra に（⚠ は出さない）
      if (!top) {
        const keepOnReply: Record<string, unknown> = {};
        if (c.tags !== undefined) keepOnReply.tags = c.tags;
        if (c.links !== undefined) keepOnReply.links = c.links;
        if (c.rank !== undefined) keepOnReply.rank = c.rank;
        if (count(keepOnReply)) x.onReply = keepOnReply;
      }
      // x_opinion の targets も新しいカードの id に（付け替えられないものは unmappedTargets に元のまま）
      if (isRecord(c.keep.x_opinion) && Array.isArray(c.keep.x_opinion.targets)) {
        const mapped: unknown[] = [];
        const unmapped: unknown[] = [];
        for (const t of c.keep.x_opinion.targets) {
          const to = typeof t === 'string' ? cardIds.get(t) : undefined;
          if (to) mapped.push(to);
          else unmapped.push(t);
        }
        x.x_opinion = { ...c.keep.x_opinion, targets: mapped, ...(unmapped.length ? { unmappedTargets: unmapped } : {}) };
      }
      if (cardIds.size > 0) x.from = c.key;
      putExtra(cardsX, id, x);

      // 関連（一番上のカードだけ。相手は同じメモの一番上のカード）
      let links: ReplyLink[] = [];
      if (top && Array.isArray(c.links)) {
        for (const raw of c.links) {
          if (!isRecord(raw)) {
            memoProblems.add('danglingCardLink');
            continue;
          }
          const toKey = fileKey(raw.to);
          if (!isLinkKind(raw.kind)) {
            memoProblems.add('badLinkKind');
            xDropped.push({ where: `memos[${m.index}].replies[${c.index}].links`, reason: 'badLinkKind', raw });
            continue;
          }
          const target = toKey !== null && ids.has(toKey) ? toKey : null;
          if (target === null || target === c.key || parentOf.get(target) !== null) {
            const cross = toKey !== null && !ids.has(toKey) && cardOwner.has(toKey);
            memoProblems.add(cross ? 'crossMemoLink' : 'danglingCardLink');
            xDropped.push({ where: `memos[${m.index}].replies[${c.index}].links`, reason: cross ? 'crossMemoLink' : 'danglingCardLink', raw });
            continue;
          }
          const to = cardIds.get(target) as string;
          if (links.some((l) => l.to === to)) {
            memoProblems.add('danglingCardLink');
            continue;
          }
          if (links.length >= MAX_LINKS_PER_CARD) {
            memoProblems.add('cardLinksOver');
            xDropped.push({ where: `memos[${m.index}].replies[${c.index}].links`, reason: 'cardLinksOver', raw });
            continue;
          }
          links = [...links, { to, kind: raw.kind }];
        }
      }
      const cardTags = top ? normalizeTags(c.tags) : [];
      if (top && Array.isArray(c.tags)) memoProblems.add('tagsCut', Math.max(0, c.tags.length - cardTags.length));
      const r = top ? (rank.get(c) as number) + (overflowCard ? 1 : 0) : undefined;
      const parent = parentKey === null ? null : (cardIds.get(parentKey) as string);
      replies.push({
        id,
        parent,
        text: parts[0],
        createdAt: cc.value,
        by: ca.by,
        ...(ce ? { editedAt: Math.max(ce.value, cc.value) } : {}),
        ...(quote ? { quote } : {}),
        ...(cardTags.length ? { tags: cardTags } : {}),
        ...(links.length ? { links } : {}),
        ...(r !== undefined ? { rank: r } : {}),
      });
      // 長いカードの続き：そのカードへの返信「（続き）」（続きの続きはその下へ）
      let prev = id;
      for (const text of parts.slice(1)) {
        const more = freshId(world.ids.reply, usedAll(map, world.taken, replies));
        replies.push({ id: more, parent: prev, text, createdAt: cc.value, by: ca.by });
        prev = more;
      }
    }

    // 1 メモ 300 枚：rank の後ろの一番上のカード（と、その下）から落とす
    let kept = replies;
    if (kept.length > IX_LIMITS.cards) {
      const order = kept.filter((r) => r.parent === null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      const under = (topId: string) => {
        const out = new Set([topId]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const r of kept) {
            if (r.parent !== null && out.has(r.parent) && !out.has(r.id)) {
              out.add(r.id);
              grew = true;
            }
          }
        }
        return out;
      };
      while (kept.length > IX_LIMITS.cards && order.length > 0) {
        const last = order.pop() as Reply;
        const doomed = under(last.id);
        memoProblems.add('cardsOver', doomed.size);
        for (const r of kept) if (doomed.has(r.id)) xDropped.push({ where: `memos[${m.index}]`, reason: 'cardsOver', raw: r });
        kept = kept.filter((r) => !doomed.has(r.id));
      }
    }
    // 逆向きの「同じ」の二本目：台帳（parseReplies の最後）と同じ規則を先に当てて数える
    const pruned = pruneLinks(kept);
    const linksBefore = kept.reduce((n, r) => n + (r.links?.length ?? 0), 0);
    const linksAfter = pruned.reduce((n, r) => n + (r.links?.length ?? 0), 0);
    memoProblems.add('sameBack', linksBefore - linksAfter);
    kept = pruned;

    const island = m.island ? (islandOf.get(m.island) ?? null) : null;
    const pos = placed.pos.get(m.key) as Hex;
    const cell: MemoCell = {
      id: memoId,
      sheet: map.sheet.to,
      pos,
      text: split.text,
      tags,
      liked: Math.max(0, Math.min(3, Math.round(Number(m.liked) || 0))),
      island,
      ...(kept.length ? { replies: kept } : {}),
      by: author.by,
      label: author.label,
      createdAt: created.value,
      updatedAt: updated,
    };
    putExtra(xm, 'm', { ...m.keep, ...(count(m.unknown) ? { unknown: m.unknown } : {}), ...(count(m.dropped) ? { dropped: m.dropped } : {}), ...(m.key.startsWith('#') ? {} : { from: m.key }) });
    if (xm.m) xMemos[memoId] = xm.m;
    if (count(cardsX)) xCards[memoId] = cardsX;

    const nCards = kept.length;
    const nBot = kept.filter((r) => r.by?.who === 'bot').length;
    const nLinks = kept.reduce((n, r) => n + (r.links?.length ?? 0), 0);
    rows.push({
      key: m.key,
      id: memoId,
      title: titleOf(split.text),
      island: m.island ? (rowIsland.get(m.island) ?? null) : null,
      pos,
      selected,
      cards: nCards,
      botCards: nBot,
      cardLinks: nLinks,
      tags: tags.length,
      bot: author.by.who === 'bot',
      opinions: m.cards.map((c) => opinionMark(c.keep.x_opinion)).filter((s): s is string => s !== null),
    });
    if (selected) {
      cells.push(cell);
      totalCards += nCards;
      botCards += nBot;
      importCards += nCards - nBot;
      cardLinks += nLinks;
    }
    for (const p of memoProblems.list()) problems.add(p.code, p.count);
  }

  // 盤面の線（m: だけ。両端を選んだものだけ。上限まで）
  const planned: PlannedBoardLink[] = [];
  const memoKeyOf = new Map(doc.memos.map((m) => [m.key, m]));
  const refKey = (ref: unknown): { key: string } | 'tab' | null => {
    if (typeof ref !== 'string') return null;
    if (ref.startsWith('t:')) return 'tab';
    if (!ref.startsWith('m:')) return null;
    const key = ref.slice(2);
    return memoKeyOf.has(key) ? { key } : null;
  };
  let linkRoom = Math.max(0, world.limits.boardLinks - world.counts.boardLinks);
  for (const l of doc.boardLinks) {
    if (!isLinkKind(l.kind)) {
      problems.add('badLinkKind');
      xDropped.push({ where: `boardLinks[${l.index}]`, reason: 'badLinkKind', raw: l.raw });
      continue;
    }
    const a = refKey(l.from);
    const b = refKey(l.to);
    if (a === 'tab' || b === 'tab') {
      problems.add('tabBoardLink');
      xDropped.push({ where: `boardLinks[${l.index}]`, reason: 'tabBoardLink', raw: l.raw });
      continue;
    }
    if (!a || !b) {
      problems.add('danglingBoardLink');
      xDropped.push({ where: `boardLinks[${l.index}]`, reason: 'danglingBoardLink', raw: l.raw });
      continue;
    }
    const from = `m:${map.memos.get(a.key)}`;
    const to = `m:${map.memos.get(b.key)}`;
    const asLinks: BoardLink[] = planned.map((p, i) => ({ id: String(i), from: p.from, to: p.to, kind: p.kind }));
    if (from === to || findDuplicate(asLinks, from, to, l.kind)) {
      problems.add('dupBoardLink');
      xDropped.push({ where: `boardLinks[${l.index}]`, reason: 'dupBoardLink', raw: l.raw });
      continue;
    }
    const sel = selectedKey(a.key) && selectedKey(b.key);
    if (sel && linkRoom <= 0) {
      problems.add('boardLinksOver');
      xDropped.push({ where: `boardLinks[${l.index}]`, reason: 'boardLinksOver', raw: l.raw });
      continue;
    }
    if (sel) linkRoom--;
    planned.push({ from, to, kind: l.kind, fromKey: a.key, toKey: b.key, selected: sel });
  }

  // 上限の判定（§4.1・§4.2）
  const overMemos = Math.max(0, world.counts.memos + cells.length + (choice.portal !== false && world.portal ? 1 : 0) - world.limits.memos);
  let blocked: string | null = null;
  if (world.counts.sheets >= world.limits.sheets) blocked = `シートが多すぎます（${world.limits.sheets} 枚まで）`;
  else if (cells.length === 0) blocked = '取り込むメモを選んでください';
  else if (overMemos > 0) blocked = `メモが多すぎます（全部で ${world.limits.memos} 個まで）。あと ${overMemos} 個外してください`;

  const sheetName = normalizeSheetName(cleanBotLine(doc.sheet.name)) || IMPORT_LABEL;
  const sheetColor = typeof doc.sheet.color === 'string' && COLOR_RE.test(doc.sheet.color) ? doc.sheet.color : world.sheetColor();
  const selectedLinks = planned.filter((p) => p.selected).length;
  const allProblems = mergeProblems(parseProblems, problems.list());

  const buildExtra = (importId: string, sourceKind: string, importedAt: number): InterchangeExtra => {
    const top: Record<string, unknown> = { ...doc.top, ...(count(doc.topUnknown) ? { unknown: doc.topUnknown } : {}) };
    return {
      v: 1,
      importId,
      importedAt,
      source: sourceKind,
      format: INTERCHANGE_FORMAT,
      version: 1,
      ...(doc.generatedAt ? { generatedAt: doc.generatedAt } : {}),
      sheet: {
        to: map.sheet.to,
        from: { ...(doc.sheet.id !== undefined ? { id: doc.sheet.id } : {}), ...(doc.sheet.createdAt !== undefined ? { createdAt: doc.sheet.createdAt } : {}) },
        ...(count(doc.sheet.keep) ? { keep: doc.sheet.keep } : {}),
        ...(count(doc.sheet.unknown) ? { unknown: doc.sheet.unknown } : {}),
      },
      top,
      ids: {
        islands: Object.fromEntries(map.islands),
        memos: Object.fromEntries(map.memos),
        cards: Object.fromEntries([...map.cards].map(([k, v]) => [map.memos.get(k) as string, Object.fromEntries(v)])),
      },
      islands: xIslands,
      memos: xMemos,
      cards: xCards,
      by: xBy,
      dropped: xDropped,
    };
  };

  return {
    map,
    sheet: { id: map.sheet.to, name: sheetName, color: sheetColor },
    islands,
    rows,
    cells,
    portal: choice.portal !== false ? world.portal : null,
    boardLinks: planned,
    problems: allProblems,
    totals: { memos: cells.length, cards: totalCards, botCards, importCards, cardLinks, boardLinks: selectedLinks, islands: islands.filter((i) => i.create).length },
    blocked,
    overMemos,
    buildExtra,
  };
}

// 付け替え表の id が、手元の台帳と重なるか
export function idMapCollides(map: IdMap, taken: ReadonlySet<string>): boolean {
  if (taken.has(map.sheet.to)) return true;
  for (const id of map.islands.values()) if (taken.has(id)) return true;
  for (const id of map.memos.values()) if (taken.has(id)) return true;
  for (const cards of map.cards.values()) for (const id of cards.values()) if (taken.has(id)) return true;
  return false;
}

// 分けて増やすカードの id が、表の id・台帳・そのメモで作ったカードと重ならないように
function usedAll(map: IdMap, taken: ReadonlySet<string>, made: readonly Reply[]): Set<string> {
  const used = new Set(taken);
  used.add(map.sheet.to);
  for (const id of map.islands.values()) used.add(id);
  for (const id of map.memos.values()) used.add(id);
  for (const cards of map.cards.values()) for (const id of cards.values()) used.add(id);
  for (const r of made) used.add(r.id);
  return used;
}

// 取り込みの id（控え・記録・extra のファイル名。提案の ap… と見分ける）
export function newImportId(now = Date.now()): string {
  return `ix${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// 記録の patchId（generatedAt があればそれ、無ければ文の短い印）
export function importPatchId(doc: InterchangeDoc, text: string): string {
  if (doc.generatedAt) return `ix:${doc.generatedAt}`.slice(0, 80);
  return `ix:${shortHash(text)}`;
}

// 文の短い印（FNV-1a 32bit。UI 側にハッシュの関数が無いので置く。暗号ではない）
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
