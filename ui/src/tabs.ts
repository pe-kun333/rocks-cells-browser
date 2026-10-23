// タブの一覧（UI 側の「台帳」）。ハニカム上の位置と、大きい表示での番号を持つ
//   ・タブはどれか1枚のシートに置く（sheet）。位置と番号はシートごと（別のシートの同じ位置には、別のタブを置ける）
import type { TabInfo } from './bridge';
import { type Hex, hexKey, nearestFree } from './hex';
import type { TabTrail } from './routes';
import { newTabUid } from './board-links';
import { MAIN_SHEET } from './sheets';
import { MAX_TAGS_PER_TAB, normalizeTags } from './tags';
import { type Reply, type ReplyAuthor, withoutReply, withReply } from './threads';
import type { TabNote } from './types';

// タブのセルの見え方（おまかせ・アイコン・画像・コメント・ページの画面）
export type TabLook = 'auto' | 'icon' | 'image' | 'comment' | 'page';
export const TAB_LOOKS: readonly { id: TabLook; label: string; hint: string }[] = [
  { id: 'auto', label: 'おまかせ', hint: '付けた画像とコメントを見せる（無ければアイコン）' },
  { id: 'icon', label: 'アイコン', hint: 'サイトのアイコン（無ければ頭の1文字）' },
  { id: 'image', label: '画像', hint: '付けた画像（無ければアイコン）' },
  { id: 'comment', label: 'コメント', hint: 'コメントを文字で（無ければ題名を薄く）' },
  { id: 'page', label: 'ページの画面', hint: '表示したページの縮図（まだ無ければアイコン）' },
];
export const isTabLook = (value: unknown): value is TabLook => TAB_LOOKS.some((l) => l.id === value);
export const MAX_TAB_COMMENT = 40;

// タブのコメント（1行・40文字まで）
export function cleanComment(text: unknown): string {
  return [...String(text ?? '').replace(/\s+/g, ' ').trim()].slice(0, MAX_TAB_COMMENT).join('');
}

export interface Tab {
  id: number; // C++ 側が振る番号（ずっと変わらない）
  uid: string; // 起動し直しても変わらない名前（盤面の関連の線が指す。session.json・アーカイブに残す）
  sheet: string; // 置いてあるシート
  pos: Hex; // ハニカム上の位置（シートの中で）
  order: number; // 大きい表示での番号（シートごとに 1, 2, 3...）
  title: string;
  url: string;
  favicon: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  asleep: boolean; // 休眠中（ページの中身を持っていない）
  suspended: boolean; // 一時停止中
  audible: boolean; // 音が出ている
  muted: boolean;
  keepAwake: boolean; // 「休眠させない」にしたタブ
  sleepBlocked: 'input' | null; // 休眠を見送った理由
  lastUsed: number; // 最後に表示していた時刻（ミリ秒）
  notes: TabNote[]; // このタブのメモ（新しいものが後ろ）
  readEdges: number; // 読み進み具合（六角形の辺 0〜6。6 で読み終えた）
  liked: number; // ♥ の段階（0〜3）
  tags: string[]; // タグ（六角メモと同じ決まり）
  island: string | null; // 入っている島の id
  trail: TabTrail | null; // 順路のどこにいるか
  image?: string; // セルに見せる画像（六角形スクショと同じ置き場所の ID）
  comment?: string; // セルに見せるひとこと
  look?: TabLook; // このタブだけの見え方（無ければ全体の見え方）
}

// タブの見た目（画像・コメント・見え方）。null は外す
export interface TabFace {
  image?: string | null;
  comment?: string;
  look?: TabLook | null;
}

export interface NewTab {
  uid?: string; // 前回の名前（無い・ほかのタブが使っていれば新しく振る）
  url: string;
  parentId: number | null; // 開いた元のタブ
  sheet?: string; // 置くシート（無ければ、開いた元のタブのシートか、今見ているシート）
  pos?: Hex; // 置きたい場所（ふさがっていればその近く）
  asleep?: boolean;
  title?: string;
  favicon?: string;
  keepAwake?: boolean;
  notes?: TabNote[];
  readEdges?: number;
  liked?: number;
  tags?: string[];
  island?: string | null;
  trail?: TabTrail | null;
  image?: string;
  comment?: string;
  look?: TabLook;
}

