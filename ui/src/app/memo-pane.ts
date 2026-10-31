import { BOT_FEATURES } from '../features';
// 下のメモの区画（ページの下の面）。写しを見て、変えてほしいときは左に頼む
//   本文の下に、コメントのカードと「＋コメント」。帯から引用と画像を足す（M3）
import { t as tr } from '../i18n';
import { armConfirm } from '../confirm-arm';
import { requestPageText } from '../ai/page';
import { type HostMessage, onMessage, request, send } from '../bridge';
import { planAnnotatedCard } from '../annotate-card-plan';
import { readImageHints } from '../bot-image-hints';
import { deleteData, readData, readDataChecked, writeData } from '../data';
import { BotImageEdit, cardImageEditLabels, type ImageEditResult } from '../panels/bot-image-edit';
import { loadTagRegistry } from '../integrations/hexmemo';
import { MAX_MEMO_TEXT, type MemoIndexItem, memoTitle } from '../memocells';
import { cardFilterRow, cardTagCandidates, cardTagCounts, chainOrder, visibleTops } from '../memo-card-filter';
import { LinkLayer, linkLayoutKey, measureLinkLayout } from '../memo-card-link-layer';
import { chosenLinkNameSet, LINK_NAME_SET_NAME_MAX, type LinkNameSet, LinkNameSetStore, MAX_LINK_NAME_SETS, resolvedLinkKindNames } from '../link-name-sets';
import { cardLabel, type DrawLink, LINK_KIND_DEFAULT_NAMES, LINK_KIND_NAME_MAX, LINK_KINDS, type LinkKind, type LinkKindNames, linkKindInfo, applyLinkKindNames, parseLinkKindNames, withLinkKindName, linkSentence, routeCardLinks, ROW_GAP_MIN, visibleLinks } from '../memo-card-links';
import { linkedClosure, linkTravel, rangeIds, type SendMode, sendWarning } from '../memo-card-send';
import { ASK_LIMITS, ASK_NOTE, buildTemplateRequest, type MaterialPick, pickMaterials, pickNames } from '../memo-card-template-ask';
import { fillFailText, fillPlanText, findFailText, findFillTemplate, isFillText, parseFillText, planFill } from '../memo-card-template-fill';
import { buildExport, exportFileName as templateExportName, exportFitsImportLimit, importFailText, type ImportParse, importSummaryText, mergeImported, parseImportText, skipReasonText } from '../memo-card-template-io';
import { deleteStoredTemplate, describeTemplateReport, importStoredTemplates, loadTemplates, pasteBlocked, renameStoredTemplate, restoreSampleTemplates, saveNewTemplate, TEMPLATE_EMPTY_HINT, TEMPLATE_UNTITLED, templateNameTaken, type TemplateIo, templateMenuGroups, templateMenuLabel, templateModeNote, templatePickState, templateSaveMessage } from '../memo-card-template-store';
import { dragNote, dropAction, ghostSlots, ghostSummary, isPaletteKey, keepSelection, moveSelection, paletteMeta, paletteOrder, searchTemplates, thumbLayout } from '../memo-card-template-palette';
import { buildTemplateFromCards, type CardTemplate, cleanTemplateName, extractHoles, fillTemplate, MODE_LABELS, TEMPLATE_FOLDERS, TEMPLATE_LIMITS, TEMPLATE_MODES, type TemplateFolder, type TemplateMode } from '../memo-card-templates';
import { CardDrag } from '../memo-card-drag';
import { type Grab, grabPointer } from '../pointer-grab';
import { MemoCardMap } from '../memo-card-map-view';
import { CardPops, FrontStack, type PopControl } from '../memo-card-pops';
import type { MapBox } from '../memo-card-map';
import type { MapSide } from '../memo-card-map';
import { beforeFor, type PendingOrder, settledCount, withPending } from '../memo-card-order';
import { mountMemoFilterWords } from '../memo-filter-words';
import { mountGrokCards } from './grok-cards';
import { readBoardUpperRatio, writeBoardUpperRatio } from '../card-board-stages';
import { readUpperRatio, writeUpperRatio } from '../cards-stages';
import { SPLIT_LABEL } from '../memo-card-board-place';
import { clampUpperRatio, nudgeUpperRatio, UPPER_SPLIT_DEFAULT, UPPER_SPLIT_MIN, UPPER_SPLIT_STEP, upperRatioFromOffset } from '../grok-cards-place';
import { isMachineTag } from '../grok-cards-tags';
import { clampMemoPaneHeight, MEMO_PANE_DEFAULT, readMemoPanePrefs, writeMemoPanePrefs } from '../memo-pane-host';
import { CellMenu, type MenuButton, type MenuEntry } from '../panels/cell-menu';
import { tagArea } from '../panels/tag-pad';
import { savedMarkNew } from '../rotate';
import { PinnedTagFeed, TAG_BUTTONS, TagBookFeed, type TagButtonSet } from '../tagbuttons';
import {
  cardThread,
  hasDrafts,
  hideReplyForm,
  rememberField,
  replyDraft,
  replyFormKey,
  repliesOpen,
  revealReply,
  showReplyForm,
  toggleCompanion,
  toggleReplies,
  type ThreadUi,
} from '../panels/thread-view';
import { MAX_TAGS_PER_TAB, normalizeTag, registeredTagNames, tagColor } from '../tags';
import type { MemoPaneView, RelayCommand } from '../types';
import { parseAiCardText, secLabel } from '../reader-ai-card';
import type { ReaderAiKind, ReaderNow, ReplyAt } from '../reader-links';
import { timeOrder } from '../reader-time-order';
import { addedCardPlaceText, CARD_COLUMNS, countUnder, createdTops, hasSlotGaps, MAX_REPLIES, MAX_REPLY_TEXT, nextRowAddPlan, orderedTops, parseQuote, pathTo, type PendingReply, quoteFragmentUrl, quoteSourceLabel, REPLY_FOLD, type Reply, type ReplyQuote, topSlots, withPlacedTop } from '../threads';
import { el } from '../util';
import { IMPORT_FILE_BYTES, IMPORT_FILE_LABEL } from '../import-limits';
import { boardSnapshot, templateSource } from '../memo-board-source';
import { boardMemoInfo, noticeTarget, skipLowerSentBar } from '../memo-board-pick';

const SAVE_MS = 500;
const ARROW_SCROLL_STEP = 60; // 書く欄が空のときの ↑↓ で、カードの区画を一度に流す量（px）
const NEXT_ROW_KEY = 'honeycomb.memoNextRow'; // 「次の行に」（下の区画だけ。オンのあいだ、新しい一番上のカードを次の行の 1 列目へ）

function readNextRow(): boolean {
  try {
    return localStorage.getItem(NEXT_ROW_KEY) === '1';
  } catch {
    return false;
  }
}

function writeNextRow(on: boolean) {
  try {
    localStorage.setItem(NEXT_ROW_KEY, on ? '1' : '0');
  } catch {
    // 覚えられなくても、今開いている区画では選んだまま
  }
}

const FLASH_MS = 1600; // 右の検索から移ったカードを光らせる長さ
const PENDING_ORDER_MS = 2000; // 頼んだ並べ替えを、写しが来ないまま見せておく長さ（plan-memo-card-order の O2）

type RelationOrigin = 'card' | 'list-pop' | 'map-pop'; // 関連の一覧を開いたカード

export function startMemoPane() {
  document.body.classList.add('surface-memo');
  const root = el('div', 'memo-pane');
  const handle = el('div', 'memo-pane-split');
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-label', '下のメモの区画の高さ。上下の矢印キーで 20 ずつ変わります');
  handle.title = tr('ドラッグで高さを変える');

  const band = el('div', 'memo-pane-band');
  const bandRow = el('div', 'memo-pane-band-row');
  const title = el('button', 'memo-pane-title', tr('メモ'));
  title.type = 'button';
  title.setAttribute('aria-haspopup', 'dialog');
  title.setAttribute('aria-expanded', 'false');
  title.setAttribute('aria-controls', 'memo-pane-list-window');
  title.title = tr('このシートのメモと、最近開いたメモの一覧（押すと開く・閉じる）');
  const sheet = el('span', 'memo-pane-sheet');
  const page = el('span', 'memo-pane-page', tr('上：ページがありません'));
  const close = el('button', 'memo-pane-close', tr('閉じる（Esc）'));
  close.type = 'button';
  close.title = tr('下の区画を閉じる');
  bandRow.append(title, sheet, page, close);
  const tools = el('div', 'memo-pane-tools');
  const quoteBtn = el('button', 'memo-pane-tool', tr('❝ 選んだ文を引用'));
  quoteBtn.type = 'button';
  quoteBtn.title = tr('上のページで選んだ文を、引用のカードにします');
  const shotBtn = el('button', 'memo-pane-tool', tr('▣ 見えている所を画像に'));
  shotBtn.type = 'button';
  shotBtn.title = tr('上に見えている所を画像にして、カードにします');
  const pageBtn = el('button', 'memo-pane-tool', tr('⇣ 全体を画像に'));
  pageBtn.type = 'button';
  pageBtn.title = tr('上のページを、スクロールで隠れた所も含めて1枚の画像にします。ページによっては、きれいに撮れないことがあります。撮っている間、ページが一瞬ちらつくことがあります');
  const pickBtn = el('button', 'memo-pane-tool', tr('🖼 画像を選ぶ'));
  pickBtn.type = 'button';
  pickBtn.title = tr('コンピュータの画像をカードにします。この区画へ貼る・落とすこともできます');
  const fileInput = el('input', 'memo-pane-file');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  const copyBtn = el('button', 'memo-pane-tool', tr('⧉ まとめてコピー'));
  copyBtn.type = 'button';
  copyBtn.title = tr('本文とカードを、Markdown にしてコピーします。メモ帳に貼れます');
  const gotoBtn = el('button', 'memo-pane-tool', tr('このタブに移動'));
  gotoBtn.type = 'button';
  gotoBtn.title = tr('左の盤面で、このメモのセルへ移ります。別のシートなら、そのシートに切り替えます');
  gotoBtn.addEventListener('click', () => {
    if (!view) {
      status.textContent = 'そのメモのセルは、もうありません';
      return;
    }
    ask({ command: 'focusMemoPaneCell', id: view.id });
  });
  const newBtn = el('button', 'memo-pane-tool', tr('＋ 新しいメモ'));
  newBtn.type = 'button';
  newBtn.title = tr('表示中のタブの近くに、空のメモのセルを置いて、ここで開きます。呼称セットは、いま開いているメモと同じにします');
  // 型を貼る ▾：保存してある型の一覧（docs/plan-card-templates.md の Phase 1c）。選ぶと、このメモの最後のカードの次に貼る
  const tplPasteWrap = el('span', 'memo-pane-menu-wrap');
  const tplPasteBtn = el('button', 'memo-pane-tool', tr('型を貼る ▾'));
  tplPasteBtn.type = 'button';
  tplPasteBtn.title = tr('登録した型のカードを、このメモの最後に貼ります（貼ったあと「元に戻す」で消せます）');
  tplPasteBtn.setAttribute('aria-haspopup', 'menu');
  tplPasteBtn.setAttribute('aria-expanded', 'false');
  const tplMenu = el('div', 'memo-pane-menu memo-pane-tplmenu');
  tplMenu.hidden = true;
  tplMenu.setAttribute('role', 'menu');
  tplPasteWrap.append(tplPasteBtn, tplMenu);
  const menuWrap = el('span', 'memo-pane-menu-wrap');
  const menuBtn = el('button', 'memo-pane-tool', '☰');
  menuBtn.type = 'button';
  menuBtn.title = tr('一覧と、上のページのリンク');
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-label', '一覧と、上のページのリンク');
  const menu = el('div', 'memo-pane-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const listItem = el('button', 'memo-pane-menu-item', tr('一覧を出す'));
  listItem.type = 'button';
  listItem.setAttribute('role', 'menuitem');
  const linkItem = el('button', 'memo-pane-menu-item', tr('上のページのリンクを入れる'));
  linkItem.type = 'button';
  linkItem.setAttribute('role', 'menuitem');
  linkItem.title = tr('今の上のページを、リンクのカードにします（文は空）');
  menu.append(listItem, linkItem);
  menuWrap.append(menuBtn, menu);
  tools.append(gotoBtn, quoteBtn, shotBtn, pageBtn, pickBtn, copyBtn, newBtn, tplPasteWrap, menuWrap, fileInput);
  band.append(bandRow, tools);

  const status = el('div', 'memo-pane-status', tr('自動で保存します'));
  // 送った直後の知らせ（切れた関連の一行と、送り先を開く・元に戻す）。右の × で両方消える。数十秒でも消える
  const sentNotice = el('div', 'memo-pane-sentnotice');
  sentNotice.hidden = true;
  const sentWarn = el('div', 'memo-pane-sentnotice-warn');
  sentWarn.hidden = true;
  const sentBar = el('div', 'memo-pane-sentbar');
  sentBar.setAttribute('role', 'status');
  const sentText = el('span', 'memo-pane-sentbar-text');
  const sentOpen = el('button', 'memo-pane-sentbar-btn', tr('送り先を開く'));
  sentOpen.type = 'button';
  const sentUndo = el('button', 'memo-pane-sentbar-btn', tr('元に戻す'));
  sentUndo.type = 'button';
  const sentClose = el('button', 'memo-pane-sentnotice-x', '×');
  sentClose.type = 'button';
  sentClose.title = tr('閉じる');
  sentClose.setAttribute('aria-label', '閉じる');
  sentBar.append(sentText, sentOpen, sentUndo);
  sentNotice.append(sentWarn, sentBar, sentClose);
  // 選ぶモードの帯（区画の下。移す・写す・新しいメモ・やめる）
  const pickBar = el('div', 'memo-pane-pickbar');
  pickBar.hidden = true;
  pickBar.setAttribute('role', 'status');
  const pickText = el('span', 'memo-pane-pickbar-text', tr('0枚を選んでいます'));
  const pickMove = el('button', 'memo-pane-pickbar-btn', tr('別のメモへ移す…'));
  pickMove.type = 'button';
  const pickCopy = el('button', 'memo-pane-pickbar-btn', tr('写す…'));
  pickCopy.type = 'button';
  const pickNew = el('button', 'memo-pane-pickbar-btn', tr('新しいメモにする'));
  pickNew.type = 'button';
  pickNew.title = tr('選んだカードを、近くに作る空のメモへ移します。呼称セットは、このメモと同じにします');
  const pickTemplate = el('button', 'memo-pane-pickbar-btn', tr('型にする…'));
  pickTemplate.type = 'button';
  const pickAsk = el('button', 'memo-pane-pickbar-btn', tr('Grok に頼む'));
  pickAsk.type = 'button';
  if (!BOT_FEATURES) pickAsk.style.display = 'none'; // 公開版（rebuild-public.ps1）
  const pickAll = el('button', 'memo-pane-pickbar-btn', tr('全部選ぶ'));  pickAll.type = 'button';
  const pickLinked = el('button', 'memo-pane-pickbar-btn', tr('つながっているカードも選ぶ'));
  pickLinked.type = 'button';
  const pickStop = el('button', 'memo-pane-pickbar-btn', tr('選ぶのをやめる'));
  pickStop.type = 'button';
  pickBar.append(pickText, pickMove, pickCopy, pickNew, pickTemplate, pickAsk, pickAll, pickLinked, pickStop);
  pickMove.addEventListener('click', () => beginSend('move', selectedIds()));
  pickCopy.addEventListener('click', () => beginSend('copy', selectedIds()));
  pickNew.addEventListener('click', () => queueSend('move', selectedIds(), null));
  pickTemplate.addEventListener('click', () => openTplDialog());
  pickAsk.addEventListener('click', () => {
    if (!view) return;
    const replies = selectedIds();
    if (replies.length === 0) return;
    ask({ command: 'askWithCards', memo: view.id, replies, linked: 'one' });
  });
  pickAll.addEventListener('click', () => {
    if (!view) return;
    for (const id of shownIds()) picked.add(id);
    renderCards(view, undefined, true);
  });
  pickLinked.addEventListener('click', () => {
    if (!view) return;
    const extra = linkedClosure(view.replies, selectedIds()).filter((id) => !picked.has(id));
    if (extra.length === 0) {
      say(tr('つながっているほかのカードはありません'));
      return;
    }
    for (const id of extra) picked.add(id);
    say(tr('つながっているカード {0} 枚を足しました', { 0: extra.length }));
    renderCards(view, undefined, true);
  });
  pickStop.addEventListener('click', () => stopPicking());
  sentOpen.addEventListener('click', () => {
    if (!sentOffer) return;
    ask({ command: 'openMemoPane', id: sentOffer.openId });
  });
  sentUndo.addEventListener('click', () => {
    if (!sentOffer) return;
    const token = sentOffer.token;
    hideSentNotice();
    ask({ command: 'undoSendReplies', token });
  });
  sentClose.addEventListener('click', () => hideSentNotice());
  // 件数の行：左は文（今の件数）、右は道具（関連の見せ方 ▾・あふれたときの注記。renderCountTools が並べる）
  const countText = el('span', 'memo-pane-count-text', tr('コメント 0（返信を入れて 0/300）'));
  const countTools = el('span', 'memo-pane-count-tools');
  // 「関連の見せ方 ▾」のボタンは作り直さない（押した欄の戻り先を保つ）。押すと欄：マウスなら押した所、キーボードならボタンの左下
  const countPick = el('button', 'memo-pane-count-view', tr('☐ 選ぶ'));
  countPick.type = 'button';
  countPick.title = tr('カードを選んで、別のメモへまとめて移す・写す');
  countPick.dataset.focusKey = 'countpick';
  countPick.addEventListener('click', () => {
    if (cardMap.isOpen) {
      say(tr('マップの中では選べません（並びに戻ってから）'));
      return;
    }
    if (pickingCards) stopPicking();
    else startPicking();
  });
  const countView = el('button', 'memo-pane-count-view', tr('関連の見せ方 ▾'));
  countView.type = 'button';
  countView.setAttribute('aria-haspopup', 'menu');
  countView.dataset.focusKey = 'countview';
  countView.addEventListener('click', (e) => {
    if (e.detail === 0) {
      const rect = countView.getBoundingClientRect();
      openLinkView(rect.left, rect.bottom, true);
    } else {
      openLinkView(e.clientX, e.clientY, false);
    }
  });
  // 「時刻順」（結んだカードが一枚でもあるときだけ出す。押すと、時刻順と並べた順を行き来する。aria-pressed は renderCountTools が当てる）
  const countTime = el('button', 'memo-pane-count-view', tr('時刻順'));
  countTime.type = 'button';
  countTime.title = tr('結んだ区間の時刻の順に並べる（動画ごと。読む画面がその動画を開いていればチャプターの仕切りも）。もう一度押すと元の並べ方に戻します');
  countTime.dataset.focusKey = 'counttime';
  countTime.addEventListener('click', () => {
    cardOrder = cardOrder === 'time' ? 'order' : 'time';
    if (view) renderCards(view, undefined, true);
  });
  // 「並び｜マップ」（関連があるときだけ出す。押すと、並びかマップへ移る。aria-pressed は renderCountTools が当てる）
  const countSwitch = el('span', 'memo-pane-count-switch');
  countSwitch.setAttribute('role', 'group');
  countSwitch.setAttribute('aria-label', '並び・マップ');
  const countList = el('button', '', tr('並び'));
  countList.type = 'button';
  countList.title = tr('カードを並びで見る');
  countList.dataset.focusKey = 'countswitch:list';
  countList.addEventListener('click', () => closeMap(true));
  const countMap = el('button', '', tr('マップ'));
  countMap.type = 'button';
  countMap.title = tr('関連のつながりを、図で見る');
  countMap.dataset.focusKey = 'countswitch:map';
  countMap.addEventListener('click', () => openMap());
  countSwitch.append(countList, countMap);
  const countline = el('div', 'memo-pane-countline');
  countline.append(countText, countTools);
  const scroll = el('div', 'memo-pane-scroll');
  const by = el('div', 'memo-pane-by');
  const body = el('textarea', 'memo-pane-body');
  body.rows = 3;
  body.placeholder = tr('ここにメモを書きます');
  const meta = el('div', 'memo-pane-meta');
  const filterBox = el('div', 'memo-pane-tagfilter'); // カードをタグで絞る札（一覧の「見出しで絞る」の memo-pane-filter とは別）
  filterBox.hidden = true;
  const cards = el('div', 'memo-pane-cards');
  const compose = el('form', 'memo-pane-compose');
  const composeLabel = el('div', 'memo-pane-compose-label', tr('＋コメント'));
  const comment = el('textarea');
  comment.rows = 2;
  comment.placeholder = tr('コメントを書く（Ctrl+Enter で足す・Shift+Enter で次の行に足す）');
  comment.setAttribute('aria-label', 'コメントを書く');
  const composeRow = el('div', 'memo-pane-compose-row');
  const meter = el('span', 'memo-pane-meter', `0 / ${REPLY_FOLD}`);
  const hint = el('span', 'memo-pane-longhint', tr('長め：カードでは 280字まで見せて、続きは開きます'));
  hint.hidden = true;
  const sendBtn = el('button', 'preview-button', tr('足す'));
  sendBtn.type = 'submit';
  const nextRowLabel = el('label', 'memo-pane-compose-nextrow');
  const nextRowCheck = el('input');
  nextRowCheck.type = 'checkbox';
  nextRowCheck.checked = readNextRow();
  const nextRowText = el('span', '', tr('次の行に'));
  nextRowLabel.append(nextRowCheck, nextRowText);
  nextRowCheck.addEventListener('change', () => writeNextRow(nextRowCheck.checked));
  // 読む画面の今のマスと結ぶ（V2b・D24）：読む画面が動画を開いているときだけ出す。既定はオフ（覚えない）
  const atLabel = el('label', 'memo-pane-compose-at');
  const atCheck = el('input');
  atCheck.type = 'checkbox';
  const atText = el('span', '', '');
  atLabel.append(atCheck, atText);
  atLabel.hidden = true;
  composeRow.append(atLabel, meter, hint, nextRowLabel, sendBtn);
  compose.append(composeLabel, comment, composeRow);
  // カードの並びと関連線の層の包み（L3）。線の層は並びの前に置き、関連があるときはカードを position: relative にして、DOM の順で線の上に重ねる
  //   （isolation で重なりの文脈を作ると、カードの中の「＋タグ」の候補の欄が「＋コメント」の欄より下になるため使わない）
  const cardsWrap = el('div', 'memo-pane-cards-wrap');
  const linkLayer = new LinkLayer({ title: (link) => linkLineTitle(link), click: (link, e) => onLinkClick(link, e) });
  cardsWrap.append(linkLayer.svg, cards);
  scroll.append(by, body, meta, filterBox, cardsWrap, compose);
  const main = el('div', 'memo-pane-main');
  // 一覧は、帯の題名を押すと浮く窓（本文の上に重ねる。区画の高さは取らない）
  const listWindow = el('div', 'memo-pane-list-window');
  listWindow.id = 'memo-pane-list-window';
  listWindow.setAttribute('role', 'dialog');
  listWindow.setAttribute('aria-label', 'メモの一覧');
  listWindow.hidden = true;
  const filter = el('input', 'memo-pane-filter');
  filter.type = 'search';
  filter.placeholder = tr('見出しで絞る');
  filter.setAttribute('aria-label', '見出しで絞る');
  const listBody = el('div', 'memo-pane-list-body');
  // 札：このシートと最近の、どちらを見せるか（押すと替わる。文字と押された印は renderList が付ける）
  const listParts = el('div', 'memo-pane-list-parts');
  listParts.setAttribute('role', 'group');
  listParts.setAttribute('aria-label', '一覧の切り替え');
  const sheetPartBtn = el('button', 'memo-pane-list-part');
  sheetPartBtn.type = 'button';
  sheetPartBtn.dataset.focusKey = 'listpart:sheet';
  const recentPartBtn = el('button', 'memo-pane-list-part');
  recentPartBtn.type = 'button';
  recentPartBtn.dataset.focusKey = 'listpart:recent';
  listParts.append(sheetPartBtn, recentPartBtn);
  sheetPartBtn.addEventListener('click', () => choosePart('sheet'));
  recentPartBtn.addEventListener('click', () => choosePart('recent'));
  // 入力できるあいだだけ、検索窓の下にワードのボタンを出す。欄から離れると閉じる
  const filterWords = mountMemoFilterWords({
    filter,
    onApply: () => {
      armedItem = null; // ワードで絞ったときも、書きかけの印は外す
      listQuery = filter.value;
      renderList();
    },
    status: (text) => {
      status.textContent = text;
    },
  });
  listWindow.append(filterWords.box, listParts, listBody);
  main.append(scroll);
  const empty = el('div', 'memo-pane-empty', tr('メモのセルをダブルクリックすると、ここに開きます'));
  const light = el('div', 'memo-pane-light');
  light.hidden = true;
  const lightImg = el('img');
  lightImg.alt = tr('大きく見た画像');
  const lightClose = el('button', 'memo-pane-light-close', '×');
  lightClose.type = 'button';
  lightClose.title = tr('画像を閉じる');
  lightClose.setAttribute('aria-label', '大きく見た画像を閉じる');
  light.append(lightImg, lightClose);
  // 段 D7：カードとセルの顔の画像を書き足す面。小窓とは別の文。やめるまではファイルも台帳も変えない
  const annotate = new BotImageEdit(readImageHints, cardImageEditLabels);
  const annotateLayer = el('div', 'memo-pane-annotate');
  annotateLayer.hidden = true;
  annotateLayer.append(annotate.element);
  // 関連づけている間の案内（状態の行と件数の行の上に重ねる。区画の高さは取らない）
  const linkBar = el('div', 'memo-pane-linkbar');
  linkBar.setAttribute('role', 'status');
  linkBar.hidden = true;
  const linkText = el('span', 'memo-pane-linkbar-text');
  const linkPick = el('button', 'memo-pane-linkbar-pick', tr('一覧から選ぶ'));
  linkPick.type = 'button';
  linkPick.addEventListener('click', () => openLinkPicker());
  const linkCancel = el('button', 'memo-pane-linkbar-cancel', tr('やめる（Esc）'));
  linkCancel.type = 'button';
  linkCancel.addEventListener('click', () => endLinking(true));
  linkBar.append(linkText, linkPick, linkCancel);
  // 相手の一覧の窓（関連づけている間だけ。帯の「一覧から選ぶ」で開く。字で絞れる・↑↓で動く）
  const linkPicker = el('div', 'memo-pane-link-picker');
  linkPicker.setAttribute('role', 'dialog');
  linkPicker.setAttribute('aria-label', '関連の相手を選ぶ');
  linkPicker.hidden = true;
  const linkFilter = el('input', 'memo-pane-link-picker-filter');
  linkFilter.type = 'search';
  linkFilter.placeholder = tr('相手のカードを字で絞る');
  linkFilter.setAttribute('aria-label', '相手のカードを字で絞る');
  const linkList = el('div', 'memo-pane-link-picker-list');
  linkPicker.append(linkFilter, linkList);
  linkFilter.addEventListener('input', () => renderLinkPicker());
  linkPicker.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeLinkPicker(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (movePickerFocus(e.key === 'ArrowDown')) e.preventDefault();
  });
  // 型にする小窓（選ぶ帯の「型にする…」。名前とフォルダを決めて、型として登録する。計画書 docs/plan-card-templates.md の Phase 1b）
  const tplDialog = el('div', 'memo-pane-tpl-dialog');
  tplDialog.setAttribute('role', 'dialog');
  tplDialog.setAttribute('aria-label', '型として登録');
  tplDialog.hidden = true;
  const tplHead = el('div', 'memo-pane-tpl-head', tr('選んだカードを型として登録'));
  const tplCounts = el('div', 'memo-pane-tpl-counts');
  const tplExcluded = el('div', 'memo-pane-tpl-excluded');
  const tplNameLabel = el('label', 'memo-pane-tpl-label', tr('名前'));
  const tplName = el('input', 'memo-pane-tpl-name');
  tplName.type = 'text';
  tplName.maxLength = TEMPLATE_LIMITS.name;
  tplName.placeholder = tr('例：賛成・反対・結論');
  tplName.setAttribute('aria-label', '型の名前');
  tplNameLabel.append(tplName);
  const tplFolders = el('div', 'memo-pane-tpl-folders');
  tplFolders.setAttribute('role', 'group');
  tplFolders.setAttribute('aria-label', 'フォルダ');
  const tplFolderBtns = TEMPLATE_FOLDERS.map((folder) => {
    const btn = el('button', 'memo-pane-tpl-folder', folder);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      tplFolder = folder;
      paintTplFolders();
    });
    return btn;
  });
  tplFolders.append(...tplFolderBtns);
  // モード：そのまま／骨組み／穴あき（Phase 3）
  const tplModes = el('div', 'memo-pane-tpl-folders');
  tplModes.setAttribute('role', 'group');
  tplModes.setAttribute('aria-label', 'モード');
  const tplModeBtns = TEMPLATE_MODES.map((mode) => {
    const btn = el('button', 'memo-pane-tpl-folder', MODE_LABELS[mode]);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      tplMode = mode;
      paintTplModes();
      refreshTplPreview();
    });
    return btn;
  });
  tplModes.append(...tplModeBtns);
  const tplModeNote = el('div', 'memo-pane-tpl-excluded');
  const tplMsg = el('div', 'memo-pane-tpl-msg');
  tplMsg.setAttribute('role', 'status');
  const tplSave = el('button', 'memo-pane-tpl-btn', tr('登録'));
  tplSave.type = 'button';
  const tplCancel = el('button', 'memo-pane-tpl-btn', tr('やめる'));
  tplCancel.type = 'button';
  const tplButtons = el('div', 'memo-pane-tpl-buttons');
  tplButtons.append(tplCancel, tplSave);
  tplDialog.append(tplHead, tplCounts, tplExcluded, tplNameLabel, tplFolders, tplModes, tplModeNote, tplMsg, tplButtons);
  // 空欄を入れて貼る小窓（穴あきの型を貼る前。空のままの欄は {{…}} のまま貼る）
  const tplFill = el('div', 'memo-pane-tpl-dialog');
  tplFill.setAttribute('role', 'dialog');
  tplFill.setAttribute('aria-label', '空欄を入れて貼る');
  tplFill.hidden = true;
  const tplFillHead = el('div', 'memo-pane-tpl-head', tr('空欄を入れて貼る'));
  const tplFillName = el('div', 'memo-pane-tpl-counts');
  const tplFillFields = el('div', 'memo-pane-tpl-fillfields');
  const FILL_NOTE = tr('空のままの欄は {{…}} のまま貼ります');
  const tplFillNote = el('div', 'memo-pane-tpl-excluded', FILL_NOTE);
  const tplFillMsg = el('div', 'memo-pane-tpl-msg');
  tplFillMsg.setAttribute('role', 'status');
  const tplFillPaste = el('button', 'memo-pane-tpl-btn', tr('貼る'));
  tplFillPaste.type = 'button';
  const tplFillCancel = el('button', 'memo-pane-tpl-btn', tr('やめる'));
  tplFillCancel.type = 'button';
  const tplFillButtons = el('div', 'memo-pane-tpl-buttons');
  const tplFillLoad = el('button', 'memo-pane-tpl-btn memo-pane-tpl-btn-left', tr('穴埋めファイルを読み込む…'));
  tplFillLoad.type = 'button';
  tplFillLoad.title = tr('Grok Bot が返した穴埋めのファイル（honeycomb-cardtpl-fill）を選んで、空欄に先に入れます（入れるだけ。貼るのは「貼る」を押したとき）');
  tplFillButtons.append(tplFillLoad, tplFillCancel, tplFillPaste);
  tplFill.append(tplFillHead, tplFillName, tplFillFields, tplFillNote, tplFillMsg, tplFillButtons);
  // 型の窓（パレット）：「型を貼る ▾」の「型の窓を開く」か `/` キーで開く、重なる窓（Phase 2）。検索・フォルダ・サムネイル・矢印で選ぶ・選ぶと並びに「入る番地」の点線（ゴースト）
  const tplPalette = el('div', 'memo-pane-tplpal');
  tplPalette.setAttribute('role', 'dialog');
  tplPalette.setAttribute('aria-label', '型の窓');
  tplPalette.hidden = true;
  const tplPalFilter = el('input', 'memo-pane-tplpal-filter');
  tplPalFilter.type = 'text';
  tplPalFilter.placeholder = tr('名前・カードの文で絞る（↑↓で選び、Enter で貼る）');
  tplPalFilter.setAttribute('role', 'combobox');
  tplPalFilter.setAttribute('aria-label', '型を絞る');
  tplPalFilter.setAttribute('aria-controls', 'memo-pane-tplpal-list');
  tplPalFilter.setAttribute('aria-expanded', 'true');
  tplPalFilter.setAttribute('aria-autocomplete', 'list');
  const tplPalFolders = el('div', 'memo-pane-tplpal-folders');
  tplPalFolders.setAttribute('role', 'group');
  tplPalFolders.setAttribute('aria-label', 'フォルダで絞る');
  for (const folder of [null, ...TEMPLATE_FOLDERS]) {
    const chip = el('button', 'memo-pane-tplpal-chip', folder ?? tr('全部'));
    chip.type = 'button';
    chip.addEventListener('click', () => {
      palFolder = folder;
      renderPalette();
      selectTemplate(palSel, true);
      tplPalFilter.focus();
    });
    tplPalFolders.append(chip);
  }
  const tplPalNote = el('div', 'memo-pane-tplpal-note');
  tplPalNote.setAttribute('role', 'status');
  const tplPalList = el('div', 'memo-pane-tplpal-list');
  tplPalList.id = 'memo-pane-tplpal-list';
  tplPalList.setAttribute('role', 'listbox');
  tplPalList.setAttribute('aria-label', '型の一覧');
  const tplPalInfo = el('div', 'memo-pane-tplpal-info');
  tplPalInfo.setAttribute('aria-live', 'polite');
  const tplPalHint = el('div', 'memo-pane-tplpal-hint', tr('↑↓ で選ぶ・Enter かクリックで貼る・Esc で閉じる'));
  const tplPalRestore = el('button', 'memo-pane-tplpal-restore', tr('初期サンプルを復元'));
  tplPalRestore.type = 'button';
  tplPalRestore.title = tr('足りない内蔵サンプルの型だけを足します（今ある型は変えません）');
  const tplPalExport = el('button', 'memo-pane-tplpal-restore', tr('書き出す'));
  tplPalExport.type = 'button';
  tplPalExport.title = tr('型を ui-data\\exports にファイルとして書き出します（全部。1 件だけは、その行の「書出」）');
  const tplPalImport = el('button', 'memo-pane-tplpal-restore', tr('読み込む…'));
  tplPalImport.type = 'button';
  tplPalImport.title = tr('書き出した型のファイル（JSON）を選んで、足します（今ある型は消しません）。Grok Bot の穴埋めのファイルなら、空欄を入れた小窓が開きます（貼るのは「貼る」を押したとき）');
  const tplPalAsk = el('button', 'memo-pane-tplpal-restore', tr('Grok に頼む…'));
  if (!BOT_FEATURES) tplPalAsk.style.display = 'none'; // 公開版（rebuild-public.ps1）：Grok 機能が既定オフ  tplPalAsk.type = 'button';
  tplPalAsk.title = tr('Grok Bot に型の下書きを頼む文を作って、コピーします（アプリは何も送りません。貼って送るのはあなたです）');
  const tplPalTools = el('div', 'memo-pane-tplpal-tools');
  tplPalTools.append(tplPalAsk, tplPalExport, tplPalImport, tplPalRestore);
  const tplPalFoot = el('div', 'memo-pane-tplpal-foot');
  tplPalFoot.append(tplPalHint, tplPalTools);
  tplPalette.append(tplPalFilter, tplPalFolders, tplPalNote, tplPalList, tplPalInfo, tplPalFoot);

// 型の窓からカードの区画へドラッグしている間の札（ポインターの右下。題の並べ替えの札と同じ見た目）
const tplDragChip = el('div', 'memo-pane-drag-chip');
tplDragChip.hidden = true;
tplDragChip.setAttribute('aria-hidden', 'true');

// 型の読み込みの確かめの小窓（Phase 4）：選んだファイルの中身を見せて、「足す」で初めて保存する
const tplImport = el('div', 'memo-pane-tpl-dialog');
tplImport.setAttribute('role', 'dialog');
tplImport.setAttribute('aria-label', '型の読み込み');
tplImport.hidden = true;
const tplImportHead = el('div', 'memo-pane-tpl-head', tr('型の読み込み'));
const tplImportName = el('div', 'memo-pane-tpl-counts');
const tplImportList = el('div', 'memo-pane-tpl-importlist');
const tplImportNote = el('div', 'memo-pane-tpl-excluded');
const tplImportMsg = el('div', 'memo-pane-tpl-msg');
tplImportMsg.setAttribute('role', 'status');
const tplImportOk = el('button', 'memo-pane-tpl-btn', tr('足す'));
tplImportOk.type = 'button';
const tplImportCancel = el('button', 'memo-pane-tpl-btn', tr('やめる'));
tplImportCancel.type = 'button';
const tplImportButtons = el('div', 'memo-pane-tpl-buttons');
tplImportButtons.append(tplImportCancel, tplImportOk);
tplImport.append(tplImportHead, tplImportName, tplImportList, tplImportNote, tplImportMsg, tplImportButtons);

