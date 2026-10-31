// コメントカードの「型」（カードと関連の組み合わせの雛形）の計算（計画書 docs/plan-card-templates.md の Phase 1a）
//   ・ここは DOM も保存も使わない（node だけで試せる。ui/test/memo-card-templates.test.ts）。保存は Phase 1b、貼り付けの書き込みは Phase 1c
//   ・対象はコメントカード（Reply）の一番上のカードだけ。Grok Cards の札は対象外（機械のタグ〈宛て:・送った:・貼った:〉は型に入れない）
//   ・型には関連の種類の id だけを入れる（画面の名前は貼った先のメモの呼称で決まる）
//   ・両端が選んだカードの中にある関連だけを入れる（外へ出る関連は数だけ数える。memo-card-send.ts の linkTravel と同じ数え方）
//   ・貼る位置は「最後に置いてある番地の次」。下書きに rank は持たせない（threads.ts の topSlots が、rank の無いカードを最後の次から作った順に並べる）
//   ・今のモードは snapshot だけ（skeleton・hole は Phase 3）
import { isMachineTag } from './grok-cards-tags';
import { isLinkKind, type LinkKind, MAX_LINKS_PER_CARD, cardLabel, pruneLinks, type ReplyLink } from './memo-card-links';
import { linkTravel } from './memo-card-send';
import { MAX_TAGS_PER_TAB, normalizeTag } from './tags';
import { CARD_COLUMNS, cleanReplyText, descendantsOf, MAX_REPLIES, MAX_REPLY_TEXT, newReplyId, orderedTops, replyIdProblem, topSlots, type Reply } from './threads';

export const TEMPLATE_VERSION = 1;

export const TEMPLATE_LIMITS = {
  cards: 30, // 1 つの型のカードの数
  templates: 200, // 1 つのファイルの型の数
  name: 40, // 型の名前の字数
  text: MAX_REPLY_TEXT, // 貼ったあとの 1 枚の文の字数
  coord: 10_000, // dx・dy の範囲（±）
} as const;

export const TEMPLATE_FOLDERS = ['議論', '調査', '計画', 'その他'] as const;
export type TemplateFolder = (typeof TEMPLATE_FOLDERS)[number];

// モード：スナップショット（文ごとそのまま）／骨組み（各カードの題の 1 行だけ。本文は持たない）／穴あき（本文を {{空欄}} にして、貼るときに値を入れる）
export const TEMPLATE_MODES = ['snapshot', 'skeleton', 'hole'] as const;
export type TemplateMode = (typeof TEMPLATE_MODES)[number];

export const MODE_LABELS: Readonly<Record<TemplateMode, string>> = { snapshot: 'そのまま', skeleton: '骨組み', hole: '穴あき' };

export function normalizeMode(raw: unknown): TemplateMode {
  return TEMPLATE_MODES.find((m) => m === raw) ?? 'snapshot';
}

// 穴あきの空欄 {{名前}}：名前は 1〜30 字（波かっこ・改行なし。前後の空白は取る）。登録のとき、本文の無い（空欄の無い）カードに入れる共通の空欄名
export const HOLE_COMMON = 'テーマ';
const HOLE_PATTERN = '\\{\\{([^{}\\r\\n]{1,30})\\}\\}';

// dx・dy を作るときの目安の大きさ（サムネイル用。貼る位置には使わない）
export const TEMPLATE_GRID = { cardW: 190, cardH: 96, gap: 20 } as const;

export interface TemplateCard {
  key: string; // 型の中だけで通じる印（k0, k1…）。貼るときに新しい Reply.id になる
  title: string; // 文の 1 行目
  body: string; // 2 行目以降（先頭の改行を残す）
  tags: string[];
  dx: number;
  dy: number;
}

export interface TemplateLink {
  from: string; // 関連を持つ側（元）の key
  to: string; // 相手の key
  kind: LinkKind;
}

export interface CardTemplate {
  version: 1;
  id: string;
  name: string;
  folder: TemplateFolder;
  mode: TemplateMode;
  createdAt?: number;
  cards: TemplateCard[];
  links: TemplateLink[];
}

export interface TemplateFile {
  version: 1;
  templates: CardTemplate[];
}

