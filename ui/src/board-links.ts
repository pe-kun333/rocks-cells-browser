// 盤面の関連の線（段階3）：左の盤面のセルどうしを、種類つきの線で結ぶ
//   ・セルの名前（CellRef）：タブは 't:' + uid（起動し直しても変わらない番号。Tab.uid）、メモのセル（入口・ボット・アプリも）は 'm:' + メモの id
//   ・種類と色・矢じりは下の区画のカードの関連と同じ表（LINK_KINDS）。名前は元の名前（メモごとに変えた名前は使わない）
//   ・一組の向きごとに 1 本（同じ向きの二本目は断る。「同じ」は向きが無いので逆向きも断る）。自分自身へは引かない
//   ・保存は session.json（boardLinks）。シートをアーカイブしても線は残し、戻せばまたつながる（uid がアーカイブに入るので）
import { t } from './i18n';
import { isLinkKind, LINK_KIND_DEFAULT_NAMES, type LinkKind } from './memo-card-links';

export type CellRef = string;

export interface BoardLink {
  id: string;
  from: CellRef;
  to: CellRef;
  kind: LinkKind;
}

export const MAX_BOARD_LINKS = 500;
const REF = /^(t|m):[0-9A-Za-z_-]{1,64}$/;

export const tabRef = (uid: string): CellRef => `t:${uid}`;
export const memoRef = (id: string): CellRef => `m:${id}`;
export function isCellRef(value: unknown): value is CellRef {
  return typeof value === 'string' && REF.test(value);
}

export function newBoardLinkId() {
  return `bl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newTabUid() {
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- 種類の名前（盤面だけ。下の区画のカードの名前（メモごと）とは別） ----------
//   保存は表示の設定（prefs.boardLinkNames）。無い種類・空は元の名前（LINK_KIND_DEFAULT_NAMES）
export const BOARD_LINK_NAME_MAX = 12;
export type BoardLinkNames = Partial<Record<LinkKind, string>>;
let boardNames: BoardLinkNames = {};

// 保存してあった名前を読む（知らない種類・空・元と同じは捨てる。長すぎれば切る）
export function parseBoardLinkNames(raw: unknown): BoardLinkNames {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: BoardLinkNames = {};
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isLinkKind(kind) || typeof value !== 'string') continue;
    const v = [...value.trim().replace(/\s+/g, ' ')].slice(0, BOARD_LINK_NAME_MAX).join('');
    if (v && v !== LINK_KIND_DEFAULT_NAMES[kind]) out[kind] = v;
  }
  return out;
}

export function setBoardLinkNames(names: BoardLinkNames) {
  boardNames = parseBoardLinkNames(names);
}

export function boardKindName(kind: LinkKind): string {
  return boardNames[kind] ?? LINK_KIND_DEFAULT_NAMES[kind];
}

// 盤面の文：「A」は「B」の続き／「A」と「B」は同じ
//   名前が文に入りにくいとき（7 文字以上・空白や記号を含む）は「A」→「B」：名前（同じ：「A」↔「B」：名前）
export function boardLinkSentence(from: string, to: string, kind: LinkKind): string {
  const name = boardKindName(kind);
  const fits = [...name].length <= 6 && !/[\s:：→←↔「」『』（）()、。,.!?！？]/.test(name);
  if (kind === 'same') return fits ? t('「{0}」と「{1}」は{2}', { 0: from, 1: to, 2: name }) : `「${from}」↔「${to}」：${name}`;
  return fits ? t('「{0}」は「{1}」の{2}', { 0: from, 1: to, 2: name }) : `「${from}」→「${to}」：${name}`;
}

// 同じ組の線がもうあるか（同じ向き。「同じ」はどちら向きでも）
export function findDuplicate(links: readonly BoardLink[], from: CellRef, to: CellRef, kind: LinkKind): BoardLink | undefined {
  return links.find((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from && (kind === 'same' || l.kind === 'same')));
}

// 保存してあった線を読む（形の崩れたもの・自分自身・二本目は捨てる。上限まで）
export function parseBoardLinks(raw: unknown): BoardLink[] {
  if (!Array.isArray(raw)) return [];
  const out: BoardLink[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id || r.id.length > 64 || ids.has(r.id)) continue;
    if (!isCellRef(r.from) || !isCellRef(r.to) || r.from === r.to || !isLinkKind(r.kind)) continue;
    if (findDuplicate(out, r.from, r.to, r.kind)) continue;
    ids.add(r.id);
    out.push({ id: r.id, from: r.from, to: r.to, kind: r.kind });
    if (out.length >= MAX_BOARD_LINKS) break;
  }
  return out;
}

export type AddResult = BoardLink | 'self' | 'duplicate' | 'full' | 'bad';

export class BoardLinkStore {
  private items: BoardLink[] = [];
  private readonly listeners = new Set<() => void>();

  list(): readonly BoardLink[] {
    return this.items;
  }

  get(id: string) {
    return this.items.find((l) => l.id === id);
  }

  forCell(ref: CellRef) {
    return this.items.filter((l) => l.from === ref || l.to === ref);
  }

  add(from: CellRef, to: CellRef, kind: LinkKind): AddResult {
    if (!isCellRef(from) || !isCellRef(to) || !isLinkKind(kind)) return 'bad';
    if (from === to) return 'self';
    if (findDuplicate(this.items, from, to, kind)) return 'duplicate';
    if (this.items.length >= MAX_BOARD_LINKS) return 'full';
    const link = { id: newBoardLinkId(), from, to, kind };
    this.items = [...this.items, link];
    this.emit();
    return link;
  }

  setKind(id: string, kind: LinkKind) {
    const link = this.get(id);
    if (!link || link.kind === kind || !isLinkKind(kind)) return;
    // 「同じ」にすると逆向きの線と重なるときは、変えない
    if (kind === 'same' && this.items.some((l) => l.id !== id && l.from === link.to && l.to === link.from)) return;
    this.items = this.items.map((l) => (l.id === id ? { ...l, kind } : l));
    this.emit();
  }

  // 向きを入れ替える（逆向きがもうあれば何もしない）
  reverse(id: string) {
    const link = this.get(id);
    if (!link || this.items.some((l) => l.id !== id && l.from === link.to && l.to === link.from)) return;
    this.items = this.items.map((l) => (l.id === id ? { ...l, from: l.to, to: l.from } : l));
    this.emit();
  }

  remove(id: string) {
    const before = this.items.length;
    this.items = this.items.filter((l) => l.id !== id);
    if (this.items.length !== before) this.emit();
  }

  // そのセルの線を全部外す（タブを閉じた・メモのセルを消した）
  removeCells(refs: Iterable<CellRef>) {
    const doomed = new Set(refs);
    if (doomed.size === 0) return;
    const before = this.items.length;
    this.items = this.items.filter((l) => !doomed.has(l.from) && !doomed.has(l.to));
    if (this.items.length !== before) this.emit();
  }

  replaceAll(links: readonly BoardLink[]) {
    this.items = parseBoardLinks(links);
    this.emit();
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}