// Grok Bot に型の下書きを頼む小窓（Phase 5c）：目的・今ある型の名前・材料のカードの文を選び、送る文をそのまま見せて、「コピーする」でクリップボードへ（自動送信はしない）
const tplAsk = el('div', 'memo-pane-tpl-dialog');
tplAsk.setAttribute('role', 'dialog');
tplAsk.setAttribute('aria-label', 'Grok Bot に型の下書きを頼む');
tplAsk.hidden = true;
const tplAskHead = el('div', 'memo-pane-tpl-head', tr('Grok Bot に型の下書きを頼む'));
const tplAskLead = el('div', 'memo-pane-tpl-excluded', tr('頼む文を作ってコピーします。{0}', { 0: ASK_NOTE }));
const tplAskPurposeLabel = el('label', 'memo-pane-tpl-label');
const tplAskPurpose = el('textarea', 'memo-pane-tpl-name');
tplAskPurpose.rows = 3;
tplAskPurpose.maxLength = ASK_LIMITS.purpose;
tplAskPurpose.placeholder = tr('例）読書会の準備に使う、5 枚くらいの型。本の要点と話したい問いを書き込める穴あきの型');
tplAskPurposeLabel.append(el('span', '', tr('どんな型がほしいですか（必須）')), tplAskPurpose);
const tplAskNamesChk = el('input');
tplAskNamesChk.type = 'checkbox';
const tplAskNamesText = el('span');
const tplAskNamesRow = el('label', 'memo-pane-tpl-checkrow');
tplAskNamesRow.append(tplAskNamesChk, tplAskNamesText);
const tplAskMatChk = el('input');
tplAskMatChk.type = 'checkbox';
const tplAskMatText = el('span');
const tplAskMatRow = el('label', 'memo-pane-tpl-checkrow');
tplAskMatRow.append(tplAskMatChk, tplAskMatText);
const tplAskMatNote = el('div', 'memo-pane-tpl-excluded');
const tplAskPreviewLabel = el('label', 'memo-pane-tpl-label');
const tplAskPreview = el('textarea', 'memo-pane-tpl-name');
tplAskPreview.rows = 8;
tplAskPreview.readOnly = true;
tplAskPreviewLabel.append(el('span', '', tr('コピーする文（このとおりに入ります）')), tplAskPreview);
const tplAskCount = el('div', 'memo-pane-tpl-excluded');
const tplAskMsg = el('div', 'memo-pane-tpl-msg');
tplAskMsg.setAttribute('role', 'status');
const tplAskCopy = el('button', 'memo-pane-tpl-btn', tr('コピーする'));
tplAskCopy.type = 'button';
const tplAskCancel = el('button', 'memo-pane-tpl-btn', tr('やめる'));
tplAskCancel.type = 'button';
const tplAskButtons = el('div', 'memo-pane-tpl-buttons');
tplAskButtons.append(tplAskCancel, tplAskCopy);
tplAsk.append(tplAskHead, tplAskLead, tplAskPurposeLabel, tplAskNamesRow, tplAskMatRow, tplAskMatNote, tplAskPreviewLabel, tplAskCount, tplAskMsg, tplAskButtons);
  // 読み上げだけの欄（並べ替えの結果など。状態の行は保存のたびに文が入るので live にしない。plan-memo-card-order の O2）
  const announcer = el('div', 'sr-only');
  announcer.setAttribute('role', 'status');
  root.append(handle, band, status, sentNotice, countline, main, pickBar, listWindow, linkBar, linkPicker, tplDialog, tplPalette, tplFill, tplImport, tplAsk, tplDragChip, empty, light, annotateLayer, announcer);
  document.body.append(root);

  // 段 9 の上半分のときだけ、下の包みの中を基準にする。包みが無いときは、今までどおり区画そのもの
  function flowFrame(): HTMLElement {
    const lower = root.querySelector(':scope > .memo-pane-lower');
    return lower instanceof HTMLElement ? lower : root;
  }

  // 上半分の境目。下の帯の高さとは別。旗が無いときは setCardsUpper(true) が来ない
  let upperRatio = UPPER_SPLIT_DEFAULT;
  let upperOwner: 'cards' | 'board' = 'cards'; // 上の入れ物の持ち主（割合の鍵が持ち主ごとに別。案 C・C3）
  let upperSplitObserver: ResizeObserver | null = null;
  const readOwnerRatio = () => (upperOwner === 'board' ? readBoardUpperRatio() : readUpperRatio());
  const writeOwnerRatio = (ratio: number) => void (upperOwner === 'board' ? writeBoardUpperRatio(ratio) : writeUpperRatio(ratio));

  function splittableHeight(): number {
    const handle = root.querySelector(':scope > .grok-cards-upper-split');
    const handleH = handle instanceof HTMLElement ? handle.offsetHeight : 0;
    return Math.max(0, root.clientHeight - handleH);
  }

  function layoutUpperSplit() {
    const upper = root.querySelector(':scope > .grok-cards-upper');
    const lower = root.querySelector(':scope > .memo-pane-lower');
    if (!(upper instanceof HTMLElement) || !(lower instanceof HTMLElement)) return;
    const total = splittableHeight();
    const shown = clampUpperRatio(total, upperRatio);
    upper.style.flexGrow = String(shown);
    lower.style.flexGrow = String(1 - shown);
    const handle = root.querySelector(':scope > .grok-cards-upper-split');
    if (handle instanceof HTMLElement) {
      const edge = total >= UPPER_SPLIT_MIN * 2 ? Math.round((UPPER_SPLIT_MIN / total) * 100) : 50;
      handle.setAttribute('aria-valuemin', String(edge));
      handle.setAttribute('aria-valuemax', String(100 - edge));
      handle.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
    }
  }

  function setUpperRatio(next: number, persist: boolean) {
    upperRatio = clampUpperRatio(splittableHeight(), next);
    layoutUpperSplit();
    if (persist) writeOwnerRatio(upperRatio);
  }

  function wireUpperSplit(handle: HTMLElement) {
    let pointerId: number | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointerId !== null) return;
      pointerId = e.pointerId;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        // 捕まえられないときも、この面に届いた移動は境目を動かす
      }
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointerId) return;
      const rect = root.getBoundingClientRect();
      const total = Math.max(0, rect.height - handle.offsetHeight);
      setUpperRatio(upperRatioFromOffset(total, e.clientY - rect.top - handle.offsetHeight / 2), false);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      writeOwnerRatio(upperRatio);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    handle.addEventListener('dblclick', () => setUpperRatio(UPPER_SPLIT_DEFAULT, true));
    handle.addEventListener('keydown', (e) => {
      const total = splittableHeight();
      if (e.key === 'ArrowUp') setUpperRatio(nudgeUpperRatio(total, upperRatio, -UPPER_SPLIT_STEP), true);
      else if (e.key === 'ArrowDown') setUpperRatio(nudgeUpperRatio(total, upperRatio, UPPER_SPLIT_STEP), true);
      else if (e.key === 'Home') setUpperRatio(0, true);
      else if (e.key === 'End') setUpperRatio(1, true);
      else return;
      e.preventDefault();
    });
  }

  function watchUpperSplit() {
    upperSplitObserver ??= new ResizeObserver(() => {
      if (root.classList.contains('is-cards-upper')) layoutUpperSplit();
    });
    upperSplitObserver.observe(root);
  }

  function unwatchUpperSplit() {
    upperSplitObserver?.disconnect();
    upperSplitObserver = null;
  }

  // 上半分のあいだだけ子を二つに分ける。旗が無いときは呼ばれない（呼ばれても、戻すと元の並び）
  //   owner：上の入れ物に入れるもの（'cards' ＝ Grok Cards、'board' ＝ ボード。既定は今までどおり Grok Cards）。上のまま持ち主だけが替わるときは、境目の割合と名前だけ替える
  function setCardsUpper(on: boolean, owner: 'cards' | 'board' = 'cards') {
    const onNow = root.classList.contains('is-cards-upper');
    if (on && onNow && owner !== upperOwner) {
      upperOwner = owner;
      root.querySelector(':scope > .grok-cards-upper-split')?.setAttribute('aria-label', SPLIT_LABEL[owner]);
      upperRatio = readOwnerRatio();
      layoutUpperSplit();
      return;
    }
    if (on === onNow) return;
    if (on) {
      const upper = el('div', 'grok-cards-upper');
      const split = el('div', 'grok-cards-upper-split');
      split.tabIndex = 0;
      split.setAttribute('role', 'separator');
      split.setAttribute('aria-orientation', 'horizontal');
      upperOwner = owner;
      split.setAttribute('aria-label', SPLIT_LABEL[owner]);
      split.title = tr('ドラッグで上下の高さを変える。ダブルクリックで半分に戻します');
      wireUpperSplit(split);
      const lower = el('div', 'memo-pane-lower');
      while (root.firstChild) lower.append(root.firstChild);
      root.append(upper, split, lower);
      root.classList.add('is-cards-upper');
      upperRatio = readOwnerRatio();
      layoutUpperSplit();
      watchUpperSplit();
      return;
    }
    unwatchUpperSplit();
    const upper = root.querySelector(':scope > .grok-cards-upper');
    if (upper) {
      // 持ち主（Grok Cards の根・ボードの面）を下の枠へ戻す。通常は呼ぶ側が先に戻してある
      for (const owned of upper.querySelectorAll(':scope > .grok-cards, :scope > .memo-board')) main.append(owned);
    }
    upperOwner = 'cards';
    const lower = root.querySelector(':scope > .memo-pane-lower');
    if (lower) while (lower.firstChild) root.append(lower.firstChild);
    upper?.remove();
    lower?.remove();
    root.querySelector(':scope > .grok-cards-upper-split')?.remove();
    root.classList.remove('is-cards-upper');
  }

  let view: MemoPaneView | null = null;
  // ボードが見るメモの写し（左の memoBoardView。選んでいる間だけ届く。plan-board-memo-switch の M2）。null＝選んでいない＝ボードは下の区画の view を見る（今までどおり）
  let boardSentAt: number | null = null; // ボードが最後に型の貼り付け（sendReplies）を送った時刻（M3）
  let boardMemoView: MemoPaneView | null = null;
  const imageMenu = new CellMenu(); // カードの画像の右クリック（menu は ☰ のメニュー）
  const linkMenu = new CellMenu(); // 関連の小さな欄（種類を選ぶ・この関連を外す）
  // 浮いたカードの層：並びの「見る」・マップの右クリックで出したカードと、「このカードの関連」の欄（relMenu）を、同じ層・同じ前後の順に入れる。
  //   押した・焦点が入った・新しく出したものが前。ほかの小さな欄（⋯・セットなど。body の z-index 50）はいつもこの層より上
  const floats = el('div', 'memo-pane-floats');
  const frontStack = new FrontStack();
  const relMenu = new CellMenu({ host: floats, keepOpen: (target) => floats.contains(target) }); // 「このカードの関連」（出したカードを押しても閉じない）
  frontStack.watch(relMenu.node);
  // 出したカードが避けるもの：開いている「このカードの関連」の欄（層の中の位置）
  const popObstacles = (): MapBox[] => {
    if (!relMenu.isOpen) return [];
    const frame = floats.getBoundingClientRect();
    const r = relMenu.node.getBoundingClientRect();
    return [{ left: r.left - frame.left, top: r.top - frame.top, right: r.right - frame.left, bottom: r.bottom - frame.top }];
  };
  // 関連のマップ（M5）：区画に重ねる窓。札を押すと、窓を閉じて並びでそのカードへ移る。窓は区画の根の中で、大きく見た画像より前に入れる
  const topCard = (id: string) => view?.replies.find((r) => r.id === id && r.parent === null);
  const cardMap = new MemoCardMap({
    label: (id) => {
      const r = topCard(id);
      return r ? cardLabel(r, 18) : '';
    },
    tooltip: (id) => {
      const r = topCard(id);
      if (!r) return '';
      const tags = (r.tags ?? []).filter((tag) => !isMachineTag(tag));
      return `${cardLabel(r, 80)}${tags.length > 0 ? `　${tags.map((t) => `#${t}`).join(' ')}` : ''}`;
    },
    mark: (id) => {
      const r = topCard(id);
      return r ? kindMark(r) : '';
    },
    dot: (id) => {
      const tag = (topCard(id)?.tags ?? []).find((item) => !isMachineTag(item));
      return tag ? tagColor(tag) : null;
    },
    lineTitle: (link) => linkLineTitle(link),
    pick: (id) => {
      closeMap(false);
      jumpToLinked(id);
    },
    close: () => closeMap(true),
    // 札の右クリック：並びと同じ作りの元のカード（つまみの代わりに「✕ 閉じる」。🔗 は使えない）
    cardView: (id, control) => {
      const r = topCard(id);
      return r && view ? commentCard(view, r, control) : null;
    },
  }, { layer: floats, stack: frontStack, obstacles: popObstacles });
  root.insertBefore(cardMap.el, light); // root.append の並びの、light の前（cardMap は linkMenu の近くで作るため、ここで入れる）
  // 並びの「関連」の「見る」で出したカード（memo-card-pops.ts）：元のカード（関連の一覧を開いたカード）の横に出して止める。
  //   層は区画の根いっぱい（マップより下）。置ける所はカードの並びの箱の中。マップを開く・メモが替わる・区画を閉じると閉じる
  root.insertBefore(floats, light); // マップの窓より上、大きく見た画像より下
  const listPops = new CardPops({
    layer: floats,
    stack: frontStack,
    obstacles: popObstacles,
    area: () => {
      if (scroll.hidden) return null;
      const frame = floats.getBoundingClientRect();
      const r = scroll.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { left: r.left - frame.left, top: r.top - frame.top, right: r.right - frame.left, bottom: r.bottom - frame.top };
    },
    build: (id, control) => {
      const r = topCard(id);
      return r && view ? commentCard(view, r, control, 'list') : null;
    },
    label: (id) => {
      const r = topCard(id);
      return r ? cardLabel(r, 18) : '';
    },
  });
  // つまみのドラッグで並べ替える（plan-memo-card-order の O3）。頼むのは moveCard（O2 と同じ道）。押している間は、カードの描き直しを待つ
  let statusBeforeGrab = ''; // つまむ前の状態の行（元の位置で離したら戻す）
  const cardDrag = new CardDrag({
    root,
    scroll,
    wrap: cardsWrap,
    cards,
    canStart: () => linking === null && !cardMap.isOpen && drag === null,
    chip: (id) => {
      const ids = idsForDrag(id);
      if (ids.length > 1) return tr('{0}枚', { 0: ids.length });
      const reply = view?.replies.find((r) => r.id === id);
      return reply ? `${kindMark(reply)} ${cardLabel(reply, 16)}` : '';
    },
    onStart: () => {
      statusBeforeGrab = status.textContent ?? '';
      linkMenu.close();
      relMenu.close();
      moreMenu.close();
      tagMenu.close();
      dragHint = tr('置きたい所で離します。一覧のメモの上で離すと移します（Ctrl で写す）。Esc でやめます');
      say(dragHint);
    },
    listHit: (x, y) => listHit(x, y),
    listHover: (id, copy) => {
      if (!id || id === 'same') {
        paintDropHint(null);
        if (id === 'same') status.textContent = tr('同じメモへは送れません');
        else if (dragHint) status.textContent = dragHint;
        return;
      }
      paintDropHint(id);
      const name = id === 'new' ? tr('新しいメモ') : ([...sheetItems, ...recentItems].find((item) => item.id === id)?.title ?? tr('メモ'));
      status.textContent = copy ? tr('「{0}」へ写します（離すと写す）', { 0: name }) : tr('「{0}」へ移します（離すと移す。Ctrl で写す）', { 0: name });
    },
    onListDrop: (id, target, copy) => {
      dragHint = '';
      paintDropHint(null);
      ignoreListClick = true;
      window.setTimeout(() => {
        ignoreListClick = false;
      }, 0);
      if (target === 'same') {
        say(tr('同じメモへは送れません'));
        return;
      }
      const ids = idsForDrag(id);
      const mode = copy ? 'copy' : (sendPick?.mode ?? 'move');
      queueSend(mode, ids, target === 'new' ? null : target);
    },
    onDrop: (id, before) => {
      const current = view;
      if (!current || before === undefined) {
        status.textContent = statusBeforeGrab; // 元の位置で離した：何もしない（台帳も書かない）
        return;
      }
      // 置き場は、つまんだ時点の見えている列で決めた。今の見えている列（待ちを当てた並び）の中の位置に直して頼む
      const others = orderLists(current).visible.filter((v) => v !== id);
      const pos = before === null ? others.length : others.indexOf(before);
      if (pos < 0 || moveCard(id, pos) !== 'moved') status.textContent = statusBeforeGrab;
    },
    onCancel: () => say(tr('やめました（元の位置のまま）')),
    slots: () => (slotMode && view ? topSlots(orderedReplies(view)) : null),
    onPlace: (id, slot) => {
      if (placeCard(id, slot) !== 'moved') status.textContent = statusBeforeGrab;
    },
    onRelease: () => {
      dragHint = '';
      paintDropHint(null);
      if (cardsDirty && view && !typingTag()) renderCards(view); // 押している間に待った描き直しを 1 回
    },
  });
  let linking: { from: string; key: string } | null = null; // 関連づけている元のカード（key：始めたボタンの data-focus-key。やめたら焦点を戻す）
  let lineMode: 'all' | 'selected' | 'none' = 'all'; // 線の見せ方（覚えない。メモを替えると「すべて」）
  let slotMode = false; // 試し：カードを升目の番地に置いている（並べた順・絞っていない・3 列が入る幅）
  let fitsWide = false; // 試し：3 列が入る幅か（変わったら描き直す）
  let cardOrder: 'order' | 'chain' | 'time' = 'order'; // カードの並べ方（並べた順〈並べ替えていなければ作った順〉・つながり順・時刻順〈V2b〉。覚えない。メモを替えると並べた順）
  // 六角で見る（plan-reader-video の V2b）：読む画面からの落ちてもよい連絡と、「マスで見る」「＋コメントで結ぶ」
  let readerNow: ReaderNow | null = null; // 読む画面の今のマス（null：読む画面が動画を開いていない、またはまだ知らない）
  let readerChapters: { video: string; chapters: { start: number; title: string }[] } | null = null; // 読む画面のチャプター（時刻順の仕切り）
  let glowing: { memoId: string; replyId: string } | null = null; // 「マスで見る」で読む画面に光らせているカード
  let atPin: ReaderNow | null = null; // 「＋コメント」で結ぶマス（結ぶ欄に印があり、書き始めたときの今のマス。足したら外す）
  let selectedCard: string | null = null; // 「選んだカード」の線だけを出すときのカード（押した・焦点の入ったカード）
  let autoSelected = false; // 線路が足りなくて、自動で「選んだカード」にした
  let keepAll = false; // 手で「すべて」を選んだ（線路が足りなくても、自動で「選んだカード」に替えない。メモを替えると戻す）
  let linkFrame = 0; // 線を描き直す 1 コマの予約
  let linkShape = ''; // 前に描いた形の印（カードの位置・線・見せ方。同じなら描き直さない）
  let linkRowGap = ROW_GAP_MIN; // 今の横の隙間（関連があるとき。線路の数で 24〜48）
  let lightReply: string | null = null; // 大きく見ている画像のカードの返信 id
  let lastSent = '';
  let typedAt = 0;
  let saveTimer = 0;
  let wantFocus = false;
  let height = readMemoPanePrefs().height || MEMO_PANE_DEFAULT;
  let drag: { pointerId: number; startY: number; startHeight: number } | null = null;
  let raf = 0;
  let pendingHeight: number | null = null;
  let commentDraft = '';
  let knownMemo: string | null = null;
  const known = new Set<string>();
  const cardEdits = new Map<string, string>(); // カードの書き直しの途中
  const openBodies = new Set<string>(); // 280字を開いたカード
  const openQuotes = new Set<string>(); // 引用の文を開いたカード
  const armed = new Set<string>(); // 消すボタンを1回押したカード
  const moreMenu = new CellMenu(); // カードの「⋯」の小さな欄（書き出す・画像を開く・フォルダで見る・コピー）
  const pending: PendingReply[] = [];
  const shotUrls = new Map<string, string>();
  const shotBusy = new Set<string>();
  let annotateShot: string | null = null; // 書き足しで書いた shots の id。左が断ったら、このファイルだけ消す
  let faceAnnotate: string | null = null; // 左から届いた、セルの顔を書き足すメモの id
  let annotateBusy = false;
  // 全体の画像が 16,000 で切れたファイルの名前。保存した返信には項目が無いので、この区画を開いているあいだだけ覚える
  const truncatedFiles = new Set<string>();
  let armEdit = false; // 次に足した引用・画像のカードで、書き直しの欄を開く
  let armTimer = 0;
  let busy = false;
  let listQuery = '';
  let listPart: 'sheet' | 'recent' = 'sheet'; // 一覧の窓で見せている札（閉じると「このシート」に戻る）
  let armedItem: string | null = null; // 書きかけがあるときに 1 回押した項目の id（もう一度押すと替える）
  let sheetItems: MemoIndexItem[] = [];
  let recentItems: MemoIndexItem[] = [];
  let listSheetName = '';
  let draftSent = false; // 左に知らせた「書きかけがあるか」
  let focusN = 0; // 右の検索から移ったカードの番号（変わったときだけ移る）
  let flash: { id: string; top: boolean; until: number } | null = null; // 光らせているカード（描き直しても、続きから光らせる）
  let flashTimer = 0;
  let filterTag: string | null = null; // タグの札で絞っているタグ（覚えない。メモを替えると外す）
  let pickingCards = false; // ☐ 選ぶ（覚えない。メモを替えるとやめる）
  let tplIds: string[] = []; // 型にする小窓を開いたときに選んでいたカード（並び順）
  let tplFolder: TemplateFolder = TEMPLATE_FOLDERS[0]; // 型にする小窓で選んでいるフォルダ
  let tplMode: TemplateMode = 'snapshot'; // 型にする小窓で選んでいるモード
  let fillTpl: CardTemplate | null = null; // 空欄を入れて貼る小窓の型
  // ボードの「型を貼る ▾」から開いた空欄の小窓（B3-2b。anchor＝ボードの道具の列。埋めた型はボードへ返し、貼るのはボード側。下の区画の貼り方は変えない）
  let fillFromBoard: { anchor: HTMLElement; done: (filled: CardTemplate, notes: string[]) => void } | null = null;
  let fillInputs: { name: string; input: HTMLInputElement }[] = [];