export type SkipReason = 'shape' | 'version' | 'mode' | 'name' | 'no-cards' | 'too-many-cards' | 'text' | 'limit';

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
// 見えない制御文字・向きを変える文字・ゼロ幅の文字（名前に入れない）
const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export const newTemplateId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------- 小さな整え ----------

// 型の名前：見えない文字を除き、空白の連なりを 1 つにし、40 字まで。空なら ''
export function cleanTemplateName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(HIDDEN_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, TEMPLATE_LIMITS.name).join('').trim();
}

export function normalizeFolder(raw: unknown): TemplateFolder {
  return TEMPLATE_FOLDERS.find((f) => f === raw) ?? 'その他';
}

// カードのタグ：normalizeTag を通し、機械のタグ（宛て:・送った:・貼った:）を除き、重複を除いて 10 個まで
export function cleanCardTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const tag = normalizeTag(value);
    if (!tag || isMachineTag(tag) || out.includes(tag)) continue;
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_TAB) break;
  }
  return out;
}

// 題と本文から、貼る文を作る（cleanReplyText で 2,000 字まで・前後の空白を取る）
export function composeText(title: string, body: string): string {
  return cleanReplyText(body ? `${title}\n${body}` : title);
}

// 文を題（1 行目）と本文（残り。先頭の改行を残す）に分ける。composeText で元の文に戻る
export function splitText(text: string): { title: string; body: string } {
  const i = text.indexOf('\n');
  return i < 0 ? { title: text, body: '' } : { title: text.slice(0, i), body: text.slice(i + 1) };
}

const coord = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(-TEMPLATE_LIMITS.coord, Math.min(TEMPLATE_LIMITS.coord, Math.round(value))) || 0 : 0);

// ---------- 関連の整理（登録・読み込みの両方で使う） ----------

// 型の関連を整える：両端が keys の中・自分自身でない・種類が正しい・同じ相手の 2 本目でない・1 枚から 10 本まで・逆向きの「同じ」の二本目は捨てる（pruneLinks と同じ決まり）
function cleanTemplateLinks(keys: readonly string[], raw: readonly unknown[]): TemplateLink[] {
  const known = new Set(keys);
  const perFrom = new Map<string, ReplyLink[]>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const v = item as Record<string, unknown>;
    if (typeof v.from !== 'string' || typeof v.to !== 'string' || !known.has(v.from) || !known.has(v.to) || v.from === v.to || !isLinkKind(v.kind)) continue;
    const list = perFrom.get(v.from) ?? [];
    if (list.length >= MAX_LINKS_PER_CARD || list.some((l) => l.to === v.to)) continue;
    list.push({ to: v.to, kind: v.kind });
    perFrom.set(v.from, list);
  }
  // 逆向きの「同じ」は pruneLinks に任せる（作った順＝カードの並びの順で、後ろのカードの一本を捨てる）
  const pseudo: Reply[] = keys.map((key, i) => ({ id: key, parent: null, text: key, createdAt: i, ...(perFrom.has(key) ? { links: perFrom.get(key) } : {}) }));
  const out: TemplateLink[] = [];
  for (const r of pruneLinks(pseudo)) for (const l of r.links ?? []) out.push({ from: r.id, to: l.to, kind: l.kind });
  return out;
}

// ---------- 選んだカードから型を作る（登録） ----------

export interface TemplateReport {
  cards: number;
  links: number; // 型に入った関連の数
  cutLinks: number; // 選んだカードと外のカードのあいだの関連（型には入らない）
  skipped: {
    children: number; // 下の返信（💬）
    images: number;
    quotes: number;
    machineTags: number; // 宛て:・送った:・貼った:
  };
  holes?: number; // 穴あきのときだけ：空欄の数
}

export type BuildTemplateResult =
  | { ok: true; template: CardTemplate; report: TemplateReport }
  | { ok: false; why: 'empty' | 'missing' | 'too-many' | 'name' | 'text'; max?: number };

