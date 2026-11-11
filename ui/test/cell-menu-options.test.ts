// 段 CB4a：CellMenu に足したもの（囲みのスクロール印と PageUp・PageDown、絵（data:image/ だけ）、折り返す行、囲みの高さの変数）
//   試験に DOM は無いので、cell-menu-close.test.ts と同じ小さな偽物の上で本物の CellMenu を動かす。偽物は、この試験で要るもの（印・属性・クラス・画像・スクロール）だけ足す
//   CSS は規則を読んで確かめる。見た目は開発画面で主担当が確かめる
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CellMenu, type MenuEntry } from '../src/panels/cell-menu';
import { parseCss, readSrc } from './theme-css';

class FakeEvent {
  stopped = false;
  defaultPrevented = false;
  constructor(
    readonly type: string,
    readonly target: FakeEl,
    readonly key: string,
  ) {}
  stopPropagation() {
    this.stopped = true;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
}

type Handler = (e: FakeEvent) => void;

class FakeTarget {
  private readonly handlers: { type: string; fn: Handler }[] = [];
  addEventListener(type: string, fn: Handler) {
    this.handlers.push({ type, fn });
  }
  run(e: FakeEvent) {
    for (const h of this.handlers) if (h.type === e.type) h.fn(e);
  }
}

class FakeEl extends FakeTarget {
  tag = '';
  parent: FakeEl | null = null;
  kids: FakeEl[] = [];
  hidden = false;
  disabled = false;
  className = '';
  textContent = '';
  tabIndex = -1; // 実際の DOM の既定（焦点を受けない）
  src = '';
  alt = '';
  offsetWidth = 100;
  offsetHeight = 100;
  clientHeight = 200;
  scrolls: [number, number][] = []; // scrollBy の呼ばれた記録
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => void this.classes.add(name),
    remove: (name: string) => void this.classes.delete(name),
  };
  private readonly attrs = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  scrollBy(x: number, y: number) {
    this.scrolls.push([x, y]);
  }
  contains(other: unknown): boolean {
    for (let n = other as FakeEl | null; n; n = n.parent) if (n === this) return true;
    return false;
  }
  append(...nodes: FakeEl[]) {
    for (const n of nodes) {
      n.parent = this;
      this.kids.push(n);
    }
  }
  replaceChildren(...nodes: FakeEl[]) {
    for (const k of this.kids) k.parent = null;
    this.kids = [];
    this.append(...nodes);
  }
  // CellMenu が使う選択子だけ（押せるボタン・スクロールの印）。子の中を前から探す
  querySelector(selector: string): FakeEl | null {
    const hit = (k: FakeEl): boolean => {
      if (selector === 'button:not(:disabled)') return k instanceof FakeButton && !k.disabled;
      if (selector === '[data-scroll="true"]') return k.dataset.scroll === 'true';
      throw new Error(`この試験の偽物にない選択子: ${selector}`);
    };
    for (const k of this.kids) {
      if (hit(k)) return k;
      const inner = k.querySelector(selector);
      if (inner) return inner;
    }
    return null;
  }
}

class FakeButton extends FakeEl {}

class FakeDoc extends FakeTarget {
  readonly body = new FakeEl();
  activeElement: FakeEl = this.body;
  createElement(tag: string) {
    const node = tag === 'button' ? new FakeButton() : new FakeEl();
    node.tag = tag;
    return node;
  }
}

class FakeWin extends FakeTarget {
  readonly innerWidth = 1000;
  readonly innerHeight = 800;
}

let page: { doc: FakeDoc; win: FakeWin };

// 押した所から上へ伝える（document・window まで。止められたら先へ進まない）
function fire(target: FakeEl, type: string, key = ''): FakeEvent {
  const e = new FakeEvent(type, target, key);
  const path: FakeTarget[] = [];
  for (let n: FakeEl | null = target; n; n = n.parent) path.push(n);
  path.push(page.doc, page.win);
  for (const t of path) {
    t.run(e);
    if (e.stopped) break;
  }
  return e;
}

// 開いたメニュー（中身は entries）。本物の CellMenu と、その欄（偽物）を返す
function openMenu(entries: MenuEntry[]) {
  const menu = new CellMenu();
  menu.open(0, 0, entries);
  return { menu, node: menu.node as unknown as FakeEl };
}

// 欄の中のすべての子（孫も）
function all(node: FakeEl): FakeEl[] {
  return node.kids.flatMap((k) => [k, ...all(k)]);
}

// 開いている間に、焦点のある所で押したキー
const keyDown = (name: string) => fire(page.doc.activeElement, 'keydown', name);

