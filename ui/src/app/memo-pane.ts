// 下のメモの区画（ページの下の面）。写しを見て、変えてほしいときは左に頼む
//   本文の下に、コメントのカードと「＋コメント」。帯から引用と画像を足す（M3）
import { armConfirm } from '../confirm-arm';
import { requestPageText } from '../ai/page';
import { type HostMessage, onMessage, request, send } from '../bridge';
import { readData, writeData } from '../data';
import { loadTagRegistry } from '../integrations/hexmemo';
import { MAX_MEMO_TEXT, type MemoIndexItem, memoTitle } from '../memocells';
import { cardFilterRow, cardTagCandidates, cardTagCounts, chainOrder, visibleTops } from '../memo-card-filter';
import { LinkLayer, linkLayoutKey, measureLinkLayout } from '../memo-card-link-layer';
import { chosenLinkNameSet, LINK_NAME_SET_NAME_MAX, type LinkNameSet, LinkNameSetStore, MAX_LINK_NAME_SETS, resolvedLinkKindNames } from '../link-name-sets';
import { cardLabel, type DrawLink, LINK_KIND_DEFAULT_NAMES, LINK_KIND_NAME_MAX, LINK_KINDS, type LinkKind, type LinkKindNames, linkKindInfo, applyLinkKindNames, parseLinkKindNames, withLinkKindName, linkSentence, routeCardLinks, ROW_GAP_MIN, visibleLinks } from '../memo-card-links';
import { linkedClosure, linkTravel, rangeIds, type SendMode, sendWarning } from '../memo-card-send';
import { CardDrag } from '../memo-card-drag';
import { MemoCardMap } from '../memo-card-map-view';
import { CardPops, FrontStack, type PopControl } from '../memo-card-pops';
import type { MapBox } from '../memo-card-map';
import type { MapSide } from '../memo-card-map';
import { beforeFor, type PendingOrder, settledCount, withPending } from '../memo-card-order';
import { mountMemoFilterWords } from '../memo-filter-words';
import { mountGrokCards } from './grok-cards';
import { readUpperRatio, writeUpperRatio } from '../cards-stages';
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
import { CARD_COLUMNS, countUnder, createdTops, hasSlotGaps, MAX_REPLIES, MAX_REPLY_TEXT, orderedTops, parseQuote, pathTo, type PendingReply, quoteFragmentUrl, quoteSourceLabel, REPLY_FOLD, type Reply, type ReplyQuote, topSlots, withPlacedTop } from '../threads';
import { el } from '../util';
import { IMPORT_FILE_BYTES, IMPORT_FILE_LABEL } from '../import-limits';

