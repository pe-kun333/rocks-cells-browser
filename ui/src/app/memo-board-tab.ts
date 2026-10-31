// 「ボード」タブの面（B1-4 読むだけ、B2-1 カードを動かして保存、B2-2 選ぶ・まとめて動かす・見ている位置の保存）
//   カードは DOM、線は SVG（ズームでぼけない）。位置は memo-card-board.ts の layoutCards（保存したものがあればそれ、なければ仮の升目）
//   B2-1：カードを左ボタンのドラッグで動かし、離したときに saveBoard で保存する（動かしたカードだけが入る。ほかは仮の位置のまま）。つまんでいる間は影つきで浮かせ、線は追従する
//   B2-2：クリック＝1 枚選ぶ／Shift クリック＝足す・外す／Shift＋空きのドラッグ＝範囲選択／空きのクリック＝選びを外す／Ctrl+A＝全部。選んだカードをつまむと全部が一緒に動き、保存は 1 回
//         見ている位置（パン・ズーム・［全体］）は、止まって約 0.4 秒後に保存する（メモ・タブを離れるときはその場で）。保存は B2-1 と同じ 1 本の列（直列）に並べる
//   B2-3b：上の道具の列でカードを足す（見ている場所の真ん中の空き）・消す・書き直す（1 枚）・タグ（選んだ全部）・線を足す／外す（1 枚）。台帳を書くのは左だけで、ここは既存の命令を送る
//         送ったあとは、左の写しに変わりが現れたかを見て知らせる。足したカードは写しに現れてから座標を書く（断られても孤児を作らない）。計算は memo-card-board-edit.ts（試験あり）
//   B3-1：2 枚以上選んで「型にする…」。登録の小窓・保存は下の区画のもの（型の窓と同じ道）を借り、ここは選んだカードの id と、ボードの座標の差（dx・dy）を渡すだけ
//   B3-2b：「型を貼る ▾」で型を選ぶと、見ている面の真ん中を基準に一発で貼る（ゴーストは無い）。穴あきの型は下の区画の空欄の小窓（BoardTemplateHook.fill）を使う。
//         id を先に決めて sendReplies（ids。B3-2a）で貼り、左の写しに全部現れてから、座標（基準＋型の dx,dy）を書く（断られたら座標は書かない＝孤児を作らない）。貼ったカードは全部選ぶ。計算は memo-card-board-paste.ts（試験あり）
//   B3-3b：道具の列の「元に戻す」「やり直す」と Ctrl+Z／Ctrl+Shift+Z／Ctrl+Y（文字の欄にいないときだけ）。移動・足す・消す・線・型の貼り付けを 50 回まで積み（メモを替えたら捨てる）、
//         戻し方は memo-card-board-undo.ts：消す＝restoreReplies（B3-3a。削除のたびに新しい undoToken）／足す＝removeReply／貼り付け＝undoSendReplies／線＝逆の changeReplyLinks／移動＝座標。戻せなければ一言出して、その 1 件だけ積みから外す
//   保存に失敗したら（カードは）元の位置に戻し、理由を出す。読めないボード・読み込み中は動かさない・書かない。Esc：つまむのを取り消す→選びを外す→縮める→メモへ
//   B1-3 のとおり、［拡大］［縮小］は高さの道（PaneHeightApi。つまみと同じ道）。計算は memo-card-board-view.ts・memo-card-board-select.ts・memo-pane-expand.ts（試験あり）
//   画面の文字は textContent だけで入れる
import { el } from '../util';
import { CellMenu, type MenuEntry } from '../panels/cell-menu';
import { tagArea } from '../panels/tag-pad';
import { MAX_TAGS_PER_TAB, registeredTagNames } from '../tags';
import type { RelayCommand } from '../types';
import { addBlockedNote, addCommand, cardAppeared, cardsGone, cardTextIs, deleteCommands, editCheck, editCommand, kindChoices, linkAddPlan, linkIs, linkRemoveCommand, liveSelection, makeReplyId, relationsOf, type Relation, spotForNewCard, tagCommands, tagFullCount, templateBlockedNote, templateOffsets, toolState, unionTags } from '../memo-card-board-edit';
import { readDataChecked } from '../data';
import { pasteDoneText, pastedAppeared, planBoardPaste, planRepaste, pasteToolNote } from '../memo-card-board-paste';
import { addUndoCommand, linkKindOf, linkSetCommand, linkStateIs, moveTargets, newUndoToken, pasteUndoCommand, REDO_STALE_NOTE, restoreCommand, restoreMoves, UNDO_STALE_NOTE, undoBlockedNote, undoButtons, undoDoneText, UndoStack, type UndoDir, type UndoOp } from '../memo-card-board-undo';
import { BOARD_KEY_HINT, boardKeyAction, boardKeysActive, KEYSHORTCUTS, keyFocusOf } from '../memo-card-board-keys';
import { orphanNoteText, planTidy, tidyButton, tidyConfirmMessage, tidyDoneText, TIDY_LABEL, TIDY_NONE_NOTE } from '../memo-card-board-tidy';
import { pasteBlocked, TEMPLATE_EMPTY_HINT, templateMenuGroups, templateMenuLabel, type LoadTemplatesResult } from '../memo-card-template-store';
import { type CardTemplate, extractHoles } from '../memo-card-templates';
import { cardFilterRow, cardTagCandidates, cardTagCounts } from '../memo-card-filter';
import { type BoardView, DEFAULT_VIEW, type NodeMove, panBy, zoomAt } from '../memo-card-board';
import type { Pt, Selection } from '../memo-card-board-select';
import { boardPaneIo } from './memo-board-io';
import { boardSaveMessage, type LoadBoardResult, loadBoard, saveBoard } from '../memo-card-board-store';
import { boardEmptyText, boardFaces, boardLinks, boardNote, type CardFace, dimmedIds, edgeGeometry, fitAll, initialView, linkDimmed, moveBlockedNote, moveResultNote, pastThreshold, planMoves, planView, searchWords, viewResultNote, viewSaveWait, wheelZoomFactor, withPending } from '../memo-card-board-view';
import { groupDragPositions, marqueeHits, marqueeRect, marqueeSelection, pressSelect, pruneSelection, sameSelection, selectAll, selectionCountText } from '../memo-card-board-select';
import { cardLabel, type LinkKind, type LinkKindNames, linkKindInfo, linkSentence, withLinkKindNames } from '../memo-card-links';
import { linkMarkerDefs } from '../memo-card-link-layer';
import { expandLabel, isExpanded, leaveExpand, shrinkExpand, toggleExpand, type ExpandState } from '../memo-pane-expand';
import { type BoardPlace, boardExpandShown, PLACE_BUTTON_LABEL, PLACE_BUTTON_TITLE } from '../memo-card-board-place';
import type { Reply } from '../threads';
import { type BoardMemoInfo, type PickMode, memoTagOf, pickerEntries, pickMode } from '../memo-board-pick';
import type { MemoIndexItem } from '../memocells';

export interface PaneHeightApi {
  get(): number;
  set(height: number): void; // 高さを変えて保存する（つまみと同じ道）
  onChange(fn: () => void): void; // 高さが変わったとき（つまみ・左からの知らせ）
}

// いま開いているメモのカードの写し（下の区画の view）。台帳を書くのは左だけで、ここは読むだけ
export interface BoardSource {
  get(): { memoId: string; replies: readonly Reply[] } | null;
  onChange(fn: () => void): void; // 写しが替わったとき（メモを開いた・替えた・カードが替わった・閉じた）
  info?(): BoardMemoInfo | null; // 名札の元（見ているメモの見出し・下の区画のメモ・別のメモを選んでいるか。M3）
  linkNames?(): LinkKindNames | undefined; // 見ているメモの関連の呼び名（呼称セットを選んでいればそのセット。M4。別のメモを見ているときだけ、ボードの描画・メニューで使う）
}

// ボードで見るメモを選ぶ道（M3）。メモの一覧は下の面が持っているもの。選ぶと左へ頼む（null＝下の区画と同じに戻す。命令は下の面が送る）
export interface BoardMemoPick {
  list(): { items: readonly MemoIndexItem[]; recent: readonly MemoIndexItem[]; sheetName: string };
  pick(id: string | null): void;
}

// 左へ命令を送る道（下の区画の ask と同じ。返事は待たない）と、左の知らせ（断られたときの文など）を受ける口
export interface BoardCommands {
  ask(action: RelayCommand): void;
  onNotice?(fn: (text: string) => void): void;
  onUndoSend?(fn: (token: string, openMemo: string) => void): void; // 左が送った型の貼り付けの「元に戻す」の印（B3-3b。ボードの Undo が undoSendReplies に使う）
  template?: BoardTemplateHook;
  place?: BoardPlaceHook; // 「上に出す／下に戻す」ボタンが押されたとき（案 C・C3。旗は廃止したので常にボタンを出す）
  pick?: BoardMemoPick; // 見るメモの名札と選び口（M3。上に出しているときだけ選べる）
}

// ボードを上の半分に出す・下に戻す道。押された向き（いま下なら upper、上なら bottom）を渡す
export interface BoardPlaceHook {
  request(to: BoardPlace): void;
}

// 型にする小窓（下の区画のもの）を、ボードから開く道。登録のあとの一言は onDone で返ってくる
export interface BoardTemplateHook {
  open(ids: string[], offsets: Record<string, { dx: number; dy: number }>, anchor: HTMLElement): void; // anchor：小窓を出す位置の目印（この下に出す）
  close(): void; // ボードから開いた小窓を閉じる（選びが変わった・タブを離れた）
  onDone(fn: (text: string, ok: boolean) => void): void; // 登録できた（ok）・小窓を閉じたあとに登録が終わった
  // 型を貼る（B3-2b）：保存してある型を読む（開くたびに読む。読めなければ null か unreadable）／穴あきの型の空欄の小窓を、anchor の下に出す。「貼る」を押したら、埋めた型と一言（空欄が残った・字数を切った）を返す（貼るのはボード側）
  list(): Promise<LoadTemplatesResult | null>;
  fill(template: CardTemplate, anchor: HTMLElement, done: (filled: CardTemplate, notes: string[]) => void): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEAD_PREFIX = 'memo-board-head-';
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K) => document.createElementNS(SVG_NS, tag);

// 読み込みは読むだけの io（書く道は渡さない）。書くのは動かして離したときの保存（boardPaneIo）だけ
const readOnlyIo = { read: (name: string) => readDataChecked<unknown>(name), write: async () => false };
const STATUS_MS = 8000;
const WATCH_MS = 3000; // 送った命令の結果が左の写しに現れるのを待つ長さ
const KNOWN_MAX = 30; // 読んだ・保存したボードの写しを覚えておく数（メモを替えた直後に、前のメモの見ている位置を保存するため）

export class MemoBoardPanel {
  readonly root = el('div', 'memo-board');
  private readonly btn = el('button', 'memo-board-expand', expandLabel(false));
  private readonly placeBtn = el('button', 'memo-board-place', PLACE_BUTTON_LABEL.bottom); // 上に出す／下に戻す（常に出す。C3）
  private place: BoardPlace = 'bottom';
  private menuEsc: Event | null = null; // メニューの中で押された Esc（ownsMenu。M3）
  private pointerOutside = false; // 最後に押した（クリックした）所が、ボードの面の外（下のメモの帯など）か。上に出しているときの、キーを受ける場所の判断に使う（C4）
  private readonly memoTag = el('button', 'memo-board-memotag'); // 見ているメモの名札（上に出していれば、押してメモを選べる。M3）
  private readonly count = el('span', 'memo-board-count');
  private readonly orphanEl = el('span', 'memo-board-orphan'); // 台帳から消えたカードの位置が残っているときだけ出す（B4-1）
  private readonly search = el('input', 'memo-board-search');
  private readonly fitBtn = el('button', 'memo-board-fit', '全体');
  private readonly zoomLabel = el('span', 'memo-board-zoom', '100%');
  private readonly filterBox = el('div', 'memo-board-filter');
  private readonly note = el('div', 'memo-board-note');
  private readonly stage = el('div', 'memo-board-stage');
  private readonly world = el('div', 'memo-board-world');
  private readonly links = svgEl('svg');
  private readonly linkLines = svgEl('g');
  private readonly emptyText = el('div', 'memo-board-empty');
  private readonly hint = el('div', 'memo-board-hint', BOARD_KEY_HINT);
  private before: number | null = null;

