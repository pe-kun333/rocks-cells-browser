// シートを使った記録（docs/ideas-sheet-folders.md の候補 3）
//   ・シートごとの最後に見た時刻：起動し直しても「最近見た順」（棚の「シート」・「シート『…』へ移す」の 5 つ）を保つ
//   ・最後にセルを移した先（3 つまで）：移すメニューの頭に出す
//   ・置き場は左の画面の localStorage だけ（シートのボタンと同じ。session.json も ui-data も変えない）
import { isSheetId } from './sheets';

const STORE_KEY = 'honeycomb.sheetUse';
export const MAX_MOVED = 3;
const MAX_SEEN = 200; // シートは 100 枚まで。消えたシートの分が少し残ってもよい数

export interface SheetUseState {
  seen: Record<string, number>; // シートの id → 最後に見た時刻
  moved: string[]; // 最後にセルを移した先（新しい順）
}

interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// 保存してあった中身を確かめながら読む（知らない形・壊れた値は捨てる）
export function parseSheetUse(raw: unknown): SheetUseState {
  const state: SheetUseState = { seen: {}, moved: [] };
  if (!raw || typeof raw !== 'object') return state;
  const x = raw as { seen?: unknown; moved?: unknown };
  if (x.seen && typeof x.seen === 'object') {
    const pairs = Object.entries(x.seen as Record<string, unknown>)
      .filter((p): p is [string, number] => isSheetId(p[0]) && typeof p[1] === 'number' && Number.isFinite(p[1]) && p[1] > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SEEN);
    for (const [id, at] of pairs) state.seen[id] = at;
  }
  if (Array.isArray(x.moved)) {
    for (const id of x.moved) if (isSheetId(id) && !state.moved.includes(id) && state.moved.length < MAX_MOVED) state.moved.push(id);
  }
  return state;
}

export class SheetUse {
  private state: SheetUseState = { seen: {}, moved: [] };

  constructor(private readonly storage: KeyValue | null = typeof localStorage === 'undefined' ? null : localStorage) {
    try {
      this.state = parseSheetUse(JSON.parse(this.storage?.getItem(STORE_KEY) ?? 'null'));
    } catch {
      // 読めなくても、今は使える（最近の順は作った順から始まる）
    }
  }

  seenAt(id: string): number | undefined {
    return this.state.seen[id];
  }

  // 今そのシートを見ている（移ってきた・移る前）
  markSeen(id: string, at = Date.now()) {
    if (!isSheetId(id) || this.state.seen[id] === at) return;
    this.state.seen[id] = at;
    this.save();
  }

  // セルをそのシートへ移した
  markMoved(id: string) {
    if (!isSheetId(id)) return;
    this.state.moved = [id, ...this.state.moved.filter((m) => m !== id)].slice(0, MAX_MOVED);
    this.save();
  }

  // 最後に移した先（新しい順。今あるシートだけ）
  moved(exists: (id: string) => boolean): string[] {
    return this.state.moved.filter(exists);
  }

  // 消えたシートを外す（台帳を読み終えてから。読む前に外すと、覚えていた順が消える）
  prune(exists: (id: string) => boolean) {
    let changed = false;
    for (const id of Object.keys(this.state.seen)) {
      if (exists(id)) continue;
      delete this.state.seen[id];
      changed = true;
    }
    const moved = this.state.moved.filter(exists);
    if (moved.length !== this.state.moved.length) {
      this.state.moved = moved;
      changed = true;
    }
    if (changed) this.save();
  }

  private save() {
    try {
      this.storage?.setItem(STORE_KEY, JSON.stringify({ version: 1, seen: this.state.seen, moved: this.state.moved }));
    } catch {
      // 保存できなくても、今は使える
    }
  }
}