let importIncoming: CardTemplate[] = []; // 読み込みの確かめ中の型（「足す」まで保存しない）
let importBusy = false; // ファイルを選んでいる・書き出している最中
let askBusy = false; // 頼む文をコピーしている最中
let askPurposeKeep = ''; // 頼む小窓の目的（このウィンドウを開いている間だけ覚える。保存しない）
let askNames: string[] = []; // 頼む小窓を開いたときの、今ある型の名前
let askPick: MaterialPick = { cards: [], dropped: 0, empty: 0, cut: 0 }; // 頼む小窓を開いたときに選んでいたカードの文
let palGrab: Grab | null = null; // 型の窓の行を押している・つまんでいる間のつまみ
let palDragOver: boolean | null = null; // つまんでいる間、ポインターがカードの区画の上か（変わったときだけゴーストを描き直す）
  let tplFromBoard = false; // 型にする小窓を、ボードの「型にする…」から開いている（B3-1。選ぶ帯からのときは false）
  let tplAnchor: HTMLElement | null = null; // ボードから開いたとき、小窓を出す位置の目印（ボードの道具の列）
  let tplOffsets: Record<string, { dx: number; dy: number }> | null = null; // ボードから開いたとき、選んだカードの配置（ボードの座標の差）
  const tplDoneListeners: Array<(text: string, ok: boolean) => void> = []; // ボードへ、登録の結果の一言を返す先
  let tplSaving = false; // 型を保存している間（二重に押させない）
  let palAll: CardTemplate[] = []; // 型の窓：読み込んだ型
  let palState: 'loading' | 'ok' | 'unreadable' = 'loading';
  let palSkipped = 0; // 読めなかった型の数
  let palQuery = '';
  let palFolder: TemplateFolder | null = null;
  let palSel: string | null = null; // 選んでいる型の id（ゴーストを出している型）
  let palSeq = 0; // 型の窓の読み込みの通し番号
  let ghostTpl: CardTemplate | null = null; // 並びに「入る番地」を点線で出している型（窓で選んでいる間だけ）
  let tplMenuSeq = 0; // 型を貼るメニューの読み込みの通し番号（閉じたあとに届いた読み込みは捨てる）
  const templateIo: TemplateIo = { read: (name) => readDataChecked<unknown>(name), write: (name, value) => writeData(name, value) };
  const picked = new Set<string>(); // 選んでいる一番上のカード
  let pickAnchor: string | null = null; // Shift＋クリックの端
  let sendPick: { mode: SendMode; ids: string[]; confirm: { to: string | null; cut: number; kept: number; ids: string[] } | null } | null = null;
  let sentTimer = 0;
  let sentOffer: { openId: string; token: string } | null = null;
  let pendingCutNote: string | null = null; // 送る直前に状態の行へ出した「関連が切れる」文。結果の知らせが引き取る
  let dragHint = '';
  let dropHint: HTMLElement | null = null;
  let ignoreListClick = false; // ドラッグで離した直後の click で、もう一度送らない
  const keepShown = new Set<string>(); // 絞り中に足したばかりで、タグがまだ届いていないカード（見せておく）
  let cardsDirty = false; // 「＋タグ」を書いている間に、描き直しを待った
  const pendingOrder: PendingOrder[] = []; // 頼んだ並べ替えで、写しがまだ追いついていないもの（見せる並びに当てる。台帳ではない。古い順）
  let pendingTimer = 0; // 古い待ちを捨てる時計
  let focusAfter: string | null = null; // 次の描き直しで焦点を当てる data-focus-key（並べ替えたカードのつまみ。一度当てたら消す）
  let sayTimer = 0;
  let saidAt = 0; // 並べ替えの文を出した時刻（線の注記で上書きしないため）
  let retryAllLines = false; // 並べ替えたあと、自動で「選んだカード」にした線を「すべて」に戻せるか、次の線の描き直しで一度だけ見る
  let candidates: string[] = []; // 「＋タグ」の候補（renderCards のたびに作る）
  const pinnedFeed = new PinnedTagFeed('right'); // 「＋タグ」の候補の上に出す、右サイドバーのタグのボタンの今のセット（読むだけ）
  // カードの「いつものタグ」（6 つのボタン）とセット：右サイドバーのタグのボタンと同じ台帳（tag-buttons-right.json）。変えるのは右に頼む
  const tagBook = new TagBookFeed((op, seq) => send({ type: 'relay', to: 'right', payload: { kind: 'tagButtonsOp', op, seq } }));
  const tagMenu = new CellMenu(); // カードの「セット ▾」「その他 ▾」・いつものタグの登録
  tagBook.onChange(() => {
    void pinnedFeed.reload();
    if (!view) return;
    if (typingTag()) cardsDirty = true; // 書いている間は描き直さない（閉じたら afterTagInput が描き直す）
    else renderCards(view);
  });
  // 呼称セットの台帳（全部のメモで共通）。書くのはこの区画だけ。どのセットを使うかは、開いているメモの linkSet
  //   台帳の id は左へ知らせる（新しいメモに、消えたセットを付けないため。このファイルを書くのは、ここだけ）
  const linkNameSets = new LinkNameSetStore();
  linkNameSets.onChange(() => {
    refreshLinkNames();
    tellKnownLinkSets();
  });
  linkNameSets.onSaveFailed(() => {
    status.textContent = tr('呼称セットを保存できませんでした');
  });
  window.addEventListener('pagehide', () => linkNameSets.flush());
  void linkNameSets.load();

  const editing = () => document.activeElement === body || Date.now() - typedAt < 1000;
  const refOf = (id: string) => ({ kind: 'memo' as const, id });

  function ask(action: RelayCommand) {
    send({ type: 'relay', to: 'left', payload: { kind: 'command', action } });
  }

  // 台帳にある呼称セットの id を左へ知らせる（読めなかったときは知らせない。左が空の一覧で上書きしないため）
  function tellKnownLinkSets() {
    if (!linkNameSets.ready || !linkNameSets.canWrite) return;
    ask({ command: 'noteLinkNameSetIds', ids: linkNameSets.book.sets.map((s) => s.id) });
  }

  // 書きかけ（コメントの欄・カードの書き直し・返信）があるかを、変わったときだけ左に知らせる
  function hasDraft() {
    return !!view && (comment.value.trim() !== '' || cardEdits.size > 0 || hasDrafts(refOf(view.id)));
  }
  function reportDraft() {
    const busy = hasDraft();
    if (busy === draftSent) return;
    draftSent = busy;
    ask({ command: 'memoPaneDraft', busy });
  }

  const threadUi: ThreadUi = {
    actions: {
      add: (ref, parent, text) => ask({ command: 'addReply', ref, parent, text }),
      remove: (ref, replyId) => ask({ command: 'removeReply', ref, replyId }),
      copy: (ref, replyId) => ask({ command: 'copyComment', ref, replyId }),
      ai: (ref, parent, who) => ask({ command: 'aiReply', ref, parent, who }),
      edit: (ref, replyId, text) => ask({ command: 'editReply', ref, replyId, text }),
    },
    pending,
    refresh: () => {
      if (view) renderCards(view);
    },
  };

  function fit() {
    body.style.height = 'auto';
    const line = 22;
    const next = Math.max(line * 3, Math.min(line * 8, body.scrollHeight));
    body.style.height = `${next}px`;
  }

  function clock() {
    return new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function flush(id = view?.id) {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    if (!id) return;
    const text = [...body.value].slice(0, MAX_MEMO_TEXT).join('');
    if (text === lastSent) return;
    lastSent = text;
    ask({ command: 'setMemoText', id, text });
    status.textContent = tr('保存しました {0}', { 0: clock() });
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => flush(), SAVE_MS);
  }

  function paintMeter() {
    const n = [...comment.value].length;
    meter.textContent = `${n} / ${REPLY_FOLD}`;
    meter.classList.toggle('long', n > REPLY_FOLD);
    hint.hidden = n <= REPLY_FOLD;
    const full = (view?.replies.length ?? 0) >= MAX_REPLIES;
    sendBtn.disabled = full || comment.value.trim() === '';
    sendBtn.title = full ? tr('返信は1つのメモに {0} 件までです', { 0: MAX_REPLIES }) : tr('コメントを足す（Ctrl+Enter。Shift+Enter で次の行に）');
  }

  function showCount(replies: readonly Reply[]) {
    const n = replies.filter((r) => r.parent === null).length;
    if (filterTag === null) {
      countText.textContent = tr('コメント {0}（返信を入れて {1}/{2}）', { 0: n, 1: replies.length, 2: MAX_REPLIES });
    } else {
      const m = visibleTops(replies, filterTag, keepShown).length;
      countText.textContent = tr('コメント 表示 {0} ／ 全 {1}（返信を入れて {2}/{3}）', { 0: m, 1: n, 2: replies.length, 3: MAX_REPLIES });
    }
    renderCountTools();
  }

  function fillMeta(next: MemoPaneView) {
    const like = el('button', next.liked > 0 ? 'preview-like liked' : 'preview-like', next.liked > 0 ? `♥${next.liked}` : '♡');
    like.type = 'button';
    like.title = tr('いいね（押すたびに 1→2→3→なし）');
    like.addEventListener('click', () => ask({ command: 'setMemoLiked', id: next.id, liked: (next.liked + 1) % 4 }));
    const tags = tagArea(
      { tags: next.tags, what: tr('このメモ'), change: (add, remove) => ask({ command: 'changeTags', memo: next.id, add, remove }) },
      { editable: true, toast: (text) => (status.textContent = text) },
    );
    meta.replaceChildren(tags, like);
  }

  // 描き直す前に、開いている欄の文と、どこを書いていたかを覚える
  function holdFields(): { kind: 'comment' | 'pane-edit' | 'form' | 'edit'; id?: string; key?: string; start: number; end: number } | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement)) return null;
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (active === comment) return { kind: 'comment', start, end };
    if (cardMap.el.contains(active) || floats.contains(active)) {
      // マップに出したカードの欄：書きかけだけ覚える（焦点は動かさない。そのカードは焦点がある間は作り直さない）
      const inMap = active.closest<HTMLElement>('[data-pane-edit]')?.dataset.paneEdit;
      if (inMap) cardEdits.set(inMap, active.value);
      const inMapForm = active.closest<HTMLElement>('[data-form]')?.dataset.form;
      if (inMapForm) rememberField('form', inMapForm, active.value);
      const inMapEdit = active.closest<HTMLElement>('[data-edit]')?.dataset.edit;
      if (inMapEdit) rememberField('edit', inMapEdit, active.value);
      return null;
    }
    if (!cards.contains(active)) return null;
    const paneEdit = active.closest<HTMLElement>('[data-pane-edit]');
    if (paneEdit?.dataset.paneEdit) {
      cardEdits.set(paneEdit.dataset.paneEdit, active.value);
      return { kind: 'pane-edit', id: paneEdit.dataset.paneEdit, start, end };
    }
    const form = active.closest<HTMLElement>('[data-form]');
    if (form?.dataset.form) {
      rememberField('form', form.dataset.form, active.value);
      return { kind: 'form', key: form.dataset.form, start, end };
    }
    const edit = active.closest<HTMLElement>('[data-edit]');
    if (edit?.dataset.edit) {
      rememberField('edit', edit.dataset.edit, active.value);
      return { kind: 'edit', key: edit.dataset.edit, start, end };
    }
    return null;
  }

  function restore(focus: ReturnType<typeof holdFields>) {
    if (!focus) return;
    let node: HTMLTextAreaElement | null = null;
    if (focus.kind === 'comment') node = comment;
    else if (focus.kind === 'pane-edit' && focus.id) node = cards.querySelector(`[data-pane-edit="${CSS.escape(focus.id)}"] textarea`);
    else if (focus.kind === 'form' && focus.key) node = cards.querySelector(`[data-form="${CSS.escape(focus.key)}"] textarea`);
    else if (focus.kind === 'edit' && focus.key) node = cards.querySelector(`[data-edit="${CSS.escape(focus.key)}"] textarea`);
    if (!node) return;
    node.focus();
    node.setSelectionRange(focus.start, focus.end);
  }

  // カードの中の「＋タグ」の書く欄にいるか（いるあいだは、カードを描き直さない）
  function typingTag() {
    const active = document.activeElement;
    return active instanceof HTMLInputElement && active.classList.contains('preview-tag-input') && cards.contains(active);
  }

  // 「＋タグ」の欄を閉じたら、待っていた描き直しを 1 回する（欄の外れ方によらず、tagArea の onClose から呼ぶ）
  function afterTagInput() {
    window.setTimeout(() => {
      if (cardsDirty && view && !typingTag()) renderCards(view);
    }, 0);
  }

  // 描き直す前に、フォーカスのある印つきの要素（× や「＋タグ」・札）の印を覚え、描き直したあとに戻す
  function focusKeyIn(box: HTMLElement): string | null {
    const active = document.activeElement;
    return active instanceof HTMLElement && box.contains(active) ? (active.dataset.focusKey ?? null) : null;
  }

  function refocus(box: HTMLElement, key: string | null) {
    if (key === null) return;
    box.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }

  // タグで絞る札を描く（選んでいるタグが無くなっていたら、絞りを外す）
  function renderFilter(current: MemoPaneView) {
    const counts = cardTagCounts(current.replies);
    if (filterTag !== null && !counts.some(([tag]) => tag === filterTag)) {
      filterTag = null;
      keepShown.clear();
    }
    const total = current.replies.filter((r) => r.parent === null).length;
    const key = focusKeyIn(filterBox);
    const row = cardFilterRow({ counts, total, selected: filterTag, pick });
    if (row) filterBox.replaceChildren(row);
    else filterBox.replaceChildren();
    filterBox.hidden = row === null;
    refocus(filterBox, key);
  }

  function pick(tag: string | null) {
    filterTag = tag;
    keepShown.clear();
    if (view) renderCards(view, undefined, true);
  }

  // force：「＋タグ」を書いている間も描き直す（絞りを替えた・メモを替えた・検索から移った）
  function renderCards(current: MemoPaneView, focus: ReturnType<typeof holdFields> | undefined = undefined, force = false) {
    // つまみを押している・ドラッグ中は描き直さない（つまみが作り直されると捕まえが外れる）。force の描き直しは、先にドラッグをやめる
    if (cardDrag.active) {
      if (!force) {
        cardsDirty = true;
        return;
      }
      cardsDirty = false; // やめたあとの onRelease で描き直さない（この描き直しで描く）
      cardDrag.cancel();
    }
    if (!force && typingTag()) {
      cardsDirty = true;
      return;
    }
    cardsDirty = false;
    // 関連づけている元のカードが外から消えたら、関連づけをやめる（小さな欄も閉じる）
    if (linking !== null) {
      const from = linking.from;
      if (!current.replies.some((r) => r.id === from && r.parent === null)) {
        linking = null;
        linkBar.hidden = true;
        linkMenu.close();
        relMenu.close();
        closeLinkPicker(false);
      }
    }
    if (pickingCards) {
      const alive = new Set(current.replies.filter((r) => r.parent === null).map((r) => r.id));
      for (const id of picked) if (!alive.has(id)) picked.delete(id);
    }
    const kept = focus === undefined ? holdFields() : focus;
    const cardKey = focusKeyIn(cards);
    const top = scroll.scrollTop;
    renderFilter(current);
    candidates = cardTagCandidates(current.replies, current.tags, registeredTagNames());
    const tops = visibleTops(orderedReplies(current), filterTag, keepShown); // 写しに、頼んだ並べ替え（待ち）を当てた並び
    if (cardOrder === 'chain' && !hasAnyLinks()) cardOrder = 'order'; // 関連が無くなったら並べた順に戻す（「関連の見せ方 ▾」も消えて戻せなくなるため）
    if (cardOrder === 'time' && !hasTimedCards()) cardOrder = 'order'; // 結んだカードが無くなったら並べた順に戻す（「時刻順」のボタンも消えるため）
    const nodes: HTMLElement[] = cardOrder === 'chain' ? chainNodes(current, tops) : cardOrder === 'time' ? timeNodes(current, tops) : tops.map((reply) => commentCard(current, reply));
    if (filterTag !== null && tops.length === 0) nodes.push(el('p', 'memo-pane-filter-empty', tr('このタグのカードはありません')));
    cards.classList.toggle('linking', linking !== null);
    cards.classList.toggle('picking', pickingCards);
    cardsWrap.classList.toggle('has-links', hasAnyLinks()); // 隙間と余白を線路の幅に（並べる前に。並びが一度で決まるように）
    // 試し：升目に置く（番地 = 行 × 3 ＋ 列）。絞っている・つながり順・3 列が入らない幅では、詰めて並べる
    fitsWide = fitsThreeColumns();
    slotMode = cardOrder === 'order' && filterTag === null && fitsWide;
    cards.classList.toggle('slotted', slotMode);
    paintNextRow();
    if (slotMode) {
      const slots = topSlots(orderedReplies(current));
      for (const node of nodes) {
        const slot = slots.get(node.dataset.card ?? '');
        if (slot === undefined) continue;
        node.style.gridRow = String(Math.floor(slot / CARD_COLUMNS) + 1);
        node.style.gridColumn = String((slot % CARD_COLUMNS) + 1);
      }
    }
    cards.replaceChildren(...nodes);
    paintReaderNow(); // 読む画面の今のマスと結んだカードの光り・「マスで見る」の押した印（V2b）
    paintGhost(); // 型の窓で選んでいる型の「入る番地」（描き直しても残す）
    scroll.scrollTop = top;
    restore(kept);
    refocus(cards, cardKey);
    // 並べ替えたあと：そのカードのつまみに焦点を当て、カードを見える所へ（印は一度当てたら消す）
    if (focusAfter !== null) {
      const target = cards.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusAfter)}"]`);
      focusAfter = null;
      if (target) {
        target.focus({ preventScroll: true });
        const node = target.closest<HTMLElement>('[data-card]');
        if (node) revealCardHead(node);
      }
    }
    showCount(current.replies);
    paintFlash();
    reportDraft();
    scheduleLinks();
    // マップが開いているときは、写しに合わせる（関連が無くなったら閉じる）
    if (cardMap.isOpen) {
      if (hasAnyLinks()) cardMap.update(current.replies.filter((r) => r.parent === null));
      else closeMap(false);
    }
    listPops.refresh((id) => current.replies.some((r) => r.id === id && r.parent === null)); // 並びに出したカードも写しに合わせる（消えたら閉じる）
  }

  // つながり順の並び：つながりごとに見出しの行と、そのカード（作った順）。最後に、関連の無いカードを「つながりなし」の見出しの下に
  function chainNodes(current: MemoPaneView, tops: readonly Reply[]): HTMLElement[] {
    const { chains, loose } = chainOrder(tops);
    const nodes: HTMLElement[] = [];
    for (const chain of chains) {
      nodes.push(el('p', 'memo-pane-chain-head', tr('つながり：「{0}」ほか {1} 枚', { 0: cardLabel(chain[0], 16), 1: chain.length - 1 })));
      for (const reply of chain) nodes.push(commentCard(current, reply));
    }
    if (loose.length > 0) {
      nodes.push(el('p', 'memo-pane-chain-head', tr('つながりなし（{0} 枚）', { 0: loose.length })));
      for (const reply of loose) nodes.push(commentCard(current, reply));
    }
    return nodes;
  }

  // 時刻順の並び（plan-reader-video の V2b）：動画ごとの組（題の見出し）、組の中は結んだ区間の早い順。読む画面がその動画を開いていればチャプターの仕切りも。結んでいないカードは最後
  function timeNodes(current: MemoPaneView, tops: readonly Reply[]): HTMLElement[] {
    // チャプターの仕切りは、読む画面がその動画を開いている間だけ（閉じたら onReaderNow が描き直す）
    const chapters = readerNow && readerChapters?.video === readerNow.video ? readerChapters : null;
    const order = timeOrder(tops, { first: readerNow?.video ?? null, chapters });
    const nodes: HTMLElement[] = [];
    for (const group of order.groups) {
      nodes.push(el('p', 'memo-pane-chain-head memo-pane-time-head', tr('🎬 {0}（{1} 枚）', { 0: group.title, 1: group.count })));
      for (const section of group.sections) {
        if (section.title !== null) nodes.push(el('p', 'memo-pane-chain-head memo-pane-time-chapter', `${secLabel(section.start ?? 0)} ${section.title}`));
        for (const reply of section.cards) nodes.push(commentCard(current, reply));
      }
    }
    if (order.loose.length > 0) {
      nodes.push(el('p', 'memo-pane-chain-head', tr('結んでいないカード（{0} 枚）', { 0: order.loose.length })));
      for (const reply of order.loose) nodes.push(commentCard(current, reply));
    }
    return nodes;
  }

  // ---------- 並べ替え（plan-memo-card-order の O2a）：待ちの並び・見えている列・左に頼む・読み上げ。純粋な関数は memo-card-order.ts ----------
  //   台帳を書くのは左だけ。区画は「この id の前へ」を頼み、写しが追いつくまで（多くて PENDING_ORDER_MS）は、頼んだ並べ替えを写しに当てて見せる

  // 見せる並びの返信（写しに、待ちの並べ替えを頼んだ順に当てたもの）
  function orderedReplies(current: MemoPaneView): readonly Reply[] {
    return pendingOrder.length > 0 ? withPending(current.replies, pendingOrder) : current.replies;
  }

  // 全体の並び（一番上のカードの id）と、見えている列（タグの絞りを当てたもの）。どちらも待ちを当てた並び
  function orderLists(current: MemoPaneView): { all: string[]; visible: string[] } {
    const replies = orderedReplies(current);
    return { all: orderedTops(replies).map((r) => r.id), visible: visibleTops(replies, filterTag, keepShown).map((r) => r.id) };
  }

  // 並べ替えてあるか（待ちを当てたあと。並べ方の名前「並べた順」と「作った順に戻す」を出すか）
  function isReordered(current: MemoPaneView): boolean {
    return orderedReplies(current).some((r) => r.parent === null && r.rank !== undefined);
  }

  // 今、並べ替えられるか（つながり順・関連づけている間・マップが開いている間は、並べ替えない）
  function canReorder(): boolean {
    return cardOrder === 'order' && linking === null && !cardMap.isOpen;
  }

  // 「次の行に」：升目の並び（並べた順・絞りなし・3 列）で、並べ替えできるときだけ押せる
  function paintNextRow() {
    const on = canReorder() && slotMode;
    nextRowCheck.disabled = !on;
    const title = on
      ? tr('オンのあいだ、新しい一番上のカードを、いちばん下のカードの次の行の 1 列目に足します（オフでも Shift+Enter で足すと次の行へ。返信は今までどおり）')
      : tr('今は使えません。並べた順で、絞りがなく、3 列の幅があり、並べ替えできるときだけ使えます');
    nextRowLabel.title = title;
    nextRowCheck.title = title;
    nextRowLabel.classList.toggle('is-disabled', !on);
  }

  // 状態の行と読み上げの欄に同じ文を出す（読み上げは、同じ文が続いても読むよう、一度空にしてから入れる）
  function say(text: string) {
    saidAt = Date.now();
    status.textContent = text;
    announcer.textContent = '';
    window.clearTimeout(sayTimer);
    sayTimer = window.setTimeout(() => (announcer.textContent = text), 50);
  }

  // id のカードを、見えている列（自分を除く）の pos 番目へ動かすよう左に頼み、待ちの並びで先に描く。焦点はそのカードのつまみへ
  //   moved：頼んだ／same：今の位置と同じ（何も送らない）／none：並べ替えられない（無いカード・つながり順・関連づけ中・マップ中）
  function moveCard(id: string, pos: number): 'moved' | 'same' | 'none' {
    const current = view;
    if (!current || !canReorder()) return 'none';
    const { all, visible } = orderLists(current);
    const from = visible.indexOf(id);
    if (from < 0) return 'none';
    const to = Math.max(0, Math.min(Math.trunc(pos), visible.length - 1));
    const before = beforeFor(all, visible, id, to);
    if (before === undefined) return 'same';
    pendingOrder.push({ kind: 'move', id, before, at: Date.now() });
    schedulePendingDrop();
    retryAllLines = true;
    ask({ command: 'moveReply', id: current.id, replyId: id, before });
    focusAfter = `card:${id}:move`;
    renderCards(current);
    startFlash(id, true);
    const reply = current.replies.find((r) => r.id === id);
    const where = filterTag !== null ? tr('・タグ「{0}」の中', { 0: filterTag }) : '';
    say(tr('「{0}」を {1} 枚目から {2} 枚目へ動かしました（{3} 枚中{4}）', { 0: reply ? cardLabel(reply, 16) : '', 1: from + 1, 2: to + 1, 3: visible.length, 4: where }));
    return 'moved';
  }

  // 並べた順を消すよう左に頼み（作った順に戻す）、待ちの並びで先に描く。並べ替えていなければ何もしない
  //   focusId：戻したあとに焦点を当てるカード（つまみの欄から戻したとき）
  function resetOrder(focusId?: string) {
    const current = view;
    if (!current || !isReordered(current)) return;
    pendingOrder.push({ kind: 'reset', at: Date.now() });
    schedulePendingDrop();
    retryAllLines = true;
    ask({ command: 'resetReplyOrder', id: current.id });
    if (focusId) focusAfter = `card:${focusId}:move`;
    renderCards(current);
    say(tr('作った順に戻しました'));
  }

  // 試し：id のカードを空いた番地 slot（行 × 3 ＋ 列）に置くよう左に頼み、待ちの並びで先に描く
  function placeCard(id: string, slot: number): 'moved' | 'none' {
    const current = view;
    if (!current || !canReorder() || !slotMode) return 'none';
    const replies = orderedReplies(current);
    const slots = topSlots(replies);
    const from = slots.get(id);
    if (from === undefined || from === slot || !withPlacedTop(replies, id, slot)) return 'none';
    pendingOrder.push({ kind: 'place', id, slot, at: Date.now() });
    schedulePendingDrop();
    retryAllLines = true;
    ask({ command: 'placeReply', id: current.id, replyId: id, slot });
    focusAfter = `card:${id}:move`;
    renderCards(current);
    startFlash(id, true);
    const reply = current.replies.find((r) => r.id === id);
    say(tr('「{0}」を {1} 行目の {2} 列目に置きました', { 0: reply ? cardLabel(reply, 16) : '', 1: Math.floor(slot / CARD_COLUMNS) + 1, 2: (slot % CARD_COLUMNS) + 1 }));
    return 'moved';
  }

  // 試し：空きを詰める（並べた順のまま）よう左に頼み、待ちの並びで先に描く。空きが無ければ何もしない
  function packCards(focusId?: string) {
    const current = view;
    if (!current || !hasSlotGaps(orderedReplies(current))) return;
    pendingOrder.push({ kind: 'pack', at: Date.now() });
    schedulePendingDrop();
    retryAllLines = true;
    ask({ command: 'packReplies', id: current.id });
    if (focusId) focusAfter = `card:${focusId}:move`;
    renderCards(current);
    say(tr('空きを詰めました（並びはそのまま）'));
  }

  // 「詰める」のボタン（空きがあるときだけ）
  function packButton(current: MemoPaneView, focusId?: string) {
    return hasSlotGaps(orderedReplies(current)) ? [{ label: tr('詰める'), title: tr('カードの間の空きを詰めます（並びはそのまま）'), close: true, run: () => packCards(focusId) }] : [];
  }

  // 試し：升目に置くか（並べた順・絞っていない・3 列が入る幅）。置かないときは、今までどおり詰めて並べる（番地は残る）
  function fitsThreeColumns(): boolean {
    const style = getComputedStyle(cards);
    const inner = cards.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
    const links = cardsWrap.classList.contains('has-links');
    const min = links ? 240 : 260;
    const gap = links ? 24 : 8;
    return inner >= CARD_COLUMNS * min + (CARD_COLUMNS - 1) * gap;
  }
  new ResizeObserver(() => {
    const next = fitsThreeColumns();
    if (next === fitsWide) return;
    fitsWide = next;
    if (view && cards.clientWidth > 0) renderCards(view);
  }).observe(cards);

  // 古い待ちを捨てる時計（いちばん古い待ちが PENDING_ORDER_MS を過ぎたら捨てて、写しの並びで描き直す）
  function schedulePendingDrop() {
    window.clearTimeout(pendingTimer);
    pendingTimer = 0;
    if (pendingOrder.length === 0) return;
    pendingTimer = window.setTimeout(
      () => {
        const now = Date.now();
        const count = pendingOrder.length;
        while (pendingOrder.length > 0 && now - pendingOrder[0].at >= PENDING_ORDER_MS) pendingOrder.shift();
        if (pendingOrder.length !== count && view) renderCards(view);
        schedulePendingDrop();
      },
      Math.max(0, pendingOrder[0].at + PENDING_ORDER_MS - Date.now()),
    );
  }

  // 並べ替えたカードの頭（つまみ）が見える所までスクロールする。見える所は、上に貼りつく札の列と下に貼りつく「＋コメント」の欄の間
  //   （既定の高さ 300 ではカードより見える所が狭く、scroll-margin-bottom: 140px のある scrollIntoView の nearest だと頭が隠れるため）
  function revealCardHead(node: HTMLElement) {
    const box = scroll.getBoundingClientRect();
    const top = box.top + (filterBox.hidden ? 0 : filterBox.getBoundingClientRect().height) + 4;
    const bottom = Math.min(box.bottom, compose.getBoundingClientRect().top) - 4;
    const card = node.getBoundingClientRect();
    if (card.top < top) scroll.scrollTop -= top - card.top;
    else if (card.bottom > bottom) scroll.scrollTop += Math.max(0, Math.min(card.bottom - bottom, card.top - top));
  }

  // 待ちを全部捨てる（メモが替わった・閉じた・左が並べ替えを断った）
  function clearPending() {
    pendingOrder.length = 0;
    window.clearTimeout(pendingTimer);
    pendingTimer = 0;
    focusAfter = null;
  }

  // つまみの小さな欄（並べ替え）：前へ・後ろへ・いちばん前へ・いちばん後へ・作った順に戻す。つながり順・時刻順の間は、理由と「並べた順にする」
  //   keyboard：キーボードで開いたとき、いちばん上の項目に焦点を置く
  function openGripMenu(id: string, x: number, y: number, keyboard: boolean) {
    const current = view;
    if (!current) return;
    const reply = current.replies.find((r) => r.id === id);
    if (!reply) return;
    const label = cardLabel(reply, 16);
    if (cardOrder !== 'order') {
      const name = cardOrder === 'chain' ? tr('つながり順') : tr('時刻順');
      linkMenu.open(x, y, [
        { section: tr('並べ替え：「{0}」', { 0: label }) },
        { note: tr('{0}の間は並べ替えられません。', { 0: name }) },
        {
          row: '',
          buttons: [
            {
              label: tr('並べた順にする'),
              close: true,
              run: () => {
                cardOrder = 'order';
                focusAfter = `card:${id}:move`;
                if (view) renderCards(view, undefined, true);
              },
            },
          ],
        },
      ]);
      say(tr('{0}の間は並べ替えられません', { 0: name }));
    } else {
      // 前後の計算は、押した時点の並びで行う（欄を開いた時点の n は使わない。stepCard と moveCard が、その時点の orderLists を読む）
      const { visible } = orderLists(current);
      const n = visible.indexOf(id) + 1;
      const m = visible.length;
      if (n === 0) return;
      const where = filterTag !== null ? tr('・タグ「{0}」の中', { 0: filterTag }) : '';
      linkMenu.open(x, y, [
        { section: tr('並べ替え：「{0}」（{1} 枚目／{2} 枚{3}）', { 0: label, 1: n, 2: m, 3: where }) },
        { label: tr('← 前へ'), hint: 'Alt+←', disabled: n === 1, run: () => stepCard(id, -1) },
        { label: tr('後ろへ →'), hint: 'Alt+→', disabled: n === m, run: () => stepCard(id, 1) },
        { label: tr('いちばん前へ'), disabled: n === 1, run: () => moveCard(id, 0) },
        { label: tr('いちばん後へ'), disabled: n === m, run: () => moveCard(id, Number.MAX_SAFE_INTEGER) }, // 端へは、見えている列の最後に丸められる
        'sep',
        isReordered(current)
          ? { row: tr('並び'), buttons: [...packButton(current, id), { label: tr('作った順に戻す'), confirm: tr('もう一度押すと戻します'), close: true, run: () => resetOrder(id) }] }
          : { note: tr('まだ並べ替えていません（作った順のまま）') },
      ]);
    }
    if (keyboard) linkMenu.focusFirst();
  }

  // つまみの Alt+←／Alt+→：見えている列の中で一つ前・後ろへ。端は読み上げで知らせる。つながり順・時刻順の間は、つまみの欄を開いて理由を出す
  function stepCard(id: string, delta: -1 | 1) {
    const current = view;
    if (!current) return;
    if (cardOrder !== 'order') {
      const grip = cards.querySelector<HTMLElement>(`[data-focus-key="card:${CSS.escape(id)}:move"]`);
      if (!grip) return;
      const rect = grip.getBoundingClientRect();
      openGripMenu(id, rect.left, rect.bottom, true);
      return;
    }
    if (!canReorder()) return;
    const { visible } = orderLists(current);
    const i = visible.indexOf(id);
    if (i < 0) return;
    if (i + delta < 0) say(tr('いちばん前です'));
    else if (i + delta >= visible.length) say(tr('いちばん後ろです'));
    else moveCard(id, i + delta);
  }

  // ---------- 関連線（L3）：測る・経路・描く。経路の計算は memo-card-links.ts、層は memo-card-link-layer.ts ----------

  // 今のメモの一番上のカードに、関連が 1 本でもあるか（絞りで隠れていても数える）
  function hasAnyLinks(): boolean {
    return !!view && view.replies.some((r) => r.parent === null && (r.links?.length ?? 0) > 0);
  }

  // 今のメモの一番上のカードに、結んだ区間（at）のあるカードが 1 枚でもあるか（絞りで隠れていても数える）
  function hasTimedCards(): boolean {
    return !!view && view.replies.some((r) => r.parent === null && r.at !== undefined);
  }

  // 線を 1 コマあとに描き直す（写しが届くたび・大きさが変わるたびに呼ばれるので、1 コマにまとめる）
  function scheduleLinks() {
    if (linkFrame) return;
    linkFrame = requestAnimationFrame(() => {
      linkFrame = 0;
      drawLinks();
    });
  }

  // 見えているカードを測り、経路を作って描く。横の隙間の幅が替わったら、測り直してもう一度（行と列は替わらない）
  //   形の印が前と同じなら描き直さない（本文を打っている間も写しは 150ms ごとに届くため）
  function drawLinks() {
    const current = view;
    const any = hasAnyLinks();
    cardsWrap.classList.toggle('has-links', any);
    if (!current || !any || lineMode === 'none' || scroll.hidden) {
      if (linkShape !== '') linkLayer.clear();
      linkShape = '';
      setLinkRowGap(ROW_GAP_MIN);
      return;
    }
    const shown = new Set([...cards.querySelectorAll<HTMLElement>(':scope > [data-card]')].map((node) => node.dataset.card ?? ''));
    const all = visibleLinks(createdTops(current.replies), shown); // 元のカードの作った順・付けた順（線路の取る順。並べ替えても替わらない）
    let links = all;
    if (lineMode === 'selected') links = selectedCard ? links.filter((l) => l.from === selectedCard || l.to === selectedCard) : [];
    const retry = retryAllLines;
    retryAllLines = false;
    for (let pass = 0; pass < 2; pass++) {
      const layout = measureLinkLayout(cardsWrap, cards);
      const nameKey = LINK_KINDS.map((k) => k.name).join('\u0001'); // 名前が替わったら、線の文も描き直す
    const shape = linkLayoutKey(layout, links, `${lineMode}|${lineMode === 'selected' ? (selectedCard ?? '') : ''}|${nameKey}`); // 「すべて」のときは、選んだカードが替わっても描き直さない
      if (shape === linkShape) return;
      // 線が多くて自動で「選んだカード」にしたあと、並べ替えで線路が足りるようになったら「すべて」に戻す（並べ替えのたびに一度だけ見る。手で選んだときは戻さない）
      if (retry && autoSelected && lineMode === 'selected' && !routeCardLinks(layout, all).overflow) {
        lineMode = 'all';
        autoSelected = false;
        renderCountTools();
        linkShape = '';
        scheduleLinks();
        return;
      }
      const route = routeCardLinks(layout, links);
      if (pass === 0 && route.rowGap !== linkRowGap) {
        setLinkRowGap(route.rowGap); // 隙間を替えたので、測り直す
        continue;
      }
      if (route.overflow && lineMode === 'all' && !keepAll) {
        // 相乗りしても線路が足りない：選んだカードの線だけにして知らせる（手で「すべて」に戻せる。戻したら、重なっても全部描く）
        lineMode = 'selected';
        autoSelected = true;
        // 並べ替えたばかりの文（動かしました・戻しました）は上書きしない（件数の行の注記は出る）
        if (Date.now() - saidAt > 3000) status.textContent = tr('線が多いので、選んだカードの線だけ出しています（関連の見せ方 ▾ で「すべて」に戻せます）');
        renderCountTools();
        linkShape = '';
        scheduleLinks();
        return;
      }
      linkShape = shape;
      linkLayer.draw(route.paths, layout, lineMode === 'selected' ? selectedCard : null);
      return;
    }
  }

  function setLinkRowGap(gap: number) {
    if (gap === linkRowGap) return;
    linkRowGap = gap;
    cards.style.setProperty('--link-row-gap', `${gap}px`);
  }

  // 線に乗せたときの文（「元」は「相手」の根拠）
  function linkLineTitle(link: DrawLink): string {
    const from = view?.replies.find((r) => r.id === link.from);
    const to = view?.replies.find((r) => r.id === link.to);
    if (!from || !to) return linkKindInfo(link.kind).name;
    return tr('{0}（押すと：元へ移る・相手へ移る・外す）', { 0: linkSentence(`「${cardLabel(from, 20)}」`, `「${cardLabel(to, 20)}」`, link.kind) });
  }

  // 線を押した（隙間の当たり判定）：小さな欄で、元へ移る・相手へ移る・この関連を外す
  function onLinkClick(link: DrawLink, e: MouseEvent) {
    e.stopPropagation();
    if (!view) return;
    const current = view;
    const from = current.replies.find((r) => r.id === link.from && r.parent === null);
    const to = current.replies.find((r) => r.id === link.to && r.parent === null);
    if (!from || !to) return;
    linkMenu.open(e.clientX, e.clientY, [
      { section: linkSentence(`「${cardLabel(from, 16)}」`, `「${cardLabel(to, 16)}」`, link.kind) },
      { label: tr('元へ移る'), run: () => jumpToLinked(link.from) },
      { label: tr('相手へ移る'), run: () => jumpToLinked(link.to) },
      'sep',
      {
        label: tr('この関連を外す'),
        run: () => {
          ask({ command: 'changeReplyLinks', id: current.id, replyId: link.from, add: [], remove: [{ to: link.to, kind: link.kind }] });
          status.textContent = tr('関連を外しました');
        },
      },
    ]);
  }

  // 件数の行の道具：線が多くて「選んだカード」に自動で替えたときの注記と、「関連の見せ方 ▾」（線路が無ければ何も出さない）
  function renderCountTools() {
    countPick.textContent = pickingCards ? tr('☑ 選ぶ') : tr('☐ 選ぶ');
    countPick.setAttribute('aria-pressed', String(pickingCards));
    const nodes: HTMLElement[] = [countPick];
    if (hasTimedCards()) {
      countTime.setAttribute('aria-pressed', String(cardOrder === 'time'));
      nodes.push(countTime);
    }
    if (!hasAnyLinks()) {
      const key = focusKeyIn(countTools);
      countTools.replaceChildren(...nodes);
      refocus(countTools, key);
      updatePickBar();
      return;
    }
    if (autoSelected) nodes.push(el('span', 'memo-pane-count-note', tr('線が多いので、選んだカードの線だけ出しています')));
    countList.setAttribute('aria-pressed', String(!cardMap.isOpen)); // 並びの窓か、マップの窓か
    countMap.setAttribute('aria-pressed', String(cardMap.isOpen));
    nodes.push(countSwitch, countView);
    const key = focusKeyIn(countTools); // 描き直すと消える焦点（「関連の見せ方 ▾」）を、描き直したあとに戻す
    countTools.replaceChildren(...nodes);
    refocus(countTools, key);
    updatePickBar();
  }

  // マップを開く（件数の行の「マップ」）：並びは残したまま、窓を区画に重ねる。窓の「× 並びに戻る」に焦点
  function openMap() {
    const current = view;
    if (!current || cardMap.isOpen || !hasAnyLinks()) return;
    linkMenu.close();
    relMenu.close();
    endLinking(false);
    if (pickingCards) stopPicking();
    closeLinkPicker(false);
    closeListWindow(false);
    listPops.closeAll(); // 並びに出したカードは、マップを開いたら閉じる
    cardMap.open(current.replies.filter((r) => r.parent === null));
    renderCountTools();
    paintNextRow();
    cardMap.el.querySelector<HTMLElement>('.memo-pane-map-close')?.focus({ preventScroll: true });
  }

  // マップを閉じる（returnFocus：件数の行の「マップ」へ焦点を戻す）
  function closeMap(returnFocus: boolean) {
    if (!cardMap.isOpen) return;
    cardMap.close();
    renderCountTools();
    paintNextRow();
    if (returnFocus) refocus(countTools, 'countswitch:map');
  }

  // 今画面に出している 6 つの名前（変えた種類だけ）
  function shownLinkKindNames(): LinkKindNames {
    const raw: LinkKindNames = {};
    for (const k of LINK_KINDS) raw[k.kind] = k.name;
    return parseLinkKindNames(raw) ?? {};
  }

  function shownLinkNamesKey(): string {
    return LINK_KINDS.map((k) => k.name).join('\u0001');
  }

  // 開いているメモの名前を表に当てる（セットを選んでいればセット。選んでいなければ、このメモの名前）
  function applyCurrentLinkNames() {
    applyLinkKindNames(resolvedLinkKindNames(view, linkNameSets.book));
  }

  // 名前が替わったときだけ、カードと線を描き直す
  function refreshLinkNames() {
    boardListeners.forEach((fn) => fn()); // ボードが別のメモを見ているときの呼び名も、呼称セットの変更で替わる（M4）
    const before = shownLinkNamesKey();
    applyCurrentLinkNames();
    if (!view || shownLinkNamesKey() === before) return;
    renderCards(view, undefined, true);
  }

  function linkSetUnusable(): boolean {
    return !linkNameSets.canWrite;
  }

  // このメモが使う呼称セットを替える（ほかのメモは変えない）。同じセットなら、何もしない
  function chooseLinkSet(setId: string | null, after?: () => void) {
    if (!view) return;
    const now = view.linkSet ?? null;
    if (now === setId) {
      after?.();
      return;
    }
    if (setId) view.linkSet = setId;
    else delete view.linkSet;
    ask({ command: 'setMemoLinkSet', id: view.id, setId });
    const set = setId ? chosenLinkNameSet(linkNameSets.book, setId) : undefined;
    status.textContent = set ? tr('このメモの呼称セットを「{0}」にしました', { 0: set.name }) : tr('このメモの呼称セットを外しました（このメモの名前に戻しました）');
    refreshLinkNames();
    after?.();
  }

  function deleteLinkSet(set: LinkNameSet) {
    if (linkSetUnusable()) {
      status.textContent = tr('呼称セットは今は変えられません（台帳を読めませんでした）');
      return;
    }
    const using = view?.linkSet === set.id;
    if (using && view) delete view.linkSet;
    const removed = linkNameSets.apply({ type: 'remove', id: set.id });
    if (!removed) {
      if (using && view) view.linkSet = set.id;
      refreshLinkNames();
      status.textContent = tr('呼称セットを消せませんでした');
      return;
    }
    ask({ command: 'clearMemoLinkSet', setId: set.id });
    status.textContent = tr('呼称セット「{0}」を消しました。使っていたメモは、そのメモの名前に戻ります', { 0: set.name });
  }

  // 呼称セットの名前と 6 つの名前（set が無ければ、新しいセットを作って、このメモで使う）
  function openLinkNameSetForm(set: LinkNameSet | null, x: number, y: number) {
    const form = el('form', 'cell-menu-form memo-pane-link-set-form');
    form.append(el('div', 'cell-menu-section', set ? tr('呼称セット「{0}」', { 0: set.name }) : tr('新しい呼称セット')));
    form.append(el('div', 'cell-menu-note', tr('色と矢じりはそのままです。名前は 10 文字までです')));
    const nameInput = el('input');
    nameInput.value = set?.name ?? '';
    nameInput.maxLength = LINK_NAME_SET_NAME_MAX;
    nameInput.placeholder = tr('セットの名前');
    nameInput.setAttribute('aria-label', 'セットの名前');
    form.append(nameInput);
    const base = set?.names ?? {};
    const inputs = new Map<LinkKind, HTMLInputElement>();
    for (const k of LINK_KINDS) {
      const row = el('div', 'memo-pane-link-set-row');
      const label = el('span', 'memo-pane-link-set-kind', LINK_KIND_DEFAULT_NAMES[k.kind]);
      label.style.setProperty('--rel', k.color);
      label.title = tr('この種類の色と形は変わりません');
      const input = el('input');
      input.value = base[k.kind] ?? LINK_KIND_DEFAULT_NAMES[k.kind];
      input.maxLength = LINK_KIND_NAME_MAX;
      input.setAttribute('aria-label', `${LINK_KIND_DEFAULT_NAMES[k.kind]}の名前`);
      row.append(label, input);
      form.append(row);
      inputs.set(k.kind, input);
    }
    const buttons = el('div', 'cell-menu-kind');
    const ok = el('button', 'cell-menu-small', set ? tr('保存する') : tr('作ってこのメモで使う'));
    ok.type = 'submit';
    const cancel = el('button', 'cell-menu-small', tr('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => linkMenu.close());
    buttons.append(ok, cancel);
    form.append(buttons);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (linkSetUnusable()) {
        status.textContent = tr('呼称セットは今は変えられません（台帳を読めませんでした）');
        return;
      }
      const raw: LinkKindNames = {};
      for (const [kind, input] of inputs) raw[kind] = input.value;
      const names = parseLinkKindNames(raw) ?? {};
      if (set) {
        linkNameSets.apply({ type: 'rename', id: set.id, name: nameInput.value });
        linkNameSets.apply({ type: 'setNames', id: set.id, names });
        const saved = chosenLinkNameSet(linkNameSets.book, set.id);
        linkMenu.close();
        status.textContent = tr('呼称セット「{0}」の名前を保存しました', { 0: saved?.name ?? set.name });
        return;
      }
      const id = linkNameSets.apply({ type: 'add', name: nameInput.value, names });
      linkMenu.close();
      if (!id) {
        status.textContent = tr('呼称セットを作れませんでした');
        return;
      }
      chooseLinkSet(id);
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        linkMenu.close();
      }
    });
    linkMenu.showForm(form, { x, y });
    nameInput.focus();
    nameInput.select();
  }

  // 「関連の見せ方」から開く、このメモの呼称セット（タグの「セット ▾」と同じ並び）
  function openLinkNameSetMenu(x: number, y: number) {
    if (!view) return;
    const book = linkNameSets.book;
    const currentId = view.linkSet;
    const current = chosenLinkNameSet(book, currentId);
    const reopen = () => openLinkNameSetMenu(x, y);
    const entries: MenuEntry[] = [{ section: tr('呼称セット（このメモだけ。登録は全部のメモで共通）') }];
    entries.push({
      row: tr('選ばない'),
      hint: tr('このメモの名前'),
      buttons: [
        {
          label: tr('使う'),
          pressed: !currentId,
          title: tr('呼称セットを外して、このメモの名前に戻す'),
          run: () => chooseLinkSet(null, reopen),
        },
      ],
    });
    for (const set of book.sets) {
      const names = LINK_KINDS.map((k) => set.names[k.kind] ?? LINK_KIND_DEFAULT_NAMES[k.kind]).join(tr('・'));
      entries.push({
        row: set.name,
        buttons: [
          {
            label: tr('使う'),
            pressed: set.id === currentId,
            title: tr('{0}（このメモの関連の名前を、このセットにする）', { 0: names }),
            run: () => chooseLinkSet(set.id, reopen),
          },
        ],
      });
    }
    entries.push('sep');
    const full = book.sets.length >= MAX_LINK_NAME_SETS;
    const locked = linkSetUnusable();
    entries.push({
      label: tr('新しいセット…'),
      hint: full ? tr('{0} 個まで', { 0: MAX_LINK_NAME_SETS }) : tr('名前と 6 つの名前'),
      disabled: full || locked || !linkNameSets.ready,
      run: () => openLinkNameSetForm(null, x, y),
    });
    entries.push({
      label: tr('今の名前をセットとして保存…'),
      disabled: full || locked || !linkNameSets.ready,
      run: () =>
        linkMenu.prompt(
          tr('新しいセットの名前'),
          tr('セット{0}', { 0: book.sets.length + 1 }),
          (name) => {
            const id = linkNameSets.apply({ type: 'add', name, names: shownLinkKindNames() });
            if (!id) {
              status.textContent = tr('呼称セットを保存できませんでした');
              return;
            }
            chooseLinkSet(id);
            const saved = chosenLinkNameSet(linkNameSets.book, id);
            status.textContent = tr('呼称セット「{0}」を保存して、このメモで使うようにしました', { 0: saved?.name ?? name });
          },
          { x, y },
          { maxLength: LINK_NAME_SET_NAME_MAX },
        ),
    });
    if (current) {
      entries.push({
        label: tr('「{0}」の名前を変える…', { 0: current.name }),
        disabled: locked,
        run: () =>
          linkMenu.prompt(
            tr('セットの名前'),
            current.name,
            (name) => {
              linkNameSets.apply({ type: 'rename', id: current.id, name });
              const saved = chosenLinkNameSet(linkNameSets.book, current.id);
              status.textContent = tr('呼称セットの名前を「{0}」にしました', { 0: saved?.name ?? name });
              reopen();
            },
            { x, y },
            { maxLength: LINK_NAME_SET_NAME_MAX },
          ),
      });
      entries.push({
        label: tr('「{0}」の 6 つの名前…', { 0: current.name }),
        disabled: locked,
        run: () => openLinkNameSetForm(current, x, y),
      });
      entries.push({
        row: '',
        buttons: [{ label: tr('「{0}」を消す', { 0: current.name }), confirm: tr('もう一度押すと消す'), close: true, run: () => deleteLinkSet(current) }],
      });
    } else if (currentId && linkNameSets.ready) {
      entries.push({ note: tr('選んでいたセットは、もうありません。このメモの名前で出しています') });
      entries.push({ label: tr('このメモの選択を外す'), run: () => chooseLinkSet(null, reopen) });
    }
    if (!linkNameSets.ready) entries.push({ note: tr('呼称セットを読み込んでいます…') });
    else if (locked) entries.push({ note: tr('呼称セットの台帳を読めなかったので、今は変えられません') });
    linkMenu.open(x, y, entries);
  }

  // 関連の見せ方の欄（「関連の見せ方 ▾」）：線の見せ方を選ぶ（欄は開いたまま描き直す）と、線の凡例。keyboard のときは、いちばん上の項目へ
  function openLinkView(x: number, y: number, keyboard: boolean) {
    // 凡例の文字（色と形の名前。この欄だけで使う）
    const colorName: Record<LinkKind, string> = { ground: tr('緑'), counter: tr('赤'), next: tr('青'), same: tr('灰'), ask: tr('紫'), supplement: tr('黄土') };
    const headName: Record<string, string> = { triangle: tr('三角の矢じり'), bar: tr('止めの棒'), chevron: tr('山形の矢じり'), none: tr('矢じりなし（向きなし）'), dot: tr('丸の矢じり'), diamond: tr('ひし形の矢じり') };
    const modes: { label: string; value: 'all' | 'selected' | 'none' }[] = [
      { label: tr('すべて'), value: 'all' },
      { label: tr('選んだカード'), value: 'selected' },
      { label: tr('出さない'), value: 'none' },
    ];
    // 欄の中身（押したあとは、押してある印と注記を当て直すために組み直す）
    const build = (): MenuEntry[] => {
      const next: MenuEntry[] = [
        { section: tr('関連の見せ方') },
        { row: tr('線'), buttons: modes.map((m) => ({ label: m.label, pressed: lineMode === m.value, run: () => choose(m.value) })) },
      ];
      if (lineMode === 'selected' && selectedCard === null) next.push({ note: tr('カードを押すと、そのカードの線だけを出します') });
      next.push(
        { section: tr('並べ方') },
        {
          row: tr('並べ方'),
          buttons: [
            { label: view && isReordered(view) ? tr('並べた順') : tr('作った順'), title: tr('並べ替えると「並べた順」になります'), pressed: cardOrder === 'order', run: () => chooseOrder('order') },
            { label: tr('つながり順'), pressed: cardOrder === 'chain', run: () => chooseOrder('chain') },
            ...(hasTimedCards() ? [{ label: tr('時刻順'), pressed: cardOrder === 'time', run: () => chooseOrder('time') }] : []),
          ],
        },
      );
      if (view && isReordered(view)) next.push({ row: tr('並び'), buttons: [...packButton(view), { label: tr('作った順に戻す'), confirm: tr('もう一度押すと戻します'), close: true, run: () => resetOrder() }] });
      const chosen = chosenLinkNameSet(linkNameSets.book, view?.linkSet);
      const missingSet = !!view?.linkSet && !chosen && linkNameSets.ready;
      const setRow = !linkNameSets.ready ? tr('読み込み中') : chosen ? chosen.name : missingSet ? tr('見つかりません') : tr('選んでいない');
      next.push({ section: tr('呼称セット') });
      next.push({
        row: setRow,
        hint: missingSet ? tr('このメモの名前で出しています') : undefined,
        buttons: [
          {
            label: tr('選ぶ ▾'),
            aria: tr('このメモの呼称セットを選ぶ'),
            title: chosen ? tr('このメモは「{0}」。登録は全部のメモで共通、使うセットはこのメモだけ', { 0: chosen.name }) : tr('登録は全部のメモで共通です。使うセットは、このメモだけ変わります'),
            run: () => openLinkNameSetMenu(x, y),
          },
        ],
      });
      next.push({ section: tr('凡例（元 → 相手。元は相手の〈種類〉）') });
      for (const k of LINK_KINDS) {
        const renamed = k.name !== LINK_KIND_DEFAULT_NAMES[k.kind];
        const setTitle = chosen ? tr('セット「{0}」の名前（このセットを使うメモ全部）', { 0: chosen.name }) : tr('このメモだけの名前');
        next.push({
          row: tr('{0}：{1}・{2}{3}', { 0: k.name, 1: colorName[k.kind], 2: headName[k.head], 3: k.dashed ? '・破線' : '' }),
          hint: renamed ? tr('元は「{0}」', { 0: LINK_KIND_DEFAULT_NAMES[k.kind] }) : undefined,
          buttons: [
            { label: tr('名前を変える'), aria: chosen ? tr('呼称セット「{0}」の「{1}」の名前を変える', { 0: chosen.name, 1: k.name }) : tr('「{0}」の名前を変える', { 0: k.name }), title: setTitle, run: () => renameKind(k.kind, x, y) },
            ...(renamed ? [{ label: tr('元に戻す'), aria: tr('「{0}」を「{1}」に戻す', { 0: k.name, 1: LINK_KIND_DEFAULT_NAMES[k.kind] }), title: setTitle, run: () => applyKindName(k.kind, null) }] : []),
          ],
        });
      }
      return next;
    };
    // 凡例の種類の名前を変える（線の色・形・保存してある関連はそのまま。名前だけ）
    //   セットを選んでいるときは、そのセットの名前を変える（このセットを使うメモ全部）。選んでいなければ、このメモだけの名前
    const applyKindName = (kind: LinkKind, name: string | null) => {
      if (!view) return;
      const set = chosenLinkNameSet(linkNameSets.book, view.linkSet);
      if (set) {
        if (linkSetUnusable()) {
          status.textContent = tr('呼称セットは今は変えられません（台帳を読めませんでした）');
          return;
        }
        const names = withLinkKindName(set.names, kind, name);
        linkNameSets.apply({ type: 'setNames', id: set.id, names: names ?? {} });
        const shown = linkKindInfo(kind).name;
        status.textContent = name ? tr('呼称セット「{0}」の名前を「{1}」にしました', { 0: set.name, 1: shown }) : tr('呼称セット「{0}」の「{1}」を元の名前に戻しました', { 0: set.name, 1: shown });
        entries.splice(0, entries.length, ...build());
        linkMenu.refresh();
        return;
      }
      const names = withLinkKindName(view.linkNames, kind, name);
      view.linkNames = names; // 写しが戻る前に、この区画ですぐ当てる
      applyLinkKindNames(names);
      ask({ command: 'setMemoLinkNames', id: view.id, names: names ?? null });
      status.textContent = name ? tr('関連の種類の名前を「{0}」にしました', { 0: linkKindInfo(kind).name }) : tr('関連の種類の名前を「{0}」に戻しました', { 0: linkKindInfo(kind).name });
      if (view) renderCards(view, undefined, true);
      scheduleLinks();
      renderCountTools();
      entries.splice(0, entries.length, ...build());
      linkMenu.refresh();
    };
    const renameKind = (kind: LinkKind, px: number, py: number) => {
      linkMenu.prompt(tr('「{0}」の新しい名前（{1} 文字まで）', { 0: linkKindInfo(kind).name, 1: LINK_KIND_NAME_MAX }), linkKindInfo(kind).name, (value) => applyKindName(kind, value), { x: px, y: py }, { maxLength: LINK_KIND_NAME_MAX });
    };
    const choose = (mode: 'all' | 'selected' | 'none') => {
      lineMode = mode;
      autoSelected = false;
      keepAll = mode === 'all'; // 手で「すべて」にしたら、線路が足りなくても替えない
      scheduleLinks();
      renderCountTools();
      entries.splice(0, entries.length, ...build()); // 開いている欄と同じ配列の中身を入れ替える（押してある印を当て直す）
      linkMenu.refresh();
    };
    // 並べ方を替える（欄は開いたまま。カードを組み直して、押してある印を当て直す）
    const chooseOrder = (order: 'order' | 'chain' | 'time') => {
      cardOrder = order;
      if (view) renderCards(view, undefined, true);
      entries.splice(0, entries.length, ...build());
      linkMenu.refresh();
    };
    const entries = build();
    linkMenu.open(x, y, entries);
    if (keyboard) linkMenu.focusFirst();
  }

  // 光らせているカードが描き直されて新しくなったら、残りの時間だけ、続きから光らせる（負の delay＝途中から）
  function paintFlash() {
    if (!flash) return;
    const rest = flash.until - Date.now();
    if (rest <= 0) return;
    const node = cards.querySelector<HTMLElement>(flash.top ? `[data-card="${CSS.escape(flash.id)}"]` : `[data-reply="${CSS.escape(flash.id)}"]`);
    if (!node) return;
    node.style.animationDelay = `${rest - FLASH_MS}ms`;
    node.classList.add('memo-pane-flash');
  }

  // カードを光らせはじめる（FLASH_MS のあいだ。動きを減らす設定の枠もここで消える）
  function startFlash(id: string, top: boolean) {
    flash = { id, top, until: Date.now() + FLASH_MS };
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      flash = null;
      for (const node of cards.querySelectorAll<HTMLElement>('.memo-pane-flash')) {
        node.classList.remove('memo-pane-flash');
        node.style.animationDelay = '';
      }
    }, FLASH_MS);
    paintFlash();
  }

  // 右の検索から：そのカード（返信）へ移って、少し光らせる
  function jumpToReply(current: MemoPaneView, id: string) {
    const reply = current.replies.find((r) => r.id === id);
    if (!reply) {
      status.textContent = tr('そのコメントは、もうありません');
      return;
    }
    if (cardMap.isOpen) closeMap(false); // 移る道は先に閉じる（マップの窓）
    const top = pathTo(current.replies, id)[0];
    // 移る先のカードが絞りで隠れていたら、絞りを外す
    if (filterTag && top && !(top.tags ?? []).includes(filterTag)) {
      filterTag = null;
      keepShown.clear();
      status.textContent = tr('タグの絞りを外しました（検索から移ったため）');
    }
    if (top) openBodies.add(top.id); // 一番上のカードの 280 字の折りたたみを開く
    revealReply(refOf(current.id), current.replies, id);
    renderCards(current, undefined, true);
    const node =
      reply.parent === null
        ? cards.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`)
        : cards.querySelector<HTMLElement>(`[data-reply="${CSS.escape(id)}"]`);
    if (!node) return;
    node.scrollIntoView({ block: 'center' });
    startFlash(id, reply.parent === null);
  }

  function shotUrl(id: string): string | undefined {
    const hit = shotUrls.get(id);
    if (hit || shotBusy.has(id)) return hit;
    shotBusy.add(id);
    void readData<{ data?: unknown }>(`shots/${id}.json`).then((saved) => {
      shotBusy.delete(id);
      if (typeof saved?.data === 'string' && saved.data.startsWith('data:image/')) {
        shotUrls.set(id, saved.data);
        if (view) renderCards(view);
      }
    });
    return undefined;
  }

  function openLight(src: string, replyId: string) {
    lightImg.src = src;
    lightReply = replyId;
    light.hidden = false;
  }

  function closeLight() {
    light.hidden = true;
    lightReply = null;
    lightImg.removeAttribute('src');
  }

  // カードの画像の右クリック（I4）：右の「撮影」に送って大きく開く。左がカードを確かめてから右へ回す
  function openImageMenu(x: number, y: number, replyId: string) {
    if (!view) return;
    const memoId = view.id;
    imageMenu.open(x, y, [
      { section: tr('カードの画像') },
      {
        label: tr('🖼 画像を撮影に送る'),
        hint: tr('大きく開く'),
        run: () => {
          ask({ command: 'captureCardImage', id: memoId, replyId });
          status.textContent = tr('画像を右の撮影に送りました（大きく開きます）');
        },
      },
      { label: tr('書き足す…'), hint: tr('新しいカードに足す'), run: () => void beginAnnotate({ kind: 'card', replyId }) },
    ]);
  }

  // 段 D7：カードの画像、または今開いているメモの顔の画像で、書き足しの面を開く。やめると何も書かない
  async function loadShot(id: string): Promise<string | null> {
    const hit = shotUrls.get(id);
    if (hit) return hit;
    const saved = await readData<{ data?: unknown }>(`shots/${id}.json`);
    if (typeof saved?.data !== 'string' || !saved.data.startsWith('data:image/')) return null;
    shotUrls.set(id, saved.data);
    return saved.data;
  }

  function hideAnnotate() {
    annotateLayer.hidden = true;
  }

  async function beginAnnotate(source: { kind: 'card'; replyId: string } | { kind: 'face' }) {
    if (!view || annotateBusy) return;
    const memoId = view.id;
    const reply = source.kind === 'card' ? view.replies.find((item) => item.id === source.replyId) : undefined;
    const imageId = source.kind === 'card' ? reply?.image : view.image;
    if (!imageId) {
      say(tr('その画像は、もうありません'));
      return;
    }
    annotateBusy = true;
    try {
      const src = await loadShot(imageId);
      if (view?.id !== memoId) return;
      if (!src) {
        say(tr('その画像は、もうありません'));
        return;
      }
      closeLight();
      imageMenu.close();
      moreMenu.close();
      annotate.open(src, null, {
        onCancel: () => hideAnnotate(),
        onDone: (result) => {
          hideAnnotate();
          void commitAnnotate(memoId, source, result);
        },
      });
      annotateLayer.hidden = false;
    } finally {
      annotateBusy = false;
    }
  }

  function takeFaceAnnotate() {
    if (!faceAnnotate || view?.id !== faceAnnotate) return;
    faceAnnotate = null;
    void beginAnnotate({ kind: 'face' });
  }

  // 印がある書き足しだけ、新しい画像のファイルを書いて左へ id を渡す。断られたらそのファイルを消す
  async function commitAnnotate(memoId: string, source: { kind: 'card'; replyId: string } | { kind: 'face' }, result: ImageEditResult) {
    if (view?.id !== memoId) return;
    const plan = planAnnotatedCard({
      version: result.version,
      marks: result.version === 'annotated' ? result.marks.length : 0,
      questions: result.boxes.map((box) => box.question).join('\n'),
      source: source.kind === 'card' ? { kind: 'card', reply: source.replyId } : { kind: 'face' },
      memoId,
      memo: { id: view.id, replies: view.replies },
    });
    if (!plan.ok) {
      say(plan.note);
      return;
    }
    setBusy(true);
    try {
      const fit = await fitPicture(result.image, true);
      if (view?.id !== memoId) return;
      if ('error' in fit) {
        say(tr('書き足した版を整えられませんでした（{0}）', { 0: FIT_STAGE[fit.error] }));
        return;
      }
      const id = newShotId();
      const ok = await writeData(`shots/${id}.json`, { version: 1, data: fit.dataUrl });
      if (view?.id !== memoId) {
        if (ok) deleteData(`shots/${id}.json`);
        return;
      }
      if (!ok) {
        say(tr('画像を保存できませんでした（保存：ファイルに書けない）'));
        return;
      }
      shotUrls.set(id, fit.dataUrl);
      annotateShot = id;
      ask({
        command: 'addAnnotatedCard',
        id: memoId,
        image: id,
        text: plan.text,
        ...(source.kind === 'card' ? { fromReply: source.replyId } : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  function appendQuote(card: HTMLElement, reply: Reply) {
    const quote = reply.quote;
    if (!quote) return;
    if (quote.text) {
      const open = openQuotes.has(reply.id);
      const block = el('div', open ? 'memo-pane-quote open' : 'memo-pane-quote', quote.text);
      card.append(block);
      const long = quote.text.split('\n').length > 4 || [...quote.text].length > 160;
      if (long) {
        const more = el('button', 'memo-pane-more', open ? tr('たたむ ▴') : tr('…続き ▾'));
        more.type = 'button';
        more.addEventListener('click', () => {
          if (openQuotes.has(reply.id)) openQuotes.delete(reply.id);
          else openQuotes.add(reply.id);
          if (view) renderCards(view);
        });
        card.append(more);
      }
    }
    const src = el('button', 'memo-pane-source', quoteSourceLabel(quote));
    src.type = 'button';
    src.title = tr('この文の所を開く');
    src.addEventListener('click', () => {
      ask({ command: 'openQuote', url: quote.url, fragmentUrl: quoteFragmentUrl(quote.url, quote.text) });
    });
    card.append(src);
  }

  function appendImage(card: HTMLElement, reply: Reply) {
    if (!reply.image) return;
    const src = shotUrl(reply.image);
    if (!src) {
      card.append(el('div', 'memo-pane-shot-wait', tr('画像を読んでいます')));
      return;
    }
    const btn = el('button', 'memo-pane-thumb');
    btn.type = 'button';
    btn.title = tr('画像を大きく見る');
    const img = el('img');
    img.src = src;
    img.alt = tr('カードの画像');
    btn.append(img);
    btn.addEventListener('click', () => openLight(src, reply.id));
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openImageMenu(e.clientX, e.clientY, reply.id);
    });
    card.append(btn);
  }

  function setBusy(next: boolean) {
    busy = next;
    quoteBtn.disabled = next;
    shotBtn.disabled = next;
    pageBtn.disabled = next;
    pickBtn.disabled = next;
    copyBtn.disabled = next;
    newBtn.disabled = next;
    tplPasteBtn.disabled = next;
    menuBtn.disabled = next;
  }

  function armNewEdit() {
    armEdit = true;
    window.clearTimeout(armTimer);
    armTimer = window.setTimeout(() => {
      armEdit = false;
    }, 12_000);
  }

  function roomForCard(): boolean {
    if (!view) return false;
    if (view.replies.length >= MAX_REPLIES) {
      status.textContent = tr('返信は1つのメモに {0} 件までです', { 0: MAX_REPLIES });
      return false;
    }
    return true;
  }

  async function quoteSelection() {
    if (!view || busy) return;
    const memoId = view.id;
    const tabId = view.page.tabId;
    if (tabId === null) {
      status.textContent = tr('上のページがありません');
      return;
    }
    setBusy(true);
    status.textContent = tr('選んだ文を読んでいます');
    try {
      const pageText = await requestPageText(tabId);
      if (view?.id !== memoId) return;
      if (pageText.error === 'noPage') {
        status.textContent = tr('上のページがありません');
        return;
      }
      if (pageText.error) {
        status.textContent = tr('上のページの文を読めませんでした');
        return;
      }
      const selection = (pageText.selection ?? '').trim();
      if (!selection) {
        status.textContent = tr('上のページで文を選んでから押してください');
        return;
      }
      const quote = parseQuote({ text: selection, url: pageText.url ?? '', title: pageText.title ?? '' });
      if (!quote) {
        status.textContent = tr('このページのアドレスでは引用を残せません');
        return;
      }
      if (!roomForCard()) return;
      armNewEdit();
      ask({ command: 'addMemoComment', id: memoId, text: '', quote });
      status.textContent = tr('引用を入れました');
    } finally {
      setBusy(false);
    }
  }

  async function captureVisible() {
    if (!view || busy) return;
    const memoId = view.id;
    const tabId = view.page.tabId;
    const source = { url: view.page.url, title: view.page.title };
    if (tabId === null) {
      status.textContent = tr('撮れませんでした（ページが眠っている・小窓に出ているなど）');
      return;
    }
    setBusy(true);
    status.textContent = tr('見えている所を撮っています');
    try {
      // maxEdge：上に見えている範囲だけ。下の区画に入力先があっても撮れ、大きすぎて届かない画像にしない
      const reply = await request((requestId) => ({ type: 'captureFull', requestId, id: tabId, maxEdge: 1600 }), 8_000);
      if (view?.id !== memoId) return;
      if (reply?.type !== 'capture' || !reply.ok || !reply.image) {
        status.textContent = captureFailure(reply);
        return;
      }
      if (!/^data:image\/(jpeg|png);base64,./.test(reply.image)) {
        status.textContent = tr('撮った画像を整えられませんでした（受け取り：画像の形でない）');
        return;
      }
      const fit = await fitPicture(reply.image, false);
      if (view?.id !== memoId) return;
      if ('error' in fit) {
        status.textContent = tr('撮った画像を整えられませんでした（{0}）', { 0: FIT_STAGE[fit.error] });
        return;
      }
      const quote = parseQuote({ text: '', url: source.url, title: source.title });
      await saveShot(memoId, fit.dataUrl, quote);
    } catch (error) {
      if (view?.id === memoId) status.textContent = tr('撮った画像を整えられませんでした（途中：{0}）', { 0: error instanceof Error ? error.name : '不明' });
    } finally {
      setBusy(false);
    }
  }

  async function captureWhole() {
    if (!view || busy) return;
    const memoId = view.id;
    const tabId = view.page.tabId;
    const source = { url: view.page.url, title: view.page.title };
    if (tabId === null) {
      status.textContent = tr('全体の画像を撮れませんでした（全体：ページなし）');
      return;
    }
    if (view.replies.length >= MAX_REPLIES) {
      status.textContent = tr('返信は1つのメモに {0} 件までです', { 0: MAX_REPLIES });
      return;
    }
    const name = exportFileName(source.url, 'jpg');
    setBusy(true);
    status.textContent = tr('ページ全体を撮っています');
    try {
      const shot = await request((requestId) => ({ type: 'capturePage', requestId, id: tabId, name }), 60_000);
      const here = () => view?.id === memoId;
      if (shot?.type !== 'pageCaptured' || !shot.ok || !shot.name || !isSafeExportName(shot.name)) {
        if (here()) status.textContent = pageFailure(shot);
        return;
      }
      const savedName = shot.name;
      if (shot.truncated) truncatedFiles.add(savedName);
      const thumb = await visibleThumb(tabId);
      const quote = parseQuote({ text: '', url: source.url, title: source.title });
      if (!thumb.image && !quote) {
        if (here()) status.textContent = tr('全体の画像は保存しました（{0}）。このページのアドレスではカードを残せません', { 0: savedName });
        return;
      }
      if (here() && view && view.replies.length >= MAX_REPLIES) {
        status.textContent = tr('全体の画像は保存しました（{0}）。返信は1つのメモに {1} 件までです', { 0: savedName, 1: MAX_REPLIES });
        return;
      }
      if (here()) armNewEdit();
      ask({
        command: 'addMemoComment',
        id: memoId,
        text: '',
        ...(thumb.image ? { image: thumb.image } : {}),
        ...(quote ? { quote } : {}),
        file: savedName,
      });
      if (here()) status.textContent = thumb.note ? tr('全体の画像は保存しました。{0}', { 0: thumb.note }) : tr('全体の画像を入れました');
    } catch (error) {
      if (view?.id === memoId) status.textContent = tr('全体の画像を撮れませんでした（全体：途中で止まった {0}）', { 0: error instanceof Error ? error.name : '不明' });
    } finally {
      setBusy(false);
    }
  }

  // 見えている所（6.2 と同じ）。全体のファイルが書けたあとなので、ここが失敗してもカードは足す
  async function visibleThumb(tabId: number): Promise<{ image?: string; note?: string }> {
    const reply = await request((requestId) => ({ type: 'captureFull', requestId, id: tabId, maxEdge: 1600 }), 8_000);
    if (reply?.type !== 'capture' || !reply.ok || !reply.image) return { note: captureFailure(reply) };
    if (!/^data:image\/(jpeg|png);base64,./.test(reply.image)) return { note: tr('見えている所は入れられませんでした（受け取り：画像の形でない）') };
    const fit = await fitPicture(reply.image, false);
    if ('error' in fit) return { note: tr('見えている所は入れられませんでした（{0}）', { 0: FIT_STAGE[fit.error] }) };
    const id = newShotId();
    const ok = await writeData(`shots/${id}.json`, { version: 1, data: fit.dataUrl });
    if (!ok) return { note: tr('見えている所は入れられませんでした（保存：ファイルに書けない）') };
    shotUrls.set(id, fit.dataUrl);
    return { image: id };
  }

  async function exportCardImage(reply: Reply) {
    if (!view || busy || !reply.image) return;
    const memoId = view.id;
    setBusy(true);
    status.textContent = tr('画像を書き出しています');
    try {
      const saved = await readData<{ data?: unknown }>(`shots/${reply.image}.json`);
      if (view?.id !== memoId) return;
      const dataUrl = typeof saved?.data === 'string' ? saved.data : '';
      const png = dataUrl.startsWith('data:image/png;base64,');
      const jpeg = dataUrl.startsWith('data:image/jpeg;base64,');
      const comma = dataUrl.indexOf(',');
      const payload = comma >= 0 ? dataUrl.slice(comma + 1) : '';
      if ((!png && !jpeg) || !payload) {
        status.textContent = tr('この画像は書き出せませんでした（書き出す：カードの画像を読めない）');
        return;
      }
      const name = exportFileName(reply.quote?.url || view.page.url, png ? 'png' : 'jpg');
      const sent = await request((requestId) => ({ type: 'exportImage', requestId, name, data: payload }), 30_000);
      if (view?.id !== memoId) return;
      if (sent?.type !== 'imageExported' || !sent.ok || !sent.name) {
        status.textContent = exportFailure(sent);
        return;
      }
      status.textContent = tr('画像を書き出しました（{0}）', { 0: sent.name });
    } finally {
      setBusy(false);
    }
  }

  async function copyMarkdown() {
    if (!view || busy) return;
    const memoId = view.id;
    const text = memoMarkdown(view);
    setBusy(true);
    status.textContent = tr('コピーしています');
    try {
      const reply = await request((requestId) => ({ type: 'clipboardWrite', requestId, text, html: '' }), 8_000);
      if (view?.id !== memoId) return;
      if (reply?.type !== 'clipboardWritten') {
        status.textContent = tr('まとめてコピーできませんでした（コピー：返事なし）');
        return;
      }
      if (!reply.ok) {
        status.textContent = tr('まとめてコピーできませんでした（コピー：書けない）');
        return;
      }
      status.textContent = tr('まとめてコピーしました。メモ帳に貼れます');
    } catch {
      if (view?.id === memoId) status.textContent = tr('まとめてコピーできませんでした（コピー：途中で止まった）');
    } finally {
      setBusy(false);
    }
  }

  function addPageLink() {
    if (!view || busy) return;
    if (view.page.tabId === null || !view.page.url) {
      status.textContent = tr('上のページがありません（リンク：ページなし）');
      return;
    }
    const quote = parseQuote({ text: '', url: view.page.url, title: view.page.title });
    if (!quote) {
      status.textContent = tr('このページのアドレスではリンクを残せません（リンク：アドレス）');
      return;
    }
    if (view.replies.length >= MAX_REPLIES) {
      status.textContent = tr('返信は1つのメモに {0} 件までです（リンク：いっぱい）', { 0: MAX_REPLIES });
      return;
    }
    armNewEdit();
    ask({ command: 'addMemoComment', id: view.id, text: '', quote });
    status.textContent = tr('ページのリンクを入れました');
  }

  function closeMenu() {
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    closeTplMenu();
    menu.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeTplMenu() {
    tplMenuSeq += 1;
    tplMenu.hidden = true;
    tplPasteBtn.setAttribute('aria-expanded', 'false');
  }

  // 型の一覧を、保存ファイルから読み直して出す（開くたびに読む。読めなければ理由を出し、ファイルは変えない）
  async function openTplMenu() {
    closeMenu();
    tplMenu.hidden = false;
    tplPasteBtn.setAttribute('aria-expanded', 'true');
    const seq = ++tplMenuSeq;
    tplMenu.replaceChildren(el('div', 'memo-pane-tplmenu-note', tr('読み込んでいます…')));
    const loaded = await loadTemplates(templateIo).catch(() => null);
    if (seq !== tplMenuSeq || tplMenu.hidden) return;
    if (!loaded || loaded.state === 'unreadable') {
      tplMenu.replaceChildren(el('div', 'memo-pane-tplmenu-note error', tr('型の保存ファイルを読めませんでした（ファイルは変えていません）')));
      return;
    }
    const nodes: HTMLElement[] = [];
    const winItem = el('button', 'memo-pane-menu-item', tr('型の窓を開く…（/ キー）'));
    winItem.type = 'button';
    winItem.setAttribute('role', 'menuitem');
    winItem.title = tr('型を検索し、サムネイルで見て、貼る位置を確かめてから貼ります');
    winItem.addEventListener('click', () => {
      closeTplMenu();
      openTplPalette();
    });
    nodes.push(winItem);
    if (loaded.templates.length === 0) nodes.push(el('div', 'memo-pane-tplmenu-note', loaded.skipped > 0 ? tr('読める型がありません（読めない型が {0} 件あります）', { 0: loaded.skipped }) : TEMPLATE_EMPTY_HINT));
    for (const group of templateMenuGroups(loaded.templates)) {
      nodes.push(el('div', 'memo-pane-tplmenu-folder', group.folder));
      for (const t of group.items) {
        const item = el('button', 'memo-pane-menu-item', templateMenuLabel(t));
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.title = tr('「{0}」を、このメモの最後に貼ります', { 0: t.name });
        item.addEventListener('click', () => {
          closeTplMenu();
          tplPasteBtn.focus();
          pasteTemplate(t);
        });
        nodes.push(item);
      }
    }
    if (loaded.templates.length > 0 && loaded.skipped > 0) nodes.push(el('div', 'memo-pane-tplmenu-note', tr('読めない型が {0} 件あります（出していません）', { 0: loaded.skipped })));
    tplMenu.replaceChildren(...nodes);
  }

  // 型を貼る：入りきらなければここで断る（左の台帳も同じ上限で断る）。貼れたら、下の区画に「元に戻す」の帯が出る
  function pasteTemplate(t: CardTemplate, prefill?: FillPrefill) {
    if (!view) return;
    const blocked = pasteBlocked(view.replies.length, t.cards.length);
    if (blocked) {
      status.textContent = blocked;
      return;
    }
    if (t.mode === 'hole' && extractHoles(t).length > 0) {
      openTplFill(t, prefill); // 穴あき：空欄を入れてから貼る（prefill：穴埋めファイルの値を先に入れる）
      return;
    }
    ask({ command: 'sendReplies', from: '', replyIds: [], to: view.id, mode: 'copy', template: t });
  }

  // ---------- 空欄を入れて貼る小窓（Phase 3）：純粋な部分は memo-card-templates.ts の extractHoles・fillTemplate ----------

  function placeTplFill() {
    const rootBox = flowFrame().getBoundingClientRect();
    const boardAnchor = fillFromBoard?.anchor.isConnected ? fillFromBoard.anchor : null; // ボードから開いたときは、ボードの道具の列の下
    let top = Math.round((boardAnchor ?? band).getBoundingClientRect().bottom - rootBox.top) + 2;
    if (!boardAnchor && rootBox.height - top - 8 < 120) top = Math.round(handle.getBoundingClientRect().bottom - rootBox.top) + 2;
    tplFill.style.top = `${top}px`;
    tplFill.style.maxHeight = `${Math.max(60, Math.round(rootBox.height - top - 6))}px`;
  }

  // 穴埋めファイル（Phase 5d）から先に入れる値と、その知らせ（入れるだけ。貼るのは小窓の「貼る」）
  type FillPrefill = { values: Record<string, string>; text: string; note: string };

  function openTplFill(t: CardTemplate, prefill?: FillPrefill, board?: NonNullable<typeof fillFromBoard>) {
    const names = extractHoles(t);
    fillTpl = t;
    fillFromBoard = board ?? null;
    fillInputs = [];
    tplFillName.textContent = tr('型「{0}」（{1}枚・{2}）', { 0: t.name, 1: t.cards.length, 2: MODE_LABELS[t.mode] });
    const rows: HTMLElement[] = [];
    for (const name of names.slice(0, 40)) {
      const row = el('label', 'memo-pane-tpl-fillrow');
      row.append(el('span', '', name));
      const input = el('input', 'memo-pane-tpl-name');
      input.type = 'text';
      input.maxLength = MAX_REPLY_TEXT;
      input.placeholder = `{{${name}}}`;
      const first = prefill?.values[name];
      if (first !== undefined) input.value = first;
      input.setAttribute('aria-label', `空欄「${name}」`);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          submitTplFill();
        }
      });
      row.append(input);
      rows.push(row);
      fillInputs.push({ name, input });
    }
    tplFillFields.replaceChildren(...rows);
    const many = names.length > 40 ? tr('空欄が多いので、最初の 40 個だけ入れられます（残りは {{…}} のまま貼ります）') : '';
    tplFillMsg.textContent = prefill ? [prefill.text, many].filter(Boolean).join('。') : many;
    tplFillMsg.classList.remove('error');
    tplFillNote.textContent = prefill?.note ? tr('{0}。Grok のメモ：{1}', { 0: FILL_NOTE, 1: prefill.note }) : FILL_NOTE;
    tplFill.hidden = false;
    placeTplFill();
    fillInputs[0]?.input.focus();
  }

  function closeTplFill(returnFocus: boolean) {
    if (tplFill.hidden) return;
    const boardOpened = fillFromBoard !== null;
    const inside = tplFill.contains(document.activeElement);
    tplFill.hidden = true;
    fillTpl = null;
    fillFromBoard = null;
    fillInputs = [];
    if (returnFocus && inside && !boardOpened) tplPasteBtn.focus();
  }

  // 空欄を埋めて貼る：入りきらなければ小窓を開けたまま理由を出す。貼れるなら 1c と同じ道（sendReplies の copy ＋ 元に戻す）で貼る
  function submitTplFill() {
    const src = tplSource(fillFromBoard !== null); // ボードから開いた小窓は、ボードが見ているメモの枚数で数える
    if (!src || !fillTpl) return;
    const values: Record<string, string> = {};
    for (const f of fillInputs) values[f.name] = f.input.value;
    const done = fillTemplate(fillTpl, values);
    const blocked = pasteBlocked(src.replies.length, done.template.cards.length);
    if (blocked) {
      tplFillMsg.textContent = blocked;
      tplFillMsg.classList.add('error');
      return;
    }
    const board = fillFromBoard; // 閉じると消えるので、先に取っておく
    closeTplFill(false);
    if (!board) tplPasteBtn.focus();
    const notes: string[] = [];
    if (done.empty > 0) notes.push(tr('空欄 {0} 個は {{…}} のまま貼りました', { 0: done.empty }));
    if (done.truncated > 0) notes.push(tr('{0} 字を超えた {1} 枚は、切って貼りました', { 0: MAX_REPLY_TEXT, 1: done.truncated }));
    if (board) {
      board.done(done.template, notes); // ボードから開いた小窓：貼るのはボード（見ている場所の真ん中へ。ids を付けて）
      return;
    }
    if (notes.length > 0) {
      pendingCutNote = notes.join('。');
      status.textContent = pendingCutNote; // 結果の知らせ（元に戻す の帯）が引き取る
    }
    ask({ command: 'sendReplies', from: '', replyIds: [], to: src.id, mode: 'copy', template: done.template }); // ここは選ぶ帯からの貼り付け（src は下の区画の view と同じ）
  }

  // ---------- 型の窓（パレット。計画書 Phase 2）：純粋な部分は memo-card-template-palette.ts ----------

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // サムネイル：カードの位置（dx・dy）の四角と、関連の線（種類の色・「疑問」は破線）。innerHTML は使わず createElementNS で組む
  function thumbSvg(t: CardTemplate): SVGSVGElement {
    const lay = thumbLayout(t, { w: 96, h: 56 });
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'memo-pane-tpl-thumb');
    svg.setAttribute('viewBox', `0 0 ${lay.w} ${lay.h}`);
    svg.setAttribute('width', String(lay.w));
    svg.setAttribute('height', String(lay.h));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const c of lay.cards) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('class', 'memo-pane-tpl-thumb-card');
      rect.setAttribute('x', String(c.x));
      rect.setAttribute('y', String(c.y));
      rect.setAttribute('width', String(c.w));
      rect.setAttribute('height', String(c.h));
      rect.setAttribute('rx', '1.5');
      svg.append(rect);
    }
    for (const link of lay.links) {
      const color = linkKindInfo(link.kind).color;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'memo-pane-tpl-thumb-link');
      line.setAttribute('x1', String(link.x1));
      line.setAttribute('y1', String(link.y1));
      line.setAttribute('x2', String(link.x2));
      line.setAttribute('y2', String(link.y2));
      if (link.dashed) line.setAttribute('stroke-dasharray', '3 2');
      line.style.setProperty('--rel', color);
      const head = document.createElementNS(SVG_NS, 'circle');
      head.setAttribute('class', 'memo-pane-tpl-thumb-head');
      head.setAttribute('cx', String(link.x2));
      head.setAttribute('cy', String(link.y2));
      head.setAttribute('r', '1.8');
      head.style.setProperty('--rel', color);
      svg.append(line, head);
    }
    return svg;
  }

  // ゴースト：palSel の型が貼られたときに入る番地へ、点線のカードを出す（renderCards の最後にも呼ぶので、描き直しで消えない）。
  //   升目に置いている間は番地（行・列）に、詰めて並べている間（絞り込み・つながり順・狭い幅）は並びの最後に出す
  function paintGhost() {
    for (const node of [...cards.querySelectorAll('.memo-pane-tpl-ghost')]) node.remove();
    if (!ghostTpl || !view) return null;
    const result = ghostSlots(ghostTpl, orderedReplies(view));
    if (!result.ok) return result;
    ghostTpl.cards.forEach((c, i) => {
      const node = el('div', 'memo-pane-tpl-ghost', `＋ ${c.title || tr('（空のカード）')}`);
      node.setAttribute('aria-hidden', 'true');
      if (slotMode) {
        const slot = result.slots[i];
        node.style.gridRow = String(Math.floor(slot / CARD_COLUMNS) + 1);
        node.style.gridColumn = String((slot % CARD_COLUMNS) + 1);
      }
      cards.append(node);
    });
    return result;
  }

  function placeTplPalette() {
    const rootBox = flowFrame().getBoundingClientRect();
    let top = Math.round(band.getBoundingClientRect().bottom - rootBox.top) + 2;
    if (rootBox.height - top - 8 < 160) top = Math.round(handle.getBoundingClientRect().bottom - rootBox.top) + 2;
    tplPalette.style.top = `${top}px`;
    tplPalette.style.maxHeight = `${Math.max(80, Math.round(rootBox.height - top - 6))}px`;
  }

  function paletteOrderNow(): CardTemplate[] {
    return paletteOrder(searchTemplates(palAll, palQuery, palFolder));
  }

  // 一覧を描き直す（読み込み・検索・フォルダの絞りを替えたとき）。選びが絞りで消えたら先頭へ
  function renderPalette() {
    palGrab?.cancel(); // つまんでいる行が作り直されるので、やめる
    const order = paletteOrderNow();
    palSel = keepSelection(
      order.map((t) => t.id),
      palSel,
    );
    const nodes: HTMLElement[] = [];
    let note = '';
    let bad = false;
    if (palState === 'loading') note = tr('読み込んでいます…');
    else if (palState === 'unreadable') {
      note = tr('型の保存ファイルを読めませんでした（ファイルは変えていません）');
      bad = true;
    } else if (palAll.length === 0) note = palSkipped > 0 ? tr('読める型がありません（読めない型が {0} 件あります）', { 0: palSkipped }) : tr('{0}。見本が欲しいときは、下の「初期サンプルを復元」を押してください', { 0: TEMPLATE_EMPTY_HINT });
    else if (order.length === 0) note = tr('当てはまる型がありません');
    tplPalNote.textContent = note;
    tplPalNote.classList.toggle('error', bad);
    let folder = '';
    for (const t of order) {
      if (t.folder !== folder) {
        folder = t.folder;
        nodes.push(el('div', 'memo-pane-tplpal-folder', folder));
      }
      const item = el('div', 'memo-pane-tplpal-item');
      item.id = `memo-pane-tplpal-${t.id}`;
      item.dataset.tplId = t.id;
      item.setAttribute('role', 'option');
      const text = el('div', 'memo-pane-tplpal-text');
      const nameEl = el('div', 'memo-pane-tplpal-name', t.name);
      text.append(nameEl, el('div', 'memo-pane-tplpal-meta', paletteMeta(t)));
      const acts = el('div', 'memo-pane-tplpal-acts');
      const rename = el('button', 'memo-pane-tplpal-act', '✎');
      rename.type = 'button';
      rename.title = tr('名前を変える');
      rename.setAttribute('aria-label', `「${t.name}」の名前を変える`);
      const out = el('button', 'memo-pane-tplpal-act', tr('書出'));
      out.type = 'button';
      out.title = tr('この型だけをファイルに書き出します');
      out.setAttribute('aria-label', `「${t.name}」だけを書き出す`);
      out.addEventListener('click', (e) => {
        e.stopPropagation();
        void exportTemplates(t);
      });
      const del = el('button', 'memo-pane-tplpal-act', tr('削除'));
      del.type = 'button';
      del.title = tr('この型を消します（もう一度押すと消えます）');
      del.setAttribute('aria-label', `「${t.name}」を削除`);
      rename.addEventListener('click', (e) => {
        e.stopPropagation();
        startPaletteRename(t, nameEl);
      });
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        onPaletteDelete(t, del);
      });
      acts.append(rename, out, del);
      item.append(thumbSvg(t), text, acts);
      item.addEventListener('pointerenter', () => selectTemplate(t.id, false));
      attachPaletteDrag(item, t);
      item.addEventListener('click', () => pasteFromPalette(t));
      nodes.push(item);
    }
    if (palState === 'ok' && palAll.length > 0 && palSkipped > 0) nodes.push(el('div', 'memo-pane-tplpal-note', tr('読めない型が {0} 件あります（出していません）', { 0: palSkipped })));
    tplPalList.replaceChildren(...nodes);
    for (const [i, btn] of [...tplPalFolders.children].entries()) {
      (btn as HTMLElement).setAttribute('aria-pressed', String(i === 0 ? palFolder === null : TEMPLATE_FOLDERS[i - 1] === palFolder));
    }
    selectTemplate(palSel, false);
  }

  // 名前の変更・削除・サンプルの復元の結果を、一覧に反映して、窓の下の行に知らせる（書くのは検査つきの保存の道だけ。失敗なら一覧はそのまま）
  function paletteResult(done: Awaited<ReturnType<typeof renameStoredTemplate>>, okText: string) {
    if (tplPalette.hidden) return;
    if (!done.ok) {
      tplPalInfo.textContent = templateSaveMessage(done.why);
      tplPalInfo.classList.add('error');
      return;
    }
    palState = 'ok';
    palAll = done.templates;
    renderPalette();
    tplPalInfo.textContent = okText;
    tplPalInfo.classList.remove('error');
  }

  // 名前を変える：その場で書き換える欄。Enter で保存・Esc かほかを押すとやめる（窓は閉じない）
  function startPaletteRename(t: CardTemplate, nameEl: HTMLElement) {
    const input = el('input', 'memo-pane-tplpal-rename');
    input.type = 'text';
    input.value = t.name;
    input.maxLength = TEMPLATE_LIMITS.name;
    input.setAttribute('aria-label', `「${t.name}」の新しい名前`);
    nameEl.replaceChildren(input);
    input.focus();
    input.select();
    let finished = false;
    const cancel = () => {
      if (finished) return;
      finished = true;
      nameEl.textContent = t.name;
    };
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', cancel);
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        tplPalFilter.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (finished) return;
        finished = true;
        void renameStoredTemplate(templateIo, t.id, input.value).then((done) => {
          if (!done.ok) nameEl.textContent = t.name;
          paletteResult(done, tr('名前を変えました'));
          tplPalFilter.focus();
        });
      }
    });
  }

  // 削除：1 回目は「もう一度押すと削除」に変えるだけ（別の所を押す・Esc でやめる。confirm-arm.ts）。2 回目で消す
  function onPaletteDelete(t: CardTemplate, del: HTMLButtonElement) {
    if (!del.hasAttribute('data-armed-confirm')) {
      armConfirm(del, () => {
        del.textContent = tr('削除');
        del.classList.remove('danger');
        tplPalInfo.textContent = '';
      });
      del.textContent = tr('もう一度押すと削除');
      del.classList.add('danger');
      tplPalInfo.textContent = tr('「{0}」を消します。もう一度「削除」を押すと消えます（別の所を押すか Esc でやめます）', { 0: t.name });
      tplPalInfo.classList.remove('error');
      return;
    }
    void deleteStoredTemplate(templateIo, t.id).then((done) => paletteResult(done, tr('「{0}」を消しました', { 0: t.name })));
  }

  // ---------- 型の書き出し・読み込み（Phase 4）：純粋な部分は memo-card-template-io.ts ----------
  //   書き出し：Grok の書き出しと同じく ui-data\exports\ にファイルを書き（writeData）、場所の名前をコピーする
  //   読み込み：「提案・取り込みファイルを開く…」と同じファイルの窓（openJsonFile）→ 検査 → 確かめの小窓 →「足す」で保存（保存は検査つきの道だけ）

  function ioSay(text: string, bad: boolean) {
    tplPalInfo.textContent = text;
    tplPalInfo.classList.toggle('error', bad);
    if (text) status.textContent = text;
  }

  async function exportTemplates(only: CardTemplate | null) {
    if (importBusy) return;
    importBusy = true;
    try {
      const loaded = await loadTemplates(templateIo).catch(() => null);
      if (!loaded || loaded.state === 'unreadable') {
        ioSay(tr('型の保存ファイルを読めないので、書き出せません（ファイルは変えていません）'), true);
        return;
      }
      const list = only ? loaded.templates.filter((t) => t.id === only.id) : loaded.templates;
      if (list.length === 0) {
        ioSay(only ? tr('その型はもうありません') : tr('書き出す型がありません'), true);
        return;
      }
      const data = buildExport(list);
      if (!exportFitsImportLimit(data)) {
        ioSay(tr('大きすぎて書き出せません（読み込める大きさは {0} まで）。「書出」で 1 件ずつ書き出してください', { 0: IMPORT_FILE_LABEL }), true);
        return;
      }
      const name = templateExportName();
      if (!(await writeData(name, data))) {
        ioSay(tr('書き出せませんでした（ui-data に書けません）'), true);
        return;
      }
      const path = `ui-data\\${name.replace(/\//g, '\\')}`;
      const copied = await request((requestId) => ({ type: 'clipboardWrite', requestId, text: path, html: '' }), 8_000).catch(() => null);
      const skipped = !only && loaded.skipped > 0 ? tr('。読めない型 {0} 件は含めていません', { 0: loaded.skipped }) : '';
      ioSay(tr('書き出しました：{0}（{1} 件{2}）{3}', { 0: path, 1: list.length, 2: skipped, 3: copied?.type === 'clipboardWritten' && copied.ok ? '。場所の名前をコピーしました' : '' }), false);
    } finally {
      importBusy = false;
    }
  }

  async function openTemplateImport() {
    if (importBusy) return;
    importBusy = true;
    try {
      const reply = await request((requestId) => ({ type: 'openJsonFile', requestId }), 10 * 60_000);
      if (!reply || reply.type !== 'jsonFile') {
        ioSay(tr('ファイルを選ぶ窓から返事がありません。何も変えていません'), true);
        return;
      }
      if (!reply.ok) {
        if (reply.error === 'cancel') return;
        ioSay(reply.error === 'big' ? tr('ファイルが大きすぎます（{0} まで）。何も変えていません', { 0: IMPORT_FILE_LABEL }) : tr('ファイルを読めませんでした。何も変えていません'), true);
        return;
      }
      if (isFillText(reply.text ?? '')) {
        await openFillFromFile(reply.text ?? '');
        return;
      }
      const parsed = parseImportText(reply.text ?? '');
      if (!parsed.ok) {
        ioSay(importFailText(parsed.why), true);
        return;
      }
      const loaded = await loadTemplates(templateIo).catch(() => null);
      if (!loaded || loaded.state === 'unreadable') {
        ioSay(templateSaveMessage('unreadable'), true);
        return;
      }
      if (loaded.skipped > 0) {
        ioSay(templateSaveMessage('partial'), true);
        return;
      }
      openTplImport(reply.name ?? tr('ファイル'), parsed, loaded.templates);
    } finally {
      importBusy = false;
    }
  }

  // ---------- 穴埋めファイルの読み込み（Phase 5d）：検査と値づくりは memo-card-template-fill.ts（純粋な部分） ----------
  //   入れるだけで貼らない。型の窓の「読み込む…」で選ぶと、ファイルの template（id か name）の穴あきの型の空欄の小窓を、値を入れた状態で開く。
  //   空欄の小窓の「穴埋めファイルを読み込む…」は、今開いている型の空欄に値を入れる。貼るのは、どちらも使う人が「貼る」を押したときだけ

  async function openFillFromFile(text: string) {
    const fill = parseFillText(text);
    if (!fill.ok) {
      ioSay(fillFailText(fill.why), true);
      return;
    }
    const loaded = await loadTemplates(templateIo).catch(() => null);
    if (!loaded || loaded.state === 'unreadable') {
      ioSay(templateSaveMessage('unreadable'), true);
      return;
    }
    const found = findFillTemplate(loaded.templates, fill.template);
    if (!found.ok) {
      ioSay(findFailText(found.why, fill.template), true);
      return;
    }
    if (!view) return;
    const plan = planFill(found.template, fill);
    if (plan.used === 0) {
      ioSay(tr('「{0}」の空欄に当たる値がありません（空欄名が合いません）。何も開いていません', { 0: found.template.name }), true);
      return;
    }
    const blocked = pasteBlocked(view.replies.length, found.template.cards.length);
    if (blocked) {
      ioSay(blocked, true);
      return;
    }
    closeTplPalette(false);
    openTplFill(found.template, { values: plan.values, text: fillPlanText(plan, fill.ignored), note: fill.note });
    status.textContent = tr('「{0}」の空欄に値を {1} 個入れました。確かめて「貼る」を押してください（まだ貼っていません）', { 0: found.template.name, 1: plan.used });
  }

  // 空欄の小窓の「穴埋めファイルを読み込む…」：今開いている型用のファイルの値を、空欄に入れる（ほかの空欄・型は変えない）
  async function loadFillIntoDialog() {
    if (importBusy || !fillTpl) return;
    const tpl = fillTpl;
    const say = (text: string, bad: boolean) => {
      tplFillMsg.textContent = text;
      tplFillMsg.classList.toggle('error', bad);
    };
    importBusy = true;
    try {
      const reply = await request((requestId) => ({ type: 'openJsonFile', requestId }), 10 * 60_000);
      if (!reply || reply.type !== 'jsonFile') {
        say(tr('ファイルを選ぶ窓から返事がありません。何も入れていません'), true);
        return;
      }
      if (!reply.ok) {
        if (reply.error === 'cancel') return;
        say(reply.error === 'big' ? tr('ファイルが大きすぎます（{0} まで）。何も入れていません', { 0: IMPORT_FILE_LABEL }) : tr('ファイルを読めませんでした。何も入れていません'), true);
        return;
      }
      if (fillTpl !== tpl) return; // 選んでいる間に、小窓が閉じた・別の型になった
      const text = reply.text ?? '';
      if (parseImportText(text).ok) {
        say(tr('これは型のファイルです。穴埋めのファイル（honeycomb-cardtpl-fill）を選んでください。何も入れていません'), true);
        return;
      }
      const fill = parseFillText(text);
      if (!fill.ok) {
        say(fillFailText(fill.why), true);
        return;
      }
      const same = (fill.template.id !== '' && fill.template.id === tpl.id) || (fill.template.name !== '' && fill.template.name === tpl.name);
      if (!same) {
        say(tr('このファイルは「{0}」用です。今開いている型「{1}」には入れていません', { 0: fill.template.name || fill.template.id, 1: tpl.name }), true);
        return;
      }
      const plan = planFill(tpl, fill);
      if (plan.used === 0) {
        say(tr('この型の空欄に当たる値がありません（空欄名が合いません）。何も入れていません'), true);
        return;
      }
      for (const f of fillInputs) {
        const v = plan.values[f.name];
        if (v !== undefined) f.input.value = v;
      }
      tplFillNote.textContent = fill.note ? tr('{0}。Grok のメモ：{1}', { 0: FILL_NOTE, 1: fill.note }) : FILL_NOTE;
      say(fillPlanText(plan, fill.ignored), false);
    } finally {
      importBusy = false;
    }
  }
  function placeTplImport() {
    const rootBox = flowFrame().getBoundingClientRect();
    let top = Math.round(band.getBoundingClientRect().bottom - rootBox.top) + 2;
    if (rootBox.height - top - 8 < 120) top = Math.round(handle.getBoundingClientRect().bottom - rootBox.top) + 2;
    tplImport.style.top = `${top}px`;
    tplImport.style.maxHeight = `${Math.max(60, Math.round(rootBox.height - top - 6))}px`;
  }

  // 確かめの小窓：足す型の名前・フォルダ・モード・枚数（名前が重なれば付け替え後の名前）と、読めなかった型の理由
  function openTplImport(fileName: string, parsed: Extract<ImportParse, { ok: true }>, existing: readonly CardTemplate[]) {
    const merged = mergeImported(existing, parsed.templates);
    importIncoming = parsed.templates;
    tplImportName.textContent = tr('{0}：{1} 件のうち、足せる型 {2} 件{3}', { 0: fileName, 1: parsed.total, 2: merged.items.length, 3: parsed.skipped.length > 0 ? `・読めない型 ${parsed.skipped.length} 件` : '' });
    const rows: HTMLElement[] = [];
    const SHOW = 40;
    for (const item of merged.items.slice(0, SHOW)) {
      const t = item.template;
      const row = el('div', 'memo-pane-tpl-importrow');
      row.append(el('div', 'memo-pane-tpl-importname', t.name), el('div', 'memo-pane-tpl-importmeta', tr('{0}・{1}枚・{2}{3}', { 0: t.folder, 1: t.cards.length, 2: MODE_LABELS[t.mode], 3: item.nameChanged ? `（もとの名前「${item.fromName}」は、同じ名前があるので変えます）` : '' })));
      rows.push(row);
    }
    if (merged.items.length > SHOW) rows.push(el('div', 'memo-pane-tpl-importmeta', tr('ほか {0} 件', { 0: merged.items.length - SHOW })));
    for (const s of parsed.skipped.slice(0, SHOW)) {
      const row = el('div', 'memo-pane-tpl-importrow skip');
      row.append(el('div', 'memo-pane-tpl-importname', tr('{0} 番目の型は読めません', { 0: s.index + 1 })), el('div', 'memo-pane-tpl-importmeta', skipReasonText(s.why)));
      rows.push(row);
    }
    if (parsed.skipped.length > SHOW) rows.push(el('div', 'memo-pane-tpl-importmeta', tr('読めない型は、ほか {0} 件', { 0: parsed.skipped.length - SHOW })));
    if (rows.length === 0) rows.push(el('div', 'memo-pane-tpl-importmeta', tr('足せる型がありません')));
    tplImportList.replaceChildren(...rows);
    tplImportNote.textContent = merged.summary.dropped > 0 ? tr('{0} 件まで置けるので、入らない {1} 件は足しません（今 {2} 件）', { 0: TEMPLATE_LIMITS.templates, 1: merged.summary.dropped, 2: existing.length }) : tr('今 {0} 件。足しても今ある型は変わりません（{1} 件まで）', { 0: existing.length, 1: TEMPLATE_LIMITS.templates });
    tplImportMsg.textContent = merged.items.length === 0 ? tr('足せる型がないので、何も変えません') : '';
    tplImportMsg.classList.remove('error');
    tplImportOk.disabled = merged.items.length === 0;
    tplImportOk.textContent = merged.items.length > 0 ? tr('{0} 件を足す', { 0: merged.items.length }) : tr('足す');
    tplImport.hidden = false;
    placeTplImport();
    (merged.items.length > 0 ? tplImportOk : tplImportCancel).focus();
  }

  function closeTplImport(returnFocus: boolean) {
    if (tplImport.hidden) return;
    const inside = tplImport.contains(document.activeElement);
    tplImport.hidden = true;
    importIncoming = [];
    if (returnFocus && inside) (tplPalette.hidden ? tplPasteBtn : tplPalImport).focus();
  }

  // ---------- Grok Bot に型の下書きを頼む（Phase 5c）：文面の組み立ては memo-card-template-ask.ts（純粋な部分） ----------
  //   頼む文を作ってクリップボードへ入れるだけ。自動送信も AI の呼び出しもしない（貼って送るのは使う人）
  //   今ある型の名前・選んでいるカードの文は、使う人がチェックを入れたときだけ入れる（初めは何も入れない。Q19）

  function placeTplAsk() {
    const rootBox = flowFrame().getBoundingClientRect();
    let top = Math.round(band.getBoundingClientRect().bottom - rootBox.top) + 2;
    if (rootBox.height - top - 8 < 120) top = Math.round(handle.getBoundingClientRect().bottom - rootBox.top) + 2;
    tplAsk.style.top = `${top}px`;
    tplAsk.style.maxHeight = `${Math.max(60, Math.round(rootBox.height - top - 6))}px`;
  }

  function askRequest() {
    return buildTemplateRequest({
      purpose: tplAskPurpose.value,
      ...(tplAskNamesChk.checked && !tplAskNamesChk.disabled ? { names: askNames } : {}),
      ...(tplAskMatChk.checked && !tplAskMatChk.disabled ? { materials: askPick.cards } : {}),
    });
  }

  // コピーする文（そのまま見せる）と数の行を、いまの選びで作り直す
  function refreshTplAsk() {
    const r = askRequest();
    tplAskMsg.textContent = '';
    tplAskMsg.classList.remove('error');
    if (!r.ok) {
      tplAskPreview.value = '';
      tplAskCount.textContent = tr('目的を書くと、ここにコピーする文が出ます');
      tplAskCopy.disabled = true;
      return;
    }
    tplAskPreview.value = r.text;
    const notes = [tr('{0} 字', { 0: r.chars.toLocaleString('ja-JP') })];
    if (r.names > 0) notes.push(tr('今ある型の名前 {0} 件', { 0: r.names }));
    if (r.materials > 0) notes.push(tr('カードの文 {0} 枚', { 0: r.materials }));
    if (tplAskMatChk.checked && !tplAskMatChk.disabled) {
      if (askPick.dropped > 0) notes.push(tr('入りきらない {0} 枚は入れません（{1} 枚・{2} 字まで）', { 0: askPick.dropped, 1: ASK_LIMITS.materialCards, 2: ASK_LIMITS.materialChars.toLocaleString('ja-JP') }));
      if (askPick.cut > 0) notes.push(tr('{0} 字を超えた {1} 枚は切って入れます', { 0: MAX_REPLY_TEXT, 1: askPick.cut }));
      if (askPick.empty > 0) notes.push(tr('文のない {0} 枚（画像だけなど）は入れません', { 0: askPick.empty }));
    }
    tplAskCount.textContent = notes.join(tr('・'));
    tplAskCopy.disabled = false;
  }

  async function openTplAsk() {
    if (!view || askBusy) return;
    closeTplFill(false);
    closeTplImport(false);
    const loaded = await loadTemplates(templateIo).catch(() => null);
    if (!view) return;
    askNames = loaded && loaded.state !== 'unreadable' ? pickNames(loaded.templates.map((t) => t.name)).names : [];
    askPick = pickMaterials(view.replies, pickingCards ? selectedIds() : []);
    tplAskPurpose.value = askPurposeKeep;
    tplAskNamesChk.checked = false;
    tplAskNamesChk.disabled = askNames.length === 0;
    tplAskNamesText.textContent = askNames.length > 0 ? tr('今ある型の名前も入れる（{0} 件。同じ名前にならないよう頼みます）', { 0: askNames.length }) : tr('今ある型の名前も入れる（今は型がありません）');
    tplAskMatChk.checked = false;
    tplAskMatChk.disabled = askPick.cards.length === 0;
    tplAskMatText.textContent = askPick.cards.length > 0 ? tr('選んでいるカードの文も入れる（{0} 枚）', { 0: askPick.cards.length }) : tr('選んでいるカードの文も入れる（今は選んでいません）');
    tplAskMatNote.textContent =
      askPick.cards.length > 0
        ? tr('カードの文は、チェックを入れたときだけ入ります。名前・連絡先・パスワードなどが入っていないか、下の「コピーする文」で確かめてください')
        : tr('カードの文を入れたいときは、先に「☐ 選ぶ」で材料にするカードを選んでから、この窓を開いてください（選ばなければ、カードの文は入りません）');
    tplAsk.hidden = false;
    placeTplAsk();
    refreshTplAsk();
    tplAskPurpose.focus();
  }

  function closeTplAsk(returnFocus: boolean) {
    if (tplAsk.hidden) return;
    const inside = tplAsk.contains(document.activeElement);
    askPurposeKeep = tplAskPurpose.value;
    tplAsk.hidden = true;
    if (returnFocus && inside) (tplPalette.hidden ? tplPasteBtn : tplPalAsk).focus();
  }

  // 「コピーする」：見えている文をそのままクリップボードへ（型の保存・台帳は変えない）。書けなければ小窓を開けたまま理由を出す
  async function copyTplAsk() {
    if (askBusy) return;
    const r = askRequest();
    if (!r.ok) {
      tplAskMsg.textContent = tr('どんな型がほしいかを書いてください');
      tplAskMsg.classList.add('error');
      tplAskPurpose.focus();
      return;
    }
    askBusy = true;
    tplAskCopy.disabled = true;
    try {
      const reply = await request((requestId) => ({ type: 'clipboardWrite', requestId, text: r.text, html: '' }), 8_000).catch(() => null);
      if (reply?.type !== 'clipboardWritten' || !reply.ok) {
        tplAskMsg.textContent = reply?.type === 'clipboardWritten' ? tr('コピーできませんでした（コピー：書けない）') : tr('コピーできませんでした（コピー：返事なし）');
        tplAskMsg.classList.add('error');
        return;
      }
      closeTplAsk(true);
      const parts = [tr('{0} 字', { 0: r.chars.toLocaleString('ja-JP') })];
      if (r.names > 0) parts.push(tr('型の名前 {0} 件', { 0: r.names }));
      if (r.materials > 0) parts.push(tr('カードの文 {0} 枚', { 0: r.materials }));
      ioSay(tr('Grok Bot に頼む文をコピーしました（{0}）。Grok Bot を開いて貼って送ってください。返ってきた JSON は、ファイルに保存して「読み込む…」で読めます', { 0: parts.join('・') }), false);
    } finally {
      askBusy = false;
      if (!tplAsk.hidden) tplAskCopy.disabled = false;
    }
  }
  // 「足す」：今のファイルを読み直して足す（保存は検査・バックアップつきの importStoredTemplates だけ）。失敗なら小窓を開けたまま理由を出す
  async function submitTplImport() {
    if (importBusy || importIncoming.length === 0) return;
    importBusy = true;
    tplImportOk.disabled = true;
    try {
      const done = await importStoredTemplates(templateIo, importIncoming).catch(() => ({ ok: false as const, why: 'write' as const }));
      if (!done.ok) {
        tplImportMsg.textContent = templateSaveMessage(done.why);
        tplImportMsg.classList.add('error');
        tplImportOk.disabled = false;
        return;
      }
      const text = done.summary ? importSummaryText(done.summary) : tr('読み込みました');
      closeTplImport(false);
      status.textContent = text;
      if (!tplPalette.hidden) {
        paletteResult(done, text);
        tplPalImport.focus();
      }
    } finally {
      importBusy = false;
    }
  }

  function restoreSamples() {
    void restoreSampleTemplates(templateIo).then((done) =>
      paletteResult(done, done.ok && (done.added ?? 0) > 0 ? tr('内蔵サンプルを {0} 件足しました', { 0: done.added }) : tr('内蔵サンプルは、すべてそろっています')),
    );
  }

  // 選びを替える（ゴーストを出す・読み上げの文を替える）。reveal：ゴーストと選んだ行を見える所へ
  function selectTemplate(id: string | null, reveal: boolean) {
    palSel = id;
    ghostTpl = id === null ? null : (palAll.find((t) => t.id === id) ?? null);
    let selected: HTMLElement | null = null;
    for (const node of tplPalList.querySelectorAll<HTMLElement>('[role="option"]')) {
      const on = node.dataset.tplId === id;
      node.classList.toggle('sel', on);
      node.setAttribute('aria-selected', String(on));
      if (on) selected = node;
    }
    if (selected) tplPalFilter.setAttribute('aria-activedescendant', selected.id);
    else tplPalFilter.removeAttribute('aria-activedescendant');
    const result = paintGhost();
    tplPalInfo.textContent = result ? ghostSummary(result) : '';
    tplPalInfo.classList.toggle('error', !!result && !result.ok);
    if (reveal) {
      selected?.scrollIntoView({ block: 'nearest' });
      cards.querySelector('.memo-pane-tpl-ghost')?.scrollIntoView({ block: 'nearest' });
    }
  }

  async function openTplPalette() {
    if (!view) return;
    closeMenu();
    closeTplMenu();
    closeListWindow(false);
    closeTplDialog(false);
    tplPalette.hidden = false;
    placeTplPalette();
    palQuery = '';
    palFolder = null;
    palSel = null;
    tplPalFilter.value = '';
    palState = 'loading';
    palAll = [];
    palSkipped = 0;
    const seq = ++palSeq;
    renderPalette();
    tplPalFilter.focus();
    const loaded = await loadTemplates(templateIo).catch(() => null);
    if (seq !== palSeq || tplPalette.hidden) return;
    if (!loaded || loaded.state === 'unreadable') palState = 'unreadable';
    else {
      palState = 'ok';
      palAll = loaded.templates;
      palSkipped = loaded.skipped;
    }
    renderPalette();
    selectTemplate(palSel, true);
  }

  // returnFocus：窓の中に焦点があったときだけ「型を貼る ▾」へ戻す。ゴーストは消す
  function closeTplPalette(returnFocus: boolean) {
    palGrab?.cancel();
    if (tplPalette.hidden) return;
    const inside = tplPalette.contains(document.activeElement);
    palSeq += 1;
    tplPalette.hidden = true;
    ghostTpl = null;
    palSel = null;
    paintGhost();
    if (returnFocus && inside) tplPasteBtn.focus();
  }

  // 窓から貼る：入りきらないときは窓を開けたまま理由を出す。貼れるなら、窓を閉じて 1c と同じ道（sendReplies の copy ＋ 元に戻す）で貼る
  function pasteFromPalette(t: CardTemplate) {
    if (!view) return;
    const blocked = pasteBlocked(view.replies.length, t.cards.length);
    if (blocked) {
      tplPalInfo.textContent = blocked;
      tplPalInfo.classList.add('error');
      return;
    }
    closeTplPalette(false);
    tplPasteBtn.focus();
    pasteTemplate(t);
  }

  // ---------- 型の窓の行を、カードの区画へドラッグして貼る（Phase 2 の残り）----------
  //   つまみは pointer-grab.ts の grabPointer（行ごとに付ける。押しただけ・動きが小さいときは、今までどおり click で貼る）
  //   つまんでいる間：区画の上ならゴースト（入る番地）と札「離すと貼る」・外なら札だけ。離す：区画の上なら貼る道（pasteFromPalette＝sendReplies の copy ＋ 元に戻す・穴あきは空欄の小窓・300 枚は断る）・外なら何もしない。Esc でやめる
  //   Grok Cards の区画は貼り先にしない

  function overCardArea(x: number, y: number): boolean {
    const node = document.elementFromPoint(x, y);
    return !!node && scroll.contains(node) && !tplPalette.contains(node) && !node.closest('.grok-cards-upper');
  }

  function placeTplDragChip(e: PointerEvent) {
    const box = root.getBoundingClientRect();
    const cw = tplDragChip.offsetWidth;
    const ch = tplDragChip.offsetHeight;
    tplDragChip.style.left = `${Math.max(box.left + 4, Math.min(e.clientX + 12, box.right - cw - 4))}px`;
    tplDragChip.style.top = `${Math.max(box.top + 4, Math.min(e.clientY + 14, box.bottom - ch - 4))}px`;
  }

  function paintPaletteDrag(t: CardTemplate, e: PointerEvent) {
    const over = overCardArea(e.clientX, e.clientY);
    const blocked = view ? pasteBlocked(view.replies.length, t.cards.length) : null;
    const note = dragNote(t, over, blocked);
    tplDragChip.textContent = note.chip;
    tplPalInfo.textContent = note.info;
    tplPalInfo.classList.toggle('error', note.error);
    if (over !== palDragOver) {
      palDragOver = over;
      cardsWrap.classList.toggle('tpl-drop-over', over);
      ghostTpl = over ? t : null;
      paintGhost();
    }
    placeTplDragChip(e);
  }

  // つまみの終わり（離した・やめた）：札・印を消し、ゴーストは窓で選んでいる型に戻す
  function endPaletteDrag() {
    palGrab = null;
    palDragOver = null;
    tplDragChip.hidden = true;
    root.classList.remove('tpl-dragging');
    cardsWrap.classList.remove('tpl-drop-over');
    selectTemplate(palSel, false);
  }

  function attachPaletteDrag(item: HTMLElement, t: CardTemplate) {
    const grab: Grab = grabPointer(item, {
      onPress: (e) => {
        if (!view || palGrab || !tplFill.hidden || !tplImport.hidden || !tplAsk.hidden) return false;
        if (e.target instanceof Element && e.target.closest('.memo-pane-tplpal-acts, input, button')) return false; // 名前を変える・書出・削除の押しは、つまみにしない
        palGrab = grab;
        return true;
      },
      onStart: (e) => {
        selectTemplate(t.id, false);
        palDragOver = null;
        root.classList.add('tpl-dragging');
        tplDragChip.hidden = false;
        paintPaletteDrag(t, e);
      },
      onMove: (e) => paintPaletteDrag(t, e),
      onEnd: (e, moved) => {
        if (!moved) {
          palGrab = null;
          return;
        }
        const action = dropAction(overCardArea(e.clientX, e.clientY), view ? pasteBlocked(view.replies.length, t.cards.length) : null);
        endPaletteDrag();
        if (action === 'none') {
          tplPalInfo.textContent = tr('貼っていません（カードの区画の上で離すと貼れます）');
          tplPalInfo.classList.remove('error');
          return;
        }
        pasteFromPalette(t); // 'refuse' も同じ道で理由を出す（窓は開けたまま）
      },
      onCancel: (moved) => {
        endPaletteDrag();
        if (moved) {
          tplPalInfo.textContent = tr('やめました（貼っていません）');
          tplPalInfo.classList.remove('error');
        }
      },
    });
  }

  // 一覧の窓：帯の題名と☰の「一覧を出す」から開く。本文の欄の高さは変えず、区画の上に浮かせる
  function placeListWindow() {
    const rootBox = flowFrame().getBoundingClientRect();
    let top = Math.round(band.getBoundingClientRect().bottom - rootBox.top) + 2;
    // 帯の下に 120px 入らないほど低い区画では、帯の上にも重ねる（区画からはみ出さないように）
    if (rootBox.height - top - 8 < 120) top = Math.round(handle.getBoundingClientRect().bottom - rootBox.top) + 2;
    listWindow.style.top = `${top}px`;
    listWindow.style.maxHeight = `${Math.max(40, Math.round(rootBox.height - top - 6))}px`;
  }

  function openListWindow(opts?: { focus?: boolean }) {
    if (!view) return;
    listWindow.hidden = false;
    title.setAttribute('aria-expanded', 'true');
    listWindow.setAttribute('aria-label', sendPick ? tr('送り先のメモ') : tr('メモの一覧'));
    filter.placeholder = sendPick ? tr('送り先を絞る') : tr('見出しで絞る');
    filter.setAttribute('aria-label', filter.placeholder);
    placeListWindow();
    renderList();
    if (opts?.focus !== false) filter.focus();
  }

  // returnFocus：窓の中に焦点があったときだけ、題名へ戻す（外を押して閉じたときは動かさない）
  function closeListWindow(returnFocus: boolean) {
    if (listWindow.hidden) return;
    const inside = listWindow.contains(document.activeElement);
    listWindow.hidden = true;
    title.setAttribute('aria-expanded', 'false');
    listWindow.setAttribute('aria-label', 'メモの一覧');
    filter.placeholder = tr('見出しで絞る');
    filter.setAttribute('aria-label', '見出しで絞る');
    filterWords.close();
    filter.value = '';
    listQuery = '';
    armedItem = null;
    listPart = 'sheet';
    sendPick = null;
    if (returnFocus && inside) title.focus({ preventScroll: true });
  }

  // 札を押したとき：見せる札を替えて、書きかけの印は外す
  function choosePart(part: 'sheet' | 'recent') {
    listPart = part;
    armedItem = null;
    renderList();
  }

  // 見せている札の項目だけを描く（札の数と押された印も、今の絞りで描く）。焦点のある項目・札は描き直しても戻す
  function renderList() {
    const key = focusKeyIn(listWindow);
    const q = listQuery.trim().toLowerCase();
    const match = (item: MemoIndexItem) => !q || item.title.toLowerCase().includes(q);
    const sheet = sheetItems.filter(match);
    const recent = recentItems.filter(match);
    const onSheet = listPart === 'sheet';
    sheetPartBtn.textContent = tr('このシート {0}', { 0: sheet.length });
    sheetPartBtn.title = tr('このシート（{0}）のメモ', { 0: listSheetName || 'シート' });
    sheetPartBtn.setAttribute('aria-pressed', String(onSheet));
    recentPartBtn.textContent = tr('最近 {0}', { 0: recent.length });
    recentPartBtn.title = tr('最近開いたメモ');
    recentPartBtn.setAttribute('aria-pressed', String(!onSheet));
    const shown = onSheet ? sheet : recent;
    listBody.replaceChildren();
    if (sendPick?.confirm) {
      listBody.append(sendConfirmBox(sendPick.confirm));
      refocus(listWindow, key);
      return;
    }
    if (sendPick) {
      const verb = sendPick.mode === 'move' ? tr('移す') : tr('写す');
      listBody.append(el('div', 'memo-pane-list-empty', tr('{0}枚を{1}先', { 0: sendPick.ids.length, 1: verb })));
      const neu = el('button', 'memo-pane-list-item memo-pane-list-new', tr('＋ 新しいメモにする'));
      neu.type = 'button';
      neu.dataset.memoId = 'new';
      neu.dataset.focusKey = 'listitem:new';
      neu.title = tr('空のメモを近くに作り、そこへ入れます。呼称セットは、このメモと同じにします');
      neu.addEventListener('click', () => {
        if (ignoreListClick) return;
        chooseSendTarget(null);
      });
      listBody.append(neu);
    }
    if (shown.length === 0) {
      const none = onSheet ? tr('このシートにメモがありません') : tr('まだありません');
      listBody.append(el('div', 'memo-pane-list-empty', q ? tr('当てはまるメモがありません') : none));
    }
    for (const item of shown) listBody.append(listButton(item));
    refocus(listWindow, key);
  }

  function listButton(item: MemoIndexItem) {
    const name = item.title || tr('（空のメモ）');
    const armed = armedItem === item.id;
    const b = el('button', 'memo-pane-list-item');
    b.type = 'button';
    b.dataset.focusKey = `listitem:${item.id}`;
    b.dataset.memoId = item.id;
    b.title = name;
    if (view?.id === item.id) b.setAttribute('aria-current', 'true');
    if (sendPick && view?.id === item.id) {
      b.disabled = true;
      b.title = tr('今開いているメモです');
    }
    if (armed && !sendPick) b.classList.add('armed');
    b.append(el('span', 'memo-pane-list-name', armed && !sendPick ? tr('書きかけが消えます・もう一度押すと替えます') : name));
    if ((item.liked ?? 0) >= 1) b.append(el('span', 'memo-pane-list-mark', `♥${item.liked}`));
    if (item.image) b.append(el('span', 'memo-pane-list-mark', '🖼'));
    if (item.by) b.append(el('span', 'memo-pane-list-by', item.by));
    b.addEventListener('click', () => {
      if (ignoreListClick) return;
      if (sendPick) {
        if (view?.id === item.id) return;
        chooseSendTarget(item.id);
        return;
      }
      // 今開いているメモなら、窓を閉じて題名へ戻す
      if (view?.id === item.id) {
        closeListWindow(true);
        return;
      }
      // 書きかけがあるときは、1 回目は印を付けて窓を開いたままにする（もう一度押すと替わる）
      if (hasDraft() && armedItem !== item.id) {
        armedItem = item.id;
        renderList();
        return;
      }
      armedItem = null;
      flush();
      ask({ command: 'openMemoPane', id: item.id });
      closeListWindow(false);
    });
    return b;
  }

  // ↑↓：項目のあいだを、本物の焦点で動かす。絞る欄と札から ↓ で一件目へ、一件目から ↑ で絞る欄へ。動いたら true
  function moveListFocus(down: boolean): boolean {
    const items = [...listBody.querySelectorAll<HTMLButtonElement>('.memo-pane-list-item')];
    const active = document.activeElement;
    const at = items.findIndex((item) => item === active);
    const onTop = active === filter || (active instanceof HTMLElement && active.classList.contains('memo-pane-list-part'));
    let next: HTMLElement | undefined;
    if (down) next = at < 0 ? (onTop ? items[0] : undefined) : items[at + 1];
    else if (at >= 0) next = at === 0 ? filter : items[at - 1];
    if (!next) return false;
    next.focus();
    return true;
  }

  // ---------- 別のメモへ移す・写す（第1段のメニュー、第2段の選ぶ、第3段のドラッグ） ----------

  function selectedIds(): string[] {
    if (!view) return [];
    const chosen = new Set(picked);
    return orderedTops(view.replies).map((r) => r.id).filter((id) => chosen.has(id));
  }

  // 今見えているカードの順（つながり順のときは、その並び。Shift の範囲と「全部選ぶ」に使う）
  function shownIds(): string[] {
    const ids = [...cards.querySelectorAll<HTMLElement>(':scope > [data-card]')].map((node) => node.dataset.card ?? '').filter((id) => id);
    if (ids.length > 0) return ids;
    return view ? orderLists(view).visible : [];
  }

  function idsForDrag(id: string): string[] {
    if (!pickingCards || !picked.has(id) || picked.size < 2) return [id];
    const ids = selectedIds();
    return ids.length > 0 ? ids : [id];
  }

  function paintDropHint(id: string | null) {
    if (dropHint) {
      dropHint.classList.remove('drop-target');
      dropHint = null;
    }
    if (!id || id === 'same') return;
    const node = listBody.querySelector<HTMLElement>(`[data-memo-id="${CSS.escape(id)}"]`);
    if (!node) return;
    node.classList.add('drop-target');
    dropHint = node;
  }

  function listHit(x: number, y: number): string | null {
    const node = document.elementFromPoint(x, y);
    if (!(node instanceof Element)) return null;
    if (listWindow.hidden) {
      if (title.contains(node)) openListWindow({ focus: false });
      return null;
    }
    const item = node.closest<HTMLElement>('.memo-pane-list-item');
    if (!item || !listWindow.contains(item)) return null;
    const id = item.dataset.memoId;
    if (!id) return null;
    if (id === 'new') return 'new';
    if (id === view?.id) return 'same';
    return id;
  }

  function orderedSendIds(ids: readonly string[]): string[] {
    if (!view) return [];
    const want = new Set(ids);
    return orderedTops(view.replies).map((r) => r.id).filter((id) => want.has(id));
  }

  function beginSend(mode: SendMode, ids: readonly string[]) {
    if (!view) return;
    const next = orderedSendIds(ids);
    if (next.length === 0) {
      say(tr('送るカードがありません'));
      return;
    }
    if (next.some((id) => cardEdits.has(id))) {
      say(tr('書き直しの途中のカードは送れません'));
      return;
    }
    if (cardMap.isOpen) closeMap(false);
    endLinking(false);
    sendPick = { mode, ids: next, confirm: null };
    openListWindow();
  }

  function chooseSendTarget(to: string | null) {
    if (!sendPick) return;
    queueSend(sendPick.mode, sendPick.ids, to);
  }

  function queueSend(mode: SendMode, ids: readonly string[], to: string | null) {
    if (!view) return;
    const next = orderedSendIds(ids);
    if (next.length === 0) {
      say(tr('送るカードがありません'));
      return;
    }
    if (next.some((id) => cardEdits.has(id))) {
      say(tr('書き直しの途中のカードは送れません'));
      return;
    }
    if (to !== null && to === view.id) {
      say(tr('同じメモへは送れません'));
      return;
    }
    const travel = linkTravel(view.replies, next);
    if (travel.cut > 0) {
      sendPick = { mode, ids: next, confirm: { to, cut: travel.cut, kept: travel.kept, ids: next } };
      if (listWindow.hidden) openListWindow({ focus: false });
      else renderList();
      const warning = sendWarning(mode, travel.cut, travel.kept);
      if (warning) say(warning);
      return;
    }
    commitSend(mode, next, to);
  }

  function commitSend(mode: SendMode, ids: readonly string[], to: string | null) {
    if (!view || ids.length === 0) return;
    const from = view.id;
    const travel = linkTravel(view.replies, ids);
    pendingCutNote = sendWarning(mode, travel.cut, travel.kept);
    sendPick = null;
    closeListWindow(false);
    stopPicking();
    ask({ command: 'sendReplies', from, replyIds: [...ids], to, mode });
  }

  function sendConfirmBox(confirm: { to: string | null; cut: number; kept: number; ids: string[] }) {
    const mode = sendPick?.mode ?? 'move';
    const box = el('div', 'memo-pane-send-confirm');
    const where = confirm.to === null ? tr('新しいメモ') : ([...sheetItems, ...recentItems].find((item) => item.id === confirm.to)?.title ?? tr('送り先'));
    box.append(el('p', 'memo-pane-send-confirm-where', tr('「{0}」へ', { 0: where })));
    box.append(el('p', '', sendWarning(mode, confirm.cut, confirm.kept) ?? ''));
    const verb = mode === 'move' ? tr('移す') : tr('写す');
    const row = el('div', 'memo-pane-send-confirm-row');
    const go = el('button', 'memo-pane-list-item', tr('このまま{0}', { 0: verb }));
    go.type = 'button';
    go.dataset.focusKey = 'sendconfirm:go';
    go.addEventListener('click', () => commitSend(mode, confirm.ids, confirm.to));
    row.append(go);
    if (view) {
      const extra = linkedClosure(view.replies, confirm.ids).filter((id) => !confirm.ids.includes(id) && !cardEdits.has(id));
      if (extra.length > 0) {
        const withThem = el('button', 'memo-pane-list-item', tr('つながっている {0} 枚も一緒に{1}', { 0: extra.length, 1: verb }));
        withThem.type = 'button';
        withThem.dataset.focusKey = 'sendconfirm:with';
        withThem.addEventListener('click', () => {
          const next = [...confirm.ids, ...extra];
          const travel = view ? linkTravel(view.replies, next) : { cut: 0, kept: 0, partners: [] };
          if (travel.cut > 0) {
            sendPick = { mode, ids: next, confirm: { to: confirm.to, cut: travel.cut, kept: travel.kept, ids: next } };
            renderList();
          } else commitSend(mode, next, confirm.to);
        });
        row.append(withThem);
      }
      const blocked = linkedClosure(view.replies, confirm.ids).filter((id) => cardEdits.has(id));
      if (blocked.length > 0) box.append(el('p', 'memo-pane-list-empty', tr('書き直しの途中のカードは一緒に送れません')));
    }
    const cancel = el('button', 'memo-pane-list-item', tr('やめる'));
    cancel.type = 'button';
    cancel.dataset.focusKey = 'sendconfirm:cancel';
    cancel.addEventListener('click', () => {
      if (!sendPick) return;
      sendPick = { ...sendPick, confirm: null };
      renderList();
    });
    row.append(cancel);
    box.append(row);
    return box;
  }

  function showSent(text: string, openId: string, token: string) {
    sentOffer = { openId, token };
    sentOpen.hidden = view?.id === openId; // 今開いているメモへ貼った（型）ときは、「送り先を開く」は要らない
    sentText.textContent = text;
    const note = pendingCutNote;
    pendingCutNote = null;
    if (note && status.textContent === note) status.textContent = '';
    sentWarn.textContent = note ?? '';
    sentWarn.hidden = !note;
    sentNotice.hidden = false;
    window.clearTimeout(sentTimer);
    sentTimer = window.setTimeout(() => hideSentNotice(), 45_000);
  }

  // 知らせを閉じる（送り先を開く・元に戻すは、このあと押せない。元に戻す処理そのものはしない）
  function hideSentNotice() {
    const note = sentWarn.textContent ?? '';
    if (note && status.textContent === note) status.textContent = '';
    sentNotice.hidden = true;
    sentWarn.hidden = true;
    sentWarn.textContent = '';
    sentOffer = null;
    pendingCutNote = null;
    window.clearTimeout(sentTimer);
  }

  function startPicking() {
    if (!view) return;
    endLinking(false);
    pickingCards = true;
    picked.clear();
    pickAnchor = null;
    updatePickBar();
    renderCards(view, undefined, true);
  }

  function stopPicking() {
    if (!pickingCards && picked.size === 0) {
      pickBar.hidden = true;
      return;
    }
    pickingCards = false;
    picked.clear();
    pickAnchor = null;
    pickBar.hidden = true;
    closeTplDialog(false);
    renderCountTools();
    if (view) renderCards(view, undefined, true);
  }

  function togglePicked(id: string, shift: boolean) {
    const current = view;
    if (!current) return;
    if (shift && pickAnchor) {
      for (const next of rangeIds(shownIds(), pickAnchor, id)) picked.add(next);
    } else if (picked.has(id)) {
      picked.delete(id);
      pickAnchor = id;
    } else {
      picked.add(id);
      pickAnchor = id;
    }
    renderCards(current, undefined, true);
  }

  function updatePickBar() {
    if (!pickingCards) {
      pickBar.hidden = true;
      return;
    }
    pickBar.hidden = false;
    const n = picked.size;
    pickText.textContent = tr('{0}枚を選んでいます', { 0: n });
    pickMove.disabled = n === 0;
    pickCopy.disabled = n === 0;
    pickNew.disabled = n === 0;
    const tplState = templatePickState(n);
    pickTemplate.disabled = !tplState.enabled;
    pickTemplate.title = tplState.hint;
    if (!tplDialog.hidden && !tplSaving && !tplFromBoard && !sameIds(selectedIds(), tplIds)) closeTplDialog(false); // 選び直したら、小窓は閉じる（数が変わるため）
    pickAll.textContent = filterTag !== null ? tr('絞り込み中を全部選ぶ') : tr('全部選ぶ');
  }

  // ---------- 型にする（選んだカードを型として登録。計画書 docs/plan-card-templates.md の Phase 1b） ----------

  function sameIds(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((id) => b.includes(id));
  }

  function paintTplModes() {
    for (const [i, btn] of tplModeBtns.entries()) btn.setAttribute('aria-pressed', String(TEMPLATE_MODES[i] === tplMode));
    tplModeNote.textContent = templateModeNote(tplMode);
  }

  // 型にする・空欄を入れて貼るの元になるカードの写し。ボードから開いたときはボードが見ているメモ（選んだメモか、下の区画と同じメモ）、選ぶ帯からのときは下の区画のメモ
  function tplSource(fromBoard: boolean): MemoPaneView | null {
    return templateSource(fromBoard, boardMemoView, view);
  }

  // 数の 2 行を、いまのモードで数え直す（穴あきは空欄の数も出る）
  function refreshTplPreview() {
    const src = tplSource(tplFromBoard);
    if (!src) return;
    const preview = buildTemplateFromCards(src.replies, tplIds, { name: tr('型'), mode: tplMode, offsets: tplOffsets ?? undefined });
    if (!preview.ok) return;
    const text = describeTemplateReport(preview.report);
    tplCounts.textContent = text.counts;
    tplExcluded.textContent = text.excluded;
  }

  function paintTplFolders() {
    for (const [i, btn] of tplFolderBtns.entries()) btn.setAttribute('aria-pressed', String(TEMPLATE_FOLDERS[i] === tplFolder));
  }

  function tplSay(text: string, error = false) {
    tplMsg.textContent = text;
    tplMsg.classList.toggle('error', error);
  }

  function placeTplDialog() {
    const rootBox = flowFrame().getBoundingClientRect();
    const anchor = tplFromBoard && tplAnchor?.isConnected ? tplAnchor : pickBar; // ボードから開いたときは、ボードの道具の列の下
    const top = Math.round(anchor.getBoundingClientRect().bottom - rootBox.top) + 2;
    tplDialog.style.top = `${top}px`;
    tplDialog.style.maxHeight = `${Math.max(40, Math.round(rootBox.height - top - 6))}px`;
  }

  // 選ぶ帯の「型にする…」（from 無し）と、ボードの「型にする…」（from：選んだカードの id・ボードの座標の差・小窓を出す目印。B3-1）の両方がここから開く
  function openTplDialog(from?: { ids: string[]; offsets: Record<string, { dx: number; dy: number }>; anchor: HTMLElement }) {
    const src = tplSource(from !== undefined);
    if (!src || (!from && !pickingCards)) return;
    const ids = from ? from.ids : selectedIds();
    const state = templatePickState(ids.length);
    if (!state.enabled) {
      status.textContent = state.hint;
      return;
    }
    // 数だけ先に見せる（名前は仮。ほんとうの登録は「登録」を押したとき）
    const preview = buildTemplateFromCards(src.replies, ids, { name: tr('型'), offsets: from?.offsets });
    if (!preview.ok) {
      const note = preview.why === 'missing' ? tr('選んだカードが見つかりません。選び直してください') : tr('型にできませんでした');
      status.textContent = note;
      if (from) tplDoneListeners.forEach((fn) => fn(note, false));
      return;
    }
    closeTplDialog(false);
    tplFromBoard = from !== undefined;
    tplAnchor = from?.anchor ?? null;
    tplOffsets = from?.offsets ?? null;
    tplIds = ids;
    tplFolder = TEMPLATE_FOLDERS[0];
    tplMode = 'snapshot';
    paintTplModes();
    refreshTplPreview();
    tplName.value = '';
    tplSay('');
    paintTplFolders();
    tplSave.disabled = false;
    tplDialog.hidden = false;
    placeTplDialog();
    tplName.focus();
  }

  // returnFocus：小窓の中に焦点があったときだけ、選ぶ帯の「型にする…」へ戻す
  function closeTplDialog(returnFocus: boolean) {
    if (tplDialog.hidden) return;
    const inside = tplDialog.contains(document.activeElement);
    tplDialog.hidden = true;
    tplIds = [];
    tplFromBoard = false;
    tplAnchor = null;
    tplOffsets = null;
    if (returnFocus && inside && !pickBar.hidden) pickTemplate.focus();
  }

  async function saveTplDialog() {
    if (tplSaving || tplDialog.hidden) return;
    const fromBoard = tplFromBoard; // 保存の間に小窓が閉じても、どちらから開いたかを覚えておく
    const src = tplSource(fromBoard);
    if (!src) return;
    // ボードから開いたときだけ：名前が空なら「無題の型」にする（選ぶ帯からのときは今までどおり、名前を求める）
    const name = fromBoard && cleanTemplateName(tplName.value) === '' ? TEMPLATE_UNTITLED : tplName.value;
    const built = buildTemplateFromCards(src.replies, tplIds, { name, folder: tplFolder, mode: tplMode, offsets: tplOffsets ?? undefined });
    if (!built.ok) {
      const messages = {
        empty: tr('選んだカードがありません'),
        missing: tr('選んだカードが見つかりません。選び直してください'),
        'too-many': tr('型にできるのは {0} 枚までです', { 0: TEMPLATE_LIMITS.cards }),
        name: tr('名前を入れてください'),
        text: tr('カードの文が長すぎます（{0}文字まで）', { 0: TEMPLATE_LIMITS.text }),
      } as const;
      tplSay(messages[built.why], true);
      if (built.why === 'name') tplName.focus();
      return;
    }
    tplSaving = true;
    tplSave.disabled = true;
    tplSay(tr('保存しています…'));
    // ボードから開いたときだけ：同じ名前の型がすでにあれば断る（選ぶ帯からのときは、今までどおり同じ名前も登録できる）
    if (fromBoard) {
      const existing = await loadTemplates(templateIo).catch(() => null);
      if (existing && existing.state !== 'unreadable' && templateNameTaken(existing.templates, built.template.name)) {
        tplSaving = false;
        tplSave.disabled = false;
        tplSay(tr('「{0}」という名前の型がすでにあります。別の名前にしてください', { 0: built.template.name }), true);
        tplName.focus();
        return;
      }
    }
    const done = await saveNewTemplate(templateIo, built.template).catch(() => ({ ok: false as const, why: 'write' as const }));
    tplSaving = false;
    if (tplDialog.hidden) {
      // 保存の間に、小窓が閉じた（Esc・メモを替えた など）。保存できたことだけは知らせる
      if (done.ok) {
        const text = tr('型「{0}」を登録しました（{1}件）', { 0: built.template.name, 1: done.count });
        say(text);
        if (fromBoard) tplDoneListeners.forEach((fn) => fn(text, true));
      }
      return;
    }
    tplSave.disabled = false;
    if (!done.ok) {
      tplSay(templateSaveMessage(done.why), true); // 小窓は開けたまま（名前は残す。やり直せる）
      return;
    }
    const savedName = built.template.name;
    closeTplDialog(false);
    if (!fromBoard) stopPicking(); // ボードから開いたときは、選びをそのまま残す
    const text = tr('型「{0}」を登録しました（{1}件）', { 0: savedName, 1: done.count });
    say(text);
    if (fromBoard) tplDoneListeners.forEach((fn) => fn(text, true));
  }

  function openExported(name: string) {
    if (!isSafeExportName(name)) {
      status.textContent = tr('このファイルは開けません（書き出す：名前）');
      return;
    }
    send({ type: 'openExported', name });
  }

  function revealExported(name: string) {
    if (!isSafeExportName(name)) {
      status.textContent = tr('このファイルのフォルダは開けません（書き出す：名前）');
      return;
    }
    send({ type: 'revealExported', name });
  }

  async function addImageFile(file: File) {
    if (!view || busy) return;
    const memoId = view.id;
    if (file.type && !file.type.startsWith('image/')) {
      status.textContent = tr('画像のファイルを選んでください');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      status.textContent = tr('20MB を超える画像は入れられません');
      return;
    }
    setBusy(true);
    try {
      const src = await readAsDataUrl(file);
      if (view?.id !== memoId) return;
      if (!src) {
        status.textContent = tr('この画像は入れられませんでした（ファイル：読めない）');
        return;
      }
      const png = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const fit = await fitPicture(src, png);
      if (view?.id !== memoId) return;
      if ('error' in fit) {
        status.textContent = tr('この画像は入れられませんでした（{0}）', { 0: FIT_STAGE[fit.error] });
        return;
      }
      await saveShot(memoId, fit.dataUrl);
    } finally {
      setBusy(false);
    }
  }

  async function saveShot(memoId: string, dataUrl: string, quote?: ReplyQuote) {
    if (view?.id !== memoId) return;
    if (!roomForCard()) return;
    const id = newShotId();
    const ok = await writeData(`shots/${id}.json`, { version: 1, data: dataUrl });
    if (view?.id !== memoId) return;
    if (!ok) {
      status.textContent = tr('画像を保存できませんでした（保存：ファイルに書けない）');
      return;
    }
    shotUrls.set(id, dataUrl);
    armNewEdit();
    ask({ command: 'addMemoComment', id: memoId, text: '', image: id, ...(quote ? { quote } : {}) });
    status.textContent = tr('画像を入れました');
  }

  // 帯は、状態の行と件数の行にちょうど重ねる（区画の中の位置を測って入れる）
  function placeLinkBar() {
    const rootBox = flowFrame().getBoundingClientRect();
    const statusBox = status.getBoundingClientRect();
    linkBar.style.top = `${Math.round(statusBox.top - rootBox.top)}px`;
    linkBar.style.minHeight = `${Math.round(countline.getBoundingClientRect().bottom - statusBox.top)}px`;
  }

  // 関連づけを始める：元のカードを決めて、帯を出す（相手のカードを押すのを待つ）
  function startLinking(from: string, key: string) {
    const reply = view?.replies.find((r) => r.id === from && r.parent === null);
    if (!reply) return;
    linkMenu.close();
    relMenu.close();
    linking = { from, key };
    linkText.textContent = tr('「{0}」の相手のカードを押してください', { 0: cardLabel(reply, 16) });
    placeLinkBar();
    linkBar.hidden = false;
    if (view) renderCards(view);
  }

  // 関連づけをやめる（returnFocus：元の「🔗」の位置へ焦点を戻す）
  function endLinking(returnFocus: boolean) {
    if (linking === null) return;
    const key = linking.key;
    linking = null;
    linkBar.hidden = true;
    linkMenu.close();
    relMenu.close();
    closeLinkPicker(false);
    if (view) renderCards(view);
    if (returnFocus) refocus(cards, key);
  }

  // 種類を選んだとき：今と同じなら何もしない。違えば左に頼む（左が断ったときは、左の知らせが状態の行に出る）
  function chooseKind(from: string, to: string, kind: LinkKind) {
    if (view) {
      const a = view.replies.find((r) => r.id === from && r.parent === null);
      const now = a?.links?.find((l) => l.to === to)?.kind;
      if (now !== kind) {
        ask({ command: 'changeReplyLinks', id: view.id, replyId: from, add: [{ to, kind }], remove: [] });
        status.textContent = tr('関連「{0}」を付けました', { 0: linkKindInfo(kind).name });
      }
    }
    endLinking(true);
  }

  // 相手のカードを押したとき：種類の小さな欄（元と相手は、どちらも一番上のカード）
  function openKindMenu(from: string, to: string, x: number, y: number, keyboard: boolean) {
    if (!view) return;
    const a = view.replies.find((r) => r.id === from && r.parent === null);
    const b = view.replies.find((r) => r.id === to && r.parent === null);
    if (!a || !b) return;
    const now = a.links?.find((l) => l.to === to)?.kind;
    const backSame = (b.links ?? []).some((l) => l.to === from && l.kind === 'same');
    const set = chosenLinkNameSet(linkNameSets.book, view.linkSet);
    const entries: MenuEntry[] = [{ section: tr('「{0}」は「{1}」の…{2}', { 0: cardLabel(a, 12), 1: cardLabel(b, 12), 2: set ? `（${set.name}）` : '' }) }];
    for (const k of LINK_KINDS) {
      entries.push({
        label: k.name,
        hint: now === k.kind ? tr('今の種類') : k.kind === 'same' && backSame ? tr('もう「{0}」です', { 0: k.name }) : undefined,
        disabled: k.kind === 'same' && backSame && now !== 'same',
        run: () => chooseKind(from, to, k.kind),
      });
    }
    if (now) {
      entries.push('sep', {
        label: tr('この関連を外す'),
        run: () => {
          if (view) ask({ command: 'changeReplyLinks', id: view.id, replyId: from, add: [], remove: [{ to, kind: now }] });
          status.textContent = tr('関連を外しました');
          endLinking(true);
        },
      });
    }
    entries.push('sep', { label: tr('やめる'), run: () => endLinking(true) });
    linkMenu.open(x, y, entries);
    if (keyboard) linkMenu.focusFirst();
  }

  // 関連の一覧の一行：出る関連（source は元のカード＝このカード）と、来る関連（source はそのカード）
  type CardRelation = { other: string; kind: LinkKind; source: string; outgoing: boolean };
  const LINK_PICK_MAX = 30; // 相手の一覧に出す枚数（あふれたら「字で絞ってください」）

  // このカード（一番上）の関連：出る関連は links の順、来る関連はほかの一番上のカードの並べた順。相手が一番上のカードに無いものは入れない
  function relationsOf(current: MemoPaneView, id: string): CardRelation[] {
    const tops = orderedTops(current.replies);
    const topIds = new Set(tops.map((r) => r.id));
    const out: CardRelation[] = [];
    const self = tops.find((r) => r.id === id);
    for (const link of self?.links ?? []) if (topIds.has(link.to)) out.push({ other: link.to, kind: link.kind, source: id, outgoing: true });
    for (const top of tops) {
      if (top.id === id) continue;
      for (const link of top.links ?? []) if (link.to === id) out.push({ other: top.id, kind: link.kind, source: top.id, outgoing: false });
    }
    return out;
  }

  // 「関連 n」を押したとき：このカードの関連の一覧（移る・外す）。キーボードのときは、いちばん上の項目へ
  // origin：一覧を開いたカード（並びのカード・並びに出したカード・マップに出したカード）。「見る」で出すカードの元になる
  function openRelations(id: string, x: number, y: number, keyboard: boolean, origin: RelationOrigin = 'card') {
    if (!view) return;
    const current = view;
    const shown = new Set(visibleTops(current.replies, filterTag, keepShown).map((r) => r.id));
    const set = chosenLinkNameSet(linkNameSets.book, current.linkSet);
    const entries: MenuEntry[] = [{ section: set ? tr('このカードの関連（{0}）', { 0: set.name }) : tr('このカードの関連') }];
    for (const rel of relationsOf(current, id)) {
      const other = current.replies.find((r) => r.id === rel.other);
      if (!other) continue;
      const name = `「${cardLabel(other, 16)}」`;
      const sentence = rel.outgoing ? linkSentence(tr('このカード'), name, rel.kind) : linkSentence(name, tr('このカード'), rel.kind);
      // 見る：相手のカードを、このカードの横に出して止める（もう一度押すと閉じる。一覧は開いたまま）。行の右クリックも同じ
      const peek: MenuButton = {
        label: tr('見る'),
        aria: tr('{0}：相手のカードを横に出す（もう一度押すと閉じる）', { 0: sentence }),
        title: tr('相手のカードを横に出して止める（もう一度押すと閉じる・右クリックでも）'),
        pressed: peeking(rel.other),
        run: () => {
          peekLinked(id, rel.other, origin);
          peek.pressed = peeking(rel.other);
          relMenu.refresh();
        },
      };
      entries.push({
        menu: () => peek.run(),
        row: sentence,
        hint: shown.has(rel.other) ? undefined : tr('絞りで隠れています'),
        buttons: [
          peek,
          { label: tr('移る'), aria: tr('{0}：相手のカードへ移る', { 0: sentence }), close: true, run: () => jumpToLinked(rel.other) },
          {
            label: tr('外す'),
            aria: tr('{0}：この関連を外す', { 0: sentence }),
            close: true,
            run: () => {
              if (view) ask({ command: 'changeReplyLinks', id: view.id, replyId: rel.source, add: [], remove: [{ to: rel.outgoing ? rel.other : id, kind: rel.kind }] });
              status.textContent = tr('関連を外しました');
            },
          },
        ],
      });
    }
    linkMenu.close();
    relMenu.open(x, y, entries);
    frontStack.raise(relMenu.node); // 開いた欄は前
    if (keyboard) relMenu.focusFirst();
  }

  // 「見る」で出しているか（マップを開いているときは、マップに出したカード）
  function peeking(id: string): boolean {
    return cardMap.isOpen ? cardMap.hasPop(id) : listPops.has(id);
  }

  // 関連の「見る」：相手のカード（target）を出す・閉じる。元（source）が並びのカードならその横、並びに出したカードならそのカードの横。
  //   マップを開いているときは、マップの札の横（札の右クリックと同じ）
  function peekLinked(source: string, target: string, origin: RelationOrigin) {
    if (!topCard(target)) {
      status.textContent = tr('そのカードは、もうありません');
      return;
    }
    if (cardMap.isOpen || origin === 'map-pop') {
      cardMap.togglePop(target, false);
      return;
    }
    const anchor = origin === 'list-pop' ? () => listPops.boxOf(source) : () => cards.querySelector<HTMLElement>(`[data-card="${CSS.escape(source)}"]`);
    listPops.toggle(target, { anchor });
  }

  // 関連の「移る」：そのカードへ移って光らせる（タグの絞りで隠れていれば、絞りを外す）
  function jumpToLinked(id: string) {
    if (!view) return;
    const current = view;
    const target = current.replies.find((r) => r.id === id && r.parent === null);
    if (!target) {
      status.textContent = tr('そのカードは、もうありません');
      return;
    }
    if (cardMap.isOpen) closeMap(false); // 移る道は先に閉じる（マップの窓）
    if (filterTag !== null && !(target.tags ?? []).includes(filterTag) && !keepShown.has(id)) {
      filterTag = null;
      keepShown.clear();
      status.textContent = tr('タグの絞りを外しました（関連から移ったため）');
    }
    renderCards(current, undefined, true);
    const node = cards.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`);
    if (!node) return;
    node.scrollIntoView({ block: 'center' });
    selectedCard = id; // 移った先を「選んだカード」にする（描き直しは renderCards の予約が 1 コマ後に行う）
    startFlash(id, true);
  }

  // 相手の一覧の窓を開く（関連づけている間だけ）。絞る欄に焦点
  function openLinkPicker() {
    if (linking === null || !view) return;
    linkMenu.close();
    relMenu.close();
    linkPicker.hidden = false;
    placeLinkPicker();
    linkFilter.value = '';
    renderLinkPicker();
    linkFilter.focus();
  }

  // 相手の一覧の窓を閉じる（returnFocus：中に焦点があったときだけ、帯の「一覧から選ぶ」へ戻す）
  function closeLinkPicker(returnFocus: boolean) {
    if (linkPicker.hidden) return;
    const inside = linkPicker.contains(document.activeElement);
    linkPicker.hidden = true;
    if (returnFocus && inside) linkPick.focus({ preventScroll: true });
  }

  // 窓の置き場は一覧の窓と同じ（帯の下から。帯の下に 120px 入らなければ、つまみのすぐ下から）
  function placeLinkPicker() {
    const rootBox = flowFrame().getBoundingClientRect();
    let top = Math.round(linkBar.getBoundingClientRect().bottom - rootBox.top) + 2;
    if (rootBox.height - top - 8 < 120) top = Math.round(handle.getBoundingClientRect().bottom - rootBox.top) + 2;
    linkPicker.style.top = `${top}px`;
    linkPicker.style.maxHeight = `${Math.max(40, Math.round(rootBox.height - top - 6))}px`;
  }

  // 相手の候補：一番上のカードで、元のカードでないもの（新しい順・LINK_PICK_MAX 枚まで）。字で絞る（題・文の小文字）
  function renderLinkPicker() {
    linkList.replaceChildren();
    if (linking === null || !view) return;
    const from = linking.from;
    const current = view;
    const q = linkFilter.value.trim().toLowerCase();
    const shown = new Set(visibleTops(current.replies, filterTag, keepShown).map((r) => r.id));
    const hits = current.replies
      .filter((r) => r.parent === null && r.id !== from)
      .filter((r) => !q || cardLabel(r, 80).toLowerCase().includes(q) || r.text.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const r of hits.slice(0, LINK_PICK_MAX)) {
      const item = el('button', 'memo-pane-link-picker-item');
      item.type = 'button';
      item.dataset.pick = r.id;
      item.append(el('span', 'memo-pane-link-picker-name', cardLabel(r, 30)), el('span', 'memo-pane-link-picker-date', dateOf(r.createdAt)));
      item.title = cardLabel(r, 120);
      if (!shown.has(r.id)) item.append(el('span', 'memo-pane-link-picker-hidden', tr('隠れ')));
      item.addEventListener('click', () => {
        if (linking === null) return;
        const rect = item.getBoundingClientRect();
        const pickFrom = linking.from;
        closeLinkPicker(false);
        linkPick.focus({ preventScroll: true }); // 種類の欄を Esc で閉じたら、帯の「一覧から選ぶ」に焦点が戻るように（欄は開いたボタンを覚える）
        openKindMenu(pickFrom, r.id, rect.left, rect.bottom, true);
      });
      linkList.append(item);
    }
    if (hits.length === 0) linkList.append(el('div', 'memo-pane-link-picker-empty', tr('当てはまるカードがありません')));
    else if (hits.length > LINK_PICK_MAX) linkList.append(el('div', 'memo-pane-link-picker-empty', tr('ほか {0} 枚（字で絞ってください）', { 0: hits.length - LINK_PICK_MAX })));
  }

  // ↑↓：窓の中の項目のあいだを、本物の焦点で動かす（絞る欄から ↓ で一件目、一件目から ↑ で絞る欄）。動いたら true
  function movePickerFocus(down: boolean): boolean {
    const items = [...linkList.querySelectorAll<HTMLButtonElement>('.memo-pane-link-picker-item')];
    const active = document.activeElement;
    const at = items.findIndex((item) => item === active);
    let next: HTMLElement | undefined;
    if (down) next = at < 0 ? (active === linkFilter ? items[0] : undefined) : items[at + 1];
    else if (at >= 0) next = at === 0 ? linkFilter : items[at - 1];
    if (!next) return false;
    next.focus();
    return true;
  }

  // ---------- カードのいつものタグ（6 つ）・セット・その他 ----------
  //   「＋タグ」の後ろに、登録したタグの小さなボタン（押すと付ける・外す。付いていれば押した見た目）と「セット ▾」「その他 ▾」
  type TagChange = (add: string[], remove: string[]) => void;
  function addTags(now: readonly string[], wanted: readonly string[], change: TagChange) {
    const fresh = wanted.filter((t) => !now.includes(t));
    const room = Math.max(0, MAX_TAGS_PER_TAB - now.length);
    if (fresh.length === 0) {
      status.textContent = tr('もう付いています');
      return;
    }
    if (room === 0) {
      status.textContent = tr('タグは1つに {0} 個までです（ほかのタグを外してから付けてください）', { 0: MAX_TAGS_PER_TAB });
      return;
    }
    change(fresh.slice(0, room), []);
    if (fresh.length > room) status.textContent = tr('タグは1つに {0} 個までなので、{1} 個は付けませんでした', { 0: MAX_TAGS_PER_TAB, 1: fresh.length - room });
  }

  function quickTags(now: readonly string[], change: TagChange, key: string): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const tag of tagBook.current.tags) {
      if (!tag) continue;
      const on = now.includes(tag);
      const b = el('button', 'memo-pane-quick-tag', tag);
      b.type = 'button';
      b.style.setProperty('--tag', tagColor(tag));
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? tr('タグ「{0}」を外す（いつものタグ）', { 0: tag }) : tr('タグ「{0}」を付ける（いつものタグ）', { 0: tag });
      b.dataset.focusKey = `card:${key}:quick:${tag}`;
      b.addEventListener('click', () => (on ? change([], [tag]) : addTags(now, [tag], change)));
      out.push(b);
    }
    const sets = el('button', 'memo-pane-tag-menu', tr('セット▾'));
    sets.type = 'button';
    sets.title = tr('タグのセット（いつものタグを替える・全部付ける・今のタグを保存・登録）');
    sets.setAttribute('aria-haspopup', 'menu');
    sets.dataset.focusKey = `card:${key}:tagsets`;
    sets.addEventListener('click', () => {
      const r = sets.getBoundingClientRect();
      openTagSetMenu(now, change, r.left, r.bottom);
    });
    const other = el('button', 'memo-pane-tag-menu', tr('その他▾'));
    other.type = 'button';
    other.title = tr('ほかのタグ（このメモでよく使う順）から付ける');
    other.setAttribute('aria-haspopup', 'menu');
    other.dataset.focusKey = `card:${key}:tagother`;
    other.addEventListener('click', () => {
      const r = other.getBoundingClientRect();
      openOtherTags(now, change, r.left, r.bottom);
    });
    out.push(sets, other);
    return out;
  }

  function openTagSetMenu(now: readonly string[], change: TagChange, x: number, y: number) {
    void tagBook.reload(); // 右で替えたかもしれない（変わっていれば、カードは描き直る）
    const book = tagBook.book;
    const cur = tagBook.current;
    const reopen = () => openTagSetMenu(now, change, x, y);
    const entries: MenuEntry[] = [{ section: tr('タグのセット（右サイドバーのタグのボタンと同じ）') }];
    for (const set of book.sets) {
      const list = set.tags.filter((t): t is string => !!t);
      entries.push({
        row: set.id === cur.id ? tr('{0}（いつもの）', { 0: set.name }) : set.name,
        hint: list.length > 0 ? list.join(tr('・')) : tr('空き'),
        buttons: [
          { label: tr('使う'), pressed: set.id === cur.id, title: tr('カードに出す 6 つのボタンを、このセットにする'), run: () => (tagBook.apply({ type: 'setCurrent', id: set.id }), reopen()) },
          { label: tr('全部付ける'), close: true, run: () => (list.length > 0 ? addTags(now, list, change) : (status.textContent = tr('このセットは空きです'))) },
        ],
      });
    }
    entries.push('sep');
    entries.push({
      label: tr('今のタグをセットとして保存…'),
      hint: now.length > TAG_BUTTONS ? tr('はじめの {0} 個', { 0: TAG_BUTTONS }) : `${now.length}`,
      disabled: now.length === 0 || book.sets.length >= 12,
      run: () =>
        tagMenu.prompt(tr('新しいセットの名前'), tr('セット{0}', { 0: book.sets.length + 1 }), (name) => {
          tagBook.apply({ type: 'addSet', name, tags: now.slice(0, TAG_BUTTONS) });
          status.textContent = tr('セット「{0}」を保存して、いつものタグにしました', { 0: name });
        }, { x, y }, { maxLength: 20 }),
    });
    entries.push({ label: tr('いつものタグを登録…'), hint: tr('{0} つ', { 0: TAG_BUTTONS }), run: () => openTagRegister(cur, x, y) });
    entries.push({ label: tr('「{0}」の名前を変える…', { 0: cur.name }), run: () => tagMenu.prompt(tr('セットの名前'), cur.name, (name) => tagBook.apply({ type: 'replaceSet', id: cur.id, name }), { x, y }, { maxLength: 20 }) });
    if (book.sets.length > 1) entries.push({ row: '', buttons: [{ label: tr('「{0}」を消す', { 0: cur.name }), confirm: tr('もう一度押すと消す'), close: true, run: () => tagBook.apply({ type: 'removeSet', id: cur.id }) }] });
    if (!tagBook.ready) entries.push({ note: tr('タグのボタンを読み込んでいます…') });
    tagMenu.open(x, y, entries);
  }

  function openOtherTags(now: readonly string[], change: TagChange, x: number, y: number) {
    const mine = new Set(tagBook.current.tags.filter((t): t is string => !!t));
    const list = candidates.filter((t) => !now.includes(t) && !mine.has(t)).slice(0, 30);
    const pills: MenuButton[] = list.map((tag) => ({ label: tag, close: true, run: () => addTags(now, [tag], change) }));
    tagMenu.open(x, y, [
      { section: tr('その他のタグ（このメモでよく使う順）') },
      ...(pills.length > 0 ? [{ pills } as MenuEntry] : [{ note: tr('ほかのタグはありません（「＋タグ」で書いて付けられます）') } as MenuEntry]),
    ]);
  }

  // いつものタグ（今のセットの 6 つ）を登録する小窓。候補から選ぶか、書く。空欄は空き
  function openTagRegister(set: TagButtonSet, x: number, y: number) {
    const form = el('form', 'cell-menu-form memo-pane-tag-register');
    form.append(el('div', 'cell-menu-section', tr('いつものタグ（セット「{0}」の {1} つ）', { 0: set.name, 1: TAG_BUTTONS })));
    const list = el('datalist');
    list.id = `memo-tag-register-${Date.now().toString(36)}`;
    for (const tag of candidates) {
      const option = el('option');
      option.value = tag;
      list.append(option);
    }
    form.append(list);
    const inputs: HTMLInputElement[] = [];
    for (let i = 0; i < TAG_BUTTONS; i++) {
      const row = el('div', 'memo-pane-tag-register-row');
      const input = el('input');
      input.value = set.tags[i] ?? '';
      input.maxLength = 30;
      input.placeholder = tr('{0} つ目（空き）', { 0: i + 1 });
      input.setAttribute('list', list.id);
      input.setAttribute('aria-label', `いつものタグ ${i + 1} つ目`);
      const clear = el('button', 'cell-menu-small', tr('空ける'));
      clear.type = 'button';
      clear.addEventListener('click', () => ((input.value = ''), input.focus()));
      row.append(input, clear);
      form.append(row);
      inputs.push(input);
    }
    const buttons = el('div', 'cell-menu-kind');
    const ok = el('button', 'cell-menu-small', tr('登録する'));
    ok.type = 'submit';
    const cancel = el('button', 'cell-menu-small', tr('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => tagMenu.close());
    buttons.append(ok, cancel);
    form.append(buttons);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const tags = inputs.map((input) => normalizeTag(input.value) || null);
      tagBook.apply({ type: 'replaceSet', id: set.id, tags });
      tagMenu.close();
      status.textContent = tr('いつものタグを登録しました（セット「{0}」）', { 0: set.name });
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        tagMenu.close();
      }
    });
    tagMenu.showForm(form, { x, y });
    inputs[0]?.focus();
  }

  // AI のカード（plan-reader-video の V4b-2）：一番上のカードで、書いたキャラ（by）と種類（at.kind）があるもの
  function isAiCard(reply: Reply): boolean {
    return reply.parent === null && !!reply.by && !!reply.at?.kind;
  }

  // AI のカードの本文（V4b-2）：見出し、「▶ 時刻」の行（押すと読む画面のその時刻へ。開いていなければ、その動画を開く）、技法の札、字のままの行。畳まない
  function aiCardBody(reply: Reply): HTMLElement {
    const body = el('div', 'memo-pane-ai-body');
    const parsed = parseAiCardText(reply.text);
    if (parsed.head) body.append(el('strong', 'memo-pane-ai-head', parsed.head));
    parsed.rows.forEach((row, i) => {
      if (row.kind === 'timed') {
        const line = el('div', 'memo-pane-ai-row');
        const start = row.sec;
        const play = el('button', 'memo-pane-at', `▶ ${row.label}`);
        play.type = 'button';
        play.title = tr('読む画面でこの時刻へ（開いていなければ、その動画を開きます）');
        play.dataset.focusKey = `card:${reply.id}:ai:${i}`;
        play.addEventListener('click', (e) => {
          e.stopPropagation();
          if (reply.at) ask({ command: 'openReaderAt', video: reply.at.video, start });
        });
        line.append(play);
        if (row.tech) line.append(el('span', 'memo-pane-ai-tech', row.tech));
        line.append(el('span', 'memo-pane-ai-text', row.text));
        body.append(line);
      } else {
        const line = el('div', 'memo-pane-ai-row plain');
        line.append(el('span', 'memo-pane-ai-text', row.text));
        body.append(line);
      }
    });
    return body;
  }

  // mapPop：出したカード（マップの札の右クリック・並びの関連の「見る」。where で見分ける）。並べ替えのつまみの代わりに「✕ 閉じる」を出し、
  //   🔗 は使えなくする。⋯ に出す側を足す
  function commentCard(current: MemoPaneView, reply: Reply, mapPop?: PopControl, where: 'map' | 'list' = 'map') {
    const inMap = mapPop !== undefined; // 出したカード（マップ・並びのどちらでも）
    const scope: ParentNode = mapPop ? mapPop.scope : cards; // 描き直したあとに焦点を当てる欄を探す所
    const origin: RelationOrigin = !mapPop ? 'card' : where === 'list' ? 'list-pop' : 'map-pop';
    const card = el('article', 'memo-pane-card');
    card.dataset.card = reply.id;
    // AI のカード（V4b-2）：種類の色の帯（CSS の ai-card・data-ai-kind）。頭の帯に種類の名前、本文は畳まない
    const aiKind = isAiCard(reply) ? reply.at?.kind : undefined;
    if (aiKind) {
      card.classList.add('ai-card');
      card.dataset.aiKind = aiKind;
    }
    if (linking?.from === reply.id) card.classList.add('link-from');
    if (pickingCards && !inMap && picked.has(reply.id)) card.classList.add('picked');
    const ref = refOf(current.id);
    const head = el('div', 'memo-pane-card-head');
    const headMain = el('span', 'memo-pane-card-head-main');
    headMain.append(el('span', '', `${kindMark(reply)} ${reply.by?.name ?? tr('あなた')}`), el('span', '', `· ${dateOf(reply.createdAt)}`));
    if (aiKind) headMain.append(el('span', 'memo-pane-ai-kind', `· ${AI_KIND_LABEL[aiKind]}`));
    const cost = reply.by?.cost; // 目安の料金（AI のカードでなくても、by.cost があれば出す）
    if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) headMain.append(el('span', 'memo-pane-ai-cost', tr('· 約 ${0}', { 0: cost.toFixed(3) })));
    if (reply.editedAt) headMain.append(el('span', 'memo-pane-edited', tr('· 書き直し済み')));
    // 結んだ区間（六角で見る。plan-reader-video の V2a-3）：「▶ 3:04」で読む画面のその時刻へ（開いていなければ、左がその動画を開く）。
    //   一つのメモに別々の動画のカードがあるときは、動画の札（題の頭）も出す（D23）
    const at = reply.parent === null ? reply.at : undefined;
    if (at) {
      const first = at.spans[0];
      const play = el('button', 'memo-pane-at', `▶ ${secLabel(first.start)}${at.spans.length > 1 ? tr(' ほか {0}', { 0: at.spans.length - 1 }) : ''}`);
      play.type = 'button';
      play.title = tr('読む画面でこの時刻へ（開いていなければ、その動画を開きます）');
      play.dataset.focusKey = `card:${reply.id}:at`;
      play.addEventListener('click', (e) => {
        e.stopPropagation();
        ask({ command: 'openReaderAt', video: at.video, start: first.start });
      });
      // マスで見る（V2b）：読む画面でこのカードと結んだマスを光らせる。もう一度押すと消す（開いていなければ、左がその動画を開いてから光らせる）
      const look = el('button', 'memo-pane-at-glow', tr('マスで見る'));
      look.type = 'button';
      look.title = tr('読む画面で、このカードと結んだマスを光らせる（もう一度押すと消えます。読む画面が開いていなければ、その動画を開きます）');
      look.dataset.glowCard = reply.id;
      look.dataset.focusKey = `card:${reply.id}:glow`;
      look.setAttribute('aria-pressed', String(glowing?.memoId === current.id && glowing.replyId === reply.id));
      look.addEventListener('click', (e) => {
        e.stopPropagation();
        if (glowing?.memoId === current.id && glowing.replyId === reply.id) {
          dropGlow();
          say(tr('マスの光りを消しました'));
        } else {
          glowing = { memoId: current.id, replyId: reply.id };
          ask({ command: 'openReaderAt', video: at.video, start: first.start, glow: { memoId: current.id, replyId: reply.id } });
          say(tr('読む画面で、結んだマスを光らせます'));
        }
        paintReaderNow();
      });
      headMain.append(play, look);
      const videos = new Set(current.replies.flatMap((r) => (r.parent === null && r.at ? [r.at.video] : [])));
      if (videos.size > 1) headMain.append(el('span', 'memo-pane-at-video', at.title ?? tr('動画')));
    }
    // 関連 n（隠れ m）：押すと、このカードの関連の一覧（移る・外す）。m は、絞りで見えていない相手の数
    const relations = relationsOf(current, reply.id);
    if (relations.length > 0) {
      const shown = new Set(visibleTops(current.replies, filterTag, keepShown).map((r) => r.id));
      const hidden = relations.filter((rel) => !shown.has(rel.other)).length;
      const count = el('button', 'memo-pane-link-count', hidden > 0 ? tr('関連 {0}（隠れ {1}）', { 0: relations.length, 1: hidden }) : tr('関連 {0}', { 0: relations.length }));
      count.type = 'button';
      count.title = tr('このカードの関連（移る・外す）');
      count.setAttribute('aria-haspopup', 'menu');
      count.dataset.focusKey = `card:${reply.id}:links`;
      count.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedCard = reply.id;
        scheduleLinks();
        if (e.detail === 0) {
          const rect = count.getBoundingClientRect();
          openRelations(reply.id, rect.left, rect.bottom, true, origin);
        } else {
          openRelations(reply.id, e.clientX, e.clientY, false, origin);
        }
      });
      headMain.append(count);
    }
    if (mapPop) {
      // マップに出したカード：つまみの代わりに「✕ 閉じる」（カードを消す × とは別。出したカードを閉じるだけ）
      const closeBtn = el('button', 'memo-pane-map-card-close', tr('✕ 閉じる'));
      closeBtn.type = 'button';
      closeBtn.title = tr('このカードを閉じる（カードは消えません。Esc・札をもう一度右クリックでも閉じる）');
      closeBtn.dataset.focusKey = `card:${reply.id}:mapclose`;
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        mapPop.close();
      });
      head.append(headMain, closeBtn);
      card.append(head);
    } else {
      // 並べ替えのつまみ（頭の帯の右端。押す・右クリック・Enter で小さな欄、つまみに焦点があるときの Alt+←→ で一つずつ動かす）
      const grip = el('button', 'memo-pane-card-grip', '⠿');
      grip.type = 'button';
      const gripName = tr('「{0}」を並べ替える。一覧のメモの上で離すと移します（Ctrl で写す）', { 0: cardLabel(reply, 16) });
      grip.title = gripName;
      grip.setAttribute('aria-label', gripName);
      grip.setAttribute('aria-haspopup', 'menu');
      grip.dataset.focusKey = `card:${reply.id}:move`;
      if (cardOrder !== 'order') grip.setAttribute('aria-disabled', 'true'); // つながり順・時刻順の間は動かせない（押すと欄で理由を出す）
      grip.addEventListener('click', (e) => {
        if (linking !== null || cardMap.isOpen) return; // 関連づけている間は、カードの並びの捕まえる段が先に受ける
        e.stopPropagation();
        selectedCard = reply.id;
        scheduleLinks();
        const rect = grip.getBoundingClientRect();
        openGripMenu(reply.id, rect.left, rect.bottom, e.detail === 0);
      });
      grip.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // WebView2 の既定の欄は出さない
        if (linking !== null || cardMap.isOpen) return;
        e.stopPropagation();
        selectedCard = reply.id;
        scheduleLinks();
        openGripMenu(reply.id, e.clientX, e.clientY, false);
      });
      cardDrag.attach(grip, reply.id); // ドラッグで並べ替える（O3。押した時点で始めない条件を見る）
      grip.addEventListener('keydown', (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); // WebView2 の「戻る・進む」に取られないように
        e.stopPropagation();
        stepCard(reply.id, e.key === 'ArrowLeft' ? -1 : 1);
      });
      if (pickingCards) {
        const on = picked.has(reply.id);
        const box = el('button', 'memo-pane-card-check', on ? '☑' : '☐');
        box.type = 'button';
        box.title = on ? tr('このカードの選択を外す') : tr('このカードを選ぶ（Shift で範囲、Ctrl で足す・外す）');
        box.setAttribute('aria-pressed', String(on));
        box.setAttribute('aria-label', box.title);
        box.dataset.focusKey = `card:${reply.id}:pick`;
        box.addEventListener('click', (e) => {
          e.stopPropagation();
          togglePicked(reply.id, e.shiftKey);
        });
        head.append(headMain, box, grip);
      } else head.append(headMain, grip);
      card.append(head);
    }
    // カードのタグ（グループ＝タグ。左に足し引きを頼む）
    const tags = tagArea(
      { tags: reply.tags ?? [], what: tr('このカード'), change: (add, remove) => ask({ command: 'changeReplyTags', id: current.id, replyId: reply.id, add, remove }) },
      { editable: true, focusKey: `card:${reply.id}:`, toast: (text) => (status.textContent = text), candidates, pinned: pinnedFeed, onClose: afterTagInput },
    );
    tags.classList.add('memo-pane-card-tags');
    tags.querySelector('.preview-tags')?.append(...quickTags(reply.tags ?? [], (add, remove) => ask({ command: 'changeReplyTags', id: current.id, replyId: reply.id, add, remove }), reply.id));
    card.append(tags);
    appendQuote(card, reply);

    if (cardEdits.has(reply.id)) {
      card.append(cardEditForm(current, reply));
    } else if (reply.text) {
      if (aiKind) {
        card.append(aiCardBody(reply)); // AI のカードは畳まない（280 字の「…続き」も出さない）
      } else {
        const chars = [...reply.text];
        const folded = chars.length > REPLY_FOLD && !openBodies.has(reply.id);
        const bodyText = el('p', 'memo-pane-card-body', folded ? chars.slice(0, REPLY_FOLD).join('') : reply.text);
        card.append(bodyText);
        if (chars.length > REPLY_FOLD) {
          const more = el('button', 'memo-pane-more', openBodies.has(reply.id) ? tr('たたむ ▴') : tr('…続き ▾'));
          more.type = 'button';
          more.addEventListener('click', () => {
            if (openBodies.has(reply.id)) openBodies.delete(reply.id);
            else openBodies.add(reply.id);
            if (view) renderCards(view);
          });
          card.append(more);
        }
      }
    }
    appendImage(card, reply);
    if (reply.file && truncatedFiles.has(reply.file)) card.append(el('p', 'memo-pane-clip', tr('途中までです')));

    const actions = el('div', 'memo-pane-card-actions');
    // あまり使わないもの（書き出す・全体の画像を開く・フォルダで見る・コピー）は「⋯」の小さな欄へ
    const moreEntries: MenuEntry[] = [{ section: `「${cardLabel(reply, 16)}」` }];
    if (reply.image) {
      moreEntries.push({ label: tr('書き出す'), hint: tr('画像をピクチャへ'), run: () => void exportCardImage(reply) });
      moreEntries.push({ label: tr('書き足す…'), hint: tr('新しいカードに足す'), run: () => void beginAnnotate({ kind: 'card', replyId: reply.id }) });
    }
    if (reply.file) {
      const fileName = reply.file;
      moreEntries.push(
        { label: tr('全体の画像を開く'), hint: tr('ピクチャの画像'), run: () => openExported(fileName) },
        { label: tr('フォルダで見る'), hint: tr('ピクチャ'), run: () => revealExported(fileName) },
      );
    }
    const editingCard = cardEdits.has(reply.id);
    const askCard: MenuEntry[] =
      reply.parent === null && BOT_FEATURES
        ? [
            { label: tr('Grok に頼む'), hint: tr('このカードを材料に'), run: () => ask({ command: 'askWithCards', memo: ref.id, replies: [reply.id], linked: 'none' }) },
            { label: tr('つながったカードも頼む'), hint: tr('直接つながるカードは印を外して足す'), run: () => ask({ command: 'askWithCards', memo: ref.id, replies: [reply.id], linked: 'one' }) },
          ]
        : [];
    moreEntries.push(
      { label: tr('コピー'), hint: tr('空いたセルに貼るとメモのセル'), run: () => ask({ command: 'copyComment', ref, replyId: reply.id }) },
      ...askCard,
      { label: tr('別のメモへ移す…'), hint: editingCard ? tr('書き直しの途中') : tr('このカードと返信'), disabled: editingCard, run: () => beginSend('move', [reply.id]) },
      { label: tr('別のメモへ写す…'), hint: editingCard ? tr('書き直しの途中') : tr('元のカードは残る'), disabled: editingCard, run: () => beginSend('copy', [reply.id]) },
      { label: tr('単語カードにする…'), hint: tr('写すだけ'), run: () => makeVocabCard(reply, ref) },
    );
    if (!reply.by && !cardEdits.has(reply.id)) {
      const edit = action(tr('書き直す'), tr('このコメントの文を書き直す（引用と画像は書き直せません）'), () => {
        if (!cardEdits.has(reply.id)) cardEdits.set(reply.id, reply.text);
        if (view) renderCards(view);
        scope.querySelector<HTMLTextAreaElement>(`[data-pane-edit="${CSS.escape(reply.id)}"] textarea`)?.focus();
      });
      actions.append(edit);
    }
    const under = countUnder(current.replies, reply.id);
    const chat = action(under > 0 ? `💬 ${under}` : '💬', under > 0 ? tr('返信 {0}件', { 0: under }) : tr('このコメントに返信を書く'), () => {
      const opened = toggleReplies(ref, reply.id);
      if (opened && current.replies.length < MAX_REPLIES) showReplyForm(ref, reply.id);
      else if (!opened && !replyDraft(ref, reply.id)) hideReplyForm(ref, reply.id);
      if (view) renderCards(view);
      if (opened) scope.querySelector<HTMLTextAreaElement>(`[data-form="${CSS.escape(replyFormKey(ref, reply.id))}"] textarea`)?.focus();
    });
    chat.setAttribute('aria-expanded', String(repliesOpen(ref, reply.id)));
    const ai = action(tr('相棒 ▾'), tr('相棒（今の会話のメンバー）に返信してもらう'), () => {
      toggleCompanion(ref, reply.id);
      if (view) renderCards(view);
    });
    const full = current.replies.length >= MAX_REPLIES;
    chat.disabled = full && under === 0;
    ai.disabled = full;
    if (full) ai.title = tr('返信は1つのメモに {0} 件までです', { 0: MAX_REPLIES });
    const remove = action(armed.has(reply.id) ? tr('消す？') : '×', armed.has(reply.id) ? removeAgain(current.replies, reply.id) : removeTitle(current.replies, reply.id), () => {
      if (!armed.has(reply.id)) {
        armed.add(reply.id);
        if (view) renderCards(view);
        return;
      }
      armed.delete(reply.id);
      ask({ command: 'removeReply', ref, replyId: reply.id });
    });
    remove.classList.add('reply-remove');
    if (armed.has(reply.id)) {
      remove.classList.add('danger');
      armConfirm(remove, () => {
        armed.delete(reply.id);
        if (view) renderCards(view);
      });
    }
    // 🔗 関連づける：押すと、このカードを元にして、相手のカードを押すのを待つ（もう一度押すとやめる）
    const fromHere = linking?.from === reply.id;
    const linkKey = `card:${reply.id}:link`;
    // action() と同じ見た目・属性。キーボードで押したときは、始めると同時に相手の一覧も開く（カードは焦点を持たないため）
    const linkTitle = tr('このカードと、ほかのカードを関連でつなぐ（相手のカードを押して、種類を選ぶ）');
    const link = el('button', 'thread-action memo-pane-card-link', '🔗');
    link.type = 'button';
    link.title = fromHere ? tr('関連づけをやめる（もう一度押す・Esc）') : linkTitle;
    link.setAttribute('aria-label', fromHere ? tr('関連づけをやめる') : linkTitle);
    link.dataset.focusKey = linkKey;
    link.setAttribute('aria-pressed', String(fromHere));
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      if (linking?.from === reply.id) {
        endLinking(true);
        return;
      }
      const keyboard = e.detail === 0;
      startLinking(reply.id, linkKey);
      if (keyboard) openLinkPicker();
    });
    if (inMap) {
      // マップの中では関連づけられない（相手のカードは並びで押すため）
      link.disabled = true;
      link.title = tr('マップの中では関連づけられません（並びに戻ってから 🔗）');
      link.setAttribute('aria-label', link.title);
    }
    const more = el('button', 'thread-action memo-pane-card-more', '⋯');
    more.type = 'button';
    const moreTitle = reply.image || reply.file ? tr('その他（コピー・別のメモへ移す・画像の書き出しなど）') : tr('その他（コピー・別のメモへ移す）');
    more.title = moreTitle;
    more.setAttribute('aria-label', moreTitle);
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.dataset.focusKey = `card:${reply.id}:more`;
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      if (linking !== null || (cardMap.isOpen && !inMap)) return; // 関連づけている間は、カードの並びの捕まえる段が先に受ける（マップに出したカードの ⋯ は使える）
      const rect = more.getBoundingClientRect();
      more.focus({ preventScroll: true }); // 閉じたらここへ焦点を戻す（CellMenu は開いた時の焦点を覚える）
      moreMenu.open(rect.left, rect.bottom + 2, mapPop ? [...moreEntries, ...popSideEntries(mapPop)] : moreEntries);
      if (e.detail === 0) moreMenu.focusFirst();
    });
    remove.classList.add('memo-pane-card-remove');
    actions.append(chat, ai, link, more, remove);
    card.append(actions, cardThread(ref, current.replies, reply.id, threadUi));
    return card;
  }

  // 単語カードにする（K6c-2）：このカードを指す単語カードを、入れる小窓で直してから左に頼む（台帳は左。見るのは右の単語帳。写すだけ。元のカードは変えない）
  //   表は、画面で選んでいる文（無ければカードの本文の頭 80 字）。画像は、カードに画像があれば指す
  function makeVocabCard(reply: Reply, ref: { kind: 'memo'; id: string }) {
    const oneLine = (text: string, max: number) => [...text.replace(/\s+/g, ' ').trim()].slice(0, max).join('');
    const picked = oneLine(window.getSelection()?.toString() ?? '', 400);
    moreMenu.confirmVocab(
      {
        kind: 'word',
        front: picked || oneLine(reply.text, 80),
        back: '',
        example: '',
        note: tr('右の単語帳に入ります。カードはこのメモを指します（写すだけ。元のカードは変わりません）'),
        rotate: savedMarkNew(),
      },
      (value) => {
        ask({
          command: 'addCards',
          cards: [{ ...value, links: [{ kind: 'memo', id: ref.id, role: 'source' }], ...(reply.image ? { image: { kind: 'shot', id: reply.image } } : {}) }],
        });
        say(tr('単語帳に入れました（元のカードはそのまま残ります）'));
      },
    );
  }

  // マップに出したカードの ⋯：札のどちら側に出すか（今の側は ✓ を付けて押せない）
  function popSideEntries(control: PopControl): MenuEntry[] {
    const names: [MapSide, string][] = [
      ['right', tr('右に出す')],
      ['left', tr('左に出す')],
      ['top', tr('上に出す')],
      ['bottom', tr('下に出す')],
    ];
    const now = control.side();
    return [
      { section: tr('札のどちら側に出すか') },
      ...names.map(([side, label]): MenuEntry => (side === now ? { label: `✓ ${label}`, hint: tr('今の側'), disabled: true } : { label, run: () => control.setSide(side) })),
    ];
  }

  function cardEditForm(current: MemoPaneView, reply: Reply) {
    const form = el('form', 'reply-form');
    form.dataset.paneEdit = reply.id;
    const text = el('textarea', 'reply-input');
    text.rows = 3;
    text.value = cardEdits.get(reply.id) ?? reply.text;
    text.setAttribute('aria-label', 'コメントを書き直す');
    if (reply.quote?.text) text.placeholder = tr('この引用について書く');
    const row = el('div', 'reply-form-row');
    const count = el('span', 'reply-meter', '');
    const paintCount = () => {
      const n = [...text.value].length;
      count.textContent = `${n} / ${REPLY_FOLD}`;
      count.classList.toggle('long', n > REPLY_FOLD);
      count.title = n > REPLY_FOLD ? tr('長め：カードでは 280字まで見せて、続きは開きます') : '';
    };
    paintCount();
    const closeEdit = () => {
      cardEdits.delete(reply.id);
      text.blur();
      if (view) renderCards(view);
    };
    const save = () => {
      const clean = [...text.value].slice(0, MAX_REPLY_TEXT).join('').trim();
      if (!clean && !reply.quote && !reply.image) {
        text.focus();
        return;
      }
      cardEdits.delete(reply.id);
      text.blur(); // 欄にいたままだと、描き直しが書きかけとして残してしまう
      ask({ command: 'editReply', ref: refOf(current.id), replyId: reply.id, text: text.value });
      if (view) renderCards(view);
    };
    text.addEventListener('input', () => {
      if ([...text.value].length > MAX_REPLY_TEXT) text.value = [...text.value].slice(0, MAX_REPLY_TEXT).join('');
      cardEdits.set(reply.id, text.value);
      paintCount();
    });
    text.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
        e.preventDefault();
        save();
      }
      if (e.key === 'Escape' && !e.isComposing) {
        e.preventDefault();
        closeEdit();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      save();
    });
    const saveBtn = el('button', 'preview-button', tr('残す'));
    saveBtn.type = 'submit';
    const cancel = el('button', 'preview-button', tr('やめる'));
    cancel.type = 'button';
    cancel.addEventListener('click', closeEdit);
    row.append(count, saveBtn, cancel);
    form.append(text, row);
    return form;
  }

  // 新しく届いた一番上のカードの id（メモが替わったときは空）
  function freshCard(id: string, replies: readonly Reply[]): string[] {
    const tops = replies.filter((r) => r.parent === null).map((r) => r.id);
    if (knownMemo !== id) {
      knownMemo = id;
      known.clear();
      for (const top of tops) known.add(top);
      return [];
    }
    const added = tops.filter((top) => !known.has(top));
    known.clear();
    for (const top of tops) known.add(top);
    return added;
  }

  // ボードが見るメモの写しを受ける（null：選びが外れた・メモが消えた＝ボードは下の区画のメモに戻る）。下の区画の view には触らない
  function paintBoardMemo(next: MemoPaneView | null) {
    boardMemoView = next;
    boardListeners.forEach((fn) => fn()); // ボードは refresh で、メモが替わったか（別のメモとして読み直すか）を見る
  }

  function paint(next: MemoPaneView | null) {
    const previous = view?.id ?? null;
    const nextId = next?.id ?? null;
    if (previous && previous !== nextId) flush(previous);
    const switched = previous !== nextId;
    view = next;
    applyCurrentLinkNames(); // 試し：セットを選んでいればその名前、選んでいなければこのメモの名前
    boardListeners.forEach((fn) => fn());
    const open = next !== null;
    band.hidden = !open;
    status.hidden = !open;
    countline.hidden = !open;
    main.hidden = !open;
    if (!open || switched) closeListWindow(false); // 区画を閉じた・メモが替わったら、一覧の窓も閉じる
    scroll.hidden = !open;
    empty.hidden = open;
    if (open) renderList();
    if (!next) {
      faceAnnotate = null;
      if (annotate.isOpen) annotate.cancel();
      else annotateLayer.hidden = true;
      listPops.closeAll(); // 区画を閉じたら、並びに出したカードも閉じる
      cardMap.close(); // 閉じたら、マップの窓も閉じて、位置と止めを捨てる
      cardMap.forget();
      linking = null; // 閉じたら、関連づけもやめる
      linkBar.hidden = true;
      linkMenu.close();
      relMenu.close();
      moreMenu.close();
      tagMenu.close();
      closeLinkPicker(false);
      linkLayer.clear(); // 線も消す（次に開いたら描き直す）
      linkShape = '';
      cardDrag.cancel(); // つまんでいたらやめる
      clearPending(); // 頼んだ並べ替えの待ちも捨てる
      pickingCards = false;
      picked.clear();
      pickAnchor = null;
      pickBar.hidden = true;
      closeTplDialog(false);
      closeTplMenu();
      closeTplPalette(false);
      closeTplFill(false);
      closeTplImport(false);
      closeTplAsk(false);
      hideSentNotice();
      body.value = '';
      lastSent = '';
      cards.replaceChildren();
      reportDraft(); // 閉じたら書きかけは無い
      grokCardsUi.sync(false);
      return;
    }
    const focus = switched ? null : holdFields();
    if (switched) {
      if (annotate.isOpen) annotate.cancel();
      listPops.closeAll(); // メモが替わったら、並びに出したカードも閉じる
      cardMap.close(); // メモが替わったら、マップの窓は閉じて、位置と止めを捨てる
      cardMap.forget();
      linking = null; // メモが替わったら、関連づけは続けない
      linkBar.hidden = true;
      linkMenu.close();
      relMenu.close();
      moreMenu.close();
      tagMenu.close();
      closeLinkPicker(false);
      lineMode = 'all'; // 線の見せ方は覚えない
      cardOrder = 'order'; // 並べ方も覚えない
      if (glowing) dropGlow(); // 前のメモのカードの「マスで見る」の光りは消す（V2b）
      clearPending(); // 前のメモに頼んだ並べ替えの待ちは捨てる
      selectedCard = null;
      autoSelected = false;
      keepAll = false;
      void pinnedFeed.reload(); // 区画を開いた・メモが替わった（「＋タグ」を押したときにも読み直す）
      void tagBook.reload();
      cardEdits.clear();
      openBodies.clear();
      openQuotes.clear();
      armed.clear();
      filterTag = null;
      keepShown.clear();
      pickingCards = false;
      picked.clear();
      pickAnchor = null;
      pickBar.hidden = true;
      closeTplDialog(false);
      closeTplPalette(false);
      closeTplFill(false);
      closeTplImport(false);
      closeTplAsk(false);
      cardsDirty = false;
      armEdit = false;
      commentDraft = '';
      comment.value = '';
      paintMeter();
    }
    const head = memoTitle(next) || tr('（空のメモ）');
    title.textContent = tr('メモ：{0}', { 0: head });
    sheet.hidden = !next.sheetName;
    sheet.textContent = next.sheetName ?? '';
    page.textContent = next.page.title ? tr('上：{0}', { 0: next.page.title }) : tr('上：ページがありません');
    if (next.by) {
      const fromBot = next.by.who === 'bot';
      by.hidden = false;
      by.textContent = fromBot ? tr('ボット（{0}）から届いた{1}', { 0: next.by.name, 1: next.label ?? '返事' }) : tr('{0}・{1}', { 0: next.label ?? '考察', 1: next.by.name });
    } else {
      by.hidden = true;
      by.textContent = '';
    }
    if (switched || !editing()) {
      if (body.value !== next.text) body.value = next.text;
      lastSent = next.text;
      fit();
    }
    if (!switched && document.activeElement !== comment && comment.value !== commentDraft) comment.value = commentDraft;
    const tagging = document.activeElement instanceof HTMLInputElement && meta.contains(document.activeElement);
    if (!tagging) fillMeta(next);
    showCount(next.replies);
    paintMeter();
    const fresh = freshCard(next.id, next.replies);
    const added = fresh.at(-1) ?? null;
    // 絞り中に届いたカード（ここで足したもの・外から足されたもの）には、選んでいるタグを付ける。届くまでは見せておく
    if (!switched && filterTag !== null) {
      for (const id of fresh) {
        const card = next.replies.find((r) => r.id === id);
        if (!card || (card.tags ?? []).includes(filterTag)) continue;
        keepShown.add(id);
        ask({ command: 'changeReplyTags', id: next.id, replyId: id, add: [filterTag], remove: [] });
      }
    }
    for (const id of [...keepShown]) {
      const card = next.replies.find((r) => r.id === id);
      if (!card || (filterTag !== null && (card.tags ?? []).includes(filterTag))) keepShown.delete(id);
    }
    let jump: string | null = null;
    if (added && armEdit) {
      const reply = next.replies.find((r) => r.id === added);
      if (reply && !reply.by && (reply.quote || reply.image)) {
        cardEdits.set(added, '');
        armEdit = false;
        window.clearTimeout(armTimer);
        jump = added;
        if (cardMap.isOpen) closeMap(false); // 書き直しの欄を開く道は、先にマップを閉じる
      }
    }
    // 写しが追いついた並べ替えの待ちを捨てる（写しが満たしている、いちばん後ろの待ちまで）
    if (!switched && pendingOrder.length > 0) {
      pendingOrder.splice(0, settledCount(next.replies, pendingOrder));
      schedulePendingDrop();
    }
    // 右の検索から：このカードへ移る（n が変わったときだけ）
    const focusTo = next.focusReply && next.focusReply.n !== focusN ? next.focusReply : null;
    renderCards(next, jump ? null : focus, switched);
    if (added) cards.querySelector(`[data-card="${CSS.escape(added)}"]`)?.scrollIntoView({ block: 'nearest' });
    if (jump) cards.querySelector<HTMLTextAreaElement>(`[data-pane-edit="${CSS.escape(jump)}"] textarea`)?.focus();
    else if (switched && !focusTo) {
      wantFocus = true;
      body.focus();
    }
    if (focusTo) {
      focusN = focusTo.n;
      wantFocus = false; // 下の面に入ったときに本文へ戻って、移ったカードが見えなくならないように
      jumpToReply(next, focusTo.id);
    }
    reportDraft();
    grokCardsUi.sync(true);
    if (annotateShot && next.replies.some((reply) => reply.image === annotateShot)) annotateShot = null;
    takeFaceAnnotate();
  }

  // nextRow：Shift+Enter で足すとき true（「次の行に」がオフでも、この 1 枚だけ次の行へ。押せないときは、ふつうの次の番地）
  function submitComment(nextRow = false) {
    if (!view) return;
    const text = [...comment.value].slice(0, MAX_REPLY_TEXT).join('');
    if (!text.trim() || view.replies.length >= MAX_REPLIES) {
      comment.focus();
      return;
    }
    const id = view.id;
    // 読む画面の今のマスと結ぶ（V2b・D24）：書き始めたときのマス（印を付けたのが書いたあとなら、そのときのマス）
    const now = atCheck.checked ? (atPin ?? readerNow) : null;
    const at: ReplyAt | undefined = now ? { video: now.video, ...(now.title ? { title: now.title } : {}), spans: [{ key: now.key, start: now.start, end: now.end }] } : undefined;
    // 「次の行に」は一番上のカードだけ。押せないとき（升目でない・並べ替えできない）は、ふつうの次の番地
    const useNext = (nextRow || nextRowCheck.checked) && !nextRowCheck.disabled;
    const plan = useNext ? nextRowAddPlan(orderedReplies(view)) : null;
    commentDraft = '';
    comment.value = '';
    atPin = null;
    paintMeter();
    paintAtOption();
    ask({ command: 'addMemoComment', id, text, ...(at ? { at } : {}), ...(useNext ? { nextRow: true } : {}) });
    if (plan) say(addedCardPlaceText(plan.slot, plan.nextRow));
    reportDraft();
  }

  // ---------- 六角で見る：読む画面との落ちてもよい連絡（plan-reader-video の V2b。D16） ----------
  // 読む画面の今のマス（readerNow）：そのマスと結んだカードを光らせ、「＋コメント」の結ぶ欄を出し直す。読む画面が閉じたら「マスで見る」も外す
  function onReaderNow(now: ReaderNow | null) {
    const videoBefore = readerNow?.video ?? null;
    readerNow = now;
    if (!now) glowing = null; // 読む画面を閉じると、読む画面の光りも消える
    paintReaderNow();
    paintAtOption();
    if (cardOrder === 'time' && view && (now?.video ?? null) !== videoBefore) renderCards(view); // 先に出す動画が替わった
  }

  // 今のマスと結んだカードに印（描き直さずに付け外し）。「マスで見る」の押した印もここで当て直す
  function paintReaderNow() {
    const ids = new Set(readerNow?.replyIds ?? []);
    for (const node of cards.querySelectorAll<HTMLElement>('[data-card]')) node.classList.toggle('reader-now', ids.has(node.dataset.card ?? ''));
    for (const button of cards.querySelectorAll<HTMLElement>('[data-glow-card]')) {
      button.setAttribute('aria-pressed', String(!!glowing && glowing.memoId === view?.id && glowing.replyId === button.dataset.glowCard));
    }
  }

  // 「マスで見る」の光りを消す（読む画面へ直に。読む画面が無ければ落ちるが、光りも無い）
  function dropGlow() {
    const was = glowing;
    glowing = null;
    if (was) send({ type: 'relay', to: 'reader', payload: { kind: 'readerGlow', memoId: was.memoId, replyId: null } });
  }

  // 「＋コメント」の「▶ m:ss と結ぶ」（D24）：読む画面が動画を開いているとき（か、結ぶマスを固定しているとき）だけ出す。
  //   読む画面が閉じて固定も無ければ、印を外す（既定はオフ。覚えない）
  function paintAtOption() {
    const now = atPin ?? readerNow;
    atLabel.hidden = !now;
    if (!now) {
      atCheck.checked = false;
      atText.textContent = '';
      return;
    }
    atText.textContent = tr('▶ {0} と結ぶ', { 0: secLabel(now.start) });
    atLabel.title = atPin
      ? tr('書き始めたときの読む画面のマス（{0}）と結んだカードにします', { 0: secLabel(atPin.start) })
      : tr('読む画面の今のマスと結んだカードにします（書き始めたときのマスに固定します）');
  }

  // 結ぶマスを固定する・外す：印があり、欄に字があれば、そのときの今のマスに固定する。欄が空になったか印を外したら外す
  function pinAt() {
    if (!atCheck.checked || comment.value.trim() === '') atPin = null;
    else if (atPin === null) atPin = readerNow;
    paintAtOption();
  }

  // 高さが変わったときに知らせる先（「ボード」タブの［拡大］［縮小］の見た目）。つまみ・左からの知らせ・［拡大］のどれでも呼ぶ
  const heightListeners: Array<() => void> = [];
  const notifyHeight = () => heightListeners.forEach((fn) => fn());
  const boardListeners: Array<() => void> = []; // 開いているメモの写しが替わったときに知らせる先（「ボード」）
  const boardNoticeListeners: Array<(text: string) => void> = []; // 左の知らせ（断られた理由など）を受ける先（「ボード」）
  const boardUndoSendListeners: Array<(token: string, openMemo: string) => void> = []; // 型の貼り付けの「元に戻す」の印を受ける先（「ボード」。B3-3b）

  function sendHeight(next: number) {
    height = clampMemoPaneHeight(next);
    handle.setAttribute('aria-valuenow', String(height));
    send({ type: 'setSidebar', side: 'memo', height });
    notifyHeight();
  }

  function endDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (pendingHeight !== null) {
      sendHeight(pendingHeight);
      pendingHeight = null;
    }
    writeMemoPanePrefs({ height });
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // 上へ引くとマウスはページの面に出る。つかんでいる間は、この面に届き続ける（計画 4.3）
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // 捕まえられないときも、この面に届いた移動は高さを変える
    }
    drag = { pointerId: e.pointerId, startY: e.screenY, startHeight: height };
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    pendingHeight = clampMemoPaneHeight(drag.startHeight + (drag.startY - e.screenY));
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (pendingHeight === null) return;
      sendHeight(pendingHeight);
      pendingHeight = null;
    });
  });
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    sendHeight(height + (e.key === 'ArrowUp' ? 20 : -20));
    writeMemoPanePrefs({ height });
  });
  handle.setAttribute('aria-valuemin', '120');
  handle.setAttribute('aria-valuemax', '1600');
  handle.setAttribute('aria-valuenow', String(height));

  // 中の欄（コメント・書き直し・返信）の入力。それぞれの欄の受け口が先に走ってから、ここへ届く
  root.addEventListener('input', () => reportDraft());
  body.addEventListener('input', () => {
    typedAt = Date.now();
    if ([...body.value].length > MAX_MEMO_TEXT) body.value = [...body.value].slice(0, MAX_MEMO_TEXT).join('');
    fit();
    scheduleSave();
  });
  body.addEventListener('blur', () => flush());
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    body.blur();
  });
  comment.addEventListener('input', () => {
    if ([...comment.value].length > MAX_REPLY_TEXT) comment.value = [...comment.value].slice(0, MAX_REPLY_TEXT).join('');
    commentDraft = comment.value;
    paintMeter();
    pinAt();
  });
  atCheck.addEventListener('change', () => pinAt());
  comment.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      submitComment();
    } else if (e.key === 'Enter' && e.shiftKey && !e.altKey && !e.isComposing) {
      // Shift+Enter：次の行の 1 列目に足す（改行は Enter だけで）
      e.preventDefault();
      submitComment(true);
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing && comment.value === '') {
      // 書く欄が空のときだけ：↑↓でカードの区画を上下に流す（書いてあるときは、今までどおり欄の中でカーソルが動く）
      e.preventDefault();
      scroll.scrollBy({ top: e.key === 'ArrowUp' ? -ARROW_SCROLL_STEP : ARROW_SCROLL_STEP });
    }
    if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      comment.blur();
    }
  });
  compose.addEventListener('submit', (e) => {
    e.preventDefault();
    submitComment();
  });
  quoteBtn.addEventListener('click', () => void quoteSelection());
  shotBtn.addEventListener('click', () => void captureVisible());
  pageBtn.addEventListener('click', () => void captureWhole());
  pickBtn.addEventListener('click', () => fileInput.click());
  copyBtn.addEventListener('click', () => void copyMarkdown());
  newBtn.addEventListener('click', () => ask({ command: 'newMemoForPane' }));
  tplPasteBtn.addEventListener('click', () => {
    if (tplMenu.hidden) void openTplMenu();
    else closeTplMenu();
  });
  menuBtn.addEventListener('click', () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  });
  listItem.addEventListener('click', () => {
    closeMenu();
    openListWindow();
  });
  title.addEventListener('click', () => {
    if (listWindow.hidden) openListWindow();
    else closeListWindow(true);
  });
  listWindow.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeListWindow(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (moveListFocus(e.key === 'ArrowDown')) e.preventDefault();
  });
  // 型の窓：絞る欄に打つと絞る。↑↓・Home・End で選び（選ぶとゴースト）、Enter で貼り、Esc で閉じる（窓の中の Esc は、ここで受ける）
  tplPalRestore.addEventListener('click', () => restoreSamples());
  tplPalExport.addEventListener('click', () => void exportTemplates(null));
  tplPalImport.addEventListener('click', () => void openTemplateImport());
  tplPalAsk.addEventListener('click', () => void openTplAsk());
  tplAskCopy.addEventListener('click', () => void copyTplAsk());
  tplAskCancel.addEventListener('click', () => closeTplAsk(true));
  tplAskPurpose.addEventListener('input', () => refreshTplAsk());
  tplAskPurpose.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      void copyTplAsk();
    }
  });
  tplAskNamesChk.addEventListener('change', () => refreshTplAsk());
  tplAskMatChk.addEventListener('change', () => refreshTplAsk());
  tplImportOk.addEventListener('click', () => void submitTplImport());
  tplImportCancel.addEventListener('click', () => closeTplImport(true));
  tplPalFilter.addEventListener('input', () => {
    palQuery = tplPalFilter.value;
    renderPalette();
    selectTemplate(palSel, true);
  });
  tplPalette.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeTplPalette(true);
      return;
    }
    const inInput = e.target === tplPalFilter;
    if (isPaletteKey(e.key) && (inInput || e.target === tplPalette || (e.target instanceof HTMLElement && e.target.getAttribute('role') === 'option'))) {
      if ((e.key === 'Home' || e.key === 'End') && inInput && !e.ctrlKey) return; // 欄の中の Home・End は、字の位置を動かす（Ctrl＋で一覧）
      e.preventDefault();
      const next = moveSelection(
        paletteOrderNow().map((t) => t.id),
        palSel,
        e.key,
      );
      selectTemplate(next, true);
      return;
    }
    if (e.key === 'Enter' && (inInput || (e.target instanceof HTMLElement && e.target.getAttribute('role') === 'option'))) {
      e.preventDefault();
      const t = palSel === null ? null : (palAll.find((x) => x.id === palSel) ?? null);
      if (t) pasteFromPalette(t);
    }
  });
  // `/` で型の窓を開く（文字を打っている欄・Grok Cards の中・選ぶ／関連づけの最中は開かない）
  window.addEventListener('keydown', (e) => {
    if (annotate.isOpen) return;
    if (e.key !== '/' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('.grok-cards-upper'))) return;
    if (!view || !tplPalette.hidden || pickingCards || linking !== null || !tplDialog.hidden || !tplFill.hidden || !tplImport.hidden || !tplAsk.hidden) return;
    e.preventDefault();
    void openTplPalette();
  });
  tplFillPaste.addEventListener('click', () => submitTplFill());
  tplFillLoad.addEventListener('click', () => void loadFillIntoDialog());
  tplFillCancel.addEventListener('click', () => closeTplFill(true));
  // 型にする小窓：登録・やめる・Enter で登録・Esc で閉じる（小窓の中の Esc は、ここで受ける）
  tplSave.addEventListener('click', () => void saveTplDialog());
  tplCancel.addEventListener('click', () => closeTplDialog(true));
  tplName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      void saveTplDialog();
    }
  });
  linkItem.addEventListener('click', () => {
    closeMenu();
    addPageLink();
  });
  filter.addEventListener('input', () => {
    armedItem = null; // 字を書いたら、書きかけの印は外す
    listQuery = filter.value;
    renderList();
  });
  document.addEventListener('pointerdown', (e) => {
    if (tplPalette.hidden) return;
    if (e.target instanceof Node && (tplPalette.contains(e.target) || tplPasteWrap.contains(e.target) || tplImport.contains(e.target) || tplAsk.contains(e.target))) return;
    closeTplPalette(false);
  });
  document.addEventListener('pointerdown', (e) => {
    if (tplMenu.hidden) return;
    if (e.target instanceof Node && tplPasteWrap.contains(e.target)) return;
    closeTplMenu();
  });
  document.addEventListener('pointerdown', (e) => {
    if (menu.hidden) return;
    if (e.target instanceof Node && menuWrap.contains(e.target)) return;
    closeMenu();
  });
  document.addEventListener('pointerdown', (e) => {
    if (listWindow.hidden) return;
    if (e.target instanceof Node && (listWindow.contains(e.target) || title.contains(e.target))) return;
    closeListWindow(false);
  });
  // 相手の一覧の窓：窓と帯の外を押したら閉じる（帯の中は、帯のボタンが決める）
  document.addEventListener('pointerdown', (e) => {
    if (linkPicker.hidden) return;
    if (e.target instanceof Node && (linkPicker.contains(e.target) || linkBar.contains(e.target))) return;
    closeLinkPicker(false);
  });
  // 並びの大きさが変わったら（幅で列の数が替わる・画像の読み込みで行の高さが替わる）、線を描き直す
  new ResizeObserver(() => {
    scheduleLinks();
    listPops.place();
  }).observe(cardsWrap);
  scroll.addEventListener('scroll', () => listPops.place(), { passive: true }); // 並びを送ったら、出したカードも元について行く
  window.addEventListener('resize', () => {
    if (!listWindow.hidden) placeListWindow();
    if (!linkBar.hidden) placeLinkBar();
    if (!linkPicker.hidden) placeLinkPicker();
    if (!tplDialog.hidden) placeTplDialog();
    if (!tplPalette.hidden) placeTplPalette();
    if (!tplFill.hidden) placeTplFill();
    if (!tplImport.hidden) placeTplImport();
    if (!tplAsk.hidden) placeTplAsk();
    listPops.place();
  });
  // 関連づけている間：相手のカードを押したら、種類の小さな欄を出す（元のカードとカードの外は、ふつうに動く）
  cards.addEventListener(
    'click',
    (e) => {
      if (linking === null || !view) return;
      const from = linking.from;
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-card]') : null;
      const to = target?.dataset.card;
      if (!to || to === from) return;
      e.preventDefault();
      e.stopPropagation();
      openKindMenu(from, to, e.clientX, e.clientY, e.detail === 0);
    },
    true,
  );
  // 選んだカード：押した・焦点の入ったカードを、「選んだカード」の線に使う（関連づけている間は替えない。乗せただけでは替えない）
  const chooseSelectedCard = (e: Event) => {
    if (linking !== null) return;
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-card]') : null;
    const id = target?.dataset.card;
    if (!id || id === selectedCard) return;
    selectedCard = id;
    scheduleLinks();
  };
  cards.addEventListener(
    'click',
    (e) => {
      if (!pickingCards || linking !== null) return;
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('button, a, input, textarea, select, label')) return;
      const id = e.target.closest<HTMLElement>('[data-card]')?.dataset.card;
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      togglePicked(id, e.shiftKey);
    },
    true,
  );
  cards.addEventListener('click', chooseSelectedCard);
  cards.addEventListener('focusin', chooseSelectedCard);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void addImageFile(file);
  });
  lightClose.addEventListener('click', closeLight);
  lightImg.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (lightReply) openImageMenu(e.clientX, e.clientY, lightReply);
  });
  light.addEventListener('click', (e) => {
    if (e.target === light) closeLight();
  });
  root.addEventListener('dragover', (e) => {
    if (!view || !e.dataTransfer) return;
    if ([...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  root.addEventListener('drop', (e) => {
    if (!view) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    const file = files.find((item) => item.type.startsWith('image/'));
    if (!file) {
      // Grok の提案・取り込みファイル（.json）：文を左に渡して、一覧を出してもらう（当てるのは左。1 MB まで：import-limits.ts）
      const json = files.find((item) => /\.json$/i.test(item.name) || item.type === 'application/json');
      if (!json) return;
      e.preventDefault();
      if (json.size > IMPORT_FILE_BYTES) {
        status.textContent = tr('ファイルが大きすぎます（{0} まで）', { 0: IMPORT_FILE_LABEL });
        return;
      }
      void json.text().then(
        (text) => ask({ command: 'grokPatchText', text, name: json.name.slice(0, 120) }),
        () => (status.textContent = tr('ファイルを読めませんでした')),
      );
      return;
    }
    e.preventDefault();
    void addImageFile(file);
  });
  window.addEventListener('paste', (e) => {
    if (!view) return;
    const data = e.clipboardData;
    const file = data ? pastedImage(data) : null;
    if (!file) return;
    const inField = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
    if (inField && data?.getData('text/plain')) return;
    e.preventDefault();
    void addImageFile(file);
  });
  const grokCardsUi = mountGrokCards({
    bandRow,
    title,
    main,
    band,
    tools,
    scroll,
    countline,
    status,
    empty,
    sheet,
    page,
    ask,
    closeLists: () => closeListWindow(false),
    pane: root,
    setCardsUpper,
    // つまみと同じ道（sendHeight → setSidebar、writeMemoPanePrefs）で高さを変える。保存されるので、開き直しても保たれる
    // いま開いているメモのカードの写し（読むだけ。ボードに描く）
    boardSource: {
      get: () => boardSnapshot(boardMemoView, view), // 選んだメモがあればそれ、無ければ下の区画のメモ（今までどおり）
      onChange: (fn) => void boardListeners.push(fn),
      info: () => boardMemoInfo(boardMemoView, view), // 名札の元（M3）
      linkNames: () => resolvedLinkKindNames(boardMemoView ?? view, linkNameSets.book), // 見ているメモの関連の呼び名（M4。別のメモを見ているときだけボードが一時的に使う）
    },
    // ボードの見るメモの選び口（M3）。一覧は下の面がすでに持っているもの（sheetItems・recentItems）。選ぶと左へ setBoardMemo（null＝下の区画と同じに戻す）
    boardPick: {
      list: () => ({ items: sheetItems, recent: recentItems, sheetName: listSheetName }),
      pick: (id) => ask({ command: 'setBoardMemo', id }),
    },
    // ボードが送る命令（編集・貼り付けなど）。型の貼り付け（sendReplies）を送った時刻を覚える（そのあとの「元に戻す」の帯を、下の区画に出さないかの判断に使う）
    boardAsk: (action) => {
      if (action.command === 'sendReplies') boardSentAt = Date.now();
      ask(action);
    },
    boardNotices: { onNotice: (fn) => void boardNoticeListeners.push(fn), onUndoSend: (fn) => void boardUndoSendListeners.push(fn) },
    boardTemplate: {
      open: (ids, offsets, anchor) => openTplDialog({ ids, offsets, anchor }),
      close: () => {
        if (tplFromBoard) closeTplDialog(false);
        if (fillFromBoard) closeTplFill(false);
      },
      list: () => loadTemplates(templateIo).catch(() => null),
      fill: (t, anchor, done) => {
        closeTplDialog(false);
        openTplFill(t, undefined, { anchor, done });
      },
      onDone: (fn) => void tplDoneListeners.push(fn),
    },
    paneHeight: {
      get: () => height,
      set: (next) => {
        sendHeight(next);
        writeMemoPanePrefs({ height });
      },
      onChange: (fn) => void heightListeners.push(fn),
    },
  });
  close.addEventListener('click', () => {
    flush();
    grokCardsUi.dismiss();
    ask({ command: 'memoPaneClose' });
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.isComposing || light.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      closeLight();
    },
    true,
  );
  // Esc の捕まえる段（型の窓の行をつまんでいるとき）：ドラッグをやめる（貼らない。窓は閉じない）
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.isComposing || !palGrab?.active) return;
      e.preventDefault();
      e.stopPropagation();
      palGrab.cancel();
    },
    true,
  );
  // Esc の捕まえる段（大きく見た画像の次）：つまみを押している・ドラッグ中ならやめる（元の位置のまま。押しただけの間も区画は閉じない）
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.isComposing || !cardDrag.active) return;
      e.preventDefault();
      e.stopPropagation();
      const moving = cardDrag.moving;
      cardDrag.cancel();
      if (!moving) say(tr('やめました（元の位置のまま）')); // つまんでいたときは onCancel が出す
    },
    true,
  );
  // Esc の捕まえる段（先に走る）：小さな欄・画像の右クリックの欄を閉じ、次に関連づけをやめる。区画は閉じない
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (annotate.isOpen) return; // 書き足しの面が自分で受ける（2 回目で捨てる）。区画は閉じない
      if (!light.hidden || !listWindow.hidden || !linkPicker.hidden) return; // 大きく見た画像・一覧の窓・相手の一覧の窓は、それぞれの受け口
      if (linkMenu.isOpen || relMenu.isOpen || imageMenu.isOpen || moreMenu.isOpen || tagMenu.isOpen) {
        e.preventDefault();
        e.stopPropagation();
        linkMenu.close();
        relMenu.close();
        imageMenu.close();
        moreMenu.close();
        tagMenu.close();
        return;
      }
      if (cardMap.isOpen) {
        const t = e.target;
        // マップに出したカードの書く欄は、その欄の受け口（書き直しをやめる など）
        if ((t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && (cardMap.el.contains(t) || floats.contains(t))) return;
        e.preventDefault();
        e.stopPropagation();
        if (cardMap.closeLastPop()) return; // 出したカードがあれば、最後に出したものから閉じる
        closeMap(true); // マップは閉じて、件数の行の「マップ」へ（区画は閉じない）
        return;
      }
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return; // 書いている欄は、その欄の受け口
      if (listPops.size > 0) {
        // 並びに出したカードは、最後に出したものから閉じる（そのあと、ふつうの Esc）
        e.preventDefault();
        e.stopPropagation();
        listPops.closeLast();
        return;
      }
      if (linking !== null) {
        e.preventDefault();
        e.stopPropagation();
        endLinking(true);
      }
    },
    true,
  );
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    if (annotate.isOpen) {
      e.preventDefault();
      if (!(e.target instanceof Node) || !annotate.element.contains(e.target)) annotate.element.focus();
      return;
    }
    if (tplFromBoard && !tplDialog.hidden) {
      // ボードから開いた型の小窓：Esc はこの小窓だけを閉じる（ボードの選びは外さない）
      e.preventDefault();
      closeTplDialog(true);
      return;
    }
    if (fillFromBoard && !tplFill.hidden) {
      // ボードから開いた空欄の小窓：Esc はこの小窓だけを閉じる（貼らない。ボードの選びは外さない）
      e.preventDefault();
      closeTplFill(false);
      return;
    }
    if (grokCardsUi.consumeEsc(e)) return;
    if (!view) return;
    if (!tplAsk.hidden) {
      e.preventDefault();
      closeTplAsk(true);
      return;
    }
    if (!tplImport.hidden) {
      e.preventDefault();
      closeTplImport(true);
      return;
    }
    if (!tplFill.hidden) {
      e.preventDefault();
      closeTplFill(true);
      return;
    }
    if (!tplDialog.hidden) {
      e.preventDefault();
      closeTplDialog(true);
      return;
    }
    if (!tplPalette.hidden) {
      e.preventDefault();
      closeTplPalette(true);
      return;
    }
    if (!listWindow.hidden) {
      e.preventDefault();
      closeListWindow(true);
      return;
    }
    if (pickingCards) {
      e.preventDefault();
      stopPicking();
      return;
    }
    if (!linkPicker.hidden) {
      // 相手の一覧の窓が開いていて、焦点が窓の外にあるとき（窓の中の Esc は窓の受け口が止める）。区画は閉じない
      e.preventDefault();
      closeLinkPicker(true);
      return;
    }
    if (!tplMenu.hidden) {
      e.preventDefault();
      closeTplMenu();
      tplPasteBtn.focus();
      return;
    }
    if (!menu.hidden) {
      e.preventDefault();
      closeMenu();
      return;
    }
    const target = e.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;
    e.preventDefault();
    flush();
    ask({ command: 'memoPaneClose' });
  });
  window.addEventListener('focus', () => {
    if (wantFocus) body.focus();
  });
  body.addEventListener('focus', () => {
    wantFocus = false;
  });

  void loadTagRegistry().then(() => {
    if (view) renderCards(view);
  }); // 六角メモのタグと同じ色・候補にする

  onMessage((msg) => {
    if (msg.type === 'relayed' && msg.payload.kind === 'memoPane') paint(msg.payload.view);
    else if (msg.type === 'relayed' && msg.payload.kind === 'memoBoardView') paintBoardMemo(msg.payload.view);
    else if (msg.type === 'relayed' && msg.payload.kind === 'grokCards') grokCardsUi.onOpen(msg.payload.open);
    else if (msg.type === 'relayed' && msg.payload.kind === 'grokCardsData') grokCardsUi.onData(msg.payload);
    else if (msg.type === 'relayed' && msg.payload.kind === 'grokCardsNotice') grokCardsUi.onNotice(msg.payload);
    else if (msg.type === 'relayed' && msg.payload.kind === 'grokReply') grokCardsUi.onReply(msg.payload.id, msg.payload.text);
    else if (msg.type === 'relayed' && msg.payload.kind === 'tagButtonsDone') tagBook.done(msg.payload.seq, msg.payload.book);
    else if (msg.type === 'relayed' && msg.payload.kind === 'memoPaneList') {
      sheetItems = msg.payload.items;
      recentItems = msg.payload.recent;
      listSheetName = msg.payload.sheetName;
      renderList();
    } else if (msg.type === 'relayed' && msg.payload.kind === 'annotateMemoImage') {
      if (typeof msg.payload.id === 'string') faceAnnotate = msg.payload.id;
      takeFaceAnnotate();
    } else if (msg.type === 'relayed' && msg.payload.kind === 'memoPaneNotice') {
      const drop = msg.payload.dropShot;
      if (typeof drop === 'string' && drop === annotateShot) {
        deleteData(`shots/${drop}.json`);
        shotUrls.delete(drop);
        shotBusy.delete(drop);
        annotateShot = null;
      }
      // 並べ替えを断られた：待ちを全部捨てる（左は知らせのあとに写しを送り直すので、写しの並びで描き直る）。読み上げにも出す
      if (msg.payload.undoSend && msg.payload.openMemo) {
        // ボードが、下の区画とは別のメモへ貼った：下の区画には「元に戻す」「送り先を開く」の帯を出さない（ボードの Undo に渡すだけ）
        const boardOwn = skipLowerSentBar({ openMemo: msg.payload.openMemo, lowerId: view?.id ?? null, chosenId: boardMemoView?.id ?? null, boardSentAt, now: Date.now() });
        if (!boardOwn) showSent(msg.payload.text, msg.payload.openMemo, msg.payload.undoSend);
        const sent = { token: msg.payload.undoSend, memo: msg.payload.openMemo };
        boardUndoSendListeners.forEach((fn) => fn(sent.token, sent.memo)); // ボードの「元に戻す」にも渡す（貼り付けの Undo）
      } else if (msg.payload.text.startsWith('並べ替えられませんでした')) {
        clearPending();
        say(msg.payload.text);
      } else {
        const noticeText = msg.payload.text;
        // メモ id つきの知らせは、ボードが別のメモを選んでいるとき、そのメモを見ているほうだけに出す（M4。id が無ければ今までどおり両方）
        const to = noticeTarget({ memo: msg.payload.memo, lowerId: view?.id ?? null, chosenId: boardMemoView?.id ?? null });
        if (to !== 'board') status.textContent = noticeText;
        if (to !== 'lower') boardNoticeListeners.forEach((fn) => fn(noticeText));
      }
    }
    else if (msg.type === 'relayed' && msg.payload.kind === 'readerNow') onReaderNow(msg.payload.now);
    else if (msg.type === 'relayed' && msg.payload.kind === 'readerChapters') {
      readerChapters = { video: msg.payload.video, chapters: msg.payload.chapters };
      if (cardOrder === 'time' && view) renderCards(view); // 時刻順の仕切り（チャプター）を当て直す
    }
    else if (msg.type === 'relayed' && msg.payload.kind === 'threadPending') {
      pending.splice(0, pending.length, ...msg.payload.pending);
      if (view) renderCards(view);
    } else if (msg.type === 'sidebars' && !drag && typeof msg.state.memo?.height === 'number') {
      height = clampMemoPaneHeight(msg.state.memo.height);
      handle.setAttribute('aria-valuenow', String(height));
      notifyHeight();
      grokCardsUi.setVisible(msg.state.memo.visible !== false);
    }
  });

  paintNextRow();
  paint(null);
  send({ type: 'ready' });
  ask({ command: 'memoPaneReady' });
  send({ type: 'relay', to: 'reader', payload: { kind: 'readerPing' } }); // 読む画面が開いていれば、今のマスとチャプターを送り直してもらう（V2b）
}

function action(label: string, title: string, onClick: () => void) {
  const b = el('button', 'thread-action', label);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function removeTitle(replies: readonly Reply[], id: string) {
  const below = countUnder(replies, id);
  return below > 0 ? tr('このコメントを消す（その下の返信 {0} 件も消えます）', { 0: below }) : tr('このコメントを消す');
}

function removeAgain(replies: readonly Reply[], id: string) {
  const below = countUnder(replies, id);
  const linked = replies.filter((r) => r.parent === null && r.id !== id && (r.links ?? []).some((l) => l.to === id)).length;
  const tail = linked > 0 ? tr('（ほかのカードからの関連 {0} 本も外れます）', { 0: linked }) : '';
  return below > 0 ? tr('もう一度押すと、このコメントとその下の返信 {0} 件を消します{1}', { 0: below, 1: tail }) : tr('もう一度押すと、このコメントを消します{0}', { 0: tail });
}

function memoMarkdown(view: MemoPaneView): string {
  const title = memoTitle({ text: view.text }) || tr('（空のメモ）');
  const lines = [`# ${title}`, '', view.text.trim(), '', '---', ''];
  // 一番上のカードは並べた順、返信の木は作った順
  const kidsOf = (parent: string | null) => (parent === null ? orderedTops(view.replies) : view.replies.filter((r) => r.parent === parent).sort((a, b) => a.createdAt - b.createdAt));
  const walk = (parent: string | null, depth: number) => {
    for (const reply of kidsOf(parent)) {
      const pad = '  '.repeat(depth);
      const who = reply.by ? `（${reply.by.name}）` : '';
      const text = reply.text.trim();
      lines.push(`${pad}- ${who}${who && text ? ' ' : ''}${text}`.trimEnd());
      if (reply.quote?.text) {
        for (const line of reply.quote.text.split('\n')) lines.push(`${pad}> ${line}`);
      }
      if (reply.quote) lines.push(`${pad}> — [${mdLabel(reply.quote.title)}](${reply.quote.url})`);
      if (reply.image) lines.push(tr('{0}［画像］', { 0: pad }));
      if (reply.parent === null && reply.links) {
        const parts: string[] = [];
        for (const link of reply.links) {
          const target = view.replies.find((r) => r.id === link.to);
          if (!target) continue;
          const name = cardLabel(target, 24);
          parts.push(link.kind === 'same' ? tr('「{0}」と{1}', { 0: name, 1: linkKindInfo(link.kind).name }) : tr('「{0}」の{1}', { 0: name, 1: linkKindInfo(link.kind).name }));
        }
        if (parts.length > 0) lines.push(tr('{0}  関連：{1}', { 0: pad, 1: parts.join('・') }));
      }
      walk(reply.id, depth + 1);
    }
  };
  walk(null, 0);
  return `${lines.join('\n').trim()}\n`;
}

function mdLabel(title: string) {
  return (title || tr('ページ')).replace(/[\[\]]/g, '');
}

function pageFailure(reply: HostMessage | null): string {
  if (!reply || reply.type !== 'pageCaptured') return tr('上のページからの返事が来ませんでした（全体：返事なし）');
  if (reply.error === 'name') return tr('ファイルの名前が違うので、全体は保存しませんでした（全体：名前）');
  if (reply.error === 'folder') return tr('ピクチャのフォルダを用意できませんでした（全体：フォルダ）');
  if (reply.error === 'noPage') return tr('上のページがありません（全体：ページなし）');
  if (reply.error === 'popout') return tr('小窓に出ているページは、全体を撮れません（全体：小窓）');
  if (reply.error === 'notActive') return tr('上に見えているページではないので、全体を撮れません（全体：表示中でない）');
  if (reply.error === 'metrics') return tr('ページの大きさを聞けませんでした（全体：大きさを聞けない）');
  if (reply.error === 'size') return tr('ページの大きさが取れませんでした（全体：大きさが変）');
  if (reply.error === 'shot') return tr('ページ全体を画像にできませんでした（全体：撮れない）');
  if (reply.error === 'write') return tr('全体の画像をファイルに書けませんでした（全体：ファイルに書けない）');
  if (reply.error === 'big') return tr('全体の画像が大きすぎて保存できませんでした（全体：大きすぎる）');
  if (reply.ok) return tr('全体の画像を保存できませんでした（全体：名前が空）');
  return tr('全体の画像を撮れませんでした（全体：{0}）', { 0: reply.error ?? '理由なし' });
}

function exportFailure(reply: HostMessage | null): string {
  if (!reply || reply.type !== 'imageExported') return tr('書き出せませんでした（書き出す：返事なし）');
  if (reply.error === 'name') return tr('ファイルの名前が違うので、書き出しませんでした（書き出す：名前）');
  if (reply.error === 'data') return tr('この画像の形では書き出せませんでした（書き出す：画像の形でない）');
  if (reply.error === 'big') return tr('画像が大きすぎて書き出せませんでした（書き出す：大きすぎる）');
  if (reply.error === 'folder') return tr('ピクチャのフォルダを用意できませんでした（書き出す：フォルダ）');
  if (reply.error === 'write') return tr('画像をファイルに書けませんでした（書き出す：ファイルに書けない）');
  return tr('書き出せませんでした（書き出す：{0}）', { 0: reply.error ?? '理由なし' });
}

function isSafeExportName(name: string): boolean {
  return !name.includes('..') && /^[A-Za-z0-9._-]{1,80}\.(jpg|png)$/.test(name);
}

// YYYYMMDD-HHMMSS-ドメイン.jpg。英数字・.・_・- だけ。拡張子を入れて 80 字まで
function exportFileName(url: string, ext: 'jpg' | 'png'): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  const safe = host.replace(/[^A-Za-z0-9._-]/g, '') || 'page';
  const tail = `.${ext}`;
  const room = 80 - tail.length - stamp.length - 1;
  const domain = safe.slice(0, Math.max(1, room));
  return `${stamp}-${domain}${tail}`;
}