export class TabStore {
  activeId: number | null = null;
  // 今見ているシート（左サイドバーが決める。右サイドバーではメインのまま）
  sheetNow: () => string = () => MAIN_SHEET;
  // タブ以外でふさがっているセル（メモのセル・これから開くタブの場所）。新しいタブは、そこにも置かない
  blocked: (h: Hex, sheet: string) => boolean = () => false;
  // 閉じるのを頼んだタブ（まとめて閉じるとき、次に表示するタブに選ばない）
  readonly closing = new Set<number>();
  private readonly tabs = new Map<number, Tab>();
  private readonly listeners: (() => void)[] = [];

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  get size() {
    return this.tabs.size;
  }

  get active() {
    return this.activeId === null ? undefined : this.tabs.get(this.activeId);
  }

  get(id: number) {
    return this.tabs.get(id);
  }

  all() {
    return [...this.tabs.values()];
  }

  // すべてのタブ（シートの中の番号順。シートどうしは id の順）
  sorted() {
    return this.all().sort((a, b) => (a.sheet === b.sheet ? a.order - b.order : a.sheet < b.sheet ? -1 : 1));
  }

  // そのシートのタブ（番号順）
  inSheet(sheet: string) {
    return this.all()
      .filter((t) => t.sheet === sheet)
      .sort((a, b) => a.order - b.order);
  }

  tabAt(pos: Hex, sheet = this.sheetNow()) {
    const key = hexKey(pos);
    return this.all().find((t) => t.sheet === sheet && hexKey(t.pos) === key);
  }

  // 新しいタブを置く
  //   シート：指定 → 開いた元のタブのシート → 今見ているシート
  //   場所：指定の場所 → 開いた元のタブ → 今のタブ（同じシートなら）→ そのシートの最後のタブ → 中心、の近くの空きセル
  //   番号：開いた元のタブの直後（元が無いか別のシートなら、そのシートの最後）
  // 起動し直しても変わらない名前から、タブを探す
  byUid(uid: string): Tab | undefined {
    for (const tab of this.tabs.values()) if (tab.uid === uid) return tab;
    return undefined;
  }

  add(id: number, init: NewTab) {
    if (this.tabs.has(id)) return;
    const parentTab = init.parentId === null ? undefined : this.tabs.get(init.parentId);
    const sheet = init.sheet || parentTab?.sheet || this.sheetNow();
    const parent = parentTab?.sheet === sheet ? parentTab : undefined;
    const active = this.active?.sheet === sheet ? this.active : undefined;
    const list = this.inSheet(sheet);
    const anchor = init.pos ?? parent?.pos ?? active?.pos ?? list.at(-1)?.pos ?? { q: 0, r: 0 };
    const uid = init.uid && /^[0-9A-Za-z_-]{1,64}$/.test(init.uid) && !this.byUid(init.uid) ? init.uid : newTabUid();
    const tab: Tab = {
      uid,
      id,
      sheet,
      url: init.url,
      pos: nearestFree(anchor, (h) => this.tabAt(h, sheet) !== undefined || this.blocked(h, sheet)),
      order: 0,
      title: init.title ?? '',
      favicon: init.favicon ?? '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      asleep: init.asleep ?? false,
      suspended: false,
      audible: false,
      muted: false,
      keepAwake: init.keepAwake ?? false,
      sleepBlocked: null,
      lastUsed: Date.now(),
      notes: init.notes ?? [],
      readEdges: init.readEdges ?? 0,
      liked: init.liked ?? 0,
      tags: init.tags ?? [],
      island: init.island ?? null,
      trail: init.trail ?? null,
      ...(init.image ? { image: init.image } : {}),
      ...(init.comment ? { comment: cleanComment(init.comment) } : {}),
      ...(init.look ? { look: init.look } : {}),
    };
    list.splice(parent ? list.indexOf(parent) + 1 : list.length, 0, tab);
    this.tabs.set(id, tab);
    renumber(list);
    this.emit();
  }

