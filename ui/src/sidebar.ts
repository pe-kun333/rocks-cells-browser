// サイドバーのタブ表示
//   小さい表示：無限のハニカム盤面（SVG）
//     セルをドラッグで移動、背景のドラッグか2本指スワイプ（ホイール）で盤面を移動、
//     ピンチ（Ctrl+ホイール）で拡大縮小
//     Ctrl+クリックでセルを選ぶ（もう一度で外す）、Shift+クリックで範囲を選ぶ。右クリックでメニュー（コピー・貼り付け・セット）
//     メモのセル（ページではないセル）も同じ盤面に置く。押すと拡大表示にメモ、ダブルクリックで下の区画を開く
//     シートへの入口（メモのセルの一種）を押すと、行き先のシートを小窓でのぞく（試し）。ダブルクリックでそのシートの盤面に変わる。入口にタブやメモを落とすと、そのシートへ移る
//     ボットのセル（メモのセルの一種）を押すと、Grok Bot アプリのそのボットのチャットが開く。ダブルクリックでも書く欄は開かない
//     アプリのセル（メモのセルの一種）は、クリックでカード、ダブルクリックで中央に出す（もう一度で最前面をやめる）
//     撮ったもののセルは、縮図とスタンプの数。クリックは選ぶだけ。ダブルクリックで右の「撮影」がその件を開く（新しくは撮らない）
//   大きい表示：番号順のリスト（HTML）。正六角形 / 横長 の2つの形、ドラッグで並び替え
//   どちらも、今見ているシートのセルだけを見せる。左上に、シートの名前（押すとシートの一覧）と、戻る ←
import type { AppStore } from './apps';
import { type BoardLink, boardKindName, type CellRef, memoRef, tabRef } from './board-links';
import { type LinkKind, linkKindInfo } from './memo-card-links';
import type { BotActivity } from './bot-replies';
import { type BotStore, botFullState, botFullStateHint, botFullStateLabel } from './bots';
import { cellLines, commentFullyShown, drawAppFace, drawBotFace, drawPortalFace, drawTabFace, type FaceSources, type PortalInfo, resolveFace, svgEl, svgText } from './cellface';
import { gapRoute, type Hex, hexCornerPoints, hexCorners, hexKey, hexToPixel, pixelToHex, vertexToPixel } from './hex';
import { EDGE_DIRECTIONS, islandLabelSize } from './islands';
import type { LikeLevel } from './likes';
import { isSpecialCell, type MemoCell, type MemoStore, memoTitle } from './memocells';
import { type Route, routeLinks } from './routes';
import type { SheetStore } from './sheets';
import type { Tab, TabLook, TabStore } from './tabs';
import { tagColor } from './tags';
import type { Thumbnails } from './thumbs';
import type { Island, IslandDraft } from './types';
import { nextTabPress, popupsHiddenWhileDragging } from './popup-gesture';
import { centerPan, ClickCounter } from './sheet-peek-logic';
import { clamp, initialOf } from './util';

export type ViewMode = 'small' | 'large';
export type LargeShape = 'regular' | 'wide';
export interface BoardView {
  x: number;
  y: number;
  zoom: number;
}

export interface SidebarActions {
  boardLinkMenu?(id: string, x: number, y: number): void; // 盤面の関連の線を押した
  finishBoardLink?(from: CellRef, to: CellRef, kind: LinkKind): void; // 関連づける：相手のセルを押した
  boardLinkingChanged?(on: boolean): void; // 関連づける途中になった・やめた
  islandMenu?(id: string, x: number, y: number): void; // 島の名前を右クリック
  renameIsland?(id: string, x: number, y: number): void; // 島の名前をダブルクリック
  activate(id: number): void;
  close(id: number): void;
  createAt(pos: Hex): void;
  hover(id: number | null): void; // マウスが乗っているタブ（拡大表示に使う）
  viewChanged(): void; // 盤面を動かした・拡大縮小した（保存用）
  // 右クリック：id は押したタブ、memo は押したメモのセル（空いたセルならどちらも null）、hex は押したセル（リストの表示では null）
  contextMenu(info: { id: number | null; memo: string | null; hex: Hex | null; x: number; y: number }): void;
  // 小窓の右クリック：今見ているシートのセルなら、メニューの前に盤面の選択を合わせる（ほかのシートのセルは選択に入れられない）
  prepareContextSelection?(id: number | null, memo: string | null): void;
  // 小窓の空いたセルの右クリック（hex は押したセル）。無ければ今までどおり何も出さない。本盤面の右クリックは使わない（contextMenu のまま）
  peekEmptyMenu?(hex: Hex, x: number, y: number): void;
  hoverMemo(id: string | null): void; // マウスが乗っているメモのセル
  openMemo(id: string): void; // メモのセルを押した（拡大表示にそのメモ）
  openMemoPane(id: string): void; // メモのセルをダブルクリックした（下の区画で開く）
  editMemo(id: string): void; // 書き直す（右クリックのメニューから）
  openPortal(id: string): void; // シートへの入口を押した（そのシートへ移る）
  dropOnPortal(cell: { tab?: number; memo?: string }, portal: string): void; // 入口にタブ・メモのセルを落とした
  openBot(id: string): void; // ボットのセルを押した（Grok Bot アプリのチャットを開く）
  focusApp(id: string): void; // アプリのセルを押した（拡大表示のカード。窓は開かない）
  launchApp(id: string): void; // アプリのセルをダブルクリックした（中央に出す。もう一度で最前面をやめる）
  openCapture(id: string): void; // 撮ったもののセルをダブルクリックした（右の「撮影」でその件を開く。新しくは撮らない）
  sheetMenu(x: number, y: number, keyboard: boolean): void; // 左上のシートの名前を押した（keyboard：Enter・Space で押した）
  back(): void; // 左上の ← を押した
  goToActive(): void; // ◎ を押したが、今のタブはほかのシートにある（そのシートへ移って中心に）
  // 試し：拡大表示がポップアップのとき、タブを1回押す → ポップアップを固定（同じタブをもう一度で外す）。ダブルクリック → そのタブへ
  clickPins?(): boolean; // 1回押しで固定するか（ポップアップの置き場所のときだけ true）
  pinTab?(id: number): void; // そのタブにポップアップを固定（同じタブなら外す）
  pinMemo?(id: string): void; // そのメモのセルにポップアップを固定（同じセルなら外す）
  unpinTab?(): void; // 固定を外す
  boardDrawn?(): void; // 盤面を描き直した（固定したポップアップの位置を合わせる）
  tabDrag?(moving: boolean): void; // 盤面のものをドラッグで動かしている（詳細カードと吹き出しを隠す。終わったら戻す）
  dismissPeekDetail?(): void; // 小窓の空いた所：小窓から出したタブの詳細だけしまう（盤面の選択は触らない）
  // 試し：入口を1回押す → 行き先のシートを小窓でのぞく（無ければ、前のように1回押しでそのシートへ移る）。同じ入口を短い間にもう一度 → 移る
  peekPortal?(id: string): void;
}

// 試し：小窓の中の盤面。決まったシートを描き、盤面の移動・拡大縮小と、セルの左クリック・右クリックを受ける
//   一覧・左上のシートの名前・＋−◎ は作らない。window のキーは聞かない。セルをドラッグして動かす・空いた所にタブを作ることは無い
//   入口だけ別：1回押しで小窓のシートが進む（clickPortal）。2回押しで行き先のシートへ移る（enterPortal）
//   タブの左クリックは、盤面で詳しいカードを出すのと同じ（1回でカード、短い間の2回目でそのタブを開く）。右クリックは盤面と同じメニュー
//   タブをドラッグして動かすことは無い（セルの上で動かしたら、盤面をずらす）
export interface SidebarPreview {
  sheet(): string | null; // 描くシート（null のときは描かない：小窓を閉じている）
  clickPortal(id: string): void; // 入口を1回押した（小窓がそのシートに変わる）
  enterPortal(id: string): void; // 入口を2回押した（その入口の行き先のシートへ移る）
}

export interface SidebarDeps {
  store: TabStore;
  memos: MemoStore;
  sheets: SheetStore;
  thumbs: Thumbnails;
  bots: BotStore; // ボットの台帳（名前とリンクの id。ボットのセルの顔と吹き出しに使う）
  apps: AppStore; // アプリの台帳（名前とアイコン。アプリのセルの顔と吹き出しに使う）
  pinnedAppId?: () => string | null; // いま中央に出しているアプリ（吹き出しを「最前面をやめる」にする）
  botAppMissing(): boolean; // Grok Bot アプリが見つからなかった（ボットのセルを「アプリなし」の顔にする）
  botActivity?(botId: string): BotActivity | undefined; // 第2段：返事・待っている依頼の状態と札の数（読み込む前は undefined）
  backTo(): string | null; // ← で戻る先のシート（無ければ null）
  captureImage(id: string): string | undefined; // 撮ったものの縮図（まだ読んでいなければ読み始める）
  captureMarks(id: string): number; // スタンプの数（台帳の写し。セルには書かない）
}

const CELL = 22; // 小さい表示のセルの大きさ（中心から頂点まで）
const FACE = CELL - 2.5; // セルの六角形の大きさ
const DOUBLE_CLICK_MS = 400; // 試し：これより短い間に同じタブを2回押したらダブルクリック
const DRAG_THRESHOLD = 4; // これ以上動いたら「クリック」ではなく「ドラッグ」とみなす
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;

type Point = { x: number; y: number };
type Drag =
  | { kind: 'cell'; id: number; start: Point; moved: boolean; at: Point }
  | { kind: 'memo'; id: string; start: Point; moved: boolean; at: Point }
  | { kind: 'pan'; start: Point; pan: Point }
  | { kind: 'row'; id: number; startY: number; moved: boolean; index: number };

export interface PatchPreview {
  islands: { name: string; color: string; refs: CellRef[] }[];
  links: { from: CellRef; to: CellRef; kind: LinkKind }[];
  cells?: { pos: Hex; color: string; label: string }[]; // 取り込み：今のシートに置く入口の位置（点線の六角形。§9.4）
}

export class Sidebar {
  mode: ViewMode = 'small';
  shape: LargeShape = 'regular';
  showNumbers = false;
  tabLook: TabLook = 'auto'; // タブのセルの見え方（すべてのシート。タブごとの見え方が優先）
  showBalloons = true; // コメントを、乗せたときに吹き出しで見せる（拡大表示がポップアップのときは見せない）