  private hidden = true;
  private memoId: string | null = null;
  private loaded: LoadBoardResult | null = null;
  private readonly known = new Map<string, LoadBoardResult>(); // メモごとの、いちばん新しく読んだ・保存したボード（保存の列がこれを元に次の形を作る）
  private loadSeq = 0;
  private needFit = true;
  private view: BoardView = { ...DEFAULT_VIEW };
  private faces: CardFace[] = [];
  private cardEls = new Map<string, HTMLElement>();
  private lineEls: { g: SVGGElement; path: SVGPathElement; label: SVGTextElement; from: string; to: string }[] = [];
  private pos = new Map<string, { x: number; y: number }>(); // いま描いている位置（つまんでいる間は動く）
  private readonly status = el('div', 'memo-board-status');
  private statusTimer = 0;
  private readonly pending = new Map<string, { x: number; y: number; seq: number }>(); // 保存を待っている位置（動かした直後に元へ跳ばない）。seq＝何回目の保存の分か（あとの保存の分を消さないため）
  private seq = 0;
  private queue: Promise<void> = Promise.resolve(); // 保存は 1 つずつ（前の保存の結果を次が使う）
  private drag: { pointerId: number; ref: string; els: HTMLElement[]; sx: number; sy: number; starts: Map<string, Pt>; pos: Map<string, Pt>; moved: boolean; collapse: boolean } | null = null;
  private selected: Selection = new Set<string>();
  private total = 0;
  private readonly marqueeEl = el('div', 'memo-board-marquee');
  private marquee: { id: number; sx: number; sy: number; base: Selection } | null = null; // 面の左上からの画素
  private viewTouchedAt: number | null = null; // 見ている位置を最後に変えた時刻（保存していないとき）
  private viewTimer = 0;
  private readonly tools = el('div', 'memo-board-tools');
  private readonly addBtn = el('button', 'memo-board-tool', '＋カード');
  private readonly editBtn = el('button', 'memo-board-tool', '書き直す');
  private readonly removeBtn = el('button', 'memo-board-tool is-danger', '削除');
  private readonly linkAddBtn = el('button', 'memo-board-tool', '線を足す');
  private readonly linkRemoveBtn = el('button', 'memo-board-tool', '線を外す…');
  private readonly templateBtn = el('button', 'memo-board-tool', '型にする…');
  private readonly pasteBtn = el('button', 'memo-board-tool', '型を貼る ▾');
  private readonly undoBtn = el('button', 'memo-board-tool', '元に戻す');
  private readonly redoBtn = el('button', 'memo-board-tool', 'やり直す');
  private readonly tidyBtn = el('button', 'memo-board-tool', TIDY_LABEL); // 消えたカードの位置を整理する（B4-1。孤児があるときだけ押せる）
  private readonly tidyBar = el('div', 'memo-board-tidybar');
  private readonly tidyText = el('span', 'memo-board-tidybar-text');
  private tidyOk: HTMLButtonElement | null = null;
  private readonly undo = new UndoStack(); // 元に戻す・やり直しの積み（B3-3b。メモを替えたら捨てる）
  private undoBusy = false; // 戻している最中（左の結果を待っている）
  private undoAbort: ((text: string) => void) | null = null; // 戻している最中に左が「元に戻せませんでした」と知らせてきたら、待たずに失敗にする
  private lastSend: { token: string; openMemo: string; at: number } | null = null; // 左から最後に届いた「送りを元に戻す」の印（型の貼り付けの Undo 用）
  private awaitingPaste: Extract<UndoOp, { kind: 'paste' }> | null = null; // 貼ったあと、印がまだ届いていない操作
  private pasteSeq = 0; // 型の一覧の読み込みの通し番号（閉じた・替わったあとに届いた読み込みは捨てる）
  private fillOpen = false; // 空欄の小窓（下の区画のもの）をボードから開いている
  private templateKey: string | null = null; // 型の小窓を開いたときの選び（選びが変わったら閉じる）
  private readonly tagRow = el('div', 'memo-board-tagrow');
  private tagKey = '';
  private readonly compose = el('form', 'memo-board-compose');
  private readonly composeLabel = el('label', 'memo-board-compose-label');
  private readonly composeText = el('textarea', 'memo-board-compose-text');
  private composing: { kind: 'add' } | { kind: 'edit'; id: string } | null = null;
  private readonly linkBar = el('div', 'memo-board-linkbar');
  private readonly linkBarText = el('span', 'memo-board-linkbar-text');
  private linkFrom: string | null = null; // 線を引く元のカード（相手のカードを押すのを待っている）
  private menu: CellMenu | null = null;
  private noticeAt = 0; // 左から最後に知らせが来た時刻（断られた理由を、こちらの一言で隠さないため）
  private dirty = false; // つまんでいる間に写しが替わった（離したあとに描き直す）
  private renderKey = '';
  private filterTag: string | null = null;
  private words: string[] = [];
  private space = false;
  private pan: { id: number; x: number; y: number; sx: number; sy: number; click: boolean } | null = null;

