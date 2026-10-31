// 右サイドバーの「メモ」の区画で使うシート：タブ（6つまで）と、シートのセット（保存したタブのシートの組）
//   ・シートそのものは左サイドバーが持つ（ここは id の並びと、セットの名前だけ）
//   ・タブのシートを「セットに保存」すると、そのシートはタブから外れてセットの一覧に入り、タブには新しい空のシートが1つ入る
//   ・セットを開くと、そのシートがタブに戻り、セットは一覧から外れる（シートはタブとセットの間を行き来する）
//   ・保存先：ui-data\right-sheets.json
import { t as tr } from './i18n';
import { readData, writeData } from './data';
import { isSheetId, RIGHT_MEMO_SHEET } from './sheets';

export const MAX_TABS = 6;
const MAX_SETS = 100;
const MAX_SET_NAME = 30;
const MAX_MADE = 200;
const FILE = 'right-sheets.json';

export interface SheetSet {
  id: string;
  name: string;
  sheets: string[]; // シートの id（タブの並び）
  at: number; // 保存した時刻
}

interface State {
  tabs: string[];
  active: string;
  sets: SheetSet[]; // 新しい順
  made: string[]; // 右で作ったシート（何も書かずにタブから外れたら、左で片づけてもらう）
}

export class RightSheetStore {
  private state: State = { tabs: [RIGHT_MEMO_SHEET], active: RIGHT_MEMO_SHEET, sets: [], made: [] };
  private loaded = false;
  private saveTimer = 0;
  private readonly listeners: (() => void)[] = [];

  async load() {
    const saved = await readData<unknown>(FILE);
    const parsed = parseState(saved);
    if (parsed) this.state = parsed;
    this.loaded = true;
    this.emit();
  }

