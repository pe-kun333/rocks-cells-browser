// 元のカードを、何かの横に出して止める「出したカード」の世話役（マップの札の右クリック・並びの「関連」の「見る」で使う）
//   ・カードの中身は呼ぶ側が作る（並びと同じ commentCard。並べ替えのつまみの代わりに「✕ 閉じる」）。何枚でも出せる
//   ・カードは「元」（anchor：札・並びのカード・別の出したカード）の横に置き、元が動けばついて行く。元が見えないときは、最後の位置のまま置ける所に収める
//   ・頭の帯をつまんで動かすと、元の右・左・上・下のいちばん近い側に付く（薄い枠を 4 つ出して、近い側を濃く）。⋯ の欄からも選べる（呼ぶ側が PopControl で）
//   ・選んだ側はカードごとに覚え、最後に選んだ側は、新しいカードの初めの側にもなる（closeAll で忘れる。localStorage は使わない）
//   ・作り直し（refresh）は、書く欄に焦点があるカード・つまんで動かしているカードを飛ばす。カードが無くなったら閉じる
//   ・前後の順（FrontStack）：出したカードと関連の一覧の欄は、最後に押した・焦点が入った・新しく出したものが前（乗せただけでは変えない）
//   ・避けるもの（obstacles：開いている関連の一覧の欄など）と元の四角に重ならない側を探して置く（avoidPlacement。選んだ側は変えない）。
//     置いた位置は、元が動く・カードの大きさが変わるまで、そのままにする（欄を開け閉めしても、カードは跳ねない）。
//     欄を避けて置いたカードは、元が動いたら同じだけ動かす（置ける所からはみ出すまで。はみ出したら置き直す）
//   ・画面の文字は textContent だけ
import { avoidPlacement, boxesOverlap, clampInto, type MapBox, type MapPoint, type MapSide, MAP_SIDES, nearestSide, sidePlacement } from './memo-card-map';
import { el } from './util';

// 出したカードの操作（呼ぶ側がカードのボタン・⋯ の欄に付ける）
export interface PopControl {
  close(): void; // 「✕ 閉じる」
  side(): MapSide; // 今の側（選んだ側。まだ選んでいなければ、今置いている側）
  setSide(side: MapSide): void; // ⋯ の「右に出す」など
  readonly scope: HTMLElement; // このカードの入っている層（描き直したあとに焦点を当てる欄を探す所）
}

// 前後の順：同じ層（同じ重なりの文脈）の中で、押した・焦点が入った・新しく出したものを前にする。乗せただけでは変えない（ちらつかないように）
export class FrontStack {
  private top = 10;

  raise(node: HTMLElement): void {
    if (node.style.zIndex === String(this.top)) return; // もう前
    this.top += 1;
    node.style.zIndex = String(this.top);
  }

  // 押す（捕まえる段で、中のボタンより先に）・焦点が入ったら前へ
  watch(node: HTMLElement): void {
    node.addEventListener('pointerdown', () => this.raise(node), true);
    node.addEventListener('focusin', () => this.raise(node));
  }
}

export interface CardPopsOptions {
  layer: HTMLElement; // カードを入れる層（位置はこの層の左上から）。呼ぶ側が置く
  area(): MapBox | null; // カードを置ける所（層の中の位置。測れなければ null）
  build(id: string, control: PopControl): HTMLElement | null; // カードを作る（無くなっていれば null）
  label(id: string): string; // 読み上げの名前
  changed?(): void; // 出した・閉じた（札の印を付け直すなど）
  stack?: FrontStack; // 前後の順（ほかの出したカード・関連の一覧の欄と分け合う。無ければこの世話役だけの順）
  obstacles?(): MapBox[]; // 重ならないように避けるもの（層の中の位置。開いている関連の一覧の欄など）
}

export interface PopOpen {
  anchor(): Element | null; // 横に置く元（無い・見えないときは、最後の位置のまま）
  back?(): HTMLElement | SVGElement | null; // 閉じたら焦点を戻す所
  focus?: boolean; // 出したら「✕ 閉じる」に焦点（キーボードで出したとき）
}

const DRAG_PX = 4; // 頭の帯をこれ以上動かしたら「つまんでいる」
// つまめない所（ボタン・書く欄・リンクなど。押したときの働きを残す）
const NO_DRAG = 'button, input, textarea, select, a, label, [contenteditable], [role="button"], [role="menuitem"]';
export const POP_GAP = 8; // 元とカードの間
export const POP_PAD = 4; // 置ける所の縁とカードの間

