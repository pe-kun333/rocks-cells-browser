// Grok の提案（patch.v1）：Grok Bot が書いた「足す・変える」の指示を確かめ、一覧（前 → 後）にし、当て、戻す
//   ・決まりの文：docs/grok-patch-format.md（試しのフォルダ）
//   ・消す・閉じる指示は無い（外せるのはタグだけ）。知らない op・形の崩れた op は捨てて、一覧の下に数だけ出す
//   ・相手は変わらない id で探す：タブは uid（無ければ url で、1 つだけ見つかったとき）・メモのセルは id・カードはメモの id ＋ カードの id・島は id
//   ・basedOn（書き出した時刻）より後に変わったメモ・カードには「書き出したあとに変わっています」の印（当てるかは使う人が決める）
//   ・当てた一つ一つに「戻し方」と「当てた直後の様子（指紋）」を残す。戻すときに指紋が違えば（あとで書き直した）戻さない
//   ・外から来た文は bot-replies.ts と同じく、見えない制御文字を消し、長さを切る。HTML にはしない
//   ・ここは DOM を使わない。読み書きは PatchWorld（呼ぶ側＝左サイドバー）がする
import { type CellRef, isCellRef, memoRef, tabRef } from './board-links';
import { cleanBotLine, cleanBotText, cutChars } from './bot-replies';
import { IMPORT_FILE_BYTES, IMPORT_FILE_LABEL, withinImportBytes } from './import-limits';
import { shortHash } from './memo-interchange';
import { isLinkKind, type LinkKind } from './memo-card-links';
import { TAG_PALETTE, normalizeTag } from './tags';

export const PATCH_LIMITS = {
  fileBytes: IMPORT_FILE_BYTES, // 提案のファイル（UTF-8 のバイト数。3 つの入口と同じ：import-limits.ts）
  ops: 200,
  tagsPerOp: 10,
  members: 50,
  memoChars: 5000,
  cardChars: 20_000,
  noteChars: 5000,
  commentChars: 40, // タブのセルのひとこと（tabs.ts の MAX_TAB_COMMENT）
  nameChars: 20,
  titleChars: 80,
};
const ID_RE = /^[0-9A-Za-z_-]{1,64}$/;

// ---------- 形 ----------

export type PatchTarget = { kind: 'tab'; uid: string; url?: string } | { kind: 'memo'; id: string } | { kind: 'card'; memo: string; id: string };
export type MemberRef = { kind: 'tab'; uid: string; url?: string } | { kind: 'memo'; id: string };

export type PatchOp =
  | { op: 'tags.add' | 'tags.remove'; target: PatchTarget; tags: string[] }
  | { op: 'tab.setComment'; target: Extract<PatchTarget, { kind: 'tab' }>; text: string }
  | { op: 'tab.addNote'; target: Extract<PatchTarget, { kind: 'tab' }>; text: string }
  | { op: 'memo.setTitle' | 'memo.appendText'; target: Extract<PatchTarget, { kind: 'memo' }>; text: string }
  | { op: 'card.add'; memo: string; parent: string | null; text: string; tags: string[] }
  | { op: 'island.create'; name: string; color: string | null; members: MemberRef[] }
  | { op: 'island.rename'; island: string; name: string }
  | { op: 'island.recolor'; island: string; color: string }
  | { op: 'island.addMembers'; island: string; members: MemberRef[] }
  | { op: 'boardLink.add'; from: MemberRef; to: MemberRef; kind: LinkKind }
  | { op: 'cardLink.add'; memo: string; from: string; to: string; kind: LinkKind }
  | { op: 'memo.create'; sheet: string | null; near: MemberRef | null; text: string; tags: string[] };

export interface GrokPatch {
  v: 1;
  type: 'patch';
  id: string; // 提案の名前（無ければ作る）
  title: string;
  note: string;
  basedOn: string | null; // 書き出した時刻（ISO）
  requestId?: string;
  ops: PatchOp[];
}

export type PatchParse = { ok: true; patch: GrokPatch; dropped: { index: number; reason: string }[] } | { ok: false; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? cutChars(cleanBotText(v), max).text : '');
const line = (v: unknown, max: number) => (typeof v === 'string' ? cutChars(cleanBotLine(v), max).text : '');
const id = (v: unknown) => (typeof v === 'string' && ID_RE.test(v) ? v : null);
const url = (v: unknown) => (typeof v === 'string' && /^https?:\/\/\S{1,2040}$/.test(v) ? v : undefined);
function tags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const t = normalizeTag(typeof raw === 'string' ? cleanBotLine(raw) : raw);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= PATCH_LIMITS.tagsPerOp) break;
  }
  return out;
}
function color(v: unknown): string | null {
  if (typeof v === 'number') v = String(v); // 色の番号は数でも文字でもよい
  if (typeof v !== 'string') return null;
  const c = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  const n = Number(c);
  return Number.isInteger(n) && n >= 0 && n < TAG_PALETTE.length ? TAG_PALETTE[n] : null; // 0〜11：色の表の番号
}

function target(v: unknown): PatchTarget | null {
  if (!isRecord(v)) return null;
  if (v.tab !== undefined || v.url !== undefined) {
    const uid = id(v.tab);
    const u = url(v.url);
    if (!uid && !u) return null;
    return { kind: 'tab', uid: uid ?? '', ...(u ? { url: u } : {}) };
  }
  if (v.memo !== undefined) {
    const m = id(v.memo);
    return m ? { kind: 'memo', id: m } : null;
  }
  if (isRecord(v.card)) {
    const m = id(v.card.memo);
    const c = id(v.card.id);
    return m && c ? { kind: 'card', memo: m, id: c } : null;
  }
  return null;
}
function member(v: unknown): MemberRef | null {
  const t = target(v);
  return t && t.kind !== 'card' ? t : null;
}
function members(v: unknown): MemberRef[] {
  if (!Array.isArray(v)) return [];
  return v.map(member).filter((m): m is MemberRef => !!m).slice(0, PATCH_LIMITS.members);
}

