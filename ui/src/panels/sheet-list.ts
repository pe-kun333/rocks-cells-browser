// シートの一覧（docs/ideas-sheet-folders.md の候補 1・2）
//   左上の名前 ▾・盤面の右クリックの「その他のシート…」・「ほかのシートへ移す…」・「あるシートへの入口を追加 ▸」で使う
//   ・頭に、道しるべ（メイン › … ）と ↑、字で絞る欄と ＋・☑・⋯。その下はシートの行だけ。足に「すべて」「たどれない」「アプリ」
//   ・段＝あるシートの盤面にある入口の行き先（sheet-tree.ts）。「▸ n」で中の段へ進む
//   ・欄は作り直さない（打った字と焦点を保つ）。日本語の変換中のキーは受けない
//   ・行の右クリック（ContextMenu キー・Shift+F10 も）で、その行のメニュー
//   中身（どの行を出すか・押したら何をするか）は呼ぶ側（primary）が決める。ここは DOM だけ
import { t as tr } from '../i18n';
import { el } from '../util';

export type SheetGroup = 'all' | 'unreachable' | 'app';
export type SheetLevel = { kind: 'hub'; id: string } | { kind: 'group'; key: SheetGroup };

export interface SheetListRow {
  id: string;
  name: string;
  color: string;
  hint?: string; // 数・道など
  current?: boolean; // 今のシート
  disabled?: boolean; // 押せない（移す元・入口を置く先の今のシートなど）。▸ は押せる
  kids?: number; // 中のシートの数（1 以上なら ▸ を出す）
  self?: boolean; // 段のシートそのもの（段の頭の行）
}

export interface SheetListModel {
  title: string;
  start: SheetLevel;
  rows(level: SheetLevel): SheetListRow[];
  crumbs(level: SheetLevel): { id: string; name: string }[]; // hub の段：メイン … そのシート
  groupName(key: SheetGroup): string;
  footer(): { key: SheetGroup; label: string; count: number }[];
  search(query: string): SheetListRow[];
  pick(id: string): void;
  rowMenu?(id: string, at: { x: number; y: number }, level: SheetLevel): void;
  add?(at: { x: number; y: number }, level: SheetLevel): void;
  more?(at: { x: number; y: number }): void;
  select?: { label: string; run(ids: string[], at: { x: number; y: number }, level: SheetLevel): void };
}

const isComposing = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229;

export class SheetList {
  readonly node = el('div', 'sheet-list');
  private readonly crumbBar = el('div', 'sheet-list-crumbs');
  private readonly input = el('input', 'sheet-list-find');
  private readonly box = el('div', 'sheet-list-rows');
  private readonly foot = el('div', 'sheet-list-foot');
  private level: SheetLevel;
  private shown: SheetListRow[] = [];
  private active = -1; // ↑↓ で選んでいる行（shown の番号）
  private selecting = false;
  private readonly selected = new Set<string>();

  constructor(
    private readonly model: SheetListModel,
    private readonly close: () => void,
  ) {
    this.level = model.start;
    const title = el('div', 'cell-menu-section', model.title);
    const tools = el('div', 'sheet-list-tools');
    this.input.type = 'search';
    this.input.placeholder = tr('名前・入口のひとこと・島の名前で探す');
    this.input.setAttribute('aria-label', tr('シートを探す'));
    this.input.maxLength = 40;
    this.input.addEventListener('input', () => this.render(true));
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    tools.append(this.input);
    if (model.add) tools.append(this.tool('＋', tr('新しいシートを作る'), (at) => model.add?.(at, this.level)));
    if (model.select) {
      const pick = this.tool('☑', tr('何枚かを選んで、まとめてフォルダへ入れる（Ctrl+クリックでも選べます）'), () => {
        this.selecting = !this.selecting;
        if (!this.selecting) this.selected.clear();
        pick.setAttribute('aria-pressed', String(this.selecting));
        this.render(false);
      });
      pick.setAttribute('aria-pressed', 'false');
      tools.append(pick);
    }
    if (model.more) tools.append(this.tool('⋯', tr('このシートの名前・消す・アーカイブ、アーカイブの一覧、表示'), (at) => model.more?.(at)));
    this.box.setAttribute('role', 'listbox');
    this.node.append(title, this.crumbBar, tools, this.box, this.foot);
    this.render(false);
  }

