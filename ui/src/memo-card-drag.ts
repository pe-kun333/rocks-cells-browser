// 下の区画のカードを、つまみ「⠿」のドラッグで並べ替える部品（DOM。plan-memo-card-order の O3）
//   ・置き場の印・題の札・つまんだカードを薄くする・貼りつき（札の列と「＋コメント」の欄）を外す・端の自動スクロールを持つ
//   ・左に頼むのは使う側（app/memo-pane.ts の moveCard）。ここは「どのカードの前へ入れるか」を返すだけ
//   ・押す・つまむ・離す・やめるは pointer-grab.ts。置き場の計算は memo-card-order.ts の dropIndexAt（純粋な関数）
//   ・線（SVG の層）は描き直さない。カードの位置はドラッグの間は変わらない（描き直しは使う側が押した時点から待つ）
import { type DropAt, type DropBox, dropIndexAt, dropPos } from './memo-card-order';
import { type Grab, grabPointer } from './pointer-grab';
import { CARD_COLUMNS, lastPlaceableSlot } from './threads';
import { el } from './util';

const EDGE = 24; // スクロールする中身の上下の端から、この px 以内で自動で送る
const STEP = 6; // 自動で送る 1 コマの px

export interface CardDragHost {
  root: HTMLElement; // 区画の根（.grabbing：貼りつきを外す。題の札もここに置く）
  scroll: HTMLElement; // スクロールする中身
  wrap: HTMLElement; // カードの並びの包み（position: relative。印をここに絶対位置で置く）
  cards: HTMLElement; // カードの並び（直下の [data-card] が見えているカード。並びの順）
  canStart(id: string): boolean; // 押した時点で、始めてよいか
  chip(id: string): string; // 題の札の文字
  onStart(id: string): void; // つまんだ（4px 動いた）
  onDrop(id: string, before: string | null | undefined): void; // 離した。before：前に入れる見えているカード（null＝見えている列の最後）、undefined＝元の位置
  onCancel(id: string): void; // つまんでいる間にやめた（元の位置のまま）
  onRelease(): void; // 押しの終わり（離した・やめたのあと。待っていた描き直しをする）
  // 一覧の窓の項目の上（id。'new'＝新しいメモ、'same'＝今のメモ）。無ければ、今までどおり並べ替える
  listHit?(x: number, y: number): string | null;
  listHover?(id: string | null, copy: boolean): void;
  onListDrop?(id: string, target: string, copy: boolean): void;
  // 試し：升目に置いているときの、一番上のカードの番地（id → 行 × 3 ＋ 列。置いていなければ null）。空いた番地に点線の枠を出し、落とすと onPlace
  slots?(): ReadonlyMap<string, number> | null;
  onPlace?(id: string, slot: number): void;
}

type Ghost = { slot: number; node: HTMLElement; left: number; top: number; right: number; bottom: number };

type DragState = {
  id: string;
  node: HTMLElement;
  boxes: DropBox[]; // 見えているカードの矩形（包みの左上から。スクロールしても変わらない）
  from: number; // つまんだカードの、見えている列の番目
  last: { x: number; y: number }; // 最後のポインターの位置（画面）
  at: DropAt | null;
  frame: number;
  ghosts: Ghost[]; // 試し：空いた番地の点線の枠（使っている行と、その次の 1 行）
  slot: number | null; // 試し：ポインターの下の空いた番地（あれば差し込みの代わりにそこへ置く）
  listHit: string | null; // 一覧の項目の上（あれば、並べ替えの印は出さない）
  copy: boolean; // Ctrl（写す）
};

export class CardDrag {
  private grab: Grab | null = null; // 今の押し
  private state: DragState | null = null; // つまんでいる間
  private readonly marker = el('div', 'memo-pane-drop-marker');
  private readonly chipEl = el('div', 'memo-pane-drag-chip');

  constructor(private readonly host: CardDragHost) {
    this.marker.hidden = true;
    this.chipEl.hidden = true;
    this.chipEl.setAttribute('aria-hidden', 'true');
    host.wrap.append(this.marker);
    host.root.append(this.chipEl);
    host.scroll.addEventListener('scroll', () => {
      if (this.state) this.place(); // ホイール・自動で送ったあと、最後のポインターの位置で置き場を測り直す
    });
  }

  // 押している（つまむ前も含む）
  get active(): boolean {
    return this.grab?.active === true;
  }

  // つまんで動かしている
  get moving(): boolean {
    return this.grab?.moving === true;
  }