interface PopRef {
  box: HTMLElement; // div.memo-pane-map-pop（中にカード）
  side: MapSide | null; // 選んだ側（null は、まだ選んでいない：右、入らなければ左）
  shown: MapSide; // 今置いている側（入らなくて反対に置いたときは、選んだ側と違う）
  anchor: () => Element | null;
  back: () => HTMLElement | SVGElement | null;
  last: MapPoint | null; // 最後に置いた位置（元が見えないときに使う）
  hold: { at: MapPoint; anchor: MapBox; w: number; h: number; avoided: boolean } | null; // 置いた位置と、そのときの元・大きさ（変わるまで、そのまま）
}

interface PopDrag {
  id: string;
  pointerId: number;
  x: number; // はじめの画面の位置
  y: number;
  left: number; // はじめのカードの位置（層の中）
  top: number;
  moved: boolean;
  near: MapSide;
}

export class CardPops {
  private readonly pops = new Map<string, PopRef>(); // 出しているカード（入れた順。Esc は最後に出したものから閉じる）
  private defaultSide: MapSide | null = null;
  private drag: PopDrag | null = null;
  private ghosts: HTMLElement[] = [];
  private readonly stack: FrontStack;

  constructor(private readonly opt: CardPopsOptions) {
    this.stack = opt.stack ?? new FrontStack();
  }

  get size(): number {
    return this.pops.size;
  }

  has(id: string): boolean {
    return this.pops.has(id);
  }

  boxOf(id: string): HTMLElement | null {
    return this.pops.get(id)?.box ?? null;
  }

  // 出していなければ出し、出していれば閉じる。出したら true
  toggle(id: string, how: PopOpen): boolean {
    if (this.pops.has(id)) {
      this.close(id, how.focus === true);
      return false;
    }
    return this.open(id, how);
  }