  // 開いたあとに呼ぶ（箱が画面に入ってから：今のシートの行まで送る・欄に焦点）
  opened(focus: boolean) {
    const row = this.box.querySelector<HTMLElement>('.sheet-list-row.current');
    if (row) this.box.scrollTop = Math.max(0, row.offsetTop - this.box.clientHeight / 2 + row.offsetHeight / 2);
    if (focus) this.input.focus({ preventScroll: true });
  }

  private tool(label: string, title: string, run: (at: { x: number; y: number }) => void) {
    const b = el('button', 'cell-menu-small sheet-list-tool', label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', () => {
      const r = b.getBoundingClientRect();
      run({ x: r.left, y: r.bottom + 2 });
    });
    return b;
  }

  private go(level: SheetLevel) {
    this.level = level;
    this.input.value = '';
    this.active = -1;
    this.render(false);
    this.box.scrollTop = 0;
  }

  private render(fromTyping: boolean) {
    const query = this.input.value.trim();
    const searching = query.length > 0;
    this.shown = searching ? this.model.search(query) : this.model.rows(this.level);
    if (fromTyping) this.active = this.shown.findIndex((r) => !r.disabled);
    this.renderCrumbs(searching);
    this.renderRows(searching);
    this.renderFoot(searching);
  }

  private renderCrumbs(searching: boolean) {
    const nodes: HTMLElement[] = [];
    if (searching) {
      nodes.push(el('span', 'sheet-list-crumb-note', tr('すべてのシートから探しています（{0} 件）', { 0: this.shown.length })));
    } else if (this.level.kind === 'group') {
      const back = el('button', 'cell-menu-small', '↑');
      back.type = 'button';
      back.title = tr('上の段へ（メインの段）');
      back.setAttribute('aria-label', back.title);
      back.addEventListener('click', () => this.go(this.model.start.kind === 'group' ? { kind: 'hub', id: 'main' } : this.model.start));
      nodes.push(back, el('span', 'sheet-list-crumb-note', this.model.groupName(this.level.key)));
    } else {
      const crumbs = this.model.crumbs(this.level);
      if (crumbs.length > 1) {
        const up = el('button', 'cell-menu-small', '↑');
        up.type = 'button';
        up.title = tr('上の段へ（「{0}」の中）', { 0: crumbs[crumbs.length - 2].name });
        up.setAttribute('aria-label', up.title);
        up.addEventListener('click', () => this.go({ kind: 'hub', id: crumbs[crumbs.length - 2].id }));
        nodes.push(up);
      }
      crumbs.forEach((c, i) => {
        if (i > 0) nodes.push(el('span', 'sheet-list-sep', '›'));
        const b = el('button', 'sheet-list-crumb', c.name);
        b.type = 'button';
        b.title = tr('「{0}」の中の段へ', { 0: c.name });
        if (i === crumbs.length - 1) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', () => this.go({ kind: 'hub', id: c.id }));
        nodes.push(b);
      });
    }
    this.crumbBar.replaceChildren(...nodes);
  }

  private renderRows(searching: boolean) {
    const nodes: HTMLElement[] = [];
    if (this.shown.length === 0) nodes.push(el('div', 'cell-menu-note', searching ? tr('当たるシートはありません（漢字は変換してから）') : tr('この段にシートはありません')));
    this.shown.forEach((row, index) => {
      const line = el('div', 'sheet-list-row');
      if (row.current) line.classList.add('current');
      if (row.self) line.classList.add('self');
      if (index === this.active) line.classList.add('active');
      const name = el('button', 'sheet-list-name');
      name.type = 'button';
      name.setAttribute('role', 'option');
      const sw = el('span', 'sheet-swatch');
      sw.style.setProperty('--sheet', row.color);
      const label = el('span', 'sheet-list-label', row.name);
      name.append(sw, label);
      if (row.current) name.append(el('span', 'sheet-list-mark', '✓'));
      if (row.hint) name.append(el('span', 'cell-menu-hint', row.hint));
      const chosen = this.selected.has(row.id);
      if (this.selecting) name.setAttribute('aria-pressed', String(chosen));
      if (chosen) line.classList.add('chosen');
      name.disabled = !!row.disabled && !this.selecting;
      name.title = row.current ? tr('「{0}」（いまのシート）', { 0: row.name }) : row.name;
      name.addEventListener('click', (e) => {
        if (this.model.select && (this.selecting || e.ctrlKey)) {
          if (row.self) return; // 段のシートそのものは選ばない（中へ入れると輪になる）
          if (!this.selecting) this.selecting = true;
          if (chosen) this.selected.delete(row.id);
          else this.selected.add(row.id);
          this.render(false);
          return;
        }
        this.pick(row);
      });
      line.append(name);
      if ((row.kids ?? 0) > 0 && !row.self) {
        const kids = el('button', 'cell-menu-small sheet-list-kids', `▸ ${row.kids}`);
        kids.type = 'button';
        kids.title = tr('「{0}」の中を見る（{1} 枚）', { 0: row.name, 1: row.kids });
        kids.setAttribute('aria-label', kids.title);
        kids.addEventListener('click', () => this.go({ kind: 'hub', id: row.id }));
        line.append(kids);
      }
      const menu = this.model.rowMenu;
      if (menu) {
        let keyAt = 0;
        const at = () => {
          const r = line.getBoundingClientRect();
          return { x: r.left + 12, y: r.bottom };
        };
        line.addEventListener('keydown', (e) => {
          if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
          e.preventDefault();
          e.stopPropagation();
          keyAt = Date.now();
          menu(row.id, at(), this.level);
        });
        line.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.button !== 2 && Date.now() - keyAt < 800) return;
          menu(row.id, { x: e.clientX, y: e.clientY }, this.level);
        });
      }
      nodes.push(line);
    });
    this.box.replaceChildren(...nodes);
    this.box.querySelector('.sheet-list-row.active')?.scrollIntoView({ block: 'nearest' });
  }

  private renderFoot(searching: boolean) {
    const nodes: HTMLElement[] = [];
    if (this.selecting && this.model.select) {
      const ids = [...this.selected];
      const run = el('button', 'cell-menu-small', tr('選んだ {0} 枚を{1}', { 0: ids.length, 1: this.model.select.label }));
      run.type = 'button';
      run.disabled = ids.length === 0;
      run.addEventListener('click', () => {
        const r = run.getBoundingClientRect();
        this.model.select?.run(ids, { x: r.left, y: r.bottom + 2 }, this.level);
      });
      const clear = el('button', 'cell-menu-small', tr('選ぶのをやめる'));
      clear.type = 'button';
      clear.addEventListener('click', () => {
        this.selecting = false;
        this.selected.clear();
        this.node.querySelector('.sheet-list-tool[aria-pressed]')?.setAttribute('aria-pressed', 'false');
        this.render(false);
      });
      nodes.push(run, clear);
    } else if (!searching) {
      for (const f of this.model.footer()) {
        if (f.count === 0 && f.key !== 'all') continue;
        const b = el('button', 'sidebar-tag sheet-list-group', `${f.label} ${f.count}`);
        b.type = 'button';
        const here = this.level.kind === 'group' && this.level.key === f.key;
        if (here) b.classList.add('is-current');
        b.addEventListener('click', () => this.go({ kind: 'group', key: f.key }));
        nodes.push(b);
      }
    }
    this.foot.replaceChildren(...nodes);
    this.foot.hidden = nodes.length === 0;
  }

  private pick(row: SheetListRow) {
    if (row.disabled) return;
    this.close();
    this.model.pick(row.id);
  }

  private onKey(e: KeyboardEvent) {
    if (isComposing(e)) return;
    const step = (dir: 1 | -1) => {
      if (this.shown.length === 0) return;
      let i = this.active;
      for (let n = 0; n < this.shown.length; n++) {
        i = (i + dir + this.shown.length) % this.shown.length;
        if (!this.shown[i].disabled) break;
      }
      this.active = i;
      this.box.querySelectorAll('.sheet-list-row').forEach((r, k) => r.classList.toggle('active', k === i));
      this.box.querySelector('.sheet-list-row.active')?.scrollIntoView({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight' && this.input.value === '') {
      const row = this.shown[this.active];
      if (row && (row.kids ?? 0) > 0 && !row.self) {
        e.preventDefault();
        this.go({ kind: 'hub', id: row.id });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = this.shown[this.active] ?? this.shown.find((r) => !r.disabled);
      if (row) this.pick(row);
    }
  }
}
