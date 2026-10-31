// 右サイドバーの「タグごとの一覧」：タグごとにまとめて、タブ（ページ）とメモのセルを並べる
//   ・まとまりの順：右のタグのボタンの順／左のタグのボタンの順／数の多い順
//     （ボタンのタグの後は、その他のタグを数の多い順に。最後に「タグなし」）。1つに2つのタグがあれば、両方のまとまりに出る
//   ・まとまりの中の並べ方：盤面の番号順／最近使った順／名前順（タブが先、メモのセルが後）
//   ・タブを押すと、そのページを表示（左の盤面も、そのタブのシートへ）。メモを押すと、左でそのメモを開く
//   ・見出しの ◎：そのタグのタブだけを、左の盤面で目立たせる（もう一度押すと戻る）
import { t as tr } from '../i18n';
import type { MemoIndexItem } from '../memocells';
import { MAIN_SHEET, type Sheet } from '../sheets';
import type { Tab } from '../tabs';
import { visibleTags } from '../grok-cards-tags';
import { tagColor } from '../tags';
import { el, hostOf, initialOf } from '../util';

export type TagGroupOrder = 'right' | 'left' | 'count';
export type TagSort = 'order' | 'recent' | 'name';

export interface TagButtonsView {
  name: string; // セットの名前
  tags: readonly (string | null)[];
}

export interface TagIndexDeps {
  tabs(): readonly Tab[];
  activeId(): number | null;
  sheets(): readonly Sheet[];
  memos(): readonly MemoIndexItem[] | null; // null：まだ左から届いていない
  rightButtons(): TagButtonsView;
  leftButtons(): TagButtonsView | null; // null：まだ左から届いていない
  highlightTag(): string | null;
  activate(id: number): void;
  showMemo(id: string): void;
  highlight(tag: string | null): void;
}

interface Prefs {
  collapsed: boolean;
  order: TagGroupOrder;
  sort: TagSort;
  open: Record<string, boolean>; // まとまりごとに、開いた・閉じた（無ければ、ボタンのタグだけ開く）
}

interface Group {
  key: string; // タグ（タグなしは NONE）
  tag: string | null;
  button: boolean; // タグのボタンにあるタグ
  tabs: Tab[];
  memos: MemoIndexItem[];
}

const PREFS_KEY = 'honeycomb.tagIndex';
const NONE = '#none'; // 「タグなし」のまとまり（normalizeTag は # を取り除くので、本当のタグとは重ならない）
const ROWS = 12; // まとまりに最初に出す行の数（「ほか n 件」で全部）
const MAX_OPEN_PREFS = 200;
const ORDER_LABELS: Record<TagSort, string> = { order: tr('盤面の番号順'), recent: tr('最近使った順'), name: tr('名前順') };

export class TagIndex {
  readonly element = el('section', 'panel-section tag-index');
  private prefs: Prefs = loadPrefs();
  private readonly full = new Set<string>(); // 「ほか n 件」を開いたまとまり
  private readonly brokenIcons = new Set<string>(); // 読めなかったファビコン
  private lastKey = '';
  private readonly sub = el('span', 'tag-index-sub');
  private readonly fold = el('button', 'tag-index-fold');
  private readonly head = el('div', 'tag-index-head');
  private readonly body = el('div', 'tag-index-body');
  private readonly groupSelect = el('select', 'tag-index-select');
  private readonly sortSelect = el('select', 'tag-index-select');
  private readonly groups = el('div', 'tag-index-groups');