// 一つの op を読む（読めなければ理由の文字）
export function parseOp(raw: unknown): PatchOp | string {
  if (!isRecord(raw) || typeof raw.op !== 'string') return 'notOp';
  switch (raw.op) {
    case 'tags.add':
    case 'tags.remove': {
      const t = target(raw.target);
      const list = tags(raw.tags);
      if (!t) return 'badTarget';
      if (list.length === 0) return 'noTags';
      return { op: raw.op, target: t, tags: list };
    }
    case 'tab.setComment':
    case 'tab.addNote': {
      const t = target(raw.target);
      if (!t || t.kind !== 'tab') return 'badTarget';
      const body = raw.op === 'tab.setComment' ? line(raw.text, PATCH_LIMITS.commentChars) : text(raw.text, PATCH_LIMITS.noteChars);
      if (!body) return 'noText'; // ひとことを空にする（消す）指示は受けない
      return { op: raw.op, target: t, text: body };
    }
    case 'memo.setTitle':
    case 'memo.appendText': {
      const t = target(raw.target);
      if (!t || t.kind !== 'memo') return 'badTarget';
      const body = raw.op === 'memo.setTitle' ? line(raw.text, PATCH_LIMITS.titleChars) : text(raw.text, PATCH_LIMITS.memoChars);
      if (!body) return 'noText';
      return { op: raw.op, target: t, text: body };
    }
    case 'card.add': {
      const m = id(raw.memo);
      const body = text(raw.text, PATCH_LIMITS.cardChars);
      if (!m) return 'badTarget';
      if (!body) return 'noText';
      const parent = raw.parent === undefined || raw.parent === null ? null : id(raw.parent);
      if (raw.parent !== undefined && raw.parent !== null && !parent) return 'badParent';
      return { op: 'card.add', memo: m, parent, text: body, tags: parent === null ? tags(raw.tags) : [] };
    }
    case 'island.create': {
      const name = line(raw.name, PATCH_LIMITS.nameChars);
      const list = members(raw.members);
      if (!name) return 'noName';
      if (list.length === 0) return 'noMembers';
      return { op: 'island.create', name, color: color(raw.color), members: list };
    }
    case 'island.rename': {
      const i = id(raw.island);
      const name = line(raw.name, PATCH_LIMITS.nameChars);
      if (!i) return 'badTarget';
      if (!name) return 'noName';
      return { op: 'island.rename', island: i, name };
    }
    case 'island.recolor': {
      const i = id(raw.island);
      const c = color(raw.color);
      if (!i) return 'badTarget';
      if (!c) return 'badColor';
      return { op: 'island.recolor', island: i, color: c };
    }
    case 'island.addMembers': {
      const i = id(raw.island);
      const list = members(raw.members);
      if (!i) return 'badTarget';
      if (list.length === 0) return 'noMembers';
      return { op: 'island.addMembers', island: i, members: list };
    }
    case 'boardLink.add': {
      const from = member(raw.from);
      const to = member(raw.to);
      if (!from || !to) return 'badTarget';
      if (!isLinkKind(raw.kind)) return 'badKind';
      return { op: 'boardLink.add', from, to, kind: raw.kind };
    }
    case 'cardLink.add': {
      const m = id(raw.memo);
      const from = id(raw.from);
      const to = id(raw.to);
      if (!m || !from || !to) return 'badTarget';
      if (!isLinkKind(raw.kind)) return 'badKind';
      return { op: 'cardLink.add', memo: m, from, to, kind: raw.kind };
    }
    case 'memo.create': {
      const body = text(raw.text, PATCH_LIMITS.memoChars);
      if (!body) return 'noText';
      const sheet = raw.sheet === undefined || raw.sheet === null ? null : id(raw.sheet);
      return { op: 'memo.create', sheet, near: member(raw.near), text: body, tags: tags(raw.tags) };
    }
    default:
      return 'unknownOp'; // 消す・閉じる op は、もとから無い
  }
}

export function parsePatch(raw: unknown): PatchParse {
  if (!isRecord(raw)) return { ok: false, reason: 'notObject' };
  if (raw.type !== 'patch') return { ok: false, reason: 'notPatch' };
  if (raw.v !== 1) return { ok: false, reason: 'badVersion' };
  if (!Array.isArray(raw.ops)) return { ok: false, reason: 'noOps' };
  if (raw.ops.length > PATCH_LIMITS.ops) return { ok: false, reason: 'tooManyOps' };
  const ops: PatchOp[] = [];
  const dropped: { index: number; reason: string }[] = [];
  raw.ops.forEach((o, index) => {
    const parsed = parseOp(o);
    if (typeof parsed === 'string') dropped.push({ index, reason: parsed });
    else ops.push(parsed);
  });
  if (ops.length === 0) return { ok: false, reason: dropped.length > 0 ? 'noUsableOps' : 'noOps' };
  const basedOn = typeof raw.basedOn === 'string' && !Number.isNaN(Date.parse(raw.basedOn)) ? new Date(raw.basedOn).toISOString() : null;
  return {
    ok: true,
    patch: {
      v: 1,
      type: 'patch',
      id: id(raw.id) ?? `p${Date.now().toString(36)}`,
      title: line(raw.title, 60) || 'Grok の提案',
      note: text(raw.note, 1000),
      basedOn,
      ...(typeof raw.requestId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.requestId) ? { requestId: raw.requestId } : {}),
      ops,
    },
    dropped,
  };
}

