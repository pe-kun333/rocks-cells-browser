// 段 CB5a：ボードの 📌 の層の部品の試験。DOM は無いので、cell-menu-options.test.ts と同じ小さな偽物の上で BoardPins を動かす
//   偽物は、この試験で要るもの（要素・イベント・層・窓）だけ足す。CSS は規則を読んで確かめる。見た目と感触は開発画面で主担当が確かめる
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardPins, type PinContent, pinPosition } from '../src/app/memo-board-pins';
import { parseCss, readSrc } from './theme-css';

interface PointerInit {
  pointerId?: number;
  isPrimary?: boolean;
  button?: number;
  buttons?: number;
  clientX?: number;
  clientY?: number;
}

type Handler = (e: FakeEvent) => void;

class FakeEvent {
  stopped = false;
  pointerId = 1;
  isPrimary = true;
  button = 0;
  buttons = 1; // 押したまま（0 だと、つかみの試験が「離れた」と見なす）
  clientX = 0;
  clientY = 0;
  pointerType = 'mouse';
  constructor(
    readonly type: string,
    readonly target: FakeEl | null,
    init: PointerInit,
  ) {
    Object.assign(this, init);
  }
  stopPropagation() {
    this.stopped = true;
  }
  preventDefault() {}
}

// 聞き手を持つもの（要素・文書・窓の共通）
class FakeTarget {
  private readonly handlers: { type: string; fn: Handler }[] = [];
  addEventListener(type: string, fn: Handler) {
    this.handlers.push({ type, fn });
  }
  removeEventListener(type: string, fn: Handler) {
    const i = this.handlers.findIndex((h) => h.type === type && h.fn === fn);
    if (i >= 0) this.handlers.splice(i, 1);
  }
  run(e: FakeEvent) {
    for (const h of [...this.handlers]) if (h.type === e.type) h.fn(e);
  }
}

class FakeEl extends FakeTarget {
  tag = '';
  parent: FakeEl | null = null;
  kids: FakeEl[] = [];
  hidden = false;
  className = '';
  textContent = '';
  title = '';
  type = '';
  src = '';
  alt = '';
  offsetWidth = 100;
  offsetHeight = 100;
  readonly style: Record<string, string> = {};
  private readonly attrs = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  append(...nodes: FakeEl[]) {
    for (const n of nodes) {
      n.remove();
      n.parent = this;
      this.kids.push(n);
    }
  }
  replaceChildren(...nodes: FakeEl[]) {
    for (const k of this.kids) k.parent = null;
    this.kids = [];
    this.append(...nodes);
  }
  remove() {
    const p = this.parent;
    if (p) p.kids = p.kids.filter((k) => k !== this);
    this.parent = null;
  }
  // grabPointer が押した所の「ボタン」を探すときだけ使う
  closest(selector: string): FakeEl | null {
    if (selector !== 'button') throw new Error(`この試験の偽物にない選択子: ${selector}`);
    for (let n: FakeEl | null = this; n; n = n.parent) if (n.tag === 'button') return n;
    return null;
  }
}

class FakeDoc extends FakeTarget {
  createElement(tag: string) {
    const node = new FakeEl();
    node.tag = tag;
    return node;
  }
}

class FakeWin extends FakeTarget {
  // この試験では時計を進めない（つまみのあとの click を捨てる時間は、試験では要らない）
  setTimeout(): number {
    return 0;
  }
  clearTimeout(): void {}
}

// 押した所から上へ伝える（止められたら先へ進まない）
function fire(target: FakeEl, type: string, init: PointerInit = {}): FakeEvent {
  const e = new FakeEvent(type, target, init);
  for (let n: FakeEl | null = target; n; n = n.parent) {
    n.run(e);
    if (e.stopped) break;
  }
  return e;
}

let win: FakeWin;
let layer: FakeEl;
let cards: Map<string, PinContent>;
let anchors: Map<string, { x: number; y: number }>;
let pins: BoardPins;