  // 押している・つまんでいるのをやめる（元の位置のまま）
  cancel(): void {
    this.grab?.cancel();
  }

  // カードのつまみに付ける（カードを描くたびに呼ぶ）
  attach(grip: HTMLElement, id: string): void {
    const grab: Grab = grabPointer(grip, {
      onPress: () => {
        if (this.active || !this.host.canStart(id)) return false;
        this.grab = grab;
        return true;
      },
      onStart: (e) => this.start(id, grip, e),
      onMove: (e) => {
        if (!this.state) return;
        this.state.last = { x: e.clientX, y: e.clientY };
        this.state.copy = e.ctrlKey || e.metaKey;
        this.place();
      },
      onEnd: (e, moved) => this.end(e, moved),
      onCancel: (moved) => this.stop(moved),
    });
  }

  private start(id: string, grip: HTMLElement, e: PointerEvent): void {
    const node = grip.closest<HTMLElement>('[data-card]');
    if (!node) {
      this.cancel();
      return;
    }
    // 貼りつきを外す（並びの位置は変わらない。見える高さが広がり、端はスクロールの箱の端になる）
    this.host.root.classList.add('grabbing');
    this.host.cards.classList.add('reordering');
    node.classList.add('dragging');
    const ghosts = this.addGhosts();
    const boxes = this.measure();
    this.state = { id, node, boxes, from: boxes.findIndex((b) => b.id === id), last: { x: e.clientX, y: e.clientY }, at: null, frame: 0, ghosts, slot: null, listHit: null, copy: e.ctrlKey || e.metaKey };
    this.chipEl.textContent = this.host.chip(id);
    this.chipEl.hidden = false;
    this.marker.hidden = false;
    this.host.onStart(id);
    this.place();
    this.tick();
  }

  // 試し：空いた番地に点線の枠を置いて測る（升目に置いていなければ無し）
  private addGhosts(): Ghost[] {
    const slots = this.host.slots?.();
    if (!slots || !this.host.onPlace) return [];
    const used = new Set(slots.values());
    const nodes: { slot: number; node: HTMLElement }[] = [];
    for (let slot = 0; slot <= lastPlaceableSlot(slots); slot++) {
      if (used.has(slot)) continue;
      const node = el('div', 'memo-pane-slot-ghost');
      node.setAttribute('aria-hidden', 'true');
      node.dataset.slot = String(slot);
      node.style.gridRow = String(Math.floor(slot / CARD_COLUMNS) + 1);
      node.style.gridColumn = String((slot % CARD_COLUMNS) + 1);
      this.host.cards.append(node);
      nodes.push({ slot, node });
    }
    const w = this.host.wrap.getBoundingClientRect();
    return nodes.map(({ slot, node }) => {
      const r = node.getBoundingClientRect();
      return { slot, node, left: r.left - w.left, top: r.top - w.top, right: r.right - w.left, bottom: r.bottom - w.top };
    });
  }

  // 見えているカードの矩形を、包みの左上から測る（ドラッグの始めに一度。スクロールしても変わらない）
  private measure(): DropBox[] {
    const w = this.host.wrap.getBoundingClientRect();
    return [...this.host.cards.querySelectorAll<HTMLElement>(':scope > [data-card]')].map((n) => {
      const r = n.getBoundingClientRect();
      return { id: n.dataset.card ?? '', left: r.left - w.left, top: r.top - w.top, right: r.right - w.left, bottom: r.bottom - w.top };
    });
  }

