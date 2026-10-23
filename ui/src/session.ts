// タブの配置と番号の保存・読み込み（ファイルへの書き込みは C++ 側が行う）
import { type BoardLink, parseBoardLinks } from './board-links';
import { isTabTrail } from './routes';
import { isSheetId, MAIN_SHEET, parseSheets, type Sheet } from './sheets';
import { normalizeTag, normalizeTags } from './tags';
import { cleanComment, isTabLook, type TabStore } from './tabs';
import { parseReplies } from './threads';
import type { Island, SavedTab, SessionData, TabNote } from './types';

// memoIslands：メモのセルが入っている島（タブが無くても島を残す）
//   sheets・sheet：シートの台帳と、見ているシート
export function toSession(store: TabStore, islands: Island[], memoIslands: (string | null)[] = [], sheets: Sheet[] = [], sheet = MAIN_SHEET, boardLinks: readonly BoardLink[] = []): SessionData {
  const used = new Set([...store.all().map((t) => t.island), ...memoIslands]);
  return {
    version: 1,
    activeId: store.activeId,
    islands: islands.filter((i) => used.has(i.id)),
    sheets,
    sheet,
    tabs: store.sorted().map((t) => toSavedTab(t)),
    ...(boardLinks.length > 0 ? { boardLinks: [...boardLinks] } : {}),
  };
}

// タブ 1 つ分の保存の形（toSession と、シートのアーカイブ（AR1）で使う）
export function toSavedTab(t: ReturnType<TabStore['sorted']>[number]): SavedTab {
  return {
    id: t.id,
    uid: t.uid,
    url: t.url,
    title: t.title,
    favicon: t.favicon,
    pos: { ...t.pos },
    order: t.order,
    keepAwake: t.keepAwake || undefined,
    notes: t.notes.length > 0 ? t.notes : undefined,
    readEdges: t.readEdges || undefined,
    liked: t.liked || undefined,
    tags: t.tags.length > 0 ? t.tags : undefined,
    island: t.island ?? undefined,
    trail: t.trail ?? undefined,
    sheet: t.sheet === MAIN_SHEET ? undefined : t.sheet,
    image: t.image,
    comment: t.comment,
    look: t.look,
  };
}

// 保存されていた内容を確かめながら読む。おかしな所は飛ばし、まったく読めなければ null
export function parseSession(raw: unknown): SessionData | null {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.tabs)) return null;
  const tabs: SavedTab[] = [];
  for (const item of raw.tabs) {
    if (!isRecord(item) || typeof item.url !== 'string' || !isRecord(item.pos)) continue;
    const q = Number(item.pos.q);
    const r = Number(item.pos.r);
    if (!Number.isInteger(q) || !Number.isInteger(r)) continue;
    tabs.push({
      id: Number(item.id) || 0,
      uid: typeof item.uid === 'string' && /^[0-9A-Za-z_-]{1,64}$/.test(item.uid) ? item.uid : undefined,
      url: item.url,
      title: typeof item.title === 'string' ? item.title : '',
      favicon: typeof item.favicon === 'string' ? item.favicon : '',
      pos: { q, r },
      order: Number(item.order) || tabs.length + 1,
      keepAwake: item.keepAwake === true,
      notes: parseNotes(item.notes),
      readEdges: smallInt(item.readEdges, 6),
      liked: smallInt(item.liked, 3),
      tags: normalizeTags(item.tags),
      island: typeof item.island === 'string' ? item.island : undefined,
      trail: isTabTrail(item.trail) ? { route: item.trail.route, step: item.trail.step, lane: item.trail.lane } : undefined,
      sheet: isSheetId(item.sheet) ? item.sheet : MAIN_SHEET, // 無ければメイン（今見ているシートに移らないように、必ず決める）
      image: typeof item.image === 'string' && /^shot[0-9a-z]+$/.test(item.image) ? item.image : undefined,
      comment: cleanComment(item.comment) || undefined,
      look: isTabLook(item.look) ? item.look : undefined,
    });
  }
  tabs.sort((a, b) => a.order - b.order);
  return {
    version: 1,
    activeId: typeof raw.activeId === 'number' ? raw.activeId : null,
    tabs,
    islands: parseIslands(raw.islands),
    boardLinks: parseBoardLinks(raw.boardLinks),
    sheets: parseSheets(raw.sheets),
    sheet: isSheetId(raw.sheet) ? raw.sheet : undefined,
  };
}

export function parseIslands(raw: unknown): Island[] {
  if (!Array.isArray(raw)) return [];
  const islands: Island[] = [];
  for (const i of raw) {
    if (!isRecord(i) || typeof i.id !== 'string' || typeof i.name !== 'string') continue;
    islands.push({
      id: i.id,
      name: normalizeIslandName(i.name),
      // theme: fixed begin：データの色（保存する値。描くときは data-colors.css でテーマの明るさの帯へ）
      color: typeof i.color === 'string' && /^#[0-9a-f]{6}$/i.test(i.color) ? i.color : '#a78bfa',
      // theme: fixed end
    });
  }
  return islands.slice(0, 50);
}

// 島の名前（タグと違い、空白は入れてよい。短く）
export function normalizeIslandName(name: string): string {
  return [...name.trim().replace(/\s+/g, ' ')].slice(0, 20).join('') || normalizeTag(name) || '島';
}

function smallInt(raw: unknown, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(max, n) : 0;
}

function parseNotes(raw: unknown): TabNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: TabNote[] = [];
  for (const n of raw) {
    if (!isRecord(n) || typeof n.id !== 'string' || typeof n.text !== 'string') continue;
    notes.push({
      id: n.id,
      text: n.text,
      createdAt: typeof n.createdAt === 'number' ? n.createdAt : Date.now(),
      source: n.source === 'user' ? 'user' : 'ai',
      label: typeof n.label === 'string' ? n.label : undefined,
      ...(Array.isArray(n.replies) && n.replies.length > 0 ? { replies: parseReplies(n.replies) } : {}),
    });
  }
  return notes.slice(-50);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