  get ready() {
    return this.loaded;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  get tabs(): readonly string[] {
    return this.state.tabs;
  }

  get active() {
    return this.state.active;
  }

  get sets(): readonly SheetSet[] {
    return this.state.sets;
  }

  get canSaveSet() {
    return this.state.sets.length < MAX_SETS;
  }

  // 右で作ったシートとして覚える
  markMade(id: string) {
    if (this.state.made.includes(id)) return;
    this.state.made = [...this.state.made, id].slice(-MAX_MADE);
    this.changed();
  }

  isMade(id: string) {
    return this.state.made.includes(id);
  }

  // 片づけた（または書いた）ので、もう覚えておかない
  forget(id: string) {
    if (!this.state.made.includes(id)) return;
    this.state.made = this.state.made.filter((m) => m !== id);
    this.changed();
  }

  // タブにもセットにも無いシート（右で作ったもの）
  private loose(ids: readonly string[]) {
    const kept = new Set([...this.state.tabs, ...this.state.sets.flatMap((s) => s.sheets)]);
    return ids.filter((id) => !kept.has(id) && this.state.made.includes(id));
  }

  setActive(id: string) {
    if (!this.state.tabs.includes(id) || this.state.active === id) return;
    this.state.active = id;
    this.changed();
  }

  // タブに足して、そのシートを見る（6つまで）
  addTab(id: string): boolean {
    if (this.state.tabs.includes(id)) {
      this.setActive(id);
      return true;
    }
    if (this.state.tabs.length >= MAX_TABS) return false;
    this.state.tabs = [...this.state.tabs, id];
    this.state.active = id;
    this.changed();
    return true;
  }

  // タブから外す（シートは消えない）。最後の1つは外さない。戻り値：タブにもセットにも無くなった、右で作ったシート
  removeTab(id: string): string[] {
    if (this.state.tabs.length <= 1 || !this.state.tabs.includes(id)) return [];
    const at = this.state.tabs.indexOf(id);
    this.state.tabs = this.state.tabs.filter((t) => t !== id);
    if (this.state.active === id) this.state.active = this.state.tabs[Math.max(0, at - 1)];
    this.changed();
    return this.loose([id]);
  }

  // 今のタブのシートをセットに保存し、タブには新しい空のシート（freshId）を1つ入れる
  saveSet(name: string, freshId: string): SheetSet | null {
    if (this.state.sets.length >= MAX_SETS) return null;
    const set: SheetSet = { id: newSetId(), name: cleanName(name) || tr('シートのセット'), sheets: [...this.state.tabs], at: Date.now() };
    this.state.sets = [set, ...this.state.sets];
    this.state.tabs = [freshId];
    this.state.active = freshId;
    this.changed();
    return set;
  }

  // セットを開く：そのシートをタブに戻し、セットは一覧から外す。saveCurrentAs があれば、今のタブを先にセットに保存する
  //   戻り値の dropped：タブにもセットにも無くなった、右で作ったシート
  openSet(setId: string, saveCurrentAs: string | null): { set: SheetSet; dropped: string[] } | null {
    const set = this.state.sets.find((s) => s.id === setId);
    if (!set || set.sheets.length === 0) return null;
    const before = [...this.state.tabs];
    let sets = this.state.sets.filter((s) => s.id !== setId);
    if (saveCurrentAs !== null && this.state.tabs.length > 0) {
      sets = [{ id: newSetId(), name: cleanName(saveCurrentAs) || tr('シートのセット'), sheets: [...this.state.tabs], at: Date.now() }, ...sets].slice(0, MAX_SETS);
    }
    this.state.sets = sets;
    this.state.tabs = set.sheets.slice(0, MAX_TABS);
    this.state.active = this.state.tabs[0];
    this.changed();
    return { set, dropped: this.loose(before) };
  }

  removeSet(setId: string) {
    const before = this.state.sets.length;
    this.state.sets = this.state.sets.filter((s) => s.id !== setId);
    if (this.state.sets.length !== before) this.changed();
  }

  // 左で消したシートを、タブとセットから外す（keep：まだ左に届いていない、右で作ったばかりのシート）
  prune(exists: (id: string) => boolean, keep: ReadonlySet<string>) {
    const ok = (id: string) => id === RIGHT_MEMO_SHEET || keep.has(id) || exists(id);
    const tabs = this.state.tabs.filter(ok);
    const sets = this.state.sets.map((s) => ({ ...s, sheets: s.sheets.filter(ok) })).filter((s) => s.sheets.length > 0);
    const changed = tabs.length !== this.state.tabs.length || sets.length !== this.state.sets.length || sets.some((s, i) => s.sheets.length !== this.state.sets[i].sheets.length);
    if (!changed) return;
    this.state.tabs = tabs.length > 0 ? tabs : [RIGHT_MEMO_SHEET];
    if (!this.state.tabs.includes(this.state.active)) this.state.active = this.state.tabs[0];
    this.state.sets = sets;
    this.changed();
  }

  private changed() {
    this.emit();
    if (!this.loaded) return; // 読み込む前に書くと、前の並びを消してしまう
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void writeData(FILE, { version: 1, ...this.state }), 300);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

function newSetId() {
  return `ss${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function cleanName(name: string) {
  return [...String(name ?? '').replace(/\s+/g, ' ').trim()].slice(0, MAX_SET_NAME).join('');
}

function ids(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isSheetId))].slice(0, max);
}

// 左の盤面から、セットの名前と中のシートだけを読む（ここでは保存しない。開いてもタブは動かない）
export function sheetSetsIn(raw: unknown): { id: string; name: string; sheets: string[] }[] {
  const state = parseState(raw);
  if (!state) return [];
  return state.sets.map((set) => ({ id: set.id, name: set.name, sheets: [...set.sheets] }));
}

function parseState(raw: unknown): State | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;
  const tabs = ids(r.tabs, MAX_TABS);
  const sets: SheetSet[] = [];
  for (const s of Array.isArray(r.sets) ? r.sets : []) {
    if (typeof s !== 'object' || s === null) continue;
    const x = s as Record<string, unknown>;
    const sheets = ids(x.sheets, MAX_TABS);
    if (typeof x.id !== 'string' || sheets.length === 0 || sets.some((t) => t.id === x.id)) continue;
    sets.push({ id: x.id, name: typeof x.name === 'string' ? cleanName(x.name) || tr('シートのセット') : tr('シートのセット'), sheets, at: typeof x.at === 'number' ? x.at : 0 });
  }
  const safeTabs = tabs.length > 0 ? tabs : [RIGHT_MEMO_SHEET];
  const active = typeof r.active === 'string' && safeTabs.includes(r.active) ? r.active : safeTabs[0];
  return { tabs: safeTabs, active, sets: sets.slice(0, MAX_SETS), made: ids(r.made, MAX_MADE) };
}