  private readonly svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private readonly list = document.createElement('ol');
  private readonly controls = document.createElement('div');
  private readonly sheetBar = document.createElement('div');
  private readonly backButton = document.createElement('button');
  private readonly sheetButton = document.createElement('button');
  private readonly balloon = document.createElement('div');
  private pan: Point = { x: 0, y: 0 };
  private zoom = 1;
  private size = { width: 0, height: 0 };
  private drag: Drag | null = null;
  private popupHold = false; // 盤面のものをドラッグしているあいだ、吹き出しを出さない
  private hovered: number | null = null;
  private pendingView: BoardView | null = null; // 大きさが分かってから当てはめる、保存してあった盤面の位置
  private pendingFit = false; // 大きさが分かってから、シートのセルが見える位置にする
  private frame = 0;
  private readonly brokenIcons = new Set<string>();
  private islands: Island[] = [];
  showIslandNames = true; // 盤面に島の名前を出す（表示の設定）
  private boardLinks: readonly BoardLink[] = []; // 盤面の関連の線
  private linking: { from: CellRef; kind: LinkKind } | null = null; // 関連づける途中（次に押したセルが相手）
  private pointerWorld: Point | null = null; // 関連づける途中の、ゴムの線の先
  private pressedLink: string | null = null; // 押した線（離したときに動いていなければ、線のメニュー）
  private patchPreview: PatchPreview = { islands: [], links: [] }; // Grok の提案の見本（点線の島・線。当てる前）
  private drafts: { draft: IslandDraft; cells: Hex[] }[] = []; // 島の案（点線で、寄せた後の形を見せる）
  private highlightTag: string | null = null; // このタグのタブだけを目立たせる
  private highlightLike: LikeLevel | null = null; // このいいねのタブとメモだけを目立たせる（タグとは同時に付かない）
  private paneMemo: string | null = null; // 下の区画で開いているメモのセル
  private route: Route | null = null; // 盤面に出す順路
  private readonly selected = new Set<number>(); // 選んだセル（コピー・セットにする）
  private readonly selectedMemos = new Set<string>(); // 選んだメモのセル
  private selectAnchor: Hex | null = null; // Shift+クリックの範囲の起点
  private hoveredMemo: string | null = null;
  private pointerHex: Hex | null = null; // マウスが最後にあったセル（Ctrl+V で貼る場所）
  private lastTabPress = 0; // 試し：最後にタブを押した（pointerdown）時刻
  private lastMemoClick: { id: string; at: number } | null = null; // 試し：メモのセルの2回押し
  private lastTabClick: { id: number; at: number } | null = null; // 試し：2回押し（ダブルクリック・ダブルタップ）を見分ける
  private readonly portalClicks = new ClickCounter(DOUBLE_CLICK_MS); // 試し：入口の2回押し（1回目で小窓、2回目で移る）
  private readonly previewClicks = new ClickCounter(DOUBLE_CLICK_MS); // 小窓の中の2回押し
  private previewFit: number | null = null; // 小窓：大きさが分かったら、この拡大率でシートのまん中を見せる
  private quietUntil = 0; // 入口を押した直後は、続くクリック・ダブルクリックを受けない（移った先のシートのセルに当たるので）
  private readonly flashing = new Map<number, { start: number; end: number }>(); // 裏で足したタブ → 光らせ始めた・終える時刻
  private readonly flashingMemos = new Map<string, { start: number; end: number }>(); // 光らせているメモのセル（ボットのセルなど。文字の id）
  private readonly store: TabStore;
  private readonly memos: MemoStore;
  private readonly sheets: SheetStore;
  private readonly thumbs: Thumbnails;
  private readonly faces: FaceSources;
  private readonly bots: BotStore;
  private readonly apps: AppStore;
  private readonly pinnedAppId: () => string | null;
  private readonly botAppMissing: () => boolean;
  private readonly botActivity: (botId: string) => BotActivity | undefined;
  private readonly backTo: () => string | null;
  private readonly captureImage: (id: string) => string | undefined;
  private readonly captureMarks: (id: string) => number;