  update(id: number, info: TabInfo) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (info.url !== undefined && info.url !== tab.url) tab.readEdges = 0; // 別のページへ移ったら、読み進みは最初から
    const { newDocument: _, ...fields } = info; // 知らせのためだけの値は、台帳に入れない
    Object.assign(tab, fields);
    this.emit();
  }

  // 画像・コメント・見え方を変える（undefined の項目はそのまま。null と空のコメントは外す）
  setFace(id: number, face: TabFace) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    if (face.image !== undefined) {
      if (face.image) tab.image = face.image;
      else delete tab.image;
    }
    if (face.comment !== undefined) {
      const comment = cleanComment(face.comment);
      if (comment) tab.comment = comment;
      else delete tab.comment;
    }
    if (face.look !== undefined) {
      if (face.look) tab.look = face.look;
      else delete tab.look;
    }
    this.emit();
  }

  // 読み進み具合。戻らない（いちばん先まで読んだところを覚える）
  setReadEdges(id: number, edges: number) {
    const tab = this.tabs.get(id);
    const value = Math.max(0, Math.min(6, Math.floor(edges)));
    if (!tab || value <= tab.readEdges) return;
    tab.readEdges = value;
    this.emit();
  }

  setLiked(id: number, liked: number) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.liked = Math.max(0, Math.min(3, liked));
    this.emit();
  }

  setTags(id: number, tags: string[]) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.tags = normalizeTags(tags);
    this.emit();
  }

  // いくつものタブにタグを足す（今あるタグは残す）
  addTags(changes: { id: number; tags: string[] }[]) {
    for (const { id, tags } of changes) {
      const tab = this.tabs.get(id);
      if (tab) tab.tags = normalizeTags([...tab.tags, ...tags]).slice(0, MAX_TAGS_PER_TAB);
    }
    this.emit();
  }

  // 島に入れる・島から出す（island = null）
  setIsland(ids: number[], island: string | null) {
    for (const id of ids) {
      const tab = this.tabs.get(id);
      if (tab) tab.island = island;
    }
    this.emit();
  }

  setTrail(id: number, trail: TabTrail | null) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.trail = trail;
    this.emit();
  }

  // いくつものセルを一度に動かす（入れ替えはしない。行き先は空いている前提。シートは変えない）
  setPositions(positions: Map<number, Hex>) {
    for (const [id, pos] of positions) {
      const tab = this.tabs.get(id);
      if (tab) tab.pos = { ...pos };
    }
    this.emit();
  }

  // タブを別のシートへ移す（行き先のセルは空いている前提）。番号は移した先の最後に、渡した順で
  moveToSheet(positions: Map<number, Hex>, sheet: string) {
    const from = new Set<string>();
    const moved: Tab[] = [];
    for (const [id, pos] of positions) {
      const tab = this.tabs.get(id);
      if (!tab) continue;
      if (tab.sheet !== sheet) from.add(tab.sheet);
      tab.pos = { ...pos };
      moved.push(tab);
    }
    const stay = this.inSheet(sheet).filter((t) => !moved.includes(t));
    for (const tab of moved) tab.sheet = sheet;
    renumber([...stay, ...moved]);
    for (const s of from) renumber(this.inSheet(s));
    this.emit();
  }

  // 表示するタブを切り替える。切り替える前のタブは「今まで使っていた」ことになる
  setActive(id: number) {
    const next = this.tabs.get(id);
    if (!next) return;
    const now = Date.now();
    if (this.active) this.active.lastUsed = now;
    next.lastUsed = now;
    next.sleepBlocked = null;
    this.activeId = id;
    this.emit();
  }

  setKeepAwake(id: number, keepAwake: boolean) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.keepAwake = keepAwake;
    this.emit();
  }

  addNote(id: number, note: TabNote) {
    const tab = this.tabs.get(id);
    if (!tab || tab.notes.some((n) => n.id === note.id)) return;
    tab.notes = [...tab.notes, note].slice(-50);
    this.emit();
  }

  // タブのメモのスレッドに返信を足す（足した返信を返す。足せなければ null）
  addNoteReply(id: number, noteId: string, parent: string | null, text: string, by?: ReplyAuthor): Reply | null {
    const note = this.tabs.get(id)?.notes.find((n) => n.id === noteId);
    if (!note) return null;
    const next = withReply(note.replies ?? [], parent, text, by);
    if (!next) return null;
    note.replies = next.replies;
    this.emit();
    return next.reply;
  }

  removeNoteReply(id: number, noteId: string, replyId: string) {
    const note = this.tabs.get(id)?.notes.find((n) => n.id === noteId);
    if (!note?.replies) return;
    note.replies = withoutReply(note.replies, replyId);
    this.emit();
  }

  removeNote(id: number, noteId: string) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.notes = tab.notes.filter((n) => n.id !== noteId);
    this.emit();
  }

  // タブを消す。消したのが表示中のタブなら、次に表示するタブの id を返す
  //   同じシートの、同じ番号（無ければ最後）のタブ。シートにタブが残っていなければ、ほかのシートで最後に使ったタブ（起きているタブを先に）
  //   閉じるのを頼んだタブ（closing）は選ばない
  remove(id: number): number | null {
    const tab = this.tabs.get(id);
    if (!tab) return null;
    this.tabs.delete(id);
    this.closing.delete(id);
    const list = this.inSheet(tab.sheet);
    renumber(list);
    let next: number | null = null;
    if (this.activeId === id) {
      this.activeId = null;
      const alive = (t: Tab) => !this.closing.has(t.id);
      const here = list.filter(alive);
      const after = list.slice(tab.order - 1).find(alive);
      const elsewhere = this.all()
        .filter(alive)
        .sort((a, b) => Number(a.asleep) - Number(b.asleep) || b.lastUsed - a.lastUsed)[0];
      next = (after ?? here.at(-1) ?? elsewhere)?.id ?? null;
    }
    this.emit();
    return next;
  }

  // セルを動かす（シートの中で）。行き先に別のタブがいれば場所を入れ替える
  moveTo(id: number, pos: Hex) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const other = this.tabAt(pos, tab.sheet);
    if (other && other !== tab) other.pos = tab.pos;
    tab.pos = pos;
    this.emit();
  }

  // 大きい表示での並び替え：シートの中の index 番目（0 始まり）に入れる
  moveInOrder(id: number, index: number) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    const list = this.inSheet(tab.sheet).filter((t) => t !== tab);
    list.splice(index, 0, tab);
    renumber(list);
    this.emit();
  }

  // 番号順で delta 個となりのタブ（今見ているシートの中で。端まで行ったら反対側へ回る）
  //   今のタブがほかのシートにあれば、このシートの最初（delta が負なら最後）のタブ。このシートにタブが無ければ、今のタブのシートで
  neighbor(delta: number): Tab | undefined {
    let list = this.inSheet(this.sheetNow());
    if (list.length === 0 && this.active) list = this.inSheet(this.active.sheet);
    if (list.length === 0) return undefined;
    const i = this.active ? list.indexOf(this.active) : -1;
    if (i < 0) return delta < 0 ? list.at(-1) : list[0];
    return list[(i + delta + list.length) % list.length];
  }

  // 他のサイドバーへ渡すための写し
  snapshot(): Tab[] {
    return this.sorted().map((t) => ({ ...t, pos: { ...t.pos }, notes: [...t.notes], tags: [...t.tags] }));
  }

  // 写しを受け取って、まるごと入れ替える（右サイドバー用）
  replaceAll(tabs: Tab[], activeId: number | null) {
    this.tabs.clear();
    for (const t of tabs) this.tabs.set(t.id, { ...t, sheet: t.sheet || MAIN_SHEET });
    this.activeId = activeId;
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

function renumber(list: Tab[]) {
  list.forEach((tab, i) => {
    tab.order = i + 1;
  });
}
