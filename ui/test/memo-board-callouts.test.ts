// 段 MK8b：ボードの吹き出しの層（app/memo-board-callouts.ts の BoardCallouts）を、偽物の DOM の上で動かす試験（docs/plan-comment-board-marks.md §4.8・§9.1）
//   memo-board-pins.test.ts と同じ形の小さな偽物（要素・イベント・焦点・文書）。時計は vitest の偽物（window は globalThis。Date.now も一緒に進む）
//   確かめること：頭の押し（同じ頭を 2 回でダブルクリック・別の頭は選ぶ）、1 回目の選びで面が低くなっても、ダブルクリックの間は作り直さない（2 回目が同じ要素に当たる）、
//   間が過ぎたら置き直し、押した頭のカードの組を出す、「＋n」はすぐ組を進める、作り直しても選んだ見た目と焦点を保つ、setPicture、clear のあとは数え直す
//   面の大きさ 840×217 と 840×190（タグの行が出て面が低くなった、の見立て。アプリで測った値ではない）と、六角の仮の並びは memo-card-board-callouts.test.ts と同じ
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardCallouts, type CalloutContent } from '../src/app/memo-board-callouts';
import { type BoardView, fitView, placementBounds } from '../src/memo-card-board';
import { type CalloutCard, calloutHead, type CalloutInput } from '../src/memo-card-board-callouts';
import { HEX_GEO } from '../src/memo-card-board-geo';
import { HEX_BOX, hexSlot } from '../src/memo-card-board-hex';
import { PEEK_DOUBLE_MS } from '../src/sheet-peek-logic';

type Handler = (e: FakeEvent) => void;

class FakeEvent {
  stopped = false;
  prevented = false;
  clientX = 10;
  clientY = 20;
  button = 0;
  pointerType = 'mouse';
  constructor(
    readonly type: string,
    init: Partial<Pick<FakeEvent, 'clientX' | 'clientY' | 'button' | 'pointerType'>> = {},
  ) {
    Object.assign(this, init);
  }
  stopPropagation() {
    this.stopped = true;
  }
  preventDefault() {
    this.prevented = true;
  }
}

class FakeText {
  parent: FakeEl | null = null;
  constructor(readonly textContent: string) {}
}

