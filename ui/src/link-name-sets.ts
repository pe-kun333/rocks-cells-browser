// 関連の「呼称セット」：6 つの種類（根拠・反論・続き・同じ・疑問・補足）に付ける名前の組
//   ・台帳は 1 つで、全部のメモタブで共通（ui-data\link-name-sets.json）。どのセットを使うかはメモごと（MemoCell.linkSet）
//   ・線に保存するのは、これまでどおり種類の id だけ。名前は線に入れない
//   ・書くのは下のメモの区画だけ（LinkNameSetStore を作るのはそこだけ）。左はメモの linkSet を書くだけで、このファイルは書かない
//   ・左は起動時にこのファイルを読むだけ（新しいメモに付ける id が、まだ台帳にあるかを見る。決まりは link-set-for-new.ts）。あとの増減は下の区画が知らせる
//   ・セットを選んでいないメモは、今までどおりそのメモの linkNames（無ければ元の名前）
import { t } from './i18n';
import { readDataChecked, writeData } from './data';
import { type LinkKind, type LinkKindNames, parseLinkKindNames } from './memo-card-links';

export const LINK_NAME_SETS_FILE = 'link-name-sets.json';
export const MAX_LINK_NAME_SETS = 12;
export const LINK_NAME_SET_NAME_MAX = 20;

const SET_ID = /^[0-9a-z_-]{1,40}$/i;

export interface LinkNameSet {
  id: string;
  name: string;
  names: LinkKindNames; // 元の名前と違うものだけ。空なら 6 つとも元の名前
}

export interface LinkNameBook {
  version: 1;
  sets: LinkNameSet[];
}

export interface LinkNameSetResult {
  book: LinkNameBook;
  id: string | null; // 当たったセット。足せなかった・見つからないときは null
  changed: boolean;
}

export type LinkNameSetOp =
  | { type: 'add'; name: string; names?: LinkKindNames }
  | { type: 'rename'; id: string; name: string }
  | { type: 'setNames'; id: string; names: LinkKindNames }
  | { type: 'remove'; id: string };

export function emptyLinkNameBook(): LinkNameBook {
  return { version: 1, sets: [] };
}

export function cleanLinkNameSetName(name: unknown): string {
  return [...String(name ?? '').replace(/\s+/g, ' ').trim()].slice(0, LINK_NAME_SET_NAME_MAX).join('');
}

export function parseLinkSetId(raw: unknown): string | undefined {
  return typeof raw === 'string' && SET_ID.test(raw) ? raw : undefined;
}

export function newLinkNameSetId(): string {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// 読み込んだ台帳を、使える形にそろえる（知らない項目・壊れたセットは読み飛ばす。version が 1 でなくても、sets があれば取る）
export function normalizeLinkNameBook(raw: unknown): LinkNameBook {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptyLinkNameBook();
  const sets: LinkNameSet[] = [];
  const list = Array.isArray((raw as { sets?: unknown }).sets) ? (raw as { sets: unknown[] }).sets : [];
  for (const [i, item] of list.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    let id = parseLinkSetId(o.id) ?? `n${i}`;
    if (sets.some((s) => s.id === id)) id = newLinkNameSetId();
    sets.push({ id, name: cleanLinkNameSetName(o.name) || t('セット{0}', { 0: sets.length + 1 }), names: parseLinkKindNames(o.names) ?? {} });
    if (sets.length >= MAX_LINK_NAME_SETS) break;
  }
  return { version: 1, sets };
}

export function chosenLinkNameSet(book: LinkNameBook, setId: string | undefined): LinkNameSet | undefined {
  if (!setId) return undefined;
  return book.sets.find((s) => s.id === setId);
}

// 画面に出す名前（変えた種類だけ。undefined は 6 つとも元の名前）
//   セットを選んでいて、そのセットが台帳にあれば、セットの名前（このメモの linkNames は使わない）
//   選んでいない・セットがもう無いときは、このメモの linkNames（今までどおり）
export function resolvedLinkKindNames(
  choice: { linkNames?: LinkKindNames; linkSet?: string } | null | undefined,
  book: LinkNameBook,
): LinkKindNames | undefined {
  if (choice?.linkSet) {
    const set = chosenLinkNameSet(book, choice.linkSet);
    if (set) return Object.keys(set.names).length > 0 ? set.names : undefined;
  }
  return choice?.linkNames;
}

function sameNames(a: LinkKindNames, b: LinkKindNames): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key as LinkKind] !== b[key as LinkKind]) return false;
  return true;
}