// 返信のならび replies から、一番上のカード ids を型にする（replies と中身は変えない）
//   カードの並びは orderedTops の順。dx・dy は番地（topSlots。3 列）から：選んだ中でいちばん左の列・いちばん上の行を 0 にする
//   input.offsets（ボードで選んだとき。B3-1）：カードの id ごとの dx・dy（ボードの座標の差）。選んだ全部に付いているときだけ使い、1 枚でも欠けていれば番地から作る
//   文が空のカード（引用か画像だけ）は、題（cardLabel）だけの文にする
export function buildTemplateFromCards(
  replies: readonly Reply[],
  ids: readonly string[],
  input: { name: unknown; folder?: unknown; mode?: unknown; newId?: () => string; now?: number; offsets?: Readonly<Record<string, { dx: number; dy: number }>> },
): BuildTemplateResult {
  const wanted = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
  if (wanted.length === 0) return { ok: false, why: 'empty' };
  const tops = orderedTops(replies);
  const topIds = new Set(tops.map((r) => r.id));
  if (wanted.some((id) => !topIds.has(id))) return { ok: false, why: 'missing' };
  if (wanted.length > TEMPLATE_LIMITS.cards) return { ok: false, why: 'too-many', max: TEMPLATE_LIMITS.cards };
  const name = cleanTemplateName(input.name);
  if (!name) return { ok: false, why: 'name' };

  const sending = tops.filter((r) => wanted.includes(r.id));
  const slots = topSlots(replies);
  const cols = sending.map((r) => (slots.get(r.id) ?? 0) % CARD_COLUMNS);
  const rows = sending.map((r) => Math.floor((slots.get(r.id) ?? 0) / CARD_COLUMNS));
  const minCol = Math.min(...cols);
  const minRow = Math.min(...rows);
  const keyOf = new Map(sending.map((r, i) => [r.id, `k${i}`]));
  const offsets = input.offsets && sending.every((r) => input.offsets?.[r.id] !== undefined) ? input.offsets : null;

  const skipped = { children: 0, images: 0, quotes: 0, machineTags: 0 };
  const cards: TemplateCard[] = [];
  for (const [i, reply] of sending.entries()) {
    const text = cleanReplyText(reply.text.trim() ? reply.text : cardLabel(reply, 80));
    if (!text) return { ok: false, why: 'text' };
    const { title, body } = splitText(text);
    const rawTags = reply.tags ?? [];
    skipped.machineTags += rawTags.filter((t) => isMachineTag(normalizeTag(t))).length;
    if (reply.image) skipped.images += 1;
    if (reply.quote) skipped.quotes += 1;
    skipped.children += descendantsOf(replies, reply.id).length;
    cards.push({
      key: `k${i}`,
      title,
      body,
      tags: cleanCardTags(rawTags),
      dx: offsets ? coord(offsets[reply.id].dx) : (cols[i] - minCol) * (TEMPLATE_GRID.cardW + TEMPLATE_GRID.gap),
      dy: offsets ? coord(offsets[reply.id].dy) : (rows[i] - minRow) * (TEMPLATE_GRID.cardH + TEMPLATE_GRID.gap),
    });
  }

  const inside: TemplateLink[] = [];
  for (const reply of sending) {
    for (const link of reply.links ?? []) {
      const to = keyOf.get(link.to);
      const from = keyOf.get(reply.id);
      if (to && from) inside.push({ from, to, kind: link.kind });
    }
  }
  const links = cleanTemplateLinks(cards.map((c) => c.key), inside);
  const mode = normalizeMode(input.mode);
  if (mode === 'skeleton') for (const c of cards) c.body = ''; // 骨組み：題の 1 行だけ（空の文は作れないので、題は必ず残る）
  else if (mode === 'hole') holeify(cards);
  const template: CardTemplate = {
    version: TEMPLATE_VERSION,
    id: input.newId ? input.newId() : newTemplateId(),
    name,
    folder: normalizeFolder(input.folder),
    mode,
    createdAt: input.now ?? Date.now(),
    cards,
    links,
  };
  return {
    ok: true,
    template,
    report: { cards: cards.length, links: links.length, cutLinks: linkTravel(replies, wanted).cut, skipped, ...(mode === 'hole' ? { holes: extractHoles(template).length } : {}) },
  };
}

// ---------- 読み込み・検証 ----------

export type ParseTemplateResult = { ok: true; template: CardTemplate } | { ok: false; why: SkipReason };