class FakeEl {
  parent: FakeEl | null = null;
  kids: (FakeEl | FakeText)[] = [];
  hidden = false;
  className = '';
  textContent = '';
  title = '';
  type = '';
  src = '';
  alt = '';
  draggable = true;
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  private readonly attrs = new Map<string, string>();
  private readonly handlers: { type: string; fn: Handler }[] = [];
  readonly classList = {
    add: (name: string) => {
      if (!this.classes().includes(name)) this.className = [...this.classes(), name].join(' ');
    },
    toggle: (name: string, on: boolean) => {
      const rest = this.classes().filter((c) => c !== name);
      this.className = (on ? [...rest, name] : rest).join(' ');
    },
    contains: (name: string) => this.classes().includes(name),
  };
  constructor(readonly tag: string) {}
  private classes() {
    return this.className.split(' ').filter((c) => c !== '');
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  addEventListener(type: string, fn: Handler) {
    this.handlers.push({ type, fn });
  }
  // 押す（この要素の受け口だけ。伝わりは試験で見る stopped で確かめる）
  fire(type: string, init: ConstructorParameters<typeof FakeEvent>[1] = {}): FakeEvent {
    const e = new FakeEvent(type, init);
    for (const h of [...this.handlers]) if (h.type === type) h.fn(e);
    return e;
  }
  append(...nodes: (FakeEl | FakeText)[]) {
    for (const n of nodes) {
      if (n instanceof FakeEl) n.remove();
      n.parent = this;
      this.kids.push(n);
    }
  }
  // 外した子の中に焦点があれば、焦点は body へ落ちる（Chromium と同じ）
  replaceChildren(...nodes: (FakeEl | FakeText)[]) {
    for (const k of this.kids) {
      k.parent = null;
      if (k instanceof FakeEl && doc.activeElement && k.contains(doc.activeElement)) doc.activeElement = doc.body;
    }
    this.kids = [];
    this.append(...nodes);
  }
  remove() {
    const p = this.parent;
    if (p) p.kids = p.kids.filter((k) => k !== this);
    this.parent = null;
  }
  contains(node: FakeEl): boolean {
    for (let n: FakeEl | null = node; n; n = n.parent) if (n === this) return true;
    return false;
  }
  focus() {
    doc.activeElement = this;
  }
  getBoundingClientRect() {
    return { left: 30, top: 40, right: 70, bottom: 57 };
  }
  // '.名前' だけ（setPicture が使う）
  querySelectorAll(selector: string): FakeEl[] {
    if (!/^\.[\w-]+$/.test(selector)) throw new Error(`この試験の偽物にない選択子: ${selector}`);
    const out: FakeEl[] = [];
    const walk = (n: FakeEl) => {
      for (const k of n.kids) {
        if (!(k instanceof FakeEl)) continue;
        if (k.classList.contains(selector.slice(1))) out.push(k);
        walk(k);
      }
    };
    walk(this);
    return out;
  }
  // 中の字（頭・文・＋n）
  get text(): string {
    return this.textContent + this.kids.map((k) => (k instanceof FakeEl ? k.text : k.textContent)).join('');
  }
}

class FakeDoc {
  readonly body = new FakeEl('body');
  activeElement: FakeEl | null = this.body;
  createElement(tag: string) {
    return new FakeEl(tag);
  }
  createTextNode(text: string) {
    return new FakeText(text);
  }
}

let doc: FakeDoc;

// 六角 20 枚のうち 10 枚に印（memo-card-board-callouts.test.ts の「置き場の全部」と同じ）。順は c1 c0 c3 c2 c6 c5 c4 c9 c8 c7
const marks: Partial<CalloutCard>[] = [{ like: 3 }, { like: 3 }, { like: 2 }, { like: 2, color: '水' }, { color: '若草' }, { color: '赤紫' }, { color: '水', like: 1 }, { like: 1 }, { like: 1 }, { like: 1 }];
const pts = Array.from({ length: 20 }, (_, i) => hexSlot(i));
const cards: CalloutCard[] = pts.map((p, i) => ({ id: `c${i}`, x: p.x, y: p.y, like: 0, color: '', createdAt: i, ...(marks[i] ?? {}) }));
const fitAt = (vp: { w: number; h: number }): BoardView => fitView(placementBounds(pts, HEX_BOX), vp);
const VIEW = fitAt({ w: 840, h: 217 }); // ［全体］の位置（面 217 で合わせた。面が低くなっても位置は替えない）

let vp: { w: number; h: number };
let view: BoardView;
let exclude: Set<string>;
let shots: Map<string, string>;
let calls: { paint: number; pick: string[]; jump: string[]; menu: [string, number, number, boolean][] };
let callouts: BoardCallouts;

const input = (): CalloutInput => ({ view, viewport: vp, box: HEX_BOX, cards, recent: [], exclude, badge: HEX_GEO.badge });
const content = (id: string): CalloutContent => ({ text: shots.has(id) ? '' : `${id} の文`, shot: shots.get(id) ?? '', url: undefined });
const show = () => callouts.show(input(), content);

const layerEl = () => callouts.layer as unknown as FakeEl;
const boxes = () => layerEl().kids.filter((k): k is FakeEl => k instanceof FakeEl && k.className.split(' ').includes('memo-board-callout'));
const ids = () => boxes().map((b) => b.dataset.callout);
const headOf = (id: string): FakeEl => {
  const box = boxes().find((b) => b.dataset.callout === id);
  if (!box) throw new Error(`頭がありません：${id}`);
  return (box.kids[0] as FakeEl).kids[0] as FakeEl;
};
const moreEl = (): FakeEl | undefined => layerEl().kids.find((k): k is FakeEl => k instanceof FakeEl && k.tag === 'button' && k.className === 'memo-board-callout-more');
const click = (node: FakeEl) => node.fire('click');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal('window', globalThis);
  doc = new FakeDoc();
  vi.stubGlobal('document', doc);
  vp = { w: 840, h: 217 };
  view = VIEW;
  exclude = new Set();
  shots = new Map();
  calls = { paint: 0, pick: [], jump: [], menu: [] };
  callouts = new BoardCallouts({
    paint: () => {
      calls.paint += 1;
      if (callouts.waiting) return; // tab の paintCallouts と同じ：時計を待っている間は時計に任せる
      show(); // そのときの面の大きさ・位置で置き直す
    },
    pick: (id) => calls.pick.push(id),
    jump: (id) => calls.jump.push(id),
    menu: (id, x, y, byKey) => calls.menu.push([id, x, y, byKey]),
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BoardCallouts：置く（偽物の DOM）', () => {
  it('面 217：4+4 の席に 7 枚と「＋3」。頭は番号と印のボタン、文は頭のあとに続ける', () => {
    expect(layerEl().hidden).toBe(true);
    show();
    expect(layerEl().hidden).toBe(false);
    expect(ids()).toEqual(['c1', 'c0', 'c3', 'c2', 'c6', 'c5', 'c4']);
    expect(headOf('c1').tag).toBe('button');
    expect(headOf('c1').textContent).toBe('1 ♥3');
    expect(boxes()[0].text).toBe('1 ♥3c1 の文');
    expect(moreEl()?.textContent).toBe('＋3');
    expect(moreEl()?.title).toBe('次の 3 枚');
  });

  it('中身が同じなら作り直さない（頭は同じ要素のまま）。面が替わって席の数が替われば作り直す', () => {
    show();
    const head = headOf('c2');
    show();
    expect(headOf('c2')).toBe(head);
    vp = { w: 840, h: 190 }; // 3+3 の席：1 組 5 枚と「＋5」
    show();
    expect(ids()).toEqual(['c1', 'c0', 'c3', 'c2', 'c6']);
    expect(headOf('c2')).not.toBe(head);
    expect(moreEl()?.textContent).toBe('＋5');
  });
});

describe('BoardCallouts：頭の押し（MK8b。§4.8・§9.1）', () => {
  it('同じ頭を 400ms 以内にもう一度押すとダブルクリック（jump）。1 回目は選ぶ（pick）。別の頭は選ぶだけ', () => {
    show();
    click(headOf('c1'));
    expect(calls.pick).toEqual(['c1']);
    vi.advanceTimersByTime(100);
    click(headOf('c0'));
    expect(calls.pick).toEqual(['c1', 'c0']);
    expect(calls.jump).toEqual([]);
    vi.advanceTimersByTime(PEEK_DOUBLE_MS + 1);
    click(headOf('c0')); // 長い：選ぶ 1 回目
    vi.advanceTimersByTime(PEEK_DOUBLE_MS);
    click(headOf('c0'));
    expect(calls.jump).toEqual(['c0']);
    expect(calls.pick).toEqual(['c1', 'c0', 'c0']);
  });

  it('1 回目の選びでタグの行が出て面が 217 → 190 に低くなっても、ダブルクリックの間は作り直さない：2 回目は同じ頭の要素に当たり、跳ぶ（左の 4 段目の頭）', () => {
    show();
    const head = headOf('c2'); // 左の 4 段目（面 190 では席が無くなる段）
    click(head);
    expect(calls.pick).toEqual(['c2']);
    vp = { w: 840, h: 190 }; // ResizeObserver → paintCallouts → show
    show();
    expect(ids()).toEqual(['c1', 'c0', 'c3', 'c2', 'c6', 'c5', 'c4']); // 席はそのまま
    expect(headOf('c2')).toBe(head);
    vi.advanceTimersByTime(200);
    click(headOf('c2'));
    expect(calls.jump).toEqual(['c2']);
  });

  it('右の 3 段目の頭（面 190 では「＋n」の段になる）も、2 回目は同じ頭に当たる', () => {
    show();
    const head = headOf('c4');
    click(head);
    vp = { w: 840, h: 190 };
    show();
    expect(moreEl()?.textContent).toBe('＋3'); // 「＋n」は動いていない
    vi.advanceTimersByTime(PEEK_DOUBLE_MS - 1);
    expect(headOf('c4')).toBe(head);
    click(head);
    expect(calls.jump).toEqual(['c4']);
  });

  it('ダブルクリックの間が過ぎたら置き直す（時計が paint を呼ぶ）。押した頭のカードの入る組を出し、選んだ見た目も当て直す', () => {
    show();
    click(headOf('c4')); // 1 組目の 7 番
    callouts.paintSelected(new Set(['c4'])); // tab の paintSelect
    vp = { w: 840, h: 190 };
    show();
    expect(callouts.waiting).toBe(true); // 待つ間も隠さない（tab の paintCallouts は時計に任せる）
    expect(layerEl().hidden).toBe(false);
    expect(calls.paint).toBe(0);
    vi.advanceTimersByTime(PEEK_DOUBLE_MS);
    expect(calls.paint).toBe(1);
    expect(callouts.waiting).toBe(false);
    expect(ids()).toEqual(['c5', 'c4', 'c9', 'c8', 'c7']); // 1 組 5 枚の 2 組目（c4 は 7 番）
    expect(headOf('c4').textContent).toBe(calloutHead(7, 0, '若草')); // 番号は通しのまま
    expect(headOf('c4').classList.contains('is-selected')).toBe(true);
    expect(moreEl()?.textContent).toBe('＋5');
  });

  it('1 組の枚数が替わっても、出していた組の頭のカードの組を出す（押していないとき。組の番だけ保つと別の組が出る）', () => {
    show();
    click(moreEl()!); // 2 組目：8・9・10 番（c9 c8 c7）
    expect(ids()).toEqual(['c9', 'c8', 'c7']);
    vp = { w: 840, h: 150 }; // 2+2 の席で 1 組 3 枚：組の番 1 のままなら 4〜6 番（c2 c6 c5）。c9（8 番）の入る 7〜9 番を出す
    show();
    expect(ids()).toEqual(['c4', 'c9', 'c8']);
  });

  it('見ている位置が替わった（［全体］で合わせ直した）・層が隠れているときは待たない（すぐ作り直す）', () => {
    show();
    click(headOf('c2'));
    vp = { w: 840, h: 190 };
    view = fitAt(vp);
    show();
    expect(callouts.waiting).toBe(false);
    expect(ids()).toHaveLength(5);
    callouts.clear();
    view = VIEW;
    vp = { w: 840, h: 217 };
    show();
    click(headOf('c2'));
    callouts.later(); // 隠して待つ
    vp = { w: 840, h: 190 };
    show(); // 時計を待たずに置く（tab の［全体］の now と同じ）
    expect(layerEl().hidden).toBe(false);
    expect(ids()).toHaveLength(5);
  });

  it('席の「＋n」：頭を押した間でも、すぐ次の組へ（時計を捨てる）。前の頭の押しとは続けて数えない', () => {
    show();
    click(headOf('c1'));
    vp = { w: 840, h: 190 };
    show(); // 待つ（時計あり）
    expect(callouts.waiting).toBe(true);
    click(moreEl()!);
    expect(callouts.waiting).toBe(false);
    expect(calls.paint).toBe(1);
    expect(ids()).toEqual(['c5', 'c4', 'c9', 'c8', 'c7']);
    vi.advanceTimersByTime(50);
    click(headOf('c5'));
    expect(calls.jump).toEqual([]);
    expect(calls.pick).toEqual(['c1', 'c5']);
  });

  it('「＋n」は最後の組のあと頭の組へ戻る。どの組でも最後の席（右の 4 段目）にある', () => {
    show();
    expect([moreEl()?.style.left, moreEl()?.style.top]).toEqual(['572px', '150px']);
    click(moreEl()!);
    expect(moreEl()?.textContent).toBe('＋7');
    expect([moreEl()?.style.left, moreEl()?.style.top]).toEqual(['572px', '150px']);
    click(moreEl()!);
    expect(ids()).toEqual(['c1', 'c0', 'c3', 'c2', 'c6', 'c5', 'c4']);
  });

  it('clear のあとの 1 回目は選ぶ（数えを捨てる）', () => {
    show();
    click(headOf('c1'));
    callouts.clear();
    expect(layerEl().hidden).toBe(true);
    expect(layerEl().kids).toEqual([]);
    show();
    click(headOf('c1'));
    expect(calls.jump).toEqual([]);
    expect(calls.pick).toEqual(['c1', 'c1']);
  });

  it('右クリック：伝わりを止めて、そのカードのメニューの口へ（押した所）。メニューキーなら頭の右上で byKey', () => {
    show();
    const e = headOf('c3').fire('contextmenu', { clientX: 300, clientY: 120 });
    expect(e.prevented && e.stopped).toBe(true);
    headOf('c3').fire('contextmenu', { clientX: 0, clientY: 0 });
    expect(calls.menu).toEqual([
      ['c3', 300, 120, false],
      ['c3', 70, 40, true],
    ]);
    const more = moreEl()!.fire('contextmenu');
    expect(more.prevented && more.stopped).toBe(true);
    expect(calls.menu).toHaveLength(2);
  });
});

describe('BoardCallouts：選んだ見た目・焦点・絵', () => {
  it('選んだ見た目は作り直さずに切り替え、作り直したあとも当て直す', () => {
    show();
    const head = headOf('c0');
    callouts.paintSelected(new Set(['c0']));
    expect(headOf('c0')).toBe(head);
    expect(head.classList.contains('is-selected')).toBe(true);
    expect(headOf('c1').classList.contains('is-selected')).toBe(false);
    vp = { w: 840, h: 190 };
    show();
    expect(headOf('c0')).not.toBe(head);
    expect(headOf('c0').classList.contains('is-selected')).toBe(true);
  });

  it('Tab で頭に焦点を置いていたら、作り直したあと同じカードの頭へ焦点を戻す（body に落とさない）', () => {
    show();
    headOf('c3').focus();
    vp = { w: 840, h: 190 };
    show();
    expect(doc.activeElement).toBe(headOf('c3'));
  });

  it('Enter で選んだ頭（1 回目の押し）は、間のあとの作り直しでも焦点を保つ', () => {
    show();
    headOf('c3').focus();
    click(headOf('c3'));
    vp = { w: 840, h: 190 };
    show();
    vi.advanceTimersByTime(PEEK_DOUBLE_MS);
    expect(calls.paint).toBe(1);
    expect(doc.activeElement).toBe(headOf('c3'));
  });

  it('「＋n」に焦点を置いて押したら、作り直したあと新しい「＋n」へ焦点を戻す', () => {
    show();
    const more = moreEl()!;
    more.focus();
    click(more);
    expect(moreEl()).not.toBe(more);
    expect(doc.activeElement).toBe(moreEl());
  });

  it('焦点が層の外なら触らない', () => {
    const outside = new FakeEl('input');
    outside.focus();
    show();
    vp = { w: 840, h: 190 };
    show();
    expect(doc.activeElement).toBe(outside);
  });

  it('字の無い写真のカードは絵を待って隠し、読めたら setPicture で、作り直さずに入れる', () => {
    shots.set('c1', 'shot1');
    show();
    const box = boxes()[0];
    const img = box.kids[1] as FakeEl;
    expect(box.classList.contains('has-picture')).toBe(true);
    expect(img.tag).toBe('img');
    expect(img.hidden).toBe(true);
    callouts.setPicture('shot2', 'data:image/png;base64,BB');
    expect(img.hidden).toBe(true);
    callouts.setPicture('shot1', 'data:image/png;base64,AA');
    expect(boxes()[0]).toBe(box);
    expect(img.src).toBe('data:image/png;base64,AA');
    expect(img.hidden).toBe(false);
  });
});
