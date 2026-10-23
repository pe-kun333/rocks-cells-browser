// 右サイドバーの区画：全部たためる・見出しの右クリックでタグ1〜6に登録・上のボタンからそこへ移動する
//   覚え方はこの画面の localStorage（右の WebView だけ。再起動しても残る）
//   もともと ▾ がある区画（メモ・データ置き場・受け取り箱・タグごとの一覧・月の窓）は、その ▾ と保存のまま使う
import { type MenuEntry, type CellMenu } from './cell-menu';
import { el } from '../util';

const STORE_KEY = 'honeycomb.sidebarSections';
const SLOT_COUNT = 6;

interface Section {
  id: string;
  title: string;
  element: HTMLElement;
  header: HTMLElement | string; // 要素か、区画の中のセレクタ（描き直して見出しが入れ替わる月の窓）
  collapsed(): boolean;
  expand(): void;
  available?(): boolean;
  unavailable?: string;
}

interface Fold {
  element: HTMLElement;
  fold: HTMLButtonElement;
  title: string;
}

interface Saved {
  collapsed?: unknown;
  slots?: unknown;
}

export class SectionShelf {
  readonly bar: HTMLElement;
  private readonly sections: Section[] = [];
  private readonly folds = new Map<string, Fold>();
  private collapsed: Record<string, boolean> = {};
  private slots: (string | null)[] = Array.from({ length: SLOT_COUNT }, () => null);
  private at = { x: 0, y: 0 };

  constructor(
    private readonly menu: CellMenu,
    private readonly toast: (text: string) => void,
  ) {
    this.bar = el('div', 'sidebar-tags');
    this.bar.setAttribute('role', 'group');
    this.bar.setAttribute('aria-label', '登録した区画');
    this.load();
  }

  // もともとたためる区画。右クリックだけ足す
  adopt(section: Section) {
    section.element.dataset.section = section.id;
    this.sections.push(section);
    this.bind(section);
  }

  // すでにある見出しに ▾ を足して、見出し以外を隠す。keep は区画の直接の子
  fold(spec: { id: string; title: string; element: HTMLElement; keep: HTMLElement; foldHost?: HTMLElement }) {
    spec.element.dataset.section = spec.id;
    this.install(spec.id, spec.title, spec.element, spec.keep, spec.foldHost ?? spec.keep);
  }

  // 見出しが描き直される区画の先頭に、「▾ 題名」を足す（拡大表示以外）
  barOn(spec: { id: string; title: string; element: HTMLElement }) {
    const head = el('div', 'sidebar-inline-head');
    head.append(el('span', 'sidebar-inline-title', spec.title));
    spec.element.prepend(head);
    spec.element.dataset.section = spec.id;
    this.install(spec.id, spec.title, spec.element, head, head);
  }

  // 中身を描き直す区画（拡大表示）は、外に見出しを置く。戻すのは外側
  wrap(spec: { id: string; title: string; element: HTMLElement }): HTMLElement {
    const shell = el('section', 'sidebar-shell panel-section');
    shell.dataset.section = spec.id;
    const head = el('div', 'sidebar-shell-head');
    head.append(el('span', 'sidebar-inline-title', spec.title));
    const body = el('div', 'sidebar-shell-body');
    spec.element.replaceWith(shell);
    body.append(spec.element);
    shell.append(head, body);
    this.install(spec.id, spec.title, shell, head, head);
    return shell;
  }

  // 登録したあとに呼ぶ。知らない id を外して、上のボタンを描く
  finish() {
    const ids = new Set(this.sections.map((section) => section.id));
    for (const key of Object.keys(this.collapsed)) if (!ids.has(key)) delete this.collapsed[key];
    const seen = new Set<string>();
    this.slots = this.slots.map((id) => {
      if (!id || !ids.has(id) || seen.has(id)) return null;
      seen.add(id);
      return id;
    });
    this.save();
    this.renderBar();
  }

