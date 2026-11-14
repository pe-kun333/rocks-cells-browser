// 棚の「ポータル」の台帳（docs/plan-portal-cells.md の §3・§4.1。DOM を使わない部品）
//   ・シートごとに 6 つまで。押すと盤面のまん中へ（描く・棚は別の段）
//   ・置き場は左の画面の置き場の新しい鍵 1 つだけ（session.json も ui-data も変えない）
//   ・書く前に置き場を読み直し、変えたシートの項だけを差し替える（左が二つ開いていても、もう一方の分を消さない）
//   ・新しい版の値（v が 1 より大きい）は読まないし、書き戻さない。そのあいだ変える口は全部断る
import type { Hex } from './hex';
import { isSheetId } from './sheets';

const STORE_KEY = 'honeycomb.waypoints';
export const WAYPOINT_STORE_KEY = STORE_KEY; // ほかの窓が書いたときの storage の知らせで比べる
const VERSION = 1;
export const WAYPOINT_SLOTS = 6;
export const MAX_SHEETS = 200; // シートは 100 枚まで。消えたシートの分が少し残ってもよい数
const HEX_LIMIT = 100_000; // 盤面のマスの読み込みと同じ判定（整数で絶対値がこれ未満）

export interface WaypointSpot {
  sheet: string;
  slot: number; // 0 始まり。画面の番号は slot + 1
  hex: Hex;
}

interface WaypointSheet {
  slots: (Hex | null)[]; // 長さ 6。slots[0] が 1 番
  at: number; // 最後に変えた時刻
}

type Sheets = Record<string, WaypointSheet>;

interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isHexValue = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && Math.abs(n) < HEX_LIMIT;
const okHex = (h: Hex | null | undefined): h is Hex => !!h && isHexValue(h.q) && isHexValue(h.r);
const sameHex = (a: Hex | null, b: Hex) => !!a && a.q === b.q && a.r === b.r;
const okSlot = (slot: number) => Number.isInteger(slot) && slot >= 0 && slot < WAYPOINT_SLOTS;
const emptySlots = (): (Hex | null)[] => Array.from({ length: WAYPOINT_SLOTS }, () => null);

// 項が多すぎたら落とす（盤面に無いシートから、at の古い順。keep は落とさない）
function trim(sheets: Sheets, exists: (id: string) => boolean, keep: string | null) {
  const ids = Object.keys(sheets);
  if (ids.length <= MAX_SHEETS) return;
  const order = ids
    .filter((id) => id !== keep)
    .map((id) => ({ id, gone: !exists(id), at: sheets[id].at }))
    .sort((a, b) => (a.gone === b.gone ? a.at - b.at : a.gone ? -1 : 1));
  let over = ids.length - MAX_SHEETS;
  for (const o of order) {
    if (over <= 0) break;
    delete sheets[o.id];
    over--;
  }
}

// 保存してあった中身を確かめながら読む（知らない形・壊れた値は捨てる。新しい版は locked）
export function parseWaypoints(raw: unknown): { sheets: Record<string, { slots: (Hex | null)[]; at: number }>; locked: boolean } {
  const out: { sheets: Sheets; locked: boolean } = { sheets: {}, locked: false };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const x = raw as { v?: unknown; sheets?: unknown };
  if (typeof x.v !== 'number' || Number.isNaN(x.v)) return out;
  if (x.v > VERSION) return { sheets: {}, locked: true };
  if (x.v < VERSION || !x.sheets || typeof x.sheets !== 'object' || Array.isArray(x.sheets)) return out;
  const items: [string, WaypointSheet][] = [];
  for (const [id, value] of Object.entries(x.sheets as Record<string, unknown>)) {
    if (!isSheetId(id) || !value || typeof value !== 'object') continue;
    const v = value as { slots?: unknown; at?: unknown };
    const slots = emptySlots();
    if (Array.isArray(v.slots)) {
      for (let i = 0; i < WAYPOINT_SLOTS && i < v.slots.length; i++) {
        const p: unknown = v.slots[i];
        if (!Array.isArray(p) || p.length !== 2 || !isHexValue(p[0]) || !isHexValue(p[1])) continue;
        const hex = { q: p[0], r: p[1] };
        if (slots.some((s) => sameHex(s, hex))) continue; // 同じマスは先の番号だけ
        slots[i] = hex;
      }
    }
    if (slots.every((s) => !s)) continue;
    const at = typeof v.at === 'number' && Number.isFinite(v.at) && v.at > 0 ? v.at : 0;
    items.push([id, { slots, at }]);
  }
  if (items.length > MAX_SHEETS) items.sort((a, b) => b[1].at - a[1].at).splice(MAX_SHEETS);
  for (const [id, s] of items) out.sheets[id] = s;
  return out;
}

