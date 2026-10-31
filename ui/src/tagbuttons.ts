// タグのボタン：よく使うタグを6つのボタンにして、押すだけで付ける・外す。6つで1組の「セット」に名前を付けて、いくつでも作って切り替える
//   ・相棒の頼みごとのボタン（ai/phrases.ts）と同じ考え：セットを切り替えると6つのボタンが入れかわるだけ（タグもタブも動かない）
//   ・左サイドバーと右サイドバーは別々に持つ（左はタブのセル・盤面のメモ、右はコメントと右のカード）
//   ・保存先：ui-data\tag-buttons-left.json・tag-buttons-right.json（書くのは、それぞれのサイドバーだけ。下の区画は、右のファイルを読むだけ〈カードの「＋タグ」の候補の上に出す。PinnedTagFeed〉）
import { t as tr } from './i18n';
import { request } from './bridge';
import { readData, writeData } from './data';
import { normalizeTag } from './tags';

export const TAG_BUTTONS = 6;
export const MAX_TAG_SETS = 12;
const NAME_MAX = 20;

export type TagSide = 'left' | 'right';

export interface TagButtonSet {
  id: string;
  name: string;
  tags: (string | null)[]; // いつも6つ（null は空き）。同じタグは1つのセットに1回だけ
}

export interface TagButtonBook {
  version: 1;
  current: string; // 使っているセット
  sets: TagButtonSet[];
}

export function defaultTagBook(): TagButtonBook {
  return { version: 1, current: 'usual', sets: [{ id: 'usual', name: 'いつもの', tags: emptySlots() }] };
}

const emptySlots = (): (string | null)[] => Array.from({ length: TAG_BUTTONS }, () => null);

export function cleanSetName(name: unknown): string {
  return [...String(name ?? '').replace(/\s+/g, ' ').trim()].slice(0, NAME_MAX).join('');
}

// 6つのボタンにそろえる（使えないタグ・2回目の同じタグは空きに）
export function normalizeSlots(raw: unknown): (string | null)[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  return Array.from({ length: TAG_BUTTONS }, (_, i) => {
    const tag = list[i] === null || list[i] === undefined ? '' : normalizeTag(list[i]);
    if (!tag || seen.has(tag)) return null;
    seen.add(tag);
    return tag;
  });
}

// 読み込んだもの（や編集したもの）を、使える形にそろえる
export function normalizeTagBook(v: unknown): TagButtonBook {
  if (typeof v !== 'object' || v === null) return defaultTagBook();
  const r = v as Record<string, unknown>;
  const sets: TagButtonSet[] = [];
  for (const [i, s] of (Array.isArray(r.sets) ? r.sets : []).entries()) {
    if (typeof s !== 'object' || s === null) continue;
    const o = s as Record<string, unknown>;
    let id = typeof o.id === 'string' && /^[0-9a-z_-]{1,40}$/i.test(o.id) ? o.id : `t${i}`;
    if (sets.some((x) => x.id === id)) id = newTagSetId();
    sets.push({ id, name: cleanSetName(o.name) || tr('セット{0}', { 0: sets.length + 1 }), tags: normalizeSlots(o.tags) });
    if (sets.length >= MAX_TAG_SETS) break;
  }
  if (sets.length === 0) return defaultTagBook();
  const current = sets.some((s) => s.id === r.current) ? (r.current as string) : sets[0].id;
  return { version: 1, current, sets };
}

export function newTagSetId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// 登録したタグ（今のセットの名前と、空きを除いた並び。1 つ以上）。「＋タグ」の候補の上に出す
export interface PinnedTags {
  setName: string;
  tags: string[];
}

// 登録したタグの写しを渡す口（tag-pad.ts の tagArea の pinned）
//   get：今の写し（null は出さない）／watch：「＋タグ」の欄を開いている間、写しが変わったら fn を呼ぶ（返り値で止める）。開くたびに読み直しを頼む
export interface PinnedSource {
  get(): PinnedTags | null;
  watch(fn: () => void): () => void;
}

// 今のセットの登録したタグ。空き 6 つなら null
export function pinnedOf(book: TagButtonBook): PinnedTags | null {
  const set = book.sets.find((s) => s.id === book.current) ?? book.sets[0];
  const tags = set ? set.tags.filter((t): t is string => !!t) : [];
  return set && tags.length > 0 ? { setName: set.name, tags } : null;
}