  private install(id: string, title: string, element: HTMLElement, keep: HTMLElement, foldHost: HTMLElement) {
    keep.classList.add('sidebar-keep');
    foldHost.classList.add('sidebar-fold-host');
    const fold = el('button', 'sidebar-fold', '▾');
    fold.type = 'button';
    foldHost.prepend(fold);
    this.folds.set(id, { element, fold, title });
    this.paint(id, this.collapsed[id] === true);
    let blockFold = false;
    // click の前にフォーカスがボタンへ移るので、書いているかは mousedown で見る
    fold.addEventListener('mousedown', (event) => {
      blockFold = !element.classList.contains('sidebar-collapsed') && writingInside(element);
      if (!blockFold) return;
      event.preventDefault();
      event.stopPropagation();
      this.toast('書いている途中です。書き終えてからたためます');
    });
    fold.addEventListener('click', (event) => {
      event.stopPropagation();
      if (blockFold) {
        blockFold = false;
        return;
      }
      this.remember(id, !element.classList.contains('sidebar-collapsed'));
    });
    // たたんでいるときに見出しのボタンを押したら、先に開いてからそのボタンの動きにする
    keep.addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Node) || fold.contains(event.target)) return;
        if (element.classList.contains('sidebar-collapsed')) this.remember(id, false);
      },
      true,
    );
    this.sections.push({
      id,
      title,
      element,
      header: keep,
      collapsed: () => element.classList.contains('sidebar-collapsed'),
      expand: () => {
        if (element.classList.contains('sidebar-collapsed')) this.remember(id, false);
      },
    });
    this.bind(this.sections[this.sections.length - 1]);
  }

  private bind(section: Section) {
    const root = typeof section.header === 'string' ? section.element : section.header;
    root.addEventListener('contextmenu', (event) => {
      const head = typeof section.header === 'string' ? section.element.querySelector(section.header) : section.header;
      if (!(event.target instanceof Node) || !head || !head.contains(event.target)) return;
      event.preventDefault();
      this.at = { x: event.clientX, y: event.clientY };
      this.menu.open(event.clientX, event.clientY, this.entriesFor(section));
    });
  }

  private entriesFor(section: Section): MenuEntry[] {
    const items: MenuEntry[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const occupant = this.slots[i];
      const name = occupant ? this.sections.find((item) => item.id === occupant)?.title : undefined;
      const hint = occupant === section.id ? 'この区画' : name;
      const slot = i;
      items.push({ label: `タグ${i + 1}に登録`, hint, run: () => this.register(section.id, slot) });
    }
    items.push('sep', { label: 'その他…', run: () => this.openList() });
    return items;
  }

  private openList() {
    const entries: MenuEntry[] = [{ section: '区画へ移動' }];
    for (const section of this.sections) {
      const slot = this.slots.indexOf(section.id);
      const hint = slot >= 0 ? `タグ${slot + 1}` : section.collapsed() ? 'たたんでいます' : undefined;
      entries.push({ label: section.title, hint, run: () => this.jump(section) });
    }
    this.menu.open(this.at.x, this.at.y, entries);
  }

  // ほかの区画のボタンから、その区画を開いて移る
  show(id: string) {
    const section = this.sections.find((item) => item.id === id);
    if (section) this.jump(section);
  }

  private register(id: string, slot: number) {
    this.slots = this.slots.map((current) => (current === id ? null : current));
    this.slots[slot] = id;
    this.save();
    this.renderBar();
  }

  private jump(section: Section) {
    if (section.available && !section.available()) {
      this.toast(section.unavailable ?? 'いまは出せません');
      return;
    }
    section.expand();
    window.requestAnimationFrame(() => section.element.scrollIntoView({ block: 'start', inline: 'nearest' }));
  }

  private remember(id: string, collapsed: boolean) {
    if (collapsed) this.collapsed[id] = true;
    else delete this.collapsed[id];
    this.paint(id, collapsed);
    this.save();
  }

  private paint(id: string, collapsed: boolean) {
    const fold = this.folds.get(id);
    if (!fold) return;
    fold.element.classList.toggle('sidebar-collapsed', collapsed);
    fold.fold.textContent = collapsed ? '▸' : '▾';
    const action = collapsed ? `${fold.title}を開く` : `${fold.title}をたたむ`;
    fold.fold.title = action;
    fold.fold.setAttribute('aria-label', action);
    fold.fold.setAttribute('aria-expanded', String(!collapsed));
  }

  private renderBar() {
    const buttons: HTMLButtonElement[] = [];
    this.slots.forEach((id, index) => {
      if (!id) return;
      const section = this.sections.find((item) => item.id === id);
      if (!section) return;
      const button = el('button', 'sidebar-tag', section.title);
      button.type = 'button';
      button.title = `タグ${index + 1}：${section.title}。押すと開いて、そこへ移動します`;
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => this.jump(section));
      buttons.push(button);
    });
    if (buttons.length === 0) {
      this.bar.replaceChildren(el('p', 'sidebar-tags-hint', '見出しを右クリックすると、ここにタグとして登録できます'));
      return;
    }
    this.bar.replaceChildren(...buttons);
  }

  private load() {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
      if (!raw || typeof raw !== 'object') return;
      const saved = raw as Saved;
      if (saved.collapsed && typeof saved.collapsed === 'object') {
        for (const [key, value] of Object.entries(saved.collapsed)) if (value === true) this.collapsed[key] = true;
      }
      const slots = saved.slots;
      if (Array.isArray(slots)) {
        this.slots = Array.from({ length: SLOT_COUNT }, (_, index) => {
          const value: unknown = slots[index];
          return typeof value === 'string' ? value : null;
        });
      }
    } catch {
      // 覚えられなくても、今は開ける
    }
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ collapsed: this.collapsed, slots: this.slots }));
    } catch {
      // 保存できなくても、今は開ける
    }
  }
}

function writingInside(root: HTMLElement) {
  const active = document.activeElement;
  return active instanceof HTMLElement && root.contains(active) && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement);
}
