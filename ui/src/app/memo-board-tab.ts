import { BOT_FEATURES } from '../features';
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
//   保存に失敗したら（カードは）元の位置に戻し、理由を出す。読めないボード・読み込み中は動かさない・書かない。Esc：つまむのを取り消す→選びを外す→（「［全体］の間」なら）全体の前へ戻る（MK2）→縮める→メモへ
//   B1-3 のとおり、［拡大］［縮小］は高さの道（PaneHeightApi。つまみと同じ道）。計算は memo-card-board-view.ts・memo-card-board-select.ts・memo-pane-expand.ts（試験あり）
//   画面の文字は textContent だけで入れる
import { t as tr } from '../i18n';
import { el } from '../util';
import { CellMenu, type MenuEntry } from '../panels/cell-menu';
import { tagArea } from '../panels/tag-pad';
import { MAX_TAGS_PER_TAB, normalizeTag, registeredTagNames } from '../tags';
import type { RelayCommand } from '../types';
import { addBlockedNote, addCommand, addLinkFrom, addSpot, canReturnDraft, cardAppeared, cardsGone, cardTextIs, composeHasDraft, composeTextHeight, type ComposeMode, deleteCommands, editCheck, editCommand, HEX_PASTE_NOTE, HEX_TEMPLATE_NOTE, kindChoices, linkAddPlan, linkIs, linkRemoveCommand, liveSelection, makeReplyId, relationsOf, type Relation, returnMode, tagCommands, tagFullCount, tagFullMarkNote, takenSpots, templateBlockedNote, templateOffsets, toolState, unionTags } from '../memo-card-board-edit';
import { readData, readDataChecked } from '../data';
import { request } from '../bridge';
import { type PasteAnchor, pasteDoneText, pastedAppeared, planBoardPaste, planRepaste, pasteToolNote } from '../memo-card-board-paste';
import { pointSpot } from '../memo-card-board-spots';
import { addUndoCommand, linkKindOf, linkSetCommand, linkStateIs, markCommand, markFull, markNow, markStateIs, moveTargets, newUndoToken, pasteUndoCommand, REDO_STALE_NOTE, removeAt, restoreCommand, restoreMoves, UNDO_STALE_NOTE, undoBlockedNote, undoButtons, undoDoneText, undoLayoutNote, UndoStack, type UndoDir, type UndoOp } from '../memo-card-board-undo';
import { type LikeLevel, likeButtonText, likeTag, MARK_COLOR_KEY, markFullNote, type MarkKind, nextLike } from '../likes';
import { BOARD_KEY_HINT, boardKeyAction, boardKeysActive, emptyComposeArrowPan, isKeyboardMenu, KEYSHORTCUTS, keyFocusOf } from '../memo-card-board-keys';
import { orphanNoteText, planTidy, tidyButton, tidyConfirmMessage, tidyDoneText, TIDY_LABEL, tidyNoneNote } from '../memo-card-board-tidy';
import { pasteBlocked, TEMPLATE_EMPTY_HINT, templateMenuGroups, templateMenuLabel, type LoadTemplatesResult } from '../memo-card-template-store';
import { type CardTemplate, extractHoles } from '../memo-card-templates';
import { cardFilterRow, cardTagCandidates, cardTagCounts } from '../memo-card-filter';
import { type BoardLayout, boardToScreen, type BoardView, DEFAULT_VIEW, type NodeMove, panBy, screenToBoard, zoomAt } from '../memo-card-board';
import { type BoardGeo, geoOf, planBoardMoves } from '../memo-card-board-geo';
import { type Overview, type OverviewEnd, overviewFaceMoved, overviewGoesBack, overviewNeedPx, overviewStart, overviewUpperWaits, UPPER_BACK_MS, upperGiveBackView, zoomTexts } from '../memo-card-board-overview';
import { type HexFaceInfo, hexFaceInfos } from '../memo-card-board-hex';
import { ROUTE_BUDGET_MS } from '../memo-card-board-route';
import { hexCardEl } from './memo-board-hex';
import type { Pt, Selection } from '../memo-card-board-select';
import { boardPaneIo } from './memo-board-io';
import { boardSaveMessage, type LoadBoardResult, loadBoard, saveBoard } from '../memo-card-board-store';
import { actualSizeView, ARRIVAL_FLASH_MS, ARRIVAL_MS, arrivedCards, boardEmptyText, boardFaces, boardLinks, boardNote, CARD_VISIBLE_ENOUGH, type CardFace, cardVisibleRatio, composeView, dimmedIds, type EdgeChip, edgeChipAt, type EdgeGeometry, fitAll, lastWritten, linkDimmed, loadOutcome, markSeatWidth, moveBlockedNote, moveResultNote, openingView, type OpeningRule, pastThreshold, planView, type ReadBox, recentTops, searchWords, settleView, viewAfterShow, viewResultNote, viewSaveWait, viewToRead, viewToReadAdded, viewToShowCard, viewToShowMoved, wheelPlan, withPending } from '../memo-card-board-view';
import { boardMenuEntries, lineMenuEntries, cardCopyText, cardFacts, cardFullText, cardHead, type CardMenuActions, type CardMenuInput, cardMenuEntries, cardTip, confirmListEntries, confirmPageEntries, confirmVideoEntries, menuPicked, oldestCardText, readMenuEntries, TAG_WRITE_LABEL, tagMenuEntries, tagMenuPool, TEMPLATE_ADD_LABEL, TEMPLATE_CENTER_HEADING, TEMPLATE_HERE_HEADING, templateDeleteEntries, templateMakeLabel, templateTierEntries } from '../memo-card-board-menu';
import { BoardPins, type PinContent } from './memo-board-pins';
import { BoardCallouts } from './memo-board-callouts';
import { type CalloutCard, calloutShot, calloutText, hasCalloutMark } from '../memo-card-board-callouts';
import { ClickCounter, PEEK_DOUBLE_MS } from '../sheet-peek-logic';
import { BOARD_ARROW_DIR, cardNear, centerMostCard, type EmptyTap, emptyTap, dragBoardDelta, dragCancelPlan, EDGE_FRAME_MS, edgeFrameMove, edgePan, edgePanStep, groupDragBy, innerPoint, marqueeHits, nearestInDirection, marqueeRect, marqueeSelection, nextInner, pressSelect, pruneSelection, sameSelection, selectAll, selectionCountText } from '../memo-card-board-select';
import { cardLabel, type DrawLink, type LinkKind, type LinkKindNames, linkKindInfo, LINK_KINDS, linkSentence, withLinkKindNames } from '../memo-card-links';
import { linkMarkerDefs } from '../memo-card-link-layer';
import { expandLabel, isExpanded, leaveExpand, shrinkExpand, toggleExpand, type ExpandState } from '../memo-pane-expand';
import { type BoardPlace, boardExpandShown, PLACE_BUTTON_LABEL, PLACE_BUTTON_TITLE } from '../memo-card-board-place';
import { quoteFragmentUrl, type Reply } from '../threads';
import { type BoardMemoInfo, type PickMode, memoTagOf, pickerEntries, pickMode } from '../memo-board-pick';
import { type BoardFocus, boardFocusStep } from '../memo-board-source';
import { arrivedPhotoCard, canOpenPhotoTitle, PHOTO_TITLE_LABEL, PHOTO_TITLE_LATER } from '../memo-board-photo';
import { shrinkPicture } from '../picture-fit';
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
  focus?(): BoardFocus | null; // 右の検索の［上で開く］：選んで 100% で見せるカード（見ている写しに載っている頼み。番号が新しいときだけ当てる。MK4）
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
  showList?(): void; // 下の帯をメモのタブにする（カードのメニューの［下の一覧］で、移った先を見せるため）
  borrowUpper?(needPx: number): boolean; // 「［全体］の間」だけ上の区画を needPx だけ高くする（今の高さに足す量。床が許す所まで。境目を一時に下げる。保存しない。MK3）。下げたら true。下の区画が、上に出していない・持ち主が違う・借りている・窓が開いている・狭いときは断る
  releaseUpper?(): void; // 借りた高さを戻す（借りる前の割合へ。上に出していて、持ち主がボードで、借りているときだけ下の区画が動く。MK3）
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
  // 型にする（TA3。右クリックの型の段のいちばん下）：小窓を出さずに登録する。name は名前の元の文（1 行目を使う。同じ名前には番号が付く）。結果の一言は onDone で返ってくる。無ければ、行を出さない
  save?(ids: string[], offsets: Record<string, { dx: number; dy: number }>, opts: { name: string; mode: 'snapshot' | 'skeleton' }): void;
  // 型を消す（TA8）：消し終えたら（消せなくても）戻る。結果の一言は onDone で返ってくる。無ければ、［型を消す…］を出さない
  remove?(id: string, name: string): Promise<void>;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEAD_PREFIX = 'memo-board-head-';
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K) => document.createElementNS(SVG_NS, tag);

// 読み込みは読むだけの io（書く道は渡さない）。書くのは動かして離したときの保存（boardPaneIo）だけ
const readOnlyIo = { read: (name: string) => readDataChecked<unknown>(name), write: async () => false };
const STATUS_MS = 8000;
const TIER_GUARD_MS = 400;
const ASK_SELECTED_NOTE = tr('選んだカードを材料にして、依頼の小窓を開きます（直接つながるカードは印を外して足します）'); // ［Grok に頼む］の説明（道具の列のボタンと、空きのメニューの行の両方が使う。TA6）

// 空きのメニューを開いた所（TA4b・TA5）。point：面の空き（at＝押した点を真ん中にした、カード 1 枚の左上。corner＝押した点そのもの。ボードの座標）。center：題の帯（押した所が無いので、面の真ん中から）
type BoardSpotFrom = { kind: 'point'; at: Pt; corner: Pt } | { kind: 'center' };
// 型を足す基準（TA2・TA5）：押したカードか、空きのメニューを開いた所
type TemplateFrom = { kind: 'card'; id: string } | BoardSpotFrom; // 型の段を出してから、段の中の押しを受けない長さ（ダブルクリックの長さと同じ）
const WATCH_MS = 3000; // 送った命令の結果が左の写しに現れるのを待つ長さ
const KNOWN_MAX = 60; // 読んだ・保存したボードの写しを覚えておく数（「形:メモ」の組で数える。メモを替えた・形を替えた直後に、前の見ている位置を保存するため。HX5）
const SHOTS_MAX = 20; // メニューの絵を覚えておく数
const SLIDE_MS = 240; // カードへ移るときに滑らせる長さ（CSS の is-sliding と同じくらい）
const COMPOSE_HINT = tr('Ctrl+Enter でも決められます（足すときは Ctrl+Enter で選んだカードの右・Shift+Enter で下に）'); // 書く欄の案内（上の区画では欄の title とプレースホルダーへ。HX2）
const COMPOSE_ADD_LABEL = tr('新しいカードの文（最後に書いたカードの隣に足します。Ctrl+Enter で選んだカードの右・Shift+Enter で下に）'); // 下の置き場で見える見出し（前と同じく 1 行に収まる長さ）
const COMPOSE_ADD_PLACE = tr('［決める］で足すカードは、最後に書いたカードが半分より多く見えていればその右、右が面の外かふさがっていれば下、どちらも無理なら見ている場所の真ん中に置きます'); // 置き場の決まりの説明（欄の title に。HX2）
// 上の区画の書く欄のプレースホルダー（短く。長い説明は title だけ）と、［決める］の字（どの形かを見て分かるように）
const COMPOSE_SHORT = { add: tr('新しいカードの文'), edit: tr('カードの文を書き直す'), photo: tr('この写真の題') } as const;
const COMPOSE_OK = { add: tr('決める'), edit: tr('書き直す'), photo: tr('題を付ける') } as const;
const COMPOSE_LIKE_TITLE = tr('次に足すカードにいいねを付けます（押すたびに 1→2→3→なし）'); // 書く欄の ♡ の説明（MK6。足す欄だけ）
// 結果を待っている印の鍵（MK6。setMark・likeAdded の markWaits）：メモ・カード・種類
const markWaitKey = (memoId: string, id: string, kind: MarkKind): string => `${memoId}\n${id}\n${kind}`;


// ←↑→↓ で見ている場所を動かす量（画面の画素。→ で右の方が見える＝面は左へ）
const BOARD_ARROW_PAN: Record<string, [number, number]> = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] };
const TOOLS_FOLDED_KEY = 'honeycomb.boardToolsFolded'; // 道具の列とタグの行を畳んでいるか（CB10。上のボードと下のタブのボードで 1 つ）