// 下の区画が、右サイドバーのタグのボタンの今のセットを読むだけの写し（TagButtonStore を作らない：作ると書き手が二つになる）
//   読めなかった（時間切れ・壊れた JSON）ときは前の写しを残す。ファイルが無い（missing）・空き 6 つのときは null
//   右で切り替えた直後（300ms の書く待ちの間）は、一つ前の並びになりうる（右から下へ知らせる写しは作らない）
export class PinnedTagFeed implements PinnedSource {
  private value: PinnedTags | null = null;
  private seq = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly side: TagSide = 'right') {}

  get(): PinnedTags | null {
    return this.value;
  }

  watch(fn: () => void): () => void {
    this.listeners.add(fn);
    void this.reload();
    return () => {
      this.listeners.delete(fn);
    };
  }

  // 読み直す（区画を開いた・メモが替わった・「＋タグ」を押した）。後から頼んだ読みがあれば、前の読みの返事は捨てる
  async reload(): Promise<void> {
    const n = ++this.seq;
    const reply = await request((requestId) => ({ type: 'readData', name: `tag-buttons-${this.side}.json`, requestId }));
    if (n !== this.seq) return;
    let next: PinnedTags | null;
    if (reply?.type !== 'dataRead') return; // 返事なし（時間切れ）：前の写しを残す
    if (reply.text === null) {
      if (!reply.missing) return; // 開けなかった：前の写しを残す
      next = null;
    } else {
      let raw: unknown;
      try {
        raw = JSON.parse(reply.text);
      } catch {
        return; // 壊れた JSON：前の写しを残す
      }
      next = pinnedOf(normalizeTagBook(raw));
    }
    if (samePinned(next, this.value)) return;
    this.value = next;
    for (const fn of [...this.listeners]) fn();
  }
}

function samePinned(a: PinnedTags | null, b: PinnedTags | null): boolean {
  if (a === null || b === null) return a === b;
  return a.setName === b.setName && a.tags.length === b.tags.length && a.tags.every((t, i) => t === b.tags[i]);
}

export class TagButtonStore {
  private state: TagButtonBook = defaultTagBook();
  private loaded = false;
  private saveTimer = 0;
  private readonly listeners: (() => void)[] = [];
  private readonly failures: (() => void)[] = [];

  constructor(readonly side: TagSide) {}

  private get file() {
    return `tag-buttons-${this.side}.json`;
  }

  async load() {
    const saved = await readData<unknown>(this.file);
    if (saved !== null) this.state = normalizeTagBook(saved);
    this.loaded = true;
    this.emit();
  }