  // 最後のポインターの位置で、置き場の印と題の札を置く
  private place(): void {
    const s = this.state;
    if (!s) return;
    const hit = this.host.listHit?.(s.last.x, s.last.y) ?? null;
    s.listHit = hit;
    this.host.listHover?.(hit, s.copy);
    const base = this.host.chip(s.id);
    this.chipEl.textContent = hit && hit !== 'same' ? `${s.copy ? '写す' : '移す'} ${base}` : base;
    if (hit) {
      this.marker.hidden = true;
      for (const g of s.ghosts) g.node.classList.remove('hot');
      s.slot = null;
      s.at = null;
    } else {
      const w = this.host.wrap.getBoundingClientRect();
      const p = { x: s.last.x - w.left, y: s.last.y - w.top };
      s.at = dropIndexAt(s.boxes, p);
      // 試し：空いた番地の上なら、そこへ置く（差し込みの印は出さない）
      const ghost = s.ghosts.find((g) => p.x >= g.left && p.x <= g.right && p.y >= g.top && p.y <= g.bottom) ?? null;
      s.slot = ghost?.slot ?? null;
      for (const g of s.ghosts) g.node.classList.toggle('hot', g === ghost);
      const mark = ghost ? null : s.at.mark;
      const box = mark ? s.boxes[mark.box] : undefined;
      if (box && mark) {
        const style = getComputedStyle(this.host.cards);
        const colGap = Number.parseFloat(style.columnGap) || 8;
        const rowGap = Number.parseFloat(style.rowGap) || 8;
        this.marker.classList.toggle('horizontal', s.at.oneColumn);
        if (s.at.oneColumn) {
          // 1 列：カードの上（下）の隙間に横の線
          const y = mark.side === 'before' ? box.top - rowGap / 2 : box.bottom + rowGap / 2;
          Object.assign(this.marker.style, { left: `${box.left}px`, top: `${y - 1}px`, width: `${box.right - box.left}px`, height: '' });
        } else {
          // 並び：入る番目のカードの左の隙間、行の最後なら行の最後のカードの右の隙間に縦の線
          const x = mark.side === 'before' ? box.left - colGap / 2 : box.right + colGap / 2;
          Object.assign(this.marker.style, { left: `${x - 1}px`, top: `${box.top}px`, width: '', height: `${box.bottom - box.top}px` });
        }
        this.marker.hidden = false;
      } else {
        this.marker.hidden = true;
      }
    }
    // 題の札：ポインターの右下（区画の中に収める）
    const root = this.host.root.getBoundingClientRect();
    const cw = this.chipEl.offsetWidth;
    const ch = this.chipEl.offsetHeight;
    const left = Math.max(root.left + 4, Math.min(s.last.x + 12, root.right - cw - 4));
    const top = Math.max(root.top + 4, Math.min(s.last.y + 14, root.bottom - ch - 4));
    this.chipEl.style.left = `${left}px`;
    this.chipEl.style.top = `${top}px`;
  }

  // 端の自動スクロール：ポインターが上下の端から EDGE 以内なら、1 コマに STEP ずつ送る（止めていても続く）
  private tick(): void {
    const s = this.state;
    if (!s) return;
    s.frame = requestAnimationFrame(() => {
      const now = this.state;
      if (!now) return;
      const scroll = this.host.scroll;
      const r = scroll.getBoundingClientRect();
      const dy = now.last.y < r.top + EDGE ? -STEP : now.last.y > r.bottom - EDGE ? STEP : 0;
      if (dy !== 0) {
        const before = scroll.scrollTop;
        scroll.scrollTop = before + dy;
        if (scroll.scrollTop !== before) this.place();
      }
      this.tick();
    });
  }

  private end(e: PointerEvent, moved: boolean): void {
    const s = this.state;
    this.grab = null;
    if (!moved || !s) {
      this.cleanup();
      this.host.onRelease(); // 押しただけ（つまみの欄は click で開く）
      return;
    }
    s.last = { x: e.clientX, y: e.clientY };
    s.copy = e.ctrlKey || e.metaKey;
    this.place();
    if (s.listHit) {
      const target = s.listHit;
      const copy = s.copy;
      const id = s.id;
      this.cleanup();
      this.host.onListDrop?.(id, target, copy);
      this.host.onRelease();
      return;
    }
    if (s.slot !== null && this.host.onPlace) {
      const slot = s.slot;
      this.cleanup();
      this.host.onPlace(s.id, slot);
      this.host.onRelease();
      return;
    }
    const index = s.at?.index ?? s.from;
    const pos = dropPos(index, s.from);
    const others = s.boxes.filter((b) => b.id !== s.id);
    const before = s.from < 0 || pos === s.from ? undefined : (others[pos]?.id ?? null);
    this.cleanup();
    this.host.onDrop(s.id, before);
    this.host.onRelease();
  }

  private stop(moved: boolean): void {
    const id = this.state?.id ?? null;
    this.grab = null;
    this.cleanup();
    if (moved && id !== null) this.host.onCancel(id);
    this.host.onRelease();
  }

  // 印・札・薄く・貼りつきを外したのを、一か所で戻す
  private cleanup(): void {
    const s = this.state;
    if (s) {
      cancelAnimationFrame(s.frame);
      s.node.classList.remove('dragging');
      for (const g of s.ghosts) g.node.remove();
    }
    this.state = null;
    this.host.root.classList.remove('grabbing');
    this.host.cards.classList.remove('reordering');
    this.marker.hidden = true;
    this.chipEl.hidden = true;
    this.host.listHover?.(null, false);
  }
}
