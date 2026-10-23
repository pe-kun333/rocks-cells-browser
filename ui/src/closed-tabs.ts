// 試し：最近閉じたタブ（左の下の棚「最近閉じた」）。新しい順に 20 件まで
//   保存先：ui-data\closed-tabs.json（URL と題名が残る。棚の「すべて消す」で消せる）
import { readData, writeData } from './data';
import type { Hex } from './hex';

const FILE = 'closed-tabs.json';
const MAX = 20;

export interface ClosedTab {
  key: string; // 一覧の中の印（閉じた時刻と番号）
  url: string;
  title: string;
  favicon: string;
  sheet: string;
  pos: Hex;
  at: number; // 閉じた時刻
}

function isClosedTab(v: unknown): v is ClosedTab {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const pos = o.pos as Record<string, unknown> | undefined;
  return (
    typeof o.key === 'string' &&
    typeof o.url === 'string' &&
    typeof o.title === 'string' &&
    typeof o.favicon === 'string' &&
    typeof o.sheet === 'string' &&
    typeof o.at === 'number' &&
    typeof pos === 'object' &&
    pos !== null &&
    typeof pos.q === 'number' &&
    typeof pos.r === 'number'
  );
}

// 開き直せる URL だけ残す（内部のページ・空のページは残さない）
export function isReopenable(url: string) {
  return /^(https?|file):/i.test(url);
}

export class ClosedTabStore {
  private items: ClosedTab[] = [];
  private loaded = false;
  private seq = 0;
  private readonly listeners: (() => void)[] = [];

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  list(): readonly ClosedTab[] {
    return this.items;
  }

  async load() {
    const saved = await readData<{ items?: unknown }>(FILE);
    const items = Array.isArray(saved?.items) ? saved.items.filter(isClosedTab).slice(0, MAX) : [];
    // 読み込む前に閉じたタブがあれば、先に並べる
    const hadNew = this.items.length > 0;
    const keys = new Set(this.items.map((t) => t.key));
    this.items = [...this.items, ...items.filter((t) => !keys.has(t.key))].slice(0, MAX);
    this.loaded = true;
    this.emit(hadNew);
  }

  add(tab: Omit<ClosedTab, 'key' | 'at'>) {
    if (!isReopenable(tab.url)) return;
    const at = Date.now();
    const item: ClosedTab = { ...tab, pos: { q: tab.pos.q, r: tab.pos.r }, title: tab.title.slice(0, 300), favicon: tab.favicon.startsWith('data:') ? '' : tab.favicon.slice(0, 2000), key: `${at}-${this.seq++}`, at };
    this.items = [item, ...this.items.filter((t) => t.url !== item.url || t.sheet !== item.sheet)].slice(0, MAX);
    this.emit(true);
  }

  take(key: string): ClosedTab | undefined {
    const item = this.items.find((t) => t.key === key);
    if (!item) return undefined;
    this.items = this.items.filter((t) => t.key !== key);
    this.emit(true);
    return item;
  }

  remove(key: string) {
    this.take(key);
  }

  clear() {
    this.items = [];
    this.emit(true);
  }

  private emit(save: boolean) {
    if (save && this.loaded) void writeData(FILE, { items: this.items });
    for (const fn of this.listeners) fn();
  }
}