function captureFailure(reply: HostMessage | null): string {
  if (!reply || reply.type !== 'capture') return tr('上のページからの返事が来ませんでした（撮る：返事なし）');
  if (reply.error === 'notActive') return tr('上に見えているページではないので撮れませんでした（撮る：notActive）');
  if (reply.error === 'tooBig') return tr('画像が大きすぎて渡せませんでした（撮る：tooBig）');
  if (reply.ok) return tr('上のページを画像にできませんでした（撮る：画像が空）');
  if (reply.error === 'metrics') return tr('上のページを画像にできませんでした（撮る：見えている範囲を聞けない）');
  if (reply.error === 'viewport') return tr('上のページを画像にできませんでした（撮る：見えている範囲の大きさが変）');
  if (reply.error === 'shot' || reply.error === 'capture') return tr('上のページを画像にできませんでした（撮る：{0}）', { 0: reply.error });
  return tr('撮れませんでした（ページが眠っている・小窓に出ているなど。撮る：{0}）', { 0: reply.error ?? '理由なし' });
}

function dateOf(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// AI のカードの種類の名前（V4b-2。頭の帯に出す）
const AI_KIND_LABEL: Record<ReaderAiKind, string> = { tech: tr('技法の色'), bones: tr('話の骨組み'), tendon: tr('天丼と伏線'), pause: tr('間'), apply: tr('応用'), talk: tr('やり取り') };

// ❝ 引用（文がある）／🖼 画像（引用の文と両方なら ❝）／🔗 リンク（文の無い引用だけ）／💬 コメント
function kindMark(reply: Reply): string {
  if (reply.quote?.text) return '❝';
  if (reply.image) return '🖼';
  if (reply.quote) return '🔗';
  return '💬';
}

function newShotId() {
  return `shot${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function pastedImage(data: DataTransfer): File | null {
  for (const item of data.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return [...data.files].find((file) => file.type.startsWith('image/')) ?? null;
}

const LONG_EDGE = 1600;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

type FitError = 'decode' | 'empty' | 'canvas' | 'encode';
const FIT_STAGE: Record<FitError, string> = {
  decode: tr('読み込み：画像として読めない'),
  empty: tr('読み込み：大きさが 0'),
  canvas: tr('縮める：canvas が使えない'),
  encode: tr('縮める：書き出せない'),
};

// 長い辺 1,600px。透明のある PNG は PNG のまま。ほかは JPEG（品質 0.85）。動く GIF は止まった絵
//   src は data: の URL だけ。UI の画面の決まり（CSP）は blob: の画像も、data: への fetch も通さない
async function fitPicture(src: string, png: boolean): Promise<{ dataUrl: string } | { error: FitError }> {
  const img = await loadPicture(src);
  if (!img) return { error: 'decode' };
  if (img.naturalWidth < 1 || img.naturalHeight < 1) return { error: 'empty' };
  try {
    const keepPng = png && pictureHasAlpha(img);
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = long > LONG_EDGE ? LONG_EDGE / long : 1;
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { error: 'canvas' };
    if (!keepPng) {
      // theme: fixed begin：画像の白い下地（書き出す画像の色）
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      // theme: fixed end
    }
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
    // 書き出せないときの toDataURL は "data:," を返す
    if (!/^data:image\/(png|jpeg);base64,./.test(dataUrl)) return { error: 'encode' };
    return { dataUrl };
  } catch {
    return { error: 'canvas' };
  }
}

function loadPicture(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

function pictureHasAlpha(img: HTMLImageElement): boolean {
  const max = 400;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 16) if (data[i] < 255) return true;
  return false;
}