  constructor(
    private readonly root: HTMLElement,
    deps: SidebarDeps,
    private readonly actions: SidebarActions,
    private readonly preview: SidebarPreview | null = null,
  ) {
    this.store = deps.store;
    this.memos = deps.memos;
    this.sheets = deps.sheets;
    this.thumbs = deps.thumbs;
    this.bots = deps.bots;
    this.apps = deps.apps;
    this.pinnedAppId = deps.pinnedAppId ?? (() => null);
    this.botAppMissing = deps.botAppMissing;
    this.botActivity = (botId) => deps.botActivity?.(botId);
    this.backTo = deps.backTo;
    this.captureImage = deps.captureImage;
    this.captureMarks = deps.captureMarks;
    this.faces = {
      image: (id) => this.memos.image(id),
      thumb: (id) => this.thumbs.get(id),
      iconOk: (url) => !this.brokenIcons.has(url),
      iconFailed: (url) => this.markBroken(url),
    };
    this.svg.classList.add('board');
    if (preview) {
      // 小窓の中：盤面と吹き出しだけ
      this.svg.classList.add('board-preview');
      this.balloon.className = 'cell-balloon';
      this.balloon.hidden = true;
      root.append(this.svg, this.balloon);
      new ResizeObserver(() => this.onResize()).observe(root);
      for (const source of [this.store, this.memos, this.thumbs, this.sheets, this.bots, this.apps]) source.onChange(() => this.requestRender());
      this.bindPreviewEvents(preview);
      return;
    }
    this.list.classList.add('tab-list');
    this.controls.className = 'board-controls';
    this.controls.append(
      controlButton('＋', '拡大', () => this.zoomBy(1.25)),
      controlButton('−', '縮小', () => this.zoomBy(0.8)),
      controlButton('◎', '今のタブを中心に', () => this.recenter()),
    );
    // 左上：戻る ← と、シートの名前（押すとシートの一覧と、タブの見え方）
    this.sheetBar.className = 'sheet-bar';
    this.backButton.className = 'sheet-back';
    this.backButton.textContent = '←';
    this.backButton.addEventListener('click', () => {
      if (performance.now() < this.quietUntil) return;
      this.quietUntil = performance.now() + 600; // 続けて押しても1回だけ戻る（押した所に名前のボタンが来ても開かない）
      this.actions.back();
    });
    this.sheetButton.className = 'sheet-chip';
    this.sheetButton.setAttribute('aria-haspopup', 'menu');
    this.sheetButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (performance.now() < this.quietUntil) return;
      const rect = this.sheetButton.getBoundingClientRect();
      this.actions.sheetMenu(rect.left, rect.bottom + 4, e.detail === 0);
    });
    this.sheetBar.append(this.backButton, this.sheetButton);
    this.balloon.className = 'cell-balloon';
    this.balloon.hidden = true;
    root.append(this.svg, this.list, this.controls, this.sheetBar, this.balloon);
    new ResizeObserver(() => this.onResize()).observe(root);
    this.store.onChange(() => this.requestRender());
    this.memos.onChange(() => this.requestRender());
    this.bots.onChange(() => this.requestRender()); // ボットの名前・リンクが変わった
    this.apps.onChange(() => this.requestRender()); // アプリの名前・アイコンが変わった
    this.thumbs.onChange(() => this.requestRender());
    this.sheets.onChange(() => this.requestRender());
    this.bindBoardEvents();
    this.bindListEvents();
  }

  get view(): BoardView {
    return { x: this.pan.x, y: this.pan.y, zoom: this.zoom };
  }

  set view(v: BoardView) {
    if (this.size.width === 0) {
      this.pendingView = v;
      this.pendingFit = false;
      return;
    }
    this.pan = { x: v.x, y: v.y };
    this.zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM);
    this.requestRender();
  }

  // 今見ているシート
  private get sheet() {
    return this.preview ? (this.preview.sheet() ?? '') : this.sheets.current;
  }

  private tabsHere(): Tab[] {
    return this.store.all().filter((t) => t.sheet === this.sheet);
  }

  private memosHere(): MemoCell[] {
    return this.memos.inSheet(this.sheet);
  }

  // シートを変えた：選択・マウスの位置を忘れて、そのシートの盤面の位置（無ければセルが見える位置）にする
  sheetChanged(view: BoardView | null) {
    this.selected.clear();
    this.selectedMemos.clear();
    this.selectAnchor = null;
    this.pointerHex = null;
    this.drag = null;
    this.hideBalloon();
    this.setHover(null);
    this.setHoverMemo(null);
    if (view) {
      this.view = view;
    } else if (this.size.width === 0) {
      this.pendingView = null;
      this.pendingFit = true;
    } else {
      this.fitSheet();
    }
    this.requestRender();
  }

  // 今のタブが見える位置に盤面を戻す（今のタブがほかのシートにあれば、そのシートへ移ってから。タブが無ければシートのセルのまん中）
  recenter() {
    const active = this.store.active;
    if (active && active.sheet !== this.sheet && this.size.width > 0) {
      this.actions.goToActive();
      return;
    }
    this.zoom = 1;
    if (active && active.sheet === this.sheet) {
      const center = hexToPixel(active.pos, CELL);
      this.pan = { x: this.size.width / 2 - center.x, y: this.size.height / 3 - center.y };
      this.requestRender();
      this.actions.viewChanged();
    } else {
      this.fitSheet();
    }
  }

  // そのセルが盤面に見えていなければ、見える位置へ動かす（拡大率はそのまま。右の「タグごとの一覧」からメモを開いたとき）
  reveal(h: Hex) {
    if (this.size.width === 0) return;
    const p = hexToPixel(h, CELL);
    const x = p.x * this.zoom + this.pan.x;
    const y = p.y * this.zoom + this.pan.y;
    const m = CELL * this.zoom;
    if (x >= m && x <= this.size.width - m && y >= this.topInset + m && y <= this.size.height - m) return;
    this.pan = { x: this.size.width / 2 - p.x * this.zoom, y: this.size.height / 3 - p.y * this.zoom };
    this.requestRender();
    this.actions.viewChanged();
  }

  // シートのセルが見える位置（拡大率は 1）
  private fitSheet() {
    this.zoom = 1;
    const points = [...this.tabsHere(), ...this.memosHere()].map((c) => hexToPixel(c.pos, CELL));
    if (points.length === 0) {
      this.pan = { x: this.size.width / 2, y: this.size.height / 3 };
    } else {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const top = Math.min(...ys);
      const cy = (top + Math.max(...ys)) / 2;
      // 上の端が切れないように（盤面の高さの 1/3 より上に収まらなければ、上の端を少し下に）
      const y = Math.min(this.size.height / 3 - cy, CELL * 2.2 - top);
      this.pan = { x: this.size.width / 2 - cx, y };
    }
    this.requestRender();
    this.actions.viewChanged();
  }

  // 試し（小窓）：シートのセルを囲む四角のまん中を、窓のまん中に（大きさが分かる前なら、分かってから）
  //   keepClicks：小窓の中の入口を押して変わったとき（続く2回目の押しを、その入口のダブルクリックとして数える）
  showCenter(zoom: number, keepClicks = false) {
    this.drag = null;
    this.hideBalloon();
    this.clearSelection();
    if (!keepClicks) this.previewClicks.reset();
    if (this.size.width === 0) {
      this.previewFit = zoom;
      return;
    }
    this.previewFit = null;
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const points = [...this.tabsHere(), ...this.memosHere()].map((c) => hexToPixel(c.pos, CELL));
    this.pan = centerPan(points, this.size, this.zoom);
    this.requestRender();
  }

  // そのセルを盤面のまん中に（拡大率はそのまま）
  centerOn(h: Hex) {
    if (this.size.width === 0) return;
    const p = hexToPixel(h, CELL);
    this.pan = { x: this.size.width / 2 - p.x * this.zoom, y: this.size.height / 2 - p.y * this.zoom };
    this.requestRender();
    this.actions.viewChanged();
  }

  // 試し：のぞき方の見た目（タブの見え方・番号・島の名前）を盤面に合わせる
  copyLook(from: Sidebar) {
    this.tabLook = from.tabLook;
    this.showNumbers = from.showNumbers;
    this.showIslandNames = from.showIslandNames;
    this.requestRender();
  }

  // at（盤面上の位置）を中心に拡大縮小する
  zoomBy(factor: number, at?: Point) {
    const p = at ?? { x: this.size.width / 2, y: this.size.height / 2 };
    const w = this.toWorld(p);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.pan = { x: p.x - w.x * this.zoom, y: p.y - w.y * this.zoom };
    this.hideBalloon();
    this.requestRender();
    this.actions.viewChanged();
  }

  // ---------- 盤面の関連の線（段階3） ----------
  setBoardLinks(links: readonly BoardLink[]) {
    this.boardLinks = links;
    this.requestRender();
  }

  // 関連づける：元のセルを決めて、次に押したセルを相手にする（Esc・右クリック・空いた所を押すとやめる）
  startBoardLink(from: CellRef, kind: LinkKind) {
    this.linking = { from, kind };
    this.svg.classList.add('is-linking');
    this.actions.boardLinkingChanged?.(true);
    this.requestRender();
  }

  cancelBoardLink() {
    if (!this.linking) return false;
    this.linking = null;
    this.pointerWorld = null;
    this.svg.classList.remove('is-linking');
    this.actions.boardLinkingChanged?.(false);
    this.requestRender();
    return true;
  }

  get isLinking() {
    return this.linking !== null;
  }

  // セルの名前 → このシートでの場所（無い・ほかのシートなら null）
  private refHere(ref: CellRef): Hex | null {
    const cell = ref.startsWith('t:') ? this.store.byUid(ref.slice(2)) : this.memos.get(ref.slice(2));
    return cell && cell.sheet === this.sheet ? cell.pos : null;
  }

  private refExists(ref: CellRef): boolean {
    return ref.startsWith('t:') ? !!this.store.byUid(ref.slice(2)) : !!this.memos.get(ref.slice(2));
  }

  // 選んでいるセルの名前（線を目立たせる）
  private selectedRefs(): Set<CellRef> {
    const refs = new Set<CellRef>();
    for (const id of this.selected) {
      const tab = this.store.get(id);
      if (tab) refs.add(tabRef(tab.uid));
    }
    for (const id of this.selectedMemos) refs.add(memoRef(id));
    return refs;
  }

  // 選んだセルに線があって、ほかの線を薄くしているか（右クリックで空いた所を押すと外す）
  get emphasizingLinks(): boolean {
    if (this.boardLinks.length === 0) return false;
    const refs = this.selectedRefs();
    return refs.size > 0 && this.boardLinks.some((l) => refs.has(l.from) || refs.has(l.to));
  }

  private boardLinkLayer(): SVGElement | null {
    if (this.boardLinks.length === 0 && !this.linking) return null;
    const g = svgEl('g', { class: 'board-link-layer' });
    const refs = this.selectedRefs();
    const emphasis = refs.size > 0 && this.boardLinks.some((l) => refs.has(l.from) || refs.has(l.to));
    const badges = new Map<string, { pos: Hex; ids: string[] }>();
    for (const link of this.boardLinks) {
      const a = this.refHere(link.from);
      const b = this.refHere(link.to);
      if (!a && !b) continue;
      if (!a || !b) {
        // 相手がほかのシート：こちらのセルに小さな印（押すと線のメニュー）
        const other = a ? link.to : link.from;
        if (!this.refExists(other)) continue;
        const here = (a ?? b) as Hex;
        const key = hexKey(here);
        const badge = badges.get(key) ?? { pos: here, ids: [] };
        badge.ids.push(link.id);
        badges.set(key, badge);
        continue;
      }
      const points = gapLine(a, b);
      if (!points) continue;
      const info = linkKindInfo(link.kind);
      const hot = refs.has(link.from) || refs.has(link.to);
      const cls = ['board-link', emphasis ? (hot ? 'is-hot' : 'is-dim') : ''].filter(Boolean).join(' ');
      const line = svgEl('g', { class: cls, style: `--link: ${info.color}` });
      line.append(svgEl('polyline', { class: info.dashed ? 'board-link-line dashed' : 'board-link-line', points }));
      const head = linkHead(points, info.head);
      if (head) line.append(head);
      const hit = svgEl('polyline', { class: 'board-link-hit', points, 'data-board-link': link.id });
      const tip = svgEl('title', {});
      tip.textContent = `${boardKindName(link.kind)}（押すとメニュー）`;
      hit.append(tip);
      line.append(hit);
      g.append(line);
    }
    for (const { pos, ids } of badges.values()) {
      const c = hexToPixel(pos, CELL);
      const corner = hexCornerPoints(c.x, c.y, CELL - 2.5)[1]; // 右上の角
      const p = { x: corner.x + (c.x - corner.x) * 0.25, y: corner.y + (c.y - corner.y) * 0.25 };
      const first = this.boardLinks.find((l) => l.id === ids[0]);
      const badge = svgEl('g', { class: 'board-link-badge', 'data-board-link': ids[0], style: `--link: ${first ? linkKindInfo(first.kind).color : 'var(--muted)'}` });
      badge.append(svgEl('circle', { cx: p.x, cy: p.y, r: 6 }), svgText(p, ids.length > 1 ? String(ids.length) : '↗', 'board-link-badge-text'));
      const tip = svgEl('title', {});
      const names = [...new Set(ids.map((lid) => this.boardLinks.find((l) => l.id === lid)).filter((l): l is BoardLink => !!l).map((l) => boardKindName(l.kind)))].join('・');
      tip.textContent = `ほかのシートのセルとの関連 ${ids.length} 本（${names}。押すとメニュー）`;
      badge.append(tip);
      g.append(badge);
    }
    // 関連づける途中：元のセルからマウスまでのゴムの線
    if (this.linking) {
      const from = this.refHere(this.linking.from);
      const to = this.pointerWorld;
      if (from && to) {
        const a = hexToPixel(from, CELL);
        const info = linkKindInfo(this.linking.kind);
        g.append(svgEl('line', { class: 'board-link-rubber', x1: a.x, y1: a.y, x2: to.x, y2: to.y, style: `--link: ${info.color}` }));
      }
    }
    return g;
  }

  setIslands(islands: Island[]) {
    this.islands = islands;
    this.requestRender();
  }

  // Grok の提案の見本（一覧でチェックした島・線）。空にすると消える
  setPatchPreview(preview: PatchPreview) {
    this.patchPreview = preview;
    this.requestRender();
  }

  setIslandDrafts(drafts: { draft: IslandDraft; cells: Hex[] }[]) {
    this.drafts = drafts;
    this.requestRender();
  }

  setHighlight(tag: string | null, like: LikeLevel | null) {
    this.highlightLike = like;
    this.highlightTag = like ? null : tag;
    this.requestRender();
  }

  // 下の区画で開いているメモのセル（金色の太い枠）
  setPaneMemo(id: string | null) {
    if (this.paneMemo === id) return;
    this.paneMemo = id;
    this.requestRender();
  }

  // 今の強調に合わないセルを薄くする。いいねが付いていればいいねだけを見る
  private dimmed(tags: readonly string[], liked: number): boolean {
    if (this.highlightLike !== null) return liked !== this.highlightLike;
    return this.highlightTag !== null && !tags.includes(this.highlightTag);
  }

  // 選んでいるタブ（左上から順に。閉じたタブ・ほかのシートへ移ったタブは外す）
  selection(): number[] {
    for (const id of this.selected) if (this.store.get(id)?.sheet !== this.sheet) this.selected.delete(id);
    return [...this.selected].sort((a, b) => {
      const ta = this.store.get(a);
      const tb = this.store.get(b);
      return ta && tb ? ta.pos.r - tb.pos.r || ta.pos.q + ta.pos.r / 2 - (tb.pos.q + tb.pos.r / 2) : 0;
    });
  }

  // 選んでいるメモのセル（消したもの・ほかのシートへ移ったものは外す）
  memoSelection(): string[] {
    for (const id of this.selectedMemos) if (this.memos.get(id)?.sheet !== this.sheet) this.selectedMemos.delete(id);
    return [...this.selectedMemos];
  }

  setSelection(ids: number[], memoIds: string[] = []) {
    this.selected.clear();
    this.selectedMemos.clear();
    for (const id of ids) if (this.store.get(id)?.sheet === this.sheet) this.selected.add(id);
    for (const id of memoIds) if (this.memos.get(id)?.sheet === this.sheet) this.selectedMemos.add(id);
    this.selectAnchor = this.store.get(ids[0])?.pos ?? this.memos.get(memoIds[0])?.pos ?? null;
    this.requestRender();
  }

  clearSelection() {
    if (this.selected.size === 0 && this.selectedMemos.size === 0) return;
    this.selected.clear();
    this.selectedMemos.clear();
    this.selectAnchor = null;
    this.requestRender();
  }

  // 盤面の上の端から空けておく高さ（左上のシートの名前の下）
  get topInset(): number {
    return this.sheetBar.offsetTop + this.sheetBar.offsetHeight + 4;
  }

  // 盤面のまん中に見えているセル（今のタブがこのシートに無いときに、新しいセルを置く場所）
  get centerHex(): Hex {
    const w = this.toWorld({ x: this.size.width / 2, y: this.size.height / 2 });
    return pixelToHex(w.x, w.y, CELL);
  }

  // 貼り付けの場所：マウスが最後にあった、空いたセル（今見ているシートで）
  get lastPointerHex(): Hex | null {
    return this.pointerHex && !this.store.tabAt(this.pointerHex, this.sheet) && !this.memos.at(this.pointerHex, this.sheet) ? this.pointerHex : null;
  }

  private toggleSelect(id: number) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.selectAnchor = this.store.get(id)?.pos ?? null;
    this.requestRender();
  }

  private toggleSelectMemo(id: string) {
    if (this.selectedMemos.has(id)) this.selectedMemos.delete(id);
    else this.selectedMemos.add(id);
    this.selectAnchor = this.memos.get(id)?.pos ?? null;
    this.requestRender();
  }

  // 起点のセルから押したセルまでの四角の中のセルを選ぶ（六角メモの Shift+クリックと同じ）
  private selectRange(to: Hex) {
    const from = this.selectAnchor;
    if (!from) return;
    const a = hexToPixel(from, CELL);
    const b = hexToPixel(to, CELL);
    const x0 = Math.min(a.x, b.x) - CELL * 0.6;
    const x1 = Math.max(a.x, b.x) + CELL * 0.6;
    const y0 = Math.min(a.y, b.y) - CELL * 0.6;
    const y1 = Math.max(a.y, b.y) + CELL * 0.6;
    const inside = (pos: Hex) => {
      const c = hexToPixel(pos, CELL);
      return c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1;
    };
    for (const tab of this.tabsHere()) if (inside(tab.pos)) this.selected.add(tab.id);
    for (const memo of this.memosHere()) if (inside(memo.pos)) this.selectedMemos.add(memo.id);
    this.requestRender();
  }

  setRoute(route: Route | null) {
    if (route === this.route && !route) return;
    this.route = route;
    this.requestRender();
  }

  // セルや行の画面上の四角（ポップアップを出す場所を決めるのに使う）
  anchorOf(id: number): DOMRect | null {
    const container = this.mode === 'small' ? this.svg : this.list;
    return container.querySelector(`[data-id="${id}"]`)?.getBoundingClientRect() ?? null;
  }

  anchorOfMemo(id: string): DOMRect | null {
    return this.svg.querySelector(`[data-memo="${id}"]`)?.getBoundingClientRect() ?? null;
  }

  // セル（空いたセルも）の画面上の四角（メモを書く欄を出す場所）
  anchorOfHex(h: Hex): DOMRect {
    const c = hexToPixel(h, CELL);
    const box = this.svg.getBoundingClientRect();
    const x = box.left + this.pan.x + c.x * this.zoom;
    const y = box.top + this.pan.y + c.y * this.zoom;
    const r = CELL * this.zoom;
    return new DOMRect(x - r, y - r, 2 * r, 2 * r);
  }

  // 描き直しは次の画面更新のときに1回だけ行う（スワイプ中に何十回も描かないように）
  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render() {
    if (this.preview) {
      if (this.preview.sheet() !== null && this.size.width > 0) this.renderBoard();
      this.actions.boardDrawn?.(); // 小窓のセルが動いた：詳しいカードの位置を合わせる
      return;
    }
    const small = this.mode === 'small';
    this.svg.style.display = small ? '' : 'none';
    this.controls.style.display = small ? '' : 'none';
    this.list.style.display = small ? 'none' : '';
    this.renderSheetBar();
    if (small) this.renderBoard();
    else this.renderList();
    this.actions.boardDrawn?.();
  }

  private renderSheetBar() {
    const sheet = this.sheets.currentSheet;
    const back = this.sheets.get(this.backTo());
    this.backButton.hidden = !back;
    if (back) {
      this.backButton.title = `「${back.name}」へ戻る`;
      this.backButton.setAttribute('aria-label', `シート「${back.name}」へ戻る`);
    }
    const swatch = document.createElement('span');
    swatch.className = 'sheet-swatch';
    swatch.style.setProperty('--sheet', sheet.color);
    const name = document.createElement('span');
    name.className = 'sheet-name';
    name.textContent = sheet.name;
    this.sheetButton.replaceChildren(swatch, name, document.createTextNode(' ▾'));
    this.sheetButton.title = `シート「${sheet.name}」（押すと、シートの一覧とタブの見え方）`;
    this.sheetButton.setAttribute('aria-label', this.sheetButton.title);
  }

  private onResize() {
    if (this.preview) {
      this.size = { width: this.root.clientWidth, height: this.root.clientHeight };
      if (this.previewFit !== null && this.size.width > 0) this.showCenter(this.previewFit);
      else this.requestRender();
      return;
    }
    const first = this.size.width === 0;
    this.size = { width: this.root.clientWidth, height: this.root.clientHeight };
    if (!first) {
      this.render();
    } else if (this.pendingView) {
      this.view = this.pendingView;
      this.pendingView = null;
    } else if (this.pendingFit) {
      this.pendingFit = false;
      this.fitSheet();
    } else {
      this.recenter();
    }
  }

  private setHover(id: number | null) {
    if (this.popupHold) return; // ドラッグが終わるまで、吹き出しも詳細も出さない
    if (id === this.hovered) return;
    this.hovered = id;
    this.actions.hover(id);
    this.updateBalloon();
  }

  private setHoverMemo(id: string | null) {
    if (this.popupHold) return;
    if (id === this.hoveredMemo) return;
    this.hoveredMemo = id;
    this.actions.hoverMemo(id);
    this.updateBalloon();
  }

  // ---------- 乗せたときの吹き出し（セルの上で読めないコメント） ----------

  private updateBalloon() {
    if (!this.showBalloons || this.drag || this.popupHold) {
      this.hideBalloon();
      return;
    }
    let title = '';
    let comment = '';
    let anchor: DOMRect | null = null;
    const tab = this.hovered === null ? undefined : this.store.get(this.hovered);
    const memo = this.memos.get(this.hoveredMemo);
    if (tab && tab.comment && (this.mode === 'large' || !commentFullyShown(tab, resolveFace(tab, this.tabLook, this.faces)))) {
      title = tab.title || tab.url;
      comment = tab.comment;
      anchor = this.anchorOf(tab.id);
    } else if (memo?.portal && memo.text) {
      title = `シート「${this.sheets.get(memo.portal)?.name ?? '？'}」`;
      comment = memoTitle(memo, 80);
      anchor = this.anchorOfMemo(memo.id);
    } else if (memo?.app) {
      const app = this.apps.get(memo.app);
      const waiting = !this.apps.ready;
      title = waiting ? 'アプリ' : app ? `アプリ「${app.name}」` : 'アプリ（台帳に見つかりません）';
      const pinned = !!app && this.pinnedAppId() === app.id;
      comment = waiting ? '読み込んでいます' : app ? (pinned ? 'ダブルクリック（最前面をやめる）' : 'ダブルクリック（中央に出す）') : '右クリック →「セルを外す」で片づけられます';
      anchor = this.anchorOfMemo(memo.id);
    } else if (memo?.bot) {
      // ボットのセル：1倍では名前を出さないので、いつも吹き出しで名前を見せる（コメントが無ければ、押すと何が起きるか）
      const bot = this.bots.get(memo.bot);
      title = bot ? `ボット「${bot.name}」` : 'ボット（台帳に見つかりません）';
      const activity = bot ? this.botActivity(bot.id) : undefined;
      const state = botFullState(bot, this.botAppMissing(), activity);
      const counts = activity && (activity.unread || activity.waiting) ? `（${botFullStateLabel(state)}・まだ読んでいない ${activity.unread}・待っている ${activity.waiting}）` : '';
      comment = `${memo.text ? memoTitle(memo, 80) : botFullStateHint(state)}${counts}`;
      anchor = this.anchorOfMemo(memo.id);
    }
    if (!anchor || !comment) {
      this.hideBalloon();
      return;
    }
    const head = document.createElement('b');
    head.textContent = title;
    this.balloon.replaceChildren(head, document.createTextNode(comment));
    this.balloon.hidden = false;
    this.balloon.style.left = '0px'; // 前の場所のままだと、幅が狭く測られる
    this.balloon.style.top = '0px';
    const box = this.root.getBoundingClientRect();
    const width = this.balloon.offsetWidth;
    const x = clamp(anchor.left + anchor.width / 2 - box.left - width / 2, 4, Math.max(4, box.width - width - 4));
    const above = anchor.top - box.top - this.balloon.offsetHeight - 6;
    const y = above >= this.topInset ? above : anchor.bottom - box.top + 6; // 左上のシートの名前に重ねない
    this.balloon.style.left = `${x}px`;
    this.balloon.style.top = `${y}px`;
  }

  private hideBalloon() {
    this.balloon.hidden = true;
  }

  // 盤面のものをドラッグしているあいだ、この盤面の吹き出しを出さない（詳細カードは tabDrag の受け側が隠す）
  holdPopups(on: boolean) {
    if (this.popupHold === on) return;
    this.popupHold = on;
    if (on) {
      this.hideBalloon();
      this.hovered = null;
      this.hoveredMemo = null;
    }
  }

  // ドラッグの始まりと終わりはここだけ。種類（タブ・メモ・入口・行）では分けない
  private beginItemDrag() {
    this.holdPopups(true);
    this.actions.tabDrag?.(true);
  }

  private endItemDrag() {
    this.holdPopups(false);
    this.actions.tabDrag?.(false);
  }

  // 動かし始めたら隠す。盤面をずらすだけ（moved を付けない）では隠さない
  private noteItemDrag(wasMoved: boolean, moved: boolean) {
    if (moved && !wasMoved && popupsHiddenWhileDragging({ moved: true })) this.beginItemDrag();
  }

  private finishItemDrag(drag: object | null) {
    if (popupsHiddenWhileDragging(drag)) this.endItemDrag();
  }

  // タブを落とした：入口ならそのシートへ。タブなら入れ替え（TabStore）、メモのセルなら場所を入れ替える
  private dropTab(id: number, pos: Hex) {
    const tab = this.store.get(id);
    const memo = this.memos.at(pos, this.sheet);
    if (tab && memo?.portal) {
      this.actions.dropOnPortal({ tab: id }, memo.id);
      return;
    }
    if (tab && memo) this.memos.move(memo.id, tab.pos);
    this.store.moveTo(id, pos);
  }

  // メモのセルを落とした：入口ならそのシートへ（入口どうしは、場所の入れ替え）。タブ・メモのセルがあれば場所を入れ替える
  private dropMemo(memo: MemoCell, pos: Hex) {
    const from = memo.pos;
    const tab = this.store.tabAt(pos, this.sheet);
    const other = this.memos.at(pos, this.sheet);
    if (other?.portal && other.id !== memo.id && !memo.portal) {
      this.actions.dropOnPortal({ memo: memo.id }, other.id);
      return;
    }
    if (other && other.id !== memo.id) this.memos.move(other.id, from);
    this.memos.move(memo.id, pos);
    if (tab) this.store.moveTo(tab.id, from);
  }

  // ---------- 小さい表示（ハニカム盤面） ----------

  private renderBoard() {
    const { width, height } = this.size;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const world = svgEl('g', { transform: `translate(${this.pan.x} ${this.pan.y}) scale(${this.zoom})` });
    world.append(this.gridPath());
    const tabs = this.tabsHere();
    const memos = this.memosHere();

    // 島（色の面と、まわりの枠と、名前）。メモのセルも島に入れる（このシートのセルだけ）
    const members = new Map<string, Hex[]>();
    for (const cell of [...tabs, ...memos]) {
      if (cell.island) members.set(cell.island, [...(members.get(cell.island) ?? []), cell.pos]);
    }
    for (const island of this.islands) {
      const cells = members.get(island.id);
      if (cells) world.append(regionShape(cells, island.color, this.showIslandNames ? island.name : '', false, { id: island.id, zoom: this.zoom }));
    }

    const drag = this.drag?.kind === 'cell' && this.drag.moved ? this.drag : null;
    const memoDrag = this.drag?.kind === 'memo' && this.drag.moved ? this.drag : null;
    for (const memo of memos) {
      if (memoDrag?.id !== memo.id) world.append(this.memoCell(memo, hexToPixel(memo.pos, CELL)));
    }
    for (const tab of tabs) {
      if (drag?.id !== tab.id) world.append(this.cell(tab, hexToPixel(tab.pos, CELL)));
    }
    const dragged = drag && this.store.get(drag.id);
    const draggedMemo = memoDrag && this.memos.get(memoDrag.id);
    const moving = drag ?? memoDrag;
    if (moving && (dragged || draggedMemo)) {
      const hex = pixelToHex(moving.at.x, moving.at.y, CELL);
      const target = hexToPixel(hex, CELL);
      const over = this.memos.at(hex, this.sheet);
      const intoPortal = !!over?.portal && over.id !== draggedMemo?.id && !draggedMemo?.portal; // 入口どうしは入れ替え（dropMemo と同じ決まり）
      world.append(svgEl('polygon', { class: intoPortal ? 'drop-target into-portal' : 'drop-target', points: hexCorners(target.x, target.y, CELL - 2) }));
      if (dragged) world.append(this.cell(dragged, moving.at));
      if (draggedMemo) world.append(this.memoCell(draggedMemo, moving.at));
    }
    const route = this.routeOverlay(tabs);
    if (route) world.append(route);
    const links = this.boardLinkLayer();
    if (links) world.append(links);
    // 島の案：寄せた後の形を点線で、入るタブには色の輪を付ける（このシートのタブだけ）
    for (const { draft, cells } of this.drafts) {
      const here = draft.tabIds.map((id) => this.store.get(id)).filter((t): t is Tab => t?.sheet === this.sheet);
      if (here.length === 0) continue;
      world.append(regionShape(cells, draft.color, `${draft.name}（案）`, true, { zoom: this.zoom }));
      for (const tab of here) {
        const c = hexToPixel(tab.pos, CELL);
        world.append(svgEl('polygon', { class: 'draft-ring', points: hexCorners(c.x, c.y, CELL - 1), stroke: draft.color }));
      }
    }
    const preview = this.patchPreviewLayer();
    if (preview) world.append(preview);
    this.svg.replaceChildren(world);
  }

  // Grok の提案の見本：島は点線の形と名前（「（Grok の案）」）、線は点線。このシートにあるセルだけ
  private patchPreviewLayer(): SVGElement | null {
    const { islands, links } = this.patchPreview;
    const cells = this.patchPreview.cells ?? [];
    if (islands.length === 0 && links.length === 0 && cells.length === 0) return null;
    const g = svgEl('g', { class: 'patch-preview' });
    for (const cell of cells) {
      const c = hexToPixel(cell.pos, CELL);
      g.append(svgEl('polygon', { class: 'draft-ring patch-preview-line', points: hexCorners(c.x, c.y, CELL - 1), stroke: cell.color }));
      g.append(svgText({ x: c.x, y: c.y }, cell.label, 'patch-preview-cell-label'));
    }
    for (const island of islands) {
      const cells = island.refs.map((r) => this.refHere(r)).filter((h): h is Hex => !!h);
      if (cells.length === 0) continue;
      g.append(regionShape(cells, island.color, `${island.name}（Grok の案）`, true, { zoom: this.zoom }));
      for (const h of cells) {
        const c = hexToPixel(h, CELL);
        g.append(svgEl('polygon', { class: 'draft-ring', points: hexCorners(c.x, c.y, CELL - 1), stroke: island.color }));
      }
    }
    for (const link of links) {
      const a = this.refHere(link.from);
      const b = this.refHere(link.to);
      const points = a && b ? gapLine(a, b) : null;
      if (!points) continue;
      const info = linkKindInfo(link.kind);
      const line = svgEl('g', { class: 'board-link patch-preview-link', style: `--link: ${info.color}` });
      line.append(svgEl('polyline', { class: 'board-link-line patch-preview-line', points }));
      const head = linkHead(points, info.head);
      if (head) line.append(head);
      g.append(line);
    }
    return g;
  }

  // 順路：順路にいるタブどうしを、セルの隙間を通る順路の色の線でつなぎ（枝は点線）、左上の角に段の番号を付ける
  //   （六角メモの Dendritic Extensions と同じ見た目）。このシートで順路にいるタブが2つ以上のときだけ
  private routeOverlay(tabs: Tab[]): SVGElement | null {
    const route = this.route;
    if (!route) return null;
    const { links, numbers } = routeLinks(route, tabs);
    if (numbers.size < 2) return null;
    const g = svgEl('g', { class: 'route-layer', style: `--route: ${route.color}` });
    for (const link of links) {
      const points = gapLine(link.from.pos, link.to.pos);
      if (points) g.append(svgEl('polyline', { class: link.branch ? 'route-line branch' : 'route-line', points }));
    }
    for (const [id, n] of numbers) {
      const tab = this.store.get(id);
      if (!tab) continue;
      const c = hexToPixel(tab.pos, CELL);
      const corner = hexCornerPoints(c.x, c.y, CELL - 2.5)[5]; // 左上の角
      const b = { x: corner.x + (c.x - corner.x) * 0.25, y: corner.y + (c.y - corner.y) * 0.25 };
      const badge = svgEl('g', { class: 'route-badge' });
      badge.append(svgEl('circle', { cx: b.x, cy: b.y, r: 6.5 }), svgText(b, String(n), 'route-badge-text'));
      g.append(badge);
    }
    return g;
  }

  // 画面に見えている範囲だけ、背景のハニカム格子を描く
  private gridPath() {
    const x0 = -this.pan.x / this.zoom;
    const y0 = -this.pan.y / this.zoom;
    const x1 = (this.size.width - this.pan.x) / this.zoom;
    const y1 = (this.size.height - this.pan.y) / this.zoom;
    const colWidth = Math.sqrt(3) * CELL;
    let d = '';
    for (let r = Math.floor(y0 / (1.5 * CELL)) - 1; r <= Math.ceil(y1 / (1.5 * CELL)) + 1; r++) {
      for (let q = Math.floor(x0 / colWidth - r / 2) - 1; q <= Math.ceil(x1 / colWidth - r / 2) + 1; q++) {
        const c = hexToPixel({ q, r }, CELL);
        d += 'M' + hexCorners(c.x, c.y, CELL - 1.5).split(' ').join('L') + 'Z';
      }
    }
    return svgEl('path', { class: 'grid', d });
  }

  // 裏で開いて足したセルを、しばらく光らせる（どこに足したか分かるように）
  flash(id: number, ms = 2600) {
    const start = performance.now();
    this.flashing.set(id, { start, end: start + ms });
    this.requestRender();
    window.setTimeout(() => {
      if ((this.flashing.get(id)?.end ?? 0) <= performance.now()) this.flashing.delete(id);
      this.requestRender();
    }, ms + 50);
  }

  // メモのセル（ボットのセルなど）を、文字の id でしばらく光らせる（返事が届いた・返事をメモにした）
  flashMemo(id: string, ms = 2600) {
    const start = performance.now();
    this.flashingMemos.set(id, { start, end: start + ms });
    this.requestRender();
    window.setTimeout(() => {
      if ((this.flashingMemos.get(id)?.end ?? 0) <= performance.now()) this.flashingMemos.delete(id);
      this.requestRender();
    }, ms + 50);
  }

  // 光らせているメモのセルなら、g に付ける class と style
  private memoFlash(id: string): { flashing: boolean; style?: string } {
    const f = this.flashingMemos.get(id);
    if (!f || f.end <= performance.now()) return { flashing: false };
    return { flashing: true, style: `animation-delay:-${Math.round(performance.now() - f.start)}ms` };
  }

  private isFlashing(id: number) {
    return (this.flashing.get(id)?.end ?? 0) > performance.now();
  }

  // 描き直しても、光り方を最初からやり直さない（光り始めてからの時間だけ、アニメーションを進めておく）
  private flashPhase(id: number) {
    return `animation-delay:-${Math.round(performance.now() - (this.flashing.get(id)?.start ?? performance.now()))}ms`;
  }

  private cell(tab: Tab, c: Point) {
    const shown = resolveFace(tab, this.tabLook, this.faces);
    const classes = ['cell'];
    const flashing = this.isFlashing(tab.id);
    if (flashing) classes.push('just-added');
    if (tab.id === this.store.activeId) classes.push('active');
    if (tab.loading) classes.push('loading');
    if (tab.asleep) classes.push('asleep');
    else if (tab.suspended) classes.push('suspended');
    if (shown.mode === 'image') classes.push('has-image');
    if (this.dimmed(tab.tags, tab.liked)) classes.push('dim');
    if (this.selected.has(tab.id)) classes.push('selected');
    const g = svgEl('g', { class: classes.join(' '), 'data-id': tab.id, ...(flashing ? { style: this.flashPhase(tab.id) } : {}) });
    g.append(svgEl('polygon', { class: 'hex', points: hexCorners(c.x, c.y, FACE) }));
    drawTabFace(g, tab, c, FACE, shown, `tab-clip-${tab.id}`, this.faces);
    // 読み進み具合：上の頂点から時計回りに、読んだ分だけ辺を灯す（6本で読み終えた）
    if (tab.readEdges > 0) {
      const corners = hexCorners(c.x, c.y, FACE).split(' ');
      const points = [...corners, corners[0]].slice(0, tab.readEdges + 1).join(' ');
      g.append(svgEl('polyline', { class: tab.readEdges >= 6 ? 'read-edges done' : 'read-edges', points }));
    }
    if (this.selected.has(tab.id)) g.append(svgEl('polygon', { class: 'select-ring', points: hexCorners(c.x, c.y, CELL - 0.5) }));
    if (tab.liked > 0) g.append(svgText({ x: c.x, y: c.y + CELL * 0.62 }, '♥'.repeat(tab.liked), 'like-mark'));
    // 右下の ♪ = 音が出ている（ミュート中は薄く）、左下の点 = 休眠させないタブ
    if (tab.audible) {
      g.append(svgText({ x: c.x + CELL * 0.55, y: c.y + CELL * 0.5 }, '♪', tab.muted ? 'audio-mark muted' : 'audio-mark'));
    }
    if (tab.keepAwake) {
      g.append(svgEl('circle', { class: 'keep-mark', cx: c.x - CELL * 0.55, cy: c.y + CELL * 0.5, r: 3 }));
    }
    // 左上の ✎ = メモがあるタブ
    if (tab.notes.length > 0) g.append(svgText({ x: c.x - CELL * 0.6, y: c.y - CELL * 0.52 }, '✎', 'note-mark'));
    if (this.showNumbers) {
      const b = { x: c.x + CELL * 0.62, y: c.y - CELL * 0.55 };
      g.append(svgEl('circle', { class: 'badge', cx: b.x, cy: b.y, r: 7 }));
      g.append(svgText(b, String(tab.order), 'badge-text'));
    }
    return g;
  }

  // メモのセル：紙の色の六角形に、最初の数文字（画像があれば六角形の画像）。シートへの入口は扉の形、ボットのセルはボットの顔、アプリのセルはアイコン
  private memoCell(memo: MemoCell, c: Point) {
    if (memo.portal) return this.portalCell(memo, c);
    if (memo.bot) return this.botCell(memo, c);
    if (memo.app) return this.appCell(memo, c);
    if (memo.capture) return this.captureCell(memo, c);
    const classes = ['cell', 'memo'];
    if (memo.id === this.paneMemo) classes.push('pane-open');
    if (this.dimmed(memo.tags, memo.liked)) classes.push('dim');
    if (this.selectedMemos.has(memo.id)) classes.push('selected');
    const flash = this.memoFlash(memo.id);
    if (flash.flashing) classes.push('just-added');
    const g = svgEl('g', { class: classes.join(' '), 'data-memo': memo.id, ...(flash.style ? { style: flash.style } : {}) });
    const points = hexCorners(c.x, c.y, FACE);
    g.append(svgEl('polygon', { class: 'hex memo-hex', points }));
    const image = this.memos.image(memo.image);
    if (image) {
      const clipId = `memo-clip-${memo.id}`;
      const clip = svgEl('clipPath', { id: clipId });
      clip.append(svgEl('polygon', { points }));
      g.append(clip, svgEl('image', { href: image, x: c.x - FACE, y: c.y - FACE, width: 2 * FACE, height: 2 * FACE, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${clipId})` }));
    } else {
      const lines = cellLines(memoTitle(memo, 6).replace(/…$/, ''));
      const shown = lines[0] ? lines : ['✎'];
      shown.forEach((line, i) => g.append(svgText({ x: c.x, y: c.y + (shown.length === 1 ? 0 : (i - 0.5) * 9.5) }, line, 'memo-text')));
    }
    if (memo.liked > 0) g.append(svgText({ x: c.x, y: c.y + CELL * 0.66 }, '♥'.repeat(memo.liked), 'like-mark'));
    if (this.selectedMemos.has(memo.id)) g.append(svgEl('polygon', { class: 'select-ring', points: hexCorners(c.x, c.y, CELL - 0.5) }));
    const title = svgEl('title', {});
    title.textContent = memoTitle(memo, 80) || 'メモ（空）';
    g.append(title);
    return g;
  }

  // 撮ったもの：六角形に切り抜いた縮図と、右上のスタンプの数（0 も出す）。ここから新しく撮るボタンは無い
  private captureCell(memo: MemoCell, c: Point) {
    const id = memo.capture ?? '';
    const marks = this.captureMarks(id);
    const classes = ['cell', 'capture'];
    if (this.selectedMemos.has(memo.id)) classes.push('selected');
    const g = svgEl('g', { class: classes.join(' '), 'data-memo': memo.id });
    const points = hexCorners(c.x, c.y, FACE);
    g.append(svgEl('polygon', { class: 'hex capture-hex', points }));
    const image = this.captureImage(id);
    if (image) {
      const clipId = `capture-clip-${memo.id}`;
      const clip = svgEl('clipPath', { id: clipId });
      clip.append(svgEl('polygon', { points }));
      g.append(clip, svgEl('image', { href: image, x: c.x - FACE, y: c.y - FACE, width: 2 * FACE, height: 2 * FACE, preserveAspectRatio: 'xMidYMid slice', 'clip-path': `url(#${clipId})` }));
    }
    const wide = marks >= 10;
    const b = { x: c.x + CELL * 0.58, y: c.y - CELL * 0.52 };
    g.append(svgEl('circle', { class: 'badge', cx: b.x, cy: b.y, r: wide ? 8 : 7 }));
    g.append(svgText(b, String(marks), wide ? 'badge-text capture-badge-text' : 'badge-text'));
    if (this.selectedMemos.has(memo.id)) g.append(svgEl('polygon', { class: 'select-ring', points: hexCorners(c.x, c.y, CELL - 0.5) }));
    const title = svgEl('title', {});
    title.textContent = `撮ったもの（スタンプ ${marks}）`;
    g.append(title);
    return g;
  }

  // シートへの入口（案A「扉」：シートの色の六角形に、白い内枠と名前。右上はシートの中のセルの数）
  private portalCell(memo: MemoCell, c: Point) {
    const target = this.sheets.get(memo.portal);
    const info: PortalInfo | null = target
      ? { name: target.name, color: target.color, count: this.store.inSheet(target.id).length + this.memos.inSheet(target.id).length }
      : null;
    const classes = ['cell', 'portal'];
    if (!target) classes.push('lost');
    if (this.dimmed(memo.tags, memo.liked)) classes.push('dim');
    if (this.selectedMemos.has(memo.id)) classes.push('selected');
    const g = svgEl('g', { class: classes.join(' '), 'data-memo': memo.id });
    drawPortalFace(g, c, FACE, info, this.memos.image(memo.image), memo.text, `portal-clip-${memo.id}`);
    if (memo.liked > 0) g.append(svgText({ x: c.x, y: c.y + CELL * 0.66 }, '♥'.repeat(memo.liked), 'like-mark'));
    if (this.selectedMemos.has(memo.id)) g.append(svgEl('polygon', { class: 'select-ring', points: hexCorners(c.x, c.y, CELL - 0.5) }));
    // 名前の全部（ひとことがあれば、乗せたときの吹き出しに名前も出るので要らない）
    if (!memo.text || !this.showBalloons) {
      const title = svgEl('title', {});
      title.textContent = target ? `シート「${target.name}」へ（${info?.count ?? 0} セル）` : '行き先のシートが見つかりません';
      g.append(title);
    }
    return g;
  }

  // ボットのセル（石板の色の六角形にボットの顔。左上に外へ出る矢印、左下にリンクなし「?」・アプリなし「×」）
  //   1倍では名前を出さない（名前は乗せたときの吹き出しで。吹き出しを出さない設定なら、title で）
  private botCell(memo: MemoCell, c: Point) {
    const bot = this.bots.get(memo.bot);
    const activity = bot ? this.botActivity(bot.id) : undefined;
    const state = botFullState(bot, this.botAppMissing(), activity);
    const classes = ['cell', 'bot'];
    if (!bot) classes.push('lost');
    if (this.dimmed(memo.tags, memo.liked)) classes.push('dim');
    if (this.selectedMemos.has(memo.id)) classes.push('selected');
    const flash = this.memoFlash(memo.id);
    if (flash.flashing) classes.push('just-added');
    const g = svgEl('g', { class: classes.join(' '), 'data-memo': memo.id, ...(flash.style ? { style: flash.style } : {}) });
    drawBotFace(g, c, FACE, { state, unread: activity?.unread, waiting: activity?.waiting }, this.memos.image(memo.image), memo.text, `bot-clip-${memo.id}`);
    if (this.selectedMemos.has(memo.id)) g.append(svgEl('polygon', { class: 'select-ring', points: hexCorners(c.x, c.y, CELL - 0.5) }));
    if (!this.showBalloons) {
      const title = svgEl('title', {});
      title.textContent = `${bot ? `ボット「${bot.name}」` : 'ボット（台帳に見つかりません）'}\n${memo.text ? `${memoTitle(memo, 80)}\n` : ''}${botFullStateHint(state)}`;
      g.append(title);
    }
    return g;
  }

  // アプリのセル（青緑の六角形に、登録したアプリのアイコン。名前は吹き出しで）
  private appCell(memo: MemoCell, c: Point) {
    const app = this.apps.get(memo.app);
    const lost = this.apps.ready && !app;
    const classes = ['cell', 'app'];
    if (lost) classes.push('lost');
    if (this.dimmed(memo.tags, memo.liked)) classes.push('dim');
    if (this.selectedMemos.has(memo.id)) classes.push('selected');
    const flash = this.memoFlash(memo.id);
    if (flash.flashing) classes.push('just-added');
    const g = svgEl('g', { class: classes.join(' '), 'data-memo': memo.id, ...(flash.style ? { style: flash.style } : {}) });
    drawAppFace(g, c, FACE, { name: app?.name ?? '', icon: app?.icon, lost }, `app-clip-${memo.id}`);
    if (this.selectedMemos.has(memo.id)) g.append(svgEl('polygon', { class: 'select-ring', points: hexCorners(c.x, c.y, CELL - 0.5) }));
    if (!this.showBalloons) {
      const title = svgEl('title', {});
      title.textContent = lost ? 'アプリ（台帳に見つかりません）' : `アプリ「${app?.name ?? ''}」`;
      g.append(title);
    }
    return g;
  }

  // 試し：ポップアップの置き場所のとき、メモ・アプリ・撮ったもののセルを1回押す → ポップアップを固定（同じセルをもう一度で外す）
  //   2回目が短い間なら（ダブルクリック）固定はそのまま。ダブルクリックの動き（下の区画で開く など）は dblclick がする
  private pinMemoClick(id: string) {
    if (!this.actions.clickPins?.() || !this.actions.pinMemo) return;
    const now = performance.now();
    const last = this.lastMemoClick;
    if (last && last.id === id && now - last.at <= DOUBLE_CLICK_MS) {
      this.lastMemoClick = null;
      return;
    }
    this.lastMemoClick = { id, at: now };
    this.actions.pinMemo(id);
  }

  private bindBoardEvents() {
    const svg = this.svg;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.linking) {
        e.preventDefault();
        e.stopPropagation();
        this.cancelBoardLink();
      }
    }, true);
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const id = idAt(e.target);
      const memo = memoAt(e.target);
      const p = this.local(e);
      this.hideBalloon();
      if (this.linking) {
        // 関連づける途中：押したセルが相手。空いた所ならやめる（盤面は動かさない）
        e.preventDefault();
        const tab = id !== null ? this.store.get(id) : undefined;
        const to = tab ? tabRef(tab.uid) : memo !== null ? memoRef(memo) : null;
        const { from, kind } = this.linking;
        this.cancelBoardLink();
        this.quietUntil = performance.now() + 500; // 続く click・dblclick でタブへ移ったり、新しいタブを作ったりしない
        if (to) this.actions.finishBoardLink?.(from, to, kind);
        return;
      }
      this.pressedLink = boardLinkAt(e.target);
      if (id !== null || memo !== null) this.lastTabPress = performance.now(); // 試し：タブを押した時刻（続く dblclick で新しいタブを作らない）
      this.drag =
        id !== null
          ? { kind: 'cell', id, start: p, moved: false, at: this.toWorld(p) }
          : memo !== null
            ? { kind: 'memo', id: memo, start: p, moved: false, at: this.toWorld(p) }
            : { kind: 'pan', start: p, pan: { ...this.pan } };
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        // 指やペンがもう離れていた
      }
    });
    svg.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) {
        this.setHover(idAt(e.target));
        this.setHoverMemo(memoAt(e.target));
        const w = this.toWorld(this.local(e));
        this.pointerHex = pixelToHex(w.x, w.y, CELL);
        if (this.linking) {
          this.pointerWorld = w;
          this.requestRender();
        }
        return;
      }
      if (d.kind === 'row') return;
      const p = this.local(e);
      if (d.kind === 'pan') {
        this.pan = { x: d.pan.x + p.x - d.start.x, y: d.pan.y + p.y - d.start.y };
        this.requestRender();
        return;
      }
      const moved = Math.hypot(p.x - d.start.x, p.y - d.start.y) > DRAG_THRESHOLD;
      this.noteItemDrag(d.moved, moved); // セルを動かし始めたら、詳細と吹き出しを隠す
      if (moved) d.moved = true;
      d.at = this.toWorld(p);
      if (d.moved) this.requestRender();
    });
    svg.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      const pressedLink = this.pressedLink;
      this.pressedLink = null;
      try {
        if (d?.kind === 'pan') {
          this.actions.viewChanged();
          const still = Math.hypot(this.local(e).x - d.start.x, this.local(e).y - d.start.y) <= DRAG_THRESHOLD;
          if (still && pressedLink && this.actions.boardLinkMenu) {
            this.actions.boardLinkMenu(pressedLink, e.clientX, e.clientY); // 線を押した：線のメニュー（選んでいるものは外さない）
            return;
          }
          if (!e.ctrlKey && !e.shiftKey && still) {
            this.clearSelection(); // 空いた所をクリック
            this.actions.unpinTab?.(); // 試し：固定したポップアップも外す
          }
        }
        if (d?.kind === 'memo') {
          const memo = this.memos.get(d.id);
          if (!memo) return;
          if (d.moved) this.dropMemo(memo, pixelToHex(d.at.x, d.at.y, CELL));
          else if (e.ctrlKey || e.metaKey) this.toggleSelectMemo(d.id);
          else if (e.shiftKey) this.selectRange(memo.pos);
          else this.openStillMemo(d.id);
          return;
        }
        if (d?.kind === 'cell') {
          if (d.moved) this.dropTab(d.id, pixelToHex(d.at.x, d.at.y, CELL));
          else if (e.ctrlKey || e.metaKey) this.toggleSelect(d.id);
          else if (e.shiftKey) {
            const tab = this.store.get(d.id);
            if (tab && this.selectAnchor) this.selectRange(tab.pos);
            else this.toggleSelect(d.id);
          } else this.openStillTab(d.id);
        }
      } finally {
        this.finishItemDrag(d); // 落とし終わってから、固定していた詳細を新しい位置に戻す
      }
    });
    // 右クリック：メニュー（選んでいないセルなら、そのセルだけを選ぶ）
    svg.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.hideBalloon();
      if (this.cancelBoardLink()) return; // 関連づける途中：右クリックでやめる
      const linkId = boardLinkAt(e.target);
      if (linkId !== null && this.actions.boardLinkMenu) {
        this.actions.boardLinkMenu(linkId, e.clientX, e.clientY);
        return;
      }
      const label = islandLabelAt(e.target);
      if (label !== null && this.actions.islandMenu) {
        this.actions.islandMenu(label, e.clientX, e.clientY);
        return;
      }
      // 選んだセルの線を目立たせているとき、セルの無い所を右クリック → 選ぶのをやめる（メニューは出さない）
      if (idAt(e.target) === null && memoAt(e.target) === null && this.emphasizingLinks) {
        const w0 = this.toWorld(this.local(e));
        const h0 = pixelToHex(w0.x, w0.y, CELL);
        if (!this.store.tabAt(h0, this.sheet) && !this.memos.at(h0, this.sheet)) {
          this.clearSelection();
          return;
        }
      }
      const id = idAt(e.target);
      const memo = memoAt(e.target);
      const w = this.toWorld(this.local(e));
      if (id !== null && !this.selected.has(id)) this.setSelection([id]);
      if (memo !== null && !this.selectedMemos.has(memo)) this.setSelection([], [memo]);
      this.actions.contextMenu({ id, memo, hex: pixelToHex(w.x, w.y, CELL), x: e.clientX, y: e.clientY });
    });
    svg.addEventListener('pointercancel', () => {
      const d = this.drag;
      this.drag = null;
      this.finishItemDrag(d);
      this.requestRender();
    });
    svg.addEventListener('pointerleave', () => {
      if (!this.drag) {
        this.setHover(null);
        this.setHoverMemo(null);
      }
    });
    // 空いているセルをダブルクリック → そこに新しいタブ。ふつうのメモなら下の区画で開く（入口は押したときにもう移っている。ボットのセルは開かない）
    //   アプリのセルは、ダブルクリックで中央に出す。もう一度で最前面をやめる
    //   撮ったものは、右の「撮影」でその件を開く（新しくは撮らない）
    svg.addEventListener('dblclick', (e) => this.openDoubleClick(e, true));
    // トラックパッド：2本指スワイプ → 盤面を移動、ピンチ → 拡大縮小
    // マウス：ホイール → 上下に移動、Shift+ホイール → 左右に移動、Ctrl+ホイール → 拡大縮小
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.hideBalloon();
        const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.size.height : 1;
        if (e.ctrlKey) {
          // ピンチは Ctrl 付きのホイールとして届く
          this.zoomBy(clamp(Math.exp(-e.deltaY * unit * 0.01), 0.8, 1.25), this.local(e));
          return;
        }
        let dx = e.deltaX * unit;
        let dy = e.deltaY * unit;
        if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
        this.pan = { x: this.pan.x - dx, y: this.pan.y - dy };
        this.requestRender();
        this.actions.viewChanged();
      },
      { passive: false },
    );
    bindMiddleClickClose(svg, (id) => this.actions.close(id));
  }

  // 動かさずに離したメモのセル（Ctrl・Shift は呼び側）。小窓も同じ処理を使う
  //   入口：小窓が無い・同じ入口の2回目はそのシートへ。1回目は小窓でのぞく（選んだものは残す）
  private openStillMemo(id: string) {
    const memo = this.memos.get(id);
    if (!memo) return;
    if (!memo.portal || !this.actions.peekPortal) this.clearSelection(); // 入口を押して小窓でのぞくだけなら、選んだものはそのまま
    if (performance.now() < this.quietUntil) return;
    if (memo.portal) {
      const now = performance.now();
      if (!this.actions.peekPortal || this.portalClicks.press(id, now) !== null) {
        this.clearSelection();
        this.quietUntil = now + 600;
        this.actions.openPortal(id);
      } else {
        this.actions.peekPortal(id); // 1回目：すぐ小窓でのぞく（待たない）
      }
    } else if (memo.bot) {
      this.quietUntil = performance.now() + 600; // 続けて押しても（ダブルクリックでも）、アプリを開くのは1回だけ
      this.actions.openBot(id);
    } else if (memo.app) {
      this.setSelection([], [id]);
      this.actions.focusApp(id);
      this.pinMemoClick(id);
    } else if (memo.capture) {
      this.setSelection([], [id]); // 選ぶだけ。メモの区画も、新しく撮ることもない
      this.pinMemoClick(id);
    } else {
      this.actions.openMemo(id);
      this.pinMemoClick(id);
    }
  }

  // 動かさずに離したタブ。拡大表示がポップアップのとき（小窓も）は1回目で詳しいカード、短い間の2回目でそのタブへ
  private openStillTab(id: number) {
    this.clearSelection();
    if (performance.now() < this.quietUntil) return;
    if (this.actions.clickPins?.() && this.actions.pinTab) {
      // 1回目はすぐカード（待たない）。同じタブを短い間にもう一度押したら、そのタブを開く（カードは残す）
      //   dblclick を待たずに自分で数えるので、指のダブルタップでも同じに動く
      const step = nextTabPress(this.lastTabClick, id, performance.now(), DOUBLE_CLICK_MS);
      this.lastTabClick = step.last;
      if (step.open) this.actions.activate(id);
      else this.actions.pinTab(id);
    } else {
      this.actions.activate(id);
    }
  }

  // ダブルクリック。allowCreate：空いたセルに新しいタブ、島の名前をその場で直す（小窓ではどちらもしない）
  private openDoubleClick(e: MouseEvent, allowCreate: boolean) {
    if (performance.now() < this.quietUntil) return;
    const label = islandLabelAt(e.target);
    if (label !== null) {
      if (allowCreate) this.actions.renameIsland?.(label, e.clientX, e.clientY); // 島の名前：その場で名前を直す（新しいタブは作らない）
      return;
    }
    const memo = memoAt(e.target);
    if (memo !== null) {
      const cell = this.memos.get(memo);
      if (cell?.app) {
        this.actions.launchApp(memo);
        return;
      }
      if (cell?.capture) {
        this.actions.openCapture(cell.capture);
        return;
      }
      if (cell && !isSpecialCell(cell)) this.actions.openMemoPane(memo);
      return;
    }
    if (!allowCreate || idAt(e.target) !== null) return;
    // 試し：タブを2回押した直後の dblclick は、新しいタブを作らない（タブへ移ると盤面が描き直され、
    //   dblclick の的がタブの要素でなくなって idAt が null になり、空いたセル扱いでホームのページが開いていた）
    const last = this.lastTabPress;
    if (last && performance.now() - last <= DOUBLE_CLICK_MS + 200) return;
    const w = this.toWorld(this.local(e));
    const hex = pixelToHex(w.x, w.y, CELL);
    if (this.store.tabAt(hex, this.sheet) || this.memos.at(hex, this.sheet)) return; // 押した所にタブ・メモのセルがある
    this.actions.createAt(hex);
  }

  // 試し：小窓の中の盤面。押したまま動かす → 盤面を移動（セルの上からでも。4px 以上動いたらクリックではない）
  //   動かさずに離した：入口は小窓のシートが進む（2回押しで行き先へ）。タブは詳しいカード（短い間の2回目で開く。盤面のシートは移さない）
  //   右クリックは盤面と同じメニュー。空いた所は、今見ているシートにタブを作らない。タブの詳細だけしまう
  //   セルをドラッグしてタブを動かすことは無い（4px 以上動いたら、小窓の中の盤面をずらす。詳細カードはセルについて来る）
  private bindPreviewEvents(preview: SidebarPreview) {
    const svg = this.svg;
    let press: { start: Point; pan: Point; id: number | null; memo: string | null; moved: boolean } | null = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.hideBalloon();
      press = { start: this.local(e), pan: { ...this.pan }, id: idAt(e.target), memo: memoAt(e.target), moved: false };
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        // もう離れていた
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!press) {
        this.setHover(idAt(e.target));
        this.setHoverMemo(memoAt(e.target));
        return;
      }
      const p = this.local(e);
      if (Math.hypot(p.x - press.start.x, p.y - press.start.y) > DRAG_THRESHOLD) press.moved = true;
      if (!press.moved) return;
      this.pan = { x: press.pan.x + p.x - press.start.x, y: press.pan.y + p.y - press.start.y };
      this.requestRender();
    });
    svg.addEventListener('pointerup', (e) => {
      const d = press;
      press = null;
      if (!d || e.button !== 0) return;
      e.stopPropagation();
      if (d.moved) {
        this.previewClicks.reset(); // ドラッグなので、セルは開かない
        return;
      }
      if (preview.sheet() === null) return;
      const tab = d.id !== null ? this.store.get(d.id) : undefined;
      const memo = d.memo !== null ? this.memos.get(d.memo) : undefined;
      const key = tab ? `t:${tab.id}` : memo ? `m:${memo.id}` : null;
      // 入口の1回目は sticky（小窓の中身が変わるので、2回目の的が違っても行き先へ移る）
      const doubled = this.previewClicks.press(key, performance.now(), !!memo?.portal);
      if (doubled !== null && doubled.startsWith('m:') && this.memos.get(doubled.slice(2))?.portal) {
        preview.enterPortal(doubled.slice(2));
        return;
      }
      if (memo?.portal) {
        preview.clickPortal(memo.id); // 盤面のように小窓を開き直さず、この窓の中のシートを進める（← で戻れる）
        return;
      }
      // 空いた所は、盤面の選択は消さない（小窓の中の誤タップで盤面の選択が消えないように）
      //   タブ以外を押した・空いた所は、小窓から出したタブの詳細だけしまう
      if (tab) this.openStillTab(tab.id);
      else {
        this.actions.dismissPeekDetail?.();
        if (memo) this.openStillMemo(memo.id);
      }
    });
    svg.addEventListener('pointercancel', () => {
      press = null;
    });
    svg.addEventListener('pointerleave', () => {
      if (press) return;
      this.setHover(null);
      this.setHoverMemo(null);
    });
    svg.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hideBalloon();
      const id = idAt(e.target);
      const memo = memoAt(e.target);
      if (id === null && memo === null) {
        // 空いた所：今のシート向けのメニューは出さない。小窓用の peekEmptyMenu があるときだけ、入口先のシート向けの小さなメニュー
        const at = this.toWorld(this.local(e));
        this.actions.peekEmptyMenu?.(pixelToHex(at.x, at.y, CELL), e.clientX, e.clientY);
        return;
      }
      const w = this.toWorld(this.local(e));
      this.actions.prepareContextSelection?.(id, memo);
      this.actions.contextMenu({ id, memo, hex: pixelToHex(w.x, w.y, CELL), x: e.clientX, y: e.clientY });
    });
    svg.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openDoubleClick(e, false); // メモの下の区画・アプリの起動・撮ったものの撮影。空いた所にタブは作らない
    });
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.hideBalloon();
        const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.size.height : 1;
        if (e.ctrlKey) {
          this.zoomBy(clamp(Math.exp(-e.deltaY * unit * 0.01), 0.8, 1.25), this.local(e));
          return;
        }
        let dx = e.deltaX * unit;
        let dy = e.deltaY * unit;
        if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
        this.pan = { x: this.pan.x - dx, y: this.pan.y - dy };
        this.requestRender();
      },
      { passive: false },
    );
  }

  private local(e: MouseEvent): Point {
    const rect = this.svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private toWorld(p: Point): Point {
    return { x: (p.x - this.pan.x) / this.zoom, y: (p.y - this.pan.y) / this.zoom };
  }

  // ---------- 大きい表示（番号順のリスト） ----------

  private renderList() {
    this.list.className = `tab-list shape-${this.shape}`;
    const drag = this.drag?.kind === 'row' && this.drag.moved ? this.drag : null;
    const rows: HTMLElement[] = this.store.inSheet(this.sheet).map((tab) => {
      const li = document.createElement('li');
      li.className = 'row';
      if (this.isFlashing(tab.id)) li.classList.add('just-added');
      if (tab.id === this.store.activeId) li.classList.add('active');
      if (tab.loading) li.classList.add('loading');
      if (tab.asleep) li.classList.add('asleep');
      else if (tab.suspended) li.classList.add('suspended');
      if (drag?.id === tab.id) li.classList.add('dragging');
      if (this.selected.has(tab.id)) li.classList.add('selected');
      if (this.dimmed(tab.tags, tab.liked)) li.classList.add('dim');
      const island = this.islands.find((i) => i.id === tab.island);
      if (island) {
        li.classList.add('in-island');
        li.style.setProperty('--island', island.color);
        li.title = `島：${island.name}`;
      }
      li.dataset.id = String(tab.id);
      const icon = span('hex-icon');
      icon.append(this.htmlIcon(tab));
      const close = document.createElement('button');
      close.className = 'close';
      close.dataset.action = 'close';
      close.setAttribute('aria-label', '閉じる');
      close.textContent = '×';
      const title = span('title');
      if (tab.comment) {
        title.classList.add('with-comment');
        title.append(span('row-title', tab.title || tab.url || '新しいタブ'), span('row-comment', tab.comment));
      } else {
        title.textContent = tab.title || tab.url || '新しいタブ';
      }
      li.append(span('num', String(tab.order)), icon, title);
      for (const tag of tab.tags.slice(0, 3)) {
        const chip = span('tag-chip', tag);
        chip.style.setProperty('--tag', tagColor(tag));
        li.append(chip);
      }
      if (tab.audible) li.append(span(tab.muted ? 'audio-mark muted' : 'audio-mark', '♪'));
      if (tab.keepAwake) li.append(span('keep-mark-html'));
      if (tab.notes.length > 0) li.append(span('note-mark', `✎${tab.notes.length}`));
      if (tab.liked > 0) li.append(span('like-mark', '♥'.repeat(tab.liked)));
      if (tab.readEdges >= 6) li.append(span('read-mark', '読了'));
      li.append(close);
      return li;
    });
    if (drag) {
      const marker = document.createElement('li');
      marker.className = 'drop-marker';
      rows.splice(drag.index, 0, marker);
    }
    if (rows.length === 0) rows.push(Object.assign(document.createElement('li'), { className: 'list-empty', textContent: 'このシートにはタブがありません' }));
    this.list.replaceChildren(...rows);
  }

  // リストの六角形のアイコン：画像を見せる見え方なら画像、それ以外はサイトのアイコン
  private htmlIcon(tab: Tab): HTMLElement {
    const shown = resolveFace(tab, this.tabLook, this.faces);
    if (shown.mode === 'image') {
      const img = document.createElement('img');
      img.className = 'face-photo';
      img.src = shown.href;
      img.alt = '';
      return img;
    }
    if (!tab.favicon || this.brokenIcons.has(tab.favicon)) return span('letter', initialOf(tab));
    const img = document.createElement('img');
    img.className = 'favicon';
    img.src = tab.favicon;
    img.alt = '';
    img.addEventListener('error', () => this.markBroken(tab.favicon), { once: true });
    return img;
  }

  private bindListEvents() {
    const list = this.list;
    list.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as Element).closest('[data-action="close"]')) return;
      const id = idAt(e.target);
      if (id === null) return;
      this.hideBalloon();
      this.drag = { kind: 'row', id, startY: e.clientY, moved: false, index: 0 };
      list.setPointerCapture(e.pointerId);
    });
    list.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) {
        this.setHover(idAt(e.target));
        return;
      }
      if (d.kind !== 'row') return;
      const moved = d.moved || Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD;
      if (!moved) return;
      this.noteItemDrag(d.moved, true); // 動かし始めたときだけ、詳細と吹き出しを隠す
      d.moved = true;
      d.index = this.rowIndexAt(e.clientY);
      this.requestRender();
    });
    list.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (d?.kind === 'row') {
        if (!d.moved) {
          if (e.ctrlKey || e.metaKey) this.toggleSelect(d.id);
          else {
            this.clearSelection();
            this.actions.activate(d.id);
          }
        } else {
          const from = this.store.inSheet(this.sheet).findIndex((t) => t.id === d.id);
          this.store.moveInOrder(d.id, d.index > from ? d.index - 1 : d.index);
        }
      }
      this.finishItemDrag(d);
    });
    list.addEventListener('pointercancel', () => {
      const d = this.drag;
      this.drag = null;
      this.finishItemDrag(d);
      this.requestRender();
    });
    list.addEventListener('pointerleave', () => {
      if (!this.drag) this.setHover(null);
    });
    list.addEventListener('click', (e) => {
      const button = (e.target as Element).closest('[data-action="close"]');
      const id = button ? idAt(button) : null;
      if (id !== null) this.actions.close(id);
    });
    list.addEventListener('scroll', () => this.hideBalloon(), { passive: true });
    bindMiddleClickClose(list, (id) => this.actions.close(id));
    list.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.hideBalloon();
      const id = idAt(e.target);
      if (id !== null && !this.selected.has(id)) this.setSelection([id]);
      this.actions.contextMenu({ id, memo: null, hex: null, x: e.clientX, y: e.clientY });
    });
  }

  // マウスの高さから「何番目と何番目の間か」を求める
  private rowIndexAt(clientY: number) {
    let index = 0;
    for (const row of this.list.querySelectorAll<HTMLElement>('li.row')) {
      const rect = row.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) index++;
    }
    return index;
  }

  // ---------- 共通 ----------

  private markBroken(url: string) {
    if (this.brokenIcons.has(url)) return;
    this.brokenIcons.add(url);
    this.requestRender();
  }
}