  constructor(
    private readonly api: PaneHeightApi | undefined,
    private readonly source: BoardSource | undefined,
    private readonly cmds?: BoardCommands,
  ) {
    this.root.hidden = true;
    const bar = el('div', 'memo-board-bar');
    this.memoTag.type = 'button';
    this.memoTag.dataset.key = 'board-memo-tag';
    this.memoTag.hidden = true;
    this.memoTag.addEventListener('click', () => this.openPickMenu());
    bar.append(el('span', 'memo-board-title', 'ボード'), this.memoTag, this.count, this.orphanEl);
    this.orphanEl.hidden = true;
    this.search.type = 'search';
    this.search.placeholder = '検索';
    this.search.setAttribute('aria-label', 'カードを検索（合わないカードは薄くなります）');
    this.search.addEventListener('input', () => {
      this.words = searchWords(this.search.value);
      this.paintDim();
    });
    this.fitBtn.type = 'button';
    this.fitBtn.title = '全部のカードが入るように見ている位置を合わせます';
    this.fitBtn.addEventListener('click', () => this.fit());
    this.btn.type = 'button';
    this.btn.dataset.key = 'board-expand';
    this.btn.addEventListener('click', () => this.toggle());
    const right = el('div', 'memo-board-bar-right');
    right.append(this.search, this.fitBtn, this.zoomLabel);
    if (api) right.append(this.btn);
    this.placeBtn.type = 'button';
    this.placeBtn.dataset.key = 'board-place';
    this.placeBtn.hidden = true;
    this.placeBtn.addEventListener('click', () => this.cmds?.place?.request(this.place === 'upper' ? 'bottom' : 'upper'));
    right.append(this.placeBtn);
    bar.append(right);

    this.links.classList.add('memo-board-links');
    this.links.setAttribute('aria-hidden', 'true');
    this.links.setAttribute('focusable', 'false');
    this.links.append(linkMarkerDefs(HEAD_PREFIX), this.linkLines);
    this.world.append(this.links);
    this.marqueeEl.hidden = true;
    this.stage.append(this.world, this.marqueeEl, this.emptyText, this.hint);
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
    this.root.append(bar, this.tools, this.tagRow, this.compose, this.linkBar, this.tidyBar, this.filterBox, this.note, this.status, this.stage);
    this.filterBox.hidden = true;
    this.note.hidden = true;
    this.emptyText.hidden = true;

    this.buildTools();
    this.bindStage();
    // 隠れていて大きさが 0 のあいだは全体表示を待つ。大きさが付いたら合わせる（区画の高さが変わったときも測り直す）
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        if (this.needFit && !this.hidden) this.render();
      }).observe(this.stage);
    }
    api?.onChange(() => this.paintButton());
    source?.onChange(() => {
      if (!this.hidden) this.refresh(false);
    });
    cmds?.template?.onDone((text, ok) => {
      if (!this.hidden) this.flash(text, ok ? 'info' : 'warn');
    });
    cmds?.onUndoSend?.((token, openMemo) => this.noteUndoSend(token, openMemo));
    cmds?.onNotice?.((text) => {
      this.noticeAt = Date.now();
      if (this.undoBusy && this.undoAbort && text.startsWith('元に戻せませんでした')) this.undoAbort(text); // 3 秒待たずに終える
      if (!this.hidden) this.flash(text, /ません|までです|できな/.test(text) ? 'warn' : 'info');
    });
    this.paintButton();
  }

  // ---------- 上に出す・下に戻す（案 C・C3） ----------

  // 下の区画が決めた置き場を受ける。available：上に出せる（段 "2"）。出せないときはボタンを出さず、［拡大］も今までどおり
  setPlace(available: boolean, upper: boolean) {
    if (upper && this.place !== 'upper') this.pointerOutside = false; // 上に出した直後は、まだ下の帯を触っていないことにする
    this.place = upper ? 'upper' : 'bottom';
    this.placeBtn.hidden = !available || !this.cmds?.place;
    this.placeBtn.textContent = PLACE_BUTTON_LABEL[this.place];
    this.placeBtn.title = PLACE_BUTTON_TITLE[this.place];
    this.btn.hidden = !boardExpandShown(upper); // 上のあいだは高さを広げない（高さは上の面が決める）
    this.root.classList.toggle('is-upper', upper);
    this.paintMemoTag();
  }

  // ---------- 見るメモの名札と選び口（M3） ----------

  private tagMode(info: BoardMemoInfo | null): PickMode {
    const pick = this.cmds?.pick;
    return pickMode(info, { available: !!pick, upper: this.place === 'upper' });
  }

  // 別のメモを見ているときは目立たせる（名札の色と帯の色）。同じときは控えめ。見るメモが無いときは出さない
  private paintMemoTag() {
    const info = this.source?.info?.() ?? null;
    const tag = memoTagOf(info, this.tagMode(info));
    this.memoTag.hidden = tag === null;
    this.root.classList.toggle('is-other-memo', tag?.tone === 'other');
    if (!tag) {
      this.menu?.close();
      return;
    }
    this.memoTag.textContent = tag.text;
    this.memoTag.title = tag.title;
    this.memoTag.disabled = !tag.pickable;
    this.memoTag.classList.toggle('is-other', tag.tone === 'other');
    this.memoTag.setAttribute('aria-label', `${tag.text.replace(' ▾', '')}。${tag.title}`);
  }

  private openPickMenu() {
    const pick = this.cmds?.pick;
    const info = this.source?.info?.() ?? null;
    if (!pick || !info) return;
    const mode = this.tagMode(info);
    if (mode === 'static') return;
    this.cancelLink();
    this.closeCompose();
    this.closeTemplate();
    const { items, recent, sheetName } = pick.list();
    const entries = pickerEntries({ items, recent, sheetName, info, mode, run: (id) => pick.pick(id) });
    const at = this.memoTag.getBoundingClientRect();
    this.getMenu().open(at.left, at.bottom + 2, entries);
    this.getMenu().focusFirst();
  }

  // 上に出しているあいだ、キー（Ctrl+A・Ctrl+Z 系・Delete・スペース・Esc）をボードが受けてよいか（C4）。下に出しているときは常に true（今までと同じ）
  keysAllowed(target: EventTarget | null): boolean {
    const inBoard = target instanceof Node && this.root.contains(target);
    const bare = !(target instanceof Element) || target === document.body || target === document.documentElement;
    return boardKeysActive(this.place === 'upper', keyFocusOf(inBoard, bare), this.pointerOutside);
  }

  // この Esc は、ボードの浮いたメニュー（メモの選び口・型・線の種類など。body に出る）の中で押されたものか（上のボードの Esc で、メニューを閉じるだけにするため。M3）
  //   メニューは Esc で自分を閉じるとき中身を片づけるので、閉じる前（window の捕まえる段）に覚えておく
  ownsMenu(e: Event): boolean {
    return this.menuEsc === e;
  }

  // フォーカスが（ボタンなどの）ボードの面の中にあるか（上のボードの Esc で、「何もしない」と「メモの帯に任せる」を分ける。C4）
  hasFocusInside(target: EventTarget | null): boolean {
    return target instanceof Node && this.root.contains(target);
  }

  // 取り合いの一言など、面の一言欄に出す（隠れていても出す）
  notify(text: string) {
    this.flash(text, 'info');
  }

  // ---------- 高さ（B1-3） ----------

  get expanded(): boolean {
    return this.api ? isExpanded(this.api.get(), availHeight()) : false;
  }

  setHidden(hidden: boolean) {
    const was = this.hidden;
    this.hidden = hidden;
    this.root.hidden = hidden;
    if (!hidden && was) this.refresh(true);
    if (hidden) {
      this.releasePan();
      this.cancelDrag();
      this.flushView(); // タブを離れる：見ている位置の保存が残っていたら、その場で保存する
      this.cancelLink();
      this.menu?.close();
      this.closeTemplate();
    }
  }

  toggle() {
    this.apply(this.api ? toggleExpand(this.state(this.api), availHeight()) : null);
  }

  // Esc：広げてあれば縮めて true。広げてなければ何もせず false
  shrink(): boolean {
    return this.apply(this.api ? shrinkExpand(this.state(this.api), availHeight()) : null);
  }

  // ボードのタブを離れるとき：このタブの［拡大］で広げたときだけ元の高さへ戻す
  leave() {
    this.apply(this.api ? leaveExpand(this.state(this.api), availHeight()) : null);
    this.before = null;
  }

  private state(api: PaneHeightApi): ExpandState {
    return { height: api.get(), before: this.before };
  }

  private apply(next: ExpandState | null): boolean {
    if (!next || !this.api) return false;
    this.before = next.before;
    this.api.set(next.height);
    this.paintButton();
    return true;
  }

  private paintButton() {
    const on = this.expanded;
    this.btn.textContent = expandLabel(on);
    this.btn.setAttribute('aria-pressed', String(on));
    this.btn.title = on ? '区画の高さを元に戻します（Esc でも戻ります）' : '区画の高さを広げます';
  }

  // ---------- 読み込みと描画（読むだけ） ----------

  // 見せるとき・写しが替わったとき。show：タブを開いた直後（ファイルを読み直す）
  private refresh(show: boolean) {
    this.paintMemoTag();
    const snap = this.source?.get() ?? null;
    if (!snap) {
      this.flushView();
      this.resetUndo();
      this.memoId = null;
      this.loaded = null;
      this.loadSeq += 1;
      this.needFit = true;
      this.render();
      return;
    }
    const changed = snap.memoId !== this.memoId;
    if (changed) {
      this.cancelDrag();
      this.flushView(); // 前のメモの、見ている位置の保存が残っていたら、その場で（メモを替える前の位置で）保存する
      this.clearFlash();
      this.pending.clear();
      this.resetUndo(); // 元に戻す・やり直しの積みは、メモを替えたら捨てる（B3-3b）
      this.setSelected(new Set());
      this.cancelLink();
      this.closeCompose();
      this.closeTidy(false);
      this.menu?.close();
      this.memoId = snap.memoId;
      this.loaded = null;
      this.needFit = true;
      this.filterTag = null;
      this.words = [];
      this.search.value = '';
      this.renderKey = '';
    }
    if (changed || show) {
      const seq = ++this.loadSeq;
      const memoId = snap.memoId;
      void loadBoard(readOnlyIo, memoId, Date.now()).then((result) => {
        if (seq !== this.loadSeq || this.memoId !== memoId || this.pending.size > 0) return; // 保存の途中の結果は、保存のあとの形を上書きしない
        this.setLoaded(memoId, result);
        this.render();
      });
    }
    this.render();
  }

  // 別のメモ（B）を見ているあいだだけ、関連の呼び名を B のものに一時的に差し替えて動かす（下の区画のメモの呼び名は全体で 1 つの状態なので、動かし終えたら必ず戻す。M4）。見ていないとき・同じメモのときは何もしない（今までと同じ）
  private named<T>(fn: () => T): T {
    const src = this.source;
    if (!src?.linkNames || !src.info?.()?.other) return fn();
    return withLinkKindNames(src.linkNames(), fn);
  }

  private render() {
    this.named(() => this.renderBoard());
  }

  private renderBoard() {
    if (this.drag?.moved) {
      this.dirty = true; // つまんでいる間は描き直さない（離したあとに）
      return;
    }
    this.dirty = false;
    const snap = this.source?.get() ?? null;
    const replies = snap?.replies ?? [];
    const board = this.loaded && this.loaded.state !== 'unreadable' ? this.loaded.board : null;
    const loading = snap !== null && this.loaded === null;
    // 読み込み中は、仮の並びを一瞬見せて入れ替わるのを避けるため、カードを出さない
    const faces = snap && !loading ? withPending(boardFaces(replies, board), this.pending) : [];
    this.stage.dataset.movable = String(snap !== null && moveBlockedNote(this.loaded) === null);
    const provisional = faces.filter((f) => !f.saved).length;
    const note = snap ? boardNote(this.loaded, provisional) : { text: '', tone: '' as const };
    this.note.textContent = note.text;
    this.note.hidden = note.text === '';
    this.note.dataset.tone = note.tone;
    this.total = faces.length;
    this.emptyText.textContent = boardEmptyText;
    this.emptyText.hidden = !(snap !== null && !loading && faces.length === 0);
    this.hint.hidden = faces.length === 0;

    const key = JSON.stringify([snap?.memoId ?? null, faces, boardLinks(replies, new Set(faces.map((f) => f.id))), linkNamesKey()]);
    this.faces = faces;
    if (key !== this.renderKey) {
      this.renderKey = key;
      this.build(replies, faces);
    }
    this.renderFilter(replies);
    this.paintDim();
    if (this.needFit && this.loaded !== null) {
      const vp = this.viewport();
      if (vp.w > 0 && vp.h > 0) {
        this.needFit = false;
        this.view = initialView(this.loaded, faces, vp);
      }
    }
    this.applyView();
    if (!loading) {
      const shown = new Set(faces.map((f) => f.id));
      this.selected = pruneSelection(this.selected, shown); // 消えたカードを選んだままにしない
      if (this.linkFrom !== null && !shown.has(this.linkFrom)) this.cancelLink(); // 線の元のカードが消えた
    }
    this.paintSelect();
  }

  private build(replies: readonly Reply[], faces: readonly CardFace[]) {
    this.cardEls.clear();
    this.pos = new Map(faces.map((f) => [f.id, { x: f.x, y: f.y }]));
    for (const node of this.world.querySelectorAll('.memo-board-card')) node.remove();
    const frag = document.createDocumentFragment();
    for (const f of faces) {
      const card = el('div', 'memo-board-card');
      card.dataset.card = f.id;
      card.style.left = `${f.x}px`;
      card.style.top = `${f.y}px`;
      card.classList.toggle('is-provisional', !f.saved);
      card.title = f.title;
      card.append(el('div', 'memo-board-card-title', f.title));
      if (f.body) card.append(el('div', 'memo-board-card-body', f.body));
      const tags = el('div', 'memo-board-card-tags');
      for (const tag of f.tags) tags.append(el('span', 'memo-board-chip', tag));
      if (f.moreTags > 0) tags.append(el('span', 'memo-board-chip is-more', `+${f.moreTags}`));
      card.append(tags);
      if (f.mark) card.append(el('span', 'memo-board-card-mark', f.mark));
      frag.append(card);
      this.cardEls.set(f.id, card);
    }
    this.world.insertBefore(frag, this.links); // 線はカードの上（隣のカードとの隙間が狭いので、下だと名札が隠れる）

    const at = new Map(faces.map((f) => [f.id, f]));
    const byId = new Map(replies.map((r) => [r.id, r]));
    this.lineEls = [];
    const lines: SVGGElement[] = [];
    for (const link of boardLinks(replies, new Set(faces.map((f) => f.id)))) {
      const a = at.get(link.from);
      const b = at.get(link.to);
      if (!a || !b) continue;
      const geom = edgeGeometry(a, b); // 重なっているカードの線は隠す（動かして離れたら出る）
      const info = linkKindInfo(link.kind);
      const g = svgEl('g');
      g.classList.add('memo-board-link');
      g.dataset.from = link.from;
      g.dataset.to = link.to;
      g.dataset.kind = link.kind;
      const title = svgEl('title');
      title.textContent = linkSentence(cardLabel(byId.get(link.from) ?? { text: '', quote: undefined, image: undefined }, 20), cardLabel(byId.get(link.to) ?? { text: '', quote: undefined, image: undefined }, 20), link.kind);
      const path = svgEl('path');
      path.classList.add('memo-pane-map-edge', 'memo-board-link-line');
      path.setAttribute('d', geom?.d ?? '');
      g.style.display = geom ? '' : 'none';
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', info.color);
      path.style.setProperty('--rel', info.color); // 描くときはテーマの明るさの帯へ（data-colors.css）
      if (info.dashed) path.setAttribute('stroke-dasharray', '6 4');
      if (info.head !== 'none') path.setAttribute('marker-end', `url(#${HEAD_PREFIX}${info.kind})`);
      const label = svgEl('text');
      label.classList.add('memo-pane-map-edge-label', 'memo-board-link-label');
      label.setAttribute('x', String(geom?.mid.x ?? 0));
      label.setAttribute('y', String(geom?.mid.y ?? 0));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('fill', info.color);
      label.style.setProperty('--rel', info.color);
      label.textContent = info.name;
      g.append(title, path, label);
      lines.push(g);
      this.lineEls.push({ g, path, label, from: link.from, to: link.to });
    }
    this.linkLines.replaceChildren(...lines);
  }

  // 絞り込みの札の列（既存の cardFilterRow）。タグが無ければ隠す
  private renderFilter(replies: readonly Reply[]) {
    const counts = cardTagCounts(replies);
    if (this.filterTag !== null && !counts.some(([tag]) => tag === this.filterTag)) this.filterTag = null;
    const total = replies.filter((r) => r.parent === null).length;
    const row = cardFilterRow({
      counts,
      total,
      selected: this.filterTag,
      pick: (tag) => {
        this.filterTag = tag;
        this.renderFilter(this.source?.get()?.replies ?? []);
        this.paintDim();
      },
    });
    this.filterBox.replaceChildren(...(row ? [row] : []));
    this.filterBox.hidden = row === null;
  }

  // 合わないカードを薄くする（作り直さない）
  private paintDim() {
    const replies = this.source?.get()?.replies ?? [];
    const dim = dimmedIds(replies, this.filterTag, this.words);
    for (const [id, node] of this.cardEls) node.classList.toggle('is-dim', dim.has(id));
    for (const line of this.lineEls) line.g.classList.toggle('is-dim', linkDimmed({ from: line.from, to: line.to, kind: 'next' }, dim));
  }

  // ---------- 見ている位置（止まって約 0.4 秒後に保存。B2-2） ----------

  private viewport() {
    return { w: this.stage.clientWidth, h: this.stage.clientHeight };
  }

  private applyView() {
    const v = this.view;
    this.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    this.stage.style.backgroundSize = `${20 * v.zoom}px ${20 * v.zoom}px`;
    this.stage.style.backgroundPosition = `${v.x}px ${v.y}px`;
    this.zoomLabel.textContent = `${Math.round(v.zoom * 100)}%`;
  }

  private fit() {
    this.view = fitAll(this.faces, this.viewport());
    this.applyView();
    this.touchView();
  }

  // 利用者が見ている位置を変えた（パン・ホイール・［全体］）。保存の待ちを始める。読めない・読み込み中は書かないので待たない
  private touchView() {
    if (!this.memoId || moveBlockedNote(this.loaded) !== null) return;
    this.viewTouchedAt = Date.now();
    if (this.viewTimer === 0) this.armViewTimer();
  }

  private armViewTimer() {
    const wait = viewSaveWait(this.viewTouchedAt, Date.now());
    if (wait === null) return;
    this.viewTimer = window.setTimeout(() => {
      this.viewTimer = 0;
      const left = viewSaveWait(this.viewTouchedAt, Date.now());
      if (left === null) return;
      if (left > 0) this.armViewTimer(); // まだ動いている：止まるまで待つ
      else this.flushView();
    }, wait);
  }

  // 保存していない見ている位置があれば、いま保存の列に入れる（タブ・メモを離れるとき・面が隠れるとき）
  flushView() {
    window.clearTimeout(this.viewTimer);
    this.viewTimer = 0;
    if (this.viewTouchedAt === null) return;
    this.viewTouchedAt = null;
    const memoId = this.memoId;
    if (!memoId) return;
    const view = { ...this.view };
    this.enqueue(async () => {
      try {
        const base = this.known.get(memoId);
        const plan = planView(base ?? null, view, Date.now());
        if (!base || !plan.ok || !plan.changed) return; // 読めない・まだ読んでいない・変わっていない：書かない
        const result = await saveBoard(boardPaneIo, base, plan.board);
        this.settle(memoId, result);
        const note = viewResultNote(result);
        if (note && this.memoId === memoId) this.flash(note.text, note.tone);
      } catch {
        if (this.memoId === memoId) this.flash(boardSaveMessage('write'), 'warn');
      }
    });
  }

  // ---------- 保存の列（直列）と、読んだ・保存したボードの覚え ----------

  private enqueue(task: () => Promise<void>) {
    this.queue = this.queue.then(task).catch(() => undefined);
  }

  private setLoaded(memoId: string, result: LoadBoardResult) {
    this.known.delete(memoId);
    this.known.set(memoId, result);
    if (this.known.size > KNOWN_MAX) {
      const oldest = this.known.keys().next().value;
      if (oldest !== undefined) this.known.delete(oldest);
    }
    if (memoId === this.memoId) this.loaded = result;
  }

  private settle(memoId: string, result: { ok: boolean; loaded?: LoadBoardResult }) {
    if (result.ok && result.loaded) this.setLoaded(memoId, result.loaded);
  }

  // ---------- 面の操作 ----------

  private stagePoint(e: PointerEvent): Pt {
    const rect = this.stage.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private bindStage() {
    this.stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (this.drag || this.marquee) return; // つまんでいる間・範囲選択の間は拡大縮小しない（座標がずれるため）
        const rect = this.stage.getBoundingClientRect();
        this.view = zoomAt(this.view, wheelZoomFactor(e.deltaY, e.deltaMode), e.clientX - rect.left, e.clientY - rect.top);
        this.applyView();
        this.touchView();
      },
      { passive: false },
    );
    this.stage.addEventListener('pointerdown', (e) => {
      // カードの上の左ボタン＝選ぶ・動かす（Shift なら足す・外す）。空きの Shift＋左ドラッグ＝範囲選択。
      // 空きの左ドラッグ・スペース＋ドラッグ・中ボタン（カードの上でも）＝見ている位置の移動（パン）。空きのクリックは選びを外す
      const cardEl = e.target instanceof Element ? e.target.closest<HTMLElement>('.memo-board-card') : null;
      const idle = !this.pan && !this.drag && !this.marquee;
      if (cardEl && e.button === 0 && !this.space && idle) {
        this.pressCard(e, cardEl);
        return;
      }
      const onCard = cardEl !== null;
      if (e.target instanceof Element && e.target.closest('input, button, select')) return;
      if (!onCard && e.button === 0 && e.shiftKey && !this.space && idle) {
        this.startMarquee(e);
        return;
      }
      const wants = e.button === 1 || (e.button === 0 && (this.space || !onCard));
      if (!wants || this.pan) return;
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, click: e.button === 0 && !this.space && !onCard };
      try {
        this.stage.setPointerCapture(e.pointerId);
      } catch {
        // 捕まえられなくても、この面に届いた移動で動く
      }
      this.stage.classList.add('is-panning');
      e.preventDefault();
    });
    this.stage.addEventListener('pointermove', (e) => {
      this.moveDrag(e);
      this.moveMarquee(e);
      if (!this.pan || e.pointerId !== this.pan.id) return;
      this.view = panBy(this.view, e.clientX - this.pan.x, e.clientY - this.pan.y);
      this.pan.x = e.clientX;
      this.pan.y = e.clientY;
      this.applyView();
      this.touchView();
    });
    this.stage.addEventListener('pointerup', (e) => {
      const p = this.pan;
      if (p && e.pointerId === p.id) {
        this.releasePan();
        // 空きを（ほとんど動かさずに）クリックした：選びを外す
        if (p.click && !pastThreshold({ dx: e.clientX - p.sx, dy: e.clientY - p.sy })) {
          if (this.linkFrom !== null) this.cancelLink();
          else this.setSelected(new Set());
        }
      }
      this.dropDrag(e);
      this.finishMarquee(e);
    });
    this.stage.addEventListener('pointercancel', (e) => {
      if (this.pan && e.pointerId === this.pan.id) this.releasePan();
      if (this.drag && e.pointerId === this.drag.pointerId) this.cancelDrag();
      if (this.marquee && e.pointerId === this.marquee.id) this.cancelDrag();
    });
    this.stage.addEventListener('lostpointercapture', (e) => {
      if (this.drag && e.pointerId === this.drag.pointerId) this.cancelDrag();
      if (this.marquee && e.pointerId === this.marquee.id) this.cancelDrag();
    });
    window.addEventListener(
      'keydown',
      (e) => {
        this.menuEsc = e.key === 'Escape' && e.target instanceof Node && !!this.menu?.isOpen && this.menu.node.contains(e.target) ? e : null;
      },
      true,
    );
    window.addEventListener(
      'pointerdown',
      (e) => {
        const inside = e.target instanceof Node && (this.root.contains(e.target) || !!this.menu?.node.contains(e.target)); // ボードの浮いたメニュー（body に出る）の中もボードのうち（M3）
        this.pointerOutside = !inside;
        // 上に出しているとき、ボードの面を押しても下の帯（欄・境目など）のフォーカスは動かないことがある。ふつうのブラウザと同じに、そのフォーカスを外す（ボードのキーを受けるため）
        if (inside && this.place === 'upper') {
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== document.body && !this.root.contains(active)) active.blur();
        }
      },
      true,
    );
    this.root.addEventListener('focusin', () => {
      this.pointerOutside = false; // Tab などでボードの中へ入ったら、ボードを使っているものとする
    });
    window.addEventListener('keydown', (e) => {
      if (this.hidden) return;
      if (!this.keysAllowed(e.target)) return; // 上に出しているとき、下のメモの帯・境目にフォーカスがあれば、ボードのキーは効かせない（C4）
      const inField = e.target instanceof Element && e.target.closest('input, textarea, select, button, [contenteditable]') !== null;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
        const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]') !== null; // ［全体］などのボタンに焦点があっても全部選ぶ
        if (typing || this.drag || this.marquee) return;
        e.preventDefault();
        this.setSelected(selectAll(this.faces.map((f) => f.id)));
        return;
      }
      // Ctrl+Z＝元に戻す／Ctrl+Shift+Z・Ctrl+Y＝やり直す（B3-3b）。文字を書く欄では、その欄の元に戻す・やり直すに任せる。Ctrl+Shift+Y は左（C++）が使う
      const zy = e.key.toLowerCase();
      if (this.cmds && (e.ctrlKey || e.metaKey) && !e.altKey && !e.isComposing && (zy === 'z' || (zy === 'y' && !e.shiftKey))) {
        const typing = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]') !== null; // ボタンに焦点があっても効く（Ctrl+A と同じ）
        if (typing || this.drag || this.marquee) return;
        e.preventDefault();
        if (!e.repeat) this.runUndo(zy === 'y' || e.shiftKey ? 'redo' : 'undo');
        return;
      }
      // Delete＝選んだカードを消す（B4-2。確認なし・Ctrl+Z で戻せる。ボタンと同じ道。押せないとき・小窓が開いているときは何もしない）
      const typingNow = e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]') !== null;
      const modal = this.composing !== null || !this.tidyBar.hidden || this.linkFrom !== null || this.templateKey !== null || this.fillOpen;
      if (this.cmds && boardKeyAction({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, isComposing: e.isComposing, repeat: e.repeat, typing: typingNow, busy: this.drag !== null || this.marquee !== null, modal }) === 'delete') {
        if (this.removeBtn.disabled || this.selected.size === 0) return;
        e.preventDefault();
        this.removeSelected();
        return;
      }
      if (e.code !== 'Space' || e.repeat || inField) return;
      this.space = true;
      this.stage.classList.add('is-space');
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.releaseSpace();
    });
    window.addEventListener('blur', () => {
      this.releaseSpace();
      this.cancelDrag();
      this.flushView();
    });
    window.addEventListener('pagehide', () => this.flushView());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushView();
    });
  }

  // ---------- 選ぶ（B2-2） ----------

  get hasSelection(): boolean {
    return this.selected.size > 0 || this.linkFrom !== null;
  }

  // 選びを外す（Esc）。外したら true
  clearSelection(): boolean {
    if (this.linkFrom !== null) {
      this.cancelLink(); // 線を引くのをやめる（選びはそのまま）
      return true;
    }
    if (this.selected.size === 0) return false;
    this.setSelected(new Set());
    return true;
  }

  private setSelected(next: Selection) {
    if (sameSelection(this.selected, next)) return;
    this.selected = next;
    this.paintSelect();
  }

  private paintSelect() {
    for (const [id, node] of this.cardEls) node.classList.toggle('is-selected', this.selected.has(id));
    this.count.textContent = selectionCountText(this.total, this.selected.size);
    this.paintLinkSource();
    this.paintTools();
    if (this.templateKey !== null && this.templateKey !== selectionKey(this.selected)) this.closeTemplate(); // 選び直したら、型の小窓は閉じる（数が変わるため）
  }

  // Shift＋空きのドラッグの始まり：いまの選択に足していく
  private startMarquee(e: PointerEvent) {
    const at = this.stagePoint(e);
    this.marquee = { id: e.pointerId, sx: at.x, sy: at.y, base: new Set(this.selected) };
    this.marqueeEl.hidden = true;
    try {
      this.stage.setPointerCapture(e.pointerId);
    } catch {
      // 捕まえられなくても、この面に届いた移動で動く
    }
    e.preventDefault();
  }

  private moveMarquee(e: PointerEvent) {
    const m = this.marquee;
    if (!m || e.pointerId !== m.id) return;
    const at = this.stagePoint(e);
    const a = { x: m.sx, y: m.sy };
    const r = marqueeRect(a, at);
    this.marqueeEl.hidden = !pastThreshold({ dx: r.w, dy: r.h });
    this.marqueeEl.style.left = `${r.x}px`;
    this.marqueeEl.style.top = `${r.y}px`;
    this.marqueeEl.style.width = `${r.w}px`;
    this.marqueeEl.style.height = `${r.h}px`;
    this.setSelected(marqueeSelection(m.base, marqueeHits(this.view, a, at, this.pos)));
  }

  private finishMarquee(e: PointerEvent) {
    const m = this.marquee;
    if (!m || e.pointerId !== m.id) return;
    this.endMarquee(false);
  }

  // 範囲選択を終える。cancel：始める前の選択に戻す
  private endMarquee(cancel: boolean) {
    const m = this.marquee;
    this.marquee = null;
    this.marqueeEl.hidden = true;
    if (!m) return;
    if (cancel) this.setSelected(m.base);
    try {
      if (this.stage.hasPointerCapture(m.id)) this.stage.releasePointerCapture(m.id);
    } catch {
      // 捕まえていなければ何もしない
    }
  }

  // ---------- カードを動かして保存（B2-1。B2-2 で選んだ全部を一緒に） ----------

  get dragging(): boolean {
    return this.drag?.moved === true || this.marquee !== null;
  }

  // 押した（まだつまんでいない）。Shift なら選びの足し外しだけ。ふつうは選んで、つまむ準備をする（動かせるかは、つまんだときに調べる）
  private pressCard(e: PointerEvent, cardEl: HTMLElement) {
    const ref = cardEl.dataset.card;
    if (!ref || !this.pos.has(ref)) return;
    if (this.linkFrom !== null) {
      // 線を引く途中：押したカードが相手（元をもう一度押すとやめる）
      e.preventDefault();
      if (ref === this.linkFrom) this.cancelLink();
      else {
        // 同じ押下のあとで、メニューの「外を押したら閉じる」が働くので、一呼吸おいて開く
        const from = this.linkFrom;
        const x = e.clientX;
        const y = e.clientY;
        window.setTimeout(() => {
          if (this.linkFrom === from) this.openKindMenu(from, ref, x, y);
        }, 0);
      }
      return;
    }
    const press = pressSelect(this.selected, ref, e.shiftKey);
    this.setSelected(press.selection);
    e.preventDefault();
    if (press.drag.length === 0) return;
    const starts = new Map<string, Pt>();
    const els: HTMLElement[] = [];
    for (const id of press.drag) {
      const at = this.pos.get(id);
      const node = this.cardEls.get(id);
      if (at && node) {
        starts.set(id, { ...at });
        els.push(node);
      }
    }
    this.drag = { pointerId: e.pointerId, ref, els, sx: e.clientX, sy: e.clientY, starts, pos: new Map(starts), moved: false, collapse: press.collapse };
    try {
      this.stage.setPointerCapture(e.pointerId);
    } catch {
      // 捕まえられなくても、この面に届いた移動で動く
    }
  }

  private moveDrag(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const delta = { dx: e.clientX - d.sx, dy: e.clientY - d.sy };
    if (!d.moved) {
      if (!pastThreshold(delta)) return;
      const blocked = moveBlockedNote(this.loaded);
      if (blocked) {
        this.flash(blocked, 'warn'); // 読めない・読み込み中：動かさない（選ぶことはできる）
        this.endDrag();
        return;
      }
      d.moved = true;
      for (const node of d.els) node.classList.add('is-dragging');
      this.stage.classList.add('is-dragging');
    }
    d.pos = groupDragPositions(d.starts, delta, this.view);
    for (const [ref, at] of d.pos) this.placeCard(ref, at);
  }

  // 描いている位置を変える（カードと、そのカードにつながる線）
  private placeCard(ref: string, pos: Pt) {
    this.pos.set(ref, pos);
    const node = this.cardEls.get(ref);
    if (node) {
      node.style.left = `${pos.x}px`;
      node.style.top = `${pos.y}px`;
    }
    for (const line of this.lineEls) {
      if (line.from !== ref && line.to !== ref) continue;
      const a = this.pos.get(line.from);
      const b = this.pos.get(line.to);
      const geom = a && b ? edgeGeometry(a, b) : null;
      line.g.style.display = geom ? '' : 'none';
      line.path.setAttribute('d', geom?.d ?? '');
      if (geom) {
        line.label.setAttribute('x', String(geom.mid.x));
        line.label.setAttribute('y', String(geom.mid.y));
      }
    }
  }

  private endDrag() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    for (const node of d.els) node.classList.remove('is-dragging');
    this.stage.classList.remove('is-dragging');
    try {
      if (this.stage.hasPointerCapture(d.pointerId)) this.stage.releasePointerCapture(d.pointerId);
    } catch {
      // 捕まえていなければ何もしない
    }
  }

  // 離した：つまんで動かしていたら、動かした全部を 1 回で保存する。押しただけなら何もしない（複数を選んだ中の 1 枚をただクリックしたら、その 1 枚だけの選択にする）
  private dropDrag(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.endDrag();
    if (d.moved) {
      const moves = [...d.pos].map(([ref, at]) => ({ ref, x: at.x, y: at.y }));
      const memoId = this.memoId;
      this.commitMove(moves, (ok) => {
        if (ok && memoId !== null && this.memoId === memoId) this.recordMove(moves, d.starts);
      });
      return;
    }
    if (d.collapse) this.setSelected(new Set([d.ref]));
    if (this.dirty) this.render();
  }

  // やめる（Esc・pointercancel・blur・隠れた・メモが替わった）：つまんでいたカードを元の位置に戻し、範囲選択は始める前の選択に戻す。何も保存しない。何かをやめたら true
  cancelDrag(): boolean {
    let did = false;
    if (this.marquee) {
      this.endMarquee(true);
      did = true;
    }
    const d = this.drag;
    if (d) {
      if (d.moved) for (const [ref, at] of d.starts) this.placeCard(ref, at);
      this.endDrag();
      if (this.dirty) this.render();
      did = did || d.moved;
    }
    return did;
  }

  // after（B3-3b）：保存の結果を知らせる（保存できた・もう同じ位置だった＝true／できなかった・動かせなかった＝false）。必ず 1 回だけ呼ぶ。元に戻す・やり直しの記録に使う
  private commitMove(moves: { ref: string; x: number; y: number }[], after?: (ok: boolean) => void) {
    const memoId = this.memoId;
    const snap = this.source?.get() ?? null;
    if (!memoId || !snap || snap.memoId !== memoId) {
      this.render();
      after?.(false);
      return;
    }
    const first = planMoves(this.loaded, snap.replies, moves, Date.now());
    if (!first.ok) {
      if (first.why === 'blocked') this.flash(moveBlockedNote(this.loaded) ?? 'カードを動かせませんでした', 'warn');
      this.render();
      after?.(false);
      return;
    }
    if (!first.changed) {
      this.render(); // 同じ場所に戻した：保存しない
      after?.(true);
      return;
    }
    const token = ++this.seq;
    for (const m of moves) this.pending.set(m.ref, { x: m.x, y: m.y, seq: token }); // 保存が終わるまで、動かした位置のまま見せる
    this.render();
    const replies = snap.replies; // 保存を待つ間にメモが替わっても、このメモの分として保存する
    this.enqueue(async () => {
      let ok = false;
      try {
        const base = this.known.get(memoId);
        const plan = planMoves(base ?? null, replies, moves, Date.now());
        if (!base || !plan.ok) {
          if (this.memoId === memoId) this.flash(boardSaveMessage('unreadable'), 'warn');
          return;
        }
        if (!plan.changed) {
          ok = true;
          return;
        }
        const result = await saveBoard(boardPaneIo, base, plan.board);
        this.settle(memoId, result);
        ok = result.ok;
        const note = moveResultNote(result);
        if (this.memoId === memoId) this.flash(note.text, note.tone);
      } catch {
        if (this.memoId === memoId) this.flash(boardSaveMessage('write'), 'warn');
      } finally {
        for (const m of moves) if (this.pending.get(m.ref)?.seq === token) this.pending.delete(m.ref);
        if (this.memoId === memoId) this.render(); // 失敗したときは、ここで元の位置に戻る
        after?.(ok);
      }
    });
  }

  // 面の上の一言（保存した・できなかった・動かせない）。しばらくして消える
  private flash(text: string, tone: 'info' | 'warn') {
    window.clearTimeout(this.statusTimer);
    this.status.textContent = text;
    this.status.dataset.tone = tone;
    this.status.hidden = text === '';
    this.statusTimer = window.setTimeout(() => this.clearFlash(), STATUS_MS);
  }

  private clearFlash() {
    window.clearTimeout(this.statusTimer);
    this.status.textContent = '';
    this.status.hidden = true;
  }
  // ---------- ボードでの編集（B2-3b）：足す・消す・書き直す・タグ・線 ----------

  private ask(action: RelayCommand) {
    this.cmds?.ask(action);
  }

  private buildTools() {
    const buttons: [HTMLButtonElement, () => void][] = [
      [this.undoBtn, () => this.runUndo('undo')],
      [this.redoBtn, () => this.runUndo('redo')],
      [this.addBtn, () => this.openCompose({ kind: 'add' }, '')],
      [this.editBtn, () => this.startEdit()],
      [this.removeBtn, () => this.removeSelected()],
      [this.linkAddBtn, () => this.startLink()],
      [this.linkRemoveBtn, () => this.openRemoveLinks()],
      [this.templateBtn, () => this.openTemplate()],
      [this.pasteBtn, () => void this.openPasteMenu()],
      [this.tidyBtn, () => this.openTidy()],
    ];
    for (const [btn, run] of buttons) {
      btn.type = 'button';
      btn.addEventListener('click', run);
      this.tools.append(btn);
    }
    this.tools.setAttribute('role', 'toolbar');
    this.tools.setAttribute('aria-label', 'カードの編集');
    this.tools.hidden = true;
    this.tagRow.hidden = true;

    this.composeText.rows = 3;
    this.composeText.maxLength = 2000;
    this.composeText.setAttribute('aria-label', 'カードの文');
    const ok = el('button', 'memo-board-tool is-primary', '決める');
    ok.type = 'submit';
    const cancel = el('button', 'memo-board-tool', 'やめる');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.closeCompose());
    const actions = el('div', 'memo-board-compose-actions');
    actions.append(ok, cancel, el('span', 'memo-board-compose-hint', 'Ctrl+Enter でも決められます'));
    this.compose.append(this.composeLabel, this.composeText, actions);
    this.compose.hidden = true;
    this.compose.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitCompose();
    });
    this.composeText.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // 欄の Esc は、この小窓を閉じるだけ（メモへ戻らない）
        this.closeCompose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.submitCompose();
      }
    });

    const cancelLink = el('button', 'memo-board-tool', 'やめる');
    cancelLink.type = 'button';
    cancelLink.addEventListener('click', () => this.cancelLink());
    this.linkBar.setAttribute('role', 'status');
    this.linkBar.append(this.linkBarText, cancelLink);
    this.linkBar.hidden = true;

    const tidyOk = el('button', 'memo-board-tool is-primary', '決める');
    tidyOk.type = 'button';
    tidyOk.addEventListener('click', () => this.runTidy());
    const tidyCancel = el('button', 'memo-board-tool', 'やめる');
    tidyCancel.type = 'button';
    tidyCancel.addEventListener('click', () => this.closeTidy(true));
    this.tidyOk = tidyOk;
    this.tidyBar.setAttribute('role', 'alertdialog');
    this.tidyBar.setAttribute('aria-label', '消したカードの位置の整理');
    this.tidyBar.append(this.tidyText, tidyOk, tidyCancel);
    this.tidyBar.hidden = true;
    this.tidyBar.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // 確認の Esc は、この確認を閉じるだけ（メモへ戻らない）
        this.closeTidy(true);
      }
    });
  }

  // ---------- 消えたカードの位置の整理（B4-1） ----------

  private openTidy() {
    const snap = this.source?.get() ?? null;
    if (!snap) return;
    const tb = tidyButton({ load: this.loaded, replies: snap.replies, busy: this.undoBusy });
    if (!tb.enabled) {
      this.flash(tb.count === 0 && this.loaded !== null && this.loaded.state !== 'unreadable' ? TIDY_NONE_NOTE : tb.note, 'warn');
      return;
    }
    this.cancelLink();
    this.closeCompose();
    if (this.fillOpen) this.closeTemplate();
    this.tidyText.textContent = tidyConfirmMessage(tb.count, this.undo.has(['remove', 'paste']));
    this.tidyBar.hidden = false;
    this.tidyOk?.focus();
  }

  private closeTidy(focusBack: boolean) {
    const was = !this.tidyBar.hidden;
    this.tidyBar.hidden = true;
    if (was && focusBack && !this.tidyBtn.disabled) this.tidyBtn.focus();
  }

  // 決めたとき：保存の直前の台帳で孤児を数え直し、孤児だけを落として 1 回保存する（積みには入れない・追加の控えは作らない）
  private runTidy() {
    const memoId = this.memoId;
    this.closeTidy(false);
    if (!memoId) return;
    this.enqueue(async () => {
      try {
        const snap = this.source?.get() ?? null;
        const base = this.known.get(memoId);
        if (!snap || snap.memoId !== memoId) return;
        const plan = planTidy(base ?? null, snap.replies, Date.now());
        if (!plan.ok) {
          if (this.memoId === memoId) this.flash(plan.why === 'none' ? TIDY_NONE_NOTE : tidyButton({ load: base ?? null, replies: snap.replies }).note, 'warn');
          return;
        }
        const result = await saveBoard(boardPaneIo, base as LoadBoardResult, plan.board);
        this.settle(memoId, result);
        if (this.memoId === memoId) this.flash(result.ok ? tidyDoneText(plan.removed) : boardSaveMessage(result.why), result.ok ? 'info' : 'warn');
      } catch {
        if (this.memoId === memoId) this.flash(boardSaveMessage('write'), 'warn');
      } finally {
        if (this.memoId === memoId) this.render();
      }
    });
  }
  // 選びと台帳に合わせて、道具の列・タグの行を描く（選びが変わった・写しが変わった・読み込みが終わったとき）
  private paintTools() {
    this.named(() => this.paintToolsBoard());
  }

  private paintToolsBoard() {
    const snap = this.source?.get() ?? null;
    const on = !!this.cmds && snap !== null && !this.hidden;
    this.tools.hidden = !on;
    if (!on || !snap) {
      this.orphanEl.hidden = true;
      this.closeTidy(false);
      this.tagRow.hidden = true;
      return;
    }
    const st = toolState({ selected: [...this.selected], replies: snap.replies, load: this.loaded });
    const set = (btn: HTMLButtonElement, b: { enabled: boolean; note: string }) => {
      btn.disabled = !b.enabled;
      btn.title = b.note;
      btn.setAttribute('aria-label', `${btn.textContent ?? ''}。${b.note}`);
    };
    this.removeBtn.textContent = st.remove.label;
    set(this.addBtn, st.add);
    set(this.editBtn, st.edit);
    set(this.removeBtn, st.remove);
    this.removeBtn.setAttribute('aria-keyshortcuts', KEYSHORTCUTS.remove);
    this.undoBtn.setAttribute('aria-keyshortcuts', KEYSHORTCUTS.undo);
    this.redoBtn.setAttribute('aria-keyshortcuts', KEYSHORTCUTS.redo);
    set(this.linkAddBtn, st.linkAdd);
    set(this.linkRemoveBtn, st.linkRemove);
    set(this.templateBtn, st.template);
    set(this.pasteBtn, st.paste);
    this.pasteBtn.setAttribute('aria-haspopup', 'menu');
    const ub = undoButtons({ undo: this.undo.peekUndo(), redo: this.undo.peekRedo(), busy: this.undoBusy, load: this.loaded });
    set(this.undoBtn, ub.undo);
    set(this.redoBtn, ub.redo);
    const tb = tidyButton({ load: this.loaded, replies: snap.replies, busy: this.undoBusy });
    set(this.tidyBtn, tb);
    this.orphanEl.textContent = orphanNoteText(tb.count);
    this.orphanEl.hidden = tb.count === 0;
    if (!this.tidyBar.hidden) {
      if (tb.count === 0) this.closeTidy(false); // 整理するものが無くなった（戻した・もう整理した）
      else this.tidyText.textContent = tidyConfirmMessage(tb.count, this.undo.has(['remove', 'paste']));
    }
    this.paintTagRow(snap.replies, st.tags);
  }

  // タグの行：選んだカードに付いているタグ（× で外す）と「＋タグ」。既存のタグの欄（tagArea）をそのまま使う。選んだ全部に付け外しが効く
  private paintTagRow(replies: readonly Reply[], show: boolean) {
    this.tagRow.hidden = !show;
    if (!show) {
      this.tagKey = '';
      this.tagRow.replaceChildren();
      return;
    }
    const ids = liveSelection(replies, [...this.selected]);
    const tags = unionTags(replies, ids);
    const key = JSON.stringify([ids, tags]);
    if (key === this.tagKey) return; // 同じなら描き直さない（書いている最中の欄を壊さない）
    this.tagKey = key;
    const area = tagArea(
      {
        tags,
        what: ids.length > 1 ? `選んだ ${ids.length} 枚のカード` : 'このカード',
        change: (add, remove) => this.changeTags(ids, add, remove),
      },
      { editable: true, focusKey: 'board:', toast: (text) => this.flash(text, 'warn'), candidates: cardTagCandidates(replies, [], registeredTagNames()) },
    );
    this.tagRow.replaceChildren(el('span', 'memo-board-tagrow-label', 'タグ'), area);
  }

  // 送った命令の結果が、左の写しに現れるのを待つ（100 ミリ秒おきに見る）。memo が替わったら false で終える
  private watch(memoId: string, seen: (replies: readonly Reply[]) => boolean, done: (ok: boolean) => void, ms = WATCH_MS) {
    const t0 = Date.now();
    const tick = () => {
      const snap = this.source?.get() ?? null;
      if (!snap || snap.memoId !== memoId) return done(false);
      if (seen(snap.replies)) return done(true);
      if (Date.now() - t0 >= ms) return done(false);
      window.setTimeout(tick, 100);
    };
    tick();
  }

  // 左の知らせ（断られた理由）がいま出ていれば、こちらの一言で隠さない
  private quietAfterNotice(): boolean {
    return Date.now() - this.noticeAt < WATCH_MS + 500;
  }

  // ---- 足す・書き直す（小窓） ----

  private openCompose(mode: { kind: 'add' } | { kind: 'edit'; id: string }, text: string) {
    const snap = this.source?.get() ?? null;
    if (!snap) return;
    if (mode.kind === 'add') {
      const blocked = addBlockedNote(this.loaded, snap.replies);
      if (blocked) {
        this.flash(blocked, 'warn');
        return;
      }
    }
    this.cancelLink();
    this.composing = mode;
    this.composeLabel.textContent = mode.kind === 'add' ? '新しいカードの文（見ている場所の真ん中に足します）' : 'カードの文を書き直す';
    this.composeText.value = text;
    this.compose.hidden = false;
    this.composeText.focus();
  }

  private closeCompose() {
    this.composing = null;
    this.compose.hidden = true;
    this.composeText.value = '';
  }

  private submitCompose() {
    const mode = this.composing;
    if (!mode) return;
    const text = this.composeText.value;
    if (mode.kind === 'add') this.submitAdd(text);
    else this.submitEdit(mode.id, text);
  }

  // カードを足す：id を先に決めて命令に入れる（B2-3a）。左の写しにそのカードが現れてから、座標を保存する（断られたら何も書かない）
  private submitAdd(text: string) {
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    if (!snap || !memoId || snap.memoId !== memoId) return;
    const blocked = addBlockedNote(this.loaded, snap.replies);
    if (blocked) {
      this.flash(blocked, 'warn');
      return;
    }
    const id = makeReplyId(snap.replies);
    const cmd = id ? addCommand(memoId, id, text) : null;
    if (!id || !cmd) {
      this.flash(id ? '文が空です' : 'カードの id を決められませんでした。もう一度お試しください', 'warn');
      return;
    }
    const spot = spotForNewCard(this.view, this.viewport(), [...this.pos.values()]);
    if (!spot) {
      this.flash('置ける空きが見つかりませんでした（見ている場所を動かしてからお試しください）', 'warn');
      return;
    }
    this.closeCompose();
    const token = ++this.seq;
    this.pending.set(id, { x: spot.x, y: spot.y, seq: token }); // 現れたときに、仮の位置を経ず置く場所に出す
    this.ask(cmd);
    this.watch(memoId, (rs) => cardAppeared(rs, id), (ok) => {
      if (!ok) {
        if (this.pending.get(id)?.seq === token) this.pending.delete(id);
        if (this.memoId === memoId) {
          if (!this.quietAfterNotice()) this.flash('カードを足せませんでした（左が断ったか、時間がかかっています。足せていなければ、もう一度お試しください）', 'warn');
          this.render();
        }
        return;
      }
      this.setSelected(new Set([id]));
      const replies = this.source?.get()?.replies ?? [];
      this.pushUndo({ kind: 'add', id, text: replies.find((r) => r.id === id)?.text ?? text, at: { x: spot.x, y: spot.y } });
      this.enqueue(async () => {
        try {
          const base = this.known.get(memoId);
          const plan = planMoves(base ?? null, replies, [{ ref: id, x: spot.x, y: spot.y }], Date.now());
          if (!base || !plan.ok) {
            if (this.memoId === memoId) this.flash('カードは足しましたが、位置は保存できませんでした', 'warn');
            return;
          }
          const result = await saveBoard(boardPaneIo, base, plan.board);
          this.settle(memoId, result);
          const note = moveResultNote(result);
          if (this.memoId === memoId) this.flash(result.ok ? 'カードを足しました' : `カードは足しましたが、${note.text}`, result.ok ? 'info' : 'warn');
        } catch {
          if (this.memoId === memoId) this.flash('カードは足しましたが、位置は保存できませんでした', 'warn');
        } finally {
          if (this.pending.get(id)?.seq === token) this.pending.delete(id);
          if (this.memoId === memoId) this.render();
        }
      });
    });
  }

  private startEdit() {
    const snap = this.source?.get() ?? null;
    if (!snap) return;
    const check = editCheck(snap.replies, [...this.selected]);
    if (!check.ok) {
      this.flash(check.note, 'warn');
      return;
    }
    this.openCompose({ kind: 'edit', id: check.reply.id }, check.reply.text);
  }

  private submitEdit(id: string, text: string) {
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    const reply = snap?.replies.find((r) => r.id === id && r.parent === null);
    if (!snap || !memoId || !reply) {
      this.closeCompose();
      this.flash('カードがもうありません', 'warn');
      return;
    }
    const made = editCommand(memoId, reply, text);
    if (!made.ok) {
      this.flash(made.note, 'warn');
      return;
    }
    this.closeCompose();
    this.ask(made.command);
    this.watch(memoId, (rs) => cardTextIs(rs, id, text), (ok) => {
      if (this.memoId !== memoId) return;
      if (ok) this.flash('書き直しました', 'info');
      else if (!this.quietAfterNotice()) this.flash('書き直せませんでした', 'warn');
    });
  }

  // ---- 消す（確認なし。B3-3 の Undo まで戻せない。ボード上の位置は孤児として残る） ----

  private removeSelected() {
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    if (!snap || !memoId) return;
    const ids = liveSelection(snap.replies, [...this.selected]);
    if (ids.length === 0) return;
    this.cancelLink();
    const token = newUndoToken(); // 操作ごとに新しい印（B3-3b）。何枚でも同じ印を付け、左が 1 件にまとめて控える
    const at: Record<string, { x: number; y: number }> = {};
    for (const id of ids) {
      const p = this.pos.get(id);
      if (p) at[id] = { x: p.x, y: p.y };
    }
    for (const cmd of deleteCommands(memoId, snap.replies, ids, token)) this.ask(cmd);
    this.setSelected(new Set());
    this.watch(memoId, (rs) => cardsGone(rs, ids), (ok) => {
      if (this.memoId !== memoId) return;
      const gone = ids.filter((id) => cardsGone(this.source?.get()?.replies ?? [], [id]));
      if (gone.length > 0) this.pushUndo({ kind: 'remove', ids: gone, at, token });
      if (ok) this.flash(ids.length > 1 ? `${ids.length}枚を削除しました（Ctrl+Z で戻せます）` : '削除しました（Ctrl+Z で戻せます）', 'info');
      else if (!this.quietAfterNotice()) this.flash('消せなかったカードがあります', 'warn');
    });
  }

  // ---- タグ（選んだ全部に） ----

  private changeTags(ids: readonly string[], add: string[], remove: string[]) {
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    if (!snap || !memoId) return;
    const cmds = tagCommands(memoId, snap.replies, ids, add, remove);
    if (cmds.length === 0) return;
    const full = add.reduce((n, tag) => Math.max(n, tagFullCount(snap.replies, ids, tag, MAX_TAGS_PER_TAB)), 0);
    if (full > 0) this.flash(`タグは 1 つに ${MAX_TAGS_PER_TAB} 個までです（${full} 枚には付けられません。ほかのタグを外してから付けてください）`, 'warn');
    for (const cmd of cmds) this.ask(cmd);
    if (full > 0) return;
    this.watch(
      memoId,
      (rs) => ids.every((id) => {
        const tags = rs.find((r) => r.id === id)?.tags ?? [];
        return add.every((t) => tags.includes(t)) && remove.every((t) => !tags.includes(t));
      }),
      (ok) => {
        if (this.memoId !== memoId) return;
        if (ok) this.flash('タグを変えました', 'info');
        else if (!this.quietAfterNotice()) this.flash('タグを変えられませんでした', 'warn');
      },
    );
  }

  // ---- 線（1 枚を選んで足す・外す） ----

  private startLink() {
    const snap = this.source?.get() ?? null;
    if (!snap) return;
    const ids = liveSelection(snap.replies, [...this.selected]);
    if (ids.length !== 1) {
      this.flash(ids.length === 0 ? '先にカードを 1 枚選んでください' : '1 枚だけ選んでください', 'warn');
      return;
    }
    this.closeCompose();
    const from = snap.replies.find((r) => r.id === ids[0]);
    if (!from) return;
    this.linkFrom = ids[0];
    this.linkBarText.textContent = `「${cardLabel(from, 16)}」の相手のカードを押してください（Esc でやめる）`;
    this.linkBar.hidden = false;
    this.stage.classList.add('is-linking');
    this.paintLinkSource();
  }

  private cancelLink() {
    if (this.linkFrom === null) return;
    this.linkFrom = null;
    this.linkBar.hidden = true;
    this.stage.classList.remove('is-linking');
    this.menu?.close();
    this.paintLinkSource();
  }

  private paintLinkSource() {
    for (const [id, node] of this.cardEls) node.classList.toggle('is-link-source', id === this.linkFrom);
  }

  private getMenu(): CellMenu {
    this.menu ??= new CellMenu();
    return this.menu;
  }

  // 相手のカードを押したとき：6 つの種類から選ぶ（今の種類・逆向きの「同じ」は既存の画面と同じ扱い）
  private openKindMenu(from: string, to: string, x: number, y: number) {
    this.named(() => this.openKindMenuBoard(from, to, x, y));
  }

  private openKindMenuBoard(from: string, to: string, x: number, y: number) {
    const snap = this.source?.get() ?? null;
    const choices = snap ? kindChoices(snap.replies, from, to) : null;
    const a = snap?.replies.find((r) => r.id === from);
    const b = snap?.replies.find((r) => r.id === to);
    if (!snap || !choices || !a || !b) {
      this.flash('そのカードとは結べません', 'warn');
      return;
    }
    const entries: MenuEntry[] = [{ section: `「${cardLabel(a, 12)}」は「${cardLabel(b, 12)}」の…` }];
    for (const c of choices) entries.push({ label: c.name, hint: c.hint, disabled: c.disabled, run: () => this.chooseKind(from, to, c.kind) });
    entries.push('sep', { label: 'やめる', run: () => this.cancelLink() });
    this.getMenu().open(x, y, entries);
    this.getMenu().focusFirst();
  }

  private chooseKind(from: string, to: string, kind: LinkKind) {
    this.named(() => this.chooseKindBoard(from, to, kind));
  }

  private chooseKindBoard(from: string, to: string, kind: LinkKind) {
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    if (!snap || !memoId) return;
    const plan = linkAddPlan(snap.replies, memoId, from, to, kind);
    if (!plan.ok) {
      this.flash(plan.note, 'warn');
      this.cancelLink();
      return;
    }
    const before = linkKindOf(snap.replies, from, to); // 同じ相手に別の種類がもうあれば、元に戻すときはその種類へ
    this.ask(plan.command);
    this.cancelLink();
    const name = linkKindInfo(kind).name;
    this.watch(memoId, (rs) => linkIs(rs, from, to, kind), (ok) => {
      if (this.memoId !== memoId) return;
      if (ok) this.pushUndo({ kind: 'link', from, to, before, after: kind });
      if (ok) this.flash(`関連「${name}」を付けました`, 'info');
      else if (!this.quietAfterNotice()) this.flash('関連を付けられませんでした', 'warn');
    });
  }

  // 選んだカードにつながる線の一覧から、外す線を選ぶ
  private openRemoveLinks() {
    this.named(() => this.openRemoveLinksBoard());
  }

  private openRemoveLinksBoard() {
    const snap = this.source?.get() ?? null;
    if (!snap) return;
    const ids = liveSelection(snap.replies, [...this.selected]);
    if (ids.length !== 1) return;
    const self = ids[0];
    const rels = relationsOf(snap.replies, self);
    if (rels.length === 0) {
      this.flash('このカードにつながる線はありません', 'info');
      return;
    }
    const at = this.linkRemoveBtn.getBoundingClientRect();
    const entries: MenuEntry[] = [{ section: 'どの線を外しますか' }];
    for (const rel of rels) entries.push({ label: rel.sentence, run: () => this.removeLink(self, rel) });
    entries.push('sep', { label: 'やめる', run: () => undefined });
    this.getMenu().open(at.left, at.bottom + 2, entries);
    this.getMenu().focusFirst();
  }

  // ---- 型にする（登録の小窓は下の区画のものを借りる。ここは選んだカードと、ボードの座標の差を渡す） ----

  private openTemplate() {
    const snap = this.source?.get() ?? null;
    const hook = this.cmds?.template;
    if (!snap || !hook) return;
    const ids = liveSelection(snap.replies, [...this.selected]);
    const blocked = templateBlockedNote(ids.length);
    if (blocked) {
      this.flash(blocked, 'warn');
      return;
    }
    this.cancelLink();
    this.closeCompose();
    if (this.fillOpen) this.closeTemplate(); // 空欄の小窓が開いていれば閉じる（小窓が重ならないように）
    const offsets = templateOffsets(ids, this.pos); // 位置の分からないカードがあれば null：下の区画が番地から作る
    this.templateKey = selectionKey(this.selected);
    hook.open(ids, offsets ?? {}, this.tools);
  }

  private closeTemplate() {
    if (this.templateKey === null && !this.fillOpen) return;
    this.templateKey = null;
    this.fillOpen = false;
    this.pasteSeq += 1; // 読み込み中の型の一覧は出さない
    this.cmds?.template?.close();
  }

  // ---- 型を貼る（B3-2b）：型の一覧 → （穴あきなら空欄の小窓）→ 見ている面の真ん中へ一発で貼る ----

  private async openPasteMenu() {
    const snap = this.source?.get() ?? null;
    const hook = this.cmds?.template;
    const memoId = this.memoId;
    if (!snap || !hook || !memoId) return;
    const blocked = pasteToolNote(this.loaded, snap.replies);
    if (blocked) {
      this.flash(blocked, 'warn');
      return;
    }
    this.cancelLink();
    this.closeCompose();
    this.closeTemplate();
    const seq = ++this.pasteSeq;
    const loaded = await hook.list().catch(() => null);
    if (seq !== this.pasteSeq || this.hidden || this.memoId !== memoId) return;
    if (!loaded || loaded.state === 'unreadable') {
      this.flash('型の保存ファイルを読めませんでした（ファイルは変えていません）', 'warn');
      return;
    }
    const replies = this.source?.get()?.replies ?? snap.replies;
    const entries: MenuEntry[] = [{ section: '貼る型を選んでください（見ている場所の真ん中に貼ります）' }];
    if (loaded.templates.length === 0) entries.push({ note: loaded.skipped > 0 ? `読める型がありません（読めない型が ${loaded.skipped} 件あります）` : TEMPLATE_EMPTY_HINT });
    for (const group of templateMenuGroups(loaded.templates)) {
      entries.push({ section: group.folder });
      for (const t of group.items) {
        const full = pasteBlocked(replies.length, t.cards.length);
        entries.push({ label: templateMenuLabel(t), hint: full ? '入りきりません' : undefined, disabled: full !== null, run: () => this.startPaste(t) });
      }
    }
    if (loaded.templates.length > 0 && loaded.skipped > 0) entries.push({ note: `読めない型が ${loaded.skipped} 件あります（出していません）` });
    entries.push('sep', { label: 'やめる', run: () => undefined });
    const at = this.pasteBtn.getBoundingClientRect();
    this.getMenu().open(at.left, at.bottom + 2, entries);
    this.getMenu().focusFirst();
  }

  // 型を選んだ：穴あきなら空欄の小窓（下の区画のもの）を出して、埋めてから。そうでなければそのまま貼る
  private startPaste(t: CardTemplate) {
    const hook = this.cmds?.template;
    if (t.mode === 'hole' && extractHoles(t).length > 0 && hook) {
      this.fillOpen = true;
      hook.fill(t, this.tools, (filled, notes) => {
        this.fillOpen = false;
        this.pasteOnBoard(filled, notes);
      });
      return;
    }
    this.pasteOnBoard(t, []);
  }

  // 貼る：id を先に決めて命令に入れる（B3-2a）。左の写しに全部のカードが現れてから、座標を保存する（断られたら何も書かず、孤児を作らない）
  private pasteOnBoard(template: CardTemplate, notes: string[]) {
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    if (!snap || !memoId || snap.memoId !== memoId || this.hidden) return;
    const plan = planBoardPaste({ memoId, template, replies: snap.replies, load: this.loaded, view: this.view, viewport: this.viewport(), taken: [...this.pos.values()] });
    if (!plan.ok) {
      this.flash(plan.note, 'warn');
      return;
    }
    const { ids, moves } = plan;
    const doneText = pasteDoneText(plan.template.name, ids.length) + (notes.length > 0 ? `。${notes.join('。')}` : '');
    this.cancelLink();
    this.closeCompose();
    const token = ++this.seq;
    for (const m of moves) this.pending.set(m.ref, { x: m.x, y: m.y, seq: token }); // 現れたときに、仮の位置を経ず置く場所に出す
    const clearPending = () => {
      for (const m of moves) if (this.pending.get(m.ref)?.seq === token) this.pending.delete(m.ref);
    };
    const askedAt = Date.now();
    this.ask(plan.command);
    this.watch(memoId, (rs) => pastedAppeared(rs, ids), (ok) => {
      if (!ok) {
        clearPending();
        if (this.memoId === memoId) {
          if (!this.quietAfterNotice()) this.flash('型を貼れませんでした（左が断ったか、時間がかかっています。貼れていなければ、もう一度お試しください）', 'warn');
          this.render();
        }
        return;
      }
      this.setSelected(new Set(ids)); // 貼ったカードは全部選ぶ
      const replies = this.source?.get()?.replies ?? [];
      this.pushPaste(memoId, plan.template, ids, moves, askedAt);
      this.enqueue(async () => {
        try {
          const base = this.known.get(memoId);
          const saved = planMoves(base ?? null, replies, moves, Date.now());
          if (!base || !saved.ok) {
            if (this.memoId === memoId) this.flash('型は貼りましたが、位置は保存できませんでした', 'warn');
            return;
          }
          const result = await saveBoard(boardPaneIo, base, saved.board);
          this.settle(memoId, result);
          const note = moveResultNote(result);
          if (this.memoId === memoId) this.flash(result.ok ? doneText : `型は貼りましたが、${note.text}`, result.ok ? 'info' : 'warn');
        } catch {
          if (this.memoId === memoId) this.flash('型は貼りましたが、位置は保存できませんでした', 'warn');
        } finally {
          clearPending();
          if (this.memoId === memoId) this.render();
        }
      });
    });
  }

  private removeLink(self: string, rel: Relation) {
    const memoId = this.memoId;
    if (!memoId) return;
    this.ask(linkRemoveCommand(memoId, rel, self));
    const to = rel.outgoing ? rel.other : self;
    this.watch(memoId, (rs) => !linkIs(rs, rel.source, to, rel.kind), (ok) => {
      if (this.memoId !== memoId) return;
      if (ok) this.pushUndo({ kind: 'link', from: rel.source, to, before: rel.kind, after: null });
      if (ok) this.flash('関連を外しました', 'info');
      else if (!this.quietAfterNotice()) this.flash('関連を外せませんでした', 'warn');
    });
  }
  // ---------- 元に戻す・やり直す（B3-3b） ----------

  private resetUndo() {
    this.undo.clear();
    this.awaitingPaste = null;
    this.lastSend = null;
    this.paintTools();
  }

  private pushUndo(op: UndoOp) {
    this.undo.push(op);
    this.paintTools();
  }

  // つまんで動かして保存できた：動いたカードだけを記録する（元の位置が同じなら記録しない）
  private recordMove(moves: readonly NodeMove[], starts: ReadonlyMap<string, Pt>) {
    const items: { ref: string; from: Pt; to: Pt }[] = [];
    for (const m of moves) {
      const from = starts.get(m.ref);
      if (from && (from.x !== m.x || from.y !== m.y)) items.push({ ref: m.ref, from: { x: from.x, y: from.y }, to: { x: m.x, y: m.y } });
    }
    if (items.length > 0) this.pushUndo({ kind: 'move', moves: items });
  }

  // 型を貼った：Undo は undoSendReplies（左が返す印が要る）。印が先に届いていればそれを、まだなら届いたときに付ける
  private pushPaste(memoId: string, template: CardTemplate, ids: readonly string[], moves: readonly NodeMove[], askedAt: number) {
    const op: Extract<UndoOp, { kind: 'paste' }> = { kind: 'paste', template, ids: [...ids], at: moves.map((m) => ({ x: m.x, y: m.y })), token: null };
    this.trackSendToken(op, memoId, askedAt);
    this.pushUndo(op);
  }

  private trackSendToken(op: Extract<UndoOp, { kind: 'paste' }>, memoId: string, askedAt: number) {
    const got = this.lastSend && this.lastSend.at >= askedAt && this.lastSend.openMemo === memoId ? this.lastSend.token : null;
    op.token = got;
    if (got !== null) this.lastSend = null;
    this.awaitingPaste = got === null ? op : null;
  }

  private noteUndoSend(token: string, openMemo: string) {
    this.lastSend = { token, openMemo, at: Date.now() };
    const waiting = this.awaitingPaste;
    if (waiting && openMemo === this.memoId) {
      waiting.token = token;
      this.awaitingPaste = null;
      this.lastSend = null;
    }
  }

  // 戻した・やり直したカードが台帳に現れたあと、座標を保存の列に積む（B2-3b・B3-2b と同じ道）。pending は現れる前に置いてある（token の分）
  private savePlaced(memoId: string, moves: readonly NodeMove[], token: number, okText: string, failText: string) {
    const replies = this.source?.get()?.replies ?? [];
    this.enqueue(async () => {
      try {
        const base = this.known.get(memoId);
        const saved = planMoves(base ?? null, replies, moves, Date.now());
        if (!base || !saved.ok) {
          if (this.memoId === memoId) this.flash(failText, 'warn');
          return;
        }
        const result = await saveBoard(boardPaneIo, base, saved.board);
        this.settle(memoId, result);
        const note = moveResultNote(result);
        if (this.memoId === memoId) this.flash(result.ok ? okText : `${failText}（${note.text}）`, result.ok ? 'info' : 'warn');
      } catch {
        if (this.memoId === memoId) this.flash(failText, 'warn');
      } finally {
        for (const m of moves) if (this.pending.get(m.ref)?.seq === token) this.pending.delete(m.ref);
        if (this.memoId === memoId) this.render();
      }
    });
  }

  // Ctrl+Z・Ctrl+Shift+Z・Ctrl+Y・ボタン。1 つずつ（戻している最中は受けない）。戻せなかったら一言出して、その 1 件だけ積みから外す（そのあとのメモの変わり方では戻せない）
  private runUndo(dir: UndoDir) {
    if (this.undoBusy || this.hidden) return;
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    if (!snap || !memoId || snap.memoId !== memoId) return;
    const blocked = undoBlockedNote(this.loaded);
    if (blocked) {
      this.flash(blocked, 'warn');
      return;
    }
    const op = this.undo.take(dir);
    if (!op) {
      this.flash(dir === 'undo' ? '戻せる操作がありません' : 'やり直せる操作がありません', 'info');
      return;
    }
    this.cancelLink();
    const version = this.undo.version;
    this.undoBusy = true;
    this.paintTools();
    // result：ok＝積みの反対側へ（next があればそれを）。text＝一言（null なら出さない。保存が終わってから別に出す）。quiet＝失敗の一言は別で出した
    let settled = false;
    const finish = (res: { ok: true; next?: UndoOp; text?: string | null } | { ok: false; quiet?: boolean; note?: string }) => {
      if (settled) return; // 左の断りで先に終えたあとに、写しを待つ側が終わっても二重にしない
      settled = true;
      this.undoAbort = null;
      this.undoBusy = false;
      if (this.memoId !== memoId) {
        this.paintTools();
        return;
      }
      if (res.ok) {
        const next = res.next ?? op;
        this.undo.finish(dir, next, version);
        const text = res.text === undefined ? undoDoneText(op, dir) : res.text;
        if (text !== null) this.flash(text, 'info');
      } else if (!res.quiet) this.flash(res.note ?? (dir === 'undo' ? UNDO_STALE_NOTE : REDO_STALE_NOTE), 'warn');
      this.paintTools();
    };
    this.undoAbort = (text) => finish({ ok: false, note: text.includes('そのあとにメモが変わっています') ? undefined : '戻せませんでした（左が断りました。取り消しの控えが残っていないかもしれません）' });
    const replies = snap.replies;
    switch (op.kind) {
      case 'move': {
        const moves = moveTargets(op, dir, replies);
        if (moves.length === 0) return finish({ ok: false });
        this.commitMove(moves, (ok) => {
          if (ok) this.setSelected(new Set(moves.map((m) => m.ref)));
          finish(ok ? { ok: true } : { ok: false, quiet: true }); // 保存できなかった理由は commitMove が出している
        });
        return;
      }
      case 'add': {
        if (dir === 'undo') {
          if (!cardAppeared(replies, op.id)) return finish({ ok: false });
          this.ask(addUndoCommand(memoId, op.id));
          this.watch(memoId, (rs) => cardsGone(rs, [op.id]), (ok) => finish(ok ? { ok: true } : { ok: false }));
          return;
        }
        const note = addBlockedNote(this.loaded, replies);
        if (note) return finish({ ok: false, note });
        const cmd = cardAppeared(replies, op.id) ? null : addCommand(memoId, op.id, op.text);
        if (!cmd) return finish({ ok: false });
        const token = ++this.seq;
        this.pending.set(op.id, { x: op.at.x, y: op.at.y, seq: token });
        this.ask(cmd);
        this.watch(memoId, (rs) => cardAppeared(rs, op.id), (ok) => {
          if (!ok) {
            if (this.pending.get(op.id)?.seq === token) this.pending.delete(op.id);
            this.render();
            return finish({ ok: false });
          }
          this.setSelected(new Set([op.id]));
          finish({ ok: true, text: null });
          this.savePlaced(memoId, [{ ref: op.id, x: op.at.x, y: op.at.y }], token, undoDoneText(op, dir), 'カードは足しましたが、位置は保存できませんでした');
        });
        return;
      }
      case 'remove': {
        if (dir === 'undo') {
          const moves = restoreMoves(op);
          const token = ++this.seq;
          for (const m of moves) this.pending.set(m.ref, { x: m.x, y: m.y, seq: token }); // 戻ったカードを、仮の位置を経ず元の場所に出す
          this.ask(restoreCommand(memoId, op.token));
          this.watch(memoId, (rs) => pastedAppeared(rs, op.ids), (ok) => {
            if (!ok) {
              for (const m of moves) if (this.pending.get(m.ref)?.seq === token) this.pending.delete(m.ref);
              this.render();
              return finish({ ok: false });
            }
            this.setSelected(new Set(op.ids));
            finish({ ok: true, text: null });
            this.savePlaced(memoId, moves, token, undoDoneText(op, dir), 'カードは戻しましたが、位置は保存できませんでした');
          });
          return;
        }
        const ids = liveSelection(replies, op.ids);
        if (ids.length === 0) return finish({ ok: false });
        const next = newUndoToken(); // 消し直すときも新しい印（戻すたびに控えが 1 件できる）
        const at: Record<string, Pt> = {};
        for (const id of ids) {
          const p = this.pos.get(id) ?? op.at[id];
          if (p) at[id] = { x: p.x, y: p.y };
        }
        for (const cmd of deleteCommands(memoId, replies, ids, next)) this.ask(cmd);
        this.setSelected(new Set());
        this.watch(memoId, (rs) => cardsGone(rs, ids), (ok) => finish(ok ? { ok: true, next: { kind: 'remove', ids, at, token: next } } : { ok: false }));
        return;
      }
      case 'link': {
        const target = dir === 'undo' ? op.before : op.after;
        if (!topOfId(replies, op.from) || !topOfId(replies, op.to)) return finish({ ok: false });
        const cmd = linkSetCommand(memoId, op.from, op.to, linkKindOf(replies, op.from, op.to), target);
        if (cmd) this.ask(cmd);
        this.watch(memoId, (rs) => linkStateIs(rs, op.from, op.to, target), (ok) => finish(ok ? { ok: true } : { ok: false }));
        return;
      }
      case 'paste': {
        if (dir === 'undo') {
          if (op.token === null) return finish({ ok: false, note: '元に戻せませんでした（左からの取り消しの印が届いていません）' });
          this.ask(pasteUndoCommand(op.token));
          this.watch(memoId, (rs) => cardsGone(rs, op.ids), (ok) => finish(ok ? { ok: true, next: { ...op, token: null } } : { ok: false }));
          return;
        }
        const plan = planRepaste({ memoId, template: op.template, replies, load: this.loaded, at: op.at });
        if (!plan.ok) return finish({ ok: false, note: plan.note });
        const { ids, moves } = plan;
        const token = ++this.seq;
        for (const m of moves) this.pending.set(m.ref, { x: m.x, y: m.y, seq: token });
        const askedAt = Date.now();
        this.ask(plan.command);
        this.watch(memoId, (rs) => pastedAppeared(rs, ids), (ok) => {
          if (!ok) {
            for (const m of moves) if (this.pending.get(m.ref)?.seq === token) this.pending.delete(m.ref);
            this.render();
            return finish({ ok: false });
          }
          // 貼り直すと id が新しくなる：このあとのやり直し（古い id を指すもの）を新しい id に付け替える
          const map = new Map(op.ids.map((id, i) => [id, ids[i]] as const));
          this.undo.remapRedo(map);
          const next: Extract<UndoOp, { kind: 'paste' }> = { ...op, ids: [...ids], token: null };
          this.trackSendToken(next, memoId, askedAt);
          this.setSelected(new Set(ids));
          finish({ ok: true, next, text: null });
          this.savePlaced(memoId, moves, token, `${undoDoneText(op, dir)}（${ids.length} 枚）`, '型は貼りましたが、位置は保存できませんでした');
        });
        return;
      }
    }
  }
  private releaseSpace() {
    this.space = false;
    this.stage.classList.remove('is-space');
  }

  private releasePan() {
    this.pan = null;
    this.stage.classList.remove('is-panning');
  }
}

function availHeight(): number {
  return typeof window !== 'undefined' && window.screen ? window.screen.availHeight : NaN;
}

const topOfId = (replies: readonly Reply[], id: string): boolean => replies.some((r) => r.id === id && r.parent === null);

// 選びの印（型の小窓を開いたときの選びと、いまの選びが同じかを見る）
function selectionKey(selected: ReadonlySet<string>): string {
  return [...selected].sort().join('\u0001');
}

// 種類の名前が替わったら描き直す（線の名札）
function linkNamesKey(): string {
  return (['ground', 'counter', 'next', 'same', 'ask', 'supplement'] as const).map((k) => linkKindInfo(k).name).join('\u0001');
}