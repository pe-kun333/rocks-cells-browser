// 右サイドバー
//   「拡大表示」「休眠」のパネルと、これから追加するパネルの置き場所。いちばん下に AI の相棒と、その下に Grok Bot（6体まで）。
//   タブの情報は左サイドバーから写しをもらう（自分では台帳を持たない）。
//   台帳や設定を変えたいときは、左サイドバーに頼む（relay の command）
import { MemoryStore } from '../ai/memory';
import { newTopic, TopicStore } from '../ai/research';
import { BLOCK_NOTE, pageIsBlocked } from '../blocklist';
import { requestPageText } from '../ai/page';
import { BrowserTools, type ToolHost } from '../ai/tools';
import { onMessage, request, send } from '../bridge';
import { CardImages } from '../card-image';
import { readData } from '../data';
import { loadTagRegistry } from '../integrations/hexmemo';
import { type LikeLevel, likeLevel } from '../likes';
import { InfoPanel, type InfoPanelHost } from '../panels/info-panel';
import { MemoryPanel } from '../panels/memory-panel';
import { OrganizePanel } from '../panels/organize-panel';
import { AiPanel, type ReminderAction } from '../panels/ai-panel';
import { AskLeftSender } from '../bot-send';
import { isMachineTag } from '../grok-cards-tags';
import { BotStrip } from '../panels/bot-strip';
import { BOT_FEATURES } from '../features';
import { BotDock } from '../panels/bot-dock';
import { CuePanel } from '../panels/cue-panel';
import { BotPanel } from '../panels/bot-panel';
import { CellMenu, showToast } from '../panels/cell-menu';
import { SectionShelf } from '../panels/section-shelf';
import { MemoPad } from '../panels/memo-pad';
import { MoonWindow } from '../panels/moon-window';
import { isWritingIn, type PreviewActions, previewCard } from '../panels/preview';
import { ReminderPanel } from '../panels/reminder-panel';
import { RoutePanel } from '../panels/route-panel';
import { CapturePanel } from '../panels/capture-panel';
import { CaptureStore, type CaptureScope } from '../captures';
import { VaultPanel } from '../panels/vault-panel';
import { VocabPanel } from '../panels/vocab-panel';
import type { RoutesState } from '../routes';
import { findVocabTab, type VocabLink, type VocabState } from '../vocab';
import { clockOf, snoozedCopy } from '../reminder-when';
import { MAX_REMINDERS, MAX_TRIGGERS, reminderLink, reminderTrigger } from '../reminders';
import { SleepPanel } from '../panels/sleep-panel';
import { SearchPanel } from '../panels/search-panel';
import { type LocalSources, searchLocal } from '../right-search';
import { TagIndex, type TagButtonsView } from '../panels/tag-index';
import { TagPad, type TagUse } from '../panels/tag-pad';
import type { ThreadUi } from '../panels/thread-view';
import type { PendingReply } from '../threads';
import type { MemoIndexItem } from '../memocells';
import { TagButtonStore } from '../tagbuttons';
import { MAIN_SHEET, type Sheet } from '../sheets';
import { TabStore } from '../tabs';
import { Thumbnails } from '../thumbs';
import { VaultStore } from '../vault';
import { VisionView } from '../visions';
import type { Island, PreviewPlacement, RelayCommand, RelayPayload, Reminder, SidebarState } from '../types';
import { $, el, hostOf } from '../util';