const serialize = (sheets: Sheets) => {
  const out: Record<string, { slots: ([number, number] | null)[]; at: number }> = {};
  for (const [id, s] of Object.entries(sheets)) out[id] = { slots: s.slots.map((h) => (h ? [h.q, h.r] : null)), at: s.at };
  return { v: VERSION, sheets: out };
};

export class WaypointStore {
  private sheets: Sheets = {};
  private stored: Sheets = {}; // 置き場に今ある（と分かっている）中身
  private isLocked = false;
  private unsaved = new Set<string>(); // 書けなかったシート（読み直してもメモリの方を使う）
  private deferred = new Set<string>(); // dropSheet(id, false) で外した、まだ書かないシート
  private exists: (sheetId: string) => boolean = () => true;
  private listeners: (() => void)[] = [];

  constructor(private readonly storage: KeyValue | null = typeof localStorage === 'undefined' ? null : localStorage) {
    this.refresh();
  }

  // 新しい版の値があって変えられない
  get locked(): boolean {
    return this.isLocked;
  }

  all(): WaypointSpot[] {
    const out: WaypointSpot[] = [];
    for (const id of Object.keys(this.sheets)) for (const p of this.list(id)) out.push({ sheet: id, slot: p.slot, hex: p.hex });
    return out;
  }

  // そのシートの項（'constructor' のような、オブジェクトに元からある名前では引かない）
  private entry(sheet: string): WaypointSheet | undefined {
    return Object.prototype.hasOwnProperty.call(this.sheets, sheet) ? this.sheets[sheet] : undefined;
  }

  list(sheet: string): { slot: number; hex: Hex }[] {
    const s = this.entry(sheet);
    if (!s) return [];
    const out: { slot: number; hex: Hex }[] = [];
    s.slots.forEach((h, slot) => {
      if (h) out.push({ slot, hex: { q: h.q, r: h.r } });
    });
    return out;
  }

  hexes(sheet: string): Hex[] {
    return this.list(sheet).map((p) => p.hex);
  }

  slotAt(sheet: string, hex: Hex): number {
    const s = this.entry(sheet);
    return s ? s.slots.findIndex((h) => sameHex(h, hex)) : -1;
  }

  // 空いている一番小さい番号に置く
  place(sheet: string, hex: Hex, now: number): number | null {
    if (!okHex(hex)) return null;
    return this.edit<number | null>(sheet, now, null, (slots) => {
      if (slots.some((s) => sameHex(s, hex))) return null;
      const slot = slots.findIndex((s) => !s);
      if (slot < 0) return null;
      slots[slot] = { q: hex.q, r: hex.r };
      return slot;
    });
  }

  // その番号のポータルを hex へ動かす
  moveTo(sheet: string, slot: number, hex: Hex, now: number): boolean {
    if (!okSlot(slot) || !okHex(hex)) return false;
    return this.edit(sheet, now, false, (slots) => {
      if (!slots[slot] || slots.some((s) => sameHex(s, hex))) return false;
      slots[slot] = { q: hex.q, r: hex.r };
      return true;
    });
  }

  // from の番号を to に替える（to が使われていれば入れ替え、空なら動かす）
  setSlot(sheet: string, from: number, to: number, now: number): 'swapped' | 'moved' | null {
    if (!okSlot(from) || !okSlot(to) || from === to) return null;
    return this.edit<'swapped' | 'moved' | null>(sheet, now, null, (slots) => {
      const a = slots[from];
      if (!a) return null;
      const b = slots[to];
      slots[to] = a;
      slots[from] = b;
      return b ? 'swapped' : 'moved';
    });
  }

  remove(sheet: string, slot: number, now: number): boolean {
    if (!okSlot(slot)) return false;
    return this.edit(sheet, now, false, (slots) => {
      if (!slots[slot]) return false;
      slots[slot] = null;
      return true;
    });
  }

  // そのシートの項を全部外す（persist が false ならメモリだけ。書くのは flush）
  dropSheet(id: string, persist = true): boolean {
    if (!isSheetId(id)) return false;
    const before = this.snapshot();
    if (persist || this.isLocked) this.refresh(); // locked でも読み直す（置き場が直っていれば戻る）
    if (this.isLocked || !this.sheets[id]) {
      this.notifyIf(before);
      return false;
    }
    delete this.sheets[id];
    if (persist) {
      this.deferred.delete(id);
      this.unsaved.add(id);
      this.write(id, false);
    } else {
      this.deferred.add(id);
    }
    this.notifyIf(before);
    return true;
  }

  // まだ書いていない変更を書く
  flush(): void {
    if (!this.unsaved.size && !this.deferred.size) return;
    const before = this.snapshot();
    this.refresh();
    if (!this.isLocked) this.write(null, true);
    this.notifyIf(before);
  }

