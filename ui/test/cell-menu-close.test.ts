// CellMenu の閉じ方（焦点の戻し先・Esc の止め方）。試験に DOM は無いので、押した所と焦点と伝わる順（捕まえる段→ふつうの段）だけの小さな偽物で本物の CellMenu を動かす
//   穴 1：メニューを開いたまま下の帯の空きを押すと、焦点が開いたボタン（ボードの中）へ戻り、ボードのキーが生き返って Delete で選んだカードが消えた
//   穴 2：Esc がメニューを閉じたうえで window の受け口（選びを外す・メモのタブへ移る・区画を閉じる）へ進んだ
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { boardKeysActive, keyFocusOf } from '../src/memo-card-board-keys';
import { CellMenu } from '../src/panels/cell-menu';

type Handler = (e: FakeEvent) => void;

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

class FakeTarget {
  private readonly handlers: { type: string; fn: Handler; capture: boolean }[] = [];
  addEventListener(type: string, fn: Handler, capture = false) {
    this.handlers.push({ type, fn, capture });
  }
  run(e: FakeEvent, capture: boolean) {
    for (const h of this.handlers) if (h.type === e.type && h.capture === capture) h.fn(e);
  }
}

class FakeEl extends FakeTarget {
  parent: FakeEl | null = null;
  kids: FakeEl[] = [];
  hidden = false;
  disabled = false;
  className = '';
  textContent = '';
  offsetWidth = 100;
  offsetHeight = 100;
  readonly style: Record<string, string> = {};
  readonly classList = { add() {}, remove() {} };
  private readonly attrs = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  hasAttribute(name: string) {
    return this.attrs.has(name);
  }
  contains(other: unknown): boolean {
    for (let n = other as FakeEl | null; n; n = n.parent) if (n === this) return true;
    return false;
  }
  get isConnected(): boolean {
    return page.body.contains(this);
  }
  append(...nodes: FakeEl[]) {
    for (const n of nodes) {
      n.parent = this;
      this.kids.push(n);
    }
  }
  replaceChildren(...nodes: FakeEl[]) {
    if (this.kids.some((k) => k.contains(page.doc.activeElement))) page.doc.activeElement = page.body; // 焦点のあった物が消えたら body へ
    for (const k of this.kids) k.parent = null;
    this.kids = [];
    this.append(...nodes);
  }
  focus() {
    for (let n: FakeEl | null = this; n; n = n.parent) if (n.hidden) return;
    if (!this.isConnected || page.doc.activeElement === this) return;
    page.doc.activeElement = this;
    fire(this, 'focusin');
  }
  querySelector(selector: string): FakeEl | null {
    expect(selector).toBe('button:not(:disabled)'); // CellMenu の focusFirst だけが使う
    return this.kids.find((k) => k instanceof FakeButton && !k.disabled) ?? null;
  }
}

class FakeButton extends FakeEl {}

class FakeDoc extends FakeTarget {
  readonly body = new FakeEl();
  activeElement: FakeEl = this.body;
  createElement(tag: string) {
    return tag === 'button' ? new FakeButton() : new FakeEl();
  }
}

class FakeWin extends FakeTarget {
  readonly innerWidth = 1000;
  readonly innerHeight = 800;
}

let page: { doc: FakeDoc; win: FakeWin; body: FakeEl };

// 伝わる順：window → document → … → 押した物（捕まえる段）、押した物 → … → document → window（ふつうの段）。止められたら先へ進まない（同じ物の受け口は全部走る）
function fire(target: FakeEl, type: string, key = ''): FakeEvent {
  const e = new FakeEvent(type, target, key);
  const path: FakeTarget[] = [];
  for (let n: FakeEl | null = target; n; n = n.parent) path.push(n);
  path.push(page.doc, page.win);
  for (const t of [...path].reverse()) {
    t.run(e, true);
    if (e.stopped) return e;
  }
  for (const t of path) {
    t.run(e, false);
    if (e.stopped) return e;
  }
  return e;
}

// 押す：押した物が焦点を決める（押せる物へ移り、それ以外は body へ）
function press(target: FakeEl) {
  fire(target, 'pointerdown');
  if (target instanceof FakeButton) target.focus();
  else page.doc.activeElement = page.body;
}

const key = (name: string) => fire(page.doc.activeElement, 'keydown', name);