// 型を 1 件読む（形の崩れたものは理由つきで断る）。renewId が true か、id が使えない形なら、新しい id にする
//   keys は k0, k1… に付け直す（同じ key が 2 つあれば、関連は先のカードを指す）。不明な項目は読まない
export function parseTemplate(raw: unknown, opts: { newId?: () => string; renewId?: boolean } = {}): ParseTemplateResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, why: 'shape' };
  const v = raw as Record<string, unknown>;
  if (v.version !== undefined && v.version !== TEMPLATE_VERSION) return { ok: false, why: 'version' };
  if (v.mode !== undefined && !TEMPLATE_MODES.some((m) => m === v.mode)) return { ok: false, why: 'mode' };
  const mode = normalizeMode(v.mode);
  const name = cleanTemplateName(v.name);
  if (!name) return { ok: false, why: 'name' };
  if (!Array.isArray(v.cards) || v.cards.length === 0) return { ok: false, why: 'no-cards' };
  if (v.cards.length > TEMPLATE_LIMITS.cards) return { ok: false, why: 'too-many-cards' };

  const make = opts.newId ?? newTemplateId;
  const keyMap = new Map<string, string>();
  const cards: TemplateCard[] = [];
  for (const [i, item] of v.cards.entries()) {
    if (typeof item !== 'object' || item === null) return { ok: false, why: 'shape' };
    const c = item as Record<string, unknown>;
    const text = composeText(typeof c.title === 'string' ? c.title : '', mode !== 'skeleton' && typeof c.body === 'string' ? c.body : ''); // 骨組みは、本文があっても読まない
    if (!text) return { ok: false, why: 'text' };
    const { title, body } = splitText(text);
    const key = `k${i}`;
    if (typeof c.key === 'string' && c.key && !keyMap.has(c.key)) keyMap.set(c.key, key);
    cards.push({ key, title, body, tags: cleanCardTags(c.tags), dx: coord(c.dx), dy: coord(c.dy) });
  }
  const rawLinks = Array.isArray(v.links) ? v.links : [];
  const renamed = rawLinks.map((item) => {
    if (typeof item !== 'object' || item === null) return null;
    const l = item as Record<string, unknown>;
    return { from: typeof l.from === 'string' ? keyMap.get(l.from) : undefined, to: typeof l.to === 'string' ? keyMap.get(l.to) : undefined, kind: l.kind };
  });
  const links = cleanTemplateLinks(cards.map((c) => c.key), renamed);
  const id = !opts.renewId && typeof v.id === 'string' && ID_RE.test(v.id) ? v.id : make();
  const createdAt = typeof v.createdAt === 'number' && Number.isFinite(v.createdAt) && v.createdAt >= 0 ? v.createdAt : undefined;
  return {
    ok: true,
    template: { version: TEMPLATE_VERSION, id, name, folder: normalizeFolder(v.folder), mode, ...(createdAt !== undefined ? { createdAt } : {}), cards, links },
  };
}

export type ParseTemplateFileResult =
  | { ok: true; templates: CardTemplate[]; skipped: { index: number; why: SkipReason }[] }
  | { ok: false; why: 'shape' | 'version' };

// 型のファイル {version:1, templates:[…]} を読む。版が 1 でなければ読まない（呼ぶ側は、書かずに読み取り専用にする）
//   不正な 1 件は捨てて理由を残す。200 件を超えた分は捨てる。id の重なりは新しい id にする
export function parseTemplateFile(raw: unknown, opts: { newId?: () => string; renewIds?: boolean } = {}): ParseTemplateFileResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, why: 'shape' };
  const f = raw as Record<string, unknown>;
  if (f.version !== TEMPLATE_VERSION) return { ok: false, why: 'version' };
  if (!Array.isArray(f.templates)) return { ok: false, why: 'shape' };
  const make = opts.newId ?? newTemplateId;
  const templates: CardTemplate[] = [];
  const skipped: { index: number; why: SkipReason }[] = [];
  const used = new Set<string>();
  for (const [index, item] of f.templates.entries()) {
    if (templates.length >= TEMPLATE_LIMITS.templates) {
      skipped.push({ index, why: 'limit' });
      continue;
    }
    const done = parseTemplate(item, { newId: make, renewId: opts.renewIds });
    if (!done.ok) {
      skipped.push({ index, why: done.why });
      continue;
    }
    let id = done.template.id;
    for (let guard = 0; used.has(id) && guard < 40; guard++) id = make();
    if (used.has(id)) {
      skipped.push({ index, why: 'shape' });
      continue;
    }
    used.add(id);
    templates.push(id === done.template.id ? done.template : { ...done.template, id });
  }
  return { ok: true, templates, skipped };
}

