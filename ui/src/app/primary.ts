// 左サイドバー（メイン）
//   タブの台帳を持ち、盤面・アドレスバー・拡大表示・保存と復元・自動休眠を担当する
//   右サイドバーには、台帳の写しと「今どのタブを拡大表示しているか」を送る
import { attachGrokCards } from '../grok-cards-bridge';
import { APP_TITLE, BOT_FEATURES, HEXMEMO_URL } from '../features';
import { CHAT_SENT, isMachineTag } from '../grok-cards-tags';
import { requestPageText } from '../ai/page';
import { type CharacterId, isCharacterId, isHaiku, nameOf, teamOf, teamSpeakers } from '../ai/characters';
import { BudgetError, BUDGET_NEAR_NOTE } from '../ai/budget';
import { describeError } from '../ai/client';
import { collectDaily, dayLabel, formatDaily, startOfLocalDay, writeDaily } from '../ai/daily';
import { readAiSettings, type ThreadPost, ThreadReplyError, writeThreadReply } from '../ai/thread-ai';
import { type HostMessage, onMessage, request, send, type ShortcutAction } from '../bridge';
import {
  BAD_BOT_LINK,
  BOT_LINK_HINT,
  BOT_LINK_LABEL,
  botAppErrorText,
  botFullState,
  type BotEntry,
  BotInbox,
  botReplyMemoText,
  botMessageMemoText,
  BotStore,
  cleanExternalText,
  headOf,
  isAgentId,
  isBotId,
  isGrokBotAddress,
  MAX_BOT_NAME,
  MAX_DOCK_BOTS,
  openBotApp,
  parseAgentId,
  parseAgentInput,
  readClipboardText,
  recentReplies,
  REPLY_PREVIEW_CHARS,
  requestNo,
  writeClipboardText,
  ANSWER_LINE_CHARS,
  ANSWER_LINES_MAX,
  type BotAnswerLines,
  type BotArrival,
  type BotAwayRow,
  type BotAwayView,
  type BotReplyArrival,
} from '../bots';
import { AppStore, appFileLabel, isStoreTarget, MAX_APP_NAME, MAX_APPS, pickAppErrorText, pickAppFile, summonApp, summonResultText } from '../apps';
import { BotTeamStore } from '../bot-teams';
import { BotPresetStore } from '../bot-preset-store';
import { type BotLastChoice, BotLastRequestStore, normalizeLastChoice } from '../bot-last-request';
import { VisionStore } from '../visions';
import { BLOCK_NOTE, ensureBlocklist, isBlockedUrl, pageIsBlocked, redactBlockedUrls } from '../blocklist';
import { type LikeLevel, likeLevel } from '../likes';
import {
  CLIPBOARD_ERROR_TEXT,
  ClipboardSender,
  type DraftRequest,
  type HookPostResult,
  isHookTicket,
  type PasteClipboard,
  type PasteRestore,
  PasteWatch,
  type SendAfter,
  type SendError,
  type SendResult,
  WebhookSender,
} from '../bot-send';
import { copyShotWithText, type ShotRef } from '../bot-shot';
import { addSingleDraft, flagsOf, newDraftId } from '../drafts';
import { botAnswerLine, botAnswerNoteText, botAnswerOneLine, botAnswerPoints } from '../bot-markdown';
import { BOT_LIMITS, cleanBotLine, cleanPresetIds, cutChars, isBotMark, RELAY_REQUEST_ID_RE, stripUrlQuery } from '../bot-replies';
import { cleanRoleText } from '../bot-roles';
import { buildTeamHandoffText } from '../bot-teams';
import { byPosition, type CellItem, type CellSet, CellSetStore, cellsOfTabs, hexMemoRecords, readClipboard, writeCellsToClipboard } from '../cellsets';
import { HOME_URL, SEARCH_URL } from '../config';
import { captureImageName, type CaptureFromKind, clipFromName, isCaptureId } from '../captures';
import { deleteData, readData, writeData } from '../data';
import { type Hex, hexKey, nearestFree } from '../hex';
import { loadTagRegistry, savedHexMemoTarget, sendToHexMemo } from '../integrations/hexmemo';
import { ISLAND_ASK_MAX, islandAskText } from '../island-ask';
import { IslandStore, islandNameSuggestion, layoutIslands, newIslandId, placeCluster, placeShape } from '../islands';
import { LINK_KIND_DEFAULT_NAMES, LINK_KINDS, type LinkKind, MAX_LINKS_PER_CARD } from '../memo-card-links';
import { BOARD_LINK_NAME_MAX, boardKindName, parseBoardLinkNames, setBoardLinkNames } from '../board-links';
import { buildExport, type ExportScope, exportFileName } from '../grok-export';
import { type AppliedStep, applyItem, type GrokPatch, type ImportSheetUndo, isBackup, PATCH_REASON_TEXT, type PatchBackup, type PatchHistoryItem, type PatchWorld, parseHistory, parsePatch, parsePatchText, type PlanItem, planPatch, undoConflicts, undoStep, type WorldTab } from '../grok-patch';
import { GrokPatchView } from '../panels/grok-patch-view';
import { BoardLinkStore, boardLinkSentence, type CellRef, findDuplicate, memoRef, tabRef } from '../board-links';
import { MemoPaneHost, readMemoPanePrefs } from '../memo-pane-host';
import { isSpecialCell, MAX_MEMO_TEXT, type MemoCell, type MemoDraft, memoTitle, MemoStore, newMemoId, toMemoIndexItem, toRightMemo, type SendRepliesResult } from '../memocells';
import { searchMemos } from '../memo-search';
import { CellMenu, type MenuButton, type MenuEntry, showToast } from '../panels/cell-menu';
import { FaceEditor, type FaceResult, shrinkImage } from '../panels/face-editor';
import type { BotActions } from '../panels/bot-card';
import { type MemoActions, MemoEditor } from '../panels/memo-card';
import type { PreviewActions } from '../panels/preview';
import { PreviewHost } from '../panels/preview-host';
import { TagPad, type TagUse } from '../panels/tag-pad';
import type { ThreadActions, ThreadUi } from '../panels/thread-view';
import { isSleepSettings, loadPrefs, MAX_POPOUTS, savePrefs } from '../prefs';
import { ReadingTracker } from '../reading';
import { ReminderStore } from '../reminders';
import { siteHost } from '../reminder-when';
import { chooseMediaFile, fileNameOf, isImageFileUrl, isMediaFileUrl } from '../reader/media';
import { isVideoUrl } from '../reader/youtube';
import { savedMarkNew } from '../rotate';
import { newLaneId, RouteRecorder, routeLayout, routeName, RouteStore, type TabTrail } from '../routes';
import { normalizeIslandName, toSavedTab, toSession } from '../session';
import { decideSessionStart, SAVE_FAILED_TEXT, SaveHealth, sessionNoticeText } from '../session-guard';
import { SessionNotice } from '../panels/session-notice';
import { THEME_APPLIED, windowThemeMessage } from '../theme';
import { startThemeMenu } from '../theme-menu';
import { buildArchive, deleteArchive, isArchiveId, listArchives, markRestored, newArchiveId, readArchive, sameContent, type SheetArchive, type SheetArchiveMeta, writeArchive } from '../sheet-archive';
import { sheetSetsIn } from '../rightsheets';
import { BoardSheetSlots, SHEET_SLOT_COUNT } from '../sheet-shortcuts';
import { CAPTURE_SHEET, isSheetId, MAIN_SHEET, MAX_SHEETS, RIGHT_MEMO_SHEET, SheetStore } from '../sheets';
import { Sidebar, type SidebarDeps } from '../sidebar';
import { SheetPeek } from '../panels/sheet-peek';
import { activationMovesBoard } from '../popup-gesture';
import { SleepManager } from '../sleep';
import { type Tab, TAB_LOOKS, type TabLook, TabStore, cleanComment } from '../tabs';
import { TagButtonStore } from '../tagbuttons';
import { changeTagList, MAX_TAGS_PER_TAB, normalizeTags, TAG_PALETTE } from '../tags';
import { cardsLinkedTo, cardsOnPage, findVocabTab, type VocabLink, VocabStore } from '../vocab';
import { MAX_REPLIES, type PendingReply, parseQuote, quoteMarkScript, regraft, type Reply, type ReplyAuthor, samePage, type ThreadRef, threadKey } from '../threads';
import { Thumbnails } from '../thumbs';
import type { CompanionEvent, HexMemoRecord, IslandDraft, PreviewPlacement, RelayCommand, RelayPayload, SidebarState, TabNote } from '../types';
import { $, debounce, el, throttle } from '../util';
import { ClosedTabStore } from '../closed-tabs';
import type { ShelfView } from '../prefs';
import { IMPORT_FILE_BYTES, IMPORT_FILE_LABEL, withinImportBytes } from '../import-limits';
import { detectJsonKind, parseInterchange, readJson } from '../memo-interchange';
import { type ArchiveResult, createInterchangeFlow } from './interchange-flow';
import { newReplyId } from '../threads';
import { newSheetId } from '../sheets';

export function startPrimary() {
  const store = new TabStore();
  const thumbs = new Thumbnails();
  const prefs = loadPrefs();
  setBoardLinkNames(prefs.boardLinkNames); // 盤面の関連の種類の名前
  const savePrefsSoon = debounce(() => savePrefs(prefs), 300);
  const sleep = new SleepManager(store, prefs.sleep);
  let sidebars: SidebarState = { left: { visible: true, width: 280 }, right: { visible: false, width: 320 } };
  let sessionReady = false; // 前回のタブを読み込み終えるまでは保存しない（空で上書きしないように）
  let sessionWritable = true; // session.json に書いてよい（読めなかったときは、使う人が決めるまで false。session-guard.ts）

  // ---------- タブを作ってもらう ----------
  // C++ に頼んだ後、tabCreated が返ってきたときに使う情報を、頼んだ番号（requestId）ごとに覚えておく
  interface Pending {
    uid?: string; // 前回のタブの名前（盤面の関連の線がつながったままになる）
    sheet?: string; // 置くシート（頼んだときに決める。無ければ、そのとき見ていたシート）
    pos?: Hex;
    title?: string;
    favicon?: string;
    keepAwake?: boolean;
    notes?: TabNote[];
    readEdges?: number;
    liked?: number;
    tags?: string[];
    island?: string;
    trail?: TabTrail;
    image?: string;
    comment?: string;
    look?: TabLook;
    activate?: boolean;
    follow?: boolean; // false：表示しても、盤面をそのタブのシートへ移さない（前回の続きを開くとき）
    background?: boolean; // 裏で読み込む（表示しない。ページはこのまま）
    addedLead?: string; // 裏で足せたときのお知らせの書き出し（「表紙をつけて、」など。無ければ「新しいタブを、」）
    branchFrom?: number; // ページのリンクから足したタブ：このタブの順路の「枝」にする
  }
  const pending = new Map<number, Pending>();
  const createdWaiters = new Map<number, (id: number) => void>(); // 新しいタブの番号が届いたら
  let nextRequestId = 1;
  const quietActivation = new Set<number>(); // 表示しても、盤面をそのタブのシートへ移さないタブ（閉じた後に選んだタブなど）

  // タブを頼む。シートは頼んだときに決める（返事が来るまでに、見ているシートが変わっても）
  //   置く場所は、返事が来るまで「予約」しておく（続けて貼ったときに、同じ場所を選ばないように）
  function requestTab(url: string, options: Pending & { lazy?: boolean; parentId?: number | null } = {}) {
    const requestId = nextRequestId++;
    const sheet = options.sheet && sheets.get(options.sheet) ? options.sheet : sheets.current;
    let pos = options.pos;
    if (pos && isTaken(pos, sheet)) pos = nearestFree(pos, (h) => isTaken(h, sheet));
    pending.set(requestId, { ...options, sheet, pos });
    const parentId = options.parentId === undefined ? store.activeId : options.parentId;
    send({ type: 'createTab', url, parentId, requestId, lazy: options.lazy, ...(options.background && !options.lazy ? { background: true } : {}) });
    return requestId;
  }

  // リンクを、裏で読み込む新しいタブにする（表示中のページはそのまま）。開いた元のタブの隣に置く（同じシート）
  //   title：リンクの文字（読み込むまでの題名）　image・comment：表紙の画像とコメント
  function openLinkInBackground(url: string, from: number | null, extra: { title?: string; image?: string; comment?: string; lead?: string } = {}) {
    if (!/^https?:\/\//i.test(url)) return;
    const parent = from === null ? undefined : store.get(from);
    const title = [...(extra.title ?? '').replace(/\s+/g, ' ').trim()].slice(0, 200).join('');
    requestTab(url, {
      background: true,
      parentId: parent ? parent.id : null,
      sheet: parent?.sheet,
      ...(title ? { title } : {}),
      ...(extra.image ? { image: extra.image } : {}),
      ...(extra.comment ? { comment: extra.comment } : {}),
      ...(extra.lead ? { addedLead: extra.lead } : {}),
      ...(parent ? { branchFrom: parent.id } : {}),
    });
  }

  // ページのリンクから開く新しいタブを、いつも裏で開くか（C++ に伝える。起動したときと、変えたとき）
  function syncLinkOpen() {
    send({ type: 'setLinkOpen', background: prefs.linkOpen === 'back' });
  }
  function setLinkOpen(mode: 'front' | 'back') {
    prefs.linkOpen = mode;
    savePrefs(prefs);
    syncLinkOpen();
    toast(mode === 'back' ? 'ページのリンクから開くタブは、いつも裏で開いてセルに足します（大きさの決まった小さな窓は表に出します）' : 'ページのリンクから開くタブは、今までどおり表に出します');
  }

  // 新しいタブ（今見ているシートに。今のタブがこのシートに無ければ、盤面のまん中に見えている所の近く）
  const createTab = (url = HOME_URL, at?: Hex) => requestTab(url, { pos: at ?? (activeOn(sheets.current) ? undefined : sidebar.centerHex) });

  // 外から「このページを開いて」と頼まれたとき（起動時に渡された URL・すでに動いている窓へ渡された URL。六角メモのブラウザ版の起動ファイルなど）
  //   同じページのタブが前回からあれば、新しく作らずそのタブを出す。前回のタブを並べ終えるまで待ってから決める
  const externalUrls: string[] = [];
  function openExternalUrl(url: string) {
    if (!/^https?:\/\//i.test(url)) return;
    externalUrls.push(url);
    flushExternalUrls();
  }
  function flushExternalUrls() {
    if (!sessionReady || pending.size > 0) return;
    const created: string[] = []; // この回に新しく頼んだページ（同じページが続けて頼まれても、タブは1つだけ）
    for (const url of externalUrls.splice(0)) {
      const existing = store.all().find((t) => samePage(t.url, url));
      if (existing) {
        send({ type: 'activateTab', id: existing.id });
      } else if (!created.some((u) => samePage(u, url))) {
        created.push(url);
        createTab(url);
      }
    }
  }
  // ---------- シート（ハニカムの盤面を何枚も持つ） ----------
  //   タブ・メモのセルは、どれか1枚のシートに置く。位置はシートごと。シートへの入口はメモのセルの一種
  const sheets = new SheetStore();
  const sheetSlots = new BoardSheetSlots(); // 盤面の右クリックに出す、シートのボタン（6つまで。この画面だけ）
  store.sheetNow = () => sheets.current;

  // ---------- 盤面とリスト ----------
  // メモのセル（ページではないセル）。新しいタブは、メモのセルのある所と、これから開くタブの場所には置かない
  const memos = new MemoStore();
  memos.sheetNow = () => sheets.current;
  void memos.load().then(() => {
    ensureSheets();
    // AR0：読み直しても台帳を読めなかった。この起動では書かない（空で上書きしない）
    if (memos.loadFailed) showToast(board, 'メモの台帳を読めませんでした。いま書いたメモは保存されません。ブラウザを開き直してください', 15000);
  });
  store.blocked = (h, sheet) => !!memos.at(h, sheet) || reservedAt(h, sheet);
  // ボットの台帳（ui-data\bots\index.json）。ボットのセル（memo.bot）の名前とリンクの id はここ。セルを外しても残す
  const bots = new BotStore();
  void bots.load();
  // アプリの台帳（ui-data\apps.json）。アプリのセル（memo.app）の名前とファイルとアイコンはここ。セルを外しても残す
  const apps = new AppStore();
  void apps.load();
  // グループ（ui-data\bots\groups.json。巣の席・各ボットの役とは別。docs/plan-bot-groups.md G1）。台帳から消えたボットの割り当ては外す
  const botTeams = new BotTeamStore((id) => !!bots.get(id), () => bots.ready);
  void botTeams.load();
  bots.onChange(() => botTeams.prune());
  // 依頼の小窓の定型（ui-data\bots\presets.json。依頼の小窓 v2・R4a）。無ければ用意した定型を書く。右と読む画面は写しを見る
  const botPresets = new BotPresetStore();
  void botPresets.load();
  // 前回送った依頼の選び方（ui-data\bots\last-request.json。R6「前と同じで」）。小窓の依頼を送れたときだけ書く。文は入れない
  const botLastRequest = new BotLastRequestStore();
  void botLastRequest.load();
  // ボットの返事の受け取り（第2段 S2.3）：確かめて pending.json・記録に書き、C++ に答える。依頼もここで作って覚える
  const botInbox = new BotInbox(bots);
  botInbox.start();
  // Grok Visions（S3.7b）：依頼と合う1通目の返事に「## Vision」の節があれば、1件1ファイルで残す（ui-data\visions\。確かめ終えて記録に書けたあと）
  const visions = new VisionStore();
  void visions.load();
  botInbox.onReply((reply) => void visions.addReply({ ...reply, botName: bots.get(reply.botId)?.name ?? '' }));
  let botAppMissing = false; // Grok Bot アプリが見つからなかった（openBotApp が noApp）。開けたら戻す。覚えておくのはこの窓が開いている間だけ
  const board = $('board');
  // 下のメモの区画。盤面より先に作る（ダブルクリックから呼ぶ）。拡大表示は、あとからつながる
  const paneHooks: { preview: { render(): void } | null } = { preview: null };
  const memoPane = new MemoPaneHost({
    memos,
    sheets,
    store,
    toast: (text) => showToast(board, text, 4500),
    onOpenChange: (id) => {
      sidebar.setPaneMemo(id);
      paneHooks.preview?.render();
    },
  });
  let pinnedAppId: string | null = null; // いま中央に出しているアプリ（もう一度ダブルクリックで最前面をやめる）
  let pinnedMemoId: string | null = null;
  const overlapTold = new Set<string>(); // サイドバーにはみ出す知らせは、アプリごとに1回
  const sidebarDeps: SidebarDeps = {
      store,
      memos,
      sheets,
      thumbs,
      bots,
      apps,
      pinnedAppId: () => pinnedAppId,
      botAppMissing: () => botAppMissing,
      botActivity: (id) => (botInbox.ready ? botInbox.activity(id) : undefined),
      backTo: () => backTarget(),
      captureImage: (id) => captureThumb(id),
      captureMarks: (id) => captureMarkCount(id),
  };
  const sidebar = new Sidebar(
    board,
    sidebarDeps,
    {
      activate: (id) => send({ type: 'activateTab', id }),
      close: (id) => send({ type: 'closeTab', id }),
      createAt: (pos) => createTab(HOME_URL, pos),
      hover: (id) => {
        preview.setPointer(id);
        relayFocus();
      },
      clickPins: () => preview.clickPins,
      pinTab: (id) => preview.pinTab(id),
      pinMemo: (id) => preview.pinMemo(id),
      unpinTab: () => preview.unpinTab(),
      boardDrawn: () => preview.reposition(),
      tabDrag: (on) => {
        preview.setDragHidden(on); // 詳細カードを隠す（固定は残し、終わったら戻す）
        peekBoard?.holdPopups(on); // 小窓の吹き出しも、ドラッグが終わるまで出さない
      },
      viewChanged: () => {
        prefs.boards[sheets.current] = sidebar.view;
        savePrefsSoon();
      },
      contextMenu: (info) => openCellMenu(info),
      islandMenu: (id, x, y) => openIslandMenu(id, x, y),
      boardLinkMenu: (id, x, y) => openBoardLinkMenu(id, x, y),
      finishBoardLink: (from, to, kind) => finishBoardLink(from, to, kind),
      boardLinkingChanged: (on) => {
        if (on) toast('相手のセルを押してください（Esc・右クリック・空いた所でやめる）', 6000);
      },
      renameIsland: (id, x, y) => renameIsland(id, { x, y }),
      hoverMemo: (id) => preview.setMemoPointer(sheetPeek.isOpen && memos.get(id)?.portal ? null : id), // 小窓を開いている間は、入口のカードを出さない
      openMemo: (id) => preview.showMemo(id),
      openMemoPane: (id) => memoPane.open(id),
      editMemo: (id) => editMemo(id),
      openPortal: (id) => openPortal(id),
      peekPortal: (id) => peekPortal(id),
      dropOnPortal: (cell, portal) => dropOnPortal(cell, portal),
      openBot: (id) => openBot(id),
      focusApp: (id) => preview.showMemo(id),
      launchApp: (id) => launchAppCell(id),
      openCapture: (id) => revealCapture(id),
      sheetMenu: (x, y, keyboard) => openSheetMenu(x, y, keyboard),
      back: () => goBack(),
      goToActive: () => {
        const active = store.active;
        if (!active) return;
        switchSheet(active.sheet);
        if (sheets.current === active.sheet) sidebar.recenter(); // 移れなかったとき（書きかけの欄があるなど）は何もしない
      },
    },
  );
  if (prefs.boards[MAIN_SHEET]) sidebar.view = prefs.boards[MAIN_SHEET];

  // 今のタブ（そのシートにあれば）
  const activeOn = (sheet: string) => (store.active?.sheet === sheet ? store.active : undefined);
  // そのシートに新しいセルを置くときの目安：今のタブ（そのシートにあれば）→ 見ているシートなら盤面のまん中 → シートの最後のタブ → 中心
  function anchorOn(sheet: string): Hex {
    const active = activeOn(sheet);
    if (active) return active.pos;
    if (sheet === sheets.current) return sidebar.centerHex;
    return store.inSheet(sheet).at(-1)?.pos ?? memos.inSheet(sheet).at(-1)?.pos ?? { q: 0, r: 0 };
  }
  // 返事待ちのタブの場所（予約）
  function reservedIn(sheet: string): Hex[] {
    return [...pending.values()].filter((p) => p.sheet === sheet && p.pos).map((p) => p.pos as Hex);
  }
  function reservedAt(h: Hex, sheet: string) {
    const key = hexKey(h);
    return reservedIn(sheet).some((r) => hexKey(r) === key);
  }
  // そのシートでふさがっているか（タブ・メモのセル・予約）
  const isTaken = (h: Hex, sheet: string) => !!store.tabAt(h, sheet) || !!memos.at(h, sheet) || reservedAt(h, sheet);

  // ---------- シートを移る ----------
  // シートが変わったら：開いていた欄とメニューを閉じ、選択を忘れ、そのシートの盤面の位置にする
  function afterSheetChange() {
    cellMenu.close();
    memoEditor.close();
    faceEditor.close();
    sheetPeek.close(); // シートを変えた：小窓は閉じる
    sidebar.sheetChanged(prefs.boards[sheets.current] ?? null);
    sidebar.setIslandDrafts([]);
    preview.resetFocus();
    updateRouteView();
    relayRoutes();
    savePrefsSoon();
  }

  // 書きかけの欄があるか（見た目の欄で何か変えた・メモに書いた）。あれば、シートを移ると消えてしまう
  const editorsBusy = () => faceEditor.isDirty || memoEditor.hasText;
  const busyToast = () => toast('書きかけの欄を「残す」か「やめる」で閉じてから、シートを移ってください');

  // シートを移る（書きかけの欄があれば移らずに知らせる）。移ったら true
  function switchSheet(id: string): boolean {
    if (id === sheets.current || !sheets.get(id)) return false;
    if (editorsBusy()) {
      busyToast();
      return false;
    }
    prefs.boards[sheets.current] = sidebar.view;
    if (!sheets.setCurrent(id)) return false;
    afterSheetChange();
    return true;
  }

  // ← で戻る先：来た順（履歴）→ 無ければ、このシートへの入口があるシート → メイン（起動し直した後など）
  function backTarget(): string | null {
    if (sheets.backTo) return sheets.backTo;
    const cur = sheets.current;
    if (cur === MAIN_SHEET) return null; // 試し：メインへの入口をほかのシートに置いても、メインに ← は出さない
    const parent = memos.list().find((m) => m.portal === cur && m.sheet !== cur && sheets.get(m.sheet))?.sheet;
    return parent ?? (cur !== MAIN_SHEET ? MAIN_SHEET : null);
  }

  function goBack() {
    if (editorsBusy()) {
      busyToast();
      return;
    }
    prefs.boards[sheets.current] = sidebar.view;
    if (sheets.back()) {
      afterSheetChange();
      return;
    }
    const target = backTarget();
    if (target && sheets.setCurrent(target, false)) afterSheetChange();
  }

  // セルが指しているシートが台帳に無ければ、名前だけの仮のシートを足す（前回の続きを読み終えてから）
  //   「撮ったもの」は、空でも一覧に出す
  function ensureSheets() {
    if (!sessionReady || !memos.ready) return;
    sheets.ensure([CAPTURE_SHEET, ...store.all().map((t) => t.sheet), ...memos.list().flatMap((m) => [m.sheet, m.portal ?? ''])]);
    if (captureBoardWait) applyCaptureBoard(captureBoardWait);
  }

  // 右から届いた撮影の一覧。画像は左がファイルから読む。スタンプの数はセルに書かない
  const captureThumbs = new Map<string, string>();
  const shelfHooks = { refresh: () => {} }; // 試し：左の下の棚を描き直す（棚を作ったあとで入れる）
  let captureItems: { id: string; createdAt: number }[] = []; // 試し：棚の「撮ったもの」（新しい順）
  const captureLoading = new Set<string>();
  // 縮図の世代（id ごと）。読んでいる間に captureChanged（隠す・取り消す）が来たら進め、古い読み込みの結果は捨てる
  const captureThumbGen = new Map<string, number>();
  const captureMarks = new Map<string, number>();
  let captureBoardWait: { id: string; marks: number; createdAt: number }[] | null = null;

  function captureThumb(id: string): string | undefined {
    if (!isCaptureId(id)) return undefined;
    const cached = captureThumbs.get(id);
    if (cached || captureLoading.has(id)) return cached;
    captureLoading.add(id);
    const generation = captureThumbGen.get(id) ?? 0;
    void readData<{ data?: unknown }>(captureImageName(id)).then((saved) => {
      captureLoading.delete(id);
      if ((captureThumbGen.get(id) ?? 0) !== generation) return; // 読んでいる間に隠す・取り消すが来た。新しい縮図は captureChanged が入れてある
      if (typeof saved?.data === 'string' && saved.data.startsWith('data:image/jpeg')) {
        captureThumbs.set(id, saved.data);
        sidebar.requestRender();
        shelfHooks.refresh();
      }
    });
    return undefined;
  }

  function captureMarkCount(id: string) {
    return captureMarks.get(id) ?? 0;
  }

  function applyCaptureBoard(items: { id: string; marks: number; createdAt: number }[]) {
    const clean = items
      .filter((item) => isCaptureId(item.id) && Number.isFinite(item.createdAt))
      .map((item) => ({ id: item.id, marks: Math.max(0, Math.min(40, Math.round(Number(item.marks)) || 0)), createdAt: item.createdAt }));
    captureMarks.clear();
    for (const item of clean) captureMarks.set(item.id, item.marks);
    captureItems = [...clean].sort((a, b) => b.createdAt - a.createdAt);
    shelfHooks.refresh();
    if (!sessionReady || !memos.ready) {
      captureBoardWait = clean;
      return;
    }
    captureBoardWait = null;
    sheets.ensure([CAPTURE_SHEET]);
    const wanted = new Set(clean.map((item) => item.id));
    for (const memo of memos.list()) {
      if (memo.capture && !wanted.has(memo.capture)) memos.remove(memo.id);
    }
    const have = new Set(memos.list().flatMap((memo) => (memo.capture ? [memo.capture] : [])));
    const missing = clean.filter((item) => !have.has(item.id)).sort((a, b) => a.createdAt - b.createdAt);
    for (const item of missing) {
      const pos = nearestFree({ q: 0, r: 0 }, (hex) => isTaken(hex, CAPTURE_SHEET));
      if (!memos.add({ sheet: CAPTURE_SHEET, pos, text: '', capture: item.id })) break;
    }
    for (const item of clean) void captureThumb(item.id);
    sidebar.requestRender();
  }

  function revealCapture(id: string) {
    if (!isCaptureId(id)) return;
    sendToRight({ kind: 'captureReveal', id });
  }
  void loadTagRegistry().then(() => sidebar.requestRender()); // 六角メモのタグと同じ色にする

  // ---------- 島とタグ ----------
  const islands = new IslandStore();
  const boardLinks = new BoardLinkStore(); // 盤面の関連の線（session.json の boardLinks）
  let highlightTag: string | null = null; // このタグのタブだけを目立たせている
  let highlightLike: LikeLevel | null = null; // このいいねのタブとメモだけ（タグとは同時に付かない）
  islands.onChange(() => sidebar.setIslands(islands.list()));
  boardLinks.onChange(() => sidebar.setBoardLinks(boardLinks.list()));

  // 試し：シートの入口の小窓（1回押しでのぞく。中の盤面は、のぞくだけの Sidebar）
  let peekBoard: Sidebar | null = null;
  islands.onChange(() => peekBoard?.setIslands(islands.list()));
  boardLinks.onChange(() => peekBoard?.setBoardLinks(boardLinks.list()));
  const sheetPeek = new SheetPeek({
    host: board,
    sheets,
    makeBoard: (root, previewOpts) => {
      const noop = () => {};
      peekBoard = new Sidebar(
        root,
        sidebarDeps,
        {
          // セルの右クリックは盤面と同じメニュー。セルのドラッグや空いた所のタブ作成はしない（noop のまま）
          // タブの左クリックは詳しいカード（clickPins）。短い間の2回目とカードの「開く」でサイトを開く。盤面はそのシートへ移さない
          // 小窓の中ではタブをドラッグで動かさない（動かすと盤面がずれるだけ。詳細カードはセルについて来る）
          clickPins: () => true,
          pinTab: (id) => preview.pinTabFromPeek(id, () => peekBoard?.anchorOf(id) ?? null),
          dismissPeekDetail: () => preview.releasePeekPin(),
          boardDrawn: () => preview.reposition(),
          activate: (id) => activateWithoutMovingPeek(id),
          close: noop,
          createAt: noop,
          hover: noop, // 乗せたときのカードは出さない（小窓に重なる）。吹き出しは小窓の中で出る
          viewChanged: noop,
          prepareContextSelection: (id, memo) => selectPeekedCell(id, memo),
          contextMenu: (info) => openCellMenu(info),
          hoverMemo: noop,
          openMemo: (id) => preview.showMemo(id),
          openMemoPane: (id) => memoPane.open(id),
          editMemo: (id) => editMemo(id),
          openPortal: noop, // 入口は小窓の進み方（1回で窓の中、2回で移る）。盤面の openPortal は使わない
          dropOnPortal: noop,
          openBot: (id) => openBot(id),
          focusApp: (id) => preview.showMemo(id),
          launchApp: (id) => launchAppCell(id),
          openCapture: (id) => revealCapture(id),
          sheetMenu: noop,
          back: noop,
          goToActive: noop,
        },
        previewOpts,
      );
      peekBoard.copyLook(sidebar);
      peekBoard.setIslands(islands.list());
      peekBoard.setBoardLinks(boardLinks.list());
      return peekBoard;
    },
    portalTarget: (id) => memos.get(id)?.portal ?? null,
    anchorOf: (id) => sidebar.anchorOfMemo(id),
    enter: (id, pos) => {
      if (!sheets.get(id)) return false;
      if (id !== sheets.current && !switchSheet(id)) return false; // 書きかけの欄があるなど：移らない（小窓は残す）
      sheetPeek.close();
      if (pos) sidebar.centerOn(pos);
      return true;
    },
    escBlocked: () => cellMenu.isOpen || memoEditor.isOpen || faceEditor.isOpen,
    dismissTabDetail: () => preview.releasePeekPin(),
    moved: () => preview.reposition(),
  });

  // 小窓に見えているシートのタブを開いても、盤面は移さない（今のシートなら、もともと移らない）
  function activateWithoutMovingPeek(id: number) {
    const tab = store.get(id);
    const peekSheet = sheetPeek.isOpen ? sheetPeek.sheetId : null;
    if (tab && !activationMovesBoard(tab.sheet, sheets.current, peekSheet)) quietActivation.add(id);
    send({ type: 'activateTab', id });
  }

  // 小窓で右クリックしたセルが、今見ているシートにあるときだけ、盤面の選択を合わせる
  //   ほかのシートのセルは盤面の選択に入らない（selection が落とす）。メニュー側がセル1個として扱う
  function selectPeekedCell(id: number | null, memo: string | null) {
    const tab = id !== null ? store.get(id) : undefined;
    const cell = memo !== null ? memos.get(memo) : undefined;
    if (tab && tab.sheet !== sheets.current) return;
    if (cell && cell.sheet !== sheets.current) return;
    if (!tab && !cell) return;
    if (tab && sidebar.selection().includes(tab.id)) return;
    if (cell && sidebar.memoSelection().includes(cell.id)) return;
    sidebar.setSelection(tab ? [tab.id] : [], cell ? [cell.id] : []);
  }

  // 入口を1回押した・「小窓で見る」：行き先のシートを小窓でのぞく
  function peekPortal(id: string) {
    const memo = memos.get(id);
    if (!memo?.portal) return;
    if (!sheets.get(memo.portal)) {
      toast('行き先のシートが見つかりません（消されたようです）');
      return;
    }
    peekBoard?.copyLook(sidebar);
    if (sheetPeek.open(id, sidebar.anchorOfMemo(id))) preview.hidePortalCard((m) => !!memos.get(m)?.portal); // 乗せていた入口のカードを消す
  }

  // 島を作って、入るタブをひとかたまりに寄せる（ほかの島に入っていたタブは、新しい島へ移る）
  function createIslands(drafts: IslandDraft[]) {
    const groups: { tabIds: number[] }[] = [];
    for (const draft of drafts) {
      const tabIds = [...new Set(draft.tabIds)].filter((id) => store.get(id));
      if (tabIds.length === 0) continue;
      const id = newIslandId();
      islands.add({ id, name: normalizeIslandName(draft.name), color: draft.color || islands.nextColor() });
      store.setIsland(tabIds, id);
      groups.push({ tabIds });
    }
    // 寄せるのはシートごと（ほかのシートのタブは、そのシートの中で寄せる）
    const positions = new Map<number, Hex>();
    for (const sheet of new Set(groups.flatMap((g) => g.tabIds.map((id) => store.get(id)?.sheet ?? MAIN_SHEET)))) {
      const inSheet = (id: number) => store.get(id)?.sheet === sheet;
      const sheetGroups = groups.map((g) => ({ tabIds: g.tabIds.filter(inSheet) })).filter((g) => g.tabIds.length > 0);
      for (const [id, pos] of layoutIslands(store.inSheet(sheet), sheetGroups, [...memos.inSheet(sheet).map((m) => m.pos), ...reservedIn(sheet)])) positions.set(id, pos);
    }
    store.setPositions(positions);
    sidebar.setIslandDrafts([]);
  }

  // 島の案を、寄せた後の形で盤面に点線で見せる
  function previewIslands(drafts: IslandDraft[] | null) {
    if (!drafts) {
      sidebar.setIslandDrafts([]);
      return;
    }
    // 見ているシートのタブだけ（ほかのシートのタブは、そのシートで寄せる）
    const sheet = sheets.current;
    const here = drafts.map((d) => ({ ...d, tabIds: d.tabIds.filter((id) => store.get(id)?.sheet === sheet) }));
    const positions = layoutIslands(store.inSheet(sheet), here, [...memos.inSheet(sheet).map((m) => m.pos), ...reservedIn(sheet)]);
    sidebar.setIslandDrafts(
      here.map((draft) => ({ draft, cells: draft.tabIds.map((id) => positions.get(id)).filter((h): h is Hex => !!h) })),
    );
  }

  // 集めた情報を、眠ったタブとして島に並べる。もう開いているページは、そのタブを島に入れる
  function openAsIsland(name: string, items: { url: string; title: string; liked: number }[]) {
    const islandName = normalizeIslandName(name);
    // 島は、見ているシートの中で探す・作る（もう開いているタブも、このシートのものだけ島に入れる）
    const sheet = sheets.current;
    const here = store.inSheet(sheet);
    let island = islands.list().find((i) => i.name === islandName && here.some((t) => t.island === i.id));
    if (!island) {
      island = { id: newIslandId(), name: islandName, color: islands.nextColor() };
      islands.add(island);
    }
    const id = island.id;
    const fresh = items.filter((item) => /^https?:\/\//i.test(item.url)).slice(0, 12);
    const open = fresh.filter((item) => here.some((t) => t.url === item.url));
    for (const item of open) store.setIsland(here.filter((t) => t.url === item.url).map((t) => t.id), id);
    const toOpen = fresh.filter((item) => !open.includes(item));
    const members = store.inSheet(sheet).filter((t) => t.island === id).map((t) => t.pos);
    const cells = placeCluster(allCells(sheet), toOpen.length, anchorOn(sheet), members);
    toOpen.forEach((item, i) => {
      requestTab(item.url, { lazy: true, parentId: null, sheet, pos: cells[i], title: item.title, liked: item.liked, island: id });
    });
  }

  // ---------- 順路（リンクをたどった道） ----------
  const routes = new RouteStore();
  const recorder = new RouteRecorder(store, routes, HOME_URL);
  let pinnedRoute: string | null = null; // 右の「順路」パネルで選んだ順路（null なら表示中のタブの順路を出す）
  void routes.load();

  function shownRouteId(): string | null {
    const id = pinnedRoute && routes.get(pinnedRoute) ? pinnedRoute : (store.active?.trail?.route ?? null);
    return id && routes.get(id) ? id : null;
  }
  function updateRouteView() {
    sidebar.setRoute(prefs.showRoute ? (routes.get(shownRouteId()) ?? null) : null);
  }
  store.onChange(updateRouteView);
  routes.onChange(updateRouteView);

  // 順路の段を開く：もうその段にいるタブがあればそれを表示。reuse なら、順路にいる表示中のタブをその段へ移す。
  //   それ以外は、新しいタブで開く（そのタブも順路の続きとして記録する）
  function openRouteStep(routeId: string, stepId: string, reuse: boolean) {
    const step = routes.get(routeId)?.steps.find((s) => s.id === stepId);
    if (!step) return;
    const here = store.all().find((t) => t.trail?.route === routeId && t.trail.step === stepId);
    if (here) {
      send({ type: 'activateTab', id: here.id });
      return;
    }
    const active = store.active;
    if (reuse && active?.trail?.route === routeId) {
      closeReader();
      recorder.expectStep(active.id, { ...active.trail, step: stepId });
      send({ type: 'navigate', id: active.id, url: step.url });
      return;
    }
    requestTab(step.url, { title: step.title, trail: { route: routeId, step: stepId, lane: newLaneId() }, activate: true });
  }

  // 順路の形のまま、眠ったタブとして盤面の島に並べる（もう開いているタブは、その場所へ動かす）
  function layoutRoute(routeId: string) {
    const route = routes.get(routeId);
    if (!route) return;
    const { steps, offsets } = routeLayout(route);
    const open = new Map<string, Tab>();
    for (const t of store.all()) {
      if (t.trail?.route === routeId && offsets.has(t.trail.step) && !open.has(t.trail.step)) open.set(t.trail.step, t);
    }
    // 見ているシートに並べる（ほかのシートにいる順路のタブも、このシートへ移す）
    const sheet = sheets.current;
    const moving = new Set([...open.values()].map((t) => t.id));
    const cells = placeShape(
      [...store.inSheet(sheet).filter((t) => !moving.has(t.id)), ...memos.inSheet(sheet), ...reservedIn(sheet).map((pos) => ({ pos }))],
      steps.map((s) => offsets.get(s.id) as Hex),
      anchorOn(sheet),
    );
    const name = normalizeIslandName(routeName(route));
    let island = islands.list().find((i) => i.name === name && store.inSheet(sheet).some((t) => t.island === i.id));
    if (!island) {
      island = { id: newIslandId(), name, color: route.color };
      islands.add(island);
    }
    const islandId = island.id;
    const positions = new Map<number, Hex>();
    const fromElsewhere = new Map<number, Hex>();
    steps.forEach((step, i) => {
      const tab = open.get(step.id);
      if (tab) (tab.sheet === sheet ? positions : fromElsewhere).set(tab.id, cells[i]);
    });
    store.setPositions(positions);
    if (fromElsewhere.size > 0) store.moveToSheet(fromElsewhere, sheet);
    store.setIsland([...moving], islandId);
    steps.forEach((step, i) => {
      if (open.has(step.id)) return;
      requestTab(step.url, {
        lazy: true,
        parentId: null,
        sheet,
        pos: cells[i],
        title: step.title,
        island: islandId,
        trail: { route: routeId, step: step.id, lane: newLaneId() },
      });
    });
    pinnedRoute = routeId;
    updateRouteView();
    relayRoutes();
  }

  // ---------- セルの範囲コピー・貼り付けと、セット（六角メモの「定型」と同じ考え） ----------
  const cellSets = new CellSetStore();
  void cellSets.load();
  const cellMenu = new CellMenu();
  const toast = (text: string, ms?: number) => showToast(board, text, ms);
  // このブラウザで最後にコピーしたセル（クリップボードには六角メモと同じ形で書く。ここにはアイコンや島も残す）
  let copied: { nonce: string; cells: CellItem[]; island?: CellSet['island'] } | null = null;

  // 小窓で右クリックした、今のシートに無いセル。メニューの項目が動くあいだ、コピーや島の操作はこの1個を選んだものとして扱う
  //   盤面の選択には入らない（ほかのシートの id は selection が落とす）。項目は close() のあとで同期に動くので、
  //   押した瞬間はまだメニューが開いていて消さない。閉じたあとの次の操作で消す
  let menuPick: { tabs: number[]; memos: string[] } | null = null;
  document.addEventListener('pointerdown', () => {
    if (!cellMenu.isOpen) menuPick = null;
  });
  document.addEventListener(
    'keydown',
    () => {
      if (!cellMenu.isOpen) menuPick = null;
    },
    true,
  );
  const selectedTabs = () => (menuPick ? menuPick.tabs : sidebar.selection()).map((id) => store.get(id)).filter((t): t is Tab => !!t);
  const selectedMemos = () => (menuPick ? menuPick.memos : sidebar.memoSelection()).map((id) => memos.get(id)).filter((m): m is MemoCell => !!m);
  // そのシートのふさがっているセル（タブ・メモのセル・返事待ちのタブの予約。置き場所を探すとき）
  const allCells = (sheet = sheets.current): { pos: Hex }[] => [...store.inSheet(sheet), ...memos.inSheet(sheet), ...reservedIn(sheet).map((pos) => ({ pos }))];

  // 選んだセルがみな同じ島なら、その島（貼るときに、同じ名前と色の島を作る）
  function islandOfCells(cells: { island: string | null }[]): CellSet['island'] {
    const id = cells[0]?.island;
    const island = id ? islands.get(id) : undefined;
    return island && cells.every((c) => c.island === id) ? { name: island.name, color: island.color } : undefined;
  }

  async function copySelection() {
    const tabs = selectedTabs();
    const notes = selectedMemos();
    const cells = cellsOfTabs(tabs, notes);
    if (cells.length === 0) {
      toast(notes.length > 0 && tabs.length === 0 && notes.every((memo) => memo.capture) ? '撮ったもののセルはコピーしません' : 'コピーできるセルがありません（http・https のページとメモのセルだけ。入口・ボットのセルはコピーしません）');
      return;
    }
    const nonce = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    copied = { nonce, cells, island: islandOfCells([...tabs, ...notes]) };
    const written = await writeCellsToClipboard(cells, nonce);
    toast(
      written
        ? `${cells.length} 個のセルをコピーしました（右クリック →「貼り付け」・Ctrl+V で同じ並びに。六角メモにも貼れます）`
        : `${cells.length} 個のセルをコピーしました（Windows のクリップボードには書けませんでした）`,
    );
  }

  // セルを、anchor（左上のセルを置く場所）から同じ並びで置く（タブは眠ったタブ、メモはメモのセル）。重なるときは、形を保てる近くへ
  //   sheet：置くシート（無ければ見ているシート）
  function placeCells(cells: CellItem[], anchor: Hex | null, island?: CellSet['island'], sheet = sheets.current) {
    const list = cells.slice(0, 60);
    const offsets = list.map((c) => ({ q: c.dq, r: c.dr }));
    const near = anchor ?? (sheet === sheets.current ? sidebar.lastPointerHex : null) ?? anchorOn(sheet);
    const occupied = allCells(sheet);
    const taken = new Set(occupied.map((t) => hexKey(t.pos)));
    let cellsAt = offsets.map((o) => ({ q: near.q + o.q, r: near.r + o.r }));
    if (cellsAt.some((h) => taken.has(hexKey(h)))) cellsAt = placeShape(occupied, offsets, near);
    let islandId: string | undefined;
    if (island) {
      islandId = newIslandId();
      islands.add({ id: islandId, name: normalizeIslandName(island.name), color: island.color });
    }
    list.forEach((c, i) => {
      if (c.memo) {
        memos.add({ sheet, pos: cellsAt[i], text: c.memo.text, tags: c.tags, liked: c.liked, island: islandId ?? null, image: c.memo.image, replies: c.memo.replies, by: c.memo.by, label: c.memo.label });
      } else {
        const face = c.face ?? {};
        requestTab(c.url, { lazy: true, parentId: null, sheet, pos: cellsAt[i], title: c.title, favicon: c.favicon, tags: c.tags, liked: c.liked, island: islandId, image: face.image, comment: face.comment, look: face.look });
      }
    });
    return list.length;
  }

  type Pasteable = { cells: CellItem[]; island?: CellSet['island']; label: string; note: string; text?: string };

  // クリップボードの中身を、貼れる形に（このブラウザでコピーしたものは、アイコンや島も）
  async function pasteable(): Promise<Pasteable | null> {
    const clip = await readClipboard();
    const count = (cells: CellItem[]) => {
      const n = cells.filter((c) => c.memo).length;
      return n > 0 ? `（うちメモ ${n}）` : '';
    };
    if (clip.kind === 'cells') {
      if (clip.ours && copied && copied.nonce === clip.nonce) {
        return { cells: copied.cells, island: copied.island, label: `コピーしたセル ${copied.cells.length} 個${count(copied.cells)}`, note: '' };
      }
      if (clip.cells.length === 0) return null;
      const skipped = clip.skipped > 0 ? `（空のマス ${clip.skipped} 個は貼りません）` : '';
      return { cells: clip.cells, label: `${clip.ours ? 'コピーしたセル' : '六角メモのマス'} ${clip.cells.length} 個${count(clip.cells)}`, note: skipped };
    }
    if (clip.kind === 'urls') return { cells: clip.cells, label: `URL ${clip.cells.length} 個`, note: '', text: clip.text };
    if (clip.kind === 'text') return { cells: [{ dq: 0, dr: 0, url: '', title: '', memo: { text: clip.text } }], label: '文章 → メモのセル', note: '', text: clip.text };
    return null;
  }

  async function pasteAt(anchor: Hex | null) {
    const p = await pasteable();
    if (!p) {
      toast('貼り付けるものがありません（セル・六角メモのマス・URL・文章をコピーしてから）');
      return;
    }
    const n = placeCells(p.cells, anchor, p.island);
    toast(`${p.label}を貼り付けました${p.cells.some((c) => !c.memo) ? '（タブは眠ったタブ。開くと読み込みます）' : ''}${p.note}`);
    return n;
  }

  function saveSelectionAsSet() {
    const tabs = selectedTabs();
    const notes = selectedMemos();
    const cells = cellsOfTabs(tabs, notes);
    if (cells.length === 0) {
      toast('セットにできるセルがありません（http・https のページとメモのセルだけ。入口・ボットのセルは入りません）');
      return;
    }
    const island = islandOfCells([...tabs, ...notes]);
    const first = tabs[0]?.title || (notes[0] ? memoTitle(notes[0], 20) : '');
    const initial = island?.name ?? ([...(first || 'セット')].slice(0, 20).join('') || 'セット');
    cellMenu.prompt(`セットの名前（${cells.length} セル）`, initial, (name) => {
      const set = cellSets.add(name, cells, island);
      toast(`セット「${set.name}」を保存しました（空いたセルを右クリック →「セットを貼る」）`);
    });
  }

  // セットを貼る（貼り方は「セットを貼る」の切り替えで選んだもの：ここに並べる・入口を1つ置く）
  function pasteSet(set: CellSet, anchor: Hex | null) {
    if (prefs.pasteSetAs === 'portal') {
      pasteSetAsSheet(set, anchor);
      return;
    }
    placeCells(set.cells, anchor, set.island);
    cellSets.used(set.id);
    toast(`セット「${set.name}」を貼りました（${set.cells.length} セル）`);
  }

  // 入口を1つだけここに置き、セットは新しいシート（名前はセットと同じ）に、保存したときの並びのまま貼る
  function pasteSetAsSheet(set: CellSet, anchor: Hex | null) {
    const here = sheets.current;
    const near = anchor ?? sidebar.lastPointerHex ?? anchorOn(here);
    const at = isTaken(near, here) ? nearestFree(near, (h) => isTaken(h, here)) : near;
    const sheet = sheets.add(set.name);
    if (!sheet) {
      toast('シートが多すぎて作れません（100 枚まで）');
      return;
    }
    const portal = memos.add({ sheet: here, pos: at, text: '', portal: sheet.id });
    if (!portal) {
      sheets.remove(sheet.id);
      toast('入口を置けませんでした（メモのセルが多すぎます）');
      return;
    }
    placeCells(set.cells, { q: 0, r: 0 }, set.island, sheet.id);
    cellSets.used(set.id);
    toast(`セット「${set.name}」を、新しいシート「${sheet.name}」に貼りました（${set.cells.length} セル）。入口をダブルクリックで移ります`, 5000);
  }

  // 「セットを貼る」の貼り方の切り替え（押してもメニューは閉じない。覚えておく）
  function pasteModeRow(onChange: () => void): MenuEntry {
    const buttons: MenuButton[] = [];
    const set = (mode: 'here' | 'portal') => {
      prefs.pasteSetAs = mode;
      savePrefs(prefs);
      buttons[0].pressed = mode === 'here';
      buttons[1].pressed = mode === 'portal';
      onChange();
      cellMenu.refresh();
    };
    buttons.push(
      { label: 'ここに並べる', pressed: prefs.pasteSetAs === 'here', run: () => set('here') },
      { label: '入口を1つ置く', pressed: prefs.pasteSetAs === 'portal', run: () => set('portal') },
    );
    return { row: '貼り方', buttons };
  }

  // 選んだセル（タブとメモ）を、六角メモの送り先のノートへ、同じ並びで送る
  async function sendSelectionToHexMemo() {
    await sendCellsToHexMemo(cellsOfTabs(selectedTabs(), selectedMemos()));
  }

  // セルを、六角メモの送り先のノートへ、同じ並びで送る（入口・ボットのセルと http・https 以外のタブは送らない。cellsOfTabs で外してある）
  async function sendCellsToHexMemo(all: CellItem[]) {
    const target = savedHexMemoTarget();
    if (!target) {
      toast('右の相棒の ⚙ で「六角メモの送り先」を選んでから、もう一度どうぞ');
      return;
    }
    const cells = all.slice(0, 50);
    if (cells.length === 0) {
      toast('六角メモへ送れるセルがありません（http・https のページとメモのセルだけ。入口・ボットのセルは送りません）');
      return;
    }
    toast('六角メモへ送っています…');
    const outcome = await sendToHexMemo(target, hexMemoRecords(cells), cells.map((c) => ({ dq: c.dq, dr: c.dr })));
    const images = cells.some((c) => c.memo?.image) ? '（スクショの画像は送りません）' : '';
    toast(outcome.ok ? ('pending' in outcome ? outcome.message : `${cells.length} 個のセルを「${target.label}」へ送りました${images}`) : `送れませんでした：${outcome.error}`, 6000);
  }

  function setEntries(anchor: Hex | null): MenuEntry[] {
    const sets = cellSets.list();
    const entries: MenuEntry[] = ['sep', { section: 'セットを貼る' }];
    if (sets.length === 0) {
      entries.push({ label: 'まだありません（セルを選んで右クリック →「セットとして保存」）', disabled: true });
      return entries;
    }
    const hint = (set: CellSet) => (prefs.pasteSetAs === 'portal' ? `${set.cells.length} → シート` : `${set.cells.length}`);
    const items = sets.slice(0, 8).map((set) => ({ set, entry: { label: set.name, hint: hint(set), run: () => pasteSet(set, anchor) } }));
    entries.push(pasteModeRow(() => items.forEach(({ set, entry }) => (entry.hint = hint(set)))));
    entries.push(...items.map((i) => i.entry));
    entries.push({ label: 'セットの一覧（名前を変える・消す）…', run: () => openSetManager(anchor) });
    return entries;
  }

  function openSetManager(anchor: Hex | null) {
    const x = window.innerWidth / 2 - 120;
    const y = 80;
    const render = () => {
      const sets = cellSets.list();
      const entries: MenuEntry[] = [{ section: `セット（${sets.length}）` }, pasteModeRow(() => undefined)];
      for (const set of sets) {
        entries.push({
          row: set.name,
          hint: `${set.cells.length} セル${set.island ? '・島' : ''}`,
          buttons: [
            { label: '貼る', run: () => (cellMenu.close(), pasteSet(set, anchor)) },
            { label: '名前', run: () => cellMenu.prompt('セットの新しい名前', set.name, (name) => cellSets.rename(set.id, name)) },
            { label: '消す', confirm: '本当に消す', run: () => (cellSets.remove(set.id), cellSets.list().length ? render() : cellMenu.close()) },
          ],
        });
      }
      cellMenu.open(x, y, entries);
    };
    render();
  }

  // ---------- シートの操作（入口・移す・まとめる・中身を出す・名前・消す・見え方） ----------

  // シートへの入口を押した
  function openPortal(id: string) {
    const memo = memos.get(id);
    if (!memo?.portal) return;
    if (!sheets.get(memo.portal)) {
      toast('行き先のシートが見つかりません（消されたようです）');
      return;
    }
    switchSheet(memo.portal);
    if (sheets.current === memo.portal) sheetPeek.close(); // 移れた（自分のシートへの入口でも閉じる）
  }

  // タブ・メモのセルを別のシートへ移す（並びはそのまま、行き先のシートの空いた所へ）。移したセルの数を返す
  //   ・行き先のシートへの入口は、そのシートの中では意味が無いので消す
  //   ・島：島のセルが全部いっしょに移るときだけ島に入ったまま（一部だけなら、移したセルは島から出す）
  function moveCellsToSheet(tabIds: number[], memoIds: string[], target: string, near?: Hex): number {
    const tabs = tabIds.map((id) => store.get(id)).filter((t): t is Tab => !!t && t.sheet !== target);
    const cells = memoIds.map((id) => memos.get(id)).filter((m): m is MemoCell => !!m && m.sheet !== target);
    for (const m of cells) if (m.portal === target) memos.remove(m.id);
    const moving = cells.filter((m) => m.portal !== target);
    const all = [...tabs, ...moving];
    if (all.length === 0) return 0;
    const base = [...all].sort((a, b) => byPosition(a.pos, b.pos))[0].pos;
    const spots = placeShape(
      allCells(target),
      all.map((c) => ({ q: c.pos.q - base.q, r: c.pos.r - base.r })),
      near ?? anchorOn(target),
    );
    const tabSet = new Set(tabs.map((t) => t.id));
    const memoSet = new Set(moving.map((m) => m.id));
    const whole = (island: string) =>
      store.all().every((t) => t.island !== island || tabSet.has(t.id)) && memos.list().every((m) => m.island !== island || memoSet.has(m.id));
    const leaveTabs = tabs.filter((t) => t.island && !whole(t.island)).map((t) => t.id);
    const leaveMemos = moving.filter((m) => m.island && !whole(m.island)).map((m) => m.id);
    if (leaveTabs.length > 0) store.setIsland(leaveTabs, null);
    if (leaveMemos.length > 0) memos.setIsland(leaveMemos, null);
    if (tabs.length > 0) store.moveToSheet(new Map(tabs.map((t, i) => [t.id, spots[i]])), target);
    if (moving.length > 0) memos.moveToSheet(new Map(moving.map((m, i) => [m.id, spots[tabs.length + i]])), target);
    return all.length;
  }

  // 入口にタブ・メモのセルを落とした：そのシートへ移す
  function dropOnPortal(cell: { tab?: number; memo?: string }, portalId: string) {
    const target = memos.get(portalId)?.portal;
    const sheet = sheets.get(target);
    if (!target || !sheet) {
      toast('行き先のシートが見つかりません');
      return;
    }
    if (cell.memo && memos.get(cell.memo)?.portal === target) {
      toast('入口は、その行き先のシートの中には入れられません');
      return;
    }
    const n = moveCellsToSheet(cell.tab !== undefined ? [cell.tab] : [], cell.memo ? [cell.memo] : [], target);
    if (n > 0) toast(`シート「${sheet.name}」へ移しました（入口を押すと小窓で見られます）`);
  }

  // 選んだセルを、ほかのシートへ移す
  function moveSelectionTo(target: string) {
    const sheet = sheets.get(target);
    if (!sheet) return;
    const tabIds = selectedTabs().map((t) => t.id);
    const memoIds = selectedMemos().map((m) => m.id);
    const dropped = memoIds.filter((id) => memos.get(id)?.portal === target).length;
    const n = moveCellsToSheet(tabIds, memoIds, target);
    sidebar.clearSelection();
    if (n === 0 && dropped === 0) {
      toast('移せるセルがありません');
      return;
    }
    toast(`${n} 個のセルを、シート「${sheet.name}」へ移しました${dropped > 0 ? `（そのシートへの入口 ${dropped} 個は消しました）` : ''}`);
  }

  // 移す先のシートを全部出す（選んだセルはそのまま）
  function openMoveToMenu(x: number, y: number, from = sheets.current) {
    const entries: MenuEntry[] = [{ section: '選んだセルを移すシート' }];
    for (const sheet of sheets.recent().filter((s) => s.id !== from)) {
      entries.push({ label: sheet.name, hint: `${store.inSheet(sheet.id).length + memos.inSheet(sheet.id).length}`, run: () => moveSelectionTo(sheet.id) });
    }
    cellMenu.open(x, y, entries);
  }

  // 選んだセルを入口1つにまとめる：新しいシートへ同じ並びで移し、いちばん左上のセルに入口を置く
  function packSelection(x: number, y: number) {
    const tabs = selectedTabs();
    const cells = selectedMemos();
    const all = [...tabs, ...cells];
    if (all.length === 0) return;
    const viewing = sheets.current;
    const homes = new Set(all.map((c) => c.sheet));
    const here = homes.size === 1 ? [...homes][0] : viewing; // 小窓のセルは、そのシートの上に入口を置く
    const at = [...all].sort((a, b) => byPosition(a.pos, b.pos))[0].pos;
    const island = islandOfCells(all);
    const first = tabs[0]?.title || (cells[0] ? memoTitle(cells[0], 20) : '');
    const initial = island?.name ?? ([...(first || 'シート')].slice(0, 20).join('') || 'シート');
    cellMenu.prompt(
      `新しいシートの名前（${all.length} セルをまとめる）`,
      initial,
      (name) => {
        if (sheets.current !== viewing) return; // 名前を入れている間にシートを移った
        const sheet = sheets.add(name);
        if (!sheet) {
          toast('シートが多すぎて作れません（100 枚まで）');
          return;
        }
        const n = moveCellsToSheet(
          tabs.map((t) => t.id),
          cells.map((m) => m.id),
          sheet.id,
          { q: 0, r: 0 },
        );
        const pos = isTaken(at, here) ? nearestFree(at, (h) => isTaken(h, here)) : at;
        const portal = memos.add({ sheet: here, pos, text: '', portal: sheet.id });
        sidebar.clearSelection();
        toast(
          portal
            ? `${n} 個のセルを、新しいシート「${sheet.name}」にまとめました（入口をダブルクリックで移ります）`
            : `${n} 個のセルを新しいシート「${sheet.name}」へ移しましたが、入口を置けませんでした（左上のシートの名前 ▾ から開けます）`,
          5000,
        );
      },
      { x, y },
    );
  }

  // 盤面のセルへ、クリップボードの画像を貼る（C++ が JPEG で返す。UI は data: を fetch しない）
  //   貼れるのはページのタブ・ふつうのメモ・入口・ボット。アプリはアイコン、撮ったものは撮影の台帳が顔
  type CellImageTarget = { kind: 'tab'; id: number } | { kind: 'memo'; id: string };

  function cellHasFaceImage(target: CellImageTarget) {
    return target.kind === 'tab' ? !!store.get(target.id)?.image : !!memos.get(target.id)?.image;
  }

  async function cellImageOnClipboard(): Promise<'yes' | 'no' | 'fail'> {
    const reply = await request((requestId) => ({ type: 'clipboardHasImage', requestId }), 3_000);
    if (!reply || reply.type !== 'clipboardImage') return 'fail';
    return reply.present ? 'yes' : 'no';
  }

  function cellImageErrorText(error: string | undefined) {
    if (error === 'empty') return 'クリップボードに画像がありません';
    if (error === 'big') return '画像が大きすぎます';
    return '画像を読めませんでした';
  }

  async function pasteCellImage(target: CellImageTarget) {
    const reply = await request((requestId) => ({ type: 'clipboardReadImage', requestId }), 8_000);
    if (!reply || reply.type !== 'clipboardImage' || !reply.ok || !reply.image?.startsWith('data:image/')) {
      toast(cellImageErrorText(reply && reply.type === 'clipboardImage' ? reply.error : undefined));
      return;
    }
    const imageId = await memos.saveImage(reply.image);
    if (!imageId) {
      toast('画像を保存できませんでした');
      return;
    }
    if (target.kind === 'tab') {
      if (!store.get(target.id)) {
        toast('そのセルは、もうありません');
        return;
      }
      // 見え方を「画像」にすると、全体の見え方がアイコンでも顔に出る
      store.setFace(target.id, { image: imageId, look: 'image' });
    } else {
      const memo = memos.get(target.id);
      if (!memo || memo.app || memo.capture) {
        toast('そのセルは、もうありません');
        return;
      }
      memos.update(target.id, { image: imageId });
    }
    toast('画像を貼りました');
  }

  function clearCellImage(target: CellImageTarget) {
    if (target.kind === 'tab') {
      const tab = store.get(target.id);
      if (!tab?.image) return;
      store.setFace(target.id, { image: null, ...(tab.look === 'image' ? { look: null } : {}) });
    } else if (memos.get(target.id)?.image) {
      memos.update(target.id, { image: null });
    } else return;
    toast('画像を外しました');
  }

  // 盤面のセルの画像（六角形スクショ・タブの見た目）を、右の撮影へ送る（I4）
  function sendCellImageToCapture(target: CellImageTarget) {
    if (target.kind === 'tab') {
      const tab = store.get(target.id);
      if (!tab?.image) {
        toast('そのセルの画像は、もうありません');
        return;
      }
      captureShotToRight(tab.image, 'tabImage', tab.title || tab.url);
    } else {
      const memo = memos.get(target.id);
      if (!memo?.image || memo.app || memo.capture) {
        toast('そのセルの画像は、もうありません');
        return;
      }
      captureShotToRight(memo.image, 'cellImage', memo.source?.title || memoTitle(memo, 40));
    }
  }

  // 「画像を貼る」を足して、開いたあとに画像の有無で押せるようにする（open の直後に返す関数を呼ぶ）
  function queueCellImage(entries: MenuEntry[], target: CellImageTarget) {
    const entry: { label: string; hint?: string; disabled?: boolean; run?: () => void } = { label: '画像を貼る', hint: '確かめています…', disabled: true };
    entries.push(entry);
    if (cellHasFaceImage(target)) {
      entries.push({ label: '画像を外す', run: () => clearCellImage(target) });
      entries.push({ label: '🖼 画像を撮影に送る', hint: '大きく開く', run: () => sendCellImageToCapture(target) });
    }
    return () => {
      const token = cellMenu.token();
      void cellImageOnClipboard().then((state) => {
        if (state === 'yes') Object.assign(entry, { hint: undefined, disabled: false, run: () => void pasteCellImage(target) });
        else Object.assign(entry, { hint: state === 'no' ? '画像がありません' : '確かめられませんでした', disabled: true, run: undefined });
        cellMenu.update(entries, token);
      });
    };
  }

  // 入口を右クリックしたときのメニュー
  function openPortalMenu(portal: MemoCell, info: { hex: Hex | null; x: number; y: number }) {
    const target = sheets.get(portal.portal);
    const entries: MenuEntry[] = [{ section: target ? `入口：シート「${target.name}」` : '入口（行き先のシートが見つかりません）' }];
    if (target) {
      const count = store.inSheet(target.id).length + memos.inSheet(target.id).length;
      entries.push({ label: 'シートを開く', hint: 'ダブルクリック', run: () => switchSheet(target.id) });
      entries.push({ label: '小窓で見る', hint: 'クリック', run: () => peekPortal(portal.id) });
      entries.push(cardWinEntry({ kind: 'memo', id: portal.id }));
      entries.push({ label: 'シートの名前を変える…', run: () => renameSheet(target.id, { x: info.x, y: info.y }) });
      entries.push({ label: '見た目（画像・コメント）…', run: () => void editPortalFace(portal.id) });
      if (target.id !== MAIN_SHEET && target.id !== portal.sheet) {
        entries.push({ label: '中身をここに出す（シートをなくす）', hint: `${count}`, run: () => unpackSheet(portal.id) });
      }
    }
    const armImage = queueCellImage(entries, { kind: 'memo', id: portal.id });
    entries.push({ label: '入口を消す（シートは残る）…', run: () => confirmRemoveMemos([portal.id]) });
    if (target && target.id !== MAIN_SHEET) entries.push({ label: 'シートごと消す…', run: () => confirmRemoveSheet(target.id) });
    if (target && target.id !== portal.sheet && canArchive(target.id)) entries.push({ label: 'シートをアーカイブ…', run: () => confirmArchiveSheet(target.id) });
    entries.push(...sheetJumpEntries(info.x, info.y));
    entries.push(...setEntries(info.hex));
    cellMenu.open(info.x, info.y, entries);
    armImage();
  }

  // 中身をここに出す：入口の場所に、行き先のシートのタブとメモのセルを並べ直して、シートをなくす
  function unpackSheet(portalId: string) {
    const portal = memos.get(portalId);
    const target = portal?.portal;
    const sheet = sheets.get(target);
    if (!portal || !target || !sheet || target === MAIN_SHEET || target === portal.sheet) {
      toast('この入口のシートは、ここに出せません');
      return;
    }
    const here = portal.sheet;
    const at = portal.pos;
    memos.remove(portal.id);
    const n = moveCellsToSheet(
      store.inSheet(target).map((t) => t.id),
      memos.inSheet(target).map((m) => m.id),
      here,
      at,
    );
    for (const m of memos.list()) if (m.portal === target) memos.remove(m.id); // ほかの所にある、このシートへの入口
    if (sheets.current === target) goBack();
    sheets.remove(target);
    delete prefs.boards[target];
    savePrefsSoon();
    toast(`シート「${sheet.name}」の中身（${n} セル）を、ここに出しました`);
  }

  function renameSheet(id: string, at?: { x: number; y: number }) {
    const sheet = sheets.get(id);
    if (!sheet) return;
    cellMenu.prompt('シートの新しい名前', sheet.name, (name) => sheets.rename(id, name), at);
  }

  function confirmRemoveSheet(id: string) {
    const sheet = sheets.get(id);
    if (!sheet || id === MAIN_SHEET || id === CAPTURE_SHEET) return;
    const tabs = store.inSheet(id).length;
    const cells = memos.inSheet(id).length;
    const x = window.innerWidth / 2 - 120;
    cellMenu.open(x, 120, [
      { section: `シート「${sheet.name}」を消します` },
      { label: `タブ ${tabs} 個を閉じ、メモのセル ${cells} 個を消します（このシートへの入口も消えます）`, disabled: true },
      { label: '消す', run: () => removeSheet(id) },
      ...(canArchive(id) ? [{ label: '消さずにアーカイブする', run: () => void archiveSheet(id) } as MenuEntry] : []),
      { label: 'やめる', run: () => undefined },
    ]);
  }

  // シートを消す：中のタブを閉じ、メモのセルとこのシートへの入口を消す
  //   見ていたシートなら先に戻り、表示中のタブがこのシートにあれば、先にほかのタブを表示する（ページが空にならないように）
  function removeSheet(id: string, done = 'removed' as 'removed' | 'archived') {
    const sheet = sheets.get(id);
    if (!sheet || id === MAIN_SHEET || id === CAPTURE_SHEET) return;
    if (sheets.current === id) {
      prefs.boards[id] = sidebar.view;
      if (!sheets.back()) sheets.setCurrent(MAIN_SHEET, false);
      afterSheetChange();
    }
    const doomed = store.inSheet(id);
    for (const t of doomed) store.closing.add(t.id);
    // 消した（アーカイブではない）：そのシートのセルの関連の線も外す。アーカイブなら残す（戻せば、またつながる）
    if (done === 'removed') boardLinks.removeCells([...doomed.map((t) => tabRef(t.uid)), ...memos.list().filter((m) => m.sheet === id || m.portal === id).map((m) => memoRef(m.id))]);
    if (store.active?.sheet === id) {
      const survivor = store
        .all()
        .filter((t) => !store.closing.has(t.id))
        .sort((a, b) => Number(a.asleep) - Number(b.asleep) || b.lastUsed - a.lastUsed)[0];
      if (survivor) {
        quietActivation.add(survivor.id);
        send({ type: 'activateTab', id: survivor.id });
      } else {
        requestTab(HOME_URL, { sheet: sheets.current, parentId: null, activate: true });
      }
    }
    for (const t of doomed) send({ type: 'closeTab', id: t.id });
    for (const m of memos.list()) if (m.sheet === id || m.portal === id) memos.remove(m.id);
    sheets.remove(id);
    delete prefs.boards[id];
    savePrefsSoon();
    if (done === 'removed') toast(`シート「${sheet.name}」を消しました`);
  }

  // ---------- シートのアーカイブ（docs/plan-sheet-archive.md。AR2・AR3） ----------
  //   書くのは左だけ。書けたと確かめてから片付ける。戻すのは追加だけ。アーカイブは自動では消さない。C++ は変えない
  const ARCHIVE_EXCLUDED = new Set<string>([MAIN_SHEET, CAPTURE_SHEET, RIGHT_MEMO_SHEET]);
  const MAX_MEMO_CELLS = 2000; // memocells.ts の上限と同じ
  const MAX_ISLAND_COUNT = 50; // session.ts の parseIslands の上限と同じ
  let archiveBusy = false; // アーカイブか戻す処理の途中
  let shuttingDown = false; // flush を受けた（閉じる途中）。新しいアーカイブと戻すを受けない
  const canArchive = (id: string) => !!sheets.get(id) && !ARCHIVE_EXCLUDED.has(id);

  // 断る条件（§5.2）。断るなら理由の文
  function archiveRefusal(sheetId: string | null, ignoreBusy = false): string | null {
    if (shuttingDown) return 'ブラウザを閉じる途中です';
    if (archiveBusy && !ignoreBusy) return 'ほかのアーカイブか、戻す処理の途中です';
    if (!sessionReady) return '前回のタブを読み終えていません。少し待ってから、もう一度押してください';
    if (pending.size > 0) return '開いている途中のタブがあります。少し待ってから、もう一度押してください';
    if (!memos.ready || !memos.writableLedger) return 'メモの台帳を読めていません（ブラウザを開き直してください）';
    if (editorsBusy()) return '書きかけの欄を「残す」か「やめる」で閉じてから、もう一度押してください';
    if (sheetId && store.inSheet(sheetId).some((t) => store.closing.has(t.id))) return 'このシートに閉じる途中のタブがあります。少し待ってから、もう一度押してください';
    return null;
  }

  // 今の盤面から組み立てる（盤面の位置は、見ているシートなら今の位置）
  function archiveFor(sheetId: string, id: string, createdAt: number): SheetArchive | null {
    const sheet = sheets.get(sheetId);
    if (!sheet) return null;
    const view = sheets.current === sheetId ? sidebar.view : prefs.boards[sheetId];
    const tabs = store
      .inSheet(sheetId)
      .filter((t) => !store.closing.has(t.id))
      .map((t) => toSavedTab(t));
    return buildArchive({ id, createdAt, sheet, view, tabs, memos: memos.list(), islands: islands.list() });
  }

  // 確かめの小窓（数と、戻せること。右のメモのシートのセットに入っていれば、外れることも）
  function confirmArchiveSheet(id: string) {
    const sheet = sheets.get(id);
    if (!sheet || !canArchive(id)) return;
    const tabs = store.inSheet(id).length;
    const cells = memos.inSheet(id).length;
    const entrances = memos.list().filter((m) => m.portal === id && m.sheet !== id).length;
    const x = window.innerWidth / 2 - 120;
    const build = (inRightSet: boolean): MenuEntry[] => [
      { section: `シート「${sheet.name}」をアーカイブします` },
      { note: `タブ ${tabs} 個・メモのセル ${cells} 個・ほかのシートからの入口 ${entrances} 個を保存して、盤面から片付けます。アーカイブの一覧（左上のシートの名前 ▾）から戻せます。` },
      ...(inRightSet ? [{ note: 'このシートは右のメモのシートのセットに入っています。セットからは外れます（戻しても戻りません）。' } as MenuEntry] : []),
      { label: 'アーカイブする', run: () => void archiveSheet(id) },
      { label: 'やめる', run: () => undefined },
    ];
    cellMenu.open(x, 120, build(false));
    const token = cellMenu.token();
    void readData<unknown>('right-sheets.json').then((raw) => {
      if (sheetSetsIn(raw).some((set) => set.sheets.includes(id))) cellMenu.update(build(true), token);
    });
  }

  // 閉じたタブが全部 tabClosed で消えるのを待つ（最長 5 秒）
  function waitTabsGone(ids: readonly number[], timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (ids.every((id) => !store.get(id))) resolve(true);
        else if (Date.now() - started > timeoutMs) resolve(false);
        else window.setTimeout(check, 100);
      };
      check();
    });
  }

  // アーカイブする（§7 AR2）：断る条件 → 組み立て → 書く・読み返す・札 → もう一度組み立てて比べる → 断る条件 → 片付け → 待つ → 書く
  //   戻り値：ok（片付けた）・tooBig（大きすぎて作れない）・failed（ほかの理由。シートはそのまま。理由はトーストで知らせる）。取り込みの戻し（D5）が使う
  async function archiveSheet(id: string): Promise<ArchiveResult> {
    const sheet = sheets.get(id);
    if (!sheet || !canArchive(id)) {
      toast('このシートはアーカイブできません');
      return 'failed';
    }
    const refusal = archiveRefusal(id);
    if (refusal) {
      toast(`${refusal}（シートはそのままです）`, 6000);
      return 'failed';
    }
    archiveBusy = true;
    try {
      const archive = archiveFor(id, newArchiveId(), Date.now());
      if (!archive) return 'failed';
      const result = await writeArchive(archive);
      if (result !== 'ok') {
        const why =
          result === 'tooBig'
            ? 'シートが大きすぎて、アーカイブを作れませんでした'
            : result === 'writeFailed'
              ? 'アーカイブを書けませんでした'
              : '書いたアーカイブを読み返せませんでした';
        toast(`${why}。シートはそのままです`, 6000);
        return result === 'tooBig' ? 'tooBig' : 'failed';
      }
      const again = archiveFor(id, archive.id, archive.createdAt);
      if (!again || !sameContent(archive, again)) {
        deleteArchive(archive.id);
        toast('書いている間に、シートの中が変わりました。もう一度アーカイブしてください（シートはそのままです）', 6000);
        return 'failed';
      }
      const late = archiveRefusal(id, true);
      if (late) {
        deleteArchive(archive.id);
        toast(`${late}（シートはそのままです）`, 6000);
        return 'failed';
      }
      // 片付け：最前面のアプリをやめる（removeMemos と同じ扱い）→ シートを消す（入口もいっしょに）
      if (pinnedAppId && memos.inSheet(id).some((m) => m.app === pinnedAppId)) stopPin(pinnedAppId);
      const doomed = store.inSheet(id).map((t) => t.id);
      removeSheet(id, 'archived');
      await waitTabsGone(doomed, 5000);
      memos.flush();
      saveSession(false);
      toast(`シート「${sheet.name}」をアーカイブしました（アーカイブの一覧から戻せます）`, 5000);
      return 'ok';
    } finally {
      archiveBusy = false;
    }
  }

  // アーカイブの一覧（§7 AR3）：新しい順に 20 件ずつ。各行に「戻す」（あれば「足りない分を戻す」）と「消す」
  function openArchiveList(x: number, y: number) {
    cellMenu.open(x, y, [{ section: 'アーカイブ' }, { label: '読み込んでいます…', disabled: true }]);
    const token = cellMenu.token();
    let limit = 20;
    void listArchives().then((list) => {
      const render = (tok?: number) => {
        const entries: MenuEntry[] = [{ section: `アーカイブ（${list.length}）` }];
        if (list.length === 0) entries.push({ label: 'まだありません（シートの名前 ▾ →「このシートをアーカイブ…」）', disabled: true });
        for (const meta of list.slice(0, limit)) {
          const date = new Date(meta.createdAt).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const onBoard = !!sheets.get(meta.sheet.id);
          entries.push({
            row: meta.sheet.name,
            hint: `タブ ${meta.counts.tabs}・メモ ${meta.counts.memos}・${date}${meta.restoredAt ? '・戻した' : ''}`,
            buttons: [
              { label: onBoard ? '足りない分を戻す' : '戻す', close: true, run: () => void restoreArchive(meta) },
              {
                label: '消す',
                confirm: '本当に消す',
                run: () => {
                  deleteArchive(meta.id);
                  list.splice(list.indexOf(meta), 1);
                  render();
                },
              },
            ],
          });
        }
        if (list.length > limit) {
          entries.push({ row: `ほかに ${list.length - limit} 件`, buttons: [{ label: 'もっと見る', run: () => ((limit += 20), render()) }] });
        }
        cellMenu.update(entries, tok);
      };
      render(token);
    });
  }

  // 戻す（§7 AR3。§5.2 の「足りない分を足す」）
  async function restoreArchive(meta: SheetArchiveMeta) {
    if (!isArchiveId(meta.id)) return;
    const refusal = archiveRefusal(null);
    if (refusal) {
      toast(refusal, 6000);
      return;
    }
    archiveBusy = true;
    try {
      const archive = await readArchive(meta.id);
      if (archive === 'missing') {
        toast('アーカイブの本体が見つかりませんでした');
        return;
      }
      if (archive === 'failed') {
        toast('アーカイブを読めませんでした（壊れているか、読み込みが間に合いませんでした）');
        return;
      }
      const late = archiveRefusal(null, true);
      if (late) {
        toast(late, 6000);
        return;
      }
      const sheetId = archive.sheet.id;
      if (ARCHIVE_EXCLUDED.has(sheetId)) return;
      const existing = sheets.get(sheetId);
      const sheetEmpty = !existing || (store.inSheet(sheetId).length === 0 && memos.inSheet(sheetId).length === 0);
      // 足すものを決める
      let lostPortals = 0;
      let lostBots = 0;
      let lostApps = 0;
      const willExist = (target: string) => target === sheetId || !!sheets.get(target);
      const cells = archive.memos.filter((m) => {
        if (memos.get(m.id)) return false;
        if (m.portal && !willExist(m.portal)) return (lostPortals++, false);
        if (m.bot && bots.ready && !bots.get(m.bot)) return (lostBots++, false);
        if (m.app && apps.ready && !apps.get(m.app)) return (lostApps++, false);
        return true;
      });
      const here = store.inSheet(sheetId);
      const tabs = archive.tabs.filter((t) => !here.some((h) => samePage(h.url, t.url) || h.url === t.url));
      let lostEntrances = 0;
      const entrances = archive.entrances.filter((m) => {
        if (memos.get(m.id)) return false;
        if (!sheets.get(m.sheet)) return (lostEntrances++, false); // 元のシートが無ければ置かない
        return true;
      });
      const newIslands = archive.islands.filter((i) => !islands.get(i.id));
      if (cells.length + tabs.length + entrances.length === 0 && existing) {
        toast('もう全部戻っています');
        return;
      }
      // 上限（足す前に全部確かめる。足し始めたら止めない）
      if (!existing && sheets.list().length >= MAX_SHEETS) {
        toast(`シートが多すぎて戻せません（${MAX_SHEETS} 枚まで）`);
        return;
      }
      if (memos.list().length + cells.length + entrances.length > MAX_MEMO_CELLS) {
        toast(`メモのセルが多すぎて戻せません（${MAX_MEMO_CELLS} 個まで。あと ${memos.list().length + cells.length + entrances.length - MAX_MEMO_CELLS} 個減らしてください）`);
        return;
      }
      if (islands.list().length + newIslands.length > MAX_ISLAND_COUNT) {
        toast(`島が多すぎて戻せません（${MAX_ISLAND_COUNT} 本まで）`);
        return;
      }
      // 足す：島 → シート → 盤面の位置 → メモ → タブ → 親の入口
      for (const island of newIslands) islands.add(island);
      const restoredSheet = sheets.restore(archive.sheet, sheetEmpty);
      if (restoredSheet === null) {
        toast('シートを戻せませんでした');
        return;
      }
      if (archive.view && !prefs.boards[sheetId]) {
        prefs.boards[sheetId] = archive.view;
        savePrefsSoon();
      }
      const near = (memo: MemoCell) => nearestFree(memo.pos, (h) => isTaken(h, memo.sheet));
      const inner = memos.restore(cells, near);
      const waits = tabs.map((t) =>
        waitCreated(
          requestTab(t.url, {
            uid: t.uid,
            sheet: sheetId,
            pos: t.pos,
            lazy: true,
            parentId: null,
            title: t.title,
            favicon: t.favicon,
            keepAwake: t.keepAwake,
            notes: t.notes,
            readEdges: t.readEdges,
            liked: t.liked,
            tags: t.tags,
            island: t.island,
            trail: t.trail,
            image: t.image,
            comment: t.comment,
            look: t.look,
          }),
          30_000,
        ),
      );
      const outer = memos.restore(entrances, near);
      const created = await Promise.all(waits);
      const missingTabs = created.filter((id) => id === null).length;
      if (missingTabs === 0) await markRestored(meta); // 届かないタブがあれば書かない（もう一度「足りない分を戻す」で続きを戻せる）
      if (sheets.current !== sheetId) switchSheet(sheetId);
      const skipped = inner.skipped + outer.skipped;
      const notes = [
        lostPortals ? `行き先の無い入口 ${lostPortals} 個` : '',
        lostEntrances ? `元のシートが無い入口 ${lostEntrances} 個` : '',
        lostBots ? `台帳に無いボットのセル ${lostBots} 個` : '',
        lostApps ? `台帳に無いアプリのセル ${lostApps} 個` : '',
        skipped ? `置けなかったメモのセル ${skipped} 個` : '',
      ].filter(Boolean);
      const head = `シート「${archive.sheet.name}」を戻しました（タブ ${tabs.length - missingTabs}・メモのセル ${inner.restored.length}・入口 ${outer.restored.length}）`;
      const tail = notes.length ? `。戻さなかったもの：${notes.join('・')}` : '';
      const miss = missingTabs ? `。${missingTabs} 個のタブが届きませんでした。もう一度「足りない分を戻す」を押してください` : '';
      toast(`${head}${tail}${miss}`, 8000);
    } finally {
      archiveBusy = false;
    }
  }

  // 試し：今あるシートへの入口を、右クリックした空いたセルに置く（新しいシートは作らない。移らない）
  //   入口は今までと同じメモのセル（portal にシートの id）。1つのシートへの入口がいくつあってもよい
  //   （シートを消す・中身を出すときは、ほかの所の入口もいっしょに消える。← は来た順の履歴で戻る）
  function openPortalToSheetMenu(at: Hex, x: number, y: number) {
    const here = sheets.current;
    const entries: MenuEntry[] = [{ section: 'どのシートへの入口を置きますか' }];
    const have = new Set(memos.inSheet(here).filter((m) => m.portal).map((m) => m.portal));
    for (const sheet of sheets.list()) {
      if (sheet.id === here) continue;
      const count = store.inSheet(sheet.id).length + memos.inSheet(sheet.id).length;
      entries.push({
        label: have.has(sheet.id) ? `${sheet.name}（このシートに入口あり）` : sheet.name,
        hint: `${count}`,
        run: () => placePortalTo(sheet.id, at, here),
      });
    }
    cellMenu.open(x, y, entries);
  }

  function placePortalTo(target: string, at: Hex, here: string) {
    const sheet = sheets.get(target);
    if (!sheet || target === here) return;
    if (sheets.current !== here) return; // 選んでいる間にシートを移った
    const pos = isTaken(at, here) ? nearestFree(at, (h) => isTaken(h, here)) : at;
    const portal = memos.add({ sheet: here, pos, text: '', portal: target });
    toast(portal ? `シート「${sheet.name}」への入口を置きました（押すと移ります）` : '入口を置けませんでした（メモのセルが多すぎます）');
  }

  // 新しいシートを作り、今のシートに入口を置いて、そのシートへ移る
  function newSheetHere(x: number, y: number) {
    cellMenu.prompt(
      '新しいシートの名前',
      `シート${sheets.list().length}`,
      (name) => {
        const here = sheets.current;
        const sheet = sheets.add(name);
        if (!sheet) {
          toast('シートが多すぎて作れません（100 枚まで）');
          return;
        }
        const near = anchorOn(here);
        const pos = isTaken(near, here) ? nearestFree(near, (h) => isTaken(h, here)) : near;
        const portal = memos.add({ sheet: here, pos, text: '', portal: sheet.id });
        switchSheet(sheet.id);
        toast(portal ? `新しいシート「${sheet.name}」を作りました（元のシートに入口を置きました。← で戻れます）` : `新しいシート「${sheet.name}」を作りました（← で戻れます）`, 5000);
      },
      { x, y },
    );
  }

  // 左上のシートの名前を押した：シートの一覧・新しいシート・名前・消す・タブの見え方
  //   一覧は sheets.list() をそのまま出す（0 枚のシートも、特別な種類も除かない）。
  //   「撮ったもの」は、保存の読み込みで落ちていても、開くときに足す
  function openSheetMenu(x: number, y: number, keyboard = false) {
    sheets.ensure([CAPTURE_SHEET]);
    const entries: MenuEntry[] = [{ section: 'シート' }];
    for (const sheet of sheets.list()) {
      const count = store.inSheet(sheet.id).length + memos.inSheet(sheet.id).length;
      entries.push({ label: `${sheet.id === sheets.current ? '✓' : '　'} ${sheet.name}`, hint: `${count}`, run: () => switchSheet(sheet.id) });
    }
    entries.push('sep');
    entries.push({ label: '＋ 新しいシート…', run: () => newSheetHere(x, y) });
    entries.push({ label: 'このシートの名前を変える…', run: () => renameSheet(sheets.current, { x, y }) });
    entries.push({ label: 'このシートを消す…', disabled: sheets.current === MAIN_SHEET || sheets.current === CAPTURE_SHEET, run: () => confirmRemoveSheet(sheets.current) });
    entries.push({ label: 'このシートをアーカイブ…', disabled: !canArchive(sheets.current), run: () => confirmArchiveSheet(sheets.current) });
    entries.push({ label: 'アーカイブの一覧…', run: () => openArchiveList(x, y) });
    entries.push('sep', { note: APP_TITLE });
    entries.push('sep', { section: '六角メモ（内蔵）' });
    entries.push({ label: '六角メモを開く', hint: 'hexmemo.local', run: () => createTab(HEXMEMO_URL) });
    if (BOT_FEATURES) entries.push('sep', { section: 'Grok Bot（外のアシスタント）と' });
    if (BOT_FEATURES) entries.push({ label: 'Grok 用に書き出す…', hint: 'ui-data\\exports', run: () => openGrokExportMenu(x, y) });
    if (BOT_FEATURES) entries.push(...grokPatchMenuEntries(x, y));
    entries.push('sep', { section: 'タブの見え方（すべてのシート）' });
    for (const look of TAB_LOOKS) {
      entries.push({ label: `${prefs.tabLook === look.id ? '●' : '○'} ${look.label}`, run: () => setTabLook(look.id) });
    }
    entries.push({ label: 'タブごとの見え方は、タブを右クリック →「見た目」', disabled: true });
    entries.push('sep', { section: 'ページのリンクから開く新しいタブ' });
    entries.push({ label: `${prefs.linkOpen === 'front' ? '●' : '○'} 表に出す（今までどおり）`, run: () => setLinkOpen('front') });
    entries.push({ label: `${prefs.linkOpen === 'back' ? '●' : '○'} いつも裏で開く（セルに足すだけ）`, run: () => setLinkOpen('back') });
    entries.push({ label: 'リンクを右クリック →「セルに追加（ページはこのまま）」でも裏で開けます', disabled: true });
    cellMenu.open(x, y, entries);
    if (keyboard) cellMenu.focusFirst();
  }

  function setTabLook(look: TabLook) {
    prefs.tabLook = look;
    applyView();
  }

  // ---------- タブ・入口の見た目（画像・コメント・見え方） ----------
  const faceEditor = new FaceEditor(board);

  // そのシートを小窓で見ている（欄は小窓のセルの近くに出す。盤面は移さない）
  function cellInPeek(sheet: string) {
    return sheetPeek.isOpen && sheetPeek.sheetId === sheet;
  }

  function anchorNearMemo(id: string, pos: Hex): DOMRect {
    if (cellInPeek(memos.get(id)?.sheet ?? '')) {
      const rect = peekBoard?.anchorOfMemo(id);
      if (rect) return rect;
    }
    return sidebar.anchorOfMemo(id) ?? sidebar.anchorOfHex(pos);
  }

  async function editTabFace(id: number) {
    const tab = store.get(id);
    if (!tab) return;
    // 小窓に見えているセルは、盤面をそのシートへ移さず、小窓のセルの近くに出す（移ると小窓が閉じる）
    const inPeek = cellInPeek(tab.sheet);
    if (!inPeek && tab.sheet !== sheets.current && !switchSheet(tab.sheet)) return;
    if (!inPeek) sidebar.render(); // セルを描いてから、その近くに出す
    const imageHref = await memos.loadImage(tab.image);
    const current = store.get(id);
    if (!current) return;
    const anchor = (inPeek ? peekBoard?.anchorOf(id) : null) ?? sidebar.anchorOf(id) ?? sidebar.anchorOfHex(current.pos);
    faceEditor.open(
      anchor,
      { kind: 'tab', tab: current, imageHref, thumb: thumbs.get(id), globalLook: prefs.tabLook, canCrop: store.activeId === id && !current.asleep },
      (result) => void applyTabFace(id, result),
      (result) => void applyTabFace(id, result).then(() => startShot(null, id)),
    );
  }

  async function applyTabFace(id: number, result: FaceResult) {
    const image = await saveFaceImage(result.image);
    store.setFace(id, { image, comment: result.comment, look: result.look });
  }

  // 見た目の欄の画像を残す（新しい画像は保存して ID に。null は外す・undefined は変えない）
  async function saveFaceImage(image: string | null | undefined): Promise<string | null | undefined> {
    if (typeof image !== 'string') return image;
    const id = await memos.saveImage(image);
    if (!id) toast('画像を保存できませんでした');
    return id ?? undefined;
  }

  async function editPortalFace(id: string) {
    const memo = memos.get(id);
    if (!memo?.portal) return;
    const target = sheets.get(memo.portal);
    const imageHref = await memos.loadImage(memo.image);
    const anchor = anchorNearMemo(id, memo.pos);
    const info = target ? { name: target.name, color: target.color, count: store.inSheet(target.id).length + memos.inSheet(target.id).length } : null;
    faceEditor.open(anchor, { kind: 'portal', name: target?.name ?? '？', info, imageHref, comment: memo.text }, (result) => {
      void saveFaceImage(result.image).then((image) => memos.update(id, { text: result.comment, ...(image !== undefined ? { image } : {}) }));
    });
  }

  // ボットのセルの見た目（画像・コメント）。名前とリンクは台帳のもので、カード・メニューから変える
  async function editBotFace(id: string) {
    const memo = memos.get(id);
    if (!memo?.bot) return;
    const imageHref = await memos.loadImage(memo.image);
    const current = memos.get(id);
    if (!current?.bot) return; // 読んでいる間に外した
    const anchor = anchorNearMemo(id, current.pos);
    const target = { kind: 'bot' as const, name: bots.get(current.bot)?.name ?? 'ボット', info: { state: botStateOf(current.bot) }, imageHref, comment: current.text };
    faceEditor.open(anchor, target, (result) => {
      void saveFaceImage(result.image).then((image) => memos.update(id, { text: result.comment, ...(image !== undefined ? { image } : {}) }));
    });
  }

  // ---------- メモのセル ----------
  const memoEditor = new MemoEditor(board);

  // 新しいメモのセルを書く（残すとできる。空のままならできない。書き始めたときのシートに置く）
  function writeNewMemo(at: Hex, initial = '') {
    const sheet = sheets.current;
    memoEditor.open(sidebar.anchorOfHex(at), '新しいメモ', initial, (text) => {
      if (!text.trim()) return;
      const memo = memos.add({ sheet, pos: isTaken(at, sheet) ? placeCluster(allCells(sheet), 1, at)[0] : at, text });
      if (memo) preview.showMemo(memo.id);
    });
  }

  function editMemo(id: string) {
    const memo = memos.get(id);
    if (!memo || memo.bot || memo.app) return; // ボットのセル・アプリのセルのコメントは、見た目の欄では書かない
    const anchor = anchorNearMemo(id, memo.pos);
    memoEditor.open(anchor, 'メモを書き直す', memo.text, (text) => memos.update(id, { text }));
  }

  function removeMemos(ids: string[]) {
    if (pinnedAppId) {
      const removesPinnedCell = pinnedMemoId !== null && ids.includes(pinnedMemoId);
      const cellsLeft = memos.list().some((memo) => memo.app === pinnedAppId && !ids.includes(memo.id));
      const removesThisApp = ids.some((id) => memos.get(id)?.app === pinnedAppId);
      if (removesPinnedCell || (removesThisApp && !cellsLeft)) stopPin(pinnedAppId);
    }
    const portals = ids.filter((id) => memos.get(id)?.portal).length;
    const botCells = ids.filter((id) => memos.get(id)?.bot).length;
    const appCells = ids.filter((id) => memos.get(id)?.app).length;
    // ボットのセル1つだけなら、外したあとのカードに「置き直す」を出す
    const only = ids.length === 1 ? memos.get(ids[0]) : undefined;
    if (only?.bot) preview.showRemovedBot(only.bot, { sheet: only.sheet, pos: only.pos });
    for (const id of ids) memos.remove(id);
    boardLinks.removeCells(ids.map(memoRef));
    sidebar.clearSelection();
    const what =
      portals === ids.length
        ? ids.length === 1
          ? '入口'
          : `入口 ${ids.length} 個`
        : botCells === ids.length
          ? ids.length === 1
            ? 'ボットのセル'
            : `ボットのセル ${ids.length} 個`
          : appCells === ids.length
            ? ids.length === 1
              ? 'アプリのセル'
              : `アプリのセル ${ids.length} 個`
            : ids.length === 1
              ? 'メモのセル'
              : `${ids.length} 個のメモのセル`;
    const kept = botCells === ids.length || appCells === ids.length;
    const notes = [
      ...(portals > 0 ? ['シートは残っています。左上のシートの名前 ▾ から開けます'] : []),
      ...(botCells > 0 ? ['ボットの名前とリンクは台帳に残っています。空いたセルを右クリック →「ボットのセルを置く…」で置き直せます'] : []),
      ...(appCells > 0 ? ['アプリの名前とファイルは台帳に残っています。空いたセルを右クリックすると、丸いボタンから置けます'] : []),
    ];
    toast(`${what}を${kept ? '外しました' : '消しました'}${notes.length > 0 ? `（${notes.join('。')}）` : ''}`, kept ? 5000 : undefined);
  }

  // ---------- ボットのセル（外の Grok Bot への窓口。docs/bot-cells/plan.md の第1段） ----------
  //   ・セルはメモのセルの一種（memo.bot にボットの id）。名前とリンク（エージェントの id）は台帳 bots
  //   ・置き方：空いたセルを右クリック →「ボットのセルを置く…」。台帳のボットを選ぶか、新しいボットのリンクか id を貼る
  //   ・1体のボットを何個のセルに置いてもよい（Q5）。セルを外しても台帳には残し、置き直せる（Q4）
  //   ・貼ったリンクから覚えるのは id だけ。grokbot:// の URL は C++ が組み立てる（UI には残さない）

  // そのボットを置いているセル（すべてのシート）
  const cellsOfBot = (botId: string) => memos.list().filter((m) => m.bot === botId);

  // 空いたセルの「ボットのセルを置く…」：新しいボット・台帳のボット（置いていないものが先）
  function openPlaceBotMenu(at: Hex, x: number, y: number) {
    if (!bots.ready) {
      toast('ボットの台帳を読み込んでいます。少し待ってから、もう一度どうぞ'); // 読み込む前に足すと、読み込んだ台帳で消えてしまう
      return;
    }
    const entries: MenuEntry[] = [{ section: 'ボットのセルを置く' }, { label: '新しいボット（リンクか id を貼る）…', run: () => newBotAt(at, { x, y }) }];
    const listed = bots
      .list()
      .map((bot) => ({ bot, count: cellsOfBot(bot.id).length }))
      .sort((a, b) => Number(a.count > 0) - Number(b.count > 0));
    if (listed.length > 0) {
      entries.push('sep', { section: '台帳のボット（置き直す・もう1つ置く）' });
      for (const { bot, count } of listed) {
        entries.push({ label: bot.name, hint: `${count === 0 ? '置いていない' : `盤面に ${count}`}${bot.agentId ? '' : '・リンクなし'}`, run: () => placeBot(bot.id, at) });
      }
    }
    cellMenu.open(x, y, entries);
  }

  // 新しいボット：リンクか id を貼ってもらい、名前を決めて台帳に入れ、そのセルに置く
  //   同じ id のボットが台帳にいれば、新しく作らずにそのボットを置く
  function newBotAt(at: Hex, where: { x: number; y: number }, initial = '') {
    const sheet = sheets.current;
    cellMenu.prompt(
      BOT_LINK_LABEL,
      initial,
      (text) => {
        const agentId = parseAgentInput(text);
        if (!agentId) {
          toast(BAD_BOT_LINK, 6000);
          newBotAt(at, where, text); // 貼り直せるように、欄を開き直す
          return;
        }
        const known = bots.list().find((b) => b.agentId === agentId);
        if (known) {
          placeBot(known.id, at, sheet, `このボットは台帳にいました（「${known.name}」）。`);
          return;
        }
        cellMenu.prompt(
          'ボットの名前',
          `ボット${bots.list().length + 1}`,
          (name) => {
            const bot = bots.add(name, agentId);
            if (!bot) {
              toast('ボットが多すぎて、台帳に入れられません（200 体まで）');
              return;
            }
            placeBot(bot.id, at, sheet);
          },
          where,
          { maxLength: MAX_BOT_NAME },
        );
      },
      where,
      { maxLength: 2048, placeholder: BOT_LINK_HINT },
    );
  }

  // 台帳のボットを、そのセル（ふさがっていれば近くの空いたセル）に置く。置いたセルを返す
  function placeBot(botId: string, at: Hex, sheet = sheets.current, lead = ''): MemoCell | null {
    const bot = bots.get(botId);
    if (!bot) return null;
    const target = sheets.get(sheet) ? sheet : sheets.current;
    const pos = isTaken(at, target) ? nearestFree(at, (h) => isTaken(h, target)) : at;
    const memo = memos.add({ sheet: target, pos, text: '', bot: bot.id });
    if (!memo) {
      toast('ボットのセルを置けませんでした（メモのセルが多すぎます）');
      return null;
    }
    preview.showMemo(memo.id);
    toast(`${lead}ボット「${bot.name}」のセルを置きました${bot.agentId ? '（押すと Grok Bot アプリのチャットが開きます）' : '（リンクがまだありません。右クリック →「リンクを貼る…」）'}`, 5000);
    return memo;
  }

  // ボットのセルを押した：カードに出し、Grok Bot アプリのそのボットのチャットを開く
  //   リンクが無ければ開かずに知らせる。はじめての1回だけ「外のアプリを開きます」と確かめる
  function openBot(id: string) {
    const memo = memos.get(id);
    if (!memo?.bot) return;
    preview.showMemo(id);
    const bot = bots.get(memo.bot);
    if (!bot) {
      toast('このボットが台帳に見つかりません（右クリック →「セルを外す」で片づけられます）', 5000);
      return;
    }
    if (!bot.agentId) {
      toast(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で、Grok Bot アプリの「リンクをコピー」から貼ってください`, 6000);
      return;
    }
    confirmThenLaunch(id, bot);
  }

  // はじめての1回だけ「外のアプリを開きます」と確かめてから、アプリを開く（copied：依頼をコピーしたあと。依頼の番号 #0003）
  function confirmThenLaunch(memoId: string, bot: BotEntry, copied?: string) {
    if (prefs.botAppConfirmed) {
      void launchBotApp(bot.id, copied);
      return;
    }
    const rect = sidebar.anchorOfMemo(memoId);
    cellMenu.open(rect ? rect.left : window.innerWidth / 2 - 120, rect ? rect.bottom + 4 : 120, [
      { section: '外のアプリ（Grok Bot）を開きます' },
      { label: `「${bot.name}」のチャットを、Grok Bot アプリで開きます。次からは聞きません`, disabled: true },
      {
        label: '開く',
        run: () => {
          prefs.botAppConfirmed = true;
          savePrefs(prefs);
          relayBots();
          void launchBotApp(bot.id, copied);
        },
      },
      { label: 'やめる', run: () => undefined },
    ]);
    cellMenu.focusFirst();
  }

  // ---------- アプリとの行き来（コピーで。S1.12・Q2。Webhook が使えるまでのつなぎ） ----------
  //   頼む文は、このボットの分だけ窓が開いている間だけ覚えておく（保存しない。本文そのものは残さない）
  const botDrafts = new Map<string, string>();

  // 依頼を送る部品（S3.4。bot-send.ts）：依頼（request.v1：requestId・check・attempt・replyTo "relay"・note。text の頭に台帳の役）を作って
  //   pending.json に覚え、「頼む文＋返事の決まり＋依頼の JSON」をクリップボードに入れてから、アプリのそのボットのチャットを開く。
  //   画面に出すのは番号（#0003）だけ。check は出さない。クリップボードに入れられなければ、作った依頼を取り消す
  //   盤面のボットのセル・右下の巣・右のボットの欄（botDraft）は、どれもここを通る
  // 送ったあと（依頼の小窓 v2・R8・D17）：書く前のクリップボードの中身を預かり（メモリの中だけ）、アプリから戻って askPastedSec 秒で
  //   「貼りましたか？」の札を右へ（写しの pasteAsk。1 枚だけ）。「貼った」「消す」・相手から届いたら、預かりに戻す（まだ依頼が残っているときだけ）
  const pasteClipboard: PasteClipboard = {
    read: async () => {
      const reply = await request((requestId) => ({ type: 'clipboardRead', requestId }), 5_000);
      return reply?.type === 'clipboard' ? { text: reply.text, html: reply.html } : null;
    },
    hasImage: async () => {
      const reply = await request((requestId) => ({ type: 'clipboardHasImage', requestId }), 5_000);
      return reply?.type === 'clipboardImage' && reply.present === true;
    },
    readImage: async () => {
      const reply = await request((requestId) => ({ type: 'clipboardReadImage', requestId }), 8_000);
      return reply?.type === 'clipboardImage' && reply.ok && typeof reply.image === 'string' && reply.image.startsWith('data:image/') ? reply.image : null;
    },
    writeText: async (text, html, noHistory) => {
      const reply = await request((requestId) => ({ type: 'clipboardWrite', requestId, text, html, noHistory }), 5_000);
      return reply?.type === 'clipboardWritten' && reply.ok;
    },
    writeImage: async (dataUrl) => {
      const png = dataUrl.slice(dataUrl.indexOf(',') + 1); // C++ は WIC で読む（JPEG の写しもそのまま渡せる）
      const reply = await request((requestId) => ({ type: 'clipboardWriteImage', requestId, png, fill: 'none' }), 8_000);
      return reply?.type === 'clipboardWritten' && reply.ok;
    },
  };
  const pasteWatch = new PasteWatch({
    clipboard: pasteClipboard,
    askSec: () => bots.nest().askPastedSec,
    changed: () => relayBots(),
  });

  const botSender = new ClipboardSender({
    inbox: botInbox,
    writeClipboard: writeClipboardText,
    writeImageText: copyShotWithText, // 画像と文を一つの貼り付けで（依頼の小窓 v2・R7d。読む画面が保存した写しを C++ が読む）
    openApp: (botId, no, say) => launchBotApp(botId, no, say),
    paste: pasteWatch,
    // アプリのチャットだけ（S3.5）のとき、依頼を作らないので、ここで台帳の役と巣の席を渡す
    botRole: (botId) => {
      const bot = bots.get(botId);
      if (!bot) return null;
      const seat = bots.docked().indexOf(botId) + 1;
      return { role: bot.role ?? null, ...(seat > 0 ? { seat } : {}) };
    },
  });

  // webhook「そのまま送る」（依頼の小窓 v2・R11・D20）：宛先の URL と鍵は C++ の DPAPI（bot-hook.bin）だけに置く。左は「ある／ない」（hookHas）だけを知り、
  //   右・読む画面の小窓へ写しで渡す（押せるか）。送るのは WebhookSender（依頼の JSON を C++ の botHookSend で POST。鍵は C++ が見出しに入れる）。
  //   どちらで送るかは botDraftV2 の via（hook）で決める（試し便・盤面のセル・右の botDraft は今までどおりコピー）。
  //   中継の答えは 16 秒まで待つ（C++ は段ごとに 15 秒）。届かなければ依頼は残し、同じ依頼を attempt を 1 増やしてコピーに切り替えられる（botHookFallback）
  let hookHas = false;
  async function refreshHook() {
    const reply = await request((requestId) => ({ type: 'getBotHook', requestId }), 5_000);
    const has = reply?.type === 'botHook' && reply.has === true;
    if (has === hookHas) return;
    hookHas = has;
    relayBots();
  }
  const HOOK_WHY: Record<string, string> = {
    timeout: '15 秒待っても中継が答えませんでした',
    tls: '安全な接続を作れませんでした（証明書など）',
    connect: '中継につながりませんでした',
    noHook: '中継の宛先と鍵がありません',
    badUrl: '宛先か鍵の形が違います',
    badRequest: '依頼の形が違いました',
  };
  const hookWhy = (error: string | undefined, status: number) => (error === 'http' ? `中継が受けませんでした（HTTP ${status}）` : (HOOK_WHY[error ?? ''] ?? '中継へ送れませんでした'));
  const hookSender = new WebhookSender({
    inbox: botInbox,
    ready: () => hookHas,
    post: async (botId, requestId, json): Promise<HookPostResult> => {
      const agentId = bots.get(botId)?.agentId;
      const reply = await request((rid) => ({ type: 'botHookSend', requestId: rid, botRequestId: requestId, body: json, ...(agentId ? { agentId } : {}) }), 16_000);
      if (reply?.type !== 'botHookSent') return { ok: false, why: '16 秒待っても答えがありませんでした。あとで届くこともあります' };
      return reply.ok ? { ok: true } : { ok: false, why: hookWhy(reply.error, reply.status) };
    },
  });

  // webhook の結果を、頼んだ小窓へ（右と読む画面の両方。ticket で合わせる。R11）。鍵・URL は入れない
  function answerHook(ticket: string, botId: string, sent: SendResult) {
    if (!ticket) return;
    const payload: RelayPayload = sent.ok
      ? { kind: 'botHookResult', ticket, botId, ok: true, ...(sent.requestId ? { requestId: sent.requestId } : {}), ...(sent.no ? { no: sent.no } : {}) }
      : { kind: 'botHookResult', ticket, botId, ok: false, message: sent.message, ...(sent.fallback ? { requestId: sent.fallback.requestId, no: sent.fallback.no, fallback: true } : {}) };
    if (rightReady || sidebars.right.visible) send({ type: 'relay', to: 'right', payload });
    if (readerReady) send({ type: 'relay', to: 'reader', payload });
  }

  // webhook で届かなかった依頼を、同じ依頼（requestId・check は同じ。attempt を 1 増やす）で「コピーしてアプリを開く」に（R11・D20）。
  //   依頼は窓が開いているあいだだけ覚えている（頼む文は記録に残さない）。書けなければ依頼はそのまま（もう一度押せる）
  const HOOK_RETRY_TEXT = {
    unknown: 'その依頼が見つかりませんでした',
    notFailed: 'その依頼は中継が受けています（まだ答えを待っているときは、少し待ってからどうぞ）',
    done: 'その依頼は、もう返事が届いたか、待つのをやめたか、コピーに切り替えてあります',
    gone: '窓を開き直したので、同じ依頼はもう出せません（頼む文は記録に残さないため）。受け取り箱の「待つのをやめる」で片づけて、小窓から頼み直してください',
  } as const;
  async function hookToCopy(botId: string, requestId: string) {
    const bot = bots.get(botId);
    if (!bot) return;
    const say = (text: string, ms?: number) => {
      toast(text, ms);
      tellRight(botId, text);
    };
    if (!bot.agentId) {
      say(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ`, 6000);
      return;
    }
    const retry = botInbox.hookRetry(botId, requestId);
    if (!retry.ok) {
      say(HOOK_RETRY_TEXT[retry.why], 7000);
      return;
    }
    if (!(await botSender.copyAgain(botId, retry.request, retry.no, { say }))) {
      say(CLIPBOARD_ERROR_TEXT, 7000);
      return;
    }
    botInbox.markCopied(botId, requestId, retry.request.attempt);
  }

  // 頼む文を書いてもらい、依頼にしてクリップボードに入れてから、アプリのそのボットのチャットを開く（貼って送るのは使う人）
  function copyAndOpenBot(memoId: string) {
    const memo = memos.get(memoId);
    const bot = bots.get(memo?.bot);
    if (!memo || !bot) return;
    if (!bot.agentId) {
      toast(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ`, 6000);
      return;
    }
    const anchor = sidebar.anchorOfMemo(memoId) ?? sidebar.anchorOfHex(memo.pos);
    memoEditor.open(
      anchor,
      `「${bot.name}」に頼む文（コピーしてから、Grok Bot アプリを開きます）`,
      botDrafts.get(bot.id) ?? '',
      (text) => {
        const request = text.trim();
        if (!request) {
          toast('頼む文が空です。書いてから、もう一度どうぞ');
          return;
        }
        botDrafts.set(bot.id, request);
        // アプリは、はじめての1回だけ確かめてから開く（confirmThenLaunch）
        void botSender
          .send(
            { botId: bot.id, text: request },
            {
              open: (no) => {
                toast(`依頼 ${no} をコピーしました。Grok Bot アプリのチャットに貼り付けて（Ctrl+V）送ってください`, 6000);
                if (bots.get(bot.id)?.agentId) confirmThenLaunch(memoId, bot, no);
              },
            },
          )
          .then((sent) => {
            if (!sent.ok) toast(sent.message, 7000);
          });
      },
      undefined,
      { okLabel: 'コピーしてアプリを開く', placeholder: '頼む文（Ctrl+Enter でコピーしてアプリを開く・Esc でやめる）' },
    );
  }

  // アプリでコピーした返事を、ボットのセルの隣にメモのセルとして置く
  //   前にコピーした別の文（パスワードなど）がメモにならないよう、最初の 200 字を見せて確かめてから
  //   外から来た文なので、相棒の返事の印（by）は付けない。先頭の行に「どこから来たか」を書く。リンクは押したときだけ開く
  async function pasteBotReply(memoId: string) {
    const memo = memos.get(memoId);
    if (!memo?.bot) return;
    const name = bots.get(memo.bot)?.name ?? 'ボット';
    const raw = await readClipboardText();
    const reply = cleanExternalText(raw);
    if (!reply) {
      toast(raw === null ? 'クリップボードを読めませんでした。もう一度どうぞ' : 'クリップボードに文字がありません。Grok Bot アプリで返事をコピーしてから、もう一度どうぞ', 6000);
      return;
    }
    const total = [...reply].length;
    const head = headOf(reply, REPLY_PREVIEW_CHARS);
    const body = botReplyMemoText(name, reply, MAX_MEMO_TEXT);
    const rect = sidebar.anchorOfMemo(memoId);
    cellMenu.open(rect ? rect.left : window.innerWidth / 2 - 140, rect ? rect.bottom + 4 : 120, [
      { section: `クリップボードの文を、「${name}」の返事としてメモにします` },
      { note: head.cut ? `${head.text}…` : head.text },
      { label: head.cut ? `最初の ${REPLY_PREVIEW_CHARS} 字だけ出しています（全部で ${total} 字）` : `全部で ${total} 字`, disabled: true },
      ...(body.cut ? [{ label: 'メモに入りきらない分は切ります', disabled: true }] : []),
      { label: 'メモにする', run: () => placeBotReply(memoId, body.text) },
      { label: 'やめる', run: () => undefined },
    ]);
    cellMenu.focusFirst();
  }

  function placeBotReply(memoId: string, text: string) {
    const memo = memos.get(memoId);
    if (!memo) {
      toast('ボットのセルが見つからないので、メモにできませんでした（外したかもしれません）');
      return;
    }
    const sheet = memo.sheet;
    const placed = memos.add({ sheet, pos: nearestFree(memo.pos, (h) => isTaken(h, sheet)), text });
    if (!placed) {
      toast('メモのセルを置けませんでした（メモのセルが多すぎます）');
      return;
    }
    preview.showMemo(placed.id);
    toast('返事を、ボットのセルの隣にメモのセルとして置きました（外から来た文の印付き。リンクは押したときだけ開きます）', 5000);
  }

  // C++ に頼んで Grok Bot アプリを開く（渡すのはエージェントの id だけ。grokbot:// の URL は C++ が組み立てる）
  //   返事を待っている間は、同じボットをもう一度開かない。アプリが無ければ、すべてのボットのセルを「アプリなし」の顔に
  const botOpening = new Set<string>();
  //   opened：開けたときの知らせを差し替える（アプリのチャットだけで送ったとき。依頼の番号が無い）
  async function launchBotApp(botId: string, copied?: string, say: (text: string, ms?: number) => void = toast, opened?: string) {
    const bot = bots.get(botId);
    if (!bot) {
      say('送り先の Grok Bot が台帳に見つかりません。右のボットの欄を開き直してから、もう一度どうぞ', 7000);
      return;
    }
    if (!bot.agentId) {
      say(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ`, 6000);
      return;
    }
    if (botOpening.has(bot.id)) {
      say(`「${bot.name}」のアプリは、今開いているところです。少し待ってから、もう一度押してください`, 6000);
      return;
    }
    botOpening.add(bot.id);
    const result = await openBotApp(bot.agentId);
    botOpening.delete(bot.id);
    const missing = !result.ok && result.error === 'noApp';
    if ((result.ok || missing) && missing !== botAppMissing) setBotAppMissing(missing);
    if (result.ok && opened) say(opened, 7000);
    else if (result.ok) say(copied ? `Grok Bot アプリで「${bot.name}」のチャットを開きました。依頼 ${copied} はコピーしてあるので、貼り付けて（Ctrl+V）送ってください` : `Grok Bot アプリで「${bot.name}」のチャットを開きました`, copied ? 7000 : undefined);
    else say(botAppErrorText(result.error), 7000);
  }

  // アプリが見つからなかった・開けた：すべてのボットのセルの顔と、右下の Grok Bot を描き直す
  function setBotAppMissing(missing: boolean) {
    botAppMissing = missing;
    sidebar.requestRender();
    preview.render();
    relayBots();
  }

  // セルの顔の状態（リンクなし・アプリなし）
  // セルの顔の状態（リンクなし・アプリなし・第2段の返事あり・待っている など）と、札の数
  const botStateOf = (botId: string | undefined) => botFullState(bots.get(botId), botAppMissing, botId && botInbox.ready ? botInbox.activity(botId) : undefined);
  const botBadgesOf = (botId: string | undefined) => (botId && botInbox.ready ? botInbox.activity(botId) : undefined);

  // メニュー・欄を出す場所（セルの下）
  function nearMemo(id: string): { x: number; y: number } | undefined {
    const rect = sidebar.anchorOfMemo(id);
    return rect ? { x: rect.left, y: rect.bottom + 4 } : undefined;
  }

  // リンクを貼る・貼り直す（覚えるのは id だけ。欄には今の id もリンクも出さない）
  function editBotLink(memoId: string, at?: { x: number; y: number }, initial = '') {
    const bot = bots.get(memos.get(memoId)?.bot);
    if (!bot) return;
    cellMenu.prompt(
      BOT_LINK_LABEL,
      initial,
      (text) => {
        const agentId = parseAgentInput(text);
        if (!agentId || !bots.setAgentId(bot.id, agentId)) {
          toast(BAD_BOT_LINK, 6000);
          editBotLink(memoId, at, text);
          return;
        }
        toast(`「${bot.name}」にリンクを付けました（id：${agentId}）。押すと Grok Bot アプリのチャットが開きます`, 5000);
      },
      at ?? nearMemo(memoId),
      { maxLength: 2048, placeholder: BOT_LINK_HINT },
    );
  }

  // ボットの名前を変える（台帳の名前なので、同じボットのセル全部が変わる）
  function renameBot(memoId: string, at?: { x: number; y: number }) {
    const bot = bots.get(memos.get(memoId)?.bot);
    if (!bot) return;
    cellMenu.prompt('ボットの新しい名前', bot.name, (name) => bots.rename(bot.id, name), at ?? nearMemo(memoId), { maxLength: MAX_BOT_NAME });
  }

  // セルを外す（確かめてから）。ボットは台帳に残る
  function confirmRemoveBotCell(memoId: string) {
    const memo = memos.get(memoId);
    if (!memo?.bot) return;
    const bot = bots.get(memo.bot);
    const others = cellsOfBot(memo.bot).length - 1;
    cellMenu.open(window.innerWidth / 2 - 120, 120, [
      { section: bot ? `ボット「${bot.name}」のセルを外します` : 'ボットのセルを外します' },
      { label: bot ? `名前とリンクは台帳に残り、あとで置き直せます${others > 0 ? `（ほかのセル ${others} 個はそのまま）` : ''}` : '台帳に無いボットのセルです', disabled: true },
      { label: '外す', run: () => removeMemos([memoId]) },
      { label: 'やめる', run: () => undefined },
    ]);
  }

  // 外したセルを置き直す（外した所。ふさがっていれば近くの空いたセル。シートが無くなっていたら今のシート）
  function replaceBot(botId: string, at: { sheet: string; pos: Hex }) {
    const sheet = sheets.get(at.sheet) ? at.sheet : sheets.current;
    const memo = placeBot(botId, at.pos, sheet);
    if (memo && memo.sheet !== sheets.current) switchSheet(memo.sheet);
  }

  // ボットのセルを右クリックしたときのメニュー
  function openBotMenu(memo: MemoCell, info: { hex: Hex | null; x: number; y: number }) {
    const bot = bots.get(memo.bot);
    const at = { x: info.x, y: info.y };
    const entries: MenuEntry[] = [{ section: bot ? `ボット「${bot.name}」` : 'ボット（台帳に見つかりません）' }];
    if (bot) {
      entries.push({ label: 'Grok Bot アプリで開く', hint: 'クリック', disabled: !bot.agentId, run: () => openBot(memo.id) });
      entries.push(cardWinEntry({ kind: 'memo', id: memo.id }));
      entries.push({ label: bot.agentId ? 'リンクを貼り直す…' : 'リンクを貼る…', run: () => editBotLink(memo.id, at) });
      entries.push({ label: '名前を変える…', run: () => renameBot(memo.id, at) });
      entries.push('sep');
      entries.push({ label: 'コピーしてアプリを開く…', disabled: !bot.agentId, run: () => copyAndOpenBot(memo.id) });
    }
    entries.push({ label: 'クリップボードの返事をメモにする…', run: () => void pasteBotReply(memo.id) });
    entries.push('sep');
    entries.push({ label: '見た目（画像・コメント）…', run: () => void editBotFace(memo.id) });
    const armImage = queueCellImage(entries, { kind: 'memo', id: memo.id });
    entries.push({ label: 'セルを外す（台帳には残る）…', run: () => confirmRemoveBotCell(memo.id) });
    entries.push(...sheetJumpEntries(info.x, info.y));
    entries.push(...setEntries(info.hex));
    cellMenu.open(info.x, info.y, entries);
    armImage();
  }

  const botActions: BotActions = {
    open: (id) => openBot(id),
    link: (id) => editBotLink(id),
    rename: (id) => renameBot(id),
    editFace: (id) => void editBotFace(id),
    copyAndOpen: (id) => copyAndOpenBot(id),
    pasteReply: (id) => void pasteBotReply(id),
    thread: (id) => {
      const botId = memos.get(id)?.bot;
      if (botId && bots.get(botId)) openBotThread(botId);
    },
    remove: (id) => removeMemos([id]),
    replace: (botId, at) => replaceBot(botId, at),
  };

  // ---------- タグを足す・外す（カードの「＋タグ」とタグのボタン、右のカード・右のコメントから） ----------
  //   その時のタグに対して足し引きする（右から続けて押しても、前の押した分を消さない）。1つに 10 個まで
  function changedTags(current: readonly string[], add: readonly unknown[], remove: readonly unknown[]): string[] | null {
    const done = changeTagList(current, add, remove);
    if (done.over) toast(`タグは1つに ${MAX_TAGS_PER_TAB} 個までです（ほかのタグを外してから付けてください）`);
    return done.tags;
  }

  function changeTabTags(id: number, add: readonly unknown[], remove: readonly unknown[]) {
    const tab = store.get(id);
    const tags = tab ? changedTags(tab.tags, add, remove) : null;
    if (tags) store.setTags(id, tags);
  }

  function changeMemoTags(id: string, add: readonly unknown[], remove: readonly unknown[]) {
    const memo = memos.get(id);
    const tags = memo && !isSpecialCell(memo) ? changedTags(memo.tags, add, remove) : null; // 入口・ボットのセルにはタグを付けない
    if (tags) memos.update(id, { tags });
  }

  // 使っているタグと数（タブ・メモのセル。タグのボタンの「その他」と、空いたボタンに登録するとき）
  function usedTags(): TagUse[] {
    const counts = new Map<string, number>();
    for (const tab of store.all()) for (const tag of tab.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    for (const memo of memos.list()) if (!isSpecialCell(memo)) for (const tag of memo.tags) if (!isMachineTag(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
  }

  // 左のタグのボタン（6つ・セット・その他）：拡大表示のカード（タブ・メモのセル）に出す。右のボタンとは別
  const tagButtons = new TagButtonStore('left');
  void tagButtons.load();
  const tagPad = new TagPad({ store: tagButtons, menu: cellMenu, side: '左サイドバー', used: usedTags, toast: (text) => toast(text, 4500) });

  const memoActions: MemoActions = {
    edit: (id) => editMemo(id),
    remove: (id) => removeMemos([id]),
    setLiked: (id, liked) => memos.update(id, { liked }),
    changeTags: (id, add, remove) => changeMemoTags(id, add, remove),
    openUrl: (url) => {
      if (/^https?:\/\//i.test(url)) requestTab(url, { activate: true });
    },
    sendToHexMemo: (id) => {
      const memo = memos.get(id);
      if (memo) void sendCellsToHexMemo(cellsOfTabs([], [memo])); // ほかのシートのメモのカードからも送れるように、選択を通さない
    },
    askCompanion: (id) => {
      const memo = memos.get(id);
      if (!memo) return;
      void (async () => {
        const url = memo.source?.url ?? '';
        const blocked = await pageIsBlocked(url);
        sendToRight({
          kind: 'askCompanion',
          from: 'memo',
          text: memo.text,
          title: memo.source?.title ?? '',
          url: blocked ? '' : url,
          ...(blocked ? {} : { image: memos.image(memo.image) }),
        });
        toast(blocked ? BLOCK_NOTE : '右の相棒に見せています');
      })();
    },
    openPane: (id) => {
      if (memoPane.isOpen(id)) memoPane.close();
      else memoPane.open(id);
    },
    isPaneOpen: (id) => memoPane.isOpen(id),
    leaveIsland: (id) => memos.setIsland([id], null),
    saveToVault: (id) => {
      const memo = memos.get(id);
      if (!memo?.by) return;
      const kind = memo.label ?? '考察';
      const head = [...memo.text.trim().split('\n')[0]].slice(0, 40).join('');
      sendToRight({
        kind: 'vaultAdd',
        draft: {
          kind: 'memo',
          title: `${memo.by.name}の${kind}${head ? `：${head}` : ''}`,
          text: memo.text,
          data: { version: 1, memo: { id: memo.id, text: memo.text, tags: memo.tags, by: memo.by, label: kind, source: memo.source, createdAt: memo.createdAt, updatedAt: memo.updatedAt } },
          sourceAt: memo.createdAt,
          source: { memoId: memo.id, speaker: memo.by.name, model: memo.by.model, pageTitle: memo.source?.title, pageUrl: memo.source?.url },
          tags: memo.tags,
        },
      });
      toast('右の「データ置き場」に入れています');
    },
  };

  // ---------- コメントのスレッド（メモのセルの文章・タブのメモへの返信。X の返信のように何段でも） ----------
  //   返信の持ち主はメモのセル・タブのメモ（このサイドバー）。右サイドバーのカードからも relay で頼まれる
  const replyPending: PendingReply[] = []; // 相棒が返信を書いている途中（カードに「書いています…」を出す）

  // スレッドの元のポストと返信（無ければ null）
  function threadOf(ref: ThreadRef): { post: ThreadPost; replies: Reply[]; image?: string } | null {
    if (ref.kind === 'memo') {
      const memo = memos.get(ref.id);
      if (!memo) return null;
      const context = memo.source ? `スクショ「${memo.source.title || memo.source.url}」に付けたコメント` : memo.image ? 'スクショのメモ' : 'メモのセル';
      // 画像だけのメモ（コメントなしのスクショ）：画像はこの頼みには入れないので、そう伝える
      const text = memo.text || (memo.image ? '（画像だけのメモ。画像はこの依頼には含まれていません）' : '');
      const author = memo.by ? `AI の相棒（${memo.by.name}の${memo.label ?? '考察'}）` : '使う人';
      return { post: { text, createdAt: memo.createdAt, author, context }, replies: memo.replies ?? [], image: memo.image };
    }
    const tab = store.get(ref.tabId);
    const note = tab?.notes.find((n) => n.id === ref.noteId);
    if (!tab || !note) return null;
    const author = note.source === 'user' ? '使う人' : `AI の相棒（${note.label ?? 'AI'}）`;
    return { post: { text: note.text, createdAt: note.createdAt, author, context: `ページ「${tab.title || tab.url}」（${tab.url}）のメモ` }, replies: note.replies ?? [] };
  }

  function addReplyTo(ref: ThreadRef, parent: string | null, text: string, by?: ReplyAuthor): Reply | null {
    return ref.kind === 'memo' ? memos.addReply(ref.id, parent, text, by) : store.addNoteReply(ref.tabId, ref.noteId, parent, text, by);
  }

  function setReplyPending(next: PendingReply[]) {
    replyPending.splice(0, replyPending.length, ...next);
    preview.render();
    relayReplyPending();
  }

  // 右サイドバーへ（閉じても裏に残っているので、閉じている間も届ける。開き直したとき・動き出したときにも）
  function relayReplyPending() {
    const pending = [...replyPending];
    if (rightReady) send({ type: 'relay', to: 'right', payload: { kind: 'threadPending', pending } });
    if (memoReady) send({ type: 'relay', to: 'memo', payload: { kind: 'threadPending', pending } });
  }

  const threadActions: ThreadActions = {
    add: (ref, parent, text) => {
      if (!addReplyTo(ref, parent, text)) toast('返信を足せませんでした（返信先が消えたか、返信が多すぎます）');
    },
    remove: (ref, replyId) => {
      if (ref.kind === 'memo') memos.removeReply(ref.id, replyId);
      else store.removeNoteReply(ref.tabId, ref.noteId, replyId);
    },
    copy: (ref, replyId) => void copyComment(ref, replyId),
    ai: (ref, parent, who) => void aiReply(ref, parent, who),
    edit: (ref, replyId, text) => {
      if (ref.kind !== 'memo') return; // タブのメモへの返信は書き直さない
      const memo = memos.get(ref.id);
      if (!memo || isSpecialCell(memo) || !memos.editReply(ref.id, replyId, text)) toast('書き直せませんでした');
    },
  };
  const threadUi: ThreadUi = {
    actions: threadActions,
    pending: replyPending,
    refresh: () => preview.render(),
    shot: (id) => memos.image(id),
    openSource: (url, fragmentUrl) => openQuote(url, fragmentUrl),
  };

  // コメント1つを、メモのセル1つとしてコピーする（下の返信は、そのセルのスレッドになる）。盤面に貼ると、メモのセルになる
  //   入口・ボットのセルのコメントはコピーしない（ボットのセルは写さない）
  async function copyComment(ref: ThreadRef, replyId: string | null) {
    const thread = threadOf(ref);
    const memo = ref.kind === 'memo' ? memos.get(ref.id) : undefined;
    if (memo && isSpecialCell(memo)) {
      toast(memo.capture ? '撮ったもののセルはコピーしません' : memo.bot ? 'ボットのセルはコピーしません' : memo.app ? 'アプリのセルはコピーしません' : '入口はコピーしません');
      return;
    }
    // 元のポストは、メモのセルなら本当の文章（画像だけのメモは空）
    const text = replyId === null ? (memo ? memo.text : thread?.post.text) : thread?.replies.find((r) => r.id === replyId)?.text;
    const image = replyId === null ? thread?.image : undefined;
    if (!thread || text === undefined || (!text && !image)) {
      toast('コピーできるコメントがありません');
      return;
    }
    const replies = regraft(thread.replies, replyId);
    // 元のポストなら、AI の相棒が残したものの印（考察・レター）も一緒に
    const mark = replyId === null && memo?.by ? { by: { who: memo.by.who, name: memo.by.name }, ...(memo.label ? { label: memo.label } : {}) } : {};
    const cell: CellItem = { dq: 0, dr: 0, url: '', title: '', memo: { text, ...(image ? { image } : {}), ...(replies.length > 0 ? { replies } : {}), ...mark } };
    const nonce = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    copied = { nonce, cells: [cell] };
    const written = await writeCellsToClipboard([cell], nonce);
    const extra = replies.length > 0 ? `（下の返信 ${replies.length} 件も一緒に）` : '';
    // 関連は写らない：このカードが関連を持つ、またはほかの一番上のカードがこのカードを相手に持つとき（スレッドを丸ごとのときは regraft で写る）
    const lostLinks =
      replyId !== null &&
      (thread.replies.some((r) => r.id === replyId && (r.links ?? []).length > 0) ||
        thread.replies.some((r) => r.parent === null && r.id !== replyId && (r.links ?? []).some((l) => l.to === replyId)));
    toast(
      written
        ? `コメントをコピーしました${extra}${lostLinks ? '（このカードの関連は写りません）' : ''}。盤面の空いたセルで Ctrl+V（右クリック →「貼り付け」）すると、メモのセルになります`
        : 'コメントをコピーできませんでした（Windows のクリップボードに書けませんでした）',
    );
  }

  // 右サイドバーから頼まれた文（フェイブルレターなど）を、メモのセル1つとしてコピーする。盤面に貼ると、書いたキャラの印つきのメモのセルになる
  async function copyMemoCell(text: string, by?: ReplyAuthor, label?: string) {
    const cell: CellItem = { dq: 0, dr: 0, url: '', title: '', memo: { text, ...(by ? { by, ...(label ? { label } : {}) } : {}) } };
    const nonce = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    copied = { nonce, cells: [cell] };
    const written = await writeCellsToClipboard([cell], nonce);
    toast(
      written
        ? `${label ?? 'メモ'}をコピーしました。盤面の空いたセルで Ctrl+V（右クリック →「貼り付け」）すると、メモのセルになります`
        : `${label ?? 'メモ'}をコピーできませんでした（Windows のクリップボードに書けませんでした）`,
    );
  }

  // 相棒（今の会話のメンバー）に、返信を書いてもらう。all はメンバーが順に（あとのキャラは、前の返信も読んでから）。
  // ハイク組（team、all の中のハイク組）は、会話と同じく 3体までは全員、4体からはモミジ（代表）か最初の班
  async function aiReply(ref: ThreadRef, parent: string | null, who: string) {
    const first = readAiSettings(null);
    const cast = first.cast;
    const team = teamSpeakers(teamOf(cast.members), cast.haiku.speak, 0);
    const list: CharacterId[] =
      who === 'all' ? [...cast.members.filter((id) => !isHaiku(id)), ...team] : who === 'team' ? team : isCharacterId(who) ? [who] : [];
    if (list.length === 0) return;
    const settings = { ...first, apiKey: first.practice ? null : await fetchApiKey() };
    for (const id of list) {
      const name = nameOf(settings.cast, id);
      const mark: PendingReply = { key: threadKey(ref), parent, who: id, name };
      setReplyPending([...replyPending, mark]);
      try {
        const thread = threadOf(ref);
        if (!thread || (parent !== null && !thread.replies.some((r) => r.id === parent))) break; // 返信先が消えた
        const written = await writeThreadReply(thread.post, thread.replies, parent, id, settings);
        if (!addReplyTo(ref, parent, written.text, { who: id, name, model: written.model, cost: written.cost })) {
          toast('返信を足せませんでした（返信先が消えたか、返信が多すぎます）');
          break;
        }
      } catch (error) {
        toast(error instanceof ThreadReplyError ? error.message : `${name}の返信を書けませんでした：${describeError(error)}`);
        break;
      } finally {
        setReplyPending(replyPending.filter((p) => p !== mark));
      }
    }
  }

  // API キー（右の相棒の ⚙ で保存したもの）を C++ から受け取る
  let apiKeyWaiters: ((key: string | null) => void)[] = [];
  function fetchApiKey(): Promise<string | null> {
    return new Promise((resolve) => {
      const done = (key: string | null) => {
        window.clearTimeout(timer);
        resolve(key);
      };
      const timer = window.setTimeout(() => {
        apiKeyWaiters = apiKeyWaiters.filter((w) => w !== done);
        resolve(null);
      }, 5_000);
      apiKeyWaiters.push(done);
      send({ type: 'getApiKey' });
    });
  }

  // ---------- 盤面の右クリック：登録したシートへ移る（いまの項目のうしろに足すだけ） ----------
  //   ボタンは6つまで。登録のしかたは、右サイドバーの区画タグと同じ（番号に入れる・同じシートは1つ・空は出さない）
  //   シートのセットは、右のメモで保存したものの一覧。選んでも右のタブは動かさない（盤面が移るだけ）

  function jumpToSheet(id: string) {
    if (id === sheets.current) {
      toast('いまのシートです');
      return;
    }
    switchSheet(id);
  }

  function rememberSheetSlots() {
    if (sessionReady) sheetSlots.prune((id) => !!sheets.get(id));
  }

  function sheetJumpEntries(x: number, y: number): MenuEntry[] {
    rememberSheetSlots();
    const entries: MenuEntry[] = ['sep', { section: 'シートへ移る' }];
    const pills: MenuButton[] = [];
    sheetSlots.list.forEach((id, index) => {
      if (!id) return;
      const sheet = sheets.get(id);
      if (!sheet) return;
      const here = sheet.id === sheets.current;
      pills.push({
        label: sheet.name,
        title: here ? `シート${index + 1}：${sheet.name}（いまのシート）` : `シート${index + 1}：${sheet.name}。押すとこのシートに移ります`,
        current: here,
        close: true,
        run: () => jumpToSheet(sheet.id),
      });
    });
    if (pills.length === 0) entries.push({ label: 'まだありません（「このシートをボタンに登録」で入れられます）', disabled: true });
    else entries.push({ pills });
    entries.push({ label: 'このシートをボタンに登録…', run: () => openSheetSlotMenu(x, y) });
    entries.push({ label: 'シートのセット…', run: () => openSheetSetMenu(x, y) });
    entries.push({ label: 'その他のシート…', run: () => openOtherSheetsMenu(x, y) });
    return entries;
  }

  // 右の区画タグの「タグ1に登録」と同じ並び。入れるのは、いま見ているシート
  function openSheetSlotMenu(x: number, y: number) {
    rememberSheetSlots();
    const current = sheets.currentSheet;
    const entries: MenuEntry[] = [{ section: `「${current.name}」をボタンに登録` }];
    for (let i = 0; i < SHEET_SLOT_COUNT; i++) {
      const occupant = sheetSlots.list[i];
      const name = occupant ? sheets.get(occupant)?.name : undefined;
      const hint = occupant === current.id ? 'このシート' : name;
      const slot = i;
      entries.push({
        label: `シート${i + 1}に登録`,
        hint,
        run: () => {
          if (sheetSlots.list[slot] === current.id) {
            toast(`すでにシート${slot + 1}のボタンです`);
            return;
          }
          const previous = name && occupant !== current.id ? `（前の「${name}」は外れます）` : '';
          sheetSlots.register(current.id, slot);
          toast(`「${current.name}」をシート${slot + 1}のボタンにしました${previous}。もう一度右クリックすると、ボタンが出ます`, 5000);
        },
      });
    }
    cellMenu.open(x, y, entries);
  }

  // 右のメモで保存したシートのセット。中のシートを選ぶと盤面が移る。セットは開かない（右のタブはそのまま）
  function openSheetSetMenu(x: number, y: number) {
    cellMenu.open(x, y, [{ section: 'シートのセット' }, { label: '読み込んでいます…', disabled: true }]);
    const token = cellMenu.token();
    void readData<unknown>('right-sheets.json').then((raw) => {
      const sets = sheetSetsIn(raw);
      const entries: MenuEntry[] = [{ section: 'シートのセット' }];
      if (sets.length === 0) {
        entries.push({ label: 'まだありません（右のメモの「保存」で作れます）', disabled: true });
      } else {
        entries.push({ note: '名前を押すと、中のシートが出ます。選んでも、右のメモのタブは変わりません。' });
        for (const set of sets) {
          entries.push({ label: set.name, hint: `${set.sheets.length}`, run: () => openOneSheetSet(x, y, set) });
        }
      }
      cellMenu.update(entries, token);
    });
  }

  function openOneSheetSet(x: number, y: number, set: { name: string; sheets: string[] }) {
    const entries: MenuEntry[] = [{ section: set.name }];
    let any = false;
    for (const id of set.sheets) {
      const sheet = sheets.get(id);
      if (!sheet) continue;
      any = true;
      const here = sheet.id === sheets.current;
      entries.push({ label: sheet.name, hint: here ? 'いまのシート' : undefined, disabled: here, run: () => jumpToSheet(sheet.id) });
    }
    if (!any) entries.push({ label: 'このセットのシートは、もうありません', disabled: true });
    cellMenu.open(x, y, entries);
  }

  // 6つのボタンに入っていないシート（右の「その他…」は全部出すが、こちらはボタンに無いものだけ）
  function openOtherSheetsMenu(x: number, y: number) {
    rememberSheetSlots();
    const pinned = new Set(sheetSlots.list.filter((id): id is string => !!id));
    const entries: MenuEntry[] = [{ section: 'その他のシート' }];
    const rest = sheets.list().filter((sheet) => !pinned.has(sheet.id));
    if (rest.length === 0) {
      entries.push({ label: 'ボタンに入っていないシートはありません', disabled: true });
    } else {
      for (const sheet of rest) {
        const count = store.inSheet(sheet.id).length + memos.inSheet(sheet.id).length;
        const here = sheet.id === sheets.current;
        entries.push({ label: sheet.name, hint: here ? 'いまのシート' : `${count}`, disabled: here, run: () => jumpToSheet(sheet.id) });
      }
    }
    cellMenu.open(x, y, entries);
  }

  // ---------- アプリのセル（Windows のアプリを盤面に登録。docs/plan-app-cells.md） ----------
  //   A3：ダブルクリックで中央の区画に合わせ、最前面にする。もう一度でやめる。追従は A4
  const openingApps = new Set<string>();

  function stopPin(appId: string | null) {
    if (!appId || pinnedAppId !== appId) return;
    const app = apps.get(appId);
    pinnedAppId = null;
    pinnedMemoId = null;
    if (app) void summonApp(app, { release: true });
    preview.render();
  }

  async function launchAppCell(id: string) {
    const memo = memos.get(id);
    if (!memo?.app) return;
    preview.showMemo(id);
    const app = apps.get(memo.app);
    if (!app) {
      toast('このアプリが台帳に見つかりません（右クリック →「セルを外す」で片づけられます）', 5000);
      return;
    }
    if (openingApps.has(app.id)) return;
    const releasing = pinnedAppId === app.id;
    openingApps.add(app.id);
    if (!releasing) {
      pinnedAppId = null;
      pinnedMemoId = null;
    }
    try {
      const result = await summonApp(app, { release: releasing });
      if (result.ok && result.aumid) apps.rememberAumid(app.id, result.aumid);
      if (result.ok && (result.action === 'placed' || result.action === 'fixed')) {
        pinnedAppId = app.id;
        pinnedMemoId = id;
        if (result.host) apps.rememberHost(app.id, result.host);
      } else if (pinnedAppId === app.id) {
        pinnedAppId = null;
        pinnedMemoId = null;
      }
      let text = summonResultText(app.name, result);
      if (result.ok && result.action === 'waiting' && isStoreTarget(app.target)) {
        text = `「${app.name}」の窓を特定できませんでした。ほかのアプリの窓は動かしていません`;
      }
      if (result.ok && result.action === 'fixed' && result.overlap) {
        if (overlapTold.has(app.id)) text = `「${app.name}」は大きさを変えられないので、中央に寄せました`;
        else overlapTold.add(app.id);
      }
      if (text) toast(text, 6000);
      preview.render();
    } finally {
      openingApps.delete(app.id);
    }
  }

  function placeApp(appId: string, at: Hex, sheet = sheets.current) {
    const app = apps.get(appId);
    if (!app) return null;
    const target = sheets.get(sheet) ? sheet : sheets.current;
    const pos = isTaken(at, target) ? nearestFree(at, (h) => isTaken(h, target)) : at;
    const memo = memos.add({ sheet: target, pos, text: '', app: app.id });
    if (!memo) {
      toast('アプリのセルを置けませんでした（メモのセルが多すぎます）');
      return null;
    }
    apps.touch(app.id);
    preview.showMemo(memo.id);
    return memo;
  }

  async function registerApp(at: Hex) {
    const picked = await pickAppFile();
    if (!picked.ok) {
      const text = pickAppErrorText(picked.error);
      if (text) toast(text, 5000);
      return;
    }
    const existing = apps.findLaunch(picked.app.launch);
    if (existing) {
      if (placeApp(existing.id, at)) toast(`「${existing.name}」は登録してありました。このセルに置きました。ダブルクリックで、中央に出します`, 6000);
      return;
    }
    if (apps.list().length >= MAX_APPS) {
      toast(`アプリが多すぎて、台帳に入れられません（${MAX_APPS} 件まで）`);
      return;
    }
    const app = apps.add(picked.app);
    if (!app) {
      toast(`アプリが多すぎて、台帳に入れられません（${MAX_APPS} 件まで）`);
      return;
    }
    if (!placeApp(app.id, at)) {
      apps.remove(app.id);
      return;
    }
    toast(`アプリ「${app.name}」を登録しました。ダブルクリックで、中央に出します`, 6000);
  }

  function renameApp(memoId: string, at?: { x: number; y: number }) {
    const app = apps.get(memos.get(memoId)?.app);
    if (!app) return;
    cellMenu.prompt('アプリの新しい名前', app.name, (name) => apps.rename(app.id, name), at ?? nearMemo(memoId), { maxLength: MAX_APP_NAME });
  }

  async function repickApp(memoId: string) {
    const app = apps.get(memos.get(memoId)?.app);
    if (!app) return;
    const picked = await pickAppFile();
    if (!picked.ok) {
      const text = pickAppErrorText(picked.error);
      if (text) toast(text, 5000);
      return;
    }
    if (!apps.replaceFile(app.id, picked.app)) return;
    toast(`「${app.name}」のファイルを選び直しました（名前はそのままです）`, 5000);
  }

  function confirmRemoveAppCell(memoId: string) {
    const memo = memos.get(memoId);
    if (!memo?.app) return;
    const app = apps.get(memo.app);
    const rect = sidebar.anchorOfMemo(memoId);
    cellMenu.open(rect ? rect.left : window.innerWidth / 2 - 120, rect ? rect.bottom + 4 : 120, [
      { section: app ? `アプリ「${app.name}」のセルを外します` : 'アプリのセルを外します' },
      { label: '名前とファイルは台帳に残り、丸いボタンから置き直せます', disabled: true },
      { label: '外す', run: () => removeMemos([memoId]) },
      { label: 'やめる', run: () => undefined },
    ]);
  }

  function confirmForgetApp(appId: string) {
    const app = apps.get(appId);
    if (!app) return;
    const count = memos.list().filter((memo) => memo.app === appId).length;
    cellMenu.open(window.innerWidth / 2 - 140, 120, [
      { section: `「${app.name}」を台帳から消します` },
      { label: count > 0 ? `盤面のセル ${count} 個も外します。ファイル自体は消えません` : '盤面にセルはありません。ファイル自体は消えません', disabled: true },
      {
        label: '消す',
        run: () => {
          stopPin(appId);
          for (const memo of memos.list()) if (memo.app === appId) memos.remove(memo.id);
          apps.remove(appId);
          sidebar.clearSelection();
          toast(`「${app.name}」を台帳から消しました`, 5000);
        },
      },
      { label: 'やめる', run: () => undefined },
    ]);
  }

  function appPlaceEntries(at: Hex, x: number, y: number): MenuEntry[] {
    const entries: MenuEntry[] = ['sep', { section: 'アプリのセル' }];
    const recent = apps.recent();
    const pills: MenuButton[] = recent.map((app) => ({
      label: app.name,
      title: `アプリ「${app.name}」（${appFileLabel(app)}）。押すと、このセルに置きます`,
      close: true,
      run: () => {
        if (placeApp(app.id, at)) toast(`アプリ「${app.name}」のセルを置きました`, 4000);
      },
    }));
    if (pills.length === 0) entries.push({ label: 'まだありません（「アプリを登録…」で入れられます）', disabled: true });
    else entries.push({ pills });
    entries.push({ label: 'アプリを登録…', run: () => void registerApp(at) });
    const shown = new Set(recent.map((app) => app.id));
    const rest = apps.list().filter((app) => !shown.has(app.id));
    if (rest.length > 0) entries.push({ label: 'その他のアプリ…', hint: `${rest.length}`, run: () => openOtherAppsMenu(at, rest, x, y) });
    return entries;
  }

  function openOtherAppsMenu(at: Hex, rest: { id: string; name: string; launch: string; shortcut: string; target: string }[], x: number, y: number) {
    const entries: MenuEntry[] = [{ section: 'その他のアプリ' }];
    for (const app of rest) {
      entries.push({
        label: app.name,
        hint: appFileLabel(app),
        run: () => {
          if (placeApp(app.id, at)) toast(`アプリ「${app.name}」のセルを置きました`, 4000);
        },
      });
    }
    cellMenu.open(x, y, entries);
  }

  function openAppMenu(memo: MemoCell, info: { hex: Hex | null; x: number; y: number }) {
    const app = apps.get(memo.app);
    const at = { x: info.x, y: info.y };
    const entries: MenuEntry[] = [{ section: app ? `アプリ「${app.name}」` : 'アプリ（台帳に見つかりません）' }];
    if (app) {
      entries.push({ note: `ファイル：${appFileLabel(app)}` });
      const pinned = pinnedAppId === app.id;
      entries.push({ label: pinned ? '最前面をやめる' : '中央に出す', hint: 'ダブルクリック', run: () => launchAppCell(memo.id) });
      entries.push({ label: '名前を変える…', run: () => renameApp(memo.id, at) });
      entries.push(cardWinEntry({ kind: 'memo', id: memo.id }));
      entries.push({ label: 'ファイルを選び直す…', run: () => void repickApp(memo.id) });
    }
    entries.push('sep');
    entries.push({ label: '画像を貼る', hint: 'アイコンが顔です', disabled: true });
    entries.push({ label: 'セルを外す（台帳には残る）…', run: () => confirmRemoveAppCell(memo.id) });
    if (app) entries.push({ label: '台帳からも消す…', run: () => confirmForgetApp(app.id) });
    entries.push(...sheetJumpEntries(info.x, info.y));
    entries.push(...setEntries(info.hex));
    cellMenu.open(info.x, info.y, entries);
  }

  // P1：右クリック「小窓で出す」：そのセルのカードを、盤面の上の小さな窓に出す（いくつでも〔6 個まで〕）
  function cardWinEntry(ref: { kind: 'tab'; id: number } | { kind: 'memo'; id: string }): MenuEntry {
    const key = ref.kind === 'tab' ? store.get(ref.id)?.uid : ref.id;
    return {
      label: '小窓で出す',
      hint: 'カード',
      disabled: !key,
      run: () => {
        if (key) preview.openCardWin(ref.kind, key);
      },
    };
  }

  function openCaptureMenu(memo: MemoCell, info: { x: number; y: number }) {
    const id = memo.capture;
    if (!id) return;
    cellMenu.open(info.x, info.y, [
      { section: '撮ったもの' },
      { label: '画像を貼る', hint: '撮影の台帳にあります', disabled: true },
      { label: '右の撮影で開く', hint: 'ダブルクリック', run: () => revealCapture(id) },
      cardWinEntry({ kind: 'memo', id: memo.id }),
      { label: `スタンプ ${captureMarkCount(id)}`, disabled: true },
      { label: '撮った画像は、右の撮影で消します', disabled: true },
      ...sheetJumpEntries(info.x, info.y),
    ]);
  }

  function openCellMenu(info: { id: number | null; memo: string | null; hex: Hex | null; x: number; y: number }) {
    const clickedTab = info.id !== null ? store.get(info.id) : undefined;
    const clickedMemo = info.memo !== null ? memos.get(info.memo) : undefined;
    // 小窓のセルは今のシートに無い。メニューのあいだだけ、その1個を選んだものとして扱う（盤面の選択は変えない）
    const offSheet = (!!clickedTab && clickedTab.sheet !== sheets.current) || (!!clickedMemo && clickedMemo.sheet !== sheets.current);
    menuPick = offSheet ? { tabs: clickedTab ? [clickedTab.id] : [], memos: clickedMemo ? [clickedMemo.id] : [] } : null;
    const selection = menuPick ? menuPick.tabs : sidebar.selection();
    const memoSelection = menuPick ? menuPick.memos : sidebar.memoSelection();
    const home = clickedTab?.sheet ?? clickedMemo?.sheet ?? sheets.current; // 「今のシート」は、押したセルのシート
    const total = selection.length + memoSelection.length;
    const portal = info.memo !== null && total === 1 ? memos.get(info.memo) : undefined;
    if (portal?.portal) {
      openPortalMenu(portal, info);
      return;
    }
    if (portal?.bot) {
      openBotMenu(portal, info);
      return;
    }
    if (portal?.app) {
      openAppMenu(portal, info);
      return;
    }
    if (portal?.capture) {
      openCaptureMenu(portal, info);
      return;
    }
    const entries: MenuEntry[] = [];
    let pasteEntry: { label: string; hint?: string; disabled?: boolean; run?: () => void } | null = null;
    let textEntry: { label: string; hint?: string; disabled?: boolean; run?: () => void } | null = null;
    let clipEntry: { label: string; hint?: string; disabled?: boolean; run?: () => void } | null = null;
    let armImage: (() => void) | null = null;
    if ((info.id !== null || info.memo !== null) && total > 0) {
      entries.push({ section: total > 1 ? `選んだセル ${total} 個` : info.memo ? 'このメモのセル' : 'このセル' });
      if (info.memo !== null && total === 1) {
        const id = info.memo;
        if (memoPane.isOpen(id)) entries.push({ label: '下の区画を閉じる', run: () => memoPane.close() });
        else entries.push({ label: '下に開いて書く（中央を上下に分ける）', hint: 'ダブルクリック', run: () => memoPane.open(id) });
        entries.push({ label: '書き直す', run: () => editMemo(id) });
        entries.push(cardWinEntry({ kind: 'memo', id }));
        // メモの文を「選んだ文」として、依頼の小窓をページの上に開く（S3.11。ボットのセル・入口は上で別のメニューになる）
        const hasText = !!memos.get(id)?.text.trim();
        if (BOT_FEATURES) entries.push({ label: '🔍 Grok に調べてもらう', disabled: !hasText, run: () => void askGrokFromMemo(id) });
        entries.push({ label: '単語帳のカードにする', run: () => offerVocabFromMemo(id, { x: info.x, y: info.y }) });
        const memo = memos.get(id);
        entries.push(...linkedCardEntries({ kind: 'memo', id }, memo ? memoTitle(memo, 24) || 'メモ' : 'メモ')); // K6
      }
      if (info.id !== null && total === 1) {
        const id = info.id;
        entries.push({ label: '見た目（画像・コメント）…', run: () => void editTabFace(id) });
        entries.push(cardWinEntry({ kind: 'tab', id }));
        const tab = store.get(id);
        if (tab) entries.push(...livePopoutEntries(id));
        entries.push({ label: '単語帳のカードにする', run: () => offerVocabFromTab(id, { x: info.x, y: info.y }) });
        if (tab) entries.push(...linkedCardEntries({ kind: 'tab', id, url: tab.url }, tab.title || tab.url || 'タブ')); // K6
      }
      if (total === 1 && info.memo) armImage = queueCellImage(entries, { kind: 'memo', id: info.memo });
      else if (total === 1 && info.id !== null) armImage = queueCellImage(entries, { kind: 'tab', id: info.id });
      entries.push({ label: 'コピー', hint: 'Ctrl+C', run: () => void copySelection() });
      entries.push({ label: 'セットとして保存…', run: saveSelectionAsSet });
      entries.push({ label: '六角メモへ送る', run: () => void sendSelectionToHexMemo() });
      // シート：選んだセルを入口1つにまとめる・ほかのシートへ移す
      entries.push({ label: '入口1つにまとめる（新しいシートへ）…', run: () => packSelection(info.x, info.y) });
      // ほかのシートへ移す（最近見たシートから5つ。多ければ「ほかのシートへ移す…」で全部）
      const others = sheets.recent().filter((s) => s.id !== home);
      for (const sheet of others.slice(0, 5)) entries.push({ label: `シート「${sheet.name}」へ移す`, run: () => moveSelectionTo(sheet.id) });
      if (others.length > 5) entries.push({ label: 'ほかのシートへ移す…', hint: `${others.length}`, run: () => openMoveToMenu(info.x, info.y, home) });
      const cell = info.id !== null ? store.get(info.id) : memos.get(info.memo);
      const island = cell?.island ? islands.get(cell.island) : undefined;
      if (island) {
        const tabsIn = store.inSheet(home).filter((t) => t.island === island.id).map((t) => t.id);
        const memosIn = memos.inSheet(home).filter((m) => m.island === island.id).map((m) => m.id);
        entries.push({
          label: `島「${island.name}」を全部選ぶ`,
          hint: `${tabsIn.length + memosIn.length}`,
          run: () => {
            if (home !== sheets.current && !switchSheet(home)) return; // 小窓のシートへ移してから選ぶ（選択は今のシートにしか乗らない）
            sidebar.setSelection(tabsIn, memosIn);
          },
        });
        entries.push({ label: 'この島を頼む', hint: '小窓', run: () => openIslandAsk(island.id, memoSelection) });
      }
      entries.push(...islandEntriesForSelection(island?.id ?? null, info.x, info.y));
      if (total === 1) entries.push(...boardLinkEntries(info.id !== null ? store.get(info.id) : undefined, info.memo, info.x, info.y));
      if (memoSelection.length > 0 && selection.length === 0) {
        const onlyPortals = memoSelection.every((id) => memos.get(id)?.portal);
        const onlyBots = memoSelection.every((id) => memos.get(id)?.bot);
        const onlyApps = memoSelection.every((id) => memos.get(id)?.app);
        const label = onlyPortals
          ? `入口 ${memoSelection.length} 個を消す（シートは残る）…`
          : onlyBots
            ? `ボットのセル ${memoSelection.length} 個を外す（台帳には残る）…`
            : onlyApps
              ? `アプリのセル ${memoSelection.length} 個を外す（台帳には残る）…`
              : memoSelection.length > 1
                ? `メモのセル ${memoSelection.length} 個を消す…`
                : 'このメモのセルを消す…';
        entries.push({ label, run: () => confirmRemoveMemos(memoSelection) });
      }
      if (total > 1) entries.push({ label: '選択を解除', hint: 'Esc', run: () => sidebar.clearSelection() });
      entries.push({ label: 'Ctrl+クリックで選び足す・Shift+クリックで範囲', disabled: true });
    } else {
      entries.push({ section: 'このセルに' });
      if (info.hex) {
        const at = info.hex;
        entries.push({ label: '新しいタブ', hint: 'ダブルクリック', run: () => createTab(HOME_URL, at) });
        entries.push({ label: 'メモを書く', run: () => writeNewMemo(at) });
        // 試し：今あるシートへの入口をここに置く
        const portalTargets = sheets.list().filter((s) => s.id !== sheets.current);
        entries.push(
          portalTargets.length > 0
            ? { label: 'あるシートへの入口を追加 ▸', run: () => openPortalToSheetMenu(at, info.x, info.y) }
            : { label: 'あるシートへの入口を追加（ほかのシートがありません）', disabled: true },
        );
        entries.push({ label: 'ボットのセルを置く…', run: () => openPlaceBotMenu(at, info.x, info.y) });
        entries.push({ label: 'スクショを撮ってここに置く', hint: 'Ctrl+Shift+S', run: () => void startShot(at) });
        entries.push({ label: '音声・動画のファイルを開く…', run: () => void openMediaFile(at) });
        entries.push({ label: '画像ファイルを開く…', run: () => void openImageFile(at) });
        clipEntry = { label: 'クリップボードの画像をセルにする', hint: '確かめています…', disabled: true };
        entries.push(clipEntry);
        entries.push(...appPlaceEntries(at, info.x, info.y));
      }
      pasteEntry = { label: '貼り付け', hint: '確かめています…', disabled: true };
      entries.push(pasteEntry);
      if (islands.list().length > 0) entries.push({ row: '島の名前', buttons: islandNamesButtons() });
    }
    entries.push(...sheetJumpEntries(info.x, info.y));
    entries.push(...setEntries(info.hex));
    cellMenu.open(info.x, info.y, entries);
    armImage?.();
    if (clipEntry && info.hex) {
      const entry = clipEntry;
      const at = info.hex;
      const token = cellMenu.token();
      void cellImageOnClipboard().then((state) => {
        if (state === 'yes') Object.assign(entry, { hint: undefined, disabled: false, run: () => void placeClipboardImage(at) });
        else Object.assign(entry, { hint: state === 'no' ? '画像がありません' : '確かめられませんでした', disabled: true, run: undefined });
        cellMenu.update(entries, token);
      });
    }
    if (pasteEntry) {
      const entry = pasteEntry;
      void pasteable().then((p) => {
        if (!p) {
          Object.assign(entry, { label: '貼り付け', hint: 'コピーしたものがありません', disabled: true });
        } else {
          Object.assign(entry, { label: `貼り付け（${p.label}）`, hint: 'Ctrl+V', disabled: false, run: () => void pasteAt(info.hex) });
          // URL を含む文章は、タブにするほか、文章のままメモにもできる
          const text = p.text;
          if (text && p.cells.some((c) => !c.memo) && info.hex) {
            const at = info.hex;
            textEntry = { label: '文章のままメモのセルにする', run: () => writeNewMemo(at, text) };
            entries.splice(entries.indexOf(entry) + 1, 0, textEntry);
          }
        }
        cellMenu.update(entries);
      });
    }
  }

  function confirmRemoveMemos(ids: string[]) {
    const x = window.innerWidth / 2 - 120;
    const portals = ids.filter((id) => memos.get(id)?.portal).length;
    const botCells = ids.filter((id) => memos.get(id)?.bot).length;
    const appCells = ids.filter((id) => memos.get(id)?.app).length;
    const kept = ids.length > 0 && (botCells === ids.length || appCells === ids.length);
    cellMenu.open(x, 120, [
      { section: ids.length > 1 ? `${kept ? 'セル' : 'メモのセル'} ${ids.length} 個を${kept ? '外します' : '消します'}` : kept ? 'このセルを外します' : 'このメモのセルを消します' },
      ...(portals > 0 ? [{ label: `うち入口 ${portals} 個（シートと中身は残ります）`, disabled: true }] : []),
      ...(botCells > 0 ? [{ label: `うちボットのセル ${botCells} 個（ボットの名前とリンクは台帳に残ります）`, disabled: true }] : []),
      ...(appCells > 0 ? [{ label: `うちアプリのセル ${appCells} 個（名前とファイルは台帳に残ります）`, disabled: true }] : []),
      { label: kept ? '外す' : '消す', run: () => removeMemos(ids) },
      { label: 'やめる', run: () => undefined },
    ]);
  }

  // キー：Ctrl+C（選んだセルをコピー）・Ctrl+V（マウスの位置か、今のタブの近くに貼る）・Esc（選択を解除）
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    // 見た目の欄が開いている間は、Ctrl+V は画像を貼るのに使う。Esc は欄を閉じる
    if (faceEditor.isOpen) {
      if (e.key === 'Escape') faceEditor.close();
      return;
    }
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      sidebar.clearSelection();
      preview.unpinTab(); // 試し：固定したポップアップも外す
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 't') {
      // 試し：最近閉じたタブを1つ開き直す（左の画面にキーボードがあるときだけ。ページの中では効かない）
      e.preventDefault();
      reopenClosed();
    } else if ((e.ctrlKey || e.metaKey) && key === 'c' && (menuPick ? menuPick.tabs.length + menuPick.memos.length : sidebar.selection().length + sidebar.memoSelection().length) > 0) {
      e.preventDefault();
      if (!cellMenu.isOpen) menuPick = null; // 小窓のメニューを閉じたあとは、盤面の選択をコピーする
      void copySelection();
    } else if ((e.ctrlKey || e.metaKey) && key === 'v') {
      e.preventDefault();
      void pasteAt(null);
    }
  });

  // 段階16。島に入っているメモと、いま選んでいるメモだけを右に見せる。となりは集めない。アプリは開かない
  function openIslandAsk(islandId: string, extraIds: string[]) {
    const island = islands.get(islandId);
    if (!island) {
      toast('その島はもうありません');
      return;
    }
    const seen = new Set<string>();
    const chosen: MemoCell[] = [];
    const take = (memo: MemoCell | undefined) => {
      if (!memo || seen.has(memo.id) || isSpecialCell(memo) || !memo.text.trim()) return;
      seen.add(memo.id);
      chosen.push(memo);
    };
    for (const memo of memos.list()) if (memo.island === islandId) take(memo);
    for (const id of extraIds) take(memos.get(id));
    const shown = chosen.slice(0, ISLAND_ASK_MAX);
    islandOffer = { islandId, ids: shown.map((memo) => memo.id) };
    const payload: Extract<RelayPayload, { kind: 'islandAskPick' }> = {
      kind: 'islandAskPick',
      islandId,
      name: island.name,
      memos: shown.map((memo) => ({ id: memo.id, title: memoTitle(memo, 40) || 'メモ' })),
      more: Math.max(0, chosen.length - shown.length),
    };
    if (sidebars.right.visible && rightReady) {
      islandAskPending = null;
      send({ type: 'relay', to: 'right', payload });
    } else {
      islandAskPending = payload;
      if (!sidebars.right.visible) send({ type: 'setSidebar', side: 'right', visible: true });
    }
  }

  async function fillIslandAsk(islandId: string, memoIds: string[]) {
    const offer = islandOffer;
    const island = islands.get(islandId);
    if (!island || !offer || offer.islandId !== islandId) {
      toast('もう一度「この島を頼む」から選んでください');
      return;
    }
    const allowed = new Set(offer.ids);
    const picked = memoIds
      .filter((id) => allowed.has(id))
      .map((id) => memos.get(id))
      .filter((memo): memo is MemoCell => !!memo && !isSpecialCell(memo));
    const text = await redactBlockedUrls(
      islandAskText(
        island.name,
        picked.map((memo) => ({ title: memoTitle(memo, 40) || 'メモ', text: memo.text })),
      ),
    );
    if (!sidebars.right.visible) send({ type: 'setSidebar', side: 'right', visible: true });
    send({ type: 'relay', to: 'right', payload: { kind: 'islandAsk', text } });
  }

  // ---------- Grok 用に書き出す（export.v1。grok-export.ts） ----------
  const GROK_LIMITS = { opsPerPatch: 200, tagsPerItem: MAX_TAGS_PER_TAB, tagChars: 30, memoChars: MAX_MEMO_TEXT, cardChars: 20_000 };

  function openGrokExportMenu(x: number, y: number) {
    const selected = sidebar.selection().length + sidebar.memoSelection().length;
    cellMenu.open(x, y, [
      { section: 'Grok 用に書き出す（読むための写し。ページの本文・画像は入れない）' },
      { label: 'このシート', hint: sheets.get(sheets.current)?.name ?? '', run: () => void grokExport('sheet') },
      { label: 'すべてのシート', hint: `${sheets.list().length} 枚`, run: () => void grokExport('all') },
      { label: '選んだセルだけ', hint: `${selected}`, disabled: selected === 0, run: () => void grokExport('selection') },
      { note: '書き出し先：データフォルダの ui-data\\exports\\state-日時.json（Grok に、このファイルを読んで提案を書くよう頼みます。決まりは docs\\grok-patch-format.md）' },
    ]);
  }

  async function grokExport(scope: ExportScope): Promise<string | null> {
    const names: Record<string, string> = {};
    for (const k of LINK_KINDS) names[k.kind] = boardKindName(k.kind);
    const built = buildExport(
      {
        scope,
        sheet: sheets.current,
        sheets: sheets.list(),
        tabs: store.all().filter((t) => !store.closing.has(t.id)),
        memos: memos.list(),
        islands: islands.list(),
        boardLinks: boardLinks.list(),
        kindNames: names,
        selection: { tabs: sidebar.selection(), memos: sidebar.memoSelection() },
      },
      GROK_LIMITS,
    );
    if (!built) {
      toast('大きすぎて書き出せませんでした（2 MB まで。「このシート」か「選んだセルだけ」で試してください）', 6000);
      return null;
    }
    const name = exportFileName();
    if (!(await writeData(name, built.data))) {
      toast('書き出せませんでした（ui-data に書けません）', 6000);
      return null;
    }
    lastGrokExport = built.data.exportedAt;
    const path = `ui-data\\${name.replace(/\//g, '\\')}`;
    toast(`書き出しました：${path}（タブ ${built.data.tabs.length}・メモ ${built.data.memos.length}・カード ${built.data.cards.length}${built.data.cut ? '。文は短くしました' : ''}）`, 7000);
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // 写せなくても、書き出しはできている
    }
    return name;
  }
  let lastGrokExport: string | null = null; // 最後に書き出した時刻（提案の basedOn と比べる）

  // ---------- Grok の提案を取り込む（patch.v1。grok-patch.ts） ----------
  //   ・読む → 一覧（前 → 後・チェック）→「反映する」で、チェックしたものだけ当てる
  //   ・当てる前に、ぜんぶの写し（patch-backups\<番号>-before.json）を書く。書けなければ当てない
  //   ・当てたあと、戻し方（patch-backups\<番号>.json）と記録（patch-history.json）を書く
  //   ・消す・閉じる指示は無い。足したものを戻すときだけ消す
  const GROK_BY: ReplyAuthor = { who: 'bot', name: 'Grok Bot' };
  const PATCH_HISTORY = 'patch-history.json';
  const patchView = new GrokPatchView();
  const PATCH_SOURCE_TEXT: Record<string, string> = { file: 'ファイルから', drop: '落としたファイルから', inbox: '受け取り口から', mock: '練習用' };

  const worldTab = (tab: Tab): WorldTab => ({
    id: tab.id,
    uid: tab.uid,
    sheet: tab.sheet,
    title: tab.title,
    url: tab.url,
    tags: [...tab.tags],
    ...(tab.comment ? { comment: tab.comment } : {}),
    island: tab.island ?? null,
    notes: tab.notes.map((n) => ({ id: n.id, text: n.text })),
  });
  const liveTabs = () => store.all().filter((t) => !store.closing.has(t.id));

  const patchWorld: PatchWorld = {
    tabByUid: (uid) => {
      const tab = store.byUid(uid);
      return tab && !store.closing.has(tab.id) ? worldTab(tab) : undefined;
    },
    tabsByUrl: (url) => liveTabs().filter((t) => t.url === url || samePage(t.url, url)).map(worldTab),
    memo: (id) => {
      const m = memos.get(id);
      if (!m) return undefined;
      return {
        id: m.id,
        sheet: m.sheet,
        text: m.text,
        tags: [...m.tags],
        island: m.island ?? null,
        special: isSpecialCell(m),
        updatedAt: m.updatedAt,
        replies: (m.replies ?? []).map((r) => ({
          id: r.id,
          parent: r.parent ?? null,
          text: r.text,
          ...(r.tags ? { tags: [...r.tags] } : {}),
          ...(r.links ? { links: r.links.map((l) => ({ to: l.to, kind: l.kind })) } : {}),
          createdAt: r.createdAt,
          ...(r.editedAt ? { editedAt: r.editedAt } : {}),
        })),
      };
    },
    island: (id) => {
      const i = islands.get(id);
      return i ? { id: i.id, name: i.name, color: i.color } : undefined;
    },
    islandCount: () => islands.list().length,
    nextIslandColor: () => islands.nextColor(),
    hasBoardLink: (from, to, kind) => findDuplicate(boardLinks.list(), from, to, kind)?.id ?? null,
    boardLinkExists: (id) => !!boardLinks.get(id),
    sheetName: (id) => sheets.get(id)?.name ?? null,
    currentSheet: () => sheets.current,
    refTitle: (ref) => refTitle(ref),
    setTabTags: (id, tags) => store.setTags(id, tags),
    setTabComment: (id, text) => store.setFace(id, { comment: text }),
    addTabNote: (id, text) => {
      if (!store.get(id)) return null;
      const noteId = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      store.addNote(id, { id: noteId, text, createdAt: Date.now(), source: 'ai', label: 'Grok Bot' });
      return noteId;
    },
    removeTabNote: (id, noteId) => store.removeNote(id, noteId),
    setMemoTags: (id, tags) => memos.update(id, { tags }),
    setMemoText: (id, text) => memos.update(id, { text }),
    setCardTags: (memo, card, tags) => {
      const now = memos.get(memo)?.replies?.find((r) => r.id === card)?.tags ?? [];
      const add = tags.filter((t) => !now.includes(t));
      const remove = now.filter((t) => !tags.includes(t));
      return memos.changeReplyTags(memo, card, add, remove).result !== 'refused';
    },
    addCard: (memo, parent, text) => memos.addReply(memo, parent, text, GROK_BY)?.id ?? null,
    removeCard: (memo, card) => memos.removeReply(memo, card),
    addCardLink: (memo, from, to, kind) => memos.changeReplyLinks(memo, from, [{ to, kind }], []).result === 'changed',
    removeCardLink: (memo, from, to) => {
      const links = memos.get(memo)?.replies?.find((r) => r.id === from)?.links ?? [];
      memos.changeReplyLinks(
        memo,
        from,
        [],
        links.filter((l) => l.to === to),
      );
    },
    addIsland: (name, color) => {
      if (islands.list().length >= MAX_ISLAND_COUNT) return null;
      const id = newIslandId();
      islands.add({ id, name: normalizeIslandName(name), color: color ?? islands.nextColor() });
      return id;
    },
    removeIsland: (id) => removeIsland(id),
    setIslandName: (id, name) => islands.update(id, { name: normalizeIslandName(name) }),
    setIslandColor: (id, color) => islands.update(id, { color }),
    setIsland: (refs, island) => {
      const tabIds: number[] = [];
      const memoIds: string[] = [];
      for (const ref of refs) {
        const cell = refCell(ref);
        if (cell?.kind === 'tab') tabIds.push(cell.tab.id);
        else if (cell?.kind === 'memo') memoIds.push(cell.memo.id);
      }
      if (tabIds.length > 0) store.setIsland(tabIds, island);
      if (memoIds.length > 0) memos.setIsland(memoIds, island);
    },
    islandOf: (ref) => {
      const cell = refCell(ref);
      if (!cell) return null;
      return (cell.kind === 'tab' ? cell.tab.island : cell.memo.island) ?? null;
    },
    addBoardLink: (from, to, kind) => {
      const done = boardLinks.add(from, to, kind);
      return typeof done === 'object' ? done.id : null;
    },
    removeBoardLink: (id) => boardLinks.remove(id),
    createMemo: (sheet, near, text, tags) => {
      const nearCell = near ? refCell(near) : null;
      const nearPos = nearCell && (nearCell.kind === 'tab' ? nearCell.tab.sheet : nearCell.memo.sheet) === sheet ? (nearCell.kind === 'tab' ? nearCell.tab.pos : nearCell.memo.pos) : null;
      const start = nearPos ?? anchorOn(sheet);
      const pos = nearestFree(start, (h) => isTaken(h, sheet));
      return memos.add({ sheet, pos, text, tags, by: GROK_BY, label: 'Grok Bot' })?.id ?? null;
    },
    removeMemo: (id) => {
      memos.remove(id);
      boardLinks.removeCells([memoRef(id)]);
    },
    kindName: (kind) => boardKindName(kind),
    // 取り込み（importSheet）。指紋のもと：そのシートのメモ・タブ・作った島の中身・線
    importView: (u) => ({
      sheet: !!sheets.get(u.sheet),
      memos: memos.list(),
      tabs: store.inSheet(u.sheet).filter((t) => !store.closing.has(t.id)).length,
      islandMembers: (id) => islandMemberCount(id),
      boardLinks: boardLinks.list(),
    }),
    removeImport: (u, mode) => removeImport(u, mode),
    maxTags: MAX_TAGS_PER_TAB,
    maxIslands: MAX_ISLAND_COUNT,
  };

  // 盤面の点線の見本（島・線）。P3
  //   チェックした島・線を、このシートの盤面に点線で描く（当てるまで台帳は変えない）。一覧を閉じたら消す
  function previewPatch(items: readonly PlanItem[]) {
    const islandsDraft: { name: string; color: string; refs: CellRef[] }[] = [];
    const linksDraft: { from: CellRef; to: CellRef; kind: LinkKind }[] = [];
    for (const item of items) {
      if (item.preview?.island) islandsDraft.push(item.preview.island);
      if (item.preview?.link) linksDraft.push(item.preview.link);
    }
    sidebar.setPatchPreview({ islands: islandsDraft, links: linksDraft });
  }

  // 取り込み（hcb-memo-interchange v1。memo-interchange.ts・interchange-flow.ts）：新しいシートとして取り込む
  const interchange = createInterchangeFlow({
    memos,
    sheets,
    islands,
    boardLinks,
    patchWorld,
    view: patchView,
    menu: cellMenu,
    toast,
    setPreview: (p) => sidebar.setPatchPreview(p),
    readData,
    writeData,
    deleteData,
    writeBefore: writePatchBefore,
    readHistory: () => readPatchHistory(),
    writeHistory: (items) => writeData(PATCH_HISTORY, { v: 1, items }),
    refusal: () => {
      if (shuttingDown) return 'ブラウザを閉じる途中です';
      if (archiveBusy) return 'ほかの処理（アーカイブか戻す）の途中です';
      if (!memos.ready || !memos.writableLedger) return 'メモの台帳を読めていないので取り込めません（少し待ってから、もう一度）';
      if (!sessionReady) return '前回のタブを読み終えていません。少し待ってから、もう一度';
      return null;
    },
    ids: { sheet: newSheetId, island: newIslandId, memo: newMemoId, reply: newReplyId },
    usedIds: () => new Set<string>([...sheets.list().map((x) => x.id), ...islands.list().map((x) => x.id), ...memos.list().flatMap((m) => [m.id, ...(m.replies ?? []).map((r) => r.id)])]),
    maxMemos: MAX_MEMO_CELLS,
    maxIslands: MAX_ISLAND_COUNT,
    portalPos: () => {
      const here = sheets.current;
      const near = anchorOn(here);
      return { sheet: here, pos: isTaken(near, here) ? nearestFree(near, (h) => isTaken(h, here)) : near };
    },
    islandColor: (n) => {
      const used = new Set(islands.list().map((i) => i.color));
      const free = TAG_PALETTE.filter((c) => !used.has(c));
      return free[n] ?? TAG_PALETTE[(islands.list().length + n) % TAG_PALETTE.length];
    },
    sheetColor: () => sheets.nextColor(),
    switchSheet: (id) => switchSheet(id),
    canArchive: (id) => canArchive(id),
    archiveSheet: (id) => archiveSheet(id),
    render: () => sidebar.render(),
    sourceText: PATCH_SOURCE_TEXT,
  });

  // 提案・取り込みの文（JSON）を読んで一覧を出す。source：file・drop・inbox・mock
  //   JSON を 1 回だけ読み、format が hcb-memo-interchange なら取り込みへ、それ以外は今までどおり提案（patch.v1）へ
  function openPatchText(text: string, source: string, after?: () => void): boolean {
    if (!withinImportBytes(text)) {
      toast(`ファイルが大きすぎます（${IMPORT_FILE_LABEL} まで）`, 6000);
      return false;
    }
    const raw = readJson(text);
    if (detectJsonKind(raw) === 'interchange') return interchange.open(raw, text, source, after);
    const parsed = parsePatchText(text);
    if (!parsed.ok) {
      toast(`Grok の提案を読めませんでした（${PATCH_REASON_TEXT[parsed.reason] ?? parsed.reason}）`, 7000);
      return false;
    }
    return showPatch(parsed.patch, parsed.dropped, source, after);
  }

  function showPatch(patch: GrokPatch, dropped: { index: number; reason: string }[], source: string, after?: () => void): boolean {
    if (!memos.ready || !memos.writableLedger) {
      toast('メモの台帳をまだ読めていないので、提案は当てられません（少し待ってから、もう一度）', 6000);
      return false;
    }
    cellMenu.close();
    const items = planPatch(patch, patchWorld);
    const staleNote = !patch.basedOn
      ? '書き出しの時刻（basedOn）が無い提案です。今の様子と合っているか、よく見てから選んでください'
      : lastGrokExport && patch.basedOn < lastGrokExport
        ? 'この提案は、いちばん新しい書き出しより前の写しをもとにしています'
        : undefined;
    patchView.open({
      patch,
      items,
      dropped,
      source: PATCH_SOURCE_TEXT[source] ?? source,
      staleNote,
      onChecked: (checked) => previewPatch(checked),
      onApply: (checked) => void applyPatch(patch, checked, source).then((ok) => ok && after?.()),
      onClose: () => previewPatch([]),
    });
    return true;
  }

  async function readPatchHistory(): Promise<PatchHistoryItem[]> {
    return parseHistory(await readData(PATCH_HISTORY));
  }

  // 当てる前の全部の写し（patch-backups\<番号>-before.json）。提案と取り込みで同じ
  async function writePatchBefore(id: string): Promise<boolean> {
    const names: Record<string, string> = {};
    for (const k of LINK_KINDS) names[k.kind] = boardKindName(k.kind);
    const before = buildExport(
      { scope: 'all', sheet: sheets.current, sheets: sheets.list(), tabs: liveTabs(), memos: memos.list(), islands: islands.list(), boardLinks: boardLinks.list(), kindNames: names, selection: { tabs: [], memos: [] } },
      GROK_LIMITS,
    );
    return !!before && (await writeData(`patch-backups/${id}-before.json`, before.data));
  }

  async function applyPatch(patch: GrokPatch, checked: readonly PlanItem[], source: string): Promise<boolean> {
    // 一覧を出してから変わったかもしれないので、もう一度確かめ、選んだ番号のうち今も使えるものだけ当てる
    const picked = new Set(checked.map((i) => i.index));
    const fresh = planPatch(patch, patchWorld).filter((i) => picked.has(i.index));
    const usable = fresh.filter((i) => i.status === 'ok');
    if (usable.length === 0) {
      toast('当てられるものがありませんでした（もうそうなっているか、相手が見つかりません）', 6000);
      return false;
    }
    const id = `ap${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    if (!(await writePatchBefore(id))) {
      toast('当てる前の写しを書けなかったので、当てませんでした（ui-data\\patch-backups に書けません）', 7000);
      return false;
    }
    const steps: AppliedStep[] = [];
    let skipped = fresh.length - usable.length;
    for (const item of usable) {
      const step = applyItem(patchWorld, item);
      if (step) steps.push(step);
      else skipped++;
    }
    const at = new Date().toISOString();
    const backup: PatchBackup = { v: 1, id, patchId: patch.id, title: patch.title, source, appliedAt: at, steps, skipped };
    const wrote = await writeData(`patch-backups/${id}.json`, backup);
    const history = await readPatchHistory();
    history.unshift({ id, patchId: patch.id, title: patch.title, source, at, applied: steps.length, skipped });
    await writeData(PATCH_HISTORY, { v: 1, items: history.slice(0, 100) });
    sidebar.render();
    toast(
      `Grok の提案を ${steps.length} 件当てました${skipped > 0 ? `（${skipped} 件は当てられませんでした）` : ''}。${wrote ? '戻すときは、シートの名前 ▾ →「Grok の提案の記録…」' : '戻し方を書けなかったので、この分は元に戻せません'}`,
      8000,
    );
    return true;
  }

  async function openPatchHistory(x: number, y: number) {
    const history = await readPatchHistory();
    const entries: MenuEntry[] = [{ section: 'Grok の提案の記録（新しい順・100 件まで）' }];
    if (history.length === 0) entries.push({ note: 'まだ当てた提案はありません' });
    for (const h of history.slice(0, 20)) {
      const when = new Date(h.at).toLocaleString();
      entries.push({
        label: `${h.title || h.patchId || '（題名なし）'}`,
        hint: `${when}・${h.applied} 件${h.undoneAt ? '・戻しました' : ''}`,
        disabled: !!h.undoneAt || h.applied === 0,
        run: () => void undoApplied(h.id, x, y),
      });
    }
    entries.push({ note: '押すと、その提案で変えたところを元に戻します（あとで手で変えたところは戻しません）。当てる前の写し：ui-data\\patch-backups' });
    cellMenu.open(x, y, entries);
  }

  async function undoApplied(id: string, x: number, y: number, onlyClean = false) {
    const raw = await readData(`patch-backups/${id}.json`);
    if (!isBackup(raw)) {
      toast('戻し方のファイルを読めませんでした（ui-data\\patch-backups）', 6000);
      return;
    }
    if (raw.undoneAt) {
      toast('この提案は、もう元に戻してあります');
      return;
    }
    // 取り込みは記録の 1 件＝シートと中身。変わっていれば分かれ道の小窓（interchange-flow.ts）
    if (interchange.isImportBackup(raw)) {
      await interchange.undo(raw, x, y);
      return;
    }
    const conflicts = new Set(undoConflicts(patchWorld, raw.steps));
    if (conflicts.size > 0 && !onlyClean) {
      const clean = raw.steps.length - conflicts.size;
      cellMenu.open(x, y, [
        { section: '元に戻せません' },
        { note: `当てたあとに ${conflicts.size} 件が変わっています（${[...conflicts].slice(0, 3).map((i) => raw.steps[i].label).join('・')}${conflicts.size > 3 ? ' など' : ''}）。上書きしないよう、そのままでは戻しません` },
        { label: `変わっていない ${clean} 件だけ戻す`, disabled: clean === 0, run: () => void undoApplied(id, x, y, true) },
        { label: 'やめる', run: () => cellMenu.close() },
      ]);
      return;
    }
    let undone = 0;
    for (let i = raw.steps.length - 1; i >= 0; i--) {
      if (conflicts.has(i)) continue;
      undoStep(patchWorld, raw.steps[i].undo);
      undone++;
    }
    const at = new Date().toISOString();
    await writeData(`patch-backups/${id}.json`, { ...raw, undoneAt: at, ...(conflicts.size > 0 ? { leftAlone: [...conflicts] } : {}) });
    const history = await readPatchHistory();
    await writeData(PATCH_HISTORY, { v: 1, items: history.map((h) => (h.id === id ? { ...h, undoneAt: at } : h)) });
    sidebar.render();
    cellMenu.close();
    toast(`Grok の提案を元に戻しました（${undone} 件${conflicts.size > 0 ? `。変わっていた ${conflicts.size} 件はそのまま` : ''}）`, 7000);
  }

  async function openPatchFile() {
    const reply = await request((requestId) => ({ type: 'openJsonFile', requestId }), 10 * 60_000);
    if (!reply || reply.type !== 'jsonFile') return;
    if (!reply.ok) {
      if (reply.error !== 'cancel') toast(reply.error === 'big' ? `ファイルが大きすぎます（${IMPORT_FILE_LABEL} まで）` : 'ファイルを読めませんでした', 6000);
      return;
    }
    openPatchText(reply.text ?? '', 'file');
  }

  function grokPatchMenuEntries(x: number, y: number): MenuEntry[] {
    return [
      { label: '提案・取り込みファイルを開く…', hint: 'JSON', run: () => void openPatchFile() },
      ...inboxPatchEntries(),
      { label: 'Grok の提案の記録…', hint: '元に戻す', run: () => void openPatchHistory(x, y) },
    ];
  }

  // ---------- Grok の提案の受け取り（P4）：受け取り口・落としたファイル ----------
  //   受け取り口（%LOCALAPPDATA%\RocksCellsRelay\inbox か ROCKSCELLS_RELAY_DIR）に置かれた type:"patch" のファイルと、
  //   取り込みファイル（format:"hcb-memo-interchange"）は、ui-data\patch-inbox\<fileId>.json に写して「届いた提案」に並べる
  //   （勝手には当てない・取り込まない。一覧を開いて選んでから）。取り込みの行には kind:'interchange'
  const PATCH_INBOX = 'patch-inbox.json';
  type InboxPatch = { fileId: string; title: string; at: string; kind?: 'interchange' };
  let inboxPatches: InboxPatch[] = [];
  const inboxPatchesLoaded = readData(PATCH_INBOX).then((raw) => {
    const items = (raw as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) return;
    inboxPatches = items
      .filter((i): i is InboxPatch => typeof i?.fileId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(i.fileId) && typeof i.title === 'string' && typeof i.at === 'string')
      .map((i): InboxPatch => ({ fileId: i.fileId, title: i.title, at: i.at, ...(i.kind === 'interchange' ? { kind: 'interchange' as const } : {}) }))
      .slice(0, 20);
  });
  const saveInboxPatches = () => writeData(PATCH_INBOX, { v: 1, items: inboxPatches });

  botInbox.onPatch(async (reply, fileId) => {
    if (detectJsonKind(reply) === 'interchange') {
      // 取り込みファイル：形だけ確かめて写す（断る理由は英数字の短い名前：badFormat・badVersion・noMemos）
      const ix = parseInterchange(reply);
      if (!ix.ok) return ix.reason;
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(fileId)) return 'badName';
      if (!(await writeData(`patch-inbox/${fileId}.json`, reply))) return 'patchWrite';
      await inboxPatchesLoaded;
      const title = ix.doc.sheet.name.trim() ? [...ix.doc.sheet.name.trim()].slice(0, 40).join('') : '取り込み';
      inboxPatches = [{ fileId, title, at: new Date().toISOString(), kind: 'interchange' as const }, ...inboxPatches.filter((p) => p.fileId !== fileId)].slice(0, 20);
      await saveInboxPatches();
      toast(`Grok の取り込みファイルが届きました：「${title}」（シートの名前 ▾ →「届いた取り込み」から見られます）`, 8000);
      return null;
    }
    const parsed = parsePatch(reply);
    if (!parsed.ok) return /^[A-Za-z0-9]{1,40}$/.test(parsed.reason) ? parsed.reason : 'badPatch';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(fileId)) return 'badName';
    if (!(await writeData(`patch-inbox/${fileId}.json`, reply))) return 'patchWrite';
    await inboxPatchesLoaded;
    inboxPatches = [{ fileId, title: parsed.patch.title, at: new Date().toISOString() }, ...inboxPatches.filter((p) => p.fileId !== fileId)].slice(0, 20);
    await saveInboxPatches();
    toast(`Grok の提案が届きました：「${parsed.patch.title}」（シートの名前 ▾ →「届いた提案」から見られます）`, 8000);
    return null;
  });

  async function openInboxPatch(fileId: string) {
    const raw = await readData(`patch-inbox/${fileId}.json`);
    if (detectJsonKind(raw) === 'interchange') {
      if (!raw) return;
      interchange.open(raw, JSON.stringify(raw), 'inbox', () => void dropInboxPatch(fileId));
      return;
    }
    const parsed = parsePatch(raw);
    if (!parsed.ok) {
      toast('届いた提案を読めませんでした（ui-data\\patch-inbox）', 6000);
      return;
    }
    showPatch(parsed.patch, parsed.dropped, 'inbox', () => void dropInboxPatch(fileId));
  }

  async function dropInboxPatch(fileId: string) {
    inboxPatches = inboxPatches.filter((p) => p.fileId !== fileId);
    await saveInboxPatches();
  }

  function inboxPatchEntries(): MenuEntry[] {
    if (inboxPatches.length === 0) return [];
    const out: MenuEntry[] = [];
    for (const p of inboxPatches.slice(0, 5)) {
      out.push({ label: `${p.kind === 'interchange' ? '届いた取り込み' : '届いた提案'}：${[...p.title].slice(0, 24).join('')}`, hint: new Date(p.at).toLocaleString(), run: () => void openInboxPatch(p.fileId) });
    }
    out.push({
      row: '届いた提案',
      hint: `${inboxPatches.length} 件（ファイルは ui-data\\patch-inbox に残ります）`,
      buttons: [
        {
          label: '一覧を片づける',
          confirm: 'もう一度押すと片づけます',
          run: () => {
            inboxPatches = [];
            void saveInboxPatches();
            cellMenu.close();
          },
        },
      ],
    });
    return out;
  }

  // 盤面に落とした .json（Grok の提案ファイル）。ほかのファイルは受け取らない（ページが移らないよう、落とすのは止める）
  board.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  board.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    e.preventDefault();
    const json = files.find((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
    if (!json) {
      toast('盤面に落とせるのは Grok の提案ファイル・取り込みファイル（.json）だけです');
      return;
    }
    if (json.size > IMPORT_FILE_BYTES) {
      toast(`ファイルが大きすぎます（${IMPORT_FILE_LABEL} まで）`);
      return;
    }
    void json.text().then(
      (text) => openPatchText(text, 'drop'),
      () => toast('ファイルを読めませんでした'),
    );
  });

  // ---------- 盤面の関連の線（段階3） ----------
  //   セルを右クリック →「関連づける…」→ 種類 → 相手のセルを押す。線を押す（右クリック）→ 線のメニュー
  function cellRefOf(tab: Tab | undefined, memoId: string | null): CellRef | null {
    if (tab) return tabRef(tab.uid);
    if (memoId !== null && memos.get(memoId)) return memoRef(memoId);
    return null;
  }

  function refCell(ref: CellRef): { kind: 'tab'; tab: Tab } | { kind: 'memo'; memo: MemoCell } | null {
    if (ref.startsWith('t:')) {
      const tab = store.byUid(ref.slice(2));
      return tab ? { kind: 'tab', tab } : null;
    }
    const memo = memos.get(ref.slice(2));
    return memo ? { kind: 'memo', memo } : null;
  }

  function refTitle(ref: CellRef): string {
    const cell = refCell(ref);
    if (!cell) return '（見つからないセル）';
    const text = cell.kind === 'tab' ? cell.tab.title || cell.tab.url : memoTitle(cell.memo, 16);
    return [...(text || '（題名なし）')].slice(0, 16).join('');
  }

  function boardLinkEntries(tab: Tab | undefined, memoId: string | null, x: number, y: number): MenuEntry[] {
    const ref = cellRefOf(tab, memoId);
    if (!ref) return [];
    const out: MenuEntry[] = [{ section: '関連' }, { label: '関連づける…', hint: '種類 → 相手のセル', run: () => openBoardLinkKinds(ref, x, y) }];
    const mine = boardLinks.forCell(ref);
    for (const link of mine.slice(0, 6)) {
      const other = link.from === ref ? link.to : link.from;
      out.push({ label: `${boardKindName(link.kind)}：${refTitle(other)}`, hint: '線のメニュー', run: () => openBoardLinkMenu(link.id, x, y) });
    }
    if (mine.length > 6) out.push({ label: `ほかに ${mine.length - 6} 本（線を押すとメニュー）`, disabled: true });
    return out;
  }

  function openBoardLinkKinds(ref: CellRef, x: number, y: number) {
    cellMenu.open(x, y, [
      { section: `「${refTitle(ref)}」から関連づける：種類` },
      ...LINK_KINDS.map((k) => ({
        label: k.kind === 'same' ? `● ${boardKindName(k.kind)}（向きなし）` : `● ${boardKindName(k.kind)}`,
        hint: k.kind === 'same' ? `AとBは${boardKindName(k.kind)}` : `このセル → 相手`,
        run: () => sidebar.startBoardLink(ref, k.kind),
      })),
      'sep',
      { label: '種類の名前を変える…', run: () => openBoardLinkNames(x, y, () => openBoardLinkKinds(ref, x, y)) },
    ]);
  }

  // 盤面の関連の種類の名前（6 つ）を書いて登録する小窓。空は元の名前。決めたら back（元のメニュー）へ戻る
  function openBoardLinkNames(x: number, y: number, back?: () => void) {
    const form = document.createElement('form');
    form.className = 'cell-menu-form board-link-names';
    const head = document.createElement('div');
    head.className = 'cell-menu-section';
    head.textContent = `盤面の関連の種類の名前（${BOARD_LINK_NAME_MAX} 文字まで。空なら元の名前）`;
    form.append(head);
    const inputs = new Map<LinkKind, HTMLInputElement>();
    for (const k of LINK_KINDS) {
      const row = document.createElement('label');
      row.className = 'board-link-name-row';
      const swatch = document.createElement('span');
      swatch.className = 'board-link-name-swatch';
      swatch.style.setProperty('--link', k.color);
      if (k.dashed) swatch.classList.add('dashed');
      const input = document.createElement('input');
      input.maxLength = BOARD_LINK_NAME_MAX;
      input.value = prefs.boardLinkNames[k.kind] ?? '';
      input.placeholder = LINK_KIND_DEFAULT_NAMES[k.kind];
      input.spellcheck = false;
      input.setAttribute('aria-label', `「${LINK_KIND_DEFAULT_NAMES[k.kind]}」の名前`);
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'cell-menu-small';
      reset.textContent = '元に戻す';
      reset.title = `「${LINK_KIND_DEFAULT_NAMES[k.kind]}」に戻す`;
      reset.addEventListener('click', () => {
        input.value = '';
        input.focus();
      });
      row.append(swatch, input, reset);
      form.append(row);
      inputs.set(k.kind, input);
    }
    const buttons = document.createElement('div');
    buttons.className = 'cell-menu-kind';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'cell-menu-small';
    ok.textContent = '登録する';
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'cell-menu-small';
    all.textContent = '全部元に戻す';
    all.addEventListener('click', () => {
      for (const input of inputs.values()) input.value = '';
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cell-menu-small';
    cancel.textContent = 'やめる';
    cancel.addEventListener('click', () => (back ? back() : cellMenu.close()));
    buttons.append(ok, all, cancel);
    form.append(buttons);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw: Record<string, string> = {};
      for (const [kind, input] of inputs) raw[kind] = input.value;
      prefs.boardLinkNames = parseBoardLinkNames(raw);
      setBoardLinkNames(prefs.boardLinkNames);
      savePrefs(prefs);
      sidebar.render();
      toast('盤面の関連の種類の名前を登録しました');
      if (back) back();
      else cellMenu.close();
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cellMenu.close();
    });
    cellMenu.showForm(form, { x, y });
    inputs.values().next().value?.focus();
  }

  function finishBoardLink(from: CellRef, to: CellRef, kind: LinkKind) {
    const result = boardLinks.add(from, to, kind);
    if (result === 'self') toast('同じセルどうしは関連づけられません');
    else if (result === 'duplicate') toast('その2つのセルは、もう関連づけてあります（線を押すと種類を変えられます）');
    else if (result === 'full') toast('関連の線が多すぎます（500 本まで）');
    else if (result === 'bad') toast('関連づけられませんでした');
    else toast(`${boardLinkSentence(refTitle(from), refTitle(to), kind)}（線を押すとメニュー）`);
  }

  // セルへ移る：盤面をそのセルまで動かして光らせる（ほかのシートなら切り替える）。ブラウザのタブは切り替えない
  function jumpToRef(ref: CellRef) {
    const cell = refCell(ref);
    if (!cell) {
      toast('そのセルは、いまの盤面にありません（閉じたか、アーカイブしたシートにあります）');
      return;
    }
    const sheet = cell.kind === 'tab' ? cell.tab.sheet : cell.memo.sheet;
    if (sheet !== sheets.current && !switchSheet(sheet)) return;
    if (cell.kind === 'tab') {
      sidebar.setSelection([cell.tab.id], []);
      sidebar.reveal(cell.tab.pos);
      sidebar.flash(cell.tab.id);
    } else {
      sidebar.setSelection([], [cell.memo.id]);
      sidebar.reveal(cell.memo.pos);
      sidebar.flashMemo(cell.memo.id);
    }
  }

  function openBoardLinkMenu(id: string, x: number, y: number) {
    const link = boardLinks.get(id);
    if (!link) return;
    const kinds: MenuButton[] = LINK_KINDS.map((k) => ({
      label: boardKindName(k.kind),
      pressed: k.kind === link.kind,
      title: `線の色 ${k.color}`,
      run: () => {
        boardLinks.setKind(id, k.kind);
        openBoardLinkMenu(id, x, y); // 文と押してある方を作り直す
      },
    }));
    const where = (ref: CellRef) => {
      const cell = refCell(ref);
      if (!cell) return '見つからない';
      const sheet = cell.kind === 'tab' ? cell.tab.sheet : cell.memo.sheet;
      return sheet === sheets.current ? '' : `シート「${sheets.get(sheet)?.name ?? '?'}」`;
    };
    const entries: MenuEntry[] = [
      { section: boardLinkSentence(refTitle(link.from), refTitle(link.to), link.kind) },
      { label: '元へ移る', hint: where(link.from) || refTitle(link.from), run: () => jumpToRef(link.from) },
      { label: '相手へ移る', hint: where(link.to) || refTitle(link.to), run: () => jumpToRef(link.to) },
      { row: '種類', buttons: kinds },
      { label: '種類の名前を変える…', run: () => openBoardLinkNames(x, y, () => openBoardLinkMenu(id, x, y)) },
    ];
    if (link.kind !== 'same') entries.push({ label: '向きを入れ替える', run: () => (boardLinks.reverse(id), openBoardLinkMenu(id, x, y)) });
    entries.push({ row: '', buttons: [{ label: 'この関連を外す', confirm: 'もう一度押すと外す', close: true, run: () => boardLinks.remove(id) }] });
    cellMenu.open(x, y, entries);
  }

  // ---------- 島を手で作る・直す（段階1） ----------
  //   選んだセル（タブとメモのセル。1つでも）を島にする：名前と色を決め、「その場で」か「まとめて並べる」
  //   島の名前（盤面）を右クリック、島のセルを右クリック：名前・色・この島に足す・島から出す・解散
  const islandCells = () => {
    const tabs = selectedTabs();
    const notes = selectedMemos();
    if (menuPick) return { tabs, notes }; // 小窓で選んだ1個は、そのシートのまま島の操作に使う
    return { tabs: tabs.filter((t) => t.sheet === sheets.current), notes: notes.filter((m) => m.sheet === sheets.current) };
  };

  function islandEntriesForSelection(clicked: string | null, x: number, y: number): MenuEntry[] {
    const { tabs, notes } = islandCells();
    const cells = [...tabs, ...notes];
    if (cells.length === 0) return [];
    const out: MenuEntry[] = [{ section: '島' }];
    out.push({ label: cells.length > 1 ? `選んだ ${cells.length} セルを島にする…` : 'このセルで島を作る…', run: () => makeIslandFromSelection(x, y) });
    const target = clicked ? islands.get(clicked) : undefined;
    if (target) {
      const outside = cells.filter((cell) => cell.island !== target.id).length;
      if (outside > 0) out.push({ label: `島「${target.name}」に足す`, hint: `${outside}`, run: () => addSelectionToIsland(target.id) });
      out.push({ label: `島「${target.name}」の名前・色…`, run: () => openIslandMenu(target.id, x, y) });
    }
    const inIsland = cells.filter((cell) => cell.island).length;
    if (inIsland > 0) out.push({ label: inIsland > 1 ? `選んだセルを島から出す（${inIsland}）` : 'このセルを島から出す', run: () => leaveIslandSelection() });
    return out;
  }

  // 色の見本のボタン（押した色を current にする。押してもメニューは閉じない）
  function colorRow(current: string, onPick: (color: string) => void): MenuEntry {
    const buttons: MenuButton[] = TAG_PALETTE.map((color) => ({
      label: '',
      color,
      pressed: color === current,
      aria: `色 ${color}`,
      title: color,
      run: () => {
        for (const b of buttons) b.pressed = b.color === color;
        onPick(color);
        cellMenu.refresh();
      },
    }));
    return { row: '色', buttons };
  }

  function makeIslandFromSelection(x: number, y: number) {
    const { tabs, notes } = islandCells();
    const count = tabs.length + notes.length;
    if (count === 0) {
      toast('島にするセルを選んでください（Ctrl+クリックで選び足す）');
      return;
    }
    if (islands.list().length >= MAX_ISLAND_COUNT) {
      toast(`島は ${MAX_ISLAND_COUNT} 個までです（使わない島を解散してください）`);
      return;
    }
    const initial = islandNameSuggestion([...tabs.map((t) => t.title), ...notes.map((m) => memoTitle(m, 20))], islands.list().length);
    cellMenu.prompt(
      `島の名前（${count} セル）`,
      initial,
      (raw) => {
        const name = normalizeIslandName(raw);
        let color = islands.nextColor();
        const run = (gather: boolean) => createIslandFrom(tabs.map((t) => t.id), notes.map((m) => m.id), name, color, gather);
        cellMenu.open(x, y, [
          { section: `島「${name}」` },
          colorRow(color, (picked) => (color = picked)),
          { label: 'その場で島にする', hint: 'セルは動かさない', run: () => run(false) },
          { label: 'まとめて並べて島にする', hint: 'ひとかたまりに寄せる', run: () => run(true) },
        ]);
      },
      { x, y },
      { maxLength: 20, placeholder: '島の名前' },
    );
  }

  // 島を作る。gather：入るセルをひとかたまりに寄せる（AI の「島にする」と同じ寄せ方。ほかのセルは動かさない）
  function createIslandFrom(tabIds: number[], memoIds: string[], name: string, color: string, gather: boolean) {
    const homes = new Set<string>();
    for (const id of tabIds) {
      const sheet = store.get(id)?.sheet;
      if (sheet) homes.add(sheet);
    }
    for (const id of memoIds) {
      const sheet = memos.get(id)?.sheet;
      if (sheet) homes.add(sheet);
    }
    // みな同じシートならそこ（小窓のセル）。ばらばらなら、今見ているシートだけ（今までどおり）
    const home = homes.size === 1 ? [...homes][0] : sheets.current;
    const tabsNow = tabIds.filter((id) => store.get(id)?.sheet === home);
    const memosNow = memoIds.filter((id) => memos.get(id)?.sheet === home);
    if (tabsNow.length + memosNow.length === 0) return;
    const id = newIslandId();
    islands.add({ id, name: normalizeIslandName(name), color: color || islands.nextColor() });
    if (tabsNow.length > 0) store.setIsland(tabsNow, id);
    if (memosNow.length > 0) memos.setIsland(memosNow, id);
    if (gather) gatherIsland(tabsNow, memosNow, home);
    toast(`島「${normalizeIslandName(name)}」を作りました（名前を右クリックで直せます）`);
  }

  // 島に入るセルを、ひとかたまりの空いたセルへ寄せる（タブもメモのセルも。ほかのセルと返事待ちの予約の場所は使わない）
  function gatherIsland(tabIds: number[], memoIds: string[], sheet = sheets.current) {
    const memoKey = new Map<number, string>(); // 寄せる計算のための仮の番号 → メモのセル
    const pseudo = [
      ...store.inSheet(sheet),
      ...memos.inSheet(sheet).map((m, i) => {
        const n = -1 - i; // タブの id（0 以上）と重ならない
        memoKey.set(n, m.id);
        return { id: n, pos: m.pos, order: Number.MAX_SAFE_INTEGER - i } as unknown as Tab;
      }),
    ];
    const memoIdToKey = new Map([...memoKey].map(([n, id]) => [id, n]));
    const group = [...tabIds, ...memoIds.map((id) => memoIdToKey.get(id)).filter((n): n is number => n !== undefined)];
    const moved = layoutIslands(pseudo, [{ tabIds: group }], reservedIn(sheet));
    const tabPos = new Map<number, Hex>();
    const memoPos = new Map<string, Hex>();
    for (const [n, pos] of moved) {
      const memoId = memoKey.get(n);
      if (memoId !== undefined) memoPos.set(memoId, pos);
      else tabPos.set(n, pos);
    }
    if (tabPos.size > 0) store.setPositions(tabPos);
    if (memoPos.size > 0) memos.setPositions(memoPos);
  }

  function addSelectionToIsland(id: string) {
    const island = islands.get(id);
    if (!island) return;
    const { tabs, notes } = islandCells();
    const tabIds = tabs.filter((t) => t.island !== id).map((t) => t.id);
    const memoIds = notes.filter((m) => m.island !== id).map((m) => m.id);
    if (tabIds.length > 0) store.setIsland(tabIds, id);
    if (memoIds.length > 0) memos.setIsland(memoIds, id);
    pruneIslands();
    toast(`島「${island.name}」に ${tabIds.length + memoIds.length} セル足しました`);
  }

  function leaveIslandSelection() {
    const { tabs, notes } = islandCells();
    const tabIds = tabs.filter((t) => t.island).map((t) => t.id);
    const memoIds = notes.filter((m) => m.island).map((m) => m.id);
    if (tabIds.length > 0) store.setIsland(tabIds, null);
    if (memoIds.length > 0) memos.setIsland(memoIds, null);
    pruneIslands();
  }

  // 入っているセルがどこにも無くなった島は消す（ほかのシートやアーカイブに残っていれば消さない。保存の toSession も同じ決まりで落とす）
  function pruneIslands() {
    const used = new Set<string | null>([...store.all().map((t) => t.island), ...memos.list().map((m) => m.island)]);
    for (const island of islands.list()) if (!used.has(island.id)) islands.remove(island.id);
  }

  function renameIsland(id: string, at?: { x: number; y: number }) {
    const island = islands.get(id);
    if (!island) return;
    cellMenu.prompt(
      '島の名前',
      island.name,
      (raw) => {
        const name = normalizeIslandName(raw);
        islands.update(id, { name });
      },
      at,
      { maxLength: 20, placeholder: '島の名前' },
    );
  }

  // 島のメニュー（名前を右クリック・セルのメニューの「名前・色…」）
  function openIslandMenu(id: string, x: number, y: number) {
    const island = islands.get(id);
    if (!island) return;
    const tabsIn = store.all().filter((t) => t.island === id);
    const memosIn = memos.list().filter((m) => m.island === id);
    const here = { tabs: tabsIn.filter((t) => t.sheet === sheets.current).map((t) => t.id), memos: memosIn.filter((m) => m.sheet === sheets.current).map((m) => m.id) };
    const { tabs, notes } = islandCells();
    const outside = [...tabs, ...notes].filter((cell) => cell.island !== id).length;
    const entries: MenuEntry[] = [
      { section: `島「${island.name}」（${tabsIn.length + memosIn.length} セル）` },
      { label: '名前を変える…', hint: '名前をダブルクリック', run: () => renameIsland(id, { x, y }) },
      colorRow(island.color, (color) => islands.update(id, { color })),
      { label: '島のセルを全部選ぶ', hint: `${here.tabs.length + here.memos.length}`, run: () => sidebar.setSelection(here.tabs, here.memos) },
    ];
    if (outside > 0) entries.push({ label: `選んだセルをこの島に足す`, hint: `${outside}`, run: () => addSelectionToIsland(id) });
    const inside = [...tabs, ...notes].filter((cell) => cell.island === id).length;
    if (inside > 0) entries.push({ label: '選んだセルを島から出す', hint: `${inside}`, run: () => leaveIslandSelection() });
    entries.push(
      { label: 'この島を頼む', hint: '小窓', run: () => openIslandAsk(id, sidebar.memoSelection()) },
      'sep',
      { row: '島の名前', buttons: islandNamesButtons() },
      { row: '', buttons: [{ label: '解散（セルはそのまま）', confirm: 'もう一度押すと解散', close: true, run: () => removeIsland(id) }] },
    );
    cellMenu.open(x, y, entries);
  }

  // 「島の名前を出す・隠す」の切り替え（覚えておく）
  function islandNamesButtons(): MenuButton[] {
    const buttons: MenuButton[] = [];
    const set = (on: boolean) => {
      prefs.showIslandNames = on;
      sidebar.showIslandNames = on;
      savePrefs(prefs);
      buttons[0].pressed = on;
      buttons[1].pressed = !on;
      sidebar.render();
      cellMenu.refresh();
    };
    buttons.push({ label: '出す', pressed: prefs.showIslandNames, run: () => set(true) }, { label: '隠す', pressed: !prefs.showIslandNames, run: () => set(false) });
    return buttons;
  }

  // 島に入っているセルの数（タブ・メモのセル。どのシートのものも）
  function islandMemberCount(id: string): number {
    return store.all().filter((t) => t.island === id && !store.closing.has(t.id)).length + memos.list().filter((m) => m.island === id).length;
  }

  // 取り込んだもの（importSheet）を消す。sheet：シートごと（中のタブも閉じる）・imported：取り込んだメモ・入口・線・島だけ（シートと、あとで足したものは残す）
  //   作った島は、ほかに使われていなければ消す
  function removeImport(u: ImportSheetUndo, mode: 'sheet' | 'imported') {
    const refs = [...u.memos, ...u.portals].map((id) => memoRef(id));
    boardLinks.removeCells(refs);
    for (const id of u.boardLinks) boardLinks.remove(id);
    if (mode === 'sheet' && sheets.get(u.sheet)) removeSheet(u.sheet);
    for (const id of [...u.memos, ...u.portals]) if (memos.get(id)) memos.remove(id);
    for (const id of u.islands) if (islands.get(id) && islandMemberCount(id) === 0) islands.remove(id);
  }

  function removeIsland(id: string) {
    store.setIsland(
      store.all().filter((t) => t.island === id).map((t) => t.id),
      null,
    );
    memos.setIsland(
      memos.list().filter((m) => m.island === id).map((m) => m.id),
      null,
    );
    islands.remove(id);
  }

  // ---------- 拡大表示 ----------
  // カードのボタンでできること（右サイドバーのカードからも、relay 経由で同じことを頼まれる）
  const tabActions: PreviewActions = {
    open: (id) => activateWithoutMovingPeek(id), // カードの「開く」。小窓のシートなら盤面は移さない
    close: (id) => send({ type: 'closeTab', id }),
    setKeepAwake: (id, keepAwake) => store.setKeepAwake(id, keepAwake),
    sleepNow: (id) => send({ type: 'discardTab', id }),
    setMuted: (id, muted) => send({ type: 'setMuted', id, muted }),
    removeNote: (id, noteId) => store.removeNote(id, noteId),
    setLiked: (id, liked) => {
      store.setLiked(id, liked);
      if (liked === 3) emitEvent('liked', id);
    },
    addUserNote: (id, text) => {
      store.addNote(id, { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, createdAt: Date.now(), source: 'user', label: 'メモ' });
      emitEvent('note', id, text);
    },
    changeTags: (id, add, remove) => changeTabTags(id, add, remove),
    leaveIsland: (id) => store.setIsland([id], null),
    readAsCells: (id) => openReader(id),
    editFace: (id) => void editTabFace(id),
  };

  // ---------- 相棒が話すきっかけ（読み終えた・♥×3・メモを書いた）を右サイドバーへ ----------
  function emitEvent(type: CompanionEvent['type'], tabId: number, text = '') {
    const tab = store.get(tabId);
    if (!tab || !sidebars.right.visible) return;
    const base = { tabId, title: tab.title, url: tab.url };
    const event: CompanionEvent =
      type === 'read' ? { type, ...base } : type === 'liked' ? { type, ...base, level: tab.liked } : { type, ...base, text };
    send({ type: 'relay', to: 'right', payload: { kind: 'event', event } });
  }
  const tracker = new ReadingTracker(store, (tabId) => emitEvent('read', tabId));
  const overlay = el('div', 'overlay');
  board.append(overlay);
  const preview = new PreviewHost({
    pinnedDetail: () => prefs.popupDetail,
    store,
    thumbs,
    dock: $('dock'),
    overlay,
    anchorOf: (id) => sidebar.anchorOf(id),
    actions: tabActions,
    islandOf: (id) => islands.get(id),
    floatMoved: (pos) => {
      prefs.floatPos = pos;
      savePrefsSoon();
    },
    memos,
    memoActions,
    anchorOfMemo: (id) => sidebar.anchorOfMemo(id),
    thread: threadUi,
    portal: {
      info: (sheetId) => {
        const sheet = sheets.get(sheetId);
        if (!sheet) return null;
        const tabs = store.inSheet(sheet.id).length;
        const memoCount = memos.inSheet(sheet.id).length;
        return { name: sheet.name, color: sheet.color, count: tabs + memoCount, tabs, memos: memoCount };
      },
      actions: {
        open: (id) => openPortal(id),
        rename: (id) => {
          const target = memos.get(id)?.portal;
          const rect = sidebar.anchorOfMemo(id);
          if (target) renameSheet(target, rect ? { x: rect.left, y: rect.bottom + 4 } : undefined);
        },
        editFace: (id) => void editPortalFace(id),
        unpack: (id) => unpackSheet(id),
        remove: (id) => removeMemos([id]),
      },
    },
    bot: {
      entry: (botId) => bots.get(botId),
      state: (botId) => botStateOf(botId),
      badges: (botId) => botBadgesOf(botId),
      actions: botActions,
    },
    app: {
      entry: (appId) => apps.get(appId),
      pinned: (appId) => !!appId && appId === pinnedAppId,
      actions: {
        launch: (id) => launchAppCell(id),
        rename: (id) => renameApp(id),
        repick: (id) => void repickApp(id),
        remove: (id) => confirmRemoveAppCell(id),
        forget: (id) => {
          const appId = memos.get(id)?.app;
          if (appId) confirmForgetApp(appId);
        },
      },
    },
    sheetName: (id) => (id === MAIN_SHEET ? undefined : sheets.get(id)?.name),
    topInset: () => sidebar.topInset,
    tagPad,
    toast: (text) => toast(text, 4500),
    cardWinsChanged: (list) => {
      prefs.cardWins = list.map((w) => ({ ...w }));
      savePrefsSoon();
    },
  });
  paneHooks.preview = preview;
  preview.setCardWins(prefs.cardWins); // P1：前の起動で出していたカードの小窓（タブ・メモが読み込まれたら出てくる）
  islands.onChange(() => preview.render());
  sheets.onChange(() => preview.render()); // シートの名前を変えたら、カードの名前も
  bots.onChange(() => preview.render()); // ボットの名前・リンクを変えたら、カードも
  apps.onChange(() => preview.render()); // アプリの名前・アイコンを変えたら、カードも
  // 「○分前に使用」の表示を新しくする
  window.setInterval(() => preview.render(), 30_000);
  // サイドバーの外（ページ側）へマウスが出たら、拡大表示を「表示中のタブ」に戻す
  document.documentElement.addEventListener('mouseleave', () => {
    preview.resetFocus();
    relayFocus();
  });

  // ---------- サムネイル ----------
  // サイドバーにマウスが入ってきたとき（＝タブを切り替えそうなとき）と、ページを読み込み終えたときに撮る
  const capture = (id: number) => {
    if (store.activeId === id) send({ type: 'captureTab', id });
  };
  document.documentElement.addEventListener(
    'mouseenter',
    throttle(() => {
      if (store.activeId !== null) capture(store.activeId);
    }, 4000),
  );

  // ---------- アドレスバーと 戻る / 進む / 再読み込み ----------
  const address = $<HTMLInputElement>('address');
  const back = $<HTMLButtonElement>('back');
  const forward = $<HTMLButtonElement>('forward');
  const reload = $<HTMLButtonElement>('reload');

  function withActive(fn: (id: number) => void) {
    if (store.activeId !== null) fn(store.activeId);
  }

  // アドレス欄に grokbot:// を入れた：タブにも、アプリにも渡さない（開くのはボットのセルの openBotApp だけ。S1.11）
  //   ボットのリンクの形なら、そのリンクの id でボットのセルを置けるようにする（置いたセルを押すと、アプリが開く）
  function refuseGrokBotAddress(text: string) {
    address.value = store.active?.url ?? '';
    address.blur();
    const agentId = parseAgentId(text.trim().replace(/^"(.*)"$/, '$1'));
    if (!agentId || !bots.ready) {
      toast('grokbot:// はアドレス欄からは開きません。Grok Bot アプリは、盤面のボットのセルを押すと開きます', 6000);
      return;
    }
    const rect = address.getBoundingClientRect();
    const where = { x: rect.left, y: rect.bottom + 4 };
    cellMenu.open(where.x, where.y, [
      { section: 'grokbot:// はアドレス欄からは開きません' },
      { label: 'Grok Bot アプリは、盤面のボットのセルを押すと開きます', disabled: true },
      { label: 'このリンクで、ボットのセルを置く…', run: () => newBotAt(sidebar.centerHex, where, agentId) },
      { label: 'やめる', run: () => undefined },
    ]);
    cellMenu.focusFirst();
  }

  $('address-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (isGrokBotAddress(address.value)) {
      refuseGrokBotAddress(address.value);
      return;
    }
    const url = toUrl(address.value);
    if (!url) return;
    closeReader(); // 別のページへ移るので、六角で読む画面は閉じる
    if (store.activeId !== null) send({ type: 'navigate', id: store.activeId, url });
    else createTab(url);
    address.blur();
  });
  address.addEventListener('focus', () => address.select());
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      address.value = store.active?.url ?? '';
      address.blur();
    } else if (e.key === 'Enter' && e.altKey && !e.isComposing) {
      // Alt+Enter：入れた URL（か検索）を、裏で読み込む新しいタブにして今見ているシートに足す（表示中のページはそのまま）
      e.preventDefault();
      if (isGrokBotAddress(address.value)) {
        refuseGrokBotAddress(address.value);
        return;
      }
      const url = toUrl(address.value);
      if (!url) return;
      requestTab(url, { background: true, pos: activeOn(sheets.current) ? undefined : sidebar.centerHex });
      address.value = store.active?.url ?? '';
      address.blur();
    }
  });
  // 戻る・進む・再読み込みでページが変わるので、六角で読む画面は閉じる
  back.addEventListener('click', () => withActive((id) => (closeReader(), send({ type: 'goBack', id }))));
  forward.addEventListener('click', () => withActive((id) => (closeReader(), send({ type: 'goForward', id }))));
  reload.addEventListener('click', () => withActive((id) => (closeReader(), send({ type: 'reload', id }))));

  store.onChange(() => {
    const tab = store.active;
    if (document.activeElement !== address) address.value = tab?.url ?? '';
    back.disabled = !tab?.canGoBack;
    forward.disabled = !tab?.canGoForward;
    reload.classList.toggle('spinning', !!tab?.loading);
  });

  // ---------- 表示の切り替え ----------
  const menu = $('preview-menu');
  const menuItems = [...menu.querySelectorAll<HTMLButtonElement>('[data-placement]')];

  function applyView() {
    sidebar.mode = prefs.mode;
    sidebar.shape = prefs.shape;
    sidebar.showNumbers = prefs.showNumbers;
    sidebar.showIslandNames = prefs.showIslandNames;
    sidebar.tabLook = prefs.tabLook;
    sidebar.showBalloons = prefs.preview !== 'popup'; // ポップアップのカードにコメントが出るので、吹き出しは要らない
    preview.placement = prefs.preview;
    preview.floatPos = prefs.floatPos;
    setPressed('mode-small', prefs.mode === 'small');
    setPressed('mode-large', prefs.mode === 'large');
    setPressed('shape-regular', prefs.shape === 'regular');
    setPressed('shape-wide', prefs.shape === 'wide');
    setPressed('toggle-numbers', prefs.showNumbers);
    setPressed('toggle-route', prefs.showRoute);
    setPressed('toggle-right', sidebars.right.visible);
    setPressed('open-reader', !!sidebars.reader?.visible);
    for (const item of menuItems) item.setAttribute('aria-checked', String(item.dataset.placement === prefs.preview));
    $('toggle-popup-detail').setAttribute('aria-checked', String(prefs.popupDetail));
    sidebar.render();
    preview.render();
    savePrefs(prefs);
  }

  $('mode-small').addEventListener('click', () => {
    prefs.mode = 'small';
    applyView();
  });
  $('mode-large').addEventListener('click', () => {
    prefs.mode = 'large';
    applyView();
  });
  for (const shape of ['regular', 'wide'] as const) {
    $(`shape-${shape}`).addEventListener('click', () => {
      prefs.shape = shape;
      prefs.mode = 'large';
      applyView();
    });
  }
  $('toggle-numbers').addEventListener('click', () => {
    prefs.showNumbers = !prefs.showNumbers;
    applyView();
  });
  $('toggle-route').addEventListener('click', () => {
    prefs.showRoute = !prefs.showRoute;
    applyView();
    updateRouteView();
  });
  $('new-tab').addEventListener('click', () => openNewTab());

  // 拡大表示の置き場所メニュー
  $('preview-button').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', () => (menu.hidden = true));
  for (const item of menuItems) {
    item.addEventListener('click', () => setPlacement(item.dataset.placement as PreviewPlacement));
  }
  // 見た目（テーマ）の小窓。保存は theme.ts、面どうしは storage で届く
  startThemeMenu($('theme-button'), $('theme-menu'));
  // 窓の枠（題名バー・窓の地・ページの明暗）を C++ へ。付けたテーマがどんな理由で変わっても（小窓・Windows の明暗・別の窓）、
  // 前と違えば送る。CSS がまだで色が読めなければ、読み込みが済んでから送り直す
  let sentTheme = '';
  const syncWindowTheme = () => {
    const msg = windowThemeMessage();
    if (!msg) return;
    const text = JSON.stringify(msg);
    if (text === sentTheme) return;
    sentTheme = text;
    send(msg);
  };
  window.addEventListener(THEME_APPLIED, syncWindowTheme);
  window.addEventListener('load', syncWindowTheme);
  syncWindowTheme();
  // 試し：固定したポップアップは詳しく（右のカードと同じボタン・タグ）。マウスを乗せただけのときは小さいまま
  $('toggle-popup-detail').addEventListener('click', () => {
    prefs.popupDetail = !prefs.popupDetail;
    applyView();
  });

  function setPlacement(placement: PreviewPlacement) {
    prefs.preview = placement;
    if (placement === 'right' && !sidebars.right.visible) setRightSidebar(true);
    applyView();
    relayState();
  }

  // 右サイドバー
  $('toggle-right').addEventListener('click', () => setRightSidebar(!sidebars.right.visible));
  function setRightSidebar(visible: boolean) {
    prefs.rightSidebar = visible;
    savePrefs(prefs);
    send({ type: 'setSidebar', side: 'right', visible });
  }

  function openNewTab() {
    createTab();
    address.value = '';
    address.focus();
  }

  // ---------- 右サイドバー（相棒）へ届けるもの ----------
  //   右サイドバーを閉じていたら開いて、準備ができてから渡す（リマインダー・「相棒に聞く」）
  const forRight: RelayPayload[] = [];
  let rightReady = false; // 右サイドバーの UI が一度でも動き出したか（閉じても裏に残っている）
  let memoReady = false; // 下のメモの面が一度でも動き出したか
  let memoPaneDraft = false; // 下の区画に書きかけがあるか（下の面が知らせる）
  const flushReminders = () => {
    for (const payload of forRight.splice(0)) send({ type: 'relay', to: 'right', payload });
  };
  function sendToRight(payload: RelayPayload) {
    if (sidebars.right.visible && rightReady) {
      send({ type: 'relay', to: 'right', payload });
    } else {
      forRight.push(payload);
      if (!sidebars.right.visible) setRightSidebar(true);
    }
  }

  // ページの右クリック「中央の見えている所」と Ctrl+Shift+Y（C2）。右が閉じていれば開いてから、右の「撮影」に頼む
  function captureCenterFromPage() {
    sendToRight({ kind: 'captureCenter' });
  }

  function captureRecordFromPage() {
    sendToRight({ kind: 'captureRecord' });
  }

  function captureScopeFromPage(scope: 'window' | 'desktop' | 'region') {
    sendToRight({ kind: 'captureScope', scope });
  }

  // ページの画像の右クリック（I1）。右が閉じていれば開いてから、右の「撮影」が測って撮る
  function captureImageFromPage(tabId: number, url: string) {
    sendToRight({ kind: 'captureImage', tabId, url: typeof url === 'string' ? url : '', tabUrl: store.get(tabId)?.url ?? '', at: Date.now() });
  }

  // 盤面・下の区画の画像を、右の「撮影」に残して大きく開く（I4）。画像は送らず、shots の ID だけ。右が閉じていれば開いてから
  function captureShotToRight(shot: string, from: CaptureFromKind, name: string) {
    const clipped = clipFromName(name);
    sendToRight({ kind: 'captureShot', shot, from, ...(clipped ? { name: clipped } : {}) });
  }

  // ---------- リマインダー（時間になったら Windows の通知と、相棒の吹き出しで知らせる） ----------
  //   Windows の通知がオフでも気づけるように、右サイドバーの相棒も吹き出しで知らせる
  // 引き金「このサイトを次に開いたとき」（K4。計画書 §5 の 16）：表示中のタブが別のホストから移ったときだけ照らす
  //   （置いたときにそのサイトを見ていても、すぐには鳴らさない。同じホストの中の移動でも鳴らさない）
  function checkSiteTrigger(from: string, to: string) {
    const host = siteHost(to);
    if (host && host !== siteHost(from)) reminders.checkSite(host);
  }
  const reminders = new ReminderStore((reminder, late) => {
    send({ type: 'notify', title: late ? 'リマインダー（起動していない間に過ぎたもの）' : 'リマインダー', body: reminder.text });
    sendToRight({ kind: 'reminder', reminder, late });
  });

  // ---------- 六角で読む（ページの上に重ねる画面） ----------
  let readerReady = false; // 読む画面の UI が動き出したか
  let readerTab: number | null = null; // 読んでいるタブ
  let readAfterActivate: number | null = null; // このタブが表示されたら、六角で読む
  function openReader(id: number) {
    capturePending = null;
    abandonCrop();
    const tab = store.get(id);
    if (!tab) return;
    if (store.activeId !== id) {
      readAfterActivate = id;
      activateWithoutMovingPeek(id); // 小窓のタブを六角で読んでも、盤面は移さない
      return;
    }
    readerTab = id;
    // YouTube の動画は、区間セルを右か下に並べて動画は見えたままにする（置き場所と大きさは読む画面の設定）
    const video = isVideoUrl(tab.url) || isMediaFileUrl(tab.url);
    const place = readerVideoPlace();
    send({ type: 'setSidebar', side: 'reader', visible: true, split: video ? place.layout : false, width: place.width, height: place.height });
    if (readerReady) send({ type: 'relay', to: 'reader', payload: { kind: 'readerOpen', tabId: id, url: tab.url, title: tab.title } });
  }
  function closeReader() {
    readerTab = null;
    shotPending = null;
    capturePending = null;
    abandonCrop();
    if (sidebars.reader?.visible) send({ type: 'setSidebar', side: 'reader', visible: false });
  }

  // 自分の音声・動画のファイルを、新しいタブで開く（同じ名前の字幕があれば、六角で読むときに読む）
  async function openMediaFile(at: Hex | null) {
    const sheet = sheets.current;
    const path = await chooseMediaFile();
    if (!path) return;
    requestTab(fileUrlOf(path), { sheet, pos: at ?? undefined, activate: true });
    toast('ファイルを開きました。六角で読む（左上の六角形のボタン）で区間セルにできます');
  }

  // 画像ファイルをタブにする。中央は WebView が file:// を開く（UI は file: も data: も取りに行かない）。顔は縮図
  //   縮図を付けられたら true。dataUrl が無いときは、ファイルだけ開いたので true
  async function placeImageCell(path: string, at: Hex | null, dataUrl?: string) {
    const sheet = sheets.current;
    const imageId = dataUrl?.startsWith('data:image/') ? await memos.saveImage(dataUrl) : null;
    const url = fileUrlOf(path);
    requestTab(url, {
      sheet,
      pos: at ?? undefined,
      activate: true,
      title: fileNameOf(url),
      ...(imageId ? { image: imageId, look: 'image' as const } : {}),
    });
    return !!imageId || !dataUrl?.startsWith('data:image/');
  }

  // 空いたセルに、選んだ画像ファイルを置く。やめたときは何もしない。種類が違うときはタブを作らない
  async function openImageFile(at: Hex | null) {
    const reply = await request((requestId) => ({ type: 'openImageFile', requestId }), 10 * 60_000);
    if (!reply || reply.type !== 'imageFile') {
      toast('画像ファイルを選べませんでした');
      return;
    }
    if (!reply.path) return;
    if (reply.error === 'type') {
      toast('画像ファイルを選んでください');
      return;
    }
    const thumb = await placeImageCell(reply.path, at, reply.image);
    if (!reply.ok) toast(reply.error === 'missing' ? 'その画像ファイルは、もうありません' : reply.error === 'big' ? '画像が大きすぎます' : '縮図は作れませんでした');
    else if (!thumb) toast('縮図は作れませんでした');
    else toast('画像を開きました');
  }

  // クリップボードの画像をファイルにしてから、画像のセルにする（中央は file:// を開く。data: は顔の縮図だけ）
  async function placeClipboardImage(at: Hex | null) {
    const reply = await request((requestId) => ({ type: 'clipboardReadImage', requestId }), 8_000);
    const image = reply && reply.type === 'clipboardImage' && reply.ok ? reply.image : undefined;
    if (!image?.startsWith('data:image/')) {
      toast(cellImageErrorText(reply && reply.type === 'clipboardImage' ? reply.error : undefined));
      return;
    }
    const saved = await request((requestId) => ({ type: 'saveClipboardImage', requestId, data: image }), 8_000);
    if (!saved || saved.type !== 'imageSaved' || !saved.ok || !saved.path) {
      toast('画像を保存できませんでした');
      return;
    }
    const thumb = await placeImageCell(saved.path, at, image);
    toast(thumb ? '画像を開きました' : '縮図は作れませんでした');
  }

  // ---------- 六角形スクショ（表示中のページを撮り、読む画面の面で六角形に切り取る） ----------
  //   sheet：撮り始めたときのシート（その間にシートを移っても、そこに置く）　forTab：タブの画像にする（六角形に切り取る）
  //   linkCover：右クリックしたリンクを、切り取った六角形を表紙にして裏で開く（from は、そのリンクがあったタブ）
  type LinkCover = { url: string; text: string; from: number };
  let shotPending: { image: string; url: string; title: string; at: Hex | null; sheet: string; forTab: number | null; linkCover: LinkCover | null } | null = null;
  let capturePending: Extract<RelayPayload, { kind: 'captureOpen' }> | null = null;
  let cropPending: Extract<RelayPayload, { kind: 'captureCrop' }> | null = null;
  function abandonCrop() {
    if (!cropPending) return;
    cropPending = null;
    sendToRight({ kind: 'captureCropCancel' });
  }
  function showCrop(image: string) {
    shotPending = null;
    readerTab = null;
    capturePending = null;
    cropPending = { kind: 'captureCrop', image };
    send({ type: 'setSidebar', side: 'reader', visible: true, split: false });
    if (readerReady) send({ type: 'relay', to: 'reader', payload: cropPending });
  }
  function showCapture(action: Extract<RelayCommand, { command: 'openCapture' }>) {
    shotPending = null;
    readerTab = null;
    abandonCrop();
    capturePending = {
      kind: 'captureOpen',
      id: action.id,
      image: action.image,
      marks: action.marks,
      strokes: action.strokes,
      blur: action.blur,
      title: action.title,
      ...(action.askedAt !== undefined ? { askedAt: action.askedAt } : {}),
      ...(action.video !== undefined ? { video: action.video } : {}),
      ...(action.undo !== undefined ? { undo: action.undo } : {}),
    };
    send({ type: 'setSidebar', side: 'reader', visible: true, split: false });
    if (readerReady) send({ type: 'relay', to: 'reader', payload: capturePending });
  }
  const shotPayload = (s: NonNullable<typeof shotPending>): RelayPayload => ({
    kind: 'shotStart',
    image: s.image,
    title: s.title,
    ...(s.linkCover ? { purpose: 'linkCover' as const } : s.forTab !== null ? { purpose: 'tabImage' as const } : {}),
  });
  async function startShot(at: Hex | null, forTab: number | null = null, linkCover: LinkCover | null = null) {
    capturePending = null;
    abandonCrop();
    const tab = store.active;
    if (!tab || tab.asleep || (forTab !== null && tab.id !== forTab)) {
      toast('表示中のページで撮れます');
      return;
    }
    if (sidebars.reader?.visible) closeReader();
    if (linkCover) await new Promise((r) => window.setTimeout(r, 180)); // ページの右クリックのメニューが消えてから撮る
    const reply = await request((requestId) => ({ type: 'captureFull', requestId, id: tab.id }), 8_000);
    if (reply?.type !== 'capture' || !reply.ok || !reply.image) {
      toast('ページを撮れませんでした');
      return;
    }
    shotPending = { image: reply.image, url: tab.url, title: tab.title, at, sheet: sheets.current, forTab, linkCover };
    send({ type: 'setSidebar', side: 'reader', visible: true, split: false });
    if (readerReady) send({ type: 'relay', to: 'reader', payload: shotPayload(shotPending) });
  }

  // 撮り終えた：左のセルに置く（画像のメモのセル）・右の相棒に見せる・Grok-Bot に送る（S3.12）
  async function finishShot(result: { image: string; comment: string; to: 'cell' | 'companion' | 'both' | 'grok' }) {
    const ctx = shotPending;
    // Grok に送る（S3.12）：読む画面は閉じずに、その上に依頼の小窓（画像のサムネイルつき・1体だけ）を開いてもらう。
    //   小窓の後ろには撮ったページを敷く。添付は S3.11 と同じ決め（ページの URL・題名。本文は付けない）
    if (result.to === 'grok' && ctx && !ctx.linkCover && ctx.forTab === null && /^data:image\//.test(result.image)) {
      shotPending = null;
      const url = /^https?:\/\//i.test(ctx.url) ? ctx.url : '';
      await openBotAsk({ url, title: ctx.title, selection: '' }, { capture: false, afterMenu: false, shot: { image: result.image, comment: result.comment, page: ctx.image } });
      return;
    }
    closeReader();
    if (!ctx) return;
    // 表紙にしてリンクをセルに追加：小さくした六角形を表紙にして、リンクを裏で読み込む新しいタブにする（コメントはタブのコメントに）
    if (ctx.linkCover) {
      const link = ctx.linkCover;
      const small = await shrinkImage(result.image, 256).catch(() => null);
      const imageId = small ? await memos.saveImage(small) : null;
      openLinkInBackground(link.url, link.from, {
        title: link.text,
        image: imageId ?? undefined,
        comment: result.comment || undefined,
        lead: imageId ? '表紙をつけて、' : '表紙の画像は保存できませんでしたが、',
      });
      return;
    }
    // タブの画像にする（六角形に切り取る）：小さくして、そのタブの画像に（コメントを書いたら、タブのコメントにも）
    if (ctx.forTab !== null) {
      const id = ctx.forTab;
      if (!store.get(id)) return;
      const small = await shrinkImage(result.image, 256).catch(() => null);
      const imageId = small ? await memos.saveImage(small) : null;
      if (!imageId) {
        toast('画像を保存できませんでした');
        return;
      }
      store.setFace(id, { image: imageId, ...(result.comment ? { comment: result.comment } : {}) });
      toast('切り取った六角形を、タブの画像にしました');
      return;
    }
    const source = /^https?:\/\//i.test(ctx.url) ? { url: ctx.url, title: ctx.title } : undefined;
    if (result.to !== 'companion') {
      const imageId = await memos.saveImage(result.image);
      const sheet = sheets.get(ctx.sheet) ? ctx.sheet : sheets.current;
      const near = ctx.at ?? anchorOn(sheet);
      const free = ctx.at && !isTaken(ctx.at, sheet);
      const pos = free && ctx.at ? ctx.at : placeCluster(allCells(sheet), 1, near)[0];
      const memo = memos.add({ sheet, pos, text: result.comment, image: imageId ?? undefined, source });
      if (memo) {
        preview.showMemo(memo.id);
        toast(imageId ? '六角形スクショを左のセルに置きました' : 'セルに置きましたが、画像を保存できませんでした');
      }
    }
    if (result.to !== 'cell') {
      const blocked = await pageIsBlocked(ctx.url);
      if (blocked) {
        toast(BLOCK_NOTE);
        if (result.comment.trim()) sendToRight({ kind: 'askCompanion', from: 'shot', text: result.comment, title: '', url: '' });
      } else {
        sendToRight({ kind: 'askCompanion', from: 'shot', text: result.comment, title: ctx.title, url: ctx.url, image: result.image });
      }
    }
  }
  $('open-reader').addEventListener('click', () => {
    if (sidebars.reader?.visible) closeReader();
    else withActive((id) => openReader(id));
  });

  // ---------- 「🔍 Grok に調べてもらう」（S3.11。ページの右クリック・Ctrl+Shift+G・メモのセルの右クリック） ----------
  //   依頼の小窓（panels/bot-request-form.ts。右の巣の上と同じ部品）を、ページの上（読む画面の重ね窓。reader/ask.ts）に開いてもらう。
  //   宛て先は巣で選んでいるボット（右のボットの欄で見ている巣の席のボット）、無ければ席1。添付はページの URL・題名・選んだ文（本文は付けない）。
  //   小窓は AskLeftSender で命令 botDraftV2 を送ってくる。依頼を作る・覚える・コピーしてアプリを開くのは今までどおり左（runCommand）
  const ASK_SELECTION_MAX = 4000; // 選んだ文の上限（C++ の右クリックと同じ）
  // Ctrl+Shift+G のとき、ページで選んでいる文を聞く決まったスクリプト（入力欄の中で選んだ文も。4,000 字まで）
  const SELECTION_SCRIPT = `(() => {
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|url)$/i.test(a.type))) && typeof a.selectionStart === 'number' && a.selectionEnd > a.selectionStart) {
      return String(a.value).slice(a.selectionStart, a.selectionEnd).slice(0, ${ASK_SELECTION_MAX});
    }
    return String(window.getSelection ? window.getSelection() : '').slice(0, ${ASK_SELECTION_MAX});
  })()`;
  let askPending: RelayPayload | null = null; // 読む画面が動き出したら渡す小窓（読む画面をはじめて出すとき）
  // Ctrl+Shift+G を素早く 2 回（R6・D14）：前の askGrok からこの時間のうちにもう一度来たら「前と同じで」（C++ は変えず、ここで時刻を見る）
  const ASK_TWICE_MS = 700;
  let lastAskAt = 0;

  // ページから（右クリック・Ctrl+Shift+G）。text が空なら、ページに選んだ文を聞く（聞けなければ選んだ文なしで開く）
  //   2 回めが素早く来たら same を付けて開く（3 回めは、また 1 回めとして数える）
  async function askGrokFromPage(tabId: number, url: string, text: string) {
    const now = Date.now();
    const same = now - lastAskAt < ASK_TWICE_MS;
    lastAskAt = same ? 0 : now;
    const tab = store.get(tabId);
    const pageUrl = /^https?:\/\//i.test(url) ? url : ''; // C++ も http・https 以外は空で送る
    const blocked = await pageIsBlocked(pageUrl);
    let selection = blocked ? '' : String(text ?? '');
    if (!blocked && !selection && tab && !tab.asleep) {
      const reply = await request((requestId) => ({ type: 'evalInTab', requestId, id: tab.id, script: SELECTION_SCRIPT }), 1500);
      if (reply?.type === 'evalResult' && reply.ok && typeof reply.value === 'string') selection = reply.value;
    }
    await openBotAsk({ url: pageUrl, title: pageUrl && tab ? tab.title : '', selection }, { capture: !blocked, afterMenu: !!text, ...(blocked ? { note: BLOCK_NOTE } : {}), ...(same ? { same } : {}) });
  }

  // メモのセルから：メモの文を「選んだ文」に（スクショのメモなら、元のページの URL と題名も付けられる）
  async function askGrokFromMemo(id: string) {
    const memo = memos.get(id);
    if (!memo || !memo.text.trim()) return;
    const source = memo.source && /^https?:\/\//i.test(memo.source.url) ? memo.source : null;
    const blocked = source ? await pageIsBlocked(source.url) : false;
    if (blocked) {
      // メモの文は人が書いたものなので頼む文に残す。ページのアドレスと、今見ている画面の画像は付けない
      await openBotAsk({ url: '', title: source?.title ?? '', selection: '' }, { capture: false, afterMenu: false, note: BLOCK_NOTE, text: memo.text, memo: true });
      return;
    }
    await openBotAsk({ url: source?.url ?? '', title: source?.title ?? '', selection: memo.text }, { capture: true, afterMenu: false, memo: true });
  }

  // クリップボードの画像の候補（R7a）：あれば長い辺 1600px の JPEG の data URL。無い・読めない・Base64 90 万字を越えるときは null
  const CLIP_CANDIDATE_MAX = 900_000;
  async function clipCandidate(): Promise<string | null> {
    if (!(await pasteClipboard.hasImage())) return null;
    const image = await pasteClipboard.readImage();
    return image && image.length <= CLIP_CANDIDATE_MAX ? image : null;
  }

  // 読む画面を出して、依頼の小窓を開いてもらう。六角で読んでいるときは、その上に重ねる（撮らない）
  //   shot：六角スクショを Grok-Bot へ（S3.12）。撮る画面のあとの読む画面に出す（ページの上と同じ扱い：閉じたら読む画面も閉じる）。
  //     image は切り取った六角形・comment は頼む文の最初の行・page は小窓の後ろに敷く撮ったページ
  //   memo：メモのセルから（定型のはじめの組を決める入口。R4a。六角スクショは shot、ほかはページ）
  //   クリップボードの画像の候補（R7a・D15）：六角スクショでも渡し止めでもなければ、下敷きを撮るのと同じあいだにクリップボードの画像を読み
  //     （clipboardHasImage → clipboardReadImage。長い辺 1600px の JPEG）、Base64 90 万字までなら botAsk の candidate で渡す。
  //     読むだけで、どこにも送らない（小窓で印を付けたときだけ、読む画面が写しを取って 2 回貼りで送る）
  //   same：Ctrl+Shift+G を素早く 2 回押した（R6。小窓が開いたらすぐ「前と同じで」を当てる）
  async function openBotAsk(
    context: { url: string; title: string; selection: string },
    opts: { capture: boolean; afterMenu: boolean; shot?: { image: string; comment: string; page: string }; note?: string; text?: string; memo?: boolean; same?: boolean },
  ) {
    if (shotPending) {
      toast('六角形スクショを撮り終えてから、もう一度どうぞ');
      return;
    }
    if (!bots.ready) {
      toast('ボットの台帳を読み込んでいます。少し待ってから、もう一度どうぞ');
      if (opts.shot) closeReader(); // 撮る画面のあとの読む画面を残さない
      return;
    }
    const hosts = await ensureBlocklist();
    const contextBlocked = isBlockedUrl(context.url, hosts);
    const safeContext = contextBlocked ? { url: '', title: context.title, selection: '' } : context;
    const shot = opts.shot && !contextBlocked ? opts.shot : undefined;
    const requestText = opts.text || (contextBlocked ? opts.shot?.comment : '') || '';
    const overReader = !shot && !!sidebars.reader?.visible;
    let image: string | undefined = shot && /^data:image\//.test(shot.page) ? shot.page : undefined;
    const tab = store.active;
    const tabBlocked = !!(tab && isBlockedUrl(tab.url, hosts));
    if (contextBlocked || opts.note) toast(BLOCK_NOTE);
    const clipRead = !shot && !opts.shot && !contextBlocked && !tabBlocked && !opts.note ? clipCandidate() : Promise.resolve(null); // R7a
    if (!overReader && opts.capture && !contextBlocked && !tabBlocked && tab && !tab.asleep) {
      // 小窓の後ろに敷くページの画像（撮れなければ地の色だけ）。右クリックのメニューが消えてから撮る
      if (opts.afterMenu) await new Promise((r) => window.setTimeout(r, 180));
      const reply = await request((requestId) => ({ type: 'captureFull', requestId, id: tab.id }), 2500);
      if (reply?.type === 'capture' && reply.ok && reply.image) image = reply.image;
    }
    const selection = cutChars(String(safeContext.selection ?? '').trim(), ASK_SELECTION_MAX).text;
    const candidate = await clipRead;
    const docked = bots.docked();
    const to = rightBot && docked.includes(rightBot) ? rightBot : docked[0];
    askPending = {
      kind: 'botAsk',
      bots: botBriefs(),
      dock: docked,
      nest: bots.nest(),
      confirmed: prefs.botAppConfirmed,
      ...(to ? { to } : {}),
      context: { ...(safeContext.url ? { url: safeContext.url } : {}), ...(safeContext.title ? { title: safeContext.title } : {}), ...(selection ? { selection } : {}) },
      ...(image ? { image } : {}),
      over: overReader ? 'reader' : 'page',
      ...(contextBlocked || opts.note ? { note: opts.note || BLOCK_NOTE } : {}),
      ...(shot
        ? { shot: { image: shot.image, comment: cutChars(String(shot.comment ?? '').trim(), ASK_SELECTION_MAX).text } }
        : requestText
          ? { text: cutChars(requestText, ASK_SELECTION_MAX).text }
          : {}),
      ...(candidate ? { candidate: { image: candidate } } : {}), // クリップボードの画像の候補（R7a。印は小窓で外した状態）
      ...(botPresets.ready ? { presets: botPresets.view() } : {}), // 定型（R4a）。入口は撮る画面からなら shot（渡し止めで画像を外しても）
      entry: opts.shot ? 'shot' : opts.memo ? 'memo' : 'page',
      ...lastRequestPayload(), // 前回送った依頼の選び方（R6）。same：Ctrl+Shift+G を素早く 2 回（開いたらすぐ当てる）
      ...(opts.same ? { same: true } : {}),
      ...(botInbox.ready ? { replies: recentReplies(botInbox.requestList()) } : {}), // 「続きとして」の選び口（R5。文は入れない）
      hook: hookHas, // webhook「そのまま送る」を押せるか（R11。「ある／ない」だけ）
    };
    // 読む画面を出す（出ていても送る：キーボードの入力先が小窓に移る）
    send({ type: 'setSidebar', side: 'reader', visible: true, ...(overReader ? {} : { split: false }) });
    if (readerReady) {
      send({ type: 'relay', to: 'reader', payload: askPending });
      askPending = null;
    }
  }

  // ---------- 右のメモ（右サイドバーの「メモ」の区画）：右で見ているシートのメモのセルの写しを送る ----------
  let rightSheet = RIGHT_MEMO_SHEET; // 右の「メモ」の区画で見ているシート（右が知らせる）
  function rightMemosPayload(): RelayPayload {
    const sheet = sheets.get(rightSheet);
    const counts: Record<string, number> = {};
    for (const m of memos.list()) if (!isSpecialCell(m)) counts[m.sheet] = (counts[m.sheet] ?? 0) + 1; // 入口・ボットのセルは数えない
    return { kind: 'rightMemos', sheetId: rightSheet, sheet: sheet ? { id: sheet.id, name: sheet.name } : null, memos: memos.inSheet(rightSheet).map(toRightMemo), counts };
  }
  //   左の UI だけが読み込み直されたとき（rightReady が戻らない）でも送れるように、右が見えていれば送る
  const relayRightMemos = debounce(() => {
    if (!sidebars.right.visible || !memos.ready) return;
    send({ type: 'relay', to: 'right', payload: rightMemosPayload() });
  }, 120);
  memos.onChange(relayRightMemos);
  sheets.onChange(relayRightMemos);
  // ---------- 右下の Grok Bot（右サイドバーの相棒の並びの下。6体まで）：ボットの台帳の写しを送る ----------
  //   名前とエージェントの id・役・右下の並び・巣の設定・アプリの有無・はじめての確かめを済ませたか（URL・キーは送らない。持っていない）
  //   台帳を変えるのは、右から頼まれたときも左だけ（runCommand の dockBot・setBotRole・setNest など）
  const botBriefs = () => bots.list().map((b) => ({ id: b.id, name: b.name, ...(b.agentId ? { agentId: b.agentId } : {}), ...(b.role ? { role: b.role } : {}) }));
  // 前回送った依頼の選び方の写し（R6。bots と botAsk に入れる。まだ無ければ何も入れない）
  function lastRequestPayload() {
    const last = botLastRequest.get();
    return last ? { lastRequest: last } : {};
  }
  function botsPayload(): RelayPayload {
    const requests = botInbox.ready ? botInbox.requestList() : undefined;
    return {
      kind: 'bots',
      bots: botBriefs(),
      dock: bots.docked(),
      nest: bots.nest(), // 巣の設定（台帳に無ければ既定）
      ...(botTeams.ready ? { teams: botTeams.teams() } : {}), // グループの割り当て（groups.json を読み終えてから）
      // 定型の組・手元・棚（presets.json を読み終えてから。R4a）。R4b から蔵も（巣の ⚙ の棚）。印の数は今ある依頼の印（tally）を足して
      ...(botPresets.ready ? { presets: botPresets.view({ vault: true, tally: requests?.tally?.presets }) } : {}),
      ...lastRequestPayload(), // 前回送った依頼の選び方（R6。文は入れない）
      appMissing: botAppMissing,
      confirmed: prefs.botAppConfirmed,
      ready: bots.ready,
      states: botInbox.ready ? botInbox.briefs() : [], // 盤面の全部のボットの状態と札の数（本文は入れない）
      inbox: botInbox.inbox, // 受け取り口の様子（owner が false なら「別の窓で使っています」）
      ...(requests ? { requests } : {}), // 受け取り箱の一覧（S3.8。check・頼む文は入れない）
      ...pasteAskPayload(), // 「貼りましたか？」の札（R8。1 枚だけ。預かった中身は入れない）
      ...(botInbox.ready ? { away: awayPayload() } : {}), // 「まず 1 枚」の表（R9。返事の一言だけ。本文は入れない）
      hook: hookHas, // webhook の宛先と鍵があるか（R11。「ある／ない」だけ）
    };
  }

  // 「まず 1 枚」の表（R9・D19）：前の「読んだ」（左が返事を最後に「読んだ」にした時刻。localStorage）より後に届いた、まだ読んでいない返事。
  //   前の「読んだ」は、この窓が動き出したときの値のまま使う（読んだり片づけたりすると行が減るだけ。不在票の数と表の数をそろえる）。
  //   返事の一言は記録から読み直して覚える（右の写しは、見ているボットの 4,000 字だけなので）。灰色の返事の数は記録から数える
  const READ_AT_KEY = 'honeycomb.botReadAt';
  const awaySince = (() => {
    try {
      const n = Number(localStorage.getItem(READ_AT_KEY));
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  })();
  const awayLines = new Map<string, string>(); // fileId → 返事の一言（窓が開いている間だけ）
  const awayLoading = new Set<string>();
  let awayGrey: { count: number; botId?: string } = { count: 0 };
  let awayGreyAsked = false;
  function noteBotRead() {
    try {
      localStorage.setItem(READ_AT_KEY, String(Date.now()));
    } catch {
      // 覚えられなくても、次に開いたときの表が「まだ読んでいない返事の全部」になるだけ
    }
  }
  function awayPayload(): BotAwayView {
    const { rows, total } = botInbox.away(awaySince);
    const missing = rows.filter((r) => !awayLines.has(r.fileId) && !awayLoading.has(r.fileId));
    if (missing.length) void loadAwayLines(missing);
    if (!awayGreyAsked) {
      awayGreyAsked = true;
      void countAwayGrey();
    }
    return {
      ...(awaySince ? { since: awaySince } : {}),
      rows: rows.map((r) => (awayLines.has(r.fileId) ? { ...r, line: awayLines.get(r.fileId) } : r)),
      total,
      grey: awayGrey.count,
      ...(awayGrey.botId ? { greyBot: awayGrey.botId } : {}),
    };
  }
  // 返事の一言：reply は一行の答え（無ければ要約の 1 行・本文の頭）、error はわけ。渡し止めのアドレスは伏せる。記録に無ければ空
  async function loadAwayLines(rows: BotAwayRow[]) {
    for (const r of rows) awayLoading.add(r.fileId);
    for (const r of rows) {
      const m = (await botInbox.findMessage(r.botId, r.fileId))?.message;
      const raw = !m ? '' : m.type === 'error' ? cleanBotLine(m.error?.message || m.text || '') : botAnswerOneLine(m.text ?? '');
      awayLines.set(r.fileId, raw ? cutChars(await redactBlockedUrls(raw), 80).text : '');
      awayLoading.delete(r.fileId);
    }
    relayBots();
  }
  async function countAwayGrey() {
    awayGrey = await botInbox.greyAfter(awaySince);
    relayBots();
  }
  function pasteAskPayload() {
    const ask = pasteWatch.current();
    return ask ? { pasteAsk: ask } : {};
  }
  const relayBots = debounce(() => {
    if (!rightReady && !sidebars.right.visible) return;
    send({ type: 'relay', to: 'right', payload: botsPayload() });
  }, 60);
  bots.onChange(relayBots);
  botTeams.onChange(relayBots);
  botPresets.onChange(relayBots);
  botInbox.onPrunedMarks((requests) => botPresets.archiveMarks(requests)); // 片づいた依頼の印を定型の数に積む（R4b）
  botLastRequest.onChange(relayBots);
  void refreshHook(); // webhook の宛先と鍵があるか（R11。「ある／ない」だけ。写しを送れるようになってから読む）
  // 右のボットの欄で見ているボット（右が botSelect で知らせる）の、やり取りの写し（check は入れない）
  let rightBot: string | null = null;
  let botOpenPending: string | null = null; // 右サイドバーが動き出したら開いてもらうボット（カードの「やり取りを見る」）
  let islandAskPending: Extract<RelayPayload, { kind: 'islandAskPick' }> | null = null; // 右が動いたら出す「この島を頼む」
  let islandOffer: { islandId: string; ids: string[] } | null = null; // いま見せているメモ（これ以外の id は下書きに入れない）
  const relayBotThread = debounce(() => {
    if (!rightBot || (!rightReady && !sidebars.right.visible)) return;
    const botId = rightBot;
    void botInbox.thread(botId).then((thread) => {
      if (thread && rightBot === botId) send({ type: 'relay', to: 'right', payload: { kind: 'botThread', thread } });
    });
  }, 150);
  botInbox.onChange(() => {
    relayBots();
    relayBotThread();
    sidebar.requestRender(); // セルの顔（状態と札）
    preview.render();
  });
  // 頼んだ依頼への返事（check の合う、1通目の reply・error）が届いた：そのボットのセルを光らせ、相棒の吹き出しで知らせ（Q7）、
  //   Windows の知らせを送る（窓が前に出ていなければタスクバーが点滅する。決まった文だけ。返事の文・リンク・題は入れない）
  //   灰色の返事（check が合わない・知らない依頼・知らせ）と、待つのをやめたあとの返事では、どれもしない（欄に出すだけ）
  botInbox.onArrival((arrival) => {
    // 貼りましたか？を待っている依頼に、確かめの合う途中経過か返事が届いた：貼ったと分かったので、聞かずに預かりへ戻す（R8）
    if (arrival.botId && arrival.requestId && !arrival.grey && pasteWatch.watching(arrival.botId, arrival.requestId)) void settlePaste(arrival.botId, arrival.requestId, 'reached');
    countAbsent(arrival);
    if (arrival.grey && arrival.type !== 'progress' && botInbox.ready) void countAwayGrey(); // 「まず 1 枚」の預かりの行（R9）
    const bot = arrival.botId ? bots.get(arrival.botId) : undefined;
    if (!bot || !arrival.final || arrival.faint) return;
    for (const cell of cellsOfBot(bot.id)) sidebar.flashMemo(cell.id, 4000);
    tellRight(bot.id, `🤖 ボット「${bot.name}」から${arrival.type === 'error' ? 'エラーの返事' : '返事'}が届きました（右の「ボットの欄」で読めます）`, true);
    send({ type: 'notify', title: APP_TITLE, body: `${bot.name} から返事` });
  });
  // 返し先「六角メモにも届く」（依頼の小窓 v2・R10・D13）：確かめが通った 1 通目の返事（onReply。灰色・2 通目から・途中経過・エラーは来ない）を、
  //   その依頼が deliverTo: 'hex' で、まだ写していなければ六角メモに 1 マス写す（deliverReplyToHex）
  botInbox.onReply((reply) => void deliverReplyToHex(reply));
  bots.onChange(relayBotThread);
  // Grok Visions の写し（月の窓に映す・ボットの欄の「Vision」札。消すのは右から removeVision で頼まれたときも左だけ）
  const relayVisions = debounce(() => {
    if (!rightReady && !sidebars.right.visible) return;
    send({ type: 'relay', to: 'right', payload: { kind: 'visions', visions: [...visions.list()], bytes: visions.bytes, ready: visions.ready } });
  }, 100);
  visions.onChange(relayVisions);
  // 待っている依頼があれば、1分おきに写しを送り直す（「遅れている」に変わるのを、右とセルの顔に出す）
  window.setInterval(() => {
    if (!bots.list().some((b) => botInbox.activity(b.id).waiting > 0)) return;
    relayBots();
    relayBotThread();
    sidebar.requestRender();
  }, 60_000);
  // 定型の棚（R4b）：1 分おきに、寿命が切れた定型と棚で 30 日使わなかった定型を蔵へ（変えたときだけ書いて写しを送る）
  window.setInterval(() => botPresets.sweep(), 60_000);
  // 中継の見張り（R8・D18）：右が見えていれば 1 分おきに、C++ が最後に見回った時刻を聞く（見回りはさせない。写しの inbox.lastScanAt）
  window.setInterval(() => {
    noteBotSeen();
    if (!botInbox.ready || (!rightReady && !sidebars.right.visible) || !bots.list().length) return;
    void botInbox.refreshStatus(false);
  }, 60_000);

  // ---------- 送ったあと（R8・D17・D18）：貼りましたか？の答え・不在票・未送信の箱 ----------

  // 貼りましたか？の答え（yes・no）か、相手から届いた（reached）：預かりに戻し、pending.json の pasted に答えを残す
  async function settlePaste(botId: string, requestId: string, answer: 'yes' | 'no' | 'reached') {
    const outcome = await pasteWatch.restore(botId, requestId);
    if (!outcome) return;
    botInbox.markPasted(botId, requestId, answer === 'no' ? 'no' : 'yes');
    const no = botInbox.noOf(requestId); // 言い換えなら #0010-2（R9）
    if (answer === 'reached') {
      // 聞かずに済ませたとき：戻したことだけを短く（替わっていて触らなかったときは黙っておく）
      if (outcome === 'restored' || outcome === 'restoredImage') sayPaste(botId, `${no} が相手に届いたので、クリップボードを預かっておいた前の中身に戻しました${outcome === 'restoredImage' ? '（画像は長い辺 1600px までの写し）' : ''}`);
      return;
    }
    const head = answer === 'no' ? `${no}：この依頼は貼らずに、待つのをやめました。` : `${no}：貼った、と記録しました。`;
    sayPaste(botId, head + pasteRestoreText(outcome));
  }
  function pasteRestoreText(outcome: PasteRestore): string {
    switch (outcome) {
      case 'restored':
        return 'クリップボードを、預かっておいた前の中身に戻しました（預かりは捨てました）';
      case 'restoredImage':
        return 'クリップボードを、預かっておいた前の画像に戻しました（長い辺 1600px までの写しです。文字は戻していません）';
      case 'cleared':
        return '前の中身は戻せる形ではなかったので、クリップボードの依頼の文だけ消しました';
      case 'changed':
        return 'クリップボードはもう別の中身だったので、そのままにしました';
      default:
        return 'クリップボードに書けませんでした（前の中身には戻せませんでした）';
    }
  }
  // 貼りましたか？の結果の知らせ（右が見えていれば右、無ければ左）
  function sayPaste(botId: string, text: string) {
    if (rightReady || sidebars.right.visible) tellRight(botId, text);
    else toast(text, 6000);
  }

  // 不在票：ブラウザを閉じている間に届いた返事の数（ブラウザは本当に届いた時刻を知らないので、起動してから ABSENT_WINDOW_MS のあいだに
  //   受け取った、確かめの合う終わりの返事を数える。起動してすぐの見回りで、閉じている間に置き場へ溜まったものが届く）。少し待ってから右へ 1 枚
  const ABSENT_WINDOW_MS = 20_000;
  const LAST_SEEN_KEY = 'honeycomb.botLastSeen'; // 左が最後に動いていた時刻（「昨夜」などの言葉だけに使う）
  const bootAt = Date.now();
  const lastSeenAt = (() => {
    try {
      const n = Number(localStorage.getItem(LAST_SEEN_KEY));
      return Number.isFinite(n) && n > 0 && n < bootAt ? n : null;
    } catch {
      return null;
    }
  })();
  let absentCount = 0;
  let absentTimer = 0;
  let absentPending: string | null = null; // 右がまだ動いていないとき、動いたら出す不在票
  noteBotSeen();
  function noteBotSeen() {
    try {
      localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
    } catch {
      // 覚えられなくても、不在票の言葉が「閉じていた間に」になるだけ
    }
  }
  function countAbsent(arrival: BotArrival) {
    if (!arrival.final || arrival.faint || arrival.grey || !arrival.botId || Date.now() - bootAt > ABSENT_WINDOW_MS) return;
    if (arrival.requestId && botInbox.isPing(arrival.botId, arrival.requestId)) return; // 試し便は数えない（「まず 1 枚」の表と同じ。R9）
    absentCount += 1;
    window.clearTimeout(absentTimer);
    absentTimer = window.setTimeout(tellAbsent, 4000);
  }
  // 不在票の数は「まず 1 枚」の表（R9）とそろえる：表に並べた数（まだ読んでいない・前の「読んだ」より後）を必ず書く。
  //   閉じる前から読んでいなかった返事も表に入るので、届いた数より多ければ両方を書く。もう全部読んでいれば出さない
  function tellAbsent() {
    if (!absentCount) return;
    const came = absentCount;
    const listed = botInbox.ready ? botInbox.away(awaySince).total : came;
    absentCount = 0;
    if (!listed) return;
    const when = absentWhen(lastSeenAt, new Date());
    const text =
      listed === came
        ? `📮 不在票：${when} ${came} 通届きました（受け取り箱の「まず 1 枚」に並べました）`
        : `📮 不在票：${when} ${came} 通届きました。まだ読んでいない返事 ${listed} 通を、受け取り箱の「まず 1 枚」に並べました`;
    if (rightReady || sidebars.right.visible) send({ type: 'relay', to: 'right', payload: { kind: 'botNotice', botId: '', text, notice: 'absent' } });
    else {
      absentPending = text;
      toast(text, 7000);
    }
  }
  function absentWhen(since: number | null, now: Date): string {
    if (!since) return '閉じていた間に';
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const s = new Date(since);
    const days = Math.round((day(now) - day(s)) / 86_400_000);
    if (days <= 0) return '閉じていた間に';
    if (days === 1) return s.getHours() >= 17 ? '昨夜' : '昨日から';
    return `${days} 日前から`;
  }

  // 未送信の箱（D18）：コピーに失敗した依頼を、下書き（drafts.json）に「未送信」として残す（番号・check は付けない。直せない失敗は残さない）
  function keepUnsent(draft: DraftRequest, error: SendError) {
    if (error === 'badBot' || error === 'emptyText') return;
    const bot = bots.get(draft.botId);
    if (!bot || !String(draft.text ?? '').trim()) return;
    const seat = bots.docked().indexOf(bot.id) + 1;
    const why: Record<string, string> = {
      clipboard: 'クリップボードに書けませんでした（ほかのアプリが使っていたかもしれません）',
      save: 'やり取りの記録を保存できませんでした',
      notReady: '記録を読み込んでいるところでした',
      otherWindow: '返事は別の窓で受け取っています',
      tooLarge: '大きすぎました（256 KB まで）',
      badUrl: 'ページの URL が依頼に付けられませんでした',
    };
    void addSingleDraft({
      id: newDraftId(),
      createdAt: Date.now(),
      text: draft.text,
      botId: bot.id,
      botName: bot.name,
      ...(bot.role?.name ? { roleName: bot.role.name } : {}),
      ...(seat > 0 ? { seat } : {}),
      next: true,
      chatOnly: draft.chatOnly === true,
      attach: flagsOf({ url: draft.page?.url, title: draft.page?.title, selection: draft.page?.selection, body: draft.body }),
      req: draft,
      failed: true,
      why: why[error] ?? 'コピーできませんでした',
    });
  }

  // 盤面のボットのセルのカードの「やり取りを見る」：右サイドバーを開き、ボットの欄でこのボットを出してもらう
  function openBotThread(botId: string) {
    rightBot = botId;
    if (rightReady && sidebars.right.visible) send({ type: 'relay', to: 'right', payload: { kind: 'botOpen', botId } });
    else botOpenPending = botId;
    if (!sidebars.right.visible) send({ type: 'setSidebar', side: 'right', visible: true });
    relayBotThread();
  }
  // 右の「タグごとの一覧」：すべてのメモのセルの短い写し（中身が変わったときだけ。動かしただけなら送らない）
  let memoIndexSent = '';
  const relayMemoIndex = debounce(() => {
    if (!sidebars.right.visible || !memos.ready) return;
    const items = memos.list().filter((m) => !isSpecialCell(m)).map(toMemoIndexItem);
    const key = JSON.stringify(items);
    if (key === memoIndexSent) return;
    memoIndexSent = key;
    send({ type: 'relay', to: 'right', payload: { kind: 'memoIndex', memos: items } });
  }, 400);
  memos.onChange(relayMemoIndex);
  // 右の「検索」の区画：メモの台帳が変わった印（右が見えている間だけ。memoIndex と同じ間合いで送り、右で 1 回の検索にまとまるように）
  let memoRev = 0;
  const relayMemoRev = debounce(() => {
    if (!sidebars.right.visible || !memos.ready) return;
    memoRev += 1;
    send({ type: 'relay', to: 'right', payload: { kind: 'memoRev', rev: memoRev } });
  }, 400);
  memos.onChange(relayMemoRev);
  // 右サイドバーが開いた・読み込み直した：同じ中身でも、もう一度送る
  function resendMemoIndex() {
    memoIndexSent = '';
    relayMemoIndex();
  }

  // ---------- 右サイドバーへの連絡 ----------
  const relayState = debounce(() => {
    if (!sidebars.right.visible) return;
    send({
      type: 'relay',
      to: 'right',
      payload: {
        kind: 'state',
        tabs: store.snapshot(),
        activeId: store.activeId,
        placement: prefs.preview,
        sleep: prefs.sleep,
        reminders: reminders.list(),
        ...(reminders.loadFailed ? { remindersFailed: true } : {}),
        islands: islands.list(),
        highlightTag,
        highlightLike,
        sheets: sheets.list(),
        sheet: sheets.current,
        tagButtons: { name: tagButtons.current.name, tags: [...tagButtons.current.tags] },
      },
    });
  }, 60);
  function relayFocus() {
    if (sidebars.right.visible && prefs.preview === 'right') {
      send({ type: 'relay', to: 'right', payload: { kind: 'focus', id: preview.focusId } });
    }
  }
  store.onChange(relayState);
  reminders.onChange(relayState);
  // 鳴ったものの記録の写し（K3。右の「鳴ったもの」の列）
  const relayFired = debounce(() => {
    if (!sidebars.right.visible || !reminders.ready) return;
    send({ type: 'relay', to: 'right', payload: { kind: 'remindersFired', items: reminders.firedList(), ...(reminders.firedFailed ? { failed: true } : {}) } });
  }, 300);
  reminders.onChange(relayFired);
  islands.onChange(relayState);
  sheets.onChange(relayState);
  tagButtons.onChange(relayState);
  void reminders.start().then(() => noticeCardLedgers());
  // 順路の写し（段が増えるたびに送ると多いので、まとめて）
  const relayRoutes = debounce(() => {
    if (!sidebars.right.visible || !routes.ready) return;
    send({ type: 'relay', to: 'right', payload: { kind: 'routes', state: routes.snapshot(), shown: shownRouteId() } });
  }, 400);
  routes.onChange(relayRoutes);

  // ---------- 単語帳（台帳は左が持ち、右の「単語帳」パネルに写しを送る） ----------
  const vocab = new VocabStore();
  void vocab.load().then(() => noticeCardLedgers());
  // K0：読み直しても台帳を読めなかった（この起動では書かない。空で上書きしない）
  //   盤面の知らせは一つの欄を使い回すので、両方読めなかったら一つの文にまとめる（あとに読み終えた方の呼び出しで）
  function noticeCardLedgers() {
    const vocabFailed = vocab.loadFailed;
    const remindersFailed = reminders.loadFailed;
    if (!vocabFailed && !remindersFailed) return;
    toast(
      vocabFailed && remindersFailed
        ? '単語帳とリマインダーの台帳を読めませんでした。いま入れたカードと置いたリマインダーは保存されません。ブラウザを開き直してください'
        : vocabFailed
          ? '単語帳の台帳を読めませんでした。いま入れたカードは保存されません。ブラウザを開き直してください'
          : 'リマインダーの台帳を読めませんでした。いま置いたリマインダーは保存されません。ブラウザを開き直してください',
      15000,
    );
  }
  const relayVocab = debounce(() => {
    if (!sidebars.right.visible || !vocab.ready) return;
    send({ type: 'relay', to: 'right', payload: { kind: 'vocab', state: vocab.snapshot() } });
  }, 300);
  vocab.onChange(relayVocab);
  // 表示中のタブのページから作ったカード（K6。右の「このページ n 枚」の札）。変わったときだけ送る
  let lastHere = '';
  const relayHere = debounce(() => {
    if (!sidebars.right.visible || !vocab.ready) return;
    const tab = store.activeId === null ? undefined : store.get(store.activeId);
    const ids = tab ? cardsOnPage(vocab.snapshot().cards, tab.url).map((c) => c.id) : [];
    const key = ids.join(',');
    if (key === lastHere) return;
    lastHere = key;
    send({ type: 'relay', to: 'right', payload: { kind: 'vocabHere', ids } });
  }, 400);
  vocab.onChange(relayHere);
  // 復習の時期のカードがあれば、1日1回、相棒に知らせてもらう（右サイドバーを開いているときだけ。閉じていれば、次に開いたときに）
  const checkVocabDue = () => {
    if (!sidebars.right.visible || !rightReady) return;
    const count = vocab.takeDueNotice();
    if (count > 0) send({ type: 'relay', to: 'right', payload: { kind: 'vocabDue', count } });
  };
  window.setInterval(checkVocabDue, 60_000);

  // 入れる前の小さな確認。表・裏・言葉か問いを直してから、右の単語帳へ入れる
  function clipChars(text: string, max: number) {
    const chars = [...text.replace(/\s+/g, ' ').trim()];
    return chars.slice(0, max).join('');
  }
  function vocabPageSource(url: string, title: string) {
    if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) return undefined;
    return { url: clipChars(url, 500), title: clipChars(title, 200) };
  }
  function offerVocabCard(seed: { front: string; example: string; note: string; source?: { url: string; title: string }; link?: VocabLink; at?: { x: number; y: number } }) {
    cellMenu.confirmVocab(
      { kind: 'word', front: clipChars(seed.front, 400), back: '', example: clipChars(seed.example, 300), note: seed.note, rotate: savedMarkNew() },
      (value) => {
        const added = vocab.add([{ ...value, source: seed.source, link: seed.link }]);
        toast(added > 0 ? '単語帳に入れました。右の「単語帳」で見られます' : '同じカードがもうあります');
      },
      seed.at,
    );
  }
  function offerVocabFromMemo(id: string, at: { x: number; y: number }) {
    const memo = memos.get(id);
    if (!memo || isSpecialCell(memo)) return;
    const front = memoTitle(memo, 80) || '（空のメモ）';
    const body = memo.text.replace(/\s+/g, ' ').trim();
    offerVocabCard({
      front,
      example: body && body !== front ? body : '',
      note: '右の単語帳に入ります。カードの「セルへ」で、このメモへ戻れます',
      link: { kind: 'memo', id },
      at,
    });
  }
  // セルの右クリック「つながったカード」（K6。計画書 §5 の 28）：このセルを指す単語カードがあるときだけ出す
  function linkedCardEntries(cell: { kind: 'tab'; id: number; url: string } | { kind: 'memo'; id: string }, title: string): MenuEntry[] {
    if (!vocab.ready) return [];
    const ids = cardsLinkedTo(vocab.snapshot().cards, cell).map((c) => c.id);
    if (ids.length === 0) return [];
    return [
      { label: `つながったカード ${ids.length} 枚を見る`, hint: '右の単語帳', run: () => sendToRight({ kind: 'vocabFilter', ids, label: `セル：${clipChars(title, 24)}` }) },
      {
        label: 'このセルのカードを ⟳ に出す',
        hint: 'めぐる表示の印',
        run: () => {
          for (const cardId of ids) vocab.update(cardId, { rotate: true });
          toast(`${ids.length} 枚にめぐる表示の印を付けました`);
        },
      },
    ];
  }
  function offerVocabFromTab(id: number, at: { x: number; y: number }) {
    const tab = store.get(id);
    if (!tab) return;
    const title = tab.title || tab.url || 'タブ';
    const source = vocabPageSource(tab.url, tab.title);
    offerVocabCard({
      front: title,
      example: '',
      source,
      link: { kind: 'tab', id, url: tab.url },
      note: source
        ? `右の単語帳に入ります。カードから、ページ「${clipChars(title, 24)}」とこのセルへ戻れます`
        : '右の単語帳に入ります。カードの「セルへ」で、このセルへ戻れます',
      at,
    });
  }
  // 右クリックの直前に、ページが単語と前後の文を window.__honeycombVocab に残す
  const VOCAB_PICK_SCRIPT = `(() => { const picked = window.__honeycombVocab || {}; const sel = String(window.getSelection ? window.getSelection() : '').replace(/\\s+/g, ' ').trim(); return { front: String(sel || picked.front || '').slice(0, 400), example: String(picked.example || '').slice(0, 300) }; })()`;
  async function offerVocabFromPage(id: number, fallbackText: string, fallbackUrl: string) {
    const tab = store.get(id);
    let front = fallbackText;
    let example = '';
    const reply = await request((requestId) => ({ type: 'evalInTab', requestId, id, script: VOCAB_PICK_SCRIPT }), 2_000);
    if (reply?.type === 'evalResult' && reply.ok && reply.value && typeof reply.value === 'object') {
      const value = reply.value as { front?: unknown; example?: unknown };
      if (typeof value.front === 'string' && value.front.trim()) front = value.front;
      if (typeof value.example === 'string') example = value.example;
    }
    front = front.replace(/\s+/g, ' ').trim();
    if (!front) {
      toast('言葉を選ぶか、Alt+クリックで単語を選んでください');
      return;
    }
    const url = tab?.url || fallbackUrl;
    const title = tab?.title || '';
    const source = vocabPageSource(url, title);
    offerVocabCard({
      front,
      example,
      source,
      link: tab ? { kind: 'tab', id: tab.id, url: tab.url } : undefined,
      note: source
        ? `右の単語帳に入ります。カードから、ページ「${clipChars(title || url, 24)}」とこのセルへ戻れます`
        : '右の単語帳に入ります。カードの「セルへ」で、このセルへ戻れます',
    });
  }
  function offerVocabPick(id: number, front: string, example: string) {
    const tab = store.get(id);
    const word = front.replace(/\s+/g, ' ').trim();
    if (!word) {
      toast('言葉を選ぶか、Alt+クリックで単語を選んでください');
      return;
    }
    const title = tab?.title || '';
    const source = tab ? vocabPageSource(tab.url, tab.title) : undefined;
    offerVocabCard({
      front: word,
      example,
      source,
      link: tab ? { kind: 'tab', id: tab.id, url: tab.url } : undefined,
      note: source
        ? `右の単語帳に入ります。カードから、ページ「${clipChars(title || tab?.url || '', 24)}」とこのセルへ戻れます`
        : '右の単語帳に入ります。カードの「セルへ」で、このセルへ戻れます',
    });
  }

  let lastShown: string | null = null;
  store.onChange(() => {
    const shown = shownRouteId();
    if (shown !== lastShown) {
      lastShown = shown;
      relayRoutes();
    }
  });

  // ---------- 保存 ----------
  const saveSoon = debounce(() => saveSession(false), 400);
  const saveIfReady = () => {
    if (sessionReady) saveSoon();
  };
  store.onChange(saveIfReady);
  islands.onChange(saveIfReady);
  sheets.onChange(saveIfReady);
  boardLinks.onChange(saveIfReady);
  // 盤面の台帳の知らせ（読めなかったときの決めごと・保存できていないこと）
  const sessionNotice = new SessionNotice(board);
  const saveHealth = new SaveHealth();
  function startSessionSaving() {
    sessionWritable = true;
    sessionNotice.hideRecovery();
    saveSession(false);
    toast('盤面の保存を始めました');
  }
  function saveSession(final: boolean) {
    // 読めなかった台帳は、決めるまで書かない（data を付けない。閉じるときの final は C++ に届ける）
    send({ type: 'saveSession', data: sessionReady && sessionWritable ? toSession(store, islands.list(), memos.list().map((m) => m.island), sheets.list(), sheets.current, boardLinks.list()) : undefined, final });
  }

  // ---------- ダウンロードの棚と、最前面の小窓（段階10） ----------
  //   棚に出すのは id・名前・大きさ・時刻だけ。ファイルの場所は C++ が持つ。開くのは、人が押したときだけ
  const popoutButton = $<HTMLButtonElement>('popout');
  let popoutId: number | null = null; // 最初の 1 つ（上のボタン用）
  const popouts = new Map<number, { slot: number; top: boolean }>(); // P2：ライブの小窓に出しているタブ全部
  sleep.isPopped = (id) => popouts.has(id);
  let downloadsSeen = false;
  let downloadItems: { id: string; name: string; bytes: number; at: number }[] = [];
  // 試し：棚は盤面の下（盤面の外）に置き、欄を切り替える：ダウンロード・最近閉じた・撮ったもの・シート。▾ でたたむ
  //   盤面の外なので、セル・固定したポップアップ・知らせ（toast）には重ならない
  const shelf = el('div', 'download-shelf');
  const shelfTabs = el('div', 'shelf-tabs');
  const shelfItems = el('div', 'download-shelf-items');
  const shelfToggle = el('button', 'shelf-toggle');
  shelfToggle.type = 'button';
  shelf.append(shelfTabs, shelfItems, shelfToggle);
  board.after(shelf);
  const SHELF_VIEWS: { id: ShelfView; label: string }[] = [
    { id: 'downloads', label: 'ダウンロード' },
    { id: 'closed', label: '最近閉じた' },
    { id: 'captures', label: '撮ったもの' },
    { id: 'sheets', label: 'シート' },
  ];
  const SHELF_CAPTURES = 12; // 撮ったものは新しい 12 件まで（縮図は小さく出すだけ）
  const SHELF_SHEETS = 12;
  const closedTabs = new ClosedTabStore();
  void closedTabs.load();
  closedTabs.onChange(() => {
    if (prefs.shelfView === 'closed') renderShelf();
  });
  sheets.onChange(() => {
    if (prefs.shelfView === 'sheets') renderShelf();
  });
  shelfHooks.refresh = () => {
    if (prefs.shelfView === 'captures') renderShelf();
  };
  shelfToggle.addEventListener('click', () => {
    prefs.shelfOpen = !prefs.shelfOpen;
    savePrefsSoon();
    renderShelf();
  });

  function shelfEmpty(text: string) {
    return el('span', 'shelf-empty', text);
  }

  function renderShelf() {
    const open = prefs.shelfOpen;
    shelf.classList.toggle('collapsed', !open);
    shelfToggle.textContent = open ? '▾' : '▴';
    shelfToggle.title = open ? '棚をたたむ' : '棚を開く';
    shelfToggle.setAttribute('aria-label', shelfToggle.title);
    shelfTabs.replaceChildren(
      ...SHELF_VIEWS.map((view) => {
        const b = el('button', 'shelf-tab', view.label);
        b.type = 'button';
        const on = view.id === prefs.shelfView;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', () => {
          prefs.shelfView = view.id;
          prefs.shelfOpen = true;
          savePrefsSoon();
          renderShelf();
        });
        return b;
      }),
    );
    if (!open) {
      shelfItems.replaceChildren();
      return;
    }
    if (prefs.shelfView === 'downloads') shelfItems.replaceChildren(...downloadChips());
    else if (prefs.shelfView === 'closed') shelfItems.replaceChildren(...closedChips());
    else if (prefs.shelfView === 'captures') shelfItems.replaceChildren(...captureChips());
    else shelfItems.replaceChildren(...sheetChips());
    shelfItems.scrollLeft = 0;
  }

  function downloadChips(): HTMLElement[] {
    if (downloadItems.length === 0) return [shelfEmpty('ダウンロードしたファイルはまだありません')];
    return downloadItems.map((item) => {
      const chip = el('button', 'download-chip', item.name);
      chip.type = 'button';
      const size = formatBytes(item.bytes);
      chip.title = size ? `${item.name}（${size}）。右クリックでフォルダを開く・棚から外す` : `${item.name}。右クリックでフォルダを開く・棚から外す`;
      chip.addEventListener('click', () => send({ type: 'openDownload', id: item.id }));
      chip.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const id = item.id;
        cellMenu.open(event.clientX, event.clientY, [
          { label: '開く', run: () => send({ type: 'openDownload', id }) },
          { label: 'フォルダを開く', run: () => send({ type: 'revealDownload', id }) },
          { label: '棚から外す', hint: 'ファイルは残る', run: () => send({ type: 'forgetDownload', id }) },
        ]);
      });
      return chip;
    });
  }

  // 閉じたタブを開き直す：元のシートの元の場所（ふさがっていれば近くの空いた所）。シートが無ければ今のシート
  function reopenClosed(key?: string) {
    const item = closedTabs.take(key ?? closedTabs.list()[0]?.key ?? '');
    if (!item) {
      toast('最近閉じたタブはありません');
      return;
    }
    const sheet = sheets.get(item.sheet) ? item.sheet : sheets.current;
    requestTab(item.url, { sheet, pos: item.pos, title: item.title, favicon: item.favicon, parentId: null });
    toast(sheet === item.sheet ? `開き直しました: ${item.title || item.url}` : `開き直しました（元のシートが無いので、今のシートに）: ${item.title || item.url}`);
  }

  function closedChips(): HTMLElement[] {
    const items = closedTabs.list();
    if (items.length === 0) return [shelfEmpty('最近閉じたタブはありません（閉じると、ここから開き直せます。Ctrl+Shift+T）')];
    return items.map((item) => {
      const chip = el('button', 'download-chip shelf-closed');
      chip.type = 'button';
      if (item.favicon && /^https?:/i.test(item.favicon)) {
        const icon = el('img', 'shelf-icon');
        icon.src = item.favicon;
        icon.alt = '';
        icon.referrerPolicy = 'no-referrer';
        icon.addEventListener('error', () => icon.remove());
        chip.append(icon);
      }
      chip.append(document.createTextNode(item.title || item.url));
      const where = sheets.get(item.sheet)?.name;
      chip.title = `${item.title || item.url}\n${item.url}\n${new Date(item.at).toLocaleString()}${where ? `・シート「${where}」` : ''}\n押すと開き直す（元の場所へ）。右クリックで一覧から外す`;
      chip.addEventListener('click', () => reopenClosed(item.key));
      chip.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const key = item.key;
        cellMenu.open(event.clientX, event.clientY, [
          { label: '開く', run: () => reopenClosed(key) },
          { label: '一覧から外す', run: () => closedTabs.remove(key) },
          { label: 'すべて消す', run: () => closedTabs.clear() },
        ]);
      });
      return chip;
    });
  }

  function captureChips(): HTMLElement[] {
    const items = captureItems.slice(0, SHELF_CAPTURES);
    if (items.length === 0) return [shelfEmpty('撮ったものはまだありません')];
    return items.map((item) => {
      const chip = el('button', 'download-chip shelf-capture');
      chip.type = 'button';
      const thumb = captureThumb(item.id); // 無ければ読み込みを始める（読めたら描き直す）
      if (thumb) {
        const img = el('img', 'shelf-thumb');
        img.src = thumb;
        img.alt = '';
        img.loading = 'lazy';
        chip.append(img);
      } else {
        chip.append(el('span', 'shelf-thumb shelf-thumb-empty', '…'));
      }
      chip.append(document.createTextNode(new Date(item.createdAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })));
      chip.title = '押すと、右の「撮影」でこの件を開く';
      chip.addEventListener('click', () => revealCapture(item.id));
      return chip;
    });
  }

  function sheetChips(): HTMLElement[] {
    rememberSheetSlots();
    const ids: string[] = [];
    for (const id of sheetSlots.list) if (id && sheets.get(id) && !ids.includes(id)) ids.push(id);
    for (const sheet of sheets.recent()) if (!ids.includes(sheet.id)) ids.push(sheet.id);
    const list = ids.slice(0, SHELF_SHEETS).flatMap((id) => sheets.get(id) ?? []);
    if (list.length <= 1) return [shelfEmpty('ほかのシートはまだありません（左上のシートの名前から作れます）')];
    return list.map((sheet) => {
      const here = sheet.id === sheets.current;
      const chip = el('button', here ? 'download-chip shelf-sheet current' : 'download-chip shelf-sheet', here ? `● ${sheet.name}` : sheet.name);
      chip.type = 'button';
      chip.style.setProperty('--sheet', sheet.color);
      chip.title = here ? `シート「${sheet.name}」（いまのシート）` : `シート「${sheet.name}」へ移る`;
      chip.addEventListener('click', () => jumpToSheet(sheet.id));
      return chip;
    });
  }

  renderShelf();

  // P2：ライブの小窓（どのタブでも。4 つまで）。右クリックのメニューの項目
  function livePopoutEntries(id: number): MenuEntry[] {
    const popped = popouts.get(id);
    if (popped) {
      return [
        { label: '小窓（ライブ）をサイドバーへ戻す', run: () => send({ type: 'dockPopout', id }) },
        { label: popped.top ? '小窓の最前面をやめる' : '小窓を最前面に固定する', run: () => send({ type: 'popoutTop', id, top: !popped.top }) },
      ];
    }
    const full = popouts.size >= MAX_POPOUTS;
    return [{ label: '小窓で出す（ライブ）', hint: full ? `${MAX_POPOUTS} つまで` : '動いたまま', disabled: full, run: () => popOut(id) }];
  }

  function popOut(id: number) {
    send({ type: 'popout', id, places: prefs.popoutPlaces.map((p) => ({ ...p })) });
  }

  function canPopout(tab: Tab | undefined) {
    if (!tab) return false;
    return isVideoUrl(tab.url) || isMediaFileUrl(tab.url) || tab.audible;
  }

  function refreshPopoutButton() {
    const active = store.active;
    const popped = popoutId !== null && store.get(popoutId) !== undefined;
    popoutButton.hidden = !(popped || canPopout(active));
    const docking = popped && (!active || popouts.has(active.id) || !canPopout(active) || popouts.size >= MAX_POPOUTS);
    popoutButton.textContent = docking ? '小窓を戻す' : '小窓';
    popoutButton.title = docking
      ? '小窓を大きい窓に戻す'
      : '小窓にする（最前面）。YouTube や音声を前に置いたまま、ほかのタブを読めます';
  }

  function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function renderDownloads(items: { id: string; name: string; bytes: number; at: number }[]) {
    const previous = new Map(downloadItems.map((item) => [item.id, item.at]));
    const fresh = downloadsSeen
      ? items.filter((item) => {
          const before = previous.get(item.id);
          return before === undefined || before < item.at;
        })
      : [];
    downloadsSeen = true;
    downloadItems = items;
    if (prefs.shelfView === 'downloads') renderShelf();
    if (fresh.length === 1) toast(`保存しました: ${fresh[0].name}`);
    else if (fresh.length > 1) toast(`保存しました（${fresh.length} 件）`);
  }

  popoutButton.addEventListener('click', () => {
    const active = store.active;
    const popped = popoutId !== null && store.get(popoutId) !== undefined;
    if (popped && (!active || popouts.has(active.id) || !canPopout(active) || popouts.size >= MAX_POPOUTS)) {
      send({ type: 'dockPopout', id: active && popouts.has(active.id) ? active.id : popoutId! });
      return;
    }
    if (active && canPopout(active)) popOut(active.id);
  });

  // ---------- 今日のふりかえり（段階11。人がこのボタンを押したときだけ。本文は送らない） ----------
  const dailyButton = $<HTMLButtonElement>('daily');
  let dailyBusy = false;
  dailyButton.addEventListener('click', () => void writeDailyReview());
  async function writeDailyReview() {
    if (dailyBusy) return;
    const hosts = await ensureBlocklist();
    const material = collectDaily({
      day: dayLabel(),
      start: startOfLocalDay(),
      routes: routes.list(),
      tabs: store.all(),
      memos: memos.list(),
      cards: vocab.snapshot().cards,
      hosts,
    });
    if (!material) {
      toast('今日の材料がありません。今日開いたページ、今日見たハート、今日のメモ、今日の単語のどれかがあると書けます', 6000);
      return;
    }
    dailyBusy = true;
    dailyButton.disabled = true;
    dailyButton.textContent = '書いています…';
    try {
      const first = readAiSettings(null);
      const settings = { apiKey: first.practice ? null : await fetchApiKey(), practice: first.practice, model: first.model };
      const result = await writeDaily(material, settings);
      const sheet = sheets.current;
      const pos = placeCluster(allCells(sheet), 1, anchorOn(sheet))[0];
      const memo = pos ? memos.add({ sheet, pos, text: formatDaily(material, result), tags: ['ふりかえり'] }) : null;
      let lines = 0;
      for (const item of result.lines) {
        const tab = store.get(item.id);
        const line = cleanComment(item.line);
        if (!tab || tab.liked <= 0 || !line) continue;
        if (tab.notes.some((n) => n.id === 'sleep-line')) store.removeNote(tab.id, 'sleep-line');
        store.addNote(tab.id, { id: 'sleep-line', text: line, createdAt: Date.now(), source: 'ai', label: '一行' });
        if (!tab.comment) store.setFace(tab.id, { comment: line });
        lines += 1;
      }
      if (!memo) {
        toast('ノートを置けませんでした（メモが多すぎます）');
        return;
      }
      preview.showMemo(memo.id);
      const cost = result.cost > 0 ? `（約 $${result.cost.toFixed(3)}）` : first.practice ? '（練習）' : '';
      const heart = lines > 0 ? `ハート ${lines} 件に、休眠したあとでも読める一行を残しました。` : '';
      const near = result.near ? ` ${BUDGET_NEAR_NOTE}` : '';
      toast(`今日のふりかえりを、メモのセルに置きました。${heart}${cost}${near}`.trim(), 8000);
    } catch (error) {
      const friendly = describeError(error);
      const message = error instanceof BudgetError ? error.message : friendly !== 'うまくいきませんでした' ? friendly : error instanceof Error && error.message ? error.message : friendly;
      toast(message, 8000);
    } finally {
      dailyBusy = false;
      dailyButton.disabled = false;
      dailyButton.textContent = '今日';
    }
  }

  // ---------- C++ からのメッセージ ----------
  onMessage((msg) => {
    switch (msg.type) {
      case 'hello':
        handleHello(msg);
        break;
      case 'apiKey':
        for (const waiter of apiKeyWaiters.splice(0)) waiter(msg.key);
        break;
      case 'tabCreated': {
        const info = msg.requestId === null ? undefined : pending.get(msg.requestId);
        if (msg.requestId !== null) pending.delete(msg.requestId); // 場所の予約もここで外れる
        const trail = info?.trail; // 順路の台帳をまだ読み込んでいなくても持たせておく（無い順路なら、使うときに無視される）
        store.add(msg.id, {
          uid: info?.uid,
          url: msg.url,
          parentId: msg.parentId,
          // UI が頼んだタブは頼んだときのシート（消えていたら見ているシート）。ページのリンクから開いたタブは、開いた元のタブのシート
          sheet: info?.sheet && sheets.get(info.sheet) ? info.sheet : info ? sheets.current : undefined,
          pos: info?.pos,
          asleep: msg.asleep,
          title: info?.title,
          favicon: info?.favicon,
          keepAwake: info?.keepAwake,
          notes: info?.notes,
          readEdges: info?.readEdges,
          liked: info?.liked,
          tags: info?.tags,
          island: info?.island,
          trail,
          image: info?.image,
          comment: info?.comment,
          look: info?.look,
        });
        if (trail) recorder.expectStep(msg.id, trail);
        // ページのリンクから新しいタブで開いた（UI が頼んだタブではない・右クリックの「セルに追加」）→ 開いた元のタブの順路の「枝」
        const branchFrom = msg.requestId === null ? msg.parentId : (info?.branchFrom ?? null);
        if (branchFrom !== null && !trail) recorder.branch(msg.id, branchFrom, msg.url);
        if (info?.activate) {
          if (info.follow === false) quietActivation.add(msg.id);
          send({ type: 'activateTab', id: msg.id });
        }
        // 裏で開いたタブ：セルを光らせて知らせる（ほかのシートに足したときは、シートの名前も）
        if (msg.background) {
          sidebar.flash(msg.id);
          const added = store.get(msg.id);
          const where = added && added.sheet !== sheets.current ? `シート「${sheets.get(added.sheet)?.name ?? ''}」の` : '';
          toast(`${info?.addedLead ?? '新しいタブを、'}${where}セルに追加しました（ページはこのまま${where ? '。左上の ▾ から開けます' : ''}）`);
        }
        flushExternalUrls(); // 前回のタブを並べ終えたら、外から頼まれていたページを開く
        if (typeof msg.requestId === 'number') {
          const waiter = createdWaiters.get(msg.requestId);
          if (waiter) {
            createdWaiters.delete(msg.requestId);
            waiter(msg.id);
          }
        }
        break;
      }
      case 'tabUpdated': {
        const before = store.get(msg.id)?.url ?? '';
        store.update(msg.id, msg.patch);
        // 音声・動画のファイルのページには題名もアイコンも無い（前のページのものが残る）：ファイルの名前にする
        if (msg.patch.url !== undefined && msg.patch.newDocument !== false && (isMediaFileUrl(msg.patch.url) || isImageFileUrl(msg.patch.url))) {
          store.update(msg.id, { title: fileNameOf(msg.patch.url), favicon: '' });
        }
        if (msg.patch.url !== undefined) recorder.navigated(msg.id, msg.patch.url, before, msg.patch.newDocument !== false);
        if (msg.patch.url !== undefined && msg.id === store.activeId) {
          checkSiteTrigger(before, msg.patch.url); // K4：表示中のタブが別のホストから移った
          relayHere(); // K6：「このページ n 枚」
        }
        if (msg.patch.title !== undefined) recorder.titled(msg.id);
        if (msg.patch.loading === false) {
          const id = msg.id;
          setTimeout(() => capture(id), 1200);
        }
        if (msg.patch.url !== undefined || msg.patch.audible !== undefined) refreshPopoutButton();
        break;
      }
      case 'tabActivated': {
        preview.resetFocus();
        checkSiteTrigger(store.get(store.activeId ?? -1)?.url ?? '', store.get(msg.id)?.url ?? ''); // K4：そのホストのタブに切り替えた
        relayHere(); // K6：「このページ n 枚」（少し待ってから読むので、切り替えたあとのタブで数える）
        store.setActive(msg.id);
        // 盤面も、表示したタブのシートへ（閉じた後に自動で選んだタブ・前回の続きを開いたときは移らない）
        const quiet = quietActivation.has(msg.id);
        quietActivation.clear();
        const shown = store.get(msg.id);
        if (shown && !quiet && shown.sheet !== sheets.current && !memoEditor.isOpen && !faceEditor.isOpen) switchSheet(shown.sheet); // 欄を開いている間は移らない
        if (readAfterActivate === msg.id) {
          readAfterActivate = null;
          openReader(msg.id);
        } else if (msg.id !== readerTab) {
          closeReader(); // 別のタブに切り替えたら、読む画面を閉じる
        }
        refreshPopoutButton();
        break;
      }
      case 'tabClosed': {
        if (msg.id === readerTab) closeReader();
        thumbs.delete(msg.id);
        {
          // 試し：最近閉じたタブに残す（シートごと消して閉じたタブは残さない）
          const closing = store.get(msg.id);
          if (closing && !store.closing.has(closing.id)) {
            closedTabs.add({ url: closing.url, title: closing.title, favicon: closing.favicon, sheet: closing.sheet, pos: closing.pos });
            boardLinks.removeCells([tabRef(closing.uid)]); // ふつうに閉じた：そのタブの関連の線も外す（シートごと片付けたときは removeSheet が決める）
          }
        }
        const next = store.remove(msg.id);
        if (next !== null) {
          quietActivation.add(next); // 閉じた後に選んだタブは、ほかのシートにあっても盤面は移らない
          send({ type: 'activateTab', id: next });
        } else if (store.size === 0) {
          createTab();
        }
        break;
      }
      case 'tabThumbnail':
        void thumbs.add(msg.id, msg.image);
        break;
      case 'sidebars': {
        const rightWasVisible = sidebars.right.visible;
        sidebars = msg.state;
        applyView();
        relayState();
        relayRightMemos();
        relayBots();
        relayVisions();
        resendMemoIndex();
        // 右が閉じたまま読み込まれていたときは、単語帳と順路の写しがまだ届いていない。開いたときに送り直す
        if (!rightWasVisible && sidebars.right.visible) {
          relayRoutes();
          relayVocab();
          lastHere = ''; // K6：右が開き直したので「このページ n 枚」も送り直す
          relayHere();
          relayFired();
        }
        if (sidebars.right.visible && rightReady && botOpenPending) {
          send({ type: 'relay', to: 'right', payload: { kind: 'botOpen', botId: botOpenPending } });
          botOpenPending = null;
        }
        if (sidebars.right.visible && rightReady && islandAskPending) {
          send({ type: 'relay', to: 'right', payload: islandAskPending });
          islandAskPending = null;
        }
        relayBotThread();
        if (sidebars.right.visible && rightReady) {
          flushReminders(); // 閉じていた右サイドバーを、もう一度開いた
          relayReplyPending();
        } else if (sidebars.memo?.visible && memoReady) {
          relayReplyPending();
        }
        break;
      }
      case 'relayed':
        if (msg.payload.kind === 'requestState' && msg.from === 'reader') {
          // 読む画面が動き出した：読んでほしいタブ（か、撮った画像）を渡す
          readerReady = true;
          const tab = readerTab === null ? undefined : store.get(readerTab);
          if (cropPending) send({ type: 'relay', to: 'reader', payload: cropPending });
          else if (capturePending) send({ type: 'relay', to: 'reader', payload: capturePending });
          else if (shotPending) send({ type: 'relay', to: 'reader', payload: shotPayload(shotPending) });
          else if (askPending) send({ type: 'relay', to: 'reader', payload: askPending });
          else if (tab) send({ type: 'relay', to: 'reader', payload: { kind: 'readerOpen', tabId: tab.id, url: tab.url, title: tab.title } });
          askPending = null;
        } else if (msg.payload.kind === 'requestState') {
          // 右サイドバーが開いた：台帳の写しと、これまでに撮ったサムネイルを渡す
          relayState();
          relayFocus();
          relayRoutes();
          relayVocab();
          lastHere = ''; // K6：右が開き直したので「このページ n 枚」も送り直す
          relayHere();
          relayFired();
          window.setTimeout(checkVocabDue, 8_000);
          send({ type: 'relay', to: msg.from, payload: { kind: 'thumbnails', images: thumbs.entries() } });
          rightReady = true;
          relayRightMemos();
          relayBots();
          relayVisions();
          if (botInbox.ready) void botInbox.refreshStatus(false); // 中継の見張りの「最後 18:41」（R8）
          if (absentPending) {
            send({ type: 'relay', to: 'right', payload: { kind: 'botNotice', botId: '', text: absentPending, notice: 'absent' } }); // 不在票（R8）
            absentPending = null;
          }
          if (botOpenPending) {
            send({ type: 'relay', to: 'right', payload: { kind: 'botOpen', botId: botOpenPending } });
            botOpenPending = null;
          }
          if (islandAskPending) {
            send({ type: 'relay', to: 'right', payload: islandAskPending });
            islandAskPending = null;
          }
          relayBotThread();
          resendMemoIndex();
          flushReminders();
          relayReplyPending();
        } else if (msg.payload.kind === 'captureBoard') {
          applyCaptureBoard(msg.payload.items);
        } else if (msg.payload.kind === 'captureChanged') {
          // 隠す・取り消すが成功した（右のカードから隠したときも）。盤面の顔と、読む画面の写し（capturePending）を新しくする
          const { id, image, blur, undo } = msg.payload;
          if (isCaptureId(id) && image.startsWith('data:image/')) {
            captureThumbGen.set(id, (captureThumbGen.get(id) ?? 0) + 1); // 読み込み中の古い縮図で上書きしない
            captureThumbs.set(id, image);
            sidebar.requestRender();
            shelfHooks.refresh();
          }
          if (capturePending?.id === id) capturePending = { ...capturePending, image, blur, undo };
          // 取り消しの写しは右の店に 1 枠だけ。別の撮影を隠したら、開いている撮影の写しはもう取り消せない
          else if (capturePending && undo) capturePending = { ...capturePending, undo: false };
          // 読む画面へは、開いている撮影と id が違っても渡す（別の撮影を隠すと、開いている撮影は「隠すのを取り消す」で戻せなくなる）
          if (readerReady) send({ type: 'relay', to: 'reader', payload: msg.payload });
        } else if (msg.payload.kind === 'captureHideDone') {
          // 読む画面が頼んだ隠す・取り消すの返事。読む画面の seq と照らす
          if (readerReady) send({ type: 'relay', to: 'reader', payload: msg.payload });
        } else if (msg.payload.kind === 'command') {
          runCommand(msg.payload.action);
        }
        break;
      case 'shortcut':
        runShortcut(msg.action);
        break;
      case 'openUrl':
        openExternalUrl(msg.url);
        break;
      case 'botLinkBlocked':
        // ページのリンクから grokbot:// を開こうとしたので、C++ が止めた（S1.11）
        toast('ページのリンクからは Grok Bot アプリを開きません（止めました）。アプリは、盤面のボットのセルを押すと開きます', 6000);
        break;
      case 'linkMenu':
        // ページの右クリックのメニュー：リンクをセルに追加（ページはこのまま）・六角スクショを表紙にして追加
        //   askGrok（S3.11）：選んだ文の上の「🔍 Grok に調べてもらう」・Ctrl+Shift+G（text が空。選んだ文はページに聞く）
        if (msg.action === 'askGrok' && BOT_FEATURES) void askGrokFromPage(msg.id, msg.url, msg.text);
        else if (msg.action === 'vocabCard') void offerVocabFromPage(msg.id, msg.text, msg.url);
        else if (msg.action === 'memoQuote') void quoteIntoMemo(msg.id, msg.url, msg.text);
        else if (msg.action === 'captureCenter') captureCenterFromPage();
        else if (msg.action === 'captureWindow') captureScopeFromPage('window');
        else if (msg.action === 'captureDesktop') captureScopeFromPage('desktop');
        else if (msg.action === 'captureRegion') captureScopeFromPage('region');
        else if (msg.action === 'captureRecord') captureRecordFromPage();
        else if (msg.action === 'captureImage') captureImageFromPage(msg.id, msg.url);
        else if (msg.action === 'shotCover') void startShot(null, null, { url: msg.url, text: msg.text, from: msg.id });
        else openLinkInBackground(msg.url, msg.id, { title: msg.text });
        break;
      case 'vocabPick':
        offerVocabPick(msg.id, msg.front, msg.example);
        break;
      case 'downloads':
        renderDownloads(msg.items);
        break;
      case 'downloadResult':
        if (msg.note) toast(msg.note);
        else if (msg.error === 'missing') toast('ファイルが見つかりません');
        else if (msg.error === 'failed') toast('開けませんでした');
        else if (msg.error === 'mock') toast('練習用の画面では、ファイルは開けません');
        break;
      case 'popout': {
        const before = popouts.size;
        popouts.clear();
        for (const item of msg.list ?? (msg.id === null ? [] : [{ id: msg.id, slot: 0, top: true }])) popouts.set(item.id, { slot: item.slot, top: item.top });
        popoutId = msg.id;
        refreshPopoutButton();
        if (msg.error === 'full') toast(`ライブの小窓は ${MAX_POPOUTS} つまでです。どれかをサイドバーへ戻してください`);
        else if (msg.error === 'failed') toast('小窓を作れませんでした');
        else if (popouts.size > before) toast('小窓に出しました。窓のタイトルを右クリックすると、最前面の切り替え・サイドバーへ戻すができます');
        else if (popouts.size < before) toast('小窓をサイドバーへ戻しました');
        break;
      }
      case 'popoutPlace': {
        if (msg.slot < 0 || msg.slot >= MAX_POPOUTS) break;
        const places = prefs.popoutPlaces.slice();
        while (places.length <= msg.slot) places.push({ x: 0, y: 0, w: 0, h: 0, top: true });
        places[msg.slot] = { x: msg.x, y: msg.y, w: msg.w, h: msg.h, top: msg.top };
        prefs.popoutPlaces = places;
        savePrefsSoon();
        break;
      }
      case 'appFollowOverlap': {
        const sticking = pinnedAppId ? apps.get(pinnedAppId) : undefined;
        if (sticking && !overlapTold.has(sticking.id)) {
          overlapTold.add(sticking.id);
          toast(`「${sticking.name}」は大きさを変えられないので、サイドバーに重なることがあります`);
        }
        break;
      }
      case 'sessionSaved': {
        // 盤面を書けたか。変わり目だけ知らせ、書けない間は帯を残す
        const change = saveHealth.note(msg.ok);
        if (change === 'failed') sessionNotice.setSaveFailed(SAVE_FAILED_TEXT);
        if (change === 'recovered') {
          sessionNotice.setSaveFailed(null);
          toast('盤面の保存が戻りました');
        }
        break;
      }
      case 'appFollowEnded': {
        const ended = pinnedAppId ? apps.get(pinnedAppId) : undefined;
        pinnedAppId = null;
        pinnedMemoId = null;
        if (ended) {
          toast(
            msg.reason === 'denied'
              ? `「${ended.name}」を動かせなくなったので、追従をやめました`
              : `「${ended.name}」の窓が閉じたので、追従をやめました`,
          );
        }
        preview.render();
        break;
      }
      case 'appActive':
        // ほかのアプリへ移った・戻った（R8）：「貼りましたか？」は戻ってから数える
        pasteWatch.appActive(msg.active === true);
        break;
      case 'botHookSent':
        // webhook の答えが、待つのをやめた（16 秒）あとに届いた（R11）：受けたなら「受けた」に直す（コピーへ切り替えたあとなら何もしない）
        if (msg.ok && typeof msg.botRequestId === 'string' && RELAY_REQUEST_ID_RE.test(msg.botRequestId)) botInbox.markHook(null, msg.botRequestId, { ok: true });
        break;
      case 'flush':
        shuttingDown = true; // アーカイブ：閉じる途中は、新しいアーカイブと戻すを受けない
        noteBotSeen(); // 不在票の「昨夜」などの言葉に使う（R8）
        memos.flush(); // メモのセルを先に書く（セッションと食い違わないように）
        vocab.flush(); // 単語帳の書くのを待っている分（K0。0.5 秒待ちのあいだに閉じても失わない）
        bots.flush();
        apps.flush();
        botTeams.flush();
        botPresets.flush();
        saveSession(true);
        break;
    }
  });

  function handleHello(msg: Extract<HostMessage, { type: 'hello' }>) {
    sidebars = msg.sidebars;
    // 無い・読めないを分ける（session-guard.ts）。読めなかったら控えの盤面（あれば）を並べ、使う人が決めるまで書かない
    const start = decideSessionStart(msg);
    const saved = start.saved;
    sessionWritable = start.writable;
    if (start.recovery) {
      sessionNotice.showRecovery(sessionNoticeText(start.recovery), {
        accept: startSessionSaving,
        decline: () => sessionNotice.showHeld(startSessionSaving),
      });
    }
    islands.replaceAll(saved?.islands ?? []);
    boardLinks.replaceAll(saved?.boardLinks ?? []);
    // シートの台帳と、見ていたシート（タブを並べる前に）。盤面の位置もそのシートのもの
    sheets.replaceAll(saved?.sheets ?? [], saved?.sheet);
    sheets.ensure((saved?.tabs ?? []).map((t) => t.sheet ?? MAIN_SHEET)); // 台帳に無いシートのタブも、そのシートに戻す（仮の名前で）
    for (const id of Object.keys(prefs.boards)) if (!sheets.get(id) && !(saved?.tabs ?? []).some((t) => t.sheet === id)) delete prefs.boards[id];
    sidebar.sheetChanged(prefs.boards[sheets.current] ?? null);
    if (msg.tabs.length > 0) {
      // UI だけが読み込み直された：今あるタブに、保存しておいた位置と番号を当てはめる
      const savedById = new Map(saved?.tabs.map((t) => [t.id, t]) ?? []);
      const orderOf = (id: number) => savedById.get(id)?.order ?? Number.MAX_SAFE_INTEGER;
      for (const { id, ...info } of [...msg.tabs].sort((a, b) => orderOf(a.id) - orderOf(b.id))) {
        const s = savedById.get(id);
        store.add(id, {
          uid: s?.uid,
          url: info.url ?? '',
          parentId: null,
          sheet: s?.sheet ?? MAIN_SHEET,
          pos: s?.pos,
          asleep: info.asleep,
          title: s?.title,
          favicon: s?.favicon,
          keepAwake: s?.keepAwake,
          notes: s?.notes,
          readEdges: s?.readEdges,
          liked: s?.liked,
          tags: s?.tags,
          island: s?.island,
          trail: s?.trail,
          image: s?.image,
          comment: s?.comment,
          look: s?.look,
        });
        store.update(id, info);
      }
      if (msg.activeId !== null) store.setActive(msg.activeId);
    } else if (saved && saved.tabs.length > 0) {
      // 前回のタブを、眠った状態で元の場所・番号に並べ直す。前回表示していたタブだけ起こす
      const activeId = saved.tabs.some((t) => t.id === saved.activeId) ? saved.activeId : saved.tabs[0].id;
      for (const t of saved.tabs) {
        requestTab(t.url, {
          uid: t.uid,
          sheet: t.sheet ?? MAIN_SHEET,
          pos: t.pos,
          lazy: true,
          parentId: null,
          title: t.title,
          favicon: t.favicon,
          keepAwake: t.keepAwake,
          notes: t.notes,
          readEdges: t.readEdges,
          liked: t.liked,
          tags: t.tags,
          island: t.island,
          trail: t.trail,
          image: t.image,
          comment: t.comment,
          look: t.look,
          activate: t.id === activeId,
          follow: false, // 盤面は、前回見ていたシートのまま
        });
      }
    } else {
      createTab();
    }
    sessionReady = true;
    syncLinkOpen(); // ページのリンクから開くタブを、いつも裏で開くか（C++ に伝える）
    // メモのセルが指しているのに台帳に無いシートを、仮のシートとして足す（保存の途中で終わったときなど）
    ensureSheets();
    if (prefs.rightSidebar !== sidebars.right.visible) setRightSidebar(prefs.rightSidebar);
    applyView();
    flushExternalUrls(); // UI だけが読み込み直されたとき（並べるタブの返事待ちが無いとき）は、ここで開く
    refreshPopoutButton();
  }

  // 引用元のタブが、表に出て読み終わるまで待つ。隠れたタブへ #:~:text= を開いても、Chromium は色を付けない
  type ShownResult = 'ready' | 'timeout' | 'gone' | 'replaced';
  let quoteJump = 0;
  let shownWaiter: {
    id: number;
    wasAsleep: boolean;
    sawLoading: boolean;
    timer: number;
    resolve: (result: ShownResult) => void;
  } | null = null;
  function finishShown(result: ShownResult) {
    const waiter = shownWaiter;
    if (!waiter) return;
    shownWaiter = null;
    window.clearTimeout(waiter.timer);
    waiter.resolve(result);
  }
  function checkShown() {
    const waiter = shownWaiter;
    if (!waiter) return;
    const tab = store.get(waiter.id);
    if (!tab) {
      finishShown('gone');
      return;
    }
    if (tab.loading) waiter.sawLoading = true;
    const visible = store.activeId === waiter.id && !tab.loading && !tab.asleep;
    // 休眠や新しいタブは、読み込みが始まって終わるまで待つ（表に出しただけでは、まだ白いページのことがある）
    const woke = !waiter.wasAsleep || waiter.sawLoading;
    if (visible && woke) finishShown('ready');
  }
  store.onChange(checkShown);
  function waitUntilShown(id: number, timeoutMs: number, needLoad = false): Promise<ShownResult> {
    finishShown('replaced');
    const tab = store.get(id);
    if (!tab) return Promise.resolve('gone');
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => finishShown('timeout'), timeoutMs);
      shownWaiter = { id, wasAsleep: needLoad || tab.asleep, sawLoading: tab.loading, timer, resolve };
      checkShown();
    });
  }
  function waitCreated(requestId: number, timeoutMs: number): Promise<number | null> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        createdWaiters.delete(requestId);
        resolve(null);
      }, timeoutMs);
      createdWaiters.set(requestId, (id) => {
        window.clearTimeout(timer);
        resolve(id);
      });
    });
  }
  function tellMemo(text: string, extra?: { openMemo?: string; undoSend?: string }) {
    send({
      type: 'relay',
      to: 'memo',
      payload: {
        kind: 'memoPaneNotice',
        text,
        ...(extra?.openMemo ? { openMemo: extra.openMemo } : {}),
        ...(extra?.undoSend ? { undoSend: extra.undoSend } : {}),
      },
    });
  }
  // 今のタブの近くに、新しいメモを置く場所（新しいメモ・カードから作るメモ。置けなければ null）
  function spotForNewMemo(): { sheet: string; pos: Hex; source?: { url: string; title: string } } {
    const tab = store.active;
    const here = sheets.current;
    const onSheet = !!tab && tab.sheet === here;
    const sheet = onSheet && tab ? tab.sheet : here;
    const near = onSheet && tab ? tab.pos : sidebar.centerHex;
    const pos = placeCluster(allCells(sheet), 1, near)[0];
    if (!pos || isTaken(pos, sheet)) throw new Error('nospace');
    let source: { url: string; title: string } | undefined;
    if (tab) {
      try {
        const protocol = new URL(tab.url).protocol;
        if (protocol === 'http:' || protocol === 'https:') source = { url: tab.url, title: tab.title || '' };
      } catch {
        source = undefined;
      }
    }
    return { sheet, pos, ...(source ? { source } : {}) };
  }
  function sendRefusalText(done: Extract<SendRepliesResult, { ok: false }>): string {
    switch (done.why) {
      case 'ledger':
        return '送れませんでした（メモの台帳を読めていません）';
      case 'from':
        return 'このカードは送れませんでした（メモがもうありません）';
      case 'to':
        return '送り先のメモは使えません';
      case 'same':
        return '同じメモへは送れません';
      case 'place':
        return '新しいメモを置けませんでした（置く：空いた場所がない）';
      case 'full-memos':
        return '新しいメモを置けませんでした（置く：メモがいっぱい）';
      case 'empty':
        return '送るカードがありません';
      case 'missing':
        return 'そのカードは、もうありません';
      case 'full':
        return `送り先に入りきりません（あと ${done.room ?? 0} 件まで、送るのは ${done.need ?? 0} 件です）`;
      default:
        return '送れませんでした';
    }
  }
  // 右の「検索」の区画に短い知らせを出す（右が見えているときだけ）
  function tellSearch(text: string) {
    if (sidebars.right.visible) send({ type: 'relay', to: 'right', payload: { kind: 'searchNotice', text } });
  }

  // 引用元を開く。同じページのタブがあれば、それを表に出してから引用の所を色づける。無ければ新しいタブ
  //   フラグメント付きの URL へ、隠れたまま・プログラムから移すと、タブは戻っても文が色づかない
  async function openQuote(url: string, fragmentUrl: string) {
    let page: URL;
    let dest: URL;
    try {
      page = new URL(url);
      dest = new URL(fragmentUrl);
    } catch {
      return;
    }
    if (page.protocol !== 'http:' && page.protocol !== 'https:') return;
    if (dest.protocol !== 'http:' && dest.protocol !== 'https:') return;
    if (!samePage(url, fragmentUrl)) return;
    const jump = ++quoteJump;
    const tell = (text: string) => {
      if (jump === quoteJump) tellMemo(text);
    };
    const script = quoteMarkScript(fragmentUrl);
    const existing = store.all().find((t) => samePage(t.url, url));
    let id: number | null;
    if (existing) {
      id = existing.id;
      if (store.activeId !== id) send({ type: 'activateTab', id });
    } else {
      id = await waitCreated(createTab(url), 12_000);
      if (jump !== quoteJump) return;
      if (id === null) {
        tell('上のページを開けませんでした');
        return;
      }
    }
    if (!script) return;
    const ready = await waitUntilShown(id, 12_000, !existing);
    if (jump !== quoteJump || ready === 'replaced') return;
    if (ready !== 'ready') {
      tell(ready === 'gone' ? '上のページを開けませんでした' : 'ページの読み込みが終わらないので、引用したところを色づけできませんでした');
      return;
    }
    // タブを表に出した直後は、ページの配置が済むまで少し待つ
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    if (jump !== quoteJump) return;
    const tab = store.get(id);
    if (!tab || tab.asleep || store.activeId !== id || !samePage(tab.url, url)) {
      tell('上のページを開けませんでした');
      return;
    }
    // 読み終わった後に文を描くページがあるので、見つからなければ少し待って2回まで探し直す
    for (let attempt = 0; ; attempt++) {
      const reply = await request((requestId) => ({ type: 'evalInTab', requestId, id, script }), 8_000);
      if (jump !== quoteJump) return;
      if (reply?.type !== 'evalResult') {
        tell('上のページからの返事が来ませんでした（色づけ：返事なし）');
        return;
      }
      if (!reply.ok) {
        tell(
          reply.error === 'noPage'
            ? '上のページを開けませんでした（色づけ：noPage）'
            : `上のページに、引用の場所を伝えられませんでした（色づけ：${reply.error ?? '理由なし'}）`,
        );
        return;
      }
      const value = (typeof reply.value === 'object' && reply.value !== null ? reply.value : {}) as { found?: unknown; painted?: unknown };
      if (value.found === true) {
        tell(value.painted === false ? '引用したところへ移りました（色づけ：ページの中では塗れず、ブラウザに任せた）' : '引用したところを色づけました');
        return;
      }
      if (attempt >= 2) {
        tell('このページの今の文には、引用したところを色づけできませんでした（色づけ：文が見つからない）');
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      if (jump !== quoteJump) return;
      const again = store.get(id);
      if (!again || store.activeId !== id || !samePage(again.url, url)) return;
    }
  }

  // メモのセルへ移る（単語カードの「セルへ」と同じ）。別のシートなら切り替え、印を付け、見える所まで動かし、少し光らせる
  //   移れなければ、下の区画やカードに出す短い理由。移れたら null
  function focusMemoOnBoard(id: string): string | null {
    const memo = memos.get(id);
    if (!memo || isSpecialCell(memo)) return 'そのメモのセルは、もうありません';
    if (!sheets.get(memo.sheet)) return 'そのシートは、もうありません';
    if (memo.sheet !== sheets.current && !switchSheet(memo.sheet)) return '書きかけの欄を閉じてから移ってください';
    sidebar.setSelection([], [memo.id]);
    sidebar.reveal(memo.pos);
    sidebar.flashMemo(memo.id);
    return null;
  }

  // 単語カードの「セルへ」：そのシートへ移り、セルに印を付けて見える所まで動かす。メモなら下の区画も開く
  function openVocabCell(link: VocabLink) {
    if (link.kind === 'memo') {
      const reason = focusMemoOnBoard(link.id);
      if (reason === 'そのメモのセルは、もうありません' || reason === 'そのシートは、もうありません') toast(reason);
      if (reason) return;
      preview.showMemo(link.id);
      memoPane.open(link.id);
      return;
    }
    const tab = findVocabTab(store.all(), link);
    if (!tab) {
      toast('そのタブのセルは、もうありません');
      return;
    }
    if (tab.sheet !== sheets.current && !switchSheet(tab.sheet)) return;
    sidebar.setSelection([tab.id], []);
    sidebar.reveal(tab.pos);
    if (store.activeId !== tab.id) send({ type: 'activateTab', id: tab.id });
  }

  // Grok Cards（段 2 以降で数を書き、段 3 で下の面へ写す。旗が空なら何もしない）
  const grokCards = attachGrokCards({
    memos,
    sheets,
    bots,
    memoPane,
    replies: () => {
      const dock = new Set(bots.docked());
      return botInbox.briefs().reduce((n, brief) => n + (dock.has(brief.id) ? brief.unread : 0), 0);
    },
    inbox: {
      ready: () => botInbox.ready,
      requests: () =>
        botInbox.requestList().items.map((item) => ({
          requestId: item.requestId,
          botId: item.botId,
          state: item.state,
          createdAt: item.createdAt,
          no: item.no,
          ...(item.group ? { group: item.group } : {}),
          ...(item.final ? { fileId: item.final.fileId } : {}),
        })),
      groups: () => botInbox.requestList().groups.map((group) => ({ group: group.group, states: group.seats.map((seat) => seat.state) })),
      replyText: async (botId, fileId) => {
        const found = await botInbox.findMessage(botId, fileId);
        return found?.message.text ?? null;
      },
    },
  });
  memos.onChange(() => grokCards.publish());
  bots.onChange(() => grokCards.publish());
  botInbox.onChange(() => grokCards.publish());

  // 右サイドバーからの頼みごと
  function runCommand(action: RelayCommand) {
    switch (action.command) {
      case 'setKeepAwake':
        tabActions.setKeepAwake(action.id, action.keepAwake);
        break;
      case 'setSleep':
        if (!isSleepSettings(action.settings)) return;
        prefs.sleep = action.settings;
        savePrefs(prefs);
        sleep.update(prefs.sleep);
        relayState();
        break;
      case 'addNote':
        store.addNote(action.tabId, action.note);
        break;
      case 'removeNote':
        store.removeNote(action.tabId, action.noteId);
        break;
      case 'setLiked':
        tabActions.setLiked(action.id, action.liked);
        break;
      case 'addUserNote':
        tabActions.addUserNote(action.tabId, action.text);
        break;
      case 'openUrl':
        // 後で読む用（background）は、眠ったまま置いておく。開くと読み込む
        if (/^https?:\/\//i.test(action.url) || /^file:\/\//i.test(action.url)) requestTab(action.url, { lazy: action.background });
        break;
      case 'addReminder':
        reminders.add(action.reminder);
        break;
      case 'cancelReminder':
        reminders.cancel(action.id);
        break;
      case 'doneReminder':
        reminders.done(action.id, action.fired === true);
        break;
      case 'setTags':
        store.setTags(action.id, action.tags);
        break;
      case 'addTags':
        store.addTags(action.changes);
        break;
      case 'createIslands':
        createIslands(action.islands);
        break;
      case 'removeIsland':
        removeIsland(action.id);
        break;
      case 'openIslandAsk':
        openIslandAsk(action.islandId, sidebar.memoSelection());
        break;
      case 'fillIslandAsk':
        void fillIslandAsk(action.islandId, action.memoIds);
        break;
      case 'leaveIsland':
        store.setIsland([action.id], null);
        break;
      case 'previewIslands':
        previewIslands(action.islands);
        break;
      case 'grokPatchText':
        // 下の区画で落としたファイルの文。ほかの入口と同じくバイトで数える（前は字数で、日本語なら 3 MB 相当まで通っていた）
        if (typeof action.text === 'string') {
          if (withinImportBytes(action.text)) openPatchText(action.text, 'drop');
          else toast(`ファイルが大きすぎます（${IMPORT_FILE_LABEL} まで）`);
        }
        break;
      case 'openAsIsland':
        openAsIsland(action.name, action.items);
        break;
      case 'openReader':
        openReader(action.id);
        break;
      case 'readerProgress':
        store.setReadEdges(action.id, action.edges);
        if (action.finished) tracker.announce(action.id);
        break;
      case 'askCompanion':
        void (async () => {
          if (await pageIsBlocked(action.url)) {
            toast(BLOCK_NOTE);
            return;
          }
          sendToRight({ kind: 'askCompanion', text: action.text, title: action.title, url: action.url });
        })();
        break;
      case 'setRouteRecording':
        routes.setRecording(action.recording);
        break;
      case 'showRoute':
        pinnedRoute = action.id;
        updateRouteView();
        relayRoutes();
        break;
      case 'updateRoute':
        routes.update(action.id, { name: action.name, color: action.color, saved: action.saved });
        break;
      case 'removeRoute':
        if (pinnedRoute === action.id) pinnedRoute = null;
        for (const t of store.all()) if (t.trail?.route === action.id) store.setTrail(t.id, null);
        routes.remove(action.id);
        break;
      case 'setRouteJournal':
        routes.setJournal(action.id, action.journal);
        break;
      case 'openRouteStep':
        openRouteStep(action.id, action.step, action.reuse);
        break;
      case 'layoutRoute':
        layoutRoute(action.id);
        break;
      case 'addCards':
        vocab.add(action.cards);
        break;
      case 'updateCard':
        {
          const { command: _command, id, ...patch } = action;
          vocab.update(id, patch); // 来た項目だけ直す（K5b で note・due・level・reviews・lapses も）
        }
        break;
      case 'removeCard':
        vocab.remove(action.id);
        break;
      case 'gradeCard':
        vocab.grade(action.id, action.grade);
        break;
      case 'markCardsSent':
        vocab.markSent(action.ids);
        break;
      case 'setVocabNotify':
        vocab.setNotify(action.notify);
        break;
      case 'linkCard':
        if (action.links) vocab.setLinks(action.id, action.links); // K6：並び全体
        else vocab.setLink(action.id, action.link);
        break;
      case 'openVocabCell':
        openVocabCell(action.link);
        break;
      case 'shotDone':
        void finishShot(action);
        break;
      case 'shotCancel':
        closeReader();
        break;
      case 'openCapture':
        if (action.image.startsWith('data:image/')) showCapture(action);
        break;
      case 'captureCardImage': {
        // 下の区画のカードの画像（I4）。カードと画像を確かめてから、右の撮影へ
        if (typeof action.id !== 'string' || typeof action.replyId !== 'string') break;
        const memo = memos.get(action.id);
        const reply = memo?.replies?.find((r) => r.id === action.replyId);
        if (!memo || !reply?.image) {
          tellMemo('そのカードの画像は、もうありません');
          break;
        }
        captureShotToRight(reply.image, 'memoCard', memoTitle(memo, 40) || memo.source?.title || '');
        break;
      }
      case 'captureMarks':
        if (capturePending?.id === action.id) capturePending = { ...capturePending, marks: action.marks };
        sendToRight({ kind: 'captureMarks', id: action.id, marks: action.marks });
        break;
      case 'captureStrokes':
        if (capturePending?.id === action.id) capturePending = { ...capturePending, strokes: action.strokes };
        sendToRight({ kind: 'captureStrokes', id: action.id, strokes: action.strokes });
        break;
      case 'captureHide':
        // 画像は送らない。右の店がファイルの画像に塗る。写し（capturePending）は、右から captureChanged が来たとき差し替える
        sendToRight({ kind: 'captureHide', id: action.id, rects: action.rects, mode: action.mode, seq: action.seq });
        break;
      case 'captureUnhide':
        sendToRight({ kind: 'captureUnhide', id: action.id, seq: action.seq });
        break;
      case 'captureClose':
        // 読む画面を閉じる：右には取り消しの写しを捨ててもらう（閉じているだけの右は、開かない）
        if (capturePending && (rightReady || sidebars.right.visible)) {
          send({ type: 'relay', to: 'right', payload: { kind: 'captureViewClosed', id: capturePending.id } });
        }
        capturePending = null;
        closeReader();
        break;
      case 'openCrop':
        if (action.image.startsWith('data:image/')) showCrop(action.image);
        break;
      case 'cropDone':
        if (action.image.startsWith('data:image/jpeg')) {
          cropPending = null;
          sendToRight({ kind: 'captureCropped', image: action.image });
        }
        closeReader();
        break;
      case 'cropCancel':
        closeReader();
        break;
      case 'addReply':
        // 相棒のキャラが書いた返信（考察を残す道具）は、書いたキャラの名前つき
        if (action.by) {
          if (!addReplyTo(action.ref, action.parent, action.text, action.by)) toast('返信を足せませんでした（返信先が消えたか、返信が多すぎます）');
        } else {
          threadActions.add(action.ref, action.parent, action.text);
        }
        break;
      case 'addMemoCell': {
        // 相棒の考察（道具）は、表示中のタブの近くの空いたセルに（表示中のタブのシートに）
        //   レターなど、使う人が「盤面に置く」を押したもの（label あり）は、今見ているシートに
        const sheet = action.label ? sheets.current : (store.active?.sheet ?? sheets.current);
        const kind = action.label ?? '考察';
        const pos = placeCluster(allCells(sheet), 1, anchorOn(sheet))[0];
        // 「ボットから届いた返事」の印（who 'bot'）は、ボットの欄の botToMemo だけが付ける
        const by = action.by && action.by.who !== 'bot' ? action.by : undefined;
        const memo = pos ? memos.add({ sheet, pos, text: action.text, by, label: action.label }) : null;
        if (memo) {
          preview.showMemo(memo.id);
          toast(sheet === sheets.current ? `相棒の${kind}を、メモのセルに置きました` : `相棒の${kind}を、シート「${sheets.get(sheet)?.name ?? ''}」のメモのセルに置きました（表示中のタブのシート。左上の ▾ から開けます）`);
        } else {
          toast('メモのセルを置けませんでした（メモが多すぎます）');
        }
        break;
      }
      case 'addRightMemo': {
        // 右の「メモ」の区画で書いたコメント：右で見ているシート（無ければ作る）に置く。
        //   場所を選んで書いたとき（空いたセルをダブルクリック）はそこに、ふだんは真ん中から外へ、空いている所に
        const text = action.text.trim();
        if (!text) break;
        const sheet = isSheetId(action.sheet) ? action.sheet : RIGHT_MEMO_SHEET;
        sheets.ensure([sheet]);
        if (!sheets.get(sheet)) {
          toast('シートが多すぎて、右のメモのシートを作れません（100 枚まで）。使わないシートを消してから、もう一度書いてください');
          break;
        }
        const want = isHex(action.pos) ? action.pos : { q: 0, r: 0 };
        const pos = nearestFree(want, (h) => isTaken(h, sheet));
        if (!memos.add({ sheet, pos, text })) toast('メモを書けませんでした（メモのセルが多すぎます）');
        break;
      }
      case 'addRightSheet':
        // 右の「メモ」の区画の ＋・セットに保存：新しいシートを作る（id は右が決めたもの）
        if (!isSheetId(action.id) || sheets.get(action.id)) break;
        sheets.ensure([action.id], action.name);
        if (!sheets.get(action.id)) toast('シートが多すぎて作れません（100 枚まで）。使わないシートを消してから、もう一度足してください');
        break;
      case 'dropEmptySheet': {
        // 右で作ったシートが、何も書かずにタブから外れた：本当に空なら片づける（メイン・右のメモ・今見ているシート・入口のあるシートは残す）
        const id = action.id;
        const empty =
          isSheetId(id) &&
          id !== MAIN_SHEET &&
          id !== RIGHT_MEMO_SHEET &&
          id !== CAPTURE_SHEET &&
          id !== sheets.current &&
          !!sheets.get(id) &&
          memos.inSheet(id).length === 0 &&
          store.inSheet(id).length === 0 &&
          !memos.list().some((m) => m.portal === id);
        if (empty) sheets.remove(id);
        break;
      }
      case 'showRightSheet':
        // 右の「メモ」の区画で見るシートが変わった：そのシートの写しを送る
        if (isSheetId(action.id)) rightSheet = action.id;
        relayRightMemos();
        break;
      case 'moveRightMemo': {
        // 右の「メモ」の区画でセルを動かした：左の盤面と同じ決まり（入口に落とせばそのシートへ、ほかのセルとは場所を入れ替える）
        const memo = memos.get(action.id);
        if (!memo || (action.sheet !== undefined && memo.sheet !== action.sheet) || !isHex(action.pos)) break;
        const sheet = memo.sheet;
        const pos = { q: action.pos.q, r: action.pos.r };
        const from = memo.pos;
        if (hexKey(from) === hexKey(pos)) break;
        const other = memos.at(pos, sheet);
        if (other?.portal && other.id !== memo.id && !memo.portal) {
          dropOnPortal({ memo: memo.id }, other.id);
          break;
        }
        const tab = store.tabAt(pos, sheet);
        if (other && other.id !== memo.id) memos.move(other.id, from);
        memos.move(memo.id, pos);
        if (tab) store.moveTo(tab.id, from);
        break;
      }
      case 'removeMemo':
        if (memos.get(action.id)) removeMemos([action.id]);
        break;
      case 'memoPaneReady':
        memoPane.ready();
        memoReady = true;
        memoPaneDraft = false; // 下の面が読み込み直された＝書きかけは無い
        relayReplyPending();
        grokCards.onMemoReady();
        break;
      case 'openGrokCards':
        grokCards.open();
        break;
      case 'closeGrokCards':
        grokCards.close();
        break;
      case 'addGrokCard':
        grokCards.add(action.address, action.text);
        break;
      case 'setGrokCardText':
        grokCards.setText(action.id, action.text);
        break;
      case 'openNestForm':
        grokCards.form(action.address);
        break;
      case 'copyGrokCard':
        grokCards.copy(action.id);
        break;
      case 'openGrokCardApp':
        grokCards.openApp(action.id);
        break;
      case 'markGrokCardSent':
        grokCards.markSent(action.id, action.sent);
        break;
      case 'markGrokCardPasted':
        grokCards.markPasted(action.id);
        break;
      case 'clearGrokCardSent':
        grokCards.clearSent(action.id);
        break;
      case 'removeGrokCard':
        grokCards.remove(action.id);
        break;
      case 'showGrokReply':
        void grokCards.showReply(action.id);
        break;
      case 'memoPaneDraft':
        memoPaneDraft = action.busy === true;
        break;
      case 'addMemoComment': {
        if (typeof action.text !== 'string') break;
        const memo = memos.get(action.id);
        if (!memo || isSpecialCell(memo)) break;
        if (!memos.addReply(action.id, null, action.text, undefined, { quote: action.quote, image: action.image, file: action.file })) {
          toast('コメントを足せませんでした（返信が多すぎます）');
        }
        break;
      }
      case 'changeReplyTags': {
        // 下の区画のカードのタグ（依頼②）。足し引きの差分で受け、その時のタグに当てる
        if (typeof action.id !== 'string' || typeof action.replyId !== 'string') break;
        const add = Array.isArray(action.add) ? action.add : [];
        const remove = Array.isArray(action.remove) ? action.remove : [];
        const done = memos.changeReplyTags(action.id, action.replyId, add, remove);
        if (done.result === 'refused') tellMemo('このカードのタグは変えられませんでした（メモの台帳を読めていないか、カードがもうありません）');
        else if (done.over) tellMemo(`タグは1つに ${MAX_TAGS_PER_TAB} 個までです（ほかのタグを外してから付けてください）`);
        break;
      }
      case 'changeReplyLinks': {
        // 下の区画のカードの関連（plan-memo-card-links の L1）。足し引きの差分で受け、その時の関連に当てる
        if (typeof action.id !== 'string' || typeof action.replyId !== 'string') break;
        const add = Array.isArray(action.add) ? action.add : [];
        const remove = Array.isArray(action.remove) ? action.remove : [];
        const done = memos.changeReplyLinks(action.id, action.replyId, add, remove);
        if (done.result === 'refused') tellMemo('このカードの関連は変えられませんでした（メモの台帳を読めていないか、カードがもうありません）');
        else if (done.over) tellMemo(`関連は 1 枚のカードから ${MAX_LINKS_PER_CARD} 本までです（ほかの関連を外してから付けてください）`);
        else if (done.refusedLinks > 0) tellMemo('その相手とは結べませんでした（相手のカードがもう無いか、もう「同じ」でつながっています）');
        break;
      }
      case 'moveReply':
      case 'placeReply':
      case 'packReplies':
      case 'resetReplyOrder': {
        // 下の区画のカードの並べ替え（plan-memo-card-order の O1）。断った・変わらなかったときも、知らせのあとに写しを送り直す
        //   （写しが来ないと、下の区画の待ちの並びが戻らない）
        if (typeof action.id !== 'string') break;
        const bad =
          (action.command === 'moveReply' && (typeof action.replyId !== 'string' || (action.before !== null && typeof action.before !== 'string'))) ||
          (action.command === 'placeReply' && (typeof action.replyId !== 'string' || typeof action.slot !== 'number' || !Number.isInteger(action.slot)));
        const done: { result: 'changed' | 'same' | 'refused'; why?: 'ledger' | 'card' } = bad
          ? { result: 'refused', why: 'card' }
          : action.command === 'moveReply'
            ? memos.moveReply(action.id, action.replyId, action.before)
            : action.command === 'placeReply'
              ? memos.placeReply(action.id, action.replyId, action.slot)
              : action.command === 'packReplies'
                ? memos.packReplies(action.id)
                : memos.resetReplyOrder(action.id);
        if (done.result === 'refused')
          tellMemo(
            done.why === 'ledger'
              ? '並べ替えられませんでした（台帳を読めていません）'
              : action.command === 'placeReply'
                ? 'そこには置けませんでした（ほかのカードがあるか、カードが見つかりません）'
                : '並べ替えられませんでした（相手のカードが見つかりません）',
          );
        if (done.result !== 'changed') memoPane.resend();
        break;
      }
      case 'editReply':
        threadActions.edit(action.ref, action.replyId, action.text);
        break;
      case 'setMemoLinkNames':
        if (typeof action.id === 'string' && !memos.setLinkNames(action.id, action.names)) tellMemo('このメモの関連の名前は変えられませんでした');
        break;
      case 'setMemoLinkSet':
        if (typeof action.id === 'string' && (action.setId === null || typeof action.setId === 'string') && !memos.setLinkSet(action.id, action.setId))
          tellMemo('このメモの呼称セットは変えられませんでした');
        break;
      case 'clearMemoLinkSet':
        if (typeof action.setId === 'string') memos.clearLinkSet(action.setId);
        break;
      case 'setMemoLiked': {
        const memo = memos.get(action.id);
        if (!memo || isSpecialCell(memo) || typeof action.liked !== 'number') break;
        memos.update(action.id, { liked: action.liked });
        break;
      }
      case 'openQuote':
        if (typeof action.url === 'string' && typeof action.fragmentUrl === 'string') openQuote(action.url, action.fragmentUrl);
        break;
      case 'memoPaneClose':
        memoPane.close();
        break;
      case 'focusMemoPaneCell': {
        const reason = typeof action.id === 'string' ? focusMemoOnBoard(action.id) : 'そのメモのセルは、もうありません';
        if (reason) tellMemo(reason);
        break;
      }
      case 'openMemoPane': {
        const fromSearch = action.from === 'search';
        const memo = typeof action.id === 'string' ? memos.get(action.id) : undefined;
        if (!memo || isSpecialCell(memo)) {
          tellMemo('そのメモは、もうありません（一覧：見つからない）');
          if (fromSearch) tellSearch('そのメモは、もうありません');
          break;
        }
        const asked = typeof action.replyId === 'string' ? action.replyId : undefined;
        const replyId = asked && (memo.replies ?? []).some((r) => r.id === asked) ? asked : undefined;
        // 右の検索から、別のメモを開こうとしていて、下に書きかけがあるときは、開かない
        if (fromSearch && memoPaneDraft && memoPane.openId !== null && memoPane.openId !== memo.id) {
          tellMemo('書きかけがあります。送るか消してから開いてください');
          tellSearch('下の区画に書きかけがあります。送るか消してから開いてください');
          break;
        }
        memoPane.open(memo.id, replyId);
        if (memo.sheet === sheets.current) sidebar.reveal(memo.pos);
        if (asked && !replyId) tellMemo('そのコメントは、もうありません（メモだけ開きました）');
        break;
      }
      case 'newMemoForPane': {
        try {
          const spot = spotForNewMemo();
          const placed = memos.add({ sheet: spot.sheet, pos: spot.pos, text: '', ...(spot.source ? { source: spot.source } : {}) });
          if (!placed) {
            tellMemo('新しいメモを置けませんでした（置く：メモがいっぱい）');
            break;
          }
          memoPane.open(placed.id);
          if (spot.sheet === sheets.current) {
            sidebar.reveal(placed.pos);
            sidebar.flashMemo(placed.id);
          }
          tellMemo('新しいメモを作りました');
        } catch (err) {
          tellMemo(err instanceof Error && err.message === 'nospace' ? '新しいメモを置けませんでした（置く：空いた場所がない）' : '新しいメモを置けませんでした（置く：途中で止まった）');
        }
        break;
      }
      case 'sendReplies': {
        if (typeof action.from !== 'string' || !Array.isArray(action.replyIds)) break;
        const mode = action.mode === 'move' || action.mode === 'copy' ? action.mode : null;
        if (!mode) break;
        const replyIds = action.replyIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64).slice(0, MAX_REPLIES);
        const toId = action.to === null ? null : typeof action.to === 'string' ? action.to : undefined;
        if (toId === undefined) break;
        let create: MemoDraft | undefined;
        if (toId === null) {
          try {
            const spot = spotForNewMemo();
            create = { sheet: spot.sheet, pos: spot.pos, text: '', ...(spot.source ? { source: spot.source } : {}) };
          } catch (err) {
            tellMemo(err instanceof Error && err.message === 'nospace' ? '新しいメモを置けませんでした（置く：空いた場所がない）' : '新しいメモを置けませんでした（置く：途中で止まった）');
            break;
          }
        }
        const done = memos.sendReplies({ fromId: action.from, replyIds, toId, mode, create });
        if (!done.ok) {
          tellMemo(sendRefusalText(done));
          break;
        }
        const dest = memos.get(done.toId);
        const title = done.created ? '新しいメモ' : dest ? memoTitle(dest) || '（空のメモ）' : 'メモ';
        const verb = mode === 'move' ? '移しました' : '写しました';
        const nameNote = done.kept > 0 ? '。関連の呼び名は送り先の呼称に従います' : '';
        tellMemo(`「${title}」へ ${done.tops} 枚を${verb}${nameNote}`, { openMemo: done.toId, undoSend: done.token });
        if (done.created && dest && dest.sheet === sheets.current) {
          sidebar.reveal(dest.pos);
          sidebar.flashMemo(dest.id);
        }
        break;
      }
      case 'undoSendReplies': {
        if (typeof action.token !== 'string') break;
        const undone = memos.undoSend(action.token);
        if (!undone.ok) tellMemo(undone.why === 'stale' ? '元に戻せませんでした（そのあとにメモが変わっています）' : '元に戻せませんでした');
        else tellMemo('送りを元に戻しました');
        break;
      }
      case 'setMemoText':
        memoPane.setText(action.id, action.text);
        break;
      case 'copyMemoCell':
        void copyMemoCell(action.text, action.by, action.label);
        break;
      case 'removeReply':
        threadActions.remove(action.ref, action.replyId);
        break;
      case 'copyComment':
        threadActions.copy(action.ref, action.replyId);
        break;
      case 'aiReply':
        threadActions.ai(action.ref, action.parent, action.who);
        break;
      case 'highlightTag':
        highlightTag = action.tag;
        highlightLike = null;
        sidebar.setHighlight(highlightTag, null);
        relayState();
        break;
      case 'highlightLike':
        highlightLike = likeLevel(action.level);
        highlightTag = null;
        sidebar.setHighlight(null, highlightLike);
        relayState();
        break;
      case 'changeTags': {
        // 右のカードのタグのボタン・右の「メモ」の区画のコメントのタグ
        const add = Array.isArray(action.add) ? action.add : [];
        const remove = Array.isArray(action.remove) ? action.remove : [];
        if (typeof action.tab === 'number') changeTabTags(action.tab, add, remove);
        else if (typeof action.memo === 'string') changeMemoTags(action.memo, add, remove);
        break;
      }
      case 'showMemo': {
        // 右の「タグごとの一覧」でメモを押した：そのシートへ移って、印を付け、拡大表示に出す
        const memo = memos.get(action.id);
        if (!memo || isSpecialCell(memo)) break;
        if (memo.sheet !== sheets.current && !switchSheet(memo.sheet)) break;
        sidebar.setSelection([], [memo.id]);
        sidebar.reveal(memo.pos);
        preview.showMemo(memo.id);
        break;
      }
      case 'searchMemos': {
        // 右の「検索」の区画（台帳は読むだけ。右が見えていなければ返さない）
        if (typeof action.seq !== 'number' || typeof action.query !== 'string' || !sidebars.right.visible) break;
        const sort = action.sort === 'created' ? 'created' : 'updated';
        const limit = typeof action.limit === 'number' && Number.isFinite(action.limit) ? action.limit : 30;
        const found = memos.ready ? searchMemos(memos.list(), { query: action.query.slice(0, 200), sort, limit }) : { items: [], total: 0 };
        send({ type: 'relay', to: 'right', payload: { kind: 'searchResults', seq: action.seq, ready: memos.ready, items: found.items, total: found.total } });
        break;
      }
      case 'editTabFace':
        void editTabFace(action.id);
        break;
      // ---- 右下の Grok Bot（右は写しを見て頼むだけ。ここで確かめてから台帳を変える。変えると写しを送り直す） ----
      case 'dockBot': {
        if (!bots.ready || !isBotId(action.botId)) break;
        const result = bots.dock(action.botId);
        if (result === 'full') toast(`右下に置ける Grok Bot は ${MAX_DOCK_BOTS} 体までです`);
        else if (result !== 'ok') relayBots(); // 右の写しを正しい形に戻す
        break;
      }
      case 'undockBot':
        if (!bots.undock(action.botId)) relayBots();
        break;
      case 'moveDockBot':
        if (!bots.moveDock(action.botId, action.to)) relayBots();
        break;
      case 'newDockBot': {
        // 新しいボットを台帳に入れて、右下に置く（同じエージェントの id のボットがいれば、新しく作らずにそれを置く）
        if (!bots.ready || !isAgentId(action.agentId)) break;
        if (bots.docked().length >= MAX_DOCK_BOTS) {
          toast(`右下に置ける Grok Bot は ${MAX_DOCK_BOTS} 体までです`);
          relayBots();
          break;
        }
        const bot = bots.list().find((b) => b.agentId === action.agentId) ?? bots.add(String(action.name ?? ''), action.agentId);
        if (!bot) {
          toast('ボットが多すぎて、台帳に入れられません（200 体まで）');
          relayBots();
          break;
        }
        bots.dock(bot.id);
        break;
      }
      case 'setBotLink':
        if (!isAgentId(action.agentId) || !bots.setAgentId(action.botId, action.agentId)) relayBots();
        break;
      case 'renameBot':
        if (!bots.rename(action.botId, String(action.name ?? ''))) relayBots();
        break;
      case 'setBotRole':
        // 巣の席の役（右の設定の欄から）。直せない形・変わらないときは、右の写しを今の台帳に戻す
        if (!bots.ready || !isBotId(action.botId) || !bots.setRole(action.botId, action.role)) relayBots(); // role が無い命令は外さない（null のときだけ外す）
        break;
      case 'setNest':
        // 巣の設定（みんなに聞くの送り方・代表・合体 Grok の演出）
        if (!bots.ready || !bots.setNest(action.nest)) relayBots();
        break;
      case 'setBotTeams':
        // グループの割り当て（groups.json。巣の席と各ボットの役は変えない）
        if (!botTeams.set(action.teams)) relayBots();
        break;
      case 'botPresetUsed':
        // 依頼の小窓で定型を押した・候補を取り込んだ（R4a）。id は use が形と在るかを確かめる（知らない id は何もしない）。set はそのときの組（R4b）
        botPresets.use(action.id, action.set);
        break;
      case 'setPresets':
        // 巣の ⚙ の定型の棚（R4b）。形は edit（mergePresetEdit）が確かめ直す。受けなかった・変わらないときは、右の写しを今の棚に戻す
        if (!botPresets.edit({ sets: action.sets, presets: action.presets, review: action.review })) relayBots();
        break;
      case 'presetFromRequest':
        // 送った依頼から拾う（R4b）。文は pick が直す（200 字・鍵らしき文字の置き換え）。足せなかったら写しを戻す
        if (!botPresets.pick(action.text, action.requestId)) relayBots();
        break;
      case 'botAppSeen':
        // 右下からアプリを開いた結果と、はじめての確かめ（盤面のボットのセルと同じ設定を使う）
        if (action.confirmed === true && !prefs.botAppConfirmed) {
          prefs.botAppConfirmed = true;
          savePrefs(prefs);
          relayBots();
        }
        if (typeof action.missing === 'boolean' && action.missing !== botAppMissing) setBotAppMissing(action.missing);
        break;
      case 'botOpenApp': {
        // 六角スクショを Grok-Bot へ（S3.12）の ①：読む画面が画像をクリップボードに入れた。そのボットのチャットを開く（依頼は作らない）
        //   知らせは右にも出す（撮影の「送る」も、使う人は右を見ている）
        const sayRight = (msg: string, ms?: number) => {
          toast(msg, ms);
          tellRight(action.botId, msg);
        };
        const bot = bots.get(action.botId);
        if (!bot) {
          sayRight('送り先の Grok Bot が台帳に見つかりません。右のボットの欄を開き直してから、もう一度どうぞ', 7000);
          break;
        }
        if (!bot.agentId) {
          sayRight(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ`, 6000);
          break;
        }
        void launchBotApp(bot.id, undefined, sayRight, `Grok Bot アプリで「${bot.name}」のチャットを開きました。画像はコピーしてあるので、チャットに貼って（Ctrl+V）から、小窓の「② 文をコピー」を押してください`);
        break;
      }
      case 'botToMemo':
        if (action.to === 'cell' || action.to === 'right' || action.to === 'hex') {
          void botToMemo(action.botId, String(action.fileId ?? ''), action.to, Number.isInteger(action.memo) ? action.memo : undefined);
        }
        break;
      case 'botToTab':
        // 回答カードの「タブに残す」（S3.10。右で押したときだけ）
        if (bots.get(action.botId)) void botToTab(action.botId, String(action.fileId ?? ''));
        break;
      case 'botAnswerLines':
        // 「続きとして」の要点の行（依頼の小窓 v2・R5）：右か読む画面の小窓から。返事は両方へ（頼んだ面だけが使う）
        if (bots.get(action.botId) && typeof action.requestId === 'string' && RELAY_REQUEST_ID_RE.test(action.requestId)) void botAnswerLines(action.botId, action.requestId);
        break;
      case 'botPasted': {
        // 「貼りましたか？」の札の答え（依頼の小窓 v2・R8・D17）。札を出している依頼と同じものだけ（違えば写しを送り直して札を正す）
        const { botId, requestId, answer } = action;
        if (!isBotId(botId) || typeof requestId !== 'string' || !RELAY_REQUEST_ID_RE.test(requestId) || !pasteWatch.watching(botId, requestId)) {
          relayBots();
          break;
        }
        if (answer === 'yes' || answer === 'no') void settlePaste(botId, requestId, answer);
        else if (answer === 'again') {
          // もう一度アプリを開く（依頼はクリップボードに残したまま。札を下げ、戻ってから、もう 1 回だけ聞く）
          const bot = bots.get(botId);
          if (!pasteWatch.again(botId, requestId)) relayBots();
          else if (bot?.agentId) void launchBotApp(bot.id, requestNo(requestId), (msg) => sayPaste(bot.id, msg));
          else sayPaste(botId, 'このボットにはリンクがまだないので、アプリを開けませんでした（右クリック →「リンクを貼る…」）');
        }
        break;
      }
      case 'botPasteMode': {
        // 画像の貼り方（依頼の小窓 v2・R7d・D16）：「貼りましたか？」の札の「次から 2 回貼りに戻す」から。巣の設定の pasteMode だけを替える
        //   （ほかの設定はそのまま。形が違う・替わらないときは、右の写しを今の台帳に戻す）
        const mode = action.mode === 'html' ? 'html' : action.mode === 'two' ? 'two' : null;
        if (!bots.ready || !mode || !bots.setNest({ ...bots.nest(), pasteMode: mode })) {
          relayBots();
          break;
        }
        const msg = mode === 'two' ? '次からは、画像を付けた依頼を 2 回に分けて貼ります（① 画像 → ② 文）。巣の ⚙「みんなに聞く」の「画像の貼り方」で戻せます' : '次からは、画像と文を一つの貼り付けで送ります（試し）';
        if (isBotId(action.botId) && bots.get(action.botId)) sayPaste(action.botId, msg);
        else toast(msg, 6000);
        break;
      }
      case 'botPing': {
        // 試し便（R8・D18）：決まった一文だけの依頼（type: "ping"）を作ってコピーし、アプリを開く（貼るのは人）。往復の時間と照合の合否は受け取り箱に出る
        const bot = bots.get(action.botId);
        const sayRight = (msg: string, ms?: number) => {
          toast(msg, ms);
          tellRight(action.botId, msg);
        };
        if (!bot) {
          sayRight('送り先の Grok Bot が台帳に見つかりません。右のボットの欄を開き直してから、もう一度どうぞ', 7000);
          break;
        }
        if (!bot.agentId) {
          sayRight(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ`, 6000);
          break;
        }
        void botSender.send({ botId: bot.id, text: '', ping: true, role: null }, { say: sayRight }).then((sent) => {
          if (!sent.ok) sayRight(sent.message, 7000);
        });
        break;
      }
      case 'botHookFallback': {
        // webhook で届かなかった依頼を、同じ依頼でコピーに切り替える（R11。小窓の切り替えのボタン・受け取り箱の伝票から）
        if (bots.get(action.botId) && typeof action.requestId === 'string' && RELAY_REQUEST_ID_RE.test(action.requestId)) void hookToCopy(action.botId, action.requestId);
        break;
      }
      case 'botHookChanged':
        void refreshHook(); // 巣の ⚙「送り方」で宛先と鍵をしまった・消した（R11。「ある／ない」を読み直して写しを送り直す）
        break;
      case 'botInboxCheck':
        // 中継の見張りの「いま取りに行く」（R8・D18）：C++ に今すぐ見回ってもらう（最後に見回った時刻が新しくなる）
        void botInbox.refreshStatus(true).then((status) => {
          const text = !status
            ? 'ブラウザの本体から返事がありませんでした。もう一度どうぞ'
            : status.owner
              ? '返事を取りに行きました。届いたものは、受け取り箱に出ます'
              : '返事は別の窓で受け取っています（この窓では取りに行けません）';
          tellRight('', text);
        });
        break;
      case 'removeVision':
        // Grok Visions を1件消す（右の月の窓・ボットの欄の札で、使う人が確かめてから）
        if (typeof action.id === 'string') visions.remove(action.id);
        break;
      case 'botSelect':
        rightBot = action.botId && bots.get(action.botId) ? action.botId : null;
        relayBotThread();
        break;
      case 'botStopWaiting':
        if (bots.get(action.botId)) botInbox.stopWaiting(action.botId, String(action.requestId ?? ''));
        break;
      case 'botMarkRead':
        if (bots.get(action.botId) && Array.isArray(action.requestIds)) {
          let changed = false;
          for (const id of action.requestIds.slice(0, 200)) changed = botInbox.markRead(action.botId, String(id)) || changed;
          if (changed) noteBotRead(); // 前の「読んだ」の時刻（次に開いたときの「まず 1 枚」の表の境目。R9）
        }
        break;
      case 'botMark': {
        // 回答カードの印（R9・D19）：形を確かめ直す。変わらなかった（知らない依頼・同じ印）ときは写しを送り直して、右の押した印を正す
        const { botId, requestId, mark } = action;
        if (!isBotId(botId) || !bots.get(botId) || typeof requestId !== 'string' || !RELAY_REQUEST_ID_RE.test(requestId) || !(mark === null || isBotMark(mark))) break;
        if (!botInbox.setMark(botId, requestId, mark)) {
          relayBots();
          relayBotThread();
        }
        break;
      }
      case 'botTeamHandoff': {
        // まとめ役に渡す（G3）。文を作って右の小窓へ渡すだけ。コピーするまでアプリは開かない
        const group = action.group;
        const tell = (botId: string, text: string) => {
          toast(text, 6000);
          send({ type: 'relay', to: 'right', payload: { kind: 'botNotice', botId, text } });
        };
        if (!Number.isInteger(group) || group < 1 || !botInbox.ready) break;
        const status = botInbox.groupStatus(group);
        const who = status.seats[0]?.botId ?? status.summary?.botId ?? '';
        if (!status.team) {
          if (who) tell(who, 'この組はグループではないので、まとめ役には渡せません');
          break;
        }
        const lead = bots.get(botTeams.teams()[status.team]?.lead ?? '');
        if (!lead) {
          if (who) tell(who, 'まとめ役が決まっていません。⚙ の「役」→「グループ」で選べます');
          break;
        }
        if (!lead.agentId) {
          tell(lead.id, `まとめ役「${lead.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ`);
          break;
        }
        if (!status.seats.some((seat) => seat.state === 'replied')) {
          tell(lead.id, 'まだ届いた返事がありません。1通届いてから、まとめ役に渡せます');
          break;
        }
        const team = status.team;
        void botInbox.handoffSources(group).then(async (slots) => {
          const redacted = [];
          for (const slot of slots) redacted.push({ ...slot, ...(slot.text != null ? { text: await redactBlockedUrls(slot.text) } : {}) });
          const text = buildTeamHandoffText(redacted, BOT_LIMITS.requestChars);
          send({ type: 'relay', to: 'right', payload: { kind: 'botTeamHandoff', group, botId: lead.id, team, text } });
        });
        break;
      }
      case 'botGroupRead': {
        // 受け取り箱の組のカードの「まとめて読む」（S3.8）：組の返事を席の順に並べて右へ（AI でまとめ直さない。check は入れない）
        const group = action.group;
        if (Number.isInteger(group) && group >= 1 && botInbox.ready) {
          void botInbox.groupReplies(group).then((replies) => send({ type: 'relay', to: 'right', payload: { kind: 'botGroupReplies', group, replies } }));
        }
        break;
      }
      case 'botDraft': {
        // 右下の Grok Bot の「コピーしてアプリを開く」：依頼を作って覚え、クリップボードに入れてからアプリを開く（はじめての確かめは右で済ませてある）
        //   知らせは右にも出す（使う人は右を見ている）
        const bot = bots.get(action.botId);
        const text = String(action.text ?? '').trim();
        const sayRight = (msg: string, ms?: number) => {
          toast(msg, ms);
          tellRight(action.botId, msg);
        };
        if (!bot) {
          sayRight('送り先の Grok Bot が台帳に見つかりません。右のボットの欄を開き直してから、もう一度どうぞ', 7000);
          break;
        }
        if (!text) {
          sayRight('送る文が空なので、コピーしませんでした。アプリは開いていません', 7000);
          break;
        }
        if (!bot.agentId) {
          sayRight(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ`, 6000);
          break;
        }
        botDrafts.set(bot.id, text);
        void botSender.send({ botId: bot.id, text }, { say: sayRight }).then((sent) => {
          if (sent.ok) {
            if (typeof action.cardId === 'string' && sent.requestId) grokCards.markSent(action.cardId, sent.requestId);
            return;
          }
          sayRight(sent.message, 7000);
          keepUnsent({ botId: bot.id, text }, sent.error); // 未送信の箱へ（R8）
        });
        break;
      }
      case 'botDraftV2': {
        // 依頼の小窓（S3.5）：頼む文・添付・役・組を受けて、依頼を作って覚え（アプリのチャットだけなら作らない）、コピーしてアプリを開く
        //   はじめての確かめは右で済ませてある。知らせは右にも出す。page・body は buildBotRequest が直す（URL の ? と # を消す・字数で切る）
        //   via が hook（R11）なら、コピーの代わりに中継へ直接（WebhookSender）。結果は ticket で頼んだ小窓へ返す（answerHook）
        const bot = bots.get(action.botId);
        const text = String(action.text ?? '').trim();
        const sayRight = (msg: string, ms?: number) => {
          toast(msg, ms);
          tellRight(action.botId, msg);
        };
        const hook = action.via === 'hook' && action.chatOnly !== true;
        const ticket = hook && isHookTicket(action.ticket) ? action.ticket : '';
        const refuse = (msg: string, ms: number) => {
          sayRight(msg, ms);
          answerHook(ticket, action.botId, { ok: false, error: 'noHook', message: msg }); // 待っている小窓にも（R11）
        };
        if (!bot) {
          refuse('送り先の Grok Bot が台帳に見つかりません。右のボットの欄を開き直してから、もう一度どうぞ', 7000);
          break;
        }
        if (!text) {
          refuse(hook ? '送る文が空なので、送りませんでした' : '送る文が空なので、コピーしませんでした。アプリは開いていません', 7000);
          break;
        }
        if (!bot.agentId) {
          refuse(`「${bot.name}」にはリンクがまだありません。右クリック →「リンクを貼る…」で貼ってから、もう一度どうぞ`, 6000);
          break;
        }
        const raw = action.page;
        const page =
          raw && typeof raw === 'object' && typeof raw.url === 'string'
            ? { title: String(raw.title ?? ''), url: raw.url, ...(typeof raw.selection === 'string' && raw.selection ? { selection: raw.selection } : {}) }
            : undefined;
        const chatOnly = action.chatOnly === true;
        // 画像と文を一つの貼り付けで（依頼の小窓 v2・R7d・D16）：写しの名前の形と色だけ確かめる（画像は C++ が bot-shots から読む。依頼にも記録にも入れない）
        const withImage = action.withImage;
        const image: ShotRef | undefined =
          withImage && typeof withImage === 'object' && typeof withImage.shotId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(withImage.shotId)
            ? { shotId: withImage.shotId, fill: withImage.fill === 'dark' ? 'dark' : 'white' }
            : undefined;
        // 小窓の選び方（R6）：形を直し、1体なら宛て先は今のボット・席は台帳の巣の並びで確かめ直す。返し先は送り方に合わせる
        const choice = ((): BotLastChoice | null => {
          const raw = action.choice !== undefined ? normalizeLastChoice(action.choice) : null;
          if (!raw) return null;
          const seat = bots.docked().indexOf(bot.id) + 1;
          return {
            ...raw,
            to: raw.to.all ? { all: true } : { botId: bot.id, ...(seat > 0 ? { seat } : {}) },
            replyTo: chatOnly ? 'chat' : action.deliverTo === 'hex' ? 'memo' : 'inbox', // 六角メモにも届く（R10）は、依頼に写す先があるときだけ
          };
        })();
        void (async () => {
          const blockedPage = page ? await pageIsBlocked(page.url) : false;
          if (blockedPage) sayRight(BLOCK_NOTE);
          const draft: DraftRequest = {
            botId: bot.id,
            text,
            ...(!chatOnly && page && !blockedPage ? { page } : {}),
            ...(!chatOnly && !blockedPage && typeof action.body === 'string' && action.body ? { body: action.body } : {}),
            ...(action.role !== undefined ? { role: action.role } : {}),
            ...(typeof action.roleText === 'string' ? { roleText: cleanRoleText(action.roleText) } : {}), // 小窓で直した役の文（R3。文字列だけ・1,200 字まで）
            ...(action.seat === 0 || (Number.isInteger(action.seat) && (action.seat ?? 0) >= 1 && (action.seat ?? 0) <= 6) ? { seat: action.seat } : {}),
            ...(Number.isInteger(action.group) && (action.group ?? 0) >= 1 ? { group: action.group } : {}),
            ...(Array.isArray(action.planned) ? { planned: action.planned.filter((id): id is string => typeof id === 'string').slice(0, 6) } : {}),
            ...(action.team ? { team: action.team } : {}),
            ...(action.summary === true ? { summary: true } : {}),
            ...(Array.isArray(action.plannedRoles) ? { plannedRoles: action.plannedRoles.filter((name): name is string => typeof name === 'string').slice(0, 6) } : {}),
            ...(chatOnly ? { chatOnly } : {}),
            // 続きの元（R5）：requestId の形だけ確かめる（覚えている依頼かは createRequest が見る。アプリのチャットだけは記録しないので使わない）
            ...(typeof action.parentRequestId === 'string' && RELAY_REQUEST_ID_RE.test(action.parentRequestId) ? { parentRequestId: action.parentRequestId } : {}),
            // 言い換えの元と使った定型（R9）：形だけ確かめる（覚えている依頼かは createRequest が見る）
            ...(typeof action.retryOf === 'string' && RELAY_REQUEST_ID_RE.test(action.retryOf) ? { retryOf: action.retryOf } : {}),
            ...(cleanPresetIds(action.presetIds).length ? { presetIds: cleanPresetIds(action.presetIds) } : {}),
            // 返し先「六角メモにも届く」（R10）：'hex' だけ。アプリのチャットだけと両立しない（JSON が無く、返事が受け取り箱に届かない）
            ...(!chatOnly && action.deliverTo === 'hex' ? { deliverTo: 'hex' as const } : {}),
          };
          const after: SendAfter = { say: sayRight, ...(image ? { image } : {}) };
          if (hook) {
            // 中継へ直接（R11）：画像あり・鍵が無いときは WebhookSender が断る（依頼は作らない）。届かなければ依頼は残す（未送信の箱には入れない。小窓が開いたまま切り替えを出す）
            const sent = await hookSender.send(draft, after);
            answerHook(ticket, bot.id, sent);
            if (!sent.ok) {
              sayRight(sent.message, 9000);
              return;
            }
            sayRight(`依頼 ${sent.no ?? ''} を中継へ直接送りました（貼る手は要りません。返事は受け取り箱に届きます）`, 6000);
            if (choice) botLastRequest.set(choice); // 送れたときだけ「前回送った依頼」にする（R6）
            if (typeof action.cardId === 'string' && !draft.group && sent.requestId) grokCards.markSent(action.cardId, sent.requestId); // 札から開いた依頼（Grok Cards の段 5）
            return;
          }
          if (chatOnly) {
            after.open = () =>
              void launchBotApp(
                bot.id,
                undefined,
                sayRight,
                `Grok Bot アプリで「${bot.name}」のチャットを開きました。頼む文はコピーしてあるので、貼り付けて（Ctrl+V）送ってください（アプリのチャットだけ：受け取り箱には届かず、記録もしません）`,
              );
          }
          const sent = await botSender.send(draft, after);
          if (!sent.ok) {
            sayRight(sent.message, 7000);
            keepUnsent(draft, sent.error); // 未送信の箱へ（R8。「送り方を選び直す…」「下書きに戻す」）
          } else {
            if (choice) botLastRequest.set(choice); // 送れたときだけ「前回送った依頼」にする（R6）
            if (typeof action.cardId === 'string' && !draft.group) {
              const raw = sent.requestId ?? (chatOnly ? CHAT_SENT : '');
              if (raw) grokCards.markSent(action.cardId, raw);
            }
          }
        })();
        break;
      }
    }
  }

  // 右サイドバーに短い知らせを出してもらう（ボットの欄・右下の Grok Bot から頼まれたことの結果）
  //   bubble：相棒の吹き出しで（頼んだ依頼への返事が届いたときだけ）
  //   fileId：どの返事のことか（右の回答カードの下に、結果の1行を出す。S3.10）
  function tellRight(botId: string, text: string, bubble = false, fileId?: string) {
    if (rightReady || sidebars.right.visible) send({ type: 'relay', to: 'right', payload: { kind: 'botNotice', botId, text, ...(bubble ? { bubble } : {}), ...(fileId ? { fileId } : {}) } });
  }

  // 返事をメモにする（右のボットの欄で押したときだけ。botToMemo）
  //   cell：そのボットのセルの隣（今のシートのセルを先に。無ければ今のシートのまん中のあたり）　right：右のメモ　hex：六角メモ（2回送らない）
  //   メモには「ボット（名前）から届いた返事」の印（by.who 'bot'）。灰色の返事は「未確認」のタグと、先頭の行の印を付ける（六角メモでも落とさない）
  //   返事は記録から読み直す（右の写しは 4,000 字までに切ってあるため。check は記録に無い）
  async function botToMemo(botId: string, fileId: string, to: 'cell' | 'right' | 'hex', memoIndex?: number) {
    const bot = bots.get(botId);
    if (!bot) return;
    const found = await botInbox.findMessage(botId, fileId);
    if (!found) {
      tellRight(botId, 'その返事が記録に見つかりませんでした（古い記録は片づけています）');
      return;
    }
    const { entry, message } = found;
    const grey = entry.grey === true || entry.match !== 'ok';
    const suggestion = memoIndex === undefined ? undefined : message.memos?.[memoIndex];
    if (memoIndex !== undefined && !suggestion) return;
    const body = botMessageMemoText(bot.name, message, { grey, no: entry.requestId ? requestNo(entry.requestId) : undefined, suggestion }, MAX_MEMO_TEXT);
    const kind = suggestion ? '提案' : message.type === 'error' ? 'エラー' : message.type === 'notice' ? '知らせ' : message.type === 'progress' ? '途中経過' : '返事';
    const tags = normalizeTags([...(grey ? ['未確認'] : []), ...(suggestion?.tags ?? [])]);
    const by = { who: 'bot', name: bot.name };
    const cutNote = body.cut ? '（長いので、メモに入る分だけにしました）' : '';
    if (to === 'hex') {
      const target = savedHexMemoTarget();
      if (!target) {
        tellRight(botId, '六角メモの送り先がまだ決まっていません（相棒の設定の「六角メモへ」で、送り先のノートを選んでください）');
        return;
      }
      const thread = await botInbox.thread(botId);
      if (thread?.items.some((i) => i.kind === 'message' && i.fileId === fileId && i.sent.includes('hex')) && memoIndex === undefined) {
        tellRight(botId, 'この返事は、もう六角メモへ送ってあります（2回は送りません）');
        return;
      }
      const record: HexMemoRecord = {
        text: body.text,
        createdAt: new Date().toISOString(),
        tags: normalizeTags(['GrokBot', bot.name, kind, ...tags]),
        // リンクは http(s) だけ（grokbot:// や中継の URL は入れない）。画像は送らない
        ...(message.links?.length ? { urls: message.links.filter((l) => /^https?:\/\//.test(l.url)).map((l) => ({ url: l.url, ...(l.title ? { title: l.title } : {}) })) } : {}),
      };
      const outcome = await sendToHexMemo(target, [record]);
      const card = memoIndex === undefined ? fileId : undefined; // 回答カードの下にも結果を出す（S3.10）
      if (!outcome.ok) {
        tellRight(botId, `六角メモへ送れませんでした（${outcome.error}）`, false, card);
        return;
      }
      if (memoIndex === undefined) botInbox.noteToMemo(botId, fileId, 'hex');
      // 「六角メモ『ノート』ノートに n マスで保存しました」（S3.10。ノートは送り先の最後の名前。書き込み先は相棒の設定で選んだノートだけ）
      const board = target.label.split(' › ').pop() || target.label;
      const cells = 'placed' in outcome && outcome.placed > 0 ? outcome.placed : 1;
      const head = grey ? `未確認の${kind}を、` : '';
      tellRight(
        botId,
        'pending' in outcome
          ? `${head}六角メモ「${board}」ノートへ ${cells} マスを送りました（${outcome.message}）${cutNote}`
          : `${head}六角メモ「${board}」ノートに ${cells} マスで保存しました ✓${cutNote}`,
        false,
        card,
      );
      return;
    }
    let sheet: string;
    let near: Hex;
    if (to === 'right') {
      sheet = isSheetId(rightSheet) ? rightSheet : RIGHT_MEMO_SHEET;
      sheets.ensure([sheet]);
      near = { q: 0, r: 0 };
    } else {
      const cells = cellsOfBot(botId);
      const cell = cells.find((m) => m.sheet === sheets.current) ?? cells[0];
      sheet = cell?.sheet ?? sheets.current;
      near = cell?.pos ?? anchorOn(sheet);
    }
    if (!sheets.get(sheet)) {
      tellRight(botId, 'メモを置くシートを作れませんでした（シートが多すぎます）');
      return;
    }
    const placed = memos.add({ sheet, pos: nearestFree(near, (h) => isTaken(h, sheet)), text: body.text, by, label: kind, tags });
    if (!placed) {
      tellRight(botId, 'メモのセルを置けませんでした（メモのセルが多すぎます）');
      return;
    }
    if (memoIndex === undefined) botInbox.noteToMemo(botId, fileId, to);
    if (to === 'cell') {
      if (sheet === sheets.current) sidebar.flashMemo(placed.id);
      preview.showMemo(placed.id);
    }
    const where = to === 'right' ? '右のメモ' : `「${bot.name}」のセルの隣のメモのセル${sheet !== sheets.current ? `（シート「${sheets.get(sheet)?.name ?? ''}」）` : ''}`;
    tellRight(botId, `${grey ? '未確認の' : ''}${kind}を、${where}に置きました${cutNote}`);
  }

  // 返し先「六角メモにも届く」（依頼の小窓 v2・R10・D13・Q6）：確かめが通った返事を、今の「六角メモで開く」と同じ道（相棒の設定で選んだノート・
  //   C++ の hexMemoSend。六角メモ側に新しい受け口は使わない）で 1 マス写し、pending.json の delivered と記録の toMemo（カードの「六角メモで開く」も
  //   「保存済み」になる）を残す。2 回は写さない（delivered・この窓のあいだ試した依頼・記録の toMemo を見る）。
  //   写すのは返事の文とリンクだけ（check と頼む文は記録にも無い。渡し止めのアドレスは伏せる：文は redactBlockedUrls、リンクは渡し止めのものを落とす）。
  //   写せなければ delivered は付けず、カードの下に理由（次に届く返事では試し直さない。カードの「六角メモで開く」で手で送れる）
  const hexTried = new Set<string>(); // この窓のあいだに写そうとした依頼（失敗しても、あとの返事では試し直さない）
  async function deliverReplyToHex(reply: BotReplyArrival) {
    const { botId, fileId, message } = reply;
    const requestId = message.requestId;
    const bot = bots.get(botId);
    if (!bot || !requestId || message.type !== 'reply' || botInbox.deliveryOf(botId, requestId) !== 'hex' || hexTried.has(requestId)) return;
    hexTried.add(requestId);
    const target = savedHexMemoTarget();
    if (!target) {
      tellRight(botId, '六角メモに写せませんでした（相棒の設定の「六角メモへ」で、送り先のノートを選んでください。選んだあとは、カードの「六角メモで開く」で送れます）', false, fileId);
      return;
    }
    const thread = await botInbox.thread(botId);
    if (thread?.items.some((i) => i.kind === 'message' && i.fileId === fileId && i.sent.includes('hex'))) return; // もう手で送ってある
    const hosts = await ensureBlocklist();
    const body = botMessageMemoText(bot.name, message, { grey: false, no: requestNo(requestId) }, MAX_MEMO_TEXT);
    const urls = (message.links ?? []).filter((l) => /^https?:\/\//.test(l.url) && !isBlockedUrl(l.url, hosts)).map((l) => ({ url: l.url, ...(l.title ? { title: l.title } : {}) }));
    const record: HexMemoRecord = {
      text: await redactBlockedUrls(body.text),
      createdAt: new Date().toISOString(),
      tags: normalizeTags(['GrokBot', bot.name, '返事']),
      ...(urls.length ? { urls } : {}), // 画像は送らない
    };
    const outcome = await sendToHexMemo(target, [record]);
    if (!outcome.ok) {
      tellRight(botId, `六角メモに写せませんでした（${outcome.error}）。カードの「六角メモで開く」で、もう一度送れます`, false, fileId);
      return;
    }
    const board = target.label.split(' › ').pop() || target.label;
    const cut = body.cut ? '（長いので、メモに入る分だけ）' : '';
    const note =
      'pending' in outcome ? `六角メモ「${board}」ノートへ写しを送りました（${outcome.message}）${cut}` : `六角メモ「${board}」ノートに写しました ✓（受け取り箱で確かめたあと、自動で）${cut}`;
    botInbox.markDelivered(botId, requestId, note);
    botInbox.noteToMemo(botId, fileId, 'hex');
    tellRight(botId, note, false, fileId);
  }

  // 回答カードの「タブに残す」（S3.10）：依頼に付けたページのタブがまだあれば、そのタブのメモ（TabNote）に要約と出典を残す。無ければ右のメモへ
  //   カードになるのは確かめの済んだ返事（check の合う reply）だけなので、ここでもそれだけを受ける。返事は記録から読み直す（右の写しは 4,000 字まで）
  //   タブは、依頼に入れた URL（? と # を消したもの。pending.json の page）と、今の URL の ? と # を消したものが同じタブ（今のタブを先に）
  // 「続きとして」の要点の行（R5）：依頼への確かめが通った返事を記録から読み直し（右の写しは 4,000 字切りなので）、
  //   要点の行と頭の 1 行を作って右と読む画面へ。渡し止めのアドレスは伏せる。見つからなければ found: false（小窓は要点なしで続ける）
  async function botAnswerLines(botId: string, requestId: string) {
    const reply = await botInbox.answerReply(botId, requestId);
    const cut = (line: string) => cutChars(line, ANSWER_LINE_CHARS).text;
    const payload: BotAnswerLines = { botId, requestId, found: !!reply, no: requestNo(requestId), line: '', lines: [] };
    if (reply) {
      payload.line = cut(await redactBlockedUrls(botAnswerLine(reply.text)));
      for (const line of botAnswerPoints(reply.text, ANSWER_LINE_CHARS, ANSWER_LINES_MAX)) payload.lines.push(cut(await redactBlockedUrls(line)));
    }
    if (rightReady || sidebars.right.visible) send({ type: 'relay', to: 'right', payload: { kind: 'botAnswerLines', ...payload } });
    if (readerReady) send({ type: 'relay', to: 'reader', payload: { kind: 'botAnswerLines', ...payload } });
  }

  async function botToTab(botId: string, fileId: string) {
    const bot = bots.get(botId);
    if (!bot) return;
    const found = await botInbox.findMessage(botId, fileId);
    if (!found) {
      tellRight(botId, 'その返事が記録に見つかりませんでした（古い記録は片づけています）', false, fileId);
      return;
    }
    const { entry, message } = found;
    if (entry.grey === true || entry.match !== 'ok' || message.type !== 'reply') return;
    const text = botAnswerNoteText(message.text ?? '', { botName: bot.name, no: entry.requestId ? requestNo(entry.requestId) : undefined, links: message.links }, MAX_MEMO_TEXT);
    const page = entry.requestId ? botInbox.requestPage(botId, entry.requestId) : undefined;
    const tab = page ? [...store.all()].sort((a, b) => Number(b.id === store.activeId) - Number(a.id === store.activeId)).find((t) => stripUrlQuery(t.url) === page) : undefined;
    if (tab) {
      store.addNote(tab.id, { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, createdAt: Date.now(), source: 'ai', label: 'Grok の回答' });
      tellRight(botId, `タブ「${tab.title || tab.url}」のメモに、要約と出典を残しました`, false, fileId);
      return;
    }
    const sheet = isSheetId(rightSheet) ? rightSheet : RIGHT_MEMO_SHEET;
    sheets.ensure([sheet]);
    const placed = sheets.get(sheet) ? memos.add({ sheet, pos: nearestFree({ q: 0, r: 0 }, (h) => isTaken(h, sheet)), text, by: { who: 'bot', name: bot.name }, label: '返事', tags: [] }) : null;
    if (!placed) {
      tellRight(botId, '右のメモに置けませんでした（メモのセルが多すぎます）', false, fileId);
      return;
    }
    botInbox.noteToMemo(botId, fileId, 'right');
    const why = page ? '依頼に付けたページのタブが、もう開いていない' : '依頼にページを付けていない（か、覚えていない古い依頼の）';
    tellRight(botId, `${why}ので、右のメモに要約と出典を残しました`, false, fileId);
  }

  // ページの右クリック「📝 下のメモに引用」と Ctrl+Shift+Q。文が空のときは、左がページに選んだ文を聞く
  async function quoteIntoMemo(tabId: number, url: string, text: string) {
    const memoId = memoPane.openId;
    if (!memoPane.isOpen() || !memoId) {
      toast('下の区画が開いていません');
      return;
    }
    const tab = (tabId ? store.get(tabId) : undefined) ?? store.active ?? undefined;
    let selection = text.trim();
    let pageUrl = url;
    let title = tab?.title ?? '';
    if (!selection) {
      if (!tab || tab.asleep) {
        tellMemo('上のページがありません（引用：ページなし）');
        return;
      }
      const pageText = await requestPageText(tab.id);
      if (!memoPane.isOpen() || memoPane.openId !== memoId) return;
      if (pageText.error === 'timeout') {
        tellMemo('上のページからの返事が来ませんでした（引用：返事なし）');
        return;
      }
      if (pageText.error === 'noPage') {
        tellMemo('上のページがありません（引用：ページなし）');
        return;
      }
      if (pageText.error) {
        tellMemo('上のページの文を読めませんでした（引用：読めない）');
        return;
      }
      selection = (pageText.selection ?? '').trim();
      if (pageText.url) pageUrl = pageText.url;
      if (pageText.title) title = pageText.title;
    } else if (!pageUrl && tab) {
      pageUrl = tab.url;
    }
    if (!selection) {
      tellMemo('上のページで文を選んでから押してください');
      return;
    }
    const quote = parseQuote({ text: selection, url: pageUrl, title });
    if (!quote) {
      tellMemo('このページのアドレスでは引用を残せません（引用：アドレス）');
      return;
    }
    if (!memos.addReply(memoId, null, '', undefined, { quote })) {
      toast('コメントを足せませんでした（返信が多すぎます）');
      return;
    }
    tellMemo('引用を入れました');
  }

  function runShortcut(action: ShortcutAction) {
    switch (action) {
      case 'newTab':
        openNewTab();
        break;
      case 'hexShot':
        void startShot(null);
        break;
      case 'memoPane': {
        if (memoPane.isOpen()) {
          memoPane.close();
          break;
        }
        const last = readMemoPanePrefs().lastMemo;
        const usable = (id: string | null) => {
          if (!id) return false;
          const memo = memos.get(id);
          return !!memo && !isSpecialCell(memo);
        };
        const id = usable(last) ? last : usable(preview.focusMemo) ? preview.focusMemo : null;
        if (!id) {
          toast('メモのセルをダブルクリックすると開きます');
          break;
        }
        memoPane.open(id);
        break;
      }
      case 'memoQuote':
        void quoteIntoMemo(store.activeId ?? 0, '', '');
        break;
      case 'captureCenter':
        captureCenterFromPage();
        break;
      case 'closeTab':
        withActive((id) => send({ type: 'closeTab', id }));
        break;
      case 'focusAddress':
        address.focus();
        break;
      case 'nextTab':
      case 'prevTab': {
        const tab = store.neighbor(action === 'nextTab' ? 1 : -1);
        if (tab) send({ type: 'activateTab', id: tab.id });
        break;
      }
    }
  }

  applyView();
  send({ type: 'ready' });
}

// 動画のときに区間セルを並べる場所と大きさ（読む画面の設定。同じ保存場所）
function readerVideoPlace(): { layout: 'right' | 'bottom'; width: number; height: number } {
  try {
    const s = JSON.parse(localStorage.getItem('honeycomb.reader') ?? '{}') as { videoWidth?: unknown; videoHeight?: unknown; videoLayout?: unknown };
    return {
      layout: s.videoLayout === 'bottom' ? 'bottom' : 'right',
      width: typeof s.videoWidth === 'number' ? s.videoWidth : 520,
      height: typeof s.videoHeight === 'number' ? s.videoHeight : 340,
    };
  } catch {
    return { layout: 'right', width: 520, height: 340 };
  }
}

function setPressed(id: string, pressed: boolean) {
  $(id).setAttribute('aria-pressed', String(pressed));
}

// C:\a\b.mp3 → file:///C:/a/b.mp3
function fileUrlOf(path: string) {
  return `file:///${path.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')}`;
}

// 入力された文字を URL にする。URL らしくなければ検索する
function toUrl(text: string): string | null {
  const input = text.trim().replace(/^"(.*)"$/, '$1');
  if (!input) return null;
  if (/^[a-zA-Z]:[\\/]/.test(input)) return fileUrlOf(input); // パソコンの中のファイル（エクスプローラーの「パスのコピー」など）
  if (isGrokBotAddress(input)) return null; // grokbot:// はタブにしない（開くのはボットのセルだけ。S1.11）
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) || /^(about|data):/i.test(input)) return input;
  if (!/\s/.test(input) && (input.includes('.') || input.startsWith('localhost'))) return `https://${input}`;
  return SEARCH_URL + encodeURIComponent(input);
}

// 右から届いた場所（整数の q・r で、大きすぎない）か
function isHex(value: unknown): value is Hex {
  if (typeof value !== 'object' || value === null) return false;
  const h = value as Record<string, unknown>;
  return Number.isInteger(h.q) && Number.isInteger(h.r) && Math.abs(h.q as number) < 100_000 && Math.abs(h.r as number) < 100_000;
}
