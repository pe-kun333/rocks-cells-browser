// 下の区画のカードの関連の「マップ」の窓（M5）：関連でつながったカードを、力学（memo-card-map.ts）で置いた図
//   ・窓は区画に重なる（DOM は memo-pane.ts が区画の根に入れる）。図は SVG：線は種類の色・破線・矢じり（linkMarkerDefs）、札は題・種類の印・最初のタグの色
//   ・札をつまむと動いて止まる（止めた札は点線の枠）。ダブルクリックで止めを外す。押すと、窓を閉じて並びでそのカードへ（host.pick）
//   ・動きは 1 コマに 1 回（requestAnimationFrame）。動きを減らす設定のときは、一度に回して描く
//   ・線には種類の名前（呼称。名前を変えていれば変えた名前）を、線の真ん中の少し左に出す（A→B と B→A が重ならないように）
//   ・札を右クリック（・ContextMenu キー・Shift+F10）すると、元のコメントカードを札の横に出して止める（何枚でも。もう一度右クリック・「✕ 閉じる」・Esc で閉じる）
//   ・出したカードは、頭の帯をつまんで動かすと、札の右・左・上・下のいちばん近い側に付く（⋯ の欄からも選べる）。
//     選んだ側はカードごとに覚え、最後に選んだ側は、この窓を開いている間の新しいカードの初めの側にもなる（覚えるのは窓を開いている間だけ）
//   ・画面の文字は textContent だけ（SVG の要素も）。乱数を使わない。localStorage を使わない（位置と止めは窓を開いている間だけ覚える）
import { t } from './i18n';
import { type DrawLink, linkKindInfo } from './memo-card-links';
import { linkMarkerDefs } from './memo-card-link-layer';
import {
  edgeEnds,
  edgeLabelPoint,
  initialPositions,
  type MapBox,
  MAP_NODE_H,
  MAP_NODE_W,
  MAP_STEPS,
  mapBounds,
  mapGraph,
  mapGraphKey,
  mapGroups,
  type MapGraph,
  type MapPoint,
  simulateMap,
  stepMap,
} from './memo-card-map';
import type { Reply } from './threads';
import { CardPops, type FrontStack, type PopControl } from './memo-card-pops';
import { el } from './util';

export type { PopControl } from './memo-card-pops';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEAD_PREFIX = 'memo-map-head-'; // 矢じりの defs の id の頭（線の marker-end も同じ頭）
const MARGIN = 24; // 図の外の余白（viewBox）
const DRAG_PX = 4; // これ以上動いたら「つまんでいる」
const SETTLE_STEPS = 60; // つまむのを離した・ダブルクリックのあと、なじませる回数
const MIN_MOVE = 0.1; // いちばん大きく動いた距離がこれより小さくなったら、動きを止める
const DOUBLE_MS = 300; // 止めた札を押したとき、ダブルクリック（止めを外す）かを待つ間

// 出したカードの置き方（呼ぶ側が渡すと、関連の一覧の欄・並びに出したカードと、同じ層・同じ前後の順を使う）
export interface MemoCardMapPopOptions {
  layer?: HTMLElement; // カードを入れる層（無ければ窓の中に作る）。窓と同じ所に重なっていること
  stack?: FrontStack;
  obstacles?(): MapBox[];
}

export interface MemoCardMapHost {
  label(id: string): string; // 札の題（先頭 18 字。呼ぶ側が cardLabel で作る）
  tooltip(id: string): string; // 札に乗せたときの文（題の先頭 80 字とタグ）
  mark(id: string): string; // 種類の印（❝・🖼・🔗・💬）
  dot(id: string): string | null; // 最初のタグの色（無ければ null）
  lineTitle(link: DrawLink): string; // 線に乗せたときの文（「元」は「相手」の根拠）
  pick(id: string): void; // 札を押した（つまんで動かしていない）・Enter：呼ぶ側が窓を閉じて、並びでそのカードへ移る
  close(): void; // 「× 並びに戻る」を押した：呼ぶ側が窓を閉じる
  // 右クリックで出す元のコメントカード（呼ぶ側が並びと同じ作りで作る。カードが無くなっていれば null）。
  //   close はカードの「✕ 閉じる」に付ける（マップの中のカードは、並べ替えのつまみの代わりにこれを出す）
  cardView(id: string, control: PopControl): HTMLElement | null;
}

const KEY_MENU_MS = 800; // ContextMenu キー・Shift+F10 で開け閉めしたあとに届く contextmenu を、同じ操作として捨てる間