export function toTemplateFile(templates: readonly CardTemplate[]): TemplateFile {
  return { version: TEMPLATE_VERSION, templates: templates.map((t) => structuredClone(t)) };
}

// 型を足す。200 件に達している・同じ id がすでにあるときは null（元の並びは変えない）
export function addTemplate(list: readonly CardTemplate[], template: CardTemplate): CardTemplate[] | null {
  if (list.length >= TEMPLATE_LIMITS.templates || list.some((t) => t.id === template.id)) return null;
  return [...list, template];
}

// ---------- 型から貼る下書きを作る ----------

export type PasteDraftResult =
  | { ok: true; replies: Reply[]; newTopIds: string[]; added: number }
  | { ok: false; why: 'invalid' | 'full'; room?: number; need?: number };

// 型から、貼る下書き（一番上のカードの Reply の並び）を作る。型と existing の中身は変えない
//   ・id は newId ?? newReplyId（memo-card-send.ts の sendCards と同じ作法）。existing の id・下書きの中の id と重ならない
//   ・作った時刻は existing の最新より後で、型の順に 1 ずつ増える。rank は持たせない（貼ると、最後に置いてある番地の次に並ぶ）
//   ・関連は型の中のものだけ（新しい id に付け替え、pruneLinks を通す）。タグは機械のタグを除く
//   ・existing と合わせて 300（MAX_REPLIES）を超えるなら、全体を断る
export function buildPasteDraft(template: CardTemplate, opts: { existing?: readonly Reply[]; newId?: () => string; now?: number } = {}): PasteDraftResult {
  const checked = parseTemplate(template);
  if (!checked.ok) return { ok: false, why: 'invalid' };
  const t = checked.template;
  const existing = opts.existing ?? [];
  const need = t.cards.length;
  const room = MAX_REPLIES - existing.length;
  if (need > room) return { ok: false, why: 'full', room: Math.max(0, room), need };

  const used = new Set(existing.map((r) => r.id));
  const make = opts.newId ?? newReplyId;
  const idOf = new Map<string, string>();
  for (const card of t.cards) {
    let id = make();
    let guard = 0;
    while (used.has(id)) {
      guard += 1;
      id = guard > 8 ? `${make()}${guard.toString(36)}` : make();
      if (guard > 40) break;
    }
    used.add(id);
    idOf.set(card.key, id);
  }
  const latest = existing.reduce((max, r) => Math.max(max, r.createdAt), 0);
  const base = Math.max(opts.now ?? Date.now(), latest + 1);
  const linksOf = new Map<string, ReplyLink[]>();
  for (const link of t.links) {
    const from = idOf.get(link.from);
    const to = idOf.get(link.to);
    if (!from || !to) continue;
    linksOf.set(from, [...(linksOf.get(from) ?? []), { to, kind: link.kind }]);
  }
  const draft: Reply[] = t.cards.map((card, i) => {
    const id = idOf.get(card.key) as string;
    const links = linksOf.get(id);
    return {
      id,
      parent: null,
      text: composeText(card.title, card.body),
      createdAt: base + i,
      ...(card.tags.length > 0 ? { tags: [...card.tags] } : {}),
      ...(links && links.length > 0 ? { links } : {}),
    };
  });
  const replies = pruneLinks(draft);
  return { ok: true, replies, newTopIds: replies.map((r) => r.id), added: need };
}