function readToolsFolded(): boolean {
  try {
    return localStorage.getItem(TOOLS_FOLDED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeToolsFolded(on: boolean) {
  try {
    localStorage.setItem(TOOLS_FOLDED_KEY, on ? '1' : '0');
  } catch {
    // 覚えられなくても、今開いている面では畳んだまま
  }
}

// ボードの形（HX4）：'hex' のときだけ六角。上のボードと下のタブのボードで 1 つ、全部のメモに効く。台帳ではない
const BOARD_SHAPE_KEY = 'honeycomb.boardShape';

function readBoardShape(): BoardLayout {
  try {
    return localStorage.getItem(BOARD_SHAPE_KEY) === 'hex' ? 'hex' : 'square';
  } catch {
    return 'square';
  }
}

function writeBoardShape(shape: BoardLayout) {
  try {
    localStorage.setItem(BOARD_SHAPE_KEY, shape);
  } catch {
    // 覚えられなくても、今開いている面ではその形のまま
  }
}

const SHAPE_TITLE_OFF = tr('六角で表示します。四角と六角の並びは別々に残ります'); // 切り替えのボタンの説明（四角のとき）
const SHAPE_TITLE_ON = tr('六角で表示しています。押すと四角に戻ります（四角と六角の並びは別々に残ります）');
const SHAPE_VIEWS_MAX = 60; // 形ごとに覚えておく見ている位置の数（形 × メモ。保存しない）

// つまんでいる最中。sx・sy・px・py は画面（client）の点（押した点・今の指）、start は押した点（面の左上から）。view0 は押した時の見ている位置
//   inner＝押してから面の中ほど（帯の外）にいた。panned＝端で見ている位置が動いた。edgeAt＝端で動かした前のこまの時刻（HX3）
//   touched0・viewMoved0・shift0・untouched0＝押した時の「触った」「見る位置を変えた」と書く欄の寄せの印の控え（取り消したら戻す）
type BoardDrag = { pointerId: number; ref: string; els: HTMLElement[]; sx: number; sy: number; px: number; py: number; start: Pt; view0: BoardView; inner: boolean; panned: boolean; edgeAt: number | null; touched0: boolean; viewMoved0: boolean; shift0: { before: BoardView } | null; untouched0: boolean; starts: Map<string, Pt>; pos: Map<string, Pt>; moved: boolean; collapse: boolean };

// 描いている線一本。marker＝曲線の矢じり（url(#…)。種類に矢じりが無ければ空）。短い線の帯（六角の隣どうし。HX4）では矢じりを外す
type LineEl = { g: SVGGElement; path: SVGPathElement; label: SVGTextElement; hit: SVGPathElement; from: string; to: string; marker: string };
type RouteSpent = { ms: number; over: number }; // 1 回の描き直しで迂回の道の計算に使った時間（ms）と、上限を超えて今の曲線で描いた線の数

// その場所が線の当たりなら、線の両端（CB15）
function lineOfHit(target: EventTarget | null): { from: string; to: string } | null {
  if (!(target instanceof SVGElement) || !target.classList.contains('memo-board-link-hit')) return null;
  const { from, to } = target.dataset;
  return from && to ? { from, to } : null;
}

export class MemoBoardPanel {
  readonly root = el('div', 'memo-board');
  private readonly titleBtn = el('button', 'memo-board-title', ''); // 押すと道具の列とタグの行を畳む（CB10）
  private toolsFolded = readToolsFolded();
  private readonly btn = el('button', 'memo-board-expand', expandLabel(false));
  private readonly placeBtn = el('button', 'memo-board-place', PLACE_BUTTON_LABEL.bottom); // 上に出す／下に戻す（常に出す。C3）
  private place: BoardPlace = 'bottom';
  private menuEsc: Event | null = null; // メニューの中で押された Esc（ownsMenu。M3）
  private pointerOutside = false; // 最後に押した（クリックした）所が、ボードの面の外（下のメモの帯など）か。上に出しているときの、キーを受ける場所の判断に使う（C4）
  private readonly memoTag = el('button', 'memo-board-memotag'); // 見ているメモの名札（上に出していれば、押してメモを選べる。M3）
  private readonly count = el('span', 'memo-board-count');
  private readonly orphanEl = el('span', 'memo-board-orphan'); // 台帳から消えたカードの位置が残っているときだけ出す（B4-1）
  private readonly search = el('input', 'memo-board-search');
  private readonly fitBtn = el('button', 'memo-board-fit', tr('全体'));
  private readonly zoomBtn = el('button', 'memo-board-zoom', '100%'); // 今の倍率を出す。押すと 100%（HX1）
  private zoomShown = -1; // zoomBtn に今書いてある倍率（％）。字だけの守り
  private zoomVar = -1; // 縮む層（world）に今書いてある --board-zoom（MK6。♥ の縁の太さ）。前に書いた倍率とそのまま比べる（zoomShown は四捨五入なので使わない）
  private zoomTip = ''; // zoomBtn に今書いてある説明と読み上げ（「［全体］の間」の始まり・終わりでも替わる。MK2）
  private overview: Overview | null = null; // 「［全体］の間」（［全体］を押す直前の位置を覚えている。％・Esc で戻る。MK2）
  private upperTimer = 0; // ピンチで「［全体］の間」を終えたあと、借りた上の高さを戻すまでの時計（保存の時計とは別。MK3）
  // 「［全体］の間」の吹き出し（MK8a・MK8b。§4.8。層は面の子で、縮む層のすぐ後ろ。止まってから置き直す時計と、頭・「＋n」の受け口も持つ）
  private readonly callouts = new BoardCallouts({ paint: () => this.paintCallouts(), pick: (id) => this.pickCallout(id), jump: (id) => this.jumpToCallout(id), menu: (id, x, y, byKey) => this.calloutMenu(id, x, y, byKey) });
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
  private loaded: LoadBoardResult | null = null; // いまの形のファイルの読み込み（形を替えたら、その形の覚えか、読み直した結果。HX5）
  private readonly known = new Map<string, LoadBoardResult>(); // 「形:メモ」ごとの、いちばん新しく読んだ・保存したボード（保存の列がこれを元に次の形を作る。鍵は boardKey。HX5）
  private readonly wrote = new Map<string, number>(); // 「形:メモ」ごとの、保存が終わった回数（読み込みの返りを、読んだあとに書いていれば捨てるため。HX5）
  private loadSeq = 0;
  private needFit = true;
  private view: BoardView = { ...DEFAULT_VIEW };
  private openRule: OpeningRule | null = null; // 開いたときに選んだ決まり（HX1。決まり 1 でなく触っていなければ、面が替わったら計算し直す）
  private viewTouched = false; // 開いてから、利用者が見ている位置を変えた・カードを動かしたか（touchView の頭と、つまんで動かし始めたときに立てる）
  private viewMoved = false; // 開いてから、見ている位置そのものを変えたか（touchView の頭だけで立てる。つまむだけでは立てない）。六角のファイルを初めて作る書き込みに今の位置を入れるか（freezeView。HX5）
  private hiddenLast: { memoId: string; id: string | null } | null = null; // 隠したときの、最後に書いたカード（出したときに比べる）
  private shape: BoardLayout = readBoardShape(); // いまの形（HX4。四角と六角の並びは別々）
  private readonly shapeViews = new Map<string, BoardView>(); // 形ごと・メモごとの見ている位置（「形:メモ」。保存しない。HX4）。出すときは開き方の決まり 1 で、保存した位置の代わりに確かめる
  private openKept: BoardView | null = null; // 形を替えたときの、その形で前に見ていた位置（次の開き方の決まり 1 に渡す。HX4）
  private placing = 0; // 位置にかかわる操作（足す・消す・貼る）の結果を待っている数（待っている間は形を替えない。HX4）
  private readonly shapeBtn = el('button', 'memo-board-shape', tr('⬡ 六角')); // 題の帯の切り替え（字は固定。押している間は六角。HX4）
  private readonly shapeTool = el('button', 'memo-board-tool memo-board-shape-tool', '⬡'); // 道具の列の切り替え（字は記号だけ）
  private faces: CardFace[] = [];
  private cardEls = new Map<string, HTMLElement>();
  private lineEls: LineEl[] = [];
  private pos = new Map<string, { x: number; y: number }>(); // いま描いている位置（つまんでいる間は動く）
  private readonly status = el('div', 'memo-board-status');
  private statusTimer = 0;
  private readonly pending = new Map<string, { x: number; y: number; seq: number }>(); // 保存を待っている位置（動かした直後に元へ跳ばない）。seq＝何回目の保存の分か（あとの保存の分を消さないため）
  private seq = 0;
  private queue: Promise<void> = Promise.resolve(); // 保存は 1 つずつ（前の保存の結果を次が使う）
  private drag: BoardDrag | null = null;
  private edgeRaf = 0; // つまんだまま端の帯にいる間、見ている位置を動かす requestAnimationFrame（止めるのは endDrag だけ。HX3）
  private selected: Selection = new Set<string>();
  private total = 0;
  private readonly marqueeEl = el('div', 'memo-board-marquee');
  private marquee: { id: number; sx: number; sy: number; base: Selection } | null = null; // 面の左上からの画素
  private viewTouchedAt: number | null = null; // 見ている位置を最後に変えた時刻（保存していないとき）
  private viewTimer = 0;
  private readonly tools = el('div', 'memo-board-tools');
  private readonly addBtn = el('button', 'memo-board-tool', tr('＋カード'));
  private readonly editBtn = el('button', 'memo-board-tool', tr('書き直す'));
  private readonly removeBtn = el('button', 'memo-board-tool is-danger', tr('削除'));
  private readonly linkAddBtn = el('button', 'memo-board-tool', tr('線を足す'));
  private readonly linkRemoveBtn = el('button', 'memo-board-tool', tr('線を外す…'));
  private readonly templateBtn = el('button', 'memo-board-tool', tr('型にする…'));
  private readonly askBtn = el('button', 'memo-board-tool', tr('Grok に頼む'));
  private readonly pasteBtn = el('button', 'memo-board-tool', tr('型を貼る ▾'));
  private readonly undoBtn = el('button', 'memo-board-tool', tr('元に戻す'));
  private readonly redoBtn = el('button', 'memo-board-tool', tr('やり直す'));
  private readonly tidyBtn = el('button', 'memo-board-tool', TIDY_LABEL); // 消えたカードの位置を整理する（B4-1。孤児があるときだけ押せる）
  private readonly tidyBar = el('div', 'memo-board-tidybar');
  private readonly tidyText = el('span', 'memo-board-tidybar-text');
  private tidyOk: HTMLButtonElement | null = null;
  private readonly undo = new UndoStack(); // 元に戻す・やり直しの積み（B3-3b。メモを替えたら捨てる）
  private undoHeld = 0; // 元に戻すを止めている数（戻している最中・足したカードの線といいねの後送り。どれも左の結果を待っている。MK6 の見直しで真偽から数に：先に終わった側が下ろしても、ほかが待っていれば止めたまま）
  private get undoBusy(): boolean {
    return this.undoHeld > 0;
  }
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
  private readonly linkKindBox = el('label', 'memo-board-linkkind'); // 足すと同時に引く線の種類（CB13。足す欄だけ）
  private readonly linkKindSel = el('select');
  private readonly composeLike = el('button', 'memo-board-tool memo-board-compose-like', likeButtonText(0)); // 次に足すカードのいいね（MK6。足す欄だけ。つなぐの後ろ。押すたびに 1→2→3→なし）
  private composeLikeLevel: 0 | LikeLevel = 0; // 書く欄の ♡ の段（欄を開くたび・閉じるたびに なし へ。足すときは submitAdd の頭で読む）
  private readonly markWaits = new Map<string, { value: string; next: string | null }>(); // 結果を待っている印（MK6。鍵は markWaitKey）。value＝送った値、next＝待っている間に押された値（最後の 1 つ）
  private composing: ComposeMode | null = null;
  private composeAt: Pt | null = null; // 「ここに書く」で押した所（置き場の左上。ボードの座標）。足す欄が開いている間だけ覚える（閉じる・入れ替える・形を替えると消す。TA4b）
  private composeShift: { before: BoardView } | null = null; // 書く欄を開いたときに寄せた（HX2）。閉じたとき、寄せてから触っていなければ before へ戻す
  private composeUntouched = false; // 書く欄を開いてから、見ている位置に触っていない（欄が伸びたとき、もう一度寄せてよい。HX2）
  private composeFitted = false; // 上の区画の細い形で、欄の高さを自分で決めている（下の置き場で手で広げた高さには触らない。HX2）
  private imeComposing = false; // 書く欄で変換している途中（高さを変えない。HX2）
  private readonly composeOk = el('button', 'memo-board-tool is-primary', COMPOSE_OK.add); // 上の区画では、形に合わせて字を替える（HX2）
  private readonly composeHint = el('span', 'memo-board-compose-hint', COMPOSE_HINT); // 案内の文（下の置き場で見える。四角と六角で同じ字。HX5）
  private photoTitleFor: string | null = null; // 書く欄が写真の題のときの、そのカード（Enter で決める・空なら付けずに閉じる）
  private photoTitleShot: string | null = null; // この画像のカードが現れたら題の欄を開く（CB7）
  private readonly refusedDrafts: { mode: ComposeMode; text: string; like?: LikeLevel }[] = []; // 左に断られた文のうち、欄が使われていて戻せなかったもの（欄が閉じたら戻す）。like：足す欄の ♡（returnLike が付ける。MK6）
  private composeDraftSent = false; // 左へ知らせた「書く欄に書きかけがあるか」（変わったときだけ知らせる。MK4）
  private focusDone = 0; // 右の検索の［上で開く］で、当てた（か、カードが無くて一言を出した）いちばん新しい番号（MK4）
  private readonly linkBar = el('div', 'memo-board-linkbar');
  private readonly linkBarText = el('span', 'memo-board-linkbar-text');
  private linkFrom: string | null = null; // 線を引く元のカード（相手のカードを押すのを待っている）
  private menu: CellMenu | null = null;
  private tierAt = 0; // 型の段を出した時刻（出してすぐの押しは受けない。続けて 2 回押したときに、指の下の型が入らないように。TA2）
  private tierGuard = false; // 上の守りの受け口を付けたか（メニューに 1 本だけ）
  private menuSeq = 0; // カードのメニューの中身を替えるたびに増やす（読み終えた絵で、別の段の中身を上書きしない）
  private readonly shotUrls = new Map<string, string>(); // メニューと 📌 の絵（shots の id → data:image/）
  private readonly shotAsked = new Set<string>(); // 読んでいる・読めなかった絵（読み直さない）
  private readonly faceUrls = new Map<string, string>(); // 顔の小さな絵（shots の id → 縮めた data:。保存しない。CB16）
  private readonly faceReading = new Set<string>(); // 読んでいる絵（同時に 2 件まで）
  private readonly faceMisses = new Map<string, number>(); // 読めなかった回数（時間切れは読み直す。3 回まで）
  private readonly facts = el('span', 'memo-board-facts'); // 選んだ 1 枚の事実（読むだけ。折り返さない）
  private slideTimer = 0;
  private readonly clicks = new ClickCounter(); // カードのダブルクリック（押して動かさずに離した回を数える。dblclick は使わない）
  private lastEmptyTap: EmptyTap | null = null; // 前の空きのクリック（空きのダブルクリックを数える。dblclick は使わない。TA7）
  private readonly pinLayer = el('div', 'memo-board-pins');
  private readonly pins: BoardPins;
  private knownTops: ReadonlySet<string> = new Set(); // 前の写しの一番上のカード（ボードの外で足された分を見つける）
  private knownMemo: string | null = null;
  private readonly arrivals = new Map<string, { timer: number; flashUntil: number }>(); // 足したカード。保存しない
  private chipEls: HTMLElement[] = []; // 足したカードの札
  private noticeAt = 0; // 左から最後に知らせが来た時刻（断られた理由を、こちらの一言で隠さないため）
  private dirty = false; // つまんでいる間に写しが替わった（離したあとに描き直す）
  private renderKey = '';
  private routeBudgetNoted = false; // 迂回の道の時間の上限（ROUTE_BUDGET_MS）を超えたことを console に一度知らせた
  private filterTag: string | null = null;
  private words: string[] = [];
  private space = false;
  private pan: { id: number; x: number; y: number; sx: number; sy: number; click: boolean; line: { from: string; to: string } | null; menu: boolean } | null = null; // menu：押した時にメニューが開いていた（閉じるための押し。TA7）
  private hoverLine: { g: SVGGElement } | null = null; // 乗せている線（名札を出す）
  private readonly linkHits = svgEl('svg'); // 線の当たり（カードより前の DOM。カードの上を押せばカードが勝つ。CB15）

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
    this.titleBtn.type = 'button';
    this.titleBtn.dataset.key = 'board-title';
    this.titleBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // マウスで押したときは焦点を題に残さない（畳んだ直後の Enter・スペースがカードの操作になるように）
    this.titleBtn.addEventListener('click', () => this.setToolsFolded(!this.toolsFolded));
    this.paintFold();
    bar.append(this.titleBtn, this.memoTag, this.count, this.orphanEl);
    bar.append(this.facts);
    this.orphanEl.hidden = true;
    this.facts.hidden = true;
    this.search.type = 'search';
    this.search.placeholder = tr('検索');
    this.search.setAttribute('aria-label', 'カードを検索（合わないカードは薄くなります）');
    this.search.addEventListener('input', () => {
      this.words = searchWords(this.search.value);
      this.paintDim();
    });
    this.fitBtn.type = 'button';
    this.fitBtn.title = tr('全部のカードが入るように見ている位置を合わせます');
    // マウスで押したときは焦点を取らない（％と同じ。矢印・Enter がボードに効くまま。MK2）。
    //   ただし焦点が Esc を自分で受ける所（字の欄・書く欄の中）にあるときは、今までどおり焦点を［全体］へ移す（欄に残すと、そのあとの Esc は欄のものになり、
    //   書く欄なら閉じて書きかけを捨てる。検索の欄なら何もしない。どちらも全体の前へ戻れない。MK2 の見直し）
    this.fitBtn.addEventListener('pointerdown', (e) => {
      const active = document.activeElement;
      const ownsEsc = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || this.compose.contains(active);
      if (!ownsEsc) e.preventDefault();
    });
    this.fitBtn.addEventListener('click', () => this.fit());
    this.zoomBtn.type = 'button';
    this.zoomBtn.dataset.key = 'board-zoom';
    this.paintZoom(); // 字・説明・読み上げ（MK2）
    this.zoomBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // マウスで押したときは焦点を取らない（題のボタンと同じ）
    this.zoomBtn.addEventListener('click', () => this.actualSize());
    this.btn.type = 'button';
    this.btn.dataset.key = 'board-expand';
    this.btn.addEventListener('click', () => this.toggle());
    const right = el('div', 'memo-board-bar-right');
    right.append(this.shapeBtn); // 六角の切り替え（HX4）。題・名札・枚数の並びとは別に、右の並びの頭へ
    right.append(this.search, this.fitBtn, this.zoomBtn);
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
    this.linkHits.classList.add('memo-board-link-hits');
    this.linkHits.setAttribute('aria-hidden', 'true');
    this.linkHits.setAttribute('focusable', 'false');
    this.world.append(this.linkHits, this.links);
    this.marqueeEl.hidden = true;
    this.stage.append(this.world, this.callouts.layer, this.marqueeEl, this.emptyText); // 操作の説明（this.hint）は利用者の希望で画面に出さない。吹き出しの層は縮む層のすぐ後ろ（範囲選択の枠と 📌 の層より下。MK8a）
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;
    // 出入りする行は面の下に置く（面の上端が動かないのでカードが動かない）。下ほど動かしたくない行：一言はすぐ下に出入りし、書く欄は動かない。絞りの札の行だけ上のまま
    this.root.append(bar, this.tools, this.filterBox, this.stage, this.status, this.note, this.linkBar, this.tidyBar, this.tagRow, this.compose);
    this.root.append(this.pinLayer);
    // 留めたカードの組が替わったら、吹き出しを置き直す（📌 で留めたカードは吹き出しに出さない。隠さない。MK8b）
    this.pins = new BoardPins({ layer: this.pinLayer, content: (memoId, id) => this.pinContent(memoId, id), anchor: (id) => this.pinAnchor(id), area: () => this.pinArea(), onChange: () => this.paintCallouts() });
    this.filterBox.hidden = true;
    this.note.hidden = true;
    this.emptyText.hidden = true;

    this.buildTools();
    this.bindShape();
    this.bindStage();
    // 隠れていて大きさが 0 のあいだは開いたときの位置を待つ。大きさが付いたら合わせる（区画の高さが変わったときも測り直す）
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        if (this.needFit && !this.hidden) this.render();
        if (!this.compose.hidden) this.growCompose(); // 幅が変わると欄の折り返しが変わる（高さが同じなら何もしない。HX2）
        this.pins.place();
        this.paintCallouts(); // 面の大きさが替わった（上の区画を高くしたときも）：「［全体］の間」なら吹き出しを置き直す（隠さない。止まるのを待っている間は時計に任せる。MK8a）
        this.paintArrivals();
        this.takeFocus(); // 右の検索の［上で開く］：面の大きさが 0 か、開いたときの位置の前で待っていた頼みを、大きさが付いたここで当てる（needFit が下りていても、大きさを待っていることがある。MK4 の見直し）
      }).observe(this.stage);
    }
    api?.onChange(() => this.paintButton());
    source?.onChange(() => {
      if (!this.hidden) this.refresh(false);
    });
    cmds?.template?.onDone((text, ok) => {
      if (this.hidden) return;
      this.flash(text, ok ? 'info' : 'warn');
      this.noticeAt = Date.now(); // すぐあとの位置の保存の成功で、この一言を消さない
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
    const moved = (upper ? 'upper' : 'bottom') !== this.place; // 上か下かが替わった（同じ置き場でも呼ばれる）
    if (upper && this.place !== 'upper') this.pointerOutside = false; // 上に出した直後は、まだ下の帯を触っていないことにする
    if (!upper) this.pins.closeAll(); // 📌 は上に出しているときだけ（下の面は低くて覆ってしまう）
    this.place = upper ? 'upper' : 'bottom';
    this.placeBtn.hidden = !available || !this.cmds?.place;
    this.placeBtn.textContent = PLACE_BUTTON_LABEL[this.place];
    this.placeBtn.title = PLACE_BUTTON_TITLE[this.place];
    this.btn.hidden = !boardExpandShown(upper); // 上のあいだは高さを広げない（高さは上の面が決める）
    this.root.classList.toggle('is-upper', upper);
    this.paintMemoTag();
    if (moved) this.endOverview('place'); // 「［全体］の間」は置き場が替わったら終える（戻らない。MK2）
    if (moved) this.paintComposeShape(); // 上の区画では書く欄を細くする（置き場が替わったときだけ。HX2）
    if (moved) this.cancelDrag(); // root を移すと指の捕まえが外れることがある：つまむのを先に取り消す（HX3）
    if (moved) this.settleFace(0); // root を移したあと：触っていない決まり 2〜4 は新しい面で計算し直す。ほかは位置を保つ（上端の差は使わない。HX1・U7）
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

  warn(text: string) {
    this.flash(text, 'warn');
  }

  // ---------- 道具の列を畳む（CB10） ----------

  private setToolsFolded(on: boolean) {
    const top = this.faceTop();
    this.toolsFolded = on;
    writeToolsFolded(on);
    if (on) {
      // 畳むボタンの先に開いていたものを閉じる（開いたまま取り残さない）
      this.menu?.close();
      this.closeTemplate();
      this.closeTidy(false);
    }
    this.paintFold();
    if (top !== null) this.settleFace(this.stage.offsetTop - top); // 面の上端が動いた：同じ処理の中で見ている位置を合わせる（HX1）
  }

  // 畳むのは class と CSS（hidden は paintToolsBoard が書き戻す）
  private paintFold() {
    this.tools.classList.toggle('is-folded', this.toolsFolded);
    this.tagRow.classList.toggle('is-folded', this.toolsFolded);
    this.titleBtn.textContent = this.toolsFolded ? tr('ボード（道具 ▴）') : tr('ボード（道具 ▾）');
    this.titleBtn.title = this.toolsFolded ? tr('道具の列を出します') : tr('道具の列とタグの行を畳んで、面を広くします。畳んでいる間も Enter・Delete・Ctrl+Z・F2・右クリックが効きます');
    this.titleBtn.setAttribute('aria-expanded', String(!this.toolsFolded));
  }

  // ---------- 形（四角・六角。HX4・HX5。docs/plan-comment-board-hex.md §6.3） ----------
  //   形は localStorage の鍵 1 つ（上と下で共通・全部のメモ）。四角と六角の並びは別々のファイル（四角は boards/、六角は boards-hex/。HX5）。
  //   this.loaded はいまの形のファイルの読み込み。書く道（saveBoard を呼ぶ 6 か所）は、操作を始めたときの形の鍵（boardKey）で known を引き、その形のファイルにだけ書く

  // 形ごとの寸法と置き方の口（memo-card-board-geo.ts）。形に関わる所はここだけを使う
  private get geo(): BoardGeo {
    return geoOf(this.shape);
  }

  // 読めるかを見る箱（形ごと。四角はカード全体、六角は箱全体 150×174）
  private get readBox(): ReadBox {
    return this.geo.readBox;
  }

  // いまの形のファイルの読み込みにする（形を替えたとき。HX5）：その形の覚え（known）があればそれを使い、無ければ読む（読み込み中は四角と同じく、動かす・足すを止める）
  //   覚えが読めないもの（unreadable。いっときの読み損ないを含む）なら使わずに読み直す（形を行き来しても止まったままにしない）
  private useShapeBoard() {
    const memoId = this.memoId;
    if (!memoId) {
      this.loaded = null;
      return;
    }
    const kept = this.known.get(boardKey(this.shape, memoId));
    const usable = kept && kept.state !== 'unreadable' ? kept : null;
    this.loaded = usable;
    if (usable) this.loadSeq += 1; // 読み込みの途中だった前の形の返りは使わない
    else this.readBoard(memoId);
  }

  // いまの形のファイルを読む（読むだけの io）。返りの使い方は loadOutcome（memo-card-board-view.ts）：読み込みの番・メモ・形がどれも今と同じときだけ使う。
  //   読んでいる間に保存を待っている・その鍵の保存が終わった（書いた回数が増えた）ときは、保存のあとの形（known）を上書きしない（読み込み中のままにもしない）
  private readBoard(memoId: string) {
    const layout = this.shape;
    const key = boardKey(layout, memoId);
    const seq = ++this.loadSeq;
    const wrote = this.wrote.get(key) ?? 0;
    void loadBoard(readOnlyIo, memoId, Date.now(), layout).then((result) => {
      const outcome = loadOutcome({
        current: seq === this.loadSeq && this.memoId === memoId && this.shape === layout,
        waiting: this.pending.size > 0 || (this.wrote.get(key) ?? 0) !== wrote,
        loaded: this.loaded !== null,
        kept: this.known.has(key),
      });
      if (outcome === 'drop') return;
      if (outcome === 'kept') this.loaded = this.known.get(key) ?? null;
      else this.setLoaded(key, result);
      this.paintTools(); // ［整理］と孤児の注の出入りを先に決める（面の大きさが決まってから開き方を決める。HX4 の直し 5 と同じ）
      this.render();
      this.takeFocus(); // 右の検索の［上で開く］：読み込みが済んで開いたときの位置を決めたあと（メモが替わったときは、ここで初めて当てられる。MK4）
    });
  }

  // いまの形とメモの見ている位置を覚える（寄せていれば寄せる前の位置。保存しない）
  private rememberView() {
    if (!this.memoId || this.needFit) return;
    const key = boardKey(this.shape, this.memoId);
    this.shapeViews.delete(key);
    this.shapeViews.set(key, { ...this.viewAfterClose() });
    if (this.shapeViews.size > SHAPE_VIEWS_MAX) {
      const oldest = this.shapeViews.keys().next().value;
      if (oldest !== undefined) this.shapeViews.delete(oldest);
    }
  }

  // 形を替えられないときの理由（替えられるなら null）：保存を待っている・つまんでいる・範囲選択の途中・位置にかかわる操作（足す・消す・貼る・戻す）の結果を待っている
  private shapeBlockedNote(): string | null {
    if (this.drag !== null || this.marquee !== null) return tr('カードをつまんでいる間・範囲選択の途中は、形を替えられません');
    if (this.pending.size > 0) return tr('位置の保存を待っています。終わってから形を替えてください');
    if (this.placing > 0 || this.undoBusy) return tr('足す・消す・貼る・元に戻すの結果を待っています。終わってから形を替えてください');
    return null;
  }

  // 押したときの動き：題の帯のボタンはここで、道具の列のボタンは buildTools の並び（ほかの道具と同じ道）で受ける（一つのボタンに二度付けない）
  private bindShape() {
    for (const b of [this.shapeBtn, this.shapeTool]) {
      b.type = 'button';
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // マウスで押したときは焦点を取らない（替えたあとの矢印・Enter が面に効くように。題のボタンと同じ）
      b.addEventListener('pointerenter', () => this.paintShape()); // 止めている理由を、乗せたときの説明に今の状態で出す
    }
    this.shapeBtn.addEventListener('click', () => this.toggleShape());
    this.shapeBtn.dataset.key = 'board-shape';
    this.shapeTool.dataset.key = 'board-shape-tool';
    this.shapeTool.setAttribute('aria-label', tr('六角で表示'));
    this.paintShape();
  }

  // 押している状態（aria-pressed）と説明。字は固定（題の帯は「⬡ 六角」、道具の列は「⬡」）
  private paintShape() {
    const hex = this.shape === 'hex';
    const title = this.shapeBlockedNote() ?? (hex ? SHAPE_TITLE_ON : SHAPE_TITLE_OFF);
    for (const b of [this.shapeBtn, this.shapeTool]) {
      b.setAttribute('aria-pressed', String(hex));
      b.title = title;
    }
  }

  private toggleShape() {
    this.setShape(this.shape === 'hex' ? 'square' : 'hex');
  }

  // 形を替える：メモを替えるときの片づけにそろえる（書く欄と選びは残す）。見ている位置は形ごと・メモごとにメモリに覚える（保存しない）。
  //   形を替えるときは毎回、開き方の決まりで決め直し、覚えた位置は保存した位置の代わりに決まり 1 にかける。
  //   読み込みは新しい形のファイル（覚えがあればそれ、無ければ読む。HX5）。四角に戻すと四角の並びは前のまま
  private setShape(next: BoardLayout) {
    if (next === this.shape) return;
    const blocked = this.shapeBlockedNote();
    if (blocked) {
      this.flash(blocked, 'warn');
      this.paintShape();
      return;
    }
    this.cancelDrag();
    this.endOverview('shape'); // 「［全体］の間」は形を替えたら終える（戻らない。開き方の決まりで決め直す前に。MK2）
    this.flushView(); // 見ている位置を替える前に（いまの形のファイルへ。六角のファイルがまだ無ければ書かない）
    this.closeTidy(false);
    this.menu?.close();
    this.cancelLink();
    this.closeTemplate();
    this.renderKey = '';
    this.rememberView();
    this.shape = next;
    writeBoardShape(next);
    this.dropComposeShift(); // 書く欄で寄せた位置は前の形のもの：閉じても戻さない
    this.composeAt = null; // 「ここに書く」の置き場も前の形のもの：書く欄と字は残し、置き場は今の決まりに戻す（TA4b）
    // 開き方の決まりで決め直す（renderBoard）。前にこの形で見ていた位置（メモリ）があれば、保存した位置の代わりに決まり 1 の確かめにかける（四角へ戻すときも。保存しない）
    const kept = this.memoId ? this.shapeViews.get(boardKey(next, this.memoId)) : undefined;
    this.openKept = kept ? { ...kept } : null;
    this.useShapeBoard(); // 新しい形のファイルの読み込み（読み終わるまでは、カードを出さず、動かす・足すを止める）
    this.needFit = true;
    this.paintTools(); // ［整理］と孤児の注の出入りを先に決める（面の大きさが替わってから開き方を決める）
    this.render();
    this.paintShape();
    this.takeFocus(); // 右の検索の［上で開く］：覚え（known）があって開き方をここで決め直したとき、待っていた頼みを当てる（読むときは readBoard の終わり。MK4 の見直し）
  }

  // ---------- 写真の行き先と題（CB7） ----------

  showsTarget(node: EventTarget | null): boolean {
    return !this.hidden && node instanceof Node && this.root.contains(node);
  }

  wantsPaste(target: EventTarget | null): boolean {
    return !this.hidden && this.keysAllowed(target);
  }

  armPhotoTitle(shot: string) {
    this.photoTitleShot = shot;
  }

  // ---------- 下の書く欄と行き来する（Alt。2026-11-04、利用者の依頼） ----------

  // 下の書く欄から来た：足す欄を開いて焦点を入れる。書きかけ・書き直しの欄が開いていれば、そのまま焦点だけ。入れたら true
  //   ほかの作業の途中（整理の確かめ・線を引く途中・型の小窓）と、足せないときは開かない（足せない理由は一言で）
  focusCompose(): boolean {
    if (this.hidden) return false;
    if (this.composing) {
      this.composeText.focus();
      return true;
    }
    if (this.modalOpen) return false;
    if (this.addBtn.disabled) {
      this.flash(this.addBtn.title, 'warn');
      return false;
    }
    this.openCompose({ kind: 'add' }, '');
    return this.composing !== null;
  }

  composeHas(target: EventTarget | null): boolean {
    return !this.compose.hidden && target instanceof Node && this.compose.contains(target);
  }

  // 下の書く欄へ戻る：足す欄が空なら閉じて面を広く戻す。書きかけ・書き直し・写真の題の欄は残す（文を失わない）
  leaveCompose() {
    if (this.composing?.kind === 'add' && this.photoTitleFor === null && this.composeText.value.trim() === '') this.closeCompose();
  }

  // 待っていた画像のカードが現れたら、選んで題の欄を開く。書きかけ・ほかの作業の途中なら開かず一言だけ（文を失わない）
  private openPhotoTitle(replies: readonly Reply[], known: ReadonlySet<string>) {
    const shot = this.photoTitleShot;
    if (!shot || this.hidden) return;
    const id = arrivedPhotoCard(replies, known, shot);
    if (!id) return;
    this.photoTitleShot = null;
    const busyElsewhere = this.drag !== null || this.linkFrom !== null || !this.tidyBar.hidden || this.templateKey !== null || this.fillOpen;
    if (!canOpenPhotoTitle({ composing: this.composing, text: this.composeText.value, busyElsewhere })) {
      this.flash(PHOTO_TITLE_LATER, 'info');
      return;
    }
    const at = this.pos.get(id);
    if (at) this.showCard(id, at);
    this.showCompose({ kind: 'edit', id }, replies.find((r) => r.id === id)?.text ?? '', true);
    this.focusComposeIfFree();
  }

  // ---------- 高さ（B1-3） ----------

  get expanded(): boolean {
    return this.api ? isExpanded(this.api.get(), availHeight()) : false;
  }

  setHidden(hidden: boolean) {
    const was = this.hidden;
    if (hidden && !was) this.noteHiddenLast(); // 隠す前の、最後に書いたカード（HX1）
    this.hidden = hidden;
    this.root.hidden = hidden;
    if (!hidden && was) this.refresh(true);
    if (hidden) {
      this.releasePan();
      this.cancelDrag();
      this.endOverview('hide'); // 「［全体］の間」は隠したら終える（戻らない。MK2）
      this.flushView(); // タブを離れる：見ている位置の保存が残っていたら、その場で保存する（寄せていれば寄せる前の位置）
      this.dropComposeShift(); // 隠したら、書く欄を閉じても前の位置へは戻さない（保存のあとで。HX2）
      this.cancelLink();
      this.menu?.close();
      this.closeTemplate();
    }
  }

  private noteHiddenLast() {
    const snap = this.source?.get() ?? null;
    this.hiddenLast = snap && snap.memoId === this.memoId ? { memoId: snap.memoId, id: lastWritten(snap.replies, this.faces)?.id ?? null } : null;
  }

  // 隠して出した（同じメモ）：最後に書いたカードが隠す前と替わっていて、読めていなければ、最後に書いた辺りへ寄せる（viewAfterShow。保存しない。開き直したのと同じ扱いで、決まりを覚え直す。HX1）
  private reopenAfterShow(replies: readonly Reply[]) {
    const before = this.hiddenLast;
    this.hiddenLast = null;
    if (!before || before.memoId !== this.memoId || this.needFit || this.loaded === null) return;
    const next = viewAfterShow(this.view, replies, this.faces, this.viewport(), { place: this.place, before: before.id, readBox: this.readBox, recent: this.geo.recent });
    if (!next) return;
    this.view = next.view;
    this.openRule = next.rule;
    this.viewTouched = false;
    this.viewMoved = false;
    this.dropComposeShift(); // 見ている位置を替えたので、書く欄を閉じても戻さない（HX2）
    this.applyView();
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
    this.btn.title = on ? tr('区画の高さを元に戻します（Esc でも戻ります）') : tr('区画の高さを広げます');
  }

  // ---------- 読み込みと描画（読むだけ） ----------

  // 見せるとき・写しが替わったとき。show：タブを開いた直後（ファイルを読み直す）
  private refresh(show: boolean) {
    this.paintMemoTag();
    const snap = this.source?.get() ?? null;
    if (!snap) {
      this.endOverview('close'); // 「［全体］の間」はメモが閉じたら終える（戻らない。間でなければ何もしない。MK2）
      this.flushView();
      this.rememberView(); // メモが閉じる前の、この形の見ている位置を覚える（六角は、そのメモをまた開いたときに決まり 1 で確かめて使う。HX4）
      this.resetUndo();
      this.memoId = null;
      this.loaded = null;
      this.loadSeq += 1;
      this.needFit = true;
      this.openKept = null;
      this.render();
      return;
    }
    const changed = snap.memoId !== this.memoId;
    if (changed) {
      this.cancelDrag();
      this.endOverview('memo'); // 「［全体］の間」はメモを替えたら終える（戻らない。MK2）
      this.flushView(); // 前のメモの、見ている位置の保存が残っていたら、その場で（メモを替える前の位置で）保存する
      this.rememberView(); // 前のメモのこの形の見ている位置を覚える（六角は、そのメモへ戻ったときにこれを使う。保存しない。HX4）
      this.clearFlash();
      this.pending.clear();
      this.resetUndo(); // 元に戻す・やり直しの積みは、メモを替えたら捨てる（B3-3b）
      this.clicks.reset();
      this.lastEmptyTap = null; // 空きのダブルクリックも数え直す（TA7）
      this.setSelected(new Set());
      this.cancelLink();
      this.refusedDrafts.length = 0; // 書く欄はメモごと。断られた文も別のメモへは持ち越さない
      this.dropComposeShift(); // 前のメモの位置へは戻さない（HX2）
      this.closeCompose();
      this.closeTidy(false);
      this.menu?.close();
      this.photoTitleShot = null;
      this.memoId = snap.memoId;
      this.loaded = null;
      this.needFit = true;
      this.openKept = null; // 形を替えたときの覚えは前のメモのもの
      this.filterTag = null;
      this.words = [];
      this.search.value = '';
      this.renderKey = '';
    }
    const knownBefore = changed || show || this.knownMemo !== snap.memoId ? null : this.knownTops;
    this.noteArrivals(snap.memoId, snap.replies, changed || show);
    if (changed || show) this.readBoard(snap.memoId); // いまの形のファイルを読む（保存の途中・読んだあとに書いた結果は、保存のあとの形を上書きしない）
    this.render();
    if (show) this.reopenAfterShow(snap.replies);
    if (knownBefore) this.openPhotoTitle(snap.replies, knownBefore);
    this.takeFocus(); // 右の検索の［上で開く］：写しを受けたとき・出したとき（出したあとの位置の決め直しより後。MK4）
  }

  // 別のメモ（B）を見ているあいだだけ、関連の呼び名を B のものに一時的に差し替えて動かす（下の区画のメモの呼び名は全体で 1 つの状態なので、動かし終えたら必ず戻す。M4）。見ていないとき・同じメモのときは何もしない（今までと同じ）
  private named<T>(fn: () => T): T {
    const src = this.source;
    if (!src?.linkNames || !src.info?.()?.other) return fn();
    return withLinkKindNames(src.linkNames(), fn);
  }

  private render() {
    this.named(() => this.renderBoard());
    this.loadFaces(); // 足した写真の絵も、動かさなくても読む
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
    // 読み込み中は、仮の並びを一瞬見せて入れ替わるのを避けるため、カードを出さない。並べ方は形ごと（board はいまの形のファイル）
    //   六角は描く順が nodes の順（最後に動かしたカードが上）なので、保存を待っているカードは保存の前から後ろ（上）に描く（HX5）
    const faces = snap && !loading ? withPending(boardFaces(replies, board, this.geo.place), this.pending, this.shape === 'hex') : [];
    this.stage.dataset.movable = String(snap !== null && moveBlockedNote(this.loaded) === null);
    const note = snap ? boardNote(this.loaded) : { text: '', tone: '' as const };
    this.note.textContent = note.text;
    this.note.hidden = note.text === '';
    this.note.dataset.tone = note.tone;
    this.total = faces.length;
    this.emptyText.textContent = boardEmptyText;
    this.emptyText.hidden = !(snap !== null && !loading && faces.length === 0);
    this.hint.hidden = faces.length === 0;

    const links = boardLinks(replies, new Set(faces.map((f) => f.id)));
    // 六角（HX4）は三角の字（日時・印・タグ・題）も鍵に入れる：✎ などは顔の文だけでは替わらないため。四角の鍵は今のまま
    const hexInfo = this.shape === 'hex' ? hexFaceInfos(replies, faces, links) : null;
    const key = JSON.stringify([snap?.memoId ?? null, this.shape, faces, links, linkNamesKey(), ...(hexInfo ? [[...hexInfo]] : [])]);
    this.faces = faces;
    if (key !== this.renderKey) {
      this.renderKey = key;
      this.build(replies, faces, links, hexInfo);
    }
    this.renderFilter(replies);
    this.paintDim();
    if (this.needFit && this.loaded !== null) {
      const vp = this.viewport();
      if (vp.w > 0 && vp.h > 0) {
        this.needFit = false;
        // 開いたとき：最後に書いた辺りを読める大きさで（決まり 1〜4。HX1）。決めた位置は保存しない（touchView を通さない。開いただけではファイルを作らない）
        //   形ごとにメモリに覚えた位置（形を替えたとき＝その形の覚え、六角でメモを開き直したとき＝六角の覚え）は、保存した位置の代わりに決まり 1 で確かめる（HX4）
        //   覚えが無ければ、いまの形のファイルの見ている位置（決まり 1。六角のファイルがまだ無ければ初期の位置なので決まり 2〜4。HX5）
        //   書く欄が開いたまま（形を替えたときなど）は、欄を閉じたあとの面（closedViewport）で決める（欄で低くなった面で決めると、閉じた面では読める覚えた位置が決まり 3 に移る）。
        //   そのあと、欄を開いたときと同じ寄せ（HX2：目当てが半分より多く見えていれば動かさない。寄せたら、閉じたときに決めた位置へ戻す）をかける
        const composeOpen = !this.compose.hidden;
        const saved = this.openKept ?? (this.shape === 'hex' && snap ? this.shapeViews.get(boardKey('hex', snap.memoId)) : undefined);
        this.openKept = null;
        const open = openingView(this.loaded, replies, faces, composeOpen ? this.closedViewport() : vp, { place: this.place, readBox: this.readBox, recent: this.geo.recent, saved });
        this.view = open.view;
        this.openRule = open.rule;
        this.viewTouched = false;
        this.viewMoved = false;
        this.dropComposeShift();
        if (composeOpen) {
          this.composeUntouched = true; // 決め直したばかりで触っていない（欄が伸びたときも、もう一度寄せてよい。欄を開いたときと同じ）
          this.shiftForCompose();
        }
      }
    }
    this.applyView();
    if (!loading) {
      const shown = new Set(faces.map((f) => f.id));
      this.selected = pruneSelection(this.selected, shown); // 消えたカードを選んだままにしない
      if (this.linkFrom !== null && !shown.has(this.linkFrom)) this.cancelLink(); // 線の元のカードが消えた
    }
    this.paintSelect();
    this.pins.refresh(snap?.memoId ?? null); // 別のメモの 📌 は隠す。カードが消えたら閉じる。写しが替わったら中身を直す
    this.paintArrivals();
  }

  // links：描く線（renderBoard が鍵と一緒に作った boardLinks。ここでは計算し直さない）。hexInfo：六角のときの三角の字（renderBoard が鍵と一緒に作る。四角では null）
  private build(replies: readonly Reply[], faces: readonly CardFace[], links: readonly DrawLink[], hexInfo: ReadonlyMap<string, HexFaceInfo> | null) {
    this.cardEls.clear();
    this.pos = new Map(faces.map((f) => [f.id, { x: f.x, y: f.y }]));
    for (const node of this.world.querySelectorAll('.memo-board-card')) node.remove();
    const frag = document.createDocumentFragment();
    const byId = new Map(replies.map((r) => [r.id, r]));
    for (const f of faces) {
      const info = hexInfo?.get(f.id);
      if (info) {
        // 六角（HX4）：SVG の多角形の顔と HTML の字（app/memo-board-hex.ts）。仮の印（四角の破線）は出さない
        const hex = hexCardEl(f, info, f.thumb ? this.faceUrls.get(f.thumb) : undefined);
        frag.append(hex);
        this.cardEls.set(f.id, hex);
        continue;
      }
      const card = el('div', 'memo-board-card');
      card.dataset.card = f.id;
      card.style.left = `${f.x}px`;
      card.style.top = `${f.y}px`;
      card.classList.toggle('is-provisional', !f.saved);
      card.classList.toggle('is-ai', f.who !== '');
      card.classList.toggle('has-tags', f.tags.length > 0);
      if (f.like > 0) card.dataset.like = String(f.like); // ♥ の縁の段（CSS の --card-heart-px。MK6）
      if (f.color) card.dataset.markColor = MARK_COLOR_KEY[f.color]; // 色の印の地（MK7。CSS が --card-mark-fill に語を入れる。記号は f.mark の先頭）
      card.title = f.title;
      if (f.thumb) {
        card.classList.add('has-thumb');
        const img = el('img', 'memo-board-card-thumb');
        img.alt = '';
        img.draggable = false;
        const url = this.faceUrls.get(f.thumb);
        if (url) img.src = url;
        card.append(img);
      }
      const flow = el('div', 'memo-board-card-flow');
      const seat = markSeatWidth(f.mark);
      if (seat > 0) {
        const seatEl = el('span', 'memo-board-card-seat');
        seatEl.style.width = `${seat}px`;
        flow.append(seatEl);
      }
      // 強制色では box-shadow の ♥ の縁が描かれないので、右上の印の席に「♥2」を字で出す（MK6）。その分の席（印の席の左。ふだんは出さない。CSS）
      const heart = f.like > 0 ? `♥${f.like}` : '';
      if (heart) {
        const heartSeat = el('span', 'memo-board-card-seat memo-board-card-heart-seat');
        heartSeat.style.width = `${markSeatWidth(f.mark ? `${heart} ${f.mark}` : heart) - seat}px`;
        flow.append(heartSeat);
      }
      flow.append(f.bold ? el('span', 'memo-board-card-first', f.first) : document.createTextNode(f.first));
      if (f.rest) flow.append(document.createTextNode(`\n${f.rest}`));
      card.append(flow);
      const tags = el('div', 'memo-board-card-tags');
      for (const tag of f.tags) tags.append(el('span', 'memo-board-chip', tag));
      if (f.moreTags > 0) tags.append(el('span', 'memo-board-chip is-more', `+${f.moreTags}`));
      card.append(tags);
      if (f.who) card.append(el('span', 'memo-board-card-who', f.who));
      if (f.mark || heart) {
        const markEl = el('span', 'memo-board-card-mark', f.mark);
        if (heart) markEl.prepend(el('span', 'memo-board-card-heart', f.mark ? `${heart} ` : heart)); // 強制色のときだけ見える（CSS）
        card.append(markEl);
      }
      frag.append(card);
      this.cardEls.set(f.id, card);
    }
    this.world.insertBefore(frag, this.links); // 線はカードの上（隣のカードとの隙間が狭いので、下だと名札が隠れる）

    const at = new Map(faces.map((f) => [f.id, f]));
    this.lineEls = [];
    this.hoverLine = null;
    const lines: SVGGElement[] = [];
    const hits: SVGPathElement[] = [];
    const spent: RouteSpent = { ms: 0, over: 0 }; // 迂回の道の計算に使った時間（全部の線で合わせて ROUTE_BUDGET_MS まで）
    for (const link of links) {
      const a = at.get(link.from);
      const b = at.get(link.to);
      if (!a || !b) continue;
      // 重なっているカードの線は隠す（動かして離れたら出る）。六角は縁で切り、縁から縁が短ければ帯（HX4）。
      //   六角は、今の曲線がほかのカードの字に掛かれば、字の箱を迂回する道で描く（geo.route。両端のほかの、描いているカード全部を渡す）。つまんで運ぶ間（placeCards）は今の曲線
      const geom = this.lineGeometry(a, b, () => faces.filter((f) => f.id !== link.from && f.id !== link.to), spent);
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
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', info.color);
      path.style.setProperty('--rel', info.color); // 描くときはテーマの明るさの帯へ（data-colors.css）
      if (info.dashed) path.setAttribute('stroke-dasharray', '6 4');
      const label = svgEl('text');
      label.classList.add('memo-pane-map-edge-label', 'memo-board-link-label');
      label.setAttribute('x', '0');
      label.setAttribute('y', '0');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('fill', info.color);
      label.style.setProperty('--rel', info.color);
      label.textContent = info.name;
      g.append(title, path, label);
      lines.push(g);
      const hit = svgEl('path');
      hit.classList.add('memo-board-link-hit');
      hit.dataset.from = link.from;
      hit.dataset.to = link.to;
      const hitTitle = svgEl('title');
      hitTitle.textContent = title.textContent;
      hit.append(hitTitle);
      hits.push(hit);
      const line: LineEl = { g, path, label, hit, from: link.from, to: link.to, marker: info.head !== 'none' ? `url(#${HEAD_PREFIX}${info.kind})` : '' };
      this.paintLine(line, geom);
      this.lineEls.push(line);
    }
    this.linkLines.replaceChildren(...lines);
    this.linkHits.replaceChildren(...hits);
    this.paintLineNames();
    this.noteRouteBudget(spent);
  }

  // 線の形（全部を作り直すとき・取り消して描き直すとき）。route のある形（六角）は迂回の道（others は両端のほかの、描いているカードの位置。要るときだけ作る）。
  //   迂回の計算に使った時間（spent.ms。呼ぶ側の 1 回の描き直しで合わせる）が ROUTE_BUDGET_MS に届いたら、残りの線は今の曲線（geo.edge）で描き、spent.over に数える。
  //   route の無い形（四角）は geo.edge（今のまま）
  private lineGeometry(a: Pt, b: Pt, others: () => readonly Pt[], spent: RouteSpent): EdgeGeometry | null {
    if (this.geo.route && spent.ms < ROUTE_BUDGET_MS) {
      const t0 = performance.now();
      const geom = this.geo.route(a, b, others());
      spent.ms += performance.now() - t0;
      return geom;
    }
    if (this.geo.route) spent.over += 1;
    return this.geo.edge(a, b);
  }

  // 時間の上限を超えて今の曲線で描いた線があれば、console に一度だけ知らせる（このボードのあいだ一度）
  private noteRouteBudget(spent: RouteSpent) {
    if (spent.over === 0 || this.routeBudgetNoted) return;
    this.routeBudgetNoted = true;
    console.info(`[ボードの線] 迂回の道の計算が ${ROUTE_BUDGET_MS}ms を超えたので、残りの ${spent.over} 本は今の曲線で描きました`);
  }

  // 動かしたカード（ids）につながる線だけを、迂回の道で描き直す（route のある形＝六角だけ。四角は何もしない）。
  //   Esc で取り消したとき・同じ所で離したとき（鍵が変わらず build が呼ばれない道）に呼ぶ。つまんで運ぶ間に placeCards が今の曲線で描いた線を戻す
  private routeLines(ids: Iterable<string>) {
    if (!this.geo.route) return;
    const moved = new Set(ids);
    const spent: RouteSpent = { ms: 0, over: 0 };
    for (const line of this.lineEls) {
      if (!moved.has(line.from) && !moved.has(line.to)) continue;
      const a = this.pos.get(line.from);
      const b = this.pos.get(line.to);
      const others = () => [...this.pos].filter(([id]) => id !== line.from && id !== line.to).map(([, p]) => p);
      this.paintLine(line, a && b ? this.lineGeometry(a, b, others, spent) : null);
    }
    this.noteRouteBudget(spent);
  }

  // 線の形を当てる（描くときと、つまんで動かす間）：曲線と矢じり。縁から縁が短い線（六角の隣どうし。HX4）は、矢じりの無い短い帯（太さ band）
  //   形が無い（重なっている）線は隠す。名札と当たりは今の作りのまま（帯でも同じ d に乗る）
  private paintLine(line: LineEl, geom: EdgeGeometry | null) {
    line.g.style.display = geom ? '' : 'none';
    line.path.setAttribute('d', geom?.d ?? '');
    line.hit.setAttribute('d', geom?.d ?? '');
    if (geom) {
      line.label.setAttribute('x', String(geom.mid.x));
      line.label.setAttribute('y', String(geom.mid.y));
      line.label.setAttribute('text-anchor', geom.anchor ?? 'middle'); // 六角の迂回の線は、名札を線から離れる向きに伸ばす（ほかは今のまま中央）
    }
    const band = geom?.band;
    line.path.style.strokeWidth = band ? String(band) : '';
    line.path.style.strokeLinecap = band ? 'butt' : '';
    if (band || !line.marker) line.path.removeAttribute('marker-end');
    else line.path.setAttribute('marker-end', line.marker);
  }

  // 絞り込みの札の列（既存の cardFilterRow）。タグが無ければ隠す
  private renderFilter(replies: readonly Reply[]) {
    const top = this.faceTop();
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
    const dy = top === null ? 0 : this.stage.offsetTop - top;
    if (dy !== 0) this.settleFace(dy); // 絞りの札の行の出入り・折り返しで面の上端が動いた：同じ処理の中で合わせる（HX1）
  }

  // 合わないカードを薄くする（作り直さない）
  private paintDim() {
    const replies = this.source?.get()?.replies ?? [];
    const dim = dimmedIds(replies, this.filterTag, this.words);
    for (const [id, node] of this.cardEls) node.classList.toggle('is-dim', dim.has(id));
    for (const line of this.lineEls) line.g.classList.toggle('is-dim', linkDimmed({ from: line.from, to: line.to, kind: 'next' }, dim));
    this.paintCallouts(); // 薄くしたカードは吹き出しに出さない。写しが替わったとき（renderBoard）もここを通る：「［全体］の間」なら置き直す（隠さない。MK8a）
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
    // 倍率の CSS 変数（MK6。♥ の縁の太さ。CSS は var(--board-zoom, 1)）：替わったときだけ書く（端で動かす・パンの間は毎こま呼ぶので。子のカード全部の style を計算し直すため）
    if (v.zoom !== this.zoomVar) {
      this.zoomVar = v.zoom;
      this.world.style.setProperty('--board-zoom', String(v.zoom));
    }
    this.paintZoom();
    this.pins.place();
    this.paintArrivals();
    this.loadFaces();
  }

  // ％の項目の字・説明・読み上げ（MK2）：applyView と、「［全体］の間」の始まり・終わりから呼ぶ。中身は zoomTexts（memo-card-board-overview.ts）
  //   値が変わったときだけ書く（端で動かす間は毎こま呼ぶので。HX3）。字は％が替わったとき（zoomShown）、説明と読み上げは中身が替わったとき（zoomTip）
  private paintZoom() {
    const z = zoomTexts(this.view.zoom, this.overview?.before ?? null);
    if (z.percent !== this.zoomShown) {
      this.zoomShown = z.percent;
      this.zoomBtn.textContent = z.text;
    }
    const tip = `${z.title}\n${z.label}`;
    if (tip !== this.zoomTip) {
      this.zoomTip = tip;
      this.zoomBtn.title = z.title;
      this.zoomBtn.setAttribute('aria-label', z.label);
    }
  }

  // 見えているカードの絵を、1〜2 件ずつ読む（描き直さず img の src だけ差し替える。CB16）
  private loadFaces() {
    if (this.hidden) return;
    const viewport = this.viewport();
    for (const f of this.faces) {
      if (this.faceReading.size >= 2) return;
      if (!f.thumb || this.faceUrls.has(f.thumb) || this.faceReading.has(f.thumb) || (this.faceMisses.get(f.thumb) ?? 0) >= 3) continue;
      const at = this.pos.get(f.id);
      if (!at || cardVisibleRatio(this.view, at, viewport, this.geo.box) <= 0) continue;
      this.loadFace(f.thumb);
    }
  }

  private loadFace(shot: string) {
    this.faceReading.add(shot);
    void readData<{ data?: unknown }>(`shots/${shot}.json`)
      .catch(() => null)
      .then((saved) => (typeof saved?.data === 'string' && saved.data.startsWith('data:image/') ? shrinkPicture(saved.data) : null))
      .then((url) => {
        this.faceReading.delete(shot);
        if (url) {
          this.faceUrls.set(shot, url);
          for (const f of this.faces) {
            if (f.thumb !== shot) continue;
            const img = this.cardEls.get(f.id)?.querySelector<HTMLImageElement>('.memo-board-card-thumb');
            if (img) img.src = url;
          }
          this.callouts.setPicture(shot, url); // 吹き出しの絵（字の無い写真のカード）も、作り直さずに替える（MK8b）
        } else {
          this.faceMisses.set(shot, (this.faceMisses.get(shot) ?? 0) + 1);
        }
        this.loadFaces();
      });
  }

  // ---------- 吹き出し（MK8a。docs/plan-comment-board-marks.md §4.8） ----------
  //   「［全体］の間」だけ、印のカードの文の頭を面の左右の空きに番号つきで出す（計算は memo-card-board-callouts.ts、層と時計は app/memo-board-callouts.ts）。上と下の置き場の両方
  //   出す：［全体］（fit。待たずに）。隠す：見ている位置が実際に替わった（touchView で、置いたときの位置と比べる）・つまむ（moveDrag。動き始めたとき）・範囲選択（moveMarquee。枠が出たとき）・滑らせる（touchView）。
  //   置き直す：止まって 400ms 後（時計）・面の大きさが替わった（ResizeObserver）・写しや絞り・検索が替わった（paintDim）・📌 を留めた・閉じた（pins の onChange）・「＋n」で組を進めた。
  //   このときは隠さない。applyView では受けない。消す：間が終わった（endOverview）。
  //   MK8b：番号の小札（形ごとの点 geo.badge）・字の無い写真のカードの絵（読めたら loadFace が setPicture で入れる）・頭の押し（pickCallout・jumpToCallout・calloutMenu）・
  //   選んだ見た目（paintSelect が paintSelected で切り替える。作り直さない）・📌 で留めたカードは出さない。
  //   頭を押してからダブルクリックの間は、層が作り直さない（選ぶとタグの行が出て面が低くなり、席の数が替わることがあるため。間のあとに置き直す。層の時計なので waiting）

  // now：止まるのを待っている間でも、待たずに置く（［全体］を押したとき）
  private paintCallouts(now = false) {
    if (!this.overview || this.hidden) {
      this.callouts.clear();
      return;
    }
    if (this.callouts.waiting && !now) return; // 止まるのを待っている：時計が置く
    const panMoved = this.pan !== null && (this.pan.x !== this.pan.sx || this.pan.y !== this.pan.sy); // 押しただけのパン・枠の出ていない範囲選択は、動きに数えない（その間に面の大きさ・写しが替わっても隠さない）
    if (this.drag?.moved || (this.marquee && !this.marqueeEl.hidden) || panMoved) {
      this.callouts.later(); // つまむ・範囲選択・パンの途中：隠したまま待ち直す
      return;
    }
    const replies = this.source?.get()?.replies ?? [];
    const byId = new Map(replies.map((r) => [r.id, r]));
    const cards: CalloutCard[] = this.faces.map((f) => {
      const at = this.pos.get(f.id) ?? f; // 描いている位置
      return { id: f.id, x: at.x, y: at.y, like: f.like, color: f.color, createdAt: byId.get(f.id)?.createdAt ?? 0 };
    });
    const exclude = dimmedIds(replies, this.filterTag, this.words); // 絞り・検索で薄くしたカードは出さない
    for (const id of this.pins.openIds(this.memoId)) exclude.add(id); // 📌 で留めたカードも出さない（全文が面にあるため。MK8b）
    const thumbs = new Map(this.faces.map((f) => [f.id, f.thumb]));
    this.callouts.show({ view: this.view, viewport: this.viewport(), box: this.geo.box, cards, recent: recentTops(replies), exclude, badge: this.geo.badge }, (id) => {
      const reply = byId.get(id);
      const text = reply ? calloutText(reply) : '';
      const shot = calloutShot(text, thumbs.get(id) ?? ''); // 字の無い写真のカードだけ、顔の絵（読めているものだけ。MK8b）
      return { text, shot, url: shot ? this.faceUrls.get(shot) : undefined };
    });
  }

  // 吹き出しの頭の左クリック（MK8b。§4.8）：そのカードを選ぶ（頭は選んだ見た目になる。選んだ見た目では作り直さない。ダブルクリックの間は層が席を保つ）。
  //   つまむ・範囲選択・パン・線を引く途中は何もしない（線の相手はカードを押して選ぶ）
  private pickCallout(id: string) {
    if (this.drag || this.marquee || this.pan || this.linkFrom !== null || !this.pos.has(id)) return;
    this.setSelected(new Set([id]));
  }

  // 頭のダブルクリック（MK8b）：選ぶ → 「［全体］の間」を終える（戻らない。借りた高さは戻す）→ ％の受け口（間でないので、選んだ 1 枚を 100% で真ん中に）。
  //   つまむ・範囲選択・パン・線を引く途中は何もしない（％の受け口が何もせずに戻り、間だけが終わるのを避ける。線の帯を残したまま跳ばない）
  private jumpToCallout(id: string) {
    if (!this.overview || this.drag || this.marquee || this.pan || this.linkFrom !== null || !this.pos.has(id)) return;
    this.setSelected(new Set([id]));
    this.endOverview('jump');
    this.actualSize();
  }

  // 頭の右クリック（メニューキーも。MK8b）：面の右クリック（onContextMenu）と同じ止めを通す（つまむ・範囲選択・パンの途中は開かない。線を引く途中はやめる。
  //   メニューキーは、面のキーの道と同じく、書く欄・確かめ・小窓・メニューが開いている間は開かない）。
  //   選びの外のカードなら選び直してから、そのカードのメニューを押した所に開く（空きのメニューへ行かない）。メニューキーなら頭の右上に開き、焦点をメニューの頭へ
  private calloutMenu(id: string, x: number, y: number, byKey: boolean) {
    if (this.drag || this.marquee || this.pan) return;
    if (this.linkFrom !== null) {
      this.cancelLink();
      return;
    }
    if (byKey && (this.modalOpen || this.menu?.isOpen)) return;
    if (!this.pos.has(id)) return;
    if (!this.selected.has(id)) this.setSelected(new Set([id]));
    this.openCardMenu(id, x, y, null);
    if (byKey) this.menu?.focusFirst();
  }

  // ---------- 右の検索の［上で開く］（MK4。docs/plan-comment-board-marks.md §4.4） ----------

  // 頼まれたカード（source.focus）を、選んで 100% で真ん中に見せる（「100%」の中の道 showActualSize の 1 枚の道）。
  //   呼ぶのは、写しを受けたとき・出したとき（refresh の終わり）・読み込みが済んだとき（readBoard）と、待つ理由が解ける所（面の大きさの変化 ResizeObserver・形の替え setShape の終わり・
  //   つまむか範囲選択を終える所 pointerup・pointercancel・lostpointercapture・blur。MK4 の見直し：ここで当てないと、待った頼みが後の関係ない写しで急に当たる）。
  //   番号が大きく（> で比べる。下の写しに前の小さい番号の頼みが残ることがあるため）、メモが同じで、そのカードが面にあるときだけ当てる
  //   当てられない間（隠れている・読み込み中・開いたときの位置を決める前・面の大きさが 0・つまむか範囲選択の途中）は番号を使わずに待つ（boardFocusStep）。
  //   当てる前に「［全体］の間」を終える（戻らない。借りた高さは戻る。面は showActualSize が読み直す）。カードが無ければ当てずに一言
  private takeFocus() {
    const want = this.source?.focus?.() ?? null;
    if (!want || want.n <= this.focusDone) return; // 頼みが無い・もう当てた（面の大きさを読まずに戻る）
    const vp = this.viewport();
    const step = boardFocusStep({ want, done: this.focusDone, hidden: this.hidden, memoId: this.memoId, loaded: this.loaded !== null, needFit: this.needFit, sized: vp.w > 0 && vp.h > 0, busy: this.drag !== null || this.marquee !== null, faces: this.faces });
    if (step !== 'hit' && step !== 'gone') return;
    this.focusDone = want.n;
    if (step === 'gone') {
      this.flash(tr('カードがもうありません。メモだけ開きました'), 'warn');
      return;
    }
    this.endOverview('jump');
    this.setSelected(new Set([want.replyId]));
    this.showActualSize();
  }

  // ---------- 「［全体］の間」（MK2。docs/plan-comment-board-marks.md §4.2） ----------
  //   ［全体］を押すと始まり、押す直前の位置を覚える。％・Esc で覚えた位置へ戻る。ピンチ・Ctrl＋ホイールで倍率が替わる・メモの替え・メモが閉じる・置き場の替え・形の替え・隠すでは終わるだけ（戻らない）。パンでは終わらない
  //   MK3（§4.3）：上に出しているときは、間だけ上の区画を高くする（境目を一時に下げる。保存しない。下の区画の borrowUpper・releaseUpper）。間が終わると戻す

  // Esc の段（grok-cards.ts）が聞く：今「［全体］の間」か
  get inOverview(): boolean {
    return this.overview !== null;
  }

  // Esc（MK2）：「［全体］の間」なら、％と同じく覚えた位置へ戻る。戻ったら true（つまむ・範囲選択の間は戻らない）
  leaveOverview(): boolean {
    if (!this.overview || this.drag || this.marquee) return false;
    this.endOverview('return');
    return true;
  }

  // 「［全体］の間」を終える（終わりの出来事は全部ここで受ける）。間でなければ何もしない（ピンチのあとの戻しを待っていれば、その場で戻すだけ。y も寄せる）
  //   戻るとき（％・Esc）の順：境目を戻す（MK3）→ 面の大きさを読む → 覚えた位置へ 220ms 滑らせる → 保存（touchView）
  //   借りた高さ（MK3）：ピンチ・Ctrl＋ホイールで終えたときは止まったとみなすまで待って戻す（armGiveBack）。ほかの理由はその場で戻す
  private endOverview(reason: OverviewEnd) {
    if (!overviewUpperWaits(reason)) this.flushGiveBack(); // 戻しを待っている間に、メモ・形・置き場などが替わった：その場で戻す（MK3）
    const o = this.overview;
    if (!o) return;
    this.callouts.clear(); // 吹き出しは間の中だけ：消す（席の順も捨てる。MK8a）
    this.overview = null;
    if (overviewUpperWaits(reason)) this.armGiveBack();
    else this.giveBackUpper();
    if (overviewGoesBack(reason)) {
      const vp = this.viewport(); // 境目を戻したあとの面の大きさ（読むと、その場で並べ直す）
      if (vp.w > 0 && vp.h > 0) this.slide();
      this.view = { ...o.before };
      this.applyView();
      this.touchView();
      return;
    }
    this.paintZoom(); // 終わるだけ：位置はそのまま。％の説明と読み上げを 100% のものに戻す
  }

  // 「［全体］の間」に借りた上の区画の高さ（境目）を、その場で戻す（MK3。借りる前の割合へ。借りていなければ下の区画が何もしない）。戻しを待つ時計も消す
  private giveBackUpper() {
    window.clearTimeout(this.upperTimer);
    this.upperTimer = 0;
    this.cmds?.releaseUpper?.();
  }

  // ピンチのあとの戻しを待っていれば、待たずにその場で戻す（MK3。メモ・形・置き場などの替え・［全体］・100%）。時計と同じ道（giveBackCentered）で、y も寄せる
  //   （寄せずに戻すと、［全体］が覚える位置・保存する位置が、高い面での位置のまま残る。直す役の見直し）
  private flushGiveBack() {
    if (this.upperTimer === 0) return;
    window.clearTimeout(this.upperTimer);
    this.upperTimer = 0;
    this.giveBackCentered();
  }

  // ピンチのあとに借りた高さを戻す（時計と、待ちを流すときの一つの道。MK3）：面の真ん中に見えていた点が真ん中に残るよう、見ている位置の y を高さの差の半分だけ動かして保存する。
  //   戻す前と後の面の高さを読む。高さが替わらなかった（借りていなかった・つまみに触った・下の区画が戻した・隠れていて面の高さが 0）ときは動かさない
  private giveBackCentered() {
    const h0 = this.stage.clientHeight;
    this.cmds?.releaseUpper?.();
    const h1 = this.viewport().h; // 戻したあとの面の高さ（読むと、その場で並べ直す）
    if (h0 <= 0 || h1 <= 0 || h1 === h0) return;
    this.view = upperGiveBackView(this.view, h0, h1);
    this.applyView();
    this.touchView();
  }

  // ピンチ・Ctrl＋ホイールで間を終えた（MK3）：止まったとみなすまで（最後の wheel から 400ms）待ってから、借りた高さを戻す（wheel が続く間は待ち直す）。
  //   戻すときは giveBackCentered（y を高さの差の半分だけ寄せて保存する）。つまむ・範囲選択・パンの途中なら待ち直す
  private armGiveBack() {
    window.clearTimeout(this.upperTimer);
    this.upperTimer = window.setTimeout(() => {
      this.upperTimer = 0;
      if (this.drag || this.marquee || this.pan) {
        this.armGiveBack();
        return;
      }
      this.giveBackCentered();
    }, UPPER_BACK_MS);
  }

  // 「［全体］の間」に上の区画を高くする（MK3。§4.3）：要る高さ（overviewNeedPx）を下の区画に頼む（境目を下げる。保存しない）。下げたら true（面の大きさが替わった）
  //   上に出しているときだけ。借りている間は、下の区画が借り直さない（借りる前の割合を上書きしない）
  private borrowForOverview(vp: { w: number; h: number }): boolean {
    if (this.place !== 'upper' || !this.cmds?.borrowUpper) return false;
    const need = overviewNeedPx(this.faces, vp, this.geo.box);
    return need > 0 && this.cmds.borrowUpper(need);
  }

  // ［全体］：「［全体］の間」でなければ始めて、押す直前の位置を覚える（読み込み中・カード 0 枚・読めないボード・面の大きさが 0・開いたときの位置をまだ決めていない・全体の位置が今と同じなら始めない）。
  //   ただし印のカード（描いているカードの全部で見る。薄くした・📌 で留めたカードも数える）があれば、全体の位置が今と同じでも始める（吹き出しを出すため。MK8b）。
  //   そのときは ％ と Esc の 1 回目がその場へ戻る。印の無いボードは今までどおり始めない（最後に書いた 2 枚は出ない）
  //   間にもう一度押したら合わせ直す（覚えた位置は替えない）。位置の保存は今までどおり（0.4 秒後）。fitAll の動きは今までどおり
  //   MK3：ピンチのあとの戻しを待っていれば先に戻す（y も寄せる。覚える位置が低い面での位置になる）。覚えたあと、間なら上の区画を高くし（境目を下げる）、面の大きさを読み直して合わせる
  private fit() {
    if (this.drag || this.marquee) return; // つまむ・範囲選択の間は動かさない（「100%」と同じ。HX3）
    this.flushGiveBack();
    const next = fitAll(this.faces, this.viewport(), this.geo.box);
    const vp = this.viewport();
    const ready = !this.needFit && vp.w > 0 && vp.h > 0; // 面の大きさが 0 のまま needFit が残っていると、覚えるのが開く前の位置になる（MK2 の見直し）
    if (!this.overview) this.overview = overviewStart({ loading: this.loaded === null, unreadable: this.loaded?.state === 'unreadable', cards: this.faces.length, ready, view: this.view, fit: next, marked: this.faces.some(hasCalloutMark) }); // 印のカードがあれば、全体の位置が今と同じでも始める（吹き出しを出すため。MK8b）
    this.view = next;
    if (this.overview && this.borrowForOverview(vp)) this.view = fitAll(this.faces, this.viewport(), this.geo.box); // 高くした面で合わせ直す
    this.applyView();
    this.touchView();
    this.paintCallouts(true); // 間なら吹き出しを出す（待たずに。間でなければ何もしない。MK8a）
  }

  // ％の項目：「［全体］の間」なら覚えた位置へ戻る（1 枚選んでいても。MK2）。そうでなければ 100%（showActualSize）
  private actualSize() {
    const vp = this.viewport();
    if (vp.w <= 0 || vp.h <= 0 || this.drag || this.marquee) return;
    if (this.overview) this.endOverview('return');
    else this.showActualSize();
  }

  // 「100%」の中の道（％の受け口と分けた。MK4・MK8 も使う）：1 枚選んでいればそのカードを真ん中に、選んでいなければ最後に書いた辺りを、倍率 1.0 で見せる。保存する（HX1）
  private showActualSize() {
    if (!this.drag && !this.marquee) this.flushGiveBack(); // ピンチのあとの戻しを待っていれば、先に戻して（y も寄せて）から今の面で 100% にする（あとで時計が 100% の位置を動かさないように。MK3）
    const vp = this.viewport();
    if (vp.w <= 0 || vp.h <= 0 || this.drag || this.marquee) return;
    const selected = this.selected.size === 1 ? [...this.selected][0] : null;
    this.slide();
    this.view = actualSizeView(this.view, this.source?.get()?.replies ?? [], this.faces, vp, { place: this.place, selected, readBox: this.readBox, recent: this.geo.recent });
    this.applyView();
    this.touchView();
  }

  // 面の上端（root の中の offsetTop）。隠れているとき・開く前は null（見ている位置を合わせない）
  private faceTop(): number | null {
    return this.hidden || this.needFit ? null : this.stage.offsetTop;
  }

  // 面が替わった（道具の列を畳む・開く、絞りの札の行の高さ、置き場の替え）：同じ処理の中で、今の面と上端の差（dy）を読んで見ている位置を合わせる（settleView。保存しない。HX1）
  //   隠れているとき・開く前・面に大きさが無いときは何もしない
  private settleFace(dy: number) {
    const vp = this.viewport();
    if (this.hidden || this.needFit || vp.w <= 0 || vp.h <= 0) return;
    const next = settleView(this.view, this.source?.get()?.replies ?? [], this.faces, vp, { dy, rule: this.openRule, touched: this.viewTouched, selected: this.selected.size }, { place: this.place, readBox: this.readBox, recent: this.geo.recent });
    this.view = next.view;
    this.openRule = next.rule;
    if (this.overview) this.overview = overviewFaceMoved(this.overview, dy); // 「［全体］の間」に覚えた位置の y にも同じ差を足す（戻ったとき、上端が動いた分ずれないように。MK2）
    this.dropComposeShift(); // 面が替わったので、書く欄を閉じても前の位置へは戻さない（HX2）
    this.applyView();
  }

  // 利用者が見ている位置を変えた（パン・ホイール・［全体］・「100%」）。保存の待ちを始める。読めない・読み込み中は書かないので待たない
  private touchView() {
    this.viewTouched = true; // 触った（保存しないときも。面が替わっても計算し直さず、上端の差を引くだけにする）
    this.viewMoved = true; // 見ている位置を変えた（パン・ホイール・矢印・［全体］・倍率・滑り。六角のファイルを初めて作るときに今の位置を入れる。HX5）
    this.dropComposeShift(); // 書く欄で寄せたあとに触った：閉じても戻さない（HX2）
    if (this.overview && this.callouts.movedFrom(this.view)) this.callouts.later(); // 吹き出し：置いたときから見ている位置が実際に替わった（パン・矢印・滑らせる）。隠して、止まって 400ms 後に置き直す（MK8a）
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

  // 保存していない見ている位置があれば、いま保存の列に入れる（タブ・メモ・形を離れるとき・面が隠れるとき）。書く先は、いまの形のファイル（HX5）
  flushView() {
    window.clearTimeout(this.viewTimer);
    this.viewTimer = 0;
    if (this.viewTouchedAt === null) return;
    this.viewTouchedAt = null;
    const memoId = this.memoId;
    if (!memoId) return;
    const layout = this.shape; // いまの形（このあと形を替えても、この形のファイルに書く。保存できなかった文の頭も、書く先の形で。HX5）
    const key = boardKey(layout, memoId);
    const view = { ...this.viewToSave() }; // 書く欄で寄せた・つまんだまま端で動いている一時の位置は保存しない（HX2・HX3）
    this.enqueue(async () => {
      try {
        const base = this.known.get(key);
        const plan = planView(base ?? null, view, Date.now());
        if (!base || !plan.ok || !plan.changed) return; // 読めない・まだ読んでいない・六角のファイルがまだ無い・変わっていない：書かない
        const result = await saveBoard(boardPaneIo, base, plan.board);
        this.settle(key, result);
        const note = viewResultNote(result, layout);
        if (note && this.memoId === memoId) this.flash(note.text, note.tone);
      } catch {
        if (this.memoId === memoId) this.flash(boardSaveMessage('write', layout), 'warn');
      }
    });
  }

  // ---------- 保存の列（直列）と、読んだ・保存したボードの覚え ----------

  private enqueue(task: () => Promise<void>) {
    this.queue = this.queue.then(task).catch(() => undefined);
  }

  // 保存を待つ位置を置く（動かした直後に元へ跳ばない）。入れ直して Map の順の後ろへ回す：六角は待っている順に上へ描くので、最後に動かしたカードが上（HX5）
  private setPending(ref: string, at: Pt, seq: number) {
    this.pending.delete(ref);
    this.pending.set(ref, { x: at.x, y: at.y, seq });
  }

  // 六角のファイルを初めて作る（固める）書き込みに入れる見ている位置（HX5）：見る位置そのものを変えていれば（viewMoved）今の位置（保存するときと同じ viewToSave）。
  //   変えていなければ渡さない（初期の位置のまま。開いただけの位置は保存しない決まりのとおり。四角でも、つまむだけでは見る位置を書かない）。
  //   viewTouched はつまみ始めただけでも立つので使わない。四角の計画は使わない
  private freezeView(): BoardView | undefined {
    return this.viewMoved ? { ...this.viewToSave() } : undefined;
  }

  // 読んだ・保存したボードを、鍵（「形:メモ」。操作を始めたときに取った鍵）で覚える。結果の形とメモが鍵と違えば捨てる（四角と六角の位置を混ぜない。HX5）
  //   いまの形とメモの鍵なら、いまの読み込み（this.loaded）にもする
  private setLoaded(key: string, result: LoadBoardResult) {
    if (boardKey(result.layout, result.memoId) !== key) return;
    this.known.delete(key);
    this.known.set(key, result);
    if (this.known.size > KNOWN_MAX) {
      const oldest = this.known.keys().next().value;
      if (oldest !== undefined) {
        this.known.delete(oldest);
        this.wrote.delete(oldest);
      }
    }
    if (this.memoId !== null && key === boardKey(this.shape, this.memoId)) this.loaded = result;
  }

  // 保存が終わった（できた・できなかった）。書いた回数を進め（途中の読み込みの返りを捨てるため）、できたら返りを覚える
  private settle(key: string, result: { ok: boolean; loaded?: LoadBoardResult }) {
    this.wrote.set(key, (this.wrote.get(key) ?? 0) + 1);
    if (result.ok && result.loaded) this.setLoaded(key, result.loaded);
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
        if (this.drag || this.marquee) return; // つまんでいる間・範囲選択の間は動かさない（座標がずれるため）
        if (this.menu?.isOpen) this.menu.close(); // メニューの位置がカードからずれるので、閉じてから動かす
        // 左の盤面と同じ：2 本指・ホイールは移動、ピンチ・Ctrl＋ホイールは拡大縮小（CB12）
        const plan = wheelPlan(e, this.stage.clientHeight);
        if (plan.kind === 'zoom') {
          const rect = this.stage.getBoundingClientRect();
          const zoom0 = this.view.zoom; // 倍率が実際に替わったら「［全体］の間」を終える（端で替わらないピンチでは終えない。パンでも終えない。MK2）
          this.view = zoomAt(this.view, plan.factor, e.clientX - rect.left, e.clientY - rect.top);
          if (this.view.zoom !== zoom0) this.endOverview('zoom');
        } else {
          this.view = panBy(this.view, -plan.dx, -plan.dy);
        }
        this.applyView();
        this.touchView();
        if (this.upperTimer !== 0) this.armGiveBack(); // ピンチで間を終えたあとの境目の戻しは、wheel が止まるまで待ち直す（MK3）
      },
      { passive: false },
    );
    // カードの右クリック：面の全体で 1 本で受ける（帯と道具の列にも標準のメニューを出さない）
    this.root.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    // 乗せた 1 枚だけ、説明に全文の頭と事実を書く（全カードには持たせない。顔の計算に入れない）
    this.stage.addEventListener('pointerover', (e) => {
      const hit = lineOfHit(e.target);
      const hover = hit ? (this.lineEls.find((l) => l.from === hit.from && l.to === hit.to) ?? null) : null;
      if (hover !== this.hoverLine) {
        this.hoverLine = hover;
        this.paintLineNames();
      }
      const cardEl = e.target instanceof Element ? e.target.closest<HTMLElement>('.memo-board-card') : null;
      if (!cardEl || (e.relatedTarget instanceof Node && cardEl.contains(e.relatedTarget))) return;
      const replies = this.source?.get()?.replies ?? [];
      const reply = replies.find((r) => r.id === cardEl.dataset.card);
      if (reply) cardEl.title = cardTip(replies, reply);
    });
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
      if (e.target instanceof Element && e.target.closest('input, button, select, .memo-board-callout-more')) return; // ボタン（吹き出しの頭・席の「＋n」も）と、押せない右上の札「＋n」の上では、パン・範囲選択・選びを外すを始めない（MK8b）
      if (!onCard && e.button === 0 && e.shiftKey && !this.space && idle) {
        this.startMarquee(e);
        return;
      }
      const wants = e.button === 1 || (e.button === 0 && (this.space || !onCard));
      if (!wants || this.pan || this.drag) return; // カードをつまんでいる間は、ほかの指で面を動かさない（取り消しで押した時の位置へ戻すため。HX3）
      this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, click: e.button === 0 && !this.space && !onCard, line: e.button === 0 && !this.space ? lineOfHit(e.target) : null, menu: this.menu?.isOpen === true };
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
          const plain = this.linkFrom === null && !p.line && !p.menu; // 空きそのものの押し（線をやめる押し・線の当たり・メニューを閉じるための押しは、ダブルクリックに数えない。TA7）
          if (this.linkFrom !== null) this.cancelLink();
          else if (p.line) this.openLineMenu(p.line.from, p.line.to, e.clientX, e.clientY); // 線を押して動かさず離した
          else this.setSelected(new Set());
          this.tapEmpty(e, plain);
        } else this.lastEmptyTap = null; // 動かした（面の移動）・空きのクリックでない：数え直す
      }
      this.dropDrag(e);
      this.finishMarquee(e);
      this.takeFocus(); // 右の検索の［上で開く］：つまむ・範囲選択の途中で待っていた頼みを、終えたここで当てる（MK4 の見直し。下の 3 か所も同じ）
    });
    this.stage.addEventListener('pointercancel', (e) => {
      if (this.pan && e.pointerId === this.pan.id) this.releasePan();
      if (this.drag && e.pointerId === this.drag.pointerId) this.cancelDrag();
      if (this.marquee && e.pointerId === this.marquee.id) this.cancelDrag();
      this.takeFocus();
    });
    this.stage.addEventListener('lostpointercapture', (e) => {
      if (this.drag && e.pointerId === this.drag.pointerId) this.cancelDrag();
      if (this.marquee && e.pointerId === this.marquee.id) this.cancelDrag();
      this.takeFocus();
    });
    window.addEventListener(
      'keydown',
      (e) => {
        this.menuEsc = e.key === 'Escape' && e.target instanceof Node && !!this.menu?.isOpen && this.menu.node.contains(e.target) ? e : null;
      },
      true,
    );
    // Esc の順：メニュー→見えている 📌（新しいほうから）→線をやめる→選びを外す。📌 があるときは、選びを外す段より先に捕まえる
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || e.defaultPrevented || this.hidden || this.menu?.isOpen || !this.pins.hasOpen(this.memoId)) return;
        if (this.dragging) return; // つまんで動かしている間・範囲選択の間は、先に取り消し（Esc の取り消しの道）へ通す（HX3）
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return; // 欄の Esc は欄のもの
        if (!this.keysAllowed(e.target) || this.templateKey !== null || this.fillOpen) return; // 下の帯・ボードから開いた小窓が先
        e.preventDefault();
        e.stopImmediatePropagation();
        this.pins.closeNewest(this.memoId);
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
      if (this.menu?.isOpen) return; // メニューが開いている間は、ボードのキーを効かせない（Delete で選んだカードを消さない。焦点がメニューの中でも外でも）
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
      const modal = this.modalOpen;
      if (this.cmds && boardKeyAction({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, isComposing: e.isComposing, repeat: e.repeat, typing: typingNow, busy: this.drag !== null || this.marquee !== null, modal }) === 'delete') {
        if (this.removeBtn.disabled || this.selected.size === 0) return;
        e.preventDefault();
        this.removeSelected();
        return;
      }
      // F2＝選んだカードを書き直す（CB14。書く欄・小窓が開いているときは開かない。文を失わない）
      if (e.key === 'F2' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && !e.isComposing && !e.repeat && !typingNow && !this.drag && !this.marquee) {
        e.preventDefault();
        if (modal) this.flash(tr('開いている欄や確かめを閉じてから書き直してください'), 'info');
        else this.startEdit();
        return;
      }
      // Shift＋←↑→↓＝隣のカードへ（CB14。ボタンに焦点があっても効く。端では動かない）
      if (BOARD_ARROW_DIR[e.key] && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing && !typingNow && !modal && !this.drag && !this.marquee) {
        e.preventDefault();
        const from = this.selected.size === 1 ? [...this.selected][0] : null;
        // 六角は ↑↓ の横の重みが 0.5、同点なら ↓ は右下・↑ は左上（HX4）。真ん中に近いカードは形の中心で測る
        const next = from !== null ? nearestInDirection(from, this.pos, BOARD_ARROW_DIR[e.key], this.geo.nearest) : centerMostCard(this.pos, this.view, this.viewport(), this.geo.center);
        const at = next !== null ? this.pos.get(next) : undefined;
        if (next !== null && at) this.showCard(next, at);
        return;
      }
      // ←↑→↓＝見ている場所を動かす（書く欄・ボタンにフォーカスがあるとき・小窓が開いているとき・つまんでいる最中は効かない）
      if (BOARD_ARROW_PAN[e.key] && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && !e.isComposing && !inField && !modal && !this.drag && !this.marquee) {
        e.preventDefault();
        const [dx, dy] = BOARD_ARROW_PAN[e.key];
        this.view = panBy(this.view, dx, dy);
        this.applyView();
        this.touchView();
        return;
      }
      // Enter＝カードを足す（［＋足す］を押したのと同じ。書く欄・ボタンにフォーカスがあるとき・小窓が開いているとき・つまんでいる最中・足せないときは効かない）
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && !e.isComposing && !e.repeat && !inField && !modal && !this.drag && !this.marquee) {
        if (this.toolsFolded && !this.tools.hidden && this.addBtn.disabled) this.flash(this.addBtn.title, 'warn'); // ボタンが隠れているので、足せない理由を一言で
        if (this.tools.hidden || this.addBtn.disabled) return;
        e.preventDefault(); // 開いた書く欄に、この Enter の改行が入らないように
        this.addBtn.click();
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
    // メニューキー・Shift+F10 で焦点がどこにも無いとき、contextmenu は body に届く（CB14）。ボードのキーが効くときだけ受ける（全体のキーにしない）
    document.addEventListener(
      'contextmenu',
      (e) => {
        if (e.target !== document.body && e.target !== document.documentElement) return;
        if (!isKeyboardMenu(e) || this.hidden || !this.keysAllowed(e.target) || this.menu?.isOpen || this.modalOpen || this.drag || this.marquee) return; // つまむ・範囲選択の間は開かない（右クリックと同じ。HX3）
        e.preventDefault();
        this.openMenuByKey();
      },
      true,
    );
    window.addEventListener('blur', () => {
      this.releaseSpace();
      this.cancelDrag();
      this.flushView();
      this.takeFocus(); // つまむのをやめた：待っていた頼みを当てる（MK4 の見直し）
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

  // 書く欄・整理の確かめ・線を引く途中・型の小窓のどれかが開いている（先にそちらを片づける）
  private get modalOpen(): boolean {
    return this.composing !== null || !this.tidyBar.hidden || this.linkFrom !== null || this.templateKey !== null || this.fillOpen;
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
    this.callouts.paintSelected(this.selected); // 吹き出しの頭の選んだ見た目（作り直さずに class を切り替える。MK8b）
    this.count.textContent = selectionCountText(this.total, this.selected.size);
    this.paintFacts();
    this.paintLinkSource();
    this.paintLineNames();
    this.paintTools();
    if (this.templateKey !== null && this.templateKey !== selectionKey(this.selected)) this.closeTemplate(); // 選び直したら、型の小窓は閉じる（数が変わるため）
  }

  // 見出しの行の事実：選んだカードが 1 枚のときだけ、枚数の隣に読むだけで出す（案内の文は変えない）
  private paintFacts() {
    const replies = this.source?.get()?.replies ?? [];
    const only = this.selected.size === 1 ? replies.find((r) => this.selected.has(r.id) && r.parent === null) : undefined;
    const text = only ? cardFacts(replies, only) : '';
    this.facts.textContent = text ? `｜${text}` : '';
    this.facts.title = text;
    this.facts.hidden = text === '';
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
    const past = pastThreshold({ dx: r.w, dy: r.h });
    if (past && this.marqueeEl.hidden && this.overview) this.callouts.later(); // 吹き出しは、範囲選択の枠が出たら隠す（Shift で押しただけでは隠さない。終えて止まってから置き直す。MK8a）
    this.marqueeEl.hidden = !past;
    this.marqueeEl.style.left = `${r.x}px`;
    this.marqueeEl.style.top = `${r.y}px`;
    this.marqueeEl.style.width = `${r.w}px`;
    this.marqueeEl.style.height = `${r.h}px`;
    this.setSelected(marqueeSelection(m.base, marqueeHits(this.view, a, at, this.pos, this.geo.box, this.geo.hits))); // 六角は多角形で当てる（HX4）
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
    const start = this.stagePoint(e);
    this.drag = { pointerId: e.pointerId, ref, els, sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, start, view0: { ...this.view }, inner: innerPoint(start, this.viewport()), panned: false, edgeAt: null, touched0: this.viewTouched, viewMoved0: this.viewMoved, shift0: this.composeShift, untouched0: this.composeUntouched, starts, pos: new Map(starts), moved: false, collapse: press.collapse };
    try {
      this.stage.setPointerCapture(e.pointerId);
    } catch {
      // 捕まえられなくても、この面に届いた移動で動く
    }
  }

  private moveDrag(e: PointerEvent) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.px = e.clientX;
    d.py = e.clientY;
    const p = this.dragPoint(d); // 面の位置はここで 1 回だけ測る
    d.inner = nextInner(d.inner, p, this.viewport()); // 面の中ほどに来た：このあと帯に入れば動き始めてよい（HX3）
    const delta = { dx: e.clientX - d.sx, dy: e.clientY - d.sy };
    if (!d.moved) {
      if (!pastThreshold(delta)) return;
      const blocked = moveBlockedNote(this.loaded);
      if (blocked) {
        this.flash(blocked, 'warn'); // 読めない・読み込み中（いまの形のファイル）：動かさない（選ぶことはできる）
        this.endDrag();
        return;
      }
      d.moved = true;
      this.viewTouched = true; // カードを動かしたのも「触った」に数える（面が替わっても計算し直さない。HX1）
      this.dropComposeShift(); // 書く欄を閉じても戻さない（HX2）
      if (this.overview) this.callouts.later(); // 吹き出しは、つまんでいる間は隠す（離して止まってから置き直す。MK8a）
      for (const node of d.els) node.classList.add('is-dragging');
      this.stage.classList.add('is-dragging');
    }
    this.followPointer(d, p);
    this.armEdgePan(d, p); // 端の帯に入っていれば、見ている位置を動かし始める（HX3）
  }

  // つまんでいる指の、面の左上からの点（今の面の位置で）
  private dragPoint(d: { px: number; py: number }): Pt {
    const rect = this.stage.getBoundingClientRect();
    return { x: d.px - rect.left, y: d.py - rect.top };
  }

  // つまんだカードを指の下に置く：押した点は押した時の見ている位置で、今の指の点（p）は今の見ている位置で、ボードの座標に直した差で動かす（端で見ている位置が動いても離れない。HX3）
  private followPointer(d: BoardDrag, p: Pt) {
    d.pos = groupDragBy(d.starts, dragBoardDelta(d.start, d.view0, p, this.view));
    this.placeCards(d.pos);
  }

  // つまんだまま端の帯にいれば、requestAnimationFrame で見ている位置を動かす（指が止まっていても動き続ける。始める条件は edgePan。HX3）
  private armEdgePan(d: BoardDrag, p: Pt) {
    if (!d.moved || this.edgeRaf !== 0) return;
    const step = edgePan(p, d.start, d.inner, this.viewport());
    if (step.dx === 0 && step.dy === 0) return;
    d.edgeAt = null; // 始めたこまは 1 こまぶん進める
    this.edgeRaf = window.requestAnimationFrame((time) => this.edgePanFrame(time));
  }

  // 1 こま：前のこまからの時間に合わせて見ている位置を動かし（edgeFrameMove・edgePanStep）、カードを指に付け直す。見ている位置は離したときに保存する
  //   帯から出た・カードの範囲や見ている位置の範囲の端で動けなくなったら、次のこまを頼まない（指がまた動けば armEdgePan が始める。つまみ終えたら endDrag が止める）
  private edgePanFrame(time: number) {
    this.edgeRaf = 0;
    const d = this.drag;
    if (!d || !d.moved) return;
    const p = this.dragPoint(d); // 面の位置はこのこまで 1 回だけ測る
    const step = edgePan(p, d.start, d.inner, this.viewport());
    const dt = d.edgeAt === null ? EDGE_FRAME_MS : time - d.edgeAt;
    d.edgeAt = time;
    const move = edgeFrameMove(step, dt);
    if (move.x === 0 && move.y === 0) {
      if (step.dx === 0 && step.dy === 0) return; // 帯から出た
      this.edgeRaf = window.requestAnimationFrame((time) => this.edgePanFrame(time)); // 時間が進んでいない：次のこまで動かす
      return;
    }
    const next = edgePanStep(this.view, move, d, p);
    if (!next) return; // カードの範囲・見ている位置の範囲の端で、どの向きにも動けない
    this.view = next;
    d.panned = true;
    this.applyView();
    this.followPointer(d, p);
    this.edgeRaf = window.requestAnimationFrame((time) => this.edgePanFrame(time));
  }

  // 描いている位置を変える（カードと、そのカードにつながる線）。何枚かをまとめて動かし、つながる線は 1 回に 1 本ずつだけ直す（端で動かす間は毎こま呼ぶので。HX3）
  //   線は今の曲線（geo.edge）。六角の迂回の道（geo.route）は、運ぶ間に道が跳ばないよう、軽く保つため使わない（離したあとの build で描き直す）
  private placeCards(moves: ReadonlyMap<string, Pt>) {
    for (const [ref, pos] of moves) {
      this.pos.set(ref, pos);
      const node = this.cardEls.get(ref);
      if (node) {
        node.style.left = `${pos.x}px`;
        node.style.top = `${pos.y}px`;
      }
    }
    for (const line of this.lineEls) {
      if (!moves.has(line.from) && !moves.has(line.to)) continue;
      const a = this.pos.get(line.from);
      const b = this.pos.get(line.to);
      this.paintLine(line, a && b ? this.geo.edge(a, b) : null);
    }
    this.pins.place();
  }

  // つまむのを終える道は、どれもここを通る（離す・取り消す・動かせない）。端で見ている位置を動かす requestAnimationFrame もここだけで止める（HX3）
  private endDrag() {
    window.cancelAnimationFrame(this.edgeRaf);
    this.edgeRaf = 0;
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
      this.clicks.reset(); // 動かしたあとの押しを、ダブルクリックの 1 回目に数えない
      if (d.panned) {
        this.touchView(); // 端で見ている位置も動いた：今のパンと同じ道で保存する（HX3）
        const at = d.pos.get(d.ref);
        if (at) this.slideToRead(at); // 面の外で離した：つまんだカードが読める所へ滑らせる（保存する）
      }
      const moves = [...d.pos].map(([ref, at]) => ({ ref, x: at.x, y: at.y }));
      const memoId = this.memoId;
      this.commitMove(moves, (ok) => {
        if (ok && memoId !== null && this.memoId === memoId) this.recordMove(moves, d.starts);
      });
      return;
    }
    if (d.collapse) this.setSelected(new Set([d.ref]));
    if (this.dirty) this.render();
    // ダブルクリック：同じカードを 400ms のうちに 2 回、動かさずに押して離した。1 回目の選びはもう効いている
    if (this.clicks.press(d.ref, Date.now()) !== null && !this.modalOpen) this.openCardMenu(d.ref, e.clientX, e.clientY, null);
  }

  // やめる（Esc・pointercancel・lostpointercapture・blur・隠れた・メモが替わった）：つまんでいたカードを元の位置に戻し、範囲選択は始める前の選択に戻す。
  //   端で見ている位置が動いていれば、押した時の位置へ戻す（HX3）。何も保存しない。何かをやめたら true
  cancelDrag(): boolean {
    let did = false;
    if (this.marquee) {
      this.endMarquee(true);
      did = true;
    }
    const d = this.drag;
    if (d) {
      const back = dragCancelPlan(d);
      if (back.positions) this.placeCards(back.positions);
      this.endDrag();
      if (back.view) {
        this.view = back.view; // 保存しない（touchView を通さない）
        this.applyView();
      }
      if (d.moved) {
        // 押した時の印に戻す（触った・見る位置を変えた・書く欄の寄せ）。つまんでいる間にできた寄せの印は捨てる（HX3・HX5）
        this.viewTouched = d.touched0;
        this.viewMoved = d.viewMoved0;
        this.composeShift = d.shift0;
        this.composeUntouched = d.untouched0;
      }
      const drawn = this.renderKey;
      if (this.dirty) this.render();
      if (back.positions && this.renderKey === drawn) this.routeLines(back.positions.keys()); // 元の位置に戻した線を迂回の道へ（build が呼ばれなかったとき）
      did = did || d.moved;
    }
    return did;
  }

  // after（B3-3b）：保存の結果を知らせる（保存できた・もう同じ位置だった＝true／できなかった・動かせなかった＝false）。必ず 1 回だけ呼ぶ。元に戻す・やり直しの記録に使う
  //   書く先は、いまの形のファイル（鍵は呼んだときの形。HX5）。六角は初めてなら固め、動かしたカードを nodes の最後へ（planBoardMoves）。元と同じ所なら書かない
  private commitMove(moves: { ref: string; x: number; y: number }[], after?: (ok: boolean) => void) {
    const memoId = this.memoId;
    const snap = this.source?.get() ?? null;
    if (!memoId || !snap || snap.memoId !== memoId) {
      this.render();
      after?.(false);
      return;
    }
    const layout = this.shape; // 書く先の形（鍵と、保存できなかった文の頭。HX5）
    const key = boardKey(layout, memoId);
    const first = planBoardMoves(this.loaded, snap.replies, moves, Date.now());
    if (!first.ok) {
      if (first.why === 'blocked') this.flash(moveBlockedNote(this.loaded) ?? tr('カードを動かせませんでした'), 'warn');
      this.render();
      after?.(false);
      return;
    }
    // 同じ場所に戻した：保存しない。ただし保存を待っているカードを含むときは、列に入れる（いまの読み込みは待っている保存の前の形なので、
    //   待っている位置から元へ戻したのに「同じ」と見えてしまう。列の中では待っている保存のあとの形と比べる。HX5。四角の前からの穴も同じ）
    if (!first.changed && !moves.some((m) => this.pending.has(m.ref))) {
      const drawn = this.renderKey;
      this.render();
      if (this.renderKey === drawn) this.routeLines(moves.map((m) => m.ref)); // 同じ所で離した：鍵が変わらず build が呼ばれないので、運ぶ間に今の曲線で描いた線を迂回の道へ
      after?.(true);
      return;
    }
    const token = ++this.seq;
    for (const m of moves) this.setPending(m.ref, m, token); // 保存が終わるまで、動かした位置のまま見せる
    const drawn = this.renderKey;
    this.render();
    if (this.renderKey === drawn) this.routeLines(moves.map((m) => m.ref)); // 待っている位置へそのまま戻して離した：鍵が変わらず build が呼ばれないので、運ぶ間に今の曲線で描いた線を迂回の道へ
    const replies = snap.replies; // 保存を待つ間にメモが替わっても、このメモの分として保存する
    const view = this.freezeView();
    this.enqueue(async () => {
      let ok = false;
      try {
        const base = this.known.get(key);
        const plan = planBoardMoves(base ?? null, replies, moves, Date.now(), { view });
        if (!base || !plan.ok) {
          if (this.memoId === memoId) this.flash(boardSaveMessage('unreadable', layout), 'warn');
          return;
        }
        if (!plan.changed) {
          ok = true;
          return;
        }
        const result = await saveBoard(boardPaneIo, base, plan.board);
        this.settle(key, result);
        ok = result.ok;
        const note = moveResultNote(result, layout);
        if (this.memoId === memoId) {
          if (note) this.flash(note.text, note.tone);
          else this.quietSuccess();
        }
      } catch {
        if (this.memoId === memoId) this.flash(boardSaveMessage('write', layout), 'warn');
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
  // うまくいった操作は一言を出さない（結果は面に見える）。前の失敗の文は残さない。左の知らせが出ていれば隠さない
  private quietSuccess() {
    if (!this.quietAfterNotice()) this.clearFlash();
  }
  // ---------- ボードでの編集（B2-3b）：足す・消す・書き直す・タグ・線 ----------

  private ask(action: RelayCommand) {
    this.cmds?.ask(action);
  }

  // 段 D4。選んだカードを材料に、依頼の小窓を開く（直接つながるカードは印を外して足す）。台帳は書かない
  private askSelected() {
    if (!this.memoId || this.selected.size === 0) return;
    this.ask({ command: 'askWithCards', memo: this.memoId, replies: [...this.selected], linked: 'one' });
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
      [this.askBtn, () => this.askSelected()],
      [this.pasteBtn, () => void this.openPasteMenu()],
      [this.tidyBtn, () => this.openTidy()],
      [this.shapeTool, () => this.toggleShape()], // 六角の切り替え（HX4。字は記号だけで、列を 1 行のまま）
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

    this.composeText.rows = 3; // 上の区画では 1 行から（paintComposeShape）
    this.composeText.maxLength = 2000;
    this.composeText.setAttribute('aria-label', 'カードの文');
    // 上の区画では、打つたびに 3 行まで伸ばす。変換の途中（IME）は高さを変えず、変換が終わってから合わせる。下の置き場では高さに触らない（HX2）
    this.composeText.addEventListener('compositionstart', () => {
      this.imeComposing = true;
    });
    this.composeText.addEventListener('compositionend', () => {
      this.imeComposing = false;
      this.growCompose();
    });
    this.composeText.addEventListener('input', (e) => {
      if (this.place !== 'upper' || this.imeComposing || (e instanceof InputEvent && e.isComposing)) return;
      this.growCompose();
    });
    this.composeText.addEventListener('input', () => this.reportComposeDraft()); // 書きかけの有無を左へ（上と下のどちらの置き場でも。変換の途中も。MK4）
    this.composeOk.type = 'submit';
    const cancel = el('button', 'memo-board-tool', tr('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.closeCompose());
    const actions = el('div', 'memo-board-compose-actions');
    const noLink = el('option', '', tr('なし'));
    noLink.value = '';
    this.linkKindSel.append(noLink, ...LINK_KINDS.map((k) => {
      const option = el('option');
      option.value = k.kind;
      return option;
    }));
    const kindText = el('span', '', tr('つなぐ'));
    kindText.append(el('span', 'memo-board-linkkind-note', tr('（Ctrl+Enter・Shift+Enter で足すとき）'))); // 上の区画では括弧の中を出さない（title に同じ説明がある。HX2）
    this.linkKindBox.append(kindText, this.linkKindSel);
    this.linkKindBox.hidden = true;
    // 書く欄の ♡（MK6）：押すたびに 1→2→3→なし。欄は form なので押しても送らない（type button）。押しで焦点を取らない（文の欄のまま続けて打てる。％の項目と同じ）
    this.composeLike.type = 'button';
    this.composeLike.title = COMPOSE_LIKE_TITLE;
    this.composeLike.hidden = true;
    this.composeLike.addEventListener('pointerdown', (e) => e.preventDefault());
    this.composeLike.addEventListener('click', () => {
      this.composeLikeLevel = nextLike(this.composeLikeLevel);
      this.paintComposeLike();
    });
    actions.append(this.composeOk, cancel, this.linkKindBox, this.composeLike, this.composeHint);
    this.compose.append(this.composeLabel, this.composeText, actions);
    this.compose.hidden = true;
    this.compose.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitCompose();
    });
    // 種類の欄に焦点があっても Esc・Ctrl+Enter が効くように、欄全体で受ける（CB13）
    this.compose.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      const inText = e.target === this.composeText;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // 欄の Esc は、この小窓を閉じるだけ（メモへ戻らない）
        this.closeCompose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (this.composing?.kind === 'add') this.submitAdd(this.composeText.value, 'right'); // 足すとき：選んだカードの右へ
        else this.submitCompose();
      } else if (inText && e.key === 'Enter' && e.shiftKey && !e.altKey && this.composing?.kind === 'add') {
        e.preventDefault(); // 足すとき：選んだカードの下へ（書き直すときの Shift+Enter は今までどおり改行）
        this.submitAdd(this.composeText.value, 'down');
      } else if (inText && e.key === 'Enter' && !e.shiftKey && !e.altKey && this.photoTitleFor !== null) {
        e.preventDefault(); // 写真の題は一行：Enter で決める
        this.submitCompose();
      } else if (
        inText &&
        !this.drag && // つまんでいる間は面を動かさない（HX3）
        emptyComposeArrowPan({
          key: e.key,
          text: this.composeText.value,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          isComposing: e.isComposing,
        }) &&
        BOARD_ARROW_PAN[e.key]
      ) {
        // 書く欄が空のときだけ：←↑→↓で見ている場所を動かす（字や空白があるときは、今までどおり欄の中でカーソルが動く）
        e.preventDefault();
        const [dx, dy] = BOARD_ARROW_PAN[e.key];
        this.view = panBy(this.view, dx, dy);
        this.applyView();
        this.touchView();
      }
    });

    const cancelLink = el('button', 'memo-board-tool', tr('やめる'));
    cancelLink.type = 'button';
    cancelLink.addEventListener('click', () => this.cancelLink());
    this.linkBar.setAttribute('role', 'status');
    this.linkBar.append(this.linkBarText, cancelLink);
    this.linkBar.hidden = true;

    const tidyOk = el('button', 'memo-board-tool is-primary', tr('決める'));
    tidyOk.type = 'button';
    tidyOk.addEventListener('click', () => this.runTidy());
    const tidyCancel = el('button', 'memo-board-tool', tr('やめる'));
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

  // 数えて片づけるのは、いまの形のファイルだけ（this.loaded。六角では文の頭に「六角の並びは、」。HX5）
  private openTidy() {
    const snap = this.source?.get() ?? null;
    if (!snap) return;
    const tb = tidyButton({ load: this.loaded, replies: snap.replies, busy: this.undoBusy });
    if (!tb.enabled) {
      this.flash(tb.count === 0 && this.loaded !== null && this.loaded.state !== 'unreadable' ? tidyNoneNote(this.shape) : tb.note, 'warn');
      return;
    }
    this.cancelLink();
    this.closeCompose();
    if (this.fillOpen) this.closeTemplate();
    this.tidyText.textContent = tidyConfirmMessage(tb.count, this.undo.has(['remove', 'paste']), this.shape);
    this.tidyBar.hidden = false;
    this.tidyOk?.focus();
  }

  private closeTidy(focusBack: boolean) {
    const was = !this.tidyBar.hidden;
    this.tidyBar.hidden = true;
    if (was && focusBack && !this.tidyBtn.disabled) this.tidyBtn.focus();
  }

  // 決めたとき：保存の直前の台帳で孤児を数え直し、孤児だけを落として 1 回保存する（積みには入れない・追加の控えは作らない）。いまの形のファイルだけ（HX5）
  private runTidy() {
    const memoId = this.memoId;
    this.closeTidy(false);
    if (!memoId) return;
    const shape = this.shape;
    const key = boardKey(shape, memoId);
    this.enqueue(async () => {
      try {
        const snap = this.source?.get() ?? null;
        const base = this.known.get(key);
        if (!snap || snap.memoId !== memoId) return;
        const plan = planTidy(base ?? null, snap.replies, Date.now());
        if (!plan.ok) {
          if (this.memoId === memoId) this.flash(plan.why === 'none' ? tidyNoneNote(shape) : tidyButton({ load: base ?? null, replies: snap.replies }).note, 'warn');
          return;
        }
        const result = await saveBoard(boardPaneIo, base as LoadBoardResult, plan.board);
        this.settle(key, result);
        if (this.memoId === memoId) this.flash(result.ok ? tidyDoneText(plan.removed, shape) : boardSaveMessage(result.why, shape), result.ok ? 'info' : 'warn');
      } catch {
        if (this.memoId === memoId) this.flash(boardSaveMessage('write', shape), 'warn');
      } finally {
        if (this.memoId === memoId) this.render();
      }
    });
  }
  // 選びと台帳に合わせて、道具の列・タグの行を描く（選びが変わった・写しが変わった・読み込みが終わったとき）
  private paintTools() {
    this.named(() => this.paintToolsBoard());
  }

  // 足す欄の「つなぐ」。選んだカードが 1 枚でないときは押せない。値はボードを開いている間だけ覚える
  private paintLinkKind() {
    const adding = this.composing?.kind === 'add';
    this.linkKindBox.hidden = !adding;
    if (!adding) return;
    for (const option of this.linkKindSel.options) {
      if (option.value) option.textContent = linkKindInfo(option.value as LinkKind).name;
    }
    const one = this.selected.size === 1;
    this.linkKindSel.disabled = !one;
    this.linkKindBox.title = one ? tr('選んだカードの横に足すとき、この種類の線も引きます（前のカード → 新しいカード）') : tr('選んだカードが 1 枚のときに使えます');
  }

  // 書く欄の ♡（MK6）：足す欄だけに出す。字は今の段（♡・♥1〜♥3）。押してあるか（段が付いているか）は aria-pressed
  private paintComposeLike() {
    this.composeLike.hidden = this.composing?.kind !== 'add';
    this.composeLike.textContent = likeButtonText(this.composeLikeLevel);
    this.composeLike.setAttribute('aria-pressed', String(this.composeLikeLevel > 0));
  }

  private paintToolsBoard() {
    this.paintLinkKind();
    this.paintComposeLike();
    this.paintShape(); // 切り替えのボタン（押している状態・止めている理由。HX4）
    const snap = this.source?.get() ?? null;
    const on = !!this.cmds && snap !== null && !this.hidden;
    this.tools.hidden = !on;
    if (!on || !snap) {
      this.orphanEl.hidden = true;
      this.closeTidy(false);
      this.tagRow.hidden = true;
      return;
    }
    const st = toolState({ selected: [...this.selected], replies: snap.replies, load: this.loaded, layout: this.shape }); // 六角（HX4）では型の 2 つを押せない
    const set = (btn: HTMLButtonElement, b: { enabled: boolean; note: string }) => {
      btn.disabled = !b.enabled;
      btn.title = b.note;
      btn.setAttribute('aria-label', `${btn.textContent ?? ''}。${b.note}`);
    };
    this.removeBtn.textContent = st.remove.label;
    set(this.addBtn, st.add);
    set(this.editBtn, st.edit);
    this.editBtn.title = `${st.edit.note}（F2）`;
    this.editBtn.setAttribute('aria-keyshortcuts', 'F2');
    set(this.removeBtn, st.remove);
    this.removeBtn.setAttribute('aria-keyshortcuts', KEYSHORTCUTS.remove);
    this.undoBtn.setAttribute('aria-keyshortcuts', KEYSHORTCUTS.undo);
    this.redoBtn.setAttribute('aria-keyshortcuts', KEYSHORTCUTS.redo);
    set(this.linkAddBtn, st.linkAdd);
    set(this.linkRemoveBtn, st.linkRemove);
    set(this.templateBtn, st.template);
    const askNote = this.selected.size === 0 ? tr('先にカードを選んでください') : ASK_SELECTED_NOTE;
    this.askBtn.disabled = this.selected.size === 0;
    if (!BOT_FEATURES) this.askBtn.style.display = 'none'; // 公開版（rebuild-public.ps1）
    this.askBtn.title = askNote;
    this.askBtn.setAttribute('aria-label', `Grok に頼む。${askNote}`);
    set(this.pasteBtn, st.paste);
    this.pasteBtn.setAttribute('aria-haspopup', 'menu');
    // 次に戻す・やり直す操作を始めたときの形が今と違えば、押せない（その形に戻すと戻せる。HX4）
    const ub = undoButtons({ undo: this.undo.peekUndo(), redo: this.undo.peekRedo(), busy: this.undoBusy, load: this.loaded, layout: { now: this.shape, undo: this.undo.peekLayout('undo'), redo: this.undo.peekLayout('redo') } });
    set(this.undoBtn, ub.undo);
    set(this.redoBtn, ub.redo);
    // ［整理］と「消したカードの位置が n 件残っています」は、いまの形のファイルの話（六角では頭に「六角の並びは、」。HX5）
    const tb = tidyButton({ load: this.loaded, replies: snap.replies, busy: this.undoBusy });
    set(this.tidyBtn, tb);
    this.orphanEl.textContent = orphanNoteText(tb.count, this.shape);
    this.orphanEl.hidden = tb.count === 0;
    if (!this.tidyBar.hidden) {
      if (tb.count === 0) this.closeTidy(false); // 整理するものが無くなった（戻した・もう整理した）
      else this.tidyText.textContent = tidyConfirmMessage(tb.count, this.undo.has(['remove', 'paste']), this.shape);
    }
    this.paintTagRow(snap.replies, st.tags && this.composing === null);
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
        what: ids.length > 1 ? tr('選んだ {0} 枚のカード', { 0: ids.length }) : tr('このカード'),
        change: (add, remove) => this.changeTags(ids, add, remove),
      },
      { editable: true, focusKey: 'board:', toast: (text) => this.flash(text, 'warn'), candidates: cardTagCandidates(replies, [], registeredTagNames()) },
    );
    this.tagRow.replaceChildren(el('span', 'memo-board-tagrow-label', tr('タグ')), area);
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

  private openCompose(mode: ComposeMode, text: string) {
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
    this.showCompose(mode, text);
    this.composeText.focus();
  }

  private showCompose(mode: ComposeMode, text: string, photoTitle = false) {
    this.composeAt = null; // 欄を入れ替えたら、「ここに書く」の置き場は持ち越さない（TA4b）
    this.composing = mode;
    this.photoTitleFor = photoTitle && mode.kind === 'edit' ? mode.id : null;
    this.composeLabel.textContent = this.photoTitleFor !== null ? PHOTO_TITLE_LABEL : mode.kind === 'add' ? COMPOSE_ADD_LABEL : tr('カードの文を書き直す');
    this.composeText.value = text;
    this.composeLikeLevel = 0; // 書く欄の ♡ は開くたびに なし から（足す欄から書き直しの欄へ替えたときも持ち越さない。断られた文を戻すときは showRefused が戻す。MK6）
    this.imeComposing = false; // 前の変換の印を持ち越さない（HX2）
    this.composeUntouched = true;
    this.compose.hidden = false;
    this.paintTools(); // 書く欄の間はタグの行を畳む（つなぐの箱もここで出し入れするので、欄の幅が決まってから高さを測る）
    this.paintComposeShape();
    this.shiftForCompose(); // 面が低くなった：目当てのカードが半分以下しか見えていなければ寄せる（HX2）
    this.reportComposeDraft(); // 開いた（書き直し・断られた文を戻した・写真の題）：書きかけの有無を左へ（MK4）
  }

  // 書く欄の形（HX2）：上の区画では 1 行から 3 行まで伸びる細い欄にし、見出しと案内の文は欄の title へ（CSS で隠す）。プレースホルダーは短い字だけ
  //   上の区画では［決める］の字を形に合わせる（足す・書き直す・写真の題）。下の置き場は今のまま（3 行・見出しが見える。足す欄の title に置き場の決まりだけ）
  //   足す置き場の説明は四角と六角で同じ字（六角の「下」は右下か左下。HX5）
  private paintComposeShape() {
    const slim = this.place === 'upper';
    const kind = this.photoTitleFor !== null ? 'photo' : this.composing?.kind === 'edit' ? 'edit' : 'add';
    const label = this.composeLabel.textContent ?? '';
    const place = kind === 'add' ? COMPOSE_ADD_PLACE : '';
    this.composeText.rows = slim ? 1 : 3;
    this.composeText.placeholder = slim ? COMPOSE_SHORT[kind] : '';
    this.composeText.title = slim ? [label, place, COMPOSE_HINT].filter((s) => s !== '').join('。') : place;
    this.composeOk.textContent = slim ? COMPOSE_OK[kind] : COMPOSE_OK.add;
    this.fitComposeText();
  }

  // 上の区画の書く欄の高さを、字に合わせる（1 行から 3 行。composeTextHeight）。高さが変わったら true
  //   変換の途中は何もしない（compositionend のあとで合わせる）。空なら測らずに 1 行。測る間はスクロールバーを出さない（折り返しの幅を変えない）
  //   下の置き場・閉じているときは、自分で決めた高さ（composeFitted）だけを外す（下で手で広げた高さには触らない）
  private fitComposeText(): boolean {
    if (this.imeComposing) return false;
    const t = this.composeText;
    const before = t.style.height;
    if (this.place !== 'upper' || this.compose.hidden) {
      if (this.composeFitted) {
        t.style.height = '';
        this.composeFitted = false;
      }
      return t.style.height !== before;
    }
    let height = composeTextHeight(0);
    if (t.value !== '') {
      const overflow = t.style.overflowY;
      t.style.overflowY = 'hidden';
      t.style.height = 'auto';
      height = composeTextHeight(t.scrollHeight);
      t.style.overflowY = overflow;
    }
    t.style.height = `${height}px`;
    this.composeFitted = true;
    return t.style.height !== before;
  }

  // 欄の高さを合わせ、変わったとき、欄を開いてから触っていなければ、目当てをもう一度寄せる（戻す先は初めの位置のまま。HX2）
  private growCompose() {
    if (this.fitComposeText() && this.composeUntouched && !this.compose.hidden) this.shiftForCompose();
  }

  // 書く欄を開いて面が低くなったとき：目当て（書き直しているカード → 1 枚の選び → 最後に書いたカード）を、読める所へ一時的に寄せる（composeView。保存しない）
  private shiftForCompose() {
    if (this.hidden || this.needFit || this.drag?.moved) return; // つまんで動かしている間は寄せない（取り消しで押した時の位置へ戻すため。HX3）
    const editing = this.composing?.kind === 'edit' ? this.composing.id : null;
    const selected = this.selected.size === 1 ? [...this.selected][0] : null;
    const next = composeView(this.view, this.source?.get()?.replies ?? [], this.faces, this.viewport(), { editing, selected, readBox: this.readBox });
    if (!next) return;
    if (!this.composeShift) this.composeShift = { before: this.view }; // 二度目に寄せても、戻す先は初めの位置
    this.view = next;
    this.applyView();
  }

  // 書く欄を閉じた：寄せてから触っていなければ、寄せる前の位置に戻す（保存しない。HX2）
  private restoreAfterCompose() {
    const shift = this.composeShift;
    this.composeShift = null;
    if (!shift || this.hidden || this.needFit) return;
    this.view = shift.before;
    this.applyView();
  }

  // 書く欄で寄せた印と、開いてから触っていない印を下ろす（触った・見ている位置が自分で替わった・隠した・メモを替えた。閉じても戻さない。HX2）
  private dropComposeShift() {
    this.composeShift = null;
    this.composeUntouched = false;
  }

  // 書く欄を閉じたあとの見ている位置（寄せていて、まだ触っていなければ、戻す前の位置）。足す・貼る場所を決めるときと、見ている位置を保存するときに使う
  private viewAfterClose(): BoardView {
    return this.composeShift?.before ?? this.view;
  }

  // 見ている位置を保存するときの位置：つまんだまま端で動いている間は押した時の位置（取り消すと戻るため。離したときに touchView で今の位置を保存する。HX3）。ほかは viewAfterClose
  private viewToSave(): BoardView {
    return this.drag?.panned ? this.drag.view0 : this.viewAfterClose();
  }

  // 書く欄を閉じたあとの面の大きさ（見込み）：今の面に書く欄の高さを足す。閉じたあとにタグの行が戻る分は引かない（近似のまま。足したあとの slideToRead が埋め合わせる）
  private closedViewport(): { w: number; h: number } {
    const vp = this.viewport();
    return { w: vp.w, h: vp.h + (this.compose.hidden ? 0 : this.compose.offsetHeight) };
  }

  // 足したカードが読めていなければ、読める所へ滑らせる（showCard と同じく滑らせて保存する。HX2）
  //   目当ては geo の slideBox（四角は読む箱。六角は箱が面に入らない低い面では文の帯。箱の上の端に合わせると帯が半分しか見えず、足すたびに縦に動くため。HX5）
  private slideToRead(at: Pt) {
    const vp = this.viewport();
    this.slideTo(viewToRead(this.view, this.geo.slideBox(at, this.view.zoom, vp), vp));
  }

  // 見ている位置を next へ滑らせて保存する。つまんで動かしている間・範囲選択の途中は動かさない（取り消しで押した時の位置へ戻すため・範囲が面の動きでずれないため。HX3・HX5）
  private slideTo(next: BoardView | null) {
    if (!next || this.drag?.moved || this.marquee) return;
    this.slide();
    this.view = next;
    this.applyView();
    this.touchView();
  }

  // 左に断られた文を欄へ戻す（文を失わない）。書いている最中の欄は壊さず、閉じたときに戻す
  private returnDraft(mode: ComposeMode, text: string) {
    if (canReturnDraft(this.composing, this.composeText.value)) {
      // 空の足す欄で押してあった ♡ は残す（開き直すと なし に戻るため。断られた文に ♡ があれば、すぐあとの returnLike がそちらにする。MK6 の見直し）
      const kept = this.composing?.kind === 'add' ? this.composeLikeLevel : 0;
      this.showRefused(mode, text, kept);
    } else this.refusedDrafts.push({ mode, text });
    this.reportComposeDraft(); // 断られた文を戻した・待たせた：書きかけの有無を左へ（MK4）
  }

  // 書く欄に書きかけがあるか（composeHasDraft。足す欄の字・書き直しの欄・断られて待っている文。写真の題は字があるときだけ）を、変わったときだけ左へ知らせる（MK4）。
  //   左は、ボードを別のメモへ替える前（「上のコメントボードで開く」・右の検索の［上で開く］）に見る。替えると欄が閉じて書きかけが消えるため
  private reportComposeDraft() {
    const busy = composeHasDraft({ open: this.composing, text: this.composeText.value, photoTitle: this.photoTitleFor !== null, waiting: this.refusedDrafts.length });
    if (busy === this.composeDraftSent) return;
    this.composeDraftSent = busy;
    this.ask({ command: 'boardComposeDraft', busy });
  }

  // like：足す欄の ♡（MK6。closeCompose は待たせた文の ♡、returnDraft は空の足す欄で押してあった ♡ を渡す。書き直しの欄では出ない）
  private showRefused(mode: ComposeMode, text: string, like: 0 | LikeLevel = 0) {
    this.showCompose(returnMode(mode, this.source?.get()?.replies ?? []), text);
    if (like > 0 && this.composing?.kind === 'add') {
      this.composeLikeLevel = like;
      this.paintComposeLike();
    }
    this.focusComposeIfFree();
  }

  // 断られて戻した足す欄の文に、足すときに読んだ ♡ も戻す（MK6）。queued：returnDraft を呼ぶ前の、待っている文の数
  //   待たせたなら（書いている最中の欄があった）、その文に付けておく（欄が閉じて出すとき closeCompose が戻す）。欄に出したなら、その欄へ
  private returnLike(like: 0 | LikeLevel, queued: number) {
    if (like === 0) return;
    if (this.refusedDrafts.length > queued) this.refusedDrafts[this.refusedDrafts.length - 1].like = like;
    else if (this.composing?.kind === 'add') {
      this.composeLikeLevel = like;
      this.paintComposeLike();
    }
  }

  // 焦点はどこにも無いときだけ欄へ（下の帯やほかの欄を使っている最中は奪わない）
  private focusComposeIfFree() {
    const active = document.activeElement;
    if ((!active || active === document.body) && this.keysAllowed(active)) this.composeText.focus();
  }

  private closeCompose() {
    const wasOpen = this.composing !== null;
    this.composing = null;
    this.composeAt = null;
    this.photoTitleFor = null;
    this.compose.hidden = true;
    this.composeText.value = '';
    this.composeLikeLevel = 0; // ♡ も なし へ（足したら 1 回ごとに戻る。MK6）
    this.imeComposing = false; // 変換の途中で閉じても印を残さない（HX2）
    this.composeUntouched = false;
    this.fitComposeText(); // 閉じたら、自分で決めた高さを外す
    this.restoreAfterCompose(); // 面が戻った：寄せてから触っていなければ、寄せる前の位置へ（HX2）
    const waiting = this.refusedDrafts.shift();
    if (waiting) this.showRefused(waiting.mode, waiting.text, waiting.like);
    else if (wasOpen) this.paintTools(); // 畳んでいたタグの行を戻す
    this.reportComposeDraft(); // 閉じた（待っていた文を戻したあと。メモの替えもここを通る）：書きかけの有無を左へ（MK4）
  }

  private submitCompose() {
    const mode = this.composing;
    if (!mode) return;
    const text = this.composeText.value;
    if (this.photoTitleFor !== null && text.trim() === '') {
      this.closeCompose(); // 題を付けずに閉じる（空のカードのまま）
      return;
    }
    if (mode.kind === 'add') this.submitAdd(text);
    else this.submitEdit(mode.id, text);
  }

  // カードを足す：id を先に決めて命令に入れる（B2-3a）。左の写しにそのカードが現れてから、座標を保存する（断られたら何も書かない）
  // dir：Ctrl+Enter は右・Shift+Enter は下。選んだカードが 1 枚のときだけその横へ（ないとき・空きがないときは、四角は今までどおり真ん中、六角は［決める］と同じ置き方。HX5）
  //   書く先は、足し始めたときの形のファイル（鍵は始めたときの形。結果を待つ間は形を替えない）。六角は初めてなら固める（planBoardMoves。HX5）
  private submitAdd(text: string, dir?: 'right' | 'down') {
    const like = this.composeLikeLevel; // 書く欄の ♡（MK6）。closeCompose で なし に戻る前に読む
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
      this.flash(id ? tr('文が空です') : tr('カードの id を決められませんでした。もう一度お試しください'), 'warn');
      return;
    }
    const anchorId = dir && this.selected.size === 1 ? [...this.selected][0] : undefined;
    const link = addLinkFrom({ dir, anchor: anchorId, kind: this.linkKindSel.value as LinkKind | '' });
    const anchor = anchorId !== undefined ? this.pos.get(anchorId) : undefined;
    const taken = takenSpots(this.pos, this.pending); // 描いている位置と、保存を待っていてまだ描いていない位置（結果を待つ間に続けて足したカードを重ねない。HX5）
    // 置き場は、書く欄を閉じたあとの面と見ている位置で決める（開いたままの低い面で決めると、カードが本来の真ん中より上に出る。寄せていれば戻したあとの位置）
    // 向きの無い足し方（［決める］）：最後に書いたカードが半分より多く見えていれば、その右か下。だめなら真ん中から（addSpot。HX2）
    // 形ごとの箱・歩み・重なり・横に置けないときの置き方は geo の口（六角は右 x＋166、下は右下か左下・Shift+Enter は縦のジグザグ。重なりは六角どうし。HX5）
    const geo = this.geo;
    const key = boardKey(geo.layout, memoId);
    const lastFace = lastWritten(snap.replies, this.faces); // 向きのある足し方で使うのは、横に置けないときの六角だけ（四角の addSpot は使わない）
    const last = lastFace ? (this.pos.get(lastFace.id) ?? lastFace) : null;
    // 「ここに書く」の欄（composeAt。TA4b）：［決める］・Ctrl+Enter・Shift+Enter のどれでも、押した所に置く（ふさがっていれば近くの升。addSpot の at）。線の決まりは今のまま
    const spot = addSpot({ at: this.composeAt ?? undefined, dir, anchor, last, view: this.viewAfterClose(), viewport: this.closedViewport(), taken, size: geo.box, step: geo.step, overlaps: geo.overlaps, besideFallback: geo.besideFallback });
    if (!spot) {
      this.flash(tr('置ける空きが見つかりませんでした（見ている場所を動かしてからお試しください）'), 'warn');
      return;
    }
    this.closeCompose();
    const token = ++this.seq;
    this.setPending(id, spot, token); // 現れたときに、仮の位置を経ず置く場所に出す
    this.placing += 1; // 結果を待つ間は形を替えない（HX4）
    this.ask(cmd);
    this.watch(memoId, (rs) => cardAppeared(rs, id), (ok) => {
      this.placing -= 1;
      if (!ok) {
        if (this.pending.get(id)?.seq === token) this.pending.delete(id);
        if (this.memoId === memoId) {
          if (!this.quietAfterNotice()) this.flash(tr('カードを足せませんでした（左が断ったか、時間がかかっています。足せていなければ、もう一度お試しください）'), 'warn');
          const queued = this.refusedDrafts.length;
          this.returnDraft({ kind: 'add' }, text);
          this.returnLike(like, queued); // ♡ も戻す（MK6）
          this.render();
        }
        return;
      }
      this.setSelected(new Set([id]));
      // 足したカードが読めていなければ、読める所へ滑らせる（保存する。どの足し方でも・四角と六角の両方。HX2 は［決める］だけだったが、上の区画の面 217 では下に足したカードが見えないため。HX5）
      if (this.memoId === memoId) this.slideToRead(this.pos.get(id) ?? spot);
      const replies = this.source?.get()?.replies ?? [];
      this.pushUndo({ kind: 'add', id, text: replies.find((r) => r.id === id)?.text ?? text, at: { x: spot.x, y: spot.y } }, geo.layout);
      // 足す → 線 → いいね の一本の順（MK6）：線を引くなら、線の見張りが終わってから drawAddedLink がいいねを送る。線が無ければ、すぐ
      if (link) this.named(() => this.drawAddedLink(memoId, link.from, id, link.kind, like));
      else this.likeAdded(memoId, id, like);
      const view = this.freezeView(); // 滑らせたあとの位置（六角のファイルを初めて作るときに入れる）
      this.enqueue(async () => {
        try {
          const base = this.known.get(key);
          // 足す道は、仮の番と同じ所でも書く（六角は初めてなら固める。計画 §6.2 の 2「初めて動かす・足すとき」。HX5）
          const plan = planBoardMoves(base ?? null, replies, [{ ref: id, x: spot.x, y: spot.y }], Date.now(), { writeSame: true, view });
          if (!base || !plan.ok) {
            if (this.memoId === memoId) this.flash(tr('カードは足しましたが、位置は保存できませんでした'), 'warn');
            return;
          }
          if (!plan.changed) {
            if (this.memoId === memoId) this.quietSuccess(); // もうその位置にある：書かずに静かに終える
            return;
          }
          const result = await saveBoard(boardPaneIo, base, plan.board);
          this.settle(key, result);
          if (this.memoId === memoId) {
            if (result.ok) this.quietSuccess();
            else this.flash(tr('カードは足しましたが、{0}', { 0: boardSaveMessage(result.why, geo.layout) }), 'warn');
          }
        } catch {
          if (this.memoId === memoId) this.flash(tr('カードは足しましたが、位置は保存できませんでした'), 'warn');
        } finally {
          if (this.pending.get(id)?.seq === token) this.pending.delete(id);
          if (this.memoId === memoId) this.render();
        }
      });
    });
  }

  // 足したカードへ線を引く（CB13）。断られてもカードは残す。線を送ってから積むまでの間は Ctrl+Z を受けない（カードの Undo が線より先に走らないように）
  //   like：書く欄の ♡（MK6）。線が終わってから（引けなかったときも）続けて likeAdded へ（足す → 線 → いいね の一本の順。Ctrl+Z の止め undoHeld は同じ手番のうちに渡す）
  private drawAddedLink(memoId: string, from: string, to: string, kind: LinkKind, like: 0 | LikeLevel = 0) {
    const replies = this.source?.get()?.replies ?? [];
    const plan = linkAddPlan(replies, memoId, from, to, kind);
    if (!plan.ok) {
      this.flash(tr('カードは足しましたが線は引けませんでした（{0}）', { 0: plan.note }), 'warn');
      this.noticeAt = Date.now(); // すぐあとの位置の保存の成功で、この一言を消さない
      this.likeAdded(memoId, to, like);
      return;
    }
    this.undoHeld += 1;
    this.paintTools();
    this.ask(plan.command);
    this.watch(memoId, (rs) => linkIs(rs, from, to, kind), (ok) => {
      this.undoHeld -= 1;
      if (this.memoId === memoId) {
        if (ok) this.pushUndo({ kind: 'link', from, to, before: null, after: kind });
        else if (!this.quietAfterNotice()) this.flash(tr('カードは足しましたが線は引けませんでした'), 'warn');
      }
      this.paintTools();
      this.likeAdded(memoId, to, like);
    });
  }

  // 書く欄の ♡ で、足したカードにいいねを付ける（MK6）。足したカードが写しに現れ、線の後送りが終わってから呼ぶ（線が無ければ足したすぐあと）。
  //   送ってから積むまでの間は Ctrl+Z を受けない（線と同じ。積む順を 足す → 線 → いいね に保つ。足したカードを消すまでの Ctrl+Z は最大 3 回）。断られてもカードは残す。
  //   右クリックの setMark とは別の道（setMark は undoBusy を持たない。線の見張りと取り合わないように）。成功の一言は出さず、前の文も消さない（線の断りの一言を残す）。
  //   同じカードの印の結果を待っていれば（markWaits）、その次に回す（押しが早いときの setMark と同じ）
  private likeAdded(memoId: string, id: string, like: 0 | LikeLevel) {
    if (like === 0 || this.memoId !== memoId) return;
    const snap = this.source?.get() ?? null;
    if (!snap || snap.memoId !== memoId) return;
    const value = likeTag(like);
    const key = markWaitKey(memoId, id, 'like');
    const waiting = this.markWaits.get(key);
    if (waiting) {
      waiting.next = value === waiting.value ? null : value;
      return;
    }
    const before = markNow(snap.replies, id, 'like');
    if (before === null || before === value) return;
    if (markFull(snap.replies, id, 'like', value, MAX_TAGS_PER_TAB)) {
      this.flash(markFullNote('like', MAX_TAGS_PER_TAB), 'warn');
      return;
    }
    this.markWaits.set(key, { value, next: null });
    this.undoHeld += 1;
    this.paintTools();
    this.ask(markCommand(memoId, id, 'like', value));
    this.watch(memoId, (rs) => markStateIs(rs, id, 'like', value), (ok) => {
      const next = this.markWaits.get(key)?.next ?? null;
      this.markWaits.delete(key); // メモが替わって終えたときも解く
      this.undoHeld -= 1;
      if (this.memoId === memoId) {
        if (ok) this.pushUndo({ kind: 'mark', id, mark: 'like', before, after: value });
        else if (!this.quietAfterNotice()) this.flash(tr('タグを変えられませんでした'), 'warn');
      }
      this.paintTools();
      if (next !== null && this.memoId === memoId) this.setMark(id, 'like', next);
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
      this.flash(tr('カードがもうありません'), 'warn');
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
      if (ok) {
        this.quietSuccess();
        return;
      }
      if (!this.quietAfterNotice()) this.flash(tr('書き直せませんでした'), 'warn');
      this.returnDraft({ kind: 'edit', id }, text);
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
    // 戻すときの位置（いまの形の位置）。六角はファイルに位置のあるカードだけ（仮のカードは戻すと仮の並びに出る。固める前に消すと後ろが詰まるため。HX5）
    const at = removeAt(ids, this.faces, this.shape);
    for (const cmd of deleteCommands(memoId, snap.replies, ids, token)) this.ask(cmd);
    this.setSelected(new Set());
    this.placing += 1; // 結果を待つ間は形を替えない（HX4）
    this.watch(memoId, (rs) => cardsGone(rs, ids), (ok) => {
      this.placing -= 1;
      if (this.memoId !== memoId) return;
      const gone = ids.filter((id) => cardsGone(this.source?.get()?.replies ?? [], [id]));
      if (gone.length > 0) this.pushUndo({ kind: 'remove', ids: gone, at, token });
      if (ok) this.flash(ids.length > 1 ? tr('{0}枚を削除しました（Ctrl+Z で戻せます）', { 0: ids.length }) : tr('削除しました（Ctrl+Z で戻せます）'), 'info');
      else if (!this.quietAfterNotice()) this.flash(tr('消せなかったカードがあります'), 'warn');
    });
  }

  // ---- タグ（選んだ全部に） ----

  // done（省略できる）：結果が分かったときに呼ぶ（同じメモのままのときだけ。送らなかった・上限で断ったときは呼ばない）
  private changeTags(ids: readonly string[], add: string[], remove: string[], done?: (ok: boolean) => void) {
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    if (!snap || !memoId) return;
    const cmds = tagCommands(memoId, snap.replies, ids, add, remove);
    if (cmds.length === 0) return;
    const full = add.reduce((n, tag) => Math.max(n, tagFullCount(snap.replies, ids, tag, MAX_TAGS_PER_TAB)), 0);
    if (full > 0) this.flash(tr('タグは 1 つに {0} 個までです（{1} 枚には付けられません。ほかのタグを外してから付けてください）', { 0: MAX_TAGS_PER_TAB, 1: full }) + tagFullMarkNote(snap.replies, ids, add, MAX_TAGS_PER_TAB), 'warn');
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
        if (ok) this.quietSuccess();
        else if (!this.quietAfterNotice()) this.flash(tr('タグを変えられませんでした'), 'warn');
        done?.(ok);
      },
    );
  }

  // ---- 線（1 枚を選んで足す・外す） ----

  private startLink() {
    const snap = this.source?.get() ?? null;
    if (!snap) return;
    const ids = liveSelection(snap.replies, [...this.selected]);
    if (ids.length !== 1) {
      this.flash(ids.length === 0 ? tr('先にカードを 1 枚選んでください') : tr('1 枚だけ選んでください'), 'warn');
      return;
    }
    this.closeCompose();
    const from = snap.replies.find((r) => r.id === ids[0]);
    if (!from) return;
    this.linkFrom = ids[0];
    this.linkBarText.textContent = tr('「{0}」の相手のカードを押してください（Esc でやめる）', { 0: cardLabel(from, 16) });
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
    const first = this.menu === null;
    this.menu ??= new CellMenu({ stopEsc: true }); // Esc はメニューを閉じるだけ（選びを外す・メモのタブへ移る・区画を閉じる、へ進まない）
    if (first) {
      // メニューは body の下で面の受け口に来ないので、項目の上の右クリックはここで止める（全文の囲みの上は標準のメニューを残す。選んでコピーできるように。
      //   メニューの中の欄〈新しいタグの欄など〉の上も残す。貼り付けられるように）
      this.menu.node.addEventListener('contextmenu', (e) => {
        if (!(e.target instanceof Element && (e.target.closest('.cell-menu-note') || e.target.closest('input, textarea')))) e.preventDefault();
      });
    }
    return this.menu;
  }

  // ---------- カードのメニュー（読む＋行く。CB4） ----------

  private onContextMenu(e: MouseEvent) {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('input, textarea, select, [contenteditable]')) return; // 文字の欄は標準のメニューを残す
    e.preventDefault();
    if (this.drag || this.marquee || this.pan) return;
    if (this.linkFrom !== null) {
      this.cancelLink();
      return;
    }
    if (isKeyboardMenu(e)) {
      if (!this.modalOpen && !this.menu?.isOpen) this.openMenuByKey();
      return;
    }
    const line = lineOfHit(target);
    if (line) {
      this.openLineMenu(line.from, line.to, e.clientX, e.clientY);
      return;
    }
    const id = target?.closest<HTMLElement>('.memo-board-card')?.dataset.card ?? this.cardNearPoint(e, target); // 縁のすぐ外は、そのカード（TA4b）
    if (!id) {
      this.openBoardMenu(e, target); // 空きのメニュー（面の中だけ。TA4b）
      return;
    }
    if (!this.selected.has(id)) this.setSelected(new Set([id])); // 選びの中のカードは選びを保つ
    this.openCardMenu(id, e.clientX, e.clientY, null);
  }

  private cardMenuInput(id: string, x: number, y: number, from: string | null): CardMenuInput | null {
    const snap = this.source?.get() ?? null;
    if (!snap) return null;
    const replies = snap.replies;
    const image = replies.find((r) => r.id === id)?.image;
    return {
      replies,
      id,
      upper: this.place === 'upper',
      other: this.source?.info?.()?.other ?? false,
      picture: image ? this.shotUrls.get(image) : undefined,
      from: from ? replies.find((r) => r.id === from) : undefined,
      picked: menuPicked(replies, [...this.selected], id), // ［削除］の字（選びの中なら選びの数。MK1）
      actions: this.cardMenuActions(id, x, y, from),
    };
  }

  // 関連の呼び名は別のメモのものになるので、組むのは this.named の中
  private cardMenuItems(id: string, x: number, y: number, from: string | null): MenuEntry[] {
    const input = this.cardMenuInput(id, x, y, from);
    return input ? this.named(() => cardMenuEntries(input)) : [];
  }

  // キーで開く：選んだ 1 枚（無ければ見えている真ん中に近いカード）を見せて、右横に開く（CB14）
  private openMenuByKey() {
    const id = this.selected.size > 0 ? [...this.selected][0] : centerMostCard(this.pos, this.view, this.viewport(), this.geo.center);
    if (id === null) return;
    if (this.selected.size > 1) {
      const at = this.pos.get(id);
      if (!at) return;
      const rect = this.stage.getBoundingClientRect();
      const anchor = this.geo.menuAnchor(at); // 四角は右上の角、六角は右の縦の辺の上の端（HX4）
      const screen = boardToScreen(this.view, anchor.x, anchor.y);
      this.openCardMenu(id, rect.left + screen.x + 8, rect.top + screen.y, null);
    } else {
      this.hopToCard(id, null);
    }
    this.menu?.focusFirst();
  }

  // ---------- 空きのメニュー（TA4b。計画書 docs/plan-comment-board-templates.md） ----------

  // 画面の点（clientX・clientY）を、ボードの座標へ（右クリックは MouseEvent なので、stagePoint は使えない）
  private boardPoint(e: { clientX: number; clientY: number }): Pt {
    const rect = this.stage.getBoundingClientRect();
    return screenToBoard(this.view, e.clientX - rect.left, e.clientY - rect.top);
  }

  // 面の中の、カードでも線でもない所：縁のすぐ外（geo.near まで。六角 9・四角 0）なら、いちばん近いカード。面の外（題の帯・道具の列）では見ない
  private cardNearPoint(e: { clientX: number; clientY: number }, target: Element | null): string | null {
    if (!target || !this.stage.contains(target)) return null;
    return cardNear(this.pos, this.boardPoint(e), this.geo.outside, this.geo.near);
  }

  // 空きの右クリック：面の中なら、押した所を置き場（左上）にして、空きのメニューを押した所に開く。題の帯の中なら、同じメニューを、押した所の無い形で（TA5）。
  //   ほか（道具の列・書く欄など）は、今までどおり何も出さない。検索の欄の上は、受け口の頭で標準のメニューに任せている
  private openBoardMenu(e: MouseEvent, target: Element | null) {
    if (!target) return;
    if (this.stage.contains(target)) {
      const p = this.boardPoint(e);
      this.showBoardMenu(e.clientX, e.clientY, { kind: 'point', at: pointSpot(p, this.geo.box), corner: p });
    } else if (target.closest('.memo-board-bar')) this.showBoardMenu(e.clientX, e.clientY, { kind: 'center' });
  }

  // 空きのメニューを (x, y) に開く。型の段の「← 戻る」からも、同じ所に、今の様子で組み直して開く
  //   見るメモが無い・命令の口が無いときは出さない。開くだけでは、何も書かない
  //   題の帯の「カードを書く」は、今ある focusCompose（書きかけがあれば焦点を戻すだけ。ほかの確かめの途中は開かない。足せないときは理由の一言）
  //   下の行（TA6）：選びがあれば「選んだ n 枚」［Grok に頼む］（道具の列のボタンと同じ入口）。消えたカードの位置が 1 件以上あり、書く欄が開いていなければ「整理」（今の openTidy）
  private showBoardMenu(x: number, y: number, from: BoardSpotFrom) {
    const snap = this.source?.get() ?? null;
    if (!this.cmds || !this.memoId || !snap) return;
    const picked = this.selected.size;
    const orphans = this.composing === null ? tidyButton({ load: this.loaded, replies: snap.replies, busy: this.undoBusy }).count : 0; // 書く欄が開いている間は出さない（整理は書く欄を閉じるため）
    this.menuSeq += 1;
    this.getMenu().open(
      x,
      y,
      boardMenuEntries({
        where: from.kind === 'point' ? 'stage' : 'bar',
        write: from.kind === 'point' ? () => this.writeHere(from.at) : () => void this.focusCompose(),
        template: this.cmds.template ? () => void this.openTemplateTier(from, { x, y }, () => this.showBoardMenu(x, y, from)) : null,
        selected: BOT_FEATURES && picked > 0 ? { n: picked, title: ASK_SELECTED_NOTE, ask: () => this.askSelected() } : null,
        tidy: orphans > 0 ? { n: orphans, run: () => this.openTidy() } : null,
      }),
    );
  }

  // 「ここに書く」：押した所（at＝置き場の左上）を覚えて、足す欄を開く。足す欄が開いていれば、字を残して置き場だけ替える。
  //   ほかの欄・確かめ（書き直し・写真の題・整理・線を引く途中・型の小窓）が開いていれば、何も閉じずに一言で止める。
  //   置き場を入れるのは、足す欄を開けたときだけ（足せないときは openCompose が一言を出して開かない）。終わりに、欄が開いていれば焦点を戻す
  private writeHere(at: Pt) {
    if (this.composing?.kind === 'add') this.composeAt = at;
    else if (this.modalOpen) this.flash(tr('開いている欄や確かめを閉じてから書いてください'), 'info');
    else {
      this.openCompose({ kind: 'add' }, '');
      if (!this.compose.hidden) this.composeAt = at; // ここへ来るのは欄が閉じているときだけ：出ていれば、今開けた足す欄
    }
    if (!this.compose.hidden) this.composeText.focus();
  }

  // 空きのクリックを数える（TA7）：同じ所（8 画素まで）を 400 ミリ秒の内に 2 回押したら、「ここに書く」と同じ動き。メニューは開かない。受け口は足さない（面の pointerup の空きの枝から呼ぶ）
  //   数えない（覚えを空にする）：plain が偽（線をやめる押し・線の当たり・メニューを閉じるための押し）・命令の口が無い・欄や確かめが開いている・
  //   縁のすぐ外（右クリックなら、そのカードのメニューになる所）
  private tapEmpty(e: PointerEvent, plain: boolean) {
    if (!plain || !this.cmds || this.modalOpen || this.cardNearPoint(e, this.stage) !== null) {
      this.lastEmptyTap = null;
      return;
    }
    const tap = emptyTap(this.lastEmptyTap, { x: e.clientX, y: e.clientY, t: Date.now() }, PEEK_DOUBLE_MS);
    this.lastEmptyTap = tap.next;
    if (tap.double) this.writeHere(pointSpot(this.boardPoint(e), this.geo.box));
  }

  // ---------- 線に触れる（CB15） ----------

  // 線を押した・右クリックした：元へ移る・相手へ移る・種類・この関連を外す
  private openLineMenu(from: string, to: string, x: number, y: number) {
    this.named(() => {
      const replies = this.source?.get()?.replies ?? [];
      const a = replies.find((r) => r.id === from);
      const b = replies.find((r) => r.id === to);
      const kind = linkKindOf(replies, from, to);
      const choices = kindChoices(replies, from, to);
      if (!a || !b || !kind || !choices) return;
      const still = () => linkKindOf(this.source?.get()?.replies ?? [], from, to) !== null; // 実行の前に、線がまだあるかを確かめる
      const gone = () => this.flash(tr('その線はもうありません'), 'warn');
      const go = (id: string) => {
        const at = this.pos.get(id);
        if (at) this.showCard(id, at);
      };
      const sentence = linkSentence(cardLabel(a, 12), cardLabel(b, 12), kind);
      this.getMenu().open(
        x,
        y,
        lineMenuEntries({
          sentence,
          fromLabel: cardLabel(a, 12),
          toLabel: cardLabel(b, 12),
          choices,
          goFrom: () => go(from),
          goTo: () => go(to),
          setKind: (next) => (still() ? this.chooseKind(from, to, next) : gone()),
          remove: () => (still() ? this.removeLink(from, { source: from, other: to, kind, outgoing: true, sentence }) : gone()),
        }),
      );
    });
  }

  // 名札は、乗せた線と、片方の端が選ばれた線だけ（決定 3）
  private paintLineNames() {
    for (const line of this.lineEls) {
      const named = line === this.hoverLine || this.selected.has(line.from) || this.selected.has(line.to);
      line.g.classList.toggle('is-named', named);
    }
  }

  private openCardMenu(id: string, x: number, y: number, from: string | null) {
    const menu = this.getMenu();
    menu.node.style.setProperty('--cell-menu-note-max', `${Math.max(64, Math.min(160, window.innerHeight - 250))}px`); // 下のタブの低い面では、囲みを低くする（190 に、MK6 のいいねの行と MK7 の色の行の分の見込み 30 ずつを足した。開発画面では測っていない）
    const seq = ++this.menuSeq;
    menu.open(x, y, this.cardMenuItems(id, x, y, from));
    this.loadMenuPicture(id, seq, () => this.cardMenuItems(id, x, y, from));
  }

  // 絵を読む。読めたら after を呼ぶ。読めなかった絵は読み直さない
  private loadShot(shot: string, after: () => void) {
    if (this.shotAsked.has(shot)) return;
    this.shotAsked.add(shot);
    void readData<{ data?: unknown }>(`shots/${shot}.json`).then((saved) => {
      if (typeof saved?.data !== 'string' || !saved.data.startsWith('data:image/')) return;
      this.shotAsked.delete(shot);
      this.shotUrls.set(shot, saved.data);
      if (this.shotUrls.size > SHOTS_MAX) this.shotUrls.delete(this.shotUrls.keys().next().value as string);
      after();
    });
  }

  // メニューの絵：読み終えたら、同じ段のままのときだけ描き直す
  private loadMenuPicture(id: string, seq: number, items: () => MenuEntry[]) {
    const shot = this.source?.get()?.replies.find((r) => r.id === id)?.image;
    if (!shot || this.shotUrls.has(shot)) return;
    const menu = this.getMenu();
    const token = menu.token();
    this.loadShot(shot, () => {
      if (seq === this.menuSeq) menu.update(items(), token);
    });
  }

  // 📌 の中身（カードが無ければ null で閉じる）。絵はあとから入る
  private pinContent(memoId: string, id: string): PinContent | null {
    const snap = this.source?.get() ?? null;
    const reply = snap?.memoId === memoId ? snap.replies.find((r) => r.id === id && r.parent === null) : undefined;
    if (!snap || !reply) return null;
    if (reply.image && !this.shotUrls.has(reply.image)) this.loadShot(reply.image, () => this.pins.refresh(this.memoId));
    return { title: cardLabel(reply, 24), head: cardHead(reply), text: cardFullText(snap.replies, reply), picture: reply.image ? this.shotUrls.get(reply.image) : undefined };
  }

  // 📌 はカードの右上についていく（層は面の親いっぱいなので、面の位置を足す）
  private pinAnchor(id: string): { x: number; y: number } | null {
    const at = this.pos.get(id);
    if (!at) return null;
    const anchor = this.geo.menuAnchor(at); // 四角は右上の角、六角は右の縦の辺の上の端（HX4）
    const screen = boardToScreen(this.view, anchor.x, anchor.y);
    return { x: this.stage.offsetLeft + screen.x, y: this.stage.offsetTop + screen.y };
  }

  private pinArea() {
    const left = this.stage.offsetLeft;
    const top = this.stage.offsetTop;
    return { left, top, right: left + this.stage.clientWidth, bottom: top + this.stage.clientHeight };
  }

  // メニューの中身を入れ替える（［読む］・2 手の確かめ）。焦点がメニューの中にあったら先頭へ置き直す（キーで使っている人のため）
  private replaceMenu(entries: MenuEntry[]) {
    const menu = this.getMenu();
    this.menuSeq += 1;
    const inside = menu.node.contains(document.activeElement);
    menu.update(entries);
    if (inside) menu.focusFirst();
  }

  private cardMenuActions(id: string, x: number, y: number, from: string | null): CardMenuActions {
    return {
      page: (reply) => {
        const quote = reply.quote;
        if (!quote) return;
        const go = () => this.ask({ command: 'openQuote', url: quote.url, fragmentUrl: quoteFragmentUrl(quote.url, quote.text) });
        if (this.place === 'upper') this.replaceMenu(confirmPageEntries(reply, () => this.lowerThen(go)));
        else go();
      },
      video: (reply) => {
        const at = reply.at;
        if (!at) return;
        const go = () => this.ask({ command: 'openReaderAt', video: at.video, start: at.spans[0].start });
        if (this.place === 'upper') this.replaceMenu(confirmVideoEntries(() => this.lowerThen(go)));
        else go();
      },
      capture: (reply) => {
        if (!this.memoId) return;
        this.ask({ command: 'captureCardImage', id: this.memoId, replyId: reply.id });
        this.flash(tr('画像を右の撮影に送りました（大きく開きます）'), 'info');
      },
      list: (reply) => {
        const info = this.source?.info?.() ?? null;
        if (info?.other) this.replaceMenu(confirmListEntries(info.shownTitle, () => this.openInList(reply.id)));
        else this.openInList(reply.id);
      },
      cell: () => {
        if (this.memoId) this.ask({ command: 'focusMemoPaneCell', id: this.memoId });
      },
      read: (reply) => {
        const input = this.cardMenuInput(reply.id, x, y, null);
        if (!input) return;
        // 読む段の ← 戻る は、元のカードの段を開き直す。［移る］は読んでいた元のカードから移ったことにする
        const actions: CardMenuActions = { ...this.cardMenuActions(id, x, y, from), back: () => this.openCardMenu(id, x, y, from) };
        const items = () => {
          const next = this.cardMenuInput(reply.id, x, y, null);
          return next ? this.named(() => readMenuEntries({ ...next, actions })) : [];
        };
        this.replaceMenu(items());
        this.loadMenuPicture(reply.id, this.menuSeq, items);
      },
      hop: (reply) => this.hopToCard(reply.id, id),
      copy: (reply) => void this.copyCard(reply),
      pin: (reply) => {
        if (this.memoId) this.pins.pin(this.memoId, reply.id);
      },
      // 移った先の ← 元のカードへ（履歴は持たず 1 段だけ）
      back: () => {
        if (from) this.hopToCard(from, null);
      },
      // 編集の行：書き直す・関連線を足すは、欄や確かめが開いていれば始めない（F2 と同じ。書きかけを上書き・消去しない）。選びをそのカード 1 枚にしてから、道具の列と同じ道へ
      edit: (reply) => {
        if (this.modalOpen) {
          this.flash(tr('開いている欄や確かめを閉じてから書き直してください'), 'info');
          return;
        }
        this.setSelected(new Set([reply.id]));
        this.startEdit();
      },
      link: (reply) => {
        if (this.modalOpen) {
          this.flash(tr('開いている欄や確かめを閉じてから線を足してください'), 'info');
          return;
        }
        this.setSelected(new Set([reply.id]));
        this.startLink();
      },
      // タグを足す…：タグの段へ替える。候補（pool）はここで 1 回だけ作り、段を閉じるまで同じものを使う（付けるたびに並びが替わらないように）。← 戻る はカードの段を開き直す（読む段と同じ）
      tags: (reply) => {
        const replies = this.source?.get()?.replies ?? [];
        const pool = tagMenuPool(cardTagCandidates(replies, [], registeredTagNames()), replies.find((r) => r.id === reply.id)?.tags ?? []);
        this.replaceMenu(this.tagMenuItems(reply.id, pool, () => this.openCardMenu(id, x, y, from), x, y));
      },
      // 型を足す…：型の一覧を読んでから、型の段へ替える（TA2）。← 戻る はカードの段を開き直す
      template: (reply) => void this.openTemplateTier({ kind: 'card', id: reply.id }, { x, y }, () => this.openCardMenu(id, x, y, from)),
      // ［削除］（MK1）：押したときに選びを見直す。押したカードが選びの中で 2 枚以上なら選んだ全部、そうでなければ選びをそのカード 1 枚にしてから、道具の列の［削除］と同じ道へ（確かめは無い。一言と Ctrl+Z も同じ）
      //   メニューを開いている間に押したカードが消えていたら、選びを替えずに一言で止める（タグを書く欄と同じ一言）。写しが無いときは removeSelected の守りに任せる
      remove: (reply) => {
        const snap = this.source?.get() ?? null;
        if (snap && !cardAppeared(snap.replies, reply.id)) {
          this.flash(tr('カードがもうありません'), 'warn');
          return;
        }
        const many = menuPicked(snap?.replies ?? [], [...this.selected], reply.id) >= 2;
        const editing = this.composing?.kind === 'edit' ? this.composing.id : null; // 書き直し中のカードは消さない（書いた文が黙って消えるため。右クリックの道だけ）
        if (editing !== null && (editing === reply.id || (many && this.selected.has(editing)))) {
          this.flash(tr('書き直しの欄を閉じてから削除してください'), 'warn');
          return;
        }
        if (!many) this.setSelected(new Set([reply.id]));
        this.removeSelected();
      },
      // いいねの行（MK6）と色の行（MK7）：押したカード 1 枚だけ（選びは替えない）。止めと元に戻すへの積みは setMark
      mark: (reply, kind, value) => this.setMark(reply.id, kind, value),
    };
  }

  // タグの段の中身。足すのはそのカード 1 枚だけ（選びは替えない。上限の確かめと一言は changeTags）。候補は段を開いたときの pool のまま
  //   候補を押しても段は開いたまま。付いたら、押したときと同じ段のままなら描き直す（付いた候補は同じ所で押された印になる。畳んだ上の区画・六角でも付いたかが分かるように）
  private tagMenuItems(id: string, pool: readonly string[], back: () => void, x: number, y: number): MenuEntry[] {
    const replies = this.source?.get()?.replies ?? [];
    return this.named(() =>
      tagMenuEntries({
        replies,
        id,
        pool,
        back,
        add: (tag) => {
          const seq = this.menuSeq;
          const token = this.getMenu().token();
          this.changeTags([id], [tag], [], (ok) => {
            if (ok && seq === this.menuSeq) this.redrawTagMenu(id, pool, back, x, y, token);
          });
        },
        write: () => this.writeTag(id, pool, back, x, y),
      }),
    );
  }

  // タグの段を描き直す。token：押したときのメニューの印（閉じた・別のメニューを開いたなら入れない。loadMenuPicture と同じ守り）。段は替えないので menuSeq は進めない（続けて押した候補の分も描き直せるように）
  //   焦点がメニューの中にあったら、同じ順番のボタンへ戻す（並びは動かないので同じボタンになる。無ければ先頭）。メニューの外なら焦点は動かさない
  //   段の位置も描き直す前のまま保つ（update は窓に収めようと置き直すので、窓の下の端では、下の囲みが伸びたぶん段が上へずれ、指の下の候補が替わるため）。伸びたぶんは下へ出る
  private redrawTagMenu(id: string, pool: readonly string[], back: () => void, x: number, y: number, token: number) {
    const menu = this.getMenu();
    if (!menu.isOpen || menu.token() !== token) return;
    const buttons = () => [...menu.node.querySelectorAll('button')];
    const inside = menu.node.contains(document.activeElement);
    const at = buttons().findIndex((b) => b === document.activeElement);
    const { left, top } = menu.node.style;
    menu.update(this.tagMenuItems(id, pool, back, x, y), token);
    menu.node.style.left = left;
    menu.node.style.top = top;
    if (!inside) return;
    const again = buttons()[at];
    if (again) again.focus();
    else menu.focusFirst();
  }

  // 新しいタグを書く欄（タグの段の［新しいタグを書く…］）。メニューを開いた所に出す。前の段の絵が、あとから欄を上書きしないように、開く前に menuSeq を進める
  //   Enter で名前が通ったら、すぐ同じ所にタグの段を開き直す（左の返事を待たない。待つ間にメニューが閉じても、あとから開かないように）。
  //   そのあとで、開き直した段の menuSeq と印を控えて足し、付いたら候補と同じ守りで描き直す（付いたタグを見せる。続けて足せる。やめるのは Esc か外を押す）
  private writeTag(id: string, pool: readonly string[], back: () => void, x: number, y: number) {
    const reply = this.source?.get()?.replies.find((r) => r.id === id && r.parent === null);
    if (!reply) {
      this.flash(tr('カードがもうありません'), 'warn');
      return;
    }
    this.menuSeq += 1;
    this.getMenu().prompt(
      tr('「{0}」に付けるタグ', { 0: cardLabel(reply, 12) }),
      '',
      (value) => {
        const tag = normalizeTag(value);
        if (!tag) {
          this.flash(tr('タグの名前が空です（# と空白は名前に入りません）'), 'warn');
          return;
        }
        this.reopenTagMenu(id, pool, back, x, y);
        const seq = this.menuSeq;
        const token = this.getMenu().token();
        this.changeTags([id], [tag], [], (ok) => {
          if (ok && seq === this.menuSeq) this.redrawTagMenu(id, pool, back, x, y, token);
        });
      },
      { x, y },
      { maxLength: 30, placeholder: tr('タグの名前') }, // 30 字は tags.ts のタグの字数と同じ
    );
  }

  // タグの段を同じ所に開き直す（新しいタグの欄で Enter を押したとき）。続けて書けるように、焦点は［新しいタグを書く…］へ（無ければ先頭）
  private reopenTagMenu(id: string, pool: readonly string[], back: () => void, x: number, y: number) {
    const menu = this.getMenu();
    this.menuSeq += 1;
    menu.open(x, y, this.tagMenuItems(id, pool, back, x, y));
    const write = [...menu.node.querySelectorAll('button')].find((b) => b.firstElementChild?.textContent === TAG_WRITE_LABEL);
    if (write) write.focus();
    else menu.focusFirst();
  }

  // 上に出しているときの 2 手：下に戻してから開く。戻るのは今の［上に出す］（見ていた位置と選びは残る）
  private lowerThen(go: () => void) {
    this.cmds?.place?.request('bottom');
    go();
  }

  // 下の一覧のそのカードへ。下の帯がメモのタブでなければ、先に替える（隠れた並びは流れないので、命令より先に）
  private openInList(replyId: string) {
    if (!this.memoId) return;
    const memoId = this.memoId;
    this.cmds?.showList?.();
    this.ask({ command: 'openMemoPane', id: memoId, replyId, from: 'board' });
  }

  // 選びを移し、十分に見えていなければ滑らせる
  private showCard(id: string, at: Pt) {
    this.setSelected(new Set([id]));
    const next = viewToShowCard(this.view, at, this.viewport(), this.geo.box);
    if (!next) return;
    this.slide();
    this.view = next;
    this.applyView();
    this.touchView(); // 今のパンと同じ道で、見ている位置を保存する
  }

  // カードへ移る：メニューをそのカードの横へ置き直す
  private hopToCard(id: string, from: string | null) {
    const at = this.pos.get(id);
    if (!at) return;
    this.showCard(id, at);
    const rect = this.stage.getBoundingClientRect();
    const anchor = this.geo.menuAnchor(at); // 四角は右上の角、六角は右の縦の辺の上の端（HX4）
    const screen = boardToScreen(this.view, anchor.x, anchor.y);
    this.openCardMenu(id, rect.left + screen.x + 8, rect.top + screen.y, from);
  }

  // ---------- 足したカード（下の一覧などで増えた分。光らせる・面の外なら札。置き直さない・保存しない。CB6） ----------

  // reset：メモを替えた・タブを開いた直後は、今あるカードを「足した」と数えない
  private noteArrivals(memoId: string, replies: readonly Reply[], reset: boolean) {
    if (reset || this.knownMemo !== memoId) this.clearArrivals();
    else for (const id of arrivedCards(this.knownTops, replies, this.pending)) this.addArrival(id);
    this.knownTops = new Set(replies.filter((r) => r.parent === null).map((r) => r.id));
    this.knownMemo = memoId;
  }

  private addArrival(id: string) {
    const timer = window.setTimeout(() => this.dropArrival(id), ARRIVAL_MS);
    this.arrivals.set(id, { timer, flashUntil: Date.now() + ARRIVAL_FLASH_MS });
    window.setTimeout(() => this.paintArrivals(), ARRIVAL_FLASH_MS + 50); // 光りの印を外す（動きを減らす設定の枠が残らないように）
  }

  private dropArrival(id: string) {
    window.clearTimeout(this.arrivals.get(id)?.timer);
    this.arrivals.delete(id);
    this.cardEls.get(id)?.classList.remove('is-arrive');
    this.paintArrivals();
  }

  private clearArrivals() {
    for (const a of this.arrivals.values()) window.clearTimeout(a.timer);
    this.arrivals.clear();
    this.paintArrivals();
  }

  // 光らせて、十分に見えていないカードには札を出す（見ている位置が動くたび・描き直すたびに置き直す）
  private paintArrivals() {
    for (const chip of this.chipEls) chip.remove();
    this.chipEls = [];
    if (this.arrivals.size === 0) return;
    const replies = this.source?.get()?.replies ?? [];
    const viewport = this.viewport();
    const placed: EdgeChip[] = [];
    const now = Date.now();
    for (const [id, a] of this.arrivals) {
      const at = this.pos.get(id);
      const reply = replies.find((r) => r.id === id);
      if (!at || !reply) continue;
      this.cardEls.get(id)?.classList.toggle('is-arrive', now < a.flashUntil);
      if (cardVisibleRatio(this.view, at, viewport, this.geo.box) >= CARD_VISIBLE_ENOUGH) continue;
      const place = edgeChipAt(this.view, at, viewport, placed, this.geo.box);
      placed.push(place);
      const label = cardLabel(reply, 8);
      const chip = el('button', 'memo-board-edgechip', tr('{0} 足した：{1}', { 0: place.arrow, 1: label }));
      chip.type = 'button';
      chip.title = tr('足したカード：{0} へ移る', { 0: label });
      chip.style.left = `${this.stage.offsetLeft + place.x}px`;
      chip.style.top = `${this.stage.offsetTop + place.y}px`;
      chip.addEventListener('click', () => {
        this.dropArrival(id);
        const spot = this.pos.get(id);
        if (spot) this.showCard(id, spot);
      });
      this.pinLayer.append(chip);
      this.chipEls.push(chip);
    }
  }

  // 短く滑らせる（「動きを減らす」の設定では滑らせない）
  private slide() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.stage.classList.add('is-sliding');
    window.clearTimeout(this.slideTimer);
    this.slideTimer = window.setTimeout(() => this.stage.classList.remove('is-sliding'), SLIDE_MS);
  }

  private async copyCard(reply: Reply) {
    const memoId = this.memoId;
    const text = cardCopyText(this.source?.get()?.replies ?? [], reply);
    const answer = await request((requestId) => ({ type: 'clipboardWrite', requestId, text, html: '' }), 8_000).catch(() => null);
    if (this.memoId !== memoId) return;
    const ok = answer?.type === 'clipboardWritten' && answer.ok;
    this.flash(ok ? tr('全文をコピーしました') : tr('コピーできませんでした'), ok ? 'info' : 'warn');
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
      this.flash(tr('そのカードとは結べません'), 'warn');
      return;
    }
    const entries: MenuEntry[] = [{ section: tr('「{0}」は「{1}」の…', { 0: cardLabel(a, 12), 1: cardLabel(b, 12) }) }];
    for (const c of choices) entries.push({ label: c.name, hint: c.hint, disabled: c.disabled, run: () => this.chooseKind(from, to, c.kind) });
    entries.push('sep', { label: tr('やめる'), run: () => this.cancelLink() });
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
    const layout = this.shape; // 積みの印は始めたときの形（結果を待つ間に形を替えてもずれない。HX4）
    this.ask(plan.command);
    this.cancelLink();
    this.watch(memoId, (rs) => linkIs(rs, from, to, kind), (ok) => {
      if (this.memoId !== memoId) return;
      if (ok) this.pushUndo({ kind: 'link', from, to, before, after: kind }, layout);
      if (ok) this.quietSuccess();
      else if (!this.quietAfterNotice()) this.flash(tr('関連を付けられませんでした'), 'warn');
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
      this.flash(tr('このカードにつながる線はありません'), 'info');
      return;
    }
    const at = this.linkRemoveBtn.getBoundingClientRect();
    const entries: MenuEntry[] = [{ section: tr('どの線を外しますか') }];
    for (const rel of rels) entries.push({ label: rel.sentence, run: () => this.removeLink(self, rel) });
    entries.push('sep', { label: tr('やめる'), run: () => undefined });
    this.getMenu().open(at.left, at.bottom + 2, entries);
    this.getMenu().focusFirst();
  }

  // ---- 型にする（登録の小窓は下の区画のものを借りる。ここは選んだカードと、ボードの座標の差を渡す） ----

  private openTemplate() {
    const snap = this.source?.get() ?? null;
    const hook = this.cmds?.template;
    if (!snap || !hook) return;
    if (this.shape === 'hex') {
      this.flash(HEX_TEMPLATE_NOTE, 'info'); // 型は四角の並びの位置（四角の歩み）で作られているので、六角では使えない（HX5 でもそのまま）
      return;
    }
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

  // ---- 型を足す（TA2。カードの右クリックの「編集」の行）：型の一覧 → 型の段 → 押したカードの右と下へ。計画書 docs/plan-comment-board-templates.md ----

  // 型の段を開く。一覧を読む間に、メニューが閉じた・別のメニューになった・メモが替わった・隠れたなら、何もしない（絵を読むときと同じ守り）
  //   段は、押したボタン（字で探す）の高さに見出しが来るように置く。出してから TIER_GUARD_MS のあいだは、段の中の押しを受けない
  //   メニューが閉じているときに呼ばれたら（消す段の「← 戻る」・空きのメニューの「型を足す…」。ふつうの項目は押すと先に閉じる）、読めたあと、同じ所（at）に開く。
  //   その間に別のメニューが開いた・形を替えた・つまむ／範囲選択／面の移動を始めた・線を引き始めたなら、何もしない（TA5）
  //   from：押したカード（TA2）か、空きのメニューを開いた所（TA5。見出しは「ここに型を足す」「真ん中に型を足す」。いちばん下の「型にする」は、2 枚以上選んでいれば選んだ組）
  private async openTemplateTier(from: TemplateFrom, at: { x: number; y: number }, back: () => void) {
    const snap = this.source?.get() ?? null;
    const hook = this.cmds?.template;
    const memoId = this.memoId;
    if (!snap || !hook || !memoId) return;
    const blocked = pasteToolNote(this.loaded, snap.replies);
    if (blocked) {
      this.flash(blocked, 'warn');
      return;
    }
    const menu = this.getMenu();
    const wasOpen = menu.isOpen;
    const token = menu.token();
    const seq = this.menuSeq;
    const shape = this.shape;
    const loaded = await hook.list().catch(() => null);
    if (this.hidden || this.memoId !== memoId || menu.isOpen !== wasOpen || menu.token() !== token || this.menuSeq !== seq) return;
    if (!wasOpen && (this.shape !== shape || this.drag || this.marquee || this.pan || this.linkFrom !== null)) return;
    if (!loaded || loaded.state === 'unreadable') {
      this.flash(tr('型の保存ファイルを読めませんでした（ファイルは変えていません）'), 'warn');
      return;
    }
    const replies = this.source?.get()?.replies ?? snap.replies;
    const cardId = from.kind === 'card' ? from.id : null;
    const reply = cardId === null ? undefined : replies.find((x) => x.id === cardId && x.parent === null);
    // いちばん下の「型にする」の行（TA3）：押したカードが 2 枚以上の選びの中なら、選んだ組。そうでなければ、描いている全部。登録するカードは、段を組んだときのもの
    //   空きと題の帯から（TA5。押したカードが無い）：2 枚以上選んでいれば選んだ組、そうでなければ描いている全部。名前は、その中でいちばん古いカードの 1 行目
    const picked = liveSelection(replies, [...this.selected]);
    const scope = picked.length >= 2 && (cardId === null || picked.includes(cardId)) ? 'selected' : 'board';
    const makeIds = scope === 'selected' ? picked : this.faces.map((f) => f.id);
    const makeLabel = hook.save && (reply || cardId === null) ? templateMakeLabel(scope, makeIds.length) : null;
    const nameFrom = cardId === null ? oldestCardText(replies, makeIds) : (reply?.text ?? '');
    const heading = from.kind === 'point' ? TEMPLATE_HERE_HEADING : from.kind === 'center' ? TEMPLATE_CENTER_HEADING : reply ? tr('「{0}」に型を足す', { 0: cardLabel(reply, 12) }) : '';
    const pressed = [...menu.node.querySelectorAll('button')].find((b) => b.textContent === TEMPLATE_ADD_LABEL);
    const top = pressed?.getBoundingClientRect().top;
    const entries = this.named(() =>
      templateTierEntries({
        heading,
        gone: cardId !== null && !reply,
        templates: loaded.templates,
        skipped: loaded.skipped,
        existing: replies.length,
        maker: makeLabel ? { label: makeLabel, make: (mode) => this.makeTemplate(makeIds, nameFrom, mode) } : null,
        erase: hook.remove ? () => void this.openDeleteTier(() => void this.openTemplateTier(from, at, back)) : null,
        back,
        pick: (t) => this.pickTemplate(t, from),
      }),
    );
    if (wasOpen) this.replaceMenu(entries);
    else {
      this.menuSeq += 1;
      menu.open(at.x, at.y, entries);
    }
    this.settleTier(menu, top);
  }

  // 型を消す段（TA8）。← 戻る は型の段へ。消したら、同じ段を読み直して描き直す（守りは型の段と同じ）
  private async openDeleteTier(back: () => void) {
    const hook = this.cmds?.template;
    const memoId = this.memoId;
    if (!hook?.remove || !memoId) return;
    const menu = this.getMenu();
    const wasOpen = menu.isOpen;
    const token = menu.token();
    const seq = this.menuSeq;
    const loaded = await hook.list().catch(() => null);
    if (this.hidden || this.memoId !== memoId || menu.isOpen !== wasOpen || menu.token() !== token || this.menuSeq !== seq) return;
    if (!loaded || loaded.state === 'unreadable') {
      this.flash(tr('型の保存ファイルを読めませんでした（ファイルは変えていません）'), 'warn');
      return;
    }
    this.replaceMenu(templateDeleteEntries({ templates: loaded.templates, back, remove: (t) => void hook.remove?.(t.id, t.name).then(() => this.openDeleteTier(back)) }));
    this.settleTier(menu, undefined);
  }

  // 段の見出しを、押したボタンの高さ（top）へ寄せる（窓に収まる所まで）。段を出した時刻を覚え、出してすぐの押しを止める受け口を 1 本だけ付ける
  private settleTier(menu: CellMenu, top: number | undefined) {
    this.tierAt = Date.now();
    if (!this.tierGuard) {
      this.tierGuard = true;
      menu.node.addEventListener(
        'click',
        (e) => {
          if (Date.now() - this.tierAt >= TIER_GUARD_MS) return;
          e.preventDefault();
          e.stopPropagation();
        },
        true,
      );
    }
    const head = menu.node.querySelector<HTMLElement>('.cell-menu-section');
    if (top === undefined || !head) return;
    const box = menu.node.getBoundingClientRect();
    const want = box.top + (top - head.getBoundingClientRect().top);
    menu.node.style.top = `${Math.round(Math.max(4, Math.min(want, window.innerHeight - box.height - 4)))}px`;
  }

  // 型にする（TA3）：今描いている位置の差をそのまま渡して、小窓を出さずに登録する（寄せない・掛けない。六角でも四角でも）。書く欄・選び・見ている位置には触らない
  //   名前は、押したカードの文の 1 行目（下の面が整える。同じ名前には番号）。結果の一言は、登録の一言の受け口（onDone）に返ってくる
  private makeTemplate(ids: readonly string[], nameFrom: string, mode: 'snapshot' | 'skeleton') {
    const hook = this.cmds?.template;
    if (!hook?.save) return;
    hook.save([...ids], templateOffsets(ids, this.pos) ?? {}, { name: nameFrom, mode });
  }

  // 型を足してよいか：整理の確かめ・線を引く途中・型の小窓が無く、書く欄は閉じているか、空の足す欄だけ（書きかけ・書き直しがあれば止める）
  private pasteFree(): boolean {
    return this.tidyBar.hidden && this.linkFrom === null && this.templateKey === null && !this.fillOpen && canReturnDraft(this.composing, this.composeText.value);
  }

  // 型の行を押した：開いている欄や確かめがあれば、何も閉じずに一言で止める。無ければ、押したカード（空きからは、押した所・面の真ん中）を基準に貼る
  private pickTemplate(t: CardTemplate, from: TemplateFrom) {
    if (!this.pasteFree()) {
      this.flash(tr('開いている欄や確かめを閉じてから型を足してください'), 'info');
      return;
    }
    this.pasteOnBoard(t, [], from);
  }

  // ---- 型を貼る（B3-2b）：型の一覧 → （穴あきなら空欄の小窓）→ 見ている面の真ん中へ一発で貼る ----

  private async openPasteMenu() {
    const snap = this.source?.get() ?? null;
    const hook = this.cmds?.template;
    const memoId = this.memoId;
    if (!snap || !hook || !memoId) return;
    const blocked = this.shape === 'hex' ? HEX_PASTE_NOTE : pasteToolNote(this.loaded, snap.replies); // 六角では型を貼れない（型は四角の歩みで作られているため。HX5 でもそのまま）
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
    if (this.shape === 'hex') return; // 一覧を読む間に六角へ替えた：型のメニューは出さない（六角では型を貼れない。HX5）
    if (!loaded || loaded.state === 'unreadable') {
      this.flash(tr('型の保存ファイルを読めませんでした（ファイルは変えていません）'), 'warn');
      return;
    }
    const replies = this.source?.get()?.replies ?? snap.replies;
    const entries: MenuEntry[] = [{ section: tr('貼る型を選んでください（見ている場所の真ん中に貼ります）') }];
    if (loaded.templates.length === 0) entries.push({ note: loaded.skipped > 0 ? tr('読める型がありません（読めない型が {0} 件あります）', { 0: loaded.skipped }) : TEMPLATE_EMPTY_HINT });
    for (const group of templateMenuGroups(loaded.templates)) {
      entries.push({ section: group.folder });
      for (const t of group.items) {
        const full = pasteBlocked(replies.length, t.cards.length);
        entries.push({ label: templateMenuLabel(t), hint: full ? tr('入りきりません') : undefined, disabled: full !== null, run: () => this.startPaste(t) });
      }
    }
    if (loaded.templates.length > 0 && loaded.skipped > 0) entries.push({ note: tr('読めない型が {0} 件あります（出していません）', { 0: loaded.skipped }) });
    entries.push('sep', { label: tr('やめる'), run: () => undefined });
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
  //   型は六角では貼れない（型の dx・dy は四角の歩みで作られているため。HX4 の守り。HX5 でもそのまま）：ボタン・メニュー（toolState・openPasteMenu）に加えて、ここでも止める。
  //   置き場の口（geo の箱・歩み・重なり）と貼り始めたときの形の鍵は、四角で使う（六角の歩みで貼る作りは、今は通らない道）
  //   基準（from）：カードの右クリックの「型を足す…」から（TA2）。あれば、六角でも通し、そのカードの右と下に置く（planBoardPaste の anchor）
  //   空きのメニューから（TA5）：押した所（point）か、面の真ん中（center。題の帯から）を基準に置く。六角でも通す。寄せる目当ては、足した分だけ
  private pasteOnBoard(template: CardTemplate, notes: string[], from?: TemplateFrom) {
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    if (!snap || !memoId || snap.memoId !== memoId || this.hidden) return;
    if (from === undefined && this.shape === 'hex') {
      this.flash(HEX_PASTE_NOTE, 'warn');
      return;
    }
    const anchorId = from?.kind === 'card' ? from.id : undefined;
    const anchorAt = anchorId === undefined ? undefined : this.pos.get(anchorId);
    if (anchorId !== undefined && !anchorAt) {
      this.flash(tr('カードがもうありません'), 'warn');
      return;
    }
    const anchor: PasteAnchor | undefined = anchorAt ? { kind: 'card', at: anchorAt } : from && from.kind !== 'card' ? from : undefined;
    const geo = this.geo;
    const key = boardKey(geo.layout, memoId);
    // 貼る場所は、書く欄を閉じたあとの面と見ている位置で決める（このあと closeCompose で寄せる前の位置へ戻るため。HX2）
    const plan = planBoardPaste({ memoId, template, replies: snap.replies, load: this.loaded, view: this.viewAfterClose(), viewport: this.closedViewport(), taken: anchor ? takenSpots(this.pos, this.pending) : [...this.pos.values()], card: geo.box, step: geo.step, overlaps: geo.overlaps, depth: geo.depth, ...(anchor ? { anchor } : {}) });
    if (!plan.ok) {
      this.flash(plan.note, 'warn');
      return;
    }
    const { ids, moves } = plan;
    // 六角で、押したカードが仮の位置（保存していない）なら、先に今の位置を書く（型を足して枚数が増えても、押したカードが別の番へ動かないように。固める前は書かれない）
    if (anchorId !== undefined && anchorAt && geo.layout === 'hex' && this.faces.find((f) => f.id === anchorId)?.saved === false) this.commitMove([{ ref: anchorId, x: anchorAt.x, y: anchorAt.y }]);
    const doneText = pasteDoneText(plan.template.name, ids.length) + (notes.length > 0 ? `。${notes.join('。')}` : '');
    this.cancelLink();
    this.closeCompose();
    const token = ++this.seq;
    for (const m of moves) this.setPending(m.ref, m, token); // 現れたときに、仮の位置を経ず置く場所に出す
    const clearPending = () => {
      for (const m of moves) if (this.pending.get(m.ref)?.seq === token) this.pending.delete(m.ref);
    };
    const askedAt = Date.now();
    this.placing += 1; // 結果を待つ間は形を替えない（HX4）
    this.ask(plan.command);
    this.watch(memoId, (rs) => pastedAppeared(rs, ids), (ok) => {
      this.placing -= 1;
      if (!ok) {
        clearPending();
        if (this.memoId === memoId) {
          if (!this.quietAfterNotice()) this.flash(tr('型を貼れませんでした（左が断ったか、時間がかかっています。貼れていなければ、もう一度お試しください）'), 'warn');
          this.render();
        }
        return;
      }
      this.setSelected(new Set(ids)); // 貼ったカードは全部選ぶ
      // 基準つき：押したカードと足した分が読める所へ寄せる（全部が面に入らなければ、足した分だけ。倍率は変えない）。空きからは、足した分だけ
      if (anchor && this.memoId === memoId) this.slideTo(viewToReadAdded(this.view, anchorAt ? geo.readBox(anchorAt) : null, moves.map((m) => geo.readBox(m)), this.viewport()));
      const replies = this.source?.get()?.replies ?? [];
      this.pushPaste(memoId, plan.template, ids, moves, askedAt, geo.layout);
      const view = this.freezeView(); // 寄せたあとの位置（六角のファイルを初めて作るときに入れる。足す道と同じ）
      this.enqueue(async () => {
        try {
          const base = this.known.get(key);
          const saved = planBoardMoves(base ?? null, replies, moves, Date.now(), { writeSame: true, view }); // 同じ所でも書く（六角は初めてなら固める。足す道と同じ）
          if (!base || !saved.ok) {
            if (this.memoId === memoId) this.flash(tr('型は貼りましたが、位置は保存できませんでした'), 'warn');
            return;
          }
          const result = await saveBoard(boardPaneIo, base, saved.board);
          this.settle(key, result);
          if (this.memoId === memoId) this.flash(result.ok ? doneText : tr('型は貼りましたが、{0}', { 0: boardSaveMessage(result.why, geo.layout) }), result.ok ? 'info' : 'warn');
        } catch {
          if (this.memoId === memoId) this.flash(tr('型は貼りましたが、位置は保存できませんでした'), 'warn');
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
    const layout = this.shape; // 積みの印は始めたときの形（HX4）
    this.watch(memoId, (rs) => !linkIs(rs, rel.source, to, rel.kind), (ok) => {
      if (this.memoId !== memoId) return;
      if (ok) this.pushUndo({ kind: 'link', from: rel.source, to, before: rel.kind, after: null }, layout);
      if (ok) this.quietSuccess();
      else if (!this.quietAfterNotice()) this.flash(tr('関連を外せませんでした'), 'warn');
    });
  }

  // カードの印（♥・色。MK5）を value（likes.ts の likeTag・colorTag の値。空＝外す）にする。口は右クリックの「いいね」の行（MK6）と「色」の行（MK7）
  //   今と同じなら送らない。新しく足すとタグが 10 個を超えるなら、送らずに断る（左も同じ決まりで断る）。
  //   元に戻すに積むのは、左の写しで値が替わったのを見てから（断られたら積まない）。
  //   うまくいったときは一言を出さない（結果は面に見える。quietSuccess で前の失敗の文は消す。MK6）。undoBusy は持たない（線の後送りの見張りと取り合わないように。書く欄の ♡ は likeAdded）
  //   押しが早いとき（MK6。計画 §4.6）：同じカード・同じ種類の印の結果を待っている間（markWaits）に呼ばれたら、前の値は待っている値として扱い（同じなら何もしない）、
  //   送るのは前の結果を見てから（最後に押した値だけ）。待たずに送ると、前の見張りが途中の値を見逃して 3 秒後に誤って断りの一言を出し、積む順も崩れるため
  setMark(replyId: string, kind: MarkKind, value: string) {
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    if (!snap || !memoId || snap.memoId !== memoId) return;
    const key = markWaitKey(memoId, replyId, kind);
    const waiting = this.markWaits.get(key);
    if (waiting) {
      waiting.next = value === waiting.value ? null : value;
      return;
    }
    const before = markNow(snap.replies, replyId, kind);
    if (before === null) {
      this.flash(tr('カードがもうありません'), 'warn');
      return;
    }
    if (before === value) return;
    if (markFull(snap.replies, replyId, kind, value, MAX_TAGS_PER_TAB)) {
      this.flash(markFullNote(kind, MAX_TAGS_PER_TAB), 'warn');
      return;
    }
    this.markWaits.set(key, { value, next: null });
    this.ask(markCommand(memoId, replyId, kind, value));
    this.watch(memoId, (rs) => markStateIs(rs, replyId, kind, value), (ok) => {
      const next = this.markWaits.get(key)?.next ?? null;
      this.markWaits.delete(key); // メモが替わって終えたときも解く（残すと、そのカードの印をもう送れない）
      if (this.memoId !== memoId) return;
      if (ok) this.pushUndo({ kind: 'mark', id: replyId, mark: kind, before, after: value });
      if (ok) this.quietSuccess();
      else if (!this.quietAfterNotice()) this.flash(tr('タグを変えられませんでした'), 'warn');
      if (next !== null) this.setMark(replyId, kind, next); // 待っている間に押された値（前の値は、いま写しにある値）
    });
  }
  // ---------- 元に戻す・やり直す（B3-3b） ----------

  private resetUndo() {
    this.undo.clear();
    this.awaitingPaste = null;
    this.lastSend = null;
    this.paintTools();
  }

  // layout：操作を始めたときの形（既定は今の形）。形の違う操作は、その形に戻すまで戻さない（印は UndoOp の外。HX4）
  private pushUndo(op: UndoOp, layout: BoardLayout = this.shape) {
    this.undo.push(op, layout);
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

  // 型を貼った：Undo は undoSendReplies（左が返す印が要る）。印が先に届いていればそれを、まだなら届いたときに付ける。layout は貼り始めたときの形
  private pushPaste(memoId: string, template: CardTemplate, ids: readonly string[], moves: readonly NodeMove[], askedAt: number, layout: BoardLayout = this.shape) {
    const op: Extract<UndoOp, { kind: 'paste' }> = { kind: 'paste', template, ids: [...ids], at: moves.map((m) => ({ x: m.x, y: m.y })), token: null };
    this.trackSendToken(op, memoId, askedAt);
    this.pushUndo(op, layout);
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
  //   layout：その操作を始めたときの形（書く先のファイル。HX5）。位置を戻すだけ（消したのを戻す・型の貼り直し）なら、もうその位置にあれば書かない。
  //   opts.writeSame（足し直し）：足す道なので、仮の番と同じ所でも書く（六角は初めてなら固める）。六角のファイルを初めて作るときは、見る位置を触っていれば今の位置も入れる
  private savePlaced(memoId: string, layout: BoardLayout, moves: readonly NodeMove[], token: number, okText: string, failText: string, opts: { writeSame?: boolean } = {}) {
    const replies = this.source?.get()?.replies ?? [];
    const key = boardKey(layout, memoId);
    const view = this.freezeView();
    this.enqueue(async () => {
      try {
        const base = this.known.get(key);
        const saved = planBoardMoves(base ?? null, replies, moves, Date.now(), { writeSame: opts.writeSame, view });
        if (!base || !saved.ok) {
          if (this.memoId === memoId) this.flash(failText, 'warn');
          return;
        }
        if (!saved.changed) {
          if (this.memoId === memoId) this.flash(okText, 'info');
          return;
        }
        const result = await saveBoard(boardPaneIo, base, saved.board);
        this.settle(key, result);
        if (this.memoId === memoId) this.flash(result.ok ? okText : `${failText}（${boardSaveMessage(result.why, layout)}）`, result.ok ? 'info' : 'warn');
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
    // 右クリックのいいね（setMark）の結果を待っている間も受けない（MK6 の見直し）。まだ積んでいないので一つ前の操作が戻ってしまい、
    //   同じカードの印なら命令が二つ続いて、setMark の見張りが途中の値を見逃すため。undoBusy とは別の条件（setMark は undoBusy を持たない）
    if (this.markWaits.size > 0) return;
    const snap = this.source?.get() ?? null;
    const memoId = this.memoId;
    if (!snap || !memoId || snap.memoId !== memoId) return;
    const peeked = dir === 'undo' ? this.undo.peekUndo() : this.undo.peekRedo();
    // カードの印（mark。MK5）はボードのファイルを書かないので、読み込み中・読めないボードでも戻す（形の印も持たない：peekLayout が null）
    const blocked = peeked?.kind === 'mark' ? null : undoBlockedNote(this.loaded);
    if (blocked) {
      this.flash(blocked, 'warn');
      return;
    }
    // 取り出す前に覗く：始めたときの形が今と違えば取り出さない（その形に戻すと戻せる。HX4）
    const layout = this.undo.peekLayout(dir);
    if (layout !== null && peeked && layout !== this.shape) {
      this.flash(undoLayoutNote(peeked, dir, layout), 'info');
      return;
    }
    const op = this.undo.take(dir);
    if (!op) {
      this.flash(dir === 'undo' ? tr('戻せる操作がありません') : tr('やり直せる操作がありません'), 'info');
      return;
    }
    this.cancelLink();
    const shape = this.shape; // 始めたときの形＝位置を書く先のファイル（取り出せたのは操作と同じ形のときだけ。結果を待つ間は形を替えない。HX5）
    const version = this.undo.version;
    this.undoHeld += 1;
    this.paintTools();
    // result：ok＝積みの反対側へ（next があればそれを）。text＝一言（null なら出さない。保存が終わってから別に出す）。quiet＝失敗の一言は別で出した
    let settled = false;
    const finish = (res: { ok: true; next?: UndoOp; text?: string | null } | { ok: false; quiet?: boolean; note?: string }) => {
      if (settled) return; // 左の断りで先に終えたあとに、写しを待つ側が終わっても二重にしない
      settled = true;
      this.undoAbort = null;
      this.undoHeld -= 1;
      if (this.memoId !== memoId) {
        this.paintTools();
        return;
      }
      if (res.ok) {
        const next = res.next ?? op;
        this.undo.finish(dir, next, version, this.shape); // 反対側の印は、そのときの形（取り出せたのは同じ形のときだけ）
        const text = res.text === undefined ? undoDoneText(op, dir) : res.text;
        if (text !== null) this.flash(text, 'info');
      } else if (!res.quiet) this.flash(res.note ?? (dir === 'undo' ? UNDO_STALE_NOTE : REDO_STALE_NOTE), 'warn');
      this.paintTools();
    };
    this.undoAbort = (text) => finish({ ok: false, note: text.includes('そのあとにメモが変わっています') ? undefined : tr('戻せませんでした（左が断りました。取り消しの控えが残っていないかもしれません）') });
    const replies = snap.replies;
    switch (op.kind) {
      case 'move': {
        const moves = moveTargets(op, dir, replies);
        if (moves.length === 0) return finish({ ok: false });
        this.commitMove(moves, (ok) => {
          if (ok) {
            this.setSelected(new Set(moves.map((m) => m.ref)));
            this.slideTo(viewToShowMoved(this.view, moves, this.viewport(), this.readBox)); // 動いたカードがどれも読めなければ、1 枚目へ滑らせる（保存する。HX3）
          }
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
        const at = op.at; // 足した位置（その形のファイルの位置。六角も位置を持つ。HX5）
        this.setPending(op.id, at, token);
        this.ask(cmd);
        this.watch(memoId, (rs) => cardAppeared(rs, op.id), (ok) => {
          if (!ok) {
            if (this.pending.get(op.id)?.seq === token) this.pending.delete(op.id);
            this.render();
            return finish({ ok: false });
          }
          this.setSelected(new Set([op.id]));
          finish({ ok: true, text: null });
          // 足し直しは足す道：仮の番と同じ所でも書く（六角は初めてなら固める。HX5）
          this.savePlaced(memoId, shape, [{ ref: op.id, x: at.x, y: at.y }], token, undoDoneText(op, dir), tr('カードは足しましたが、位置は保存できませんでした'), { writeSame: true });
        });
        return;
      }
      case 'remove': {
        if (dir === 'undo') {
          const moves = restoreMoves(op); // 六角で位置を覚えていない（仮の）カードは入らない：戻すと仮の並びに出る（HX5）
          const token = ++this.seq;
          for (const m of moves) this.setPending(m.ref, m, token); // 戻ったカードを、仮の位置を経ず元の場所に出す
          this.ask(restoreCommand(memoId, op.token));
          this.watch(memoId, (rs) => pastedAppeared(rs, op.ids), (ok) => {
            if (!ok) {
              for (const m of moves) if (this.pending.get(m.ref)?.seq === token) this.pending.delete(m.ref);
              this.render();
              return finish({ ok: false });
            }
            this.setSelected(new Set(op.ids));
            finish({ ok: true, text: null });
            if (moves.length === 0) this.flash(undoDoneText(op, dir), 'info'); // 戻す位置が一つも無い：書かずに仮の並びに出す（savePlaced は呼ばない）
            else this.savePlaced(memoId, shape, moves, token, undoDoneText(op, dir), tr('カードは戻しましたが、位置は保存できませんでした'));
          });
          return;
        }
        const ids = liveSelection(replies, op.ids);
        if (ids.length === 0) return finish({ ok: false });
        const next = newUndoToken(); // 消し直すときも新しい印（戻すたびに控えが 1 件できる）
        // いまの形の位置（op は同じ形のときだけ取り出せる）。六角はファイルに位置のあるカードだけ（消すときと同じ。HX5）。描いていなければ前に覚えた位置
        const at = removeAt(ids, this.faces, this.shape, op.at);
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
          if (op.token === null) return finish({ ok: false, note: tr('元に戻せませんでした（左からの取り消しの印が届いていません）') });
          this.ask(pasteUndoCommand(op.token));
          this.watch(memoId, (rs) => cardsGone(rs, op.ids), (ok) => finish(ok ? { ok: true, next: { ...op, token: null } } : { ok: false }));
          return;
        }
        const plan = planRepaste({ memoId, template: op.template, replies, load: this.loaded, at: op.at });
        if (!plan.ok) return finish({ ok: false, note: plan.note });
        const { ids, moves } = plan;
        const token = ++this.seq;
        for (const m of moves) this.setPending(m.ref, m, token);
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
          this.savePlaced(memoId, shape, moves, token, tr('{0}（{1} 枚）', { 0: undoDoneText(op, dir), 1: ids.length }), tr('型は貼りましたが、位置は保存できませんでした'));
        });
        return;
      }
      case 'mark': {
        // カードの印（MK5）：前の値（やり直しは後の値）を置き直す。カードが無ければ戻さない。足すとタグが 10 個を超えるなら、送らずに断る
        const target = dir === 'undo' ? op.before : op.after;
        const now = markNow(replies, op.id, op.mark);
        if (now === null) return finish({ ok: false });
        if (now !== target) {
          if (markFull(replies, op.id, op.mark, target, MAX_TAGS_PER_TAB)) return finish({ ok: false, note: markFullNote(op.mark, MAX_TAGS_PER_TAB) });
          this.ask(markCommand(memoId, op.id, op.mark, target));
        }
        this.watch(memoId, (rs) => markStateIs(rs, op.id, op.mark, target), (ok) => finish(ok ? { ok: true } : { ok: false }));
        return;
      }
      default:
        // 漏れの検査：種類を足して case を書かないと、型の検査がここで止める（書かないまま動くと undoBusy が下りない）
        op satisfies never;
        return finish({ ok: false });
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

// 「形:メモ」の鍵：読んだ・保存したボードの覚え（known。HX5）と、形ごとの見ている位置の覚え（HX4）。四角と六角の位置を混ぜないため、どちらも形とメモの組で引く
function boardKey(shape: BoardLayout, memoId: string): string {
  return `${shape}:${memoId}`;
}

// 種類の名前が替わったら描き直す（線の名札）
function linkNamesKey(): string {
  return (['ground', 'counter', 'next', 'same', 'ask', 'supplement'] as const).map((k) => linkKindInfo(k).name).join('\u0001');
}