// JSON の文から（大きすぎ・壊れていれば理由）
export function parsePatchText(source: string): PatchParse {
  if (!withinImportBytes(source)) return { ok: false, reason: 'tooBig' };
  let raw: unknown;
  try {
    raw = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch {
    return { ok: false, reason: 'badJson' };
  }
  return parsePatch(raw);
}

export const PATCH_REASON_TEXT: Record<string, string> = {
  notObject: 'JSON の形が違います',
  notPatch: 'type が "patch" ではありません',
  badVersion: 'v が 1 ではありません',
  noOps: 'ops がありません',
  tooManyOps: `ops が多すぎます（${PATCH_LIMITS.ops} 件まで）`,
  noUsableOps: '使える ops がありません',
  tooBig: `ファイルが大きすぎます（${IMPORT_FILE_LABEL} まで）`,
  badJson: 'JSON として読めません',
  notOp: 'op がありません',
  badTarget: '相手（target）の形が違います',
  noTags: 'タグがありません',
  noText: '文がありません',
  badParent: 'parent の形が違います',
  noName: '名前がありません',
  noMembers: '入れるセルがありません',
  badColor: '色の形が違います',
  badKind: '関連の種類が違います',
  unknownOp: '知らない op です（消す・閉じるはできません）',
};

// ---------- 盤面とのやりとり（呼ぶ側が作る） ----------

export interface WorldTab {
  id: number;
  uid: string;
  sheet: string;
  title: string;
  url: string;
  tags: string[];
  comment?: string;
  island: string | null;
  notes: { id: string; text: string }[];
}
export interface WorldCard {
  id: string;
  parent: string | null;
  text: string;
  tags?: string[];
  links?: { to: string; kind: string }[];
  createdAt: number;
  editedAt?: number;
}
export interface WorldMemo {
  id: string;
  sheet: string;
  text: string;
  tags: string[];
  island: string | null;
  special: boolean; // 入口・ボット・アプリ・撮ったもの（カード・タイトルは持たない）
  updatedAt: number;
  replies: WorldCard[];
}

export interface PatchWorld {
  tabByUid(uid: string): WorldTab | undefined;
  tabsByUrl(url: string): WorldTab[];
  memo(id: string): WorldMemo | undefined;
  island(id: string): { id: string; name: string; color: string } | undefined;
  islandCount(): number;
  nextIslandColor(): string; // 色の指定が無い島に使う色（見本と当てるときで同じ色にする）
  hasBoardLink(from: CellRef, to: CellRef, kind: LinkKind): string | null; // あれば、その線の id
  boardLinkExists(id: string): boolean;
  sheetName(id: string): string | null;
  currentSheet(): string;
  refTitle(ref: CellRef): string;
  // 書く（できなければ null・false）
  setTabTags(id: number, tags: string[]): void;
  setTabComment(id: number, text: string): void;
  addTabNote(id: number, text: string): string | null;
  removeTabNote(id: number, noteId: string): void;
  setMemoTags(id: string, tags: string[]): void;
  setMemoText(id: string, text: string): void;
  setCardTags(memo: string, card: string, tags: string[]): boolean;
  addCard(memo: string, parent: string | null, text: string): string | null;
  removeCard(memo: string, card: string): void;
  addCardLink(memo: string, from: string, to: string, kind: LinkKind): boolean;
  removeCardLink(memo: string, from: string, to: string): void;
  addIsland(name: string, color: string | null): string | null;
  removeIsland(id: string): void;
  setIslandName(id: string, name: string): void;
  setIslandColor(id: string, color: string): void;
  setIsland(refs: CellRef[], island: string | null): void;
  islandOf(ref: CellRef): string | null;
  addBoardLink(from: CellRef, to: CellRef, kind: LinkKind): string | null;
  removeBoardLink(id: string): void;
  createMemo(sheet: string, near: CellRef | null, text: string, tags: string[]): string | null;
  removeMemo(id: string): void;
  kindName(kind: LinkKind): string;
  // 取り込み（importSheet）：指紋のもとと、消すこと（sheet：シートごと・imported：取り込んだものだけ）
  importView(u: ImportSheetUndo): ImportView;
  removeImport(u: ImportSheetUndo, mode: 'sheet' | 'imported'): void;
  maxTags: number;
  maxIslands: number;
}

// ---------- 一覧（前 → 後） ----------

export type PlanStatus = 'ok' | 'same' | 'missing' | 'refused';

export interface PlanItem {
  index: number; // patch.ops の何番目
  op: PatchOp;
  what: string; // 何をするか（「タグを足す」など）
  target: string; // どこに（セルの名前）
  before: string;
  after: string;
  status: PlanStatus;
  notes: string[]; // 「URL で見つけました」「書き出したあとに変わっています」など
  changedSince: boolean;
  preview?: { island?: { name: string; color: string; refs: CellRef[] }; link?: { from: CellRef; to: CellRef; kind: LinkKind } };
}

const short = (s: string, n = 40) => {
  const chars = [...s.replace(/\s+/g, ' ').trim()];
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
};
const list = (t: readonly string[]) => (t.length > 0 ? t.map((x) => `#${x}`).join(' ') : '（なし）');

interface Resolved {
  tab?: WorldTab;
  memo?: WorldMemo;
  card?: WorldCard;
  note?: string;
}

function resolveTab(world: PatchWorld, t: { uid: string; url?: string }): Resolved {
  const byUid = t.uid ? world.tabByUid(t.uid) : undefined;
  if (byUid) return { tab: byUid };
  if (t.url) {
    const found = world.tabsByUrl(t.url);
    if (found.length === 1) return { tab: found[0], note: t.uid ? 'uid が合わないので、URL で見つけました' : 'URL で見つけました' };
    if (found.length > 1) return { note: `同じ URL のタブが ${found.length} 個あるので決められません` };
  }
  return {};
}

function resolve(world: PatchWorld, t: PatchTarget): Resolved {
  if (t.kind === 'tab') return resolveTab(world, t);
  const memo = world.memo(t.kind === 'memo' ? t.id : t.memo);
  if (!memo) return {};
  if (t.kind === 'memo') return { memo };
  const card = memo.replies.find((r) => r.id === t.id);
  return card ? { memo, card } : { memo };
}

export function memberRef(world: PatchWorld, m: MemberRef): { ref: CellRef | null; note?: string } {
  if (m.kind === 'memo') return { ref: world.memo(m.id) ? memoRef(m.id) : null };
  const r = resolveTab(world, m);
  return { ref: r.tab ? tabRef(r.tab.uid) : null, note: r.note };
}

function targetName(_world: PatchWorld, r: Resolved): string {
  if (r.tab) return `タブ「${short(r.tab.title || r.tab.url, 24)}」`;
  if (r.card && r.memo) return `カード「${short(r.card.text, 24)}」（メモ「${short(r.memo.text.split('\n')[0] ?? '', 16)}」）`;
  if (r.memo) return `メモ「${short(r.memo.text.split('\n')[0] ?? '', 24)}」`;
  return '（見つからない）';
}

export function planPatch(patch: GrokPatch, world: PatchWorld): PlanItem[] {
  const basedOn = patch.basedOn ? Date.parse(patch.basedOn) : null;
  const since = (m?: WorldMemo, c?: WorldCard) => basedOn !== null && ((c ? (c.editedAt ?? c.createdAt) : (m?.updatedAt ?? 0)) > basedOn);
  return patch.ops.map((op, index) => {
    const item: PlanItem = { index, op, what: '', target: '', before: '', after: '', status: 'ok', notes: [], changedSince: false };
    const fail = (status: PlanStatus, note?: string) => {
      item.status = status;
      if (note) item.notes.push(note);
      return item;
    };
    switch (op.op) {
      case 'tags.add':
      case 'tags.remove': {
        const r = resolve(world, op.target);
        item.what = op.op === 'tags.add' ? 'タグを足す' : 'タグを外す';
        item.target = targetName(world, r);
        if (r.note) item.notes.push(r.note);
        const now = r.card ? (r.card.tags ?? []) : r.memo && !r.card && op.target.kind !== 'card' ? r.memo.tags : r.tab?.tags;
        if (!now || (op.target.kind === 'card' && !r.card)) return fail('missing');
        if (r.card && r.card.parent !== null) return fail('refused', 'タグは一番上のカードにだけ付けられます');
        if (r.memo && r.memo.special && !r.card) return fail('refused', '入口・ボット・アプリのセルには付けません');
        item.changedSince = since(r.memo, r.card);
        const next = op.op === 'tags.add' ? [...now, ...op.tags.filter((t) => !now.includes(t))] : now.filter((t) => !op.tags.includes(t));
        if (next.length > world.maxTags) return fail('refused', `タグは 1 つに ${world.maxTags} 個までです`);
        item.before = list(now);
        item.after = list(next);
        if (next.length === now.length && next.every((t, i) => t === now[i])) return fail('same', 'もうそうなっています');
        return item;
      }
      case 'tab.setComment': {
        const r = resolve(world, op.target);
        item.what = 'セルのひとことを変える';
        item.target = targetName(world, r);
        if (r.note) item.notes.push(r.note);
        if (!r.tab) return fail('missing');
        item.before = r.tab.comment || '（なし）';
        item.after = op.text || '（なし）';
        if ((r.tab.comment ?? '') === op.text) return fail('same', 'もうそうなっています');
        return item;
      }
      case 'tab.addNote': {
        const r = resolve(world, op.target);
        item.what = 'タブにメモを足す';
        item.target = targetName(world, r);
        if (r.note) item.notes.push(r.note);
        if (!r.tab) return fail('missing');
        item.before = `メモ ${r.tab.notes.length} 件`;
        item.after = `＋「${short(op.text)}」`;
        return item;
      }
      case 'memo.setTitle':
      case 'memo.appendText': {
        const r = resolve(world, op.target);
        item.what = op.op === 'memo.setTitle' ? 'メモの題（1 行目）を変える' : 'メモに書き足す';
        item.target = targetName(world, r);
        if (!r.memo) return fail('missing');
        if (r.memo.special) return fail('refused', '入口・ボット・アプリのセルの文は変えません');
        item.changedSince = since(r.memo);
        const next = memoTextAfter(r.memo.text, op);
        item.before = op.op === 'memo.setTitle' ? short(r.memo.text.split('\n')[0] ?? '') : `${[...r.memo.text].length} 字`;
        item.after = op.op === 'memo.setTitle' ? short(op.text) : `＋「${short(op.text)}」`;
        if ([...next].length > PATCH_LIMITS.memoChars) return fail('refused', `メモは ${PATCH_LIMITS.memoChars} 字までです`);
        if (next === r.memo.text) return fail('same', 'もうそうなっています');
        return item;
      }
      case 'card.add': {
        const memo = world.memo(op.memo);
        item.what = op.parent ? 'カードに返信を足す' : 'カードを足す';
        item.target = memo ? targetName(world, { memo }) : '（見つからない）';
        if (!memo) return fail('missing');
        if (memo.special) return fail('refused', '入口・ボット・アプリのセルにはカードを足せません');
        if (op.parent && !memo.replies.some((c) => c.id === op.parent)) return fail('missing', '返信先のカードがありません');
        item.before = `カード ${memo.replies.length} 枚`;
        item.after = `＋「${short(op.text)}」（Grok Bot）${op.tags.length ? ` ${list(op.tags)}` : ''}`;
        return item;
      }
      case 'island.create': {
        item.what = '島を作る';
        const refs = op.members.map((m) => memberRef(world, m));
        const found = refs.map((r) => r.ref).filter((r): r is CellRef => !!r);
        for (const n of refs) if (n.note) item.notes.push(n.note);
        item.target = `「${op.name}」（${found.length} セル）`;
        if (found.length === 0) return fail('missing', '入れるセルが見つかりません');
        if (found.length < op.members.length) item.notes.push(`${op.members.length - found.length} セルは見つからないので入れません`);
        if (world.islandCount() >= world.maxIslands) return fail('refused', `島は ${world.maxIslands} 個までです`);
        const moved = found.filter((r) => world.islandOf(r)).length;
        if (moved > 0) item.notes.push(`${moved} セルは今の島から移ります`);
        item.before = '（なし）';
        item.after = `島「${op.name}」${found.map((r) => world.refTitle(r)).slice(0, 4).join('・')}${found.length > 4 ? ' ほか' : ''}`;
        item.preview = { island: { name: op.name, color: op.color ?? world.nextIslandColor(), refs: found } };
        return item;
      }
      case 'island.rename':
      case 'island.recolor': {
        const island = world.island(op.island);
        item.what = op.op === 'island.rename' ? '島の名前を変える' : '島の色を変える';
        item.target = island ? `島「${island.name}」` : '（見つからない島）';
        if (!island) return fail('missing');
        item.before = op.op === 'island.rename' ? island.name : island.color;
        item.after = op.op === 'island.rename' ? op.name : op.color;
        if (item.before === item.after) return fail('same', 'もうそうなっています');
        return item;
      }
      case 'island.addMembers': {
        const island = world.island(op.island);
        item.what = '島にセルを足す';
        item.target = island ? `島「${island.name}」` : '（見つからない島）';
        if (!island) return fail('missing');
        const refs = op.members.map((m) => memberRef(world, m));
        for (const n of refs) if (n.note) item.notes.push(n.note);
        const found = refs.map((r) => r.ref).filter((r): r is CellRef => !!r && world.islandOf(r) !== island.id);
        if (found.length === 0) return fail('same', '足すセルがありません（見つからないか、もう入っています）');
        item.before = '';
        item.after = `＋${found.map((r) => world.refTitle(r)).slice(0, 4).join('・')}${found.length > 4 ? ' ほか' : ''}`;
        item.preview = { island: { name: island.name, color: island.color, refs: found } };
        return item;
      }
      case 'boardLink.add': {
        item.what = '盤面に関連の線を引く';
        const a = memberRef(world, op.from);
        const b = memberRef(world, op.to);
        for (const n of [a, b]) if (n.note) item.notes.push(n.note);
        item.target = `${a.ref ? world.refTitle(a.ref) : '（見つからない）'} → ${b.ref ? world.refTitle(b.ref) : '（見つからない）'}`;
        if (!a.ref || !b.ref) return fail('missing');
        if (a.ref === b.ref) return fail('refused', '同じセルどうしです');
        item.before = '（線なし）';
        item.after = `「${world.kindName(op.kind)}」の線`;
        if (world.hasBoardLink(a.ref, b.ref, op.kind)) return fail('same', 'もう線があります');
        item.preview = { link: { from: a.ref, to: b.ref, kind: op.kind } };
        return item;
      }
      case 'cardLink.add': {
        const memo = world.memo(op.memo);
        item.what = 'カードどうしを関連づける';
        if (!memo) return fail('missing');
        const from = memo.replies.find((c) => c.id === op.from);
        const to = memo.replies.find((c) => c.id === op.to);
        item.target = `「${short(from?.text ?? '?', 16)}」→「${short(to?.text ?? '?', 16)}」`;
        if (!from || !to) return fail('missing', 'カードが見つかりません');
        if (from.parent !== null || to.parent !== null) return fail('refused', '一番上のカードどうしだけ結べます');
        if (from.id === to.id) return fail('refused', '同じカードどうしです');
        item.changedSince = since(memo, from);
        item.before = '（関連なし）';
        item.after = `「${world.kindName(op.kind)}」`;
        if ((from.links ?? []).some((l) => l.to === to.id)) return fail('same', 'もう関連があります');
        return item;
      }
      case 'memo.create': {
        item.what = 'メモのセルを作る';
        const sheet = op.sheet ?? world.currentSheet();
        const name = world.sheetName(sheet);
        item.target = name ? `シート「${name}」` : '（見つからないシート）';
        if (!name) return fail('missing');
        const near = op.near ? memberRef(world, op.near) : null;
        if (near?.note) item.notes.push(near.note);
        if (op.near && !near?.ref) item.notes.push('近くに置く相手が見つからないので、空いた所に置きます');
        item.before = '（なし）';
        item.after = `「${short(op.text)}」${op.tags.length ? ` ${list(op.tags)}` : ''}`;
        return item;
      }
    }
  });
}

function memoTextAfter(textNow: string, op: Extract<PatchOp, { op: 'memo.setTitle' | 'memo.appendText' }>): string {
  if (op.op === 'memo.appendText') return textNow ? `${textNow}\n${op.text}` : op.text;
  const lines = textNow.split('\n');
  const at = lines.findIndex((l) => l.trim());
  if (at < 0) return op.text;
  lines[at] = op.text;
  return lines.join('\n');
}

// ---------- 当てる・戻す ----------

export type UndoStep =
  | { r: 'tabTags'; uid: string; before: string[] }
  | { r: 'memoTags'; id: string; before: string[] }
  | { r: 'cardTags'; memo: string; id: string; before: string[] }
  | { r: 'tabComment'; uid: string; before: string }
  | { r: 'tabNote'; uid: string; noteId: string }
  | { r: 'memoText'; id: string; before: string }
  | { r: 'card'; memo: string; id: string }
  | { r: 'island'; id: string; refs: CellRef[]; prev: (string | null)[] }
  | { r: 'islandName'; id: string; before: string }
  | { r: 'islandColor'; id: string; before: string }
  | { r: 'islandMembers'; id: string; refs: CellRef[]; prev: (string | null)[] }
  | { r: 'boardLink'; id: string }
  | { r: 'cardLink'; memo: string; from: string; to: string }
  | { r: 'memo'; id: string }
  | ImportSheetUndo;

// 取り込み（hcb-memo-interchange。memo-interchange.ts・app/interchange-flow.ts）の戻し方：記録の 1 件＝シートと中身をまとめて消す
//   sheet：作ったシート。memos：取り込んだメモ（入口は portals）。islands・boardLinks：作った島・線。extra：ui-data\interchange-extra\<id>.json
export interface ImportSheetUndo {
  r: 'importSheet';
  sheet: string;
  memos: string[];
  portals: string[];
  islands: string[];
  boardLinks: string[];
  extra: string;
}

// 指紋のもとになる、今の様子（PatchWorld.importView が渡す。シートが無ければ sheet:false）
export interface ImportView {
  sheet: boolean;
  memos: readonly { id: string; sheet: string; portal?: string; updatedAt: number; text: string; replies?: readonly { id: string; text: string; editedAt?: number; rank?: number; tags?: readonly string[]; links?: readonly { to: string; kind: string }[] }[] }[];
  tabs: number; // そのシートにあるタブの数
  islandMembers: (id: string) => number; // 島に入っているセルの数（ほかのシートのものも）
  boardLinks: readonly { id: string; from: CellRef; to: CellRef }[];
}

// 取り込んだ直後と比べるための形（指紋はこれの JSON。戻すときの小窓の数もここから数える）
export interface ImportSheetState {
  memos: [string, number, string][]; // そのシートのメモ：id・updatedAt・カードの印（文・editedAt・rank・タグ・関連）
  tabs: number;
  islands: number[]; // 作った島ごとの、入っているセルの数
  boardLinks: string[]; // そのシートのメモ・入口につながる線の id
  portals: string[]; // 残っている入口（id@置いてあるシート）
}

export function importSheetState(u: ImportSheetUndo, view: ImportView): ImportSheetState | null {
  if (!view.sheet) return null;
  const inSheet = view.memos.filter((m) => m.sheet === u.sheet).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const portals = view.memos.filter((m) => u.portals.includes(m.id) && m.portal === u.sheet);
  const refs = new Set([...inSheet, ...portals].map((m) => memoRefOf(m.id)));
  return {
    memos: inSheet.map((m) => [m.id, m.updatedAt, shortHash(JSON.stringify([m.text, (m.replies ?? []).map((r) => [r.id, r.text, r.editedAt ?? 0, r.rank ?? -1, r.tags ?? [], r.links ?? []])]))]),
    tabs: view.tabs,
    islands: u.islands.map((id) => view.islandMembers(id)),
    boardLinks: view.boardLinks
      .filter((l) => refs.has(l.from) || refs.has(l.to))
      .map((l) => l.id)
      .sort(),
    portals: portals.map((m) => `${m.id}@${m.sheet}`).sort(),
  };
}

// 取り込んだあとに変わったところの数（戻すときの小窓。after は取り込んだ直後の指紋）
export interface ImportChanges {
  edited: number; // 直したメモ（取り込んだメモのうち、中身が変わったもの）
  added: number; // あとで足したメモ
  removed: number; // あとで消した・動かした取り込みのメモ
  tabs: number; // シートにあるタブ
  links: number; // あとで足した線（ほかのシートからのものも）
  islandMembers: number; // 作った島に、あとで足したセル
}

export function importChanges(u: ImportSheetUndo, after: string, now: ImportSheetState): ImportChanges {
  let before: ImportSheetState | null = null;
  try {
    const raw = JSON.parse(after) as unknown;
    if (isRecord(raw) && Array.isArray(raw.memos)) before = raw as unknown as ImportSheetState;
  } catch {
    before = null;
  }
  const was = new Map((before?.memos ?? []).map((m) => [m[0], m]));
  const nowMap = new Map(now.memos.map((m) => [m[0], m]));
  const imported = new Set(u.memos);
  let edited = 0;
  let added = 0;
  for (const m of now.memos) {
    const b = was.get(m[0]);
    if (!imported.has(m[0]) && !b) added++;
    else if (b && (b[1] !== m[1] || b[2] !== m[2])) edited++;
  }
  const removed = u.memos.filter((id) => !nowMap.has(id)).length;
  const wasLinks = new Set(before?.boardLinks ?? u.boardLinks);
  const links = now.boardLinks.filter((id) => !wasLinks.has(id)).length;
  const islandMembers = now.islands.reduce((n, c, i) => n + Math.max(0, c - (before?.islands[i] ?? c)), 0);
  return { edited, added, removed, tabs: now.tabs, links, islandMembers };
}

const memoRefOf = (id: string): CellRef => `m:${id}`;

export interface AppliedStep {
  label: string;
  undo: UndoStep;
  after: string; // 当てた直後の指紋
}

// 今の様子の指紋（戻すときに、当てた直後と同じか比べる）。相手が無ければ 'gone'
export function fingerprint(world: PatchWorld, u: UndoStep): string {
  switch (u.r) {
    case 'tabTags':
      return JSON.stringify(world.tabByUid(u.uid)?.tags ?? 'gone');
    case 'memoTags':
      return JSON.stringify(world.memo(u.id)?.tags ?? 'gone');
    case 'cardTags':
      return JSON.stringify(world.memo(u.memo)?.replies.find((c) => c.id === u.id)?.tags ?? (world.memo(u.memo)?.replies.some((c) => c.id === u.id) ? [] : 'gone'));
    case 'tabComment':
      return JSON.stringify(world.tabByUid(u.uid) ? (world.tabByUid(u.uid)?.comment ?? '') : 'gone');
    case 'tabNote':
      return JSON.stringify(world.tabByUid(u.uid)?.notes.find((n) => n.id === u.noteId)?.text ?? 'gone');
    case 'memoText':
      return JSON.stringify(world.memo(u.id)?.text ?? 'gone');
    case 'card': {
      const m = world.memo(u.memo);
      const c = m?.replies.find((r) => r.id === u.id);
      if (!m || !c) return 'gone';
      return JSON.stringify([c.text, c.editedAt ?? 0, m.replies.filter((r) => r.parent === c.id).length]); // 返信が付いたら戻さない
    }
    case 'island': {
      const i = world.island(u.id);
      return i ? JSON.stringify([i.name, i.color, u.refs.map((r) => world.islandOf(r) === u.id)]) : 'gone';
    }
    case 'islandName':
      return JSON.stringify(world.island(u.id)?.name ?? 'gone');
    case 'islandColor':
      return JSON.stringify(world.island(u.id)?.color ?? 'gone');
    case 'islandMembers':
      return JSON.stringify(u.refs.map((r) => world.islandOf(r)));
    case 'boardLink':
      return world.boardLinkExists(u.id) ? 'here' : 'gone';
    case 'cardLink': {
      const c = world.memo(u.memo)?.replies.find((r) => r.id === u.from);
      return JSON.stringify((c?.links ?? []).find((l) => l.to === u.to) ?? 'gone');
    }
    case 'memo': {
      const m = world.memo(u.id);
      return m ? JSON.stringify([m.text, m.replies.length]) : 'gone';
    }
    case 'importSheet': {
      const state = importSheetState(u, world.importView(u));
      return state ? JSON.stringify(state) : 'gone';
    }
  }
}

// 一つ当てる（当てられなければ null）
export function applyItem(world: PatchWorld, item: PlanItem): AppliedStep | null {
  if (item.status !== 'ok') return null;
  const op = item.op;
  const label = `${item.what}：${item.target}`;
  const done = (undo: UndoStep): AppliedStep => ({ label, undo, after: fingerprint(world, undo) });
  switch (op.op) {
    case 'tags.add':
    case 'tags.remove': {
      const r = resolve(world, op.target);
      const change = (now: string[]) => (op.op === 'tags.add' ? [...now, ...op.tags.filter((t) => !now.includes(t))] : now.filter((t) => !op.tags.includes(t))).slice(0, world.maxTags);
      if (r.card && r.memo) {
        const before = [...(r.card.tags ?? [])];
        if (!world.setCardTags(r.memo.id, r.card.id, change(before))) return null;
        return done({ r: 'cardTags', memo: r.memo.id, id: r.card.id, before });
      }
      if (r.memo && op.target.kind === 'memo') {
        const before = [...r.memo.tags];
        world.setMemoTags(r.memo.id, change(before));
        return done({ r: 'memoTags', id: r.memo.id, before });
      }
      if (r.tab) {
        const before = [...r.tab.tags];
        world.setTabTags(r.tab.id, change(before));
        return done({ r: 'tabTags', uid: r.tab.uid, before });
      }
      return null;
    }
    case 'tab.setComment': {
      const r = resolve(world, op.target);
      if (!r.tab) return null;
      const before = r.tab.comment ?? '';
      world.setTabComment(r.tab.id, op.text);
      return done({ r: 'tabComment', uid: r.tab.uid, before });
    }
    case 'tab.addNote': {
      const r = resolve(world, op.target);
      if (!r.tab) return null;
      const noteId = world.addTabNote(r.tab.id, op.text);
      return noteId ? done({ r: 'tabNote', uid: r.tab.uid, noteId }) : null;
    }
    case 'memo.setTitle':
    case 'memo.appendText': {
      const memo = world.memo(op.target.id);
      if (!memo || memo.special) return null;
      const before = memo.text;
      world.setMemoText(memo.id, memoTextAfter(before, op));
      return done({ r: 'memoText', id: memo.id, before });
    }
    case 'card.add': {
      const id = world.addCard(op.memo, op.parent, op.text);
      if (!id) return null;
      if (op.parent === null && op.tags.length > 0) world.setCardTags(op.memo, id, op.tags.slice(0, world.maxTags));
      return done({ r: 'card', memo: op.memo, id });
    }
    case 'island.create': {
      const refs = op.members.map((m) => memberRef(world, m).ref).filter((r): r is CellRef => !!r);
      if (refs.length === 0) return null;
      const prev = refs.map((r) => world.islandOf(r));
      const id = world.addIsland(op.name, op.color ?? item.preview?.island?.color ?? null);
      if (!id) return null;
      world.setIsland(refs, id);
      return done({ r: 'island', id, refs, prev });
    }
    case 'island.rename': {
      const island = world.island(op.island);
      if (!island) return null;
      world.setIslandName(island.id, op.name);
      return done({ r: 'islandName', id: island.id, before: island.name });
    }
    case 'island.recolor': {
      const island = world.island(op.island);
      if (!island) return null;
      world.setIslandColor(island.id, op.color);
      return done({ r: 'islandColor', id: island.id, before: island.color });
    }
    case 'island.addMembers': {
      const island = world.island(op.island);
      if (!island) return null;
      const refs = op.members.map((m) => memberRef(world, m).ref).filter((r): r is CellRef => !!r && world.islandOf(r) !== island.id);
      if (refs.length === 0) return null;
      const prev = refs.map((r) => world.islandOf(r));
      world.setIsland(refs, island.id);
      return done({ r: 'islandMembers', id: island.id, refs, prev });
    }
    case 'boardLink.add': {
      const a = memberRef(world, op.from).ref;
      const b = memberRef(world, op.to).ref;
      if (!a || !b) return null;
      const id = world.addBoardLink(a, b, op.kind);
      return id ? done({ r: 'boardLink', id }) : null;
    }
    case 'cardLink.add':
      return world.addCardLink(op.memo, op.from, op.to, op.kind) ? done({ r: 'cardLink', memo: op.memo, from: op.from, to: op.to }) : null;
    case 'memo.create': {
      const near = op.near ? memberRef(world, op.near).ref : null;
      const id = world.createMemo(op.sheet ?? world.currentSheet(), near, op.text, op.tags);
      return id ? done({ r: 'memo', id }) : null;
    }
  }
}

// 戻す前に確かめる：当てた直後と違う（あとで書き直した・消した）ものの番号
export function undoConflicts(world: PatchWorld, steps: readonly AppliedStep[]): number[] {
  return steps.flatMap((s, i) => (fingerprint(world, s.undo) === s.after ? [] : [i]));
}

// 一つ戻す（後ろから順に呼ぶ）
export function undoStep(world: PatchWorld, u: UndoStep) {
  switch (u.r) {
    case 'tabTags': {
      const tab = world.tabByUid(u.uid);
      if (tab) world.setTabTags(tab.id, u.before);
      return;
    }
    case 'memoTags':
      world.setMemoTags(u.id, u.before);
      return;
    case 'cardTags':
      world.setCardTags(u.memo, u.id, u.before);
      return;
    case 'tabComment': {
      const tab = world.tabByUid(u.uid);
      if (tab) world.setTabComment(tab.id, u.before);
      return;
    }
    case 'tabNote': {
      const tab = world.tabByUid(u.uid);
      if (tab) world.removeTabNote(tab.id, u.noteId);
      return;
    }
    case 'memoText':
      world.setMemoText(u.id, u.before);
      return;
    case 'card':
      world.removeCard(u.memo, u.id);
      return;
    case 'island':
      u.refs.forEach((r, i) => world.setIsland([r], u.prev[i] && world.island(u.prev[i] as string) ? u.prev[i] : null));
      world.removeIsland(u.id);
      return;
    case 'islandName':
      world.setIslandName(u.id, u.before);
      return;
    case 'islandColor':
      world.setIslandColor(u.id, u.before);
      return;
    case 'islandMembers':
      u.refs.forEach((r, i) => world.setIsland([r], u.prev[i] && world.island(u.prev[i] as string) ? u.prev[i] : null));
      return;
    case 'boardLink':
      world.removeBoardLink(u.id);
      return;
    case 'cardLink':
      world.removeCardLink(u.memo, u.from, u.to);
      return;
    case 'memo':
      world.removeMemo(u.id);
      return;
    case 'importSheet':
      // 指紋が同じ（取り込んだまま）のときだけ、ここで消す。変わっていれば分かれ道（app/interchange-flow.ts の小窓）
      world.removeImport(u, 'sheet');
      return;
  }
}

// 控え（ui-data\patch-backups\<id>.json）と記録（ui-data\patch-history.json）
export interface PatchBackup {
  v: 1;
  id: string; // 当てた番号
  patchId: string;
  title: string;
  source: string; // inbox・file・drop
  appliedAt: string;
  steps: AppliedStep[];
  skipped: number;
  undoneAt?: string;
}

export interface PatchHistoryItem {
  id: string;
  patchId: string;
  title: string;
  source: string;
  at: string;
  applied: number;
  skipped: number;
  undoneAt?: string;
}

export function parseHistory(raw: unknown): PatchHistoryItem[] {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return [];
  return raw.items
    .filter(isRecord)
    .filter((i) => typeof i.id === 'string' && ID_RE.test(i.id) && typeof i.at === 'string')
    .map((i) => ({
      id: i.id as string,
      patchId: typeof i.patchId === 'string' ? i.patchId : '',
      title: typeof i.title === 'string' ? i.title.slice(0, 60) : '',
      source: typeof i.source === 'string' ? i.source.slice(0, 20) : '',
      at: i.at as string,
      applied: Number(i.applied) || 0,
      skipped: Number(i.skipped) || 0,
      ...(typeof i.undoneAt === 'string' ? { undoneAt: i.undoneAt } : {}),
    }))
    .slice(0, 100);
}

export function isBackup(raw: unknown): raw is PatchBackup {
  return isRecord(raw) && raw.v === 1 && typeof raw.id === 'string' && Array.isArray(raw.steps) && raw.steps.every((s) => isRecord(s) && isRecord(s.undo) && typeof s.after === 'string' && validUndo(s.undo));
}

function validUndo(u: Record<string, unknown>): boolean {
  const refs = (v: unknown) => Array.isArray(v) && v.every(isCellRef);
  switch (u.r) {
    case 'tabTags':
    case 'tabComment':
    case 'tabNote':
      return typeof u.uid === 'string';
    case 'memoTags':
    case 'memoText':
    case 'memo':
    case 'boardLink':
    case 'islandName':
    case 'islandColor':
      return typeof u.id === 'string';
    case 'cardTags':
    case 'card':
      return typeof u.memo === 'string' && typeof u.id === 'string';
    case 'island':
    case 'islandMembers':
      return typeof u.id === 'string' && refs(u.refs) && Array.isArray(u.prev);
    case 'cardLink':
      return typeof u.memo === 'string' && typeof u.from === 'string' && typeof u.to === 'string';
    case 'importSheet': {
      const ids = (v: unknown) => Array.isArray(v) && v.length <= 5000 && v.every((x) => typeof x === 'string' && ID_RE.test(x));
      return typeof u.sheet === 'string' && /^sh[0-9a-z]+$/.test(u.sheet) && ids(u.memos) && ids(u.portals) && ids(u.islands) && ids(u.boardLinks) && typeof u.extra === 'string' && ID_RE.test(u.extra);
    }
    default:
      return false;
  }
}