beforeEach(() => {
  const doc = new FakeDoc();
  page = { doc, win: new FakeWin(), body: doc.body };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', page.win);
  vi.stubGlobal('HTMLElement', FakeEl);
  vi.stubGlobal('HTMLButtonElement', FakeButton);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ボードの面と、開くボタンと、下の帯。ボタンで開いて、キーボードの位置を一番上の項目へ（ボードのメニューの開き方）
function openFromBoard(options: ConstructorParameters<typeof CellMenu>[0] = {}) {
  const root = new FakeEl();
  const opener = new FakeButton();
  root.append(opener);
  const band = new FakeEl();
  page.body.append(root, band);
  const menu = new CellMenu(options);
  const ran: string[] = [];
  press(opener);
  menu.open(0, 0, [{ label: '項目', run: () => void ran.push('項目') }]);
  menu.focusFirst();
  const item = (menu.node as unknown as FakeEl).kids[0];
  expect(page.doc.activeElement).toBe(item);
  return { root, opener, band, menu, item, ran };
}

describe('CellMenu の焦点の戻し先', () => {
  it('項目を押して閉じたら、開いたボタンへ戻す（今までどおり）', () => {
    const { opener, menu, item, ran } = openFromBoard();
    press(item);
    fire(item, 'click');
    expect(ran).toEqual(['項目']);
    expect(menu.isOpen).toBe(false);
    expect(page.doc.activeElement).toBe(opener);
  });

  it('Esc で閉じたら、開いたボタンへ戻す（今までどおり）', () => {
    const { opener, menu } = openFromBoard();
    key('Escape');
    expect(menu.isOpen).toBe(false);
    expect(page.doc.activeElement).toBe(opener);
  });

  it('外を押して閉じたら戻さない。焦点は押した所が決める', () => {
    const { root, band, menu } = openFromBoard();
    let focusin = 0;
    root.addEventListener('focusin', () => void focusin++);
    press(band);
    expect(menu.isOpen).toBe(false);
    expect(page.doc.activeElement).toBe(page.body);
    expect(focusin).toBe(0); // ボードの中へ焦点が一度も入らない
  });

  it('外の押せる物を押したら、焦点はその物へ', () => {
    const { band, menu } = openFromBoard();
    const other = new FakeButton();
    band.append(other);
    press(other);
    expect(menu.isOpen).toBe(false);
    expect(page.doc.activeElement).toBe(other);
  });

  it('keepOpen の所を押しても閉じない（今までどおり）', () => {
    const { band, menu, item } = openFromBoard({ keepOpen: (target) => band.contains(target) });
    fire(band, 'pointerdown');
    expect(menu.isOpen).toBe(true);
    expect(page.doc.activeElement).toBe(item);
  });

  it('窓から焦点が外れて閉じたら、開いたボタンへ戻す（今までどおり。戻ってきたときの位置）', () => {
    const { opener, menu } = openFromBoard();
    page.win.run(new FakeEvent('blur', page.body, ''), false);
    expect(menu.isOpen).toBe(false);
    expect(page.doc.activeElement).toBe(opener);
  });

  it('穴 1：上に出したボードの［型を貼る ▾］を開いて下の帯の空きを押すと、ボードのキーは効かないまま（Delete が通らない）', () => {
    const { root, band, menu } = openFromBoard();
    // memo-board-tab.ts と同じ形：最後に押した所を window の捕まえる段で覚え、ボードの中へ焦点が入ったら「ボードを使っている」に戻す
    let pointerOutside = false;
    page.win.addEventListener('pointerdown', (e) => void (pointerOutside = !(root.contains(e.target) || menu.node.contains(e.target as unknown as Node))), true);
    root.addEventListener('focusin', () => void (pointerOutside = false));
    const keysAllowed = () => {
      const target = page.doc.activeElement;
      return boardKeysActive(true, keyFocusOf(root.contains(target), target === page.body), pointerOutside);
    };
    press(band);
    expect(pointerOutside).toBe(true);
    expect(keysAllowed()).toBe(false);
    press(root); // ボードを押し直せば、また効く（手順書 4.6-3）
    expect(keysAllowed()).toBe(true);
  });
});

describe('CellMenu の Esc（stopEsc）', () => {
  // 区画の Esc の受け口（memo-pane.ts）は window のふつうの段、ボードが中の Esc を覚えるのは window の捕まえる段
  function listenWindow() {
    const heard = { capture: 0, bubble: 0 };
    page.win.addEventListener('keydown', () => void heard.capture++, true);
    page.win.addEventListener('keydown', () => void heard.bubble++);
    return heard;
  }

  it('stopEsc：メニューの中の Esc は閉じるだけ。window のふつうの段へ進まない', () => {
    const { opener, menu } = openFromBoard({ stopEsc: true });
    const heard = listenWindow();
    const e = key('Escape');
    expect(menu.isOpen).toBe(false);
    expect(page.doc.activeElement).toBe(opener);
    expect(heard).toEqual({ capture: 1, bubble: 0 });
    expect(e.defaultPrevented).toBe(true);
  });

  it('穴 2：stopEsc：焦点がメニューの外（body）でも閉じるだけ。選びを外す・区画を閉じるへ進まない', () => {
    const { menu } = openFromBoard({ stopEsc: true });
    page.doc.activeElement = page.body; // メニューの中の押せない所を押すと、開いたまま焦点が body へ移る
    const heard = listenWindow();
    key('Escape');
    expect(menu.isOpen).toBe(false);
    expect(heard).toEqual({ capture: 1, bubble: 0 });
    expect(page.doc.activeElement).toBe(page.body);
  });

  it('stopEsc：閉じたあとの Esc は止めない（何もメニューが無いときの Esc は今の決めのまま次の段へ）', () => {
    const { menu } = openFromBoard({ stopEsc: true });
    key('Escape');
    expect(menu.isOpen).toBe(false);
    const heard = listenWindow();
    const e = key('Escape');
    expect(heard).toEqual({ capture: 1, bubble: 1 });
    expect(e.defaultPrevented).toBe(false);
  });

  it('stopEsc：Esc 以外のキーは止めない', () => {
    const { menu } = openFromBoard({ stopEsc: true });
    const heard = listenWindow();
    const e = key('Delete');
    expect(menu.isOpen).toBe(true);
    expect(heard).toEqual({ capture: 1, bubble: 1 });
    expect(e.stopped).toBe(false);
  });

  it('stopEsc が無いメニューは今までどおり（閉じて、次の段へも進む）', () => {
    const { menu } = openFromBoard();
    const heard = listenWindow();
    const e = key('Escape');
    expect(menu.isOpen).toBe(false);
    expect(heard).toEqual({ capture: 1, bubble: 1 });
    expect(e.stopped).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });
});
