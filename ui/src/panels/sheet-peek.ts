// 試し：シートの入口の「小窓」。入口を1回押すと、行き先のシートを盤面の上の小さな窓でのぞく
//   ・窓は動かない（見出しを引けば動かせる。大きさは変えられない）。中の盤面は、引く・ホイールでどこまでも動かせ、Ctrl+ホイール・＋−で拡大縮小
//   ・中のタブは、左クリックで詳しいカードをセルの近くに出す（すぐには開かない）。もう一度すぐ押すか、カードの「開く」でサイトを開く。盤面のシートは移らない
//   ・右クリックは盤面と同じメニュー。ほかのセルは盤面と同じ左クリック。4px 以上動かすと盤面の移動で、セルは開かない。タブ自体はドラッグで動かさない
//   ・中の入口だけ別：1回押す → 窓がそのシートに変わる（← で戻る）。2回押す → そのシートへ移る（窓は閉じる）
//   ・窓は1つだけ。ほかの入口を押すと置き換わる。✕・Esc・移った・シートを変えた で閉じる。盤面のほかの所を押しても閉じない
import { grabPointer } from '../pointer-grab';
import type { Hex } from '../hex';
import type { SheetStore } from '../sheets';
import { type Box, clampBox, PEEK_ZOOM, peekBox } from '../sheet-peek-logic';
import type { Sidebar, SidebarPreview } from '../sidebar';

export interface SheetPeekDeps {
  host: HTMLElement; // 盤面の入れ物（小窓はこの中に収める）
  sheets: SheetStore;
  makeBoard(root: HTMLElement, preview: SidebarPreview): Sidebar; // 中の盤面（のぞくだけの Sidebar）
  portalTarget(id: string): string | null; // 入口の行き先のシート
  anchorOf(id: string): DOMRect | null; // 盤面の入口のセルの画面上の四角（盤面の大きさが変わったときに置き直す）
  enter(sheet: string, pos?: Hex): boolean; // そのシートへ移る（pos があれば、そのセルをまん中に）。移れたら true
  escBlocked(): boolean; // メニューや欄が開いている（Esc はそちらが先）
  dismissTabDetail?(): void; // 小窓を閉じた・中のシートが変わった：セルの近くの詳細をしまう
  moved?(): void; // 小窓を動かした：詳細カードをセルに合わせる
}

export class SheetPeek {
  private readonly node = document.createElement('section');
  private readonly title = document.createElement('div');
  private readonly name = document.createElement('span');
  private readonly swatch = document.createElement('span');
  private readonly backButton = document.createElement('button');
  private readonly body = document.createElement('div');
  private board: Sidebar | null = null;
  private current: string | null = null; // のぞいているシート
  private history: string[] = []; // ← で戻る先（来た順）
  private portal: string | null = null; // 小窓を開いた盤面の入口
  private dragged = false; // 見出しを引いて動かした（盤面の大きさが変わっても、入口の近くへは戻さない）