const SAVE_MS = 500;
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
  handle.title = 'ドラッグで高さを変える';

  const band = el('div', 'memo-pane-band');
  const bandRow = el('div', 'memo-pane-band-row');
  const title = el('button', 'memo-pane-title', 'メモ');
  title.type = 'button';
  title.setAttribute('aria-haspopup', 'dialog');
  title.setAttribute('aria-expanded', 'false');
  title.setAttribute('aria-controls', 'memo-pane-list-window');
  title.title = 'このシートのメモと、最近開いたメモの一覧（押すと開く・閉じる）';
  const sheet = el('span', 'memo-pane-sheet');
  const page = el('span', 'memo-pane-page', '上：ページがありません');
  const close = el('button', 'memo-pane-close', '閉じる（Esc）');
  close.type = 'button';
  close.title = '下の区画を閉じる';
  bandRow.append(title, sheet, page, close);
  const tools = el('div', 'memo-pane-tools');
  const quoteBtn = el('button', 'memo-pane-tool', '❝ 選んだ文を引用');
  quoteBtn.type = 'button';
  quoteBtn.title = '上のページで選んだ文を、引用のカードにします';
  const shotBtn = el('button', 'memo-pane-tool', '▣ 見えている所を画像に');
  shotBtn.type = 'button';
  shotBtn.title = '上に見えている所を画像にして、カードにします';
  const pageBtn = el('button', 'memo-pane-tool', '⇣ 全体を画像に');
  pageBtn.type = 'button';
  pageBtn.title = '上のページを、スクロールで隠れた所も含めて1枚の画像にします。ページによっては、きれいに撮れないことがあります。撮っている間、ページが一瞬ちらつくことがあります';
  const pickBtn = el('button', 'memo-pane-tool', '🖼 画像を選ぶ');
  pickBtn.type = 'button';
  pickBtn.title = 'コンピュータの画像をカードにします。この区画へ貼る・落とすこともできます';
  const fileInput = el('input', 'memo-pane-file');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  const copyBtn = el('button', 'memo-pane-tool', '⧉ まとめてコピー');
  copyBtn.type = 'button';
  copyBtn.title = '本文とカードを、Markdown にしてコピーします。メモ帳に貼れます';
  const gotoBtn = el('button', 'memo-pane-tool', 'このタブに移動');
  gotoBtn.type = 'button';
  gotoBtn.title = '左の盤面で、このメモのセルへ移ります。別のシートなら、そのシートに切り替えます';
  gotoBtn.addEventListener('click', () => {
    if (!view) {
      status.textContent = 'そのメモのセルは、もうありません';
      return;
    }
    ask({ command: 'focusMemoPaneCell', id: view.id });
  });
  const newBtn = el('button', 'memo-pane-tool', '＋ 新しいメモ');
  newBtn.type = 'button';
  newBtn.title = '表示中のタブの近くに、空のメモのセルを置いて、ここで開きます';
  const menuWrap = el('span', 'memo-pane-menu-wrap');
  const menuBtn = el('button', 'memo-pane-tool', '☰');
  menuBtn.type = 'button';
  menuBtn.title = '一覧と、上のページのリンク';
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-label', '一覧と、上のページのリンク');
  const menu = el('div', 'memo-pane-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  const listItem = el('button', 'memo-pane-menu-item', '一覧を出す');
  listItem.type = 'button';
  listItem.setAttribute('role', 'menuitem');
  const linkItem = el('button', 'memo-pane-menu-item', '上のページのリンクを入れる');
  linkItem.type = 'button';
  linkItem.setAttribute('role', 'menuitem');
  linkItem.title = '今の上のページを、リンクのカードにします（文は空）';
  menu.append(listItem, linkItem);
  menuWrap.append(menuBtn, menu);
  tools.append(gotoBtn, quoteBtn, shotBtn, pageBtn, pickBtn, copyBtn, newBtn, menuWrap, fileInput);
  band.append(bandRow, tools);

  const status = el('div', 'memo-pane-status', '自動で保存します');
  // 送った直後の知らせ（切れた関連の一行と、送り先を開く・元に戻す）。右の × で両方消える。数十秒でも消える
  const sentNotice = el('div', 'memo-pane-sentnotice');
  sentNotice.hidden = true;
  const sentWarn = el('div', 'memo-pane-sentnotice-warn');
  sentWarn.hidden = true;
  const sentBar = el('div', 'memo-pane-sentbar');
  sentBar.setAttribute('role', 'status');
  const sentText = el('span', 'memo-pane-sentbar-text');
  const sentOpen = el('button', 'memo-pane-sentbar-btn', '送り先を開く');
  sentOpen.type = 'button';
  const sentUndo = el('button', 'memo-pane-sentbar-btn', '元に戻す');
  sentUndo.type = 'button';
  const sentClose = el('button', 'memo-pane-sentnotice-x', '×');
  sentClose.type = 'button';
  sentClose.title = '閉じる';
  sentClose.setAttribute('aria-label', '閉じる');
  sentBar.append(sentText, sentOpen, sentUndo);
  sentNotice.append(sentWarn, sentBar, sentClose);
  // 選ぶモードの帯（区画の下。移す・写す・新しいメモ・やめる）
  const pickBar = el('div', 'memo-pane-pickbar');
  pickBar.hidden = true;
  pickBar.setAttribute('role', 'status');
  const pickText = el('span', 'memo-pane-pickbar-text', '0枚を選んでいます');
  const pickMove = el('button', 'memo-pane-pickbar-btn', '別のメモへ移す…');
  pickMove.type = 'button';
  const pickCopy = el('button', 'memo-pane-pickbar-btn', '写す…');
  pickCopy.type = 'button';
  const pickNew = el('button', 'memo-pane-pickbar-btn', '新しいメモにする');
  pickNew.type = 'button';
  const pickAll = el('button', 'memo-pane-pickbar-btn', '全部選ぶ');
  pickAll.type = 'button';
  const pickLinked = el('button', 'memo-pane-pickbar-btn', 'つながっているカードも選ぶ');
  pickLinked.type = 'button';
  const pickStop = el('button', 'memo-pane-pickbar-btn', '選ぶのをやめる');
  pickStop.type = 'button';
  pickBar.append(pickText, pickMove, pickCopy, pickNew, pickAll, pickLinked, pickStop);
  pickMove.addEventListener('click', () => beginSend('move', selectedIds()));
  pickCopy.addEventListener('click', () => beginSend('copy', selectedIds()));
  pickNew.addEventListener('click', () => queueSend('move', selectedIds(), null));
  pickAll.addEventListener('click', () => {
    if (!view) return;
    for (const id of shownIds()) picked.add(id);
    renderCards(view, undefined, true);
  });
  pickLinked.addEventListener('click', () => {
    if (!view) return;
    const extra = linkedClosure(view.replies, selectedIds()).filter((id) => !picked.has(id));
    if (extra.length === 0) {
      say('つながっているほかのカードはありません');
      return;
    }
    for (const id of extra) picked.add(id);
    say(`つながっているカード ${extra.length} 枚を足しました`);
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
  const countText = el('span', 'memo-pane-count-text', 'コメント 0（返信を入れて 0/300）');
  const countTools = el('span', 'memo-pane-count-tools');
  // 「関連の見せ方 ▾」のボタンは作り直さない（押した欄の戻り先を保つ）。押すと欄：マウスなら押した所、キーボードならボタンの左下
  const countPick = el('button', 'memo-pane-count-view', '☐ 選ぶ');
  countPick.type = 'button';
  countPick.title = 'カードを選んで、別のメモへまとめて移す・写す';
  countPick.dataset.focusKey = 'countpick';
  countPick.addEventListener('click', () => {
    if (cardMap.isOpen) {
      say('マップの中では選べません（並びに戻ってから）');
      return;
    }
    if (pickingCards) stopPicking();
    else startPicking();
  });
  const countView = el('button', 'memo-pane-count-view', '関連の見せ方 ▾');
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
  // 「並び｜マップ」（関連があるときだけ出す。押すと、並びかマップへ移る。aria-pressed は renderCountTools が当てる）
  const countSwitch = el('span', 'memo-pane-count-switch');
  countSwitch.setAttribute('role', 'group');
  countSwitch.setAttribute('aria-label', '並び・マップ');
  const countList = el('button', '', '並び');
  countList.type = 'button';
  countList.title = 'カードを並びで見る';
  countList.dataset.focusKey = 'countswitch:list';
  countList.addEventListener('click', () => closeMap(true));
  const countMap = el('button', '', 'マップ');
  countMap.type = 'button';
  countMap.title = '関連のつながりを、図で見る';
  countMap.dataset.focusKey = 'countswitch:map';
  countMap.addEventListener('click', () => openMap());
  countSwitch.append(countList, countMap);
  const countline = el('div', 'memo-pane-countline');
  countline.append(countText, countTools);
  const scroll = el('div', 'memo-pane-scroll');
  const by = el('div', 'memo-pane-by');
  const body = el('textarea', 'memo-pane-body');
  body.rows = 3;
  body.placeholder = 'ここにメモを書きます';
  const meta = el('div', 'memo-pane-meta');
  const filterBox = el('div', 'memo-pane-tagfilter'); // カードをタグで絞る札（一覧の「見出しで絞る」の memo-pane-filter とは別）
  filterBox.hidden = true;
  const cards = el('div', 'memo-pane-cards');
  const compose = el('form', 'memo-pane-compose');
  const composeLabel = el('div', 'memo-pane-compose-label', '＋コメント');
  const comment = el('textarea');
  comment.rows = 2;
  comment.placeholder = 'コメントを書く（Ctrl+Enter で足す）';
  comment.setAttribute('aria-label', 'コメントを書く');
  const composeRow = el('div', 'memo-pane-compose-row');
  const meter = el('span', 'memo-pane-meter', `0 / ${REPLY_FOLD}`);
  const hint = el('span', 'memo-pane-longhint', '長め：カードでは 280字まで見せて、続きは開きます');
  hint.hidden = true;
  const sendBtn = el('button', 'preview-button', '足す');
  sendBtn.type = 'submit';
  composeRow.append(meter, hint, sendBtn);
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
  filter.placeholder = '見出しで絞る';
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
  const empty = el('div', 'memo-pane-empty', 'メモのセルをダブルクリックすると、ここに開きます');
  const light = el('div', 'memo-pane-light');
  light.hidden = true;
  const lightImg = el('img');
  lightImg.alt = '大きく見た画像';
  const lightClose = el('button', 'memo-pane-light-close', '×');
  lightClose.type = 'button';
  lightClose.title = '画像を閉じる';
  lightClose.setAttribute('aria-label', '大きく見た画像を閉じる');
  light.append(lightImg, lightClose);
  // 関連づけている間の案内（状態の行と件数の行の上に重ねる。区画の高さは取らない）
  const linkBar = el('div', 'memo-pane-linkbar');
  linkBar.setAttribute('role', 'status');
  linkBar.hidden = true;
  const linkText = el('span', 'memo-pane-linkbar-text');
  const linkPick = el('button', 'memo-pane-linkbar-pick', '一覧から選ぶ');
  linkPick.type = 'button';
  linkPick.addEventListener('click', () => openLinkPicker());
  const linkCancel = el('button', 'memo-pane-linkbar-cancel', 'やめる（Esc）');
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
  linkFilter.placeholder = '相手のカードを字で絞る';
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
  // 読み上げだけの欄（並べ替えの結果など。状態の行は保存のたびに文が入るので live にしない。plan-memo-card-order の O2）
  const announcer = el('div', 'sr-only');
  announcer.setAttribute('role', 'status');
  root.append(handle, band, status, sentNotice, countline, main, pickBar, listWindow, linkBar, linkPicker, empty, light, announcer);
  document.body.append(root);

  // 段 9 の上半分のときだけ、下の包みの中を基準にする。包みが無いときは、今までどおり区画そのもの
  function flowFrame(): HTMLElement {
    const lower = root.querySelector(':scope > .memo-pane-lower');
    return lower instanceof HTMLElement ? lower : root;
  }

  // 上半分の境目。下の帯の高さとは別。旗が無いときは setCardsUpper(true) が来ない
  let upperRatio = UPPER_SPLIT_DEFAULT;
  let upperSplitObserver: ResizeObserver | null = null;

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
    if (persist) writeUpperRatio(upperRatio);
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
      writeUpperRatio(upperRatio);
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
  function setCardsUpper(on: boolean) {
    const onNow = root.classList.contains('is-cards-upper');
    if (on === onNow) return;
    if (on) {
      const upper = el('div', 'grok-cards-upper');
      const split = el('div', 'grok-cards-upper-split');
      split.tabIndex = 0;
      split.setAttribute('role', 'separator');
      split.setAttribute('aria-orientation', 'horizontal');
      split.setAttribute('aria-label', 'Grok Cards とメモの境目。上下の矢印キーで変わり、ダブルクリックで半分に戻します');
      split.title = 'ドラッグで上下の高さを変える。ダブルクリックで半分に戻します';
      wireUpperSplit(split);
      const lower = el('div', 'memo-pane-lower');
      while (root.firstChild) lower.append(root.firstChild);
      root.append(upper, split, lower);
      root.classList.add('is-cards-upper');
      upperRatio = readUpperRatio();
      layoutUpperSplit();
      watchUpperSplit();
      return;
    }
    unwatchUpperSplit();
    const upper = root.querySelector(':scope > .grok-cards-upper');
    if (upper) {
      const cards = upper.querySelector(':scope > .grok-cards');
      if (cards) main.append(cards);
    }
    const lower = root.querySelector(':scope > .memo-pane-lower');
    if (lower) while (lower.firstChild) root.append(lower.firstChild);
    upper?.remove();
    lower?.remove();
    root.querySelector(':scope > .grok-cards-upper-split')?.remove();
    root.classList.remove('is-cards-upper');
  }

  let view: MemoPaneView | null = null;
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
      if (ids.length > 1) return `${ids.length}枚`;
      const reply = view?.replies.find((r) => r.id === id);
      return reply ? `${kindMark(reply)} ${cardLabel(reply, 16)}` : '';
    },
    onStart: () => {
      statusBeforeGrab = status.textContent ?? '';
      linkMenu.close();
      relMenu.close();
      moreMenu.close();
      tagMenu.close();
      dragHint = '置きたい所で離します。一覧のメモの上で離すと移します（Ctrl で写す）。Esc でやめます';
      say(dragHint);
    },
    listHit: (x, y) => listHit(x, y),
    listHover: (id, copy) => {
      if (!id || id === 'same') {
        paintDropHint(null);
        if (id === 'same') status.textContent = '同じメモへは送れません';
        else if (dragHint) status.textContent = dragHint;
        return;
      }
      paintDropHint(id);
      const name = id === 'new' ? '新しいメモ' : ([...sheetItems, ...recentItems].find((item) => item.id === id)?.title ?? 'メモ');
      status.textContent = copy ? `「${name}」へ写します（離すと写す）` : `「${name}」へ移します（離すと移す。Ctrl で写す）`;
    },
    onListDrop: (id, target, copy) => {
      dragHint = '';
      paintDropHint(null);
      ignoreListClick = true;
      window.setTimeout(() => {
        ignoreListClick = false;
      }, 0);
      if (target === 'same') {
        say('同じメモへは送れません');
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
    onCancel: () => say('やめました（元の位置のまま）'),
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
  let cardOrder: 'order' | 'chain' = 'order'; // カードの並べ方（並べた順〈並べ替えていなければ作った順〉・つながり順。覚えない。メモを替えると並べた順）
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
  const linkNameSets = new LinkNameSetStore();
  linkNameSets.onChange(() => refreshLinkNames());
  linkNameSets.onSaveFailed(() => {
    status.textContent = '呼称セットを保存できませんでした';
  });
  window.addEventListener('pagehide', () => linkNameSets.flush());
  void linkNameSets.load();

  const editing = () => document.activeElement === body || Date.now() - typedAt < 1000;
  const refOf = (id: string) => ({ kind: 'memo' as const, id });

  function ask(action: RelayCommand) {
    send({ type: 'relay', to: 'left', payload: { kind: 'command', action } });
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
    status.textContent = `保存しました ${clock()}`;
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
    sendBtn.title = full ? `返信は1つのメモに ${MAX_REPLIES} 件までです` : 'コメントを足す（Ctrl+Enter）';
  }

  function showCount(replies: readonly Reply[]) {
    const n = replies.filter((r) => r.parent === null).length;
    if (filterTag === null) {
      countText.textContent = `コメント ${n}（返信を入れて ${replies.length}/${MAX_REPLIES}）`;
    } else {
      const m = visibleTops(replies, filterTag, keepShown).length;
      countText.textContent = `コメント 表示 ${m} ／ 全 ${n}（返信を入れて ${replies.length}/${MAX_REPLIES}）`;
    }
    renderCountTools();
  }

  function fillMeta(next: MemoPaneView) {
    const like = el('button', next.liked > 0 ? 'preview-like liked' : 'preview-like', next.liked > 0 ? `♥${next.liked}` : '♡');
    like.type = 'button';
    like.title = 'いいね（押すたびに 1→2→3→なし）';
    like.addEventListener('click', () => ask({ command: 'setMemoLiked', id: next.id, liked: (next.liked + 1) % 4 }));
    const tags = tagArea(
      { tags: next.tags, what: 'このメモ', change: (add, remove) => ask({ command: 'changeTags', memo: next.id, add, remove }) },
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
    const nodes: HTMLElement[] = cardOrder === 'chain' ? chainNodes(current, tops) : tops.map((reply) => commentCard(current, reply));
    if (filterTag !== null && tops.length === 0) nodes.push(el('p', 'memo-pane-filter-empty', 'このタグのカードはありません'));
    cards.classList.toggle('linking', linking !== null);
    cards.classList.toggle('picking', pickingCards);
    cardsWrap.classList.toggle('has-links', hasAnyLinks()); // 隙間と余白を線路の幅に（並べる前に。並びが一度で決まるように）
    // 試し：升目に置く（番地 = 行 × 3 ＋ 列）。絞っている・つながり順・3 列が入らない幅では、詰めて並べる
    fitsWide = fitsThreeColumns();
    slotMode = cardOrder === 'order' && filterTag === null && fitsWide;
    cards.classList.toggle('slotted', slotMode);
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
      nodes.push(el('p', 'memo-pane-chain-head', `つながり：「${cardLabel(chain[0], 16)}」ほか ${chain.length - 1} 枚`));
      for (const reply of chain) nodes.push(commentCard(current, reply));
    }
    if (loose.length > 0) {
      nodes.push(el('p', 'memo-pane-chain-head', `つながりなし（${loose.length} 枚）`));
      for (const reply of loose) nodes.push(commentCard(current, reply));
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
    const where = filterTag !== null ? `・タグ「${filterTag}」の中` : '';
    say(`「${reply ? cardLabel(reply, 16) : ''}」を ${from + 1} 枚目から ${to + 1} 枚目へ動かしました（${visible.length} 枚中${where}）`);
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
    say('作った順に戻しました');
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
    say(`「${reply ? cardLabel(reply, 16) : ''}」を ${Math.floor(slot / CARD_COLUMNS) + 1} 行目の ${(slot % CARD_COLUMNS) + 1} 列目に置きました`);
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
    say('空きを詰めました（並びはそのまま）');
  }

  // 「詰める」のボタン（空きがあるときだけ）
  function packButton(current: MemoPaneView, focusId?: string) {
    return hasSlotGaps(orderedReplies(current)) ? [{ label: '詰める', title: 'カードの間の空きを詰めます（並びはそのまま）', close: true, run: () => packCards(focusId) }] : [];
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

  // つまみの小さな欄（並べ替え）：前へ・後ろへ・いちばん前へ・いちばん後へ・作った順に戻す。つながり順の間は、理由と「並べた順にする」
  //   keyboard：キーボードで開いたとき、いちばん上の項目に焦点を置く
  function openGripMenu(id: string, x: number, y: number, keyboard: boolean) {
    const current = view;
    if (!current) return;
    const reply = current.replies.find((r) => r.id === id);
    if (!reply) return;
    const label = cardLabel(reply, 16);
    if (cardOrder === 'chain') {
      linkMenu.open(x, y, [
        { section: `並べ替え：「${label}」` },
        { note: 'つながり順の間は並べ替えられません。' },
        {
          row: '',
          buttons: [
            {
              label: '並べた順にする',
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
      say('つながり順の間は並べ替えられません');
    } else {
      // 前後の計算は、押した時点の並びで行う（欄を開いた時点の n は使わない。stepCard と moveCard が、その時点の orderLists を読む）
      const { visible } = orderLists(current);
      const n = visible.indexOf(id) + 1;
      const m = visible.length;
      if (n === 0) return;
      const where = filterTag !== null ? `・タグ「${filterTag}」の中` : '';
      linkMenu.open(x, y, [
        { section: `並べ替え：「${label}」（${n} 枚目／${m} 枚${where}）` },
        { label: '← 前へ', hint: 'Alt+←', disabled: n === 1, run: () => stepCard(id, -1) },
        { label: '後ろへ →', hint: 'Alt+→', disabled: n === m, run: () => stepCard(id, 1) },
        { label: 'いちばん前へ', disabled: n === 1, run: () => moveCard(id, 0) },
        { label: 'いちばん後へ', disabled: n === m, run: () => moveCard(id, Number.MAX_SAFE_INTEGER) }, // 端へは、見えている列の最後に丸められる
        'sep',
        isReordered(current)
          ? { row: '並び', buttons: [...packButton(current, id), { label: '作った順に戻す', confirm: 'もう一度押すと戻します', close: true, run: () => resetOrder(id) }] }
          : { note: 'まだ並べ替えていません（作った順のまま）' },
      ]);
    }
    if (keyboard) linkMenu.focusFirst();
  }

  // つまみの Alt+←／Alt+→：見えている列の中で一つ前・後ろへ。端は読み上げで知らせる。つながり順の間は、つまみの欄を開いて理由を出す
  function stepCard(id: string, delta: -1 | 1) {
    const current = view;
    if (!current) return;
    if (cardOrder === 'chain') {
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
    if (i + delta < 0) say('いちばん前です');
    else if (i + delta >= visible.length) say('いちばん後ろです');
    else moveCard(id, i + delta);
  }

  // ---------- 関連線（L3）：測る・経路・描く。経路の計算は memo-card-links.ts、層は memo-card-link-layer.ts ----------

  // 今のメモの一番上のカードに、関連が 1 本でもあるか（絞りで隠れていても数える）
  function hasAnyLinks(): boolean {
    return !!view && view.replies.some((r) => r.parent === null && (r.links?.length ?? 0) > 0);
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
        if (Date.now() - saidAt > 3000) status.textContent = '線が多いので、選んだカードの線だけ出しています（関連の見せ方 ▾ で「すべて」に戻せます）';
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
    return `${linkSentence(`「${cardLabel(from, 20)}」`, `「${cardLabel(to, 20)}」`, link.kind)}（押すと：元へ移る・相手へ移る・外す）`;
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
      { label: '元へ移る', run: () => jumpToLinked(link.from) },
      { label: '相手へ移る', run: () => jumpToLinked(link.to) },
      'sep',
      {
        label: 'この関連を外す',
        run: () => {
          ask({ command: 'changeReplyLinks', id: current.id, replyId: link.from, add: [], remove: [{ to: link.to, kind: link.kind }] });
          status.textContent = '関連を外しました';
        },
      },
    ]);
  }

  // 件数の行の道具：線が多くて「選んだカード」に自動で替えたときの注記と、「関連の見せ方 ▾」（線路が無ければ何も出さない）
  function renderCountTools() {
    countPick.textContent = pickingCards ? '☑ 選ぶ' : '☐ 選ぶ';
    countPick.setAttribute('aria-pressed', String(pickingCards));
    const nodes: HTMLElement[] = [countPick];
    if (!hasAnyLinks()) {
      const key = focusKeyIn(countTools);
      countTools.replaceChildren(...nodes);
      refocus(countTools, key);
      updatePickBar();
      return;
    }
    if (autoSelected) nodes.push(el('span', 'memo-pane-count-note', '線が多いので、選んだカードの線だけ出しています'));
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
    cardMap.el.querySelector<HTMLElement>('.memo-pane-map-close')?.focus({ preventScroll: true });
  }

  // マップを閉じる（returnFocus：件数の行の「マップ」へ焦点を戻す）
  function closeMap(returnFocus: boolean) {
    if (!cardMap.isOpen) return;
    cardMap.close();
    renderCountTools();
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
    status.textContent = set ? `このメモの呼称セットを「${set.name}」にしました` : 'このメモの呼称セットを外しました（このメモの名前に戻しました）';
    refreshLinkNames();
    after?.();
  }

  function deleteLinkSet(set: LinkNameSet) {
    if (linkSetUnusable()) {
      status.textContent = '呼称セットは今は変えられません（台帳を読めませんでした）';
      return;
    }
    const using = view?.linkSet === set.id;
    if (using && view) delete view.linkSet;
    const removed = linkNameSets.apply({ type: 'remove', id: set.id });
    if (!removed) {
      if (using && view) view.linkSet = set.id;
      refreshLinkNames();
      status.textContent = '呼称セットを消せませんでした';
      return;
    }
    ask({ command: 'clearMemoLinkSet', setId: set.id });
    status.textContent = `呼称セット「${set.name}」を消しました。使っていたメモは、そのメモの名前に戻ります`;
  }

  // 呼称セットの名前と 6 つの名前（set が無ければ、新しいセットを作って、このメモで使う）
  function openLinkNameSetForm(set: LinkNameSet | null, x: number, y: number) {
    const form = el('form', 'cell-menu-form memo-pane-link-set-form');
    form.append(el('div', 'cell-menu-section', set ? `呼称セット「${set.name}」` : '新しい呼称セット'));
    form.append(el('div', 'cell-menu-note', '色と矢じりはそのままです。名前は 10 文字までです'));
    const nameInput = el('input');
    nameInput.value = set?.name ?? '';
    nameInput.maxLength = LINK_NAME_SET_NAME_MAX;
    nameInput.placeholder = 'セットの名前';
    nameInput.setAttribute('aria-label', 'セットの名前');
    form.append(nameInput);
    const base = set?.names ?? {};
    const inputs = new Map<LinkKind, HTMLInputElement>();
    for (const k of LINK_KINDS) {
      const row = el('div', 'memo-pane-link-set-row');
      const label = el('span', 'memo-pane-link-set-kind', LINK_KIND_DEFAULT_NAMES[k.kind]);
      label.style.setProperty('--rel', k.color);
      label.title = 'この種類の色と形は変わりません';
      const input = el('input');
      input.value = base[k.kind] ?? LINK_KIND_DEFAULT_NAMES[k.kind];
      input.maxLength = LINK_KIND_NAME_MAX;
      input.setAttribute('aria-label', `${LINK_KIND_DEFAULT_NAMES[k.kind]}の名前`);
      row.append(label, input);
      form.append(row);
      inputs.set(k.kind, input);
    }
    const buttons = el('div', 'cell-menu-kind');
    const ok = el('button', 'cell-menu-small', set ? '保存する' : '作ってこのメモで使う');
    ok.type = 'submit';
    const cancel = el('button', 'cell-menu-small', 'やめる');
    cancel.type = 'button';
    cancel.addEventListener('click', () => linkMenu.close());
    buttons.append(ok, cancel);
    form.append(buttons);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (linkSetUnusable()) {
        status.textContent = '呼称セットは今は変えられません（台帳を読めませんでした）';
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
        status.textContent = `呼称セット「${saved?.name ?? set.name}」の名前を保存しました`;
        return;
      }
      const id = linkNameSets.apply({ type: 'add', name: nameInput.value, names });
      linkMenu.close();
      if (!id) {
        status.textContent = '呼称セットを作れませんでした';
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
    const entries: MenuEntry[] = [{ section: '呼称セット（このメモだけ。登録は全部のメモで共通）' }];
    entries.push({
      row: '選ばない',
      hint: 'このメモの名前',
      buttons: [
        {
          label: '使う',
          pressed: !currentId,
          title: '呼称セットを外して、このメモの名前に戻す',
          run: () => chooseLinkSet(null, reopen),
        },
      ],
    });
    for (const set of book.sets) {
      const names = LINK_KINDS.map((k) => set.names[k.kind] ?? LINK_KIND_DEFAULT_NAMES[k.kind]).join('・');
      entries.push({
        row: set.name,
        buttons: [
          {
            label: '使う',
            pressed: set.id === currentId,
            title: `${names}（このメモの関連の名前を、このセットにする）`,
            run: () => chooseLinkSet(set.id, reopen),
          },
        ],
      });
    }
    entries.push('sep');
    const full = book.sets.length >= MAX_LINK_NAME_SETS;
    const locked = linkSetUnusable();
    entries.push({
      label: '新しいセット…',
      hint: full ? `${MAX_LINK_NAME_SETS} 個まで` : '名前と 6 つの名前',
      disabled: full || locked || !linkNameSets.ready,
      run: () => openLinkNameSetForm(null, x, y),
    });
    entries.push({
      label: '今の名前をセットとして保存…',
      disabled: full || locked || !linkNameSets.ready,
      run: () =>
        linkMenu.prompt(
          '新しいセットの名前',
          `セット${book.sets.length + 1}`,
          (name) => {
            const id = linkNameSets.apply({ type: 'add', name, names: shownLinkKindNames() });
            if (!id) {
              status.textContent = '呼称セットを保存できませんでした';
              return;
            }
            chooseLinkSet(id);
            const saved = chosenLinkNameSet(linkNameSets.book, id);
            status.textContent = `呼称セット「${saved?.name ?? name}」を保存して、このメモで使うようにしました`;
          },
          { x, y },
          { maxLength: LINK_NAME_SET_NAME_MAX },
        ),
    });
    if (current) {
      entries.push({
        label: `「${current.name}」の名前を変える…`,
        disabled: locked,
        run: () =>
          linkMenu.prompt(
            'セットの名前',
            current.name,
            (name) => {
              linkNameSets.apply({ type: 'rename', id: current.id, name });
              const saved = chosenLinkNameSet(linkNameSets.book, current.id);
              status.textContent = `呼称セットの名前を「${saved?.name ?? name}」にしました`;
              reopen();
            },
            { x, y },
            { maxLength: LINK_NAME_SET_NAME_MAX },
          ),
      });
      entries.push({
        label: `「${current.name}」の 6 つの名前…`,
        disabled: locked,
        run: () => openLinkNameSetForm(current, x, y),
      });
      entries.push({
        row: '',
        buttons: [{ label: `「${current.name}」を消す`, confirm: 'もう一度押すと消す', close: true, run: () => deleteLinkSet(current) }],
      });
    } else if (currentId && linkNameSets.ready) {
      entries.push({ note: '選んでいたセットは、もうありません。このメモの名前で出しています' });
      entries.push({ label: 'このメモの選択を外す', run: () => chooseLinkSet(null, reopen) });
    }
    if (!linkNameSets.ready) entries.push({ note: '呼称セットを読み込んでいます…' });
    else if (locked) entries.push({ note: '呼称セットの台帳を読めなかったので、今は変えられません' });
    linkMenu.open(x, y, entries);
  }

  // 関連の見せ方の欄（「関連の見せ方 ▾」）：線の見せ方を選ぶ（欄は開いたまま描き直す）と、線の凡例。keyboard のときは、いちばん上の項目へ
  function openLinkView(x: number, y: number, keyboard: boolean) {
    // 凡例の文字（色と形の名前。この欄だけで使う）
    const colorName: Record<LinkKind, string> = { ground: '緑', counter: '赤', next: '青', same: '灰', ask: '紫', supplement: '黄土' };
    const headName: Record<string, string> = { triangle: '三角の矢じり', bar: '止めの棒', chevron: '山形の矢じり', none: '矢じりなし（向きなし）', dot: '丸の矢じり', diamond: 'ひし形の矢じり' };
    const modes: { label: string; value: 'all' | 'selected' | 'none' }[] = [
      { label: 'すべて', value: 'all' },
      { label: '選んだカード', value: 'selected' },
      { label: '出さない', value: 'none' },
    ];
    // 欄の中身（押したあとは、押してある印と注記を当て直すために組み直す）
    const build = (): MenuEntry[] => {
      const next: MenuEntry[] = [
        { section: '関連の見せ方' },
        { row: '線', buttons: modes.map((m) => ({ label: m.label, pressed: lineMode === m.value, run: () => choose(m.value) })) },
      ];
      if (lineMode === 'selected' && selectedCard === null) next.push({ note: 'カードを押すと、そのカードの線だけを出します' });
      next.push(
        { section: '並べ方' },
        {
          row: '並べ方',
          buttons: [
            { label: view && isReordered(view) ? '並べた順' : '作った順', title: '並べ替えると「並べた順」になります', pressed: cardOrder === 'order', run: () => chooseOrder('order') },
            { label: 'つながり順', pressed: cardOrder === 'chain', run: () => chooseOrder('chain') },
          ],
        },
      );
      if (view && isReordered(view)) next.push({ row: '並び', buttons: [...packButton(view), { label: '作った順に戻す', confirm: 'もう一度押すと戻します', close: true, run: () => resetOrder() }] });
      const chosen = chosenLinkNameSet(linkNameSets.book, view?.linkSet);
      const missingSet = !!view?.linkSet && !chosen && linkNameSets.ready;
      const setRow = !linkNameSets.ready ? '読み込み中' : chosen ? chosen.name : missingSet ? '見つかりません' : '選んでいない';
      next.push({ section: '呼称セット' });
      next.push({
        row: setRow,
        hint: missingSet ? 'このメモの名前で出しています' : undefined,
        buttons: [
          {
            label: '選ぶ ▾',
            aria: 'このメモの呼称セットを選ぶ',
            title: chosen ? `このメモは「${chosen.name}」。登録は全部のメモで共通、使うセットはこのメモだけ` : '登録は全部のメモで共通です。使うセットは、このメモだけ変わります',
            run: () => openLinkNameSetMenu(x, y),
          },
        ],
      });
      next.push({ section: '凡例（元 → 相手。元は相手の〈種類〉）' });
      for (const k of LINK_KINDS) {
        const renamed = k.name !== LINK_KIND_DEFAULT_NAMES[k.kind];
        const setTitle = chosen ? `セット「${chosen.name}」の名前（このセットを使うメモ全部）` : 'このメモだけの名前';
        next.push({
          row: `${k.name}：${colorName[k.kind]}・${headName[k.head]}${k.dashed ? '・破線' : ''}`,
          hint: renamed ? `元は「${LINK_KIND_DEFAULT_NAMES[k.kind]}」` : undefined,
          buttons: [
            { label: '名前を変える', aria: chosen ? `呼称セット「${chosen.name}」の「${k.name}」の名前を変える` : `「${k.name}」の名前を変える`, title: setTitle, run: () => renameKind(k.kind, x, y) },
            ...(renamed ? [{ label: '元に戻す', aria: `「${k.name}」を「${LINK_KIND_DEFAULT_NAMES[k.kind]}」に戻す`, title: setTitle, run: () => applyKindName(k.kind, null) }] : []),
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
          status.textContent = '呼称セットは今は変えられません（台帳を読めませんでした）';
          return;
        }
        const names = withLinkKindName(set.names, kind, name);
        linkNameSets.apply({ type: 'setNames', id: set.id, names: names ?? {} });
        const shown = linkKindInfo(kind).name;
        status.textContent = name ? `呼称セット「${set.name}」の名前を「${shown}」にしました` : `呼称セット「${set.name}」の「${shown}」を元の名前に戻しました`;
        entries.splice(0, entries.length, ...build());
        linkMenu.refresh();
        return;
      }
      const names = withLinkKindName(view.linkNames, kind, name);
      view.linkNames = names; // 写しが戻る前に、この区画ですぐ当てる
      applyLinkKindNames(names);
      ask({ command: 'setMemoLinkNames', id: view.id, names: names ?? null });
      status.textContent = name ? `関連の種類の名前を「${linkKindInfo(kind).name}」にしました` : `関連の種類の名前を「${linkKindInfo(kind).name}」に戻しました`;
      if (view) renderCards(view, undefined, true);
      scheduleLinks();
      renderCountTools();
      entries.splice(0, entries.length, ...build());
      linkMenu.refresh();
    };
    const renameKind = (kind: LinkKind, px: number, py: number) => {
      linkMenu.prompt(`「${linkKindInfo(kind).name}」の新しい名前（${LINK_KIND_NAME_MAX} 文字まで）`, linkKindInfo(kind).name, (value) => applyKindName(kind, value), { x: px, y: py }, { maxLength: LINK_KIND_NAME_MAX });
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
    const chooseOrder = (order: 'order' | 'chain') => {
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
      status.textContent = 'そのコメントは、もうありません';
      return;
    }
    if (cardMap.isOpen) closeMap(false); // 移る道は先に閉じる（マップの窓）
    const top = pathTo(current.replies, id)[0];
    // 移る先のカードが絞りで隠れていたら、絞りを外す
    if (filterTag && top && !(top.tags ?? []).includes(filterTag)) {
      filterTag = null;
      keepShown.clear();
      status.textContent = 'タグの絞りを外しました（検索から移ったため）';
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
      { section: 'カードの画像' },
      {
        label: '🖼 画像を撮影に送る',
        hint: '大きく開く',
        run: () => {
          ask({ command: 'captureCardImage', id: memoId, replyId });
          status.textContent = '画像を右の撮影に送りました（大きく開きます）';
        },
      },
    ]);
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
        const more = el('button', 'memo-pane-more', open ? 'たたむ ▴' : '…続き ▾');
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
    src.title = 'この文の所を開く';
    src.addEventListener('click', () => {
      ask({ command: 'openQuote', url: quote.url, fragmentUrl: quoteFragmentUrl(quote.url, quote.text) });
    });
    card.append(src);
  }

  function appendImage(card: HTMLElement, reply: Reply) {
    if (!reply.image) return;
    const src = shotUrl(reply.image);
    if (!src) {
      card.append(el('div', 'memo-pane-shot-wait', '画像を読んでいます'));
      return;
    }
    const btn = el('button', 'memo-pane-thumb');
    btn.type = 'button';
    btn.title = '画像を大きく見る';
    const img = el('img');
    img.src = src;
    img.alt = 'カードの画像';
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
      status.textContent = `返信は1つのメモに ${MAX_REPLIES} 件までです`;
      return false;
    }
    return true;
  }

  async function quoteSelection() {
    if (!view || busy) return;
    const memoId = view.id;
    const tabId = view.page.tabId;
    if (tabId === null) {
      status.textContent = '上のページがありません';
      return;
    }
    setBusy(true);
    status.textContent = '選んだ文を読んでいます';
    try {
      const pageText = await requestPageText(tabId);
      if (view?.id !== memoId) return;
      if (pageText.error === 'noPage') {
        status.textContent = '上のページがありません';
        return;
      }
      if (pageText.error) {
        status.textContent = '上のページの文を読めませんでした';
        return;
      }
      const selection = (pageText.selection ?? '').trim();
      if (!selection) {
        status.textContent = '上のページで文を選んでから押してください';
        return;
      }
      const quote = parseQuote({ text: selection, url: pageText.url ?? '', title: pageText.title ?? '' });
      if (!quote) {
        status.textContent = 'このページのアドレスでは引用を残せません';
        return;
      }
      if (!roomForCard()) return;
      armNewEdit();
      ask({ command: 'addMemoComment', id: memoId, text: '', quote });
      status.textContent = '引用を入れました';
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
      status.textContent = '撮れませんでした（ページが眠っている・小窓に出ているなど）';
      return;
    }
    setBusy(true);
    status.textContent = '見えている所を撮っています';
    try {
      // maxEdge：上に見えている範囲だけ。下の区画に入力先があっても撮れ、大きすぎて届かない画像にしない
      const reply = await request((requestId) => ({ type: 'captureFull', requestId, id: tabId, maxEdge: 1600 }), 8_000);
      if (view?.id !== memoId) return;
      if (reply?.type !== 'capture' || !reply.ok || !reply.image) {
        status.textContent = captureFailure(reply);
        return;
      }
      if (!/^data:image\/(jpeg|png);base64,./.test(reply.image)) {
        status.textContent = '撮った画像を整えられませんでした（受け取り：画像の形でない）';
        return;
      }
      const fit = await fitPicture(reply.image, false);
      if (view?.id !== memoId) return;
      if ('error' in fit) {
        status.textContent = `撮った画像を整えられませんでした（${FIT_STAGE[fit.error]}）`;
        return;
      }
      const quote = parseQuote({ text: '', url: source.url, title: source.title });
      await saveShot(memoId, fit.dataUrl, quote);
    } catch (error) {
      if (view?.id === memoId) status.textContent = `撮った画像を整えられませんでした（途中：${error instanceof Error ? error.name : '不明'}）`;
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
      status.textContent = '全体の画像を撮れませんでした（全体：ページなし）';
      return;
    }
    if (view.replies.length >= MAX_REPLIES) {
      status.textContent = `返信は1つのメモに ${MAX_REPLIES} 件までです`;
      return;
    }
    const name = exportFileName(source.url, 'jpg');
    setBusy(true);
    status.textContent = 'ページ全体を撮っています';
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
        if (here()) status.textContent = `全体の画像は保存しました（${savedName}）。このページのアドレスではカードを残せません`;
        return;
      }
      if (here() && view && view.replies.length >= MAX_REPLIES) {
        status.textContent = `全体の画像は保存しました（${savedName}）。返信は1つのメモに ${MAX_REPLIES} 件までです`;
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
      if (here()) status.textContent = thumb.note ? `全体の画像は保存しました。${thumb.note}` : '全体の画像を入れました';
    } catch (error) {
      if (view?.id === memoId) status.textContent = `全体の画像を撮れませんでした（全体：途中で止まった ${error instanceof Error ? error.name : '不明'}）`;
    } finally {
      setBusy(false);
    }
  }

  // 見えている所（6.2 と同じ）。全体のファイルが書けたあとなので、ここが失敗してもカードは足す
  async function visibleThumb(tabId: number): Promise<{ image?: string; note?: string }> {
    const reply = await request((requestId) => ({ type: 'captureFull', requestId, id: tabId, maxEdge: 1600 }), 8_000);
    if (reply?.type !== 'capture' || !reply.ok || !reply.image) return { note: captureFailure(reply) };
    if (!/^data:image\/(jpeg|png);base64,./.test(reply.image)) return { note: '見えている所は入れられませんでした（受け取り：画像の形でない）' };
    const fit = await fitPicture(reply.image, false);
    if ('error' in fit) return { note: `見えている所は入れられませんでした（${FIT_STAGE[fit.error]}）` };
    const id = newShotId();
    const ok = await writeData(`shots/${id}.json`, { version: 1, data: fit.dataUrl });
    if (!ok) return { note: '見えている所は入れられませんでした（保存：ファイルに書けない）' };
    shotUrls.set(id, fit.dataUrl);
    return { image: id };
  }

  async function exportCardImage(reply: Reply) {
    if (!view || busy || !reply.image) return;
    const memoId = view.id;
    setBusy(true);
    status.textContent = '画像を書き出しています';
    try {
      const saved = await readData<{ data?: unknown }>(`shots/${reply.image}.json`);
      if (view?.id !== memoId) return;
      const dataUrl = typeof saved?.data === 'string' ? saved.data : '';
      const png = dataUrl.startsWith('data:image/png;base64,');
      const jpeg = dataUrl.startsWith('data:image/jpeg;base64,');
      const comma = dataUrl.indexOf(',');
      const payload = comma >= 0 ? dataUrl.slice(comma + 1) : '';
      if ((!png && !jpeg) || !payload) {
        status.textContent = 'この画像は書き出せませんでした（書き出す：カードの画像を読めない）';
        return;
      }
      const name = exportFileName(reply.quote?.url || view.page.url, png ? 'png' : 'jpg');
      const sent = await request((requestId) => ({ type: 'exportImage', requestId, name, data: payload }), 30_000);
      if (view?.id !== memoId) return;
      if (sent?.type !== 'imageExported' || !sent.ok || !sent.name) {
        status.textContent = exportFailure(sent);
        return;
      }
      status.textContent = `画像を書き出しました（${sent.name}）`;
    } finally {
      setBusy(false);
    }
  }

  async function copyMarkdown() {
    if (!view || busy) return;
    const memoId = view.id;
    const text = memoMarkdown(view);
    setBusy(true);
    status.textContent = 'コピーしています';
    try {
      const reply = await request((requestId) => ({ type: 'clipboardWrite', requestId, text, html: '' }), 8_000);
      if (view?.id !== memoId) return;
      if (reply?.type !== 'clipboardWritten') {
        status.textContent = 'まとめてコピーできませんでした（コピー：返事なし）';
        return;
      }
      if (!reply.ok) {
        status.textContent = 'まとめてコピーできませんでした（コピー：書けない）';
        return;
      }
      status.textContent = 'まとめてコピーしました。メモ帳に貼れます';
    } catch {
      if (view?.id === memoId) status.textContent = 'まとめてコピーできませんでした（コピー：途中で止まった）';
    } finally {
      setBusy(false);
    }
  }

  function addPageLink() {
    if (!view || busy) return;
    if (view.page.tabId === null || !view.page.url) {
      status.textContent = '上のページがありません（リンク：ページなし）';
      return;
    }
    const quote = parseQuote({ text: '', url: view.page.url, title: view.page.title });
    if (!quote) {
      status.textContent = 'このページのアドレスではリンクを残せません（リンク：アドレス）';
      return;
    }
    if (view.replies.length >= MAX_REPLIES) {
      status.textContent = `返信は1つのメモに ${MAX_REPLIES} 件までです（リンク：いっぱい）`;
      return;
    }
    armNewEdit();
    ask({ command: 'addMemoComment', id: view.id, text: '', quote });
    status.textContent = 'ページのリンクを入れました';
  }

  function closeMenu() {
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  function openMenu() {
    menu.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
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
    listWindow.setAttribute('aria-label', sendPick ? '送り先のメモ' : 'メモの一覧');
    filter.placeholder = sendPick ? '送り先を絞る' : '見出しで絞る';
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
    filter.placeholder = '見出しで絞る';
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
    sheetPartBtn.textContent = `このシート ${sheet.length}`;
    sheetPartBtn.title = `このシート（${listSheetName || 'シート'}）のメモ`;
    sheetPartBtn.setAttribute('aria-pressed', String(onSheet));
    recentPartBtn.textContent = `最近 ${recent.length}`;
    recentPartBtn.title = '最近開いたメモ';
    recentPartBtn.setAttribute('aria-pressed', String(!onSheet));
    const shown = onSheet ? sheet : recent;
    listBody.replaceChildren();
    if (sendPick?.confirm) {
      listBody.append(sendConfirmBox(sendPick.confirm));
      refocus(listWindow, key);
      return;
    }
    if (sendPick) {
      const verb = sendPick.mode === 'move' ? '移す' : '写す';
      listBody.append(el('div', 'memo-pane-list-empty', `${sendPick.ids.length}枚を${verb}先`));
      const neu = el('button', 'memo-pane-list-item memo-pane-list-new', '＋ 新しいメモにする');
      neu.type = 'button';
      neu.dataset.memoId = 'new';
      neu.dataset.focusKey = 'listitem:new';
      neu.title = '空のメモを近くに作り、そこへ入れます';
      neu.addEventListener('click', () => {
        if (ignoreListClick) return;
        chooseSendTarget(null);
      });
      listBody.append(neu);
    }
    if (shown.length === 0) {
      const none = onSheet ? 'このシートにメモがありません' : 'まだありません';
      listBody.append(el('div', 'memo-pane-list-empty', q ? '当てはまるメモがありません' : none));
    }
    for (const item of shown) listBody.append(listButton(item));
    refocus(listWindow, key);
  }

  function listButton(item: MemoIndexItem) {
    const name = item.title || '（空のメモ）';
    const armed = armedItem === item.id;
    const b = el('button', 'memo-pane-list-item');
    b.type = 'button';
    b.dataset.focusKey = `listitem:${item.id}`;
    b.dataset.memoId = item.id;
    b.title = name;
    if (view?.id === item.id) b.setAttribute('aria-current', 'true');
    if (sendPick && view?.id === item.id) {
      b.disabled = true;
      b.title = '今開いているメモです';
    }
    if (armed && !sendPick) b.classList.add('armed');
    b.append(el('span', 'memo-pane-list-name', armed && !sendPick ? '書きかけが消えます・もう一度押すと替えます' : name));
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
      say('送るカードがありません');
      return;
    }
    if (next.some((id) => cardEdits.has(id))) {
      say('書き直しの途中のカードは送れません');
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
      say('送るカードがありません');
      return;
    }
    if (next.some((id) => cardEdits.has(id))) {
      say('書き直しの途中のカードは送れません');
      return;
    }
    if (to !== null && to === view.id) {
      say('同じメモへは送れません');
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
    const where = confirm.to === null ? '新しいメモ' : ([...sheetItems, ...recentItems].find((item) => item.id === confirm.to)?.title ?? '送り先');
    box.append(el('p', 'memo-pane-send-confirm-where', `「${where}」へ`));
    box.append(el('p', '', sendWarning(mode, confirm.cut, confirm.kept) ?? ''));
    const verb = mode === 'move' ? '移す' : '写す';
    const row = el('div', 'memo-pane-send-confirm-row');
    const go = el('button', 'memo-pane-list-item', `このまま${verb}`);
    go.type = 'button';
    go.dataset.focusKey = 'sendconfirm:go';
    go.addEventListener('click', () => commitSend(mode, confirm.ids, confirm.to));
    row.append(go);
    if (view) {
      const extra = linkedClosure(view.replies, confirm.ids).filter((id) => !confirm.ids.includes(id) && !cardEdits.has(id));
      if (extra.length > 0) {
        const withThem = el('button', 'memo-pane-list-item', `つながっている ${extra.length} 枚も一緒に${verb}`);
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
      if (blocked.length > 0) box.append(el('p', 'memo-pane-list-empty', '書き直しの途中のカードは一緒に送れません'));
    }
    const cancel = el('button', 'memo-pane-list-item', 'やめる');
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
    pickText.textContent = `${n}枚を選んでいます`;
    pickMove.disabled = n === 0;
    pickCopy.disabled = n === 0;
    pickNew.disabled = n === 0;
    pickAll.textContent = filterTag !== null ? '絞り込み中を全部選ぶ' : '全部選ぶ';
  }

  function openExported(name: string) {
    if (!isSafeExportName(name)) {
      status.textContent = 'このファイルは開けません（書き出す：名前）';
      return;
    }
    send({ type: 'openExported', name });
  }

  function revealExported(name: string) {
    if (!isSafeExportName(name)) {
      status.textContent = 'このファイルのフォルダは開けません（書き出す：名前）';
      return;
    }
    send({ type: 'revealExported', name });
  }

  async function addImageFile(file: File) {
    if (!view || busy) return;
    const memoId = view.id;
    if (file.type && !file.type.startsWith('image/')) {
      status.textContent = '画像のファイルを選んでください';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      status.textContent = '20MB を超える画像は入れられません';
      return;
    }
    setBusy(true);
    try {
      const src = await readAsDataUrl(file);
      if (view?.id !== memoId) return;
      if (!src) {
        status.textContent = 'この画像は入れられませんでした（ファイル：読めない）';
        return;
      }
      const png = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
      const fit = await fitPicture(src, png);
      if (view?.id !== memoId) return;
      if ('error' in fit) {
        status.textContent = `この画像は入れられませんでした（${FIT_STAGE[fit.error]}）`;
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
      status.textContent = '画像を保存できませんでした（保存：ファイルに書けない）';
      return;
    }
    shotUrls.set(id, dataUrl);
    armNewEdit();
    ask({ command: 'addMemoComment', id: memoId, text: '', image: id, ...(quote ? { quote } : {}) });
    status.textContent = '画像を入れました';
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
    linkText.textContent = `「${cardLabel(reply, 16)}」の相手のカードを押してください`;
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
        status.textContent = `関連「${linkKindInfo(kind).name}」を付けました`;
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
    const entries: MenuEntry[] = [{ section: `「${cardLabel(a, 12)}」は「${cardLabel(b, 12)}」の…${set ? `（${set.name}）` : ''}` }];
    for (const k of LINK_KINDS) {
      entries.push({
        label: k.name,
        hint: now === k.kind ? '今の種類' : k.kind === 'same' && backSame ? `もう「${k.name}」です` : undefined,
        disabled: k.kind === 'same' && backSame && now !== 'same',
        run: () => chooseKind(from, to, k.kind),
      });
    }
    if (now) {
      entries.push('sep', {
        label: 'この関連を外す',
        run: () => {
          if (view) ask({ command: 'changeReplyLinks', id: view.id, replyId: from, add: [], remove: [{ to, kind: now }] });
          status.textContent = '関連を外しました';
          endLinking(true);
        },
      });
    }
    entries.push('sep', { label: 'やめる', run: () => endLinking(true) });
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
    const entries: MenuEntry[] = [{ section: set ? `このカードの関連（${set.name}）` : 'このカードの関連' }];
    for (const rel of relationsOf(current, id)) {
      const other = current.replies.find((r) => r.id === rel.other);
      if (!other) continue;
      const name = `「${cardLabel(other, 16)}」`;
      const sentence = rel.outgoing ? linkSentence('このカード', name, rel.kind) : linkSentence(name, 'このカード', rel.kind);
      // 見る：相手のカードを、このカードの横に出して止める（もう一度押すと閉じる。一覧は開いたまま）。行の右クリックも同じ
      const peek: MenuButton = {
        label: '見る',
        aria: `${sentence}：相手のカードを横に出す（もう一度押すと閉じる）`,
        title: '相手のカードを横に出して止める（もう一度押すと閉じる・右クリックでも）',
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
        hint: shown.has(rel.other) ? undefined : '絞りで隠れています',
        buttons: [
          peek,
          { label: '移る', aria: `${sentence}：相手のカードへ移る`, close: true, run: () => jumpToLinked(rel.other) },
          {
            label: '外す',
            aria: `${sentence}：この関連を外す`,
            close: true,
            run: () => {
              if (view) ask({ command: 'changeReplyLinks', id: view.id, replyId: rel.source, add: [], remove: [{ to: rel.outgoing ? rel.other : id, kind: rel.kind }] });
              status.textContent = '関連を外しました';
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
      status.textContent = 'そのカードは、もうありません';
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
      status.textContent = 'そのカードは、もうありません';
      return;
    }
    if (cardMap.isOpen) closeMap(false); // 移る道は先に閉じる（マップの窓）
    if (filterTag !== null && !(target.tags ?? []).includes(filterTag) && !keepShown.has(id)) {
      filterTag = null;
      keepShown.clear();
      status.textContent = 'タグの絞りを外しました（関連から移ったため）';
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
      if (!shown.has(r.id)) item.append(el('span', 'memo-pane-link-picker-hidden', '隠れ'));
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
    if (hits.length === 0) linkList.append(el('div', 'memo-pane-link-picker-empty', '当てはまるカードがありません'));
    else if (hits.length > LINK_PICK_MAX) linkList.append(el('div', 'memo-pane-link-picker-empty', `ほか ${hits.length - LINK_PICK_MAX} 枚（字で絞ってください）`));
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
      status.textContent = 'もう付いています';
      return;
    }
    if (room === 0) {
      status.textContent = `タグは1つに ${MAX_TAGS_PER_TAB} 個までです（ほかのタグを外してから付けてください）`;
      return;
    }
    change(fresh.slice(0, room), []);
    if (fresh.length > room) status.textContent = `タグは1つに ${MAX_TAGS_PER_TAB} 個までなので、${fresh.length - room} 個は付けませんでした`;
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
      b.title = on ? `タグ「${tag}」を外す（いつものタグ）` : `タグ「${tag}」を付ける（いつものタグ）`;
      b.dataset.focusKey = `card:${key}:quick:${tag}`;
      b.addEventListener('click', () => (on ? change([], [tag]) : addTags(now, [tag], change)));
      out.push(b);
    }
    const sets = el('button', 'memo-pane-tag-menu', 'セット▾');
    sets.type = 'button';
    sets.title = 'タグのセット（いつものタグを替える・全部付ける・今のタグを保存・登録）';
    sets.setAttribute('aria-haspopup', 'menu');
    sets.dataset.focusKey = `card:${key}:tagsets`;
    sets.addEventListener('click', () => {
      const r = sets.getBoundingClientRect();
      openTagSetMenu(now, change, r.left, r.bottom);
    });
    const other = el('button', 'memo-pane-tag-menu', 'その他▾');
    other.type = 'button';
    other.title = 'ほかのタグ（このメモでよく使う順）から付ける';
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
    const entries: MenuEntry[] = [{ section: 'タグのセット（右サイドバーのタグのボタンと同じ）' }];
    for (const set of book.sets) {
      const list = set.tags.filter((t): t is string => !!t);
      entries.push({
        row: set.id === cur.id ? `${set.name}（いつもの）` : set.name,
        hint: list.length > 0 ? list.join('・') : '空き',
        buttons: [
          { label: '使う', pressed: set.id === cur.id, title: 'カードに出す 6 つのボタンを、このセットにする', run: () => (tagBook.apply({ type: 'setCurrent', id: set.id }), reopen()) },
          { label: '全部付ける', close: true, run: () => (list.length > 0 ? addTags(now, list, change) : (status.textContent = 'このセットは空きです')) },
        ],
      });
    }
    entries.push('sep');
    entries.push({
      label: '今のタグをセットとして保存…',
      hint: now.length > TAG_BUTTONS ? `はじめの ${TAG_BUTTONS} 個` : `${now.length}`,
      disabled: now.length === 0 || book.sets.length >= 12,
      run: () =>
        tagMenu.prompt('新しいセットの名前', `セット${book.sets.length + 1}`, (name) => {
          tagBook.apply({ type: 'addSet', name, tags: now.slice(0, TAG_BUTTONS) });
          status.textContent = `セット「${name}」を保存して、いつものタグにしました`;
        }, { x, y }, { maxLength: 20 }),
    });
    entries.push({ label: 'いつものタグを登録…', hint: `${TAG_BUTTONS} つ`, run: () => openTagRegister(cur, x, y) });
    entries.push({ label: `「${cur.name}」の名前を変える…`, run: () => tagMenu.prompt('セットの名前', cur.name, (name) => tagBook.apply({ type: 'replaceSet', id: cur.id, name }), { x, y }, { maxLength: 20 }) });
    if (book.sets.length > 1) entries.push({ row: '', buttons: [{ label: `「${cur.name}」を消す`, confirm: 'もう一度押すと消す', close: true, run: () => tagBook.apply({ type: 'removeSet', id: cur.id }) }] });
    if (!tagBook.ready) entries.push({ note: 'タグのボタンを読み込んでいます…' });
    tagMenu.open(x, y, entries);
  }

  function openOtherTags(now: readonly string[], change: TagChange, x: number, y: number) {
    const mine = new Set(tagBook.current.tags.filter((t): t is string => !!t));
    const list = candidates.filter((t) => !now.includes(t) && !mine.has(t)).slice(0, 30);
    const pills: MenuButton[] = list.map((tag) => ({ label: tag, close: true, run: () => addTags(now, [tag], change) }));
    tagMenu.open(x, y, [
      { section: 'その他のタグ（このメモでよく使う順）' },
      ...(pills.length > 0 ? [{ pills } as MenuEntry] : [{ note: 'ほかのタグはありません（「＋タグ」で書いて付けられます）' } as MenuEntry]),
    ]);
  }

  // いつものタグ（今のセットの 6 つ）を登録する小窓。候補から選ぶか、書く。空欄は空き
  function openTagRegister(set: TagButtonSet, x: number, y: number) {
    const form = el('form', 'cell-menu-form memo-pane-tag-register');
    form.append(el('div', 'cell-menu-section', `いつものタグ（セット「${set.name}」の ${TAG_BUTTONS} つ）`));
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
      input.placeholder = `${i + 1} つ目（空き）`;
      input.setAttribute('list', list.id);
      input.setAttribute('aria-label', `いつものタグ ${i + 1} つ目`);
      const clear = el('button', 'cell-menu-small', '空ける');
      clear.type = 'button';
      clear.addEventListener('click', () => ((input.value = ''), input.focus()));
      row.append(input, clear);
      form.append(row);
      inputs.push(input);
    }
    const buttons = el('div', 'cell-menu-kind');
    const ok = el('button', 'cell-menu-small', '登録する');
    ok.type = 'submit';
    const cancel = el('button', 'cell-menu-small', 'やめる');
    cancel.type = 'button';
    cancel.addEventListener('click', () => tagMenu.close());
    buttons.append(ok, cancel);
    form.append(buttons);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const tags = inputs.map((input) => normalizeTag(input.value) || null);
      tagBook.apply({ type: 'replaceSet', id: set.id, tags });
      tagMenu.close();
      status.textContent = `いつものタグを登録しました（セット「${set.name}」）`;
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

  // mapPop：出したカード（マップの札の右クリック・並びの関連の「見る」。where で見分ける）。並べ替えのつまみの代わりに「✕ 閉じる」を出し、
  //   🔗 は使えなくする。⋯ に出す側を足す
  function commentCard(current: MemoPaneView, reply: Reply, mapPop?: PopControl, where: 'map' | 'list' = 'map') {
    const inMap = mapPop !== undefined; // 出したカード（マップ・並びのどちらでも）
    const scope: ParentNode = mapPop ? mapPop.scope : cards; // 描き直したあとに焦点を当てる欄を探す所
    const origin: RelationOrigin = !mapPop ? 'card' : where === 'list' ? 'list-pop' : 'map-pop';
    const card = el('article', 'memo-pane-card');
    card.dataset.card = reply.id;
    if (linking?.from === reply.id) card.classList.add('link-from');
    if (pickingCards && !inMap && picked.has(reply.id)) card.classList.add('picked');
    const ref = refOf(current.id);
    const head = el('div', 'memo-pane-card-head');
    const headMain = el('span', 'memo-pane-card-head-main');
    headMain.append(el('span', '', `${kindMark(reply)} ${reply.by?.name ?? 'あなた'}`), el('span', '', `· ${dateOf(reply.createdAt)}`));
    if (reply.editedAt) headMain.append(el('span', 'memo-pane-edited', '· 書き直し済み'));
    // 関連 n（隠れ m）：押すと、このカードの関連の一覧（移る・外す）。m は、絞りで見えていない相手の数
    const relations = relationsOf(current, reply.id);
    if (relations.length > 0) {
      const shown = new Set(visibleTops(current.replies, filterTag, keepShown).map((r) => r.id));
      const hidden = relations.filter((rel) => !shown.has(rel.other)).length;
      const count = el('button', 'memo-pane-link-count', hidden > 0 ? `関連 ${relations.length}（隠れ ${hidden}）` : `関連 ${relations.length}`);
      count.type = 'button';
      count.title = 'このカードの関連（移る・外す）';
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
      const closeBtn = el('button', 'memo-pane-map-card-close', '✕ 閉じる');
      closeBtn.type = 'button';
      closeBtn.title = 'このカードを閉じる（カードは消えません。Esc・札をもう一度右クリックでも閉じる）';
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
      const gripName = `「${cardLabel(reply, 16)}」を並べ替える。一覧のメモの上で離すと移します（Ctrl で写す）`;
      grip.title = gripName;
      grip.setAttribute('aria-label', gripName);
      grip.setAttribute('aria-haspopup', 'menu');
      grip.dataset.focusKey = `card:${reply.id}:move`;
      if (cardOrder === 'chain') grip.setAttribute('aria-disabled', 'true'); // つながり順の間は動かせない（押すと欄で理由を出す）
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
        box.title = on ? 'このカードの選択を外す' : 'このカードを選ぶ（Shift で範囲、Ctrl で足す・外す）';
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
      { tags: reply.tags ?? [], what: 'このカード', change: (add, remove) => ask({ command: 'changeReplyTags', id: current.id, replyId: reply.id, add, remove }) },
      { editable: true, focusKey: `card:${reply.id}:`, toast: (text) => (status.textContent = text), candidates, pinned: pinnedFeed, onClose: afterTagInput },
    );
    tags.classList.add('memo-pane-card-tags');
    tags.querySelector('.preview-tags')?.append(...quickTags(reply.tags ?? [], (add, remove) => ask({ command: 'changeReplyTags', id: current.id, replyId: reply.id, add, remove }), reply.id));
    card.append(tags);
    appendQuote(card, reply);

    if (cardEdits.has(reply.id)) {
      card.append(cardEditForm(current, reply));
    } else if (reply.text) {
      const chars = [...reply.text];
      const folded = chars.length > REPLY_FOLD && !openBodies.has(reply.id);
      const bodyText = el('p', 'memo-pane-card-body', folded ? chars.slice(0, REPLY_FOLD).join('') : reply.text);
      card.append(bodyText);
      if (chars.length > REPLY_FOLD) {
        const more = el('button', 'memo-pane-more', openBodies.has(reply.id) ? 'たたむ ▴' : '…続き ▾');
        more.type = 'button';
        more.addEventListener('click', () => {
          if (openBodies.has(reply.id)) openBodies.delete(reply.id);
          else openBodies.add(reply.id);
          if (view) renderCards(view);
        });
        card.append(more);
      }
    }
    appendImage(card, reply);
    if (reply.file && truncatedFiles.has(reply.file)) card.append(el('p', 'memo-pane-clip', '途中までです'));

    const actions = el('div', 'memo-pane-card-actions');
    // あまり使わないもの（書き出す・全体の画像を開く・フォルダで見る・コピー）は「⋯」の小さな欄へ
    const moreEntries: MenuEntry[] = [{ section: `「${cardLabel(reply, 16)}」` }];
    if (reply.image) {
      moreEntries.push({ label: '書き出す', hint: '画像をピクチャへ', run: () => void exportCardImage(reply) });
    }
    if (reply.file) {
      const fileName = reply.file;
      moreEntries.push(
        { label: '全体の画像を開く', hint: 'ピクチャの画像', run: () => openExported(fileName) },
        { label: 'フォルダで見る', hint: 'ピクチャ', run: () => revealExported(fileName) },
      );
    }
    const editingCard = cardEdits.has(reply.id);
    moreEntries.push(
      { label: 'コピー', hint: '空いたセルに貼るとメモのセル', run: () => ask({ command: 'copyComment', ref, replyId: reply.id }) },
      { label: '別のメモへ移す…', hint: editingCard ? '書き直しの途中' : 'このカードと返信', disabled: editingCard, run: () => beginSend('move', [reply.id]) },
      { label: '別のメモへ写す…', hint: editingCard ? '書き直しの途中' : '元のカードは残る', disabled: editingCard, run: () => beginSend('copy', [reply.id]) },
      { label: '単語カードにする…', hint: '写すだけ', run: () => makeVocabCard(reply, ref) },
    );
    if (!reply.by && !cardEdits.has(reply.id)) {
      const edit = action('書き直す', 'このコメントの文を書き直す（引用と画像は書き直せません）', () => {
        if (!cardEdits.has(reply.id)) cardEdits.set(reply.id, reply.text);
        if (view) renderCards(view);
        scope.querySelector<HTMLTextAreaElement>(`[data-pane-edit="${CSS.escape(reply.id)}"] textarea`)?.focus();
      });
      actions.append(edit);
    }
    const under = countUnder(current.replies, reply.id);
    const chat = action(under > 0 ? `💬 ${under}` : '💬', under > 0 ? `返信 ${under}件` : 'このコメントに返信を書く', () => {
      const opened = toggleReplies(ref, reply.id);
      if (opened && current.replies.length < MAX_REPLIES) showReplyForm(ref, reply.id);
      else if (!opened && !replyDraft(ref, reply.id)) hideReplyForm(ref, reply.id);
      if (view) renderCards(view);
      if (opened) scope.querySelector<HTMLTextAreaElement>(`[data-form="${CSS.escape(replyFormKey(ref, reply.id))}"] textarea`)?.focus();
    });
    chat.setAttribute('aria-expanded', String(repliesOpen(ref, reply.id)));
    const ai = action('相棒 ▾', '相棒（今の会話のメンバー）に返信してもらう', () => {
      toggleCompanion(ref, reply.id);
      if (view) renderCards(view);
    });
    const full = current.replies.length >= MAX_REPLIES;
    chat.disabled = full && under === 0;
    ai.disabled = full;
    if (full) ai.title = `返信は1つのメモに ${MAX_REPLIES} 件までです`;
    const remove = action(armed.has(reply.id) ? '消す？' : '×', armed.has(reply.id) ? removeAgain(current.replies, reply.id) : removeTitle(current.replies, reply.id), () => {
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
    const linkTitle = 'このカードと、ほかのカードを関連でつなぐ（相手のカードを押して、種類を選ぶ）';
    const link = el('button', 'thread-action memo-pane-card-link', '🔗');
    link.type = 'button';
    link.title = fromHere ? '関連づけをやめる（もう一度押す・Esc）' : linkTitle;
    link.setAttribute('aria-label', fromHere ? '関連づけをやめる' : linkTitle);
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
      link.title = 'マップの中では関連づけられません（並びに戻ってから 🔗）';
      link.setAttribute('aria-label', link.title);
    }
    const more = el('button', 'thread-action memo-pane-card-more', '⋯');
    more.type = 'button';
    const moreTitle = reply.image || reply.file ? 'その他（コピー・別のメモへ移す・画像の書き出しなど）' : 'その他（コピー・別のメモへ移す）';
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
        note: '右の単語帳に入ります。カードはこのメモを指します（写すだけ。元のカードは変わりません）',
        rotate: savedMarkNew(),
      },
      (value) => {
        ask({
          command: 'addCards',
          cards: [{ ...value, links: [{ kind: 'memo', id: ref.id, role: 'source' }], ...(reply.image ? { image: { kind: 'shot', id: reply.image } } : {}) }],
        });
        say('単語帳に入れました（元のカードはそのまま残ります）');
      },
    );
  }

  // マップに出したカードの ⋯：札のどちら側に出すか（今の側は ✓ を付けて押せない）
  function popSideEntries(control: PopControl): MenuEntry[] {
    const names: [MapSide, string][] = [
      ['right', '右に出す'],
      ['left', '左に出す'],
      ['top', '上に出す'],
      ['bottom', '下に出す'],
    ];
    const now = control.side();
    return [
      { section: '札のどちら側に出すか' },
      ...names.map(([side, label]): MenuEntry => (side === now ? { label: `✓ ${label}`, hint: '今の側', disabled: true } : { label, run: () => control.setSide(side) })),
    ];
  }

  function cardEditForm(current: MemoPaneView, reply: Reply) {
    const form = el('form', 'reply-form');
    form.dataset.paneEdit = reply.id;
    const text = el('textarea', 'reply-input');
    text.rows = 3;
    text.value = cardEdits.get(reply.id) ?? reply.text;
    text.setAttribute('aria-label', 'コメントを書き直す');
    if (reply.quote?.text) text.placeholder = 'この引用について書く';
    const row = el('div', 'reply-form-row');
    const count = el('span', 'reply-meter', '');
    const paintCount = () => {
      const n = [...text.value].length;
      count.textContent = `${n} / ${REPLY_FOLD}`;
      count.classList.toggle('long', n > REPLY_FOLD);
      count.title = n > REPLY_FOLD ? '長め：カードでは 280字まで見せて、続きは開きます' : '';
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
    const saveBtn = el('button', 'preview-button', '残す');
    saveBtn.type = 'submit';
    const cancel = el('button', 'preview-button', 'やめる');
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

  function paint(next: MemoPaneView | null) {
    const previous = view?.id ?? null;
    const nextId = next?.id ?? null;
    if (previous && previous !== nextId) flush(previous);
    const switched = previous !== nextId;
    view = next;
    applyCurrentLinkNames(); // 試し：セットを選んでいればその名前、選んでいなければこのメモの名前
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
      cardsDirty = false;
      armEdit = false;
      commentDraft = '';
      comment.value = '';
      paintMeter();
    }
    const head = memoTitle(next) || '（空のメモ）';
    title.textContent = `メモ：${head}`;
    sheet.hidden = !next.sheetName;
    sheet.textContent = next.sheetName ?? '';
    page.textContent = next.page.title ? `上：${next.page.title}` : '上：ページがありません';
    if (next.by) {
      const fromBot = next.by.who === 'bot';
      by.hidden = false;
      by.textContent = fromBot ? `ボット（${next.by.name}）から届いた${next.label ?? '返事'}` : `${next.label ?? '考察'}・${next.by.name}`;
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
  }

  function submitComment() {
    if (!view) return;
    const text = [...comment.value].slice(0, MAX_REPLY_TEXT).join('');
    if (!text.trim() || view.replies.length >= MAX_REPLIES) {
      comment.focus();
      return;
    }
    const id = view.id;
    commentDraft = '';
    comment.value = '';
    paintMeter();
    ask({ command: 'addMemoComment', id, text });
    reportDraft();
  }

  function sendHeight(next: number) {
    height = clampMemoPaneHeight(next);
    handle.setAttribute('aria-valuenow', String(height));
    send({ type: 'setSidebar', side: 'memo', height });
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
  });
  comment.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      submitComment();
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
        status.textContent = `ファイルが大きすぎます（${IMPORT_FILE_LABEL} まで）`;
        return;
      }
      void json.text().then(
        (text) => ask({ command: 'grokPatchText', text, name: json.name.slice(0, 120) }),
        () => (status.textContent = 'ファイルを読めませんでした'),
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
  // Esc の捕まえる段（大きく見た画像の次）：つまみを押している・ドラッグ中ならやめる（元の位置のまま。押しただけの間も区画は閉じない）
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.isComposing || !cardDrag.active) return;
      e.preventDefault();
      e.stopPropagation();
      const moving = cardDrag.moving;
      cardDrag.cancel();
      if (!moving) say('やめました（元の位置のまま）'); // つまんでいたときは onCancel が出す
    },
    true,
  );
  // Esc の捕まえる段（先に走る）：小さな欄・画像の右クリックの欄を閉じ、次に関連づけをやめる。区画は閉じない
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.isComposing) return;
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
    if (grokCardsUi.consumeEsc(e)) return;
    if (!view) return;
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
    } else if (msg.type === 'relayed' && msg.payload.kind === 'memoPaneNotice') {
      // 並べ替えを断られた：待ちを全部捨てる（左は知らせのあとに写しを送り直すので、写しの並びで描き直る）。読み上げにも出す
      if (msg.payload.undoSend && msg.payload.openMemo) showSent(msg.payload.text, msg.payload.openMemo, msg.payload.undoSend);
      else if (msg.payload.text.startsWith('並べ替えられませんでした')) {
        clearPending();
        say(msg.payload.text);
      } else status.textContent = msg.payload.text;
    }
    else if (msg.type === 'relayed' && msg.payload.kind === 'threadPending') {
      pending.splice(0, pending.length, ...msg.payload.pending);
      if (view) renderCards(view);
    } else if (msg.type === 'sidebars' && !drag && typeof msg.state.memo?.height === 'number') {
      height = clampMemoPaneHeight(msg.state.memo.height);
      handle.setAttribute('aria-valuenow', String(height));
      grokCardsUi.setVisible(msg.state.memo.visible !== false);
    }
  });

  paint(null);
  send({ type: 'ready' });
  ask({ command: 'memoPaneReady' });
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
  return below > 0 ? `このコメントを消す（その下の返信 ${below} 件も消えます）` : 'このコメントを消す';
}

function removeAgain(replies: readonly Reply[], id: string) {
  const below = countUnder(replies, id);
  const linked = replies.filter((r) => r.parent === null && r.id !== id && (r.links ?? []).some((l) => l.to === id)).length;
  const tail = linked > 0 ? `（ほかのカードからの関連 ${linked} 本も外れます）` : '';
  return below > 0 ? `もう一度押すと、このコメントとその下の返信 ${below} 件を消します${tail}` : `もう一度押すと、このコメントを消します${tail}`;
}

function memoMarkdown(view: MemoPaneView): string {
  const title = memoTitle({ text: view.text }) || '（空のメモ）';
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
      if (reply.image) lines.push(`${pad}［画像］`);
      if (reply.parent === null && reply.links) {
        const parts: string[] = [];
        for (const link of reply.links) {
          const target = view.replies.find((r) => r.id === link.to);
          if (!target) continue;
          const name = cardLabel(target, 24);
          parts.push(link.kind === 'same' ? `「${name}」と${linkKindInfo(link.kind).name}` : `「${name}」の${linkKindInfo(link.kind).name}`);
        }
        if (parts.length > 0) lines.push(`${pad}  関連：${parts.join('・')}`);
      }
      walk(reply.id, depth + 1);
    }
  };
  walk(null, 0);
  return `${lines.join('\n').trim()}\n`;
}

function mdLabel(title: string) {
  return (title || 'ページ').replace(/[\[\]]/g, '');
}

function pageFailure(reply: HostMessage | null): string {
  if (!reply || reply.type !== 'pageCaptured') return '上のページからの返事が来ませんでした（全体：返事なし）';
  if (reply.error === 'name') return 'ファイルの名前が違うので、全体は保存しませんでした（全体：名前）';
  if (reply.error === 'folder') return 'ピクチャのフォルダを用意できませんでした（全体：フォルダ）';
  if (reply.error === 'noPage') return '上のページがありません（全体：ページなし）';
  if (reply.error === 'popout') return '小窓に出ているページは、全体を撮れません（全体：小窓）';
  if (reply.error === 'notActive') return '上に見えているページではないので、全体を撮れません（全体：表示中でない）';
  if (reply.error === 'metrics') return 'ページの大きさを聞けませんでした（全体：大きさを聞けない）';
  if (reply.error === 'size') return 'ページの大きさが取れませんでした（全体：大きさが変）';
  if (reply.error === 'shot') return 'ページ全体を画像にできませんでした（全体：撮れない）';
  if (reply.error === 'write') return '全体の画像をファイルに書けませんでした（全体：ファイルに書けない）';
  if (reply.error === 'big') return '全体の画像が大きすぎて保存できませんでした（全体：大きすぎる）';
  if (reply.ok) return '全体の画像を保存できませんでした（全体：名前が空）';
  return `全体の画像を撮れませんでした（全体：${reply.error ?? '理由なし'}）`;
}

function exportFailure(reply: HostMessage | null): string {
  if (!reply || reply.type !== 'imageExported') return '書き出せませんでした（書き出す：返事なし）';
  if (reply.error === 'name') return 'ファイルの名前が違うので、書き出しませんでした（書き出す：名前）';
  if (reply.error === 'data') return 'この画像の形では書き出せませんでした（書き出す：画像の形でない）';
  if (reply.error === 'big') return '画像が大きすぎて書き出せませんでした（書き出す：大きすぎる）';
  if (reply.error === 'folder') return 'ピクチャのフォルダを用意できませんでした（書き出す：フォルダ）';
  if (reply.error === 'write') return '画像をファイルに書けませんでした（書き出す：ファイルに書けない）';
  return `書き出せませんでした（書き出す：${reply.error ?? '理由なし'}）`;
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
  if (!reply || reply.type !== 'capture') return '上のページからの返事が来ませんでした（撮る：返事なし）';
  if (reply.error === 'notActive') return '上に見えているページではないので撮れませんでした（撮る：notActive）';
  if (reply.error === 'tooBig') return '画像が大きすぎて渡せませんでした（撮る：tooBig）';
  if (reply.ok) return '上のページを画像にできませんでした（撮る：画像が空）';
  if (reply.error === 'metrics') return '上のページを画像にできませんでした（撮る：見えている範囲を聞けない）';
  if (reply.error === 'viewport') return '上のページを画像にできませんでした（撮る：見えている範囲の大きさが変）';
  if (reply.error === 'shot' || reply.error === 'capture') return `上のページを画像にできませんでした（撮る：${reply.error}）`;
  return `撮れませんでした（ページが眠っている・小窓に出ているなど。撮る：${reply.error ?? '理由なし'}）`;
}

function dateOf(ms: number) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

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
  decode: '読み込み：画像として読めない',
  empty: '読み込み：大きさが 0',
  canvas: '縮める：canvas が使えない',
  encode: '縮める：書き出せない',
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