  get ready() {
    return this.loaded;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  // 保存できなかった（知らせる）
  onSaveFailed(fn: () => void) {
    this.failures.push(fn);
  }

  // 今の台帳（下の区画へ返す写し）
  get book(): TagButtonBook {
    return { version: 1, current: this.state.current, sets: this.state.sets.map((x) => ({ ...x, tags: [...x.tags] })) };
  }

  // 下の区画から頼まれた変更を当てる（決まりは applyTagOp と同じ）
  apply(op: TagButtonsOp) {
    switch (op.type) {
      case 'setCurrent':
        this.setCurrent(op.id);
        break;
      case 'replaceSet':
        this.replaceSet(op.id, { name: op.name, tags: op.tags });
        break;
      case 'addSet':
        this.addSet(op.name, op.tags);
        break;
      case 'removeSet':
        this.removeSet(op.id);
        break;
    }
  }

  get sets(): readonly TagButtonSet[] {
    return this.state.sets;
  }

  get current(): TagButtonSet {
    return this.state.sets.find((s) => s.id === this.state.current) ?? this.state.sets[0];
  }

  get canAddSet() {
    return this.state.sets.length < MAX_TAG_SETS;
  }

  // 変わったかどうかを見る印（描き直すかどうか）
  get key(): string {
    const set = this.current;
    return `${this.loaded ? 1 : 0}|${set.id}|${set.name}|${set.tags.join('\u0001')}|${this.state.sets.length}`;
  }

  setCurrent(id: string) {
    if (id === this.state.current || !this.state.sets.some((s) => s.id === id)) return;
    this.state.current = id;
    this.changed();
  }

  // 空いている最初のボタン（無ければ -1）
  firstEmpty(): number {
    return this.current.tags.indexOf(null);
  }

  // ボタン slot にタグを入れる（同じセットのほかのボタンにあれば、そこと入れ替える）
  assign(slot: number, value: string) {
    const tag = normalizeTag(value);
    if (!tag || slot < 0 || slot >= TAG_BUTTONS) return;
    const tags = [...this.current.tags];
    const at = tags.indexOf(tag);
    if (at === slot) return;
    if (at >= 0) tags[at] = tags[slot];
    tags[slot] = tag;
    this.replaceCurrent({ tags });
  }

  clear(slot: number) {
    if (this.current.tags[slot] === null || this.current.tags[slot] === undefined) return;
    const tags = [...this.current.tags];
    tags[slot] = null;
    this.replaceCurrent({ tags });
  }

  // ボタンの場所を入れ替える
  swap(a: number, b: number) {
    if (a === b || a < 0 || b < 0 || a >= TAG_BUTTONS || b >= TAG_BUTTONS) return;
    const tags = [...this.current.tags];
    [tags[a], tags[b]] = [tags[b], tags[a]];
    this.replaceCurrent({ tags });
  }

  // 新しいセット（tags があれば、その並びで）を作って、使うセットにする
  addSet(name: string, tags?: (string | null)[]): TagButtonSet | null {
    if (!this.canAddSet) return null;
    const set: TagButtonSet = { id: newTagSetId(), name: cleanSetName(name) || tr('セット{0}', { 0: this.state.sets.length + 1 }), tags: tags ? normalizeSlots(tags) : emptySlots() };
    this.state.sets = [...this.state.sets, set];
    this.state.current = set.id;
    this.changed();
    return set;
  }

  renameSet(id: string, name: string) {
    const clean = cleanSetName(name);
    const set = this.state.sets.find((s) => s.id === id);
    if (!set || !clean || clean === set.name) return;
    this.state.sets = this.state.sets.map((s) => (s.id === id ? { ...s, name: clean } : s));
    this.changed();
  }

  // セットを消す（最後の1つは消さない）
  removeSet(id: string) {
    if (this.state.sets.length <= 1 || !this.state.sets.some((s) => s.id === id)) return;
    const at = this.state.sets.findIndex((s) => s.id === id);
    this.state.sets = this.state.sets.filter((s) => s.id !== id);
    if (this.state.current === id) this.state.current = this.state.sets[Math.max(0, at - 1)].id;
    this.changed();
  }

  // 使っているセットの並びを書き換える（ボタンの登録・入れ替え・空き）
  replaceCurrent(change: { name?: string; tags?: (string | null)[] }) {
    this.replaceSet(this.current.id, change);
  }

  // そのセットの名前と並びを、まとめて書き換える（編集の欄の「保存」は、開いたときのセットに書く）。変えたら true
  replaceSet(id: string, change: { name?: string; tags?: (string | null)[] }): boolean {
    const set = this.state.sets.find((s) => s.id === id);
    if (!set) return false;
    const next: TagButtonSet = {
      ...set,
      name: change.name !== undefined ? cleanSetName(change.name) || set.name : set.name,
      tags: change.tags ? normalizeSlots(change.tags) : set.tags,
    };
    if (next.name === set.name && next.tags.every((t, i) => t === set.tags[i])) return false;
    this.state.sets = this.state.sets.map((s) => (s.id === id ? next : s));
    this.changed();
    return true;
  }

  private changed() {
    this.emit();
    if (!this.loaded) return; // 読み込む前に書くと、前のボタンを消してしまう
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void writeData(this.file, this.state).then((ok) => {
        if (!ok) for (const fn of this.failures) fn();
      });
    }, 300);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

// ---------- 下の区画のカードから、右のタグのボタン（セット）を変える ----------
//   書き手は右サイドバー（TagButtonStore('right')）のまま：下の区画は「変えて」と relay で頼み、右が変えて、今の台帳を返す
//   右がいない（返事が来ない）ときだけ、下の区画が自分でファイルに書く（そのとき右は動いていないので、書き手が二つにならない）
export type TagButtonsOp =
  | { type: 'setCurrent'; id: string }
  | { type: 'replaceSet'; id: string; name?: string; tags?: (string | null)[] }
  | { type: 'addSet'; name: string; tags?: (string | null)[] }
  | { type: 'removeSet'; id: string };

// 台帳に一つの変更を当てた、新しい台帳（TagButtonStore と同じ決まり。当てられなければ同じもの）
export function applyTagOp(book: TagButtonBook, op: TagButtonsOp): TagButtonBook {
  const b = normalizeTagBook(book);
  switch (op.type) {
    case 'setCurrent':
      return b.sets.some((s) => s.id === op.id) ? { ...b, current: op.id } : b;
    case 'replaceSet':
      return {
        ...b,
        sets: b.sets.map((s) =>
          s.id === op.id ? { ...s, name: op.name !== undefined ? cleanSetName(op.name) || s.name : s.name, tags: op.tags ? normalizeSlots(op.tags) : s.tags } : s,
        ),
      };
    case 'addSet': {
      if (b.sets.length >= MAX_TAG_SETS) return b;
      const set: TagButtonSet = { id: newTagSetId(), name: cleanSetName(op.name) || tr('セット{0}', { 0: b.sets.length + 1 }), tags: op.tags ? normalizeSlots(op.tags) : emptySlots() };
      return { ...b, sets: [...b.sets, set], current: set.id };
    }
    case 'removeSet': {
      if (b.sets.length <= 1 || !b.sets.some((s) => s.id === op.id)) return b;
      const at = b.sets.findIndex((s) => s.id === op.id);
      const sets = b.sets.filter((s) => s.id !== op.id);
      return { ...b, sets, current: b.current === op.id ? sets[Math.max(0, at - 1)].id : b.current };
    }
  }
}

// 下の区画が持つ、右のタグのボタンの台帳の写し（読み直す・変えてと頼む）
export class TagBookFeed {
  private value: TagButtonBook = defaultTagBook();
  private loaded = false;
  private seq = 0;
  private readSeq = 0;
  private readonly waiting = new Map<number, number>(); // 頼んだ番号 → 時間切れのタイマー
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly sendOp: (op: TagButtonsOp, seq: number) => void,
    private readonly side: TagSide = 'right',
  ) {}