  constructor(private readonly deps: SheetPeekDeps) {
    const node = this.node;
    node.className = 'sheet-peek';
    node.hidden = true;
    node.setAttribute('role', 'dialog');
    this.title.className = 'sheet-peek-title';
    this.swatch.className = 'sheet-swatch';
    this.name.className = 'sheet-peek-name';
    this.backButton.className = 'sheet-peek-btn sheet-peek-back';
    this.backButton.textContent = '←';
    this.backButton.addEventListener('click', () => this.back());
    const label = document.createElement('span');
    label.className = 'sheet-peek-label';
    label.append(this.swatch, this.name);
    this.title.append(
      this.backButton,
      label,
      button('＋', '拡大', 'sheet-peek-zoom-in', () => this.board?.zoomBy(1.25)),
      button('−', '縮小', 'sheet-peek-zoom-out', () => this.board?.zoomBy(0.8)),
      button('入る', 'このシートへ移る', 'sheet-peek-enter', () => this.enterCurrent()),
      button('✕', '閉じる（Esc）', 'sheet-peek-close', () => this.close()),
    );
    this.body.className = 'sheet-peek-body';
    node.append(this.title, this.body);
    // 小窓の中の操作は、下の盤面に届かせない（選ぶのを外す・固定を外す などが起きないように）
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel'] as const) {
      node.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'contextmenu' || type === 'wheel') e.preventDefault();
      }, { passive: false });
    }
    // 見出しを引いて動かす（ボタンの上からは始めない）
    let start: { x: number; y: number; left: number; top: number } | null = null;
    grabPointer(this.title, {
      onPress: (e) => {
        if ((e.target as Element).closest('button')) return false;
        start = { x: e.clientX, y: e.clientY, left: node.offsetLeft, top: node.offsetTop };
        this.dragged = true;
      },
      onMove: (e) => {
        if (!start) return;
        this.place({ left: start.left + e.clientX - start.x, top: start.top + e.clientY - start.y, width: node.offsetWidth, height: node.offsetHeight });
      },
      onEnd: () => (start = null),
      onCancel: () => (start = null),
    });
    deps.host.append(node);
    deps.sheets.onChange(() => this.refresh());
    // 盤面の大きさが変わった（下の拡大表示の高さなど）：場所はそのままで、大きさを合わせて盤面の中に収める
    new ResizeObserver(() => this.fit()).observe(deps.host);
  }

  get isOpen() {
    return this.current !== null;
  }

  get sheetId() {
    return this.current;
  }

  get portalId() {
    return this.portal;
  }

  // 入口 portal（行き先 sheet）の小窓を開く。開いていれば置き換える。anchor は入口のセルの画面上の四角
  open(portal: string, anchor: DOMRect | null) {
    const target = this.deps.portalTarget(portal);
    if (!target || !this.deps.sheets.get(target)) return false;
    const wasOpen = this.isOpen;
    this.portal = portal;
    this.history = [];
    this.current = target;
    this.dragged = false;
    this.node.hidden = false;
    if (!wasOpen) window.addEventListener('keydown', this.onKey, true);
    this.placeNear(anchor);
    this.show();
    return true;
  }

  close() {
    if (!this.isOpen) return;
    this.current = null;
    this.portal = null;
    this.history = [];
    this.node.hidden = true;
    window.removeEventListener('keydown', this.onKey, true);
    this.deps.dismissTabDetail?.();
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented || this.deps.escBlocked()) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.close();
  };

  // 中の入口を押した：窓がそのシートに変わる
  private go(sheet: string) {
    if (!this.current || sheet === this.current || !this.deps.sheets.get(sheet)) return;
    this.history.push(this.current);
    this.current = sheet;
    this.show(true);
  }

  private back() {
    const prev = this.history.pop();
    if (!prev) return;
    this.current = prev;
    this.show();
  }

  private enterCurrent() {
    if (this.current && this.deps.enter(this.current)) this.close();
  }

  private ensureBoard(): Sidebar {
    if (this.board) return this.board;
    this.board = this.deps.makeBoard(this.body, {
      sheet: () => this.current,
      clickPortal: (id) => {
        const target = this.deps.portalTarget(id);
        if (target) this.go(target);
      },
      enterPortal: (id) => {
        const target = this.deps.portalTarget(id);
        if (target && this.deps.enter(target)) this.close();
      },
    });
    return this.board;
  }

  // 今のシートを、まん中から見せる（シートが変わるので、前のタブの詳細はしまう）
  private show(keepClicks = false) {
    this.deps.dismissTabDetail?.();
    this.refresh();
    this.ensureBoard().showCenter(PEEK_ZOOM, keepClicks);
  }

  // 名前・色・← を今のシートに合わせる（のぞいているシートが消えたら閉じる）
  private refresh() {
    if (!this.current) return;
    this.history = this.history.filter((id) => this.deps.sheets.get(id));
    const sheet = this.deps.sheets.get(this.current);
    if (!sheet) {
      this.close();
      return;
    }
    this.name.textContent = sheet.name;
    this.swatch.style.setProperty('--sheet', sheet.color);
    this.node.setAttribute('aria-label', `シート「${sheet.name}」の小窓`);
    this.title.title = `シート「${sheet.name}」をのぞいています（見出しを引くと動かせます。タブは1回で詳しいカード、もう一度ですぐ開きます。盤面は移りません。入口は1回でこの窓が進み、2回で移ります）`;
    const prev = this.deps.sheets.get(this.history.at(-1));
    this.backButton.hidden = !prev;
    this.backButton.title = prev ? `「${prev.name}」に戻る` : '';
    this.backButton.setAttribute('aria-label', this.backButton.title || '戻る');
  }

  // 入口のすぐ下（入らなければすぐ上）に置く
  private placeNear(anchor: DOMRect | null) {
    const host = this.deps.host.getBoundingClientRect();
    const area: Box = { left: 0, top: 0, width: host.width, height: host.height };
    const a = anchor ? { left: anchor.left - host.left, top: anchor.top - host.top, width: anchor.width, height: anchor.height } : null;
    this.place(peekBox(a, area), false);
  }

  private fit() {
    if (!this.isOpen) return;
    const host = this.deps.host;
    if (host.clientWidth === 0 || host.clientHeight === 0) return;
    if (!this.dragged && this.portal) {
      const anchor = this.deps.anchorOf(this.portal);
      if (anchor) {
        this.placeNear(anchor);
        return;
      }
    }
    const size = peekBox(null, { left: 0, top: 0, width: host.clientWidth, height: host.clientHeight });
    this.place({ left: size.left, top: this.node.offsetTop, width: size.width, height: size.height });
  }

  private place(box: Box, clamp = true) {
    const host = this.deps.host;
    const b = clamp ? clampBox(box, { left: 0, top: 0, width: host.clientWidth, height: host.clientHeight }) : box;
    Object.assign(this.node.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    if (this.isOpen) this.deps.moved?.();
  }
}

function button(text: string, label: string, cls: string, run: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `sheet-peek-btn ${cls}`;
  b.textContent = text;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', run);
  return b;
}