  constructor(private readonly deps: TagIndexDeps) {
    this.element.setAttribute('aria-label', 'タグごとの一覧');
    this.head.append(el('h2', 'tag-index-title', tr('タグごとの一覧')), this.sub, this.fold);
    this.fold.type = 'button';
    this.fold.addEventListener('click', () => {
      this.prefs.collapsed = !this.prefs.collapsed;
      this.savePrefs();
      this.render(true);
    });

    const controls = el('div', 'tag-index-controls');
    const groupLabel = el('label', 'tag-index-control');
    this.groupSelect.setAttribute('aria-label', 'まとまりの順');
    this.groupSelect.addEventListener('change', () => {
      const value = this.groupSelect.value;
      this.prefs.order = value === 'left' || value === 'count' ? value : 'right';
      this.savePrefs();
      this.render(true);
    });
    groupLabel.append(el('span', '', tr('まとまり')), this.groupSelect);
    const sortLabel = el('label', 'tag-index-control');
    this.sortSelect.setAttribute('aria-label', 'まとまりの中の並べ方');
    for (const sort of ['order', 'recent', 'name'] as TagSort[]) {
      const option = el('option', '', ORDER_LABELS[sort]);
      option.value = sort;
      this.sortSelect.append(option);
    }
    this.sortSelect.addEventListener('change', () => {
      const value = this.sortSelect.value;
      this.prefs.sort = value === 'recent' || value === 'name' ? value : 'order';
      this.savePrefs();
      this.render(true);
    });
    sortLabel.append(el('span', '', tr('並べ方')), this.sortSelect);
    controls.append(groupLabel, sortLabel);

    this.groups.setAttribute('role', 'region');
    this.groups.setAttribute('aria-label', 'タグごとのタブとメモ');
    this.body.append(controls, this.groups);
    this.element.append(this.head, this.body);
    this.render(true);
  }

  // 描き直す（中身が変わっていなければ何もしない。force：開け閉めなど）
  render(force = false) {
    const key = this.keyOf();
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const collapsed = this.prefs.collapsed;
    this.fold.textContent = collapsed ? '▸' : '▾';
    this.fold.title = collapsed ? tr('タグごとの一覧を開く') : tr('タグごとの一覧をたたむ');
    this.fold.setAttribute('aria-label', this.fold.title);
    this.fold.setAttribute('aria-expanded', String(!collapsed));
    this.body.hidden = collapsed;
    const groups = this.build();
    const tagged = groups.filter((g) => g.tag !== null && g.tabs.length + g.memos.length > 0).length;
    this.sub.textContent = tagged > 0 ? tr('タグ {0} 個', { 0: tagged }) : '';
    if (collapsed) return;
    this.renderSelects();
    // 押したボタンに、描き直した後もキーボードの位置を残す
    const active = document.activeElement instanceof HTMLElement && this.groups.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    const top = this.groups.scrollTop;
    this.groups.replaceChildren(...this.groupNodes(groups));
    this.groups.scrollTop = top;
    if (active) this.groups.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
  }

  private renderSelects() {
    const right = this.deps.rightButtons();
    const left = this.deps.leftButtons();
    const options: [TagGroupOrder, string][] = [
      ['right', tr('右のタグのボタンの順（{0}）', { 0: right.name })],
      ['left', left ? tr('左のタグのボタンの順（{0}）', { 0: left.name }) : tr('左のタグのボタンの順')],
      ['count', tr('数の多い順')],
    ];
    const signature = options.map((o) => o.join(':')).join('|');
    if (this.groupSelect.dataset.options !== signature) {
      this.groupSelect.replaceChildren(
        ...options.map(([value, label]) => {
          const option = el('option', '', label);
          option.value = value;
          return option;
        }),
      );
      this.groupSelect.dataset.options = signature;
    }
    this.groupSelect.value = this.prefs.order;
    this.sortSelect.value = this.prefs.sort;
  }

  // ---------- まとまりを作る ----------

  private buttonTags(): string[] {
    const order = this.prefs.order;
    if (order === 'count') return [];
    const view = order === 'left' ? this.deps.leftButtons() : this.deps.rightButtons();
    return (view?.tags ?? []).filter((t): t is string => !!t);
  }