// 型を貼るときに呼び出し側が決める id（sendReplies の ids。B3-2a）が使えない理由。使える（null）条件：
//   配列で、型の上限（30 枚）以内、貼る枚数（count）と同じ長さ、すべて REPLY_ID_RE の形、指定の中で重ならず、貼り先の台帳にもまだ無い。
//   順に調べるので、上限を超える指定は count の食い違いより先に limit になる。何も書かない側の検査（純関数）
export type PasteIdsProblem = 'form' | 'limit' | 'count' | 'dup' | 'taken';
export function pasteIdsProblem(existing: readonly Reply[], ids: unknown, count: number): PasteIdsProblem | null {
  if (!Array.isArray(ids)) return 'form';
  if (ids.length > TEMPLATE_LIMITS.cards) return 'limit';
  if (ids.length !== count) return 'count';
  const seen = new Set<string>();
  for (const id of ids) {
    if (replyIdProblem([], id) !== null) return 'form';
    if (seen.has(id as string)) return 'dup';
    seen.add(id as string);
  }
  for (const id of ids) if (replyIdProblem(existing, id) !== null) return 'taken';
  return null;
}

// ---------- 穴あき（空欄の抽出・登録・埋める） ----------

const holeRe = () => new RegExp(HOLE_PATTERN, 'g');

// 文の中の空欄の名前（出てきた順・重なりなし）
export function holeNames(texts: readonly string[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(holeRe())) {
      const name = m[1].trim();
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

// 型の空欄の名前（カードの順に、題・本文の順）
export function extractHoles(template: Pick<CardTemplate, 'cards'>): string[] {
  return holeNames(template.cards.flatMap((c) => [c.title, c.body]));
}

// 登録のとき穴あきにする：本文に空欄があるカードは、そのまま（既存の {{…}} は空欄として扱う）。無いカードの本文は「{{テーマ}}：{{題}}」にする（題の空欄名は、重ならない名前にする）
function holeify(cards: TemplateCard[]) {
  const used = new Set<string>([HOLE_COMMON, ...holeNames(cards.flatMap((c) => [c.title, c.body]))]);
  for (const card of cards) {
    if (holeNames([card.body]).length > 0) continue;
    const base = [...card.title.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()].slice(0, 20).join('') || '本文';
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}（${n}）`;
    used.add(name);
    card.body = `{{${HOLE_COMMON}}}：{{${name}}}`;
  }
}

export interface FillResult {
  template: CardTemplate; // 埋めたあとの型（mode は snapshot。貼る道は、ふつうの型と同じ）
  filled: number; // 値を入れた空欄の数
  empty: number; // 空のまま（{{…}} のまま貼る）空欄の数
  truncated: number; // 埋めたあと 2,000 字を超えて切ったカードの数
}

// 空欄を値で埋める。値は文字として入れる（HTML にしない・{{…}} のように見える値も、もう一度は埋めない）。
//   空の値の空欄は {{名前}} のまま。題（1 行目）に入れる値は 1 行にする。制御文字は除く。埋めたあと 2,000 字を超える分は切る
export function fillTemplate(template: CardTemplate, values: Readonly<Record<string, string>>): FillResult {
  const value = (name: string): string | null => {
    const raw = values[name];
    if (typeof raw !== 'string') return null;
    // eslint-disable-next-line no-control-regex
    const v = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    return v === '' ? null : v;
  };
  const names = extractHoles(template);
  const filledNames = new Set<string>();
  const sub = (text: string, oneLine: boolean) =>
    text.replace(holeRe(), (whole: string, raw: string) => {
      const name = raw.trim();
      const v = name ? value(name) : null;
      if (v === null) return whole;
      filledNames.add(name);
      return oneLine ? v.replace(/\s*\n\s*/g, ' ') : v;
    });
  let truncated = 0;
  const cards = template.cards.map((c) => {
    const title = sub(c.title, true);
    const body = sub(c.body, false);
    const raw = (body ? `${title}\n${body}` : title).replace(/\r\n?/g, '\n');
    if ([...raw].length > MAX_REPLY_TEXT) truncated += 1;
    const text = composeText(title, body) || composeText(c.title, '');
    return { ...c, ...splitText(text), tags: [...c.tags] };
  });
  return { template: { ...template, mode: 'snapshot', cards, links: template.links.map((l) => ({ ...l })) }, filled: filledNames.size, empty: names.length - filledNames.size, truncated };
}