interface NodeRef {
  g: SVGGElement;
  dot: SVGCircleElement | null; // 最初のタグの色の点（タグが無ければ無い）
  mark: SVGTextElement;
  label: SVGTextElement;
  title: SVGTitleElement;
}

interface EdgeRef {
  link: DrawLink;
  path: SVGPathElement;
  title: SVGTitleElement;
  label: SVGTextElement; // 線の呼称（種類の名前）
}

interface DragState {
  id: string;
  pointerId: number;
  x: number; // はじめの画面の位置
  y: number;
  moved: boolean; // 4px 以上動いて、つまんでいる
  dx: number; // つかんだ所と札の中心の差（図の座標。つまんだ瞬間に札が跳ねないように）
  dy: number;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

// 動きを減らす設定かどうか（開くたびに聞く）
function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class MemoCardMap {
  readonly el: HTMLElement; // 窓（div.memo-pane-map、hidden）。呼ぶ側が区画の根に入れる
  private readonly title: HTMLElement;
  private readonly note: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly edgeLayer: SVGGElement;
  private readonly labelLayer: SVGGElement; // 線の呼称（線の上、札の下）
  private readonly nodeLayer: SVGGElement;
  private readonly popLayer: HTMLElement; // 右クリックで出したカードの層（窓の中に重ねる）
  private readonly pops: CardPops; // 右クリックで出したカード（memo-card-pops.ts）
  private keyMenuAt = 0; // ContextMenu キー・Shift+F10 で開け閉めした時刻
  private keyMenuId = '';
  private readonly nodes = new Map<string, NodeRef>();
  private edges: EdgeRef[] = [];
  private graph: MapGraph = { ids: [], edges: [], loose: 0 };
  private graphKey = '';
  private groups = new Map<string, number>();
  private pos = new Map<string, MapPoint>(); // 今の位置（動かしている間は毎コマ変わる）
  private vel = new Map<string, MapPoint>();
  private remembered = new Map<string, MapPoint>(); // 覚えている位置（閉じたとき・節が替わるときに、今の位置を写す）
  private pinned = new Set<string>(); // 止めた札（つまんで動かした札。ダブルクリックで外す）
  private drag: DragState | null = null;
  private dragging: string | null = null; // つまんで動かしている札（その間は viewBox を変えない）
  private pending: readonly Reply[] | null = null; // つまんでいる間に届いた写し（つまむのが終わってから行う）
  private budget = 0; // 動きの残りのコマ数
  private frame = 0; // 予約した 1 コマ（0 なら予約なし）
  private opened = false;
  private pickTimer = 0; // 止めた札を押したときの、pick の待ち（その間にダブルクリックが来たら止めを外す）
  private unsettled = false; // 動いている途中で閉じた（開き直したら、動きの続きを回す）
  private aspect = 1; // 図の幅 ÷ 高さ（力学の中心への引きを、図の形に合わせる。動かし始めるときに測る）

  constructor(
    private readonly host: MemoCardMapHost,
    popOptions: MemoCardMapPopOptions = {},
  ) {
    this.el = el('div', 'memo-pane-map');
    this.el.hidden = true;
    const head = el('div', 'memo-pane-map-head');
    this.title = el('span', 'memo-pane-map-title');
    this.note = el('span', 'memo-pane-map-note');
    const reset = el('button', 'memo-pane-map-reset', t('置き直す'));
    reset.type = 'button';
    reset.title = t('止めと位置を捨てて、最初から動かす');
    reset.addEventListener('click', () => this.reset());
    const close = el('button', 'memo-pane-map-close', t('× 並びに戻る（Esc）'));
    close.type = 'button';
    close.addEventListener('click', () => this.host.close());
    head.append(this.title, this.note, reset, close);
    this.svg = svgEl('svg');
    this.svg.classList.add('memo-pane-map-svg');
    this.edgeLayer = svgEl('g');
    this.edgeLayer.classList.add('memo-pane-map-edges');
    this.labelLayer = svgEl('g');
    this.labelLayer.classList.add('memo-pane-map-edge-labels');
    this.nodeLayer = svgEl('g');
    this.nodeLayer.classList.add('memo-pane-map-nodes');
    this.svg.append(linkMarkerDefs(HEAD_PREFIX), this.edgeLayer, this.labelLayer, this.nodeLayer);
    this.popLayer = popOptions.layer ?? el('div', 'memo-pane-map-pops');
    this.el.append(head, this.svg);
    if (!popOptions.layer) this.el.append(this.popLayer);
    this.pops = new CardPops({
      layer: this.popLayer,
      area: () => this.popArea(),
      build: (id, control) => this.host.cardView(id, control),
      label: (id) => this.host.label(id),
      stack: popOptions.stack,
      obstacles: popOptions.obstacles,
      changed: () => {
        for (const [id, ref] of this.nodes) ref.g.classList.toggle('popped', this.pops.has(id));
      },
    });
    window.addEventListener('resize', () => {
      if (this.opened) this.pops.place();
    });
  }

  // 出しているカードの数
  get popCount(): number {
    return this.pops.size;
  }

  // この札のカードを出しているか
  hasPop(id: string): boolean {
    return this.pops.has(id);
  }

  // 最後に出したカードを閉じる（Esc）。閉じたら true（出していなければ false）
  closeLastPop(): boolean {
    return this.pops.closeLast();
  }

  // 出しているカードを、今の写しで作り直す（呼ぶ側が並びを描き直したとき）。札が無くなった（関連が外れた・消えた）カードは閉じる
  refreshPops(): void {
    this.pops.refresh((id) => this.nodes.has(id));
  }

  // 札の右クリック（・関連の一覧の「見る」）：出していなければ出し、出していれば閉じる
  togglePop(id: string, keyboard: boolean): void {
    if (!this.opened || !this.nodes.has(id)) return;
    this.pops.toggle(id, { anchor: () => this.nodes.get(id)?.g ?? null, back: () => (this.opened ? (this.nodes.get(id)?.g ?? null) : null), focus: keyboard });
  }

  // カードを置ける所（窓の中。上の帯の下）
  private popArea(): MapBox | null {
    if (!this.opened) return null;
    const frame = this.popLayer.getBoundingClientRect();
    const box = this.el.getBoundingClientRect();
    const svgRect = this.svg.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return { left: box.left - frame.left, top: svgRect.top - frame.top, right: box.right - frame.left, bottom: box.bottom - frame.top };
  }


  // 全部のカードを閉じる（焦点は戻さない）。最後に選んだ側も忘れる（この窓を開いている間だけ）
  private closeAllPops(): void {
    this.pops.closeAll();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  // 窓を見せて描く。前の位置（同じメモで前に開いたとき）から始める
  open(tops: readonly Reply[]): void {
    if (this.opened) this.close(); // 開いたままの呼び出しは、いったん閉じてから開く（位置は覚えたまま）
    const prevKey = this.graphKey;
    this.opened = true;
    this.el.hidden = false;
    this.setGraph(tops);
    this.buildDom();
    this.paintText();
    // 前に開いたときと節と辺が同じで、全部の位置を覚えていれば、その形のまま描く（動かし直さない。開き直しても同じ形）
    if (prevKey !== '' && prevKey === this.graphKey && this.graph.ids.every((id) => this.remembered.has(id))) {
      this.vel = new Map();
      this.budget = 0;
      this.pos = initialPositions(this.graph.ids, this.remembered);
      this.draw();
      if (this.unsettled) this.kick(MAP_STEPS); // 動いている途中で閉じていたら、続きを回す
      return;
    }
    this.place(this.remembered);
  }

  // 開いている間に写しが届いた：節と辺の組が替わったときだけ動かし直す。替わらなければ、文だけ描き直す（位置は動かさない）
  update(tops: readonly Reply[]): void {
    if (!this.opened) return;
    const graph = mapGraph(tops);
    if (mapGraphKey(graph) === this.graphKey) {
      this.graph = graph; // 同じ節と辺（札の文と線の文だけ替わる）
      this.paintText();
      this.refreshPops();
      return;
    }
    if (this.drag !== null) {
      this.pending = tops; // つまんでいる間は、札を作り直さない（つまむのが終わってから行う）
      this.refreshPops();
      return;
    }
    this.remember();
    this.setGraph(tops);
    this.buildDom();
    this.paintText();
    this.place(this.remembered);
    this.refreshPops(); // 札が無くなった（関連が外れた・消えた）カードは閉じる
  }

  // 窓を隠し、動きを止める（位置と止めは覚えたまま）
  close(): void {
    if (this.opened) {
      this.remember();
      this.unsettled = this.budget > 0;
    }
    this.closeAllPops(); // 出したカードは、窓を閉じたら閉じる（開き直しても出さない）
    this.halt();
    window.clearTimeout(this.pickTimer);
    this.pickTimer = 0;
    this.drag = null;
    this.dragging = null;
    this.pending = null;
    this.opened = false;
    this.el.hidden = true;
  }

  // メモが替わった：位置と止めを捨てる
  forget(): void {
    this.remembered = new Map();
    this.pinned = new Set();
    this.graphKey = '';
  }

  // 置き直す：止めと位置を捨てて、最初から動かす（札と線は作り直さない）
  private reset(): void {
    if (!this.opened) return;
    this.remembered = new Map();
    this.pinned.clear();
    this.place(this.remembered);
  }

  private setGraph(tops: readonly Reply[]): void {
    this.graph = mapGraph(tops);
    this.graphKey = mapGraphKey(this.graph);
    this.groups = mapGroups(this.graph.ids, this.graph.edges);
  }

  // 節と辺の札・線を作り直す（節か辺が替わったとき）。線を下、札を上に置く
  private buildDom(): void {
    this.nodeLayer.replaceChildren();
    this.edgeLayer.replaceChildren();
    this.labelLayer.replaceChildren();
    this.nodes.clear();
    this.edges = [];
    for (const link of this.graph.edges) {
      const info = linkKindInfo(link.kind);
      const path = svgEl('path');
      path.classList.add('memo-pane-map-edge');
      path.setAttribute('stroke', info.color);
      path.style.setProperty('--rel', info.color); // 描くときはテーマの明るさの帯へ（data-colors.css）
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      if (info.dashed) path.setAttribute('stroke-dasharray', '5 4');
      if (info.head !== 'none') path.setAttribute('marker-end', `url(#${HEAD_PREFIX}${info.kind})`);
      const title = svgEl('title');
      path.append(title);
      this.edgeLayer.append(path);
      const label = svgEl('text');
      label.classList.add('memo-pane-map-edge-label');
      label.setAttribute('fill', info.color);
      label.style.setProperty('--rel', info.color);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('aria-hidden', 'true'); // 読み上げは線の title（種類の名前を含む）
      this.labelLayer.append(label);
      this.edges.push({ link, path, title, label });
    }
    for (const id of this.graph.ids) {
      const g = svgEl('g');
      g.classList.add('memo-pane-map-node');
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.dataset.id = id;
      const rect = svgEl('rect');
      rect.setAttribute('width', String(MAP_NODE_W));
      rect.setAttribute('height', String(MAP_NODE_H));
      rect.setAttribute('rx', '8');
      const mark = svgEl('text');
      mark.classList.add('memo-pane-map-mark');
      mark.setAttribute('x', '22');
      mark.setAttribute('y', '21');
      const label = svgEl('text');
      label.classList.add('memo-pane-map-label');
      label.setAttribute('x', '40');
      label.setAttribute('y', '21');
      const title = svgEl('title');
      g.append(rect, mark, label, title);
      const ref: NodeRef = { g, dot: null, mark, label, title };
      if (this.pops.has(id)) g.classList.add('popped');
      this.bindNode(id, ref);
      this.nodeLayer.append(g);
      this.nodes.set(id, ref);
    }
  }

  // 札の押し・つまみ・ダブルクリック・キー。押した（つまんでいない）ら pick、つまんで動かしたら止まる
  private bindNode(id: string, ref: NodeRef): void {
    const g = ref.g;
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.drag !== null) return;
      const at = this.toMap(e);
      const center = this.pos.get(id);
      const dx = at && center ? at.x - center.x : 0;
      const dy = at && center ? at.y - center.y : 0;
      this.drag = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false, dx, dy };
      try {
        g.setPointerCapture(e.pointerId);
      } catch {
        // 捕まえられないときは、この札の上で動いたときだけ動く
      }
    });
    g.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== id || e.pointerId !== d.pointerId) return;
      if (!d.moved) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
        d.moved = true;
        this.dragging = id;
      }
      const p = this.toMap(e);
      if (!p) return;
      this.pos.set(id, { x: p.x - d.dx, y: p.y - d.dy }); // つかんだ所の差を保つ
      this.pinned.add(id);
      this.draw();
    });
    g.addEventListener('pointerup', (e) => {
      const d = this.drag;
      if (!d || d.id !== id || e.pointerId !== d.pointerId) return;
      this.drag = null;
      if (!d.moved) {
        // つまんでいない押し：窓を閉じて、並びでこのカードへ。止めた札だけは、ダブルクリック（止めを外す）かを少し待つ
        //   （すぐ pick すると 1 回目の押しで窓が閉じ、ダブルクリックが届かないため）
        window.clearTimeout(this.pickTimer);
        if (this.pinned.has(id)) {
          this.pickTimer = window.setTimeout(() => {
            this.pickTimer = 0;
            if (this.opened) this.host.pick(id);
          }, DOUBLE_MS);
        } else {
          this.host.pick(id);
        }
        return;
      }
      this.dragging = null;
      this.kick(SETTLE_STEPS); // 止めたまま、ほかの札がなじむように
      this.flushPending();
    });
    g.addEventListener('pointercancel', (e) => {
      const d = this.drag;
      if (!d || d.id !== id || e.pointerId !== d.pointerId) return;
      this.drag = null;
      this.dragging = null; // つまむのをやめるだけ（止めた札は止まったまま）
      this.draw();
      this.flushPending();
    });
    g.addEventListener('dblclick', () => {
      window.clearTimeout(this.pickTimer); // 待っていた pick はやめる
      this.pickTimer = 0;
      this.pinned.delete(id); // 止めを外して、動かし直す
      g.classList.remove('pinned');
      this.kick(SETTLE_STEPS);
    });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
        // キーで右クリックの代わり（あとから届く contextmenu は同じ操作として捨てる）
        e.preventDefault();
        this.keyMenuAt = Date.now();
        this.keyMenuId = id;
        this.togglePop(id, true);
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this.host.pick(id);
    });
    g.addEventListener('contextmenu', (e) => {
      e.preventDefault(); // WebView2 の既定の欄は出さない
      e.stopPropagation();
      const fromKey = e.button !== 2; // キー（ContextMenu・Shift+F10）から来た contextmenu
      if (fromKey && this.keyMenuId === id && Date.now() - this.keyMenuAt < KEY_MENU_MS) return; // keydown で開け閉めした分
      this.togglePop(id, fromKey);
    });
  }

  // 画面の位置を、図（SVG）の座標に直す
  private toMap(e: PointerEvent): MapPoint | null {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  // 札の位置・止め・線の端を、今の位置で書き直す（DOM は作り直さない）。つまんでいる間は viewBox を変えない
  private draw(): void {
    for (const [id, ref] of this.nodes) {
      const p = this.pos.get(id);
      if (p) ref.g.setAttribute('transform', `translate(${p.x - MAP_NODE_W / 2} ${p.y - MAP_NODE_H / 2})`);
      ref.g.classList.toggle('pinned', this.pinned.has(id));
    }
    for (const edge of this.edges) {
      const a = this.pos.get(edge.link.from);
      const b = this.pos.get(edge.link.to);
      const ends = a && b ? edgeEnds(a, b) : null;
      edge.path.setAttribute('d', ends ? `M ${ends.from.x} ${ends.from.y} L ${ends.to.x} ${ends.to.y}` : '');
      if (ends) {
        const at = edgeLabelPoint(ends.from, ends.to);
        edge.label.setAttribute('x', String(at.x));
        edge.label.setAttribute('y', String(at.y));
      }
      if (ends) edge.label.removeAttribute('visibility');
      else edge.label.setAttribute('visibility', 'hidden'); // 札どうしが重なって線が無いときは、呼称も出さない
    }
    if (this.dragging === null) this.fitView();
    this.pops.place(); // 札が動いたら、出したカードもついて行く
  }

  // 全部の札が入るように、viewBox を合わせる（札が無ければ外す）。大きくはしない（1 倍まで。札が少ないときに字が大きくなりすぎないように）
  private fitView(): void {
    const b = mapBounds(this.pos, MARGIN);
    if (b.w <= 0 || b.h <= 0) {
      this.svg.removeAttribute('viewBox');
      return;
    }
    const w = this.svg.clientWidth;
    const h = this.svg.clientHeight;
    if (w <= 0 || h <= 0) {
      this.svg.setAttribute('viewBox', `${b.x} ${b.y} ${b.w} ${b.h}`);
      return;
    }
    // 倍率は、札の枠が図に入る大きさ（1 倍まで）。その倍率で図いっぱいの枠を、札の枠の真ん中に置く
    const scale = Math.min(1, w / b.w, h / b.h);
    const vw = w / scale;
    const vh = h / scale;
    this.svg.setAttribute('viewBox', `${b.x + b.w / 2 - vw / 2} ${b.y + b.h / 2 - vh / 2} ${vw} ${vh}`);
  }

  // 図の幅 ÷ 高さ（測れなければ 1。極端な形は 0.25〜4 に収める）
  private measureAspect(): void {
    const w = this.svg.clientWidth;
    const h = this.svg.clientHeight;
    this.aspect = w > 0 && h > 0 ? Math.min(4, Math.max(0.25, w / h)) : 1;
  }

  // 文（上の行・題・印・点・乗せたときの文・線の文）を、今の節と辺で書き直す（位置は動かさない）
  private paintText(): void {
    const n = this.graph.ids.length;
    this.title.textContent = n > 0 ? t('マップ：関連のあるカード {0} 枚', { 0: n }) : t('マップ：関連のあるカードはありません');
    this.note.textContent = t('関連の無いカード {0} 枚（並びにだけ出ます）', { 0: this.graph.loose });
    this.note.hidden = this.graph.loose === 0;
    for (const [id, ref] of this.nodes) {
      const label = this.host.label(id);
      ref.label.textContent = label;
      ref.mark.textContent = this.host.mark(id);
      ref.title.textContent = this.host.tooltip(id);
      ref.g.setAttribute('aria-label', `${label}（押すと並びでこのカードへ。右クリック・Shift+F10 で元のカードを横に出す）`);
      this.paintDot(ref, this.host.dot(id));
    }
    for (const edge of this.edges) {
      edge.title.textContent = this.host.lineTitle(edge.link);
      edge.label.textContent = linkKindInfo(edge.link.kind).name; // 名前を変えていれば、変えた名前（applyLinkKindNames）
    }
  }

  private paintDot(ref: NodeRef, color: string | null): void {
    if (color === null) {
      ref.dot?.remove();
      ref.dot = null;
      return;
    }
    if (ref.dot === null) {
      const dot = svgEl('circle');
      dot.setAttribute('cx', '12');
      dot.setAttribute('cy', '17');
      dot.setAttribute('r', '4');
      ref.g.insertBefore(dot, ref.mark);
      ref.dot = dot;
    }
    ref.dot.setAttribute('fill', color);
    ref.dot.classList.add('memo-pane-map-dot');
    ref.dot.style.setProperty('--data', color);
  }

  // 今の位置を覚える（写しを持たせる。力学は位置の値を書き換えるので、覚える側は別の値にする）
  private remember(): void {
    const next = new Map<string, MapPoint>();
    for (const [id, p] of this.pos) next.set(id, { ...p });
    this.remembered = next;
  }

  // 札の位置を作って、動かす（開いたとき・節が替わったとき・置き直したとき）。動きを減らす設定のときは、一度に回して描く
  private place(keep: ReadonlyMap<string, MapPoint>): void {
    this.vel = new Map();
    this.budget = 0;
    this.measureAspect(); // 窓が見えてから測る（open は el.hidden を外してから呼ぶ）
    if (reducedMotion()) {
      this.pos = simulateMap(this.graph, keep, this.pinned, MAP_STEPS, this.aspect);
      this.draw();
      return;
    }
    this.pos = initialPositions(this.graph.ids, keep);
    this.draw();
    this.kick(MAP_STEPS);
  }

  // 動きを、もう何コマか回す（つまむのを離した・ダブルクリックのあと）。動きを減らす設定のときは、その場で回して描く
  private kick(steps: number): void {
    if (!this.opened) return;
    if (reducedMotion()) {
      for (let i = 0; i < steps; i++) {
        if (this.stepOnce() < MIN_MOVE) break;
      }
      this.draw();
      return;
    }
    this.budget = Math.max(this.budget, steps);
    this.schedule();
  }

  // 力学を 1 回進める。いちばん大きく動いた距離を返す
  private stepOnce(): number {
    return stepMap(this.graph.ids, this.pos, this.vel, this.graph.edges, this.pinned, this.groups, this.aspect);
  }

  // 1 コマに 1 回、力学を進めて描く（動きが止まるか、残りのコマ数が尽きたら止める）
  private readonly tick = (): void => {
    this.frame = 0;
    if (!this.opened || this.budget <= 0) return;
    const most = this.stepOnce();
    this.budget -= 1;
    if (most < MIN_MOVE) this.budget = 0;
    this.draw();
    this.schedule();
  };

  private schedule(): void {
    if (this.frame !== 0 || !this.opened || this.budget <= 0) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  // 動きを止める（予約した 1 コマも取り消す）
  private halt(): void {
    this.budget = 0;
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  // つまんでいる間に届いた写しを、つまむのが終わってから行う
  private flushPending(): void {
    const tops = this.pending;
    if (tops === null) return;
    this.pending = null;
    this.update(tops);
  }
}
