// シートのアーカイブ（AR1。docs/plan-sheet-archive.md §6）
//   本体：ui-data\sheet-archive\<id>.json（書いた後は変えない）
//   札  ：ui-data\sheet-archive-meta\<id>.json（一覧に出す小さなファイル。戻したときに restoredAt を書き直す）
//   目次のファイルは作らない（読めなかったときに全件を失わないように）。札の無い本体は一覧に出ない
//   画像は写さず id で参照する（shots\<id>.json）。将来 shots\ を掃除するなら、アーカイブも参照元に数えること
import { deleteData, listData, readDataChecked, writeData } from './data';
import { type MemoCell, parseMemo } from './memocells';
import { parseIslands, parseSession } from './session';
import { isSheetId, type Sheet } from './sheets';
import type { BoardView } from './sidebar';
import { samePage } from './threads';
import type { Island, SavedTab } from './types';

export const ARCHIVE_DIR = 'sheet-archive';
export const ARCHIVE_META_DIR = 'sheet-archive-meta';
export const MAX_ARCHIVE_CHARS = 2_000_000; // §5.2：これを超えるアーカイブは作らない

export type ArchivedTab = Omit<SavedTab, 'id' | 'sheet'>;

export interface SheetArchive {
  version: 1;
  id: string; // ar…
  createdAt: number;
  sheet: Sheet;
  view?: BoardView;
  tabs: ArchivedTab[]; // order の順
  memos: MemoCell[]; // このシートのメモのセル（入口・ボット・アプリ・撮ったもの含む）
  entrances: MemoCell[]; // ほかのシートにあった、このシートへの入口
  islands: Island[]; // このシートのタブ・メモが入っていた島
  shots: string[]; // 参照している画像の id
}

export interface SheetArchiveMeta {
  version: 1;
  id: string;
  createdAt: number;
  sheet: { id: string; name: string; color: string };
  counts: { tabs: number; memos: number; entrances: number; images: number };
  chars: number;
  restoredAt?: number;
}