beforeEach(() => {
  const doc = new FakeDoc();
  page = { doc, win: new FakeWin() };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', page.win);
  vi.stubGlobal('HTMLElement', FakeEl);
  vi.stubGlobal('HTMLButtonElement', FakeButton);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CellMenu の囲みのスクロール（PageUp・PageDown）', () => {
  it('スクロールの印のある囲みは焦点を受けて data-scroll が付く。印の無い囲みには付かない', () => {
    const { node } = openMenu([{ note: '長い全文', scroll: true }, { note: '短い文' }]);
    const [long, short] = node.kids;
    expect(long.tabIndex).toBe(0);
    expect(long.dataset.scroll).toBe('true');
    expect(short.tabIndex).toBe(-1);
    expect(short.dataset.scroll).toBeUndefined();
  });

  it('開いている間の PageDown・PageUp は、囲みの高さの 0.8 倍だけ scrollBy し、既定の動きを止める', () => {
    const { node } = openMenu([{ note: '長い全文', scroll: true }]);
    const box = node.kids[0];
    const down = keyDown('PageDown');
    const up = keyDown('PageUp');
    expect(box.scrolls).toEqual([
      [0, 160],
      [0, -160],
    ]);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
  });

  it('印の無いメニューでは PageDown でも scrollBy されず、既定の動きも止めない', () => {
    const { node } = openMenu([{ note: '短い文' }, { label: '項目', run: () => undefined }]);
    const e = keyDown('PageDown');
    expect(e.defaultPrevented).toBe(false);
    expect(all(node).every((n) => n.scrolls.length === 0)).toBe(true);
  });

  it('閉じたメニューでは PageDown で何もしない', () => {
    const { menu, node } = openMenu([{ note: '長い全文', scroll: true }]);
    const box = node.kids[0];
    menu.close();
    const e = keyDown('PageDown');
    expect(box.scrolls).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('CellMenu の絵（data:image/ の文字列だけ）', () => {
  it('data:image/ の絵は img になり、src と alt が入る', () => {
    const { node } = openMenu([{ picture: 'data:image/png;base64,AA==', alt: 'カードの絵' }]);
    expect(node.kids).toHaveLength(1);
    const box = node.kids[0];
    expect(box.className).toBe('cell-menu-picture');
    expect(box.kids).toHaveLength(1);
    const img = box.kids[0];
    expect(img.tag).toBe('img');
    expect(img.src).toBe('data:image/png;base64,AA==');
    expect(img.alt).toBe('カードの絵');
  });

  it('data:image/ でない絵は何も描かず、前後の項目は今までどおり', () => {
    const { node } = openMenu([{ section: '前' }, { picture: 'https://example.com/a.png', alt: '外' }, { note: '後' }]);
    expect(all(node).some((n) => n.tag === 'img')).toBe(false);
    expect(node.kids.map((k) => k.className)).toEqual(['cell-menu-section', 'cell-menu-note']);
  });
});

describe('CellMenu の折り返す行', () => {
  it('wrap の行だけ cell-menu-row-wrap が付く', () => {
    const { node } = openMenu([
      { row: '色', buttons: [{ label: '赤', run: () => undefined }] },
      { row: 'セット', buttons: [{ label: '一', run: () => undefined }], wrap: true },
    ]);
    const [plain, wrapped] = node.kids;
    expect(plain.classes.has('cell-menu-row-wrap')).toBe(false);
    expect(wrapped.classes.has('cell-menu-row-wrap')).toBe(true);
    expect(wrapped.className).toBe('cell-menu-row');
  });
});

describe('style.css（規則を読んで確かめる）', () => {
  const rules = parseCss(readSrc('style.css'));
  const decl = (selector: string, prop: string) =>
    rules.find((r) => r.at.length === 0 && r.selector === selector)?.decls.find((d) => d.prop === prop)?.value;

  it('囲みの高さは変数（既定 160px）で、絵の高さも同じ変数を使う', () => {
    expect(decl('.cell-menu-note', 'max-height')).toBe('var(--cell-menu-note-max, 160px)');
    expect(decl('.cell-menu-picture img', 'max-height')).toBe('var(--cell-menu-note-max, 160px)');
  });

  it('スクロールの印の焦点の輪・絵・折り返す行の規則がある', () => {
    expect(decl(".cell-menu-note[data-scroll='true']:focus-visible", 'outline')).toBe('2px solid var(--accent-line)');
    expect(decl('.cell-menu-row-wrap', 'flex-wrap')).toBe('wrap');
    expect(decl('.cell-menu-row-wrap .cell-menu-row-name', 'flex')).toBe('0 1 auto');
  });
});