  private build(): Group[] {
    const byTag = new Map<string, Group>();
    const groupOf = (tag: string | null): Group => {
      const key = tag ?? NONE;
      let group = byTag.get(key);
      if (!group) {
        group = { key, tag, button: false, tabs: [], memos: [] };
        byTag.set(key, group);
      }
      return group;
    };
    for (const tab of this.deps.tabs()) {
      if (tab.tags.length === 0) groupOf(null).tabs.push(tab);
      for (const tag of tab.tags) groupOf(tag).tabs.push(tab);
    }
    for (const memo of this.deps.memos() ?? []) {
      const tags = visibleTags(memo.tags);
      if (tags.length === 0) groupOf(null).memos.push(memo);
      for (const tag of tags) groupOf(tag).memos.push(memo);
    }
    const buttons = this.buttonTags();
    const first = buttons.map((tag) => {
      const group = groupOf(tag);
      group.button = true;
      return group;
    });
    const size = (g: Group) => g.tabs.length + g.memos.length;
    const rest = [...byTag.values()]
      .filter((g) => g.tag !== null && !g.button)
      .sort((a, b) => size(b) - size(a) || (a.tag ?? '').localeCompare(b.tag ?? '', 'ja'));
    const none = byTag.get(NONE);
    const out = [...first, ...rest, ...(none ? [none] : [])];
    for (const g of out) this.sortGroup(g);
    return out;
  }