beforeEach(() => {
  win = new FakeWin();
  vi.stubGlobal('document', new FakeDoc());
  vi.stubGlobal('window', win);
  layer = new FakeEl();
  layer.tag = 'div';
  cards = new Map();
  anchors = new Map();
  pins = new BoardPins({
    layer: layer as unknown as HTMLElement,
    content: (memoId, id) => cards.get(`${memoId}/${id}`) ?? null,
    anchor: (id) => anchors.get(id) ?? null,
    area: () => ({ left: 0, top: 0, right: 500, bottom: 400 }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 留められるカードを 1 枚用意する（anchor は左上の (100, 50)）
function card(memoId: string, id: string, title: string, extra: Partial<PinContent> = {}) {
  cards.set(`${memoId}/${id}`, { title, head: `${title}の事実`, text: `${title}の全文`, ...extra });
  if (!anchors.has(id)) anchors.set(id, { x: 100, y: 50 });
}

// 窓（document・window）に起きたこと
function fireWindow(type: string, init: PointerInit) {
  win.run(new FakeEvent(type, null, init));
}

// 1 件の DOM：頭（0）と中身（1）。頭の中は、📌・名前・✕ の順
const labelOf = (node: FakeEl) => node.getAttribute('aria-label');
const bodyOf = (node: FakeEl) => node.kids[1];
const closeOf = (node: FakeEl) => node.kids[0].kids[2];

describe('pinPosition（置き場所を四角の中に収める）', () => {
  const area = { left: 0, top: 0, right: 500, bottom: 400 };

  it('中に入るときは anchor ＋ off のまま', () => {
    expect(pinPosition({ x: 100, y: 50 }, { x: 8, y: 0 }, { w: 300, h: 120 }, area)).toEqual({ left: 108, top: 50 });
  });

  it('右と下にはみ出すと、四角の端（余白 4px）まで詰める。左と上にはみ出すと 4px で止まる', () => {
    expect(pinPosition({ x: 400, y: 350 }, { x: 8, y: 0 }, { w: 300, h: 120 }, area)).toEqual({ left: 196, top: 276 });
    expect(pinPosition({ x: -50, y: -10 }, { x: 0, y: 0 }, { w: 300, h: 120 }, area)).toEqual({ left: 4, top: 4 });
  });

  it('四角より大きいときは左上に寄せる', () => {
    expect(pinPosition({ x: 100, y: 50 }, { x: 8, y: 0 }, { w: 600, h: 500 }, area)).toEqual({ left: 4, top: 4 });
  });
});

describe('BoardPins（偽物の DOM の上）', () => {
  it('留めると層に 1 件。同じカードをもう一度留めても 1 件のまま', () => {
    card('m1', 'a', 'A');
    pins.pin('m1', 'a');
    expect(layer.kids).toHaveLength(1);
    pins.pin('m1', 'a');
    expect(layer.kids).toHaveLength(1);
    expect(pins.hasOpen('m1')).toBe(true);
  });

  it('カードが無ければ留めない', () => {
    pins.pin('m1', 'none');
    expect(layer.kids).toHaveLength(0);
    expect(pins.hasOpen('m1')).toBe(false);
  });

  it('2 枚目は off がずれる（そのメモの件数の分だけ右下へ）', () => {
    card('m1', 'a', 'A');
    card('m1', 'b', 'B');
    pins.pin('m1', 'a');
    pins.pin('m1', 'b');
    const [first, second] = layer.kids;
    expect(first.style.left).toBe('108px');
    expect(first.style.top).toBe('50px');
    expect(second.style.left).toBe('136px');
    expect(second.style.top).toBe('84px');
  });

  it('頭の帯は 📌・名前・✕（title と aria-label つき）。中身は事実と全文', () => {
    card('m1', 'a', 'A');
    pins.pin('m1', 'a');
    const node = layer.kids[0];
    expect(node.getAttribute('role')).toBe('dialog');
    expect(labelOf(node)).toBe('留めたカード：A');
    const head = node.kids[0];
    expect(head.kids[1].textContent).toBe('A');
    expect(closeOf(node).title).toBe('閉じる（カードは消えません）');
    expect(closeOf(node).getAttribute('aria-label')).toBe('閉じる');
    expect(bodyOf(node).kids.map((k) => k.textContent)).toEqual(['Aの事実', 'Aの全文']);
  });

  it('押したら前に出す（ほかより高い z-index になる）', () => {
    card('m1', 'a', 'A');
    card('m1', 'b', 'B');
    pins.pin('m1', 'a');
    pins.pin('m1', 'b');
    const [first, second] = layer.kids;
    expect(first.style.zIndex).toBe('1');
    expect(second.style.zIndex).toBe('2');
    fire(first, 'pointerdown');
    expect(first.style.zIndex).toBe('3');
  });

  it('頭をつかんで動かすと、ずれた分だけ動く。面の外へは出ない。離したら動かない', () => {
    card('m1', 'a', 'A');
    pins.pin('m1', 'a');
    const node = layer.kids[0];
    fire(node.kids[0], 'pointerdown', { clientX: 200, clientY: 60 });
    fireWindow('pointermove', { clientX: 230, clientY: 90 });
    expect(node.style.left).toBe('138px');
    expect(node.style.top).toBe('80px');
    fireWindow('pointermove', { clientX: 2000, clientY: 90 });
    expect(node.style.left).toBe('396px'); // 四角の右の端（500 − 幅 100 − 余白 4）
    fireWindow('pointerup', { clientX: 2000, clientY: 90 });
    fireWindow('pointermove', { clientX: 10, clientY: 90 });
    expect(node.style.left).toBe('396px');
  });

  describe('refresh', () => {
    it('別のメモのものは隠れて閉じない。戻すと見える', () => {
      card('m1', 'a', 'A');
      pins.pin('m1', 'a');
      const node = layer.kids[0];
      pins.refresh('m2');
      expect(node.hidden).toBe(true);
      expect(layer.kids).toHaveLength(1);
      expect(pins.hasOpen('m1')).toBe(true);
      pins.refresh('m1');
      expect(node.hidden).toBe(false);
    });

    it('カードが消えたら閉じる', () => {
      card('m1', 'a', 'A');
      pins.pin('m1', 'a');
      cards.delete('m1/a');
      pins.refresh('m1');
      expect(layer.kids).toHaveLength(0);
      expect(pins.hasOpen('m1')).toBe(false);
    });

    it('中身が同じなら描き直さない（body の子が同じノードのまま）', () => {
      card('m1', 'a', 'A');
      pins.pin('m1', 'a');
      const body = bodyOf(layer.kids[0]);
      const before = [...body.kids];
      pins.refresh('m1');
      expect(body.kids).toHaveLength(before.length);
      body.kids.forEach((k, i) => expect(k).toBe(before[i]));
    });

    it('中身が変わったら描き直す（文の欄が替わり、文が空なら全文の欄は無い）', () => {
      card('m1', 'a', 'A');
      pins.pin('m1', 'a');
      const node = layer.kids[0];
      const before = bodyOf(node).kids[0];
      cards.set('m1/a', { title: 'A', head: '新しい事実', text: '' });
      pins.refresh('m1');
      expect(bodyOf(node).kids[0]).not.toBe(before);
      expect(bodyOf(node).kids[0].textContent).toBe('新しい事実');
      expect(bodyOf(node).kids).toHaveLength(1);
    });
  });

  it('closeNewest は新しいほうから閉じて true。無ければ false。ほかのメモのものは閉じない', () => {
    card('m1', 'a', 'A');
    card('m1', 'b', 'B');
    card('m2', 'c', 'C');
    pins.pin('m1', 'a');
    pins.pin('m1', 'b');
    pins.pin('m2', 'c');
    expect(pins.closeNewest('m1')).toBe(true);
    expect(layer.kids.map(labelOf)).toEqual(['留めたカード：A', '留めたカード：C']);
    expect(pins.closeNewest('m1')).toBe(true);
    expect(pins.closeNewest('m1')).toBe(false);
    expect(pins.closeNewest('m9')).toBe(false);
    expect(pins.hasOpen('m2')).toBe(true);
  });

  it('closeAll で全部消え、hasOpen はメモごとに答える', () => {
    card('m1', 'a', 'A');
    card('m2', 'c', 'C');
    pins.pin('m1', 'a');
    pins.pin('m2', 'c');
    expect(pins.hasOpen('m1')).toBe(true);
    expect(pins.hasOpen('m2')).toBe(true);
    expect(pins.hasOpen('m3')).toBe(false);
    pins.closeAll();
    expect(layer.kids).toHaveLength(0);
    expect(pins.hasOpen('m1')).toBe(false);
    expect(pins.hasOpen(null)).toBe(false);
  });

  it('絵は data:image/ のときだけ入る', () => {
    card('m1', 'a', 'A', { picture: 'data:image/png;base64,AA==' });
    card('m1', 'b', 'B', { picture: 'https://example.com/a.png' });
    pins.pin('m1', 'a');
    pins.pin('m1', 'b');
    const [withPic, withoutPic] = layer.kids;
    const img = bodyOf(withPic).kids.find((k) => k.tag === 'img');
    expect(img?.src).toBe('data:image/png;base64,AA==');
    expect(img?.alt).toBe('カードの画像');
    expect(bodyOf(withoutPic).kids.some((k) => k.tag === 'img')).toBe(false);
  });

  it('✕ で閉じる。カードは消えない', () => {
    card('m1', 'a', 'A');
    pins.pin('m1', 'a');
    fire(closeOf(layer.kids[0]), 'click');
    expect(layer.kids).toHaveLength(0);
    expect(pins.hasOpen('m1')).toBe(false);
    expect(cards.has('m1/a')).toBe(true);
  });
});

describe('style（規則を読んで確かめる）', () => {
  const rules = parseCss(readSrc('grok-cards.css'));
  const decl = (selector: string, prop: string) =>
    rules.find((r) => r.at.length === 0 && r.selector === selector)?.decls.find((d) => d.prop === prop)?.value;

  it('面は 📌 の位置の基準（position: relative）。層は押せず、カードの窓だけ押せる', () => {
    expect(decl('.memo-board', 'position')).toBe('relative');
    expect(decl('.memo-board-pins', 'pointer-events')).toBe('none');
    expect(decl('.memo-board-pin', 'pointer-events')).toBe('auto');
  });

  it('隠れた 📌 は出ない', () => {
    expect(decl('.memo-board-pin[hidden]', 'display')).toBe('none');
  });
});