  open(id: string, how: PopOpen): boolean {
    if (this.pops.has(id)) return true;
    const box = el('div', 'memo-pane-map-pop');
    box.dataset.pop = id;
    box.tabIndex = -1;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `元のカード：${this.opt.label(id)}`);
    const ref: PopRef = { box, side: this.defaultSide, shown: this.defaultSide ?? 'right', anchor: how.anchor, back: how.back ?? (() => null), last: null, hold: null }; // 最後に選んだ側から始める
    this.pops.set(id, ref);
    const card = this.opt.build(id, this.control(id));
    if (!card) {
      this.pops.delete(id);
      return false;
    }
    card.classList.add('memo-pane-map-card');
    box.append(card);
    this.bindDrag(id, box);
    this.stack.watch(box);
    this.stack.raise(box); // 新しく出したカードは前（開いている関連の一覧の欄より前）
    this.opt.layer.append(box);
    this.place();
    this.opt.changed?.();
    if (how.focus) (box.querySelector<HTMLElement>('.memo-pane-map-card-close') ?? box).focus({ preventScroll: true });
    return true;
  }

  // 閉じる（returnFocus：焦点を戻す所へ。カードの中に焦点があったときも戻す）
  close(id: string, returnFocus: boolean): void {
    const pop = this.pops.get(id);
    if (!pop) return;
    const had = pop.box.contains(document.activeElement);
    if (this.drag?.id === id) {
      this.drag = null;
      this.hideGhosts();
    }
    pop.box.remove();
    this.pops.delete(id);
    if (returnFocus || had) {
      const back = pop.back();
      if (back?.isConnected) back.focus({ preventScroll: true });
    }
    this.opt.changed?.();
  }

  // 最後に出したカードを閉じる（Esc）。閉じたら true
  closeLast(): boolean {
    const ids = [...this.pops.keys()];
    const last = ids[ids.length - 1];
    if (last === undefined) return false;
    this.close(last, true);
    return true;
  }

  // 全部閉じて、最後に選んだ側も忘れる（焦点は戻さない）
  closeAll(): void {
    for (const id of [...this.pops.keys()]) this.close(id, false);
    this.defaultSide = null;
  }

  // 今の写しで作り直す。alive が false のカード・作れなくなったカードは閉じる。
  //   書く欄（input・textarea）に焦点があるカード・つまんで動かしているカードは作り直さない。ボタンなどの焦点は、同じ印の要素へ戻す
  refresh(alive: (id: string) => boolean = () => true): void {
    for (const [id, pop] of [...this.pops]) {
      if (!this.pops.has(id)) continue; // 前のカードを閉じたときに、一緒に閉じた
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && pop.box.contains(active) ? active : null;
      if (!alive(id)) {
        this.close(id, inside !== null);
        continue;
      }
      if (inside && (inside instanceof HTMLInputElement || inside instanceof HTMLTextAreaElement)) continue;
      if (this.drag?.id === id && this.drag.moved) continue;
      const card = this.opt.build(id, this.control(id));
      if (!card) {
        this.close(id, inside !== null);
        continue;
      }
      const key = inside?.dataset.focusKey ?? null;
      const scroll = pop.box.scrollTop;
      card.classList.add('memo-pane-map-card');
      pop.box.replaceChildren(card);
      pop.box.scrollTop = scroll;
      if (inside) {
        const again = key !== null ? pop.box.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`) : null;
        (again ?? pop.box).focus({ preventScroll: true });
      }
    }
    this.place();
  }

  // 元の横に置き直す（元が動くたび）。選んだ側（無ければ右）に置き、入らなければ、その時だけ反対の側。
  //   元が無い・置ける所の外にあるときは、最後の位置のまま収める。つまんで動かしているカードは動かさない（薄い枠だけ元について行く）
  place(): void {
    if (this.pops.size === 0) return;
    const area = this.opt.area();
    if (!area) return;
    for (const [id, pop] of this.pops) {
      pop.box.style.maxHeight = `${Math.max(80, area.bottom - area.top - POP_PAD * 2)}px`;
      if (this.drag?.id === id && this.drag.moved) {
        this.placeGhosts(id);
        continue;
      }
      const size = { w: pop.box.offsetWidth, h: pop.box.offsetHeight };
      const node = this.anchorBox(pop);
      let at: MapPoint;
      if (node && boxesOverlap(node, area)) {
        const hold = pop.hold;
        const sameSize = hold !== null && Math.abs(hold.w - size.w) < 1 && Math.abs(hold.h - size.h) < 1;
        const moved = hold && sameSize && hold.avoided ? shifted(hold, node) : null; // 欄を避けて置いたカード：元と同じだけ動かす（入るうちは）
        if (hold && sameSize && sameBox(hold.anchor, node)) {
          at = clampInto(hold.at, size, area, POP_PAD); // 元もカードも動いていない：そのまま（欄を開け閉めしても跳ねない）
        } else if (hold && moved && insideArea(moved, size, area, POP_PAD)) {
          at = moved;
          pop.hold = { ...hold, at: moved, anchor: node };
        } else {
          const placed = avoidPlacement(node, size, area, pop.side ?? 'right', [...(this.opt.obstacles?.() ?? []), node], POP_GAP, POP_PAD);
          pop.shown = placed.side;
          at = placed;
          pop.hold = { at: { x: placed.x, y: placed.y }, anchor: node, w: size.w, h: size.h, avoided: placed.avoided };
          pop.box.dataset.avoided = placed.avoided ? 'true' : '';
        }
        pop.box.dataset.away = '';
      } else {
        pop.hold = null;
        at = clampInto(pop.last ?? { x: area.left, y: area.top }, size, area, POP_PAD);
        pop.box.dataset.away = 'true'; // 元が見えていない
      }
      pop.last = at;
      pop.box.style.left = `${Math.round(at.x)}px`;
      pop.box.style.top = `${Math.round(at.y)}px`;
      pop.box.dataset.side = pop.shown;
      pop.box.dataset.chosen = pop.side ?? '';
    }
  }

  private control(id: string): PopControl {
    return {
      close: () => this.close(id, true),
      side: () => {
        const pop = this.pops.get(id);
        return pop ? (pop.side ?? pop.shown) : 'right';
      },
      setSide: (side) => this.setSide(id, side),
      scope: this.opt.layer,
    };
  }

  // 側を選ぶ（つまんで離した・⋯ の欄）。最後に選んだ側は、新しいカードの初めの側にもなる
  private setSide(id: string, side: MapSide): void {
    const pop = this.pops.get(id);
    if (!pop) return;
    pop.side = side;
    pop.hold = null; // 選び直したら置き直す
    this.defaultSide = side;
    this.place();
  }

  // 元の四角（層の中の位置）。元が無ければ null
  private anchorBox(pop: PopRef): MapBox | null {
    const anchor = pop.anchor();
    if (!anchor || !anchor.isConnected) return null;
    const r = anchor.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null; // 隠れている
    const frame = this.opt.layer.getBoundingClientRect();
    return { left: r.left - frame.left, top: r.top - frame.top, right: r.right - frame.left, bottom: r.bottom - frame.top };
  }

  // 頭の帯をつまんで動かす。動かしている間は 4 つの側の薄い枠を出し、いちばん近い側を濃くする。離したら、その側に付く
  private bindDrag(id: string, box: HTMLElement): void {
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.drag !== null) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target || !target.closest('.memo-pane-card-head') || target.closest(NO_DRAG)) return;
      this.drag = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: box.offsetLeft, top: box.offsetTop, moved: false, near: this.pops.get(id)?.shown ?? 'right' };
      try {
        box.setPointerCapture(e.pointerId); // 押した時点で捕まえる（速く動かして、4px のうちにカードの外へ出ても続くように。ボタンの上では捕まえない）
      } catch {
        // 捕まえられないときは、カードの上で動いたときだけ動く
      }
    });
    box.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== id || e.pointerId !== d.pointerId) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
        d.moved = true;
        box.classList.add('dragging');
        this.showGhosts(id);
      }
      e.preventDefault(); // 字を選ばない
      box.style.left = `${Math.round(d.left + e.clientX - d.x)}px`;
      box.style.top = `${Math.round(d.top + e.clientY - d.y)}px`;
      d.near = this.nearOf(id, box) ?? d.near;
      for (const g of this.ghosts) g.classList.toggle('near', g.dataset.side === d.near);
    });
    const stopClick = (c: Event) => c.stopPropagation();
    const end = (e: PointerEvent, drop: boolean) => {
      const d = this.drag;
      if (!d || d.id !== id || e.pointerId !== d.pointerId) return;
      this.drag = null;
      if (!d.moved) return; // つまんでいない押し：ふつうの押し（クリック）のまま
      box.classList.remove('dragging');
      this.hideGhosts();
      if (drop) {
        // 離したあとのクリックは捨てる（頭の帯の字の上で離しても、何も押さない）
        box.addEventListener('click', stopClick, true);
        window.setTimeout(() => box.removeEventListener('click', stopClick, true), 0);
        this.setSide(id, d.near);
      } else {
        this.place(); // やめた：元の位置へ
      }
    };
    box.addEventListener('pointerup', (e) => end(e, true));
    box.addEventListener('pointercancel', (e) => end(e, false));
  }

  // つまんでいるカードの真ん中が、元から見てどの側か（元が無ければ null）
  private nearOf(id: string, box: HTMLElement): MapSide | null {
    const pop = this.pops.get(id);
    const node = pop ? this.anchorBox(pop) : null;
    if (!node) return null;
    const frame = this.opt.layer.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    return nearestSide(
      { x: (node.left + node.right) / 2, y: (node.top + node.bottom) / 2 },
      { x: (b.left + b.right) / 2 - frame.left, y: (b.top + b.bottom) / 2 - frame.top },
    );
  }

  // 4 つの側の薄い枠（そこに置いたときの位置。入らない側は、反対に置いたときの位置）。元が見えなければ出さない
  private showGhosts(id: string): void {
    this.hideGhosts();
    for (const side of MAP_SIDES) {
      const g = el('div', 'memo-pane-map-pop-ghost');
      g.dataset.side = side;
      g.setAttribute('aria-hidden', 'true');
      this.opt.layer.insertBefore(g, this.opt.layer.firstChild);
      this.ghosts.push(g);
    }
    this.placeGhosts(id);
  }

  private placeGhosts(id: string): void {
    const pop = this.pops.get(id);
    const area = this.opt.area();
    const node = pop ? this.anchorBox(pop) : null;
    const seen = node !== null && area !== null && boxesOverlap(node, area);
    for (const g of this.ghosts) g.hidden = !seen;
    if (!pop || !area || !node || !seen) return;
    const size = { w: pop.box.offsetWidth, h: pop.box.offsetHeight };
    for (const g of this.ghosts) {
      const at = sidePlacement(node, size, area, g.dataset.side as MapSide, POP_GAP, POP_PAD);
      g.style.left = `${Math.round(at.x)}px`;
      g.style.top = `${Math.round(at.y)}px`;
      g.style.width = `${size.w}px`;
      g.style.height = `${size.h}px`;
    }
  }

  private hideGhosts(): void {
    for (const g of this.ghosts) g.remove();
    this.ghosts = [];
  }
}

function sameBox(a: MapBox, b: MapBox): boolean {
  return Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.right - b.right) < 0.5 && Math.abs(a.bottom - b.bottom) < 0.5;
}

// 元が動いた分だけ、置いた位置を動かす
function shifted(hold: { at: MapPoint; anchor: MapBox }, node: MapBox): MapPoint {
  return { x: hold.at.x + (node.left - hold.anchor.left), y: hold.at.y + (node.top - hold.anchor.top) };
}

// 置ける所に、はみ出さずに入るか
function insideArea(at: MapPoint, size: { w: number; h: number }, area: MapBox, pad: number): boolean {
  return at.x >= area.left + pad && at.y >= area.top + pad && at.x + size.w <= area.right - pad && at.y + size.h <= area.bottom - pad;
}