  get book(): TagButtonBook {
    return this.value;
  }

  get ready() {
    return this.loaded;
  }

  get current(): TagButtonSet {
    return this.value.sets.find((s) => s.id === this.value.current) ?? this.value.sets[0];
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async reload(): Promise<void> {
    if (this.waiting.size > 0) return; // 頼んだ返事を待つ間は、古いファイルで上書きしない
    const n = ++this.readSeq;
    const reply = await request((requestId) => ({ type: 'readData', name: `tag-buttons-${this.side}.json`, requestId }));
    if (n !== this.readSeq || this.waiting.size > 0 || reply?.type !== 'dataRead') return;
    let next: TagButtonBook;
    if (reply.text === null) {
      if (!reply.missing) return;
      next = defaultTagBook();
    } else {
      try {
        next = normalizeTagBook(JSON.parse(reply.text));
      } catch {
        return;
      }
    }
    this.loaded = true;
    this.set(next);
  }

  // 変えて、と頼む（すぐ写しに当てて描く。右の返事で置き換える。返事が無ければ自分で書く）
  apply(op: TagButtonsOp) {
    const seq = ++this.seq;
    this.readSeq++; // 読みかけの古い返事は捨てる
    this.set(applyTagOp(this.value, op));
    this.sendOp(op, seq);
    const timer = window.setTimeout(() => {
      if (!this.waiting.delete(seq)) return;
      if (this.loaded) void writeData(`tag-buttons-${this.side}.json`, this.value); // 右がいない：自分で書く（読み終えていなければ書かない）
    }, 1500);
    this.waiting.set(seq, timer);
  }

  // 右の返事（変えたあとの台帳）
  done(seq: number, book: unknown) {
    const timer = this.waiting.get(seq);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    this.waiting.delete(seq);
    this.loaded = true;
    if (this.waiting.size === 0) this.set(normalizeTagBook(book)); // まだ待ちがあれば、最後の返事で置き換える
  }

  private set(next: TagButtonBook) {
    const same = JSON.stringify(next) === JSON.stringify(this.value);
    this.value = next;
    if (!same) for (const fn of [...this.listeners]) fn();
  }
}