const ID_RE = /^ar[0-9a-z]{6,32}$/;
export const isArchiveId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id);
export const newArchiveId = () => `ar${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const bodyName = (id: string) => `${ARCHIVE_DIR}/${id}.json`;
const metaName = (id: string) => `${ARCHIVE_META_DIR}/${id}.json`;

// 今の盤面から組み立てる（純粋な関数。材料は呼ぶ側が渡す）
//   tabs：このシートのタブ（保存の形。閉じ途中のものは呼ぶ側が除く）　memos：全部のメモのセル　islands：島の台帳
export function buildArchive(o: { id: string; createdAt: number; sheet: Sheet; view?: BoardView; tabs: readonly SavedTab[]; memos: readonly MemoCell[]; islands: readonly Island[] }): SheetArchive {
  const sheetId = o.sheet.id;
  const tabs = [...o.tabs]
    .filter((t) => (t.sheet ?? 'main') === sheetId)
    .sort((a, b) => a.order - b.order)
    .map((t) => {
      const { id: _id, sheet: _sheet, ...rest } = t;
      return clone(rest);
    });
  const memos = o.memos.filter((m) => m.sheet === sheetId).map(clone);
  const entrances = o.memos.filter((m) => m.portal === sheetId && m.sheet !== sheetId).map(clone);
  const usedIslands = new Set<string>([...tabs.flatMap((t) => (t.island ? [t.island] : [])), ...memos.flatMap((m) => (m.island ? [m.island] : []))]);
  const islands = o.islands.filter((i) => usedIslands.has(i.id)).map(clone);
  return {
    version: 1,
    id: o.id,
    createdAt: o.createdAt,
    sheet: { ...o.sheet },
    ...(o.view ? { view: { ...o.view } } : {}),
    tabs,
    memos,
    entrances,
    islands,
    shots: collectShots(tabs, memos),
  };
}

// 参照している画像の id（タブの image、メモの image、返信の image。返信は入れ子でも拾う）
function collectShots(tabs: readonly ArchivedTab[], memos: readonly MemoCell[]): string[] {
  const out = new Set<string>();
  for (const t of tabs) if (t.image) out.add(t.image);
  const text = JSON.stringify(memos);
  for (const m of text.matchAll(/"image":"(shot[0-9a-z]+)"/g)) out.add(m[1]);
  return [...out].sort();
}

// 書いている間に変わったかの比べ（§5.2）。メモと入口は中身全部、タブは位置・同じページの URL・notes・♥・タグ・島・画像・コメント・見え方・休眠させない・順路
//   題名・アイコン・読んだ量・順番は比べない
export function sameContent(a: SheetArchive, b: SheetArchive): boolean {
  if (a.sheet.id !== b.sheet.id) return false;
  if (!sameCells(a.memos, b.memos) || !sameCells(a.entrances, b.entrances)) return false;
  if (a.tabs.length !== b.tabs.length) return false;
  const key = (t: ArchivedTab) => `${t.pos.q},${t.pos.r}`;
  const bs = new Map(b.tabs.map((t) => [key(t), t]));
  if (bs.size !== b.tabs.length) return false;
  for (const t of a.tabs) {
    const u = bs.get(key(t));
    if (!u || !(t.url === u.url || samePage(t.url, u.url))) return false;
    if (stable(tabCore(t)) !== stable(tabCore(u))) return false;
  }
  return true;
}

function tabCore(t: ArchivedTab) {
  return {
    notes: t.notes ?? [],
    liked: t.liked ?? 0,
    tags: t.tags ?? [],
    island: t.island ?? null,
    image: t.image ?? null,
    comment: t.comment ?? null,
    look: t.look ?? null,
    keepAwake: !!t.keepAwake,
    trail: t.trail ?? null,
  };
}

function sameCells(a: readonly MemoCell[], b: readonly MemoCell[]) {
  if (a.length !== b.length) return false;
  const sort = (list: readonly MemoCell[]) => [...list].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)).map(stable);
  const x = sort(a);
  const y = sort(b);
  return x.every((v, i) => v === y[i]);
}

// 厳しく読む（おかしければ null）
export function parseArchive(raw: unknown): SheetArchive | null {
  if (!isRecord(raw) || raw.version !== 1 || !isArchiveId(raw.id) || typeof raw.createdAt !== 'number') return null;
  const sheet = parseSheet(raw.sheet);
  if (!sheet) return null;
  if (!Array.isArray(raw.tabs) || !Array.isArray(raw.memos) || !Array.isArray(raw.entrances) || !Array.isArray(raw.islands) || !Array.isArray(raw.shots)) return null;
  // タブは session.json と同じ読み方（番号は無いので 0、シートはこのシート）
  const parsed = parseSession({ version: 1, tabs: raw.tabs.map((t) => (isRecord(t) ? { ...t, id: 0, sheet: sheet.id } : t)) });
  if (!parsed || parsed.tabs.length !== raw.tabs.length) return null;
  const tabs: ArchivedTab[] = parsed.tabs.map((t) => {
    const { id: _id, sheet: _sheet, ...rest } = t;
    return rest;
  });
  const memos = raw.memos.map(parseMemo);
  const entrances = raw.entrances.map(parseMemo);
  if (memos.some((m) => !m || m.sheet !== sheet.id) || entrances.some((m) => !m || m.portal !== sheet.id || m.sheet === sheet.id)) return null;
  const view = isRecord(raw.view) && [raw.view.x, raw.view.y, raw.view.zoom].every((n) => typeof n === 'number' && Number.isFinite(n)) ? { x: Number(raw.view.x), y: Number(raw.view.y), zoom: Number(raw.view.zoom) } : undefined;
  return {
    version: 1,
    id: raw.id,
    createdAt: raw.createdAt,
    sheet,
    ...(view ? { view } : {}),
    tabs,
    memos: memos as MemoCell[],
    entrances: entrances as MemoCell[],
    islands: parseIslands(raw.islands),
    shots: raw.shots.filter((s): s is string => typeof s === 'string' && /^shot[0-9a-z]+$/.test(s)),
  };
}

export function parseArchiveMeta(raw: unknown): SheetArchiveMeta | null {
  if (!isRecord(raw) || raw.version !== 1 || !isArchiveId(raw.id) || typeof raw.createdAt !== 'number' || typeof raw.chars !== 'number') return null;
  const sheet = parseSheet(raw.sheet);
  const c = raw.counts;
  if (!sheet || !isRecord(c)) return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  const counts = { tabs: n(c.tabs), memos: n(c.memos), entrances: n(c.entrances), images: n(c.images) };
  if (Object.values(counts).some((v) => v === null)) return null;
  return {
    version: 1,
    id: raw.id,
    createdAt: raw.createdAt,
    sheet: { id: sheet.id, name: sheet.name, color: sheet.color },
    counts: counts as SheetArchiveMeta['counts'],
    chars: raw.chars,
    ...(typeof raw.restoredAt === 'number' ? { restoredAt: raw.restoredAt } : {}),
  };
}

function parseSheet(raw: unknown): Sheet | null {
  if (!isRecord(raw) || !isSheetId(raw.id) || typeof raw.name !== 'string' || typeof raw.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.color)) return null;
  return { id: raw.id, name: raw.name.slice(0, 40), color: raw.color, createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0 };
}

export function metaOf(archive: SheetArchive, chars: number): SheetArchiveMeta {
  return {
    version: 1,
    id: archive.id,
    createdAt: archive.createdAt,
    sheet: { id: archive.sheet.id, name: archive.sheet.name, color: archive.sheet.color },
    counts: { tabs: archive.tabs.length, memos: archive.memos.length, entrances: archive.entrances.length, images: archive.shots.length },
    chars,
  };
}

export type WriteResult = 'ok' | 'tooBig' | 'writeFailed' | 'verifyFailed';

// 本体を書く → 読み返して照合 → 札を書く（札を書けなければ本体も消す）
export async function writeArchive(archive: SheetArchive): Promise<WriteResult> {
  const text = JSON.stringify(archive);
  if (text.length > MAX_ARCHIVE_CHARS) return 'tooBig';
  if (!(await writeData(bodyName(archive.id), archive))) return 'writeFailed';
  const back = await readDataChecked<unknown>(bodyName(archive.id));
  const parsed = back.status === 'ok' ? parseArchive(back.value) : null;
  if (!parsed || !verifySame(archive, parsed)) {
    deleteData(bodyName(archive.id));
    return 'verifyFailed';
  }
  if (!(await writeData(metaName(archive.id), metaOf(archive, text.length)))) {
    deleteData(bodyName(archive.id));
    return 'writeFailed';
  }
  const meta = await readDataChecked<unknown>(metaName(archive.id));
  if (meta.status !== 'ok' || !parseArchiveMeta(meta.value)) {
    deleteData(metaName(archive.id));
    deleteData(bodyName(archive.id));
    return 'verifyFailed';
  }
  return 'ok';
}

// 読み返しの照合：件数、メモと入口の id、タブの URL と位置（と中身の比べ）
function verifySame(a: SheetArchive, b: SheetArchive) {
  if (a.id !== b.id || a.sheet.id !== b.sheet.id || a.tabs.length !== b.tabs.length || a.memos.length !== b.memos.length || a.entrances.length !== b.entrances.length) return false;
  if (a.islands.length !== b.islands.length) return false;
  for (let i = 0; i < a.tabs.length; i++) {
    const x = a.tabs[i];
    const y = b.tabs[i];
    if (x.url !== y.url || x.pos.q !== y.pos.q || x.pos.r !== y.pos.r) return false;
  }
  const ids = (list: readonly MemoCell[]) => list.map((m) => m.id).sort().join(',');
  return ids(a.memos) === ids(b.memos) && ids(a.entrances) === ids(b.entrances) && sameContent(a, b);
}

// 一覧（札を新しい順に）。読めない札は飛ばす
export async function listArchives(): Promise<SheetArchiveMeta[]> {
  const files = (await listData(ARCHIVE_META_DIR)).map((f) => /(?:^|\/)(ar[0-9a-z]{6,32})\.json$/.exec(f.name)?.[1]).filter((id): id is string => !!id);
  const read = await Promise.all(files.map((id) => readDataChecked<unknown>(metaName(id))));
  const out: SheetArchiveMeta[] = [];
  read.forEach((r, i) => {
    const meta = r.status === 'ok' ? parseArchiveMeta(r.value) : null;
    if (meta && meta.id === files[i]) out.push(meta);
  });
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function readArchive(id: string): Promise<SheetArchive | 'missing' | 'failed'> {
  if (!isArchiveId(id)) return 'failed';
  const r = await readDataChecked<unknown>(bodyName(id));
  if (r.status === 'missing') return 'missing';
  if (r.status === 'failed') return 'failed';
  const archive = parseArchive(r.value);
  return archive && archive.id === id ? archive : 'failed';
}

export async function markRestored(meta: SheetArchiveMeta, at = Date.now()): Promise<boolean> {
  return writeData(metaName(meta.id), { ...meta, restoredAt: at });
}

// 札を先に消し、次に本体（deleteData は返事が無いので、消えたかは確かめられない）
export function deleteArchive(id: string) {
  if (!isArchiveId(id)) return;
  deleteData(metaName(id));
  deleteData(bodyName(id));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// キーの順をそろえた JSON（比べる用）
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, value: unknown) =>
    isRecord(value) ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]])) : value,
  );
}