  private sortGroup(group: Group) {
    const sheetIndex = new Map(this.deps.sheets().map((s, i) => [s.id, i]));
    const sheetOf = (id: string) => sheetIndex.get(id) ?? 999;
    const sort = this.prefs.sort;
    if (sort === 'recent') {
      group.tabs.sort((a, b) => b.lastUsed - a.lastUsed);
      group.memos.sort((a, b) => b.updatedAt - a.updatedAt);
    } else if (sort === 'name') {
      group.tabs.sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'ja'));
      group.memos.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    } else {
      group.tabs.sort((a, b) => sheetOf(a.sheet) - sheetOf(b.sheet) || a.order - b.order);
      group.memos.sort((a, b) => sheetOf(a.sheet) - sheetOf(b.sheet) || a.createdAt - b.createdAt);
    }
  }

  // ---------- 描く ----------

  private groupNodes(groups: Group[]): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    if (this.deps.memos() === null && this.deps.tabs().length === 0) {
      nodes.push(el('div', 'tag-index-empty', tr('読み込んでいます…')));
      return nodes;
    }
    if (!groups.some((g) => g.tag !== null)) {
      nodes.push(el('div', 'tag-index-empty', tr('タグはまだありません。カードやコメントの「＋タグ」・タグのボタンで付けると、ここにタグごとに並びます')));
    }
    if (this.prefs.order === 'left' && !this.deps.leftButtons()) {
      nodes.push(el('div', 'tag-index-note', tr('左のタグのボタンが届くまで、数の多い順に並べています')));
    }
    let dividerShown = false;
    const anyButton = groups.some((g) => g.button);
    groups.forEach((group, i) => {
      if (anyButton && !group.button && !dividerShown) {
        dividerShown = true;
        nodes.push(el('div', 'tag-index-divider', group.tag === null ? tr('タグの付いていないもの') : tr('その他のタグ')));
      }
      // はじめから開いておくもの：ボタンのタグ（ボタンのタグが無ければ、上から3つのタグ）
      const opened = group.button || (!anyButton && group.tag !== null && i < 3);
      nodes.push(this.groupNode(group, this.prefs.open[group.key] ?? opened));
    });
    return nodes;
  }

  private groupNode(group: Group, open: boolean): HTMLElement {
    const node = el('div', `tag-index-group${open ? ' open' : ''}${group.button ? ' button-tag' : ''}${group.tag === null ? ' none' : ''}`);
    const head = el('div', 'tag-index-ghead');
    const toggle = el('button', 'tag-index-toggle');
    toggle.type = 'button';
    toggle.dataset.focusKey = `g:${group.key}`;
    toggle.setAttribute('aria-expanded', String(open));
    const name = group.tag === null ? el('span', 'tag-index-none', tr('タグなし')) : el('span', 'tag-chip', group.tag);
    if (group.tag !== null) name.style.setProperty('--tag', tagColor(group.tag));
    const count = el('span', 'tag-index-count', countLabel(group));
    toggle.append(el('span', 'tag-index-arrow', open ? '▾' : '▸'), name, count);
    toggle.title = open ? tr('このまとまりを閉じる') : tr('このまとまりを開く');
    toggle.addEventListener('click', () => {
      this.prefs.open[group.key] = !open;
      const keys = Object.keys(this.prefs.open);
      if (keys.length > MAX_OPEN_PREFS) for (const k of keys.slice(0, keys.length - MAX_OPEN_PREFS)) delete this.prefs.open[k];
      this.savePrefs();
      this.render(true);
    });
    head.append(toggle);
    if (group.tag !== null && group.tabs.length > 0) {
      const tag = group.tag;
      const on = this.deps.highlightTag() === tag;
      const hl = el('button', 'tag-index-hl', '◎');
      hl.type = 'button';
      hl.dataset.focusKey = `h:${group.key}`;
      hl.setAttribute('aria-pressed', String(on));
      hl.title = on ? tr('目立たせるのをやめる') : tr('「{0}」のタブだけを、左の盤面で目立たせる', { 0: tag });
      hl.setAttribute('aria-label', hl.title);
      hl.addEventListener('click', () => this.deps.highlight(on ? null : tag));
      head.append(hl);
    }
    node.append(head);
    if (!open) return node;

    const rows = el('div', 'tag-index-rows');
    const total = group.tabs.length + group.memos.length;
    if (total === 0) {
      rows.append(el('div', 'tag-index-empty small', tr('このタグのタブ・メモは、まだありません')));
    } else {
      // 出す行だけを作る（多いまとまりでも、見えない行は作らない）
      const all = this.full.has(group.key);
      const tabs = all ? group.tabs : group.tabs.slice(0, ROWS);
      const memos = all ? group.memos : group.memos.slice(0, Math.max(0, ROWS - tabs.length));
      rows.append(...tabs.map((t) => this.tabRow(t, group.key)), ...memos.map((m) => this.memoRow(m, group.key)));
      if (total > ROWS) {
        const more = el('button', 'tag-index-more', all ? tr('最初の {0} 件だけにする ▴', { 0: ROWS }) : tr('ほか {0} 件を見る ▾', { 0: total - ROWS }));
        more.type = 'button';
        more.dataset.focusKey = `m:${group.key}`;
        more.addEventListener('click', () => {
          if (all) this.full.delete(group.key);
          else this.full.add(group.key);
          this.render(true);
        });
        rows.append(more);
      }
    }
    node.append(rows);
    return node;
  }

  private sheetName(id: string) {
    if (id === MAIN_SHEET) return '';
    return this.deps.sheets().find((s) => s.id === id)?.name ?? '';
  }

  private tabRow(tab: Tab, groupKey: string): HTMLElement {
    const active = tab.id === this.deps.activeId();
    const row = el('button', `tag-index-row tab${active ? ' active' : ''}${tab.asleep ? ' asleep' : ''}`);
    row.type = 'button';
    row.dataset.focusKey = `t:${groupKey}:${tab.id}`;
    const icon = el('span', 'tag-index-icon');
    if (tab.favicon && /^(https?:|data:image\/)/i.test(tab.favicon) && !this.brokenIcons.has(tab.favicon)) {
      const img = el('img');
      img.src = tab.favicon;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      const favicon = tab.favicon;
      img.addEventListener('error', () => {
        this.brokenIcons.add(favicon);
        img.replaceWith(document.createTextNode(initialOf(tab)));
      });
      icon.append(img);
    } else {
      icon.textContent = initialOf(tab);
    }
    const meta = [hostOf(tab.url), this.sheetName(tab.sheet) && tr('シート：{0}', { 0: this.sheetName(tab.sheet) }), tab.asleep ? tr('休眠中') : '', active ? tr('表示中') : ''].filter(Boolean).join(tr('・'));
    row.append(icon, el('span', 'tag-index-name', titleOf(tab)), el('span', 'tag-index-meta', meta));
    row.title = tr('{0}\n{1}\n（押すと、このタブを表示）', { 0: titleOf(tab), 1: tab.url });
    row.addEventListener('click', () => this.deps.activate(tab.id));
    return row;
  }

  private memoRow(memo: MemoIndexItem, groupKey: string): HTMLElement {
    const row = el('button', `tag-index-row memo${memo.by ? ' ai' : ''}`);
    row.type = 'button';
    row.dataset.focusKey = `n:${groupKey}:${memo.id}`;
    const icon = el('span', 'tag-index-icon memo', memo.image ? '▣' : memo.by ? '✦' : '✎');
    const sheet = this.sheetName(memo.sheet);
    const meta = [memo.by ? `${memo.by}` : tr('メモ'), sheet && tr('シート：{0}', { 0: sheet }), dateOf(memo.updatedAt)].filter(Boolean).join(tr('・'));
    row.append(icon, el('span', 'tag-index-name', memo.title), el('span', 'tag-index-meta', meta));
    row.title = tr('{0}\n（押すと、左の盤面でこのメモを開く）', { 0: memo.title });
    row.addEventListener('click', () => this.deps.showMemo(memo.id));
    return row;
  }

  // ---------- 描き直すかどうか ----------

  private keyOf(): string {
    const tabs = this.deps
      .tabs()
      .map((t) => `${t.id}/${t.sheet}/${t.order}/${t.title}/${t.url}/${t.favicon}/${t.asleep ? 1 : 0}/${t.lastUsed}/${t.tags.join(',')}`)
      .join('\u0001');
    const memos = this.deps.memos();
    const memoKey = memos === null ? 'none' : memos.map((m) => `${m.id}/${m.sheet}/${m.title}/${m.updatedAt}/${m.tags.join(',')}`).join('\u0001');
    const sheets = this.deps
      .sheets()
      .map((s) => `${s.id}/${s.name}`)
      .join(',');
    const right = this.deps.rightButtons();
    const left = this.deps.leftButtons();
    return [
      JSON.stringify(this.prefs),
      [...this.full].join(','),
      `${right.name}:${right.tags.join(',')}`,
      left ? `${left.name}:${left.tags.join(',')}` : '-',
      this.deps.highlightTag() ?? '',
      this.deps.activeId() ?? '',
      sheets,
      tabs,
      memoKey,
    ].join('|');
  }

  private savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // 保存できなくても動作は続ける
    }
  }

  // 上のタグから開く（右クリックの登録先）
  get header() {
    return this.head;
  }

  isCollapsed() {
    return this.prefs.collapsed;
  }

  expand() {
    if (!this.prefs.collapsed) return;
    this.prefs.collapsed = false;
    this.savePrefs();
    this.render(true);
  }
}

function titleOf(tab: Tab) {
  return tab.title || hostOf(tab.url) || tab.url || tr('新しいタブ');
}

function countLabel(group: Group) {
  const parts: string[] = [];
  if (group.tabs.length > 0) parts.push(tr('タブ {0}', { 0: group.tabs.length }));
  if (group.memos.length > 0) parts.push(tr('メモ {0}', { 0: group.memos.length }));
  return parts.join(tr('・')) || '0';
}

function dateOf(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function loadPrefs(): Prefs {
  // open は、もとの形を持たない入れ物（「constructor」のような名前のタグでも、開け閉めが正しく覚えられるように）
  const fallback: Prefs = { collapsed: false, order: 'right', sort: 'order', open: Object.create(null) as Record<string, boolean> };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    const open: Record<string, boolean> = Object.create(null);
    if (raw.open && typeof raw.open === 'object') for (const [k, v] of Object.entries(raw.open)) if (typeof v === 'boolean') open[k] = v;
    return {
      collapsed: raw.collapsed === true,
      order: raw.order === 'left' || raw.order === 'count' ? raw.order : 'right',
      sort: raw.sort === 'recent' || raw.sort === 'name' ? raw.sort : 'order',
      open,
    };
  } catch {
    return fallback;
  }
}