export function startSecondary() {
  document.body.classList.add('surface-right');
  const store = new TabStore();
  const thumbs = new Thumbnails();
  let placement: PreviewPlacement | null = null; // 左サイドバーから教えてもらうまでは不明
  let focusId: number | null = null;
  let reminders: Reminder[] = []; // 左サイドバーが持つリマインダーの写し
  let remindersFailed = false; // 左の台帳を読めなかった（K0b。右の区画が帯で知らせる）
  let rightOpen = true; // 右サイドバーが見えているか（閉じているあいだは、ひとことの回数を溜めない）
  function noteSidebars(state: SidebarState) {
    const open = state.right?.visible !== false;
    if (open === rightOpen) return;
    rightOpen = open;
    for (const fn of vocabListeners) fn(); // 月の窓のひとこと（見えていない間は溜めない）
  }
  const reminderListeners: (() => void)[] = []; // 写しが変わったとき（月の窓のめぐる表示）
  let gotState = false; // 左サイドバーから台帳の写しが届いたか
  let captureAfterState: CaptureScope | null = null; // 写しが届く前に「撮って」が来た（右を開いた直後）
  let captureImageAfterState: Extract<RelayPayload, { kind: 'captureImage' }> | null = null; // 写しが届く前に「画像を撮って」が来た（右を開いた直後）。続けて来たら最後の 1 件
  let recordAfterState = false; // 写しが届く前に「中央を録画」が来た
  let islands: Island[] = [];
  let highlightTag: string | null = null;
  let highlightLike: LikeLevel | null = null;
  let tagRegistry: Promise<string[]> = loadTagRegistry(); // 六角メモのタグ（色をそろえる）
  let routes: RoutesState = { recording: true, routes: [] }; // 左サイドバーが持つ順路の写し
  let vocab: VocabState = { cards: [], notify: true }; // 左サイドバーが持つ単語帳の写し
  let gotVocab = false; // 単語帳の写しが左サイドバーから届いたか（検索で、まだ無いのと 0 件を分ける）
  const vocabListeners: (() => void)[] = []; // 写しが届いたとき（月の窓のめぐる表示）
  let sectionShelf: SectionShelf | null = null; // 区画のたたみと上のタグ（できてから入る）
  let sheets: Sheet[] = []; // 左サイドバーが持つシートの台帳の写し
  let memoIndex: MemoIndexItem[] | null = null; // すべてのメモのセルの短い写し（タグごとの一覧。左から届くまでは null）
  let leftTagButtons: TagButtonsView | null = null; // 左のタグのボタン（使っているセット）
  // タブに付けた画像（左サイドバーが保存したものを読む。読み終えたら描き直す）
  const faceImages = new Map<string, string>();
  const faceLoading = new Set<string>();
  let refreshMemos = () => {}; // 画像を読み終えたら、右の「メモ」の区画も描き直す
  function faceImageOf(id: string | undefined): string | undefined {
    if (!id) return undefined;
    const cached = faceImages.get(id);
    if (cached || faceLoading.has(id)) return cached;
    faceLoading.add(id);
    void readData<{ data?: unknown }>(`shots/${id}.json`).then((saved) => {
      if (typeof saved?.data === 'string' && saved.data.startsWith('data:image/')) {
        faceImages.set(id, saved.data);
        render();
        refreshMemos();
      }
    });
    return undefined;
  }
  // 単語カードの指す画像（K6。計画書 §5 の 19）：shots と撮影を読んで覚える（読み終えたら単語帳の区画と月の窓を描き直す）
  const cardImages = new CardImages({
    shot: async (id) => {
      const saved = await readData<{ data?: unknown }>(`shots/${id}.json`);
      return typeof saved?.data === 'string' ? saved.data : null;
    },
    capture: (id) => captureStore.loadImage(id),
  });
  let hereIds: string[] = []; // 左が表示中のページから作ったカード（K6。月の窓の「このページ n 枚」）

  const askLeft = (action: RelayCommand) => send({ type: 'relay', to: 'left', payload: { kind: 'command', action } });
  const actions: PreviewActions = {
    open: (id) => send({ type: 'activateTab', id }),
    close: (id) => send({ type: 'closeTab', id }),
    setKeepAwake: (id, keepAwake) => askLeft({ command: 'setKeepAwake', id, keepAwake }),
    sleepNow: (id) => send({ type: 'discardTab', id }),
    setMuted: (id, muted) => send({ type: 'setMuted', id, muted }),
    removeNote: (tabId, noteId) => askLeft({ command: 'removeNote', tabId, noteId }),
    setLiked: (id, liked) => askLeft({ command: 'setLiked', id, liked }),
    addUserNote: (tabId, text) => askLeft({ command: 'addUserNote', tabId, text }),
    changeTags: (id, add, remove) => askLeft({ command: 'changeTags', tab: id, add, remove }),
    leaveIsland: (id) => askLeft({ command: 'leaveIsland', id }),
    readAsCells: (id) => askLeft({ command: 'openReader', id }),
    editFace: (id) => askLeft({ command: 'editTabFace', id }), // 見た目の欄は、左の盤面のセルの近くに開く
  };
  // タブのメモへの返信（コメントのスレッド）。返信の持ち主は左サイドバーなので、頼むだけ
  const replyPending: PendingReply[] = []; // 相棒が返信を書いている途中（左サイドバーから届く）
  const threadUi: ThreadUi = {
    actions: {
      add: (ref, parent, text) => askLeft({ command: 'addReply', ref, parent, text }),
      remove: (ref, replyId) => askLeft({ command: 'removeReply', ref, replyId }),
      copy: (ref, replyId) => askLeft({ command: 'copyComment', ref, replyId }),
      ai: (ref, parent, who) => askLeft({ command: 'aiReply', ref, parent, who }),
      edit: (ref, replyId, text) => askLeft({ command: 'editReply', ref, replyId, text }),
    },
    pending: replyPending,
    refresh: () => render(),
    shot: (id) => faceImageOf(id),
    openSource: (url, fragmentUrl) => askLeft({ command: 'openQuote', url, fragmentUrl }),
  };

  const header = el('header', 'panel-header');
  const closeButton = el('button', '', '×');
  closeButton.title = '右サイドバーを閉じる';
  closeButton.setAttribute('aria-label', '右サイドバーを閉じる');
  closeButton.addEventListener('click', () => send({ type: 'setSidebar', side: 'right', visible: false }));
  header.append(el('span', 'panel-title', 'パネル'), closeButton);

  // 右のタグのボタン（6つ・セット・その他）：右のカードと、メモの区画のコメントに出す。左のボタンとは別
  const menu = new CellMenu();
  const tagButtons = new TagButtonStore('right');
  void tagButtons.load();
  // データ置き場（右サイドバーのメモの区画のすぐ下）。相棒との会話と、相棒が作ったものを残す
  const vaultStore = new VaultStore();
  function usedTags(): TagUse[] {
    const counts = new Map<string, number>();
    for (const tab of store.all()) for (const tag of tab.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    for (const memo of memoIndex ?? []) for (const tag of memo.tags) if (!isMachineTag(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    for (const item of vaultStore.items) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
  }
  const rightToast = (text: string) => showToast(document.body, text, 4500);
  const tagPad = new TagPad({ store: tagButtons, menu, side: '右サイドバー', used: usedTags, toast: rightToast });

  const previewSection = el('section', 'panel-section');
  const sleepPanel = new SleepPanel(store, (settings) => askLeft({ command: 'setSleep', settings }));
  const reminderPanel = new ReminderPanel({ add: (r) => toolHost.addReminder(r), cancel: (id) => toolHost.cancelReminder(id), activeTab: () => { const t = store.active; return t ? { id: t.id, url: t.url, title: t.title || hostOf(t.url) } : null; }, tabs: () => store.all(), memos: () => memoIndex, openLink: (link) => openReminderLink(link), done: (id, fired) => doneReminder(id, fired), toCard: (text) => reminderToCard(text), openCard: (id) => openReminderCard(id) });
  const paintReminders = () => {
    reminderPanel.render(reminders, remindersFailed);
    for (const fn of reminderListeners) fn(); // 月の窓のめぐる表示
  };
  // リマインダーの指す先へ（K2。計画書 §5 の 9）：タブが見つかれば、単語カードと同じ道でそのセルへ。無ければ URL を開く
  function openReminderLink(link: VocabLink) {
    if (link.kind === 'tab' && !findVocabTab(store.all(), link)) {
      if (link.url) askLeft({ command: 'openUrl', url: link.url, background: false });
      else rightToast('そのタブのセルは、もうありません');
      return;
    }
    askLeft({ command: 'openVocabCell', link });
  }
  // 済み（K3）：まだ鳴っていないものは一覧からすぐ外す（繰り返しは左が次の回を送り返す）
  function doneReminder(id: string, fired: boolean) {
    if (!fired) {
      reminders = reminders.filter((r) => r.id !== id);
      paintReminders();
    }
    askLeft({ command: 'doneReminder', id, ...(fired ? { fired: true } : {}) });
  }
  // 鳴ったものを単語カードに（K3）：単語帳の「＋カード」を、表にその文を入れて開く
  function reminderToCard(text: string) {
    sectionShelf?.show('vocab');
    if (!vocabPanel.startAdd({ front: text })) rightToast('単語帳の復習の途中です。終えてからどうぞ');
  }
  // 延ばす（K2。計画書 §5 の 12）：同じ文・指す先・置いた人で、新しい id と時刻で置き直す
  function snoozeReminder(reminder: Reminder, dueAt: number): boolean {
    const ok = toolHost.addReminder(snoozedCopy(reminder, dueAt, Date.now()));
    if (ok) rightToast(`リマインダーを ${clockOf(dueAt)} に延ばしました`);
    return ok;
  }
  // リマインダーの吹き出しのボタン（K2）：10 分延ばす・1 時間延ばす・そのセルへ（指す先があるとき）
  function reminderBubbleActions(reminder: Reminder): ReminderAction[] {
    const actions: ReminderAction[] = [
      { label: '10 分延ばす', title: '10 分後にもう一度知らせます', run: () => void snoozeReminder(reminder, Date.now() + 10 * 60_000) },
      { label: '1 時間延ばす', title: '1 時間後にもう一度知らせます', run: () => void snoozeReminder(reminder, Date.now() + 60 * 60_000) },
      { label: '済み', title: '済みにします（「鳴ったもの」に残ります）', run: () => doneReminder(reminder.id, true) },
    ];
    const link = reminderLink(reminder);
    if (link) actions.push({ label: 'そのセルへ', title: reminder.title ? `「${reminder.title}」へ` : '指しているセルへ', run: () => openReminderLink(link) });
    const card = reminder.card;
    if (typeof card === 'string') actions.push({ label: '単語帳で開く', title: '右の「単語帳」で、このカードを開きます', run: () => openReminderCard(card) });
    return actions;
  }
  // カードから置いたリマインダーの「単語帳で開く」（K4）
  function openReminderCard(id: string) {
    if (!vocab.cards.some((c) => c.id === id)) {
      rightToast('そのカードは、もう単語帳にありません');
      return;
    }
    sectionShelf?.show('vocab');
    vocabPanel.reveal(id);
  }
  const organizePanel = new OrganizePanel({
    tabs: () => store.all(),
    islands: () => islands,
    highlightTag: () => highlightTag,
    highlightLike: () => highlightLike,
    memos: () => memoIndex,
    settings: () => ai.organizeSettings(),
    registeredTags: () => {
      tagRegistry = loadTagRegistry(); // 頼むたびに読み直す（六角メモでタグが増えているかもしれない）
      return tagRegistry;
    },
    askLeft,
  });
  const memory = new MemoryStore();
  const memoryPanel = new MemoryPanel({
    store: memory,
    entries: () => ai.conversationEntries(),
    settings: () => ai.organizeSettings(),
  });
  const topics = new TopicStore();
  const infoHost: InfoPanelHost = {
    store: topics,
    settings: () => ai.organizeSettings(),
    async interests() {
      await memory.ready;
      return memory.list().map((m) => m.text).slice(-30);
    },
    openUrl: (url, background) => askLeft({ command: 'openUrl', url, background }),
    openAsIsland: (name, items) => askLeft({ command: 'openAsIsland', name, items }),
    announce: (text) => void ai.announce(text),
    toVault: (draft) => vaultPanel.add(draft),
    askBot: () => false, // 巣ができるまで。クリックはそれよりあと
  };
  const infoPanel = new InfoPanel(infoHost);
  const routePanel = new RoutePanel({
    askLeft,
    tabs: () => store.all(),
    activeTab: () => store.active,
    settings: () => ai.organizeSettings(),
    hexMemoTarget: () => ai.hexMemoTarget(),
  });
  store.onChange(() => routePanel.tabsChanged());
  const vocabPanel = new VocabPanel({
    askLeft,
    addReminder: (reminder) => toolHost.addReminder(reminder), // カードから「復習を思い出す」（K4）
    settings: () => ai.organizeSettings(),
    hexMemoTarget: () => ai.hexMemoTarget(),
    activeTabId: () => store.activeId,
    tabs: () => store.all().map((tab) => ({ id: tab.id, title: tab.title || hostOf(tab.url) || '新しいタブ', url: tab.url, sheet: tab.sheet })),
    memos: () => memoIndex?.map((memo) => ({ id: memo.id, title: memo.title, sheet: memo.sheet })) ?? null,
    sheetName: (id) => (id === MAIN_SHEET ? 'メイン' : (sheets.find((sheet) => sheet.id === id)?.name ?? '')),
    openUrl: (url) => askLeft({ command: 'openUrl', url, background: false }),
    announce: (text) => void ai.announce(text),
    toVault: (draft) => vaultPanel.add(draft),
    openRotate: () => moonWindow.openSettings(),
    image: (image) => cardImages.get(image), // カードの指す画像（K6）
    // 画像を付ける欄の候補（K6）：撮影は新しい順、画像のセルはメモの一覧の写しから
    imageChoices: () => ({
      captures: [...captureStore.items]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((item) => ({ id: item.id, label: item.comment || item.source?.title || '', at: item.createdAt })),
      shots: (memoIndex ?? []).flatMap((memo) => (memo.imageId ? [{ id: memo.imageId, label: memo.title }] : [])),
    }),
  });
  // 下のパネルのいちばん上：メモの区画（右だけのシート「右のメモ」の蜂の巣と、書いたコメント）
  const memoPad: MemoPad = new MemoPad({
    askLeft,
    thread: {
      actions: threadUi.actions,
      pending: replyPending,
      refresh: () => memoPad.render(true),
      shot: (id) => faceImageOf(id),
      openSource: (url, fragmentUrl) => askLeft({ command: 'openQuote', url, fragmentUrl }),
    },
    menu,
    tabs: () => store.all(),
    sheets: () => sheets,
    tagPad,
    changeTags: (id, add, remove) => askLeft({ command: 'changeTags', memo: id, add, remove }),
  });
  refreshMemos = () => memoPad.render();
  // メモの区画の下：タグごとの一覧（タブとメモのセルを、タグのまとまりで）
  const tagIndex = new TagIndex({
    tabs: () => store.all(),
    activeId: () => store.activeId,
    sheets: () => sheets,
    memos: () => memoIndex,
    rightButtons: () => ({ name: tagButtons.current.name, tags: tagButtons.current.tags }),
    leftButtons: () => leftTagButtons,
    highlightTag: () => highlightTag,
    activate: (id) => send({ type: 'activateTab', id }),
    showMemo: (id) => askLeft({ command: 'showMemo', id }),
    highlight: (tag) => askLeft({ command: 'highlightTag', tag }),
  });
  // タグごとの一覧のすぐ上：検索（メモとコメントは左に探してもらい、タブ・撮影・置き場・単語帳は右の中で探す）
  const searchPanel = new SearchPanel({
    ask: (seq, query, sort, limit) => askLeft({ command: 'searchMemos', seq, query, sort, limit }),
    memoKnown: (id) => (memoIndex ? memoIndex.some((m) => m.id === id) : null),
    sheetName: (id) => (id === MAIN_SHEET ? null : (sheets.find((s) => s.id === id)?.name ?? 'シート')),
    openMemo: (item) => askLeft({ command: 'openMemoPane', id: item.memoId, ...(item.replyId ? { replyId: item.replyId } : {}), from: 'search' }),
    showMemo: (id) => askLeft({ command: 'showMemo', id }),
    local: (query, kinds) => {
      // 右が持っているもの（タブの写し・撮影の台帳・置き場の目次・単語帳の写し）から探す。まだ無いものは知らせに回す
      const notes: string[] = [];
      const src: LocalSources = {};
      if (kinds.includes('tab')) {
        if (gotState) src.tabs = store.all();
        else notes.push('タブはまだ届いていません');
      }
      if (kinds.includes('capture')) {
        if (captureStore.state === 'ready') src.captures = captureStore.items;
        else notes.push(captureStore.state === 'loading' ? '撮影は読み込み中です' : '撮影の台帳を読めていません');
      }
      if (kinds.includes('vault')) {
        if (vaultStore.isLoaded) src.vault = vaultStore.items;
        else notes.push('データ置き場は読み込み中です');
      }
      if (kinds.includes('vocab')) {
        if (gotVocab) src.vocab = vocab.cards;
        else notes.push('単語帳はまだ届いていません');
      }
      if (kinds.includes('reminder')) {
        if (gotState) src.reminders = reminders;
        else notes.push('リマインダーはまだ届いていません');
      }
      return { items: searchLocal(src, query), notes };
    },
    openLocal: (item) => {
      // その区画を開いて、そのカードを出す（もう無ければ false）
      if (item.kind === 'tab') {
        const id = Number(item.id);
        if (!store.get(id)) return false;
        send({ type: 'activateTab', id });
      } else if (item.kind === 'capture') {
        if (!captureStore.items.some((c) => c.id === item.id)) return false;
        sectionShelf?.show('capture');
        capturePanel.reveal(item.id);
      } else if (item.kind === 'vault') {
        if (!vaultStore.get(item.id)) return false;
        sectionShelf?.show('vault');
        vaultPanel.reveal(item.id);
      } else if (item.kind === 'reminder') {
        if (!reminders.some((r) => r.id === item.id)) return false;
        sectionShelf?.show('reminder');
      } else {
        if (!vocab.cards.some((c) => c.id === item.id)) return false;
        sectionShelf?.show('vocab');
        vocabPanel.reveal(item.id);
      }
      return true;
    },
  });
  // 右の台帳が変わったら、右の中だけ探し直す（撮影の台帳は、作った所の下で）
  store.onChange(() => searchPanel.localChanged());
  vaultStore.onChange(() => searchPanel.localChanged());
  tagPad.onChange(() => {
    render();
    memoPad.render(); // 一覧の印にボタンの並びも入っているので、変わったときだけ描き直す（返信を書いている間は待つ）
    tagIndex.render();
  });
  const placeholder = el('section', 'panel-section panel-placeholder');
  placeholder.append(el('p', 'sidebar-placeholder-note', 'ここに今後、メモなどのパネルを追加できます'));
  const scroll = el('div', 'panels-scroll');
  scroll.append(
    memoPad.element,
    searchPanel.element,
    tagIndex.element,
    previewSection,
    routePanel.element,
    vocabPanel.element,
    infoPanel.element,
    organizePanel.element,
    memoryPanel.element,
    sleepPanel.element,
    reminderPanel.element,
    placeholder,
  );

  // AI の相棒の道具が使う手足（タブの操作は C++ に、台帳やリマインダーの変更は左サイドバーに頼む）
  const toolHost: ToolHost = {
    ready: () => toolHost.waitFor(() => gotState || null, 3000),
    tabs: () => store.all(),
    sheets: () => sheets,
    activeId: () => store.activeId,
    openUrl: (url, background) => askLeft({ command: 'openUrl', url, background }),
    activate: (id) => send({ type: 'activateTab', id }),
    discard: (id) => send({ type: 'discardTab', id }),
    close: (id) => send({ type: 'closeTab', id }),
    navigate: (id, url) => send({ type: 'navigate', id, url }),
    setMuted: (id, muted) => send({ type: 'setMuted', id, muted }),
    async evalInTab(id, script, timeoutMs) {
      const reply = await request((requestId) => ({ type: 'evalInTab', requestId, id, script }), timeoutMs);
      if (reply?.type !== 'evalResult') return { ok: false, error: 'timeout' };
      return { ok: reply.ok, value: reply.value, error: reply.error };
    },
    reminders: () => reminders,
    setTags: (id, tags) => askLeft({ command: 'setTags', id, tags }),
    createIslands: (drafts) => askLeft({ command: 'createIslands', islands: drafts }),
    islands: () => islands,
    remember: (text) => memory.add(text, 'ai'),
    forget: (id) => memory.remove(id),
    async memories() {
      await memory.ready;
      await memory.refresh();
      return { place: memory.placeLabel, editable: memory.editable, items: memory.list() };
    },
    topics: () =>
      topics.list().map((t) => ({
        name: t.name,
        query: t.query,
        everyHours: t.everyHours,
        lastRunAt: t.lastRunAt,
        top: topics
          .resultsOf(t.id)
          .items.filter((i) => !i.dismissed)
          .sort((a, b) => b.total - a.total)
          .slice(0, 3)
          .map((i) => ({ title: i.title, url: i.url, total: i.total })),
      })),
    async addTopic(fields) {
      await topics.ready;
      const name = [...fields.name.trim()].slice(0, 30).join('');
      if (!name || !fields.query.trim()) return { ok: false, message: '名前と、調べたいことが要ります' };
      if (topics.find(name)?.name === name) return { ok: false, message: `「${name}」はもう登録してあります` };
      await topics.save(newTopic({ name, query: fields.query.trim().slice(0, 600), everyHours: fields.everyHours }));
      return { ok: true, message: `情報収集のトピック「${name}」を登録しました` };
    },
    async runTopic(name) {
      await topics.ready;
      const topic = topics.find(name);
      if (!topic) return { ok: false, message: `「${name}」というトピックはありません`, items: [] };
      const r = await infoPanel.run(topic, false);
      const items = topics
        .resultsOf(topic.id)
        .items.filter((i) => !i.dismissed)
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)
        .map((i) => ({ title: i.title, url: i.url, total: i.total, summary: i.summary }));
      return { ok: r.ok, message: r.message, items };
    },
    routes: () => routes,
    vocab: () => vocab,
    addCards: (cards) => askLeft({ command: 'addCards', cards }),
    // ほかのタブの本文（フェイブルが記事を比べるとき）。長い本文は 2万字まで
    async readTab(id) {
      const page = await requestPageText(id);
      if (await pageIsBlocked(page.url)) return { ok: false, title: page.title ?? '', url: '', text: '', truncated: false, error: BLOCK_NOTE };
      if (page.error || !page.text) {
        const error =
          page.error === 'noPage'
            ? 'そのタブは休眠中か、ページがありません（使う人がタブを開いてから、もう一度）'
            : page.error === 'timeout'
              ? 'ページの本文を取り出すのに時間がかかりすぎました'
              : 'このページからは文章を取り出せませんでした';
        return { ok: false, title: '', url: '', text: '', truncated: false, error };
      }
      const chars = [...page.text];
      const text = chars.length > 20_000 ? chars.slice(0, 20_000).join('') : page.text;
      return { ok: true, title: page.title ?? '', url: page.url ?? '', text, truncated: !!page.truncated || chars.length > 20_000 };
    },
    addMemoCell: (text, by) => askLeft({ command: 'addMemoCell', text, by }),
    addTabNote: (tabId, note) => askLeft({ command: 'addNote', tabId, note }),
    replyToNote: (tabId, noteId, text, by) => askLeft({ command: 'addReply', ref: { kind: 'note', tabId, noteId }, parent: null, text, by }),
    addReminder(reminder) {
      // いっぱい（100 件）なら置かない（K2。左の黙った落ちに頼らない。同じ id の置き直しは数えない）
      // 時刻のものは 100 件、引き金のもの（K4）は別に 30 件まで
      const triggered = !!reminderTrigger(reminder);
      const limit = triggered ? MAX_TRIGGERS : MAX_REMINDERS;
      const same = reminders.filter((r) => !!reminderTrigger(r) === triggered);
      if (!reminders.some((r) => r.id === reminder.id) && same.length >= limit) {
        rightToast(`${triggered ? '引き金のリマインダー' : 'リマインダー'}がいっぱいです（${limit} 件）。古いものを取り消してください`);
        return false;
      }
      reminders = [...reminders.filter((r) => r.id !== reminder.id), reminder].sort((a, b) => a.dueAt - b.dueAt); // 左から写しが届くまでの間も、一覧に出す
      paintReminders();
      askLeft({ command: 'addReminder', reminder });
      return true;
    },
    cancelReminder(id) {
      reminders = reminders.filter((r) => r.id !== id);
      paintReminders();
      askLeft({ command: 'cancelReminder', id });
    },
    waitFor: (check, timeoutMs) =>
      new Promise((resolve) => {
        const first = check();
        if (first) return resolve(first);
        const started = Date.now();
        const timer = window.setInterval(() => {
          const value = check();
          if (value || Date.now() - started > timeoutMs) {
            window.clearInterval(timer);
            resolve(value ?? null);
          }
        }, 200);
      }),
  };

  // いちばん下には、AI の相棒が常駐する（ボットの巣は、このあとできるので、下書きを開く先はあとからつなぐ）
  let askCompanionBot: (text: string) => boolean = () => false;
  const ai = new AiPanel({
    keepNote: (tabId, note) => askLeft({ command: 'addNote', tabId, note }),
    activeTabId: () => store.activeId,
    tools: new BrowserTools(toolHost),
    memory: () => memory.block(),
    openUrl: (url) => askLeft({ command: 'openUrl', url, background: false }),
    addCards: (cards) => askLeft({ command: 'addCards', cards }),
    placeMemoCell: (text, by, label) => askLeft({ command: 'addMemoCell', text, by, label }),
    copyMemoCell: (text, by, label) => askLeft({ command: 'copyMemoCell', text, by, label }),
    toVault: (draft) => vaultPanel.add(draft),
    conversationToVault: () => void vaultPanel.saveConversation(),
    askBot: (text) => askCompanionBot(text),
    reminderActions: (reminder) => reminderBubbleActions(reminder),
    askLeft: (action) => askLeft(action),
  });
  // 右下の Grok-Bot の巣（相棒の並びの下。6つの席の六角形の輪。席を押すと選び、ダブルクリックで Grok Bot アプリのチャットが開く。第3段 S3.2）
  //   相棒の顔・切り替え・入力欄はそのまま。台帳は左が持つので、写しを見て、変えたいときは左に頼む
  //   依頼の小窓（S3.5）に添えられるのは、右で見ているタブの URL と題名（選んだ文・本文は読む画面から。S3.11）
  const botDock = new BotDock({
    askLeft,
    menu,
    toast: (text, ms) => showToast(document.body, text, ms ?? 4500),
    selected: (id) => botPanel.show(id),
    openInbox: () => botPanel.openList(), // 巣の下の1行（S3.8）
    openDrafts: () => botPanel.openDrafts(), // 殻の段 1〜2
    openReply: (id) => botPanel.openUnread(id), // 返事が届いて光る席を押した（R8。その返事へ飛び、読んだにする）
    // 巣の ⚙「送り方」（依頼の小窓 v2・R11）：宛先と鍵は C++ に直接渡す（左を通さない。C++ が DPAPI の bot-hook.bin にしまい、「ある／ない」だけを返す）。
    //   変えたら左に botHookChanged（左が「ある／ない」を読み直し、小窓へ写しで渡す）
    hook: {
      state: async () => {
        const reply = await request((requestId) => ({ type: 'getBotHook', requestId }), 5000);
        return reply?.type === 'botHook' ? reply.has : null;
      },
      save: async (url, key) => {
        const reply = await request((requestId) => ({ type: 'setBotHook', requestId, url, key }), 8000);
        if (reply?.type !== 'botHook') return null;
        askLeft({ command: 'botHookChanged' });
        return { has: reply.has, ...(reply.error ? { error: reply.error } : {}) };
      },
      remove: async () => {
        const reply = await request((requestId) => ({ type: 'deleteBotHook', requestId }), 5000);
        if (reply?.type !== 'botHook') return null;
        askLeft({ command: 'botHookChanged' });
        return reply.has;
      },
    },
    page: () => {
      const tab = store.active;
      return tab ? { url: tab.url, title: tab.title } : null;
    },
  });
  if (BOT_FEATURES) ai.element.append(botDock.element);
  if (BOT_FEATURES) new BotStrip(botDock.element); // 段 2 の帯。旗が無ければ要素を足さない
  infoHost.askBot = (text) => botDock.openTopic(text);
  askCompanionBot = (text) => botDock.openCompanion(text);
  const cue = new CuePanel({
    pageText: (id) => requestPageText(id),
    blocked: (url) => pageIsBlocked(url),
    target: () => botDock.cueTarget(),
    openForm: (input) => botDock.openCue(input),
    saveMemo: (text) => askLeft({ command: 'addMemoCell', text, label: '合図' }),
    toast: (text) => showToast(document.body, text, 5000),
  });
  // Grok Visions（S3.7b）：左が残した Vision の写し（relay の visions）と、巣の設定「月の窓に Visions を出す」（relay の bots の nest.visions）
  const visionView = new VisionView();
  const removeVision = (id: string) => askLeft({ command: 'removeVision', id });
  // ボットの欄（Q8 の案1：メモの区画の下、データ置き場のさらに下）。右下の Grok Bot で選んだボット・盤面のカードから開いたボットのやり取り
  const botPanel: BotPanel = new BotPanel({
    askLeft,
    menu,
    toast: (text, ms) => showToast(document.body, text, ms ?? 4500),
    selected: (id) => botDock.choose(id),
    copyAndOpen: (id) => botDock.copyAndOpenFor(id),
    sendDraft: async (draft) => {
      const result = await new AskLeftSender(askLeft).send(draft.req);
      if (!result.ok) {
        rightToast(result.message);
        return false;
      }
      return true;
    },
    followUp: (id, text, parentRequestId) => botDock.followUp(id, text, parentRequestId), // 回答カードの「続けて聞く」（S3.10。R5 から、その返事の依頼を「続きとして」選んで開く）
    reopenDraft: (draft) => botDock.openUnsent(draft), // 未送信の「送り方を選び直す…」（R8）
    askAgain: (how, item, line) => botDock.askAgain(how, item, line), // 回答カードの「もう一度 ▾」（R9。別の子へ渡す・言い換えてもう一回・頼み方を直す）
    hexTarget: () => ai.hexMemoTarget()?.label ?? null, // 回答カードの「六角メモで開く」の送り先（相棒の設定。S3.10）
    addCards: (cards) => askLeft({ command: 'addCards', cards }),
    existingFronts: () => vocab.cards.map((card) => card.front),
    organizeSettings: () => ai.organizeSettings(),
    diveEstimate: (chars) => ai.diveEstimate(chars),
    diveReply: (text) => ai.diveReply(text),
    showEstimate: (chars) => ai.showEstimate(chars),
    showReply: (text) => ai.showReply(text),
    vision: (botId, fileId) => visionView.byFile(botId, fileId),
    removeVision,
  });
  visionView.onChange(() => botPanel.render()); // 返事のカードの「Vision」札
  // メモの区画のすぐ下の区画：データ置き場（相棒との会話の画像と文字・相棒が作ったもの）
  const vaultPanel: VaultPanel = new VaultPanel({
    store: vaultStore,
    conversation: () => ai.conversationSnapshot(),
    hexMemoTarget: () => ai.hexMemoTarget(),
    askLeft,
    tagPad,
    toast: rightToast,
  });
  // 右サイドバーの上の区画：月の窓（公開してよいフェイブルレターと Grok Visions を、1通ずつ映す）
  const moonWindow: MoonWindow = new MoonWindow(
    ai.letters,
    {
      openLetter: (id) => void ai.openLetter(id),
      openConversation: (id) => void ai.openConversationById(id),
      // もとの返事へ：ボットの欄でその返事のカードを見せる（ボットが台帳にいない・カードが写しに無いときは、要点を開く）
      openReply: (vision) => {
        const missing = () => {
          moonWindow.showVisionPoints(vision.id);
          rightToast('もとの返事は、いまのボットの欄には出ていません（古いやり取りか、ボットが台帳にいません）。要点を開きました');
        };
        if (!botPanel.openMessage(vision.botId, vision.source.fileId, missing)) missing();
      },
      removeVision,
      openUrl: (url) => askLeft({ command: 'openUrl', url, background: false }),
    },
    visionView,
    {
      vocab: () => vocab.cards,
      reminders: () => reminders,
      practice: () => ai.organizeSettings().practice,
      voices: (team) => ai.commentVoices(team),
      aiSettings: () => ai.organizeSettings(),
      keepComment: (text) => void ai.keepMoonComment(text),
      sidebarOpen: () => rightOpen,
      onChange: (fn) => {
        vocabListeners.push(fn);
        reminderListeners.push(fn);
      },
      openVocab: (id) => {
        sectionShelf?.show('vocab');
        vocabPanel.reveal(id);
      },
      openReminder: () => sectionShelf?.show('reminder'),
      openReminderLink: (r) => {
        const link = reminderLink(r);
        if (link) openReminderLink(link);
      },
      delayReminder: (r, ms, fired) => {
        if (fired) void snoozeReminder(r, Date.now() + ms); // 鳴ったものは写しで延ばす（記録は「延ばした」）
        else void toolHost.addReminder({ ...r, dueAt: Math.max(r.dueAt, Date.now()) + ms }); // まだ鳴っていないものは同じ id で時刻だけ
      },
      doneReminder: (id, fired) => doneReminder(id, fired),
      grade: (id, grade) => askLeft({ command: 'gradeCard', id, grade }), // めぐる表示の 1 枚の評価（K1）
      setMark: (id, on) => askLeft({ command: 'updateCard', id, rotate: on }), // ⟳ の印（K1）
      image: (image) => cardImages.get(image), // カードの指す画像（K6）
      hereIds: () => hereIds, // 「このページ n 枚」（K6）
      cellLink: (card) => vocabPanel.cellLink(card), // 「セルへ：題名」（K6）
    },
  );
  // データ置き場は見出しのすぐ下（月の窓とその下のパネルの欄は、隣り合わせのまま。CSS が隣どうしを前提にしている）
  // データ置き場は、下のパネルの欄の中の「メモの区画」のすぐ下（欄といっしょに動くので、相棒の会話の入力欄を押し出さない）
  const captureStore = new CaptureStore();
  captureStore.onChange(() => sendCaptureBoard());
  captureStore.onChange(() => searchPanel.localChanged());
  captureStore.onChange(() => cardImages.forgetMissing()); // 撮り直した・戻した撮影は、次に読み直す（K6）
  cardImages.onChange(() => {
    vocabPanel.render();
    for (const fn of vocabListeners) fn(); // 月の窓のめぐる表示
  });
  const capturePanel = new CapturePanel({
    store: captureStore,
    activeTab: () => {
      const tab = store.active;
      return tab ? { id: tab.id, url: tab.url, title: tab.title } : null;
    },
    askLeft,
    menu,
    toast: rightToast,
    companions: () => ai.captureCompanions(),
    bots: () => botPanel.listBots(),
    practice: () => ai.organizeSettings().practice,
    busy: () => ai.companionBusy(),
    companionPrice: (target) => ai.capturePrice(target),
    sendCapture: (text, images, target, display) => ai.sendCapture(text, images, target, display),
    botAppConfirmed: () => botDock.appConfirmed(),
    confirmBotApp: () => botDock.confirmAppOpen(),
  });
  // 隠す・取り消すが成功するたび（右のカードからでも、読む画面からでも）、右のカードと、左・読む画面の画像を新しくする
  captureStore.onHidden((ev) => {
    capturePanel.replaceImage(ev.id, ev.image);
    send({ type: 'relay', to: 'left', payload: { kind: 'captureChanged', id: ev.id, image: ev.image, blur: ev.blur, undo: ev.undo } });
  });
  // 撮影はデータ置き場のすぐ下。メモのすぐ下がデータ置き場、という並びは変えない
  memoPad.element.after(vaultPanel.element);
  vaultPanel.element.after(capturePanel.element);
  capturePanel.element.after(cue.element);
  if (BOT_FEATURES) cue.element.after(botPanel.element);
  $('panels').append(header, moonWindow.element, scroll, ai.element);
  mountSectionShelf();

  // 全部の区画をたためるようにし、見出しの右クリックで上のタグ（6つ）に登録する
  function mountSectionShelf() {
    const shelf = new SectionShelf(menu, rightToast);
    sectionShelf = shelf;
    moonWindow.element.before(shelf.bar);
    const head = (root: ParentNode, selector: string) => {
      const node = root.querySelector(selector);
      return node instanceof HTMLElement ? node : null;
    };
    shelf.adopt({
      id: 'moon',
      title: '月の窓',
      element: moonWindow.element,
      header: '.moon-head',
      collapsed: () => moonWindow.isCollapsed(),
      expand: () => moonWindow.expand(),
      available: () => !moonWindow.element.hidden,
      unavailable: '月の窓は、いま出すものがありません',
    });
    shelf.adopt({
      id: 'memo',
      title: 'メモ',
      element: memoPad.element,
      header: memoPad.header,
      collapsed: () => memoPad.isCollapsed(),
      expand: () => memoPad.expand(),
    });
    shelf.adopt({
      id: 'vault',
      title: 'データ置き場',
      element: vaultPanel.element,
      header: vaultPanel.header,
      collapsed: () => vaultPanel.isCollapsed(),
      expand: () => vaultPanel.expand(),
    });
    shelf.adopt({
      id: 'capture',
      title: '撮影',
      element: capturePanel.element,
      header: capturePanel.header,
      collapsed: () => capturePanel.isCollapsed(),
      expand: () => capturePanel.expand(),
    });
    const cueHead = head(cue.element, '.cue-head');
    if (cueHead) shelf.fold({ id: 'cue', title: '合図', element: cue.element, keep: cueHead });
    shelf.adopt({
      id: 'bot',
      title: '受け取り箱',
      element: botPanel.element,
      header: botPanel.header,
      collapsed: () => botPanel.isCollapsed(),
      expand: () => botPanel.expand(),
    });
    shelf.adopt({
      id: 'search',
      title: '検索',
      element: searchPanel.element,
      header: searchPanel.header,
      collapsed: () => searchPanel.isCollapsed(),
      expand: () => searchPanel.expand(),
    });
    shelf.adopt({
      id: 'tags',
      title: 'タグごとの一覧',
      element: tagIndex.element,
      header: tagIndex.header,
      collapsed: () => tagIndex.isCollapsed(),
      expand: () => tagIndex.expand(),
    });
    shelf.wrap({ id: 'preview', title: '拡大表示', element: previewSection });
    const routeHead = head(routePanel.element, '.info-head');
    const routeTitle = head(routePanel.element, '.info-head .panel-subtitle');
    if (routeHead && routeTitle) shelf.fold({ id: 'route', title: '順路', element: routePanel.element, keep: routeHead, foldHost: routeTitle });
    shelf.barOn({ id: 'vocab', title: '単語帳', element: vocabPanel.element });
    const infoHead = head(infoPanel.element, '.info-head');
    const infoTitle = head(infoPanel.element, '.info-head .panel-subtitle');
    if (infoHead && infoTitle) shelf.fold({ id: 'info', title: '情報収集', element: infoPanel.element, keep: infoHead, foldHost: infoTitle });
    const organizeHead = head(organizePanel.element, ':scope > .panel-subtitle');
    if (organizeHead) shelf.fold({ id: 'organize', title: '整理（タグと島）', element: organizePanel.element, keep: organizeHead });
    const memoryHead = head(memoryPanel.element, ':scope > .panel-subtitle');
    if (memoryHead) shelf.fold({ id: 'memory', title: '相棒が覚えていること', element: memoryPanel.element, keep: memoryHead });
    const sleepHead = head(sleepPanel.element, ':scope > .panel-subtitle');
    if (sleepHead) shelf.fold({ id: 'sleep', title: '休眠', element: sleepPanel.element, keep: sleepHead });
    const reminderHead = head(reminderPanel.element, ':scope > .panel-subtitle');
    if (reminderHead) shelf.fold({ id: 'reminder', title: 'リマインダー', element: reminderPanel.element, keep: reminderHead });
    shelf.barOn({ id: 'later', title: 'これからの区画', element: placeholder });
    shelf.barOn({ id: 'ai', title: '相棒', element: ai.element });
    shelf.finish();
  }

  function render() {
    if (isWritingIn(previewSection)) return; // メモを書いている途中
    if (placement === null) {
      previewSection.replaceChildren();
      return;
    }
    if (placement !== 'right') {
      previewSection.replaceChildren(
        el('div', 'preview-empty', '拡大表示をここに出すには、左のサイドバーの虫めがねのメニューで「右サイドバー」を選びます'),
      );
      return;
    }
    const id = focusId !== null && store.get(focusId) ? focusId : store.activeId;
    const tab = id === null ? undefined : store.get(id);
    // 押したボタン（タグのボタンなど）に、描き直した後もキーボードの位置を残す（左の拡大表示と同じ）
    const active = document.activeElement instanceof HTMLElement && previewSection.contains(document.activeElement) ? document.activeElement.dataset.focusKey : undefined;
    previewSection.replaceChildren(
      tab
        ? previewCard({
            tab,
            activeId: store.activeId,
            thumbnail: thumbs.get(tab.id),
            compact: false,
            actions,
            island: islands.find((i) => i.id === tab.island),
            thread: threadUi,
            faceImage: faceImageOf(tab.image),
            sheetName: tab.sheet === MAIN_SHEET ? undefined : sheets.find((sh) => sh.id === tab.sheet)?.name,
            tagPad,
            toast: rightToast,
          })
        : el('div', 'preview-empty', 'タブがありません'),
    );
    if (active) previewSection.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
  }
  store.onChange(render);
  store.onChange(() => cue.watch(store.active ? { id: store.active.id, url: store.active.url, title: store.active.title, loading: store.active.loading } : null));
  thumbs.onChange(render);
  window.setInterval(render, 30_000); // 「○分前に使用」の表示を新しくする

  // ページの右クリックと Ctrl+Shift+Y。写しがまだ無いときは、届いてから撮る（開いた直後に空の台帳で撮らない）
  // 盤面の「撮ったもの」へ、台帳の短い一覧（画像は送らない）。読み終える前の空一覧では、置いてあるセルを消さない
  function sendCaptureBoard() {
    if (!captureStore.isLoaded) return;
    send({
      type: 'relay',
      to: 'left',
      payload: {
        kind: 'captureBoard',
        items: captureStore.items.map((item) => ({ id: item.id, marks: item.marks.length, createdAt: item.createdAt })),
      },
    });
  }

  function captureFromPage(scope: CaptureScope) {
    if (!gotState) {
      captureAfterState = scope;
      return;
    }
    captureAfterState = null;
    sectionShelf?.show('capture');
    capturePanel.captureScope(scope);
  }

  function captureImageFromPage(req: Extract<RelayPayload, { kind: 'captureImage' }>) {
    if (!gotState) {
      captureImageAfterState = req;
      return;
    }
    captureImageAfterState = null;
    sectionShelf?.show('capture');
    void capturePanel.shootImage(req);
  }

  function recordFromPage() {
    if (!gotState) {
      recordAfterState = true;
      return;
    }
    recordAfterState = false;
    sectionShelf?.show('capture');
    if (capturePanel.isRecording()) capturePanel.stopRecord();
    else capturePanel.startRecord();
  }

  onMessage((msg) => {
    switch (msg.type) {
      case 'hello':
        noteSidebars(msg.sidebars);
        send({ type: 'relay', to: 'left', payload: { kind: 'requestState' } });
        break;
      case 'sidebars':
        noteSidebars(msg.state);
        break;
      case 'relayed':
        if (msg.payload.kind === 'state') {
          placement = msg.payload.placement;
          sleepPanel.setSettings(msg.payload.sleep);
          gotState = true;
          islands = msg.payload.islands ?? [];
          highlightLike = likeLevel(msg.payload.highlightLike);
          highlightTag = highlightLike ? null : (msg.payload.highlightTag ?? null);
          reminders = msg.payload.reminders ?? [];
          remindersFailed = msg.payload.remindersFailed === true;
          sheets = msg.payload.sheets ?? [];
          leftTagButtons = msg.payload.tagButtons ?? null;
          paintReminders();
          store.replaceAll(msg.payload.tabs, msg.payload.activeId);
          organizePanel.render();
          memoPad.tabsChanged();
          memoPad.sheetsChanged();
          tagIndex.render();
          if (captureAfterState) captureFromPage(captureAfterState);
          if (recordAfterState) recordFromPage();
          if (captureImageAfterState) captureImageFromPage(captureImageAfterState);
          sendCaptureBoard();
        } else if (msg.payload.kind === 'tagButtonsOp') {
          // 下の区画のカードから：タグのボタンを変えて、今の台帳を返す（読み込む前なら、読み終えてから）
          const { op, seq } = msg.payload;
          const to = msg.from;
          void (tagButtons.ready ? Promise.resolve() : tagButtons.load()).then(() => {
            tagButtons.apply(op);
            send({ type: 'relay', to, payload: { kind: 'tagButtonsDone', seq, book: tagButtons.book } });
          });
        } else if (msg.payload.kind === 'focus') {
          focusId = msg.payload.id;
          render();
        } else if (msg.payload.kind === 'thumbnails') {
          thumbs.put(msg.payload.images);
        } else if (msg.payload.kind === 'event') {
          ai.onEvent(msg.payload.event);
        } else if (msg.payload.kind === 'reminder') {
          void ai.onReminder(msg.payload.reminder, msg.payload.late);
        } else if (msg.payload.kind === 'readerTalk') {
          void ai.startTalk(msg.payload.talk); // 六角で見るのやり取りの型（V5。形は右で確かめる）
        } else if (msg.payload.kind === 'readerCardDone') {
          ai.onTalkCardDone(msg.payload); // 右の「📌 カードへ」の返事（V5）
        } else if (msg.payload.kind === 'askCompanion') {
          const payload = msg.payload;
          void (async () => {
            const from = payload.from ?? 'reader';
            const blocked = await pageIsBlocked(payload.url);
            if (blocked && from === 'memo') {
              showToast(document.body, BLOCK_NOTE, 6000);
              void ai.askAbout(payload.text, payload.title, 'memo');
            } else if (blocked && from === 'shot' && payload.text.trim()) {
              showToast(document.body, BLOCK_NOTE, 6000);
              void ai.askAbout(payload.text, '', 'shot');
            } else if (blocked) {
              showToast(document.body, BLOCK_NOTE, 6000);
            } else {
              void ai.askAbout(payload.text, payload.title, from, payload.image);
            }
          })();
        } else if (msg.payload.kind === 'routes') {
          routes = msg.payload.state;
          routePanel.setState(msg.payload.state, msg.payload.shown);
        } else if (msg.payload.kind === 'remindersFired') {
          reminderPanel.renderFired(msg.payload.items, msg.payload.failed === true); // 鳴ったものの記録（K3）
        } else if (msg.payload.kind === 'vocabHere') {
          hereIds = msg.payload.ids; // 左が表示中のページから作ったカード（K6）。月の窓の札を描き直す
          for (const fn of vocabListeners) fn();
        } else if (msg.payload.kind === 'vocabFilter') {
          sectionShelf?.show('vocab');
          vocabPanel.setFilter(msg.payload.ids, msg.payload.label); // 盤面のセルの右クリック「つながったカードを見る」（K6b）
        } else if (msg.payload.kind === 'vocab') {
          vocab = msg.payload.state;
          gotVocab = true;
          vocabPanel.setState(msg.payload.state);
          for (const fn of vocabListeners) fn(); // 月の窓のめぐる表示
          searchPanel.localChanged(); // 検索：単語帳の中を探し直す
        } else if (msg.payload.kind === 'threadPending') {
          replyPending.splice(0, replyPending.length, ...msg.payload.pending);
          render();
          memoPad.render();
        } else if (msg.payload.kind === 'rightMemos') {
          memoPad.setMemos(msg.payload);
        } else if (msg.payload.kind === 'vaultAdd') {
          void vaultPanel.add(msg.payload.draft); // 左サイドバーから（相棒が残した考察のメモ）
        } else if (msg.payload.kind === 'memoIndex') {
          memoIndex = msg.payload.memos;
          tagIndex.render();
          searchPanel.refresh();
          organizePanel.render(); // メモのいいねの数
        } else if (msg.payload.kind === 'searchResults') {
          searchPanel.receive(msg.payload);
        } else if (msg.payload.kind === 'searchNotice') {
          searchPanel.notice(msg.payload.text); // 左が決めた短い知らせ
        } else if (msg.payload.kind === 'memoRev') {
          searchPanel.refresh(); // メモの台帳が変わった（コメントの足し引きは memoIndex に出ない）
        } else if (msg.payload.kind === 'nestForm') {
          botDock.openAddressed(msg.payload.address); // Grok Cards の「＋下書き」（段 4 の前）。今の依頼の小窓
        } else if (msg.payload.kind === 'cardForm') {
          botDock.openCard(msg.payload); // 段 5。札の文を、今の依頼の小窓に入れる（押すまで送らない）
        } else if (msg.payload.kind === 'cardApp') {
          botDock.openApp(msg.payload.botId); // 段 5・6。アプリを開くだけ
        } else if (msg.payload.kind === 'bots') {
          botDock.setState(msg.payload); // 右下の Grok Bot：ボットの台帳の写し
          botPanel.setState(msg.payload); // ボットの欄：台帳・状態・受け取り口の様子
          visionView.setEnabled(msg.payload.nest?.visions !== 'off'); // 巣の設定「月の窓に Visions を出す」
        } else if (msg.payload.kind === 'visions') {
          visionView.set(msg.payload); // Grok Visions の写し（月の窓・ボットの欄の札）
        } else if (msg.payload.kind === 'botThread') {
          botPanel.setThread(msg.payload.thread); // ボットの欄：見ているボットのやり取り
        } else if (msg.payload.kind === 'botGroupReplies') {
          botPanel.setGroupReplies(msg.payload.group, msg.payload.replies); // 受け取り箱の組のカードの「まとめて読む」（S3.8）
        } else if (msg.payload.kind === 'botAnswerLines') {
          botDock.answerLines(msg.payload); // 小窓の「続きとして」の要点の行（R5。頼んだものだけを使う）
        } else if (msg.payload.kind === 'botHookResult') {
          botDock.hookResult(msg.payload); // 小窓の webhook「そのまま送る」の結果（R11。頼んだものだけを使う）
        } else if (msg.payload.kind === 'botTeamHandoff') {
          botDock.openHandoff(msg.payload); // まとめ役に渡す文を小窓へ（G3）。コピーするまでアプリは開かない
        } else if (msg.payload.kind === 'botOpen') {
          botPanel.open(msg.payload.botId); // 盤面のカードの「やり取りを見る」
        } else if (msg.payload.kind === 'botNotice') {
          // 左がボットのことで決めた知らせ（依頼をコピーした など）。返事が届いた知らせは相棒の吹き出しで（Q7。見えていれば出さない）
          if (msg.payload.fileId) botPanel.cardNote(msg.payload.fileId, msg.payload.text); // 回答カードの下の1行（S3.10）
          if (msg.payload.notice === 'absent') botPanel.absent(msg.payload.text); // 不在票（R8。受け取り箱の上に 1 枚。知らせも出す）
          if (!msg.payload.bubble) showToast(document.body, msg.payload.text, 6000);
          else if (!botPanel.isShowing(msg.payload.botId)) void ai.announce(msg.payload.text);
        } else if (msg.payload.kind === 'vocabDue') {
          void ai.announce(`📇 単語帳に、今日復習するカードが ${msg.payload.count} 枚あります（右の「単語帳」パネルの「復習する」から）`);
        } else if (msg.payload.kind === 'captureReveal') {
          sectionShelf?.show('capture');
          capturePanel.reveal(msg.payload.id);
        } else if (msg.payload.kind === 'captureCenter') {
          captureFromPage('center');
        } else if (msg.payload.kind === 'captureShot') {
          // 盤面・下の区画の画像（I4）。タブの写しは使わないので、届くのを待たない
          sectionShelf?.show('capture');
          void capturePanel.keepShot(msg.payload.shot, msg.payload.from, msg.payload.name ?? '');
        } else if (msg.payload.kind === 'captureImage') {
          captureImageFromPage(msg.payload);
        } else if (msg.payload.kind === 'captureRecord') {
          recordFromPage();
        } else if (msg.payload.kind === 'captureScope') {
          captureFromPage(msg.payload.scope);
        } else if (msg.payload.kind === 'captureCropped') {
          void capturePanel.finishCrop(msg.payload.image);
        } else if (msg.payload.kind === 'captureCropCancel') {
          capturePanel.cancelCrop();
        } else if (msg.payload.kind === 'captureMarks') {
          void captureStore.setMarks(msg.payload.id, msg.payload.marks);
        } else if (msg.payload.kind === 'captureStrokes') {
          void captureStore.setStrokes(msg.payload.id, msg.payload.strokes);
        } else if (msg.payload.kind === 'captureHide' || msg.payload.kind === 'captureUnhide') {
          // 読む画面が頼んだ隠す・取り消す。結果は seq を付けて左へ返す（読む画面が、自分の頼みと照らす）
          const { id, seq } = msg.payload;
          const done = (ok: boolean, reason?: string) =>
            send({ type: 'relay', to: 'left', payload: { kind: 'captureHideDone', id, seq, ok, ...(reason ? { reason } : {}) } });
          const asked = msg.payload.kind === 'captureHide' ? captureStore.hide(id, { rects: msg.payload.rects, mode: msg.payload.mode }) : captureStore.unhide(id);
          void asked.then(
            // 成功でも一覧（captures.json）の保存に失敗していたら、reason: 'index' を付ける（ok は true のまま）
            (result) => (result.ok ? done(true, result.saved ? undefined : 'index') : done(false, result.reason)),
            () => done(false), // 店が例外で落ちた（理由は付けない）
          );
        } else if (msg.payload.kind === 'captureViewClosed') {
          captureStore.forgetUndo(msg.payload.id); // 読む画面を閉じたら、取り消しの写しは捨てる
        }
        break;
      case 'tabThumbnail':
        void thumbs.add(msg.id, msg.image);
        break;
      case 'tabClosed':
        thumbs.delete(msg.id);
        break;
      default:
        break;
    }
  });

  render();
  send({ type: 'ready' });
}