// 台帳に一つの変更を当てた、新しい台帳（元の台帳は変えない）
export function applyLinkNameSetOp(book: LinkNameBook, op: LinkNameSetOp): LinkNameSetResult {
  const b = normalizeLinkNameBook(book);
  switch (op.type) {
    case 'add': {
      if (b.sets.length >= MAX_LINK_NAME_SETS) return { book: b, id: null, changed: false };
      const set: LinkNameSet = {
        id: newLinkNameSetId(),
        name: cleanLinkNameSetName(op.name) || t('セット{0}', { 0: b.sets.length + 1 }),
        names: parseLinkKindNames(op.names) ?? {},
      };
      return { book: { version: 1, sets: [...b.sets, set] }, id: set.id, changed: true };
    }
    case 'rename': {
      const set = b.sets.find((s) => s.id === op.id);
      const name = cleanLinkNameSetName(op.name);
      if (!set || !name || name === set.name) return { book: b, id: set?.id ?? null, changed: false };
      return { book: { version: 1, sets: b.sets.map((s) => (s.id === op.id ? { ...s, name } : s)) }, id: set.id, changed: true };
    }
    case 'setNames': {
      const set = b.sets.find((s) => s.id === op.id);
      if (!set) return { book: b, id: null, changed: false };
      const names = parseLinkKindNames(op.names) ?? {};
      if (sameNames(names, set.names)) return { book: b, id: set.id, changed: false };
      return { book: { version: 1, sets: b.sets.map((s) => (s.id === op.id ? { ...s, names } : s)) }, id: set.id, changed: true };
    }
    case 'remove': {
      if (!b.sets.some((s) => s.id === op.id)) return { book: b, id: null, changed: false };
      return { book: { version: 1, sets: b.sets.filter((s) => s.id !== op.id) }, id: op.id, changed: true };
    }
  }
}

// 下のメモの区画が持つ台帳（この 1 か所だけが link-name-sets.json を書く）
export class LinkNameSetStore {
  private state: LinkNameBook = emptyLinkNameBook();
  private loaded = false;
  private writable = false;
  private dirty = false;
  private saveTimer = 0;
  private readonly listeners: (() => void)[] = [];
  private readonly failures: (() => void)[] = [];

  async load(): Promise<void> {
    const read = await readDataChecked<unknown>(LINK_NAME_SETS_FILE);
    if (read.status === 'ok') this.state = normalizeLinkNameBook(read.value);
    else if (read.status === 'missing') this.state = emptyLinkNameBook();
    this.writable = read.status !== 'failed';
    this.loaded = true;
    this.dirty = false;
    this.emit();
  }

  get ready(): boolean {
    return this.loaded;
  }

  get canWrite(): boolean {
    return this.loaded && this.writable;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  onSaveFailed(fn: () => void): void {
    this.failures.push(fn);
  }

  get book(): LinkNameBook {
    return { version: 1, sets: this.state.sets.map((s) => ({ ...s, names: { ...s.names } })) };
  }

  // 変えたセットの id。読めない・当てられなかったときは null（台帳は変えない）
  apply(op: LinkNameSetOp): string | null {
    if (!this.loaded || !this.writable) return null;
    const result = applyLinkNameSetOp(this.state, op);
    if (!result.changed || !result.id) return result.id;
    this.state = result.book;
    this.changed();
    return result.id;
  }

  flush(): void {
    if (!this.dirty || !this.loaded || !this.writable) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    this.dirty = false;
    void writeData(LINK_NAME_SETS_FILE, this.state).then((ok) => {
      if (ok) return;
      this.dirty = true;
      for (const fn of this.failures) fn();
    });
  }

  private changed(): void {
    this.dirty = true;
    this.emit();
    if (!this.loaded || !this.writable) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flush(), 300);
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