// セルの集まりを、色の面とまわりの枠で描き、いちばん上のセルの上に名前を出す（六角メモの「領域」と同じ見せ方）
function regionShape(cells: Hex[], color: string, name: string, dashed: boolean, label: { id?: string; zoom?: number } = {}) {
  const keys = new Set(cells.map(hexKey));
  let fill = '';
  let edge = '';
  for (const h of cells) {
    const c = hexToPixel(h, CELL);
    const corners = hexCornerPoints(c.x, c.y, CELL);
    fill += `M${corners.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`;
    EDGE_DIRECTIONS.forEach((d, i) => {
      if (keys.has(hexKey({ q: h.q + d.q, r: h.r + d.r }))) return; // となりも島の中なら、枠は引かない
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      edge += `M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    });
  }
  const g = svgEl('g', { class: dashed ? 'island draft' : 'island' });
  g.style.setProperty('--island', color); // 面・枠・名前は、テーマの明るさの帯で描く（data-colors.css。属性の色は帯の効かない所の代わり）
  g.append(svgEl('path', { class: 'island-fill', d: fill, fill: color }), svgEl('path', { class: 'island-edge', d: edge, stroke: color }));
  const top = cells.map((h) => hexToPixel(h, CELL)).sort((a, b) => a.y - b.y || a.x - b.x)[0];
  if (top && name) {
    // 名前：縮めても画面の上で 10px より小さくしない。縁取り（背景の色）で、線やセルの上でも読める。押せる（右クリック・ダブルクリック）
    const size = islandLabelSize(label.zoom ?? 1);
    const text = svgText({ x: top.x, y: top.y - CELL - 6 - (size - 10) * 0.4 }, name, 'island-label');
    text.style.fontSize = `${size.toFixed(1)}px`;
    text.style.strokeWidth = `${(size * 0.32).toFixed(1)}px`;
    if (label.id) {
      text.dataset.island = label.id;
      const tip = svgEl('title', {});
      tip.textContent = `島「${name}」（右クリックで名前・色・解散、ダブルクリックで名前を変える）`;
      text.append(tip);
    }
    g.append(text);
  }
  return g;
}

// 押した要素が盤面の関連の線（当たりの太い線・ほかのシートの印）なら、その線の id
function boardLinkAt(target: EventTarget | null): string | null {
  const node = target instanceof Element ? target.closest<SVGElement>('[data-board-link]') : null;
  return node?.dataset.boardLink ?? null;
}

// 線の先（相手の側）の矢じり。points は gapLine の「x,y x,y …」
function linkHead(points: string, head: string): SVGElement | null {
  if (head === 'none') return null;
  const pts = points.split(' ').map((p) => p.split(',').map(Number));
  if (pts.length < 2) return null;
  const [x2, y2] = pts[pts.length - 1];
  const [x1, y1] = pts[pts.length - 2];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const nx = -uy;
  const ny = ux;
  const s = 5;
  const at = (back: number, side: number) => `${(x2 - ux * back + nx * side).toFixed(1)},${(y2 - uy * back + ny * side).toFixed(1)}`;
  switch (head) {
    case 'triangle':
      return svgEl('polygon', { class: 'board-link-head filled', points: `${at(0, 0)} ${at(s * 1.6, s)} ${at(s * 1.6, -s)}` });
    case 'chevron':
      return svgEl('polyline', { class: 'board-link-head', points: `${at(s * 1.5, s)} ${at(0, 0)} ${at(s * 1.5, -s)}` });
    case 'bar':
      return svgEl('polyline', { class: 'board-link-head', points: `${at(0, s * 1.1)} ${at(0, -s * 1.1)}` });
    case 'dot':
      return svgEl('circle', { class: 'board-link-head filled', cx: x2.toFixed(1), cy: y2.toFixed(1), r: 3 });
    case 'diamond':
      return svgEl('polygon', { class: 'board-link-head filled', points: `${at(0, 0)} ${at(s, s * 0.7)} ${at(s * 2, 0)} ${at(s, -s * 0.7)}` });
    default:
      return null;
  }
}

// 押した要素が島の名前なら、その島の id
function islandLabelAt(target: EventTarget | null): string | null {
  const node = target instanceof Element ? target.closest<SVGElement>('[data-island]') : null;
  return node?.dataset.island ?? null;
}

// 中クリック（ホイールボタン）でタブを閉じる
function bindMiddleClickClose(target: Element, close: (id: number) => void) {
  target.addEventListener('mousedown', (e) => {
    if ((e as MouseEvent).button === 1) e.preventDefault(); // 自動スクロールを出さない
  });
  target.addEventListener('auxclick', (e) => {
    if ((e as MouseEvent).button !== 1) return;
    const id = idAt(e.target);
    if (id !== null) close(id);
  });
}

function idAt(target: EventTarget | null): number | null {
  const found = target instanceof Element ? target.closest('[data-id]') : null;
  return found ? Number(found.getAttribute('data-id')) : null;
}

function memoAt(target: EventTarget | null): string | null {
  const found = target instanceof Element ? target.closest('[data-memo]') : null;
  return found?.getAttribute('data-memo') ?? null;
}

function controlButton(label: string, title: string, onClick: () => void) {
  const button = document.createElement('button');
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', onClick);
  return button;
}

// セル a から b へ、隙間を通る線（両端はセルの中へ少し入れる）
function gapLine(a: Hex, b: Hex): string | null {
  const route = gapRoute(a, b);
  if (!route || route.length === 0) return null;
  const pts = route.map((v) => vertexToPixel(v, CELL));
  const into = (p: Point, cell: Hex) => {
    const c = hexToPixel(cell, CELL);
    return { x: p.x + (c.x - p.x) * 0.3, y: p.y + (c.y - p.y) * 0.3 };
  };
  pts.unshift(into(pts[0], a));
  pts.push(into(pts[pts.length - 1], b));
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function span(className: string, text = '') {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}