  // 置き場を読み直す（ほかの窓が書いたとき。まだ書いていない自分の変更は保つ）
  reload(): void {
    const before = this.snapshot();
    this.refresh();
    this.notifyIf(before);
  }

  // 盤面にあるシートか（上限で落とす順に使う）
  setExists(fn: (sheetId: string) => boolean): void {
    this.exists = fn;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  // 読み直してから、そのシートの slots を変える。fail と同じ答えなら何も書かない
  private edit<T>(sheet: string, now: number, fail: T, fn: (slots: (Hex | null)[]) => T): T {
    if (!isSheetId(sheet)) return fail;
    const before = this.snapshot();
    this.refresh(); // locked でも読み直す（読むだけで書かない。置き場が直っていれば戻る）
    if (this.isLocked) {
      this.notifyIf(before);
      return fail;
    }
    const slots = this.sheets[sheet] ? [...this.sheets[sheet].slots] : emptySlots();
    const result = fn(slots);
    if (result === fail) {
      this.notifyIf(before);
      return fail;
    }
    if (slots.every((s) => !s)) delete this.sheets[sheet];
    else this.sheets[sheet] = { slots, at: now };
    this.deferred.delete(sheet);
    this.unsaved.add(sheet);
    this.write(sheet, false);
    this.notifyIf(before);
    return result;
  }

  // 置き場の中身に、まだ書いていない自分の分を重ねてメモリにする
  private refresh() {
    if (!this.storage) return;
    let raw: string | null;
    try {
      raw = this.storage.getItem(STORE_KEY);
    } catch {
      return; // 読めなくても、メモリの中では使える
    }
    let parsed: { sheets: Sheets; locked: boolean };
    try {
      parsed = parseWaypoints(raw === null ? null : JSON.parse(raw));
    } catch {
      parsed = { sheets: {}, locked: false }; // 壊れた値は捨てる
    }
    this.isLocked = parsed.locked;
    this.stored = { ...parsed.sheets };
    if (parsed.locked) {
      this.sheets = {};
      this.unsaved.clear(); // deferred は保つ（locked が外れた読み直しで、また外す）
      return;
    }
    const next = parsed.sheets;
    for (const id of [...this.unsaved, ...this.deferred]) {
      if (this.sheets[id]) next[id] = this.sheets[id];
      else delete next[id];
    }
    this.sheets = next;
  }

  // 全体を書く（all が false なら、dropSheet(id, false) の分は置き場の値のまま。
  // ただし 200 を超えるなら、その分は先に外して書く。メモリにある項は落とさない）
  private write(keep: string | null, all: boolean) {
    trim(this.sheets, this.exists, keep);
    const out: Sheets = { ...this.sheets };
    if (!all) {
      for (const id of this.deferred) {
        if (this.stored[id] && Object.keys(out).length < MAX_SHEETS) out[id] = this.stored[id];
        else delete out[id];
      }
    }
    if (!this.storage) return;
    try {
      this.storage.setItem(STORE_KEY, JSON.stringify(serialize(out)));
      this.stored = out;
      this.unsaved.clear();
      if (all) this.deferred.clear();
    } catch {
      // 書けなくても、メモリの中では使える（次に書くときにまた書く）
    }
  }

  private snapshot() {
    return JSON.stringify({ l: this.isLocked, s: serialize(this.sheets) });
  }

  private notifyIf(before: string) {
    if (this.snapshot() === before) return;
    for (const fn of this.listeners) fn();
  }
}

// 置けるか（この順に見る。置けるなら null）
export function waypointPlaceBlock(o: { ready: boolean; taken: boolean; locked: boolean; full: boolean }): 'locked' | 'loading' | 'taken' | 'full' | null {
  if (o.locked) return 'locked';
  if (!o.ready) return 'loading';
  if (o.taken) return 'taken';
  if (o.full) return 'full';
  return null;
}

// 棚のチップを作り直すかの比べに使う鍵（シートと番号の並びが同じなら同じ字）
export function waypointChipsKey(sheet: string, slots: readonly number[]): string {
  return `${sheet}|${slots.join(',')}`;
}

// 空いている一番小さい番号（無ければ -1）
export function freeWaypointSlot(used: readonly number[]): number {
  for (let slot = 0; slot < WAYPOINT_SLOTS; slot++) if (!used.includes(slot)) return slot;
  return -1;
}

// 番号を替えるメニューの行（1〜6 番の順。今の番号・使っている番号・空いた番号）
export function waypointSlotRows(current: number, used: readonly number[]): { slot: number; state: 'current' | 'used' | 'free' }[] {
  return Array.from({ length: WAYPOINT_SLOTS }, (_, slot) => ({
    slot,
    state: slot === current ? 'current' : used.includes(slot) ? 'used' : 'free',
  }));
}
